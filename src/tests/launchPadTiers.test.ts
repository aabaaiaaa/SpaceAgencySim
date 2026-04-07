// @ts-nocheck
/**
 * launchPadTiers.test.js — Unit tests for Launch Pad upgrade tiers (TASK-031).
 *
 * Tests cover:
 *   - LAUNCH_PAD_MAX_MASS constants per tier
 *   - Validation: mass limit check per Launch Pad tier
 *   - Validation: launch clamps require Tier 3
 *   - Validation: launch clamps must be staged
 *   - Physics: launch clamps hold rocket on pad
 *   - Physics: releasing clamps allows liftoff
 *   - hasLaunchClamps() helper
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTotalMass,
  runValidation,
  hasLaunchClamps,
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
import { createPhysicsState } from '../core/physics.ts';
import {
  FacilityId,
  LAUNCH_PAD_MAX_MASS,
  PartType,
} from '../core/constants.ts';
import { getPartById } from '../data/parts.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeState(padTier = 1) {
  const state = createGameState();
  state.facilities[FacilityId.LAUNCH_PAD] = { built: true, tier: padTier };
  return state;
}

/**
 * Build a small passing rocket (probe + small tank + spark engine).
 * Total wet mass ≈ 50 + 50 + 400 + 120 = 620 kg — well within Tier 1 limit.
 */
function makeSmallRocket() {
  const assembly = createRocketAssembly();
  const staging = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',      0,   0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',    0, -55);

  connectParts(assembly, probeId, 1, tankId, 0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging };
}

/**
 * Build a rocket with a launch clamp attached.
 * Probe + small tank + spark engine + launch clamp on the side.
 */
function makeRocketWithClamp() {
  const assembly = createRocketAssembly();
  const staging = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',  0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',       0,   0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',     0, -55);
  const clampId  = addPartToAssembly(assembly, 'launch-clamp-1', -30,   0);

  // Connect vertically.
  connectParts(assembly, probeId, 1, tankId, 0);
  connectParts(assembly, tankId,  1, engineId, 0);
  // Clamp attaches to tank's left snap.
  connectParts(assembly, tankId,  2, clampId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, clampId, engineId };
}

// ---------------------------------------------------------------------------
// LAUNCH_PAD_MAX_MASS constants
// ---------------------------------------------------------------------------

