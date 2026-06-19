/**
 * Wave 8 (Tests) - URL-contract tests for the RFI api helpers.
 *
 * The exact request paths are load-bearing and have bitten us before:
 *   - ``getRFI`` / ``updateRFI`` MUST hit ``/v1/rfi/{id}`` with NO trailing
 *     slash. The app runs with ``redirect_slashes=False``, so a stray slash
 *     404s and the detail page shows "RFI not found" forever (the Wave 7 fix).
 *   - ``createVariationFromRFI`` MUST hit the trailing-slash form
 *     ``/v1/rfi/{id}/create-variation/`` for the same reason, inverted.
 *   - ``fetchRFIs`` must omit empty / whitespace-only filters from the query
 *     string (an empty ``?status=`` would 422 against the enum-validated
 *     param) and only include offset/limit when they are real numbers.
 *
 * We mock the shared HTTP layer so these are pure URL-assembly assertions
 * with no network and no coupling to the auth/toast/offline stores.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiGet = vi.fn(async () => ({}) as unknown);
const apiPost = vi.fn(async () => ({}) as unknown);
const apiPatch = vi.fn(async () => ({}) as unknown);

vi.mock('@/shared/lib/api', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiPatch: (...args: unknown[]) => apiPatch(...args),
}));

import {
  getRFI,
  fetchRFIs,
  fetchRFIStats,
  createRFI,
  updateRFI,
  respondToRFI,
  closeRFI,
  createVariationFromRFI,
} from '../api';

beforeEach(() => {
  apiGet.mockClear();
  apiPost.mockClear();
  apiPatch.mockClear();
});

describe('getRFI', () => {
  it('GETs /v1/rfi/{id} with NO trailing slash', async () => {
    await getRFI('abc-123');
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet.mock.calls[0][0]).toBe('/v1/rfi/abc-123');
  });
});

describe('updateRFI', () => {
  it('PATCHes /v1/rfi/{id} with NO trailing slash and forwards the body', async () => {
    const body = { subject: 'New' };
    await updateRFI('abc-123', body);
    expect(apiPatch).toHaveBeenCalledTimes(1);
    expect(apiPatch.mock.calls[0][0]).toBe('/v1/rfi/abc-123');
    expect(apiPatch.mock.calls[0][1]).toEqual(body);
  });
});

describe('createVariationFromRFI', () => {
  it('POSTs the trailing-slash create-variation route', async () => {
    await createVariationFromRFI('abc-123');
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost.mock.calls[0][0]).toBe('/v1/rfi/abc-123/create-variation/');
  });
});

describe('respondToRFI / closeRFI', () => {
  it('respondToRFI POSTs the trailing-slash respond route with the body', async () => {
    await respondToRFI('r1', { official_response: 'done' });
    expect(apiPost.mock.calls[0][0]).toBe('/v1/rfi/r1/respond/');
    expect(apiPost.mock.calls[0][1]).toEqual({ official_response: 'done' });
  });

  it('closeRFI POSTs the trailing-slash close route', async () => {
    await closeRFI('r1');
    expect(apiPost.mock.calls[0][0]).toBe('/v1/rfi/r1/close/');
  });
});

describe('createRFI', () => {
  it('POSTs the collection root with a trailing slash', async () => {
    await createRFI({ project_id: 'p1', subject: 's', question: 'q' });
    expect(apiPost.mock.calls[0][0]).toBe('/v1/rfi/');
  });
});

describe('fetchRFIStats', () => {
  it('encodes the project id into the stats query', async () => {
    await fetchRFIStats('p1/2');
    expect(apiGet.mock.calls[0][0]).toBe('/v1/rfi/stats/?project_id=p1%2F2');
  });
});

describe('fetchRFIs query-string assembly', () => {
  it('returns the bare collection root when no filters are supplied', async () => {
    await fetchRFIs();
    expect(apiGet.mock.calls[0][0]).toBe('/v1/rfi/');
  });

  it('omits empty status and whitespace-only search', async () => {
    await fetchRFIs({ project_id: 'p1', status: '', search: '   ' });
    const url = apiGet.mock.calls[0][0] as string;
    expect(url).toContain('project_id=p1');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('search=');
  });

  it('includes status, trimmed search, offset and limit when present', async () => {
    await fetchRFIs({
      project_id: 'p1',
      status: 'open',
      search: '  rebar  ',
      offset: 20,
      limit: 50,
    });
    const url = apiGet.mock.calls[0][0] as string;
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('project_id')).toBe('p1');
    expect(qs.get('status')).toBe('open');
    expect(qs.get('search')).toBe('rebar');
    expect(qs.get('offset')).toBe('20');
    expect(qs.get('limit')).toBe('50');
  });

  it('includes offset=0 (a real number, not falsy-dropped)', async () => {
    await fetchRFIs({ project_id: 'p1', offset: 0 });
    const qs = new URLSearchParams(
      (apiGet.mock.calls[0][0] as string).split('?')[1],
    );
    // offset 0 is meaningful (first page) and must survive the typeof check.
    expect(qs.get('offset')).toBe('0');
  });
});
