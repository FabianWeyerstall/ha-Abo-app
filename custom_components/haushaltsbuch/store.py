"""Persistent data and access rules.

Layout of the stored document::

    {
      "users": {user_id: {"balance": float|None, "balance_date": "YYYY-MM-DD"|None}},
      "items": {item_id: {..., "owner": user_id, "household_id": str|None,
                          "confirmations": [...]}},
      "households": {household_id: {"name": str, "members": [user_id],
                                    "created_by": user_id, "balance": float|None,
                                    "balance_date": str|None, "entities": bool}},
    }

Every read and write goes through a user id. A user sees their own items and the
items shared into a household they belong to. Only the owner can change an item.
Being a Home Assistant admin grants nothing extra.
"""
from __future__ import annotations

from datetime import date
from typing import Any
from uuid import uuid4

from .engine import (
    CERTAINTIES,
    EXPENSE,
    FREQUENCIES,
    INCOME,
    NOTICE_UNITS,
    SHIFT_NEXT,
    SHIFT_NONE,
    SHIFT_PREVIOUS,
    STATUS_BOOKED,
    STATUS_SKIPPED,
    UNIT_MONTHS,
    UNIT_WEEKS,
    parse_date,
)


class AccessError(Exception):
    """The user may not see or change this object."""


class ValidationError(Exception):
    """The submitted data is invalid."""


def empty_data() -> dict[str, Any]:
    return {"users": {}, "items": {}, "households": {}}


# Items booked at most every N months count as "special" in the views.
SPECIAL_MIN_MONTHS = (2, 3, 6, 12, 999)

EXPORT_FORMAT = "haushaltsbuch"
EXPORT_VERSION = 1

ITEM_FIELDS = {
    "name",
    "direction",
    "amount",
    "amount_variance_pct",
    "category",
    "icon",
    "start_date",
    "end_date",
    "schedule",
    "date_tolerance_days",
    "weekend_shift",
    "certainty",
    "note",
    "household_id",
    "price_changes",
    "contract",
}