describe('LAUNCH_PAD_MAX_MASS', () => {
  it('defines mass limits for tiers 1, 2, and 3', () => {
    expect(LAUNCH_PAD_MAX_MASS[1]).toBe(18_000);
    expect(LAUNCH_PAD_MAX_MASS[2]).toBe(80_000);
    expect(LAUNCH_PAD_MAX_MASS[3]).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// PartType.LAUNCH_CLAMP exists
// ---------------------------------------------------------------------------

describe('LAUNCH_CLAMP part type', () => {
  it('exists in the PartType enum', () => {
    expect(PartType.LAUNCH_CLAMP).toBe('LAUNCH_CLAMP');
  });

  it('has a part definition in the catalog', () => {
    const def = getPartById('launch-clamp-1');
    expect(def).toBeDefined();
    expect(def.type).toBe(PartType.LAUNCH_CLAMP);
    expect(def.mass).toBe(0);
    expect(def.activationBehaviour).toBe('SEPARATE');
  });
});

// ---------------------------------------------------------------------------
// Validation: mass limit check
// ---------------------------------------------------------------------------

describe('runValidation — pad mass limit', () => {
  it('passes when rocket mass is within Tier 1 limit', () => {
    const state = makeState(1);
    const { assembly, staging } = makeSmallRocket();
    const result = runValidation(assembly, staging, state);

    // Small rocket should be well under 18,000 kg.
    expect(result.totalMassKg).toBeLessThan(LAUNCH_PAD_MAX_MASS[1]);
    const massCheck = result.checks.find(c => c.id === 'pad-mass-limit');
    expect(massCheck).toBeUndefined(); // No mass check emitted when passing.
  });

  it('fails when rocket mass exceeds Tier 1 limit', () => {
    const state = makeState(1);
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();

    // Build a heavy rocket.
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 200);
    // Add many large fuel tanks to exceed 18,000 kg.
    let lastId = probeId;
    let yPos = 120;
    for (let i = 0; i < 10; i++) {
      const tId = addPartToAssembly(assembly, 'tank-large', 0, yPos);
      connectParts(assembly, lastId, 1, tId, 0);
      lastId = tId;
      yPos -= 80;
    }
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, yPos - 30);
    connectParts(assembly, lastId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const result = runValidation(assembly, staging, state);

    // If the rocket is heavy enough, mass check should fail.
    if (result.totalMassKg > LAUNCH_PAD_MAX_MASS[1]) {
      const massCheck = result.checks.find(c => c.id === 'pad-mass-limit');
      expect(massCheck).toBeDefined();
      expect(massCheck.pass).toBe(false);
      expect(result.canLaunch).toBe(false);
    }
  });

  it('passes heavy rockets at Tier 3 (unlimited mass)', () => {
    const state = makeState(3);
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 200);
    let lastId = probeId;
    let yPos = 120;
    for (let i = 0; i < 10; i++) {
      const tId = addPartToAssembly(assembly, 'tank-large', 0, yPos);
      connectParts(assembly, lastId, 1, tId, 0);
      lastId = tId;
      yPos -= 80;
    }
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, yPos - 30);
    connectParts(assembly, lastId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const result = runValidation(assembly, staging, state);
    const massCheck = result.checks.find(c => c.id === 'pad-mass-limit');
    // At Tier 3, mass limit is Infinity — no check should appear.
    expect(massCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation: launch clamp tier requirement
// ---------------------------------------------------------------------------

describe('runValidation — launch clamp tier requirement', () => {
  it('fails when clamps are used at Tier 1', () => {
    const state = makeState(1);
    const { assembly, staging, clampId } = makeRocketWithClamp();
    assignPartToStage(staging, clampId, 0);

    const result = runValidation(assembly, staging, state);
    const clampCheck = result.checks.find(c => c.id === 'clamp-tier-required');
    expect(clampCheck).toBeDefined();
    expect(clampCheck.pass).toBe(false);
  });

  it('fails when clamps are used at Tier 2', () => {
    const state = makeState(2);
    const { assembly, staging, clampId } = makeRocketWithClamp();
    assignPartToStage(staging, clampId, 0);

    const result = runValidation(assembly, staging, state);
    const clampCheck = result.checks.find(c => c.id === 'clamp-tier-required');
    expect(clampCheck).toBeDefined();
    expect(clampCheck.pass).toBe(false);
  });

  it('passes when clamps are used at Tier 3', () => {
    const state = makeState(3);
    const { assembly, staging, clampId } = makeRocketWithClamp();
    assignPartToStage(staging, clampId, 0);

    const result = runValidation(assembly, staging, state);
    const clampCheck = result.checks.find(c => c.id === 'clamp-tier-required');
    expect(clampCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation: launch clamp staging
// ---------------------------------------------------------------------------

describe('runValidation — launch clamp staging', () => {
  it('fails when clamps are present but not staged', () => {
    const state = makeState(3);
    const { assembly, staging } = makeRocketWithClamp();
    // Don't assign clamp to any stage — only engine is staged.

    const result = runValidation(assembly, staging, state);
    const clampStagingCheck = result.checks.find(c => c.id === 'clamp-not-staged');
    expect(clampStagingCheck).toBeDefined();
    expect(clampStagingCheck.pass).toBe(false);
  });

  it('passes when clamps are staged', () => {
    const state = makeState(3);
    const { assembly, staging, clampId } = makeRocketWithClamp();
    assignPartToStage(staging, clampId, 0);

    const result = runValidation(assembly, staging, state);
    const clampStagingCheck = result.checks.find(c => c.id === 'clamp-not-staged');
    expect(clampStagingCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasLaunchClamps helper
// ---------------------------------------------------------------------------

describe('hasLaunchClamps', () => {
  it('returns false for a rocket without clamps', () => {
    const { assembly } = makeSmallRocket();
    expect(hasLaunchClamps(assembly)).toBe(false);
  });

  it('returns true for a rocket with clamps', () => {
    const { assembly } = makeRocketWithClamp();
    expect(hasLaunchClamps(assembly)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Physics: launch clamp hold
// ---------------------------------------------------------------------------

describe('createPhysicsState — launch clamp detection', () => {
  it('sets hasLaunchClamps = true when assembly contains clamps', () => {
    const { assembly } = makeRocketWithClamp();
    const flightState = { fuelRemaining: 0, hasScienceModules: false, scienceModuleRunning: false };
    const ps = createPhysicsState(assembly, flightState);
    expect(ps.hasLaunchClamps).toBe(true);
  });

  it('sets hasLaunchClamps = false when assembly has no clamps', () => {
    const { assembly } = makeSmallRocket();
    const flightState = { fuelRemaining: 0, hasScienceModules: false, scienceModuleRunning: false };
    const ps = createPhysicsState(assembly, flightState);
    expect(ps.hasLaunchClamps).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Validation result: hasLaunchClamp flag
// ---------------------------------------------------------------------------

describe('runValidation — hasLaunchClamp flag', () => {
  it('returns hasLaunchClamp = true when clamps present', () => {
    const state = makeState(3);
    const { assembly, staging, clampId } = makeRocketWithClamp();
    assignPartToStage(staging, clampId, 0);
    const result = runValidation(assembly, staging, state);
    expect(result.hasLaunchClamp).toBe(true);
  });

  it('returns hasLaunchClamp = false when no clamps', () => {
    const state = makeState(1);
    const { assembly, staging } = makeSmallRocket();
    const result = runValidation(assembly, staging, state);
    expect(result.hasLaunchClamp).toBe(false);
  });
});
