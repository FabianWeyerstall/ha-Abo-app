"""Imported bank transactions per user, for the statistics view.

Kept apart from the book so that the plan stays small and fast. Rows are
stored compactly as lists: [date, amount, name, main category, category,
account, purpose]. Only the user who imported them can read them.
"""
from __future__ import annotations

from typing import Any

from .store import ValidationError, _check_date

MAX_ROWS_PER_USER = 50_000
FIELDS = ("date", "amount", "name", "main_category", "category", "account", "purpose")


class Ledger:
    def __init__(self, data: dict[str, Any] | None = None) -> None:
        self.data: dict[str, Any] = data or {"users": {}}
        self.data.setdefault("users", {})

    def rows(self, user_id: str) -> list[list[Any]]:
        return (self.data["users"].get(user_id) or {}).get("rows", [])

    def add(self, user_id: str, rows: list[Any]) -> dict[str, int]:
        """Add transactions; ones already there (same values) are skipped."""
        cleaned = [_clean_row(r) for r in rows]
        user = self.data["users"].setdefault(user_id, {"rows": []})
        known = {tuple(r) for r in user["rows"]}
        added = 0
        for row in cleaned:
            key = tuple(row)
            if key in known:
                continue
            known.add(key)
            user["rows"].append(row)
            added += 1
        if len(user["rows"]) > MAX_ROWS_PER_USER:
            raise ValidationError("too_many_rows")
        user["rows"].sort(key=lambda r: r[0])
        return {"added": added, "skipped": len(cleaned) - added, "total": len(user["rows"])}

    def clear(self, user_id: str) -> int:
        removed = len(self.rows(user_id))
        self.data["users"].pop(user_id, None)
        return removed


def _clean_row(raw: Any) -> list[Any]:
    if not isinstance(raw, dict):
        raise ValidationError("row")
    _check_date(raw.get("date"), "date")
    try:
        amount = round(float(raw.get("amount")), 2)
    except (TypeError, ValueError) as err:
        raise ValidationError("amount") from err
    if amount == 0 or abs(amount) >= 10_000_000:
        raise ValidationError("amount")
    text = lambda key, size: str(raw.get(key) or "").strip()[:size]  # noqa: E731
    return [
        raw["date"],
        amount,
        text("name", 80),
        text("main_category", 50),
        text("category", 50),
        text("account", 40),
        text("purpose", 140),
    ]
