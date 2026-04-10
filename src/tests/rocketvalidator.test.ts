/**
 * rocketvalidator.test.ts — Unit tests for the Rocket Engineer validation module (TASK-019).
 *
 * Tests cover:
 *   - getTotalMass()        — empty assembly, dry-only parts, parts with fuel
 *   - getStage1Thrust()     — empty stages, IGNITE parts, non-IGNITE parts
 *   - calculateTWR()        — zero mass guard, correct calculation
 *   - runValidation()
 *       Check 1: command/computer module present
 *       Check 2: connectivity (no floating parts)
 *       Check 3: Stage 1 has engine or SRB
 *       Check 4: TWR > 1.0
 *       Warning: crewed mission + only computer module
 *       canLaunch: blocked when any blocking check fails
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTotalMass,
  getStage1Thrust,
  calculateTWR,
  runValidation,
} from '../core/rocketvalidator.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  assignPartToStage,
  syncStagingWithAssembly,
} from '../core/rocketbuilder.ts';
import { createGameState } from '../core/gameState.ts';

import type { RocketAssembly, StagingConfig, PlacedPart } from '../core/rocketbuilder.ts';
import type { GameState, MissionInstance } from '../core/gameState.ts';
import type { ValidationCheck, ValidationResult } from '../core/rocketvalidator.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal GameState with no accepted missions. */
function makeState(): GameState {
  return createGameState();
}

/**
 * Build a minimal passing rocket:
 *   - Probe Core Mk1 (computer module) at world (0, 0)
 *   - Small Tank below it
 *   - Spark Engine below tank, assigned to Stage 1
 *
 * The parts are connected top-to-bottom, giving a fully connected assembly.
 */
function makePassingRocket(): { assembly: RocketAssembly; staging: StagingConfig } {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  // Probe Core Mk1: mass=50, no fuel
  const probeId   = addPartToAssembly(assembly, 'probe-core-mk1',  0,  60);
  // Small Tank:    mass=50, fuelMass=400
  const tankId    = addPartToAssembly(assembly, 'tank-small',      0,   0);
  // Spark Engine:  mass=120, thrust=60 kN
  const engineId  = addPartToAssembly(assembly, 'engine-spark',    0, -55);

  // Connect probe → tank (probe bottom snap touches tank top snap).
  connectParts(assembly, probeId, 1, tankId, 0);
  // Connect tank → engine.
  connectParts(assembly, tankId, 1, engineId, 0);

  // Sync staging: engine is activatable → lands in unstaged.
  syncStagingWithAssembly(assembly, staging);

  // Assign engine to Stage 1.
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging };
}

// ---------------------------------------------------------------------------
// getTotalMass()
// ---------------------------------------------------------------------------

describe('getTotalMass()', () => {
  it('returns 0 for an empty assembly', () => {
    const assembly = createRocketAssembly();
    expect(getTotalMass(assembly)).toBe(0);
  });

  it('returns dry mass for a part with no fuelMass', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0); // mass: 50
    expect(getTotalMass(assembly)).toBe(50);
  });

  it('adds fuelMass from a fuel tank', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'tank-small', 0, 0); // mass: 50, fuelMass: 400
    expect(getTotalMass(assembly)).toBe(450);
  });

  it('sums multiple parts including SRB fuel', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'tank-small', 0, 0);      // 50 + 400 = 450
    addPartToAssembly(assembly, 'srb-small',  50, 0);     // 180 + 900 = 1080
    addPartToAssembly(assembly, 'engine-spark', -50, 0);  // 120 + 0   = 120
    expect(getTotalMass(assembly)).toBe(450 + 1080 + 120);
  });

  it('ignores unknown part IDs gracefully', () => {
    const assembly = createRocketAssembly();
    // Manually insert a part with a non-existent catalog ID.
    assembly.parts.set('x', { instanceId: 'x', partId: 'does-not-exist', x: 0, y: 0 });
    expect(getTotalMass(assembly)).toBe(0); // unknown part contributes 0
  });
});

// ---------------------------------------------------------------------------
// getStage1Thrust()
// ---------------------------------------------------------------------------

describe('getStage1Thrust()', () => {
  it('returns 0 when Stage 1 is empty', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    expect(getStage1Thrust(assembly, staging)).toBe(0);
  });

  it('sums thrust of IGNITE parts in Stage 1', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, 0); // thrust: 60 kN
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    expect(getStage1Thrust(assembly, staging)).toBe(60);
  });

  it('does not count non-IGNITE parts (e.g. decouplers)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const decId = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0, 0); // SEPARATE
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, decId, 0);

    expect(getStage1Thrust(assembly, staging)).toBe(0);
  });

  it('adds thrust from multiple engines in Stage 1', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const e1 = addPartToAssembly(assembly, 'engine-spark',   0, 0); // 60 kN
    const e2 = addPartToAssembly(assembly, 'engine-reliant', 50, 0); // 240 kN
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, e1, 0);
    assignPartToStage(staging, e2, 0);

    expect(getStage1Thrust(assembly, staging)).toBe(300);
  });

  it('includes SRBs (IGNITE behaviour)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const srbId = addPartToAssembly(assembly, 'srb-small', 0, 0); // thrust: 180 kN
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, srbId, 0);

    expect(getStage1Thrust(assembly, staging)).toBe(180);
  });
});

