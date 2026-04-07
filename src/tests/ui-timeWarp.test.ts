// @ts-nocheck
/**
 * ui-timeWarp.test.ts — Unit tests for time warp auto-reset logic.
 *
 * Tests checkTimeWarpResets() from src/ui/flightController/_timeWarp.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

// Mock the flightHud module (DOM-dependent)
vi.mock('../ui/flightHud.ts', () => ({
  setHudTimeWarp: vi.fn(),
  lockTimeWarp: vi.fn(),
}));

// Mock atmosphere
vi.mock('../core/atmosphere.ts', () => ({
  ATMOSPHERE_TOP: 100000, // 100 km
  airDensity: vi.fn(() => 0),
  SEA_LEVEL_DENSITY: 1.225,
}));

// Mock bodies data
vi.mock('../data/bodies.ts', () => ({
  getAtmosphereTop: vi.fn(() => 100000),
}));

import { setHudTimeWarp, lockTimeWarp } from '../ui/flightHud.ts';
import { getFCState, setFCState, resetFCState } from '../ui/flightController/_state.ts';
import { checkTimeWarpResets, applyTimeWarp } from '../ui/flightController/_timeWarp.ts';

describe('timeWarp', () => {
  beforeEach(() => {
    resetFCState();
    vi.clearAllMocks();
  });

  describe('applyTimeWarp()', () => {
    it('sets the timeWarp level on FCState', () => {
      applyTimeWarp(4);
      expect(getFCState().timeWarp).toBe(4);
    });

    it('calls setHudTimeWarp with the new level', () => {
      applyTimeWarp(10);
      expect(setHudTimeWarp).toHaveBeenCalledWith(10);
    });
  });

  describe('checkTimeWarpResets()', () => {
    it('returns early when ps is null', () => {
      expect(() => checkTimeWarpResets(1000)).not.toThrow();
    });

    it('returns early when flightState is null', () => {
      setFCState({ ps: { posY: 50000, velX: 0, velY: 0 } });
      expect(() => checkTimeWarpResets(1000)).not.toThrow();
    });

    describe('staging lockout expiry', () => {
      it('clears staging lockout when timestamp exceeds lockout time', () => {
        setFCState({
          ps: { posY: 50000, velX: 0, velY: 0, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'ASCENT' },
          stagingLockoutUntil: 5000,
          timeWarp: 1,
        });

        checkTimeWarpResets(6000);

        expect(getFCState().stagingLockoutUntil).toBe(0);
        expect(lockTimeWarp).toHaveBeenCalledWith(false);
      });

      it('does not clear lockout before expiry', () => {
        setFCState({
          ps: { posY: 50000, velX: 0, velY: 0, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'ASCENT' },
          stagingLockoutUntil: 5000,
          timeWarp: 1,
        });

        checkTimeWarpResets(3000);
        expect(getFCState().stagingLockoutUntil).toBe(5000);
      });
    });

    describe('when timeWarp is 1', () => {
      it('updates prevAltitude and prevInSpace and returns early', () => {
        setFCState({
          ps: { posY: 50000, velX: 0, velY: 0, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'ASCENT' },
          timeWarp: 1,
        });

        checkTimeWarpResets(1000);

        expect(getFCState().prevAltitude).toBe(50000);
        expect(getFCState().prevInSpace).toBe(false); // 50km < 100km atmo top
      });

      it('sets prevInSpace to true when above atmosphere', () => {
        setFCState({
          ps: { posY: 150000, velX: 0, velY: 0, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'ORBIT' },
          timeWarp: 1,
        });

        checkTimeWarpResets(1000);
        expect(getFCState().prevInSpace).toBe(true);
      });

      it('clamps negative altitude to 0', () => {
        setFCState({
          ps: { posY: -50, velX: 0, velY: 0, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'LANDED' },
          timeWarp: 1,
        });

        checkTimeWarpResets(1000);
        expect(getFCState().prevAltitude).toBe(0);
      });
    });

    describe('landing/crash reset', () => {
      it('resets warp to 1x on landing', () => {
        setFCState({
          ps: { posY: 0, velX: 0, velY: 0, landed: true, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'LANDED' },
          timeWarp: 4,
          prevAltitude: 100,
          prevInSpace: false,
        });

        checkTimeWarpResets(1000);
        expect(getFCState().timeWarp).toBe(1);
        expect(setHudTimeWarp).toHaveBeenCalledWith(1);
      });

      it('resets warp to 1x on crash', () => {
        setFCState({
          ps: { posY: 0, velX: 0, velY: 0, landed: false, crashed: true },
          flightState: { bodyId: 'EARTH', phase: 'CRASHED' },
          timeWarp: 10,
          prevAltitude: 5000,
          prevInSpace: false,
        });

        checkTimeWarpResets(1000);
        expect(getFCState().timeWarp).toBe(1);
      });
    });

    describe('reentry reset', () => {
      it('resets warp on reentry (was in space, now below atmosphere, fast speed)', () => {
        setFCState({
          ps: { posY: 90000, velX: 600, velY: -400, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'REENTRY' },
          timeWarp: 4,
          prevAltitude: 110000,
          prevInSpace: true, // was in space last frame
        });

        checkTimeWarpResets(1000);
        // speed = hypot(600, -400) ≈ 721 > 500 and prevInSpace && !inSpace
        expect(getFCState().timeWarp).toBe(1);
      });

      it('does NOT reset warp when speed is low (ascending slowly)', () => {
        setFCState({
          ps: { posY: 90000, velX: 10, velY: 5, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'ASCENT' },
          timeWarp: 4,
          prevAltitude: 110000,
          prevInSpace: true,
        });

        checkTimeWarpResets(1000);
        // speed = hypot(10, 5) ≈ 11 < 500 → no reset
        expect(getFCState().timeWarp).toBe(4);
      });

      it('does NOT reset warp when still in space', () => {
        setFCState({
          ps: { posY: 120000, velX: 7000, velY: 0, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'ORBIT' },
          timeWarp: 10,
          prevAltitude: 130000,
          prevInSpace: true,
        });

        checkTimeWarpResets(1000);
        // Still above 100km → still in space → no reset
        expect(getFCState().timeWarp).toBe(10);
      });

      it('does NOT reset warp when was NOT in space last frame', () => {
        setFCState({
          ps: { posY: 40000, velX: 600, velY: -300, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'DESCENT' },
          timeWarp: 4,
          prevAltitude: 50000,
          prevInSpace: false, // was not in space
        });

        checkTimeWarpResets(1000);
        // Not a reentry transition (was already below atmosphere)
        expect(getFCState().timeWarp).toBe(4);
      });
    });

    describe('altitude tracking', () => {
      it('updates prevAltitude and prevInSpace each frame', () => {
        setFCState({
          ps: { posY: 200000, velX: 7800, velY: 0, landed: false, crashed: false },
          flightState: { bodyId: 'EARTH', phase: 'ORBIT' },
          timeWarp: 4,
          prevAltitude: 190000,
          prevInSpace: true,
        });

        checkTimeWarpResets(1000);
        expect(getFCState().prevAltitude).toBe(200000);
        expect(getFCState().prevInSpace).toBe(true);
      });
    });
  });
});
