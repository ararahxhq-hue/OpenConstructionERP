/**
 * Regression guard for Issue #292 (imperial): a quantity-cell formula that
 * reuses another position's quantity, e.g. =pos("01.005").qty, must reproduce
 * the referenced metric-canonical quantity after the display-to-metric commit
 * seam, in BOTH measurement systems.
 *
 * The FormulaCellEditor projects each context position's metric quantity into
 * the active display unit before evaluation, so the commit seam (toMetricQty ->
 * fromDisplayQuantity) converts exactly once. Feeding raw metric positions
 * would let the seam convert a SECOND time in imperial mode (dividing by the ft
 * factor again), a #285-class quantity corruption. These tests lock in the
 * round-trip against the real conversion primitives the editor uses.
 */
import { describe, it, expect } from 'vitest';

import { buildFormulaContext, evaluateFormula } from './formula';
import type { Position } from '../api';
import { toDisplayQuantity, fromDisplayQuantity } from '@/shared/lib/unitConversion';

type System = 'metric' | 'imperial';

// A position carrying just the fields the formula engine reads (ordinal, id,
// quantity, unit_rate); the rest of Position is irrelevant here.
function makePosition(ordinal: string, quantityMetric: number, unit: string): Position {
  return {
    id: ordinal,
    ordinal,
    unit,
    quantity: quantityMetric,
    unit_rate: 0,
  } as unknown as Position;
}

// Mirror what FormulaCellEditor does: project each context position's metric
// quantity into the active display unit before building the formula context.
function projectedContext(positions: Position[], system: System) {
  const projected = positions.map((p) => ({
    ...p,
    quantity: toDisplayQuantity(Number(p.quantity) || 0, p.unit, system).value,
  })) as unknown as Position[];
  return buildFormulaContext({ positions: projected });
}

// The commit seam the editor applies to a resolved formula value.
function storeFromDisplay(resolved: number, unit: string, system: System): number {
  return fromDisplayQuantity(resolved, unit, system);
}

describe('quantity-cell reference reuse round-trips through the display seam (#292)', () => {
  it('metric mode is a no-op: =pos().qty stores the referenced metric value', () => {
    const ctx = projectedContext([makePosition('01.001', 3.048, 'm')], 'metric');
    const resolved = evaluateFormula('=pos("01.001").qty', ctx);
    expect(resolved).not.toBeNull();
    expect(storeFromDisplay(resolved as number, 'm', 'metric')).toBeCloseTo(3.048, 6);
  });

  it('imperial length: =pos().qty resolves in feet and stores the original metres', () => {
    const ctx = projectedContext([makePosition('01.001', 3.048, 'm')], 'imperial'); // 10 ft
    const resolved = evaluateFormula('=pos("01.001").qty', ctx);
    expect(resolved).not.toBeNull();
    expect(resolved as number).toBeCloseTo(10, 4); // displayed feet, not metres
    expect(storeFromDisplay(resolved as number, 'm', 'imperial')).toBeCloseTo(3.048, 6);
  });

  it('imperial area: =pos().qty round-trips m2 to ft2 and back', () => {
    const ctx = projectedContext([makePosition('02.001', 10, 'm2')], 'imperial');
    const resolved = evaluateFormula('=pos("02.001").qty', ctx);
    expect(resolved).not.toBeNull();
    expect(resolved as number).toBeCloseTo(107.639, 2);
    expect(storeFromDisplay(resolved as number, 'm2', 'imperial')).toBeCloseTo(10, 6);
  });

  it('imperial with arithmetic: =pos().qty * 2 stays consistent end to end', () => {
    const ctx = projectedContext([makePosition('01.001', 3.048, 'm')], 'imperial');
    const resolved = evaluateFormula('=pos("01.001").qty * 2', ctx);
    expect(resolved).not.toBeNull();
    expect(resolved as number).toBeCloseTo(20, 3); // 2 * 10 ft
    expect(storeFromDisplay(resolved as number, 'm', 'imperial')).toBeCloseTo(6.096, 6);
  });
});
