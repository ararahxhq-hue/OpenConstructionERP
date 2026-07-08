"""Price-index business logic.

Thin orchestration over the three tables plus the pure Decimal core in
:mod:`app.modules.price_index.index_math`. Data access is inlined on the
session (the module has no separate repository layer). All numeric work is
delegated to the pure functions so this layer stays free of rounding logic.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.price_index import index_math
from app.modules.price_index.models import (
    CostIndexPoint,
    CostIndexSeries,
    LocationFactor,
)
from app.modules.price_index.schemas import (
    AdjustLine,
    AdjustLineResult,
    AdjustRequest,
    AdjustResponse,
    CostIndexPointCreate,
    CostIndexPointUpdate,
    CostIndexSeriesCreate,
    CostIndexSeriesUpdate,
    LocationFactorCreate,
    LocationFactorUpdate,
)


class SeriesNotFoundError(LookupError):
    """Raised when a referenced cost-index series does not exist."""


class PriceIndexService:
    """Orchestrates series/point/location-factor CRUD and batch adjustment."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Series ───────────────────────────────────────────────────────────

    async def list_series(self) -> list[tuple[CostIndexSeries, int]]:
        """Return every series paired with its point count, ordered by name."""
        count_col = func.count(CostIndexPoint.id)
        stmt = (
            select(CostIndexSeries, count_col)
            .outerjoin(CostIndexPoint, CostIndexPoint.series_id == CostIndexSeries.id)
            .group_by(CostIndexSeries.id)
            .order_by(CostIndexSeries.name)
        )
        rows = await self.session.execute(stmt)
        return [(series, int(count or 0)) for series, count in rows.all()]

    async def get_series(self, series_id: uuid.UUID) -> CostIndexSeries | None:
        return await self.session.get(CostIndexSeries, series_id)

    async def create_series(self, data: CostIndexSeriesCreate) -> CostIndexSeries:
        obj = CostIndexSeries(name=data.name, description=data.description)
        self.session.add(obj)
        await self.session.flush()
        return obj

    async def update_series(
        self,
        series_id: uuid.UUID,
        data: CostIndexSeriesUpdate,
    ) -> CostIndexSeries | None:
        obj = await self.get_series(series_id)
        if obj is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(obj, key, value)
        await self.session.flush()
        return obj

    async def delete_series(self, series_id: uuid.UUID) -> bool:
        obj = await self.get_series(series_id)
        if obj is None:
            return False
        await self.session.delete(obj)
        await self.session.flush()
        return True

    async def point_count(self, series_id: uuid.UUID) -> int:
        stmt = select(func.count(CostIndexPoint.id)).where(CostIndexPoint.series_id == series_id)
        return int((await self.session.execute(stmt)).scalar_one())

    # ── Points ───────────────────────────────────────────────────────────

    async def add_point(
        self,
        series_id: uuid.UUID,
        data: CostIndexPointCreate,
    ) -> CostIndexPoint:
        obj = CostIndexPoint(series_id=series_id, period=data.period, factor=data.factor)
        self.session.add(obj)
        await self.session.flush()
        return obj

    async def get_point(self, point_id: uuid.UUID) -> CostIndexPoint | None:
        return await self.session.get(CostIndexPoint, point_id)

    async def update_point(
        self,
        point_id: uuid.UUID,
        data: CostIndexPointUpdate,
    ) -> CostIndexPoint | None:
        obj = await self.get_point(point_id)
        if obj is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(obj, key, value)
        await self.session.flush()
        return obj

    async def delete_point(self, point_id: uuid.UUID) -> bool:
        obj = await self.get_point(point_id)
        if obj is None:
            return False
        await self.session.delete(obj)
        await self.session.flush()
        return True

    # ── Location factors ─────────────────────────────────────────────────

    async def list_location_factors(self) -> list[LocationFactor]:
        stmt = select(LocationFactor).order_by(LocationFactor.region_code)
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_location_factor(self, factor_id: uuid.UUID) -> LocationFactor | None:
        return await self.session.get(LocationFactor, factor_id)

    async def create_location_factor(self, data: LocationFactorCreate) -> LocationFactor:
        obj = LocationFactor(
            region_code=data.region_code,
            label=data.label,
            factor=data.factor,
        )
        self.session.add(obj)
        await self.session.flush()
        return obj

    async def update_location_factor(
        self,
        factor_id: uuid.UUID,
        data: LocationFactorUpdate,
    ) -> LocationFactor | None:
        obj = await self.get_location_factor(factor_id)
        if obj is None:
            return None
        for key, value in data.model_dump(exclude_unset=True).items():
            if value is not None:
                setattr(obj, key, value)
        await self.session.flush()
        return obj

    async def delete_location_factor(self, factor_id: uuid.UUID) -> bool:
        obj = await self.get_location_factor(factor_id)
        if obj is None:
            return False
        await self.session.delete(obj)
        await self.session.flush()
        return True

    # ── Adjustment ───────────────────────────────────────────────────────

    async def adjust(self, request: AdjustRequest) -> AdjustResponse:
        """Bring a batch of amounts to the target period and region.

        The chosen series' points and every stored regional factor are loaded
        once, then each line is resolved with the pure Decimal core. A line
        whose period is absent from the series is reported with an ``error``
        and null figures rather than failing the whole batch.

        Args:
            request: The series to escalate against and the lines to adjust.

        Returns:
            The per-line results paired with the series name.

        Raises:
            SeriesNotFoundError: If ``request.series_id`` does not exist.
        """
        series = await self.get_series(request.series_id)
        if series is None:
            raise SeriesNotFoundError(str(request.series_id))

        points = {p.period: p.factor for p in series.points}
        regions: dict[str, Decimal] = {lf.region_code: lf.factor for lf in await self.list_location_factors()}

        results = [self._adjust_line(line, points, regions) for line in request.lines]
        return AdjustResponse(series_id=series.id, series_name=series.name, results=results)

    @staticmethod
    def _adjust_line(
        line: AdjustLine,
        points: dict[str, Decimal],
        regions: dict[str, Decimal],
    ) -> AdjustLineResult:
        """Resolve one line's factors and adjusted amount (pure, no I/O)."""
        base = AdjustLineResult(
            amount=line.amount,
            base_period=line.base_period,
            target_period=line.target_period,
            base_region=line.base_region,
            target_region=line.target_region,
        )
        try:
            temporal = index_math.resolve_factor(points, line.base_period, line.target_period)
        except index_math.PeriodNotFoundError as exc:
            base.error = str(exc)
            return base

        location = index_math.location_multiplier(regions, line.base_region, line.target_region)
        applied = index_math.combined_factor(temporal, location)
        adjusted = index_math.adjust(line.amount, temporal, location)

        base.temporal_factor = temporal
        base.location_factor = location
        base.applied_factor = applied
        base.adjusted_amount = adjusted
        base.note = _region_note(line, regions)
        return base


def _region_note(line: AdjustLine, regions: dict[str, Decimal]) -> str | None:
    """Flag any named region that has no stored factor (treated as 1)."""
    missing = [
        region
        for region in (line.base_region, line.target_region)
        if region and region.strip() and region.strip() not in regions
    ]
    if not missing:
        return None
    joined = ", ".join(sorted(set(missing)))
    return f"no stored factor for region(s) {joined}; assumed 1"
