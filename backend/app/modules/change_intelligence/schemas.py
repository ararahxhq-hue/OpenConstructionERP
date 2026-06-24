# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pydantic response schemas for the change-intelligence API."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PartyLoadOut(BaseModel):
    """Open-change load for one responsible party (ball in court)."""

    model_config = ConfigDict(from_attributes=True)

    party: str
    open_count: int
    overdue_count: int
    oldest_age_days: float
    total_age_days: float
    avg_age_days: float


class ItemAgingOut(BaseModel):
    """One open change record with its aging."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    code: str
    title: str
    status: str
    party: str
    age_days: float
    stale_days: float | None
    response_due_date: str | None
    overdue: bool
    days_to_due: float | None


class CycleTimeBoardOut(BaseModel):
    """The "waiting on whom" board for a project's open changes."""

    project_id: str
    as_of: datetime
    total_open: int
    total_overdue: int
    unassigned_open: int
    parties: list[PartyLoadOut]
    items: list[ItemAgingOut]
