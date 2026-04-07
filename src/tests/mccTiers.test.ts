// @ts-nocheck
/**
 * mccTiers.test.js — Unit tests for Mission Control Centre upgrade tiers (TASK-033).
 *
 * Tests cover:
 *   - MCC_TIER_FEATURES constant validation
 *   - CONTRACT_TIER_CAPS per tier (pool + active limits)
 *   - Contract template minMccTier annotations
 *   - Contract generation filtering by MCC tier
 *   - Tier 1 generates only basic contracts (minMccTier 1)
 *   - Tier 2 unlocks medium-difficulty contracts (minMccTier 2)
 *   - Tier 3 unlocks premium contracts and chains (minMccTier 3)
 *   - Upgrade definitions for MISSION_CONTROL in FACILITY_UPGRADE_DEFS
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  generateContracts,
  getMissionControlTier,
  getContractCaps,
} from '../core/contracts.ts';
import {
  FacilityId,
  CONTRACT_TIER_CAPS,
  MCC_TIER_FEATURES,
  FACILITY_UPGRADE_DEFS,
} from '../core/constants.ts';
import { CONTRACT_TEMPLATES } from '../data/contracts.ts';
import { ObjectiveType } from '../data/missions.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a game state with a specific MCC tier and enough completed missions
 * to reach the given progression tier.
 */
function makeState(mccTier = 1, progressionMissions = 2) {
  const state = createGameState();
  state.facilities[FacilityId.MISSION_CONTROL] = { built: true, tier: mccTier };

  // Populate completed missions for progression tier calculation.
  state.missions.completed = [];
  for (let i = 0; i < progressionMissions; i++) {
    state.missions.completed.push({
      id: `mission-${i + 1}`,
      title: `M${i + 1}`,
      objectives: [{ type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 + i * 500 }, completed: true }],
      reward: 15000,
    });
  }

  // Unlock science and satellite parts for templates that check these.
  state.parts = ['science-module-mk1', 'satellite-mk1'];

  return state;
}

// ---------------------------------------------------------------------------
// MCC_TIER_FEATURES constant
// ---------------------------------------------------------------------------

