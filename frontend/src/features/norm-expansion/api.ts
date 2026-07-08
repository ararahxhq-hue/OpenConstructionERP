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
