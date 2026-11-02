"""Pure calculation logic: due dates, certainty and balance forecast.

This module has no Home Assistant imports so it can be tested on its own.
"""
from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Iterable

SURE = "sicher"
LIKELY = "wahrscheinlich"
UNSURE = "unsicher"
CERTAINTIES = (SURE, LIKELY, UNSURE)

FREQ_ONCE = "once"
FREQ_WEEKLY = "weekly"
FREQ_MONTHLY = "monthly"
FREQ_YEARLY = "yearly"
FREQ_FIXED_DATES = "fixed_dates"
FREQUENCIES = (FREQ_ONCE, FREQ_WEEKLY, FREQ_MONTHLY, FREQ_YEARLY, FREQ_FIXED_DATES)

SHIFT_NEXT = "next"
SHIFT_PREVIOUS = "previous"
SHIFT_NONE = "none"

EXPENSE = "expense"
INCOME = "income"

STATUS_BOOKED = "booked"
STATUS_SKIPPED = "skipped"


# --------------------------------------------------------------------------
# Bank business days (TARGET2 / SEPA calendar)
# --------------------------------------------------------------------------

def easter_sunday(year: int) -> date:
    """Gregorian Easter Sunday (Anonymous Gregorian algorithm)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


_HOLIDAY_CACHE: dict[int, frozenset[date]] = {}


def bank_holidays(year: int) -> frozenset[date]:
    """Days on which SEPA payments are not settled."""
    if year not in _HOLIDAY_CACHE:
        easter = easter_sunday(year)
        _HOLIDAY_CACHE[year] = frozenset(
            {
                date(year, 1, 1),
                easter - timedelta(days=2),  # Karfreitag
                easter + timedelta(days=1),  # Ostermontag
                date(year, 5, 1),
                date(year, 12, 25),
                date(year, 12, 26),
            }
        )
    return _HOLIDAY_CACHE[year]


def is_business_day(day: date) -> bool:
    return day.weekday() < 5 and day not in bank_holidays(day.year)


def shift_to_business_day(day: date, mode: str) -> date:
    if mode == SHIFT_NONE:
        return day
    step = timedelta(days=-1 if mode == SHIFT_PREVIOUS else 1)
    while not is_business_day(day):
        day += step
    return day


# --------------------------------------------------------------------------
# Schedules
# --------------------------------------------------------------------------

def parse_date(value: str | date | None) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(value)


def _add_months(start: date, months: int, day: int) -> date:
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, min(day, monthrange(year, month)[1]))


def _fixed_date(year: int, month_day: str) -> date:
    month, day = (int(part) for part in month_day.split("-"))
    return date(year, month, min(day, monthrange(year, month)[1]))


def nominal_dates(item: dict[str, Any], until: date) -> Iterable[date]:
    """Yield the unshifted due dates of an item up to and including `until`."""
    schedule = item.get("schedule") or {}
    freq = schedule.get("frequency", FREQ_MONTHLY)
    start = parse_date(item.get("start_date"))
    end = parse_date(item.get("end_date"))
    interval = max(1, int(schedule.get("interval") or 1))
    if start is None:
        return
    limit = min(until, end) if end else until

    if freq == FREQ_ONCE:
        if start <= limit:
            yield start
        return

    if freq == FREQ_WEEKLY:
        current = start
        while current <= limit:
            yield current
            current += timedelta(weeks=interval)
        return

    if freq in (FREQ_MONTHLY, FREQ_YEARLY):
        step = interval if freq == FREQ_MONTHLY else interval * 12
        k = 0
        while True:
            current = _add_months(start, k * step, start.day)
            if current > limit:
                return
            yield current
            k += 1

    if freq == FREQ_FIXED_DATES:
        dates = sorted(schedule.get("dates") or [])
        if not dates:
            return
        year = start.year
        while year <= limit.year:
            for month_day in dates:
                current = _fixed_date(year, month_day)
                if start <= current <= limit:
                    yield current
            year += 1


def default_shift(item: dict[str, Any]) -> str:
    if item.get("weekend_shift") in (SHIFT_NEXT, SHIFT_PREVIOUS, SHIFT_NONE):
        return item["weekend_shift"]
    return SHIFT_PREVIOUS if item.get("direction") == INCOME else SHIFT_NEXT


# --------------------------------------------------------------------------
# Certainty
# --------------------------------------------------------------------------

def certainty_for(item: dict[str, Any], due: date) -> str:
    """Classify how certain a single future booking is."""
    override = item.get("certainty")
    if override in CERTAINTIES:
        return override

    variance = float(item.get("amount_variance_pct") or 0)
    tolerance = int(item.get("date_tolerance_days") or 0)
    end = parse_date(item.get("end_date"))
    confirmations = sorted(
        item.get("confirmations") or [], key=lambda c: c["due_date"]
    )
    recent = [c for c in confirmations if c["due_date"] < due.isoformat()][-3:]

    if any(c["status"] == STATUS_SKIPPED for c in recent[-2:]):
        return UNSURE
    if variance > 20 or tolerance > 7:
        return UNSURE
    if end and due > end - timedelta(days=30):
        return UNSURE
    if variance > 0 or tolerance > 3:
        return LIKELY
    if (item.get("schedule") or {}).get("frequency") == FREQ_ONCE:
        return LIKELY
    booked = [c for c in recent if c["status"] == STATUS_BOOKED]
    if not booked:
        return LIKELY
    amount = float(item.get("amount") or 0)
    for conf in booked:
        actual_date = parse_date(conf.get("actual_date")) or parse_date(conf["due_date"])
        actual_amount = conf.get("actual_amount")
        if abs((actual_date - parse_date(conf["due_date"])).days) > max(tolerance, 3):
            return LIKELY
        if actual_amount is not None and abs(float(actual_amount) - amount) > 0.01:
            return LIKELY
    return SURE


# --------------------------------------------------------------------------
# Occurrences and forecast
# --------------------------------------------------------------------------

@dataclass
class Occurrence:
    item_id: str
    name: str
    category: str
    icon: str
    direction: str
    owner: str
    due_date: date  # nominal date, used as the key for confirmations
    date: date  # shifted to a bank business day, or actual date when booked
    amount: float  # signed: income positive, expense negative
    certainty: str
    status: str | None = None  # booked / skipped / None (open)
    household_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "item_id": self.item_id,
            "name": self.name,
            "category": self.category,
            "icon": self.icon,
            "direction": self.direction,
            "owner": self.owner,
            "due_date": self.due_date.isoformat(),
            "date": self.date.isoformat(),
            "amount": round(self.amount, 2),
            "certainty": self.certainty,
            "status": self.status,
            "household_id": self.household_id,
        }


def occurrences(
    items: Iterable[dict[str, Any]], start: date, end: date
) -> list[Occurrence]:
    """All bookings of the given items whose date lies in [start, end]."""
    result: list[Occurrence] = []
    for item in items:
        confirmations = {c["due_date"]: c for c in item.get("confirmations") or []}
        shift = default_shift(item)
        sign = 1 if item.get("direction") == INCOME else -1
        # Shifting can move a date a few days, so look slightly beyond the range.
        for nominal in nominal_dates(item, end + timedelta(days=7)):
            conf = confirmations.get(nominal.isoformat())
            if conf and conf["status"] == STATUS_BOOKED:
                when = parse_date(conf.get("actual_date")) or shift_to_business_day(nominal, shift)
                amount = conf.get("actual_amount")
                amount = float(item.get("amount") or 0) if amount is None else float(amount)
                certainty = SURE
                status = STATUS_BOOKED
            else:
                when = shift_to_business_day(nominal, shift)
                amount = float(item.get("amount") or 0)
                certainty = certainty_for(item, nominal)
                status = conf["status"] if conf else None
            if not start <= when <= end:
                continue
            result.append(
                Occurrence(
                    item_id=item["id"],
                    name=item.get("name", ""),
                    category=item.get("category", ""),
                    icon=item.get("icon") or "",
                    direction=item.get("direction", EXPENSE),
                    owner=item.get("owner", ""),
                    due_date=nominal,
                    date=when,
                    amount=sign * abs(amount),
                    certainty=certainty,
                    status=status,
                    household_id=item.get("household_id"),
                )
            )
    result.sort(key=lambda o: (o.date, o.amount, o.name))
    return result


@dataclass
class ForecastDay:
    day: date
    entries: list[Occurrence] = field(default_factory=list)
    balance_sure: float | None = None
    balance_likely: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "date": self.day.isoformat(),
            "entries": [e.as_dict() for e in self.entries],
            "balance_sure": None if self.balance_sure is None else round(self.balance_sure, 2),
            "balance_likely": None if self.balance_likely is None else round(self.balance_likely, 2),
        }


def forecast(
    items: list[dict[str, Any]],
    start: date,
    end: date,
    balance: float | None,
    balance_date: date | None,
) -> list[ForecastDay]:
    """Day-by-day list of bookings with the projected balance after each day.

    The balance is taken as of the end of `balance_date`; bookings dated on or
    before it are assumed to be included already. Skipped bookings never count,
    uncertain ones are shown but left out of both balance lines.
    """
    calc_start = min(start, balance_date + timedelta(days=1)) if balance_date else start
    all_occ = occurrences(items, calc_start, end)
    by_day: dict[date, list[Occurrence]] = {}
    for occ in all_occ:
        by_day.setdefault(occ.date, []).append(occ)

    days: list[ForecastDay] = []
    sure = likely = balance
    day = calc_start
    while day <= end:
        entries = by_day.get(day, [])
        if balance is not None and balance_date is not None and day > balance_date:
            for occ in entries:
                if occ.status == STATUS_SKIPPED:
                    continue
                if occ.certainty == SURE:
                    sure += occ.amount
                    likely += occ.amount
                elif occ.certainty == LIKELY:
                    likely += occ.amount
        if day >= start:
            known = balance is not None and balance_date is not None and day >= balance_date
            days.append(
                ForecastDay(
                    day=day,
                    entries=entries,
                    balance_sure=sure if known else None,
                    balance_likely=likely if known else None,
                )
            )
        day += timedelta(days=1)
    return days


def month_summaries(
    items: list[dict[str, Any]], first_month: date, months: int
) -> list[dict[str, Any]]:
    """Income, expenses and net per month, split by certainty."""
    result = []
    for index in range(months):
        month_start = _add_months(first_month.replace(day=1), index, 1)
        month_end = month_start.replace(day=monthrange(month_start.year, month_start.month)[1])
        summary = {
            "month": month_start.isoformat()[:7],
            "income": 0.0,
            "expense": 0.0,
            "uncertain_income": 0.0,
            "uncertain_expense": 0.0,
        }
        for occ in occurrences(items, month_start, month_end):
            if occ.status == STATUS_SKIPPED:
                continue
            uncertain = occ.certainty == UNSURE
            if occ.amount >= 0:
                summary["uncertain_income" if uncertain else "income"] += occ.amount
            else:
                summary["uncertain_expense" if uncertain else "expense"] += -occ.amount
        summary["net"] = summary["income"] - summary["expense"]
        result.append({k: round(v, 2) if isinstance(v, float) else v for k, v in summary.items()})
    return result
