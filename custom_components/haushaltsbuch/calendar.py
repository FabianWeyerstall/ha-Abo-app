"""Calendar with all due dates of a household."""
from __future__ import annotations

from datetime import date, datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .engine import Occurrence, occurrences
from .entity import HouseholdEntity, entity_households


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    data = entry.runtime_data
    async_add_entities(
        HouseholdCalendar(data, household_id) for household_id in entity_households(data)
    )


def _event(occ: Occurrence, currency: str) -> CalendarEvent:
    sign = "+" if occ.amount >= 0 else "−"
    return CalendarEvent(
        start=occ.date,
        end=occ.date + timedelta(days=1),
        summary=f"{occ.name} {sign}{abs(occ.amount):.2f} {currency}",
        description=f"{occ.category} · {occ.certainty}",
        uid=f"{occ.item_id}_{occ.due_date.isoformat()}",
    )


class HouseholdCalendar(HouseholdEntity, CalendarEntity):
    _attr_should_poll = True

    def __init__(self, data, household_id: str) -> None:
        super().__init__(data, household_id, "due_dates")
        self._event: CalendarEvent | None = None

    @property
    def event(self) -> CalendarEvent | None:
        return self._event

    async def async_update(self) -> None:
        today = dt_util.now().date()
        upcoming = [
            occ
            for occ in occurrences(self.items, today, today + timedelta(days=366))
            if occ.status is None
        ]
        self._event = _event(upcoming[0], self.hass.config.currency) if upcoming else None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        start: date = dt_util.as_local(start_date).date()
        end: date = dt_util.as_local(end_date).date()
        return [
            _event(occ, hass.config.currency)
            for occ in occurrences(self.items, start, end)
            if occ.status != "skipped"
        ]
