/**
 * API helpers for Common Data Environment (CDE) — ISO 19650.
 *
 * All endpoints are prefixed with /v1/cde/.
 */

import { apiGet, apiPost } from '@/shared/lib/api';

/* ── Types ─────────────────────────────────────────────────────────────── */

export type CDEState = 'wip' | 'shared' | 'published' | 'archived';

export type CDEDiscipline =
  | 'architecture'
  | 'structural'
  | 'mep'
  | 'civil'
  | 'landscape'
  | 'interior'
  | 'other';

export interface CDERevision {
  id: string;
  container_id: string;
  revision_code: string;
  date: string;
  status: CDEState;
  filename: string | null;
  file_size: number | null;
  change_summary: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CDEContainer {
  id: string;
  project_id: string;
  container_code: string;
  title: string;
  discipline: CDEDiscipline;
  state: CDEState;
  suitability_code: string | null;
  current_revision: string;
  classification: string | null;
  revision_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CDEContainerFilters {
  project_id?: string;
  state?: CDEState | '';
}

export interface CreateCDEContainerPayload {
  project_id: string;
  container_code: string;
  title: string;
  discipline: CDEDiscipline;
  suitability_code?: string;
  classification?: string;
}

export interface TransitionPayload {
  target_state: CDEState;
  comments?: string;
}

/* ── API Functions ─────────────────────────────────────────────────────── */

export async function fetchCDEContainers(
  filters?: CDEContainerFilters,
): Promise<CDEContainer[]> {
  const params = new URLSearchParams();
  if (filters?.project_id) params.set('project_id', filters.project_id);
  if (filters?.state) params.set('state', filters.state);
  const qs = params.toString();
  return apiGet<CDEContainer[]>(`/v1/cde/containers${qs ? `?${qs}` : ''}`);
}

export async function createCDEContainer(
  data: CreateCDEContainerPayload,
): Promise<CDEContainer> {
  return apiPost<CDEContainer>('/v1/cde/containers', data);
}

export async function transitionContainer(
  id: string,
  data: TransitionPayload,
): Promise<CDEContainer> {
  return apiPost<CDEContainer>(`/v1/cde/containers/${id}/transition`, data);
}

export async function fetchContainerRevisions(id: string): Promise<CDERevision[]> {
  return apiGet<CDERevision[]>(`/v1/cde/containers/${id}/revisions`);
}
