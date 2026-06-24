# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Change-intelligence API routes (auto-mounted at /api/v1/change-intelligence).

Access control mirrors every other project-scoped router: the caller must be
authenticated and pass :func:`verify_project_access` for the requested project
(owner / team-member / admin), which 404s on both "missing" and "denied" so it
never leaks project existence.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.dependencies import CurrentUserId, SessionDep, verify_project_access
from app.modules.change_intelligence.schemas import (
    CycleTimeBoardOut,
    ItemAgingOut,
    PartyLoadOut,
)
from app.modules.change_intelligence.service import build_project_board

router = APIRouter(tags=["Change Intelligence"])


@router.get("/projects/{project_id}/cycle-time", response_model=CycleTimeBoardOut)
async def get_cycle_time_board(
    project_id: uuid.UUID,
    session: SessionDep,
    user_id: CurrentUserId = None,  # type: ignore[assignment]
) -> CycleTimeBoardOut:
    """Per-party "waiting on whom" board over a project's open change records."""
    await verify_project_access(project_id, user_id or "", session)

    board = await build_project_board(session, project_id)
    return CycleTimeBoardOut(
        project_id=str(project_id),
        as_of=board.as_of,
        total_open=board.total_open,
        total_overdue=board.total_overdue,
        unassigned_open=board.unassigned_open,
        parties=[PartyLoadOut.model_validate(p) for p in board.parties],
        items=[ItemAgingOut.model_validate(r) for r in board.items],
    )
