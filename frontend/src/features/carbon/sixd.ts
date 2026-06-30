// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Pure helpers for the 6D (BIM auto-enrich) carbon flow. No React, no i18next
// here: each label helper returns a stable key + English default so the
// component resolves it through t(key, { defaultValue }). Kept side-effect free
// so it can be unit-tested without a DOM.

import type { AutoEnrichBimResult, EmbodiedSource } from './api';

/** Subset of the design-system Badge variants the source pill uses. Narrower
 *  than Badge's full union on purpose, and assignable to it. */
export type SourcePillVariant = 'neutral' | 'blue';

/** Plain-number summary of an auto-enrich pass, ready for display. */
export interface EnrichSummary {
  /** Elements matched to a factor (created, or creatable in a dry run). */
  created: number;
  /** Elements skipped because no material carbon factor matched. */
  skippedNoMatch: number;
  /** Elements skipped because they carried no usable quantity. */
  skippedNoQuantity: number;
  /** Elements skipped because this inventory already has an auto-enriched
   *  entry linked to them (idempotency - re-running never double-counts). */
  skippedExisting: number;
  /** All skipped elements (no-match + no-quantity + already-linked). */
  totalSkipped: number;
  /** Every element the pass looked at. */
  totalConsidered: number;
  /** True when there is at least one proposal worth confirming. */
  hasProposals: boolean;
}

/** A non-negative integer view of a possibly-missing counter. */
function count(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Fold an {@link AutoEnrichBimResult} into display counters. Tolerates a
 * partial / malformed payload (missing counters become 0) so the preview UI
 * never renders NaN.
 */
export function summarizeEnrich(result: AutoEnrichBimResult | null | undefined): EnrichSummary {
  // The matched/creatable count is the number of proposals the pass returned.
  // A dry-run preview reports created=0 (nothing persisted yet) while still
  // returning every proposal in `entries`, so count the proposals directly and
  // fall back to the persisted counter only when `entries` is absent.
  const created = Array.isArray(result?.entries)
    ? result.entries.length
    : count(result?.created);
  const skippedNoMatch = count(result?.skipped_no_match);
  const skippedNoQuantity = count(result?.skipped_no_quantity);
  const skippedExisting = count(result?.skipped_existing);
  const totalSkipped = skippedNoMatch + skippedNoQuantity + skippedExisting;
  return {
    created,
    skippedNoMatch,
    skippedNoQuantity,
    skippedExisting,
    totalSkipped,
    totalConsidered: created + totalSkipped,
    hasProposals: created > 0,
  };
}

/** A label resolvable through i18next: stable key plus its English default. */
export interface SourceLabelDescriptor {
  key: string;
  defaultValue: string;
}

/**
 * Map an embodied-entry source to a short pill label. An absent / unknown
 * source is treated as manual, matching the backend's legacy-row behaviour.
 */
export function sourceLabel(source: EmbodiedSource | null | undefined): SourceLabelDescriptor {
  switch (source) {
    case 'auto_enriched':
      return { key: 'carbon.sixd.source_auto', defaultValue: 'Auto from BIM' };
    case 'boq_derived':
      return { key: 'carbon.sixd.source_boq', defaultValue: 'From BOQ' };
    case 'manual':
    default:
      return { key: 'carbon.sixd.source_manual', defaultValue: 'Manual' };
  }
}

/** Badge colour for a source pill. Auto-from-BIM stands out (blue); the
 *  others are quiet neutrals so the list stays calm. */
export function sourcePillVariant(source: EmbodiedSource | null | undefined): SourcePillVariant {
  return source === 'auto_enriched' ? 'blue' : 'neutral';
}
