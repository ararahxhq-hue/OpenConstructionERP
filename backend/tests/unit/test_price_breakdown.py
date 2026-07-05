"""Unit tests for the price-breakdown library (pure, DB-free)."""

from decimal import Decimal

import pytest

from app.modules.price_breakdown import (
    PriceBreakdownError,
    ResourceKind,
    build_breakdown,
    coerce_kind,
    efb_221_view,
    from_position,
    get_preset,
    render_markdown,
)


def _sample():
    # A reinforced-concrete wall, per m3, priced from resources.
    return build_breakdown(
        position_ref="01.02.003",
        description="Reinforced concrete wall C30/37",
        unit="m3",
        position_quantity=Decimal("50"),
        components=[
            {"kind": "material", "description": "Concrete C30/37", "unit": "m3", "quantity": "1.02", "unit_cost": "95"},
            {"kind": "material", "description": "Rebar", "unit": "t", "quantity": "0.12", "unit_cost": "900"},
            {"kind": "labor", "description": "Steelfixer + mason", "unit": "h", "quantity": "3.5", "unit_cost": "42"},
            {"kind": "machinery", "description": "Concrete pump", "unit": "h", "quantity": "0.3", "unit_cost": "80"},
        ],
        overhead_pct="8",
        profit_pct="5",
        currency="EUR",
    )


def test_direct_cost_and_kind_totals():
    bd = _sample()
    # 96.90 concrete + 108 rebar + 147 labour + 24 machinery
    assert bd.direct_unit_cost == Decimal("375.90")
    kt = bd.kind_totals
    assert kt[ResourceKind.MATERIAL] == Decimal("204.90")
    assert kt[ResourceKind.LABOUR] == Decimal("147.00")
    assert kt[ResourceKind.MACHINERY] == Decimal("24.00")
    assert kt[ResourceKind.SUBCONTRACT] == Decimal("0")


def test_markup_stacks_in_order():
    bd = _sample()
    direct = Decimal("375.90")
    overhead = direct * Decimal("8") / 100
    risk = Decimal("0")
    profit = (direct + overhead + risk) * Decimal("5") / 100
    assert bd.overhead_amount == overhead
    assert bd.profit_amount == profit
    assert bd.unit_rate == direct + overhead + profit
    # Position total = unit rate * quantity.
    assert bd.position_total == bd.unit_rate * Decimal("50")


def test_to_dict_rounds_and_reconciles():
    d = _sample().to_dict()
    assert d["direct_unit_cost"] == "375.90"
    assert d["currency"] == "EUR"
    # kind_totals covers every category.
    assert set(d["kind_totals"]) == {k.value for k in ResourceKind}
    # unit_rate 2dp string.
    assert d["unit_rate"] == "426.27"


def test_component_amount_from_quantity_when_not_given():
    bd = build_breakdown(
        position_ref="1",
        description="x",
        unit="m2",
        position_quantity="10",
        components=[{"kind": "material", "description": "paint", "quantity": "0.25", "unit_cost": "12"}],
    )
    assert bd.components[0].amount == Decimal("3.00")
    assert bd.unit_rate == Decimal("3.00")  # no markup


def test_empty_components_raise():
    with pytest.raises(PriceBreakdownError):
        build_breakdown(position_ref="1", description="x", unit="m", position_quantity="1", components=[])


def test_coerce_kind_aliases():
    assert coerce_kind("Labour") is ResourceKind.LABOUR
    assert coerce_kind("operator") is ResourceKind.LABOUR
    assert coerce_kind("plant") is ResourceKind.MACHINERY
    assert coerce_kind("equipment") is ResourceKind.EQUIPMENT
    assert coerce_kind("subcontractor") is ResourceKind.SUBCONTRACT
    assert coerce_kind("overhead") is ResourceKind.OTHER
    assert coerce_kind("something weird") is ResourceKind.OTHER


def test_from_position_reads_metadata_resources():
    # Resource totals are for the whole position (quantity 20).
    position = {
        "ordinal": "02.01.001",
        "description": "Blockwork wall",
        "unit": "m2",
        "quantity": "20",
        "unit_rate": "60",
        "metadata_": {
            "resources": [
                {
                    "type": "material",
                    "name": "Blocks",
                    "unit": "m2",
                    "quantity": "21",
                    "unit_rate": "30",
                    "total": "630",
                },
                {"type": "labor", "name": "Mason", "unit": "h", "quantity": "10", "unit_rate": "42", "total": "420"},
            ]
        },
    }
    bd = from_position(position, overhead_pct="10", profit_pct="6")
    # Per-unit direct = (630 + 420) / 20 = 52.50
    assert bd.direct_unit_cost == Decimal("52.50")
    assert bd.position_quantity == Decimal("20")
    # Overhead then profit.
    assert bd.overhead_amount == Decimal("52.50") * Decimal("10") / 100
    assert bd.currency == "EUR"


def test_from_position_derives_markup_from_boq_markups():
    position = {
        "ordinal": "1",
        "unit": "m",
        "quantity": "1",
        "unit_rate": "100",
        "metadata_": {
            "resources": [{"type": "material", "name": "pipe", "total": "100", "quantity": "1", "unit_rate": "100"}]
        },
    }
    markups = [
        {"category": "overhead", "markup_type": "percentage", "percentage": "12"},
        {"category": "profit", "markup_type": "percentage", "percentage": "8"},
        {"category": "tax", "markup_type": "percentage", "percentage": "19"},  # ignored
    ]
    bd = from_position(position, markups=markups)
    assert bd.overhead_pct == Decimal("12")
    assert bd.profit_pct == Decimal("8")


def test_from_position_without_resources_falls_back_to_unit_rate():
    position = {"ordinal": "9", "unit": "pcs", "quantity": "3", "unit_rate": "250", "metadata_": {}}
    bd = from_position(position)
    assert bd.direct_unit_cost == Decimal("250")
    assert bd.components[0].kind is ResourceKind.OTHER
    assert bd.position_total == Decimal("750")


def test_efb_view_and_markdown_render():
    bd = _sample()
    efb = efb_221_view(bd)
    labels = {row["label"] for row in efb["rows"]}
    assert any("221" in lbl for lbl in labels)  # Lohnkosten (221)
    assert efb["unit_rate"] == "426.27"

    md = render_markdown(bd, preset="efb")
    assert "EFB price sheets" in md
    assert "Position total:" in md
    # International preset labels differ.
    assert get_preset("international").label == "Unit price analysis"
    assert "Labour" in render_markdown(bd, preset="international")
