# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Pydantic response schemas for the claims evidence-pack API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class EvidenceEntryOut(BaseModel):
    """One source record in the evidence pack."""

    model_config = ConfigDict(from_attributes=True)

    ref_id: str
    source_module: str
    kind: str
    title: str
    occurred_at: str | None
    actor_id: str | None
    summary: str


class EvidenceSectionOut(BaseModel):
    """A named, ordered group of evidence entries."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    entries: list[EvidenceEntryOut]


class EvidencePackOut(BaseModel):
    """The assembled, deterministic evidence pack."""

    model_config = ConfigDict(from_attributes=True)

    subject_ref: str
    basis: str
    entry_count: int
    date_from: str | None
    date_to: str | None
    sections: list[EvidenceSectionOut]
    content_digest: str
