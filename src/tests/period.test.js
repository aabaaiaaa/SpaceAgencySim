/**
 * period.test.js — Unit tests for the period (flight) system.
 *
 * Tests cover:
 *   - advancePeriod()    — increments the period counter
 *   - Crew salaries      — charges $5k per active astronaut per period
 *   - Facility upkeep    — charges $10k base per period
 *   - Operating costs    — deducted from cash (can go negative)
 *   - Mission expiry     — expires accepted missions past their deadline period
 *   - Integration with processFlightReturn()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.js';
import { advancePeriod } from '../core/period.js';
import {
  CREW_SALARY_PER_PERIOD,
  FACILITY_UPKEEP_PER_PERIOD,
  FACILITY_DEFINITIONS,
  AstronautStatus,
  STARTING_MONEY,
} from '../core/constants.js';

/** Number of starter facilities pre-built in a fresh game. */
const STARTER_COUNT = FACILITY_DEFINITIONS.filter((f) => f.starter).length;

/** Total base facility upkeep for a fresh game (per-facility cost × starters). */
const BASE_UPKEEP = FACILITY_UPKEEP_PER_PERIOD * STARTER_COUNT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState() {
  return createGameState();
}

/** Add an active crew member to the state. */
function addCrew(state, overrides = {}) {
  state.crew.push({
    id: overrides.id ?? `crew-${state.crew.length + 1}`,
    name: overrides.name ?? `Astronaut ${state.crew.length + 1}`,
    status: overrides.status ?? AstronautStatus.ACTIVE,
    skills: { piloting: 0, engineering: 0, science: 0 },
    salary: overrides.salary ?? CREW_SALARY_PER_PERIOD,
    hiredDate: new Date().toISOString(),
    injuryEnds: null,
  });
}

