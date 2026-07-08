"""Production-norm expansion API routes.

Mounted at ``/api/v1/norm-expansion/`` by the module loader.

Endpoint groups:
    /norms/                         - norm library CRUD
    /norms/{id}/materials/          - material coefficient sub-resource
    /materials/{id}                 - material coefficient delete
    /expand                         - expand one work item's quantity
    /expand-batch                   - expand several work items at once

The library is a shared, platform-wide reference (like a code catalogue), so
reads are open to any authenticated viewer and writes are gated by role. A
missing row returns 404, never 403, so probing never leaks a UUID's existence.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import CurrentUserId, RequirePermission, SessionDep
from app.modules.norm_expansion.models import ProductionNorm
from app.modules.norm_expansion.schemas import (
    ExpandBatchRequest,
    ExpandBatchResponse,
    ExpandRequest,
    ExpansionResponse,
    MaterialDemandResponse,
    NormCreate,
    NormMaterialCreate,
    NormMaterialResponse,
    NormResponse,
    NormUpdate,
)
from app.modules.norm_expansion.service import (
    ExpansionResult,
    NormExpansionService,
    WorkKeyExistsError,
)

router = APIRouter(tags=["norm-expansion"])


def _norm_to_response(norm: ProductionNorm) -> NormResponse:
    return NormResponse.model_validate(norm)


def _expansion_to_response(
    norm: ProductionNorm,
    result: ExpansionResult,
    quantity: object,
) -> ExpansionResponse:
    """Assemble the API response from a norm and its expansion result."""
    return ExpansionResponse(
        work_key=norm.work_key,
        name=norm.name,
        unit=norm.unit,
        quantity=quantity,  # type: ignore[arg-type]
        labor_hours=result.labor_hours,
        machine_hours=result.machine_hours,
        materials=[MaterialDemandResponse(name=m.name, unit=m.unit, qty=m.qty) for m in result.materials],
    )


async def _load_norm_or_404(service: NormExpansionService, norm_id: uuid.UUID) -> ProductionNorm:
    norm = await service.get_norm(norm_id)
    if norm is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Production norm not found")
    return norm


# ── Norm library CRUD ────────────────────────────────────────────────────────


@router.get("/norms/", response_model=list[NormResponse])
async def list_norms(
    session: SessionDep,
    _user_id: CurrentUserId,
    q: str | None = Query(default=None, description="Search work_key / name"),
    category: str | None = Query(default=None),
    active_only: bool = Query(default=False),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[NormResponse]:
    """List production norms in the shared library."""
    service = NormExpansionService(session)
    norms = await service.list_norms(
        q=q,
        category=category,
        active_only=active_only,
        offset=offset,
        limit=limit,
    )
    return [_norm_to_response(n) for n in norms]


@router.post(
    "/norms/",
    response_model=NormResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RequirePermission("norm_expansion.write"))],
)
async def create_norm(
    data: NormCreate,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> NormResponse:
    """Create a production norm with its material coefficients."""
    service = NormExpansionService(session)
    try:
        norm = await service.create_norm(data)
    except WorkKeyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return _norm_to_response(norm)


@router.get("/norms/{norm_id}", response_model=NormResponse)
async def get_norm(
    norm_id: uuid.UUID,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> NormResponse:
    """Fetch a single norm with its materials."""
    service = NormExpansionService(session)
    norm = await _load_norm_or_404(service, norm_id)
    return _norm_to_response(norm)


@router.patch(
    "/norms/{norm_id}",
    response_model=NormResponse,
    dependencies=[Depends(RequirePermission("norm_expansion.write"))],
)
async def update_norm(
    norm_id: uuid.UUID,
    data: NormUpdate,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> NormResponse:
    """Patch a norm's scalar fields."""
    service = NormExpansionService(session)
    await _load_norm_or_404(service, norm_id)
    try:
        norm = await service.update_norm(norm_id, data)
    except WorkKeyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    assert norm is not None  # the load_or_404 above proved existence
    return _norm_to_response(norm)


@router.delete(
    "/norms/{norm_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("norm_expansion.manage"))],
)
async def delete_norm(
    norm_id: uuid.UUID,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> None:
    """Delete a norm and all its material coefficients."""
    service = NormExpansionService(session)
    await _load_norm_or_404(service, norm_id)
    await service.delete_norm(norm_id)


# ── Material coefficients ────────────────────────────────────────────────────


@router.post(
    "/norms/{norm_id}/materials/",
    response_model=NormMaterialResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(RequirePermission("norm_expansion.write"))],
)
async def add_material(
    norm_id: uuid.UUID,
    data: NormMaterialCreate,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> NormMaterialResponse:
    """Attach a material coefficient to a norm."""
    service = NormExpansionService(session)
    norm = await _load_norm_or_404(service, norm_id)
    material = await service.add_material(norm, data)
    return NormMaterialResponse.model_validate(material)


@router.delete(
    "/materials/{material_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(RequirePermission("norm_expansion.write"))],
)
async def delete_material(
    material_id: uuid.UUID,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> None:
    """Remove a single material coefficient."""
    service = NormExpansionService(session)
    if await service.get_material(material_id) is None:
        # IDOR posture: unknown id is a 404, never a 403 / 422.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    await service.delete_material(material_id)


# ── Expansion ────────────────────────────────────────────────────────────────


@router.post(
    "/expand",
    response_model=ExpansionResponse,
    dependencies=[Depends(RequirePermission("norm_expansion.read"))],
)
async def expand_one(
    data: ExpandRequest,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> ExpansionResponse:
    """Expand a single work item's quantity into unpriced resource demand."""
    service = NormExpansionService(session)
    outcome = await service.expand_work_key(data.work_key, data.quantity)
    if outcome is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No production norm for work_key: {data.work_key}",
        )
    norm, result = outcome
    return _expansion_to_response(norm, result, data.quantity)


@router.post(
    "/expand-batch",
    response_model=ExpandBatchResponse,
    dependencies=[Depends(RequirePermission("norm_expansion.read"))],
)
async def expand_batch(
    data: ExpandBatchRequest,
    session: SessionDep,
    _user_id: CurrentUserId,
) -> ExpandBatchResponse:
    """Expand several work items at once.

    Work keys with no matching norm are collected under ``unmatched`` rather
    than failing the whole request, so a partial BOQ still returns the demand
    it can compute.
    """
    service = NormExpansionService(session)
    results: list[ExpansionResponse] = []
    unmatched: list[str] = []
    for item in data.items:
        outcome = await service.expand_work_key(item.work_key, item.quantity)
        if outcome is None:
            unmatched.append(item.work_key)
            continue
        norm, result = outcome
        results.append(_expansion_to_response(norm, result, item.quantity))
    return ExpandBatchResponse(results=results, unmatched=unmatched)
