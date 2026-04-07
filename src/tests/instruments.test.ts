// @ts-nocheck
/**
 * instruments.test.js — Unit tests for the instrument-based science system.
 *
 * Tests cover:
 *   Instrument catalog         — definitions, lookup helpers, new fields
 *   Biome validation           — validBiomes enforcement on activation
 *   Science module containers  — instrument slot initialisation, per-instrument states
 *   Instrument activation      — individual and batch (via staging)
 *   Experiment lifecycle       — idle → running → complete → data_returned / transmitted
 *   Yield formula              — baseYield × biomeMultiplier × skillBonus × diminishingReturn
 *   Diminishing returns        — persistent tracking across collections
 *   Data types                 — SAMPLE (return only) vs ANALYSIS (transmit or return)
 *   Context menu integration   — getModuleInstrumentKeys, status queries
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
  parseInstrumentKey,
} from '../core/sciencemodule.ts';
import {
  getInstrumentById,
  getAllInstruments,
  getInstrumentsByTier,
  isInstrumentValidForBiome,
  INSTRUMENTS,
} from '../data/instruments.ts';
import { getPartById } from '../data/parts.ts';
import {
  ScienceDataType,
  DIMINISHING_RETURNS,
  ANALYSIS_TRANSMIT_YIELD_MIN,
  ANALYSIS_TRANSMIT_YIELD_MAX,
} from '../core/constants.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
} from '../core/rocketbuilder.ts';
import { createPhysicsState } from '../core/physics.ts';
import { createFlightState } from '../core/gameState.ts';
import { activateCurrentStage } from '../core/staging.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeFlightState() {
  return createFlightState({ missionId: 'test', rocketId: 'test' });
}

/**
 * Build an assembly with a probe core and a science module that has
 * the given instruments loaded.
 */
function makeAssemblyWithInstruments(instrumentIds) {
  const assembly = createRocketAssembly();
  const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
  const scienceId = addPartToAssembly(assembly, 'science-module-mk1', 0, 100);
  connectParts(assembly, probeId, 1, scienceId, 0);

  // Load instruments into the science module.
  const placed = assembly.parts.get(scienceId);
  placed.instruments = [...instrumentIds];

  return { assembly, probeId, scienceId };
}

function makePhysicsState(assembly, altitude = 0) {
  const ps = createPhysicsState(assembly, makeFlightState());
  ps.posY = altitude;
  return ps;
}

function makeGameState() {
  return {
    scienceLog: [],
    sciencePoints: 0,
    crew: [],
    facilities: {},
  };
}

// ---------------------------------------------------------------------------
// Instrument catalog
// ---------------------------------------------------------------------------

