/**
 * useDisplayQuantity — the React seam for measurement-system-aware quantities.
 *
 * Reads the user's `measurementSystem` preference once (selector-scoped, so a
 * component only re-renders when that one preference changes) and returns a
 * small, memoised API bound to it. Every non-takeoff surface that renders or
 * exports a metric-canonical quantity should go through this hook instead of
 * touching the converter directly, so the metric/imperial decision lives in
 * exactly one place.
 *
 *   const q = useDisplayQuantity();
 *   const { value, unit } = q.convert(area, 'm²');   // -> ft² for imperial
 *   const label = q.unitFor('m');                    // -> 'ft' for imperial
 *   const stored = q.toMetric(typed, 'm²');          // editable-cell reverse
 */
import { useMemo } from 'react';

import { usePreferencesStore, type MeasurementSystem } from '@/stores/usePreferencesStore';
import {
  toDisplayQuantity,
  displayUnitFor,
  fromDisplayQuantity,
  type DisplayQuantity,
} from '@/shared/lib/unitConversion';

export interface DisplayQuantityApi {
  /** The active measurement system. */
  system: MeasurementSystem;
  /** Convert a metric-canonical value + unit into the display system. */
  convert: (value: number, metricUnit: string) => DisplayQuantity;
  /** The display unit label a metric unit resolves to (no value needed). */
  unitFor: (metricUnit: string) => string;
  /** Reverse a value a user typed in the display system back to metric storage. */
  toMetric: (value: number, metricUnit: string) => number;
}

export function useDisplayQuantity(): DisplayQuantityApi {
  const system = usePreferencesStore((s) => s.measurementSystem);
  return useMemo(
    () => ({
      system,
      convert: (value: number, metricUnit: string) =>
        toDisplayQuantity(value, metricUnit, system),
      unitFor: (metricUnit: string) => displayUnitFor(metricUnit, system),
      toMetric: (value: number, metricUnit: string) =>
        fromDisplayQuantity(value, metricUnit, system),
    }),
    [system],
  );
}
