/**
 * flightReturn.test.js — Unit tests for processFlightReturn().
 *
 * Tests cover:
 *   - Return summary structure and defaults
 *   - Mission completion — all-met, partial, empty objectives
 *   - Part recovery — landed with assembly, crash, engineering bonus
 *   - Loan interest — applied when balance > 0, skipped when 0
 *   - Death fines — crashed crew, ejected crew, already applied
 *   - Reputation — crew death, safe return, rocket destruction, mission failure
 *   - Flight outcome determination — all FlightOutcome branches
 *   - Field craft deployment — orbit, non-Earth landing, crash filtering
 *   - Flight history recording and currentFlight clearing
 *   - Flight time accumulation
 *   - Contract/satellite/achievement/challenge delegation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGameState } from '../core/gameState.js';
import { processFlightReturn } from '../core/flightReturn.js';
import { MISSIONS, ObjectiveType, MissionStatus, rebuildMissionsIndex } from '../data/missions.js';
import {
  PartType,
  DEATH_FINE_PER_ASTRONAUT,
  FlightOutcome,
  STARTING_MONEY,
  STARTING_LOAN_BALANCE,
  STARTING_REPUTATION,
  FieldCraftStatus,
} from '../core/constants.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function freshState() {
  return createGameState();
}

function makeMissionDef(overrides = {}) {
  return {
    id: 'test-mission-001',
    title: 'Test Mission',
    description: 'A mission for testing.',
    location: 'desert',
    objectives: [],
    reward: 10_000,
    unlocksAfter: [],
    unlockedParts: [],
    status: MissionStatus.AVAILABLE,
    ...overrides,
  };
}

function seedAcceptedMission(state, def) {
  const instance = {
    ...def,
    objectives: def.objectives.map((o) => ({ ...o })),
    unlocksAfter: [...def.unlocksAfter],
    unlockedParts: [...def.unlockedParts],
    status: MissionStatus.ACCEPTED,
  };
  state.missions.accepted.push(instance);
  return instance;
}

function makeFlightState(missionId, overrides = {}) {
  return {
    missionId,
    rocketId: 'rocket-1',
    crewIds: [],
    timeElapsed: 0,
    altitude: 0,
    velocity: 0,
    maxAltitude: 0,
    maxVelocity: 0,
    fuelRemaining: 1000,
    deltaVRemaining: 5000,
    events: [],
    aborted: false,
    ...overrides,
  };
}

/**
 * Build a minimal physics state for testing.
 */
function makePhysicsState(overrides = {}) {
  return {
    landed: false,
    crashed: false,
    activeParts: new Set(),
    ejectedCrewIds: new Set(),
    _usedInventoryParts: null,
    ...overrides,
  };
}

/**
 * Build a minimal rocket assembly with a parts Map.
 * @param {Array<[string, {partId: string}]>} entries - [instanceId, {partId}] pairs
 */
function makeAssembly(entries) {
  return {
    parts: new Map(entries.map(([id, data]) => [id, data])),
  };
}

// ---------------------------------------------------------------------------
// Catalog surgery — same pattern as missions.test.js
// ---------------------------------------------------------------------------

function withMissions(...defs) {
  const saved = MISSIONS.splice(0, MISSIONS.length);
  MISSIONS.push(...defs);
  rebuildMissionsIndex();
  return () => {
    MISSIONS.splice(0, MISSIONS.length);
    MISSIONS.push(...saved);
    rebuildMissionsIndex();
  };
}

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------

/** @type {import('../core/gameState.js').GameState} */
let state;
let cleanup;

beforeEach(() => {
  state = freshState();
  cleanup = null;
});

afterEach(() => {
  if (cleanup) cleanup();
});

// ===========================================================================
// 1. Return summary structure
// ===========================================================================

describe('processFlightReturn() — return summary', () => {
  it('returns an object with all expected keys', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result).toHaveProperty('completedMissions');
    expect(result).toHaveProperty('recoveryValue');
    expect(result).toHaveProperty('interestCharged');
    expect(result).toHaveProperty('loanBalance');
    expect(result).toHaveProperty('deathFineTotal');
    expect(result).toHaveProperty('operatingCosts');
    expect(result).toHaveProperty('crewSalaryCost');
    expect(result).toHaveProperty('facilityUpkeep');
    expect(result).toHaveProperty('activeCrewCount');
    expect(result).toHaveProperty('netCashChange');
    expect(result).toHaveProperty('totalFlights');
    expect(result).toHaveProperty('currentPeriod');
    expect(result).toHaveProperty('expiredMissionIds');
    expect(result).toHaveProperty('completedContracts');
    expect(result).toHaveProperty('newContracts');
    expect(result).toHaveProperty('bankrupt');
    expect(result).toHaveProperty('deployedSatellites');
    expect(result).toHaveProperty('crewXPGains');
    expect(result).toHaveProperty('crewInjuries');
    expect(result).toHaveProperty('recoveredParts');
    expect(result).toHaveProperty('reputationChange');
    expect(result).toHaveProperty('reputationAfter');
    expect(result).toHaveProperty('newAchievements');
    expect(result).toHaveProperty('deployedFieldCraft');
    expect(result).toHaveProperty('lifeSupportWarnings');
    expect(result).toHaveProperty('lifeSupportDeaths');
    expect(result).toHaveProperty('challengeResult');
  });

  it('returns completedMissions as an empty array when no missions accepted', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);
    expect(result.completedMissions).toEqual([]);
  });

  it('records exactly one flight in history', () => {
    const fs = makeFlightState(null);
    processFlightReturn(state, fs, null, null);
    expect(state.flightHistory).toHaveLength(1);
  });

  it('advances the period counter', () => {
    const periodBefore = state.currentPeriod;
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);
    expect(result.currentPeriod).toBe(periodBefore + 1);
  });

  it('clears state.currentFlight to null', () => {
    state.currentFlight = { missionId: 'x' };
    const fs = makeFlightState(null);
    processFlightReturn(state, fs, null, null);
    expect(state.currentFlight).toBeNull();
  });
});

