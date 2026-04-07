/**
 * challenges.ts — Challenge mission lifecycle management.
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
 * 1. Player opens Challenges tab -> sees all unlocked challenges + best medals
 * 2. Player accepts a challenge -> copied into state.challenges.active
 * 3. During flight: objectives are checked each tick (reuses contract objective logic)
 * 4. On flight return: if all objectives met, score is computed and medal awarded
 * 5. Best medal per challenge is persisted in state.challenges.results
 * 6. Player can replay any time to improve their medal
 *
 * @module core/challenges
 */

import { CHALLENGES, MedalTier, ScoreDirection } from '../data/challenges.ts';
import { earnReward } from './finance.ts';
import { ensureCustomChallengeState } from './customChallenges.ts';
import type { GameState, FlightState, ChallengeDef, ObjectiveDef, ChallengeResultEntry } from './gameState.ts';
import type { PhysicsState } from './physics.ts';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

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

/** PhysicsState augmented with optional scoring metrics. */
interface ScoringPhysicsState extends PhysicsState {
  totalFuel?: number;
  maxFuel?: number;
}

interface ChallengeCompletionResult {
  completed: boolean;
  challengeId?: string;
  challengeTitle?: string;
  score?: number;
  medal?: string;
  previousMedal?: string;
  isNewBest?: boolean;
  reward?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-copy a challenge definition for use as a live instance.
 */
function _copyChallenge(def: ChallengeDef): ChallengeDef {
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
 */
export function ensureChallengeState(state: GameState): void {
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
 */
export function getUnlockedChallenges(state: GameState): ChallengeDef[] {
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
 */
export function getChallengeResult(state: GameState, challengeId: string): ChallengeResultEntry | null {
  ensureChallengeState(state);
  return state.challenges.results[challengeId] ?? null;
}

/**
 * Get the currently active challenge (if any).
 */
export function getActiveChallenge(state: GameState): ChallengeDef | null {
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
 */
export function acceptChallenge(state: GameState, challengeId: string): { success: boolean; challenge?: ChallengeDef; error?: string } {
  ensureChallengeState(state);

  // Search official challenges first, then custom.
  let def: ChallengeDef | undefined = CHALLENGES.find((ch) => ch.id === challengeId);
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
 */
export function abandonChallenge(state: GameState): { success: boolean } {
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
 */
export function checkChallengeObjectives(state: GameState, flightState: FlightState): void {
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
 */
function _checkSingleObjective(obj: ObjectiveDef, flightState: FlightState): void {
  const objHold = obj as ObjectiveWithHold;
  const t = obj.target as ObjectiveTarget;

  switch (obj.type) {
    case 'REACH_ALTITUDE':
      if (t.altitude != null && flightState.altitude >= t.altitude) obj.completed = true;
      break;

    case 'REACH_SPEED':
      if (t.speed != null && flightState.velocity >= t.speed) obj.completed = true;
      break;

    case 'SAFE_LANDING': {
      const landing = flightState.events.find(
        (e) => e.type === 'LANDING' && typeof e.speed === 'number' && (e.speed as number) <= (t.maxLandingSpeed ?? Infinity),
      );
      if (landing) obj.completed = true;
      break;
    }

    case 'ACTIVATE_PART': {
      const activation = flightState.events.find(
        (e) => e.type === 'PART_ACTIVATED' && e.partType === t.partType,
      );
      if (activation) obj.completed = true;
      break;
    }

    case 'HOLD_ALTITUDE': {
      const inRange =
        t.minAltitude != null && t.maxAltitude != null &&
        flightState.altitude >= t.minAltitude &&
        flightState.altitude <= t.maxAltitude;
      if (inRange) {
        if (objHold._holdEnteredAt == null) {
          objHold._holdEnteredAt = flightState.timeElapsed;
        } else if (t.duration != null && flightState.timeElapsed - objHold._holdEnteredAt >= t.duration) {
          obj.completed = true;
        }
      } else {
        objHold._holdEnteredAt = null;
      }
      break;
    }

    case 'RETURN_SCIENCE_DATA': {
      const scienceCollected = flightState.events.some((e) => e.type === 'SCIENCE_COLLECTED');
      const safeLanding = flightState.events.some(
        (e) => e.type === 'LANDING' && typeof e.speed === 'number' && (e.speed as number) <= 10,
      );
      if (scienceCollected && safeLanding) obj.completed = true;
      break;
    }

    case 'CONTROLLED_CRASH': {
      const crash = flightState.events.find(
        (e) => (e.type === 'LANDING' || e.type === 'CRASH') &&
               typeof e.speed === 'number' && (e.speed as number) >= (t.minCrashSpeed ?? 0),
      );
      if (crash) obj.completed = true;
      break;
    }

    case 'EJECT_CREW': {
      const eject = flightState.events.find(
        (e) => e.type === 'CREW_EJECTED' && typeof e.altitude === 'number' && (e.altitude as number) >= (t.minAltitude ?? 0),
      );
      if (eject) obj.completed = true;
      break;
    }

    case 'RELEASE_SATELLITE': {
      const release = flightState.events.find(
        (e) => e.type === 'SATELLITE_RELEASED' &&
               typeof e.altitude === 'number' && (e.altitude as number) >= (t.minAltitude ?? 0) &&
               (t.minVelocity == null ||
                 (typeof e.velocity === 'number' && (e.velocity as number) >= t.minVelocity)),
      );
      if (release) obj.completed = true;
      break;
    }

    case 'REACH_ORBIT':
      if (t.orbitAltitude != null && t.orbitalVelocity != null &&
          flightState.altitude >= t.orbitAltitude &&
          flightState.velocity >= t.orbitalVelocity) {
        obj.completed = true;
      }
      break;

    case 'BUDGET_LIMIT':
      if (typeof flightState.rocketCost === 'number' &&
          t.maxCost != null && flightState.rocketCost <= t.maxCost) {
        obj.completed = true;
      }
      break;

    case 'MAX_PARTS':
      if (typeof flightState.partCount === 'number' &&
          t.maxParts != null && flightState.partCount <= t.maxParts) {
        obj.completed = true;
      }
      break;

    case 'RESTRICT_PART':
      if (Array.isArray(flightState.partTypes) &&
          t.forbiddenType != null && !flightState.partTypes.includes(t.forbiddenType)) {
        obj.completed = true;
      }
      break;

    case 'MULTI_SATELLITE': {
      const releases = flightState.events.filter(
        (e) => e.type === 'SATELLITE_RELEASED' &&
               typeof e.altitude === 'number' && (e.altitude as number) >= (t.minAltitude ?? 0),
      );
      if (t.count != null && releases.length >= t.count) obj.completed = true;
      break;
    }

    case 'MINIMUM_CREW':
      if (typeof flightState.crewCount === 'number' &&
          t.minCrew != null && flightState.crewCount >= t.minCrew) {
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
 */
export function extractScoreMetric(metric: string, flightState: FlightState, ps: PhysicsState | null): number | null {
  switch (metric) {
    case 'rocketCost':
      return typeof flightState.rocketCost === 'number' ? flightState.rocketCost : null;

    case 'landingSpeed': {
      const landingEvent = (flightState.events ?? []).find(
        (e) => e.type === 'LANDING' && typeof e.speed === 'number',
      );
      return landingEvent && typeof landingEvent.speed === 'number' ? landingEvent.speed : null;
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
      // Return as a percentage (0-100).
      const psExt = ps as ScoringPhysicsState | null;
      if (psExt && typeof psExt.totalFuel === 'number' && typeof psExt.maxFuel === 'number' && psExt.maxFuel > 0) {
        return Math.round((psExt.totalFuel / psExt.maxFuel) * 100);
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
 */
export function computeMedal(challenge: ChallengeDef, score: number): string {
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
 */
const MEDAL_RANK: Record<string, number> = {
  [MedalTier.NONE]:   0,
  [MedalTier.BRONZE]: 1,
  [MedalTier.SILVER]: 2,
  [MedalTier.GOLD]:   3,
};

/**
 * Returns true if medalA is strictly better than medalB.
 */
export function isBetterMedal(medalA: string, medalB: string): boolean {
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
 */
export function processChallengeCompletion(state: GameState, flightState: FlightState, ps: PhysicsState | null): ChallengeCompletionResult {
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
    const rewardsMap = challenge.rewards as Record<string, number>;
    const newReward = rewardsMap[medal] ?? 0;
    const oldReward = previousMedal !== MedalTier.NONE
      ? (rewardsMap[previousMedal] ?? 0)
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
