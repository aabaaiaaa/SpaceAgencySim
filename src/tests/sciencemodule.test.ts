// @ts-nocheck
/**
 * sciencemodule.test.js — Unit tests for sciencemodule.js edge cases and
 * behaviours not covered by instruments.test.js.
 *
 * Tests cover:
 *   Malfunction blocking           — SCIENCE_INSTRUMENT_FAILURE blocks activation
 *   Crew science skill             — duration reduction and yield bonus
 *   R&D Lab science bonus          — tier-based yield multiplier
 *   Inactive parts                 — activation/tick/transmit/landing skipped
 *   Legacy module tick             — modules with no instruments loaded
 *   Legacy module safe landing     — data recovery for legacy modules
 *   Multiple instrument timing     — different completion times in one module
 *   Diminishing returns edge cases — null biome, cumulative collections
 *   Status query edge cases        — null instrumentStates, getScienceModuleTimer aggregation
 *   getScienceModuleStatus         — priority ordering across mixed states
 *   Transmit edge cases            — already transmitted, inactive part
 */

import { describe, it, expect } from 'vitest';
import {
  ScienceModuleState,
  initInstrumentStates,
  activateInstrument,
  activateAllInstruments,
  activateScienceModule,
  tickInstruments,
  transmitInstrument,
  getScienceModuleStatus,
  getScienceModuleTimer,
  getInstrumentStatus,
  getInstrumentTimer,
  getModuleInstrumentKeys,
  onSafeLanding,
  hasAnyRunningExperiment,
  calculateYield,
  getInstrumentKey,
} from '../core/sciencemodule.ts';
import { getInstrumentById } from '../data/instruments.ts';
import {
  ScienceDataType,
  DIMINISHING_RETURNS,
  FacilityId,
  RD_LAB_SCIENCE_BONUS,
  MalfunctionType,
} from '../core/constants.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
} from '../core/rocketbuilder.ts';
import { createPhysicsState } from '../core/physics.ts';
import { createFlightState } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeFlightState(overrides = {}) {
  return { ...createFlightState({ missionId: 'test', rocketId: 'test' }), ...overrides };
}

function makeAssemblyWithInstruments(instrumentIds) {
  const assembly = createRocketAssembly();
  const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
  const scienceId = addPartToAssembly(assembly, 'science-module-mk1', 0, 100);
  connectParts(assembly, probeId, 1, scienceId, 0);

  const placed = assembly.parts.get(scienceId);
  placed.instruments = [...instrumentIds];

  return { assembly, probeId, scienceId };
}

function makeLegacyAssembly() {
  const assembly = createRocketAssembly();
  const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
  const scienceId = addPartToAssembly(assembly, 'science-module-mk1', 0, 100);
  connectParts(assembly, probeId, 1, scienceId, 0);
  // No instruments loaded — legacy module behaviour.
  return { assembly, probeId, scienceId };
}

function makePhysicsState(assembly, altitude = 0) {
  const ps = createPhysicsState(assembly, makeFlightState());
  ps.posY = altitude;
  return ps;
}

function makeGameState(overrides = {}) {
  return {
    scienceLog: [],
    sciencePoints: 0,
    crew: [],
    facilities: {},
    ...overrides,
  };
}

function makeGameStateWithRdLab(tier) {
  return makeGameState({
    facilities: {
      [FacilityId.RD_LAB]: { built: true, tier },
    },
  });
}

function makeGameStateWithCrew(scienceSkill) {
  return makeGameState({
    crew: [{ id: 'crew-1', skills: { science: scienceSkill } }],
  });
}

// ---------------------------------------------------------------------------
// Malfunction blocking activation
// ---------------------------------------------------------------------------