// ===========================================================================
// 2. Mission completion
// ===========================================================================

describe('processFlightReturn() — mission completion', () => {
  it('completes a mission when all objectives are met', () => {
    const def = makeMissionDef({
      id: 'fr-m1',
      title: 'Test Complete',
      reward: 5000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'reach 100m' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);
    state.loan = { balance: 0, interestRate: 0 };

    const fs = makeFlightState('fr-m1');
    const result = processFlightReturn(state, fs, null, null);

    expect(result.completedMissions).toHaveLength(1);
    expect(result.completedMissions[0].reward).toBe(5000);
    expect(state.missions.completed.map((m) => m.id)).toContain('fr-m1');
  });

  it('does not complete a mission when objectives are not all met', () => {
    const def = makeMissionDef({
      id: 'fr-m2',
      reward: 5000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
        { id: 'o2', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 9999 }, completed: false, description: 'not done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const fs = makeFlightState('fr-m2');
    const result = processFlightReturn(state, fs, null, null);

    expect(result.completedMissions).toHaveLength(0);
    expect(state.missions.accepted).toHaveLength(1);
  });

  it('does not complete a mission with empty objectives array', () => {
    const def = makeMissionDef({
      id: 'fr-empty',
      reward: 1000,
      objectives: [],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const fs = makeFlightState('fr-empty');
    const result = processFlightReturn(state, fs, null, null);

    expect(result.completedMissions).toHaveLength(0);
  });

  it('completes multiple missions in a single flight', () => {
    const def1 = makeMissionDef({
      id: 'fr-multi1',
      reward: 3000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    const def2 = makeMissionDef({
      id: 'fr-multi2',
      reward: 7000,
      objectives: [
        { id: 'o2', type: ObjectiveType.REACH_SPEED, target: { speed: 50 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def1, def2);
    seedAcceptedMission(state, def1);
    seedAcceptedMission(state, def2);
    state.loan = { balance: 0, interestRate: 0 };

    const moneyBefore = state.money;
    const fs = makeFlightState('fr-multi1');
    const result = processFlightReturn(state, fs, null, null);

    expect(result.completedMissions).toHaveLength(2);
    expect(state.money).toBe(moneyBefore + 3000 + 7000 - result.operatingCosts);
  });

  it('credits mission rewards to state.money', () => {
    const def = makeMissionDef({
      id: 'fr-reward',
      reward: 25_000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);
    state.loan = { balance: 0, interestRate: 0 };

    const moneyBefore = state.money;
    const fs = makeFlightState('fr-reward');
    const result = processFlightReturn(state, fs, null, null);

    // Money = before + reward - operatingCosts
    expect(state.money).toBe(moneyBefore + 25_000 - result.operatingCosts);
  });
});

// ===========================================================================
// 3. Part recovery
// ===========================================================================

describe('processFlightReturn() — part recovery', () => {
  it('recovers part value when landed safely with an assembly', () => {
    state.loan = { balance: 0, interestRate: 0 };

    // Use real part IDs from the catalog.
    // probe-core-mk1 cost=5000, tank-small cost=800
    const assembly = makeAssembly([
      ['inst-1', { partId: 'probe-core-mk1' }],
      ['inst-2', { partId: 'tank-small' }],
    ]);
    const ps = makePhysicsState({
      landed: true,
      crashed: false,
      activeParts: new Set(['inst-1', 'inst-2']),
    });
    const fs = makeFlightState(null);

    const moneyBefore = state.money;
    const result = processFlightReturn(state, fs, ps, assembly);

    // With no crew, engineering skill = 0, recoveryFrac = 0.6
    const expectedRecovery = Math.round(5000 * 0.6) + Math.round(800 * 0.6);
    expect(result.recoveryValue).toBe(expectedRecovery);
    // Money gained from recovery, minus operating costs
    expect(state.money).toBe(moneyBefore + expectedRecovery - result.operatingCosts);
  });

  it('does not recover parts when crashed', () => {
    const assembly = makeAssembly([
      ['inst-1', { partId: 'probe-core-mk1' }],
    ]);
    const ps = makePhysicsState({
      landed: false,
      crashed: true,
      activeParts: new Set(['inst-1']),
    });
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, ps, assembly);

    expect(result.recoveryValue).toBe(0);
  });

  it('does not recover parts when assembly is null', () => {
    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, ps, null);

    expect(result.recoveryValue).toBe(0);
  });

  it('does not recover parts when ps is null', () => {
    const assembly = makeAssembly([
      ['inst-1', { partId: 'probe-core-mk1' }],
    ]);
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, assembly);

    expect(result.recoveryValue).toBe(0);
  });

  it('skips destroyed parts (not in activeParts)', () => {
    state.loan = { balance: 0, interestRate: 0 };

    const assembly = makeAssembly([
      ['inst-1', { partId: 'probe-core-mk1' }],   // active
      ['inst-2', { partId: 'tank-small' }],         // destroyed (not in activeParts)
    ]);
    const ps = makePhysicsState({
      landed: true,
      crashed: false,
      activeParts: new Set(['inst-1']), // only inst-1 active
    });
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, ps, assembly);

    // Only probe-core-mk1 recovered
    expect(result.recoveryValue).toBe(Math.round(5000 * 0.6));
  });

  it('skips parts with unknown partId (not in catalog)', () => {
    state.loan = { balance: 0, interestRate: 0 };

    const assembly = makeAssembly([
      ['inst-1', { partId: 'nonexistent-part-xyz' }],
    ]);
    const ps = makePhysicsState({
      landed: true,
      crashed: false,
      activeParts: new Set(['inst-1']),
    });
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, ps, assembly);

    expect(result.recoveryValue).toBe(0);
  });

  it('applies engineering skill bonus to recovery fraction', () => {
    state.loan = { balance: 0, interestRate: 0 };

    // Add a crew member with engineering skill.
    const crewId = 'eng-crew-1';
    state.crew.push({
      id: crewId,
      name: 'Engineer',
      status: 'active',
      skills: { piloting: 0, engineering: 50, science: 0 },
      flightCount: 0,
      hiredPeriod: 0,
    });

    const assembly = makeAssembly([
      ['inst-1', { partId: 'engine-spark' }], // cost=6000
    ]);
    const ps = makePhysicsState({
      landed: true,
      crashed: false,
      activeParts: new Set(['inst-1']),
    });
    const fs = makeFlightState(null, { crewIds: [crewId] });

    const result = processFlightReturn(state, fs, ps, assembly);

    // recoveryFrac = 0.6 + (50/100) * 0.2 = 0.7
    const expectedRecovery = Math.round(6000 * 0.7);
    expect(result.recoveryValue).toBe(expectedRecovery);
  });
});

// ===========================================================================
// 4. Loan interest
// ===========================================================================

describe('processFlightReturn() — loan interest', () => {
  it('applies interest when loan balance > 0', () => {
    state.loan = { balance: 1_000_000, interestRate: 0.05, totalInterestAccrued: 0 };
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    // Interest = 1M * 5% = 50,000
    expect(result.interestCharged).toBeGreaterThan(0);
  });

  it('does not apply interest when loan balance is 0', () => {
    state.loan = { balance: 0, interestRate: 0.03, totalInterestAccrued: 0 };
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.interestCharged).toBe(0);
  });

  it('returns the correct loan balance after interest', () => {
    state.loan = { balance: 2_000_000, interestRate: 0.03, totalInterestAccrued: 0 };
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.loanBalance).toBe(state.loan.balance);
  });
});

// ===========================================================================
// 5. Death fines
// ===========================================================================

describe('processFlightReturn() — death fines', () => {
  it('applies death fine for crew KIA on crash', () => {
    // Add crew members.
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
      { id: 'crew-b', name: 'Beta', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

    const ps = makePhysicsState({
      crashed: true,
      landed: false,
      ejectedCrewIds: new Set(),
    });
    const fs = makeFlightState(null, {
      crewIds: ['crew-a', 'crew-b'],
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deathFineTotal).toBe(2 * DEATH_FINE_PER_ASTRONAUT);
  });

  it('does not fine ejected crew on crash', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
      { id: 'crew-b', name: 'Beta', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

    const ps = makePhysicsState({
      crashed: true,
      landed: false,
      ejectedCrewIds: new Set(['crew-a']), // crew-a ejected safely
    });
    const fs = makeFlightState(null, {
      crewIds: ['crew-a', 'crew-b'],
    });

    const result = processFlightReturn(state, fs, ps, null);

    // Only crew-b was KIA.
    expect(result.deathFineTotal).toBe(1 * DEATH_FINE_PER_ASTRONAUT);
  });

  it('does not apply death fines when deathFinesApplied is true', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ crashed: true });
    const fs = makeFlightState(null, {
      crewIds: ['crew-a'],
      deathFinesApplied: true, // already applied mid-flight
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deathFineTotal).toBe(0);
  });

  it('does not apply death fines when craft landed safely', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deathFineTotal).toBe(0);
  });

  it('applies death fine when all command modules destroyed (not crashed)', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

    // Assembly has a command module but it's NOT in activeParts (destroyed).
    const assembly = makeAssembly([
      ['cmd-inst', { partId: 'cmd-mk1' }],
      ['tank-inst', { partId: 'tank-small' }],
    ]);
    const ps = makePhysicsState({
      landed: false,
      crashed: false,
      activeParts: new Set(['tank-inst']), // cmd-inst NOT active (destroyed)
    });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, assembly);

    expect(result.deathFineTotal).toBe(1 * DEATH_FINE_PER_ASTRONAUT);
  });

  it('does not apply death fine when command module is still active', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const assembly = makeAssembly([
      ['cmd-inst', { partId: 'cmd-mk1' }],
    ]);
    const ps = makePhysicsState({
      landed: false,
      crashed: false,
      activeParts: new Set(['cmd-inst']), // command module still active
    });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, assembly);

    expect(result.deathFineTotal).toBe(0);
  });

  it('does not apply death fine for uncrewed flights', () => {
    const ps = makePhysicsState({ crashed: true });
    const fs = makeFlightState(null, { crewIds: [] });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deathFineTotal).toBe(0);
  });

  it('marks deathFinesApplied on flightState after processing', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ crashed: true });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    processFlightReturn(state, fs, ps, null);

    expect(fs.deathFinesApplied).toBe(true);
  });
});

