import { describe, it, expect } from 'vitest';
import { getBodyColor, formatLocation } from '../ui/logistics/_routeMap.ts';
import type { RouteLocation } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// getBodyColor()
// ---------------------------------------------------------------------------
// Unit tests run in Node.js (environment: 'node' in vite.config.ts) so
// `typeof document === 'undefined'` is true.  The function's fallback path
// returns '#888' for every bodyId.  A full DOM test would require jsdom or
// a browser environment; the CSS custom property read path is covered by
// the E2E suite instead.
// ---------------------------------------------------------------------------

describe('getBodyColor()', () => {
  it('@smoke returns fallback #888 when DOM is unavailable (Node env)', () => {
    expect(getBodyColor('earth')).toBe('#888');
  });

  it('returns fallback for any arbitrary bodyId string', () => {
    expect(getBodyColor('MARS')).toBe('#888');
    expect(getBodyColor('moon')).toBe('#888');
    expect(getBodyColor('jupiter')).toBe('#888');
    expect(getBodyColor('saturn')).toBe('#888');
    expect(getBodyColor('titan')).toBe('#888');
    expect(getBodyColor('ceres')).toBe('#888');
    expect(getBodyColor('sun')).toBe('#888');
  });

  it('returns fallback for unknown body names', () => {
    expect(getBodyColor('pluto')).toBe('#888');
    expect(getBodyColor('unknown')).toBe('#888');
    expect(getBodyColor('')).toBe('#888');
  });

  it('accepts any string as bodyId (type signature check)', () => {
    // Verify the function does not throw for arbitrary input
    const bodyIds = ['EARTH', 'earth', 'Mars', 'UNKNOWN_BODY', '123', 'a-b-c'];
    for (const id of bodyIds) {
      expect(() => getBodyColor(id)).not.toThrow();
      expect(typeof getBodyColor(id)).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// formatLocation() — pure logic, no DOM dependency
// ---------------------------------------------------------------------------

describe('formatLocation()', () => {
  it('formats a surface location', () => {
    const loc: RouteLocation = { bodyId: 'MOON', locationType: 'surface' };
    expect(formatLocation(loc)).toBe('MOON (surface)');
  });

  it('formats an orbit location with altitude', () => {
    const loc: RouteLocation = { bodyId: 'MARS', locationType: 'orbit', altitude: 200 };
    expect(formatLocation(loc)).toBe('MARS (orbit, 200km)');
  });

  it('formats an orbit location without altitude', () => {
    const loc: RouteLocation = { bodyId: 'EARTH', locationType: 'orbit' };
    expect(formatLocation(loc)).toBe('EARTH (orbit)');
  });

  it('includes hub name when hubs array is provided and hubId matches', () => {
    const loc: RouteLocation = { bodyId: 'MOON', locationType: 'surface', hubId: 'hub-1' };
    const hubs = [{ id: 'hub-1', name: 'Artemis Base' }];
    expect(formatLocation(loc, hubs)).toBe('Artemis Base (MOON, surface)');
  });

  it('falls back to body name when hubId does not match any hub', () => {
    const loc: RouteLocation = { bodyId: 'MARS', locationType: 'surface', hubId: 'hub-999' };
    const hubs = [{ id: 'hub-1', name: 'Artemis Base' }];
    expect(formatLocation(loc, hubs)).toBe('MARS (surface)');
  });

  it('falls back to body name when no hubs array provided but hubId set', () => {
    const loc: RouteLocation = { bodyId: 'MARS', locationType: 'surface', hubId: 'hub-1' };
    expect(formatLocation(loc)).toBe('MARS (surface)');
  });
});