describe('Malfunction blocking', () => {
  it('blocks activation when science module has SCIENCE_INSTRUMENT_FAILURE', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    // Inject a malfunction.
    if (!ps.malfunctions) ps.malfunctions = new Map();
    ps.malfunctions.set(scienceId, {
      type: MalfunctionType.SCIENCE_INSTRUMENT_FAILURE,
      recovered: false,
    });

    const key = getInstrumentKey(scienceId, 0);
    const result = activateInstrument(ps, assembly, fs, key);

    expect(result).toBe(false);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.IDLE);
  });

  it('allows activation after malfunction is recovered', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    if (!ps.malfunctions) ps.malfunctions = new Map();
    ps.malfunctions.set(scienceId, {
      type: MalfunctionType.SCIENCE_INSTRUMENT_FAILURE,
      recovered: true,
    });

    const key = getInstrumentKey(scienceId, 0);
    const result = activateInstrument(ps, assembly, fs, key);

    expect(result).toBe(true);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);
  });

  it('allows activation when malfunction type is not SCIENCE_INSTRUMENT_FAILURE', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    if (!ps.malfunctions) ps.malfunctions = new Map();
    ps.malfunctions.set(scienceId, {
      type: MalfunctionType.FUEL_TANK_LEAK,
      recovered: false,
    });

    const key = getInstrumentKey(scienceId, 0);
    const result = activateInstrument(ps, assembly, fs, key);

    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Crew science skill effects
// ---------------------------------------------------------------------------

describe('Crew science skill', () => {
  it('reduces experiment duration at 100 skill by ~1/3', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const gs = makeGameStateWithCrew(100);
    const fs = makeFlightState({ crewIds: ['crew-1'], _gameState: gs });
    ps._gameState = gs;

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);

    const entry = ps.instrumentStates.get(key);
    const baseDuration = getInstrumentById('thermometer-mk1').experimentDuration; // 10s
    // At 100 skill: durationFactor = 1 - (100/100) * (1/3) ≈ 0.6667
    const expected = baseDuration * (2 / 3);
    expect(entry.timer).toBeCloseTo(expected, 1);
  });

  it('does not reduce duration at 0 skill', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const gs = makeGameStateWithCrew(0);
    const fs = makeFlightState({ crewIds: ['crew-1'], _gameState: gs });
    ps._gameState = gs;

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);

    const baseDuration = getInstrumentById('thermometer-mk1').experimentDuration;
    expect(ps.instrumentStates.get(key).timer).toBe(baseDuration);
  });

  it('reduces duration proportionally at 50 skill', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const gs = makeGameStateWithCrew(50);
    const fs = makeFlightState({ crewIds: ['crew-1'], _gameState: gs });
    ps._gameState = gs;

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);

    const baseDuration = getInstrumentById('thermometer-mk1').experimentDuration;
    // At 50 skill: factor = 1 - (50/100) * (1/3) = 1 - 1/6 ≈ 0.8333
    const expected = baseDuration * (5 / 6);
    expect(ps.instrumentStates.get(key).timer).toBeCloseTo(expected, 1);
  });

  it('uses highest crew member science skill', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const gs = makeGameState({
      crew: [
        { id: 'c1', skills: { science: 20 } },
        { id: 'c2', skills: { science: 80 } },
        { id: 'c3', skills: { science: 40 } },
      ],
    });
    const fs = makeFlightState({ crewIds: ['c1', 'c2', 'c3'], _gameState: gs });
    ps._gameState = gs;

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);

    const baseDuration = getInstrumentById('thermometer-mk1').experimentDuration;
    // Best skill = 80: factor = 1 - (80/100) * (1/3) = 1 - 0.2667 ≈ 0.7333
    const expected = baseDuration * (1 - (80 / 100) * (1 / 3));
    expect(ps.instrumentStates.get(key).timer).toBeCloseTo(expected, 1);
  });
});

// ---------------------------------------------------------------------------
// R&D Lab science bonus in yield
// ---------------------------------------------------------------------------

describe('R&D Lab science bonus', () => {
  it('applies tier 1 bonus (+10%) to yield', () => {
    const gs = makeGameStateWithRdLab(1);
    const baseYield = getInstrumentById('thermometer-mk1').baseYield;

    const yield_ = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    // base * biome * skill(1.0) * diminish(1.0) * (1 + 0.10) = 5 * 1.1 = 5.5
    expect(yield_).toBeCloseTo(baseYield * 1.10, 2);
  });

  it('applies tier 2 bonus (+20%) to yield', () => {
    const gs = makeGameStateWithRdLab(2);
    const baseYield = getInstrumentById('thermometer-mk1').baseYield;

    const yield_ = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(yield_).toBeCloseTo(baseYield * 1.20, 2);
  });

  it('applies tier 3 bonus (+30%) to yield', () => {
    const gs = makeGameStateWithRdLab(3);
    const baseYield = getInstrumentById('thermometer-mk1').baseYield;

    const yield_ = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(yield_).toBeCloseTo(baseYield * 1.30, 2);
  });

  it('applies no bonus when R&D Lab is not built', () => {
    const gs = makeGameState();
    const baseYield = getInstrumentById('thermometer-mk1').baseYield;

    const yield_ = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(yield_).toBeCloseTo(baseYield, 2);
  });

  it('combines R&D bonus with skill and biome multiplier', () => {
    const gs = makeGameStateWithRdLab(2);
    const baseYield = getInstrumentById('thermometer-mk1').baseYield;

    // skill 60 → bonus 1.3, biome 2.0, rdlab +20%
    const yield_ = calculateYield('thermometer-mk1', 'GROUND', 2.0, 60, gs);
    const expected = baseYield * 2.0 * 1.3 * 1.0 * 1.20;
    expect(yield_).toBeCloseTo(expected, 1);
  });
});