class Book:
    """In-memory data with access rules. Persisting is done by the caller."""

    def __init__(self, data: dict[str, Any] | None = None) -> None:
        self.data = data or empty_data()
        for key, value in empty_data().items():
            self.data.setdefault(key, value)

    # ---------------------------------------------------------------- users
    def user(self, user_id: str) -> dict[str, Any]:
        return self.data["users"].setdefault(
            user_id, {"balance": None, "balance_date": None}
        )

    def set_user_settings(self, user_id: str, settings: dict[str, Any]) -> None:
        """Personal display settings (currently: what counts as a special item)."""
        try:
            min_months = int(settings.get("special_min_months", 2))
            min_amount = round(abs(float(settings.get("special_min_amount") or 0)), 2)
        except (TypeError, ValueError) as err:
            raise ValidationError("settings") from err
        if min_months not in SPECIAL_MIN_MONTHS:
            raise ValidationError("special_min_months")
        salary = settings.get("salary_item_id") or None
        if salary not in self.data["items"]:
            salary = None  # unknown or deleted item: back to calendar months
        self.user(user_id)["settings"] = {
            "special_min_months": min_months,
            "special_min_amount": min_amount,
            "salary_item_id": salary,
        }

    def set_user_balance(self, user_id: str, balance: float, balance_date: str) -> None:
        _check_date(balance_date, "balance_date")
        user = self.user(user_id)
        user["balance"] = float(balance)
        user["balance_date"] = balance_date

    # ----------------------------------------------------------- households
    def households_for(self, user_id: str) -> list[dict[str, Any]]:
        return [
            {"id": hid, **hh}
            for hid, hh in self.data["households"].items()
            if user_id in hh["members"]
        ]

    def household(self, user_id: str, household_id: str) -> dict[str, Any]:
        household = self.data["households"].get(household_id)
        if household is None or user_id not in household["members"]:
            raise AccessError("household")
        return household

    def create_household(self, user_id: str, name: str, members: list[str]) -> str:
        name = (name or "").strip()
        if not name:
            raise ValidationError("name")
        household_id = uuid4().hex
        self.data["households"][household_id] = {
            "name": name,
            "members": sorted({user_id, *members}),
            "created_by": user_id,
            "balance": None,
            "balance_date": None,
            "entities": False,
        }
        return household_id

    def update_household(
        self,
        user_id: str,
        household_id: str,
        name: str | None = None,
        members: list[str] | None = None,
        entities: bool | None = None,
    ) -> None:
        household = self.household(user_id, household_id)
        if name is not None:
            if not name.strip():
                raise ValidationError("name")
            household["name"] = name.strip()
        if members is not None:
            if household["created_by"] != user_id:
                raise AccessError("members")
            new_members = sorted({household["created_by"], *members})
            removed = set(household["members"]) - set(new_members)
            household["members"] = new_members
            # Items of people who left become private again.
            for item in self.data["items"].values():
                if item.get("household_id") == household_id and item["owner"] in removed:
                    item["household_id"] = None
        if entities is not None:
            household["entities"] = bool(entities)

    def leave_household(self, user_id: str, household_id: str) -> None:
        household = self.household(user_id, household_id)
        if household["created_by"] == user_id:
            raise ValidationError("creator_cannot_leave")
        self.update_household(
            household["created_by"],
            household_id,
            members=[m for m in household["members"] if m != user_id],
        )

    def delete_household(self, user_id: str, household_id: str) -> None:
        household = self.household(user_id, household_id)
        if household["created_by"] != user_id:
            raise AccessError("delete")
        for item in self.data["items"].values():
            if item.get("household_id") == household_id:
                item["household_id"] = None
        del self.data["households"][household_id]

    def set_household_balance(
        self, user_id: str, household_id: str, balance: float, balance_date: str
    ) -> None:
        _check_date(balance_date, "balance_date")
        household = self.household(user_id, household_id)
        household["balance"] = float(balance)
        household["balance_date"] = balance_date

    # ---------------------------------------------------------------- items
    def can_see(self, user_id: str, item: dict[str, Any]) -> bool:
        if item["owner"] == user_id:
            return True
        household = self.data["households"].get(item.get("household_id") or "")
        return bool(household and user_id in household["members"])

    def visible_items(self, user_id: str) -> list[dict[str, Any]]:
        return [i for i in self.data["items"].values() if self.can_see(user_id, i)]

    def own_items(self, user_id: str) -> list[dict[str, Any]]:
        return [i for i in self.data["items"].values() if i["owner"] == user_id]

    def household_items(self, user_id: str, household_id: str) -> list[dict[str, Any]]:
        self.household(user_id, household_id)
        return self.items_of_household(household_id)

    def items_of_household(self, household_id: str) -> list[dict[str, Any]]:
        return [
            i for i in self.data["items"].values() if i.get("household_id") == household_id
        ]

    def save_item(self, user_id: str, values: dict[str, Any]) -> str:
        item_id = values.get("id")
        if item_id:
            item = self.data["items"].get(item_id)
            if item is None or item["owner"] != user_id:
                raise AccessError("item")
        else:
            item_id = uuid4().hex
            item = {"id": item_id, "owner": user_id, "confirmations": []}
        cleaned = _validate_item({k: v for k, v in values.items() if k in ITEM_FIELDS})
        if cleaned.get("household_id"):
            self.household(user_id, cleaned["household_id"])
        item.update(cleaned)
        self.data["items"][item_id] = item
        return item_id

    def delete_item(self, user_id: str, item_id: str) -> None:
        item = self.data["items"].get(item_id)
        if item is None or item["owner"] != user_id:
            raise AccessError("item")
        del self.data["items"][item_id]

    def confirm(
        self,
        user_id: str,
        item_id: str,
        due_date: str,
        status: str | None,
        actual_date: str | None = None,
        actual_amount: float | None = None,
    ) -> None:
        """Mark one booking as booked or skipped, or reset it (status None)."""
        item = self.data["items"].get(item_id)
        if item is None or not self.can_see(user_id, item):
            raise AccessError("item")
        _check_date(due_date, "due_date")
        confirmations = [
            c for c in item.get("confirmations", []) if c["due_date"] != due_date
        ]
        if status is not None:
            if status not in (STATUS_BOOKED, STATUS_SKIPPED):
                raise ValidationError("status")
            if actual_date:
                _check_date(actual_date, "actual_date")
            confirmations.append(
                {
                    "due_date": due_date,
                    "status": status,
                    "actual_date": actual_date or None,
                    "actual_amount": None if actual_amount is None else abs(float(actual_amount)),
                    "by": user_id,
                }
            )
        confirmations.sort(key=lambda c: c["due_date"])
        # Keep the history short; the certainty only looks at the last few.
        item["confirmations"] = confirmations[-24:]

    def plan(
        self,
        user_id: str,
        item_id: str,
        due_date: str,
        planned_date: str | None,
        amount: float | None = None,
    ) -> None:
        """Fix the date (and optionally amount) of one booking, or clear it."""
        item = self.data["items"].get(item_id)
        if item is None or not self.can_see(user_id, item):
            raise AccessError("item")
        _check_date(due_date, "due_date")
        overrides = [o for o in item.get("overrides", []) if o["due_date"] != due_date]
        if planned_date:
            _check_date(planned_date, "date")
            try:
                amount = None if amount is None else abs(float(amount))
            except (TypeError, ValueError) as err:
                raise ValidationError("amount") from err
            overrides.append(
                {"due_date": due_date, "date": planned_date, "amount": amount, "by": user_id}
            )
        overrides.sort(key=lambda o: o["due_date"])
        # Planned appointments far in the past are no longer needed.
        item["overrides"] = overrides[-36:]


    # ------------------------------------------------------------ spendings
    def add_spending(
        self,
        user_id: str,
        item_id: str,
        spent_on: str,
        amount: Any,
        note: str | None = None,
    ) -> str:
        """Record money spent from a budget. Members of its household may too."""
        item = self.data["items"].get(item_id)
        if item is None or not self.can_see(user_id, item):
            raise AccessError("item")
        if (item.get("schedule") or {}).get("frequency") != "budget":
            raise ValidationError("not_a_budget")
        _check_date(spent_on, "date")
        try:
            value = round(abs(float(amount)), 2)
        except (TypeError, ValueError) as err:
            raise ValidationError("amount") from err
        if not 0 < value < 1_000_000:
            raise ValidationError("amount")
        spending_id = uuid4().hex[:12]
        spendings = list(item.get("spendings") or [])
        spendings.append(
            {
                "id": spending_id,
                "date": spent_on,
                "amount": value,
                "note": str(note or "")[:200],
                "by": user_id,
            }
        )
        spendings.sort(key=lambda x: (x["date"], x["id"]))
        # About a year of shopping is plenty for the current and past months.
        item["spendings"] = spendings[-1000:]
        return spending_id

    def delete_spending(self, user_id: str, item_id: str, spending_id: str) -> None:
        item = self.data["items"].get(item_id)
        if item is None or not self.can_see(user_id, item):
            raise AccessError("item")
        before = item.get("spendings") or []
        after = [x for x in before if x.get("id") != spending_id]
        if len(after) == len(before):
            raise ValidationError("spending")
        item["spendings"] = after

    def find_budget(self, user_id: str | None, name: str) -> dict[str, Any]:
        """A budget by id or name (ignoring case), among the user's visible items."""
        pool = self.visible_items(user_id) if user_id else list(self.data["items"].values())
        budgets = [i for i in pool if (i.get("schedule") or {}).get("frequency") == "budget"]
        wanted = str(name or "").strip().lower()
        for item in budgets:
            if item["id"] == name:
                return item
        matches = [i for i in budgets if i.get("name", "").strip().lower() == wanted]
        if not wanted and len(budgets) == 1:
            matches = budgets
        if len(matches) != 1:
            raise ValidationError("budget")
        return matches[0]

    # -------------------------------------------------------- export/import
    def export_items(self, user_id: str) -> dict[str, Any]:
        """The user's own items as a portable document (no ids, no households)."""
        user = self.user(user_id)
        items = []
        for item in sorted(self.own_items(user_id), key=lambda i: i["name"].lower()):
            entry = {k: item.get(k) for k in ITEM_FIELDS if k != "household_id"}
            entry["confirmations"] = [
                {k: c.get(k) for k in ("due_date", "status", "actual_date", "actual_amount")}
                for c in item.get("confirmations", [])
            ]
            entry["overrides"] = [
                {k: o.get(k) for k in ("due_date", "date", "amount")}
                for o in item.get("overrides", [])
            ]
            entry["spendings"] = [
                {k: x.get(k) for k in ("date", "amount", "note")}
                for x in item.get("spendings", [])
            ]
            items.append(entry)
        return {
            "format": EXPORT_FORMAT,
            "version": EXPORT_VERSION,
            "exported_at": date.today().isoformat(),
            "balance": user["balance"],
            "balance_date": user["balance_date"],
            "items": items,
        }

    def import_items(
        self, user_id: str, document: dict[str, Any], replace: bool = False
    ) -> dict[str, int]:
        """Add the items of an export as private items of this user.

        Everything is validated before anything changes. With ``replace`` the
        user's own items are removed first; otherwise items that already exist
        with the same name, direction, amount and start date are skipped.
        """
        if not isinstance(document, dict) or document.get("format") != EXPORT_FORMAT:
            raise ValidationError("file_format")
        raw_items = document.get("items")
        if not isinstance(raw_items, list):
            raise ValidationError("items")
        prepared = []
        for number, raw in enumerate(raw_items, start=1):
            if not isinstance(raw, dict):
                raise ValidationError(f"item {number}")
            try:
                cleaned = _validate_item({**raw, "household_id": None})
                cleaned["confirmations"] = _clean_confirmations(raw.get("confirmations"))
                cleaned["overrides"] = _clean_overrides(raw.get("overrides"))
                cleaned["spendings"] = _clean_spendings(raw.get("spendings"))
            except ValidationError as err:
                raise ValidationError(f"{raw.get('name') or number}: {err}") from err
            prepared.append(cleaned)

        if replace:
            for item in self.own_items(user_id):
                del self.data["items"][item["id"]]
        existing = {_identity(i) for i in self.own_items(user_id)}
        added = skipped = 0
        for cleaned in prepared:
            if _identity(cleaned) in existing:
                skipped += 1
                continue
            item_id = uuid4().hex
            self.data["items"][item_id] = {"id": item_id, "owner": user_id, **cleaned}
            existing.add(_identity(cleaned))
            added += 1

        balance, balance_date = document.get("balance"), document.get("balance_date")
        if replace and balance is not None and balance_date:
            try:
                self.set_user_balance(user_id, float(balance), balance_date)
            except (TypeError, ValueError, ValidationError):
                pass
        return {"added": added, "skipped": skipped}


