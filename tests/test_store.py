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
