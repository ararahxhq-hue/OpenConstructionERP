// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * API helpers for Production-Norm Expansion.
 *
 * Every path is built from BASE ('/v1/norm-expansion'); apiGet / apiPost already
 * prepend '/api', so we never write '/api/v1' here. All coefficients and expanded
 * quantities cross the wire as Decimal-as-string (e.g. "0.4500", "120.0000"),
 * never a number: format them for display with fmtNumber / toNum and never call
 * .toFixed on a raw wire value or add two of them with '+'.
 */

import { apiGet, apiPost, apiPatch, apiDelete } from '@/shared/lib/api';

const BASE = '/v1/norm-expansion';

/* ── Types ─────────────────────────────────────────────────────────────── */

/** A material a norm consumes per unit. `qty_per_unit` is Decimal-as-string. */
export interface NormMaterial {
  id: string;
  norm_id: string;
  name: string;
  unit: string;
  qty_per_unit: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** A production norm. Coefficient fields are Decimal-as-string. */
export interface ProductionNorm {
  id: string;
  work_key: string;
  name: string;
  unit: string;
  category: string;
  labor_hours_per_unit: string;
  machine_hours_per_unit: string;
  notes: string;
  is_active: boolean;
  materials: NormMaterial[];
  created_at: string;
  updated_at: string;
}

/** One expanded, unpriced material demand line. `qty` is Decimal-as-string. */
export interface MaterialDemand {
  name: string;
  unit: string;
  qty: string;
}

/** The unpriced resource demand behind a quantity of one work item. */
export interface ExpansionResult {
  work_key: string;
  name: string;
  unit: string;
  quantity: string;
  labor_hours: string;
  machine_hours: string;
  materials: MaterialDemand[];
}

/** Batch expansion result plus any work keys that matched no norm. */
export interface ExpandBatchResponse {
  results: ExpansionResult[];
  unmatched: string[];
}

/* ── Payloads ──────────────────────────────────────────────────────────── */

export interface NormMaterialCreatePayload {
  name: string;
  unit: string;
  qty_per_unit?: string;
  sort_order?: number;
}

export interface CreateNormPayload {
  work_key: string;
  name?: string;
  unit: string;
  category?: string;
  labor_hours_per_unit?: string;
  machine_hours_per_unit?: string;
  notes?: string;
  is_active?: boolean;
  materials?: NormMaterialCreatePayload[];
}

export type UpdateNormPayload = Partial<Omit<CreateNormPayload, 'materials'>>;

export interface ExpandItem {
  work_key: string;
  quantity: string;
}

export interface ExpandBatchPayload {
  items: ExpandItem[];
}

/* ── Norm library CRUD ─────────────────────────────────────────────────── */

export interface FetchNormsParams {
  q?: string;
  category?: string;
  activeOnly?: boolean;
}

export async function fetchNorms(params: FetchNormsParams = {}): Promise<ProductionNorm[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.activeOnly) qs.set('active_only', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<ProductionNorm[]>(`${BASE}/norms/${suffix}`);
}

export async function createNorm(data: CreateNormPayload): Promise<ProductionNorm> {
  return apiPost<ProductionNorm>(`${BASE}/norms/`, data);
}

export async function updateNorm(id: string, data: UpdateNormPayload): Promise<ProductionNorm> {
  return apiPatch<ProductionNorm>(`${BASE}/norms/${id}`, data);
}

export async function deleteNorm(id: string): Promise<void> {
  return apiDelete<void>(`${BASE}/norms/${id}`);
}

export async function addNormMaterial(
  normId: string,
  data: NormMaterialCreatePayload,
): Promise<NormMaterial> {
  return apiPost<NormMaterial>(`${BASE}/norms/${normId}/materials/`, data);
}

export async function deleteNormMaterial(materialId: string): Promise<void> {
  return apiDelete<void>(`${BASE}/materials/${materialId}`);
}

/* ── Expansion ─────────────────────────────────────────────────────────── */

export async function expandWork(data: ExpandItem): Promise<ExpansionResult> {
  return apiPost<ExpansionResult>(`${BASE}/expand`, data);
}

export async function expandBatch(data: ExpandBatchPayload): Promise<ExpandBatchResponse> {
  return apiPost<ExpandBatchResponse>(`${BASE}/expand-batch`, data);
}

/* ── Priced assembly build ─────────────────────────────────────────────── */

/**
 * One priced component of an assembly built from a norm.
 *
 * Every numeric field (`quantity`, `unit_cost`, `total`, and the waste figures)
 * crosses the wire as Decimal-as-string and MUST be rendered verbatim - never
 * parsed into a float and re-formatted, which would corrupt money / precision.
 * `quantity` is the per-unit coefficient (the NET / installed quantity for a
 * material). The waste fields describe the net -> gross allowance folded into
 * `total`; they are `null` for labour / equipment, where no waste applies.
 */
export interface PricedComponent {
  /** Canonical resource token: `labor` | `equipment` | `material` (or null). */
  resource_type: string | null;
  description: string;
  unit: string;
  quantity: string;
  unit_cost: string;
  total: string;
  cost_item_id: string | null;
  priced: boolean;
  unpriced_reason: string;
  net_qty: string | null;
  waste_pct: string | null;
  gross_qty: string | null;
  waste_matched: boolean | null;
}

/**
 * The assembly built and saved from a production norm.
 *
 * `total_rate` is the built-up unit rate (Decimal-as-string). `unpriced` lists
 * the descriptions of lines that could not be priced; `waste_unmatched` lists
 * the materials grossed up at pass-through because the waste-factor library had
 * no entry for them. `waste_applied` echoes whether waste was requested.
 */
export interface BuildAssemblyResult {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  currency: string;
  total_rate: string;
  project_id: string | null;
  is_template: boolean;
  work_key: string;
  components: PricedComponent[];
  unpriced: string[];
  waste_applied: boolean;
  waste_unmatched: string[];
}

/** Request body for building a priced assembly from a norm. */
export interface BuildAssemblyPayload {
  labor_rate_template_id?: string;
  machine_rate_template_id?: string;
  project_id?: string;
  region?: string;
  apply_waste?: boolean;
}

/** Build (and persist) a priced assembly from a production norm's coefficients. */
export async function buildAssemblyFromNorm(
  normId: string,
  data: BuildAssemblyPayload,
): Promise<BuildAssemblyResult> {
  return apiPost<BuildAssemblyResult>(`${BASE}/norms/${normId}/build-assembly`, data);
}

/* ── Pure helpers (unit-tested) ────────────────────────────────────────── */

/**
 * True when `q` is a finite, strictly-positive quantity.
 *
 * Used to gate the Expand button so we never POST a blank, zero, negative or
 * non-numeric quantity (the backend requires `quantity > 0`). The string is
 * parsed, never mutated, so a Decimal-as-string like "12.5" stays exact on the
 * wire.
 */
export function isValidQuantity(q: string): boolean {
  const trimmed = q.trim();
  if (trimmed === '') return false;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0;
}

/**
 * Build a batch-expand payload from raw form rows.
 *
 * Drops any row whose `work_key` is blank or whose `quantity` is not a valid
 * positive number, and trims the work key. The quantity string is passed
 * through verbatim (no float round-trip) so precision is preserved end to end.
 */
export function buildExpandBatchPayload(
  rows: { work_key: string; quantity: string }[],
): ExpandBatchPayload {
  const items: ExpandItem[] = rows
    .map((r) => ({ work_key: r.work_key.trim(), quantity: r.quantity.trim() }))
    .filter((r) => r.work_key !== '' && isValidQuantity(r.quantity));
  return { items };
}

/** Raw editor state behind the build-assembly panel (all strings for inputs). */
export interface BuildAssemblyFormInput {
  laborRateTemplateId: string;
  machineRateTemplateId: string;
  region: string;
  applyWaste: boolean;
}

/**
 * Build the build-assembly request body from the panel's form state.
 *
 * Empty optional selections are omitted so the backend treats them as absent
 * (an omitted labour-rate template leaves labour unpriced and flagged; an
 * omitted region skips the region hint). `apply_waste` is always sent so the
 * toggle's state is explicit on the wire rather than relying on the server
 * default flipping under us.
 */
export function buildBuildAssemblyPayload(input: BuildAssemblyFormInput): BuildAssemblyPayload {
  const payload: BuildAssemblyPayload = { apply_waste: input.applyWaste };
  const labor = input.laborRateTemplateId.trim();
  if (labor !== '') payload.labor_rate_template_id = labor;
  const machine = input.machineRateTemplateId.trim();
  if (machine !== '') payload.machine_rate_template_id = machine;
  const region = input.region.trim();
  if (region !== '') payload.region = region;
  return payload;
}

/** The canonical resource kinds a priced line can carry. */
export type ResourceKind = 'labor' | 'equipment' | 'material' | 'other';

/** A resource-type badge: a single letter plus the UI variant to tint it. */
export interface ResourceBadgeInfo {
  letter: string;
  variant: 'blue' | 'success' | 'warning' | 'neutral';
  kind: ResourceKind;
}

/**
 * Map a priced component's `resource_type` to a compact badge (letter + tint).
 *
 * Labour -> L, Equipment -> E, Material -> M; an unknown or missing type falls
 * back to a neutral '?' so a new backend resource token never renders blank.
 * The comparison is case-insensitive and pure, so it is unit-tested without the
 * component.
 */
export function resourceBadge(resourceType: string | null | undefined): ResourceBadgeInfo {
  switch ((resourceType ?? '').trim().toLowerCase()) {
    case 'labor':
      return { letter: 'L', variant: 'blue', kind: 'labor' };
    case 'equipment':
      return { letter: 'E', variant: 'warning', kind: 'equipment' };
    case 'material':
      return { letter: 'M', variant: 'success', kind: 'material' };
    default:
      return { letter: '?', variant: 'neutral', kind: 'other' };
  }
}

/**
 * Append an optional currency label to a Decimal-as-string money value,
 * verbatim.
 *
 * The value is never parsed or re-formatted, so its exact wire precision
 * (including trailing zeros) is preserved - the platform's Decimal-as-string
 * money contract. A blank currency yields the bare value.
 */
export function withCurrency(value: string, currency?: string | null): string {
  const cur = (currency ?? '').trim();
  return cur ? `${value} ${cur}` : value;
}