// ---------------------------------------------------------------------------
// Inactive parts
// ---------------------------------------------------------------------------

describe('Inactive parts', () => {
  it('blocks activation when module is not in activeParts', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    // Remove from active parts.
    ps.activeParts.delete(scienceId);

    const key = getInstrumentKey(scienceId, 0);
    expect(activateInstrument(ps, assembly, fs, key)).toBe(false);
  });

  it('tick skips instruments on inactive parts', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);

    // Deactivate the part.
    ps.activeParts.delete(scienceId);

    const timerBefore = ps.instrumentStates.get(key).timer;
    tickInstruments(ps, assembly, fs, 5);
    // Timer should not change since part is inactive.
    expect(ps.instrumentStates.get(key).timer).toBe(timerBefore);
  });

  it('transmit fails when module is inactive', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15); // complete

    ps.activeParts.delete(scienceId);
    expect(transmitInstrument(ps, assembly, fs, key, gs)).toBe(0);
  });

  it('safe landing skips inactive parts', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.COMPLETE);

    ps.activeParts.delete(scienceId);
    onSafeLanding(ps, assembly, fs, gs);

    // Should remain COMPLETE, not transition to DATA_RETURNED.
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.COMPLETE);
  });

  it('hasAnyRunningExperiment ignores inactive parts', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    expect(hasAnyRunningExperiment(ps)).toBe(true);

    ps.activeParts.delete(scienceId);
    expect(hasAnyRunningExperiment(ps)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Legacy module behaviour (no instruments loaded)
// ---------------------------------------------------------------------------

describe('Legacy module (no instruments)', () => {
  it('activateScienceModule starts legacy experiment', () => {
    const { assembly, scienceId } = makeLegacyAssembly();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    // Set up legacy entry manually (initInstrumentStates creates one for
    // modules with COLLECT_SCIENCE activation even without instruments).
    if (!ps.scienceModuleStates.has(scienceId)) {
      ps.scienceModuleStates.set(scienceId, {
        state: ScienceModuleState.IDLE,
        timer: 0,
        startBiome: null,
        completeBiome: null,
        scienceMultiplier: 1.0,
      });
    }

    const result = activateScienceModule(ps, assembly, fs, scienceId);
    expect(result).toBe(true);

    const entry = ps.scienceModuleStates.get(scienceId);
    expect(entry.state).toBe(ScienceModuleState.RUNNING);
    expect(entry.timer).toBeGreaterThan(0);
  });

  it('legacy module ticks and completes via tickInstruments', () => {
    const { assembly, scienceId } = makeLegacyAssembly();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    ps.scienceModuleStates.set(scienceId, {
      state: ScienceModuleState.RUNNING,
      timer: 5,
      startBiome: 'GROUND',
      completeBiome: null,
      scienceMultiplier: 1.0,
    });

    tickInstruments(ps, assembly, fs, 6);

    const entry = ps.scienceModuleStates.get(scienceId);
    expect(entry.state).toBe(ScienceModuleState.COMPLETE);
    expect(entry.timer).toBe(0);
    expect(entry.completeBiome).toBeDefined();

    const event = fs.events.find((e) => e.type === 'SCIENCE_COLLECTED');
    expect(event).toBeDefined();
    expect(event.instanceId).toBe(scienceId);
  });

  it('legacy module sets scienceModuleRunning flag during tick', () => {
    const { assembly, scienceId } = makeLegacyAssembly();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();
    fs.scienceModuleRunning = false;

    ps.scienceModuleStates.set(scienceId, {
      state: ScienceModuleState.RUNNING,
      timer: 10,
      startBiome: 'GROUND',
      completeBiome: null,
      scienceMultiplier: 1.0,
    });

    tickInstruments(ps, assembly, fs, 1);
    expect(fs.scienceModuleRunning).toBe(true);
  });

  it('onSafeLanding recovers data from legacy modules', () => {
    const { assembly, scienceId } = makeLegacyAssembly();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();
    const gs = makeGameState();

    ps.scienceModuleStates.set(scienceId, {
      state: ScienceModuleState.COMPLETE,
      timer: 0,
      startBiome: 'GROUND',
      completeBiome: 'GROUND',
      scienceMultiplier: 1.0,
    });

    onSafeLanding(ps, assembly, fs, gs);

    expect(ps.scienceModuleStates.get(scienceId).state).toBe(ScienceModuleState.DATA_RETURNED);

    const event = fs.events.find((e) => e.type === 'SCIENCE_DATA_RETURNED');
    expect(event).toBeDefined();
    expect(event.instanceId).toBe(scienceId);
  });

  it('hasAnyRunningExperiment detects running legacy modules', () => {
    const { assembly, scienceId } = makeLegacyAssembly();
    const ps = makePhysicsState(assembly);

    ps.scienceModuleStates.set(scienceId, {
      state: ScienceModuleState.RUNNING,
      timer: 5,
      startBiome: null,
      completeBiome: null,
      scienceMultiplier: 1.0,
    });

    expect(hasAnyRunningExperiment(ps)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multiple instruments with different timers
// ---------------------------------------------------------------------------

describe('Multiple instruments timing', () => {
  it('instruments complete at their own pace within a single module', () => {
    // thermometer-mk1: 10s, surface-sampler: 40s — both valid in GROUND.
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'surface-sampler']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);

    activateInstrument(ps, assembly, fs, key0);
    activateInstrument(ps, assembly, fs, key1);

    // Tick 12s — thermometer should complete, sampler still running.
    tickInstruments(ps, assembly, fs, 12);

    expect(ps.instrumentStates.get(key0).state).toBe(ScienceModuleState.COMPLETE);
    expect(ps.instrumentStates.get(key1).state).toBe(ScienceModuleState.RUNNING);
    expect(ps.instrumentStates.get(key1).timer).toBeCloseTo(28, 0);
  });

  it('module status shows RUNNING when any instrument is running', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'surface-sampler']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);

    activateInstrument(ps, assembly, fs, key0);
    activateInstrument(ps, assembly, fs, key1);
    tickInstruments(ps, assembly, fs, 12);

    // One complete, one running → module reports RUNNING.
    expect(getScienceModuleStatus(ps, scienceId)).toBe(ScienceModuleState.RUNNING);
  });

  it('module status shows COMPLETE when all instruments are complete', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'surface-sampler']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);

    activateInstrument(ps, assembly, fs, key0);
    activateInstrument(ps, assembly, fs, key1);
    tickInstruments(ps, assembly, fs, 50); // Both complete.

    expect(getScienceModuleStatus(ps, scienceId)).toBe(ScienceModuleState.COMPLETE);
  });
});

