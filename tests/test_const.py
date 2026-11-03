"""The German and English templates stay valid and consistent."""
from custom_components.haushaltsbuch.const import (
    DEFAULT_CATEGORIES,
    DEFAULT_CATEGORIES_EN,
    TEMPLATES,
    TEMPLATES_EN,
)

FREQUENCIES = {"once", "weekly", "monthly", "yearly", "fixed_dates", "rolling", "budget"}


def test_templates_are_valid():
    for templates in (TEMPLATES, TEMPLATES_EN):
        for t in templates:
            assert t["name"] and t["category"] and t["icon"].startswith("mdi:")
            assert t["direction"] in ("income", "expense")
            assert t["frequency"] in FREQUENCIES
            assert t.get("certainty") in (None, "sicher", "wahrscheinlich", "unsicher")


def test_english_template_categories_are_suggested():
    assert {t["category"] for t in TEMPLATES_EN} <= set(DEFAULT_CATEGORIES_EN)
    assert len(set(DEFAULT_CATEGORIES_EN)) == len(DEFAULT_CATEGORIES_EN)
    assert len(set(DEFAULT_CATEGORIES)) == len(DEFAULT_CATEGORIES)
