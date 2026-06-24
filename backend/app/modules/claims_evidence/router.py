# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Claims evidence-pack API routes (auto-mounted at /api/v1/claims-evidence).

Access control mirrors every other project-scoped router: the caller must be
authenticated and pass :func:`verify_project_access` for the requested project,
which 404s on both "missing" and "denied" so it never leaks project existence.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query

from app.dependencies import CurrentUserId, SessionDep, verify_project_access
from app.modules.claims_evidence.schemas import EvidencePackOut
from app.modules.claims_evidence.service import assemble_evidence

router = APIRouter(tags=["Claims Evidence"])


@router.get("/projects/{project_id}/pack", response_model=EvidencePackOut)
async def get_evidence_pack(
    project_id: uuid.UUID,
    session: SessionDep,
    subject_ref: str = Query(description="Identifier of the claim or dispute the pack supports."),
    basis: str = Query(default="dispute", description="The basis the pack is assembled under."),
    limit: int = Query(default=500, ge=1, le=2000, description="Max activity rows to include."),
    user_id: CurrentUserId = None,  # type: ignore[assignment]
) -> EvidencePackOut:
    """Assemble a deterministic evidence pack for a project's claim or dispute."""
    await verify_project_access(project_id, user_id or "", session)

    pack = await assemble_evidence(
        session,
        project_id=project_id,
        subject_ref=subject_ref,
        basis=basis,
        activity_limit=limit,
    )
    return EvidencePackOut.model_validate(pack)
