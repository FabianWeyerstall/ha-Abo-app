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
# Next booking follows the last actual or planned one (e.g. a haircut).
FREQ_ROLLING = "rolling"
# A monthly amount for variable spending (groceries, fuel) without single
# bookings. It lowers the projected balance evenly over each day of the month.
FREQ_BUDGET = "budget"
FREQUENCIES = (
    FREQ_ONCE, FREQ_WEEKLY, FREQ_MONTHLY, FREQ_YEARLY, FREQ_FIXED_DATES, FREQ_ROLLING, FREQ_BUDGET
)

NOTICE_UNITS = ("days", "weeks", "months")

UNIT_MONTHS = "months"
UNIT_WEEKS = "weeks"

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


def amount_on(item: dict[str, Any], day: date) -> float:
    """Amount valid on `day`: the base amount or the last price change before it."""
    amount = float(item.get("amount") or 0)
    for change in sorted(item.get("price_changes") or [], key=lambda c: c["from"]):
        if parse_date(change["from"]) <= day:
            amount = float(change["amount"])
    return amount


def _shift_by(day: date, value: int, unit: str, original_day: int | None = None) -> date:
    """Move `day` by `value` days, weeks or months (negative goes back)."""
    if unit == "months":
        return _add_months(day, value, original_day or day.day)
    if unit == "weeks":
        return day + timedelta(weeks=value)
    return day + timedelta(days=value)


def _sub_notice(day: date, value: int, unit: str) -> date:
    return _shift_by(day, -value, unit)


def contract_info(item: dict[str, Any], today: date) -> dict[str, Any] | None:
    """Next contract end and the last day to cancel for it.

    A contract renews by `renew` (in `renew_unit`, months by default; the
    older key `renew_months` is still read) after each end; without renewal
    it simply ends. Returns None when the item has no contract end date.
    """
    contract = item.get("contract") or {}
    end = parse_date(contract.get("end"))
    if end is None:
        return None
    notice = int(contract.get("notice") or 0)
    unit = contract.get("notice_unit") or "months"
    renew = int(contract.get("renew", contract.get("renew_months")) or 0)
    renew_unit = contract.get("renew_unit") or "months"
    first_end = end
    cancel_by = _sub_notice(end, notice, unit)
    if renew > 0:
        k = 0
        while cancel_by < today:
            k += 1
            end = _shift_by(first_end, k * renew, renew_unit, first_end.day)
            cancel_by = _sub_notice(end, notice, unit)
    return {
        "end": end.isoformat(),
        "cancel_by": cancel_by.isoformat(),
        "days_left": (cancel_by - today).days,
        "renews": renew > 0,
        "ended": end < today,
    }


def learned_interval_days(item: dict[str, Any]) -> int | None:
    """Average gap in days between the last booked visits of a rolling item.

    Needs at least three booked visits (two gaps). Returns None otherwise or
    when learning is switched off for the item.
    """
    schedule = item.get("schedule") or {}
    if schedule.get("frequency") != FREQ_ROLLING or schedule.get("learn") is False:
        return None
    visits = sorted(
        parse_date(c.get("actual_date")) or parse_date(c["due_date"])
        for c in item.get("confirmations") or []
        if c["status"] == STATUS_BOOKED
    )[-7:]
    if len(visits) < 3:
        return None
    gaps = [(b - a).days for a, b in zip(visits, visits[1:]) if (b - a).days > 0]
    if len(gaps) < 2:
        return None
    return max(1, round(sum(gaps) / len(gaps)))


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


def _rolling_step(day: date, interval: int, unit: str) -> date:
    if unit == UNIT_WEEKS:
        return day + timedelta(weeks=interval)
    return _add_months(day, interval, day.day)


