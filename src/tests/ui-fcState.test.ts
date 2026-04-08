// @ts-nocheck
/**
 * ui-fcState.test.ts — Unit tests for flight controller state management.
 *
 * Tests getFCState(), setFCState(), resetFCState() from
 * src/ui/flightController/_state.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getFCState, setFCState, resetFCState } from '../ui/flightController/_state.ts';

describe('FCState', () => {
  beforeEach(() => {
    resetFCState();
  });

  describe('getFCState()', () => {
    it('returns a state object', () => {
      const s = getFCState();
      expect(s).toBeDefined();
      expect(typeof s).toBe('object');
    });

    it('returns the same object on multiple calls', () => {
      expect(getFCState()).toBe(getFCState());
    });
  });

  describe('default state values', () => {
    it('core references are null by default', () => {
      const s = getFCState();
      expect(s.rafId).toBeNull();
      expect(s.assembly).toBeNull();
      expect(s.stagingConfig).toBeNull();
      expect(s.state).toBeNull();
      expect(s.container).toBeNull();
      expect(s.onFlightEnd).toBeNull();
      expect(s.lastTs).toBeNull();
    });

    it('event listener references are null', () => {
      const s = getFCState();
      expect(s.keydownHandler).toBeNull();
      expect(s.keyupHandler).toBeNull();
    });

    it('DOM references are null', () => {
      const s = getFCState();
      expect(s.flightOverlay).toBeNull();
      expect(s.mapHud).toBeNull();
      expect(s.dockingHud).toBeNull();
      expect(s.loopErrorBanner).toBeNull();
    });

    it('boolean flags default correctly', () => {
      const s = getFCState();
      expect(s.summaryShown).toBe(false);
      expect(s.mapActive).toBe(false);
      expect(s.mapThrusting).toBe(false);
      expect(s.normalOrbitThrusting).toBe(false);
      expect(s.deorbitWarningActive).toBe(false);
      expect(s.workerReady).toBe(false);
    });

    it('numeric values default to expected values', () => {
      const s = getFCState();
      expect(s.timeWarp).toBe(1);
      expect(s.preMenuTimeWarp).toBe(1);
      expect(s.stagingLockoutUntil).toBe(0);
      expect(s.prevAltitude).toBe(0);
      expect(s.loopConsecutiveErrors).toBe(0);
    });

    it('prevInSpace defaults to false', () => {
      expect(getFCState().prevInSpace).toBe(false);
    });

    it('Set fields are empty by default', () => {
      const s = getFCState();
      expect(s.mapHeldKeys).toBeInstanceOf(Set);
      expect(s.mapHeldKeys.size).toBe(0);
      expect(s.normalOrbitHeldKeys).toBeInstanceOf(Set);
      expect(s.normalOrbitHeldKeys.size).toBe(0);
    });
  });

  describe('setFCState()', () => {
    it('patches a single property', () => {
      setFCState({ timeWarp: 4 });
      expect(getFCState().timeWarp).toBe(4);
    });

    it('patches multiple properties at once', () => {
      setFCState({ mapActive: true, summaryShown: true, timeWarp: 10 });
      const s = getFCState();
      expect(s.mapActive).toBe(true);
      expect(s.summaryShown).toBe(true);
      expect(s.timeWarp).toBe(10);
    });

    it('does not reset unpatched properties', () => {
      setFCState({ timeWarp: 8 });
      setFCState({ mapActive: true });
      expect(getFCState().timeWarp).toBe(8);
    });

    it('preserves object identity after patching', () => {
      const before = getFCState();
      setFCState({ timeWarp: 5 });
      expect(getFCState()).toBe(before);
    });
  });

  describe('resetFCState()', () => {
    it('resets all properties to defaults', () => {
      setFCState({
        timeWarp: 100,
        mapActive: true,
        summaryShown: true,
        workerReady: true,
        loopConsecutiveErrors: 5,
      });

      resetFCState();
      const s = getFCState();
      expect(s.timeWarp).toBe(1);
      expect(s.mapActive).toBe(false);
      expect(s.summaryShown).toBe(false);
      expect(s.workerReady).toBe(false);
      expect(s.loopConsecutiveErrors).toBe(0);
    });

    it('creates new Set instances after reset', () => {
      const oldKeys = getFCState().mapHeldKeys;
      oldKeys.add('w');
      resetFCState();
      expect(getFCState().mapHeldKeys.size).toBe(0);
      expect(getFCState().mapHeldKeys).not.toBe(oldKeys);
    });

    it('returns a new object reference after reset', () => {
      const before = getFCState();
      resetFCState();
      expect(getFCState()).not.toBe(before);
    });
  });
});
