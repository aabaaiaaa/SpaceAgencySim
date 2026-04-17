/**
 * ui-flightHudState.test.ts — Unit tests for flight HUD state and pure helpers.
 *
 * Tests getFlightHudState(), setFlightHudState(), resetFlightHudState() and the
 * pure formatters/estimators from src/ui/flightHud/_state.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  G0,
  getFlightHudState,
  setFlightHudState,
  resetFlightHudState,
  formatAltitude,
  formatSignedVelocity,
  formatThrottle,
  estimateApoapsis,
  buildFuelTankList,
} from '../ui/flightHud/_state.ts';
import { createRocketAssembly } from '../core/rocketbuilder.ts';

describe('flightHud _state', () => {
  beforeEach(() => {
    resetFlightHudState();
  });

  describe('G0', () => {
    it('equals standard gravity 9.81 m/s^2', () => {
      expect(G0).toBe(9.81);
    });
  });

  describe('getFlightHudState()', () => {
    it('returns the same object on multiple calls', () => {
      expect(getFlightHudState()).toBe(getFlightHudState());
    });

    it('default values', () => {
      const s = getFlightHudState();
      expect(s.timeWarp).toBe(1);
      expect(s.warpLocked).toBe(false);
      expect(s.launchTipHidden).toBe(false);
      expect(s.consecutiveErrors).toBe(0);
    });
  });

  describe('setFlightHudState()', () => {
    it('patches a single property', () => {
      setFlightHudState({ timeWarp: 10 });
      expect(getFlightHudState().timeWarp).toBe(10);
    });

    it('patches multiple properties at once', () => {
      setFlightHudState({
        timeWarp:          50,
        warpLocked:        true,
        launchTipHidden:   true,
        consecutiveErrors: 3,
      });
      const s = getFlightHudState();
      expect(s.timeWarp).toBe(50);
      expect(s.warpLocked).toBe(true);
      expect(s.launchTipHidden).toBe(true);
      expect(s.consecutiveErrors).toBe(3);
    });

    it('does not reset unpatched properties', () => {
      setFlightHudState({ timeWarp: 100 });
      setFlightHudState({ warpLocked: true });
      expect(getFlightHudState().timeWarp).toBe(100);
      expect(getFlightHudState().warpLocked).toBe(true);
    });

    it('preserves object identity after patching', () => {
      const before = getFlightHudState();
      setFlightHudState({ timeWarp: 5 });
      expect(getFlightHudState()).toBe(before);
    });
  });

  describe('resetFlightHudState()', () => {
    it('resets all properties to defaults', () => {
      setFlightHudState({
        timeWarp:          100,
        warpLocked:        true,
        launchTipHidden:   true,
        consecutiveErrors: 7,
      });

      resetFlightHudState();
      const s = getFlightHudState();
      expect(s.timeWarp).toBe(1);
      expect(s.warpLocked).toBe(false);
      expect(s.launchTipHidden).toBe(false);
      expect(s.consecutiveErrors).toBe(0);
    });

    it('preserves the same object reference (mutates in place)', () => {
      const before = getFlightHudState();
      setFlightHudState({ timeWarp: 42 });
      resetFlightHudState();
      expect(getFlightHudState()).toBe(before);
    });
  });

  describe('formatAltitude()', () => {
    it('formats integer values with thousands separator', () => {
      expect(formatAltitude(0)).toBe('0');
      expect(formatAltitude(1_000)).toBe('1,000');
      expect(formatAltitude(1_234_567)).toBe('1,234,567');
    });

    it('rounds fractional values to the nearest integer', () => {
      expect(formatAltitude(1_000.4)).toBe('1,000');
      expect(formatAltitude(1_000.6)).toBe('1,001');
    });

    it('handles negative values', () => {
      expect(formatAltitude(-2_500)).toBe('-2,500');
    });
  });

  describe('formatSignedVelocity()', () => {
    it('prefixes positive values with +', () => {
      expect(formatSignedVelocity(12.3)).toBe('+12.3');
    });

    it('prefixes zero with +', () => {
      expect(formatSignedVelocity(0)).toBe('+0.0');
    });

    it('emits a - sign for negative values without extra prefix', () => {
      expect(formatSignedVelocity(-4.5)).toBe('-4.5');
    });

    it('rounds to one decimal place', () => {
      expect(formatSignedVelocity(1.234)).toBe('+1.2');
      expect(formatSignedVelocity(-1.25)).toMatch(/^-1\.[23]$/); // JS banker rounding
    });
  });

  describe('formatThrottle()', () => {
    it('computes integer percent from 0..1 throttle', () => {
      expect(formatThrottle(0,   'absolute').pct).toBe(0);
      expect(formatThrottle(0.5, 'absolute').pct).toBe(50);
      expect(formatThrottle(1,   'absolute').pct).toBe(100);
    });

    it('labels with % suffix in absolute mode', () => {
      expect(formatThrottle(0.75, 'absolute').label).toBe('75%');
    });

    it('labels with TWR suffix in twr mode', () => {
      expect(formatThrottle(0.75, 'twr').label).toBe('75% TWR');
    });

    it('clamps throttle below 0 and above 1', () => {
      expect(formatThrottle(-0.5, 'absolute')).toEqual({ pct: 0,   label: '0%'   });
      expect(formatThrottle( 1.5, 'absolute')).toEqual({ pct: 100, label: '100%' });
    });

    it('rounds mid-range values to nearest integer percent', () => {
      expect(formatThrottle(0.337, 'absolute').pct).toBe(34);
      expect(formatThrottle(0.333, 'twr').label).toBe('33% TWR');
    });
  });

  describe('estimateApoapsis()', () => {
    it('returns current altitude when descending', () => {
      expect(estimateApoapsis(10_000, -5)).toBe(10_000);
      expect(estimateApoapsis(10_000,  0)).toBe(10_000);
    });

    it('adds ballistic height for positive vertical velocity', () => {
      // h = alt + v^2 / (2 g)
      const alt    = 1_000;
      const vy     = 100;
      const expected = alt + (vy * vy) / (2 * G0);
      expect(estimateApoapsis(alt, vy)).toBeCloseTo(expected, 6);
    });

    it('handles very small positive velocity', () => {
      const result = estimateApoapsis(500, 0.1);
      expect(result).toBeGreaterThan(500);
      expect(result).toBeLessThan(501);
    });

    it('scales quadratically with velocity', () => {
      const a = estimateApoapsis(0, 50);
      const b = estimateApoapsis(0, 100);
      expect(b / a).toBeCloseTo(4, 6);
    });
  });

  describe('buildFuelTankList()', () => {
    it('returns an empty list when no tanks are active', () => {
      const fuel         = new Map<string, number>([['inst-1', 500]]);
      const active       = new Set<string>();
      const assembly     = createRocketAssembly();
      assembly.parts.set('inst-1', { instanceId: 'inst-1', partId: 'tank-small', x: 0, y: 0 });
      expect(buildFuelTankList(fuel, active, assembly)).toEqual([]);
    });

    it('excludes tanks below 0.1 kg', () => {
      const fuel     = new Map<string, number>([['inst-1', 0.05]]);
      const active   = new Set<string>(['inst-1']);
      const assembly = createRocketAssembly();
      assembly.parts.set('inst-1', { instanceId: 'inst-1', partId: 'tank-small', x: 0, y: 0 });
      expect(buildFuelTankList(fuel, active, assembly)).toEqual([]);
    });

    it('resolves display name via getPartById', () => {
      const fuel     = new Map<string, number>([['inst-1', 400]]);
      const active   = new Set<string>(['inst-1']);
      const assembly = createRocketAssembly();
      assembly.parts.set('inst-1', { instanceId: 'inst-1', partId: 'tank-small', x: 0, y: 0 });

      const rows = buildFuelTankList(fuel, active, assembly);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        instanceId: 'inst-1',
        name:       'Small Tank',
        fuelKg:     400,
      });
    });

    it('falls back to partId when no part definition matches', () => {
      const fuel     = new Map<string, number>([['inst-1', 200]]);
      const active   = new Set<string>(['inst-1']);
      const assembly = createRocketAssembly();
      assembly.parts.set('inst-1', { instanceId: 'inst-1', partId: 'nonexistent-part', x: 0, y: 0 });

      const rows = buildFuelTankList(fuel, active, assembly);
      expect(rows[0].name).toBe('nonexistent-part');
    });

    it('falls back to instanceId when the part is not in the assembly', () => {
      const fuel     = new Map<string, number>([['orphan', 150]]);
      const active   = new Set<string>(['orphan']);
      const assembly = createRocketAssembly();

      const rows = buildFuelTankList(fuel, active, assembly);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('orphan');
    });

    it('sorts rows by descending fuel mass', () => {
      const fuel = new Map<string, number>([
        ['a', 100],
        ['b', 500],
        ['c', 300],
      ]);
      const active   = new Set<string>(['a', 'b', 'c']);
      const assembly = createRocketAssembly();
      assembly.parts.set('a', { instanceId: 'a', partId: 'tank-small',  x: 0, y: 0 });
      assembly.parts.set('b', { instanceId: 'b', partId: 'tank-medium', x: 0, y: 0 });
      assembly.parts.set('c', { instanceId: 'c', partId: 'tank-large',  x: 0, y: 0 });

      const rows = buildFuelTankList(fuel, active, assembly);
      expect(rows.map(r => r.instanceId)).toEqual(['b', 'c', 'a']);
      expect(rows.map(r => r.fuelKg)).toEqual([500, 300, 100]);
    });

    it('skips tanks that are in fuelStore but not in activeParts', () => {
      const fuel = new Map<string, number>([
        ['a', 100],
        ['b', 200],
      ]);
      const active   = new Set<string>(['a']);
      const assembly = createRocketAssembly();
      assembly.parts.set('a', { instanceId: 'a', partId: 'tank-small',  x: 0, y: 0 });
      assembly.parts.set('b', { instanceId: 'b', partId: 'tank-medium', x: 0, y: 0 });

      const rows = buildFuelTankList(fuel, active, assembly);
      expect(rows).toHaveLength(1);
      expect(rows[0].instanceId).toBe('a');
    });
  });
});
