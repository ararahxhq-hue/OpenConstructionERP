"""Metric -> imperial conversion helper - GitHub #270.

``app.core.unit_conversion`` is the backend twin of the frontend
``unitConversion.ts``; printed reports (BOQ PDF) convert physical quantities
to imperial through it when the user asks, while money and data-interchange
exports stay canonical metric.

These tests pin:

* the conversion factors match the frontend table (m/m2/m3/kg/km/cm/mm/t/lm)
* the superscript area / volume variants ("m²" / "m³") convert and relabel
* unmapped units (pcs, %, lump, hr) pass through unchanged in both systems
* metric (the default) returns the value unchanged and only tidies the label
* the value math is done in Decimal so a Decimal quantity keeps its precision
* ``display_unit_for`` resolves labels without a value
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.core.unit_conversion import ConversionResult, convert, display_unit_for

# ── Imperial conversion factors (mirror unitConversion.ts) ────────────────


@pytest.mark.parametrize(
    ("metric_unit", "factor", "display_unit"),
    [
        ("m", "3.2808399", "ft"),
        ("m2", "10.7639", "sq ft"),
        ("m3", "35.3147", "cu ft"),
        ("kg", "2.20462", "lb"),
        ("km", "0.621371", "mi"),
        ("cm", "0.393701", "in"),
        ("mm", "0.0393701", "in"),
        ("t", "1.10231", "ton"),
        ("lm", "3.28084", "l.ft"),
    ],
)
def test_imperial_factors_match_frontend(metric_unit: str, factor: str, display_unit: str) -> None:
    """Each metric unit scales by the documented factor and relabels for imperial."""
    result = convert(Decimal("10"), metric_unit, "imperial")
    assert result.value == Decimal("10") * Decimal(factor)
    assert result.display_unit == display_unit


def test_superscript_area_and_volume_variants_convert() -> None:
    """The takeoff-style "m²" / "m³" codes convert and relabel to "ft²" / "ft³"."""
    area = convert(Decimal("10"), "m²", "imperial")
    assert area.value == Decimal("10") * Decimal("10.7639")
    assert area.display_unit == "ft²"

    volume = convert(Decimal("10"), "m³", "imperial")
    assert volume.value == Decimal("10") * Decimal("35.3147")
    assert volume.display_unit == "ft³"


# ── Passthrough for unmapped units ────────────────────────────────────────


@pytest.mark.parametrize("unmapped", ["pcs", "%", "lump", "hr", "ea", "lsum"])
def test_unmapped_units_pass_through_unchanged(unmapped: str) -> None:
    """Countable / lump / dimensionless units never convert, in either system."""
    metric = convert(Decimal("7.5"), unmapped, "metric")
    assert metric == ConversionResult(Decimal("7.5"), unmapped)

    imperial = convert(Decimal("7.5"), unmapped, "imperial")
    assert imperial == ConversionResult(Decimal("7.5"), unmapped)


def test_none_and_empty_unit_pass_through() -> None:
    """A missing unit is treated as unmapped: value unchanged, empty label."""
    assert convert(Decimal("3"), None, "imperial") == ConversionResult(Decimal("3"), "")
    assert convert(Decimal("3"), "", "imperial") == ConversionResult(Decimal("3"), "")


# ── Metric (default) behaviour ────────────────────────────────────────────


def test_metric_default_keeps_value_and_tidies_label() -> None:
    """The default system returns the value unchanged and only tidies the label."""
    # Default argument is metric.
    result = convert(Decimal("123.45"), "m2")
    assert result.value == Decimal("123.45")
    assert result.display_unit == "m²"


def test_metric_passes_value_through_bit_for_bit() -> None:
    """Metric mode must not perturb the numeric value at all."""
    value = Decimal("999999999.9999")
    result = convert(value, "m", "metric")
    assert result.value == value
    assert result.display_unit == "m"


# ── Precision: math stays in Decimal ──────────────────────────────────────


def test_conversion_uses_decimal_math_no_float_drift() -> None:
    """A Decimal quantity stays a Decimal and avoids binary-float error."""
    result = convert(Decimal("0.1"), "m", "imperial")
    assert isinstance(result.value, Decimal)
    # Decimal("0.1") * Decimal("3.2808399") is exact; the float product
    # 0.1 * 3.2808399 would be 0.32808399000000003.
    assert result.value == Decimal("0.1") * Decimal("3.2808399")
    assert result.value != Decimal(str(0.1 * 3.2808399))


def test_string_and_float_inputs_are_coerced() -> None:
    """Non-Decimal numeric inputs are accepted and coerced (float / str)."""
    from_float = convert(10.0, "kg", "imperial")
    assert from_float.value == Decimal("10") * Decimal("2.20462")

    from_str = convert("10", "kg", "imperial")
    assert from_str.value == Decimal("10") * Decimal("2.20462")


def test_non_finite_value_collapses_to_zero() -> None:
    """A NaN / Inf quantity collapses to 0 rather than propagating."""
    assert convert(Decimal("NaN"), "m", "imperial").value == Decimal(0)
    assert convert("not-a-number", "m", "imperial").value == Decimal(0)


# ── display_unit_for (label only, no value) ───────────────────────────────


def test_display_unit_for_metric_and_imperial() -> None:
    """The label-only helper resolves the same labels as ``convert``."""
    assert display_unit_for("m2", "metric") == "m²"
    assert display_unit_for("m2", "imperial") == "sq ft"
    assert display_unit_for("m³", "imperial") == "ft³"
    # Default is metric.
    assert display_unit_for("kg") == "kg"
    # Unmapped passes through.
    assert display_unit_for("pcs", "imperial") == "pcs"


def test_case_insensitive_unit_lookup() -> None:
    """Unit lookup tolerates surrounding whitespace and upper-case spelling."""
    assert convert(Decimal("1"), "  M2 ", "imperial").display_unit == "sq ft"
    assert display_unit_for("KG", "imperial") == "lb"