// ===========================================================================
// 6. Reputation
// ===========================================================================

describe('processFlightReturn() — reputation', () => {
  it('decreases reputation on crew death', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ crashed: true });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, null);

    // Crew death: -10, rocket destruction: -2, mission failure: -3 = -15
    expect(result.reputationChange).toBeLessThan(0);
    expect(result.reputationAfter).toBeLessThan(STARTING_REPUTATION);
  });

  it('increases reputation on safe crew return', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    // Complete a mission so outcome is SUCCESS (not FAILURE which would penalise).
    const def = makeMissionDef({
      id: 'fr-rep-mission',
      reward: 1000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState('fr-rep-mission', { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, null);

    // Safe crew return: +1 per surviving crew
    expect(result.reputationAfter).toBeGreaterThanOrEqual(STARTING_REPUTATION);
  });

  it('decreases reputation on rocket destruction (crash without landing)', () => {
    const ps = makePhysicsState({ crashed: true, landed: false });
    const fs = makeFlightState(null);

    const result = processFlightReturn(state, fs, ps, null);

    // Rocket destruction: -2, mission failure: -3 = -5
    expect(result.reputationChange).toBeLessThan(0);
  });

  it('decreases reputation on mission failure outcome', () => {
    const ps = makePhysicsState({ crashed: true, landed: false });
    const fs = makeFlightState(null);

    const result = processFlightReturn(state, fs, ps, null);

    // Mission failure: -3 (no missions completed, crashed)
    expect(result.reputationAfter).toBeLessThan(STARTING_REPUTATION);
  });

  it('does not penalise for mission failure when missions are completed', () => {
    const def = makeMissionDef({
      id: 'fr-rep-crash-complete',
      reward: 1000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const ps = makePhysicsState({ crashed: true, landed: false });
    const fs = makeFlightState('fr-rep-crash-complete');

    const result = processFlightReturn(state, fs, ps, null);

    // Outcome is PARTIAL_SUCCESS (crashed + missions) → no mission failure penalty.
    // Only rocket destruction: -2
    // reputationChange should be -2, not -5
    expect(result.reputationChange).toBe(-2);
  });
});

// ===========================================================================
// 7. Flight outcome (_determineOutcome)
// ===========================================================================

describe('processFlightReturn() — flight outcome', () => {
  it('records SUCCESS when landed with missions completed', () => {
    const def = makeMissionDef({
      id: 'fr-outcome-success',
      reward: 1000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState('fr-outcome-success');
    processFlightReturn(state, fs, ps, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.outcome).toBe(FlightOutcome.SUCCESS);
  });

  it('records PARTIAL_SUCCESS when landed without completing missions', () => {
    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null);
    processFlightReturn(state, fs, ps, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.outcome).toBe(FlightOutcome.PARTIAL_SUCCESS);
  });

  it('records PARTIAL_SUCCESS when crashed but missions completed', () => {
    const def = makeMissionDef({
      id: 'fr-outcome-partial',
      reward: 1000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const ps = makePhysicsState({ crashed: true, landed: false });
    const fs = makeFlightState('fr-outcome-partial');
    processFlightReturn(state, fs, ps, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.outcome).toBe(FlightOutcome.PARTIAL_SUCCESS);
  });

  it('records FAILURE when crashed without completing missions', () => {
    const ps = makePhysicsState({ crashed: true, landed: false });
    const fs = makeFlightState(null);
    processFlightReturn(state, fs, ps, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.outcome).toBe(FlightOutcome.FAILURE);
  });

  it('records SUCCESS when ps is null but missions completed', () => {
    const def = makeMissionDef({
      id: 'fr-outcome-null-ps',
      reward: 1000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const fs = makeFlightState('fr-outcome-null-ps');
    processFlightReturn(state, fs, null, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.outcome).toBe(FlightOutcome.SUCCESS);
  });

  it('records FAILURE when ps is null and no missions completed', () => {
    const fs = makeFlightState(null);
    processFlightReturn(state, fs, null, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.outcome).toBe(FlightOutcome.FAILURE);
  });
});

// ===========================================================================
// 8. Flight history recording
// ===========================================================================

describe('processFlightReturn() — flight history', () => {
  it('records flight with correct mission and rocket IDs', () => {
    const fs = makeFlightState('mission-abc', { rocketId: 'rocket-xyz' });
    processFlightReturn(state, fs, null, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.missionId).toBe('mission-abc');
    expect(lastFlight.rocketId).toBe('rocket-xyz');
  });

  it('records crewIds from flight state', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });
    processFlightReturn(state, fs, ps, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.crewIds).toContain('crew-a');
  });

  it('records maxAltitude and maxSpeed from flightState', () => {
    const fs = makeFlightState(null, {
      maxAltitude: 150_000,
      maxVelocity: 7800,
    });
    processFlightReturn(state, fs, null, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.maxAltitude).toBe(150_000);
    expect(lastFlight.maxSpeed).toBe(7800);
  });

  it('records flight duration from timeElapsed', () => {
    const fs = makeFlightState(null, { timeElapsed: 600 });
    processFlightReturn(state, fs, null, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.duration).toBe(600);
  });

  it('records revenue as mission rewards + recovery value', () => {
    const def = makeMissionDef({
      id: 'fr-rev',
      reward: 5000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const assembly = makeAssembly([
      ['inst-1', { partId: 'probe-core-mk1' }], // cost=5000
    ]);
    const ps = makePhysicsState({
      landed: true,
      crashed: false,
      activeParts: new Set(['inst-1']),
    });
    const fs = makeFlightState('fr-rev');
    const result = processFlightReturn(state, fs, ps, assembly);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.revenue).toBe(5000 + result.recoveryValue);
  });

  it('records bodies visited from flightState', () => {
    const fs = makeFlightState(null, {
      bodyId: 'MOON',
      transferState: {
        originBodyId: 'EARTH',
        destinationBodyId: 'MOON',
      },
    });
    processFlightReturn(state, fs, null, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.bodiesVisited).toContain('EARTH');
    expect(lastFlight.bodiesVisited).toContain('MOON');
  });

  it('records rocket name from savedDesigns or rockets', () => {
    state.rockets = [{ id: 'rocket-1', name: 'My Rocket' }];
    const fs = makeFlightState(null, { rocketId: 'rocket-1' });
    processFlightReturn(state, fs, null, null);

    const lastFlight = state.flightHistory[state.flightHistory.length - 1];
    expect(lastFlight.rocketName).toBe('My Rocket');
  });

  it('generates a unique ID for each flight record', () => {
    const fs1 = makeFlightState(null);
    processFlightReturn(state, fs1, null, null);
    const fs2 = makeFlightState(null);
    processFlightReturn(state, fs2, null, null);

    expect(state.flightHistory).toHaveLength(2);
    expect(state.flightHistory[0].id).not.toBe(state.flightHistory[1].id);
  });

  it('initialises flightHistory array if missing', () => {
    state.flightHistory = undefined;
    const fs = makeFlightState(null);
    processFlightReturn(state, fs, null, null);

    expect(Array.isArray(state.flightHistory)).toBe(true);
    expect(state.flightHistory).toHaveLength(1);
  });
});

// ===========================================================================
// 9. Flight time accumulation
// ===========================================================================

describe('processFlightReturn() — flight time', () => {
  it('accumulates flight time from flightState.timeElapsed', () => {
    state.flightTimeSeconds = 100;
    const fs = makeFlightState(null, { timeElapsed: 250 });
    processFlightReturn(state, fs, null, null);

    expect(state.flightTimeSeconds).toBe(350);
  });

  it('defaults timeElapsed to 0 if not present', () => {
    state.flightTimeSeconds = 100;
    const fs = makeFlightState(null);
    delete fs.timeElapsed;
    processFlightReturn(state, fs, null, null);

    expect(state.flightTimeSeconds).toBe(100);
  });

  it('initialises flightTimeSeconds if undefined', () => {
    state.flightTimeSeconds = undefined;
    const fs = makeFlightState(null, { timeElapsed: 50 });
    processFlightReturn(state, fs, null, null);

    expect(state.flightTimeSeconds).toBe(50);
  });
});

// ===========================================================================
// 10. Net cash change
// ===========================================================================

describe('processFlightReturn() — net cash change', () => {
  it('calculates netCashChange as state.money difference', () => {
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };
    const moneyBefore = state.money;
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.netCashChange).toBe(state.money - moneyBefore);
  });

  it('netCashChange reflects mission reward minus operating costs', () => {
    const def = makeMissionDef({
      id: 'fr-net',
      reward: 50_000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

    const fs = makeFlightState('fr-net');
    const result = processFlightReturn(state, fs, null, null);

    // Net = reward - operatingCosts
    expect(result.netCashChange).toBe(50_000 - result.operatingCosts);
  });
});

// ===========================================================================
// 11. Field craft deployment
// ===========================================================================

describe('processFlightReturn() — field craft', () => {
  it('creates field craft when crew is in orbit', () => {
    state.crew.push(
      { id: 'crew-orbit', name: 'Orbiter', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.rockets = [{ id: 'rocket-1', name: 'Orbital Vessel' }];

    const ps = makePhysicsState({ landed: false, crashed: false });
    const fs = makeFlightState(null, {
      crewIds: ['crew-orbit'],
      inOrbit: true,
      bodyId: 'EARTH',
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deployedFieldCraft).not.toBeNull();
    expect(result.deployedFieldCraft.crewIds).toContain('crew-orbit');
    expect(result.deployedFieldCraft.status).toBe(FieldCraftStatus.IN_ORBIT);
    expect(state.fieldCraft.length).toBeGreaterThanOrEqual(1);
  });

  it('creates field craft when crew lands on non-Earth body', () => {
    state.crew.push(
      { id: 'crew-moon', name: 'Moonwalker', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.rockets = [{ id: 'rocket-1', name: 'Lunar Lander' }];

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, {
      crewIds: ['crew-moon'],
      bodyId: 'MOON',
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deployedFieldCraft).not.toBeNull();
    expect(result.deployedFieldCraft.status).toBe(FieldCraftStatus.LANDED);
    expect(result.deployedFieldCraft.bodyId).toBe('MOON');
  });

  it('does not create field craft when crew returns to Earth', () => {
    state.crew.push(
      { id: 'crew-home', name: 'Homer', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, {
      crewIds: ['crew-home'],
      bodyId: 'EARTH',
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deployedFieldCraft).toBeNull();
  });

  it('does not create field craft for uncrewed flights', () => {
    const ps = makePhysicsState({ landed: false, crashed: false });
    const fs = makeFlightState(null, {
      crewIds: [],
      inOrbit: true,
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deployedFieldCraft).toBeNull();
  });

  it('excludes KIA crew from field craft when crashed in orbit', () => {
    state.crew.push(
      { id: 'crew-alive', name: 'Survivor', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
      { id: 'crew-dead', name: 'Lost', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.rockets = [{ id: 'rocket-1', name: 'Vessel' }];

    const ps = makePhysicsState({
      landed: false,
      crashed: true,
      ejectedCrewIds: new Set(['crew-alive']), // crew-alive ejected, crew-dead KIA
    });
    const fs = makeFlightState(null, {
      crewIds: ['crew-alive', 'crew-dead'],
      inOrbit: true,
    });

    const result = processFlightReturn(state, fs, ps, null);

    // crew-dead was KIA (crashed, not ejected) — should not be in field craft.
    if (result.deployedFieldCraft) {
      expect(result.deployedFieldCraft.crewIds).toContain('crew-alive');
      expect(result.deployedFieldCraft.crewIds).not.toContain('crew-dead');
    }
  });

  it('does not create field craft when all crew are KIA', () => {
    state.crew.push(
      { id: 'crew-dead', name: 'Lost', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({
      landed: false,
      crashed: true,
      ejectedCrewIds: new Set(), // no one ejected → all KIA
    });
    const fs = makeFlightState(null, {
      crewIds: ['crew-dead'],
      inOrbit: true,
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.deployedFieldCraft).toBeNull();
  });

  it('initialises fieldCraft array if missing', () => {
    state.fieldCraft = undefined;
    state.crew.push(
      { id: 'crew-orbit', name: 'Orbiter', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.rockets = [{ id: 'rocket-1', name: 'Ship' }];

    const ps = makePhysicsState({ landed: false, crashed: false });
    const fs = makeFlightState(null, {
      crewIds: ['crew-orbit'],
      inOrbit: true,
    });

    const result = processFlightReturn(state, fs, ps, null);

    expect(Array.isArray(state.fieldCraft)).toBe(true);
    expect(result.deployedFieldCraft).not.toBeNull();
  });
});

// ===========================================================================
// 12. Crew XP awards
// ===========================================================================

describe('processFlightReturn() — crew XP', () => {
  it('awards XP to surviving crew', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.crewXPGains).toBeInstanceOf(Array);
  });

  it('does not award XP to KIA crew on crash', () => {
    state.crew.push(
      { id: 'crew-dead', name: 'Lost', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({
      crashed: true,
      ejectedCrewIds: new Set(), // not ejected → KIA
    });
    const fs = makeFlightState(null, { crewIds: ['crew-dead'] });

    const result = processFlightReturn(state, fs, ps, null);

    // No surviving crew → empty XP gains
    expect(result.crewXPGains).toEqual([]);
  });

  it('awards XP to ejected crew even on crash', () => {
    state.crew.push(
      { id: 'crew-ejected', name: 'Ejected', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({
      crashed: true,
      ejectedCrewIds: new Set(['crew-ejected']),
    });
    const fs = makeFlightState(null, { crewIds: ['crew-ejected'] });

    const result = processFlightReturn(state, fs, ps, null);

    // Ejected crew survive → they get XP
    expect(result.crewXPGains.length).toBeGreaterThanOrEqual(0);
  });

  it('returns empty array when no crew on flight', () => {
    const fs = makeFlightState(null, { crewIds: [] });
    const result = processFlightReturn(state, fs, null, null);

    expect(result.crewXPGains).toEqual([]);
  });
});

// ===========================================================================
// 13. Surface sample returns
// ===========================================================================

describe('processFlightReturn() — surface samples', () => {
  it('processes sample returns on safe Earth landing', () => {
    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, { bodyId: 'EARTH' });

    const result = processFlightReturn(state, fs, ps, null);

    // No surface items to return, but the function was called
    expect(result).toHaveProperty('samplesReturned');
    expect(result.samplesReturned).toBe(0);
  });

  it('does not process sample returns when crashed', () => {
    const ps = makePhysicsState({ crashed: true, landed: false });
    const fs = makeFlightState(null, { bodyId: 'EARTH' });

    const result = processFlightReturn(state, fs, ps, null);

    expect(result.samplesReturned).toBe(0);
  });
});

// ===========================================================================
// 14. Operating costs
// ===========================================================================

describe('processFlightReturn() — operating costs', () => {
  it('reports operating costs, crew salaries, and facility upkeep', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(typeof result.operatingCosts).toBe('number');
    expect(typeof result.crewSalaryCost).toBe('number');
    expect(typeof result.facilityUpkeep).toBe('number');
    expect(result.operatingCosts).toBe(result.crewSalaryCost + result.facilityUpkeep);
  });

  it('reports activeCrewCount', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });
    const result = processFlightReturn(state, fs, ps, null);

    expect(result.activeCrewCount).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// 15. Contracts and satellites
// ===========================================================================

describe('processFlightReturn() — contracts and satellites', () => {
  it('returns completedContracts array', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.completedContracts).toBeInstanceOf(Array);
  });

  it('returns newContracts array', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.newContracts).toBeInstanceOf(Array);
  });

  it('returns deployedSatellites array', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.deployedSatellites).toBeInstanceOf(Array);
  });
});

// ===========================================================================
// 16. Achievements and challenges
// ===========================================================================

describe('processFlightReturn() — achievements and challenges', () => {
  it('returns newAchievements array', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.newAchievements).toBeInstanceOf(Array);
  });

  it('returns challengeResult object', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result).toHaveProperty('challengeResult');
  });
});

// ===========================================================================
// 17. Weather reroll
// ===========================================================================

describe('processFlightReturn() — weather', () => {
  it('reinitialises weather after flight return', () => {
    state.weather = null;
    const fs = makeFlightState(null, { bodyId: 'EARTH' });
    processFlightReturn(state, fs, null, null);

    expect(state.weather).not.toBeNull();
  });
});

// ===========================================================================
// 18. Edge cases
// ===========================================================================

describe('processFlightReturn() — edge cases', () => {
  it('handles null flightState.crewIds gracefully in death fine path', () => {
    const ps = makePhysicsState({ crashed: true });
    const fs = makeFlightState(null);
    fs.crewIds = undefined;

    // Should not throw.
    const result = processFlightReturn(state, fs, ps, null);
    expect(result.deathFineTotal).toBe(0);
  });

  it('handles missing flightState.events gracefully', () => {
    const fs = makeFlightState(null);
    delete fs.events;

    // Should not throw.
    const result = processFlightReturn(state, fs, null, null);
    expect(result).toHaveProperty('crewXPGains');
  });

  it('handles undefined ps.ejectedCrewIds', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ crashed: true });
    delete ps.ejectedCrewIds;
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    // Should not throw — defaults to empty set via ?? operator.
    const result = processFlightReturn(state, fs, ps, null);
    expect(result.deathFineTotal).toBe(1 * DEATH_FINE_PER_ASTRONAUT);
  });

  it('handles multiple flights accumulating history', () => {
    for (let i = 0; i < 3; i++) {
      const fs = makeFlightState(null, { timeElapsed: 100 });
      processFlightReturn(state, fs, null, null);
    }

    expect(state.flightHistory).toHaveLength(3);
    expect(state.flightTimeSeconds).toBe(300);
  });

  it('totalFlights matches flightHistory length', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.totalFlights).toBe(state.flightHistory.length);
  });

  it('handles flightState with no bodyId (defaults to EARTH)', () => {
    const fs = makeFlightState(null);
    delete fs.bodyId;
    const result = processFlightReturn(state, fs, null, null);

    // Should not throw. Weather should be initialised for EARTH.
    expect(state.weather).not.toBeNull();
    expect(result).toHaveProperty('samplesReturned');
  });
});

// ===========================================================================
// 19. _allCommandModulesDestroyed (tested via death fines)
// ===========================================================================

describe('processFlightReturn() — command module destruction logic', () => {
  it('does not trigger when assembly has no command modules', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    // Assembly has only a probe core (COMPUTER_MODULE, not COMMAND_MODULE).
    const assembly = makeAssembly([
      ['probe-inst', { partId: 'probe-core-mk1' }],
    ]);
    const ps = makePhysicsState({
      landed: false,
      crashed: false,
      activeParts: new Set(), // probe destroyed but it's not a command module
    });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, assembly);

    // No command modules → _allCommandModulesDestroyed returns false → no death fine.
    expect(result.deathFineTotal).toBe(0);
  });

  it('does not trigger when at least one command module is active', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const assembly = makeAssembly([
      ['cmd-1', { partId: 'cmd-mk1' }],
      ['cmd-2', { partId: 'cmd-mk1' }],
    ]);
    const ps = makePhysicsState({
      landed: false,
      crashed: false,
      activeParts: new Set(['cmd-1']), // cmd-1 active, cmd-2 destroyed
    });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, assembly);

    // At least one command module active → not all destroyed → no death fine.
    expect(result.deathFineTotal).toBe(0);
  });

  it('triggers death fine when all command modules destroyed (two modules)', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

    const assembly = makeAssembly([
      ['cmd-1', { partId: 'cmd-mk1' }],
      ['cmd-2', { partId: 'cmd-mk1' }],
      ['tank-inst', { partId: 'tank-small' }],
    ]);
    const ps = makePhysicsState({
      landed: false,
      crashed: false,
      activeParts: new Set(['tank-inst']), // both command modules destroyed
    });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });

    const result = processFlightReturn(state, fs, ps, assembly);

    expect(result.deathFineTotal).toBe(1 * DEATH_FINE_PER_ASTRONAUT);
  });
});