/** Add an accepted mission with an optional deadline period. */
function addAcceptedMission(state, { id, deadlinePeriod } = {}) {
  const missionId = id ?? `mission-${state.missions.accepted.length + 1}`;
  state.missions.accepted.push({
    id: missionId,
    title: `Mission ${missionId}`,
    description: 'Test mission',
    reward: 100_000,
    deadline: '',
    state: 'ACCEPTED',
    deadlinePeriod: deadlinePeriod ?? undefined,
    requirements: {},
    objectives: [],
    acceptedDate: new Date().toISOString(),
    completedDate: null,
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Period constants', () => {
  it('CREW_SALARY_PER_PERIOD is $5,000', () => {
    expect(CREW_SALARY_PER_PERIOD).toBe(5_000);
  });

  it('FACILITY_UPKEEP_PER_PERIOD is $10,000', () => {
    expect(FACILITY_UPKEEP_PER_PERIOD).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// advancePeriod — counter
// ---------------------------------------------------------------------------

describe('advancePeriod() — counter', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('starts at period 0', () => {
    expect(state.currentPeriod).toBe(0);
  });

  it('increments from 0 to 1 on first call', () => {
    const result = advancePeriod(state);
    expect(state.currentPeriod).toBe(1);
    expect(result.newPeriod).toBe(1);
  });

  it('increments sequentially across multiple calls', () => {
    advancePeriod(state);
    advancePeriod(state);
    advancePeriod(state);
    expect(state.currentPeriod).toBe(3);
  });

  it('handles missing currentPeriod field (legacy save)', () => {
    delete state.currentPeriod;
    const result = advancePeriod(state);
    expect(state.currentPeriod).toBe(1);
    expect(result.newPeriod).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// advancePeriod — crew salaries
// ---------------------------------------------------------------------------

describe('advancePeriod() — crew salaries', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('charges nothing when there are no crew', () => {
    const result = advancePeriod(state);
    expect(result.crewSalaryCost).toBe(0);
    expect(result.activeCrewCount).toBe(0);
  });

  it('charges $5k per active crew member', () => {
    addCrew(state);
    addCrew(state);
    const result = advancePeriod(state);
    expect(result.crewSalaryCost).toBe(2 * CREW_SALARY_PER_PERIOD);
    expect(result.activeCrewCount).toBe(2);
  });

  it('does not charge fired crew', () => {
    addCrew(state);
    addCrew(state, { status: AstronautStatus.FIRED });
    const result = advancePeriod(state);
    expect(result.crewSalaryCost).toBe(CREW_SALARY_PER_PERIOD);
    expect(result.activeCrewCount).toBe(1);
  });

  it('does not charge KIA crew', () => {
    addCrew(state);
    addCrew(state, { status: AstronautStatus.KIA });
    const result = advancePeriod(state);
    expect(result.crewSalaryCost).toBe(CREW_SALARY_PER_PERIOD);
    expect(result.activeCrewCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// advancePeriod — facility upkeep
// ---------------------------------------------------------------------------

describe('advancePeriod() — facility upkeep', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('charges base facility upkeep per built facility', () => {
    const result = advancePeriod(state);
    expect(result.facilityUpkeep).toBe(BASE_UPKEEP);
  });
});

// ---------------------------------------------------------------------------
// advancePeriod — total operating costs
// ---------------------------------------------------------------------------

describe('advancePeriod() — operating costs deduction', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('deducts total operating costs from cash', () => {
    addCrew(state);
    addCrew(state);
    const cashBefore = state.money;
    const result = advancePeriod(state);
    const expectedCost = 2 * CREW_SALARY_PER_PERIOD + BASE_UPKEEP;
    expect(result.totalOperatingCost).toBe(expectedCost);
    expect(state.money).toBe(cashBefore - expectedCost);
  });

  it('with no crew, only facility upkeep is charged', () => {
    const cashBefore = state.money;
    const result = advancePeriod(state);
    expect(result.totalOperatingCost).toBe(BASE_UPKEEP);
    expect(state.money).toBe(cashBefore - BASE_UPKEEP);
  });

  it('can drive cash negative (costs are mandatory)', () => {
    state.money = 1_000;
    addCrew(state);
    addCrew(state);
    addCrew(state);
    advancePeriod(state);
    expect(state.money).toBe(1_000 - (3 * CREW_SALARY_PER_PERIOD + BASE_UPKEEP));
    expect(state.money).toBeLessThan(0);
  });

  it('deducts from zero cash correctly', () => {
    state.money = 0;
    advancePeriod(state);
    expect(state.money).toBe(-BASE_UPKEEP);
  });
});

// ---------------------------------------------------------------------------
// advancePeriod — mission expiry
// ---------------------------------------------------------------------------

describe('advancePeriod() — mission expiry', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('expires missions past their deadline period', () => {
    addAcceptedMission(state, { id: 'exp-1', deadlinePeriod: 1 });
    state.currentPeriod = 1; // after advance, period = 2, deadline was 1
    const result = advancePeriod(state);
    expect(result.expiredMissionIds).toContain('exp-1');
    expect(state.missions.accepted.find(m => m.id === 'exp-1')).toBeUndefined();
  });

  it('does not expire missions still within deadline', () => {
    addAcceptedMission(state, { id: 'alive-1', deadlinePeriod: 5 });
    const result = advancePeriod(state);
    expect(result.expiredMissionIds).not.toContain('alive-1');
    expect(state.missions.accepted.find(m => m.id === 'alive-1')).toBeDefined();
  });

  it('does not expire missions with no deadlinePeriod', () => {
    addAcceptedMission(state, { id: 'no-deadline' });
    const result = advancePeriod(state);
    expect(result.expiredMissionIds).toHaveLength(0);
    expect(state.missions.accepted).toHaveLength(1);
  });

  it('expires multiple missions at once', () => {
    addAcceptedMission(state, { id: 'exp-a', deadlinePeriod: 0 });
    addAcceptedMission(state, { id: 'exp-b', deadlinePeriod: 0 });
    addAcceptedMission(state, { id: 'alive', deadlinePeriod: 10 });
    const result = advancePeriod(state);
    expect(result.expiredMissionIds).toHaveLength(2);
    expect(state.missions.accepted).toHaveLength(1);
    expect(state.missions.accepted[0].id).toBe('alive');
  });
});

// ---------------------------------------------------------------------------
// gameState — currentPeriod field in initial state
// ---------------------------------------------------------------------------

describe('GameState — period field', () => {
  it('createGameState() includes currentPeriod initialized to 0', () => {
    const state = createGameState();
    expect(state).toHaveProperty('currentPeriod');
    expect(state.currentPeriod).toBe(0);
  });
});
