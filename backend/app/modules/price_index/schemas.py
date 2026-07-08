"""Pydantic v2 schemas for the price-index module.

Factors and money are carried as :class:`~decimal.Decimal` and emitted as
plain decimal *strings* on the wire (via :data:`DecimalStr`) so a precise value
never loses digits through a JSON ``float`` bridge - the platform-wide
"money / factor as string" convention.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator

# Upper bound shared by every numeric input. 1e12 is far beyond any real index
# value / money amount yet keeps each pairwise product finite in Decimal, so an
# adjusted amount can never overflow to a non-finite value.
_NUM_MAX: Decimal = Decimal("1000000000000")

# ISO year-month, ``YYYY-MM`` with a real month 01-12.
PERIOD_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _decimal_to_str(value: Decimal | None) -> str | None:
    """Serialise a ``Decimal`` as a fixed-point string (never exponent form)."""
    if value is None:
        return None
    if not isinstance(value, Decimal):
        try:
            value = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
    if not value.is_finite():
        return None
    return format(value, "f")


# Decimal that JSON-serialises to a plain string. Reused for every factor and
# money field on the response models.
DecimalStr = Annotated[Decimal, PlainSerializer(_decimal_to_str, return_type=str)]


def _validate_period(value: str) -> str:
    """Reject anything that is not a ``YYYY-MM`` string with a real month."""
    text = value.strip()
    if not PERIOD_RE.match(text):
        raise ValueError("period must be an ISO year-month string, e.g. '2026-01'")
    return text


def _reject_non_finite(value: Decimal) -> Decimal:
    if not value.is_finite():
        raise ValueError("value must be finite (no NaN / Infinity)")
    return value


# ── Cost-index series ────────────────────────────────────────────────────────


class CostIndexSeriesCreate(BaseModel):
    """Create a new cost-index series."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)


class CostIndexSeriesUpdate(BaseModel):
    """Partial update for a cost-index series."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)


class CostIndexSeriesResponse(BaseModel):
    """A cost-index series header as returned by the API."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    name: str
    description: str
    point_count: int = 0
    created_at: datetime
    updated_at: datetime


# ── Cost-index points ────────────────────────────────────────────────────────


class CostIndexPointCreate(BaseModel):
    """Add one ``(period, factor)`` point to a series."""

    model_config = ConfigDict(str_strip_whitespace=True)

    period: str = Field(..., description="ISO year-month, e.g. '2026-01'")
    factor: Decimal = Field(..., gt=0, le=_NUM_MAX)

    @field_validator("period")
    @classmethod
    def _check_period(cls, value: str) -> str:
        return _validate_period(value)

    @field_validator("factor")
    @classmethod
    def _check_factor(cls, value: Decimal) -> Decimal:
        return _reject_non_finite(value)


class CostIndexPointUpdate(BaseModel):
    """Update the factor (and optionally the period) of a point."""

    model_config = ConfigDict(str_strip_whitespace=True)

    period: str | None = Field(default=None)
    factor: Decimal | None = Field(default=None, gt=0, le=_NUM_MAX)

    @field_validator("period")
    @classmethod
    def _check_period(cls, value: str | None) -> str | None:
        return _validate_period(value) if value is not None else None

    @field_validator("factor")
    @classmethod
    def _check_factor(cls, value: Decimal | None) -> Decimal | None:
        return _reject_non_finite(value) if value is not None else None


class CostIndexPointResponse(BaseModel):
    """A single index point as returned by the API."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    series_id: UUID
    period: str
    factor: DecimalStr = Decimal("1")
    created_at: datetime
    updated_at: datetime


class CostIndexSeriesDetail(CostIndexSeriesResponse):
    """A series header plus all of its points, ordered by period."""

    points: list[CostIndexPointResponse] = Field(default_factory=list)


# ── Location factors ─────────────────────────────────────────────────────────


class LocationFactorCreate(BaseModel):
    """Create a regional cost factor."""

    model_config = ConfigDict(str_strip_whitespace=True)

    region_code: str = Field(..., min_length=1, max_length=64)
    label: str = Field(default="", max_length=255)
    factor: Decimal = Field(..., gt=0, le=_NUM_MAX)

    @field_validator("factor")
    @classmethod
    def _check_factor(cls, value: Decimal) -> Decimal:
        return _reject_non_finite(value)


class LocationFactorUpdate(BaseModel):
    """Partial update for a regional cost factor."""

    model_config = ConfigDict(str_strip_whitespace=True)

    region_code: str | None = Field(default=None, min_length=1, max_length=64)
    label: str | None = Field(default=None, max_length=255)
    factor: Decimal | None = Field(default=None, gt=0, le=_NUM_MAX)

    @field_validator("factor")
    @classmethod
    def _check_factor(cls, value: Decimal | None) -> Decimal | None:
        return _reject_non_finite(value) if value is not None else None


class LocationFactorResponse(BaseModel):
    """A regional cost factor as returned by the API."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    region_code: str
    label: str
    factor: DecimalStr = Decimal("1")
    created_at: datetime
    updated_at: datetime


# ── Adjust ───────────────────────────────────────────────────────────────────


class AdjustLine(BaseModel):
    """One amount to bring from a base period/region to a target period/region."""

    model_config = ConfigDict(str_strip_whitespace=True)

    amount: Decimal = Field(..., ge=0, le=_NUM_MAX)
    base_period: str = Field(..., description="ISO year-month the amount is expressed in")
    target_period: str = Field(..., description="ISO year-month to bring the amount to")
    base_region: str | None = Field(default=None, max_length=64)
    target_region: str | None = Field(default=None, max_length=64)

    @field_validator("amount")
    @classmethod
    def _check_amount(cls, value: Decimal) -> Decimal:
        return _reject_non_finite(value)

    @field_validator("base_period", "target_period")
    @classmethod
    def _check_period(cls, value: str) -> str:
        return _validate_period(value)


class AdjustRequest(BaseModel):
    """Adjust a batch of amounts against one chosen cost-index series."""

    model_config = ConfigDict(str_strip_whitespace=True)

    series_id: UUID
    lines: list[AdjustLine] = Field(..., min_length=1, max_length=1000)


class AdjustLineResult(BaseModel):
    """The adjustment outcome for one input line.

    ``temporal_factor``, ``location_factor``, ``applied_factor`` and
    ``adjusted_amount`` are ``null`` when ``error`` is set (for example a
    period missing from the series), so a single bad line never voids the
    whole batch.
    """

    amount: DecimalStr
    base_period: str
    target_period: str
    base_region: str | None = None
    target_region: str | None = None
    temporal_factor: DecimalStr | None = None
    location_factor: DecimalStr | None = None
    applied_factor: DecimalStr | None = None
    adjusted_amount: DecimalStr | None = None
    note: str | None = None
    error: str | None = None


class AdjustResponse(BaseModel):
    """The full result of an :class:`AdjustRequest`."""

    series_id: UUID
    series_name: str
    results: list[AdjustLineResult] = Field(default_factory=list)
