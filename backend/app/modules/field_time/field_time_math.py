# DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
"""Pure field-time engine - all validatable timesheet logic, zero I/O.

This module deliberately imports nothing from :mod:`app.database`, SQLAlchemy,
FastAPI or any ORM model. It is the single source of truth for the rules that
decide whether a foreman's field timesheet is well formed, how a worker's hours
sum across a day, which lines become daywork sheet lines, how hours roll up into
cost, and how a reversing timesheet nets against the original it corrects.

Keeping the logic here (instead of inside :class:`FieldTimesheetService`) means
every rule is unit-testable on any interpreter - including the local Python 3.11
runner - without booting a database, exactly like ``schedule.progress_math`` and
``boq.cost_risk_engine``.

Vocabulary:

* A *line* is one worker-hours or plant-hours booking. A line is *labour* when it
  carries a ``resource_id`` and *plant* when it carries an ``equipment_id``.
  Exactly one of the two identifies a well formed line (labour XOR plant).
* A *worker* is the labour ``resource_id``. Per-worker hours are summed across a
  single day's lines and capped so a day can never book more than 24 hours.
* A *daywork* line books time-and-material work performed under an open variation
  and, on approval, is mirrored into a signed daywork sheet.

Money is ``Decimal`` throughout - never ``float`` - and serialised to a string by
the caller, matching the platform-wide money convention.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher
from typing import Any

# The hard ceiling on how many hours a single worker can book in one calendar
# day. A day has 24 hours; anything above is a data-entry error (a decimal typo,
# a double entry, or two crews booked under one person).
MAX_HOURS_PER_DAY: Decimal = Decimal("24")

# Quantisation quanta - hours to 2 dp, money to 2 dp.
_HOURS_Q: Decimal = Decimal("0.01")
_MONEY_Q: Decimal = Decimal("0.01")

# Line kinds resolved from which identifier a line carries.
KIND_LABOUR = "labour"
KIND_PLANT = "plant"
KIND_AMBIGUOUS = "ambiguous"  # both a resource and an equipment id - not allowed
KIND_UNSPECIFIED = "unspecified"  # neither id and no explicit hint - not allowed


# ── Coercion helpers ────────────────────────────────────────────────────────


def to_decimal(value: object, default: Decimal = Decimal("0")) -> Decimal:
    """Coerce an arbitrary value to a finite ``Decimal``.

    Args:
        value: An int / float / str / Decimal (or None).
        default: What to return when ``value`` is None or cannot be parsed.

    Returns:
        The parsed ``Decimal``, preserving sign (a reversal uses negative
        hours), or ``default`` for None / non-numeric / non-finite input.
    """
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value if value.is_finite() else default
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default
    return parsed if parsed.is_finite() else default


def quantize_hours(value: object) -> Decimal:
    """Return ``value`` as a 2 dp ``Decimal`` number of hours."""
    return to_decimal(value).quantize(_HOURS_Q)


def quantize_money(value: object) -> Decimal:
    """Return ``value`` as a 2 dp ``Decimal`` money amount."""
    return to_decimal(value).quantize(_MONEY_Q)


def _clean_str(value: object) -> str:
    """Return a stripped string for ``value`` (``""`` for None)."""
    if value is None:
        return ""
    return str(value).strip()


def _get(line: Mapping[str, Any], key: str) -> object:
    """Read ``key`` from a line mapping, tolerating a missing key."""
    return line.get(key) if isinstance(line, Mapping) else None


# ── Line kind + completeness ────────────────────────────────────────────────


def resolve_line_kind(line: Mapping[str, Any]) -> str:
    """Resolve whether a line books labour or plant.

    The persisted invariant is labour XOR plant, but a draft payload may carry
    neither identifier yet (the foreman has picked a worker/machine but not
    saved) - in that case an explicit ``kind`` hint (``"labour"`` / ``"plant"``)
    still lets the completeness rules classify the intent.

    Returns:
        One of ``KIND_LABOUR``, ``KIND_PLANT``, ``KIND_AMBIGUOUS`` (both ids
        set) or ``KIND_UNSPECIFIED`` (neither id and no usable hint).
    """
    has_resource = bool(_clean_str(_get(line, "resource_id")))
    has_equipment = bool(_clean_str(_get(line, "equipment_id")))
    if has_resource and has_equipment:
        return KIND_AMBIGUOUS
    if has_resource:
        return KIND_LABOUR
    if has_equipment:
        return KIND_PLANT
    hint = _clean_str(_get(line, "kind")).lower()
    if hint in ("labour", "labor"):
        return KIND_LABOUR
    if hint in ("plant", "equipment"):
        return KIND_PLANT
    return KIND_UNSPECIFIED


@dataclass(frozen=True)
class LineCompleteness:
    """Outcome of checking one line for completeness.

    Attributes:
        passed: True when the line is well formed.
        kind: The resolved line kind (see :func:`resolve_line_kind`).
        reasons: Machine-readable reason codes for each failed check
            (``"labour_xor_plant"``, ``"hours_positive"``, ``"cost_code_required"``).
    """

    passed: bool
    kind: str
    reasons: tuple[str, ...] = ()


def line_completeness(line: Mapping[str, Any]) -> LineCompleteness:
    """Check a single line: labour XOR plant, hours > 0, cost_code present.

    Args:
        line: A line mapping with ``resource_id`` / ``equipment_id`` /
            ``hours`` / ``cost_code`` (and optional ``kind``).

    Returns:
        A :class:`LineCompleteness` capturing pass/fail plus reason codes.
    """
    reasons: list[str] = []
    kind = resolve_line_kind(line)
    if kind in (KIND_AMBIGUOUS, KIND_UNSPECIFIED):
        reasons.append("labour_xor_plant")
    if to_decimal(_get(line, "hours")) <= 0:
        reasons.append("hours_positive")
    if not _clean_str(_get(line, "cost_code")):
        reasons.append("cost_code_required")
    return LineCompleteness(passed=not reasons, kind=kind, reasons=tuple(reasons))


# ── Per-worker daily hours ──────────────────────────────────────────────────


def worker_key(line: Mapping[str, Any]) -> str | None:
    """Return the labour worker key (``resource_id``) for a line, else None.

    Plant lines (no ``resource_id``) return None - a machine is not a worker and
    is exempt from the per-worker daily cap.
    """
    resource_id = _clean_str(_get(line, "resource_id"))
    return resource_id or None


def sum_hours_by_worker(lines: Sequence[Mapping[str, Any]]) -> dict[str, Decimal]:
    """Sum labour hours per worker across a day's lines.

    Args:
        lines: The day's timesheet lines.

    Returns:
        ``{resource_id: total_hours}`` over labour lines only. Plant lines are
        ignored. Negative or non-numeric hours coerce to 0 so a stray value
        never understates a worker's day below what was actually booked.
    """
    totals: dict[str, Decimal] = {}
    for line in lines:
        key = worker_key(line)
        if key is None:
            continue
        hours = to_decimal(_get(line, "hours"))
        if hours < 0:
            hours = Decimal("0")
        totals[key] = totals.get(key, Decimal("0")) + hours
    return {key: value.quantize(_HOURS_Q) for key, value in totals.items()}


@dataclass(frozen=True)
class WorkerDayHours:
    """A worker's summed hours for a day, with the cap it is checked against."""

    worker_key: str
    hours: Decimal
    max_hours: Decimal

    @property
    def exceeds(self) -> bool:
        """True when the worker's hours exceed the daily cap."""
        return self.hours > self.max_hours


