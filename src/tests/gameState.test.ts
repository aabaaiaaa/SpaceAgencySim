// @ts-nocheck
/**
 * gameState.test.js — Unit tests for the central game state module.
 *
 * Tests cover:
 *   - createGameState()       — correct initial shape and defaults
 *   - createCrewMember()      — correct defaults and field presence
 *   - createMission()         — correct defaults and field presence
 *   - createRocketDesign()    — correct defaults and field presence
 *   - createFlightResult()    — correct defaults and field presence
 *   - createFlightState()     — correct defaults and field presence
 *   - isFlightActive()        — correctly detects active / idle state
 *   - getIdleCrew()           — filters correctly by status
 *   - findCrewById()          — finds and returns correct record
 *   - findMissionById()       — searches all three mission buckets
 *   - findRocketById()        — finds and returns correct record
 *   - PartType / MissionState / CrewStatus / FlightOutcome — frozen enums
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // State factories
  createGameState,
  createCrewMember,
  createMission,
  createRocketDesign,
  createFlightResult,
  createFlightState,
  // Helpers
  isFlightActive,
  getIdleCrew,
  findCrewById,
  findMissionById,
  findRocketById,
} from '../core/gameState.ts';
import {
  PartType,
  MissionState,
  CrewStatus,
  AstronautStatus,
  FlightOutcome,
  FuelType,
  STARTING_MONEY,
  STARTING_LOAN_BALANCE,
  DEFAULT_LOAN_INTEREST_RATE,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// createGameState
// ---------------------------------------------------------------------------

describe('createGameState()', () => {
  let state;
  beforeEach(() => { state = createGameState(); });

  it('sets money to STARTING_MONEY', () => {
    expect(state.money).toBe(STARTING_MONEY);
  });

  it('initialises loan with correct defaults', () => {
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE);
    expect(state.loan.interestRate).toBe(DEFAULT_LOAN_INTEREST_RATE);
  });

  it('initialises crew as empty array', () => {
    expect(Array.isArray(state.crew)).toBe(true);
    expect(state.crew).toHaveLength(0);
  });

  it('initialises missions object with three empty arrays', () => {
    expect(Array.isArray(state.missions.available)).toBe(true);
    expect(Array.isArray(state.missions.accepted)).toBe(true);
    expect(Array.isArray(state.missions.completed)).toBe(true);
    expect(state.missions.available).toHaveLength(0);
    expect(state.missions.accepted).toHaveLength(0);
    expect(state.missions.completed).toHaveLength(0);
  });

  it('initialises rockets as empty array', () => {
    expect(Array.isArray(state.rockets)).toBe(true);
    expect(state.rockets).toHaveLength(0);
  });

  it('initialises parts as empty array', () => {
    expect(Array.isArray(state.parts)).toBe(true);
    expect(state.parts).toHaveLength(0);
  });

  it('initialises flightHistory as empty array', () => {
    expect(Array.isArray(state.flightHistory)).toBe(true);
    expect(state.flightHistory).toHaveLength(0);
  });

  it('initialises playTimeSeconds to 0', () => {
    expect(state.playTimeSeconds).toBe(0);
  });

  it('initialises currentFlight to null', () => {
    expect(state.currentFlight).toBeNull();
  });

  it('initialises debugMode to false', () => {
    expect(state.debugMode).toBe(false);
  });

  it('@smoke returns independent objects on each call', () => {
    const stateA = createGameState();
    const stateB = createGameState();
    stateA.money = 999;
    expect(stateB.money).toBe(STARTING_MONEY);
  });
});

// ---------------------------------------------------------------------------
// createCrewMember
// ---------------------------------------------------------------------------

describe('createCrewMember()', () => {
  const opts = { id: 'crew-1', name: 'Alice', salary: 500 };
  let member;
  beforeEach(() => { member = createCrewMember(opts); });

  it('stores provided id, name, and salary', () => {
    expect(member.id).toBe('crew-1');
    expect(member.name).toBe('Alice');
    expect(member.salary).toBe(500);
  });

  it('defaults status to ACTIVE', () => {
    expect(member.status).toBe(AstronautStatus.ACTIVE);
  });

  it('initialises all skills to 0', () => {
    expect(member.skills.piloting).toBe(0);
    expect(member.skills.engineering).toBe(0);
    expect(member.skills.science).toBe(0);
  });

  it('sets injuryEnds to null', () => {
    expect(member.injuryEnds).toBeNull();
  });

  it('stores a custom hireDate when provided', () => {
    const date = '2026-01-01T00:00:00.000Z';
    const m = createCrewMember({ ...opts, hireDate: date });
    expect(m.hireDate).toBe(date);
  });

  it('generates a default hireDate when not provided', () => {
    expect(typeof member.hireDate).toBe('string');
    expect(member.hireDate.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// createMission
// ---------------------------------------------------------------------------

describe('createMission()', () => {
  const baseOpts = {
    id: 'mission-1',
    title: 'First Orbit',
    description: 'Reach low Earth orbit.',
    reward: 5000,
    deadline: '2026-12-31T00:00:00.000Z',
  };
  let mission;
  beforeEach(() => { mission = createMission(baseOpts); });

  it('stores provided fields', () => {
    expect(mission.id).toBe('mission-1');
    expect(mission.title).toBe('First Orbit');
    expect(mission.reward).toBe(5000);
    expect(mission.deadline).toBe(baseOpts.deadline);
  });

  it('defaults state to AVAILABLE', () => {
    expect(mission.state).toBe(MissionState.AVAILABLE);
  });

  it('defaults acceptedDate and completedDate to null', () => {
    expect(mission.acceptedDate).toBeNull();
    expect(mission.completedDate).toBeNull();
  });

  it('defaults requirements to zero/empty when not provided', () => {
    expect(mission.requirements.minDeltaV).toBe(0);
    expect(mission.requirements.minCrewCount).toBe(0);
    expect(mission.requirements.requiredParts).toEqual([]);
  });

  it('accepts custom requirements', () => {
    const m = createMission({
      ...baseOpts,
      requirements: { minDeltaV: 7800, minCrewCount: 2, requiredParts: ['cmd-pod-mk1'] },
    });
    expect(m.requirements.minDeltaV).toBe(7800);
    expect(m.requirements.minCrewCount).toBe(2);
    expect(m.requirements.requiredParts).toContain('cmd-pod-mk1');
  });
});

// ---------------------------------------------------------------------------
// createRocketDesign
// ---------------------------------------------------------------------------

describe('createRocketDesign()', () => {
  let design;
  beforeEach(() => { design = createRocketDesign({ id: 'rocket-1', name: 'Sparrow I' }); });

  it('stores id and name', () => {
    expect(design.id).toBe('rocket-1');
    expect(design.name).toBe('Sparrow I');
  });

  it('defaults parts to empty array', () => {
    expect(design.parts).toEqual([]);
  });

  it('defaults totalMass and totalThrust to 0', () => {
    expect(design.totalMass).toBe(0);
    expect(design.totalThrust).toBe(0);
  });

  it('stores createdDate and updatedDate as ISO strings', () => {
    expect(typeof design.createdDate).toBe('string');
    expect(typeof design.updatedDate).toBe('string');
    // Simple check that it looks like an ISO date
    expect(design.createdDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// createFlightResult
// ---------------------------------------------------------------------------

describe('createFlightResult()', () => {
  const baseOpts = {
    id: 'flight-1',
    missionId: 'mission-1',
    rocketId: 'rocket-1',
    outcome: FlightOutcome.SUCCESS,
  };
  let result;
  beforeEach(() => { result = createFlightResult(baseOpts); });

  it('stores required fields', () => {
    expect(result.id).toBe('flight-1');
    expect(result.missionId).toBe('mission-1');
    expect(result.rocketId).toBe('rocket-1');
    expect(result.outcome).toBe(FlightOutcome.SUCCESS);
  });

  it('defaults crewIds to empty array', () => {
    expect(result.crewIds).toEqual([]);
  });

  it('defaults numeric fields to 0', () => {
    expect(result.deltaVUsed).toBe(0);
    expect(result.revenue).toBe(0);
  });

  it('defaults notes to empty string', () => {
    expect(result.notes).toBe('');
  });
});

// ---------------------------------------------------------------------------
// createFlightState
// ---------------------------------------------------------------------------

describe('createFlightState()', () => {
  let flight;
  beforeEach(() => {
    flight = createFlightState({
      missionId: 'mission-1',
      rocketId: 'rocket-1',
      fuelRemaining: 1200,
      deltaVRemaining: 9500,
    });
  });

  it('stores missionId and rocketId', () => {
    expect(flight.missionId).toBe('mission-1');
    expect(flight.rocketId).toBe('rocket-1');
  });

  it('initialises time and position to zero', () => {
    expect(flight.timeElapsed).toBe(0);
    expect(flight.altitude).toBe(0);
    expect(flight.velocity).toBe(0);
  });

  it('stores provided fuel and deltaV values', () => {
    expect(flight.fuelRemaining).toBe(1200);
    expect(flight.deltaVRemaining).toBe(9500);
  });

  it('initialises events to empty array', () => {
    expect(flight.events).toEqual([]);
  });

  it('initialises aborted to false', () => {
    expect(flight.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFlightActive
// ---------------------------------------------------------------------------

describe('isFlightActive()', () => {
  it('returns false when currentFlight is null', () => {
    const state = createGameState();
    expect(isFlightActive(state)).toBe(false);
  });

  it('returns true when currentFlight is set', () => {
    const state = createGameState();
    state.currentFlight = createFlightState({ missionId: 'm1', rocketId: 'r1' });
    expect(isFlightActive(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getIdleCrew
// ---------------------------------------------------------------------------

describe('getIdleCrew()', () => {
  it('returns empty array when no crew', () => {
    const state = createGameState();
    expect(getIdleCrew(state)).toEqual([]);
  });

  it('returns only ACTIVE members', () => {
    const state = createGameState();
    const alice = createCrewMember({ id: 'c1', name: 'Alice', salary: 500 });
    const bob = createCrewMember({ id: 'c2', name: 'Bob', salary: 500 });
    bob.status = AstronautStatus.FIRED;
    state.crew.push(alice, bob);
    const idle = getIdleCrew(state);
    expect(idle).toHaveLength(1);
    expect(idle[0].id).toBe('c1');
  });
});

// ---------------------------------------------------------------------------
// findCrewById
// ---------------------------------------------------------------------------

describe('findCrewById()', () => {
  it('returns null when not found', () => {
    const state = createGameState();
    expect(findCrewById(state, 'nobody')).toBeNull();
  });

  it('returns the correct crew member', () => {
    const state = createGameState();
    state.crew.push(createCrewMember({ id: 'c1', name: 'Alice', salary: 500 }));
    state.crew.push(createCrewMember({ id: 'c2', name: 'Bob', salary: 500 }));
    const found = findCrewById(state, 'c2');
    expect(found).not.toBeNull();
    expect(found.name).toBe('Bob');
  });
});

// ---------------------------------------------------------------------------
// findMissionById
// ---------------------------------------------------------------------------

describe('findMissionById()', () => {
  const mOpts = {
    id: 'm1',
    title: 'Test',
    description: 'desc',
    reward: 1000,
    deadline: '2026-12-31T00:00:00.000Z',
  };

  it('returns null when not found', () => {
    const state = createGameState();
    expect(findMissionById(state, 'x')).toBeNull();
  });

  it('finds a mission in the available bucket', () => {
    const state = createGameState();
    state.missions.available.push(createMission(mOpts));
    expect(findMissionById(state, 'm1')).not.toBeNull();
  });

  it('finds a mission in the accepted bucket', () => {
    const state = createGameState();
    const m = createMission(mOpts);
    m.state = MissionState.ACCEPTED;
    state.missions.accepted.push(m);
    expect(findMissionById(state, 'm1')).not.toBeNull();
  });

  it('finds a mission in the completed bucket', () => {
    const state = createGameState();
    const m = createMission(mOpts);
    m.state = MissionState.COMPLETED;
    state.missions.completed.push(m);
    expect(findMissionById(state, 'm1')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findRocketById
// ---------------------------------------------------------------------------

describe('findRocketById()', () => {
  it('returns null when not found', () => {
    const state = createGameState();
    expect(findRocketById(state, 'r99')).toBeNull();
  });

  it('returns the correct design', () => {
    const state = createGameState();
    state.rockets.push(createRocketDesign({ id: 'r1', name: 'Sparrow I' }));
    state.rockets.push(createRocketDesign({ id: 'r2', name: 'Condor II' }));
    expect(findRocketById(state, 'r2').name).toBe('Condor II');
  });
});

// ---------------------------------------------------------------------------
// Enum / constant integrity
// ---------------------------------------------------------------------------

describe('PartType enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(PartType)).toBe(true);
  });

  it('contains expected values', () => {
    expect(PartType.ENGINE).toBe('ENGINE');
    expect(PartType.FUEL_TANK).toBe('FUEL_TANK');
    expect(PartType.COMMAND_MODULE).toBe('COMMAND_MODULE');
    expect(PartType.PARACHUTE).toBe('PARACHUTE');
    expect(PartType.HEAT_SHIELD).toBe('HEAT_SHIELD');
    expect(PartType.LANDING_LEG).toBe('LANDING_LEG');
  });
});

describe('MissionState enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(MissionState)).toBe(true);
  });

  it('contains all lifecycle states', () => {
    expect(MissionState.AVAILABLE).toBe('AVAILABLE');
    expect(MissionState.ACCEPTED).toBe('ACCEPTED');
    expect(MissionState.COMPLETED).toBe('COMPLETED');
    expect(MissionState.FAILED).toBe('FAILED');
    expect(MissionState.EXPIRED).toBe('EXPIRED');
  });
});

describe('CrewStatus enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(CrewStatus)).toBe(true);
  });

  it('contains all status values', () => {
    expect(CrewStatus.IDLE).toBe('IDLE');
    expect(CrewStatus.ON_MISSION).toBe('ON_MISSION');
    expect(CrewStatus.TRAINING).toBe('TRAINING');
    expect(CrewStatus.INJURED).toBe('INJURED');
    expect(CrewStatus.DEAD).toBe('DEAD');
  });
});

describe('FlightOutcome enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(FlightOutcome)).toBe(true);
  });

  it('contains all outcome values', () => {
    expect(FlightOutcome.SUCCESS).toBe('SUCCESS');
    expect(FlightOutcome.PARTIAL_SUCCESS).toBe('PARTIAL_SUCCESS');
    expect(FlightOutcome.FAILURE).toBe('FAILURE');
    expect(FlightOutcome.CREW_LOST).toBe('CREW_LOST');
  });
});

describe('FuelType enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(FuelType)).toBe(true);
  });
});
