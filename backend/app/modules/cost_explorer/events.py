# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""Cost Explorer reverse-index freshness.

Keeps ``oe_cost_item_resource`` in step with the costs table by subscribing to
the ``costs.item.*`` / ``costs.items.*`` events the costs module already
publishes. A single item change refreshes just that item's edges; a bulk import
triggers one debounced full rebuild. Without this the reverse index would go
silently stale after every rate edit or price-base import, and the four search
modes would answer from stale edges with no warning.

Auto-imported by the module loader when ``oe_cost_explorer`` is loaded (see
``module_loader._load_module`` -> ``events.py``). Every handler runs detached
from the request transaction in its own short-lived session and swallows errors,
so a sync hiccup never propagates into a user request or the publishing module.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from app.core.events import Event, event_bus

logger = logging.getLogger(__name__)

# A bulk import fires one event per region file; debounce + lock so several
# arriving together collapse into a single rebuild rather than one pass each.
_BULK_LOCK = asyncio.Lock()
_BULK_DEBOUNCE_SECONDS = 2.0
# Above this many cost items an automatic full rebuild stands down (mirrors the
# startup auto-build cap) so a huge base is left to a deliberate admin reindex
# rather than rebuilt on a constrained box after every import.
_BULK_AUTOREBUILD_MAX_ITEMS = 40000


def _extract_item_id(event: Event) -> uuid.UUID | None:
    """Pull ``item_id`` out of an event payload as a UUID, or None if absent/bad."""
    raw = (event.data or {}).get("item_id")
    if raw is None:
        return None
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None


async def _refresh_one(item_id: uuid.UUID) -> None:
    """Rebuild the reverse-index edges for a single changed cost item."""
    from app.database import async_session_factory
    from app.modules.cost_explorer.repository import CostExplorerRepository
    from app.modules.cost_explorer.service import CostExplorerService

    try:
        async with async_session_factory() as session:
            repo = CostExplorerRepository(session)
            # Only maintain an index that already exists. Before the first build
            # a single item event must not seed a one-row index and thereby
            # suppress the full startup build.
            if await repo.count_edges() == 0:
                return
            await CostExplorerService(repo).refresh_item(item_id)
            await session.commit()
    except Exception:  # pragma: no cover - best-effort background sync
        logger.debug("Cost Explorer: edge refresh failed for %s", item_id, exc_info=True)


async def _remove_one(item_id: uuid.UUID) -> None:
    """Drop a deleted cost item's edges from the reverse index."""
    from app.database import async_session_factory
    from app.modules.cost_explorer.repository import CostExplorerRepository

    try:
        async with async_session_factory() as session:
            repo = CostExplorerRepository(session)
            await repo.delete_edges_for_item(item_id)
            await session.commit()
    except Exception:  # pragma: no cover - best-effort background sync
        logger.debug("Cost Explorer: edge delete failed for %s", item_id, exc_info=True)


async def _on_cost_item_created(event: Event) -> None:
    item_id = _extract_item_id(event)
    if item_id is not None:
        await _refresh_one(item_id)


async def _on_cost_item_updated(event: Event) -> None:
    item_id = _extract_item_id(event)
    if item_id is not None:
        await _refresh_one(item_id)


async def _on_cost_item_deleted(event: Event) -> None:
    item_id = _extract_item_id(event)
    if item_id is not None:
        await _remove_one(item_id)


async def _on_bulk_import(event: Event) -> None:
    """Rebuild the whole index after a bulk import (debounced, size-capped)."""
    _ = event  # the bulk payload is summary-only (no per-row ids)
    if _BULK_LOCK.locked():
        # A rebuild is already scheduled/running; it will pick up these rows too.
        return

    from app.database import async_session_factory
    from app.modules.cost_explorer.repository import CostExplorerRepository
    from app.modules.cost_explorer.service import CostExplorerService

    async with _BULK_LOCK:
        # Let the import transaction settle so the new rows are visible.
        await asyncio.sleep(_BULK_DEBOUNCE_SECONDS)
        try:
            async with async_session_factory() as session:
                repo = CostExplorerRepository(session)
                if await repo.count_edges() == 0:
                    # Never built yet; the startup auto-build owns first population.
                    return
                if await repo.count_cost_items() > _BULK_AUTOREBUILD_MAX_ITEMS:
                    logger.info(
                        "Cost Explorer: base too large for an automatic post-import rebuild; "
                        "run POST /api/v1/cost-explorer/reindex to refresh the index."
                    )
                    return
                report = await CostExplorerService(repo).reindex()
                await session.commit()
                logger.info(
                    "Cost Explorer: reverse index rebuilt after bulk import (%d items -> %d edges).",
                    report.items_scanned,
                    report.edges_written,
                )
        except Exception:  # pragma: no cover - best-effort background sync
            logger.debug("Cost Explorer: post-import reindex failed", exc_info=True)


def _register_handlers() -> None:
    """Wire the handlers into the event bus (idempotent by callable identity)."""
    event_bus.subscribe("costs.item.created", _on_cost_item_created)
    event_bus.subscribe("costs.item.updated", _on_cost_item_updated)
    event_bus.subscribe("costs.item.deleted", _on_cost_item_deleted)
    event_bus.subscribe("costs.items.bulk_imported", _on_bulk_import)


_register_handlers()


__all__ = [
    "_extract_item_id",
    "_on_bulk_import",
    "_on_cost_item_created",
    "_on_cost_item_deleted",
    "_on_cost_item_updated",
    "_register_handlers",
]