def hours_cap_exceedances(
    lines: Sequence[Mapping[str, Any]],
    *,
    max_hours: Decimal = MAX_HOURS_PER_DAY,
) -> list[WorkerDayHours]:
    """Return the workers whose summed daily hours exceed ``max_hours``.

    Args:
        lines: The day's timesheet lines.
        max_hours: The per-worker daily ceiling (default 24).

    Returns:
        One :class:`WorkerDayHours` per offending worker, sorted by worker key
        for deterministic output. Empty when every worker is within the cap.
    """
    exceed: list[WorkerDayHours] = []
    for key, hours in sorted(sum_hours_by_worker(lines).items()):
        if hours > max_hours:
            exceed.append(WorkerDayHours(worker_key=key, hours=hours, max_hours=max_hours))
    return exceed


# ── Daywork + plant completeness ────────────────────────────────────────────


def is_daywork_line(line: Mapping[str, Any]) -> bool:
    """Return True when a line is flagged as daywork (time-and-material)."""
    return bool(_get(line, "is_daywork"))


def daywork_incomplete_indices(
    lines: Sequence[Mapping[str, Any]],
    *,
    open_variation_ids: set[str] | None = None,
) -> list[int]:
    """Return indices of daywork lines that do not reference an open variation.

    A daywork line must name the variation it was performed under. When
    ``open_variation_ids`` is supplied, the referenced variation must also be
    open (still accepting cost). When it is None, only presence is checked - the
    caller could not resolve variation status, so we do not fail on it.

    Args:
        lines: The timesheet lines.
        open_variation_ids: Variation ids currently open, or None to skip the
            open-status check.

    Returns:
        Sorted list of offending line indices.
    """
    bad: list[int] = []
    for index, line in enumerate(lines):
        if not is_daywork_line(line):
            continue
        variation_id = _clean_str(_get(line, "variation_id"))
        if not variation_id:
            bad.append(index)
            continue
        if open_variation_ids is not None and variation_id not in open_variation_ids:
            bad.append(index)
    return bad


