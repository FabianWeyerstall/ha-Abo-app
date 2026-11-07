"""Haushaltsbuch: due dates of subscriptions, contracts and income in Home Assistant."""
from __future__ import annotations

import copy
from datetime import date, timedelta
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    EVENT_CONTRACT_REMINDER,
    PANEL_ICON,
    PANEL_STATIC_URL,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
    REMINDER_HOUR,
    SERVICE_ADD_EXPENSE,
    SERVICE_CONTRACT_REMINDERS,
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
)
from .engine import budget_status, contract_reminders, period_finder
from . import backups
from .ledger import Ledger
from .store import Book, ValidationError
from .websocket_api import async_register_websocket_commands

PLATFORMS = [Platform.CALENDAR, Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
STATIC_REGISTERED = f"{DOMAIN}_static_registered"


class HaushaltsbuchData:
    """Runtime holder for the book and its persistence."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.book = Book()
        self.ledger_store: Store = Store(hass, 1, f"{DOMAIN}.ledger")
        self.ledger = Ledger()
        self._entity_households: frozenset[str] = frozenset()

    async def async_load(self) -> None:
        self.book = Book(await self.store.async_load())
        self.ledger = Ledger(await self.ledger_store.async_load())
        self._entity_households = self.entity_households()

    def entity_households(self) -> frozenset[str]:
        return frozenset(
            hid for hid, hh in self.book.data["households"].items() if hh.get("entities")
        )

    async def async_backup(self, reason: str) -> str:
        """Write a backup of all data to /config/haushaltsbuch_backups."""
        document = backups.make_document(self.book, self.ledger, reason)
        return await self.hass.async_add_executor_job(
            backups.write, backups.backup_dir(self.hass), document
        )

    async def async_restore(self, document: dict) -> None:
        """Replace all data with a backup; the current state is saved first."""
        backups.check_document(document)
        await self.async_backup("before_restore")
        self.book = Book(copy.deepcopy(document["book"]))
        self.ledger = Ledger(copy.deepcopy(document.get("ledger") or {"users": {}}))
        await self.async_ledger_changed()
        await self.async_changed()

    async def async_ledger_changed(self) -> None:
        await self.ledger_store.async_save(self.ledger.data)

    async def async_changed(self) -> None:
        """Persist and notify entities; reload when the entity set changed."""
        await self.store.async_save(self.book.data)
        if self.entity_households() != self._entity_households:
            self.hass.config_entries.async_schedule_reload(self.entry.entry_id)
        else:
            async_dispatcher_send(self.hass, SIGNAL_UPDATED)


async def async_fire_contract_reminders(
    hass: HomeAssistant, today: date | None = None, all_upcoming: bool = False
) -> int:
    """Fire one event per contract whose cancel-by date is near. Returns the count."""
    data: HaushaltsbuchData | None = hass.data.get(DOMAIN)
    if data is None:
        return 0
    today = today or dt_util.now().date()
    users = {u.id: u.name or u.id for u in await hass.auth.async_get_users()}
    households = data.book.data["households"]
    reminders = contract_reminders(data.book.data["items"].values(), today, all_upcoming)
    for reminder in reminders:
        household = households.get(reminder["household_id"] or "")
        hass.bus.async_fire(
            EVENT_CONTRACT_REMINDER,
            {
                **reminder,
                "owner_name": users.get(reminder["owner"], ""),
                "household": household["name"] if household else None,
            },
        )
    return len(reminders)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_register_websocket_commands(hass)

    async def _send_reminders(call: ServiceCall) -> None:
        await async_fire_contract_reminders(hass, all_upcoming=call.data["all"])

    hass.services.async_register(
        DOMAIN,
        SERVICE_CONTRACT_REMINDERS,
        _send_reminders,
        schema=vol.Schema({vol.Optional("all", default=False): bool}),
    )

    async def _add_expense(call: ServiceCall) -> ServiceResponse:
        data: HaushaltsbuchData | None = hass.data.get(DOMAIN)
        if data is None:
            raise ServiceValidationError("Haushaltsbuch is not loaded")
        user_id = call.context.user_id
        today = dt_util.now().date()
        spent_on = call.data.get("date") or today
        try:
            item = data.book.find_budget(user_id, call.data.get("budget") or "")
            data.book.add_spending(
                user_id or item["owner"],
                item["id"],
                spent_on.isoformat(),
                call.data["amount"],
                call.data.get("note"),
            )
        except ValidationError as err:
            raise ServiceValidationError(
                f"Budget not found or not unique: {call.data.get('budget') or '-'}"
                if str(err) == "budget"
                else f"Invalid value: {err}"
            ) from err
        await data.async_changed()
        owner = user_id or item["owner"]
        salary = (data.book.user(owner).get("settings") or {}).get("salary_item_id")
        finder = period_finder(
            data.book.visible_items(owner), salary, today - timedelta(days=62), today + timedelta(days=62)
        )
        status = budget_status(item, today, finder)
        return {
            "budget": item["name"],
            "amount": round(float(call.data["amount"]), 2),
            "spent": status["spent"],
            "rest": status["rest"],
            "days_left": status["days_left"],
        }

    hass.services.async_register(
        DOMAIN,
        SERVICE_ADD_EXPENSE,
        _add_expense,
        schema=vol.Schema(
            {
                vol.Optional("budget"): cv.string,
                vol.Required("amount"): vol.All(vol.Coerce(float), vol.Range(min=0.01)),
                vol.Optional("date"): cv.date,
                vol.Optional("note"): cv.string,
            }
        ),
        supports_response=SupportsResponse.OPTIONAL,
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = HaushaltsbuchData(hass, entry)
    await data.async_load()
    hass.data[DOMAIN] = data
    entry.runtime_data = data

    # Static paths cannot be removed again, so register them once per HA run.
    if not hass.data.get(STATIC_REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    PANEL_STATIC_URL, str(Path(__file__).parent / "frontend"), False
                )
            ]
        )
        hass.data[STATIC_REGISTERED] = True

    if PANEL_URL_PATH not in hass.data.get(frontend.DATA_PANELS, {}):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_WEBCOMPONENT,
            # One title for all users: HA can't localise a custom panel's
            # sidebar title per user, so the product name stays as it is.
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{PANEL_STATIC_URL}/haushaltsbuch-panel.js?v={VERSION}",
            require_admin=False,
            config={},
        )

    async def _daily(now) -> None:
        await async_fire_contract_reminders(hass, dt_util.as_local(now).date())

    entry.async_on_unload(
        async_track_time_change(hass, _daily, hour=REMINDER_HOUR, minute=0, second=0)
    )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data.pop(DOMAIN, None)
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return unloaded
