import { describe, it, expect } from 'vitest';
import { getBodyColor, formatLocation } from '../ui/logistics/_routeMap.ts';
import { BODY_COLORS, DEFAULT_BODY_COLOR } from '../core/mapGeometry.ts';
import type { RouteLocation } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// getBodyColor()
// ---------------------------------------------------------------------------
// getBodyColor is now a re-export of getBodyColorHex from core/mapGeometry.
// It returns actual hex colors from the BODY_COLORS map instead of relying
// on CSS custom properties.  No DOM dependency — works identically in Node
// and browser environments.
// ---------------------------------------------------------------------------

describe('getBodyColor()', () => {
  it('@smoke returns correct hex color for known bodies', () => {
    expect(getBodyColor('earth')).toBe(BODY_COLORS.earth);
    expect(getBodyColor('EARTH')).toBe(BODY_COLORS.earth);
  });

  it('returns correct colors for all known bodies (case-insensitive)', () => {
    expect(getBodyColor('MARS')).toBe(BODY_COLORS.mars);
    expect(getBodyColor('moon')).toBe(BODY_COLORS.moon);
    expect(getBodyColor('jupiter')).toBe(BODY_COLORS.jupiter);
    expect(getBodyColor('saturn')).toBe(BODY_COLORS.saturn);
    expect(getBodyColor('titan')).toBe(BODY_COLORS.titan);
    expect(getBodyColor('ceres')).toBe(BODY_COLORS.ceres);
    expect(getBodyColor('sun')).toBe(BODY_COLORS.sun);
  });

  it('returns default color for unknown body names', () => {
    expect(getBodyColor('pluto')).toBe(DEFAULT_BODY_COLOR);
    expect(getBodyColor('unknown')).toBe(DEFAULT_BODY_COLOR);
    expect(getBodyColor('')).toBe(DEFAULT_BODY_COLOR);
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
    const loc: RouteLocation = { bodyId: 'MOON', locationType: 'surface', hubId: null };
    expect(formatLocation(loc)).toBe('MOON (surface)');
  });

  it('formats an orbit location with altitude', () => {
    const loc: RouteLocation = { bodyId: 'MARS', locationType: 'orbit', altitude: 200, hubId: null };
    expect(formatLocation(loc)).toBe('MARS (orbit, 200km)');
  });

  it('formats an orbit location without altitude', () => {
    const loc: RouteLocation = { bodyId: 'EARTH', locationType: 'orbit', hubId: null };
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