def plant_missing_equipment_indices(lines: Sequence[Mapping[str, Any]]) -> list[int]:
    """Return indices of plant-intent lines that name no equipment item.

    A line that declares plant work (via a ``"plant"`` kind hint) but carries no
    ``equipment_id`` cannot be costed against a machine. This is distinct from
    the labour-XOR-plant completeness error: here the intent is known (plant),
    only the specific machine is missing, so it is a warning the foreman can
    resolve by attaching the equipment.
    """
    bad: list[int] = []
    for index, line in enumerate(lines):
        if _clean_str(_get(line, "equipment_id")):
            continue
        hint = _clean_str(_get(line, "kind")).lower()
        if hint in ("plant", "equipment"):
            bad.append(index)
    return bad


def cost_code_unresolved_indices(
    lines: Sequence[Mapping[str, Any]],
    *,
    valid_cost_codes: set[str] | None,
    valid_wbs: set[str] | None,
) -> list[int]:
    """Return indices of lines whose cost_code / wbs resolves to no position.

    A line resolves when its ``cost_code`` is a known project cost code OR its
    ``wbs`` is a known project WBS code. Lines that carry neither code are left
    to :func:`line_completeness` (which requires a cost_code) and are not flagged
    here. When both resolver sets are None the caller could not load the
    project's codes, so nothing is flagged (resolution is deferred).

    Args:
        lines: The timesheet lines.
        valid_cost_codes: Known project cost codes, or None to skip.
        valid_wbs: Known project WBS codes, or None to skip.

    Returns:
        Sorted list of line indices whose codes resolve to nothing.
    """
    if valid_cost_codes is None and valid_wbs is None:
        return []
    codes = valid_cost_codes or set()
    wbs_codes = valid_wbs or set()
    bad: list[int] = []
    for index, line in enumerate(lines):
        cost_code = _clean_str(_get(line, "cost_code"))
        wbs = _clean_str(_get(line, "wbs"))
        if not cost_code and not wbs:
            continue  # completeness owns the "cost_code required" check
        if cost_code and cost_code in codes:
            continue
        if wbs and wbs in wbs_codes:
            continue
        bad.append(index)
    return bad


# ── Daywork sheet line mapping ──────────────────────────────────────────────