describe('MCC_TIER_FEATURES', () => {
  it('defines features for tiers 1, 2, and 3', () => {
    expect(MCC_TIER_FEATURES[1]).toBeDefined();
    expect(MCC_TIER_FEATURES[2]).toBeDefined();
    expect(MCC_TIER_FEATURES[3]).toBeDefined();
  });

  it('each tier has a label and features array', () => {
    for (const tier of [1, 2, 3]) {
      const info = MCC_TIER_FEATURES[tier];
      expect(typeof info.label).toBe('string');
      expect(info.label.length).toBeGreaterThan(0);
      expect(Array.isArray(info.features)).toBe(true);
      expect(info.features.length).toBeGreaterThan(0);
    }
  });

  it('Tier 1 is "Basic" with tutorial missions', () => {
    expect(MCC_TIER_FEATURES[1].label).toBe('Basic');
    expect(MCC_TIER_FEATURES[1].features.some(f => /tutorial/i.test(f))).toBe(true);
  });

  it('Tier 2 is "Standard" with medium-difficulty', () => {
    expect(MCC_TIER_FEATURES[2].label).toBe('Standard');
    expect(MCC_TIER_FEATURES[2].features.some(f => /medium/i.test(f))).toBe(true);
  });

  it('Tier 3 is "Advanced" with premium contracts and chains', () => {
    expect(MCC_TIER_FEATURES[3].label).toBe('Advanced');
    expect(MCC_TIER_FEATURES[3].features.some(f => /premium/i.test(f))).toBe(true);
    expect(MCC_TIER_FEATURES[3].features.some(f => /chain/i.test(f))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CONTRACT_TIER_CAPS per tier
// ---------------------------------------------------------------------------

describe('CONTRACT_TIER_CAPS', () => {
  it('Tier 1: pool=4, active=2', () => {
    expect(CONTRACT_TIER_CAPS[1].pool).toBe(4);
    expect(CONTRACT_TIER_CAPS[1].active).toBe(2);
  });

  it('Tier 2: pool=8, active=5', () => {
    expect(CONTRACT_TIER_CAPS[2].pool).toBe(8);
    expect(CONTRACT_TIER_CAPS[2].active).toBe(5);
  });

  it('Tier 3: pool=12, active=8', () => {
    expect(CONTRACT_TIER_CAPS[3].pool).toBe(12);
    expect(CONTRACT_TIER_CAPS[3].active).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// FACILITY_UPGRADE_DEFS — MISSION_CONTROL
// ---------------------------------------------------------------------------

describe('FACILITY_UPGRADE_DEFS — MISSION_CONTROL', () => {
  const def = FACILITY_UPGRADE_DEFS[FacilityId.MISSION_CONTROL];

  it('has maxTier 3', () => {
    expect(def.maxTier).toBe(3);
  });

  it('Tier 2 costs $200,000', () => {
    expect(def.tiers[2].moneyCost).toBe(200_000);
    expect(def.tiers[2].scienceCost).toBe(0);
  });

  it('Tier 3 costs $500,000', () => {
    expect(def.tiers[3].moneyCost).toBe(500_000);
    expect(def.tiers[3].scienceCost).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Contract template minMccTier annotations
// ---------------------------------------------------------------------------

describe('Contract templates — minMccTier', () => {
  it('every template has a minMccTier of 1, 2, or 3', () => {
    for (const t of CONTRACT_TEMPLATES) {
      expect(t.minMccTier, `${t.id} missing minMccTier`).toBeDefined();
      expect([1, 2, 3]).toContain(t.minMccTier);
    }
  });

  it('basic templates (altitude-push, safe-recovery, budget-challenge) require MCC tier 1', () => {
    const basicIds = ['altitude-push', 'safe-recovery', 'budget-challenge'];
    for (const id of basicIds) {
      const t = CONTRACT_TEMPLATES.find(t => t.id === id);
      expect(t, `Template ${id} not found`).toBeDefined();
      expect(t.minMccTier).toBe(1);
    }
  });

  it('medium templates (speed-push, crash-test, minimalist, etc.) require MCC tier 2', () => {
    const mediumIds = ['speed-push', 'crash-test', 'minimalist', 'no-chute-recovery', 'science-survey'];
    for (const id of mediumIds) {
      const t = CONTRACT_TEMPLATES.find(t => t.id === id);
      expect(t, `Template ${id} not found`).toBeDefined();
      expect(t.minMccTier).toBe(2);
    }
  });

  it('premium/chain templates require MCC tier 3', () => {
    const premiumIds = [
      'science-chain', 'satellite-deploy', 'multi-satellite',
      'orbital-mission', 'orbital-satellite', 'crewed-orbital', 'budget-orbital',
    ];
    for (const id of premiumIds) {
      const t = CONTRACT_TEMPLATES.find(t => t.id === id);
      expect(t, `Template ${id} not found`).toBeDefined();
      expect(t.minMccTier).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Contract generation filtering by MCC tier
// ---------------------------------------------------------------------------

describe('generateContracts() — MCC tier filtering', () => {
  it('Tier 1: only generates contracts with minMccTier <= 1', () => {
    const state = makeState(1, 4); // progression tier 2 (4 missions)
    // Generate contracts many times to cover randomness.
    const generated = [];
    for (let i = 0; i < 20; i++) {
      state.contracts.board = [];
      const result = generateContracts(state);
      generated.push(...result);
    }

    // All generated contracts should come from templates with minMccTier 1.
    // We check this indirectly: at MCC tier 1, no medium/premium templates
    // should appear (speed-push, crash-test, science-chain, etc.).
    const tier1TemplateIds = new Set(
      CONTRACT_TEMPLATES.filter(t => t.minMccTier <= 1).map(t => t.id),
    );

    // Verify we actually generated some contracts.
    expect(generated.length).toBeGreaterThan(0);

    // All generated contracts should have titles matching tier 1 templates.
    // Since we can't directly check template id on generated contracts,
    // verify no medium-difficulty-only contracts appear.
    const hasMediumOnly = generated.some(c =>
      c.title.startsWith('Speed Trial') ||
      c.title.startsWith('Impact Test') ||
      c.title.startsWith('Minimalist'),
    );
    expect(hasMediumOnly).toBe(false);
  });

  it('Tier 2: generates medium-difficulty contracts', () => {
    const state = makeState(2, 4); // MCC tier 2, progression tier 2
    const generated = [];
    for (let i = 0; i < 30; i++) {
      state.contracts.board = [];
      const result = generateContracts(state);
      generated.push(...result);
    }

    expect(generated.length).toBeGreaterThan(0);

    // At MCC tier 2, medium-difficulty contracts should appear (speed, crash, minimalist).
    // Given enough iterations, at least one should show up.
    const hasMedium = generated.some(c =>
      c.title.startsWith('Speed Trial') ||
      c.title.startsWith('Impact Test') ||
      c.title.startsWith('Minimalist') ||
      c.title.startsWith('Unpowered Recovery'),
    );
    expect(hasMedium).toBe(true);

    // But premium (tier 3) contracts should NOT appear.
    const hasPremium = generated.some(c =>
      c.title.startsWith('Atmospheric Survey I') || // science-chain
      c.title.startsWith('Orbital Insertion') ||
      c.title.startsWith('Constellation'),
    );
    expect(hasPremium).toBe(false);
  });

  it('Tier 3: generates premium and chain contracts when progression allows', () => {
    // Need high progression (15+ missions) plus MCC tier 3 for orbital contracts.
    const state = makeState(3, 16);
    // Also need orbital capability for orbital templates.
    state.missions.completed.push({
      id: 'mission-orbital',
      title: 'Orbital',
      objectives: [{ type: ObjectiveType.REACH_ORBIT, target: { orbitAltitude: 80000, orbitalVelocity: 7800 }, completed: true }],
      reward: 200000,
    });

    const generated = [];
    for (let i = 0; i < 40; i++) {
      state.contracts.board = [];
      const result = generateContracts(state);
      generated.push(...result);
    }

    expect(generated.length).toBeGreaterThan(0);

    // At tier 3 with high progression, premium contracts should be available.
    // Check for chain contracts or orbital contracts.
    const hasPremium = generated.some(c =>
      c.chainId != null ||
      c.title.startsWith('Orbital Insertion') ||
      c.title.startsWith('Orbital Satellite') ||
      c.title.startsWith('Constellation') ||
      c.title.startsWith('Budget Orbit'),
    );
    expect(hasPremium).toBe(true);
  });

  it('Tier 2 does not generate chain contracts', () => {
    const state = makeState(2, 8); // MCC tier 2, high progression
    const generated = [];
    for (let i = 0; i < 30; i++) {
      state.contracts.board = [];
      const result = generateContracts(state);
      generated.push(...result);
    }

    const hasChain = generated.some(c => c.chainId != null);
    expect(hasChain).toBe(false);
  });

  it('pool cap respects MCC tier', () => {
    for (const tier of [1, 2, 3]) {
      const state = makeState(tier, 4);
      const caps = getContractCaps(state);
      expect(caps.pool).toBe(CONTRACT_TIER_CAPS[tier].pool);
      expect(caps.active).toBe(CONTRACT_TIER_CAPS[tier].active);
    }
  });
});

// ---------------------------------------------------------------------------
// getMissionControlTier edge cases
// ---------------------------------------------------------------------------

describe('getMissionControlTier() — tier values', () => {
  it('returns 1 for fresh state (MCC at default tier)', () => {
    const state = createGameState();
    expect(getMissionControlTier(state)).toBe(1);
  });

  it('returns the correct tier for each upgrade level', () => {
    for (const tier of [1, 2, 3]) {
      const state = createGameState();
      state.facilities[FacilityId.MISSION_CONTROL] = { built: true, tier };
      expect(getMissionControlTier(state)).toBe(tier);
    }
  });

  it('returns 1 when facilities object is missing', () => {
    const state = createGameState();
    delete state.facilities;
    state.facilities = {};
    expect(getMissionControlTier(state)).toBe(1);
  });
});
