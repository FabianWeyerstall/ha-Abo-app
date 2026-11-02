"""Haushaltsbuch: due dates of subscriptions, contracts and income in Home Assistant."""
from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    PANEL_ICON,
    PANEL_STATIC_URL,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PANEL_WEBCOMPONENT,
    SIGNAL_UPDATED,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
)
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


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    async_register_websocket_commands(hass)
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
            sidebar_title=PANEL_TITLE,
            sidebar_icon=PANEL_ICON,
            module_url=f"{PANEL_STATIC_URL}/haushaltsbuch-panel.js?v={VERSION}",
            require_admin=False,
            config={},
        )

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data.pop(DOMAIN, None)
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return unloaded