@dataclass(frozen=True)
class DayworkLineDraft:
    """A daywork sheet line derived from an approved daywork timesheet line.

    Mirrors the variations ``DayworkSheetLineCreate`` fields so the field-time
    service can hand it straight to the variations service without re-deriving.
    """

    line_type: str  # "labor" | "equipment" (variations vocabulary)
    description: str
    quantity: Decimal  # hours booked
    unit: str  # "h"
    unit_rate: Decimal  # cost rate per hour
    worker_name: str | None
    equipment_code: str | None
    source_line_id: str | None
    variation_id: str | None


def daywork_line_drafts(
    lines: Sequence[Mapping[str, Any]],
    *,
    labour_rates: Mapping[str, Decimal] | None = None,
    plant_rates: Mapping[str, Decimal] | None = None,
) -> list[DayworkLineDraft]:
    """Map the daywork lines of a timesheet to draft daywork sheet lines.

    Only lines flagged ``is_daywork`` are mapped - ordinary lines flow into cost
    actuals but never onto a signed daywork sheet. Labour lines become
    ``"labor"`` daywork lines, plant lines become ``"equipment"`` lines, and the
    hourly cost rate is looked up from the supplied rate maps (0 when unknown).

    Args:
        lines: The timesheet lines.
        labour_rates: ``{resource_id: hourly_rate}``.
        plant_rates: ``{equipment_id: hourly_rate}``.

    Returns:
        One :class:`DayworkLineDraft` per daywork line, in input order.
    """
    labour = labour_rates or {}
    plant = plant_rates or {}
    drafts: list[DayworkLineDraft] = []
    for line in lines:
        if not is_daywork_line(line):
            continue
        kind = resolve_line_kind(line)
        hours = quantize_hours(_get(line, "hours"))
        resource_id = _clean_str(_get(line, "resource_id"))
        equipment_id = _clean_str(_get(line, "equipment_id"))
        note = _clean_str(_get(line, "note"))
        if kind == KIND_PLANT:
            rate = to_decimal(plant.get(equipment_id)) if equipment_id else Decimal("0")
            line_type = "equipment"
        else:
            rate = to_decimal(labour.get(resource_id)) if resource_id else Decimal("0")
            line_type = "labor"
        drafts.append(
            DayworkLineDraft(
                line_type=line_type,
                description=note or _clean_str(_get(line, "cost_code")) or "Daywork",
                quantity=hours,
                unit="h",
                unit_rate=rate.quantize(Decimal("0.0001")),
                worker_name=resource_id or None,
                equipment_code=equipment_id or None,
                source_line_id=_clean_str(_get(line, "id")) or None,
                variation_id=_clean_str(_get(line, "variation_id")) or None,
            ),
        )
    return drafts


# ── Cost rollup ─────────────────────────────────────────────────────────────


def line_cost(hours: object, rate: object) -> Decimal:
    """Return ``hours * rate`` as a 2 dp money ``Decimal``."""
    return (to_decimal(hours) * to_decimal(rate)).quantize(_MONEY_Q)


@dataclass(frozen=True)
class CostRollup:
    """Hours and cost rolled up over a set of lines, split labour vs plant."""

    labour_hours: Decimal
    plant_hours: Decimal
    labour_cost: Decimal
    plant_cost: Decimal

    @property
    def total_hours(self) -> Decimal:
        """Combined labour + plant hours."""
        return (self.labour_hours + self.plant_hours).quantize(_HOURS_Q)

    @property
    def total_cost(self) -> Decimal:
        """Combined labour + plant cost."""
        return (self.labour_cost + self.plant_cost).quantize(_MONEY_Q)


