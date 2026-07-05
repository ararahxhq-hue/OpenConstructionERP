"""Presentation presets for a price breakdown.

The breakdown model is country-neutral. A preset is only a labelling and
grouping choice for output: which categories to show, in which order, under
which heading. The international preset is the default; the EFB preset lays the
same data out like the German procurement price sheets. Adding a country
convention is one entry in ``PRESETS``.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.modules.price_breakdown.model import PriceBreakdown, ResourceKind

_2P = Decimal("0.01")


@dataclass(frozen=True)
class Preset:
    name: str
    label: str
    region: str
    # Heading shown per resource kind, in display order.
    kind_labels: tuple[tuple[ResourceKind, str], ...]


_INTERNATIONAL = Preset(
    name="international",
    label="Unit price analysis",
    region="international",
    kind_labels=(
        (ResourceKind.LABOUR, "Labour"),
        (ResourceKind.MATERIAL, "Material"),
        (ResourceKind.MACHINERY, "Machinery"),
        (ResourceKind.EQUIPMENT, "Equipment"),
        (ResourceKind.SUBCONTRACT, "Subcontract"),
        (ResourceKind.OTHER, "Other"),
    ),
)

# EFB (Einheitliche Formblaetter, German public procurement handbook). 221 is
# the own-labour sheet, 222 the subcontract sheet, 223 the material list; here
# they are one labelled view of the same categories.
_EFB = Preset(
    name="efb",
    label="EFB price sheets (221/222/223)",
    region="DE",
    kind_labels=(
        (ResourceKind.LABOUR, "Lohnkosten (221)"),
        (ResourceKind.MATERIAL, "Stoffkosten (223)"),
        (ResourceKind.MACHINERY, "Geraetekosten"),
        (ResourceKind.EQUIPMENT, "Vorhaltekosten"),
        (ResourceKind.SUBCONTRACT, "Nachunternehmerleistungen (222)"),
        (ResourceKind.OTHER, "Sonstige Kosten"),
    ),
)

PRESETS: dict[str, Preset] = {p.name: p for p in (_INTERNATIONAL, _EFB)}


def get_preset(name: str | None) -> Preset:
    return PRESETS.get((name or "").strip().lower(), _INTERNATIONAL)


def _q(value: Decimal) -> str:
    return str(Decimal(value).quantize(_2P, rounding=ROUND_HALF_UP))


def efb_221_view(bd: PriceBreakdown) -> dict:
    """Group the components the way an EFB 221-style sheet does: totals per
    resource category plus the markup lines, keyed by category."""
    kt = bd.kind_totals
    preset = _EFB
    rows = [{"kind": kind.value, "label": label, "amount": _q(kt[kind])} for kind, label in preset.kind_labels]
    return {
        "position_ref": bd.position_ref,
        "unit": bd.unit,
        "currency": bd.currency,
        "rows": rows,
        "direct_unit_cost": _q(bd.direct_unit_cost),
        "overhead_amount": _q(bd.overhead_amount),
        "risk_amount": _q(bd.risk_amount),
        "profit_amount": _q(bd.profit_amount),
        "unit_rate": _q(bd.unit_rate),
    }


def render_markdown(bd: PriceBreakdown, *, preset: str = "international") -> str:
    """A compact, readable price-analysis table (works for any language later
    once the labels move to i18n; the numbers are the point)."""
    p = get_preset(preset)
    cur = bd.currency
    lines: list[str] = []
    lines.append(f"# {p.label}: {bd.position_ref} {bd.description}".rstrip())
    lines.append("")
    lines.append(f"Unit: {bd.unit}   Quantity: {bd.position_quantity}   Currency: {cur}")
    lines.append("")
    lines.append("| Resource | Description | Qty | Unit cost | Amount |")
    lines.append("| --- | --- | ---: | ---: | ---: |")
    label_by_kind = dict(p.kind_labels)
    for c in bd.components:
        lines.append(
            f"| {label_by_kind.get(c.kind, c.kind.value)} | {c.description} | "
            f"{c.quantity} | {_q(c.unit_cost)} | {_q(c.amount)} |"
        )
    lines.append("")
    lines.append(f"Direct cost per unit: {_q(bd.direct_unit_cost)} {cur}")
    if bd.overhead_pct:
        lines.append(f"Overhead ({bd.overhead_pct}%): {_q(bd.overhead_amount)} {cur}")
    if bd.risk_pct:
        lines.append(f"Risk ({bd.risk_pct}%): {_q(bd.risk_amount)} {cur}")
    if bd.profit_pct:
        lines.append(f"Profit ({bd.profit_pct}%): {_q(bd.profit_amount)} {cur}")
    lines.append(f"Unit rate: {_q(bd.unit_rate)} {cur}")
    lines.append(f"Position total: {_q(bd.position_total)} {cur}")
    return "\n".join(lines)
