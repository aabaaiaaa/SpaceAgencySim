/**
 * construction.test.js — Unit tests for the facility construction system.
 *
 * Tests cover:
 *   - hasFacility()        — checks whether a facility is built
 *   - getFacilityDef()     — looks up a facility definition by ID
 *   - getFacilityTier()    — returns the current tier of a built facility
 *   - canBuildFacility()   — pre-condition checks (tutorial lock, funds, science, already built)
 *   - buildFacility()      — builds a facility and deducts cost (money + science for R&D Lab)
 *   - awardFacility()      — awards a facility for free (tutorial missions)
 *   - canUpgradeFacility() — pre-condition checks for upgrading a facility
 *   - upgradeFacility()    — upgrades a facility to the next tier
 *   - getDiscountedMoneyCost() — reputation discount on money costs
 */

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import {
  hasFacility,
  getFacilityDef,
  getFacilityTier,
  canBuildFacility,
  buildFacility,
  awardFacility,
  canUpgradeFacility,
  upgradeFacility,
  getDiscountedMoneyCost,
} from '../core/construction.ts';
import {
  FacilityId,
  FACILITY_DEFINITIONS,
  RD_LAB_TIER_DEFS,
  RD_LAB_MAX_TIER,
  FACILITY_UPGRADE_DEFS,
  getFacilityUpgradeDef,
  STARTING_REPUTATION,
  getReputationDiscount,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  return createGameState();
}

function nonTutorialState(): GameState {
  const state = createGameState();
  state.tutorialMode = false;
  return state;
}

// ---------------------------------------------------------------------------
// hasFacility
// ---------------------------------------------------------------------------

