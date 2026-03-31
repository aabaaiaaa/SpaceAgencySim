/**
 * contracts.js — Contract system: generation, acceptance, completion,
 * cancellation, and expiry.
 *
 * Procedurally generated contracts supplement the static tutorial missions.
 * After each flight return, 2–3 new contracts are generated and placed on
 * the board.  The player can accept contracts (up to the active cap) and
 * complete them by meeting objectives during flights.
 *
 * Board pool and active caps are governed by Mission Control facility tier:
 *   Tier 1: 4 pool / 2 active
 *   Tier 2: 8 pool / 5 active
 *   Tier 3: 12 pool / 8 active
 *
 * @module core/contracts
 */

import {
  FacilityId,
  CONTRACT_TIER_CAPS,
  CONTRACTS_PER_FLIGHT_MIN,
  CONTRACTS_PER_FLIGHT_MAX,
  CONTRACT_BOARD_EXPIRY_FLIGHTS,
  CONTRACT_CANCEL_PENALTY_RATE,
  CONTRACT_REP_GAIN_MIN,
  CONTRACT_REP_GAIN_MAX,
  CONTRACT_REP_LOSS_CANCEL,
  CONTRACT_REP_LOSS_FAIL,
  CONTRACT_BONUS_REWARD_RATE,
} from './constants.js';
import { earnReward } from './finance.js';
import { CONTRACT_TEMPLATES, generateChainContinuation, getProgressionTier } from '../data/contracts.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique contract ID.
 * @returns {string}
 */
