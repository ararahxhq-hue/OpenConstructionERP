# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Construction-control Pydantic schemas - request/response models."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Shared regex fragments for the discriminators (kept here so router, service and
# tests reference one source of truth).
INSPECTION_TYPE_PATTERN = r"^(mir|wir|ir|hidden_works|acceptance)$"
PARTY_ROLE_PATTERN = r"^(qc|qa|tpi|ahj)$"
INTERVENTION_POINT_PATTERN = r"^(hold|witness|surveillance|review)$"
ACCEPTANCE_RULE_PATTERN = r"^(range|min|max|boolean|text)$"
RESULT_PATTERN = r"^(pass|fail|conditional)$"

# Pillar 2 - material record (digital passport) + test result discriminators.
# EN 10204 inspection-document grade (2.1 / 2.2 / 3.1 / 3.2) plus the EU CPR / UKCA
# markings (dop / ce / ukca) and a generic certificate of conformity (coc).
CERT_TYPE_PATTERN = r"^(2\.1|2\.2|3\.1|3\.2|dop|ce|ukca|coc|other)$"
MATERIAL_STATUS_PATTERN = r"^(draft|submitted|under_review|accepted|rejected|expired|superseded)$"
# A material may be created or edited only into a pre-decision state; accept / reject
# is reached through the review endpoint (which can raise an NCR), never a plain write.
MATERIAL_CREATE_STATUS_PATTERN = r"^(draft|submitted)$"
MATERIAL_UPDATE_STATUS_PATTERN = r"^(draft|submitted|under_review|superseded)$"
TEST_STATUS_PATTERN = r"^(draft|recorded|void)$"


# ── Universal Element Reference (UER) ─────────────────────────────────────────


class ElementRefIn(BaseModel):
    """Inbound element link. Any subset is accepted; the resolver fills the rest.

    A caller may pass the strong ``bim_element_id``, or the normalised
    ``(model_id, stable_id)``, or ``(model_id, native_id)``, or only denormalised
    display fields when the model is not yet ingested. IFC GlobalId is optional.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    bim_element_id: UUID | None = None
    model_id: UUID | None = None
    stable_id: str | None = Field(default=None, max_length=255)
    source_format: str | None = Field(default=None, max_length=20)
    ifc_global_id: str | None = Field(default=None, max_length=22)
    native_id: str | None = Field(default=None, max_length=255)
    model_version: str | None = Field(default=None, max_length=20)
    element_name: str | None = Field(default=None, max_length=500)
    element_type: str | None = Field(default=None, max_length=100)
    bbox: dict[str, Any] | None = None
    viewpoint: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ElementRefResponse(BaseModel):
    """A resolved UER as returned from the API."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    owner_type: str
    owner_id: str
    project_id: UUID
    bim_element_id: UUID | None = None
    model_id: UUID | None = None
    stable_id: str | None = None
    source_format: str | None = None
    ifc_global_id: str | None = None
    native_id: str | None = None
    model_version: str | None = None
    element_name: str | None = None
    element_type: str | None = None
    bbox: dict[str, Any] | None = None
    viewpoint: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime


# ── Acceptance criterion ──────────────────────────────────────────────────────


class AcceptanceCriterionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    code: str = Field(..., min_length=1, max_length=80)
    title: str = Field(..., min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    standard_ref: str | None = Field(default=None, max_length=120)
    discipline: str | None = Field(default=None, max_length=50)
    category: str | None = Field(default=None, max_length=80)
    characteristic: str | None = Field(default=None, max_length=255)
    method: str | None = Field(default=None, max_length=10000)
    unit: str | None = Field(default=None, max_length=40)
    acceptance_rule: str = Field(default="text", pattern=ACCEPTANCE_RULE_PATTERN)
    nominal_value: str | None = Field(default=None, max_length=80)
    tolerance_lower: str | None = Field(default=None, max_length=80)
    tolerance_upper: str | None = Field(default=None, max_length=80)
    is_active: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class AcceptanceCriterionUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    code: str | None = Field(default=None, min_length=1, max_length=80)
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    standard_ref: str | None = Field(default=None, max_length=120)
    discipline: str | None = Field(default=None, max_length=50)
    category: str | None = Field(default=None, max_length=80)
    characteristic: str | None = Field(default=None, max_length=255)
    method: str | None = Field(default=None, max_length=10000)
    unit: str | None = Field(default=None, max_length=40)
    acceptance_rule: str | None = Field(default=None, pattern=ACCEPTANCE_RULE_PATTERN)
    nominal_value: str | None = Field(default=None, max_length=80)
    tolerance_lower: str | None = Field(default=None, max_length=80)
    tolerance_upper: str | None = Field(default=None, max_length=80)
    is_active: bool | None = None
    metadata: dict[str, Any] | None = None


class AcceptanceCriterionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    project_id: UUID
    code: str
    title: str
    description: str | None = None
    standard_ref: str | None = None
    discipline: str | None = None
    category: str | None = None
    characteristic: str | None = None
    method: str | None = None
    unit: str | None = None
    acceptance_rule: str = "text"
    nominal_value: str | None = None
    tolerance_lower: str | None = None
    tolerance_upper: str | None = None
    is_active: bool = True
    created_by: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime


# ── Inspection ────────────────────────────────────────────────────────────────


class InspectionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    inspection_type: str = Field(..., pattern=INSPECTION_TYPE_PATTERN)
    party_role: str = Field(default="qc", pattern=PARTY_ROLE_PATTERN)
    intervention_point: str | None = Field(default=None, pattern=INTERVENTION_POINT_PATTERN)
    title: str = Field(..., min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    location_description: str | None = Field(default=None, max_length=500)
    activity_id: str | None = Field(default=None, max_length=36)
    criterion_id: UUID | None = None
    scheduled_at: str | None = Field(default=None, max_length=40)
    # Optional element under inspection (the UER). When omitted the inspection is
    # not model-linked, which is valid for purely location-based checks.
    element: ElementRefIn | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class InspectionUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    inspection_type: str | None = Field(default=None, pattern=INSPECTION_TYPE_PATTERN)
    party_role: str | None = Field(default=None, pattern=PARTY_ROLE_PATTERN)
    intervention_point: str | None = Field(default=None, pattern=INTERVENTION_POINT_PATTERN)
    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    location_description: str | None = Field(default=None, max_length=500)
    activity_id: str | None = Field(default=None, max_length=36)
    criterion_id: UUID | None = None
    status: str | None = Field(default=None, pattern=r"^(draft|scheduled|in_progress|passed|failed|closed|void)$")
    scheduled_at: str | None = Field(default=None, max_length=40)
    metadata: dict[str, Any] | None = None


class InspectionResultIn(BaseModel):
    """Record the outcome of an inspection. A ``fail`` (or ``conditional``) raises an NCR."""

    model_config = ConfigDict(str_strip_whitespace=True)

    result: str = Field(..., pattern=RESULT_PATTERN)
    measured_value: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=10000)
    performed_at: str | None = Field(default=None, max_length=40)
    # Severity used for an auto-raised NCR; defaults are derived from the result.
    ncr_severity: str | None = Field(default=None, pattern=r"^(critical|major|minor|observation)$")


class InspectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    project_id: UUID
    inspection_number: str
    inspection_type: str
    party_role: str = "qc"
    intervention_point: str | None = None
    title: str
    description: str | None = None
    location_description: str | None = None
    activity_id: str | None = None
    criterion_id: str | None = None
    status: str = "draft"
    result: str | None = None
    measured_value: str | None = None
    result_notes: str | None = None
    raised_ncr_id: str | None = None
    scheduled_at: str | None = None
    performed_at: str | None = None
    performed_by: str | None = None
    created_by: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
    # Resolved element links (populated by the service, not from_attributes).
    elements: list[ElementRefResponse] = Field(default_factory=list)


# ── Material record (digital passport, EN 10204) ──────────────────────────────


class MaterialRecordCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    name: str = Field(..., min_length=1, max_length=500)
    material_type: str | None = Field(default=None, max_length=80)
    spec_grade: str | None = Field(default=None, max_length=255)
    manufacturer: str | None = Field(default=None, max_length=255)
    supplier: str | None = Field(default=None, max_length=255)
    supplier_id: str | None = Field(default=None, max_length=36)
    product_code: str | None = Field(default=None, max_length=255)
    # Conformity certificate (EN 10204 grade + EU CPR / UKCA markings).
    cert_type: str | None = Field(default=None, pattern=CERT_TYPE_PATTERN)
    cert_number: str | None = Field(default=None, max_length=120)
    cert_issuer: str | None = Field(default=None, max_length=255)
    cert_document_id: str | None = Field(default=None, max_length=36)
    dop_number: str | None = Field(default=None, max_length=120)
    ce_marking: bool = False
    ukca_marking: bool = False
    issued_at: str | None = Field(default=None, max_length=40)
    valid_from: str | None = Field(default=None, max_length=40)
    valid_until: str | None = Field(default=None, max_length=40)
    # Traceability.
    batch_number: str | None = Field(default=None, max_length=120)
    heat_number: str | None = Field(default=None, max_length=120)
    lot_number: str | None = Field(default=None, max_length=120)
    quantity: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, max_length=40)
    # Links. ``criterion_id`` is a UUID so a cross-project criterion is rejected (IDOR);
    # the procurement ids are soft references (no FK) to the goods receipt.
    criterion_id: UUID | None = None
    po_id: str | None = Field(default=None, max_length=36)
    gr_id: str | None = Field(default=None, max_length=36)
    gr_item_id: str | None = Field(default=None, max_length=36)
    status: str = Field(default="draft", pattern=MATERIAL_CREATE_STATUS_PATTERN)
    received_at: str | None = Field(default=None, max_length=40)
    # Optional model element the material is installed in / linked to (the UER).
    element: ElementRefIn | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class MaterialRecordUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=500)
    material_type: str | None = Field(default=None, max_length=80)
    spec_grade: str | None = Field(default=None, max_length=255)
    manufacturer: str | None = Field(default=None, max_length=255)
    supplier: str | None = Field(default=None, max_length=255)
    supplier_id: str | None = Field(default=None, max_length=36)
    product_code: str | None = Field(default=None, max_length=255)
    cert_type: str | None = Field(default=None, pattern=CERT_TYPE_PATTERN)
    cert_number: str | None = Field(default=None, max_length=120)
    cert_issuer: str | None = Field(default=None, max_length=255)
    cert_document_id: str | None = Field(default=None, max_length=36)
    dop_number: str | None = Field(default=None, max_length=120)
    ce_marking: bool | None = None
    ukca_marking: bool | None = None
    issued_at: str | None = Field(default=None, max_length=40)
    valid_from: str | None = Field(default=None, max_length=40)
    valid_until: str | None = Field(default=None, max_length=40)
    batch_number: str | None = Field(default=None, max_length=120)
    heat_number: str | None = Field(default=None, max_length=120)
    lot_number: str | None = Field(default=None, max_length=120)
    quantity: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, max_length=40)
    criterion_id: UUID | None = None
    po_id: str | None = Field(default=None, max_length=36)
    gr_id: str | None = Field(default=None, max_length=36)
    gr_item_id: str | None = Field(default=None, max_length=36)
    status: str | None = Field(default=None, pattern=MATERIAL_UPDATE_STATUS_PATTERN)
    received_at: str | None = Field(default=None, max_length=40)
    metadata: dict[str, Any] | None = None