// ---------------------------------------------------------------------------
// getScienceModuleTimer aggregation
// ---------------------------------------------------------------------------

describe('getScienceModuleTimer', () => {
  it('returns max timer across running instruments', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'surface-sampler']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);

    activateInstrument(ps, assembly, fs, key0);
    activateInstrument(ps, assembly, fs, key1);

    // thermometer: 10s, sampler: 40s → max = 40.
    const timer = getScienceModuleTimer(ps, scienceId);
    expect(timer).toBe(40);
  });

  it('returns 0 when no instruments are running', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);

    expect(getScienceModuleTimer(ps, scienceId)).toBe(0);
  });

  it('returns 0 for unknown module', () => {
    const { assembly } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);

    expect(getScienceModuleTimer(ps, 'nonexistent')).toBe(0);
  });

  it('falls back to legacy timer when no instruments', () => {
    const { assembly, scienceId } = makeLegacyAssembly();
    const ps = makePhysicsState(assembly);

    ps.scienceModuleStates.set(scienceId, {
      state: ScienceModuleState.RUNNING,
      timer: 15,
      startBiome: null,
      completeBiome: null,
      scienceMultiplier: 1.0,
    });

    expect(getScienceModuleTimer(ps, scienceId)).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// getScienceModuleStatus priority
// ---------------------------------------------------------------------------

describe('getScienceModuleStatus priority', () => {
  it('returns DATA_RETURNED when all instruments returned or transmitted', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'surface-sampler']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);

    activateInstrument(ps, assembly, fs, key0);
    activateInstrument(ps, assembly, fs, key1);
    tickInstruments(ps, assembly, fs, 50);

    // Return both via safe landing.
    onSafeLanding(ps, assembly, fs, gs);

    expect(getScienceModuleStatus(ps, scienceId)).toBe(ScienceModuleState.DATA_RETURNED);
  });

  it('returns IDLE for module with no instrument states', () => {
    const { assembly } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);

    expect(getScienceModuleStatus(ps, 'nonexistent-module')).toBe(ScienceModuleState.IDLE);
  });

  it('falls back to legacy state when no instrument keys exist', () => {
    const { assembly, scienceId } = makeLegacyAssembly();
    const ps = makePhysicsState(assembly);

    ps.scienceModuleStates.set(scienceId, {
      state: ScienceModuleState.COMPLETE,
      timer: 0,
      startBiome: null,
      completeBiome: null,
      scienceMultiplier: 1.0,
    });

    expect(getScienceModuleStatus(ps, scienceId)).toBe(ScienceModuleState.COMPLETE);
  });
});

