/**
 * reputation.ts — Agency reputation system.
 *
 * Reputation is a score from 0 to 100 that affects:
 *   - Contract quality (tier-based filtering handled by contracts.js)
 *   - Crew hiring cost (modifier applied in crew.js)
 *   - Facility construction cost (discount applied in construction.js)
 *
 * Reputation tiers:
 *   0–20   Basic:    +50 % crew cost, no facility discount
 *   21–40  Standard: +25 % crew cost, no facility discount
 *   41–60  Good:     normal crew cost ($50k), 5 % facility discount
 *   61–80  Premium:  −10 % crew cost, 10 % facility discount
 *   81–100 Elite:    −25 % crew cost, 15 % facility discount
 *
 * Facility discounts apply to money only — never to science costs (R&D Lab).
 *
 * @module core/reputation
 */

import {
  STARTING_REPUTATION,
  REP_GAIN_SAFE_CREW_RETURN,
  REP_GAIN_MILESTONE,
  REP_LOSS_CREW_DEATH,
  REP_LOSS_MISSION_FAILURE,
  REP_LOSS_ROCKET_DESTRUCTION,
  getReputationTier,
} from './constants.js';

import type { GameState } from './gameState.js';

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Clamp reputation to [0, 100].
 */
function clampRep(rep: number): number {
  return Math.max(0, Math.min(100, rep));
}

/**
 * Adjust the agency reputation by `delta` and clamp to [0, 100].
 *
 * @param state
 * @param delta  Amount to add (positive) or subtract (negative).
 * @returns The new reputation value after clamping.
 */
export function adjustReputation(state: GameState, delta: number): number {
  state.reputation = clampRep((state.reputation ?? STARTING_REPUTATION) + delta);
  return state.reputation;
}

// ---------------------------------------------------------------------------
// Flight-return reputation events
// ---------------------------------------------------------------------------

/**
 * Apply reputation changes for crew deaths during a flight.
 *
 * −10 reputation per crew member killed.
 *
 * @param state
 * @param kiaCount  Number of crew members killed.
 * @returns Total reputation change (negative).
 */
export function applyCrewDeathReputation(state: GameState, kiaCount: number): number {
  if (kiaCount <= 0) return 0;
  const delta = -REP_LOSS_CREW_DEATH * kiaCount;
  adjustReputation(state, delta);
  return delta;
}

/**
 * Apply reputation bonus for safely returning crew.
 *
 * +1 reputation per surviving crew member on a safe landing.
 *
 * @param state
 * @param survivingCrewCount  Number of crew safely returned.
 * @returns Total reputation change (positive).
 */
export function applySafeCrewReturnReputation(
  state: GameState,
  survivingCrewCount: number,
): number {
  if (survivingCrewCount <= 0) return 0;
  const delta = REP_GAIN_SAFE_CREW_RETURN * survivingCrewCount;
  adjustReputation(state, delta);
  return delta;
}

/**
 * Apply reputation penalty for mission failure (flight ended without
 * completing objectives).
 *
 * −3 reputation.
 *
 * @returns Reputation change (−3).
 */
export function applyMissionFailureReputation(state: GameState): number {
  const delta = -REP_LOSS_MISSION_FAILURE;
  adjustReputation(state, delta);
  return delta;
}

/**
 * Apply reputation penalty for rocket destruction without recovery.
 *
 * −2 reputation.
 *
 * @returns Reputation change (−2).
 */
export function applyRocketDestructionReputation(state: GameState): number {
  const delta = -REP_LOSS_ROCKET_DESTRUCTION;
  adjustReputation(state, delta);
  return delta;
}

/**
 * Apply reputation bonus for achieving a milestone.
 *
 * +10 reputation.
 *
 * @returns Reputation change (+10).
 */
export function applyMilestoneReputation(state: GameState): number {
  const delta = REP_GAIN_MILESTONE;
  adjustReputation(state, delta);
  return delta;
}
