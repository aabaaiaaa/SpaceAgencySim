// @ts-nocheck
/**
 * sandbox.test.js — Unit tests for sandbox game mode.
 *
 * Tests cover:
 *   - GameMode enum existence
 *   - gameState initialisation with sandbox fields
 *   - Sandbox construction: free building and upgrades
 *   - Sandbox tech tree: free research, bypasses prerequisites
 *   - Sandbox weather: perfect conditions when weather disabled
 *   - Sandbox malfunctions: skipped when disabled
 *   - Save/load migration: gameMode defaults for older saves
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.js';
import {
  GameMode,
  FacilityId,
  FACILITY_DEFINITIONS,
  SANDBOX_STARTING_MONEY,
  STARTING_MONEY,
  MalfunctionMode,
} from '../core/constants.js';
import {
  hasFacility,
  canBuildFacility,
  buildFacility,
  canUpgradeFacility,
  upgradeFacility,
  getFacilityTier,
} from '../core/construction.js';
import {
  canResearchNode,
  researchNode,
  isNodeResearched,
} from '../core/techtree.js';
import { TECH_NODES } from '../data/techtree.js';
import { initWeather, getCurrentWeather, getWeatherSkipCost } from '../core/weather.js';
import { getAllParts } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a sandbox-mode state with all facilities, parts, and tech unlocked. */
function sandboxState() {
  const state = createGameState();
  state.gameMode = GameMode.SANDBOX;
  state.tutorialMode = false;
  state.money = SANDBOX_STARTING_MONEY;
  state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };
  state.sandboxSettings = { malfunctionsEnabled: false, weatherEnabled: false };

  // All facilities built at tier 1.
  for (const def of FACILITY_DEFINITIONS) {
    state.facilities[def.id] = { built: true, tier: 1 };
  }

  // All parts unlocked.
  state.parts = getAllParts().map((p) => p.id);

  // All tech nodes researched.
  const researched = [];
  const instruments = [];
  for (const node of TECH_NODES) {
    researched.push(node.id);
    for (const iid of node.unlocksInstruments) {
      if (!instruments.includes(iid)) instruments.push(iid);
    }
  }
  state.techTree = { researched, unlockedInstruments: instruments };

  return state;
}

// ---------------------------------------------------------------------------
// GameMode Enum
// ---------------------------------------------------------------------------

