# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""Cost Explorer data access layer.

Pure data access over three tables, no business logic:
    oe_cost_item_resource  - the resource -> work reverse index (this module)
    oe_costs_item          - priced work items (the costs module)
    oe_catalog_resource    - the resource price book (the catalog module)

The reverse index is the backbone: it turns "which priced works consume
resource X" from a full JSON scan of every cost item into a plain indexed
lookup. Everything else reads the cost and catalog tables the module depends on.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Sequence

from sqlalchemy import delete, distinct, func, insert, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.catalog.models import CatalogResource
from app.modules.cost_explorer.models import CostItemResource
from app.modules.costs.models import CostItem


def _escape_like(term: str) -> str:
    r"""Escape LIKE/ILIKE wildcards so a literal ``%`` / ``_`` stays literal.

    Mirrors the catalog repository: without this, ``q='%'`` matches every row.
    Pair the result with ``.ilike(pattern, escape="\\")``.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CostExplorerRepository:
    """Data access for the reverse index and the cost / catalog reads."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Reindex source + bookkeeping ─────────────────────────────────────────

    async def count_cost_items(self) -> int:
        """Total priced work items available to index."""
        return int((await self.session.execute(select(func.count()).select_from(CostItem))).scalar_one())

    async def count_edges(self) -> int:
        """Total reverse-index rows currently stored."""
        return int((await self.session.execute(select(func.count()).select_from(CostItemResource))).scalar_one())

    async def distinct_regions(self) -> list[str]:
        """Non-null region tags that carry at least one cost item."""
        stmt = select(distinct(CostItem.region)).where(CostItem.region.is_not(None))
        rows = (await self.session.execute(stmt)).scalars().all()
        return [r for r in rows if r]

    async def has_null_region_items(self) -> bool:
        """True when any cost item has no region tag (its own reindex bucket)."""
        stmt = select(CostItem.id).where(CostItem.region.is_(None)).limit(1)
        return (await self.session.execute(stmt)).first() is not None

    async def stream_items_in_region(self, region: str | None, batch_size: int = 1000) -> AsyncIterator[object]:
        """Yield ``(id, code, region, source, components)`` for one region bucket.

        Paged by id keyset in ``batch_size`` chunks so a large base is never
        materialised in one go during a reindex, yet no server-side cursor is
        held open while the caller writes edges on the same connection (which
        asyncpg forbids). ``region=None`` selects the items whose region IS NULL,
        not all items. Soft-deleted (inactive) items are skipped so a deleted
        work never lingers in the index.
        """
        after: uuid.UUID | None = None
        while True:
            stmt = select(CostItem.id, CostItem.code, CostItem.region, CostItem.source, CostItem.components)
            stmt = stmt.where(CostItem.region.is_(None)) if region is None else stmt.where(CostItem.region == region)
            stmt = stmt.where(CostItem.is_active.is_(True))
            if after is not None:
                stmt = stmt.where(CostItem.id > after)
            stmt = stmt.order_by(CostItem.id).limit(batch_size)
            rows = (await self.session.execute(stmt)).all()
            if not rows:
                return
            for row in rows:
                yield row
            if len(rows) < batch_size:
                return
            after = rows[-1][0]

    async def delete_edges_for_region(self, region: str | None) -> None:
        """Drop all reverse-index rows for one region bucket (None = NULL bucket)."""
        stmt = delete(CostItemResource)
        stmt = (
            stmt.where(CostItemResource.region.is_(None))
            if region is None
            else stmt.where(CostItemResource.region == region)
        )
        await self.session.execute(stmt)

    async def delete_edges_for_item(self, item_id: uuid.UUID) -> None:
        """Drop the reverse-index rows for a single cost item (incremental sync)."""
        await self.session.execute(delete(CostItemResource).where(CostItemResource.cost_item_id == item_id))

    async def bulk_insert_edges(self, rows: list[dict]) -> None:
        """Insert a batch of reverse-index rows."""
        if rows:
            await self.session.execute(insert(CostItemResource), rows)

    # ── By resources ─────────────────────────────────────────────────────────

    async def candidate_item_ids(
        self,
        region: str | None,
        resource_codes: Sequence[str],
        sources: Sequence[str] | None,
        limit: int,
    ) -> list[uuid.UUID]:
        """Work-item ids that consume the requested resources, best match first.

        Ordered by how many of the requested resources each item carries, so the
        candidate cap keeps the most promising items rather than an arbitrary
        slice (the fine-grained scoring then runs in the ranking engine).
        """
        if not resource_codes:
            return []
        match_count = func.count().label("matches")
        stmt = (
            select(CostItemResource.cost_item_id, match_count)
            .where(CostItemResource.resource_code.in_(list(resource_codes)))
            .group_by(CostItemResource.cost_item_id)
            .order_by(match_count.desc())
        )
        if region is not None:
            stmt = stmt.where(CostItemResource.region == region)
        if sources:
            stmt = stmt.join(CostItem, CostItem.id == CostItemResource.cost_item_id).where(
                CostItem.source.in_(list(sources))
            )
        stmt = stmt.limit(limit)
        return [row[0] for row in (await self.session.execute(stmt)).all()]

    async def edges_for_items(self, item_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, list[CostItemResource]]:
        """All reverse-index rows for the given items, grouped by item id."""
        if not item_ids:
            return {}
        stmt = select(CostItemResource).where(CostItemResource.cost_item_id.in_(list(item_ids)))
        out: dict[uuid.UUID, list[CostItemResource]] = {}
        for row in (await self.session.execute(stmt)).scalars().all():
            out.setdefault(row.cost_item_id, []).append(row)
        return out

    async def cost_items_by_ids(self, item_ids: Sequence[uuid.UUID]) -> dict[uuid.UUID, CostItem]:
        """Load the given cost items keyed by id."""
        if not item_ids:
            return {}
        stmt = select(CostItem).where(CostItem.id.in_(list(item_ids)))
        return {row.id: row for row in (await self.session.execute(stmt)).scalars().all()}

    async def get_item(self, item_id: uuid.UUID) -> CostItem | None:
        """Load a single cost item by id."""
        return await self.session.get(CostItem, item_id)

    # ── Find work (text search) ──────────────────────────────────────────────

    async def search_work(
        self,
        tokens: Sequence[str],
        region: str | None,
        sources: Sequence[str] | None,
        limit: int,
    ) -> list[CostItem]:
        """Cost items where every token appears in the code or the description."""
        stmt = select(CostItem).where(CostItem.is_active.is_(True))
        for tok in tokens:
            pattern = f"%{_escape_like(tok)}%"
            stmt = stmt.where(
                or_(
                    CostItem.code.ilike(pattern, escape="\\"),
                    CostItem.description.ilike(pattern, escape="\\"),
                )
            )
        if region is not None:
            stmt = stmt.where(CostItem.region == region)
        if sources:
            stmt = stmt.where(CostItem.source.in_(list(sources)))
        stmt = stmt.limit(limit)
        return list((await self.session.execute(stmt)).scalars().all())

    # ── Compare across bases ─────────────────────────────────────────────────

    async def items_by_code(self, code: str, limit: int) -> list[CostItem]:
        """Every priced instance of one rate code (the same work across regions)."""
        stmt = select(CostItem).where(CostItem.code == code, CostItem.is_active.is_(True)).limit(limit)
        return list((await self.session.execute(stmt)).scalars().all())

    # ── Substitution / price intelligence ────────────────────────────────────

    async def catalog_resource(self, resource_code: str, region: str | None = None) -> CatalogResource | None:
        """One catalog row for a resource, preferring the given region."""
        stmt = select(CatalogResource).where(CatalogResource.resource_code == resource_code)
        if region is not None:
            stmt = stmt.where(CatalogResource.region == region)
        return (await self.session.execute(stmt.limit(1))).scalars().first()

    async def catalog_rows_for_resource(self, resource_code: str, limit: int = 200) -> list[CatalogResource]:
        """All catalog rows for a resource (one per region price book), capped."""
        stmt = select(CatalogResource).where(CatalogResource.resource_code == resource_code).limit(limit)
        return list((await self.session.execute(stmt)).scalars().all())

    async def dominant_region_for_resource(self, resource_code: str) -> str | None:
        """The region carrying the most price rows for this resource.

        Price stats must stay inside one currency; when the caller gives no
        region this picks the region with the most data so the spread is a
        single-currency distribution rather than a cross-currency blend.
        """
        stmt = (
            select(CostItemResource.region, func.count().label("n"))
            .join(CostItem, CostItem.id == CostItemResource.cost_item_id)
            .where(
                CostItemResource.resource_code == resource_code,
                CostItemResource.region.is_not(None),
                CostItem.is_active.is_(True),
            )
            .group_by(CostItemResource.region)
            .order_by(func.count().desc())
            .limit(1)
        )
        row = (await self.session.execute(stmt)).first()
        return row[0] if row else None

    async def resource_usage_count(self, resource_code: str, region: str | None = None) -> int:
        """How many distinct live works consume this resource."""
        stmt = (
            select(func.count(distinct(CostItemResource.cost_item_id)))
            .join(CostItem, CostItem.id == CostItemResource.cost_item_id)
            .where(CostItemResource.resource_code == resource_code, CostItem.is_active.is_(True))
        )
        if region is not None:
            stmt = stmt.where(CostItemResource.region == region)
        return int((await self.session.execute(stmt)).scalar_one())

    async def edge_prices_for_resource(
        self, resource_code: str, region: str | None = None, limit: int = 5000
    ) -> list[str]:
        """A capped sample of the unit prices this resource carries across works.

        Joined to the cost item so a stale edge pointing at a removed / inactive
        work never skews the spread, and capped so the busiest resource cannot
        pull an unbounded column into memory for the in-Python percentiles.
        """
        stmt = (
            select(CostItemResource.unit_rate)
            .join(CostItem, CostItem.id == CostItemResource.cost_item_id)
            .where(CostItemResource.resource_code == resource_code, CostItem.is_active.is_(True))
        )
        if region is not None:
            stmt = stmt.where(CostItemResource.region == region)
        stmt = stmt.limit(limit)
        return list((await self.session.execute(stmt)).scalars().all())

    async def top_works_for_resource(
        self, resource_code: str, region: str | None, limit: int
    ) -> list[CostItemResource]:
        """Reverse-index rows for the live works that consume this resource."""
        stmt = (
            select(CostItemResource)
            .join(CostItem, CostItem.id == CostItemResource.cost_item_id)
            .where(CostItemResource.resource_code == resource_code, CostItem.is_active.is_(True))
        )
        if region is not None:
            stmt = stmt.where(CostItemResource.region == region)
        return list((await self.session.execute(stmt.limit(limit))).scalars().all())
