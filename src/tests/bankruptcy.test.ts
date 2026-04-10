/**
 * bankruptcy.test.js — Unit tests for operating costs and bankruptcy detection.
 *
 * Tests cover:
 *   - getMinimumRocketCost()  — computes cheapest rocket from unlocked parts
 *   - isBankrupt()            — detects when player cannot afford any rocket
 *   - advancePeriod() bankruptcy flag — returned in period summary
 *   - Individual crew salary usage — period system uses per-astronaut salary
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState, CrewMember } from '../core/gameState.ts';
import { advancePeriod } from '../core/period.ts';
import { getMinimumRocketCost, isBankrupt } from '../core/finance.ts';
import {
  CREW_SALARY_PER_PERIOD,
  FACILITY_UPKEEP_PER_PERIOD,
  MAX_LOAN_BALANCE,
  AstronautStatus,
  STARTING_MONEY,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  return createGameState();
}

interface CrewOverrides {
  id?: string;
  name?: string;
  status?: AstronautStatus;
  salary?: number;
}

function addCrew(state: GameState, overrides: CrewOverrides = {}): void {
  state.crew.push({
    id: overrides.id ?? `crew-${state.crew.length + 1}`,
    name: overrides.name ?? `Astronaut ${state.crew.length + 1}`,
    status: overrides.status ?? AstronautStatus.ACTIVE,
    skills: { piloting: 0, engineering: 0, science: 0 },
    salary: overrides.salary ?? CREW_SALARY_PER_PERIOD,
    hireDate: new Date().toISOString(),
    missionsFlown: 0,
    flightsFlown: 0,
    deathDate: null,
    deathCause: null,
    assignedRocketId: null,
    injuryEnds: null,
    trainingSkill: null,
    trainingEnds: null,
  });
}

// ---------------------------------------------------------------------------
// getMinimumRocketCost
// ---------------------------------------------------------------------------

describe('getMinimumRocketCost()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('returns Infinity when no parts are unlocked', () => {
    state.parts = [];
    expect(getMinimumRocketCost(state)).toBe(Infinity);
  });

  it('returns Infinity when no command module is unlocked', () => {
    state.parts = ['tank-small', 'engine-spark'];
    expect(getMinimumRocketCost(state)).toBe(Infinity);
  });

  it('returns Infinity when no thrust source is unlocked', () => {
    state.parts = ['probe-core-mk1'];
    expect(getMinimumRocketCost(state)).toBe(Infinity);
  });

  it('computes correct cost with probe + SRB (cheapest combo)', () => {
    // probe-core-mk1 ($5,000) + srb-small ($3,000) = $8,000
    state.parts = ['probe-core-mk1', 'srb-small'];
    expect(getMinimumRocketCost(state)).toBe(8_000);
  });

  it('computes correct cost with probe + engine + tank', () => {
    // probe-core-mk1 ($5,000) + engine-spark ($6,000) + tank-small ($800) = $11,800
    state.parts = ['probe-core-mk1', 'engine-spark', 'tank-small'];
    expect(getMinimumRocketCost(state)).toBe(11_800);
  });

  it('chooses SRB over engine+tank when SRB is cheaper', () => {
    // SRB path: probe ($5k) + SRB ($3k) = $8k
    // Liquid path: probe ($5k) + engine ($6k) + tank ($800) = $11.8k
    state.parts = ['probe-core-mk1', 'srb-small', 'engine-spark', 'tank-small'];
    expect(getMinimumRocketCost(state)).toBe(8_000);
  });

  it('prefers cheaper command module', () => {
    // probe ($5k) < cmd-mk1 ($8k)
    state.parts = ['probe-core-mk1', 'cmd-mk1', 'srb-small'];
    expect(getMinimumRocketCost(state)).toBe(8_000); // probe + SRB
  });

  it('uses command module when probe is not available', () => {
    // cmd-mk1 ($8k) + srb-small ($3k) = $11k
    state.parts = ['cmd-mk1', 'srb-small'];
    expect(getMinimumRocketCost(state)).toBe(11_000);
  });
});

// ---------------------------------------------------------------------------
// isBankrupt
// ---------------------------------------------------------------------------

describe('isBankrupt()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('returns false when no parts are unlocked (early game)', () => {
    state.parts = [];
    expect(isBankrupt(state)).toBe(false);
  });

  it('returns false when player has sufficient cash', () => {
    state.parts = ['probe-core-mk1', 'srb-small'];
    state.money = 100_000;
    expect(isBankrupt(state)).toBe(false);
  });

  it('returns false when player can borrow enough', () => {
    state.parts = ['probe-core-mk1', 'srb-small'];
    state.money = 0;
    state.loan.balance = 0; // Can borrow up to $10M
    expect(isBankrupt(state)).toBe(false);
  });

  it('returns true when cash + borrowable < minimum rocket cost', () => {
    state.parts = ['probe-core-mk1', 'srb-small'];
    state.money = -100_000;
    state.loan.balance = MAX_LOAN_BALANCE; // Already maxed out
    expect(isBankrupt(state)).toBe(true);
  });

  it('returns true when money is deeply negative and loans maxed', () => {
    state.parts = ['probe-core-mk1', 'engine-spark', 'tank-small'];
    state.money = -500_000;
    state.loan.balance = MAX_LOAN_BALANCE;
    expect(isBankrupt(state)).toBe(true);
  });

  it('returns false when barely enough purchasing power', () => {
    state.parts = ['probe-core-mk1', 'srb-small']; // min cost = $8,000
    state.money = 8_000;
    state.loan.balance = MAX_LOAN_BALANCE; // Can't borrow more
    expect(isBankrupt(state)).toBe(false);
  });

  it('returns true when just below minimum', () => {
    state.parts = ['probe-core-mk1', 'srb-small']; // min cost = $8,000
    state.money = 7_999;
    state.loan.balance = MAX_LOAN_BALANCE;
    expect(isBankrupt(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advancePeriod — individual crew salaries
// ---------------------------------------------------------------------------

describe('advancePeriod() — individual crew salaries', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('uses per-astronaut salary field when set', () => {
    addCrew(state, { salary: 10_000 });
    addCrew(state, { salary: 3_000 });
    const result = advancePeriod(state);
    expect(result.crewSalaryCost).toBe(13_000);
  });

  it('falls back to CREW_SALARY_PER_PERIOD when salary is undefined', () => {
    state.crew.push({
      id: 'legacy-crew',
      name: 'Legacy Astronaut',
      status: AstronautStatus.ACTIVE,
      skills: { piloting: 0, engineering: 0, science: 0 },
      // No salary field — simulates legacy save data
      hireDate: new Date().toISOString(),
      injuryEnds: null,
      missionsFlown: 0,
      flightsFlown: 0,
      deathDate: null,
      deathCause: null,
      assignedRocketId: null,
      trainingSkill: null,
      trainingEnds: null,
    } as CrewMember);
    const result = advancePeriod(state);
    expect(result.crewSalaryCost).toBe(CREW_SALARY_PER_PERIOD);
  });

  it('mixes individual and default salaries correctly', () => {
    addCrew(state, { salary: 8_000 });
    state.crew.push({
      id: 'legacy-crew',
      name: 'Legacy',
      status: AstronautStatus.ACTIVE,
      skills: { piloting: 0, engineering: 0, science: 0 },
      hireDate: new Date().toISOString(),
      injuryEnds: null,
      missionsFlown: 0,
      flightsFlown: 0,
      deathDate: null,
      deathCause: null,
      assignedRocketId: null,
      trainingSkill: null,
      trainingEnds: null,
    } as CrewMember);
    const result = advancePeriod(state);
    expect(result.crewSalaryCost).toBe(8_000 + CREW_SALARY_PER_PERIOD);
  });
});

// ---------------------------------------------------------------------------
// advancePeriod — bankruptcy flag
// ---------------------------------------------------------------------------

describe('advancePeriod() — bankruptcy flag', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('returns bankrupt: false when player is solvent', () => {
    state.parts = ['probe-core-mk1', 'srb-small'];
    state.money = 100_000;
    const result = advancePeriod(state);
    expect(result.bankrupt).toBe(false);
  });

  it('returns bankrupt: true when player cannot afford cheapest rocket', () => {
    state.parts = ['probe-core-mk1', 'srb-small'];
    state.money = -100_000;
    state.loan.balance = MAX_LOAN_BALANCE;
    const result = advancePeriod(state);
    expect(result.bankrupt).toBe(true);
  });

  it('returns bankrupt: false when no parts unlocked (early game)', () => {
    state.parts = [];
    state.money = 0;
    state.loan.balance = MAX_LOAN_BALANCE;
    const result = advancePeriod(state);
    expect(result.bankrupt).toBe(false);
  });
});
