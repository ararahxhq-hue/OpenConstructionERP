"""Production-norm business logic.

Owns the norm library CRUD and the expansion orchestration: it resolves a
``work_key`` to a stored norm, turns the ORM row into the pure
:class:`app.modules.norm_expansion.expand_math.NormCoefficients` value object,
and runs the deterministic Decimal expansion. Keeping the math in a separate
pure module means the DB layer here stays thin and the arithmetic stays
unit-testable without a database.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.norm_expansion.expand_math import (
    ExpansionResult,
    MaterialCoefficient,
    NormCoefficients,
    expand,
)
from app.modules.norm_expansion.models import NormMaterial, ProductionNorm
from app.modules.norm_expansion.schemas import (
    NormCreate,
    NormMaterialCreate,
    NormUpdate,
)


class WorkKeyExistsError(ValueError):
    """Raised when creating / renaming a norm to a ``work_key`` already in use."""

    def __init__(self, work_key: str) -> None:
        self.work_key = work_key
        super().__init__(f"work_key already exists: {work_key}")


def norm_to_coefficients(norm: ProductionNorm) -> NormCoefficients:
    """Build the pure coefficient value object from an ORM norm row.

    The ORM ``materials`` collection is eager-loaded (``selectin``), so reading
    it here never triggers a lazy load outside the async greenlet.

    Args:
        norm: A loaded :class:`ProductionNorm` with its materials.

    Returns:
        The equivalent :class:`NormCoefficients`.
    """
    return NormCoefficients(
        labor_hours_per_unit=norm.labor_hours_per_unit,
        machine_hours_per_unit=norm.machine_hours_per_unit,
        materials=tuple(
            MaterialCoefficient(name=m.name, unit=m.unit, qty_per_unit=m.qty_per_unit) for m in norm.materials
        ),
    )


class NormExpansionService:
    """Thin orchestration layer over the production-norm tables."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Reads ──────────────────────────────────────────────────────────────

    async def list_norms(
        self,
        *,
        q: str | None = None,
        category: str | None = None,
        active_only: bool = False,
        offset: int = 0,
        limit: int = 100,
    ) -> list[ProductionNorm]:
        """List norms, newest first, with optional text / category filters."""
        stmt = select(ProductionNorm)
        if q:
            like = f"%{q.strip().lower()}%"
            stmt = stmt.where(
                func.lower(ProductionNorm.work_key).like(like) | func.lower(ProductionNorm.name).like(like)
            )
        if category:
            stmt = stmt.where(ProductionNorm.category == category)
        if active_only:
            stmt = stmt.where(ProductionNorm.is_active.is_(True))
        stmt = stmt.order_by(ProductionNorm.created_at.desc()).offset(offset).limit(limit)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_norm(self, norm_id: uuid.UUID) -> ProductionNorm | None:
        """Load a single norm (with materials) by primary key."""
        result = await self.session.execute(select(ProductionNorm).where(ProductionNorm.id == norm_id))
        return result.scalar_one_or_none()

    async def get_by_work_key(self, work_key: str) -> ProductionNorm | None:
        """Load a single norm (with materials) by its unique ``work_key``."""
        result = await self.session.execute(select(ProductionNorm).where(ProductionNorm.work_key == work_key.strip()))
        return result.scalar_one_or_none()

    # ── Writes ─────────────────────────────────────────────────────────────

    async def create_norm(self, data: NormCreate) -> ProductionNorm:
        """Create a norm with its inline material coefficients.

        Raises:
            WorkKeyExistsError: If a norm with the same ``work_key`` exists.
        """
        if await self.get_by_work_key(data.work_key) is not None:
            raise WorkKeyExistsError(data.work_key)
        norm = ProductionNorm(
            work_key=data.work_key,
            name=data.name,
            unit=data.unit,
            category=data.category,
            labor_hours_per_unit=data.labor_hours_per_unit,
            machine_hours_per_unit=data.machine_hours_per_unit,
            notes=data.notes,
            is_active=data.is_active,
        )
        for index, mat in enumerate(data.materials):
            norm.materials.append(_build_material(mat, fallback_order=index))
        self.session.add(norm)
        await self.session.flush()
        return norm

    async def update_norm(self, norm_id: uuid.UUID, data: NormUpdate) -> ProductionNorm | None:
        """Patch a norm's scalar fields in place.

        Raises:
            WorkKeyExistsError: If ``work_key`` is changed to one already taken
                by a different norm.
        """
        norm = await self.get_norm(norm_id)
        if norm is None:
            return None
        fields: dict[str, Any] = data.model_dump(exclude_unset=True)
        new_key = fields.get("work_key")
        if new_key is not None and new_key != norm.work_key:
            clash = await self.get_by_work_key(new_key)
            if clash is not None and clash.id != norm.id:
                raise WorkKeyExistsError(new_key)
        for key, value in fields.items():
            setattr(norm, key, value)
        await self.session.flush()
        return norm

    async def delete_norm(self, norm_id: uuid.UUID) -> bool:
        """Delete a norm and its materials. Returns True if a row was removed."""
        norm = await self.get_norm(norm_id)
        if norm is None:
            return False
        await self.session.delete(norm)
        await self.session.flush()
        return True

    async def add_material(
        self,
        norm: ProductionNorm,
        data: NormMaterialCreate,
    ) -> NormMaterial:
        """Attach one material coefficient to an existing norm."""
        next_order = data.sort_order or (max((m.sort_order for m in norm.materials), default=-1) + 1)
        material = NormMaterial(
            norm_id=norm.id,
            name=data.name,
            unit=data.unit,
            qty_per_unit=data.qty_per_unit,
            sort_order=next_order,
        )
        self.session.add(material)
        await self.session.flush()
        return material

    async def get_material(self, material_id: uuid.UUID) -> NormMaterial | None:
        """Load a single material coefficient by primary key."""
        result = await self.session.execute(select(NormMaterial).where(NormMaterial.id == material_id))
        return result.scalar_one_or_none()

    async def delete_material(self, material_id: uuid.UUID) -> bool:
        """Delete one material coefficient. Returns True if a row was removed."""
        material = await self.get_material(material_id)
        if material is None:
            return False
        await self.session.delete(material)
        await self.session.flush()
        return True

    # ── Expansion ──────────────────────────────────────────────────────────

    async def expand_work_key(
        self,
        work_key: str,
        quantity: Decimal,
    ) -> tuple[ProductionNorm, ExpansionResult] | None:
        """Resolve ``work_key`` and expand ``quantity`` into resource demand.

        Returns ``None`` when no norm matches the key so the caller can map it
        to a 404 (single) or an ``unmatched`` entry (batch).
        """
        norm = await self.get_by_work_key(work_key)
        if norm is None:
            return None
        result = expand(norm_to_coefficients(norm), quantity)
        return norm, result


def _build_material(data: NormMaterialCreate, *, fallback_order: int) -> NormMaterial:
    """Construct a NormMaterial from a create payload, defaulting sort order."""
    return NormMaterial(
        name=data.name,
        unit=data.unit,
        qty_per_unit=data.qty_per_unit,
        sort_order=data.sort_order or fallback_order,
    )
