/**
 * surfaceOps.test.js — Unit tests for the surface operations system.
 *
 * Tests cover:
 *   - plantFlag()                — one per body, crewed only, milestone bonus
 *   - collectSurfaceSample()     — crewed only, creates uncollected sample
 *   - deploySurfaceInstrument()  — requires science module
 *   - deployBeacon()             — always available when landed
 *   - processSurfaceOps()        — passive science from instruments
 *   - processSampleReturns()     — science on Earth return
 *   - getAvailableSurfaceActions() — action availability query
 *   - areSurfaceItemsVisible()   — GPS visibility check
 *   - getSurfaceItemsAtBody()    — filtering by body
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState, FlightState, SurfaceItem } from '../core/gameState.ts';
import type { PhysicsState, RocketAssembly, PlacedPart } from '../core/physics.ts';
import {
  plantFlag,
  collectSurfaceSample,
  deploySurfaceInstrument,
  deployBeacon,
  processSurfaceOps,
  processSampleReturns,
  getAvailableSurfaceActions,
  areSurfaceItemsVisible,
  getSurfaceItemsAtBody,
  hasFlag,
} from '../core/surfaceOps.ts';
import {
  SurfaceItemType,
  FLAG_MILESTONE_BONUS,
  FLAG_MILESTONE_REP,
  SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD,
  SURFACE_SAMPLE_BASE_SCIENCE,
  SatelliteType,
} from '../core/constants.ts';

interface SurfaceActionResult {
  success: boolean;
  reason?: string;
  item?: SurfaceItem;
}

interface SurfaceAction {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLandedPS(posX = 100): Partial<PhysicsState> {
  return {
    landed: true,
    crashed: false,
    grounded: false,
    posX,
    posY: 0,
    velX: 0,
    velY: 0,
    activeParts: new Set(['0', '1', '2']),
  };
}

function makeFlyingPS(): Partial<PhysicsState> {
  return {
    landed: false,
    crashed: false,
    grounded: false,
    posX: 0,
    posY: 5000,
    velX: 100,
    velY: 50,
    activeParts: new Set(['0', '1']),
  };
}

function makeCrewedFlightState(bodyId = 'MOON'): Partial<FlightState> {
  return {
    missionId: 'test-mission',
    rocketId: 'test-rocket',
    crewIds: ['crew-1', 'crew-2'],
    timeElapsed: 3600,
    altitude: 0,
    velocity: 0,
    events: [],
    bodyId: bodyId as FlightState['bodyId'],
  };
}

function makeUncrewedFlightState(bodyId = 'MOON'): Partial<FlightState> {
  return {
    missionId: 'test-mission',
    rocketId: 'test-rocket',
    crewIds: [],
    timeElapsed: 3600,
    altitude: 0,
    velocity: 0,
    events: [],
    bodyId: bodyId as FlightState['bodyId'],
  };
}

function makeAssemblyWithScience(): Partial<RocketAssembly> {
  return {
    parts: new Map<string, PlacedPart>([
      ['0', { instanceId: '0', partId: 'cmd-mk1', x: 0, y: 0 }],
      ['1', { instanceId: '1', partId: 'tank-small', x: 0, y: 0 }],
      ['2', { instanceId: '2', partId: 'science-module-mk1', x: 0, y: 0 }],
    ]),
  };
}

function makeAssemblyWithoutScience(): Partial<RocketAssembly> {
  return {
    parts: new Map<string, PlacedPart>([
      ['0', { instanceId: '0', partId: 'cmd-mk1', x: 0, y: 0 }],
      ['1', { instanceId: '1', partId: 'tank-small', x: 0, y: 0 }],
    ]),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('surfaceOps', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState();
    state.agencyName = 'Test Agency';
  });

  // =========================================================================
  // plantFlag
  // =========================================================================

  describe('plantFlag()', () => {
    it('plants a flag on a body when crewed and landed', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;

      const result: SurfaceActionResult = plantFlag(state, fs, ps);

      expect(result.success).toBe(true);
      expect(result.item).toBeDefined();
      expect(result.item!.type).toBe(SurfaceItemType.FLAG);
      expect(result.item!.bodyId).toBe('MOON');
      expect(state.surfaceItems).toHaveLength(1);
    });

    it('awards milestone bonus cash and reputation', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const cashBefore = state.money;
      const repBefore = state.reputation;

      plantFlag(state, fs, ps);

      expect(state.money).toBe(cashBefore + FLAG_MILESTONE_BONUS);
      expect(state.reputation).toBe(repBefore + FLAG_MILESTONE_REP);
    });

    it('adds a flight event', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;

      plantFlag(state, fs, ps);

      expect(fs.events).toHaveLength(1);
      expect(fs.events[0].type).toBe('FLAG_PLANTED');
    });

    it('rejects planting a second flag on the same body', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;

      plantFlag(state, fs, ps);
      const result: SurfaceActionResult = plantFlag(state, fs, ps);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('already planted');
    });

    it('allows planting flags on different bodies', () => {
      const ps = makeLandedPS() as PhysicsState;

      plantFlag(state, makeCrewedFlightState('MOON') as FlightState, ps);
      const result: SurfaceActionResult = plantFlag(state, makeCrewedFlightState('MARS') as FlightState, ps);

      expect(result.success).toBe(true);
      expect(state.surfaceItems).toHaveLength(2);
    });

    it('rejects uncrewed flights', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeUncrewedFlightState('MOON') as FlightState;

      const result: SurfaceActionResult = plantFlag(state, fs, ps);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('Crew');
    });

    it('rejects when not landed', () => {
      const ps = makeFlyingPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;

      const result: SurfaceActionResult = plantFlag(state, fs, ps);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('landed');
    });
  });

  // =========================================================================
  // collectSurfaceSample
  // =========================================================================

  describe('collectSurfaceSample()', () => {
    it('collects a sample when crewed and landed', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MARS') as FlightState;

      const result: SurfaceActionResult = collectSurfaceSample(state, fs, ps);

      expect(result.success).toBe(true);
      expect(result.item!.type).toBe(SurfaceItemType.SURFACE_SAMPLE);
      expect(result.item!.collected).toBe(false);
    });

    it('rejects uncrewed flights', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeUncrewedFlightState('MARS') as FlightState;

      const result: SurfaceActionResult = collectSurfaceSample(state, fs, ps);

      expect(result.success).toBe(false);
    });

    it('allows multiple samples on the same body', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MARS') as FlightState;

      collectSurfaceSample(state, fs, ps);
      const result: SurfaceActionResult = collectSurfaceSample(state, fs, ps);

      expect(result.success).toBe(true);
      expect(state.surfaceItems).toHaveLength(2);
    });
  });

  // =========================================================================
  // deploySurfaceInstrument
  // =========================================================================

  describe('deploySurfaceInstrument()', () => {
    it('deploys an instrument when science module is present', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithScience() as RocketAssembly;

      const result: SurfaceActionResult = deploySurfaceInstrument(state, fs, ps, assembly);

      expect(result.success).toBe(true);
      expect(result.item!.type).toBe(SurfaceItemType.SURFACE_INSTRUMENT);
    });

    it('rejects when no science module is present', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithoutScience() as RocketAssembly;

      const result: SurfaceActionResult = deploySurfaceInstrument(state, fs, ps, assembly);

      expect(result.success).toBe(false);
      expect(result.reason).toContain('science module');
    });

    it('rejects when not landed', () => {
      const ps = makeFlyingPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithScience() as RocketAssembly;

      const result: SurfaceActionResult = deploySurfaceInstrument(state, fs, ps, assembly);

      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // deployBeacon
  // =========================================================================

  describe('deployBeacon()', () => {
    it('deploys a beacon when landed', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;

      const result: SurfaceActionResult = deployBeacon(state, fs, ps);

      expect(result.success).toBe(true);
      expect(result.item!.type).toBe(SurfaceItemType.BEACON);
    });

    it('works for uncrewed flights', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeUncrewedFlightState('MOON') as FlightState;

      const result: SurfaceActionResult = deployBeacon(state, fs, ps);

      expect(result.success).toBe(true);
    });

    it('uses custom beacon name', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;

      const result: SurfaceActionResult = deployBeacon(state, fs, ps, 'Alpha Base');

      expect(result.success).toBe(true);
      expect(result.item!.label).toBe('Alpha Base');
    });
  });

  // =========================================================================
  // processSurfaceOps
  // =========================================================================

  describe('processSurfaceOps()', () => {
    it('awards science per deployed instrument per period', () => {
      const scienceBefore = state.sciencePoints;

      // Deploy 2 instruments.
      state.surfaceItems = [
        { id: 'si-1', type: SurfaceItemType.SURFACE_INSTRUMENT, bodyId: 'MOON', posX: 0, deployedPeriod: 0 } as SurfaceItem,
        { id: 'si-2', type: SurfaceItemType.SURFACE_INSTRUMENT, bodyId: 'MARS', posX: 0, deployedPeriod: 0 } as SurfaceItem,
      ];

      const result = processSurfaceOps(state);

      expect(result.scienceEarned).toBe(2 * SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD);
      expect(state.sciencePoints).toBe(scienceBefore + 2 * SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD);
    });

    it('does not award science for non-instrument items', () => {
      state.surfaceItems = [
        { id: 'f-1', type: SurfaceItemType.FLAG, bodyId: 'MOON', posX: 0, deployedPeriod: 0 } as SurfaceItem,
        { id: 'b-1', type: SurfaceItemType.BEACON, bodyId: 'MOON', posX: 0, deployedPeriod: 0 } as SurfaceItem,
      ];

      const result = processSurfaceOps(state);

      expect(result.scienceEarned).toBe(0);
    });
  });

  // =========================================================================
  // processSampleReturns
  // =========================================================================

  describe('processSampleReturns()', () => {
    it('awards science for uncollected samples on safe Earth landing', () => {
      state.surfaceItems = [
        { id: 's-1', type: SurfaceItemType.SURFACE_SAMPLE, bodyId: 'MOON', posX: 0, deployedPeriod: 0, collected: false } as SurfaceItem,
        { id: 's-2', type: SurfaceItemType.SURFACE_SAMPLE, bodyId: 'MARS', posX: 0, deployedPeriod: 0, collected: false } as SurfaceItem,
      ];

      const result = processSampleReturns(state, 'EARTH');

      expect(result.samplesReturned).toBe(2);
      expect(result.scienceEarned).toBe(2 * SURFACE_SAMPLE_BASE_SCIENCE);
      expect(state.surfaceItems[0].collected).toBe(true);
      expect(state.surfaceItems[1].collected).toBe(true);
    });

    it('does not process samples when landing on non-Earth body', () => {
      state.surfaceItems = [
        { id: 's-1', type: SurfaceItemType.SURFACE_SAMPLE, bodyId: 'MOON', posX: 0, deployedPeriod: 0, collected: false } as SurfaceItem,
      ];

      const result = processSampleReturns(state, 'MOON');

      expect(result.samplesReturned).toBe(0);
      expect(state.surfaceItems[0].collected).toBe(false);
    });

    it('skips already-collected samples', () => {
      state.surfaceItems = [
        { id: 's-1', type: SurfaceItemType.SURFACE_SAMPLE, bodyId: 'MOON', posX: 0, deployedPeriod: 0, collected: true } as SurfaceItem,
        { id: 's-2', type: SurfaceItemType.SURFACE_SAMPLE, bodyId: 'MARS', posX: 0, deployedPeriod: 0, collected: false } as SurfaceItem,
      ];

      const result = processSampleReturns(state, 'EARTH');

      expect(result.samplesReturned).toBe(1);
    });
  });

  // =========================================================================
  // getAvailableSurfaceActions
  // =========================================================================

  describe('getAvailableSurfaceActions()', () => {
    it('returns all actions when crewed with science module and landed', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithScience() as RocketAssembly;

      const actions: SurfaceAction[] = getAvailableSurfaceActions(state, fs, ps, assembly);

      expect(actions).toHaveLength(4);
      expect(actions.find(a => a.id === 'plant-flag')!.enabled).toBe(true);
      expect(actions.find(a => a.id === 'collect-sample')!.enabled).toBe(true);
      expect(actions.find(a => a.id === 'deploy-instrument')!.enabled).toBe(true);
      expect(actions.find(a => a.id === 'deploy-beacon')!.enabled).toBe(true);
    });

    it('disables flag after already planted', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithScience() as RocketAssembly;

      plantFlag(state, fs, ps);
      const actions: SurfaceAction[] = getAvailableSurfaceActions(state, fs, ps, assembly);

      expect(actions.find(a => a.id === 'plant-flag')!.enabled).toBe(false);
    });

    it('disables crew-only actions for uncrewed flights', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeUncrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithScience() as RocketAssembly;

      const actions: SurfaceAction[] = getAvailableSurfaceActions(state, fs, ps, assembly);

      expect(actions.find(a => a.id === 'plant-flag')!.enabled).toBe(false);
      expect(actions.find(a => a.id === 'collect-sample')!.enabled).toBe(false);
      // Instrument and beacon should still work.
      expect(actions.find(a => a.id === 'deploy-instrument')!.enabled).toBe(true);
      expect(actions.find(a => a.id === 'deploy-beacon')!.enabled).toBe(true);
    });

    it('disables instrument without science module', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithoutScience() as RocketAssembly;

      const actions: SurfaceAction[] = getAvailableSurfaceActions(state, fs, ps, assembly);

      expect(actions.find(a => a.id === 'deploy-instrument')!.enabled).toBe(false);
    });

    it('returns empty array when not landed', () => {
      const ps = makeFlyingPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      const assembly = makeAssemblyWithScience() as RocketAssembly;

      const actions: SurfaceAction[] = getAvailableSurfaceActions(state, fs, ps, assembly);

      expect(actions).toHaveLength(0);
    });
  });

  // =========================================================================
  // areSurfaceItemsVisible
  // =========================================================================

  describe('areSurfaceItemsVisible()', () => {
    it('always visible on Earth', () => {
      expect(areSurfaceItemsVisible(state, 'EARTH')).toBe(true);
    });

    it('not visible on Moon without GPS satellites', () => {
      expect(areSurfaceItemsVisible(state, 'MOON')).toBe(false);
    });

    it('visible on Moon with GPS satellite in orbit around Moon', () => {
      state.satelliteNetwork.satellites.push({
        id: 'sat-gps-1',
        orbitalObjectId: 'oo-1',
        satelliteType: SatelliteType.GPS,
        partId: 'satellite-gps',
        bodyId: 'MOON',
        bandId: 'MLO',
        health: 100,
        autoMaintain: false,
        deployedPeriod: 1,
      });

      expect(areSurfaceItemsVisible(state, 'MOON')).toBe(true);
    });

    it('GPS satellite at wrong body does not help', () => {
      state.satelliteNetwork.satellites.push({
        id: 'sat-gps-1',
        orbitalObjectId: 'oo-1',
        satelliteType: SatelliteType.GPS,
        partId: 'satellite-gps',
        bodyId: 'EARTH',
        bandId: 'MEO',
        health: 100,
        autoMaintain: false,
        deployedPeriod: 1,
      });

      expect(areSurfaceItemsVisible(state, 'MOON')).toBe(false);
    });

    it('dead GPS satellite (health 0) does not count', () => {
      state.satelliteNetwork.satellites.push({
        id: 'sat-gps-1',
        orbitalObjectId: 'oo-1',
        satelliteType: SatelliteType.GPS,
        partId: 'satellite-gps',
        bodyId: 'MOON',
        bandId: 'MLO',
        health: 0,
        autoMaintain: false,
        deployedPeriod: 1,
      });

      expect(areSurfaceItemsVisible(state, 'MOON')).toBe(false);
    });
  });

  // =========================================================================
  // getSurfaceItemsAtBody
  // =========================================================================

  describe('getSurfaceItemsAtBody()', () => {
    it('filters items by body', () => {
      state.surfaceItems = [
        { id: '1', type: SurfaceItemType.FLAG, bodyId: 'MOON', posX: 0, deployedPeriod: 0 } as SurfaceItem,
        { id: '2', type: SurfaceItemType.FLAG, bodyId: 'MARS', posX: 0, deployedPeriod: 0 } as SurfaceItem,
        { id: '3', type: SurfaceItemType.BEACON, bodyId: 'MOON', posX: 50, deployedPeriod: 0 } as SurfaceItem,
      ];

      const moonItems: SurfaceItem[] = getSurfaceItemsAtBody(state, 'MOON');
      const marsItems: SurfaceItem[] = getSurfaceItemsAtBody(state, 'MARS');

      expect(moonItems).toHaveLength(2);
      expect(marsItems).toHaveLength(1);
    });

    it('returns empty array for body with no items', () => {
      expect(getSurfaceItemsAtBody(state, 'VENUS')).toHaveLength(0);
    });
  });

  // =========================================================================
  // hasFlag
  // =========================================================================

  describe('hasFlag()', () => {
    it('returns false when no flag planted', () => {
      expect(hasFlag(state, 'MOON')).toBe(false);
    });

    it('returns true after planting a flag', () => {
      const ps = makeLandedPS() as PhysicsState;
      const fs = makeCrewedFlightState('MOON') as FlightState;
      plantFlag(state, fs, ps);

      expect(hasFlag(state, 'MOON')).toBe(true);
      expect(hasFlag(state, 'MARS')).toBe(false);
    });
  });
});