describe('Instrument catalog', () => {
  it('defines at least 6 instruments', () => {
    expect(INSTRUMENTS.length).toBeGreaterThanOrEqual(6);
  });

  it('each instrument has required fields including cost, validBiomes, techTier', () => {
    for (const instr of INSTRUMENTS) {
      expect(instr.id).toBeDefined();
      expect(instr.name).toBeDefined();
      expect(instr.dataType).toMatch(/^(SAMPLE|ANALYSIS)$/);
      expect(instr.baseYield).toBeGreaterThan(0);
      expect(instr.experimentDuration).toBeGreaterThan(0);
      expect(instr.mass).toBeGreaterThanOrEqual(0);
      expect(instr.cost).toBeGreaterThan(0);
      expect(Array.isArray(instr.validBiomes)).toBe(true);
      expect(instr.validBiomes.length).toBeGreaterThan(0);
      expect(typeof instr.techTier).toBe('number');
      expect(instr.techTier).toBeGreaterThanOrEqual(0);
    }
  });

  it('contains the five task-specified instruments', () => {
    expect(getInstrumentById('thermometer-mk1')).toBeDefined();
    expect(getInstrumentById('barometer')).toBeDefined();
    expect(getInstrumentById('radiation-detector')).toBeDefined();
    expect(getInstrumentById('magnetometer')).toBeDefined();
    expect(getInstrumentById('gravity-gradiometer')).toBeDefined();
  });

  it('thermometer-mk1 matches spec: $2k, 50kg, 10s, 5pts, starter', () => {
    const t = getInstrumentById('thermometer-mk1');
    expect(t.cost).toBe(2_000);
    expect(t.mass).toBe(50);
    expect(t.experimentDuration).toBe(10);
    expect(t.baseYield).toBe(5);
    expect(t.techTier).toBe(0);
    expect(t.validBiomes).toEqual(['GROUND', 'LOW_ATMOSPHERE']);
  });

  it('barometer matches spec: $4k, 80kg, 15s, 10pts, T1', () => {
    const b = getInstrumentById('barometer');
    expect(b.cost).toBe(4_000);
    expect(b.mass).toBe(80);
    expect(b.experimentDuration).toBe(15);
    expect(b.baseYield).toBe(10);
    expect(b.techTier).toBe(1);
    expect(b.validBiomes).toEqual(['MID_ATMOSPHERE', 'UPPER_ATMOSPHERE']);
  });

  it('radiation detector matches spec: $8k, 120kg, 20s, 20pts, T2', () => {
    const r = getInstrumentById('radiation-detector');
    expect(r.cost).toBe(8_000);
    expect(r.mass).toBe(120);
    expect(r.experimentDuration).toBe(20);
    expect(r.baseYield).toBe(20);
    expect(r.techTier).toBe(2);
    expect(r.validBiomes).toEqual(['MESOSPHERE', 'NEAR_SPACE']);
  });

  it('gravity gradiometer matches spec: $15k, 200kg, 30s, 40pts, T3', () => {
    const g = getInstrumentById('gravity-gradiometer');
    expect(g.cost).toBe(15_000);
    expect(g.mass).toBe(200);
    expect(g.experimentDuration).toBe(30);
    expect(g.baseYield).toBe(40);
    expect(g.techTier).toBe(3);
    expect(g.validBiomes).toEqual(['LOW_ORBIT', 'HIGH_ORBIT']);
  });

  it('magnetometer matches spec: $12k, 150kg, 25s, 15pts, T3', () => {
    const m = getInstrumentById('magnetometer');
    expect(m.cost).toBe(12_000);
    expect(m.mass).toBe(150);
    expect(m.experimentDuration).toBe(25);
    expect(m.baseYield).toBe(15);
    expect(m.techTier).toBe(3);
    expect(m.validBiomes).toEqual(['UPPER_ATMOSPHERE', 'MESOSPHERE', 'NEAR_SPACE']);
  });

  it('getInstrumentById returns correct instrument', () => {
    const therm = getInstrumentById('thermometer-mk1');
    expect(therm).toBeDefined();
    expect(therm.name).toBe('Thermometer Mk1');
    expect(therm.dataType).toBe('ANALYSIS');
  });

  it('getInstrumentById returns undefined for unknown ID', () => {
    expect(getInstrumentById('nonexistent')).toBeUndefined();
  });

  it('getAllInstruments returns the full catalog', () => {
    expect(getAllInstruments().length).toBe(INSTRUMENTS.length);
  });

  it('contains both SAMPLE and ANALYSIS data types', () => {
    const types = new Set(INSTRUMENTS.map((i) => i.dataType));
    expect(types.has('SAMPLE')).toBe(true);
    expect(types.has('ANALYSIS')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tech tier filtering
// ---------------------------------------------------------------------------

describe('getInstrumentsByTier', () => {
  it('returns only starter instruments at tier 0', () => {
    const tier0 = getInstrumentsByTier(0);
    expect(tier0.length).toBeGreaterThanOrEqual(1);
    for (const instr of tier0) {
      expect(instr.techTier).toBe(0);
    }
    expect(tier0.some((i) => i.id === 'thermometer-mk1')).toBe(true);
  });

  it('returns tier 0 and 1 instruments at tier 1', () => {
    const tier1 = getInstrumentsByTier(1);
    for (const instr of tier1) {
      expect(instr.techTier).toBeLessThanOrEqual(1);
    }
    expect(tier1.some((i) => i.id === 'thermometer-mk1')).toBe(true);
    expect(tier1.some((i) => i.id === 'barometer')).toBe(true);
  });

  it('returns all instruments at tier 3', () => {
    const tier3 = getInstrumentsByTier(3);
    expect(tier3.length).toBe(INSTRUMENTS.length);
  });
});

// ---------------------------------------------------------------------------
// Biome validation
// ---------------------------------------------------------------------------

describe('isInstrumentValidForBiome', () => {
  it('thermometer-mk1 works in GROUND and LOW_ATMOSPHERE', () => {
    expect(isInstrumentValidForBiome('thermometer-mk1', 'GROUND')).toBe(true);
    expect(isInstrumentValidForBiome('thermometer-mk1', 'LOW_ATMOSPHERE')).toBe(true);
  });

  it('thermometer-mk1 does not work in MID_ATMOSPHERE or above', () => {
    expect(isInstrumentValidForBiome('thermometer-mk1', 'MID_ATMOSPHERE')).toBe(false);
    expect(isInstrumentValidForBiome('thermometer-mk1', 'LOW_ORBIT')).toBe(false);
  });

  it('gravity-gradiometer only works in LOW_ORBIT and HIGH_ORBIT', () => {
    expect(isInstrumentValidForBiome('gravity-gradiometer', 'LOW_ORBIT')).toBe(true);
    expect(isInstrumentValidForBiome('gravity-gradiometer', 'HIGH_ORBIT')).toBe(true);
    expect(isInstrumentValidForBiome('gravity-gradiometer', 'NEAR_SPACE')).toBe(false);
    expect(isInstrumentValidForBiome('gravity-gradiometer', 'GROUND')).toBe(false);
  });

  it('magnetometer works in UPPER_ATMOSPHERE, MESOSPHERE, NEAR_SPACE', () => {
    expect(isInstrumentValidForBiome('magnetometer', 'UPPER_ATMOSPHERE')).toBe(true);
    expect(isInstrumentValidForBiome('magnetometer', 'MESOSPHERE')).toBe(true);
    expect(isInstrumentValidForBiome('magnetometer', 'NEAR_SPACE')).toBe(true);
    expect(isInstrumentValidForBiome('magnetometer', 'LOW_ORBIT')).toBe(false);
  });

  it('returns false for unknown instrument', () => {
    expect(isInstrumentValidForBiome('nonexistent', 'GROUND')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Instrument key helpers
// ---------------------------------------------------------------------------

describe('Instrument key helpers', () => {
  it('getInstrumentKey produces correct format', () => {
    expect(getInstrumentKey('inst-5', 0)).toBe('inst-5:instr:0');
    expect(getInstrumentKey('inst-10', 2)).toBe('inst-10:instr:2');
  });

  it('parseInstrumentKey extracts components', () => {
    const parsed = parseInstrumentKey('inst-5:instr:0');
    expect(parsed).toEqual({ moduleInstanceId: 'inst-5', slotIndex: 0 });
  });

  it('parseInstrumentKey returns null for non-instrument keys', () => {
    expect(parseInstrumentKey('inst-5')).toBeNull();
    expect(parseInstrumentKey('hello')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Science module part definition
// ---------------------------------------------------------------------------

describe('Science module part definition', () => {
  it('science-module-mk1 has instrumentSlots property', () => {
    const def = getPartById('science-module-mk1');
    expect(def).toBeDefined();
    expect(def.properties.instrumentSlots).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Instrument state initialisation
// ---------------------------------------------------------------------------

describe('initInstrumentStates', () => {
  it('creates instrument state entries for loaded instruments', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'barometer']);
    const ps = makePhysicsState(assembly);

    expect(ps.instrumentStates.size).toBe(2);

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);

    const entry0 = ps.instrumentStates.get(key0);
    expect(entry0).toBeDefined();
    expect(entry0.instrumentId).toBe('thermometer-mk1');
    expect(entry0.moduleInstanceId).toBe(scienceId);
    expect(entry0.slotIndex).toBe(0);
    expect(entry0.state).toBe(ScienceModuleState.IDLE);
    expect(entry0.dataType).toBe('ANALYSIS');

    const entry1 = ps.instrumentStates.get(key1);
    expect(entry1).toBeDefined();
    expect(entry1.instrumentId).toBe('barometer');
  });

  it('also populates legacy scienceModuleStates', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly);

    expect(ps.scienceModuleStates.has(scienceId)).toBe(true);
    expect(ps.scienceModuleStates.get(scienceId).state).toBe(ScienceModuleState.IDLE);
  });

  it('creates no entries when no instruments are loaded', () => {
    const assembly = createRocketAssembly();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const scienceId = addPartToAssembly(assembly, 'science-module-mk1', 0, 100);
    connectParts(assembly, probeId, 1, scienceId, 0);
    // No instruments loaded.

    const ps = makePhysicsState(assembly);
    expect(ps.instrumentStates.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Individual instrument activation
// ---------------------------------------------------------------------------

describe('activateInstrument', () => {
  it('transitions instrument from idle to running with correct timer', () => {
    // Altitude 0 = GROUND biome, which is valid for thermometer-mk1.
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    const result = activateInstrument(ps, assembly, fs, key);

    expect(result).toBe(true);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);
    expect(ps.instrumentStates.get(key).timer).toBe(10); // thermometer-mk1 duration
    expect(ps.instrumentStates.get(key).startBiome).toBeDefined();
  });

  it('emits PART_ACTIVATED event with instrumentId', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);

    const event = fs.events.find((e) => e.type === 'PART_ACTIVATED');
    expect(event).toBeDefined();
    expect(event.instrumentId).toBe('thermometer-mk1');
    expect(event.instrumentKey).toBe(key);
  });

  it('returns false for already running instrument', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    expect(activateInstrument(ps, assembly, fs, key)).toBe(false);
  });

  it('returns false for unknown key', () => {
    const { assembly } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    expect(activateInstrument(ps, assembly, fs, 'nonexistent:instr:0')).toBe(false);
  });

  it('rejects activation outside valid biomes', () => {
    // thermometer-mk1 valid in GROUND (0–100m) and LOW_ATMOSPHERE (100–2000m).
    // Set altitude to 50,000m (MESOSPHERE) — should fail.
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 50_000);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    const result = activateInstrument(ps, assembly, fs, key);

    expect(result).toBe(false);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.IDLE);

    const event = fs.events.find((e) => e.type === 'INSTRUMENT_INVALID_BIOME');
    expect(event).toBeDefined();
    expect(event.instrumentId).toBe('thermometer-mk1');
  });

  it('allows activation in valid biomes', () => {
    // barometer valid in MID_ATMOSPHERE (2,000–10,000m).
    const { assembly, scienceId } = makeAssemblyWithInstruments(['barometer']);
    const ps = makePhysicsState(assembly, 5_000);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    const result = activateInstrument(ps, assembly, fs, key);

    expect(result).toBe(true);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);
  });
});

// ---------------------------------------------------------------------------
// Batch activation (activateAllInstruments / activateScienceModule)
// ---------------------------------------------------------------------------

describe('activateAllInstruments', () => {
  it('activates all idle instruments in valid biomes', () => {
    // Altitude 0 = GROUND. thermometer-mk1 is valid, barometer is not.
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'barometer']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const count = activateAllInstruments(ps, assembly, fs, scienceId);
    // Only thermometer-mk1 should activate (GROUND is valid for it).
    expect(count).toBe(1);

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);
    expect(ps.instrumentStates.get(key0).state).toBe(ScienceModuleState.RUNNING);
    expect(ps.instrumentStates.get(key1).state).toBe(ScienceModuleState.IDLE);
  });
});

describe('activateScienceModule (backward compat)', () => {
  it('activates instruments when module has them loaded', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const result = activateScienceModule(ps, assembly, fs, scienceId);
    expect(result).toBe(true);

    const key = getInstrumentKey(scienceId, 0);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);
  });

  it('falls back to legacy behaviour for modules without instruments', () => {
    const assembly = createRocketAssembly();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const scienceId = addPartToAssembly(assembly, 'science-module-mk1', 0, 100);
    connectParts(assembly, probeId, 1, scienceId, 0);
    // No instruments loaded.

    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    // The legacy module entry should exist from initScienceModuleStates.
    // For modules without instruments, the legacy path should handle it.
    // Manually set up a legacy entry since the new init skips empty modules.
    ps.scienceModuleStates.set(scienceId, {
      state: ScienceModuleState.IDLE,
      timer: 0,
      startBiome: null,
      completeBiome: null,
      scienceMultiplier: 1.0,
    });

    const result = activateScienceModule(ps, assembly, fs, scienceId);
    expect(result).toBe(true);
    expect(ps.scienceModuleStates.get(scienceId).state).toBe(ScienceModuleState.RUNNING);
  });
});

// ---------------------------------------------------------------------------
// Experiment tick (timer countdown)
// ---------------------------------------------------------------------------

describe('tickInstruments', () => {
  it('decrements running instrument timers', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);

    const initialTimer = ps.instrumentStates.get(key).timer;
    tickInstruments(ps, assembly, fs, 1);
    expect(ps.instrumentStates.get(key).timer).toBeCloseTo(initialTimer - 1, 1);
  });

  it('transitions to complete when timer expires and emits SCIENCE_COLLECTED', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);

    // Fast-forward past the experiment duration.
    tickInstruments(ps, assembly, fs, 15);

    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.COMPLETE);
    expect(ps.instrumentStates.get(key).completeBiome).toBeDefined();
    expect(ps.instrumentStates.get(key).scienceMultiplier).toBeGreaterThan(0);

    const sciEvent = fs.events.find((e) => e.type === 'SCIENCE_COLLECTED');
    expect(sciEvent).toBeDefined();
    expect(sciEvent.instrumentId).toBe('thermometer-mk1');
    expect(sciEvent.dataType).toBe('ANALYSIS');
  });

  it('sets flightState.scienceModuleRunning while instruments are running', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    fs.scienceModuleRunning = false;

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 0.1);

    expect(fs.scienceModuleRunning).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Safe landing (data return)
// ---------------------------------------------------------------------------

describe('onSafeLanding', () => {
  it('transitions complete instruments to data_returned with yield event', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15); // complete

    onSafeLanding(ps, assembly, fs, gs);

    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.DATA_RETURNED);

    const returnEvent = fs.events.find((e) => e.type === 'SCIENCE_DATA_RETURNED');
    expect(returnEvent).toBeDefined();
    expect(returnEvent.instrumentId).toBe('thermometer-mk1');
    expect(returnEvent.scienceYield).toBeGreaterThan(0);
  });

  it('records collection in scienceLog for diminishing returns', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15);
    onSafeLanding(ps, assembly, fs, gs);

    expect(gs.scienceLog.length).toBe(1);
    expect(gs.scienceLog[0].instrumentId).toBe('thermometer-mk1');
    expect(gs.scienceLog[0].count).toBe(1);
  });

  it('does not return data from instruments still running', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    // Do NOT tick to completion.

    onSafeLanding(ps, assembly, fs, gs);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);
  });
});

