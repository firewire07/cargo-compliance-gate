import { HttpErrorResponse } from '@angular/common/http';
import { holdPhase } from '../models/hold.model';
import { apiErrorMessage } from './api-error';
import { formatAge } from './format-age';

describe('formatAge', () => {
  const now = Date.parse('2026-11-14T02:00:00.000Z');

  it('formats minutes and hours', () => {
    expect(formatAge('2026-11-14T01:50:00.000Z', now)).toBe('10m ago');
    expect(formatAge('2026-11-14T00:00:00.000Z', now)).toBe('2h ago');
  });
});

describe('holdPhase', () => {
  const base = {
    id: 'h1',
    awb: '020-11111111',
    shipmentVersion: 1,
    reasons: [],
    checklist: [],
    createdAt: '2026-11-14T01:00:00.000Z',
  };

  it('derives the release phase from hold fields', () => {
    expect(holdPhase({ ...base, shipmentStatus: 'HELD' })).toBe('OPEN');
    expect(
      holdPhase({
        ...base,
        releaseRequestedBy: 'analyst-a',
        releaseRequestedAt: '2026-11-14T01:05:00.000Z',
      }),
    ).toBe('RELEASE_REQUESTED');
    expect(
      holdPhase({
        ...base,
        releaseApprovedBy: 'analyst-b',
        shipmentStatus: 'RELEASED',
      }),
    ).toBe('RELEASED');
  });
});

describe('apiErrorMessage', () => {
  it('uses the Nest message for a 403', () => {
    const err = new HttpErrorResponse({
      status: 403,
      statusText: 'Forbidden',
      error: { message: 'ANALYST role required' },
    });
    expect(apiErrorMessage(err)).toBe('ANALYST role required');
  });
});
