"""Access rules and validation of the data store."""
import pytest

from custom_components.haushaltsbuch.store import AccessError, Book, ValidationError

ITEM = {
    "name": "Netflix",
    "direction": "expense",
    "amount": "13.99",
    "category": "TV & Streaming",
    "icon": "mdi:netflix",
    "start_date": "2026-11-15",
    "schedule": {"frequency": "monthly", "interval": 1},
}


def test_items_are_private_until_shared():
    book = Book()
    item_id = book.save_item("anna", ITEM)
    assert [i["id"] for i in book.visible_items("anna")] == [item_id]
    assert book.visible_items("ben") == []
    with pytest.raises(AccessError):
        book.save_item("ben", {**ITEM, "id": item_id})
    with pytest.raises(AccessError):
        book.confirm("ben", item_id, "2026-11-15", "booked")


def test_household_sharing():
    book = Book()
    hh = book.create_household("anna", "Zuhause", ["ben"])
    shared = book.save_item("anna", {**ITEM, "household_id": hh})
    private = book.save_item("anna", {**ITEM, "name": "Privat"})
    assert {i["id"] for i in book.visible_items("ben")} == {shared}
    assert {i["id"] for i in book.household_items("ben", hh)} == {shared}
    # members may confirm shared bookings but not edit them
    book.confirm("ben", shared, "2026-11-15", "booked", actual_amount=13.99)
    with pytest.raises(AccessError):
        book.delete_item("ben", shared)
    # outsiders see nothing
    with pytest.raises(AccessError):
        book.household_items("carla", hh)
    with pytest.raises(AccessError):
        book.save_item("carla", {**ITEM, "household_id": hh})
    assert private not in {i["id"] for i in book.visible_items("ben")}


def test_member_removal_makes_items_private():
    book = Book()
    hh = book.create_household("anna", "Zuhause", ["ben"])
    bens = book.save_item("ben", {**ITEM, "household_id": hh})
    with pytest.raises(AccessError):
        book.update_household("ben", hh, members=[])  # only the creator manages members
    book.leave_household("ben", hh)
    assert book.data["items"][bens]["household_id"] is None
    assert book.visible_items("anna") == []
    with pytest.raises(ValidationError):
        book.leave_household("anna", hh)


def test_delete_household():
    book = Book()
    hh = book.create_household("anna", "Zuhause", ["ben"])
    it = book.save_item("anna", {**ITEM, "household_id": hh})
    with pytest.raises(AccessError):
        book.delete_household("ben", hh)
    book.delete_household("anna", hh)
    assert book.data["items"][it]["household_id"] is None


@pytest.mark.parametrize(
    "change",
    [
        {"name": " "},
        {"amount": "abc"},
        {"direction": "sideways"},
        {"start_date": "15.11.2026"},
        {"end_date": "2026-01-01"},
        {"schedule": {"frequency": "daily"}},
        {"schedule": {"frequency": "fixed_dates", "dates": []}},
        {"schedule": {"frequency": "fixed_dates", "dates": ["13-01"]}},
        {"certainty": "maybe"},
        {"amount_variance_pct": 150},
    ],
)
def test_validation(change):
    with pytest.raises(ValidationError):
        Book().save_item("anna", {**ITEM, **change})


def test_valid_item_is_normalised():
    book = Book()
    item_id = book.save_item(
        "anna",
        {**ITEM, "amount": "-13.99", "schedule": {"frequency": "fixed_dates", "dates": ["10-15", "4-1"]}, "owner": "evil"},
    )
    item = book.data["items"][item_id]
    assert item["amount"] == 13.99
    assert item["owner"] == "anna"
    assert item["schedule"]["dates"] == ["04-01", "10-15"]


def test_confirm_reset():
    book = Book()
    it = book.save_item("anna", ITEM)
    book.confirm("anna", it, "2026-11-15", "skipped")
    assert len(book.data["items"][it]["confirmations"]) == 1
    book.confirm("anna", it, "2026-11-15", None)
    assert book.data["items"][it]["confirmations"] == []


def test_plan_and_clear_appointment():
    book = Book()
    it = book.save_item("anna", {**ITEM, "schedule": {"frequency": "rolling", "interval": 5, "unit": "weeks"}})
    assert book.data["items"][it]["schedule"]["unit"] == "weeks"
    book.plan("anna", it, "2026-12-20", "2026-12-23", 30)
    assert book.data["items"][it]["overrides"][0]["date"] == "2026-12-23"
    with pytest.raises(AccessError):
        book.plan("ben", it, "2026-12-20", "2026-12-24")
    with pytest.raises(ValidationError):
        book.plan("anna", it, "2026-12-20", "23.12.2026")
    book.plan("anna", it, "2026-12-20", None)
    assert book.data["items"][it]["overrides"] == []
    # saving the item again keeps planned appointments
    book.plan("anna", it, "2026-12-20", "2026-12-23")
    book.save_item("anna", {**ITEM, "id": it, "schedule": {"frequency": "rolling", "interval": 4, "unit": "weeks"}})
    assert len(book.data["items"][it]["overrides"]) == 1