def rolling_keys(item: dict[str, Any], until: date) -> list[date]:
    """Keys (nominal dates) of a rolling schedule up to `until`.

    Every booked confirmation and every planned appointment is an anchor at its
    real date. After the last anchor the schedule continues every interval;
    between anchors that lie far apart the gap is filled the same way.
    """
    schedule = item.get("schedule") or {}
    interval = max(1, int(schedule.get("interval") or 1))
    unit = schedule.get("unit") or UNIT_MONTHS
    start = parse_date(item.get("start_date"))
    end = parse_date(item.get("end_date"))
    if start is None:
        return []
    limit = min(until, end) if end else until
    learned = learned_interval_days(item)

    def step(day: date) -> date:
        if learned:
            return day + timedelta(days=learned)
        return _rolling_step(day, interval, unit)

    anchors: dict[date, date] = {start: start}
    for override in item.get("overrides") or []:
        anchors[parse_date(override["due_date"])] = parse_date(override["date"])
    for conf in item.get("confirmations") or []:
        key = parse_date(conf["due_date"])
        if conf["status"] == STATUS_BOOKED and conf.get("actual_date"):
            anchors[key] = parse_date(conf["actual_date"])
        else:
            anchors.setdefault(key, key)

    ordered = sorted(anchors.items(), key=lambda kv: (kv[1], kv[0]))
    half = timedelta(
        days=learned / 2 if learned else (4 if unit == UNIT_WEEKS else 15) * interval
    )
    keys: list[date] = []
    for index, (key, real) in enumerate(ordered):
        if key <= limit or real <= limit:
            keys.append(key)
        nxt = ordered[index + 1][1] if index + 1 < len(ordered) else None
        current = step(real)
        while current <= limit and (nxt is None or current <= nxt - half):
            keys.append(current)
            current = step(current)
    return keys


def default_shift(item: dict[str, Any]) -> str:
    """Bookings due on a weekend or bank holiday move to the next business day.

    Salary is the usual exception (paid earlier); the salary template sets
    "previous" explicitly instead of guessing it from the direction.
    """
    if item.get("weekend_shift") in (SHIFT_NEXT, SHIFT_PREVIOUS, SHIFT_NONE):
        return item["weekend_shift"]
    return SHIFT_NEXT


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
    if (item.get("schedule") or {}).get("frequency") in (FREQ_ONCE, FREQ_ROLLING, FREQ_BUDGET):
        return LIKELY
    booked = [c for c in recent if c["status"] == STATUS_BOOKED]
    if not booked:
        return LIKELY
    for conf in booked:
        amount = amount_on(item, parse_date(conf["due_date"]))
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
    planned: bool = False  # date fixed by hand ("Termin festlegen")

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
            "planned": self.planned,
        }


def occurrences(
    items: Iterable[dict[str, Any]], start: date, end: date
) -> list[Occurrence]:
    """All bookings of the given items whose date lies in [start, end]."""
    result: list[Occurrence] = []
    for item in items:
        confirmations = {c["due_date"]: c for c in item.get("confirmations") or []}
        overrides = {o["due_date"]: o for o in item.get("overrides") or []}
        rolling = (item.get("schedule") or {}).get("frequency") == FREQ_ROLLING
        # Rolling items are appointments paid on the day, so they are not shifted.
        shift = SHIFT_NONE if rolling else default_shift(item)
        sign = 1 if item.get("direction") == INCOME else -1
        horizon = end + timedelta(days=7)  # shifting can move a date a few days
        keys = rolling_keys(item, horizon) if rolling else nominal_dates(item, horizon)
        for nominal in keys:
            conf = confirmations.get(nominal.isoformat())
            override = overrides.get(nominal.isoformat())
            planned = False
            if conf and conf["status"] == STATUS_BOOKED:
                when = (
                    parse_date(conf.get("actual_date"))
                    or (parse_date(override["date"]) if override else None)
                    or shift_to_business_day(nominal, shift)
                )
                amount = conf.get("actual_amount")
                amount = amount_on(item, nominal) if amount is None else float(amount)
                certainty = SURE
                status = STATUS_BOOKED
            elif override:
                when = parse_date(override["date"])
                amount = override.get("amount")
                amount = amount_on(item, nominal) if amount is None else float(amount)
                certainty = SURE
                status = conf["status"] if conf else None
                planned = True
            else:
                when = shift_to_business_day(nominal, shift)
                amount = amount_on(item, nominal)
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
                    planned=planned,
                )
            )
    result.sort(key=lambda o: (o.date, o.amount, o.name))
    return result


