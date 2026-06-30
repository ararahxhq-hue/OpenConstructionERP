// Unit tests for the pure 6D auto-enrich helpers. No DOM / i18next needed.
import { describe, it, expect } from 'vitest';

import type { AutoEnrichBimResult, EmbodiedEntry } from './api';
import { summarizeEnrich, sourceLabel, sourcePillVariant } from './sixd';

function mkEntry(over: Partial<EmbodiedEntry> = {}): EmbodiedEntry {
  return {
    id: 'e1',
    inventory_id: 'inv1',
    element_id: 'el-1',
    source: 'auto_enriched',
    match_confidence: 'high',
    description: 'Wall',
    quantity: '9',
    unit: 'm3',
    factor_value_used: '300',
    carbon_kg: '2700',
    stage: 'a1a3',
    metadata: {},
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function result(over: Partial<AutoEnrichBimResult> = {}): AutoEnrichBimResult {
  return {
    created: 0,
    skipped_no_match: 0,
    skipped_no_quantity: 0,
    entries: [],
    ...over,
  };
}

describe('summarizeEnrich', () => {
  it('counts matched proposals from entries, not the persisted counter (dry-run preview)', () => {
    // The backend reports created=0 during a dry-run preview (nothing persisted
    // yet) while still returning every proposal in `entries`. The summary must
    // reflect the proposals so the preview -> confirm flow stays reachable.
    const s = summarizeEnrich(
      result({
        created: 0,
        entries: [mkEntry(), mkEntry(), mkEntry()],
        skipped_no_match: 3,
        skipped_no_quantity: 5,
      }),
    );
    expect(s.created).toBe(3);
    expect(s.hasProposals).toBe(true);
    expect(s.totalSkipped).toBe(8);
    expect(s.totalConsidered).toBe(11);
  });

  it('reports no proposals when entries is empty', () => {
    const s = summarizeEnrich(result({ created: 0, skipped_no_match: 4, skipped_no_quantity: 2 }));
    expect(s.hasProposals).toBe(false);
    expect(s.totalSkipped).toBe(6);
    expect(s.totalConsidered).toBe(6);
  });

  it('folds skipped_existing into the totals (idempotency)', () => {
    const s = summarizeEnrich(
      result({ entries: [mkEntry()], skipped_no_match: 1, skipped_no_quantity: 2, skipped_existing: 4 }),
    );
    expect(s.created).toBe(1);
    expect(s.skippedExisting).toBe(4);
    expect(s.totalSkipped).toBe(7);
    expect(s.totalConsidered).toBe(8);
  });

  it('treats null / missing / negative counters as zero (never NaN)', () => {
    expect(summarizeEnrich(null)).toEqual({
      created: 0,
      skippedNoMatch: 0,
      skippedNoQuantity: 0,
      skippedExisting: 0,
      totalSkipped: 0,
      totalConsidered: 0,
      hasProposals: false,
    });
    const partial = { entries: [] } as unknown as AutoEnrichBimResult;
    expect(summarizeEnrich(partial).totalConsidered).toBe(0);
    const negative = result({ entries: [mkEntry()], skipped_no_match: -1, skipped_existing: -2 });
    const s = summarizeEnrich(negative);
    expect(s.skippedNoMatch).toBe(0);
    expect(s.skippedExisting).toBe(0);
    expect(Number.isNaN(s.totalConsidered)).toBe(false);
  });

  it('floors fractional counters (created fallback + skips)', () => {
    // When `entries` is absent the matched count falls back to the persisted
    // counter, which is floored like every other counter.
    const noEntries = { created: 2.9, skipped_no_quantity: 1.2 } as unknown as AutoEnrichBimResult;
    const s = summarizeEnrich(noEntries);
    expect(s.created).toBe(2);
    expect(s.skippedNoQuantity).toBe(1);
  });

  it('accepts a real EmbodiedEntry payload in entries', () => {
    const s = summarizeEnrich(result({ entries: [mkEntry({ unit: 'm3' })] }));
    expect(s.created).toBe(1);
    expect(s.hasProposals).toBe(true);
  });
});

describe('sourceLabel', () => {
  it('maps each known source to its key + default', () => {
    expect(sourceLabel('auto_enriched')).toEqual({
      key: 'carbon.sixd.source_auto',
      defaultValue: 'Auto from BIM',
    });
    expect(sourceLabel('boq_derived')).toEqual({
      key: 'carbon.sixd.source_boq',
      defaultValue: 'From BOQ',
    });
    expect(sourceLabel('manual')).toEqual({
      key: 'carbon.sixd.source_manual',
      defaultValue: 'Manual',
    });
  });

  it('falls back to manual for null / undefined (legacy rows)', () => {
    expect(sourceLabel(null).key).toBe('carbon.sixd.source_manual');
    expect(sourceLabel(undefined).key).toBe('carbon.sixd.source_manual');
  });
});

describe('sourcePillVariant', () => {
  it('highlights auto-from-BIM and keeps the rest neutral', () => {
    expect(sourcePillVariant('auto_enriched')).toBe('blue');
    expect(sourcePillVariant('boq_derived')).toBe('neutral');
    expect(sourcePillVariant('manual')).toBe('neutral');
    expect(sourcePillVariant(null)).toBe('neutral');
  });
});
