"""WebSocket commands used by the sidebar panel.

Every command works with the logged-in Home Assistant user taken from the
connection, so a user only ever reaches their own data and their households.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import wraps
from typing import Any, Callable

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DEFAULT_CATEGORIES, DEFAULT_CATEGORIES_EN, DOMAIN, TEMPLATES, TEMPLATES_EN
from .engine import (
    FREQ_BUDGET,
    amount_on,
    budget_status,
    contract_info,
    period_finder,
    forecast,
    learned_interval_days,
    month_summaries,
    salary_periods,
    parse_date,
)
from .store import AccessError, ValidationError

SCOPE_ME = "me"


@callback
def async_register_websocket_commands(hass: HomeAssistant) -> None:
    for command in (
        ws_state,
        ws_save_item,
        ws_delete_item,
        ws_confirm,
        ws_plan,
        ws_set_balance,
        ws_forecast,
        ws_summary,
        ws_create_household,
        ws_update_household,
        ws_leave_household,
        ws_delete_household,
        ws_export,
        ws_import,
        ws_settings,
        ws_add_spending,
        ws_update_spending,
        ws_delete_spending,
    ):
        websocket_api.async_register_command(hass, command)


def _handler(func: Callable) -> Callable:
    """Resolve the runtime data, map errors and persist after writes."""

    @wraps(func)
    async def wrapper(hass: HomeAssistant, connection, msg: dict[str, Any]) -> None:
        data = hass.data.get(DOMAIN)
        if data is None:
            connection.send_error(msg["id"], "not_loaded", "Haushaltsbuch is not loaded")
            return
        try:
            result, changed = await func(hass, connection, msg, data)
        except AccessError as err:
            connection.send_error(msg["id"], "unauthorized", str(err))
            return
        except ValidationError as err:
            connection.send_error(msg["id"], "invalid_format", str(err))
            return
        if changed:
            await data.async_changed()
        connection.send_result(msg["id"], result)

    return wrapper


async def _user_names(hass: HomeAssistant) -> dict[str, str]:
    return {
        user.id: user.name or user.id
        for user in await hass.auth.async_get_users()
        if not user.system_generated
    }


def _finder(data, user_id: str, items, today: date, months: int = 13):
    """Budget months for this user: payday to payday when a salary is set."""
    salary = (data.book.user(user_id).get("settings") or {}).get("salary_item_id")
    return period_finder(
        items, salary, today - timedelta(days=62), today + timedelta(days=31 * (months + 1))
    )


def _scope_items(data, user_id: str, scope: str):
    book = data.book
    if scope == SCOPE_ME:
        user = book.user(user_id)
        return book.own_items(user_id), user["balance"], user["balance_date"]
    household = book.household(user_id, scope)
    return (
        book.items_of_household(scope),
        household["balance"],
        household["balance_date"],
    )


# ---------------------------------------------------------------------- read

@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/state"})
@websocket_api.async_response
@_handler
async def ws_state(hass, connection, msg, data):
    user_id = connection.user.id
    book = data.book
    names = await _user_names(hass)
    today = date.today()
    active_users = [
        {"id": user.id, "name": user.name or user.id}
        for user in await hass.auth.async_get_users()
        if not user.system_generated and user.is_active
    ]
    items = []
    finder = _finder(data, user_id, book.visible_items(user_id), today, 1)
    for item in book.visible_items(user_id):
        items.append(
            {
                **{k: v for k, v in item.items() if k not in ("confirmations", "spendings")},
                "owner_name": names.get(item["owner"], "?"),
                "editable": item["owner"] == user_id,
                "current_amount": amount_on(item, today),
                "contract_info": contract_info(item, today),
                "learned_days": learned_interval_days(item),
                **(
                    {"budget_status": budget_status(item, today, finder)}
                    if (item.get("schedule") or {}).get("frequency") == FREQ_BUDGET
                    else {}
                ),
            }
        )
    households = [
        {
            **household,
            "member_names": [names.get(m, "?") for m in household["members"]],
            "is_creator": household["created_by"] == user_id,
        }
        for household in book.households_for(user_id)
    ]
    user = book.user(user_id)
    used = {i["category"] for i in items if i.get("category")}
    categories = sorted(set(DEFAULT_CATEGORIES) | used)
    categories_en = sorted(set(DEFAULT_CATEGORIES_EN) | used)
    return (
        {
            "user": {"id": user_id, "name": names.get(user_id, ""), **user},
            "users": active_users,
            "items": sorted(items, key=lambda i: i["name"].lower()),
            "households": households,
            "categories": categories,
            "categories_en": categories_en,
            "templates": TEMPLATES,
            "templates_en": TEMPLATES_EN,
            "currency": hass.config.currency,
        },
        False,
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/forecast",
        vol.Required("scope"): str,
        vol.Required("start"): str,
        vol.Required("end"): str,
    }
)
@websocket_api.async_response
@_handler
async def ws_forecast(hass, connection, msg, data):
    start, end = parse_date(msg["start"]), parse_date(msg["end"])
    if start is None or end is None or end < start or (end - start).days > 400:
        raise ValidationError("range")
    items, balance, balance_date = _scope_items(data, connection.user.id, msg["scope"])
    names = await _user_names(hass)
    today = date.today()
    finder = _finder(data, connection.user.id, items, min(today, start), max(1, (end - today).days // 28 + 1))
    days = [
        day.as_dict()
        for day in forecast(items, start, end, balance, parse_date(balance_date), today, finder)
    ]
    for day in days:
        for entry in day["entries"]:
            entry["owner_name"] = names.get(entry["owner"], "?")
    return ({"days": days, "balance": balance, "balance_date": balance_date}, False)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/summary",
        vol.Required("scope"): str,
        vol.Optional("months", default=6): vol.All(int, vol.Range(min=1, max=24)),
    }
)
@websocket_api.async_response
@_handler
async def ws_summary(hass, connection, msg, data):
    user_id = connection.user.id
    items, _, _ = _scope_items(data, user_id, msg["scope"])
    salary = (data.book.user(user_id).get("settings") or {}).get("salary_item_id")
    periods = salary_periods(items, salary, date.today(), msg["months"])
    today = date.today()
    finder = _finder(data, user_id, items, today, msg["months"])
    return (month_summaries(items, today, msg["months"], periods, today, finder), False)


# --------------------------------------------------------------------- write

@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/item/save", vol.Required("item"): dict}
)
@websocket_api.async_response
@_handler
async def ws_save_item(hass, connection, msg, data):
    item_id = data.book.save_item(connection.user.id, msg["item"])
    return ({"id": item_id}, True)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/item/delete", vol.Required("item_id"): str}
)
@websocket_api.async_response
@_handler
async def ws_delete_item(hass, connection, msg, data):
    data.book.delete_item(connection.user.id, msg["item_id"])
    return (None, True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/confirm",
        vol.Required("item_id"): str,
        vol.Required("due_date"): str,
        vol.Required("status"): vol.Any(None, "booked", "skipped"),
        vol.Optional("actual_date"): vol.Any(None, str),
        vol.Optional("actual_amount"): vol.Any(None, vol.Coerce(float)),
    }
)
@websocket_api.async_response
@_handler
async def ws_confirm(hass, connection, msg, data):
    data.book.confirm(
        connection.user.id,
        msg["item_id"],
        msg["due_date"],
        msg["status"],
        msg.get("actual_date"),
        msg.get("actual_amount"),
    )
    return (None, True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/plan",
        vol.Required("item_id"): str,
        vol.Required("due_date"): str,
        vol.Required("date"): vol.Any(None, str),
        vol.Optional("amount"): vol.Any(None, vol.Coerce(float)),
    }
)
@websocket_api.async_response
@_handler
async def ws_plan(hass, connection, msg, data):
    data.book.plan(
        connection.user.id, msg["item_id"], msg["due_date"], msg["date"], msg.get("amount")
    )
    return (None, True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/balance",
        vol.Required("scope"): str,
        vol.Required("balance"): vol.Coerce(float),
        vol.Optional("balance_date"): str,
    }
)
@websocket_api.async_response
@_handler
async def ws_set_balance(hass, connection, msg, data):
    balance_date = msg.get("balance_date") or date.today().isoformat()
    if msg["scope"] == SCOPE_ME:
        data.book.set_user_balance(connection.user.id, msg["balance"], balance_date)
    else:
        data.book.set_household_balance(
            connection.user.id, msg["scope"], msg["balance"], balance_date
        )
    return (None, True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/household/create",
        vol.Required("name"): str,
        vol.Optional("members", default=[]): [str],
    }
)
@websocket_api.async_response
@_handler
async def ws_create_household(hass, connection, msg, data):
    valid = set((await _user_names(hass)).keys())
    members = [m for m in msg["members"] if m in valid]
    household_id = data.book.create_household(connection.user.id, msg["name"], members)
    return ({"id": household_id}, True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/household/update",
        vol.Required("household_id"): str,
        vol.Optional("name"): str,
        vol.Optional("members"): [str],
        vol.Optional("entities"): bool,
    }
)
@websocket_api.async_response
@_handler
async def ws_update_household(hass, connection, msg, data):
    members = msg.get("members")
    if members is not None:
        valid = set((await _user_names(hass)).keys())
        members = [m for m in members if m in valid]
    data.book.update_household(
        connection.user.id,
        msg["household_id"],
        name=msg.get("name"),
        members=members,
        entities=msg.get("entities"),
    )
    return (None, True)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/household/leave", vol.Required("household_id"): str}
)
@websocket_api.async_response
@_handler
async def ws_leave_household(hass, connection, msg, data):
    data.book.leave_household(connection.user.id, msg["household_id"])
    return (None, True)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/household/delete", vol.Required("household_id"): str}
)
@websocket_api.async_response
@_handler
async def ws_delete_household(hass, connection, msg, data):
    data.book.delete_household(connection.user.id, msg["household_id"])
    return (None, True)


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/export"})
@websocket_api.async_response
@_handler
async def ws_export(hass, connection, msg, data):
    return (data.book.export_items(connection.user.id), False)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/import",
        vol.Required("data"): dict,
        vol.Optional("replace", default=False): bool,
    }
)
@websocket_api.async_response
@_handler
async def ws_import(hass, connection, msg, data):
    result = data.book.import_items(connection.user.id, msg["data"], msg["replace"])
    return (result, True)


@websocket_api.websocket_command(
    {vol.Required("type"): f"{DOMAIN}/settings", vol.Required("settings"): dict}
)
@websocket_api.async_response
@_handler
async def ws_settings(hass, connection, msg, data):
    data.book.set_user_settings(connection.user.id, msg["settings"])
    return (None, True)


# ----------------------------------------------------------------- budgets

@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/spending/add",
        vol.Required("item_id"): str,
        vol.Required("date"): str,
        vol.Required("amount"): vol.Coerce(float),
        vol.Optional("note"): vol.Any(str, None),
    }
)
@websocket_api.async_response
@_handler
async def ws_add_spending(hass, connection, msg, data):
    spending_id = data.book.add_spending(
        connection.user.id, msg["item_id"], msg["date"], msg["amount"], msg.get("note")
    )
    return ({"id": spending_id}, True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/spending/update",
        vol.Required("item_id"): str,
        vol.Required("spending_id"): str,
        vol.Required("date"): str,
        vol.Required("amount"): vol.Coerce(float),
        vol.Optional("note"): vol.Any(str, None),
    }
)
@websocket_api.async_response
@_handler
async def ws_update_spending(hass, connection, msg, data):
    data.book.update_spending(
        connection.user.id,
        msg["item_id"],
        msg["spending_id"],
        msg["date"],
        msg["amount"],
        msg.get("note"),
    )
    return (None, True)


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/spending/delete",
        vol.Required("item_id"): str,
        vol.Required("spending_id"): str,
    }
)
@websocket_api.async_response
@_handler
async def ws_delete_spending(hass, connection, msg, data):
    data.book.delete_spending(connection.user.id, msg["item_id"], msg["spending_id"])
    return (None, True)
