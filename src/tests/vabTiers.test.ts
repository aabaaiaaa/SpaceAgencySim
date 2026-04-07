// @ts-nocheck
/**
 * vabTiers.test.js — Unit tests for VAB upgrade tiers (TASK-032).
 *
 * Tests cover:
 *   - VAB_MAX_PARTS / VAB_MAX_HEIGHT / VAB_MAX_WIDTH constants per tier
 *   - Validation: part count limit check per VAB tier
 *   - Validation: height limit check per VAB tier
 *   - Validation: width limit check per VAB tier
 *   - Tier 3 removes all VAB limits
 */

import { describe, it, expect } from 'vitest';
import {
  runValidation,
  getRocketBounds,
} from '../core/rocketvalidator.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
} from '../core/rocketbuilder.ts';
import { createGameState } from '../core/gameState.ts';
import {
  FacilityId,
  VAB_MAX_PARTS,
  VAB_MAX_HEIGHT,
  VAB_MAX_WIDTH,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeState(vabTier = 1) {
  const state = createGameState();
  state.facilities[FacilityId.VAB] = { built: true, tier: vabTier };
  // Give launch pad tier 3 so mass limits don't interfere.
  state.facilities[FacilityId.LAUNCH_PAD] = { built: true, tier: 3 };
  return state;
}

/**
 * Build a small passing rocket (probe + small tank + spark engine).
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
 * Build a rocket with many parts to exceed part count limits.
 * Adds probe + engine + many fuel tanks connected in a chain.
 */
function makeHighPartCountRocket(partCount) {
  const assembly = createRocketAssembly();
  const staging = createStagingConfig();

  const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, partCount * 50);
  let lastId = probeId;
  let yPos = (partCount - 1) * 50;

  // Add fuel tanks to reach the desired part count (minus probe and engine).
  for (let i = 0; i < partCount - 2; i++) {
    const tId = addPartToAssembly(assembly, 'tank-small', 0, yPos);
    connectParts(assembly, lastId, 1, tId, 0);
    lastId = tId;
    yPos -= 50;
  }

  const engineId = addPartToAssembly(assembly, 'engine-spark', 0, yPos - 30);
  connectParts(assembly, lastId, 1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging };
}

// ---------------------------------------------------------------------------
// VAB_MAX_PARTS / VAB_MAX_HEIGHT / VAB_MAX_WIDTH constants
// ---------------------------------------------------------------------------

