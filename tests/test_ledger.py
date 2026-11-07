"""Imported transactions: anything in a bank file is stored as plain, bounded text."""
import pytest

from custom_components.haushaltsbuch import ledger as ledger_module
from custom_components.haushaltsbuch.ledger import Ledger
from custom_components.haushaltsbuch.store import ValidationError

EVIL = [
    "<img src=x onerror=alert(1)>",
    "'; DROP TABLE users; --",
    '=HYPERLINK("http://evil")',
    "{{constructor.constructor('alert(1)')()}}",
]


def test_hostile_text_is_kept_as_plain_text():
    ledger = Ledger()
    rows = [{"date": "2026-10-01", "amount": -1 - i, "name": t, "purpose": t, "account": t} for i, t in enumerate(EVIL)]
    assert ledger.add("anna", rows)["added"] == 4
    stored = ledger.rows("anna")
    assert [r[2] for r in stored] == EVIL
    assert ledger.rows("bob") == []


def test_text_is_capped_and_control_characters_dropped():
    ledger = Ledger()
    ledger.add("anna", [{"date": "2026-10-01", "amount": -5, "name": "A\x00B\nC" + "x" * 500, "purpose": "y" * 5000}])
    row = ledger.rows("anna")[0]
    assert row[2].startswith("A B C") and len(row[2]) == 80
    assert len(row[6]) == 140


@pytest.mark.parametrize("amount", ["nan", "inf", "-inf", "1e9", 0, "abc", None])
def test_bad_amounts_are_refused(amount):
    with pytest.raises(ValidationError):
        Ledger().add("anna", [{"date": "2026-10-01", "amount": amount}])


@pytest.mark.parametrize("date", ["2026-13-01", "01.10.2026", "", None, "2026-10-01'; DROP TABLE x"])
def test_bad_dates_are_refused(date):
    with pytest.raises(ValidationError):
        Ledger().add("anna", [{"date": date, "amount": -1}])


def test_refused_import_leaves_nothing_behind(monkeypatch):
    monkeypatch.setattr(ledger_module, "MAX_ROWS_PER_USER", 3)
    ledger = Ledger()
    ledger.add("anna", [{"date": "2026-10-01", "amount": -1}, {"date": "2026-10-02", "amount": -2}])
    with pytest.raises(ValidationError):
        ledger.add("anna", [{"date": f"2026-10-1{i}", "amount": -i - 1} for i in range(3)])
    assert len(ledger.rows("anna")) == 2
    with pytest.raises(ValidationError):
        ledger.add("bob", [{"date": "2026-10-01", "amount": -1}, "kein Umsatz"])
    assert ledger.rows("bob") == []