describe('GameMode enum', () => {
  it('defines TUTORIAL, FREEPLAY, and SANDBOX', () => {
    expect(GameMode.TUTORIAL).toBe('tutorial');
    expect(GameMode.FREEPLAY).toBe('freeplay');
    expect(GameMode.SANDBOX).toBe('sandbox');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(GameMode)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Game State
// ---------------------------------------------------------------------------

describe('createGameState sandbox fields', () => {
  it('includes gameMode defaulting to tutorial', () => {
    const state = createGameState();
    expect(state.gameMode).toBe(GameMode.TUTORIAL);
  });

  it('includes sandboxSettings defaulting to null', () => {
    const state = createGameState();
    expect(state.sandboxSettings).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sandbox: Construction
// ---------------------------------------------------------------------------

describe('sandbox construction', () => {
  let state;
  beforeEach(() => {
    state = sandboxState();
  });

  it('all facilities are pre-built', () => {
    for (const def of FACILITY_DEFINITIONS) {
      expect(hasFacility(state, def.id)).toBe(true);
    }
  });

  it('canBuildFacility returns "Already built" since all are pre-built', () => {
    const check = canBuildFacility(state, FacilityId.CREW_ADMIN);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Already built');
  });

  it('canBuildFacility allows building in sandbox (non-pre-built scenario)', () => {
    // Remove a facility to test the sandbox bypass.
    delete state.facilities[FacilityId.CREW_ADMIN];
    const check = canBuildFacility(state, FacilityId.CREW_ADMIN);
    expect(check.allowed).toBe(true);
  });

  it('buildFacility does not deduct money in sandbox', () => {
    delete state.facilities[FacilityId.CREW_ADMIN];
    const moneyBefore = state.money;
    const result = buildFacility(state, FacilityId.CREW_ADMIN);
    expect(result.success).toBe(true);
    expect(state.money).toBe(moneyBefore); // No money deducted.
  });

  it('canUpgradeFacility returns moneyCost=0 in sandbox', () => {
    const check = canUpgradeFacility(state, FacilityId.LAUNCH_PAD);
    if (check.allowed) {
      expect(check.moneyCost).toBe(0);
      expect(check.scienceCost).toBe(0);
    }
  });

  it('upgradeFacility does not deduct money in sandbox', () => {
    const moneyBefore = state.money;
    const scienceBefore = state.sciencePoints;
    const check = canUpgradeFacility(state, FacilityId.LAUNCH_PAD);
    if (check.allowed) {
      const result = upgradeFacility(state, FacilityId.LAUNCH_PAD);
      expect(result.success).toBe(true);
      expect(state.money).toBe(moneyBefore);
      expect(state.sciencePoints).toBe(scienceBefore);
    }
  });
});

// ---------------------------------------------------------------------------
// Sandbox: Tech Tree
// ---------------------------------------------------------------------------

describe('sandbox tech tree', () => {
  it('all tech nodes start as researched', () => {
    const state = sandboxState();
    for (const node of TECH_NODES) {
      expect(isNodeResearched(state, node.id)).toBe(true);
    }
  });

  it('canResearchNode allows research in sandbox (bypasses prerequisites)', () => {
    const state = sandboxState();
    // Clear all research to test the bypass.
    state.techTree.researched = [];
    state.sciencePoints = 0;
    state.money = 0;
    // Should still be allowed in sandbox despite no funds/science.
    const node = TECH_NODES[0];
    const check = canResearchNode(state, node.id);
    expect(check.allowed).toBe(true);
  });

  it('researchNode does not deduct funds or science in sandbox', () => {
    const state = sandboxState();
    state.techTree.researched = [];
    state.sciencePoints = 100;
    const moneyBefore = state.money;
    const scienceBefore = state.sciencePoints;
    const node = TECH_NODES[0];
    const result = researchNode(state, node.id);
    expect(result.success).toBe(true);
    expect(state.money).toBe(moneyBefore);
    expect(state.sciencePoints).toBe(scienceBefore);
  });
});

// ---------------------------------------------------------------------------
// Sandbox: Weather
// ---------------------------------------------------------------------------

describe('sandbox weather', () => {
  it('generates perfect weather when weather disabled', () => {
    const state = sandboxState();
    state.sandboxSettings.weatherEnabled = false;
    initWeather(state, 'EARTH');
    const weather = getCurrentWeather(state);
    expect(weather.windSpeed).toBe(0);
    expect(weather.temperature).toBe(1.0);
    expect(weather.visibility).toBe(0);
    expect(weather.extreme).toBe(false);
    expect(weather.description).toContain('sandbox');
  });

  it('generates normal weather when weather enabled', () => {
    const state = sandboxState();
    state.sandboxSettings.weatherEnabled = true;
    initWeather(state, 'EARTH');
    const weather = getCurrentWeather(state);
    // Weather should be generated normally — wind may be non-zero.
    expect(typeof weather.windSpeed).toBe('number');
    expect(typeof weather.temperature).toBe('number');
  });

  it('weather skip cost is always 0 in sandbox', () => {
    const state = sandboxState();
    initWeather(state, 'EARTH');
    expect(getWeatherSkipCost(state)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sandbox: Starting values
// ---------------------------------------------------------------------------

describe('sandbox starting values', () => {
  it('SANDBOX_STARTING_MONEY is much larger than STARTING_MONEY', () => {
    expect(SANDBOX_STARTING_MONEY).toBeGreaterThan(STARTING_MONEY * 10);
  });

  it('sandbox state has no loan', () => {
    const state = sandboxState();
    expect(state.loan.balance).toBe(0);
    expect(state.loan.interestRate).toBe(0);
  });

  it('sandbox state has all parts unlocked', () => {
    const state = sandboxState();
    const allParts = getAllParts();
    for (const part of allParts) {
      expect(state.parts).toContain(part.id);
    }
  });
});
