"""Constants for the Haushaltsbuch integration."""
from __future__ import annotations

DOMAIN = "haushaltsbuch"
VERSION = "0.5.7"

STORAGE_KEY = f"{DOMAIN}.data"
STORAGE_VERSION = 1

PANEL_URL_PATH = "haushaltsbuch"
PANEL_WEBCOMPONENT = "haushaltsbuch-panel"
PANEL_STATIC_URL = "/haushaltsbuch_static"
PANEL_TITLE = "Haushaltsbuch"
PANEL_ICON = "mdi:cash-clock"

SIGNAL_UPDATED = f"{DOMAIN}_updated"
EVENT_CONTRACT_REMINDER = f"{DOMAIN}_kuendigungsfrist"
SERVICE_CONTRACT_REMINDERS = "send_contract_reminders"
REMINDER_HOUR = 9

DEFAULT_CATEGORIES = [
    "Einnahmen",
    "Gehalt",
    "Photovoltaik",
    "Wohnen",
    "Strom",
    "Wasser",
    "Kredite",
    "Sparen",
    "Versicherungen",
    "Auto",
    "Motorrad",
    "Steuern",
    "Rundfunk",
    "Internet & Telefon",
    "TV & Streaming",
    "Abos",
    "Kinder",
    "Vereine",
    "Gesundheit & Pflege",
    "Sonstiges",
]

# Templates for quick entry. Icons are Material Design Icons available in HA.
TEMPLATES = [
    {"name": "Gehalt", "direction": "income", "category": "Gehalt", "icon": "mdi:briefcase", "frequency": "monthly", "weekend_shift": "previous"},
    {"name": "Bonus", "direction": "income", "category": "Einnahmen", "icon": "mdi:gift", "frequency": "once", "certainty": "unsicher"},
    {"name": "Photovoltaik Einspeisevergütung", "direction": "income", "category": "Photovoltaik", "icon": "mdi:solar-power-variant", "frequency": "monthly"},
    {"name": "Steuererstattung", "direction": "income", "category": "Steuern", "icon": "mdi:cash-refund", "frequency": "once", "certainty": "unsicher"},
    {"name": "Rundfunkbeitrag (GEZ)", "direction": "expense", "category": "Rundfunk", "icon": "mdi:radio-tower", "frequency": "monthly", "interval": 3, "amount": 55.08},
    {"name": "Strom", "direction": "expense", "category": "Strom", "icon": "mdi:flash", "frequency": "monthly"},
    {"name": "Wasser", "direction": "expense", "category": "Wasser", "icon": "mdi:water", "frequency": "monthly"},
    {"name": "Kredit", "direction": "expense", "category": "Kredite", "icon": "mdi:bank", "frequency": "monthly"},
    {"name": "Bausparvertrag", "direction": "expense", "category": "Sparen", "icon": "mdi:home-plus", "frequency": "monthly"},
    {"name": "Kfz-Versicherung Auto", "direction": "expense", "category": "Versicherungen", "icon": "mdi:car", "frequency": "yearly"},
    {"name": "Kfz-Versicherung Motorrad", "direction": "expense", "category": "Versicherungen", "icon": "mdi:motorbike", "frequency": "yearly"},
    {"name": "Kfz-Steuer Auto", "direction": "expense", "category": "Steuern", "icon": "mdi:car-info", "frequency": "yearly"},
    {"name": "Kfz-Steuer Motorrad", "direction": "expense", "category": "Steuern", "icon": "mdi:motorbike", "frequency": "yearly"},
    {"name": "Reiseversicherung", "direction": "expense", "category": "Versicherungen", "icon": "mdi:airplane", "frequency": "yearly"},
    {"name": "Lebensversicherung", "direction": "expense", "category": "Versicherungen", "icon": "mdi:heart-pulse", "frequency": "monthly"},
    {"name": "Berufsunfähigkeitsversicherung", "direction": "expense", "category": "Versicherungen", "icon": "mdi:account-hard-hat", "frequency": "monthly"},
    {"name": "Rechtsschutzversicherung", "direction": "expense", "category": "Versicherungen", "icon": "mdi:scale-balance", "frequency": "yearly"},
    {"name": "Verein", "direction": "expense", "category": "Vereine", "icon": "mdi:account-group", "frequency": "yearly"},
    {"name": "Internet", "direction": "expense", "category": "Internet & Telefon", "icon": "mdi:router-wireless", "frequency": "monthly"},
    {"name": "Handy", "direction": "expense", "category": "Internet & Telefon", "icon": "mdi:cellphone", "frequency": "monthly"},
    {"name": "Netflix", "direction": "expense", "category": "TV & Streaming", "icon": "mdi:netflix", "frequency": "monthly"},
    {"name": "Amazon Prime", "direction": "expense", "category": "TV & Streaming", "icon": "mdi:shopping", "frequency": "yearly"},
    {"name": "Disney+", "direction": "expense", "category": "TV & Streaming", "icon": "mdi:filmstrip", "frequency": "monthly"},
    {"name": "Apple", "direction": "expense", "category": "Abos", "icon": "mdi:apple", "frequency": "monthly"},
    {"name": "Cookidoo", "direction": "expense", "category": "Abos", "icon": "mdi:pot-steam", "frequency": "yearly"},
    {"name": "Friseur", "direction": "expense", "category": "Gesundheit & Pflege", "icon": "mdi:content-cut", "frequency": "rolling", "interval": 1, "unit": "months"},
    {"name": "Kindergarten", "direction": "expense", "category": "Kinder", "icon": "mdi:human-male-child", "frequency": "monthly"},
    {"name": "Lebensmittel", "direction": "expense", "category": "Lebensmittel", "icon": "mdi:cart", "frequency": "budget"},
    {"name": "Tanken", "direction": "expense", "category": "Auto", "icon": "mdi:gas-station", "frequency": "rolling", "interval": 2, "unit": "weeks", "amount_variance_pct": 20},
    {"name": "Räderwechsel", "direction": "expense", "category": "Auto", "icon": "mdi:tire", "frequency": "fixed_dates", "dates": ["04-01", "10-15"], "date_tolerance_days": 14},
]
