"""Shared base for entities of a household.

Entities are visible to every Home Assistant user, so they are only created
for households where a member switched them on in the panel.
"""
from __future__ import annotations

from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, SIGNAL_UPDATED, VERSION


class HouseholdEntity(Entity):
    _attr_has_entity_name = True

    def __init__(self, data, household_id: str, key: str) -> None:
        self._data = data
        self._household_id = household_id
        self._attr_unique_id = f"{household_id}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, household_id)},
            name=f"Haushaltsbuch {self.household['name']}",
            manufacturer="Haushaltsbuch",
            entry_type=DeviceEntryType.SERVICE,
            sw_version=VERSION,
        )

    @property
    def household(self) -> dict:
        return self._data.book.data["households"].get(self._household_id) or {}

    @property
    def items(self) -> list[dict]:
        return self._data.book.items_of_household(self._household_id)

    @property
    def available(self) -> bool:
        return bool(self.household)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(
            async_dispatcher_connect(self.hass, SIGNAL_UPDATED, self._handle_update)
        )

    @callback
    def _handle_update(self) -> None:
        self.async_schedule_update_ha_state(True)


def entity_households(data) -> list[str]:
    return sorted(data.entity_households())
