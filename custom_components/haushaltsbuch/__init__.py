"""Haushaltsbuch: due dates of subscriptions, contracts and income in Home Assistant."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import voluptuous as vol

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN,
    EVENT_CONTRACT_REMINDER,
    PANEL_ICON,
    PANEL_STATIC_URL,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
    REMINDER_HOUR,
    SERVICE_CONTRACT_REMINDERS,
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
)
from .engine import contract_reminders
from .store import Book
from .websocket_api import async_register_websocket_commands

PLATFORMS = [Platform.CALENDAR, Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)
STATIC_REGISTERED = f"{DOMAIN}_static_registered"


class HaushaltsbuchData:
    """Runtime holder for the book and its persistence."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.book = Book()
        self._entity_households: frozenset[str] = frozenset()

    async def async_load(self) -> None:
        self.book = Book(await self.store.async_load())
        self._entity_households = self.entity_households()

    def entity_households(self) -> frozenset[str]:
        return frozenset(
            hid for hid, hh in self.book.data["households"].items() if hh.get("entities")
        )

    async def async_changed(self) -> None:
        """Persist and notify entities; reload when the entity set changed."""
        await self.store.async_save(self.book.data)
        if self.entity_households() != self._entity_households:
            self.hass.config_entries.async_schedule_reload(self.entry.entry_id)
        else:
            async_dispatcher_send(self.hass, SIGNAL_UPDATED)


async def async_fire_contract_reminders(
    hass: HomeAssistant, today: date | None = None, all_upcoming: bool = False
) -> int:
    """Fire one event per contract whose cancel-by date is near. Returns the count."""
    data: HaushaltsbuchData | None = hass.data.get(DOMAIN)
    if data is None:
        return 0
    today = today or dt_util.now().date()
    users = {u.id: u.name or u.id for u in await hass.auth.async_get_users()}
    households = data.book.data["households"]
    reminders = contract_reminders(data.book.data["items"].values(), today, all_upcoming)
    for reminder in reminders:
        household = households.get(reminder["household_id"] or "")
        hass.bus.async_fire(
            EVENT_CONTRACT_REMINDER,
            {
                **reminder,
                "owner_name": users.get(reminder["owner"], ""),
                "household": household["name"] if household else None,
            },
        )
    return len(reminders)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_register_websocket_commands(hass)

    async def _send_reminders(call: ServiceCall) -> None:
        await async_fire_contract_reminders(hass, all_upcoming=call.data["all"])

    hass.services.async_register(
        DOMAIN,
        SERVICE_CONTRACT_REMINDERS,
        _send_reminders,
        schema=vol.Schema({vol.Optional("all", default=False): bool}),
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = HaushaltsbuchData(hass, entry)
    await data.async_load()
    hass.data[DOMAIN] = data
    entry.runtime_data = data

    # Static paths cannot be removed again, so register them once per HA run.
    if not hass.data.get(STATIC_REGISTERED):
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    PANEL_STATIC_URL, str(Path(__file__).parent / "frontend"), False
                )
            ]
        )
        hass.data[STATIC_REGISTERED] = True

    if PANEL_URL_PATH not in hass.data.get(frontend.DATA_PANELS, {}):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_URL_PATH,
            webcomponent_name=PANEL_WEBCOMPONENT,
            # One title for all users: HA can't localise a custom panel's
            # sidebar title per user, so the product name stays as it is.
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{PANEL_STATIC_URL}/haushaltsbuch-panel.js?v={VERSION}",
            require_admin=False,
            config={},
        )

    async def _daily(now) -> None:
        await async_fire_contract_reminders(hass, dt_util.as_local(now).date())

    entry.async_on_unload(
        async_track_time_change(hass, _daily, hour=REMINDER_HOUR, minute=0, second=0)
    )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data.pop(DOMAIN, None)
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return unloaded