function _generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `contract-${crypto.randomUUID()}`;
  }
  return `contract-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Get the Mission Control tier (defaults to 1 if not built or missing).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}
 */
export function getMissionControlTier(state) {
  const mc = state.facilities?.[FacilityId.MISSION_CONTROL];
  if (!mc || !mc.built) return 1;
  return mc.tier || 1;
}

/**
 * Get the board pool cap and active cap for the current MC tier.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ pool: number, active: number }}
 */
export function getContractCaps(state) {
  const tier = getMissionControlTier(state);
  return CONTRACT_TIER_CAPS[tier] ?? CONTRACT_TIER_CAPS[1];
}

/**
 * Clamp reputation to [0, 100].
 * @param {number} rep
 * @returns {number}
 */
function _clampRep(rep) {
  return Math.max(0, Math.min(100, rep));
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate new contracts and add them to the board after a flight return.
 *
 * - Generates 2–3 new contracts (random).
 * - Only generates up to the board pool cap (excess contracts are not created).
 * - Templates are filtered by the player's progression tier.
 * - Duplicate template IDs on the board are avoided where possible.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('./gameState.js').Contract[]} Newly generated contracts.
 */
export function generateContracts(state) {
  _ensureContracts(state);

  const caps = getContractCaps(state);
  const currentBoardSize = state.contracts.board.length;
  const slotsAvailable = caps.pool - currentBoardSize;
  if (slotsAvailable <= 0) return [];

  const count = Math.min(
    slotsAvailable,
    CONTRACTS_PER_FLIGHT_MIN + Math.floor(Math.random() * (CONTRACTS_PER_FLIGHT_MAX - CONTRACTS_PER_FLIGHT_MIN + 1)),
  );

  const tier = getProgressionTier(state);
  const mccTier = getMissionControlTier(state);
  const eligible = CONTRACT_TEMPLATES.filter(
    (t) => tier >= t.minTier &&
           (!t.maxTier || tier <= t.maxTier) &&
           (t.minMccTier ?? 1) <= mccTier &&
           t.canGenerate(state, tier),
  );

  if (eligible.length === 0) return [];

  // Track which template IDs are already on the board to reduce duplicates.
  const usedTemplateIds = new Set();
  const generated = [];

  for (let i = 0; i < count; i++) {
    // Prefer templates not yet on the board.
    let pool = eligible.filter((t) => !usedTemplateIds.has(t.id));
    if (pool.length === 0) pool = eligible;

    const template = pool[Math.floor(Math.random() * pool.length)];
    const rand = Math.random();
    const data = template.generate(state, rand);

    /** @type {import('./gameState.js').Contract} */
    const contract = {
      id: _generateId(),
      title: data.title,
      description: data.description,
      category: data.category,
      objectives: data.objectives,
      bonusObjectives: data.bonusObjectives ?? [],
      bonusReward: data.bonusReward ?? 0,
      reward: data.reward,
      penaltyFee: Math.round(data.reward * CONTRACT_CANCEL_PENALTY_RATE),
      reputationReward: CONTRACT_REP_GAIN_MIN + Math.floor(Math.random() * (CONTRACT_REP_GAIN_MAX - CONTRACT_REP_GAIN_MIN + 1)),
      reputationPenalty: CONTRACT_REP_LOSS_CANCEL,
      deadlinePeriod: data.deadlineFlights != null
        ? state.currentPeriod + data.deadlineFlights
        : null,
      boardExpiryPeriod: state.currentPeriod + CONTRACT_BOARD_EXPIRY_FLIGHTS,
      generatedPeriod: state.currentPeriod,
      acceptedPeriod: null,
      chainId: data.chainId,
      chainPart: data.chainPart,
      chainTotal: data.chainTotal,
      conflictTags: data.conflictTags ?? [],
    };

    state.contracts.board.push(contract);
    generated.push(contract);
    usedTemplateIds.add(template.id);
  }

  return generated;
}

// ---------------------------------------------------------------------------
// Board Expiry
// ---------------------------------------------------------------------------

/**
 * Remove board contracts that have exceeded their expiry period.
 *
 * Called during period advancement.  Contracts expire after N flights
 * without being accepted.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {string[]} IDs of expired board contracts.
 */
export function expireBoardContracts(state) {
  _ensureContracts(state);

  const expired = [];
  state.contracts.board = state.contracts.board.filter((c) => {
    if (state.currentPeriod > c.boardExpiryPeriod) {
      expired.push(c.id);
      return false;
    }
    return true;
  });
  return expired;
}

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

/**
 * Accept a contract from the board.
 *
 * Moves the contract from `board` to `active`.  Returns failure if the
 * active cap would be exceeded or the contract is not found.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} contractId
 * @returns {{ success: boolean, contract?: import('./gameState.js').Contract, error?: string }}
 */
export function acceptContract(state, contractId) {
  _ensureContracts(state);

  const caps = getContractCaps(state);
  if (state.contracts.active.length >= caps.active) {
    return { success: false, error: `Active contract limit reached (${caps.active}).` };
  }

  const idx = state.contracts.board.findIndex((c) => c.id === contractId);
  if (idx === -1) {
    return { success: false, error: 'Contract not found on the board.' };
  }

  const [contract] = state.contracts.board.splice(idx, 1);
  contract.acceptedPeriod = state.currentPeriod;

  // If the contract has a deadline expressed as flights-from-now and it was
  // computed at generation time, keep it.  If it was null (open-ended), keep null.
  state.contracts.active.push(contract);

  return { success: true, contract };
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

/**
 * Complete a contract after all objectives are met.
 *
 * Awards cash reward and reputation.  If the contract is part of a chain,
 * generates the next part and places it on the board.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} contractId
 * @returns {{ success: boolean, contract?: import('./gameState.js').Contract, reward?: number, nextChainContract?: import('./gameState.js').Contract, error?: string }}
 */
export function completeContract(state, contractId) {
  _ensureContracts(state);

  const idx = state.contracts.active.findIndex((c) => c.id === contractId);
  if (idx === -1) {
    return { success: false, error: 'Contract not found in active list.' };
  }

  const [contract] = state.contracts.active.splice(idx, 1);
  state.contracts.completed.push(contract);

  // Award cash.
  earnReward(state, contract.reward);

  // Check bonus objectives — award bonus reward if all completed.
  let bonusAwarded = 0;
  if (Array.isArray(contract.bonusObjectives) && contract.bonusObjectives.length > 0 &&
      contract.bonusObjectives.every((o) => o.completed)) {
    bonusAwarded = contract.bonusReward || Math.round(contract.reward * CONTRACT_BONUS_REWARD_RATE);
    earnReward(state, bonusAwarded);
  }

  // Award reputation.
  state.reputation = _clampRep((state.reputation ?? 50) + contract.reputationReward);

  // Chain continuation: generate next part if applicable.
  let nextChainContract = null;
  if (contract.chainId && contract.chainPart && contract.chainTotal &&
      contract.chainPart < contract.chainTotal) {
    const nextPart = contract.chainPart + 1;
    const data = generateChainContinuation(contract.chainId, nextPart, Math.random());

    nextChainContract = {
      id: _generateId(),
      title: data.title,
      description: data.description,
      category: data.category,
      objectives: data.objectives,
      bonusObjectives: data.bonusObjectives ?? [],
      bonusReward: data.bonusReward ?? 0,
      reward: data.reward,
      penaltyFee: Math.round(data.reward * CONTRACT_CANCEL_PENALTY_RATE),
      reputationReward: CONTRACT_REP_GAIN_MIN + Math.floor(Math.random() * (CONTRACT_REP_GAIN_MAX - CONTRACT_REP_GAIN_MIN + 1)),
      reputationPenalty: CONTRACT_REP_LOSS_CANCEL,
      deadlinePeriod: data.deadlineFlights != null
        ? state.currentPeriod + data.deadlineFlights
        : null,
      boardExpiryPeriod: state.currentPeriod + CONTRACT_BOARD_EXPIRY_FLIGHTS,
      generatedPeriod: state.currentPeriod,
      acceptedPeriod: null,
      chainId: data.chainId,
      chainPart: data.chainPart,
      chainTotal: data.chainTotal,
      conflictTags: data.conflictTags ?? [],
    };

    state.contracts.board.push(nextChainContract);
  }

  return {
    success: true,
    contract,
    reward: contract.reward,
    bonusAwarded,
    nextChainContract,
  };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/**
 * Cancel an active contract.
 *
 * Applies penalty fee (deducted from cash, can go negative) and reputation
 * hit.  The contract is moved to the failed list.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} contractId
 * @returns {{ success: boolean, contract?: import('./gameState.js').Contract, penaltyFee?: number, error?: string }}
 */
export function cancelContract(state, contractId) {
  _ensureContracts(state);

  const idx = state.contracts.active.findIndex((c) => c.id === contractId);
  if (idx === -1) {
    return { success: false, error: 'Contract not found in active list.' };
  }

  const [contract] = state.contracts.active.splice(idx, 1);

  // Apply penalty fee (mandatory, can go negative).
  const penalty = contract.penaltyFee;
  state.money -= penalty;

  // Reputation hit.
  state.reputation = _clampRep((state.reputation ?? 50) - contract.reputationPenalty);

  state.contracts.failed.push(contract);

  return { success: true, contract, penaltyFee: penalty };
}

// ---------------------------------------------------------------------------
// Deadline Expiry (active contracts)
// ---------------------------------------------------------------------------

/**
 * Expire active contracts whose deadline period has passed.
 *
 * Called during period advancement.  Expired contracts are moved to failed
 * and a reputation penalty is applied.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {string[]} IDs of expired active contracts.
 */
export function expireActiveContracts(state) {
  _ensureContracts(state);

  const expired = [];
  const remaining = [];

  for (const contract of state.contracts.active) {
    if (contract.deadlinePeriod != null && state.currentPeriod > contract.deadlinePeriod) {
      state.reputation = _clampRep((state.reputation ?? 50) - CONTRACT_REP_LOSS_FAIL);
      state.contracts.failed.push(contract);
      expired.push(contract.id);
    } else {
      remaining.push(contract);
    }
  }

  state.contracts.active = remaining;
  return expired;
}

// ---------------------------------------------------------------------------
// Objective checking (called each physics tick, mirrors missions.js pattern)
// ---------------------------------------------------------------------------

/**
 * Check and update objective completion for all active contracts.
 *
 * This mirrors `checkObjectiveCompletion()` in missions.js and should be
 * called on the same tick.  It reuses the same objective type checks.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 */
export function checkContractObjectives(state, flightState) {
  if (!flightState) return;
  _ensureContracts(state);

  const active = state.contracts.active;
  if (!active || active.length === 0) return;

  // Import objective types inline to avoid circular deps — they're string constants.
  for (const contract of active) {
    if (!contract.objectives || contract.objectives.length === 0) continue;

    for (const obj of contract.objectives) {
      if (obj.completed) continue;
      _checkSingleObjective(obj, flightState);
    }

    // Also check bonus objectives.
    if (Array.isArray(contract.bonusObjectives)) {
      for (const obj of contract.bonusObjectives) {
        if (obj.completed) continue;
        _checkSingleObjective(obj, flightState);
      }
    }
  }
}

/**
 * Check a single objective against the current flight state.
 * Mirrors the switch in missions.js checkObjectiveCompletion().
 *
 * @param {import('../data/missions.js').ObjectiveDef} obj
 * @param {import('./gameState.js').FlightState} flightState
 */
function _checkSingleObjective(obj, flightState) {
  switch (obj.type) {
    case 'REACH_ALTITUDE':
      if (flightState.altitude >= obj.target.altitude) obj.completed = true;
      break;

    case 'REACH_SPEED':
      if (flightState.velocity >= obj.target.speed) obj.completed = true;
      break;

    case 'SAFE_LANDING': {
      const landing = flightState.events.find(
        (e) => e.type === 'LANDING' && typeof e.speed === 'number' && e.speed <= obj.target.maxLandingSpeed,
      );
      if (landing) obj.completed = true;
      break;
    }

    case 'ACTIVATE_PART': {
      const activation = flightState.events.find(
        (e) => e.type === 'PART_ACTIVATED' && e.partType === obj.target.partType,
      );
      if (activation) obj.completed = true;
      break;
    }

    case 'HOLD_ALTITUDE': {
      const inRange =
        flightState.altitude >= obj.target.minAltitude &&
        flightState.altitude <= obj.target.maxAltitude;
      const experimentOk =
        !flightState.hasScienceModules ||
        flightState.scienceModuleRunning === true ||
        flightState.events.some((e) => e.type === 'SCIENCE_COLLECTED');

      if (inRange && experimentOk) {
        if (obj._holdEnteredAt == null) {
          obj._holdEnteredAt = flightState.timeElapsed;
        } else if (flightState.timeElapsed - obj._holdEnteredAt >= obj.target.duration) {
          obj.completed = true;
        }
      } else {
        obj._holdEnteredAt = null;
      }
      break;
    }

    case 'RETURN_SCIENCE_DATA': {
      const scienceCollected = flightState.events.some((e) => e.type === 'SCIENCE_COLLECTED');
      const safeLanding = flightState.events.some(
        (e) => e.type === 'LANDING' && typeof e.speed === 'number' && e.speed <= 10,
      );
      if (scienceCollected && safeLanding) obj.completed = true;
      break;
    }

    case 'CONTROLLED_CRASH': {
      const crash = flightState.events.find(
        (e) => (e.type === 'LANDING' || e.type === 'CRASH') &&
               typeof e.speed === 'number' && e.speed >= obj.target.minCrashSpeed,
      );
      if (crash) obj.completed = true;
      break;
    }

    case 'EJECT_CREW': {
      const eject = flightState.events.find(
        (e) => e.type === 'CREW_EJECTED' && typeof e.altitude === 'number' && e.altitude >= obj.target.minAltitude,
      );
      if (eject) obj.completed = true;
      break;
    }

    case 'RELEASE_SATELLITE': {
      const release = flightState.events.find(
        (e) => e.type === 'SATELLITE_RELEASED' &&
               typeof e.altitude === 'number' && e.altitude >= obj.target.minAltitude &&
               (obj.target.minVelocity == null ||
                 (typeof e.velocity === 'number' && e.velocity >= obj.target.minVelocity)),
      );
      if (release) obj.completed = true;
      break;
    }

    case 'REACH_ORBIT':
      if (flightState.altitude >= obj.target.orbitAltitude &&
          flightState.velocity >= obj.target.orbitalVelocity) {
        obj.completed = true;
      }
      break;

    case 'BUDGET_LIMIT':
      if (typeof flightState.rocketCost === 'number' &&
          flightState.rocketCost <= obj.target.maxCost) {
        obj.completed = true;
      }
      break;

    case 'MAX_PARTS':
      if (typeof flightState.partCount === 'number' &&
          flightState.partCount <= obj.target.maxParts) {
        obj.completed = true;
      }
      break;

    case 'RESTRICT_PART':
      if (Array.isArray(flightState.partTypes) &&
          !flightState.partTypes.includes(obj.target.forbiddenType)) {
        obj.completed = true;
      }
      break;

    case 'MULTI_SATELLITE': {
      const releases = flightState.events.filter(
        (e) => e.type === 'SATELLITE_RELEASED' &&
               typeof e.altitude === 'number' && e.altitude >= obj.target.minAltitude,
      );
      if (releases.length >= obj.target.count) obj.completed = true;
      break;
    }

    case 'MINIMUM_CREW':
      if (typeof flightState.crewCount === 'number' &&
          flightState.crewCount >= obj.target.minCrew) {
        obj.completed = true;
      }
      break;

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Flight return processing (contract completion check)
// ---------------------------------------------------------------------------

/**
 * Process contract completions at end of flight.
 *
 * Checks all active contracts — if all objectives are met, completes them.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ completedContracts: Array<{ contract: import('./gameState.js').Contract, reward: number, nextChainContract?: import('./gameState.js').Contract }> }}
 */
export function processContractCompletions(state) {
  _ensureContracts(state);

  const completedContracts = [];

  // Snapshot active list since completeContract() mutates it.
  const snapshot = [...state.contracts.active];

  for (const contract of snapshot) {
    const allMet =
      Array.isArray(contract.objectives) &&
      contract.objectives.length > 0 &&
      contract.objectives.every((o) => o.completed);

    if (allMet) {
      const result = completeContract(state, contract.id);
      if (result.success) {
        completedContracts.push({
          contract: result.contract,
          reward: result.reward,
          nextChainContract: result.nextChainContract,
        });
      }
    }
  }

  return { completedContracts };
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

/**
 * Detect conflicting active contracts based on shared conflict tags.
 *
 * Returns an array of conflict descriptions. Each entry is an object with
 * the two conflicting contract IDs and the shared tag.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {Array<{ contractA: string, contractB: string, tag: string }>}
 */
export function getActiveConflicts(state) {
  _ensureContracts(state);
  const active = state.contracts.active;
  const conflicts = [];

  for (let i = 0; i < active.length; i++) {
    const tagsA = active[i].conflictTags;
    if (!Array.isArray(tagsA) || tagsA.length === 0) continue;

    for (let j = i + 1; j < active.length; j++) {
      const tagsB = active[j].conflictTags;
      if (!Array.isArray(tagsB) || tagsB.length === 0) continue;

      for (const tag of tagsA) {
        if (tagsB.includes(tag)) {
          conflicts.push({
            contractA: active[i].id,
            contractB: active[j].id,
            tag,
          });
        }
      }
    }
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// State guard
// ---------------------------------------------------------------------------

/**
 * Ensure the contracts sub-object exists on state (handles legacy saves).
 *
 * @param {import('./gameState.js').GameState} state
 */
function _ensureContracts(state) {
  if (!state.contracts) {
    state.contracts = { board: [], active: [], completed: [], failed: [] };
  }
  if (!Array.isArray(state.contracts.board)) state.contracts.board = [];
  if (!Array.isArray(state.contracts.active)) state.contracts.active = [];
  if (!Array.isArray(state.contracts.completed)) state.contracts.completed = [];
  if (!Array.isArray(state.contracts.failed)) state.contracts.failed = [];
  if (typeof state.reputation !== 'number') state.reputation = 50;
}
