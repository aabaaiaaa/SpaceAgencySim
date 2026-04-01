/**
 * challenges.js — Challenge mission lifecycle management.
 *
 * Challenges are hand-crafted replayable missions with medal-based scoring.
 * Unlike regular missions (one-time) and contracts (procedural), challenges
 * are static definitions that can be replayed to improve your medal.
 *
 * STATE STRUCTURE
 * ===============
 * state.challenges = {
 *   active:    ChallengeInstance | null,   // Currently accepted challenge (max 1)
 *   results:   { [challengeId]: ChallengeResult }  // Best result per challenge
 * }
 *
 * LIFECYCLE
 * =========
 * 1. Player opens Challenges tab → sees all unlocked challenges + best medals
 * 2. Player accepts a challenge → copied into state.challenges.active
 * 3. During flight: objectives are checked each tick (reuses contract objective logic)
 * 4. On flight return: if all objectives met, score is computed and medal awarded
 * 5. Best medal per challenge is persisted in state.challenges.results
 * 6. Player can replay any time to improve their medal
 *
 * @module core/challenges
 */

import { CHALLENGES, MedalTier, ScoreDirection } from '../data/challenges.js';
import { earnReward } from './finance.js';
import { ensureCustomChallengeState } from './customChallenges.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-copy a challenge definition for use as a live instance.
 *
 * @param {import('../data/challenges.js').ChallengeDef} def
 * @returns {import('../data/challenges.js').ChallengeDef}
 */
function _copyChallenge(def) {
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    briefing: def.briefing,
    objectives: def.objectives.map((obj) => ({ ...obj, completed: false })),
    scoreMetric: def.scoreMetric,
    scoreLabel: def.scoreLabel,
    scoreUnit: def.scoreUnit,
    scoreDirection: def.scoreDirection,
    medals: { ...def.medals },
    rewards: { ...def.rewards },
    requiredMissions: def.requiredMissions ? [...def.requiredMissions] : [],
  };
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Ensure state.challenges exists with the correct shape.
 *
 * @param {import('./gameState.js').GameState} state
 */