def rollup(
    lines: Sequence[Mapping[str, Any]],
    *,
    labour_rates: Mapping[str, Decimal] | None = None,
    plant_rates: Mapping[str, Decimal] | None = None,
) -> CostRollup:
    """Roll a timesheet's lines up into labour/plant hours and cost.

    Hours are always counted; cost is ``hours * rate`` where a rate is known and
    0 where it is not (so an unpriced resource still surfaces its hours without
    silently inventing a rate).

    Args:
        lines: The timesheet lines.
        labour_rates: ``{resource_id: hourly_rate}``.
        plant_rates: ``{equipment_id: hourly_rate}``.

    Returns:
        A :class:`CostRollup`.
    """
    labour = labour_rates or {}
    plant = plant_rates or {}
    labour_hours = Decimal("0")
    plant_hours = Decimal("0")
    labour_cost = Decimal("0")
    plant_cost = Decimal("0")
    for line in lines:
        hours = to_decimal(_get(line, "hours"))
        kind = resolve_line_kind(line)
        if kind == KIND_PLANT:
            equipment_id = _clean_str(_get(line, "equipment_id"))
            plant_hours += hours
            plant_cost += hours * to_decimal(plant.get(equipment_id))
        elif kind == KIND_LABOUR:
            resource_id = _clean_str(_get(line, "resource_id"))
            labour_hours += hours
            labour_cost += hours * to_decimal(labour.get(resource_id))
    return CostRollup(
        labour_hours=labour_hours.quantize(_HOURS_Q),
        plant_hours=plant_hours.quantize(_HOURS_Q),
        labour_cost=labour_cost.quantize(_MONEY_Q),
        plant_cost=plant_cost.quantize(_MONEY_Q),
    )


# ── Reversal netting ────────────────────────────────────────────────────────


@dataclass(frozen=True)
class TimesheetContribution:
    """One timesheet's signed contribution to a project's actual hours.

    Attributes:
        hours: The timesheet's total (positive) booked hours.
        is_reversal: True when this timesheet reverses another (contributes
            negative hours so an approved + reversal pair nets to zero).
    """

    hours: Decimal
    is_reversal: bool = False


def net_hours(contributions: Sequence[TimesheetContribution]) -> Decimal:
    """Net signed hours across timesheets, so a reversal cancels its original.

    A normal timesheet contributes ``+hours``; a reversal contributes
    ``-hours``. An approved timesheet plus a reversal that mirrors it therefore
    nets to exactly zero - the accounting-clean way to undo already-counted
    labour without deleting the audit trail.

    Args:
        contributions: The timesheets contributing to the total.

    Returns:
        The net hours as a 2 dp ``Decimal`` (may be zero or, transiently,
        negative if reversals exceed originals).
    """
    total = Decimal("0")
    for item in contributions:
        hours = to_decimal(item.hours)
        total += -hours if item.is_reversal else hours
    return total.quantize(_HOURS_Q)


