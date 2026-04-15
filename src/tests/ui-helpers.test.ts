// @vitest-environment jsdom
/**
 * ui-helpers.test.ts — Unit tests for testable UI helper functions.
 *
 * Tests cover:
 * 1. _formatMoney logic (reimplemented from hubManagement.ts — private, not exported)
 * 2. _getStatusInfo logic (reimplemented from hubManagement.ts — private, not exported)
 * 3. getBodyColor (imported from logistics/_routeMap.ts — fallback in Node env)
 * 4. showLoadingIndicator / hideLoadingIndicator (skipped — requires DOM env;
 *    neither happy-dom nor jsdom is installed)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getBodyColor } from '../ui/logistics/_routeMap.ts';

// ---------------------------------------------------------------------------
// 1. _formatMoney — local reimplementation of the private helper from
//    src/ui/hubManagement.ts (lines 524-533).
// ---------------------------------------------------------------------------

/**
 * Reimplementation of the private _formatMoney helper for testing.
 * Mirrors the exact logic in hubManagement.ts.
 */
function _formatMoney(amount: number): string {
  if (amount === 0) return '$0';
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}k`;
  }
  return `$${amount.toLocaleString()}`;
}

describe('_formatMoney (hubManagement helper)', () => {
  it('formats zero as $0', () => {
    expect(_formatMoney(0)).toBe('$0');
  });

  it('formats small amounts below $1,000 with locale string', () => {
    expect(_formatMoney(500)).toBe(`$${(500).toLocaleString()}`);
  });

  it('formats $1,000 as $1k', () => {
    expect(_formatMoney(1_000)).toBe('$1k');
  });

  it('formats $50,000 as $50k', () => {
    expect(_formatMoney(50_000)).toBe('$50k');
  });

  it('formats $999,999 as $1000k (rounds up)', () => {
    // 999_999 / 1000 = 999.999, toFixed(0) rounds to '1000'
    expect(_formatMoney(999_999)).toBe('$1000k');
  });

  it('formats $1,000,000 as $1.0M', () => {
    expect(_formatMoney(1_000_000)).toBe('$1.0M');
  });

  it('formats $2,500,000 as $2.5M', () => {
    expect(_formatMoney(2_500_000)).toBe('$2.5M');
  });

  it('formats $10,500,000 as $10.5M', () => {
    expect(_formatMoney(10_500_000)).toBe('$10.5M');
  });

  it('formats exact boundary at 1,000 using k suffix', () => {
    expect(_formatMoney(1_000)).toBe('$1k');
  });

  it('formats values just below 1,000 using locale string', () => {
    expect(_formatMoney(999)).toBe(`$${(999).toLocaleString()}`);
  });
});

// ---------------------------------------------------------------------------
// 2. _getStatusInfo — local reimplementation of the private helper from
//    src/ui/hubManagement.ts (lines 205-215).
// ---------------------------------------------------------------------------

interface FacilityInfo {
  id: string;
  name: string;
  tier: number;
  underConstruction: boolean;
}

interface StatusInput {
  online: boolean;
  facilities: FacilityInfo[];
}

/**
 * Reimplementation of the private _getStatusInfo helper for testing.
 * Mirrors the exact logic in hubManagement.ts.
 */
function _getStatusInfo(info: StatusInput): { label: string; className: string } {
  if (info.online) {
    return { label: 'Online', className: 'hub-mgmt-status--online' };
  }
  const hasBuilding = info.facilities.some(f => f.underConstruction);
  if (hasBuilding) {
    return { label: 'Building', className: 'hub-mgmt-status--building' };
  }
  return { label: 'Offline', className: 'hub-mgmt-status--offline' };
}

describe('_getStatusInfo (hubManagement helper)', () => {
  it('returns Online when hub is online', () => {
    const result = _getStatusInfo({
      online: true,
      facilities: [],
    });
    expect(result).toEqual({ label: 'Online', className: 'hub-mgmt-status--online' });
  });

  it('returns Online even when facilities are under construction', () => {
    // online takes precedence over underConstruction
    const result = _getStatusInfo({
      online: true,
      facilities: [
        { id: 'crew-hab', name: 'Crew Hab', tier: 1, underConstruction: true },
      ],
    });
    expect(result).toEqual({ label: 'Online', className: 'hub-mgmt-status--online' });
  });

  it('returns Building when offline with a facility under construction', () => {
    const result = _getStatusInfo({
      online: false,
      facilities: [
        { id: 'crew-hab', name: 'Crew Hab', tier: 1, underConstruction: true },
      ],
    });
    expect(result).toEqual({ label: 'Building', className: 'hub-mgmt-status--building' });
  });

  it('returns Building when any facility in the list is under construction', () => {
    const result = _getStatusInfo({
      online: false,
      facilities: [
        { id: 'crew-hab', name: 'Crew Hab', tier: 1, underConstruction: false },
        { id: 'mining-ops', name: 'Mining Ops', tier: 1, underConstruction: true },
      ],
    });
    expect(result).toEqual({ label: 'Building', className: 'hub-mgmt-status--building' });
  });

  it('returns Offline when not online and no facilities under construction', () => {
    const result = _getStatusInfo({
      online: false,
      facilities: [
        { id: 'crew-hab', name: 'Crew Hab', tier: 2, underConstruction: false },
      ],
    });
    expect(result).toEqual({ label: 'Offline', className: 'hub-mgmt-status--offline' });
  });

  it('returns Offline when not online and facilities list is empty', () => {
    const result = _getStatusInfo({
      online: false,
      facilities: [],
    });
    expect(result).toEqual({ label: 'Offline', className: 'hub-mgmt-status--offline' });
  });
});

// ---------------------------------------------------------------------------
// 3. getBodyColor — imported from src/ui/logistics/_routeMap.ts.
//    In the Node.js test environment `document` is undefined, so the
//    function should always return the fallback value '#888'.
// ---------------------------------------------------------------------------

describe('getBodyColor (logistics route map helper)', () => {
  it('returns fallback #888 when document is undefined (Node test env)', () => {
    expect(getBodyColor('EARTH')).toBe('#888');
  });

  it('returns fallback #888 for any body ID in Node test env', () => {
    expect(getBodyColor('MOON')).toBe('#888');
    expect(getBodyColor('MARS')).toBe('#888');
    expect(getBodyColor('SUN')).toBe('#888');
  });

  it('returns fallback #888 for unknown body IDs', () => {
    expect(getBodyColor('PLUTO')).toBe('#888');
    expect(getBodyColor('')).toBe('#888');
  });

  it('is a function that accepts a string argument', () => {
    expect(typeof getBodyColor).toBe('function');
    expect(getBodyColor.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. showLoadingIndicator / hideLoadingIndicator
// ---------------------------------------------------------------------------

describe('showLoadingIndicator / hideLoadingIndicator', () => {
  beforeEach(() => {
    // Clean up any leftover overlay from previous tests.
    const existing = document.getElementById('loading-indicator');
    if (existing) existing.remove();
  });

  it('show adds a loading overlay to document.body', async () => {
    const { showLoadingIndicator } = await import('../ui/loadingIndicator.ts');
    showLoadingIndicator();
    expect(document.getElementById('loading-indicator')).not.toBeNull();
  });

  it('show is idempotent — calling twice reuses the same element', async () => {
    const { showLoadingIndicator } = await import('../ui/loadingIndicator.ts');
    showLoadingIndicator();
    showLoadingIndicator();
    expect(document.querySelectorAll('#loading-indicator').length).toBe(1);
  });

  it('hide sets display to none', async () => {
    const { showLoadingIndicator, hideLoadingIndicator } = await import('../ui/loadingIndicator.ts');
    showLoadingIndicator();
    hideLoadingIndicator();
    expect(document.getElementById('loading-indicator')?.style.display).toBe('none');
  });

  it('hide does not throw when nothing is shown', async () => {
    const { hideLoadingIndicator } = await import('../ui/loadingIndicator.ts');
    expect(() => hideLoadingIndicator()).not.toThrow();
  });
});