export function ensureChallengeState(state) {
  if (!state.challenges || typeof state.challenges !== 'object') {
    state.challenges = { active: null, results: {} };
  }
  if (!state.challenges.results || typeof state.challenges.results !== 'object') {
    state.challenges.results = {};
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all challenges the player has unlocked (prerequisites met).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('../data/challenges.js').ChallengeDef[]}
 */
export function getUnlockedChallenges(state) {
  ensureChallengeState(state);
  const completedMissionIds = new Set(
    (state.missions?.completed ?? []).map((m) => m.id),
  );

  const official = CHALLENGES.filter((ch) => {
    if (!ch.requiredMissions || ch.requiredMissions.length === 0) return true;
    return ch.requiredMissions.every((mid) => completedMissionIds.has(mid));
  });

  // Include all player-created custom challenges (no prerequisites).
  ensureCustomChallengeState(state);
  const custom = state.customChallenges ?? [];

  return [...official, ...custom];
}

/**
 * Get the player's best result for a specific challenge.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} challengeId
 * @returns {{ medal: string, score: number, attempts: number } | null}
 */
export function getChallengeResult(state, challengeId) {
  ensureChallengeState(state);
  return state.challenges.results[challengeId] ?? null;
}

/**
 * Get the currently active challenge (if any).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('../data/challenges.js').ChallengeDef | null}
 */
export function getActiveChallenge(state) {
  ensureChallengeState(state);
  return state.challenges.active;
}

// ---------------------------------------------------------------------------
// Lifecycle mutations
// ---------------------------------------------------------------------------

/**
 * Accept (or replay) a challenge.
 *
 * Only one challenge can be active at a time. Accepting a new challenge
 * replaces any currently active one.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} challengeId
 * @returns {{ success: boolean, challenge?: object, error?: string }}
 */
export function acceptChallenge(state, challengeId) {
  ensureChallengeState(state);

  // Search official challenges first, then custom.
  let def = CHALLENGES.find((ch) => ch.id === challengeId);
  if (!def) {
    ensureCustomChallengeState(state);
    def = (state.customChallenges ?? []).find((ch) => ch.id === challengeId);
  }
  if (!def) {
    return { success: false, error: `Challenge '${challengeId}' not found.` };
  }

  // Check prerequisites (custom challenges have none).
  const completedMissionIds = new Set(
    (state.missions?.completed ?? []).map((m) => m.id),
  );
  if (def.requiredMissions && def.requiredMissions.length > 0) {
    const unmet = def.requiredMissions.filter((mid) => !completedMissionIds.has(mid));
    if (unmet.length > 0) {
      return { success: false, error: `Prerequisites not met: ${unmet.join(', ')}` };
    }
  }

  const instance = _copyChallenge(def);
  if (def.custom) instance.custom = true;
  state.challenges.active = instance;

  return { success: true, challenge: instance };
}

/**
 * Abandon the currently active challenge without scoring.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ success: boolean }}
 */
export function abandonChallenge(state) {
  ensureChallengeState(state);
  state.challenges.active = null;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Objective checking (called each physics tick)
// ---------------------------------------------------------------------------

/**
 * Check and update objective completion for the active challenge.
 *
 * Uses the same objective types as missions/contracts. Called from the
 * main objective checking loop alongside mission and contract checks.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 */
export function checkChallengeObjectives(state, flightState) {
  if (!flightState) return;
  ensureChallengeState(state);

  const challenge = state.challenges.active;
  if (!challenge || !challenge.objectives) return;

  for (const obj of challenge.objectives) {
    if (obj.completed) continue;
    _checkSingleObjective(obj, flightState);
  }
}

/**
 * Check a single objective against the current flight state.
 * Mirrors the switch in contracts.js _checkSingleObjective().
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
      if (inRange) {
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
// Scoring
// ---------------------------------------------------------------------------

/**
 * Extract the scoring metric value from a flight state.
 *
 * @param {string} metric  - The scoreMetric field name.
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('./physics.js').PhysicsState|null} ps
 * @returns {number|null}  The metric value, or null if unavailable.
 */
export function extractScoreMetric(metric, flightState, ps) {
  switch (metric) {
    case 'rocketCost':
      return typeof flightState.rocketCost === 'number' ? flightState.rocketCost : null;

    case 'landingSpeed': {
      const landingEvent = (flightState.events ?? []).find(
        (e) => e.type === 'LANDING' && typeof e.speed === 'number',
      );
      return landingEvent ? landingEvent.speed : null;
    }

    case 'partCount':
      return typeof flightState.partCount === 'number' ? flightState.partCount : null;

    case 'maxAltitude':
      return typeof flightState.maxAltitude === 'number'
        ? flightState.maxAltitude
        : (typeof flightState.altitude === 'number' ? flightState.altitude : null);

    case 'maxVelocity':
      return typeof flightState.maxVelocity === 'number'
        ? flightState.maxVelocity
        : (typeof flightState.velocity === 'number' ? flightState.velocity : null);

    case 'timeElapsed':
      return typeof flightState.timeElapsed === 'number' ? flightState.timeElapsed : null;

    case 'fuelRemaining': {
      // Return as a percentage (0–100).
      if (ps && typeof ps.totalFuel === 'number' && typeof ps.maxFuel === 'number' && ps.maxFuel > 0) {
        return Math.round((ps.totalFuel / ps.maxFuel) * 100);
      }
      if (typeof flightState.fuelFraction === 'number') {
        return Math.round(flightState.fuelFraction * 100);
      }
      return null;
    }

    case 'satellitesDeployed': {
      const releases = (flightState.events ?? []).filter(
        (e) => e.type === 'SATELLITE_RELEASED',
      );
      return releases.length;
    }

    default:
      return null;
  }
}

/**
 * Determine what medal a score earns for a given challenge definition.
 *
 * @param {import('../data/challenges.js').ChallengeDef} challenge
 * @param {number} score
 * @returns {string}  MedalTier value.
 */
export function computeMedal(challenge, score) {
  const { medals, scoreDirection } = challenge;

  if (scoreDirection === ScoreDirection.LOWER_IS_BETTER) {
    if (score <= medals.gold)   return MedalTier.GOLD;
    if (score <= medals.silver) return MedalTier.SILVER;
    if (score <= medals.bronze) return MedalTier.BRONZE;
    return MedalTier.NONE;
  }

  // HIGHER_IS_BETTER
  if (score >= medals.gold)   return MedalTier.GOLD;
  if (score >= medals.silver) return MedalTier.SILVER;
  if (score >= medals.bronze) return MedalTier.BRONZE;
  return MedalTier.NONE;
}

/**
 * Medal tier ordering for comparison.
 * @type {Object<string, number>}
 */
const MEDAL_RANK = {
  [MedalTier.NONE]:   0,
  [MedalTier.BRONZE]: 1,
  [MedalTier.SILVER]: 2,
  [MedalTier.GOLD]:   3,
};

/**
 * Returns true if medalA is strictly better than medalB.
 *
 * @param {string} medalA
 * @param {string} medalB
 * @returns {boolean}
 */
export function isBetterMedal(medalA, medalB) {
  return (MEDAL_RANK[medalA] ?? 0) > (MEDAL_RANK[medalB] ?? 0);
}

// ---------------------------------------------------------------------------
// Flight return processing
// ---------------------------------------------------------------------------

/**
 * Process challenge completion at end of flight.
 *
 * If the active challenge's objectives are all met, computes the score and
 * medal, updates the best result, awards cash, and clears the active slot.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('./physics.js').PhysicsState|null} ps
 * @returns {{
 *   completed: boolean,
 *   challengeId?: string,
 *   challengeTitle?: string,
 *   score?: number,
 *   medal?: string,
 *   previousMedal?: string,
 *   isNewBest?: boolean,
 *   reward?: number,
 * }}
 */
export function processChallengeCompletion(state, flightState, ps) {
  ensureChallengeState(state);

  const challenge = state.challenges.active;
  if (!challenge) return { completed: false };

  // Check if all objectives are met.
  const allMet = Array.isArray(challenge.objectives) &&
    challenge.objectives.length > 0 &&
    challenge.objectives.every((obj) => obj.completed);

  if (!allMet) {
    // Clear the active challenge on flight end (failed attempt).
    state.challenges.active = null;
    return { completed: false };
  }

  // Compute score.
  const score = extractScoreMetric(challenge.scoreMetric, flightState, ps);
  if (score == null) {
    state.challenges.active = null;
    return { completed: false };
  }

  const medal = computeMedal(challenge, score);
  const previousResult = state.challenges.results[challenge.id];
  const previousMedal = previousResult?.medal ?? MedalTier.NONE;
  const isNewBest = isBetterMedal(medal, previousMedal);

  // Determine reward: only pay the delta between new and old medal tier.
  let reward = 0;
  if (medal !== MedalTier.NONE) {
    const newReward = challenge.rewards[medal] ?? 0;
    const oldReward = previousMedal !== MedalTier.NONE
      ? (challenge.rewards[previousMedal] ?? 0)
      : 0;
    reward = Math.max(0, newReward - oldReward);
  }

  // Award cash.
  if (reward > 0) {
    earnReward(state, reward);
  }

  // Update best result.
  const attempts = (previousResult?.attempts ?? 0) + 1;
  if (isNewBest || !previousResult) {
    state.challenges.results[challenge.id] = {
      medal,
      score,
      attempts,
    };
  } else {
    // Just increment attempt counter.
    state.challenges.results[challenge.id] = {
      ...previousResult,
      attempts,
    };
  }

  // Clear active challenge.
  state.challenges.active = null;

  return {
    completed: true,
    challengeId: challenge.id,
    challengeTitle: challenge.title,
    score,
    medal,
    previousMedal,
    isNewBest,
    reward,
  };
}