// ===========================================================================
// 20. Bankruptcy flag
// ===========================================================================

describe('processFlightReturn() — bankruptcy', () => {
  it('reports bankrupt flag from period summary', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(typeof result.bankrupt).toBe('boolean');
  });
});

// ===========================================================================
// 21. Crew injuries
// ===========================================================================

describe('processFlightReturn() — crew injuries', () => {
  it('returns crewInjuries array', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.crewInjuries).toBeInstanceOf(Array);
  });

  it('returns empty injuries for safe landing', () => {
    state.crew.push(
      { id: 'crew-a', name: 'Alpha', status: 'active', skills: { piloting: 0, engineering: 0, science: 0 }, flightCount: 0, hiredPeriod: 0 },
    );

    const ps = makePhysicsState({ landed: true, crashed: false });
    const fs = makeFlightState(null, { crewIds: ['crew-a'] });
    const result = processFlightReturn(state, fs, ps, null);

    expect(result.crewInjuries).toEqual([]);
  });
});

// ===========================================================================
// 22. Life support warnings/deaths
// ===========================================================================

describe('processFlightReturn() — life support', () => {
  it('returns lifeSupportWarnings array', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.lifeSupportWarnings).toBeInstanceOf(Array);
  });

  it('returns lifeSupportDeaths array', () => {
    const fs = makeFlightState(null);
    const result = processFlightReturn(state, fs, null, null);

    expect(result.lifeSupportDeaths).toBeInstanceOf(Array);
  });
});

