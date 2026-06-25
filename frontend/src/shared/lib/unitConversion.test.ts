/**
 * Unit tests for the metric <-> imperial conversion helpers.
 *
 * Pure functions, no DOM. Covers length, area and volume in both
 * directions, the superscript area / volume variants used by the takeoff
 * layer ("m2" / "m" forms), the metric-display normalisation, and the
 * unknown-unit pass-through.
 */

import { describe, it, expect } from 'vitest';
import {
  convertUnit,
  getDisplayUnit,
  isMetricUnit,
} from './unitConversion';

describe('convertUnit - metric to imperial', () => {
  it('converts length m -> ft', () => {
    const r = convertUnit(10, 'm', 'imperial');
    expect(r.value).toBeCloseTo(32.808399, 5);
    expect(r.unit).toBe('ft');
    expect(r.displayUnit).toBe('ft');
  });

  it('converts area m2 -> ft2', () => {
    const r = convertUnit(10, 'm2', 'imperial');
    expect(r.value).toBeCloseTo(107.639, 3);
    expect(r.unit).toBe('ft2');
    expect(r.displayUnit).toBe('sq ft');
  });

  it('converts volume m3 -> ft3', () => {
    const r = convertUnit(10, 'm3', 'imperial');
    expect(r.value).toBeCloseTo(353.147, 3);
    expect(r.unit).toBe('ft3');
    expect(r.displayUnit).toBe('cu ft');
  });

  it('converts the superscript area unit m² -> ft²', () => {
    const r = convertUnit(10, 'm²', 'imperial');
    expect(r.value).toBeCloseTo(107.639, 3);
    expect(r.unit).toBe('ft2');
    // Superscript source keeps the superscript display style.
    expect(r.displayUnit).toBe('ft²');
  });

  it('converts the superscript volume unit m³ -> ft³', () => {
    const r = convertUnit(10, 'm³', 'imperial');
    expect(r.value).toBeCloseTo(353.147, 3);
    expect(r.unit).toBe('ft3');
    expect(r.displayUnit).toBe('ft³');
  });

  it('leaves a countable / unmapped unit unchanged', () => {
    const r = convertUnit(7, 'pcs', 'imperial');
    expect(r.value).toBe(7);
    expect(r.displayUnit).toBe('pcs');
  });
});

describe('convertUnit - imperial to metric', () => {
  it('converts length ft -> m', () => {
    const r = convertUnit(32.808399, 'ft', 'metric');
    expect(r.value).toBeCloseTo(10, 4);
    expect(r.unit).toBe('m');
  });

  it('converts area ft2 -> m2', () => {
    const r = convertUnit(107.639, 'ft2', 'metric');
    expect(r.value).toBeCloseTo(10, 3);
    expect(r.unit).toBe('m2');
  });

  it('converts volume ft3 -> m3', () => {
    const r = convertUnit(353.147, 'ft3', 'metric');
    expect(r.value).toBeCloseTo(10, 3);
    expect(r.unit).toBe('m3');
  });
});

describe('convertUnit - round-trip', () => {
  it('m -> ft -> m is identity within tolerance', () => {
    const ft = convertUnit(12.34, 'm', 'imperial');
    const back = convertUnit(ft.value, 'ft', 'metric');
    expect(back.value).toBeCloseTo(12.34, 4);
  });
});

describe('getDisplayUnit', () => {
  it('normalises ascii metric area / volume to superscripts', () => {
    expect(getDisplayUnit('m2')).toBe('m²');
    expect(getDisplayUnit('m3')).toBe('m³');
  });

  it('keeps already-superscript metric units as-is', () => {
    expect(getDisplayUnit('m²')).toBe('m²');
    expect(getDisplayUnit('m³')).toBe('m³');
  });

  it('falls back to the raw code for unknown units', () => {
    expect(getDisplayUnit('pcs')).toBe('pcs');
    expect(getDisplayUnit('')).toBe('');
  });
});

describe('isMetricUnit', () => {
  it('recognises metric units including superscript variants', () => {
    expect(isMetricUnit('m')).toBe(true);
    expect(isMetricUnit('m2')).toBe(true);
    expect(isMetricUnit('m²')).toBe(true);
    expect(isMetricUnit('m³')).toBe(true);
  });

  it('recognises imperial units', () => {
    expect(isMetricUnit('ft')).toBe(false);
    expect(isMetricUnit('ft2')).toBe(false);
  });

  it('returns null for unknown units', () => {
    expect(isMetricUnit('pcs')).toBeNull();
    expect(isMetricUnit('lsum')).toBeNull();
  });
});
