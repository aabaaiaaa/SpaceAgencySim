/**
 * contracts.ts — Contract system: generation, acceptance, completion,
 * cancellation, and expiry.
 *
 * Procedurally generated contracts supplement the static tutorial missions.
 * After each flight return, 2-3 new contracts are generated and placed on
 * the board.  The player can accept contracts (up to the active cap) and
 * complete them by meeting objectives during flights.
 *
 * Board pool and active caps are governed by Mission Control facility tier:
 *   Tier 1: 4 pool / 2 active
 *   Tier 2: 8 pool / 5 active
 *   Tier 3: 12 pool / 8 active
 */

import {
  FacilityId, CONTRACT_TIER_CAPS, CONTRACTS_PER_FLIGHT_MIN, CONTRACTS_PER_FLIGHT_MAX,
  CONTRACT_BOARD_EXPIRY_FLIGHTS, CONTRACT_CANCEL_PENALTY_RATE, CONTRACT_REP_GAIN_MIN,
  CONTRACT_REP_GAIN_MAX, CONTRACT_REP_LOSS_CANCEL, CONTRACT_REP_LOSS_FAIL, CONTRACT_BONUS_REWARD_RATE,
} from './constants.ts';
import type { ContractCategory } from './constants.ts';
import { earnReward } from './finance.ts';
import { CONTRACT_TEMPLATES, generateChainContinuation, getProgressionTier } from '../data/contracts.ts';
import type { GameState, FlightState, Contract, ObjectiveDef } from './gameState.ts';

/** All possible objective target fields across objective types. */
interface ObjectiveTarget {
  altitude?: number;
  speed?: number;
  maxLandingSpeed?: number;
  partType?: string;
  minAltitude?: number;
  maxAltitude?: number;
  duration?: number;
  minCrashSpeed?: number;
  orbitAltitude?: number;
  orbitalVelocity?: number;
  maxCost?: number;
  maxParts?: number;
  forbiddenType?: string;
  minVelocity?: number;
  count?: number;
  minCrew?: number;
}

/** Objective with runtime-only hold tracking property. */
interface ObjectiveWithHold extends ObjectiveDef {
  _holdEnteredAt?: number | null;
}

interface ExtendedContract extends Contract {
  bonusObjectives?: (ObjectiveDef & { bonus?: boolean })[];
  bonusReward?: number;
  conflictTags?: string[];
}
interface ContractCaps { pool: number; active: number; }
interface AcceptResult { success: boolean; contract?: ExtendedContract; error?: string; }
interface CompleteResult { success: boolean; contract?: ExtendedContract; reward?: number; bonusAwarded?: number; nextChainContract?: ExtendedContract | null; error?: string; }
interface CancelResult { success: boolean; contract?: ExtendedContract; penaltyFee?: number; error?: string; }
interface ContractConflict { contractA: string; contractB: string; tag: string; }
interface CompletionEntry { contract: ExtendedContract | undefined; reward: number | undefined; nextChainContract?: ExtendedContract | null; }
interface ProcessCompletionsResult { completedContracts: CompletionEntry[]; }

/** Shape returned by contract template generate() functions. */
interface ContractGenerationData {
  title: string;
  description: string;
  category: string;
  objectives: ObjectiveDef[];
  bonusObjectives?: (ObjectiveDef & { bonus?: boolean })[];
  bonusReward?: number;
  reward: number;
  deadlineFlights?: number | null;
  chainId?: string | null;
  chainPart?: number | null;
  chainTotal?: number | null;
  conflictTags?: string[];
}

