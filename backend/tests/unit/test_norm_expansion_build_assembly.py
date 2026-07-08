# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""Service tests for building a priced assembly from a production norm.

These drive :func:`app.modules.norm_expansion.service.build_assembly_from_norm`
end to end against a real (transaction-isolated) PostgreSQL session, seeding a
production norm, a labour-rate template and matching cost items, then asserting
the persisted assembly carries the built-up unit rate, the correct priced /
unpriced components, and the project / template wiring.

They use the shared ``oe_test_unit`` database via ``tests._pg`` (rolled back on
teardown), the same fixture style the assemblies module tests use - no new test
harness is introduced.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.labor_rates.models import LaborRateTemplate, OnCostComponent
from app.modules.norm_expansion.models import NormMaterial, ProductionNorm
from app.modules.norm_expansion.service import NormNotFoundError, build_assembly_from_norm
from tests._pg import transactional_session

D = Decimal


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


async def _seed_plastering_norm(s) -> ProductionNorm:
    """A norm: 0.45 labour-h, 0.02 machine-h, 12 kg gypsum + 6 l water per m2."""
    norm = ProductionNorm(
        work_key=f"plastering_{uuid.uuid4().hex[:6]}",
        name="Internal plastering",
        unit="m2",
        category="finishing",
        labor_hours_per_unit=D("0.45"),
        machine_hours_per_unit=D("0.02"),
        is_active=True,
    )
    norm.materials.append(NormMaterial(name="Gypsum plaster", unit="kg", qty_per_unit=D("12.0"), sort_order=0))
    norm.materials.append(NormMaterial(name="Water", unit="l", qty_per_unit=D("6.0"), sort_order=1))
    s.add(norm)
    await s.flush()
    return norm


async def _seed_labor_template(s) -> LaborRateTemplate:
    """A template that builds up to a 36.00/h all-in rate (30 base + 20%)."""
    template = LaborRateTemplate(name="Plasterer", base_wage=D("30"), currency="EUR")
    template.components.append(
        OnCostComponent(label="Statutory charges", kind="percentage", value=D("20"), sort_order=0)
    )
    s.add(template)
    await s.flush()
    return template


async def _seed_cost_item(s, *, code: str, description: str, unit: str, rate: str, currency: str = "EUR"):
    from app.modules.costs.models import CostItem

    item = CostItem(
        code=code,
        description=description,
        unit=unit,
        rate=rate,
        currency=currency,
        source="custom",
        is_active=True,
    )
    s.add(item)
    await s.flush()
    return item


@pytest.mark.asyncio
async def test_build_prices_labour_and_materials_and_persists(session):
    norm = await _seed_plastering_norm(session)
    template = await _seed_labor_template(session)
    gypsum = await _seed_cost_item(
        session, code=f"G-{uuid.uuid4().hex[:6]}", description="Gypsum plaster 25 kg bag", unit="kg", rate="0.50"
    )
    await _seed_cost_item(session, code=f"W-{uuid.uuid4().hex[:6]}", description="Water potable", unit="l", rate="0.01")

    assembly = await build_assembly_from_norm(
        session,
        norm.id,
        labor_rate_template_id=template.id,
    )

    assert assembly.is_template is False
    assert assembly.unit == "m2"
    assert assembly.currency == "EUR"
    assert assembly.code.startswith("NORM-")
    assert assembly.metadata_["source"] == "production_norm"
    assert assembly.metadata_["work_key"] == norm.work_key

    # labour 0.45*36 = 16.20; machine unpriced = 0; gypsum 12*0.50 = 6.00;
    # water 6*0.01 = 0.06 -> built-up unit rate 22.26.
    assert D(str(assembly.total_rate)) == D("22.26")

    by_type = {c.resource_type: c for c in assembly.components}
    assert len(assembly.components) == 4
    assert by_type["labor"].metadata_["priced"] is True
    assert D(str(by_type["labor"].unit_cost)) == D("36.0000")
    assert D(str(by_type["labor"].total)) == D("16.20")

    # No machine-rate template was given: the machine line is present but
    # unpriced and flagged, and contributes zero to the total.
    assert by_type["equipment"].metadata_["priced"] is False
    assert D(str(by_type["equipment"].unit_cost)) == D("0")
    assert "Machine / equipment" in assembly.metadata_["unpriced"]

    # Materials are linked back to the matched cost items.
    gypsum_comp = next(c for c in assembly.components if c.description == "Gypsum plaster")
    assert gypsum_comp.cost_item_id == gypsum.id
    assert gypsum_comp.metadata_["priced"] is True
    assert D(str(gypsum_comp.total)) == D("6.00")


@pytest.mark.asyncio
async def test_unmatched_material_is_unpriced_and_flagged(session):
    norm = await _seed_plastering_norm(session)
    template = await _seed_labor_template(session)
    # Only gypsum is in the catalogue; water has no matching cost item.
    await _seed_cost_item(
        session, code=f"G-{uuid.uuid4().hex[:6]}", description="Gypsum plaster 25 kg bag", unit="kg", rate="0.50"
    )

    assembly = await build_assembly_from_norm(session, norm.id, labor_rate_template_id=template.id)

    water = next(c for c in assembly.components if c.description == "Water")
    assert water.metadata_["priced"] is False
    assert D(str(water.unit_cost)) == D("0")
    assert water.cost_item_id is None
    assert "Water" in assembly.metadata_["unpriced"]
    # labour 16.20 + machine 0 + gypsum 6.00 + water 0 = 22.20.
    assert D(str(assembly.total_rate)) == D("22.20")


@pytest.mark.asyncio
async def test_missing_labour_template_leaves_labour_unpriced(session):
    norm = await _seed_plastering_norm(session)
    await _seed_cost_item(
        session, code=f"G-{uuid.uuid4().hex[:6]}", description="Gypsum plaster 25 kg bag", unit="kg", rate="0.50"
    )
    await _seed_cost_item(session, code=f"W-{uuid.uuid4().hex[:6]}", description="Water potable", unit="l", rate="0.01")

    assembly = await build_assembly_from_norm(session, norm.id, labor_rate_template_id=None)

    labour = next(c for c in assembly.components if c.resource_type == "labor")
    assert labour.metadata_["priced"] is False
    assert D(str(labour.unit_cost)) == D("0")
    assert "Labour" in assembly.metadata_["unpriced"]
    # Only the materials are priced: gypsum 6.00 + water 0.06 = 6.06.
    assert D(str(assembly.total_rate)) == D("6.06")


@pytest.mark.asyncio
async def test_project_scoping_sets_project_and_owner(session):
    from app.modules.projects.models import Project
    from app.modules.users.models import User

    owner_id = uuid.uuid4()
    project_id = uuid.uuid4()
    session.add(User(id=owner_id, email=f"o-{uuid.uuid4().hex[:6]}@test.io", hashed_password="x", full_name="O"))
    await session.flush()
    session.add(Project(id=project_id, name="Norm Build", owner_id=owner_id, currency="EUR"))
    await session.flush()

    norm = await _seed_plastering_norm(session)
    template = await _seed_labor_template(session)

    assembly = await build_assembly_from_norm(
        session,
        norm.id,
        labor_rate_template_id=template.id,
        project_id=project_id,
        owner_id=str(owner_id),
    )

    assert assembly.project_id == project_id
    assert assembly.owner_id == owner_id
    assert assembly.is_template is False


@pytest.mark.asyncio
async def test_missing_norm_raises_not_found(session):
    with pytest.raises(NormNotFoundError):
        await build_assembly_from_norm(session, uuid.uuid4())
