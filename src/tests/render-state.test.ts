/**
 * render-state.test.ts — Unit tests for flight render state management.
 *
 * Tests getFlightRenderState(), setFlightRenderState(), resetFlightRenderState()
 * from src/render/flight/_state.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TrailSegment, PlumeState } from '../render/flight/_state.ts';

// ---------------------------------------------------------------------------
// Mock pixi.js — needed because _state.ts imports PixiJS types
// ---------------------------------------------------------------------------

vi.mock('pixi.js', () => ({
  Graphics: class {},
  Text: class {},
  TextStyle: class {},
  Container: class {},
}));

import {
  getFlightRenderState,
  setFlightRenderState,
  resetFlightRenderState,
} from '../render/flight/_state.ts';

describe('FlightRenderState', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  describe('getFlightRenderState()', () => {
    it('returns a state object', () => {
      const s = getFlightRenderState();
      expect(s).toBeDefined();
      expect(typeof s).toBe('object');
    });

    it('returns the same object on multiple calls', () => {
      const s1 = getFlightRenderState();
      const s2 = getFlightRenderState();
      expect(s1).toBe(s2);
    });
  });

  describe('default state values', () => {
    it('PixiJS container refs are null by default', () => {
      const s = getFlightRenderState();
      expect(s.skyGraphics).toBeNull();
      expect(s.starsContainer).toBeNull();
      expect(s.groundGraphics).toBeNull();
      expect(s.surfaceItemsGraphics).toBeNull();
      expect(s.debrisContainer).toBeNull();
      expect(s.trailContainer).toBeNull();
      expect(s.rocketContainer).toBeNull();
      expect(s.canopyContainer).toBeNull();
      expect(s.biomeLabelContainer).toBeNull();
      expect(s.hazeGraphics).toBeNull();
      expect(s.horizonGraphics).toBeNull();
      expect(s.dockingTargetGfx).toBeNull();
      expect(s.machGraphics).toBeNull();
    });

    it('camera state has correct defaults', () => {
      const s = getFlightRenderState();
      expect(s.camWorldX).toBe(0);
      expect(s.camWorldY).toBe(0);
      expect(s.lastCamTime).toBeNull();
      expect(s.camSnap).toBe(true);
      expect(s.prevTargetX).toBeNull();
      expect(s.prevTargetY).toBeNull();
      expect(s.camOffsetX).toBe(0);
      expect(s.camOffsetY).toBe(0);
    });

    it('zoom defaults to 1.0', () => {
      const s = getFlightRenderState();
      expect(s.zoomLevel).toBe(1.0);
    });

    it('mouse position defaults to (0, 0)', () => {
      const s = getFlightRenderState();
      expect(s.mouseX).toBe(0);
      expect(s.mouseY).toBe(0);
    });

    it('input is enabled by default', () => {
      const s = getFlightRenderState();
      expect(s.inputEnabled).toBe(true);
    });

    it('weather visibility defaults to 0', () => {
      const s = getFlightRenderState();
      expect(s.weatherVisibility).toBe(0);
    });

    it('biome label defaults to null / 0', () => {
      const s = getFlightRenderState();
      expect(s.currentBiomeName).toBeNull();
      expect(s.biomeLabelAlpha).toBe(0);
    });

    it('stars array is empty by default', () => {
      const s = getFlightRenderState();
      expect(s.stars).toEqual([]);
    });

    it('trail segments are empty by default', () => {
      const s = getFlightRenderState();
      expect(s.trailSegments).toEqual([]);
      expect(s.lastTrailTime).toBeNull();
    });

    it('plume states map is empty by default', () => {
      const s = getFlightRenderState();
      expect(s.plumeStates).toBeInstanceOf(Map);
      expect(s.plumeStates.size).toBe(0);
    });

    it('mach phase defaults to 0', () => {
      const s = getFlightRenderState();
      expect(s.machPhase).toBe(0);
    });

    it('input handlers are null by default', () => {
      const s = getFlightRenderState();
      expect(s.wheelHandler).toBeNull();
      expect(s.mouseMoveHandler).toBeNull();
    });

    it('body visuals have Earth-like defaults', () => {
      const s = getFlightRenderState();
      expect(s.bodyVisuals).toBeDefined();
      expect(typeof s.bodyVisuals.seaLevel).toBe('number');
      expect(typeof s.bodyVisuals.highAlt).toBe('number');
      expect(typeof s.bodyVisuals.space).toBe('number');
      expect(typeof s.bodyVisuals.starStart).toBe('number');
      expect(typeof s.bodyVisuals.starEnd).toBe('number');
      expect(typeof s.bodyVisuals.ground).toBe('number');
    });
  });

  describe('setFlightRenderState()', () => {
    it('merges a partial update into the state', () => {
      setFlightRenderState({ zoomLevel: 2.5 });
      const s = getFlightRenderState();
      expect(s.zoomLevel).toBe(2.5);
    });

    it('does not reset other properties when patching', () => {
      const s = getFlightRenderState();
      s.camWorldX = 100;
      setFlightRenderState({ zoomLevel: 3.0 });
      expect(s.camWorldX).toBe(100);
      expect(s.zoomLevel).toBe(3.0);
    });

    it('can set multiple properties at once', () => {
      setFlightRenderState({
        camWorldX: 50,
        camWorldY: 75,
        weatherVisibility: 0.8,
      });
      const s = getFlightRenderState();
      expect(s.camWorldX).toBe(50);
      expect(s.camWorldY).toBe(75);
      expect(s.weatherVisibility).toBe(0.8);
    });

    it('can set input enabled/disabled', () => {
      setFlightRenderState({ inputEnabled: false });
      expect(getFlightRenderState().inputEnabled).toBe(false);
    });
  });

  describe('resetFlightRenderState()', () => {
    it('returns all values to defaults after mutations', () => {
      const s = getFlightRenderState();
      s.zoomLevel = 3.0;
      s.camWorldX = 500;
      s.camWorldY = -200;
      s.weatherVisibility = 0.9;
      s.inputEnabled = false;
      s.machPhase = 42;
      const seg: TrailSegment = {
        worldX: 1, worldY: 2, vx: 3, vy: 4,
        age: 0, baseW: 5, baseH: 6, isSRB: false,
        maxAge: 1, isSmoke: false,
      };
      s.trailSegments.push(seg);

      resetFlightRenderState();

      const fresh = getFlightRenderState();
      expect(fresh.zoomLevel).toBe(1.0);
      expect(fresh.camWorldX).toBe(0);
      expect(fresh.camWorldY).toBe(0);
      expect(fresh.weatherVisibility).toBe(0);
      expect(fresh.inputEnabled).toBe(true);
      expect(fresh.machPhase).toBe(0);
      expect(fresh.trailSegments).toEqual([]);
    });

    it('creates a new state object (old reference is stale)', () => {
      const before = getFlightRenderState();
      resetFlightRenderState();
      const after = getFlightRenderState();
      expect(after).not.toBe(before);
    });

    it('resets plumeStates map', () => {
      const s = getFlightRenderState();
      const plume: PlumeState = { phase: 1.5 };
      s.plumeStates.set('engine1', plume);
      expect(s.plumeStates.size).toBe(1);

      resetFlightRenderState();
      expect(getFlightRenderState().plumeStates.size).toBe(0);
    });
  });
});
