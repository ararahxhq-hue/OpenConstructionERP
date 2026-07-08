/**
 * API helpers for Price Index (base-to-current cost adjustment).
 *
 * All endpoints are mounted at /api/v1/price-index/. Factors and money are
 * decimal strings in and out (the platform-wide "money / factor as string"
 * convention) so a precise value never loses digits through a JS Number. The
 * app runs with redirect_slashes disabled, so every path keeps its trailing
 * slash.
 */

import { apiGet, apiPost, apiPatch, apiDelete } from '@/shared/lib/api';

const BASE = '/v1/price-index';

/* -- Types ---------------------------------------------------------------- */

export interface CostIndexSeries {
  id: string;
  name: string;
  description: string;
  point_count: number;
  created_at: string;
  updated_at: string;
}

export interface CostIndexPoint {
  id: string;
  series_id: string;
  /** ISO year-month, e.g. "2026-01". */
  period: string;
  factor: string;
  created_at: string;
  updated_at: string;
}

export interface CostIndexSeriesDetail extends CostIndexSeries {
  points: CostIndexPoint[];
}

export interface LocationFactor {
  id: string;
  region_code: string;
  label: string;
  factor: string;
  created_at: string;
  updated_at: string;
}

export interface AdjustLineInput {
  amount: string;
  base_period: string;
  target_period: string;
  base_region?: string | null;
  target_region?: string | null;
}

export interface AdjustLineResult {
  amount: string;
  base_period: string;
  target_period: string;
  base_region: string | null;
  target_region: string | null;
  temporal_factor: string | null;
  location_factor: string | null;
  applied_factor: string | null;
  adjusted_amount: string | null;
  note: string | null;
  error: string | null;
}

export interface AdjustResponse {
  series_id: string;
  series_name: string;
  results: AdjustLineResult[];
}

export interface CreateSeriesPayload {
  name: string;
  description?: string;
}

export interface CreatePointPayload {
  period: string;
  factor: string;
}

export interface CreateLocationFactorPayload {
  region_code: string;
  label?: string;
  factor: string;
}

/* -- Pure helpers (unit-tested) ------------------------------------------- */

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True when `period` is an ISO year-month string with a real month (01-12). */
export function isValidPeriod(period: string | null | undefined): boolean {
  if (!period) return false;
  return PERIOD_RE.test(period.trim());
}

/**
 * Render a factor decimal string for display, trimming trailing zeros
 * ("1.400000" -> "1.4", "1.000000" -> "1", "0.900000" -> "0.9"). Pure string
 * work - no Number parse - so an exact stored value is never rounded.
 */
export function formatFactor(raw: string | null | undefined): string {
  if (raw == null || raw === '') return '';
  const text = String(raw).trim();
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
}

export type FactorDirection = 'up' | 'down' | 'flat';

/**
 * Classify a multiplier for a display tone: above one is "up" (costs rose),
 * below one is "down", exactly one (or unparseable) is "flat". Display-only -
 * never used for money math.
 */
export function factorDirection(raw: string | null | undefined): FactorDirection {
  if (raw == null || raw === '') return 'flat';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'flat';
  if (n > 1) return 'up';
  if (n < 1) return 'down';
  return 'flat';
}

/** A blank adjust line for seeding the editor. */
export function blankAdjustLine(): AdjustLineInput {
  return {
    amount: '',
    base_period: '',
    target_period: '',
    base_region: '',
    target_region: '',
  };
}

/**
 * True when a line is complete enough to send: a non-negative amount and two
 * valid periods. Regions are optional (a blank region means the national
 * baseline of 1).
 */
export function isAdjustLineReady(line: AdjustLineInput): boolean {
  const amount = Number(line.amount);
  if (!Number.isFinite(amount) || amount < 0 || line.amount.trim() === '') return false;
  return isValidPeriod(line.base_period) && isValidPeriod(line.target_period);
}

/* -- Series --------------------------------------------------------------- */

export async function listSeries(): Promise<CostIndexSeries[]> {
  const res = await apiGet<CostIndexSeries[]>(`${BASE}/series/`);
  return Array.isArray(res) ? res : [];
}

export async function fetchSeries(id: string): Promise<CostIndexSeriesDetail> {
  return apiGet<CostIndexSeriesDetail>(`${BASE}/series/${id}/`);
}

export async function createSeries(data: CreateSeriesPayload): Promise<CostIndexSeries> {
  return apiPost<CostIndexSeries>(`${BASE}/series/`, data);
}

export async function updateSeries(
  id: string,
  data: Partial<CreateSeriesPayload>,
): Promise<CostIndexSeries> {
  return apiPatch<CostIndexSeries>(`${BASE}/series/${id}/`, data);
}

export async function deleteSeries(id: string): Promise<void> {
  return apiDelete(`${BASE}/series/${id}/`);
}

/* -- Points --------------------------------------------------------------- */

export async function addPoint(seriesId: string, data: CreatePointPayload): Promise<CostIndexPoint> {
  return apiPost<CostIndexPoint>(`${BASE}/series/${seriesId}/points/`, data);
}

export async function deletePoint(seriesId: string, pointId: string): Promise<void> {
  return apiDelete(`${BASE}/series/${seriesId}/points/${pointId}/`);
}

/* -- Location factors ----------------------------------------------------- */

export async function listLocationFactors(): Promise<LocationFactor[]> {
  const res = await apiGet<LocationFactor[]>(`${BASE}/location-factors/`);
  return Array.isArray(res) ? res : [];
}

export async function createLocationFactor(
  data: CreateLocationFactorPayload,
): Promise<LocationFactor> {
  return apiPost<LocationFactor>(`${BASE}/location-factors/`, data);
}

export async function deleteLocationFactor(id: string): Promise<void> {
  return apiDelete(`${BASE}/location-factors/${id}/`);
}

/* -- Adjust --------------------------------------------------------------- */

export async function adjustAmounts(
  seriesId: string,
  lines: AdjustLineInput[],
): Promise<AdjustResponse> {
  const payload = {
    series_id: seriesId,
    lines: lines.map((l) => ({
      amount: l.amount,
      base_period: l.base_period,
      target_period: l.target_period,
      base_region: l.base_region || null,
      target_region: l.target_region || null,
    })),
  };
  return apiPost<AdjustResponse>(`${BASE}/adjust/`, payload);
}
