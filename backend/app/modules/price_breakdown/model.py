"""Domain model and math for a unit-price breakdown.

Everything here is pure and Decimal-exact so it is trivially testable and can
be driven from a stored assembly, a BoQ position, or an ad-hoc dict.

Markup convention (explicit on purpose, because standards word it differently):

    direct        = sum of all component amounts (per one unit of the position)
    overhead      = direct * overhead_pct / 100
    risk          = (direct + overhead) * risk_pct / 100
    profit        = (direct + overhead + risk) * profit_pct / 100
    unit_rate     = direct + overhead + risk + profit
    position_total = unit_rate * position_quantity

Overhead, risk and profit are applied in that order and each on the running
subtotal, which matches how site overhead, contingency and profit stack in a
detailed rate build-up. All percentages are optional and default to zero, so a
plain material-plus-labour rate works with no markup configured.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum

_2P = Decimal("0.01")
_4P = Decimal("0.0001")


class PriceBreakdownError(ValueError):
    """Raised when a breakdown cannot be assembled or is inconsistent."""


class ResourceKind(StrEnum):
    """Cost categories shared by detailed-rate standards worldwide.

    The string values match the vocabulary the rest of the platform already
    stores (``Component.resource_type`` and the BoQ cost breakdown), so a
    breakdown reads and writes the same tokens: labor, material, machinery,
    equipment, subcontractor, other. Machinery (plant that performs work) is
    kept distinct from equipment (installed or hired), matching the platform's
    methodology; a preset can merge them under one "plant" heading for display.
    """

    LABOUR = "labor"
    MATERIAL = "material"
    MACHINERY = "machinery"
    EQUIPMENT = "equipment"
    SUBCONTRACT = "subcontractor"
    OTHER = "other"


# Accept common synonyms so callers/imports do not have to pre-normalise.
_KIND_ALIASES = {
    "labor": ResourceKind.LABOUR,
    "labour": ResourceKind.LABOUR,
    "wage": ResourceKind.LABOUR,
    "wages": ResourceKind.LABOUR,
    "operator": ResourceKind.LABOUR,
    "lohn": ResourceKind.LABOUR,
    "material": ResourceKind.MATERIAL,
    "materials": ResourceKind.MATERIAL,
    "stoffkosten": ResourceKind.MATERIAL,
    "machinery": ResourceKind.MACHINERY,
    "machine": ResourceKind.MACHINERY,
    "plant": ResourceKind.MACHINERY,
    "equipment": ResourceKind.EQUIPMENT,
    "geraet": ResourceKind.EQUIPMENT,
    "subcontractor": ResourceKind.SUBCONTRACT,
    "subcontract": ResourceKind.SUBCONTRACT,
    "sub": ResourceKind.SUBCONTRACT,
    "nachunternehmer": ResourceKind.SUBCONTRACT,
    "overhead": ResourceKind.OTHER,
    "other": ResourceKind.OTHER,
    "misc": ResourceKind.OTHER,
    "sonstiges": ResourceKind.OTHER,
}


def coerce_kind(value: str | ResourceKind | None) -> ResourceKind:
    """Map a free-text resource type onto a :class:`ResourceKind`."""
    if isinstance(value, ResourceKind):
        return value
    return _KIND_ALIASES.get(str(value or "").strip().lower(), ResourceKind.OTHER)


def _dec(value: object, default: str = "0") -> Decimal:
    if isinstance(value, Decimal):
        return value
    if value is None or value == "":
        return Decimal(default)
    try:
        return Decimal(str(value))
    except (ArithmeticError, ValueError, TypeError):
        return Decimal(default)


@dataclass
class CostComponent:
    """One resource line in the rate build-up, costed per position unit.

    ``amount`` is the contribution to the unit rate (quantity x unit_cost). For
    example, 0.12 t of rebar per m3 of wall at 900/t contributes 108 to the m3
    rate: quantity=0.12, unit_cost=900, amount=108.
    """

    kind: ResourceKind
    description: str
    quantity: Decimal
    unit_cost: Decimal
    unit: str = ""
    amount: Decimal = Decimal("0")

    def normalised(self) -> CostComponent:
        qty = _dec(self.quantity, "1")
        unit_cost = _dec(self.unit_cost)
        amount = _dec(self.amount) if self.amount else qty * unit_cost
        return CostComponent(
            kind=coerce_kind(self.kind),
            description=str(self.description or "").strip() or "-",
            quantity=qty,
            unit_cost=unit_cost,
            unit=str(self.unit or ""),
            amount=amount,
        )


@dataclass
class PriceBreakdown:
    """A costed unit rate broken into resources and markup."""

    position_ref: str
    description: str
    unit: str
    position_quantity: Decimal
    components: list[CostComponent]
    overhead_pct: Decimal = Decimal("0")
    risk_pct: Decimal = Decimal("0")
    profit_pct: Decimal = Decimal("0")
    currency: str = "EUR"

    # ---- derived totals (per one unit unless noted) -------------------------
    @property
    def direct_unit_cost(self) -> Decimal:
        return sum((c.amount for c in self.components), Decimal("0"))

    @property
    def kind_totals(self) -> dict[ResourceKind, Decimal]:
        totals = {k: Decimal("0") for k in ResourceKind}
        for c in self.components:
            totals[c.kind] += c.amount
        return totals

    @property
    def overhead_amount(self) -> Decimal:
        return self.direct_unit_cost * self.overhead_pct / 100

    @property
    def risk_amount(self) -> Decimal:
        return (self.direct_unit_cost + self.overhead_amount) * self.risk_pct / 100

    @property
    def profit_amount(self) -> Decimal:
        base = self.direct_unit_cost + self.overhead_amount + self.risk_amount
        return base * self.profit_pct / 100

    @property
    def unit_rate(self) -> Decimal:
        return self.direct_unit_cost + self.overhead_amount + self.risk_amount + self.profit_amount

    @property
    def position_total(self) -> Decimal:
        return self.unit_rate * self.position_quantity

    def to_dict(self) -> dict:
        """JSON-ready view (money rounded to 2dp, quantities to 4dp)."""
        kt = self.kind_totals
        return {
            "position_ref": self.position_ref,
            "description": self.description,
            "unit": self.unit,
            "currency": self.currency,
            "position_quantity": _q(self.position_quantity, _4P),
            "components": [
                {
                    "kind": c.kind.value,
                    "description": c.description,
                    "unit": c.unit,
                    "quantity": _q(c.quantity, _4P),
                    "unit_cost": _q(c.unit_cost, _2P),
                    "amount": _q(c.amount, _2P),
                }
                for c in self.components
            ],
            "kind_totals": {k.value: _q(v, _2P) for k, v in kt.items()},
            "direct_unit_cost": _q(self.direct_unit_cost, _2P),
            "overhead_pct": _q(self.overhead_pct, _2P),
            "overhead_amount": _q(self.overhead_amount, _2P),
            "risk_pct": _q(self.risk_pct, _2P),
            "risk_amount": _q(self.risk_amount, _2P),
            "profit_pct": _q(self.profit_pct, _2P),
            "profit_amount": _q(self.profit_amount, _2P),
            "unit_rate": _q(self.unit_rate, _2P),
            "position_total": _q(self.position_total, _2P),
        }


def _q(value: Decimal, quant: Decimal) -> str:
    return str(_dec(value).quantize(quant, rounding=ROUND_HALF_UP))


def build_breakdown(
    *,
    position_ref: str,
    description: str,
    unit: str,
    position_quantity: object,
    components: list[dict | CostComponent],
    overhead_pct: object = 0,
    risk_pct: object = 0,
    profit_pct: object = 0,
    currency: str = "EUR",
) -> PriceBreakdown:
    """Assemble a :class:`PriceBreakdown` from plain dicts or components."""
    comps: list[CostComponent] = []
    for raw in components or []:
        if isinstance(raw, CostComponent):
            comps.append(raw.normalised())
            continue
        comps.append(
            CostComponent(
                kind=coerce_kind(raw.get("kind") or raw.get("resource_type")),
                description=raw.get("description") or raw.get("name") or "-",
                quantity=_dec(raw.get("quantity") or raw.get("factor"), "1"),
                unit_cost=_dec(raw.get("unit_cost") or raw.get("unit_rate") or raw.get("price")),
                unit=raw.get("unit") or "",
                amount=_dec(raw.get("amount")) if raw.get("amount") not in (None, "") else Decimal("0"),
            ).normalised()
        )
    if not comps:
        raise PriceBreakdownError("a price breakdown needs at least one cost component")
    return PriceBreakdown(
        position_ref=str(position_ref or "").strip(),
        description=str(description or "").strip(),
        unit=str(unit or ""),
        position_quantity=_dec(position_quantity, "1"),
        components=comps,
        overhead_pct=_dec(overhead_pct),
        risk_pct=_dec(risk_pct),
        profit_pct=_dec(profit_pct),
        currency=str(currency or "EUR").strip() or "EUR",
    )
