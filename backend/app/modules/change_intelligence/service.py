# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Change-intelligence service - the thin database layer over the pure engines.

Gathers the current state of every change-family record for a project (change
orders, variation notices / requests / orders, MoC entries) and feeds it to the
pure :mod:`cycle_time` engine to produce the "waiting on whom" board. Only the
columns the engine needs are selected (no relationship loading), so a project
with many change records stays cheap to summarise.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change_intelligence.cycle_time import (
    KIND_CHANGE_ORDER,
    KIND_MOC_ENTRY,
    KIND_VARIATION_NOTICE,
    KIND_VARIATION_ORDER,
    KIND_VARIATION_REQUEST,
    ChangeItem,
    CycleTimeBoard,
    build_board,
    is_open_status,
)
from app.modules.changeorders.models import ChangeOrder
from app.modules.moc.models import MoCEntry
from app.modules.variations.models import Notice, VariationOrder, VariationRequest

# Each change-family source table mapped to its engine kind token. Every model
# carries the same shape we read: id / code / title / status / ball_in_court /
# response_due_date plus created_at + updated_at from the shared Base.
_SOURCES: tuple[tuple[type, str], ...] = (
    (ChangeOrder, KIND_CHANGE_ORDER),
    (Notice, KIND_VARIATION_NOTICE),
    (VariationRequest, KIND_VARIATION_REQUEST),
    (VariationOrder, KIND_VARIATION_ORDER),
    (MoCEntry, KIND_MOC_ENTRY),
)


async def gather_change_items(session: AsyncSession, project_id: uuid.UUID) -> list[ChangeItem]:
    """Read every change-family record for *project_id* as engine ChangeItems."""
    items: list[ChangeItem] = []
    for model, kind in _SOURCES:
        stmt = select(
            model.id,
            model.code,
            model.title,
            model.status,
            model.ball_in_court,
            model.response_due_date,
            model.created_at,
            model.updated_at,
        ).where(model.project_id == project_id)
        result = await session.execute(stmt)
        for row in result.all():
            items.append(
                ChangeItem(
                    id=str(row.id),
                    kind=kind,
                    code=row.code or "",
                    title=(row.title or "").strip(),
                    status=row.status or "",
                    is_open=is_open_status(kind, row.status),
                    ball_in_court=row.ball_in_court,
                    response_due_date=row.response_due_date,
                    opened_at=row.created_at,
                    last_activity_at=row.updated_at,
                )
            )
    return items


async def build_project_board(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> CycleTimeBoard:
    """Build the cycle-time board for one project from its live change records."""
    moment = now or datetime.now(UTC)
    items = await gather_change_items(session, project_id)
    return build_board(items, moment)