def _identity(item: dict[str, Any]) -> tuple:
    return (item["name"].lower(), item["direction"], round(float(item["amount"]), 2), item["start_date"])


def _clean_confirmations(values: Any) -> list[dict[str, Any]]:
    result = []
    for c in values or []:
        if not isinstance(c, dict):
            raise ValidationError("confirmations")
        _check_date(c.get("due_date"), "confirmations")
        if c.get("status") not in (STATUS_BOOKED, STATUS_SKIPPED):
            raise ValidationError("confirmations")
        if c.get("actual_date"):
            _check_date(c["actual_date"], "confirmations")
        try:
            amount = None if c.get("actual_amount") is None else abs(float(c["actual_amount"]))
        except (TypeError, ValueError) as err:
            raise ValidationError("confirmations") from err
        result.append(
            {"due_date": c["due_date"], "status": c["status"],
             "actual_date": c.get("actual_date") or None, "actual_amount": amount}
        )
    return sorted(result, key=lambda c: c["due_date"])[-24:]


def _clean_overrides(values: Any) -> list[dict[str, Any]]:
    result = []
    for o in values or []:
        if not isinstance(o, dict):
            raise ValidationError("overrides")
        _check_date(o.get("due_date"), "overrides")
        _check_date(o.get("date"), "overrides")
        try:
            amount = None if o.get("amount") is None else abs(float(o["amount"]))
        except (TypeError, ValueError) as err:
            raise ValidationError("overrides") from err
        result.append({"due_date": o["due_date"], "date": o["date"], "amount": amount})
    return sorted(result, key=lambda o: o["due_date"])[-36:]