def reverse_lines(lines: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Build the line payload for a reversing timesheet from an original.

    The reversal mirrors every original line verbatim (same worker/plant, hours,
    cost_code, daywork/variation link) so the reversal is a faithful negative of
    what it corrects. Hours stay positive on the row; the *timesheet* carries the
    reversal sign (see :func:`net_hours`), matching how the payroll and cost
    consumers net an approved original against its reversal.

    Args:
        lines: The original timesheet's lines (mappings).

    Returns:
        A list of plain dicts ready to persist as the reversal's lines.
    """
    mirrored: list[dict[str, Any]] = []
    for line in lines:
        mirrored.append(
            {
                "resource_id": _clean_str(_get(line, "resource_id")) or None,
                "equipment_id": _clean_str(_get(line, "equipment_id")) or None,
                "hours": quantize_hours(_get(line, "hours")),
                "cost_code": _clean_str(_get(line, "cost_code")),
                "wbs": _clean_str(_get(line, "wbs")) or None,
                "is_daywork": bool(_get(line, "is_daywork")),
                "variation_id": _clean_str(_get(line, "variation_id")) or None,
                "note": _clean_str(_get(line, "note")),
            },
        )
    return mirrored


# ── Cost-code suggestions (AI-augmented, human-confirmed) ────────────────────


@dataclass(frozen=True)
class CostCodeSuggestion:
    """A ranked cost-code suggestion for a line, with a confidence score.

    A suggestion is never auto-applied: the API returns it, the foreman confirms
    it, and only then does the line's ``cost_code`` change. ``confidence`` is a
    0.0-1.0 text-similarity score, never a certainty.
    """

    code: str
    label: str
    confidence: float


def _normalise_text(value: str) -> str:
    """Lower-case and collapse a string for fuzzy matching."""
    return " ".join(value.lower().split())


def suggest_cost_codes(
    text: str,
    candidates: Sequence[Mapping[str, Any]],
    *,
    limit: int = 5,
    min_confidence: float = 0.0,
) -> list[CostCodeSuggestion]:
    """Rank candidate cost codes by textual similarity to ``text``.

    A deterministic, dependency-free heuristic (difflib ratio over the candidate
    code + label versus the line's description) that PROPOSES cost codes for a
    line. It never applies them - the caller returns the ranked list to the user
    for confirmation, honouring the AI-augmented / human-confirmed principle.

    Args:
        text: The line description / note to match against.
        candidates: ``[{"code": ..., "label": ...}, ...]`` project cost codes.
        limit: Maximum suggestions to return.
        min_confidence: Drop suggestions below this score.

    Returns:
        Up to ``limit`` :class:`CostCodeSuggestion` sorted by confidence
        descending (ties broken by code for stable output).
    """
    needle = _normalise_text(_clean_str(text))
    if not needle:
        return []
    scored: list[CostCodeSuggestion] = []
    for candidate in candidates:
        code = _clean_str(_get(candidate, "code"))
        if not code:
            continue
        label = _clean_str(_get(candidate, "label"))
        haystack = _normalise_text(f"{code} {label}".strip())
        ratio = SequenceMatcher(None, needle, haystack).ratio()
        confidence = round(ratio, 4)
        if confidence >= min_confidence:
            scored.append(CostCodeSuggestion(code=code, label=label, confidence=confidence))
    scored.sort(key=lambda item: (-item.confidence, item.code))
    return scored[: max(0, limit)]


# ── Aggregate validation summary (used by the service before persistence) ────


@dataclass
class TimesheetChecks:
    """A flat summary of every field-time check over one timesheet payload.

    The service builds this to decide whether a submit is allowed (any
    ``blocking`` reason is an ERROR) and to surface warnings. The colocated
    validation rules recompute the same primitives for the traffic-light
    dashboard, so this stays a convenience aggregate, not a second source of
    truth.
    """

    incomplete_line_indices: list[int] = field(default_factory=list)
    hours_cap_exceedances: list[WorkerDayHours] = field(default_factory=list)
    unresolved_cost_code_indices: list[int] = field(default_factory=list)
    daywork_incomplete_indices: list[int] = field(default_factory=list)
    plant_missing_equipment_indices: list[int] = field(default_factory=list)

    @property
    def has_blocking_errors(self) -> bool:
        """True when any ERROR-severity condition is present."""
        return any(
            (
                self.incomplete_line_indices,
                self.hours_cap_exceedances,
                self.unresolved_cost_code_indices,
            ),
        )


def check_timesheet(
    lines: Sequence[Mapping[str, Any]],
    *,
    valid_cost_codes: set[str] | None = None,
    valid_wbs: set[str] | None = None,
    open_variation_ids: set[str] | None = None,
    max_hours: Decimal = MAX_HOURS_PER_DAY,
) -> TimesheetChecks:
    """Run every timesheet check and return a flat summary.

    Args:
        lines: The timesheet lines.
        valid_cost_codes: Known project cost codes (None to skip resolution).
        valid_wbs: Known project WBS codes (None to skip resolution).
        open_variation_ids: Open variation ids (None to skip the open check).
        max_hours: Per-worker daily cap.

    Returns:
        A :class:`TimesheetChecks` aggregate.
    """
    incomplete = [i for i, line in enumerate(lines) if not line_completeness(line).passed]
    return TimesheetChecks(
        incomplete_line_indices=incomplete,
        hours_cap_exceedances=hours_cap_exceedances(lines, max_hours=max_hours),
        unresolved_cost_code_indices=cost_code_unresolved_indices(
            lines,
            valid_cost_codes=valid_cost_codes,
            valid_wbs=valid_wbs,
        ),
        daywork_incomplete_indices=daywork_incomplete_indices(
            lines,
            open_variation_ids=open_variation_ids,
        ),
        plant_missing_equipment_indices=plant_missing_equipment_indices(lines),
    )
