# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Off-site / Prefab / DfMA service - business logic.

Stateless service layer. Handles:
- Prefab unit CRUD
- Ordered production-stage advances (design -> ... -> installed) via the
  ``PrefabStageMachine``, with a hard QA gate before dispatch / delivery /
  installation
- An immutable ``ProductionEvent`` audit row for every stage change
- Best-effort domain events (dispatched / installed) for cross-module handlers
"""

import logging
import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.events import event_bus
from app.modules.prefab import events as prefab_events
from app.modules.prefab.guard import (
    STAGE_ORDER,
    PrefabStage,
    PrefabStageMachine,
    next_stage,
)
from app.modules.prefab.models import PrefabUnit, ProductionEvent
from app.modules.prefab.repository import (
    PrefabUnitRepository,
    ProductionEventRepository,
)
from app.modules.prefab.schemas import (
    AdvanceStageRequest,
    PrefabBoardColumn,
    PrefabBoardResponse,
    PrefabStatsResponse,
    PrefabUnitCreate,
    PrefabUnitResponse,
    PrefabUnitUpdate,
)

logger = logging.getLogger(__name__)

# Upper bound on how many units a single board response materialises. A prefab
# register per project sits comfortably inside this; the count per column stays
# authoritative via the stats group-by even if a huge project ever exceeds it.
_BOARD_UNIT_CAP = 1000

_stage_machine = PrefabStageMachine()


class PrefabService:
    """Business logic for off-site / prefab operations."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.unit_repo = PrefabUnitRepository(session)
        self.event_repo = ProductionEventRepository(session)

    # ── Unit CRUD ─────────────────────────────────────────────────────────

    async def create_unit(
        self,
        data: PrefabUnitCreate,
        user_id: str | None = None,
    ) -> PrefabUnit:
        """Create a new prefab unit.

        Raises 409 if ``ref`` already exists within the project.
        """
        existing = await self.unit_repo.get_by_ref_and_project(data.project_id, data.ref)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Unit ref '{data.ref}' already exists in project {data.project_id}",
            )

        unit = PrefabUnit(
            project_id=data.project_id,
            ref=data.ref,
            unit_type=data.unit_type,
            status=data.status,
            target_install_date=data.target_install_date,
            drawing_ref=data.drawing_ref,
            bim_element_ids=data.bim_element_ids,
            notes=data.notes,
            created_by=user_id,
        )
        unit = await self.unit_repo.create(unit)

        # Seed the audit trail with the unit's opening stage so the timeline is
        # never empty and the first advance has a clear predecessor.
        opening = ProductionEvent(
            unit_id=unit.id,
            stage=data.status,
            from_stage=None,
            note="Unit registered",
            created_by=user_id,
        )
        await self.event_repo.create(opening)

        event_bus.publish_detached(
            prefab_events.UNIT_CREATED,
            data={
                "project_id": str(data.project_id),
                "unit_id": str(unit.id),
                "ref": data.ref,
                "unit_type": data.unit_type,
                "status": data.status,
                "user_id": user_id,
            },
            source_module="prefab",
        )
        logger.info(
            "Prefab unit created: %s (%s) for project %s",
            data.ref,
            data.status,
            data.project_id,
        )
        return unit

    async def get_unit(self, unit_id: uuid.UUID) -> PrefabUnit:
        """Get a unit by ID. Raises 404 if not found."""
        unit = await self.unit_repo.get_by_id(unit_id)
        if unit is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Prefab unit not found",
            )
        return unit

    async def list_units(
        self,
        project_id: uuid.UUID,
        *,
        offset: int = 0,
        limit: int = 50,
        status: str | None = None,
        unit_type: str | None = None,
    ) -> tuple[list[PrefabUnit], int]:
        """List units for a project with optional status / type filters."""
        return await self.unit_repo.list_for_project(
            project_id,
            offset=offset,
            limit=limit,
            status=status,
            unit_type=unit_type,
        )

    async def update_unit(
        self,
        unit_id: uuid.UUID,
        data: PrefabUnitUpdate,
    ) -> PrefabUnit:
        """Update mutable unit fields (never ``status`` - that goes via advance)."""
        unit = await self.get_unit(unit_id)

        fields: dict[str, Any] = data.model_dump(exclude_unset=True)
        if not fields:
            return unit

        # Guard uniqueness when the ref is being changed.
        new_ref = fields.get("ref")
        if new_ref is not None and new_ref != unit.ref:
            clash = await self.unit_repo.get_by_ref_and_project(unit.project_id, new_ref)
            if clash is not None and clash.id != unit.id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Unit ref '{new_ref}' already exists in this project",
                )

        await self.unit_repo.update_fields(unit_id, **fields)
        await self.session.refresh(unit)
        logger.info("Prefab unit updated: %s (fields=%s)", unit_id, list(fields.keys()))
        return unit

    async def delete_unit(self, unit_id: uuid.UUID) -> None:
        """Delete a unit and its production events."""
        await self.get_unit(unit_id)
        await self.unit_repo.delete(unit_id)
        logger.info("Prefab unit deleted: %s", unit_id)

    # ── Stage advance (ordered state machine + QA gate) ───────────────────

    async def advance_stage(
        self,
        unit_id: uuid.UUID,
        data: AdvanceStageRequest,
        user_id: str | None = None,
    ) -> PrefabUnit:
        """Advance a unit's production stage following the ordered lifecycle.

        Uses ``PrefabStageMachine`` to enforce forward-only movement and the QA
        gate: a unit can never reach ``dispatched`` / ``delivered`` /
        ``installed`` before it has passed ``qa``. A ``ProductionEvent`` audit
        row is written inline (same session) so a rollback leaves no orphan
        audit row; the event bus is used only for cross-module notification.
        """
        unit = await self.get_unit(unit_id)
        current = unit.status

        # Resolve the target: an explicit one, else the immediate next stage.
        target = data.target_status or next_stage(current)
        if target is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(f"Unit is already at the final stage ('{current}') and cannot advance further"),
            )

        allowed, reason = _stage_machine.can_advance(current, target)
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=reason,
            )

        await self.unit_repo.update_fields(unit_id, status=target)

        audit = ProductionEvent(
            unit_id=unit_id,
            stage=target,
            from_stage=current,
            note=data.note,
            created_by=user_id,
        )
        self.session.add(audit)
        await self.session.flush()
        await self.session.refresh(unit)

        logger.info(
            "Prefab stage advance: %s -> %s for unit %s (user=%s)",
            current,
            target,
            unit_id,
            user_id,
        )

        # Always announce the advance; additionally fire the two milestone
        # topics the spec calls out so logistics / schedule can react.
        base_payload = {
            "project_id": str(unit.project_id),
            "unit_id": str(unit_id),
            "ref": unit.ref,
            "from_stage": current,
            "to_stage": target,
            "user_id": user_id,
        }
        event_bus.publish_detached(
            prefab_events.UNIT_STAGE_ADVANCED,
            data=base_payload,
            source_module="prefab",
        )
        if target == PrefabStage.DISPATCHED.value:
            event_bus.publish_detached(
                prefab_events.UNIT_DISPATCHED,
                data=base_payload,
                source_module="prefab",
            )
        elif target == PrefabStage.INSTALLED.value:
            event_bus.publish_detached(
                prefab_events.UNIT_INSTALLED,
                data=base_payload,
                source_module="prefab",
            )

        return unit

    async def get_unit_events(self, unit_id: uuid.UUID) -> list[ProductionEvent]:
        """Return the production-event timeline for a unit, newest first."""
        await self.get_unit(unit_id)
        return await self.event_repo.list_for_unit(unit_id)

    # ── Board + stats ─────────────────────────────────────────────────────

    async def get_board(self, project_id: uuid.UUID) -> PrefabBoardResponse:
        """Return the project's units grouped into columns by production stage.

        Columns are always the full ordered lifecycle (zero-filled) so the UI
        renders a stable kanban even when a stage has no units.
        """
        units, total = await self.unit_repo.list_for_project(
            project_id,
            offset=0,
            limit=_BOARD_UNIT_CAP,
        )

        buckets: dict[str, list[PrefabUnitResponse]] = {stage: [] for stage in STAGE_ORDER}
        for unit in units:
            resp = PrefabUnitResponse.model_validate(unit)
            # An unknown/legacy status still shows up under its own key so it is
            # never silently dropped from the board.
            buckets.setdefault(unit.status, []).append(resp)

        columns = [
            PrefabBoardColumn(stage=stage, count=len(buckets[stage]), units=buckets[stage]) for stage in STAGE_ORDER
        ]
        # Append any off-lifecycle buckets (should not happen for valid data).
        for stage, items in buckets.items():
            if stage not in STAGE_ORDER:
                columns.append(PrefabBoardColumn(stage=stage, count=len(items), units=items))

        return PrefabBoardResponse(project_id=project_id, total=total, columns=columns)

    async def get_stats(self, project_id: uuid.UUID) -> PrefabStatsResponse:
        """Return aggregate statistics for a project's prefab units."""
        raw = await self.unit_repo.stats_for_project(project_id)
        return PrefabStatsResponse(
            total=raw["total"],
            by_status=raw["by_status"],
            by_type=raw["by_type"],
        )