def _is_budget(item: dict[str, Any]) -> bool:
    return (item.get("schedule") or {}).get("frequency") == FREQ_BUDGET


def _budget_active(item: dict[str, Any], day: date) -> bool:
    start = parse_date(item.get("start_date"))
    end = parse_date(item.get("end_date"))
    return start is not None and start <= day and (end is None or day <= end)


def budget_per_day(items: Iterable[dict[str, Any]], day: date) -> float:
    """Signed sum of all budgets for one day (a month's budget spread evenly)."""
    days_in_month = monthrange(day.year, day.month)[1]
    total = 0.0
    for item in items:
        if _is_budget(item) and _budget_active(item, day):
            sign = 1 if item.get("direction") == INCOME else -1
            total += sign * abs(amount_on(item, day)) / days_in_month
    return total


@dataclass
class ForecastDay:
    day: date
    entries: list[Occurrence] = field(default_factory=list)
    balance_sure: float | None = None
    balance_likely: float | None = None
    budget: float = 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "date": self.day.isoformat(),
            "budget": round(self.budget, 2),
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
    uncertain ones are shown but left out of both balance lines. Budgets are
    spread over the days of each month and count as likely.
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
        budget = budget_per_day(items, day)
        if balance is not None and balance_date is not None and day > balance_date:
            likely += budget
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
                    budget=budget,
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
        entries = []
        for occ in occurrences(items, month_start, month_end):
            if occ.status == STATUS_SKIPPED:
                continue
            entries.append(occ.as_dict())
            uncertain = occ.certainty == UNSURE
            if occ.amount >= 0:
                summary["uncertain_income" if uncertain else "income"] += occ.amount
            else:
                summary["uncertain_expense" if uncertain else "expense"] += -occ.amount
        for item in items:
            if not _is_budget(item):
                continue
            active = [
                month_start + timedelta(days=i)
                for i in range((month_end - month_start).days + 1)
                if _budget_active(item, month_start + timedelta(days=i))
            ]
            if not active:
                continue
            # Pro rata for months in which the budget starts or ends.
            amount = abs(amount_on(item, active[0])) * len(active) / ((month_end - month_start).days + 1)
            income = item.get("direction") == INCOME
            summary["income" if income else "expense"] += amount
            entries.append(
                {
                    **Occurrence(
                        item_id=item["id"],
                        name=item.get("name", ""),
                        category=item.get("category", ""),
                        icon=item.get("icon") or "",
                        direction=item.get("direction", EXPENSE),
                        owner=item.get("owner", ""),
                        due_date=active[0],
                        date=active[0],
                        amount=amount if income else -amount,
                        certainty=LIKELY,
                        household_id=item.get("household_id"),
                    ).as_dict(),
                    "budget": True,
                }
            )
        entries.sort(key=lambda e: e["date"])
        summary["net"] = summary["income"] - summary["expense"]
        summary = {k: round(v, 2) if isinstance(v, float) else v for k, v in summary.items()}
        summary["entries"] = entries
        result.append(summary)
    return result


REMINDER_DAYS = (30, 7, 1)


def contract_reminders(
    items: Iterable[dict[str, Any]], today: date, all_upcoming: bool = False
) -> list[dict[str, Any]]:
    """Contracts whose last day to cancel is 30, 7 or 1 day(s) away.

    With `all_upcoming` every contract that can still be cancelled within the
    next 60 days is returned (used to test a notification right away).
    """
    result = []
    for item in items:
        info = contract_info(item, today)
        if not info or info["ended"]:
            continue
        days_left = info["days_left"]
        if (all_upcoming and 0 <= days_left <= 60) or days_left in REMINDER_DAYS:
            result.append(
                {
                    "item_id": item["id"],
                    "name": item.get("name", ""),
                    "owner": item.get("owner"),
                    "household_id": item.get("household_id"),
                    "amount": round(amount_on(item, today), 2),
                    "cancel_by": info["cancel_by"],
                    "contract_end": info["end"],
                    "days_left": days_left,
                    "renews": info["renews"],
                }
            )
    return sorted(result, key=lambda r: r["cancel_by"])