// ---------------------------------------------------------------------------
// Transmit (ANALYSIS data from orbit)
// ---------------------------------------------------------------------------

describe('transmitInstrument', () => {
  it('transmits ANALYSIS data with reduced yield', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15); // complete

    const yield_ = transmitInstrument(ps, assembly, fs, key, gs);
    expect(yield_).toBeGreaterThan(0);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.TRANSMITTED);

    const event = fs.events.find((e) => e.type === 'SCIENCE_TRANSMITTED');
    expect(event).toBeDefined();
    expect(event.transmitFraction).toBeGreaterThanOrEqual(ANALYSIS_TRANSMIT_YIELD_MIN);
    expect(event.transmitFraction).toBeLessThanOrEqual(ANALYSIS_TRANSMIT_YIELD_MAX);
  });

  it('refuses to transmit SAMPLE data', () => {
    // surface-sampler valid in GROUND.
    const { assembly, scienceId } = makeAssemblyWithInstruments(['surface-sampler']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 50); // complete

    const yield_ = transmitInstrument(ps, assembly, fs, key, gs);
    expect(yield_).toBe(0);
    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.COMPLETE);
  });

  it('refuses to transmit already-returned data', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15);
    onSafeLanding(ps, assembly, fs, gs);

    // Already returned — transmit should fail.
    expect(transmitInstrument(ps, assembly, fs, key, gs)).toBe(0);
  });

  it('records collection in scienceLog on transmit', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();
    const gs = makeGameState();

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    tickInstruments(ps, assembly, fs, 15);
    transmitInstrument(ps, assembly, fs, key, gs);

    expect(gs.scienceLog.length).toBe(1);
    expect(gs.scienceLog[0].count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Yield formula and diminishing returns
// ---------------------------------------------------------------------------

describe('calculateYield', () => {
  it('applies base yield and biome multiplier', () => {
    const gs = makeGameState();
    const therm = getInstrumentById('thermometer-mk1');

    // First collection, biome multiplier 2.0, no skill bonus.
    const yield_ = calculateYield('thermometer-mk1', 'MESOSPHERE', 2.0, 0, gs);
    expect(yield_).toBeCloseTo(therm.baseYield * 2.0 * 1.0 * 1.0, 1);
  });

  it('applies science skill bonus', () => {
    const gs = makeGameState();
    const therm = getInstrumentById('thermometer-mk1');

    // 100 skill = 1.5× bonus.
    const yield_ = calculateYield('thermometer-mk1', 'GROUND', 0.5, 100, gs);
    expect(yield_).toBeCloseTo(therm.baseYield * 0.5 * 1.5 * 1.0, 1);
  });

  it('applies diminishing returns: 1st=100%, 2nd=25%, 3rd=10%, 4th=0%', () => {
    const gs = makeGameState();
    const therm = getInstrumentById('thermometer-mk1');
    const biome = 'LOW_ATMOSPHERE';
    const mult = 1.0;

    const first = calculateYield('thermometer-mk1', biome, mult, 0, gs);
    expect(first).toBeCloseTo(therm.baseYield * 1.0, 1);

    // Simulate first collection.
    gs.scienceLog.push({ instrumentId: 'thermometer-mk1', biomeId: biome, count: 1 });
    const second = calculateYield('thermometer-mk1', biome, mult, 0, gs);
    expect(second).toBeCloseTo(therm.baseYield * 0.25, 1);

    // Simulate second collection.
    gs.scienceLog[0].count = 2;
    const third = calculateYield('thermometer-mk1', biome, mult, 0, gs);
    expect(third).toBeCloseTo(therm.baseYield * 0.10, 1);

    // Simulate third collection.
    gs.scienceLog[0].count = 3;
    const fourth = calculateYield('thermometer-mk1', biome, mult, 0, gs);
    expect(fourth).toBe(0);
  });

  it('diminishing returns are per instrument-biome pair', () => {
    const gs = makeGameState();
    gs.scienceLog.push({ instrumentId: 'thermometer-mk1', biomeId: 'GROUND', count: 3 });

    // Same instrument, different biome → still first collection.
    const yield_ = calculateYield('thermometer-mk1', 'LOW_ATMOSPHERE', 1.0, 0, gs);
    expect(yield_).toBeGreaterThan(0);

    // Different instrument, same biome → still first collection.
    const yield2 = calculateYield('barometer', 'GROUND', 0.5, 0, gs);
    expect(yield2).toBeGreaterThan(0);
  });

  it('returns 0 for unknown instrument', () => {
    expect(calculateYield('nonexistent', 'GROUND', 1.0, 0, null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Status queries
// ---------------------------------------------------------------------------

describe('Status queries', () => {
  it('getModuleInstrumentKeys returns keys for loaded instruments', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'barometer']);
    const ps = makePhysicsState(assembly);

    const keys = getModuleInstrumentKeys(ps, scienceId);
    expect(keys.length).toBe(2);
    expect(keys).toContain(getInstrumentKey(scienceId, 0));
    expect(keys).toContain(getInstrumentKey(scienceId, 1));
  });

  it('getInstrumentStatus returns correct states', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    expect(getInstrumentStatus(ps, key)).toBe(ScienceModuleState.IDLE);

    activateInstrument(ps, assembly, fs, key);
    expect(getInstrumentStatus(ps, key)).toBe(ScienceModuleState.RUNNING);

    tickInstruments(ps, assembly, fs, 15);
    expect(getInstrumentStatus(ps, key)).toBe(ScienceModuleState.COMPLETE);
  });

  it('getInstrumentTimer returns remaining time while running', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    const key = getInstrumentKey(scienceId, 0);
    expect(getInstrumentTimer(ps, key)).toBe(0);

    activateInstrument(ps, assembly, fs, key);
    expect(getInstrumentTimer(ps, key)).toBe(10);

    tickInstruments(ps, assembly, fs, 3);
    expect(getInstrumentTimer(ps, key)).toBeCloseTo(7, 0);
  });

  it('getScienceModuleStatus summarises instrument states', () => {
    // Both instruments in GROUND biome; only thermometer-mk1 is valid here.
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'barometer']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    expect(getScienceModuleStatus(ps, scienceId)).toBe(ScienceModuleState.IDLE);

    const key0 = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key0);
    expect(getScienceModuleStatus(ps, scienceId)).toBe(ScienceModuleState.RUNNING);
  });

  it('hasAnyRunningExperiment returns true when instruments are running', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    expect(hasAnyRunningExperiment(ps)).toBe(false);

    const key = getInstrumentKey(scienceId, 0);
    activateInstrument(ps, assembly, fs, key);
    expect(hasAnyRunningExperiment(ps)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Staging integration — individual instrument keys
// ---------------------------------------------------------------------------

describe('Staging integration', () => {
  it('syncStagingWithAssembly registers instrument keys for modules with instruments', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1', 'barometer']);
    const staging = createStagingConfig();

    syncStagingWithAssembly(assembly, staging);

    const key0 = getInstrumentKey(scienceId, 0);
    const key1 = getInstrumentKey(scienceId, 1);

    // Instrument keys should be in the unstaged pool.
    expect(staging.unstaged).toContain(key0);
    expect(staging.unstaged).toContain(key1);
  });

  it('activateCurrentStage handles instrument keys in valid biome', () => {
    const { assembly, scienceId } = makeAssemblyWithInstruments(['thermometer-mk1']);
    const staging = createStagingConfig();

    syncStagingWithAssembly(assembly, staging);

    const key = getInstrumentKey(scienceId, 0);
    assignPartToStage(staging, key, 0);

    // Altitude 0 = GROUND, valid for thermometer-mk1.
    const ps = makePhysicsState(assembly, 0);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.instrumentStates.get(key).state).toBe(ScienceModuleState.RUNNING);
    expect(fs.events.some((e) => e.type === 'PART_ACTIVATED' && e.instrumentId === 'thermometer-mk1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Science constants', () => {
  it('ScienceDataType enum has SAMPLE and ANALYSIS', () => {
    expect(ScienceDataType.SAMPLE).toBe('SAMPLE');
    expect(ScienceDataType.ANALYSIS).toBe('ANALYSIS');
  });

  it('DIMINISHING_RETURNS has correct values', () => {
    expect(DIMINISHING_RETURNS).toEqual([1.0, 0.25, 0.10]);
  });

  it('ANALYSIS transmit yield range is 0.4 to 0.6', () => {
    expect(ANALYSIS_TRANSMIT_YIELD_MIN).toBe(0.40);
    expect(ANALYSIS_TRANSMIT_YIELD_MAX).toBe(0.60);
  });
});
