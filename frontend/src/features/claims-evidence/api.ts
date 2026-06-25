// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// API client for the claims-evidence provability surface (#6). Grades how
// provable one change / claim is from the evidence already on the project and
// returns the 0-100 score, its band and the per-signal breakdown plus the cure
// list. Read-only; nothing is persisted server-side.

import { apiGet } from '@/shared/lib/api';
import type { ProvabilityScore } from './types';

const BASE = '/v1/claims-evidence';

// The change families a subject can be (mirrors the backend subject kinds).
export type SubjectKind =
  | 'change_order'
  | 'variation_notice'
  | 'variation_request'
  | 'variation_order'
  | 'moc_entry';

export function getChangeProvability(
  projectId: string,
  subjectKind: SubjectKind,
  subjectId: string,
): Promise<ProvabilityScore> {
  return apiGet<ProvabilityScore>(
    `${BASE}/projects/${encodeURIComponent(projectId)}/changes/${encodeURIComponent(
      subjectKind,
    )}/${encodeURIComponent(subjectId)}/provability`,
  );
}
