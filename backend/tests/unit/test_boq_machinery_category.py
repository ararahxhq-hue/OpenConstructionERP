# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Resource-category normalisation: machinery must stay distinct from equipment.

Regression for the methodology engine. The post-Soviet СМР/SMR cascade splits
construction machinery (which rides inside the SMR works base) from installed
equipment (which carries only some markups) - see
``app.modules.methodology.templates._CASCADE_BASE_MAPPING`` (Uzbekistan /
railway). The BOQ cost breakdown used to fold ``machinery`` into ``equipment``,
which silently zeroed the machinery base and over-stated equipment whenever a
methodology computed from a ``boq_id``. These tests pin the split so that
regression cannot return.
"""

from decimal import Decimal

import pytest

from app.modules.boq.service import BOQService
from app.modules.methodology.bases import resolve_bases
from app.modules.methodology.templates import _CASCADE_BASE_MAPPING, _SMR_COMPOSITE

_norm = BOQService._normalize_resource_category


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # machinery + its synonyms now get their OWN category
        ("machinery", "machinery"),
        ("Machinery", "machinery"),
        ("  MACHINERY  ", "machinery"),
        ("machine", "machinery"),
        ("maschine", "machinery"),  # German
        ("mechanism", "machinery"),
        ("mechanisms", "machinery"),  # ru "механизмы"
        # installed equipment stays equipment - NOT machinery
        ("equipment", "equipment"),
        ("plant", "equipment"),
        ("geraet", "equipment"),
        # the other canonical categories are unchanged
        ("labor", "labor"),
        ("labour", "labor"),
        ("material", "material"),
        ("materials", "material"),
        ("subcontractor", "subcontractor"),
        ("nachunternehmer", "subcontractor"),
        ("anything-else", "other"),
    ],
)
def test_normalize_resource_category(raw: str, expected: str) -> None:
    assert _norm(raw) == expected


def test_machinery_distinct_from_equipment() -> None:
    """The whole point: the two must never collapse into one bucket."""
    assert _norm("machinery") != _norm("equipment")


def test_cascade_base_mapping_sees_machinery_total() -> None:
    """End-to-end intent: a breakdown that now emits a ``machinery`` total feeds
    a non-zero machinery base, an un-inflated equipment base, and a full SMR
    composite under the UZ/railway cascade mapping. Previously machinery was 0
    and equipment absorbed it."""
    # Totals as the fixed breakdown now reports them (machinery separate).
    totals = {
        "labor": Decimal("100"),
        "machinery": Decimal("40"),
        "material": Decimal("200"),
        "equipment": Decimal("75"),
    }
    bases = resolve_bases(_CASCADE_BASE_MAPPING, totals)
    assert bases["machinery"] == Decimal("40")  # not zero
    assert bases["equipment"] == Decimal("75")  # not inflated by machinery
    assert bases["materials"] == Decimal("200")  # token "materials" <- type "material"

    # A composite sums resolved BASE TOKENS (not raw resource types): the cascade
    # engine computes SMR = labor + machinery + materials over ``bases``.
    smr = sum((bases[tok] for tok in _SMR_COMPOSITE["SMR"]), Decimal(0))
    assert smr == Decimal("340")