describe('hasFacility', () => {
  it('returns true for starter facilities on a fresh game', () => {
    const state = freshState();
    expect(hasFacility(state, FacilityId.LAUNCH_PAD)).toBe(true);
    expect(hasFacility(state, FacilityId.VAB)).toBe(true);
    expect(hasFacility(state, FacilityId.MISSION_CONTROL)).toBe(true);
  });

  it('returns false for non-starter facilities on a fresh game', () => {
    const state = freshState();
    expect(hasFacility(state, FacilityId.CREW_ADMIN)).toBe(false);
    expect(hasFacility(state, FacilityId.TRACKING_STATION)).toBe(false);
    expect(hasFacility(state, FacilityId.RD_LAB)).toBe(false);
  });

  it('returns false for unknown facility IDs', () => {
    const state = freshState();
    expect(hasFacility(state, 'nonexistent')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getFacilityDef
// ---------------------------------------------------------------------------

describe('getFacilityDef', () => {
  it('returns the definition for a valid facility ID', () => {
    const def = getFacilityDef(FacilityId.CREW_ADMIN)!;
    expect(def).toBeDefined();
    expect(def.name).toBe('Crew Administration');
    expect(def.cost).toBe(100_000);
  });

  it('returns undefined for an unknown facility ID', () => {
    expect(getFacilityDef('nonexistent')).toBeUndefined();
  });

  it('every FACILITY_DEFINITIONS entry is retrievable', () => {
    for (const def of FACILITY_DEFINITIONS) {
      expect(getFacilityDef(def.id)).toBe(def);
    }
  });

  it('all facility definitions have a scienceCost field', () => {
    for (const def of FACILITY_DEFINITIONS) {
      expect(typeof def.scienceCost).toBe('number');
    }
  });

  it('only R&D Lab and Logistics Center have a non-zero scienceCost', () => {
    for (const def of FACILITY_DEFINITIONS) {
      if (def.id === FacilityId.RD_LAB) {
        expect(def.scienceCost).toBe(20);
      } else if (def.id === FacilityId.LOGISTICS_CENTER) {
        expect(def.scienceCost).toBe(15);
      } else {
        expect(def.scienceCost).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getFacilityTier
// ---------------------------------------------------------------------------

describe('getFacilityTier', () => {
  it('returns 0 for an unbuilt facility', () => {
    const state = freshState();
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(0);
  });

  it('returns 1 for a freshly built facility', () => {
    const state = nonTutorialState();
    state.money = 1_000_000;
    state.sciencePoints = 100;
    buildFacility(state, FacilityId.RD_LAB);
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(1);
  });

  it('returns the correct tier after upgrades', () => {
    const state = nonTutorialState();
    state.money = 5_000_000;
    state.sciencePoints = 500;
    buildFacility(state, FacilityId.RD_LAB);
    upgradeFacility(state, FacilityId.RD_LAB);
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// canBuildFacility
// ---------------------------------------------------------------------------

describe('canBuildFacility', () => {
  it('blocks building in tutorial mode', () => {
    const state = freshState(); // tutorialMode = true
    const result = canBuildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('tutorial');
  });

  it('blocks already-built facilities', () => {
    const state = nonTutorialState();
    const result = canBuildFacility(state, FacilityId.LAUNCH_PAD);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Already built');
  });

  it('blocks unknown facilities', () => {
    const state = nonTutorialState();
    const result = canBuildFacility(state, 'nonexistent');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Unknown');
  });

  it('blocks when insufficient funds', () => {
    const state = nonTutorialState();
    state.money = 50_000; // Crew Admin costs $100k
    const result = canBuildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Insufficient funds');
  });

  it('allows building with sufficient funds in non-tutorial mode', () => {
    const state = nonTutorialState();
    state.money = 500_000;
    const result = canBuildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('');
  });

  it('allows building free facilities in non-tutorial mode', () => {
    const state = nonTutorialState();
    state.money = 0;
    const result = canBuildFacility(state, FacilityId.LIBRARY);
    expect(result.allowed).toBe(true);
  });

  it('blocks R&D Lab when insufficient science', () => {
    const state = nonTutorialState();
    state.money = 500_000;
    state.sciencePoints = 10; // Need 20
    const result = canBuildFacility(state, FacilityId.RD_LAB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Insufficient science');
  });

  it('allows R&D Lab with sufficient money and science', () => {
    const state = nonTutorialState();
    state.money = 500_000;
    state.sciencePoints = 20;
    const result = canBuildFacility(state, FacilityId.RD_LAB);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildFacility
// ---------------------------------------------------------------------------

describe('buildFacility', () => {
  it('builds a facility and deducts cost (with reputation discount)', () => {
    const state = nonTutorialState();
    state.money = 500_000;
    // At starting reputation (50, Good tier), 5 % discount applies.
    const result = buildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.success).toBe(true);
    expect(hasFacility(state, FacilityId.CREW_ADMIN)).toBe(true);
    expect(state.money).toBe(405_000); // 500k − 100k×0.95 = 405k
    expect(state.hubs[0].facilities[FacilityId.CREW_ADMIN].tier).toBe(1);
  });

  it('builds a free facility without deducting cash', () => {
    const state = nonTutorialState();
    const startMoney = state.money;
    const result = buildFacility(state, FacilityId.LIBRARY);
    expect(result.success).toBe(true);
    expect(hasFacility(state, FacilityId.LIBRARY)).toBe(true);
    expect(state.money).toBe(startMoney);
  });

  it('fails in tutorial mode', () => {
    const state = freshState();
    state.money = 500_000;
    const result = buildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.success).toBe(false);
    expect(hasFacility(state, FacilityId.CREW_ADMIN)).toBe(false);
  });

  it('fails with insufficient funds', () => {
    const state = nonTutorialState();
    state.money = 50_000;
    const result = buildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.success).toBe(false);
    expect(state.money).toBe(50_000); // unchanged
  });

  it('fails for already-built facility', () => {
    const state = nonTutorialState();
    const result = buildFacility(state, FacilityId.LAUNCH_PAD);
    expect(result.success).toBe(false);
  });

  it('fails for unknown facility', () => {
    const state = nonTutorialState();
    const result = buildFacility(state, 'nonexistent');
    expect(result.success).toBe(false);
  });

  it('@smoke builds R&D Lab and deducts both money and science', () => {
    const state = nonTutorialState();
    state.money = 500_000;
    state.sciencePoints = 50;
    const result = buildFacility(state, FacilityId.RD_LAB);
    expect(result.success).toBe(true);
    expect(hasFacility(state, FacilityId.RD_LAB)).toBe(true);
    // At starting reputation (50, Good tier), 5 % money discount applies.
    // Science cost is never discounted.
    expect(state.money).toBe(215_000); // 500k − 300k×0.95 = 215k
    expect(state.sciencePoints).toBe(30); // 50 - 20
  });

  it('fails R&D Lab with insufficient science (money is sufficient)', () => {
    const state = nonTutorialState();
    state.money = 500_000;
    state.sciencePoints = 10;
    const result = buildFacility(state, FacilityId.RD_LAB);
    expect(result.success).toBe(false);
    expect(state.money).toBe(500_000); // unchanged
    expect(state.sciencePoints).toBe(10); // unchanged
  });

  it('applies reputation discount to R&D Lab money cost', () => {
    const state = nonTutorialState();
    state.reputation = 100; // Max reputation
    state.money = 500_000;
    state.sciencePoints = 50;
    const discount = getReputationDiscount(100);
    const expectedMoneyCost = Math.floor(300_000 * (1 - discount));
    const result = buildFacility(state, FacilityId.RD_LAB);
    expect(result.success).toBe(true);
    expect(state.money).toBe(500_000 - expectedMoneyCost);
    // Science is NOT discounted.
    expect(state.sciencePoints).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// awardFacility
// ---------------------------------------------------------------------------

describe('awardFacility', () => {
  it('awards a facility for free even in tutorial mode', () => {
    const state = freshState(); // tutorialMode = true
    const result = awardFacility(state, FacilityId.CREW_ADMIN);
    expect(result.success).toBe(true);
    expect(hasFacility(state, FacilityId.CREW_ADMIN)).toBe(true);
    expect(state.hubs[0].facilities[FacilityId.CREW_ADMIN].tier).toBe(1);
  });

  it('does not deduct cash', () => {
    const state = freshState();
    const startMoney = state.money;
    awardFacility(state, FacilityId.CREW_ADMIN);
    expect(state.money).toBe(startMoney);
  });

  it('fails for already-built facility', () => {
    const state = freshState();
    const result = awardFacility(state, FacilityId.LAUNCH_PAD);
    expect(result.success).toBe(false);
  });

  it('fails for unknown facility', () => {
    const state = freshState();
    const result = awardFacility(state, 'nonexistent');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// canUpgradeFacility
// ---------------------------------------------------------------------------

describe('canUpgradeFacility', () => {
  it('rejects unbuilt facility', () => {
    const state = nonTutorialState();
    const result = canUpgradeFacility(state, FacilityId.RD_LAB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not built');
  });

  it('rejects non-upgradeable facility', () => {
    const state = nonTutorialState();
    // Library has no upgrade definitions.
    buildFacility(state, FacilityId.LIBRARY);
    const result = canUpgradeFacility(state, FacilityId.LIBRARY);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cannot be upgraded');
  });

  it('allows upgrading R&D Lab from tier 1 to tier 2', () => {
    const state = nonTutorialState();
    state.money = 2_000_000;
    state.sciencePoints = 200;
    buildFacility(state, FacilityId.RD_LAB);
    const result = canUpgradeFacility(state, FacilityId.RD_LAB);
    expect(result.allowed).toBe(true);
    expect(result.nextTier).toBe(2);
    expect(result.scienceCost).toBe(RD_LAB_TIER_DEFS[2].scienceCost);
  });

  it('rejects upgrade when insufficient funds', () => {
    const state = nonTutorialState();
    state.money = 400_000;
    state.sciencePoints = 200;
    buildFacility(state, FacilityId.RD_LAB);
    // After build: money = 400k - 300k = 100k, not enough for tier 2 ($600k)
    const result = canUpgradeFacility(state, FacilityId.RD_LAB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Insufficient funds');
  });

  it('rejects upgrade when insufficient science', () => {
    const state = nonTutorialState();
    state.money = 2_000_000;
    state.sciencePoints = 50; // After build: 50 - 20 = 30, need 100 for tier 2
    buildFacility(state, FacilityId.RD_LAB);
    const result = canUpgradeFacility(state, FacilityId.RD_LAB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Insufficient science');
  });

  it('rejects upgrade past max tier', () => {
    const state = nonTutorialState();
    state.money = 10_000_000;
    state.sciencePoints = 1000;
    buildFacility(state, FacilityId.RD_LAB);
    upgradeFacility(state, FacilityId.RD_LAB); // → Tier 2
    upgradeFacility(state, FacilityId.RD_LAB); // → Tier 3
    const result = canUpgradeFacility(state, FacilityId.RD_LAB);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('maximum tier');
  });
});

// ---------------------------------------------------------------------------
// upgradeFacility
// ---------------------------------------------------------------------------

describe('upgradeFacility', () => {
  it('upgrades R&D Lab from tier 1 to tier 2 and deducts costs', () => {
    const state = nonTutorialState();
    state.money = 2_000_000;
    state.sciencePoints = 500;
    buildFacility(state, FacilityId.RD_LAB);
    const moneyBefore = state.money;
    const scienceBefore = state.sciencePoints;
    const result = upgradeFacility(state, FacilityId.RD_LAB);
    expect(result.success).toBe(true);
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(2);
    const discountedCost = getDiscountedMoneyCost(RD_LAB_TIER_DEFS[2].moneyCost, state.reputation ?? 50);
    expect(state.money).toBe(moneyBefore - discountedCost);
    expect(state.sciencePoints).toBe(scienceBefore - RD_LAB_TIER_DEFS[2].scienceCost);
  });

  it('can upgrade R&D Lab through all 3 tiers', () => {
    const state = nonTutorialState();
    state.money = 10_000_000;
    state.sciencePoints = 1000;
    buildFacility(state, FacilityId.RD_LAB);
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(1);
    upgradeFacility(state, FacilityId.RD_LAB);
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(2);
    upgradeFacility(state, FacilityId.RD_LAB);
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(3);
  });

  it('fails past max tier', () => {
    const state = nonTutorialState();
    state.money = 10_000_000;
    state.sciencePoints = 1000;
    buildFacility(state, FacilityId.RD_LAB);
    upgradeFacility(state, FacilityId.RD_LAB);
    upgradeFacility(state, FacilityId.RD_LAB);
    const result = upgradeFacility(state, FacilityId.RD_LAB);
    expect(result.success).toBe(false);
    expect(getFacilityTier(state, FacilityId.RD_LAB)).toBe(3);
  });

  it('applies reputation discount to money portion only', () => {
    const state = nonTutorialState();
    state.reputation = 100;
    state.money = 5_000_000;
    state.sciencePoints = 500;
    buildFacility(state, FacilityId.RD_LAB);
    const moneyBefore = state.money;
    const scienceBefore = state.sciencePoints;
    upgradeFacility(state, FacilityId.RD_LAB);
    const discount = getReputationDiscount(100);
    const expectedMoneyCost = Math.floor(RD_LAB_TIER_DEFS[2].moneyCost * (1 - discount));
    expect(state.money).toBe(moneyBefore - expectedMoneyCost);
    // Science is NOT discounted
    expect(state.sciencePoints).toBe(scienceBefore - RD_LAB_TIER_DEFS[2].scienceCost);
  });
});

// ---------------------------------------------------------------------------
// getDiscountedMoneyCost
// ---------------------------------------------------------------------------

describe('getDiscountedMoneyCost', () => {
  it('returns 5 % discounted cost at starting reputation (Good tier)', () => {
    // Starting reputation 50 is in the Good tier (5 % discount).
    expect(getDiscountedMoneyCost(100_000, STARTING_REPUTATION)).toBe(95_000);
  });

  it('returns 15 % discounted cost at Elite reputation', () => {
    const cost = getDiscountedMoneyCost(100_000, 100);
    const discount = getReputationDiscount(100);
    expect(discount).toBe(0.15);
    expect(cost).toBe(Math.floor(100_000 * (1 - discount)));
    expect(cost).toBe(85_000);
  });

  it('returns full cost at Standard tier reputation', () => {
    // Reputation 30 is in the Standard tier (0 % discount).
    expect(getDiscountedMoneyCost(100_000, 30)).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// Integration: starter facilities
// ---------------------------------------------------------------------------

describe('starter facilities', () => {
  it('exactly the starter facilities are pre-built in a new game', () => {
    const state = freshState();
    const starterIds = FACILITY_DEFINITIONS
      .filter((f) => f.starter)
      .map((f) => f.id);

    // All starters are built.
    for (const id of starterIds) {
      expect(hasFacility(state, id)).toBe(true);
    }

    // Non-starters are not built.
    const nonStarterIds = FACILITY_DEFINITIONS
      .filter((f) => !f.starter)
      .map((f) => f.id);
    for (const id of nonStarterIds) {
      expect(hasFacility(state, id)).toBe(false);
    }
  });

  it('new state has tutorialMode = true by default', () => {
    const state = freshState();
    expect(state.tutorialMode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R&D Lab tier definitions
// ---------------------------------------------------------------------------

describe('R&D Lab tier definitions', () => {
  it('has definitions for all 3 tiers', () => {
    for (let tier = 1; tier <= RD_LAB_MAX_TIER; tier++) {
      expect(RD_LAB_TIER_DEFS[tier]).toBeDefined();
      expect(typeof RD_LAB_TIER_DEFS[tier].moneyCost).toBe('number');
      expect(typeof RD_LAB_TIER_DEFS[tier].scienceCost).toBe('number');
      expect(RD_LAB_TIER_DEFS[tier].description).toBeTruthy();
    }
  });

  it('tier costs increase with each tier', () => {
    expect(RD_LAB_TIER_DEFS[2].moneyCost).toBeGreaterThan(RD_LAB_TIER_DEFS[1].moneyCost);
    expect(RD_LAB_TIER_DEFS[3].moneyCost).toBeGreaterThan(RD_LAB_TIER_DEFS[2].moneyCost);
    expect(RD_LAB_TIER_DEFS[2].scienceCost).toBeGreaterThan(RD_LAB_TIER_DEFS[1].scienceCost);
    expect(RD_LAB_TIER_DEFS[3].scienceCost).toBeGreaterThan(RD_LAB_TIER_DEFS[2].scienceCost);
  });

  it('tier 1 = $300k + 20 sci, tier 2 = $600k + 100 sci, tier 3 = $1M + 200 sci', () => {
    expect(RD_LAB_TIER_DEFS[1].moneyCost).toBe(300_000);
    expect(RD_LAB_TIER_DEFS[1].scienceCost).toBe(20);
    expect(RD_LAB_TIER_DEFS[2].moneyCost).toBe(600_000);
    expect(RD_LAB_TIER_DEFS[2].scienceCost).toBe(100);
    expect(RD_LAB_TIER_DEFS[3].moneyCost).toBe(1_000_000);
    expect(RD_LAB_TIER_DEFS[3].scienceCost).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Generalized facility upgrade system
// ---------------------------------------------------------------------------

describe('FACILITY_UPGRADE_DEFS', () => {
  it('has upgrade definitions for all expected facilities', () => {
    const upgradeable = [
      FacilityId.LAUNCH_PAD,
      FacilityId.VAB,
      FacilityId.MISSION_CONTROL,
      FacilityId.CREW_ADMIN,
      FacilityId.TRACKING_STATION,
      FacilityId.RD_LAB,
      FacilityId.SATELLITE_OPS,
    ];
    for (const id of upgradeable) {
      expect(getFacilityUpgradeDef(id)).toBeTruthy();
    }
  });

  it('returns null for Library (no upgrades)', () => {
    expect(getFacilityUpgradeDef(FacilityId.LIBRARY)).toBeNull();
  });

  it('all upgrade tiers have moneyCost, scienceCost, and description', () => {
    for (const [_id, def] of Object.entries(FACILITY_UPGRADE_DEFS)) {
      for (let tier = 2; tier <= def.maxTier; tier++) {
        const tierDef = def.tiers[tier];
        expect(tierDef).toBeDefined();
        expect(typeof tierDef.moneyCost).toBe('number');
        expect(typeof tierDef.scienceCost).toBe('number');
        expect(tierDef.description).toBeTruthy();
      }
    }
  });

  it('only R&D Lab has non-zero scienceCost in upgrade tiers', () => {
    for (const [id, def] of Object.entries(FACILITY_UPGRADE_DEFS)) {
      for (let tier = 2; tier <= def.maxTier; tier++) {
        if (id === FacilityId.RD_LAB) {
          expect(def.tiers[tier].scienceCost).toBeGreaterThan(0);
        } else {
          expect(def.tiers[tier].scienceCost).toBe(0);
        }
      }
    }
  });

  it('upgrade costs increase with tier', () => {
    for (const [, def] of Object.entries(FACILITY_UPGRADE_DEFS)) {
      if (def.maxTier >= 3) {
        expect(def.tiers[3].moneyCost).toBeGreaterThan(def.tiers[2].moneyCost);
      }
    }
  });
});

describe('generalized facility upgrades', () => {
  it('can upgrade Launch Pad from tier 1 to tier 2 (money only)', () => {
    const state = nonTutorialState();
    state.money = 1_000_000;
    // Launch Pad is a starter, already built at tier 1.
    expect(getFacilityTier(state, FacilityId.LAUNCH_PAD)).toBe(1);
    const check = canUpgradeFacility(state, FacilityId.LAUNCH_PAD);
    expect(check.allowed).toBe(true);
    expect(check.nextTier).toBe(2);
    expect(check.scienceCost).toBe(0);
    const result = upgradeFacility(state, FacilityId.LAUNCH_PAD);
    expect(result.success).toBe(true);
    expect(getFacilityTier(state, FacilityId.LAUNCH_PAD)).toBe(2);
  });

  it('can upgrade VAB through all 3 tiers', () => {
    const state = nonTutorialState();
    state.money = 5_000_000;
    expect(getFacilityTier(state, FacilityId.VAB)).toBe(1);
    upgradeFacility(state, FacilityId.VAB);
    expect(getFacilityTier(state, FacilityId.VAB)).toBe(2);
    upgradeFacility(state, FacilityId.VAB);
    expect(getFacilityTier(state, FacilityId.VAB)).toBe(3);
    // Cannot upgrade past max tier.
    const result = upgradeFacility(state, FacilityId.VAB);
    expect(result.success).toBe(false);
    expect(getFacilityTier(state, FacilityId.VAB)).toBe(3);
  });

  it('deducts correct money for Mission Control upgrade', () => {
    const state = nonTutorialState();
    state.money = 1_000_000;
    const moneyBefore = state.money;
    const upgDef = getFacilityUpgradeDef(FacilityId.MISSION_CONTROL)!;
    const expectedCost = getDiscountedMoneyCost(upgDef.tiers[2].moneyCost, state.reputation ?? 50);
    upgradeFacility(state, FacilityId.MISSION_CONTROL);
    expect(state.money).toBe(moneyBefore - expectedCost);
  });

  it('blocks upgrade when insufficient funds for Crew Admin', () => {
    const state = nonTutorialState();
    state.money = 200_000;
    buildFacility(state, FacilityId.CREW_ADMIN); // costs $100k → $100k left
    const check = canUpgradeFacility(state, FacilityId.CREW_ADMIN);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Insufficient funds');
  });

  it('applies reputation discount to upgrade money costs', () => {
    const state = nonTutorialState();
    state.reputation = 100;
    state.money = 5_000_000;
    const moneyBefore = state.money;
    const upgDef = getFacilityUpgradeDef(FacilityId.LAUNCH_PAD)!;
    const discount = getReputationDiscount(100);
    const expectedCost = Math.floor(upgDef.tiers[2].moneyCost * (1 - discount));
    upgradeFacility(state, FacilityId.LAUNCH_PAD);
    expect(state.money).toBe(moneyBefore - expectedCost);
  });

  it('non-R&D Lab upgrades do not require science', () => {
    const state = nonTutorialState();
    state.money = 5_000_000;
    state.sciencePoints = 0;
    const result = upgradeFacility(state, FacilityId.LAUNCH_PAD);
    expect(result.success).toBe(true);
  });
});
