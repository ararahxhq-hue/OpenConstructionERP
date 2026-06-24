# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Claims / dispute evidence-pack service - the thin database layer.

Gathers a project's cross-module activity (from the activity-log timeline) and
its change-family records, projects them to evidence entries, and hands them to
the pure assembly engine to produce a deterministic, ordered evidence pack. The
pack is assembled on demand; nothing is persisted, so there is no new table and
no migration.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.changeorders.models import ChangeOrder
from app.modules.claims_evidence.evidence_pack import (
    EvidenceEntry,
    EvidencePack,
    assemble_pack,
)
from app.modules.moc.models import MoCEntry
from app.modules.timeline.service import get_project_timeline
from app.modules.variations.models import Notice, VariationOrder, VariationRequest

# Change-family source tables mapped to the (source_module, kind) the evidence
# engine routes on. source_module mirrors the activity-log module names so a
# document and the events about it land in the same section.
_CHANGE_SOURCES: tuple[tuple[type, str, str], ...] = (
    (Notice, "notices", "notice"),
    (VariationRequest, "variations", "variation_request"),
    (VariationOrder, "variations", "variation_order"),
    (ChangeOrder, "changeorders", "change_order"),
    (MoCEntry, "moc", "moc_entry"),
)


def _iso(value: object) -> str | None:
    """Render a datetime-like value as an ISO string, or None."""
    return value.isoformat() if hasattr(value, "isoformat") else None


async def _activity_entries(session: AsyncSession, project_id: uuid.UUID, limit: int) -> list[EvidenceEntry]:
    """Project the activity-log timeline rows into evidence entries."""
    rows = await get_project_timeline(session, project_id=project_id, limit=limit)
    entries: list[EvidenceEntry] = []
    for row in rows:
        action = row.action or ""
        title = f"{row.entity_type} {action}".strip() if row.entity_type else action
        entries.append(
            EvidenceEntry(
                ref_id=str(row.id),
                source_module=row.module or "activity_log",
                kind=action,
                title=title or "activity",
                occurred_at=_iso(row.created_at),
                actor_id=str(row.actor_id) if row.actor_id else None,
                summary=row.reason or "",
            )
        )
    return entries


async def _change_entries(session: AsyncSession, project_id: uuid.UUID) -> list[EvidenceEntry]:
    """Project the change-family documents into evidence entries."""
    entries: list[EvidenceEntry] = []
    for model, source_module, kind in _CHANGE_SOURCES:
        stmt = select(model.id, model.code, model.title, model.created_at).where(model.project_id == project_id)
        for row in (await session.execute(stmt)).all():
            title = (row.title or "").strip() or (row.code or "")
            label = f"{row.code} {title}".strip() if row.code else title
            entries.append(
                EvidenceEntry(
                    ref_id=str(row.id),
                    source_module=source_module,
                    kind=kind,
                    title=label or kind,
                    occurred_at=_iso(row.created_at),
                    actor_id=None,
                    summary="",
                )
            )
    return entries


async def assemble_evidence(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    subject_ref: str,
    basis: str = "dispute",
    activity_limit: int = 500,
) -> EvidencePack:
    """Assemble a deterministic evidence pack for a project's claim or dispute.

    Pulls the project's recent cross-module activity and every change-family
    record, then orders, sections and digests them with the pure engine. The
    same project state always yields the same pack and content digest.
    """
    entries = await _activity_entries(session, project_id, activity_limit)
    entries += await _change_entries(session, project_id)
    return assemble_pack(subject_ref, entries, basis=basis)
