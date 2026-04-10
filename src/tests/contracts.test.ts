/**
 * contracts.test.js — Unit tests for the contract system.
 *
 * Tests cover:
 *   - Contract generation (generateContracts)
 *   - Board pool caps by Mission Control tier
 *   - Contract acceptance (acceptContract)
 *   - Active cap enforcement
 *   - Contract completion (completeContract)
 *   - Contract cancellation (cancelContract)
 *   - Board expiry (expireBoardContracts)
 *   - Active contract deadline expiry (expireActiveContracts)
 *   - Contract objective checking (checkContractObjectives)
 *   - Flight return integration (processContractCompletions)
 *   - Chain contract continuation
 *   - Reputation changes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState, FlightState, Contract, ObjectiveDef, FlightEvent, MissionInstance } from '../core/gameState.ts';
import {
  generateContracts,
  acceptContract,
  completeContract,
  cancelContract,
  expireBoardContracts,
  expireActiveContracts,
  checkContractObjectives,
  processContractCompletions,
  getContractCaps,
  getMissionControlTier,
  getActiveConflicts,
} from '../core/contracts.ts';
import {
  CONTRACT_TIER_CAPS,
  CONTRACTS_PER_FLIGHT_MIN,
  CONTRACTS_PER_FLIGHT_MAX,
  CONTRACT_BOARD_EXPIRY_FLIGHTS,
  CONTRACT_CANCEL_PENALTY_RATE,
  CONTRACT_REP_GAIN_BASE,
  CONTRACT_REP_LOSS_CANCEL,
  CONTRACT_REP_LOSS_FAIL,
  STARTING_REPUTATION,
  FacilityId,
  ContractCategory,
  STARTING_MONEY,
  CONTRACT_BONUS_REWARD_RATE,
  CONTRACT_CONFLICT_TAGS,
  PartType,
} from '../core/constants.ts';
import type { ContractCategory as ContractCategoryType } from '../core/constants.ts';
import { ObjectiveType } from '../data/missions.ts';

interface TestContract extends Contract {
  bonusObjectives: (ObjectiveDef & { bonus?: boolean })[];
  bonusReward: number;
  conflictTags: string[];
}

interface TestContractOverrides {
  id?: string;
  title?: string;
  description?: string;
  category?: ContractCategoryType;
  objectives?: ObjectiveDef[];
  bonusObjectives?: (ObjectiveDef & { bonus?: boolean })[];
  bonusReward?: number;
  reward?: number;
  penaltyFee?: number;
  reputationReward?: number;
  reputationPenalty?: number;
  deadlinePeriod?: number | null;
  boardExpiryPeriod?: number;
  generatedPeriod?: number;
  acceptedPeriod?: number | null;
  chainId?: string | null;
  chainPart?: number | null;
  chainTotal?: number | null;
  conflictTags?: string[];
}

interface TestFlightEvent {
  type: string;
  time?: number;
  description?: string;
  [key: string]: unknown;
}

interface TestFlightOverrides {
  altitude?: number;
  velocity?: number;
  timeElapsed?: number;
  events?: TestFlightEvent[];
  hasScienceModules?: boolean;
  scienceModuleRunning?: boolean;
  rocketCost?: number;
  partCount?: number;
  partTypes?: string[];
  crewCount?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  const state = createGameState();
  // Give the player some completed missions so contracts can generate.
  state.missions.completed = [
    { id: 'mission-001', title: 'M1', objectives: [{ type: ObjectiveType.REACH_SPEED, target: { speed: 150 }, completed: true }], reward: 25000 },
    { id: 'mission-004', title: 'M4', objectives: [{ type: ObjectiveType.REACH_HORIZONTAL_SPEED, target: { speed: 300 }, completed: true }], reward: 30000 },
  ] as unknown as MissionInstance[];
  return state;
}

function makeContract(overrides: TestContractOverrides = {}): TestContract {
  return {
    id: overrides.id ?? `contract-test-${Math.random().toString(36).slice(2)}`,
    title: overrides.title ?? 'Test Contract',
    description: overrides.description ?? 'A test contract.',
    category: overrides.category ?? ContractCategory.ALTITUDE_RECORD,
    objectives: overrides.objectives ?? [
      { id: 'obj-1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 500 }, completed: false, description: 'Reach 500 m' },
    ],
    bonusObjectives: overrides.bonusObjectives ?? [],
    bonusReward: overrides.bonusReward ?? 0,
    reward: overrides.reward ?? 50_000,
    penaltyFee: overrides.penaltyFee ?? 12_500,
    reputationReward: overrides.reputationReward ?? 6,
    reputationPenalty: overrides.reputationPenalty ?? CONTRACT_REP_LOSS_CANCEL,
    deadlinePeriod: overrides.deadlinePeriod ?? null,
    boardExpiryPeriod: overrides.boardExpiryPeriod ?? 5,
    generatedPeriod: overrides.generatedPeriod ?? 0,
    acceptedPeriod: overrides.acceptedPeriod ?? null,
    chainId: overrides.chainId ?? null,
    chainPart: overrides.chainPart ?? null,
    chainTotal: overrides.chainTotal ?? null,
    conflictTags: overrides.conflictTags ?? [],
  };
}

function makeFlightState(overrides: TestFlightOverrides = {}): FlightState {
  return {
    altitude: overrides.altitude ?? 0,
    velocity: overrides.velocity ?? 0,
    timeElapsed: overrides.timeElapsed ?? 0,
    events: (overrides.events ?? []) as FlightEvent[],
    hasScienceModules: overrides.hasScienceModules ?? false,
    scienceModuleRunning: overrides.scienceModuleRunning ?? false,
    rocketCost: overrides.rocketCost,
    partCount: overrides.partCount,
    partTypes: overrides.partTypes,
    crewCount: overrides.crewCount,
  } as FlightState;
}

// ---------------------------------------------------------------------------
// Mission Control tier
// ---------------------------------------------------------------------------

describe('getMissionControlTier()', () => {
  it('returns 1 for a fresh game (MC built at tier 1)', () => {
    const state = freshState();
    expect(getMissionControlTier(state)).toBe(1);
  });

  it('returns correct tier when MC is upgraded', () => {
    const state = freshState();
    state.facilities[FacilityId.MISSION_CONTROL] = { built: true, tier: 2 };
    expect(getMissionControlTier(state)).toBe(2);
  });

  it('returns 1 when MC is not built', () => {
    const state = freshState();
    delete state.facilities[FacilityId.MISSION_CONTROL];
    expect(getMissionControlTier(state)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Contract caps
// ---------------------------------------------------------------------------

describe('getContractCaps()', () => {
  it('returns tier 1 caps for a fresh game', () => {
    const state = freshState();
    const caps = getContractCaps(state);
    expect(caps.pool).toBe(CONTRACT_TIER_CAPS[1].pool);
    expect(caps.active).toBe(CONTRACT_TIER_CAPS[1].active);
  });

  it('returns tier 2 caps when MC is tier 2', () => {
    const state = freshState();
    state.facilities[FacilityId.MISSION_CONTROL] = { built: true, tier: 2 };
    const caps = getContractCaps(state);
    expect(caps.pool).toBe(CONTRACT_TIER_CAPS[2].pool);
    expect(caps.active).toBe(CONTRACT_TIER_CAPS[2].active);
  });

  it('returns tier 3 caps when MC is tier 3', () => {
    const state = freshState();
    state.facilities[FacilityId.MISSION_CONTROL] = { built: true, tier: 3 };
    const caps = getContractCaps(state);
    expect(caps.pool).toBe(CONTRACT_TIER_CAPS[3].pool);
    expect(caps.active).toBe(CONTRACT_TIER_CAPS[3].active);
  });
});

// ---------------------------------------------------------------------------
// Contract generation
// ---------------------------------------------------------------------------

describe('generateContracts()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('generates 2-3 contracts on a fresh board', () => {
    const result = generateContracts(state);
    expect(result.length).toBeGreaterThanOrEqual(CONTRACTS_PER_FLIGHT_MIN);
    expect(result.length).toBeLessThanOrEqual(CONTRACTS_PER_FLIGHT_MAX);
    expect(state.contracts.board.length).toBe(result.length);
  });

  it('does not exceed the board pool cap', () => {
    // Fill the board to pool cap - 1
    const caps = getContractCaps(state);
    for (let i = 0; i < caps.pool - 1; i++) {
      state.contracts.board.push(makeContract({ id: `c-${i}` }));
    }
    const result = generateContracts(state);
    // Should only add 1 contract (pool cap - existing = 1 slot)
    expect(result.length).toBe(1);
    expect(state.contracts.board.length).toBe(caps.pool);
  });

  it('generates nothing when board is full', () => {
    const caps = getContractCaps(state);
    for (let i = 0; i < caps.pool; i++) {
      state.contracts.board.push(makeContract({ id: `c-${i}` }));
    }
    const result = generateContracts(state);
    expect(result.length).toBe(0);
  });

  it('generates contracts with valid fields', () => {
    const result = generateContracts(state);
    for (const c of result) {
      expect(c.id).toMatch(/^contract-/);
      expect(typeof c.title).toBe('string');
      expect(typeof c.description).toBe('string');
      expect(typeof c.reward).toBe('number');
      expect(c.reward).toBeGreaterThan(0);
      expect(typeof c.penaltyFee).toBe('number');
      expect(c.penaltyFee).toBeGreaterThan(0);
      expect(Array.isArray(c.objectives)).toBe(true);
      expect(c.objectives.length).toBeGreaterThan(0);
      expect(c.boardExpiryPeriod).toBe(state.currentPeriod + CONTRACT_BOARD_EXPIRY_FLIGHTS);
    }
  });

  it('handles state without contracts field (legacy save)', () => {
    // @ts-expect-error intentionally deleting required field to test legacy save handling
    delete state.contracts;
    const result = generateContracts(state);
    expect(result.length).toBeGreaterThanOrEqual(CONTRACTS_PER_FLIGHT_MIN);
    expect(state.contracts.board.length).toBe(result.length);
  });
});

// ---------------------------------------------------------------------------
// Contract acceptance
// ---------------------------------------------------------------------------

describe('acceptContract()', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    state.contracts.board.push(makeContract({ id: 'c-1' }));
    state.contracts.board.push(makeContract({ id: 'c-2' }));
  });

  it('moves contract from board to active', () => {
    const result = acceptContract(state, 'c-1');
    expect(result.success).toBe(true);
    expect(result.contract!.id).toBe('c-1');
    expect(state.contracts.board.length).toBe(1);
    expect(state.contracts.active.length).toBe(1);
    expect(state.contracts.active[0].id).toBe('c-1');
  });

  it('sets acceptedPeriod on the contract', () => {
    state.currentPeriod = 3;
    acceptContract(state, 'c-1');
    expect(state.contracts.active[0].acceptedPeriod).toBe(3);
  });

  it('fails if contract not found', () => {
    const result = acceptContract(state, 'nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('fails if active cap is reached', () => {
    // Tier 1 active cap = 2
    state.contracts.active.push(makeContract({ id: 'a-1' }));
    state.contracts.active.push(makeContract({ id: 'a-2' }));
    const result = acceptContract(state, 'c-1');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/limit reached/);
  });
});

// ---------------------------------------------------------------------------
// Contract completion
// ---------------------------------------------------------------------------

describe('completeContract()', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    state.contracts.active.push(makeContract({ id: 'c-1', reward: 100_000 }));
    state.reputation = 50;
  });

  it('moves contract from active to completed and awards cash', () => {
    const cashBefore = state.money;
    const result = completeContract(state, 'c-1');
    expect(result.success).toBe(true);
    expect(result.reward).toBe(100_000);
    expect(state.money).toBe(cashBefore + 100_000);
    expect(state.contracts.active.length).toBe(0);
    expect(state.contracts.completed.length).toBe(1);
  });

  it('awards reputation', () => {
    completeContract(state, 'c-1');
    expect(state.reputation).toBeGreaterThan(50);
  });

  it('fails if contract not in active list', () => {
    const result = completeContract(state, 'nonexistent');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Chain contract completion
// ---------------------------------------------------------------------------

describe('completeContract() — chain contracts', () => {
  it('generates next chain part on completion', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'chain-1',
      chainId: 'chain-test',
      chainPart: 1,
      chainTotal: 3,
      reward: 30_000,
    }));

    const result = completeContract(state, 'chain-1');
    expect(result.success).toBe(true);
    expect(result.nextChainContract).toBeDefined();
    expect(result.nextChainContract!.chainPart).toBe(2);
    expect(result.nextChainContract!.chainTotal).toBe(3);
    expect(result.nextChainContract!.chainId).toBe('chain-test');
    // Next part should be on the board
    expect(state.contracts.board.some(c => c.chainId === 'chain-test' && c.chainPart === 2)).toBe(true);
  });

  it('does not generate chain continuation for the last part', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'chain-last',
      chainId: 'chain-test',
      chainPart: 3,
      chainTotal: 3,
      reward: 90_000,
    }));

    const result = completeContract(state, 'chain-last');
    expect(result.success).toBe(true);
    expect(result.nextChainContract).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Contract cancellation
// ---------------------------------------------------------------------------

describe('cancelContract()', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-cancel',
      reward: 100_000,
      penaltyFee: 25_000,
      reputationPenalty: CONTRACT_REP_LOSS_CANCEL,
    }));
    state.reputation = 50;
  });

  it('moves contract from active to failed', () => {
    cancelContract(state, 'c-cancel');
    expect(state.contracts.active.length).toBe(0);
    expect(state.contracts.failed.length).toBe(1);
  });

  it('applies penalty fee', () => {
    const cashBefore = state.money;
    const result = cancelContract(state, 'c-cancel');
    expect(result.penaltyFee).toBe(25_000);
    expect(state.money).toBe(cashBefore - 25_000);
  });

  it('penalty can drive cash negative', () => {
    state.money = 10_000;
    cancelContract(state, 'c-cancel');
    expect(state.money).toBe(10_000 - 25_000);
    expect(state.money).toBeLessThan(0);
  });

  it('reduces reputation', () => {
    cancelContract(state, 'c-cancel');
    expect(state.reputation).toBe(50 - CONTRACT_REP_LOSS_CANCEL);
  });

  it('fails if contract not found', () => {
    const result = cancelContract(state, 'nonexistent');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Board expiry
// ---------------------------------------------------------------------------

describe('expireBoardContracts()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('removes contracts past their board expiry period', () => {
    state.contracts.board.push(makeContract({ id: 'exp-1', boardExpiryPeriod: 2 }));
    state.contracts.board.push(makeContract({ id: 'alive', boardExpiryPeriod: 10 }));
    state.currentPeriod = 3;
    const expired = expireBoardContracts(state);
    expect(expired).toContain('exp-1');
    expect(expired).not.toContain('alive');
    expect(state.contracts.board.length).toBe(1);
    expect(state.contracts.board[0].id).toBe('alive');
  });

  it('does not remove contracts within expiry period', () => {
    state.contracts.board.push(makeContract({ id: 'alive', boardExpiryPeriod: 5 }));
    state.currentPeriod = 3;
    const expired = expireBoardContracts(state);
    expect(expired).toHaveLength(0);
    expect(state.contracts.board.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Active contract deadline expiry
// ---------------------------------------------------------------------------

describe('expireActiveContracts()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); state.reputation = 50; });

  it('expires active contracts past their deadline', () => {
    state.contracts.active.push(makeContract({ id: 'exp-1', deadlinePeriod: 2 }));
    state.contracts.active.push(makeContract({ id: 'alive', deadlinePeriod: 10 }));
    state.currentPeriod = 3;
    const expired = expireActiveContracts(state);
    expect(expired).toContain('exp-1');
    expect(expired).not.toContain('alive');
    expect(state.contracts.active.length).toBe(1);
    expect(state.contracts.failed.length).toBe(1);
  });

  it('does not expire open-ended contracts (null deadline)', () => {
    state.contracts.active.push(makeContract({ id: 'open', deadlinePeriod: null }));
    state.currentPeriod = 100;
    const expired = expireActiveContracts(state);
    expect(expired).toHaveLength(0);
    expect(state.contracts.active.length).toBe(1);
  });

  it('applies reputation penalty on expiry', () => {
    state.contracts.active.push(makeContract({ id: 'exp-1', deadlinePeriod: 1 }));
    state.currentPeriod = 2;
    expireActiveContracts(state);
    expect(state.reputation).toBe(50 - CONTRACT_REP_LOSS_FAIL);
  });
});

// ---------------------------------------------------------------------------
// Contract objective checking
// ---------------------------------------------------------------------------

describe('checkContractObjectives()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('completes REACH_ALTITUDE objective when altitude met', () => {
    state.contracts.active.push(makeContract({
      id: 'c-alt',
      objectives: [{
        id: 'obj-1', type: 'REACH_ALTITUDE',
        target: { altitude: 500 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ altitude: 500 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('does not complete REACH_ALTITUDE when altitude not met', () => {
    state.contracts.active.push(makeContract({
      id: 'c-alt',
      objectives: [{
        id: 'obj-1', type: 'REACH_ALTITUDE',
        target: { altitude: 500 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ altitude: 499 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });

  it('completes REACH_SPEED objective when speed met', () => {
    state.contracts.active.push(makeContract({
      id: 'c-spd',
      objectives: [{
        id: 'obj-1', type: 'REACH_SPEED',
        target: { speed: 200 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ velocity: 200 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('completes SAFE_LANDING objective on safe landing event', () => {
    state.contracts.active.push(makeContract({
      id: 'c-safe',
      objectives: [{
        id: 'obj-1', type: 'SAFE_LANDING',
        target: { maxLandingSpeed: 10 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({
      events: [{ type: 'LANDING', speed: 8, time: 100 }],
    }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('completes CONTROLLED_CRASH objective on fast impact', () => {
    state.contracts.active.push(makeContract({
      id: 'c-crash',
      objectives: [{
        id: 'obj-1', type: 'CONTROLLED_CRASH',
        target: { minCrashSpeed: 50 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({
      events: [{ type: 'CRASH', speed: 60, time: 50 }],
    }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('no-ops when flightState is null', () => {
    state.contracts.active.push(makeContract({ id: 'c-1' }));
    // @ts-expect-error intentionally passing null to test defensive guard
    expect(() => checkContractObjectives(state, null)).not.toThrow();
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });

  it('no-ops when no active contracts', () => {
    expect(() => checkContractObjectives(state, makeFlightState({ altitude: 1000 }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// processContractCompletions
// ---------------------------------------------------------------------------

describe('processContractCompletions()', () => {
  it('@smoke completes contracts with all objectives met', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-done',
      objectives: [{
        id: 'obj-1', type: 'REACH_ALTITUDE',
        target: { altitude: 500 }, completed: true, description: 'Test',
      }],
      reward: 50_000,
    }));

    const cashBefore = state.money;
    const result = processContractCompletions(state);
    expect(result.completedContracts.length).toBe(1);
    expect(result.completedContracts[0].reward).toBe(50_000);
    expect(state.money).toBe(cashBefore + 50_000);
    expect(state.contracts.active.length).toBe(0);
    expect(state.contracts.completed.length).toBe(1);
  });

  it('does not complete contracts with incomplete objectives', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-partial',
      objectives: [
        { id: 'obj-1', type: 'REACH_ALTITUDE', target: { altitude: 500 }, completed: true, description: 'T1' },
        { id: 'obj-2', type: 'REACH_SPEED', target: { speed: 200 }, completed: false, description: 'T2' },
      ],
      reward: 50_000,
    }));

    const result = processContractCompletions(state);
    expect(result.completedContracts.length).toBe(0);
    expect(state.contracts.active.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reputation bounds
// ---------------------------------------------------------------------------

describe('Reputation clamping', () => {
  it('reputation does not exceed 100', () => {
    const state = freshState();
    state.reputation = 98;
    state.contracts.active.push(makeContract({ id: 'c-1', reputationReward: 10 }));
    completeContract(state, 'c-1');
    expect(state.reputation).toBe(100);
  });

  it('reputation does not go below 0', () => {
    const state = freshState();
    state.reputation = 3;
    state.contracts.active.push(makeContract({
      id: 'c-1',
      penaltyFee: 0,
      reputationPenalty: 10,
    }));
    cancelContract(state, 'c-1');
    expect(state.reputation).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tier cap constants
// ---------------------------------------------------------------------------

describe('Contract tier cap constants', () => {
  it('Tier 1 = 4 pool / 2 active', () => {
    expect(CONTRACT_TIER_CAPS[1]).toEqual({ pool: 4, active: 2 });
  });

  it('Tier 2 = 8 pool / 5 active', () => {
    expect(CONTRACT_TIER_CAPS[2]).toEqual({ pool: 8, active: 5 });
  });

  it('Tier 3 = 12 pool / 8 active', () => {
    expect(CONTRACT_TIER_CAPS[3]).toEqual({ pool: 12, active: 8 });
  });
});

// ---------------------------------------------------------------------------
// GameState — contract fields in initial state
// ---------------------------------------------------------------------------

describe('GameState — contract fields', () => {
  it('createGameState() includes contracts object', () => {
    const state = createGameState();
    expect(state.contracts).toBeDefined();
    expect(Array.isArray(state.contracts.board)).toBe(true);
    expect(Array.isArray(state.contracts.active)).toBe(true);
    expect(Array.isArray(state.contracts.completed)).toBe(true);
    expect(Array.isArray(state.contracts.failed)).toBe(true);
    expect(state.contracts.board.length).toBe(0);
  });

  it('createGameState() includes reputation at starting value', () => {
    const state = createGameState();
    expect(state.reputation).toBe(STARTING_REPUTATION);
  });
});

// ---------------------------------------------------------------------------
// New objective types (TASK-009)
// ---------------------------------------------------------------------------

describe('checkContractObjectives() — BUDGET_LIMIT', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('completes when rocket cost is within budget', () => {
    state.contracts.active.push(makeContract({
      id: 'c-budget',
      objectives: [{
        id: 'obj-1', type: 'BUDGET_LIMIT',
        target: { maxCost: 50_000 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ rocketCost: 45_000 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('completes when rocket cost equals budget exactly', () => {
    state.contracts.active.push(makeContract({
      id: 'c-budget',
      objectives: [{
        id: 'obj-1', type: 'BUDGET_LIMIT',
        target: { maxCost: 50_000 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ rocketCost: 50_000 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when rocket cost exceeds budget', () => {
    state.contracts.active.push(makeContract({
      id: 'c-budget',
      objectives: [{
        id: 'obj-1', type: 'BUDGET_LIMIT',
        target: { maxCost: 50_000 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ rocketCost: 50_001 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when rocketCost is missing from flightState', () => {
    state.contracts.active.push(makeContract({
      id: 'c-budget',
      objectives: [{
        id: 'obj-1', type: 'BUDGET_LIMIT',
        target: { maxCost: 50_000 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({}));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });
});

describe('checkContractObjectives() — MAX_PARTS', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('completes when part count is within limit', () => {
    state.contracts.active.push(makeContract({
      id: 'c-parts',
      objectives: [{
        id: 'obj-1', type: 'MAX_PARTS',
        target: { maxParts: 4 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ partCount: 3 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('completes when part count equals limit exactly', () => {
    state.contracts.active.push(makeContract({
      id: 'c-parts',
      objectives: [{
        id: 'obj-1', type: 'MAX_PARTS',
        target: { maxParts: 4 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ partCount: 4 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when part count exceeds limit', () => {
    state.contracts.active.push(makeContract({
      id: 'c-parts',
      objectives: [{
        id: 'obj-1', type: 'MAX_PARTS',
        target: { maxParts: 4 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ partCount: 5 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });
});

describe('checkContractObjectives() — RESTRICT_PART', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('completes when forbidden part type is absent', () => {
    state.contracts.active.push(makeContract({
      id: 'c-restrict',
      objectives: [{
        id: 'obj-1', type: 'RESTRICT_PART',
        target: { forbiddenType: PartType.PARACHUTE }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({
      partTypes: [PartType.ENGINE, PartType.FUEL_TANK, PartType.COMMAND_MODULE],
    }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when forbidden part type is present', () => {
    state.contracts.active.push(makeContract({
      id: 'c-restrict',
      objectives: [{
        id: 'obj-1', type: 'RESTRICT_PART',
        target: { forbiddenType: PartType.PARACHUTE }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({
      partTypes: [PartType.ENGINE, PartType.PARACHUTE],
    }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when partTypes is missing', () => {
    state.contracts.active.push(makeContract({
      id: 'c-restrict',
      objectives: [{
        id: 'obj-1', type: 'RESTRICT_PART',
        target: { forbiddenType: PartType.PARACHUTE }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({}));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });
});

describe('checkContractObjectives() — MULTI_SATELLITE', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('completes when enough satellites are released at altitude', () => {
    state.contracts.active.push(makeContract({
      id: 'c-msat',
      objectives: [{
        id: 'obj-1', type: 'MULTI_SATELLITE',
        target: { count: 2, minAltitude: 5_000 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({
      events: [
        { type: 'SATELLITE_RELEASED', altitude: 6_000 },
        { type: 'SATELLITE_RELEASED', altitude: 5_500 },
      ],
    }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when not enough satellites released', () => {
    state.contracts.active.push(makeContract({
      id: 'c-msat',
      objectives: [{
        id: 'obj-1', type: 'MULTI_SATELLITE',
        target: { count: 3, minAltitude: 5_000 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({
      events: [
        { type: 'SATELLITE_RELEASED', altitude: 6_000 },
        { type: 'SATELLITE_RELEASED', altitude: 5_500 },
      ],
    }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });

  it('ignores satellites released below minimum altitude', () => {
    state.contracts.active.push(makeContract({
      id: 'c-msat',
      objectives: [{
        id: 'obj-1', type: 'MULTI_SATELLITE',
        target: { count: 2, minAltitude: 5_000 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({
      events: [
        { type: 'SATELLITE_RELEASED', altitude: 6_000 },
        { type: 'SATELLITE_RELEASED', altitude: 4_000 }, // too low
      ],
    }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });
});

describe('checkContractObjectives() — MINIMUM_CREW', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('completes when crew count meets minimum', () => {
    state.contracts.active.push(makeContract({
      id: 'c-crew',
      objectives: [{
        id: 'obj-1', type: 'MINIMUM_CREW',
        target: { minCrew: 2 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ crewCount: 2 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('completes when crew count exceeds minimum', () => {
    state.contracts.active.push(makeContract({
      id: 'c-crew',
      objectives: [{
        id: 'obj-1', type: 'MINIMUM_CREW',
        target: { minCrew: 1 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ crewCount: 3 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when crew count is below minimum', () => {
    state.contracts.active.push(makeContract({
      id: 'c-crew',
      objectives: [{
        id: 'obj-1', type: 'MINIMUM_CREW',
        target: { minCrew: 2 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({ crewCount: 1 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when crewCount is missing', () => {
    state.contracts.active.push(makeContract({
      id: 'c-crew',
      objectives: [{
        id: 'obj-1', type: 'MINIMUM_CREW',
        target: { minCrew: 1 }, completed: false, description: 'Test',
      }],
    }));

    checkContractObjectives(state, makeFlightState({}));
    expect(state.contracts.active[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bonus objectives (TASK-009)
// ---------------------------------------------------------------------------

describe('Bonus objectives', () => {
  it('checkContractObjectives() checks bonus objectives', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-bonus',
      objectives: [{
        id: 'obj-1', type: 'REACH_ALTITUDE',
        target: { altitude: 500 }, completed: false, description: 'Main',
      }],
      bonusObjectives: [{
        id: 'obj-bonus-1', type: 'REACH_ALTITUDE',
        target: { altitude: 1000 }, completed: false, description: 'Bonus',
        bonus: true,
      }],
      bonusReward: 25_000,
    }));

    checkContractObjectives(state, makeFlightState({ altitude: 1200 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
    expect((state.contracts.active[0] as TestContract).bonusObjectives[0].completed).toBe(true);
  });

  it('bonus objectives can remain incomplete while main objectives complete', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-bonus',
      objectives: [{
        id: 'obj-1', type: 'REACH_ALTITUDE',
        target: { altitude: 500 }, completed: false, description: 'Main',
      }],
      bonusObjectives: [{
        id: 'obj-bonus-1', type: 'REACH_ALTITUDE',
        target: { altitude: 1000 }, completed: false, description: 'Bonus',
        bonus: true,
      }],
      bonusReward: 25_000,
    }));

    checkContractObjectives(state, makeFlightState({ altitude: 700 }));
    expect(state.contracts.active[0].objectives[0].completed).toBe(true);
    expect((state.contracts.active[0] as TestContract).bonusObjectives[0].completed).toBe(false);
  });

  it('completeContract() awards bonus reward when all bonus objectives met', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-bonus',
      reward: 100_000,
      bonusObjectives: [{
        id: 'obj-bonus-1', type: 'REACH_ALTITUDE',
        target: { altitude: 1000 }, completed: true, description: 'Bonus',
        bonus: true,
      }],
      bonusReward: 50_000,
    }));

    const cashBefore = state.money;
    const result = completeContract(state, 'c-bonus');
    expect(result.success).toBe(true);
    expect(result.bonusAwarded).toBe(50_000);
    expect(state.money).toBe(cashBefore + 100_000 + 50_000);
  });

  it('completeContract() does not award bonus when bonus objectives incomplete', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-bonus',
      reward: 100_000,
      bonusObjectives: [{
        id: 'obj-bonus-1', type: 'REACH_ALTITUDE',
        target: { altitude: 1000 }, completed: false, description: 'Bonus',
        bonus: true,
      }],
      bonusReward: 50_000,
    }));

    const cashBefore = state.money;
    const result = completeContract(state, 'c-bonus');
    expect(result.success).toBe(true);
    expect(result.bonusAwarded).toBe(0);
    expect(state.money).toBe(cashBefore + 100_000);
  });

  it('completeContract() uses default bonus rate when bonusReward is 0', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-bonus-default',
      reward: 100_000,
      bonusObjectives: [{
        id: 'obj-bonus-1', type: 'REACH_ALTITUDE',
        target: { altitude: 1000 }, completed: true, description: 'Bonus',
        bonus: true,
      }],
      bonusReward: 0,
    }));

    const cashBefore = state.money;
    const result = completeContract(state, 'c-bonus-default');
    expect(result.success).toBe(true);
    // When bonusReward is 0 (falsy), uses default rate
    const expectedBonus = Math.round(100_000 * CONTRACT_BONUS_REWARD_RATE);
    expect(result.bonusAwarded).toBe(expectedBonus);
    expect(state.money).toBe(cashBefore + 100_000 + expectedBonus);
  });

  it('completeContract() awards 0 bonus when no bonus objectives exist', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-no-bonus',
      reward: 100_000,
    }));

    const cashBefore = state.money;
    const result = completeContract(state, 'c-no-bonus');
    expect(result.success).toBe(true);
    expect(result.bonusAwarded).toBe(0);
    expect(state.money).toBe(cashBefore + 100_000);
  });
});

// ---------------------------------------------------------------------------
// Conflict detection (TASK-009)
// ---------------------------------------------------------------------------

describe('getActiveConflicts()', () => {
  it('detects conflicts between contracts with shared tags', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-crash',
      conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
    }));
    state.contracts.active.push(makeContract({
      id: 'c-safe',
      conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
    }));

    const conflicts = getActiveConflicts(state);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].contractA).toBe('c-crash');
    expect(conflicts[0].contractB).toBe('c-safe');
    expect(conflicts[0].tag).toBe(CONTRACT_CONFLICT_TAGS.DESTRUCTIVE);
  });

  it('returns empty array when no conflicts exist', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-1',
      conflictTags: [CONTRACT_CONFLICT_TAGS.BUDGET],
    }));
    state.contracts.active.push(makeContract({
      id: 'c-2',
      conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
    }));

    const conflicts = getActiveConflicts(state);
    expect(conflicts.length).toBe(0);
  });

  it('returns empty array when contracts have no tags', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({ id: 'c-1' }));
    state.contracts.active.push(makeContract({ id: 'c-2' }));

    const conflicts = getActiveConflicts(state);
    expect(conflicts.length).toBe(0);
  });

  it('detects multiple conflicts from multiple shared tags', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-1',
      conflictTags: [CONTRACT_CONFLICT_TAGS.BUDGET, CONTRACT_CONFLICT_TAGS.MINIMALIST],
    }));
    state.contracts.active.push(makeContract({
      id: 'c-2',
      conflictTags: [CONTRACT_CONFLICT_TAGS.BUDGET, CONTRACT_CONFLICT_TAGS.MINIMALIST],
    }));

    const conflicts = getActiveConflicts(state);
    expect(conflicts.length).toBe(2);
  });

  it('handles three-way conflicts correctly', () => {
    const state = freshState();
    state.contracts.active.push(makeContract({
      id: 'c-1', conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
    }));
    state.contracts.active.push(makeContract({
      id: 'c-2', conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
    }));
    state.contracts.active.push(makeContract({
      id: 'c-3', conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
    }));

    const conflicts = getActiveConflicts(state);
    // 3 pairs: (1,2), (1,3), (2,3)
    expect(conflicts.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Contract structure fields (TASK-009)
// ---------------------------------------------------------------------------

describe('Contract structure — new fields', () => {
  it('generated contracts include bonusObjectives array', () => {
    const state = freshState();
    const result = generateContracts(state);
    for (const c of result) {
      expect(Array.isArray(c.bonusObjectives)).toBe(true);
    }
  });

  it('generated contracts include conflictTags array', () => {
    const state = freshState();
    const result = generateContracts(state);
    for (const c of result) {
      expect(Array.isArray(c.conflictTags)).toBe(true);
    }
  });

  it('generated contracts include bonusReward field', () => {
    const state = freshState();
    const result = generateContracts(state);
    for (const c of result) {
      expect(typeof c.bonusReward).toBe('number');
    }
  });
});
