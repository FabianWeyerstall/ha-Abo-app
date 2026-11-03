"""Setup, panel, WebSocket API and entities inside a test Home Assistant."""
from datetime import date, timedelta

from homeassistant.components import frontend
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.haushaltsbuch.const import DOMAIN, PANEL_URL_PATH


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, title="Haushaltsbuch")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_setup_registers_panel(hass: HomeAssistant, hass_ws_client) -> None:
    entry = await _setup(hass)
    assert PANEL_URL_PATH in hass.data[frontend.DATA_PANELS]
    assert await hass.config_entries.async_unload(entry.entry_id)
    assert PANEL_URL_PATH not in hass.data[frontend.DATA_PANELS]


async def test_websocket_flow_and_privacy(
    hass: HomeAssistant, hass_ws_client, hass_admin_user, hass_read_only_user, hass_read_only_access_token
) -> None:
    await _setup(hass)
    anna = await hass_ws_client(hass)  # admin user
    ben = await hass_ws_client(hass, hass_read_only_access_token)
    today = date.today()

    await anna.send_json_auto_id(
        {
            "type": f"{DOMAIN}/item/save",
            "item": {
                "name": "Netflix",
                "direction": "expense",
                "amount": 13.99,
                "category": "TV & Streaming",
                "icon": "mdi:netflix",
                "start_date": today.isoformat(),
                "schedule": {"frequency": "monthly", "interval": 1},
            },
        }
    )
    res = await anna.receive_json()
    assert res["success"], res
    item_id = res["result"]["id"]

    await anna.send_json_auto_id({"type": f"{DOMAIN}/balance", "scope": "me", "balance": 1000})
    assert (await anna.receive_json())["success"]

    await anna.send_json_auto_id(
        {
            "type": f"{DOMAIN}/forecast",
            "scope": "me",
            "start": today.isoformat(),
            "end": (today + timedelta(days=40)).isoformat(),
        }
    )
    res = await anna.receive_json()
    assert res["success"], res
    entries = [e for d in res["result"]["days"] for e in d["entries"]]
    assert entries and entries[0]["name"] == "Netflix"

    # Fix the next booking as an appointment; it is then marked as planned
    first = entries[0]
    await anna.send_json_auto_id(
        {"type": f"{DOMAIN}/plan", "item_id": item_id, "due_date": first["due_date"],
         "date": (today + timedelta(days=3)).isoformat(), "amount": 15}
    )
    assert (await anna.receive_json())["success"]
    await anna.send_json_auto_id(
        {"type": f"{DOMAIN}/forecast", "scope": "me", "start": today.isoformat(),
         "end": (today + timedelta(days=10)).isoformat()}
    )
    res = await anna.receive_json()
    planned = [e for d in res["result"]["days"] for e in d["entries"] if e["planned"]]
    assert planned and planned[0]["amount"] == -15

    # Ben (another user, read-only in HA) sees none of Anna's private data
    await ben.send_json_auto_id({"type": f"{DOMAIN}/state"})
    res = await ben.receive_json()
    assert res["success"], res
    assert res["result"]["items"] == []
    await ben.send_json_auto_id({"type": f"{DOMAIN}/item/delete", "item_id": item_id})
    res = await ben.receive_json()
    assert not res["success"] and res["error"]["code"] == "unauthorized"

    # Anna shares it through a household with Ben and switches entities on
    await anna.send_json_auto_id(
        {"type": f"{DOMAIN}/household/create", "name": "Zuhause", "members": [hass_read_only_user.id]}
    )
    res = await anna.receive_json()
    household_id = res["result"]["id"]
    await anna.send_json_auto_id(
        {"type": f"{DOMAIN}/item/save", "item": {**_item(today), "id": item_id, "household_id": household_id}}
    )
    assert (await anna.receive_json())["success"]
    await anna.send_json_auto_id(
        {"type": f"{DOMAIN}/household/update", "household_id": household_id, "entities": True}
    )
    assert (await anna.receive_json())["success"]
    await hass.async_block_till_done()

    await ben.send_json_auto_id({"type": f"{DOMAIN}/state"})
    res = await ben.receive_json()
    assert [i["id"] for i in res["result"]["items"]] == [item_id]
    assert res["result"]["items"][0]["editable"] is False
    assert res["result"]["items"][0]["current_amount"] == 13.99
    assert res["result"]["items"][0]["contract_info"] is None
    await ben.send_json_auto_id({"type": f"{DOMAIN}/summary", "scope": household_id, "months": 2})
    res = await ben.receive_json()
    assert res["success"] and len(res["result"]) == 2

    calendars = hass.states.async_entity_ids("calendar")
    sensors = hass.states.async_entity_ids("sensor")
    assert len(calendars) == 1
    assert len(sensors) == 3


def _item(today: date) -> dict:
    return {
        "name": "Netflix",
        "direction": "expense",
        "amount": 13.99,
        "category": "TV & Streaming",
        "icon": "mdi:netflix",
        "start_date": today.isoformat(),
        "schedule": {"frequency": "monthly", "interval": 1},
    }


async def test_websocket_export_import(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    today = date.today()
    await client.send_json_auto_id({"type": f"{DOMAIN}/item/save", "item": _item(today)})
    assert (await client.receive_json())["success"]
    await client.send_json_auto_id({"type": f"{DOMAIN}/export"})
    exported = (await client.receive_json())["result"]
    assert len(exported["items"]) == 1
    await client.send_json_auto_id({"type": f"{DOMAIN}/import", "data": exported})
    res = await client.receive_json()
    assert res["success"] and res["result"] == {"added": 0, "skipped": 1}
    await client.send_json_auto_id({"type": f"{DOMAIN}/import", "data": {"format": "x"}})
    res = await client.receive_json()
    assert not res["success"] and res["error"]["code"] == "invalid_format"


async def test_contract_reminder_event_and_service(hass: HomeAssistant, hass_ws_client) -> None:
    from pytest_homeassistant_custom_component.common import async_capture_events

    from homeassistant.util import dt as dt_util

    await _setup(hass)
    client = await hass_ws_client(hass)
    today = dt_util.now().date()  # HA's time zone, as used by the integration
    cancel_in_7 = (today + timedelta(days=7)).isoformat()
    await client.send_json_auto_id(
        {
            "type": f"{DOMAIN}/item/save",
            "item": {**_item(today), "contract": {"end": cancel_in_7, "notice": 0, "notice_unit": "days", "renew": 12}},
        }
    )
    assert (await client.receive_json())["success"]
    events = async_capture_events(hass, f"{DOMAIN}_kuendigungsfrist")
    await hass.services.async_call(DOMAIN, "send_contract_reminders", {}, blocking=True)
    await hass.async_block_till_done()
    assert len(events) == 1
    data = events[0].data
    assert data["name"] == "Netflix" and data["days_left"] == 7 and data["cancel_by"] == cancel_in_7
    assert data["household"] is None and "owner_name" in data
