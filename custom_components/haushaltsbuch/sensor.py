"""Sensors of a household: next booking and projected balance."""
from __future__ import annotations

from calendar import monthrange
from datetime import timedelta

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .engine import EXPENSE, INCOME, forecast, occurrences, parse_date
from .entity import HouseholdEntity, entity_households

SCAN_INTERVAL = timedelta(minutes=30)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    data = entry.runtime_data
    entities: list[SensorEntity] = []
    for household_id in entity_households(data):
        entities += [
            NextBookingSensor(data, household_id, EXPENSE),
            NextBookingSensor(data, household_id, INCOME),
            MonthEndBalanceSensor(data, household_id),
        ]
    async_add_entities(entities)


class NextBookingSensor(HouseholdEntity, SensorEntity):
    """Amount of the next open booking, with its name and date as attributes."""

    _attr_should_poll = True
    _attr_device_class = SensorDeviceClass.MONETARY

    def __init__(self, data, household_id: str, direction: str) -> None:
        key = "next_expense" if direction == EXPENSE else "next_income"
        super().__init__(data, household_id, key)
        self._direction = direction

    @property
    def native_unit_of_measurement(self) -> str:
        return self.hass.config.currency

    async def async_update(self) -> None:
        today = dt_util.now().date()
        upcoming = [
            occ
            for occ in occurrences(self.items, today, today + timedelta(days=366))
            if occ.status is None and occ.direction == self._direction
        ]
        if not upcoming:
            self._attr_native_value = None
            self._attr_extra_state_attributes = {}
            return
        nxt = upcoming[0]
        self._attr_native_value = round(abs(nxt.amount), 2)
        self._attr_extra_state_attributes = {
            "name": nxt.name,
            "date": nxt.date.isoformat(),
            "category": nxt.category,
            "certainty": nxt.certainty,
            "icon_name": nxt.icon,
        }


class MonthEndBalanceSensor(HouseholdEntity, SensorEntity):
    """Projected balance at the end of the current month (sure + likely)."""

    _attr_should_poll = True
    _attr_device_class = SensorDeviceClass.MONETARY

    def __init__(self, data, household_id: str) -> None:
        super().__init__(data, household_id, "month_end_balance")

    @property
    def native_unit_of_measurement(self) -> str:
        return self.hass.config.currency

    async def async_update(self) -> None:
        household = self.household
        balance_date = parse_date(household.get("balance_date"))
        if household.get("balance") is None or balance_date is None:
            self._attr_native_value = None
            return
        today = dt_util.now().date()
        month_end = today.replace(day=monthrange(today.year, today.month)[1])
        end = max(month_end, balance_date)
        days = forecast(self.items, end, end, household["balance"], balance_date)
        self._attr_native_value = days[-1].balance_likely if days else None
        self._attr_extra_state_attributes = {
            "nur_sichere_posten": days[-1].balance_sure if days else None,  # kept for existing automations
            "vorsichtig": days[-1].balance_sure if days else None,
            "stand_vom": balance_date.isoformat(),
        }