class MaterialReviewIn(BaseModel):
    """Record a conformity decision on a material submittal.

    ``decision`` reuses the inspection result grammar: ``pass`` accepts the material,
    ``fail`` rejects it (raises a material NCR), ``conditional`` accepts it subject to a
    tracked observation (raises a low-severity NCR).
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    decision: str = Field(..., pattern=RESULT_PATTERN)
    notes: str | None = Field(default=None, max_length=10000)
    reviewed_at: str | None = Field(default=None, max_length=40)
    ncr_severity: str | None = Field(default=None, pattern=r"^(critical|major|minor|observation)$")


class MaterialRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    project_id: UUID
    record_number: str
    name: str
    material_type: str | None = None
    spec_grade: str | None = None
    manufacturer: str | None = None
    supplier: str | None = None
    supplier_id: str | None = None
    product_code: str | None = None
    cert_type: str | None = None
    cert_number: str | None = None
    cert_issuer: str | None = None
    cert_document_id: str | None = None
    dop_number: str | None = None
    ce_marking: bool = False
    ukca_marking: bool = False
    issued_at: str | None = None
    valid_from: str | None = None
    valid_until: str | None = None
    batch_number: str | None = None
    heat_number: str | None = None
    lot_number: str | None = None
    quantity: str | None = None
    unit: str | None = None
    criterion_id: str | None = None
    po_id: str | None = None
    gr_id: str | None = None
    gr_item_id: str | None = None
    status: str = "draft"
    review_notes: str | None = None
    raised_ncr_id: str | None = None
    received_at: str | None = None
    received_by: str | None = None
    reviewed_at: str | None = None
    reviewed_by: str | None = None
    created_by: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
    # Computed (service-set, not from the ORM): certificate past its validity window.
    is_expired: bool = False
    elements: list[ElementRefResponse] = Field(default_factory=list)


# ── Test result (ISO/IEC 17025 lab) ───────────────────────────────────────────


class TestResultCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    project_id: UUID
    title: str = Field(..., min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    # UUIDs so a cross-project material / criterion is rejected (IDOR); the inspection
    # link is a soft reference within the same module.
    material_record_id: UUID | None = None
    inspection_id: str | None = Field(default=None, max_length=36)
    criterion_id: UUID | None = None
    sample_id: str | None = Field(default=None, max_length=120)
    test_method: str | None = Field(default=None, max_length=255)
    lab_name: str | None = Field(default=None, max_length=255)
    lab_accreditation: str | None = Field(default=None, max_length=120)
    is_accredited: bool = False
    measured_value: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, max_length=40)
    specimen_age_days: int | None = Field(default=None, ge=0)
    sampled_at: str | None = Field(default=None, max_length=40)
    element: ElementRefIn | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TestResultUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str | None = Field(default=None, min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=10000)
    material_record_id: UUID | None = None
    inspection_id: str | None = Field(default=None, max_length=36)
    criterion_id: UUID | None = None
    sample_id: str | None = Field(default=None, max_length=120)
    test_method: str | None = Field(default=None, max_length=255)
    lab_name: str | None = Field(default=None, max_length=255)
    lab_accreditation: str | None = Field(default=None, max_length=120)
    is_accredited: bool | None = None
    measured_value: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, max_length=40)
    specimen_age_days: int | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern=TEST_STATUS_PATTERN)
    sampled_at: str | None = Field(default=None, max_length=40)
    metadata: dict[str, Any] | None = None


class TestResultRecordIn(BaseModel):
    """Record a test outcome. A ``fail`` (or ``conditional``) raises a linked NCR."""

    model_config = ConfigDict(str_strip_whitespace=True)

    result: str = Field(..., pattern=RESULT_PATTERN)
    measured_value: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=10000)
    tested_at: str | None = Field(default=None, max_length=40)
    ncr_severity: str | None = Field(default=None, pattern=r"^(critical|major|minor|observation)$")


class TestResultResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    project_id: UUID
    result_number: str
    title: str
    description: str | None = None
    material_record_id: str | None = None
    inspection_id: str | None = None
    criterion_id: str | None = None
    sample_id: str | None = None
    test_method: str | None = None
    lab_name: str | None = None
    lab_accreditation: str | None = None
    is_accredited: bool = False
    measured_value: str | None = None
    unit: str | None = None
    specimen_age_days: int | None = None
    status: str = "draft"
    result: str | None = None
    result_notes: str | None = None
    raised_ncr_id: str | None = None
    sampled_at: str | None = None
    tested_at: str | None = None
    performed_by: str | None = None
    created_by: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="metadata_")
    created_at: datetime
    updated_at: datetime
    elements: list[ElementRefResponse] = Field(default_factory=list)
