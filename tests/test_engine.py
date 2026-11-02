"""Tests for the pure calculation logic (no Home Assistant needed)."""
from datetime import date

import pytest

from custom_components.haushaltsbuch.engine import (
    LIKELY,
    SURE,
    UNSURE,
    certainty_for,
    easter_sunday,
    forecast,
    month_summaries,
    nominal_dates,
    occurrences,
    shift_to_business_day,
)


def item(**kw):
    base = {
        "id": "x",
        "name": "Test",
        "direction": "expense",
        "amount": 10.0,
        "category": "Abos",
        "start_date": "2026-01-15",
        "schedule": {"frequency": "monthly", "interval": 1},
        "confirmations": [],
    }
    base.update(kw)
    return base


def test_easter():
    assert easter_sunday(2026) == date(2026, 4, 5)
    assert easter_sunday(2027) == date(2027, 3, 28)


def test_shift_weekend_and_holiday():
    # 2026-04-03 is Good Friday, 04-06 Easter Monday
    assert shift_to_business_day(date(2026, 4, 3), "next") == date(2026, 4, 7)
    assert shift_to_business_day(date(2026, 4, 3), "previous") == date(2026, 4, 2)
    assert shift_to_business_day(date(2026, 11, 7), "none") == date(2026, 11, 7)


def test_monthly_clamps_to_month_end():
    it = item(start_date="2026-01-31")
    dates = list(nominal_dates(it, date(2026, 4, 30)))
    assert dates == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_quarterly_and_end_date():
    it = item(schedule={"frequency": "monthly", "interval": 3}, end_date="2026-08-01")
    assert list(nominal_dates(it, date(2027, 1, 1))) == [
        date(2026, 1, 15),
        date(2026, 4, 15),
        date(2026, 7, 15),
    ]


def test_fixed_dates_twice_a_year():
    it = item(
        start_date="2026-01-01",
        schedule={"frequency": "fixed_dates", "dates": ["04-01", "10-15"]},
    )
    assert list(nominal_dates(it, date(2027, 5, 1))) == [
        date(2026, 4, 1),
        date(2026, 10, 15),
        date(2027, 4, 1),
    ]


def test_weekly_and_once():
    weekly = item(start_date="2026-01-01", schedule={"frequency": "weekly", "interval": 2})
    assert len(list(nominal_dates(weekly, date(2026, 1, 31)))) == 3
    once = item(start_date="2026-03-01", schedule={"frequency": "once"})
    assert list(nominal_dates(once, date(2030, 1, 1))) == [date(2026, 3, 1)]


def test_weekend_shift_defaults_to_next_business_day():
    # Feed-in payment due 2027-01-02 (Saturday, after the Jan 1 holiday)
    feed_in = item(direction="income", amount=31, start_date="2026-11-02")
    occ = occurrences([feed_in], date(2026, 12, 1), date(2027, 1, 31))
    assert [o.date for o in occ] == [date(2026, 12, 2), date(2027, 1, 4)]
    dec, jan = month_summaries([feed_in], date(2026, 12, 1), 2)
    assert dec["income"] == 31 and jan["income"] == 31
    assert [e["date"] for e in jan["entries"]] == ["2027-01-04"]


def test_salary_can_be_paid_on_previous_business_day():
    salary = item(direction="income", amount=3000, start_date="2026-01-31", weekend_shift="previous")
    occ = occurrences([salary], date(2026, 1, 1), date(2026, 1, 31))
    # 2026-01-31 is a Saturday -> paid Friday 30th, positive amount
    assert [(o.date, o.amount) for o in occ] == [(date(2026, 1, 30), 3000.0)]


def test_certainty_rules():
    due = date(2026, 6, 15)
    assert certainty_for(item(), due) == LIKELY  # never confirmed
    confirmed = item(
        confirmations=[
            {"due_date": "2026-04-15", "status": "booked", "actual_date": "2026-04-15", "actual_amount": 10},
            {"due_date": "2026-05-15", "status": "booked", "actual_date": None, "actual_amount": None},
        ]
    )
    assert certainty_for(confirmed, due) == SURE
    assert certainty_for(item(amount_variance_pct=5), due) == LIKELY
    assert certainty_for(item(amount_variance_pct=50), due) == UNSURE
    assert certainty_for(item(end_date="2026-06-30"), due) == UNSURE
    assert certainty_for(item(certainty=SURE, amount_variance_pct=50), due) == SURE
    skipped = item(confirmations=[{"due_date": "2026-05-15", "status": "skipped"}])
    assert certainty_for(skipped, due) == UNSURE
    late = item(
        confirmations=[{"due_date": "2026-05-15", "status": "booked", "actual_date": "2026-05-25", "actual_amount": None}]
    )
    assert certainty_for(late, due) == LIKELY