def _clean_spendings(values: Any) -> list[dict[str, Any]]:
    result = []
    for x in values or []:
        if not isinstance(x, dict):
            raise ValidationError("spendings")
        _check_date(x.get("date"), "spendings")
        try:
            amount = round(abs(float(x.get("amount"))), 2)
        except (TypeError, ValueError) as err:
            raise ValidationError("spendings") from err
        result.append(
            {"id": uuid4().hex[:12], "date": x["date"], "amount": amount, "note": str(x.get("note") or "")[:200]}
        )
    return sorted(result, key=lambda x: x["date"])[-1000:]


def _check_date(value: Any, field: str) -> None:
    try:
        if parse_date(value) is None:
            raise ValueError
    except (TypeError, ValueError) as err:
        raise ValidationError(field) from err


def _validate_item(values: dict[str, Any]) -> dict[str, Any]:
    name = str(values.get("name") or "").strip()
    if not name:
        raise ValidationError("name")
    direction = values.get("direction", EXPENSE)
    if direction not in (EXPENSE, INCOME):
        raise ValidationError("direction")
    try:
        amount = abs(float(values.get("amount")))
        variance = float(values.get("amount_variance_pct") or 0)
        tolerance = int(values.get("date_tolerance_days") or 0)
    except (TypeError, ValueError) as err:
        raise ValidationError("amount") from err
    if not 0 <= variance <= 100 or not 0 <= tolerance <= 60:
        raise ValidationError("tolerance")
    _check_date(values.get("start_date"), "start_date")
    end_date = values.get("end_date") or None
    if end_date:
        _check_date(end_date, "end_date")
        if parse_date(end_date) < parse_date(values["start_date"]):
            raise ValidationError("end_date")

    schedule = values.get("schedule") or {}
    frequency = schedule.get("frequency", "monthly")
    if frequency not in FREQUENCIES:
        raise ValidationError("frequency")
    try:
        interval = int(schedule.get("interval") or 1)
    except (TypeError, ValueError) as err:
        raise ValidationError("interval") from err
    if not 1 <= interval <= 120:
        raise ValidationError("interval")
    unit = schedule.get("unit") or UNIT_MONTHS
    if unit not in (UNIT_MONTHS, UNIT_WEEKS):
        raise ValidationError("unit")
    weekday = schedule.get("weekday")
    week = schedule.get("week")
    if frequency == "monthly" and weekday is not None:
        try:
            weekday, week = int(weekday), int(week if week is not None else -1)
        except (TypeError, ValueError) as err:
            raise ValidationError("weekday") from err
        if not 0 <= weekday <= 6 or week not in (1, 2, 3, 4, -1):
            raise ValidationError("weekday")
    else:
        weekday = week = None
    dates: list[str] = []
    if frequency == "fixed_dates":
        for month_day in schedule.get("dates") or []:
            try:
                month, day = (int(p) for p in str(month_day).split("-"))
                date(2024, month, day)  # leap year accepts 02-29
            except (TypeError, ValueError) as err:
                raise ValidationError("dates") from err
            dates.append(f"{month:02d}-{day:02d}")
        if not dates:
            raise ValidationError("dates")

    price_changes = []
    for change in values.get("price_changes") or []:
        if not isinstance(change, dict):
            raise ValidationError("price_changes")
        _check_date(change.get("from"), "price_changes")
        try:
            new_amount = round(abs(float(change.get("amount"))), 2)
        except (TypeError, ValueError) as err:
            raise ValidationError("price_changes") from err
        price_changes.append({"from": change["from"], "amount": new_amount})
    price_changes = sorted({c["from"]: c for c in price_changes}.values(), key=lambda c: c["from"])[-50:]

    contract = None
    raw_contract = values.get("contract") or {}
    if raw_contract.get("end"):
        _check_date(raw_contract["end"], "contract_end")
        try:
            notice = int(raw_contract.get("notice") or 0)
            renew = int(raw_contract.get("renew", raw_contract.get("renew_months")) or 0)
        except (TypeError, ValueError) as err:
            raise ValidationError("contract") from err
        notice_unit = raw_contract.get("notice_unit") or "months"
        renew_unit = raw_contract.get("renew_unit") or "months"
        if (
            not 0 <= notice <= 365
            or not 0 <= renew <= 365
            or notice_unit not in NOTICE_UNITS
            or renew_unit not in NOTICE_UNITS
        ):
            raise ValidationError("contract")
        contract = {
            "end": raw_contract["end"],
            "notice": notice,
            "notice_unit": notice_unit,
            "renew": renew,
            "renew_unit": renew_unit,
        }

    shift = values.get("weekend_shift") or None
    if shift not in (None, SHIFT_NEXT, SHIFT_PREVIOUS, SHIFT_NONE):
        raise ValidationError("weekend_shift")
    certainty = values.get("certainty") or None
    if certainty not in (None, *CERTAINTIES):
        raise ValidationError("certainty")

    return {
        "name": name[:100],
        "direction": direction,
        "amount": round(amount, 2),
        "amount_variance_pct": variance,
        "category": str(values.get("category") or "Sonstiges")[:50],
        "icon": str(values.get("icon") or "")[:80],
        "start_date": values["start_date"],
        "end_date": end_date,
        "schedule": {
            "frequency": frequency,
            "interval": interval,
            "dates": sorted(set(dates)),
            **({"weekday": weekday, "week": week} if weekday is not None else {}),
            **(
                {"unit": unit, "learn": schedule.get("learn") is not False}
                if frequency == "rolling"
                else {}
            ),
        },
        "date_tolerance_days": tolerance,
        "weekend_shift": shift,
        "certainty": certainty,
        "note": str(values.get("note") or "")[:1000],
        "household_id": values.get("household_id") or None,
        "price_changes": price_changes,
        "contract": contract,
    }
