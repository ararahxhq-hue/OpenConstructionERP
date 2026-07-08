// DDC-CWICR-OE: DataDrivenConstruction - OpenConstructionERP
// Tests for the pure, DB-free helpers behind the norm-expansion feature.
import { describe, expect, it } from 'vitest';
import { buildExpandBatchPayload, isValidQuantity } from './api';

describe('isValidQuantity', () => {
  it('accepts finite positive numbers', () => {
    expect(isValidQuantity('1')).toBe(true);
    expect(isValidQuantity('12.5')).toBe(true);
    expect(isValidQuantity('0.0001')).toBe(true);
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(isValidQuantity('  3  ')).toBe(true);
  });

  it('rejects blank, zero and negative quantities', () => {
    expect(isValidQuantity('')).toBe(false);
    expect(isValidQuantity('   ')).toBe(false);
    expect(isValidQuantity('0')).toBe(false);
    expect(isValidQuantity('-1')).toBe(false);
  });

  it('rejects non-numeric and non-finite input', () => {
    expect(isValidQuantity('abc')).toBe(false);
    expect(isValidQuantity('Infinity')).toBe(false);
    expect(isValidQuantity('NaN')).toBe(false);
  });
});

describe('buildExpandBatchPayload', () => {
  it('keeps valid rows and trims the work key', () => {
    const payload = buildExpandBatchPayload([
      { work_key: '  plastering_internal  ', quantity: '10' },
      { work_key: 'concrete_c30_37', quantity: '2.5' },
    ]);
    expect(payload.items).toEqual([
      { work_key: 'plastering_internal', quantity: '10' },
      { work_key: 'concrete_c30_37', quantity: '2.5' },
    ]);
  });

  it('drops rows with a blank work key or an invalid quantity', () => {
    const payload = buildExpandBatchPayload([
      { work_key: '', quantity: '10' },
      { work_key: 'formwork_wall', quantity: '0' },
      { work_key: 'formwork_wall', quantity: 'abc' },
      { work_key: 'formwork_wall', quantity: '3' },
    ]);
    expect(payload.items).toEqual([{ work_key: 'formwork_wall', quantity: '3' }]);
  });

  it('passes the quantity string through verbatim to preserve precision', () => {
    const payload = buildExpandBatchPayload([{ work_key: 'x', quantity: ' 12.5000 ' }]);
    // Trimmed, but never re-parsed into a float that could drop trailing zeros.
    expect(payload.items[0]?.quantity).toBe('12.5000');
  });

  it('returns an empty item list for empty input', () => {
    expect(buildExpandBatchPayload([])).toEqual({ items: [] });
  });
});