def test_forecast_balance_lines():
    items = [
        item(id="rent", amount=1000, start_date="2026-11-03",
             confirmations=[{"due_date": "2026-10-03", "status": "booked", "actual_date": None, "actual_amount": None}]),
        item(id="power", amount=100, start_date="2026-11-04"),  # likely
        item(id="bonus", direction="income", amount=500, start_date="2026-11-05",
             schedule={"frequency": "once"}, certainty=UNSURE),
    ]
    days = forecast(items, date(2026, 11, 2), date(2026, 11, 6), 2000.0, date(2026, 11, 2))
    by_date = {d.day.isoformat(): d for d in days}
    assert by_date["2026-11-02"].balance_sure == 2000
    assert by_date["2026-11-03"].balance_sure == 1000
    assert by_date["2026-11-04"].balance_sure == 1000
    assert by_date["2026-11-04"].balance_likely == 900
    # uncertain bonus is listed but not counted
    assert [e.item_id for e in by_date["2026-11-05"].entries] == ["bonus"]
    assert by_date["2026-11-06"].balance_likely == 900


def test_forecast_uses_actual_and_ignores_skipped():
    it = item(
        start_date="2026-11-03",
        confirmations=[{"due_date": "2026-11-03", "status": "booked", "actual_date": "2026-11-04", "actual_amount": 12.5}],
    )
    days = forecast([it], date(2026, 11, 1), date(2026, 11, 5), 100.0, date(2026, 11, 1))
    assert days[-1].balance_sure == pytest.approx(87.5)
    skipped = item(start_date="2026-11-03", confirmations=[{"due_date": "2026-11-03", "status": "skipped"}])
    days = forecast([skipped], date(2026, 11, 1), date(2026, 11, 5), 100.0, date(2026, 11, 1))
    assert days[-1].balance_likely == 100


def test_forecast_without_balance():
    days = forecast([item()], date(2026, 1, 1), date(2026, 1, 31), None, None)
    assert len(days) == 31
    assert all(d.balance_sure is None for d in days)


def test_month_summaries():
    items = [
        item(direction="income", amount=3000, start_date="2026-01-15"),
        item(amount=100, start_date="2026-01-10"),
        item(amount=50, start_date="2026-02-10", schedule={"frequency": "once"}, certainty=UNSURE),
    ]
    jan, feb = month_summaries(items, date(2026, 1, 20), 2)
    assert jan["month"] == "2026-01"
    assert jan["income"] == 3000 and jan["expense"] == 100 and jan["net"] == 2900
    assert feb["uncertain_expense"] == 50


def rolling(**kw):
    return item(start_date="2026-11-10", schedule={"frequency": "rolling", "interval": 1, "unit": "months"}, **kw)


def dates_of(it, start="2026-11-01", end="2027-03-31"):
    return [o.date.isoformat() for o in occurrences([it], date.fromisoformat(start), date.fromisoformat(end))]


def test_rolling_runs_monthly_without_appointments():
    assert dates_of(rolling()) == ["2026-11-10", "2026-12-10", "2027-01-10", "2027-02-10", "2027-03-10"]


def test_rolling_planned_appointment_moves_following_ones():
    it = rolling(overrides=[{"due_date": "2026-12-10", "date": "2026-12-19", "amount": None}])
    assert dates_of(it) == ["2026-11-10", "2026-12-19", "2027-01-19", "2027-02-19", "2027-03-19"]
    occ = occurrences([it], date(2026, 12, 1), date(2027, 1, 31))
    assert [(o.planned, o.certainty) for o in occ] == [(True, SURE), (False, LIKELY)]


def test_rolling_late_visit_shifts_schedule():
    # went 5 weeks later than planned
    it = rolling(confirmations=[{"due_date": "2026-11-10", "status": "booked", "actual_date": "2026-12-15", "actual_amount": 32}])
    assert dates_of(it) == ["2026-12-15", "2027-01-15", "2027-02-15", "2027-03-15"]


def test_rolling_keeps_gap_before_a_later_appointment():
    # appointment fixed for the 3rd visit, the 2nd stays in between
    it = rolling(overrides=[{"due_date": "2027-01-10", "date": "2027-01-20", "amount": 40}])
    assert dates_of(it) == ["2026-11-10", "2026-12-10", "2027-01-20", "2027-02-20", "2027-03-20"]
    jan = [o for o in occurrences([it], date(2027, 1, 1), date(2027, 1, 31))][0]
    assert jan.amount == -40


def test_rolling_in_weeks_and_end_date():
    it = item(start_date="2026-11-02", end_date="2026-12-31", schedule={"frequency": "rolling", "interval": 5, "unit": "weeks"})
    assert dates_of(it) == ["2026-11-02", "2026-12-07"]


def test_override_moves_single_fixed_booking_only():
    it = item(start_date="2026-11-15", overrides=[{"due_date": "2026-12-15", "date": "2026-12-22", "amount": None}])
    assert dates_of(it, end="2027-01-31") == ["2026-11-16", "2026-12-22", "2027-01-15"]