describe('VAB tier limit constants', () => {
  it('defines part count limits for tiers 1, 2, and 3', () => {
    expect(VAB_MAX_PARTS[1]).toBe(20);
    expect(VAB_MAX_PARTS[2]).toBe(40);
    expect(VAB_MAX_PARTS[3]).toBe(Infinity);
  });

  it('defines height limits for tiers 1, 2, and 3', () => {
    expect(VAB_MAX_HEIGHT[1]).toBe(400);
    expect(VAB_MAX_HEIGHT[2]).toBe(800);
    expect(VAB_MAX_HEIGHT[3]).toBe(Infinity);
  });

  it('defines width limits for tiers 1, 2, and 3', () => {
    expect(VAB_MAX_WIDTH[1]).toBe(120);
    expect(VAB_MAX_WIDTH[2]).toBe(200);
    expect(VAB_MAX_WIDTH[3]).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Validation: part count limit
// ---------------------------------------------------------------------------

describe('runValidation — VAB part count limit', () => {
  it('passes when part count is within Tier 1 limit', () => {
    const state = makeState(1);
    const { assembly, staging } = makeSmallRocket(); // 3 parts
    const result = runValidation(assembly, staging, state);

    expect(assembly.parts.size).toBeLessThanOrEqual(VAB_MAX_PARTS[1]);
    const partCheck = result.checks.find(c => c.id === 'vab-part-limit');
    expect(partCheck).toBeUndefined(); // No check emitted when passing.
  });

  it('fails when part count exceeds Tier 1 limit', () => {
    const state = makeState(1);
    const { assembly, staging } = makeHighPartCountRocket(VAB_MAX_PARTS[1] + 1);
    const result = runValidation(assembly, staging, state);

    expect(assembly.parts.size).toBeGreaterThan(VAB_MAX_PARTS[1]);
    const partCheck = result.checks.find(c => c.id === 'vab-part-limit');
    expect(partCheck).toBeDefined();
    expect(partCheck.pass).toBe(false);
    expect(result.canLaunch).toBe(false);
  });

  it('passes same part count at Tier 2', () => {
    const state = makeState(2);
    const { assembly, staging } = makeHighPartCountRocket(VAB_MAX_PARTS[1] + 1);
    const result = runValidation(assembly, staging, state);

    // 21 parts is within Tier 2 limit of 40.
    expect(assembly.parts.size).toBeLessThanOrEqual(VAB_MAX_PARTS[2]);
    const partCheck = result.checks.find(c => c.id === 'vab-part-limit');
    expect(partCheck).toBeUndefined();
  });

  it('fails when part count exceeds Tier 2 limit', () => {
    const state = makeState(2);
    const { assembly, staging } = makeHighPartCountRocket(VAB_MAX_PARTS[2] + 1);
    const result = runValidation(assembly, staging, state);

    const partCheck = result.checks.find(c => c.id === 'vab-part-limit');
    expect(partCheck).toBeDefined();
    expect(partCheck.pass).toBe(false);
  });

  it('passes any part count at Tier 3 (unlimited)', () => {
    const state = makeState(3);
    const { assembly, staging } = makeHighPartCountRocket(50);
    const result = runValidation(assembly, staging, state);

    const partCheck = result.checks.find(c => c.id === 'vab-part-limit');
    expect(partCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation: height limit
// ---------------------------------------------------------------------------

describe('runValidation — VAB height limit', () => {
  it('passes when rocket height is within Tier 1 limit', () => {
    const state = makeState(1);
    const { assembly, staging } = makeSmallRocket();
    const bounds = getRocketBounds(assembly);
    const height = bounds ? bounds.maxY - bounds.minY : 0;

    expect(height).toBeLessThanOrEqual(VAB_MAX_HEIGHT[1]);
    const result = runValidation(assembly, staging, state);
    const heightCheck = result.checks.find(c => c.id === 'vab-height-limit');
    expect(heightCheck).toBeUndefined();
  });

  it('fails when rocket height exceeds Tier 1 limit', () => {
    const state = makeState(1);
    // Build a tall rocket — many tanks stacked vertically, each ~40px tall + spacing.
    const { assembly, staging } = makeHighPartCountRocket(15);
    const bounds = getRocketBounds(assembly);
    const height = bounds ? bounds.maxY - bounds.minY : 0;

    const result = runValidation(assembly, staging, state);
    const heightCheck = result.checks.find(c => c.id === 'vab-height-limit');

    // If the rocket is tall enough, height check should fail.
    if (height > VAB_MAX_HEIGHT[1]) {
      expect(heightCheck).toBeDefined();
      expect(heightCheck.pass).toBe(false);
    }
  });

  it('passes tall rockets at Tier 3 (unlimited)', () => {
    const state = makeState(3);
    const { assembly, staging } = makeHighPartCountRocket(15);
    const result = runValidation(assembly, staging, state);
    const heightCheck = result.checks.find(c => c.id === 'vab-height-limit');
    expect(heightCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Validation: width limit
// ---------------------------------------------------------------------------

describe('runValidation — VAB width limit', () => {
  it('passes when rocket width is within Tier 1 limit', () => {
    const state = makeState(1);
    const { assembly, staging } = makeSmallRocket();
    const bounds = getRocketBounds(assembly);
    const width = bounds ? bounds.maxX - bounds.minX : 0;

    expect(width).toBeLessThanOrEqual(VAB_MAX_WIDTH[1]);
    const result = runValidation(assembly, staging, state);
    const widthCheck = result.checks.find(c => c.id === 'vab-width-limit');
    expect(widthCheck).toBeUndefined();
  });

  it('fails when rocket width exceeds Tier 1 limit with spread-out parts', () => {
    const state = makeState(1);
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();

    // Place parts far apart horizontally to exceed width limit.
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,   60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',      0,    0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',    0,  -55);
    // Place two parts far to the sides to force wide bounds.
    const leftId   = addPartToAssembly(assembly, 'tank-small',     -80,   0);
    const rightId  = addPartToAssembly(assembly, 'tank-small',      80,   0);

    connectParts(assembly, probeId, 1, tankId, 0);
    connectParts(assembly, tankId, 1, engineId, 0);
    connectParts(assembly, tankId, 2, leftId, 0);
    connectParts(assembly, tankId, 3, rightId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const bounds = getRocketBounds(assembly);
    const width = bounds ? bounds.maxX - bounds.minX : 0;

    const result = runValidation(assembly, staging, state);
    const widthCheck = result.checks.find(c => c.id === 'vab-width-limit');

    if (width > VAB_MAX_WIDTH[1]) {
      expect(widthCheck).toBeDefined();
      expect(widthCheck.pass).toBe(false);
    }
  });

  it('passes wide rockets at Tier 3 (unlimited)', () => {
    const state = makeState(3);
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,   60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',      0,    0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',    0,  -55);
    addPartToAssembly(assembly, 'tank-small', -80, 0);
    addPartToAssembly(assembly, 'tank-small',  80, 0);

    connectParts(assembly, probeId, 1, tankId, 0);
    connectParts(assembly, tankId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const result = runValidation(assembly, staging, state);
    const widthCheck = result.checks.find(c => c.id === 'vab-width-limit');
    expect(widthCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tier progression — all limits relax with upgrades
// ---------------------------------------------------------------------------

describe('VAB tier progression', () => {
  it('Tier 1 has the most restrictive limits', () => {
    expect(VAB_MAX_PARTS[1]).toBeLessThan(VAB_MAX_PARTS[2]);
    expect(VAB_MAX_HEIGHT[1]).toBeLessThan(VAB_MAX_HEIGHT[2]);
    expect(VAB_MAX_WIDTH[1]).toBeLessThan(VAB_MAX_WIDTH[2]);
  });

  it('Tier 2 has higher limits than Tier 1', () => {
    expect(VAB_MAX_PARTS[2]).toBeGreaterThan(VAB_MAX_PARTS[1]);
    expect(VAB_MAX_HEIGHT[2]).toBeGreaterThan(VAB_MAX_HEIGHT[1]);
    expect(VAB_MAX_WIDTH[2]).toBeGreaterThan(VAB_MAX_WIDTH[1]);
  });

  it('Tier 3 removes all limits (Infinity)', () => {
    expect(VAB_MAX_PARTS[3]).toBe(Infinity);
    expect(VAB_MAX_HEIGHT[3]).toBe(Infinity);
    expect(VAB_MAX_WIDTH[3]).toBe(Infinity);
  });
});