// ---------------------------------------------------------------------------
// calculateTWR()
// ---------------------------------------------------------------------------

describe('calculateTWR()', () => {
  it('returns 0 for an empty assembly', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    expect(calculateTWR(assembly, staging)).toBe(0);
  });

  it('returns 0 when there is no Stage 1 engine', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    addPartToAssembly(assembly, 'tank-small', 0, 0);
    // No engine assigned to stage 1.
    expect(calculateTWR(assembly, staging)).toBe(0);
  });

  it('computes TWR correctly: (thrustKN * 1000) / (massKg * 9.81)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Spark engine: thrust=60 kN, mass=120 kg (no fuel mass).
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const expected = (60 * 1000) / (120 * 9.81);
    expect(calculateTWR(assembly, staging)).toBeCloseTo(expected, 4);
  });

  it('TWR > 1 for a well-designed rocket', () => {
    const { assembly, staging } = makePassingRocket();
    // probe(50) + tank(50+400) + engine(120) = 620 kg; thrust=60 kN
    // TWR = 60000 / (620 * 9.81) ≈ 9.87 — well above 1.
    expect(calculateTWR(assembly, staging)).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// runValidation() — CHECK 1: command module
// ---------------------------------------------------------------------------

describe('runValidation() — Check 1: command module', () => {
  it('fails when assembly is empty', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = makeState();
    const result   = runValidation(assembly, staging, state);

    const check = result.checks.find((c) => c.id === 'command-module');
    expect(check).toBeDefined();
    expect(check!.pass).toBe(false);
    expect(result.canLaunch).toBe(false);
  });

  it('passes with a crewed command module', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = makeState();
    addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    const result = runValidation(assembly, staging, state);
    const check  = result.checks.find((c) => c.id === 'command-module');
    expect(check!.pass).toBe(true);
    expect(check!.message).toMatch(/crewed command module/i);
  });

  it('passes with a computer (probe) module', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = makeState();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const result = runValidation(assembly, staging, state);
    const check  = result.checks.find((c) => c.id === 'command-module');
    expect(check!.pass).toBe(true);
    expect(check!.message).toMatch(/computer/i);
  });
});

// ---------------------------------------------------------------------------
// runValidation() — CHECK 2: connectivity
// ---------------------------------------------------------------------------