def test_rolling_unit_validation():
    with pytest.raises(ValidationError):
        Book().save_item("anna", {**ITEM, "schedule": {"frequency": "rolling", "unit": "days"}})


def test_export_and_import_roundtrip():
    import json

    book = Book()
    hh = book.create_household("anna", "Zuhause", ["ben"])
    item_id = book.save_item("anna", {**ITEM, "household_id": hh})
    book.save_item("anna", {**ITEM, "name": "Friseur", "schedule": {"frequency": "rolling", "interval": 1, "unit": "months"}})
    book.save_item("ben", {**ITEM, "name": "Bens Posten"})
    book.confirm("anna", item_id, "2026-11-15", "booked", actual_amount=14)
    book.plan("anna", item_id, "2026-12-15", "2026-12-18")
    book.set_user_balance("anna", 1200, "2026-11-01")

    exported = json.loads(json.dumps(book.export_items("anna")))
    assert exported["format"] == "haushaltsbuch"
    assert [i["name"] for i in exported["items"]] == ["Friseur", "Netflix"]
    assert "household_id" not in exported["items"][1] and "owner" not in exported["items"][1]

    # into a fresh book for another user: everything private, history kept
    other = Book()
    assert other.import_items("carl", exported) == {"added": 2, "skipped": 0}
    netflix = next(i for i in other.own_items("carl") if i["name"] == "Netflix")
    assert netflix["household_id"] is None
    assert netflix["confirmations"][0]["actual_amount"] == 14
    assert netflix["overrides"][0]["date"] == "2026-12-18"
    friseur = next(i for i in other.own_items("carl") if i["name"] == "Friseur")
    assert friseur["schedule"]["unit"] == "months"

    # importing again adds nothing; replace swaps the own items and the balance
    assert other.import_items("carl", exported) == {"added": 0, "skipped": 2}
    other.save_item("carl", {**ITEM, "name": "Alt"})
    assert other.import_items("carl", exported, replace=True) == {"added": 2, "skipped": 0}
    assert sorted(i["name"] for i in other.own_items("carl")) == ["Friseur", "Netflix"]
    assert other.user("carl")["balance"] == 1200


def test_import_rejects_bad_files_without_changes():
    book = Book()
    book.save_item("anna", ITEM)
    with pytest.raises(ValidationError):
        book.import_items("anna", {"items": []})
    bad = {"format": "haushaltsbuch", "items": [{**ITEM, "name": "Gut"}, {**ITEM, "start_date": "kaputt"}]}
    with pytest.raises(ValidationError):
        book.import_items("anna", bad, replace=True)
    assert [i["name"] for i in book.own_items("anna")] == ["Netflix"]


def test_new_item_fields_are_validated():
    book = Book()
    item_id = book.save_item("anna", {
        **ITEM,
        "price_changes": [{"from": "2027-01-01", "amount": "15.99"}, {"from": "2026-12-01", "amount": 14}],
        "contract": {"end": "2027-06-30", "notice": "1", "notice_unit": "months", "renew_months": "12"},
    })
    saved = book.data["items"][item_id]
    assert [c["from"] for c in saved["price_changes"]] == ["2026-12-01", "2027-01-01"]
    assert saved["contract"] == {"end": "2027-06-30", "notice": 1, "notice_unit": "months", "renew_months": 12}
    no_contract = book.save_item("anna", {**ITEM, "contract": {"end": "", "notice": 3}})
    assert book.data["items"][no_contract]["contract"] is None
    rolling = book.save_item("anna", {**ITEM, "schedule": {"frequency": "rolling", "learn": False}})
    assert book.data["items"][rolling]["schedule"]["learn"] is False
    budget = book.save_item("anna", {**ITEM, "schedule": {"frequency": "budget"}})
    assert book.data["items"][budget]["schedule"]["frequency"] == "budget"
    for bad in (
        {"price_changes": [{"from": "x", "amount": 1}]},
        {"price_changes": [{"from": "2026-01-01", "amount": "abc"}]},
        {"contract": {"end": "2026-01-01", "notice_unit": "years"}},
        {"contract": {"end": "2026-01-01", "notice": 400}},
    ):
        with pytest.raises(ValidationError):
            book.save_item("anna", {**ITEM, **bad})