function _generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `contract-${crypto.randomUUID()}`;
  return `contract-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getMissionControlTier(state: GameState): number {
  const mc = state.facilities?.[FacilityId.MISSION_CONTROL];
  if (!mc || !mc.built) return 1;
  return mc.tier || 1;
}

export function getContractCaps(state: GameState): ContractCaps {
  const tier = getMissionControlTier(state);
  return CONTRACT_TIER_CAPS[tier] ?? CONTRACT_TIER_CAPS[1];
}

function _clampRep(rep: number): number { return Math.max(0, Math.min(100, rep)); }

function _buildContract(data: ContractGenerationData, state: GameState): ExtendedContract {
  return {
    id: _generateId(), title: data.title, description: data.description, category: data.category as ContractCategory,
    objectives: data.objectives, bonusObjectives: data.bonusObjectives ?? [], bonusReward: data.bonusReward ?? 0,
    reward: data.reward, penaltyFee: Math.round(data.reward * CONTRACT_CANCEL_PENALTY_RATE),
    reputationReward: CONTRACT_REP_GAIN_MIN + Math.floor(Math.random() * (CONTRACT_REP_GAIN_MAX - CONTRACT_REP_GAIN_MIN + 1)),
    reputationPenalty: CONTRACT_REP_LOSS_CANCEL,
    deadlinePeriod: data.deadlineFlights != null ? state.currentPeriod + data.deadlineFlights : null,
    boardExpiryPeriod: state.currentPeriod + CONTRACT_BOARD_EXPIRY_FLIGHTS,
    generatedPeriod: state.currentPeriod, acceptedPeriod: null,
    chainId: data.chainId ?? null, chainPart: data.chainPart ?? null, chainTotal: data.chainTotal ?? null,
    conflictTags: data.conflictTags ?? [],
  };
}

export function generateContracts(state: GameState): ExtendedContract[] {
  _ensureContracts(state);
  const caps = getContractCaps(state);
  const slotsAvailable = caps.pool - state.contracts.board.length;
  if (slotsAvailable <= 0) return [];
  const count = Math.min(slotsAvailable, CONTRACTS_PER_FLIGHT_MIN + Math.floor(Math.random() * (CONTRACTS_PER_FLIGHT_MAX - CONTRACTS_PER_FLIGHT_MIN + 1)));
  const tier = getProgressionTier(state);
  const mccTier = getMissionControlTier(state);
  const eligible = CONTRACT_TEMPLATES.filter((t) => tier >= t.minTier && (!t.maxTier || tier <= t.maxTier) && (t.minMccTier ?? 1) <= mccTier && t.canGenerate(state, tier));
  if (eligible.length === 0) return [];
  const usedTemplateIds = new Set<string>();
  const generated: ExtendedContract[] = [];
  for (let i = 0; i < count; i++) {
    let pool = eligible.filter((t) => !usedTemplateIds.has(t.id));
    if (pool.length === 0) pool = eligible;
    const template = pool[Math.floor(Math.random() * pool.length)];
    const data = template.generate(state, Math.random());
    const contract = _buildContract(data, state);
    state.contracts.board.push(contract);
    generated.push(contract);
    usedTemplateIds.add(template.id);
  }
  return generated;
}

export function expireBoardContracts(state: GameState): string[] {
  _ensureContracts(state);
  const expired: string[] = [];
  state.contracts.board = state.contracts.board.filter((c) => {
    if (state.currentPeriod > c.boardExpiryPeriod) { expired.push(c.id); return false; }
    return true;
  });
  return expired;
}

export function acceptContract(state: GameState, contractId: string): AcceptResult {
  _ensureContracts(state);
  const caps = getContractCaps(state);
  if (state.contracts.active.length >= caps.active) return { success: false, error: `Active contract limit reached (${caps.active}).` };
  const idx = state.contracts.board.findIndex((c) => c.id === contractId);
  if (idx === -1) return { success: false, error: 'Contract not found on the board.' };
  const [contract] = state.contracts.board.splice(idx, 1);
  contract.acceptedPeriod = state.currentPeriod;
  state.contracts.active.push(contract);
  return { success: true, contract: contract as ExtendedContract };

}

export function completeContract(state: GameState, contractId: string): CompleteResult {
  _ensureContracts(state);
  const idx = state.contracts.active.findIndex((c) => c.id === contractId);
  if (idx === -1) return { success: false, error: 'Contract not found in active list.' };
  const [contract] = state.contracts.active.splice(idx, 1) as ExtendedContract[];
  state.contracts.completed.push(contract as Contract);
  earnReward(state, contract.reward);
  let bonusAwarded = 0;
  if (Array.isArray(contract.bonusObjectives) && contract.bonusObjectives.length > 0 && contract.bonusObjectives.every((o) => o.completed)) {
    bonusAwarded = contract.bonusReward || Math.round(contract.reward * CONTRACT_BONUS_REWARD_RATE);
    earnReward(state, bonusAwarded);
  }
  state.reputation = _clampRep((state.reputation ?? 50) + contract.reputationReward);
  let nextChainContract: ExtendedContract | null = null;
  if (contract.chainId && contract.chainPart && contract.chainTotal && contract.chainPart < contract.chainTotal) {
    const data = generateChainContinuation(contract.chainId, contract.chainPart + 1, Math.random());
    nextChainContract = _buildContract(data, state);
    state.contracts.board.push(nextChainContract as Contract);
  }
  return { success: true, contract, reward: contract.reward, bonusAwarded, nextChainContract };
}

export function cancelContract(state: GameState, contractId: string): CancelResult {
  _ensureContracts(state);
  const idx = state.contracts.active.findIndex((c) => c.id === contractId);
  if (idx === -1) return { success: false, error: 'Contract not found in active list.' };
  const [contract] = state.contracts.active.splice(idx, 1);
  const penalty = contract.penaltyFee;
  state.money -= penalty;
  state.reputation = _clampRep((state.reputation ?? 50) - contract.reputationPenalty);
  state.contracts.failed.push(contract);
  return { success: true, contract: contract as ExtendedContract, penaltyFee: penalty };
}

export function expireActiveContracts(state: GameState): string[] {
  _ensureContracts(state);
  const expired: string[] = [];
  const remaining: Contract[] = [];
  for (const contract of state.contracts.active) {
    if (contract.deadlinePeriod != null && state.currentPeriod > contract.deadlinePeriod) {
      state.reputation = _clampRep((state.reputation ?? 50) - CONTRACT_REP_LOSS_FAIL);
      state.contracts.failed.push(contract); expired.push(contract.id);
    } else { remaining.push(contract); }
  }
  state.contracts.active = remaining;
  return expired;
}

export function checkContractObjectives(state: GameState, flightState: FlightState): void {
  if (!flightState) return;
  _ensureContracts(state);
  const active = state.contracts.active;
  if (!active || active.length === 0) return;
  for (const contract of active) {
    if (!contract.objectives || contract.objectives.length === 0) continue;
    for (const obj of contract.objectives) { if (!obj.completed) _checkSingleObjective(obj, flightState); }
    const ext = contract as ExtendedContract;
    if (Array.isArray(ext.bonusObjectives)) {
      for (const obj of ext.bonusObjectives) { if (!obj.completed) _checkSingleObjective(obj, flightState); }
    }
  }
}

function _checkSingleObjective(obj: ObjectiveDef, flightState: FlightState): void {
  const target = obj.target as ObjectiveTarget;
  const objHold = obj as ObjectiveWithHold;
  switch (obj.type) {
    case 'REACH_ALTITUDE': if (target.altitude != null && flightState.altitude >= target.altitude) obj.completed = true; break;
    case 'REACH_SPEED': if (target.speed != null && flightState.velocity >= target.speed) obj.completed = true; break;
    case 'SAFE_LANDING': { if (flightState.events.find((e) => e.type === 'LANDING' && typeof e.speed === 'number' && (e.speed as number) <= (target.maxLandingSpeed ?? Infinity))) obj.completed = true; break; }
    case 'ACTIVATE_PART': { if (flightState.events.find((e) => e.type === 'PART_ACTIVATED' && e.partType === target.partType)) obj.completed = true; break; }
    case 'HOLD_ALTITUDE': {
      const inRange = target.minAltitude != null && target.maxAltitude != null && flightState.altitude >= target.minAltitude && flightState.altitude <= target.maxAltitude;
      const experimentOk = !flightState.hasScienceModules || flightState.scienceModuleRunning === true || flightState.events.some((e) => e.type === 'SCIENCE_COLLECTED');
      if (inRange && experimentOk) { if (objHold._holdEnteredAt == null) objHold._holdEnteredAt = flightState.timeElapsed; else if (target.duration != null && flightState.timeElapsed - objHold._holdEnteredAt >= target.duration) obj.completed = true; } else { objHold._holdEnteredAt = null; }
      break;
    }
    case 'RETURN_SCIENCE_DATA': { if (flightState.events.some((e) => e.type === 'SCIENCE_COLLECTED') && flightState.events.some((e) => e.type === 'LANDING' && typeof e.speed === 'number' && (e.speed as number) <= 10)) obj.completed = true; break; }
    case 'CONTROLLED_CRASH': { if (flightState.events.find((e) => (e.type === 'LANDING' || e.type === 'CRASH') && typeof e.speed === 'number' && (e.speed as number) >= (target.minCrashSpeed ?? 0))) obj.completed = true; break; }
    case 'EJECT_CREW': { if (flightState.events.find((e) => e.type === 'CREW_EJECTED' && typeof e.altitude === 'number' && (e.altitude as number) >= (target.minAltitude ?? 0))) obj.completed = true; break; }
    case 'RELEASE_SATELLITE': { if (flightState.events.find((e) => e.type === 'SATELLITE_RELEASED' && typeof e.altitude === 'number' && (e.altitude as number) >= (target.minAltitude ?? 0) && (target.minVelocity == null || (typeof e.velocity === 'number' && (e.velocity as number) >= target.minVelocity)))) obj.completed = true; break; }
    case 'REACH_ORBIT': if (target.orbitAltitude != null && target.orbitalVelocity != null && flightState.altitude >= target.orbitAltitude && flightState.velocity >= target.orbitalVelocity) obj.completed = true; break;
    case 'BUDGET_LIMIT': if (typeof flightState.rocketCost === 'number' && target.maxCost != null && flightState.rocketCost <= target.maxCost) obj.completed = true; break;
    case 'MAX_PARTS': if (typeof flightState.partCount === 'number' && target.maxParts != null && flightState.partCount <= target.maxParts) obj.completed = true; break;
    case 'RESTRICT_PART': if (Array.isArray(flightState.partTypes) && target.forbiddenType != null && !flightState.partTypes.includes(target.forbiddenType)) obj.completed = true; break;
    case 'MULTI_SATELLITE': { if (target.count != null && flightState.events.filter((e) => e.type === 'SATELLITE_RELEASED' && typeof e.altitude === 'number' && (e.altitude as number) >= (target.minAltitude ?? 0)).length >= target.count) obj.completed = true; break; }
    case 'MINIMUM_CREW': if (typeof flightState.crewCount === 'number' && target.minCrew != null && flightState.crewCount >= target.minCrew) obj.completed = true; break;
    default: break;
  }
}

export function processContractCompletions(state: GameState): ProcessCompletionsResult {
  _ensureContracts(state);
  const completedContracts: CompletionEntry[] = [];
  for (const contract of [...state.contracts.active]) {
    if (Array.isArray(contract.objectives) && contract.objectives.length > 0 && contract.objectives.every((o) => o.completed)) {
      const result = completeContract(state, contract.id);
      if (result.success) completedContracts.push({ contract: result.contract, reward: result.reward, nextChainContract: result.nextChainContract });
    }
  }
  return { completedContracts };
}

export function getActiveConflicts(state: GameState): ContractConflict[] {
  _ensureContracts(state);
  const active = state.contracts.active as ExtendedContract[];
  const conflicts: ContractConflict[] = [];
  for (let i = 0; i < active.length; i++) {
    const tagsA = active[i].conflictTags;
    if (!Array.isArray(tagsA) || tagsA.length === 0) continue;
    for (let j = i + 1; j < active.length; j++) {
      const tagsB = active[j].conflictTags;
      if (!Array.isArray(tagsB) || tagsB.length === 0) continue;
      for (const tag of tagsA) { if (tagsB.includes(tag)) conflicts.push({ contractA: active[i].id, contractB: active[j].id, tag }); }
    }
  }
  return conflicts;
}

function _ensureContracts(state: GameState): void {
  if (!state.contracts) state.contracts = { board: [], active: [], completed: [], failed: [] };
  if (!Array.isArray(state.contracts.board)) state.contracts.board = [];
  if (!Array.isArray(state.contracts.active)) state.contracts.active = [];
  if (!Array.isArray(state.contracts.completed)) state.contracts.completed = [];
  if (!Array.isArray(state.contracts.failed)) state.contracts.failed = [];
  if (typeof state.reputation !== 'number') state.reputation = 50;
}
