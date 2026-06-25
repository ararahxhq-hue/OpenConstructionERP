// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Wire types for the change-provability API (#6). The provability score grades
// how strong the contemporaneous record behind one change / claim is, from the
// evidence already on the project, with a transparent per-signal breakdown so
// the UI can show exactly what to cure. The score is a pure 0-100 integer; the
// band is the engine's own classification and is never re-thresholded here.

export type ProvabilityBand = 'weak' | 'moderate' | 'strong';

export interface ProvabilitySubScore {
  signal: string;
  weight: number;
  earned: number;
  fraction: number;
  // True once the signal is fully satisfied (the backend sets this from
  // earned >= weight) so a gauge can render a present / missing row directly.
  present: boolean;
}

export interface ProvabilityWeakness {
  token: string;
  message: string;
  signal: string;
  points_lost: number;
}

export interface ProvabilityScore {
  subject_kind: string;
  subject_id: string;
  subject_ref: string;
  score: number;
  band: ProvabilityBand;
  sub_scores: ProvabilitySubScore[];
  weaknesses: ProvabilityWeakness[];
  entry_count: number;
  date_from: string | null;
  date_to: string | null;
}
