/**
 * construction.test.js — Unit tests for the facility construction system.
 *
 * Tests cover:
 *   - hasFacility()     — checks whether a facility is built
 *   - getFacilityDef()  — looks up a facility definition by ID
 *   - canBuildFacility() — pre-condition checks (tutorial lock, funds, already built)
 *   - buildFacility()   — builds a facility and deducts cost
 *   - awardFacility()   — awards a facility for free (tutorial missions)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.js';
import {
  hasFacility,
  getFacilityDef,
  canBuildFacility,
  buildFacility,
  awardFacility,
} from '../core/construction.js';
import { FacilityId, FACILITY_DEFINITIONS } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState() {
  return createGameState();
}

function nonTutorialState() {
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
    const def = getFacilityDef(FacilityId.CREW_ADMIN);
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
});

// ---------------------------------------------------------------------------
// buildFacility
// ---------------------------------------------------------------------------

describe('buildFacility', () => {
  it('builds a facility and deducts cost', () => {
    const state = nonTutorialState();
    state.money = 500_000;
    const result = buildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.success).toBe(true);
    expect(hasFacility(state, FacilityId.CREW_ADMIN)).toBe(true);
    expect(state.money).toBe(400_000);
    expect(state.facilities[FacilityId.CREW_ADMIN].tier).toBe(1);
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
    expect(state.facilities[FacilityId.CREW_ADMIN].tier).toBe(1);
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
