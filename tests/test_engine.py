"""Tests for the pure calculation logic (no Home Assistant needed)."""
from datetime import date, timedelta

import pytest

from custom_components.haushaltsbuch.engine import (
    LIKELY,
    amount_on,
    budget_per_day,
    contract_info,
    learned_interval_days,
    SURE,
    UNSURE,
    certainty_for,
    easter_sunday,
    forecast,
    month_summaries,
    nth_weekday,
    salary_periods,
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
    # the cautious line counts the likely expense too
    assert by_date["2026-11-04"].balance_sure == 900
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


def test_price_change_applies_from_date_only():
    it = item(start_date="2026-01-15", price_changes=[{"from": "2026-03-01", "amount": 15.99}])
    occ = occurrences([it], date(2026, 1, 1), date(2026, 4, 30))
    assert [o.amount for o in occ] == [-10, -10, -15.99, -15.99]
    assert amount_on(it, date(2026, 2, 28)) == 10
    # a booking confirmed at the old price stays sure after the change
    confirmed = item(
        price_changes=[{"from": "2026-05-01", "amount": 12}],
        confirmations=[{"due_date": "2026-04-15", "status": "booked", "actual_date": None, "actual_amount": 10}],
    )
    assert certainty_for(confirmed, date(2026, 5, 15)) == SURE


def test_contract_cancel_by_and_renewal():
    it = item(contract={"end": "2026-12-31", "notice": 3, "notice_unit": "months", "renew_months": 12})
    info = contract_info(it, date(2026, 11, 2))
    # cancel-by date for 2026 has passed, so the next one is for the renewed end
    assert info["end"] == "2027-12-31" and info["cancel_by"] == "2027-09-30" and info["renews"]
    info = contract_info(it, date(2026, 6, 1))
    assert info["end"] == "2026-12-31" and info["cancel_by"] == "2026-09-30"
    assert info["days_left"] == 121
    fixed = item(contract={"end": "2026-10-31", "notice": 4, "notice_unit": "weeks", "renew_months": 0})
    info = contract_info(fixed, date(2026, 11, 2))
    assert info["ended"] and info["cancel_by"] == "2026-10-03"
    assert contract_info(item(), date(2026, 1, 1)) is None
    # renewal in weeks (e.g. a 4-week mobile plan) and days
    weekly = item(contract={"end": "2026-11-01", "notice": 7, "notice_unit": "days", "renew": 4, "renew_unit": "weeks"})
    info = contract_info(weekly, date(2026, 11, 3))
    assert info["end"] == "2026-11-29" and info["cancel_by"] == "2026-11-22"
    daily = item(contract={"end": "2026-11-01", "notice": 0, "notice_unit": "days", "renew": 30, "renew_unit": "days"})
    assert contract_info(daily, date(2026, 11, 3))["end"] == "2026-12-01"


def test_budget_spreads_over_month_and_counts_as_likely():
    budget = item(id="food", amount=600, start_date="2026-11-01", schedule={"frequency": "budget"})
    assert occurrences([budget], date(2026, 11, 1), date(2026, 11, 30)) == []
    assert budget_per_day([budget], date(2026, 11, 10)) == pytest.approx(-20)
    days = forecast([budget], date(2026, 11, 1), date(2026, 11, 30), 1000.0, date(2026, 11, 10))
    assert days[-1].balance_likely == pytest.approx(1000 - 20 * 20)
    assert days[-1].balance_sure == pytest.approx(1000 - 20 * 20)
    nov, dec = month_summaries([budget], date(2026, 11, 1), 2)
    assert nov["expense"] == 600 and dec["expense"] == 600
    assert nov["entries"][0]["budget"] is True
    # started mid-month: pro rata
    late = item(amount=300, start_date="2026-11-16", schedule={"frequency": "budget"})
    assert month_summaries([late], date(2026, 11, 1), 1)[0]["expense"] == 150


def test_rolling_learns_interval_from_booked_visits():
    visits = ["2026-08-01", "2026-09-05", "2026-10-10"]  # every 35 days
    conf = [{"due_date": d, "status": "booked", "actual_date": d, "actual_amount": None} for d in visits]
    it = item(start_date="2026-08-01", schedule={"frequency": "rolling", "interval": 1, "unit": "months"}, confirmations=conf)
    assert learned_interval_days(it) == 35
    assert dates_of(it, start="2026-10-11", end="2026-12-31") == ["2026-11-14", "2026-12-19"]
    off = item(start_date="2026-08-01", schedule={"frequency": "rolling", "interval": 1, "unit": "months", "learn": False}, confirmations=conf)
    assert learned_interval_days(off) is None
    assert dates_of(off, start="2026-10-11", end="2026-12-31") == ["2026-11-10", "2026-12-10"]


def test_contract_reminders_30_7_1_days_before():
    from custom_components.haushaltsbuch.engine import contract_reminders

    def contract(id_, end):
        return item(id=id_, name=id_, contract={"end": end, "notice": 1, "notice_unit": "months", "renew": 12})

    items = [contract("in30", "2027-01-01"), contract("in7", "2026-12-08"), contract("in10", "2026-12-11"), item(id="none")]
    today = date(2026, 11, 1)
    assert [r["name"] for r in contract_reminders(items, today)] == ["in7", "in30"]
    r = contract_reminders(items, today)[0]
    assert r["days_left"] == 7 and r["cancel_by"] == "2026-11-08" and r["renews"]
    assert [r["name"] for r in contract_reminders(items, today, all_upcoming=True)] == ["in7", "in10", "in30"]


def test_cautious_line_leaves_out_likely_income():
    items = [
        item(id="salary", direction="income", amount=2000, start_date="2026-11-03"),  # likely
        item(id="power", amount=100, start_date="2026-11-04"),  # likely
    ]
    days = forecast(items, date(2026, 11, 2), date(2026, 11, 5), 500.0, date(2026, 11, 2))
    assert days[-1].balance_likely == 2400
    assert days[-1].balance_sure == 400
    assert all(d.balance_sure <= d.balance_likely for d in days)


def test_last_thursday_of_month():
    assert nth_weekday(2026, 11, 3, -1) == date(2026, 11, 26)
    assert nth_weekday(2026, 12, 3, -1) == date(2026, 12, 31)
    assert nth_weekday(2026, 11, 0, 1) == date(2026, 11, 2)
    salary = item(
        direction="income",
        start_date="2026-10-01",
        schedule={"frequency": "monthly", "interval": 1, "weekday": 3, "week": -1},
    )
    assert list(nominal_dates(salary, date(2027, 1, 31))) == [
        date(2026, 10, 29), date(2026, 11, 26), date(2026, 12, 31), date(2027, 1, 28),
    ]


def test_months_run_from_payday_to_payday():
    salary = item(
        id="gehalt",
        direction="income",
        amount=2700.0,
        start_date="2026-01-01",
        weekend_shift="previous",
        schedule={"frequency": "monthly", "interval": 1, "weekday": 3, "week": -1},
    )
    rent = item(id="miete", amount=900.0, start_date="2026-01-01",
                schedule={"frequency": "monthly", "interval": 1})
    periods = salary_periods([salary, rent], "gehalt", date(2026, 11, 3), 2)
    # Paid on 29 Oct, so the current month is November until the next payday.
    assert periods[0] == (date(2026, 11, 1), date(2026, 10, 29), date(2026, 11, 25))
    assert periods[1] == (date(2026, 12, 1), date(2026, 11, 26), date(2026, 12, 30))
    rows = month_summaries([salary, rent], date(2026, 11, 3), 2, periods)
    assert rows[0]["month"] == "2026-11"
    assert rows[0]["income"] == 2700.0 and rows[0]["expense"] == 900.0
    assert rows[0]["start"] == "2026-10-29"
    # After payday on 26 Nov the current month is already December.
    assert salary_periods([salary], "gehalt", date(2026, 11, 27), 1)[0][0] == date(2026, 12, 1)
    # Unknown salary item: calendar months.
    assert salary_periods([rent], "gehalt", date(2026, 11, 3), 1) is None


def _budget(**kw):
    return item(
        id="essen", amount=600.0, start_date="2026-01-01",
        schedule={"frequency": "budget", "interval": 1}, **kw,
    )


def test_untracked_budget_is_spread_evenly():
    from custom_components.haushaltsbuch.engine import budget_amounts
    amounts = budget_amounts(_budget(), date(2026, 11, 1), date(2026, 11, 30), date(2026, 11, 10))
    assert round(sum(amounts.values()), 2) == 600.0
    assert round(amounts[date(2026, 11, 1)], 2) == 20.0


def test_spendings_shrink_the_rest_and_rest_expires():
    from custom_components.haushaltsbuch.engine import budget_amounts, budget_status
    b = _budget(spendings=[
        {"id": "a", "date": "2026-11-02", "amount": 150.0},
        {"id": "b", "date": "2026-11-09", "amount": 150.0},
    ])
    today = date(2026, 11, 11)  # 20 days left including today
    amounts = budget_amounts(b, date(2026, 11, 1), date(2026, 11, 30), today)
    assert amounts[date(2026, 11, 2)] == 150.0
    assert date(2026, 11, 5) not in amounts  # past days count only real spending
    assert round(amounts[date(2026, 11, 11)], 2) == 15.0  # 300 left over 20 days
    assert round(sum(amounts.values()), 2) == 600.0
    # The next month starts fresh with the full budget.
    december = budget_amounts(b, date(2026, 12, 1), date(2026, 12, 31), today)
    assert round(sum(december.values()), 2) == 600.0
    status = budget_status(b, today)
    assert status["spent"] == 300.0 and status["rest"] == 300.0 and status["days_left"] == 20


def test_overspent_budget_adds_nothing_more():
    from custom_components.haushaltsbuch.engine import budget_amounts, budget_status
    b = _budget(spendings=[{"id": "a", "date": "2026-11-05", "amount": 700.0}])
    today = date(2026, 11, 20)
    amounts = budget_amounts(b, date(2026, 11, 1), date(2026, 11, 30), today)
    assert amounts == {date(2026, 11, 5): 700.0}
    assert budget_status(b, today)["rest"] == -100.0


def test_budget_month_follows_salary_cycle():
    from custom_components.haushaltsbuch.engine import budget_status, period_finder
    salary = item(
        id="gehalt", direction="income", amount=2700.0, start_date="2026-01-01",
        weekend_shift="previous",
        schedule={"frequency": "monthly", "interval": 1, "weekday": 3, "week": -1},
    )
    b = _budget(spendings=[{"id": "a", "date": "2026-10-30", "amount": 100.0}])
    today = date(2026, 11, 3)
    find = period_finder([salary, b], "gehalt", today - timedelta(days=60), today + timedelta(days=60))
    assert find(today) == (date(2026, 10, 29), date(2026, 11, 25))
    status = budget_status(b, today, find)
    assert status["spent"] == 100.0 and status["start"] == "2026-10-29"