describe('runValidation() — Check 2: part connectivity', () => {
  it('passes for a single part', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = makeState();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const result = runValidation(assembly, staging, state);
    const check  = result.checks.find((c) => c.id === 'connectivity');
    expect(check!.pass).toBe(true);
  });

  it('passes when all parts are connected', () => {
    const { assembly, staging } = makePassingRocket();
    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'connectivity');
    expect(check!.pass).toBe(true);
  });

  it('fails when a part is floating (not connected to root)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = makeState();
    // Add two parts with no connection between them.
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    addPartToAssembly(assembly, 'tank-small', 200, 200); // far away, no connection
    const result = runValidation(assembly, staging, state);
    const check  = result.checks.find((c) => c.id === 'connectivity');
    expect(check!.pass).toBe(false);
    expect(check!.message).toMatch(/floating/i);
  });

  it('is a blocking check (canLaunch false when it fails)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    addPartToAssembly(assembly, 'tank-small', 200, 200);
    const result = runValidation(assembly, staging, makeState());
    expect(result.canLaunch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runValidation() — CHECK 3: Stage 1 engine
// ---------------------------------------------------------------------------

describe('runValidation() — Check 3: Stage 1 engine', () => {
  it('fails when no engine is assigned to Stage 1', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'stage1-engine');
    expect(check!.pass).toBe(false);
    expect(result.canLaunch).toBe(false);
  });

  it('passes when an engine is in Stage 1', () => {
    const { assembly, staging } = makePassingRocket();
    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'stage1-engine');
    expect(check!.pass).toBe(true);
  });

  it('passes when an SRB is in Stage 1', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const srbId = addPartToAssembly(assembly, 'srb-small', 0, -40);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, srbId, 0);
    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'stage1-engine');
    expect(check!.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runValidation() — CHECK 4: TWR
// ---------------------------------------------------------------------------

describe('runValidation() — Check 4: Stage 1 TWR', () => {
  it('fails when TWR is 0', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'twr');
    expect(check!.pass).toBe(false);
  });

  it('passes for the passing rocket fixture', () => {
    const { assembly, staging } = makePassingRocket();
    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'twr');
    expect(check!.pass).toBe(true);
    expect(check!.message).toMatch(/TWR:/);
  });

  it('reports TWR value numerically in message', () => {
    const { assembly, staging } = makePassingRocket();
    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'twr');
    // Message should contain a decimal number.
    expect(check!.message).toMatch(/\d+\.\d+/);
  });

  it('fails for a rocket too heavy to lift off', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // 4 large tanks = 4 × (200 + 8000) = 32800 kg, Spark = 120 kg → total ~32920 kg
    // Spark thrust = 60 kN → TWR = 60000 / (32920 * 9.81) ≈ 0.186 (< 1.0)
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 200);
    addPartToAssembly(assembly, 'tank-large',     0, 100);
    addPartToAssembly(assembly, 'tank-large',     0,  -50);
    addPartToAssembly(assembly, 'tank-large',     0, -200);
    addPartToAssembly(assembly, 'tank-large',     0, -350);
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, -430);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const result = runValidation(assembly, staging, makeState());
    const check  = result.checks.find((c) => c.id === 'twr');
    expect(check!.pass).toBe(false);
    expect(result.canLaunch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runValidation() — WARNING 5: crewed mission + only computer module
// ---------------------------------------------------------------------------

describe('runValidation() — Warning 5: crew warning', () => {
  it('does not emit the warning when no missions are accepted', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const result = runValidation(assembly, staging, makeState());
    const warn   = result.checks.find((c) => c.id === 'crew-module-warn');
    expect(warn).toBeUndefined();
  });

  it('emits the warning when an accepted crewed mission + only computer module', () => {
    const { assembly, staging } = makePassingRocket(); // has probe-core, no cmd module
    const state = makeState();
    // Inject an accepted mission with minCrewCount > 0.
    state.missions.accepted.push({
      id: 'test-mission',
      title: 'Test',
      description: '',
      reward: 10000,
      deadline: '2030-01-01',
      state: 'ACCEPTED',
      requirements: { minDeltaV: 0, minCrewCount: 1, requiredParts: [] },
      acceptedDate: new Date().toISOString(),
      completedDate: null,
    });

    const result = runValidation(assembly, staging, state);
    const warn   = result.checks.find((c) => c.id === 'crew-module-warn');
    expect(warn).toBeDefined();
    expect(warn!.pass).toBe(false);
    expect(warn!.warn).toBe(true); // non-blocking
  });

  it('does NOT block launch when only a warning fails', () => {
    const { assembly, staging } = makePassingRocket();
    const state = makeState();
    state.missions.accepted.push({
      id: 'test-mission',
      title: 'Test',
      description: '',
      reward: 10000,
      deadline: '2030-01-01',
      state: 'ACCEPTED',
      requirements: { minDeltaV: 0, minCrewCount: 1, requiredParts: [] },
      acceptedDate: new Date().toISOString(),
      completedDate: null,
    });

    const result = runValidation(assembly, staging, state);
    // The passing rocket passes checks 1-4; warning 5 fails but is non-blocking.
    expect(result.canLaunch).toBe(true);
  });

  it('does NOT emit the warning when a crewed command module is present', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    addPartToAssembly(assembly, 'cmd-mk1', 0, 0); // crewed module
    const state = makeState();
    state.missions.accepted.push({
      id: 'test-mission',
      title: 'Test',
      description: '',
      reward: 10000,
      deadline: '2030-01-01',
      state: 'ACCEPTED',
      requirements: { minDeltaV: 0, minCrewCount: 1, requiredParts: [] },
      acceptedDate: new Date().toISOString(),
      completedDate: null,
    });
    const result = runValidation(assembly, staging, state);
    const warn   = result.checks.find((c) => c.id === 'crew-module-warn');
    expect(warn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runValidation() — canLaunch composite
// ---------------------------------------------------------------------------

describe('runValidation() — canLaunch', () => {
  it('is false for an empty assembly', () => {
    const result = runValidation(createRocketAssembly(), createStagingConfig(), makeState());
    expect(result.canLaunch).toBe(false);
  });

  it('@smoke is true for the fully-valid passing rocket', () => {
    const { assembly, staging } = makePassingRocket();
    const result = runValidation(assembly, staging, makeState());
    expect(result.canLaunch).toBe(true);
  });

  it('exposes totalMassKg, stage1Thrust, twr in the result', () => {
    const { assembly, staging } = makePassingRocket();
    const result = runValidation(assembly, staging, makeState());
    expect(result.totalMassKg).toBeGreaterThan(0);
    expect(result.stage1Thrust).toBeGreaterThan(0);
    expect(result.twr).toBeGreaterThan(0);
  });

  it('includes exactly 4 checks for a no-mission passing rocket (no warning emitted)', () => {
    const { assembly, staging } = makePassingRocket();
    const result = runValidation(assembly, staging, makeState());
    expect(result.checks).toHaveLength(4);
  });

  it('includes 5 checks when a crew warning fires', () => {
    const { assembly, staging } = makePassingRocket();
    const state = makeState();
    state.missions.accepted.push({
      id: 'test-m',
      title: 'T',
      description: '',
      reward: 0,
      deadline: '2030-01-01',
      state: 'ACCEPTED',
      requirements: { minDeltaV: 0, minCrewCount: 1, requiredParts: [] },
      acceptedDate: new Date().toISOString(),
      completedDate: null,
    });
    const result = runValidation(assembly, staging, state);
    expect(result.checks).toHaveLength(5);
  });
});