// ---------------------------------------------------------------------------
// Transmit edge cases
// ---------------------------------------------------------------------------

describe('Transmit edge cases', () => {
  it('cannot transmit an instrument that was already transmitted', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15);

    // Transmit once.
    transmitInstrument(ps, assembly, fs, key, gs);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.TRANSMITTED);

    // Second transmit fails.
    expect(transmitInstrument(ps, assembly, fs, key, gs)).toBe(0);
  });

  it('cannot transmit a still-running instrument', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    // Still running — do not tick to completion.

    expect(transmitInstrument(ps, assembly, fs, key, gs)).toBe(0);
  });

  it('cannot transmit an idle instrument', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    // Never activated.
    expect(transmitInstrument(ps, assembly, fs, key, gs)).toBe(0);
  });

  it('cannot transmit unknown key', () => {
    const { assembly } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    expect(transmitInstrument(ps, assembly, fs, 'nonexistent:instr:0', gs)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Diminishing returns edge cases
// ---------------------------------------------------------------------------

describe('Diminishing returns edge cases', () => {
  it('handles null biome by normalising to empty string', () => {
    const gs = makeGameState();

    const first = calculateYield('thermometer-mk1', null, 1.0, 0, gs);
    expect(first).toBeGreaterThan(0);

    // Record with null biome.
    gs.scienceLog.push({ instrumentId: 'thermometer-mk1', biomeId: '', count: 1 });

    const second = calculateYield('thermometer-mk1', null, 1.0, 0, gs);
    expect(second).toBeCloseTo(first * 0.25, 1);
  });

  it('handles null gameState gracefully (no diminishing returns applied)', () => {
    const yield_ = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, null);
    const baseYield = getInstrumentById('thermometer-mk1').baseYield;
    // No gameState → priorCount = 0 → DIMINISHING_RETURNS[0] = 1.0, no rdlab bonus.
    expect(yield_).toBeCloseTo(baseYield, 2);
  });

  it('cumulative collections degrade yield across multiple flights', () => {
    const gs = makeGameState();
    const baseYield = getInstrumentById('thermometer-mk1').baseYield;

    // First collection.
    const y1 = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(y1).toBeCloseTo(baseYield * DIMINISHING_RETURNS[0], 2);

    gs.scienceLog.push({ instrumentId: 'thermometer-mk1', biomeId: 'GROUND', count: 1 });
    const y2 = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(y2).toBeCloseTo(baseYield * DIMINISHING_RETURNS[1], 2);

    gs.scienceLog[0].count = 2;
    const y3 = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(y3).toBeCloseTo(baseYield * DIMINISHING_RETURNS[2], 2);

    gs.scienceLog[0].count = 3;
    const y4 = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(y4).toBe(0);

    gs.scienceLog[0].count = 100;
    const y100 = calculateYield('thermometer-mk1', 'GROUND', 1.0, 0, gs);
    expect(y100).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Defensive / null-safety edge cases
// ---------------------------------------------------------------------------

describe('Null-safety edge cases', () => {
  it('getInstrumentStatus returns IDLE when instrumentStates is undefined', () => {
    const ps = { instrumentStates: undefined };
    expect(getInstrumentStatus(ps, 'any:instr:0')).toBe(ScienceModuleState.IDLE);
  });

  it('getInstrumentTimer returns 0 when instrumentStates is undefined', () => {
    const ps = { instrumentStates: undefined };
    expect(getInstrumentTimer(ps, 'any:instr:0')).toBe(0);
  });

  it('getModuleInstrumentKeys returns [] when instrumentStates is undefined', () => {
    const ps = { instrumentStates: undefined };
    expect(getModuleInstrumentKeys(ps, 'any')).toEqual([]);
  });

  it('tickInstruments is a no-op when instrumentStates is undefined', () => {
    const ps = { instrumentStates: undefined, scienceModuleStates: undefined, activeParts: new Set() };
    const fs = makeFlightState();
    // Should not throw.
    expect(() => tickInstruments(ps, { parts: new Map() }, fs, 1)).not.toThrow();
  });

  it('onSafeLanding handles undefined instrumentStates and scienceModuleStates', () => {
    const ps = { instrumentStates: undefined, scienceModuleStates: undefined, activeParts: new Set() };
    const fs = makeFlightState();
    const gs = makeGameState();
    expect(() => onSafeLanding(ps, { parts: new Map() }, fs, gs)).not.toThrow();
  });

  it('hasAnyRunningExperiment returns false for empty maps', () => {
    const ps = {
      instrumentStates: new Map(),
      scienceModuleStates: new Map(),
      activeParts: new Set(),
    };
    expect(hasAnyRunningExperiment(ps)).toBe(false);
  });

  it('activateInstrument returns false when instrumentStates is undefined', () => {
    const ps = { instrumentStates: undefined, activeParts: new Set() };
    const fs = makeFlightState();
    expect(activateInstrument(ps, { parts: new Map() }, fs, 'any:instr:0')).toBe(false);
  });

  it('activateAllInstruments returns 0 when instrumentStates is undefined', () => {
    const ps = { instrumentStates: undefined, activeParts: new Set() };
    const fs = makeFlightState();
    expect(activateAllInstruments(ps, { parts: new Map() }, fs, 'mod-1')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Full lifecycle — activate → tick → complete → return/transmit
// ---------------------------------------------------------------------------

describe('Full instrument lifecycle', () => {
  it('SAMPLE instrument: activate → complete → safe landing returns full yield', () => {
    // surface-sampler: SAMPLE type, 40s, valid in GROUND.
    const { assembly, scienceId } = makeAssemblyWithInstruments(['surface-sampler']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);

    // 1. Activate.
    expect(activateInstrument(ps, assembly, fs, key)).toBe(true);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);

    // 2. Tick to completion.
    tickInstruments(ps, assembly, fs, 45);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.COMPLETE);

    // 3. Safe landing recovers data.
    onSafeLanding(ps, assembly, fs, gs);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.DATA_RETURNED);

    const returnEvent = fs.events.find((e) => e.type === 'SCIENCE_DATA_RETURNED' && e.instrumentKey === key);
    expect(returnEvent).toBeDefined();
    expect(returnEvent.scienceYield).toBeGreaterThan(0);
    expect(returnEvent.dataType).toBe(ScienceDataType.SAMPLE);

    // 4. Diminishing returns recorded.
    expect(gs.scienceLog.length).toBe(1);
    expect(gs.scienceLog[0].instrumentId).toBe('surface-sampler');
    expect(gs.scienceLog[0].count).toBe(1);
  });

  it('ANALYSIS instrument: activate → complete → transmit returns reduced yield', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);

    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15);

    const fullYield = calculateYield(
      'thermometer-mk1',
      ps.instrumentStates.get(key).completeBiome,
      ps.instrumentStates.get(key).scienceMultiplier,
      0,
      gs,
    );

    const transmitYield = transmitInstrument(ps, assembly, fs, key, gs);

    expect(transmitYield).toBeGreaterThan(0);
    expect(transmitYield).toBeLessThan(fullYield);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.TRANSMITTED);
  });
});