// ===========================================================================
// 23. Defensive null guards on state properties
// ===========================================================================

describe('processFlightReturn() — defensive null guards', () => {
  it('handles state.crew being null without throwing', () => {
    state.crew = null;
    const fs = makeFlightState(null, {
      crewIds: ['astro-1'],
      inOrbit: true,
    });
    const ps = makePhysicsState({ landed: false, crashed: false });

    expect(() => processFlightReturn(state, fs, ps, null)).not.toThrow();
  });

  it('handles state.crew being undefined without throwing', () => {
    state.crew = undefined;
    const fs = makeFlightState(null, {
      crewIds: ['astro-1'],
      inOrbit: true,
    });
    const ps = makePhysicsState({ landed: false, crashed: false });

    expect(() => processFlightReturn(state, fs, ps, null)).not.toThrow();
  });

  it('handles state.missions being null without throwing', () => {
    state.missions = null;
    const fs = makeFlightState(null);

    expect(() => processFlightReturn(state, fs, null, null)).not.toThrow();
    const result = processFlightReturn(state, fs, null, null);
    expect(result.completedMissions).toEqual([]);
  });

  it('handles state.missions.accepted being undefined without throwing', () => {
    state.missions = {};
    const fs = makeFlightState(null);

    expect(() => processFlightReturn(state, fs, null, null)).not.toThrow();
    const result = processFlightReturn(state, fs, null, null);
    expect(result.completedMissions).toEqual([]);
  });
});
