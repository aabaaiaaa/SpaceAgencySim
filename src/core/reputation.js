/**
 * reputation.js — Agency reputation system.
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

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Clamp reputation to [0, 100].
 * @param {number} rep
 * @returns {number}
 */
function clampRep(rep) {
  return Math.max(0, Math.min(100, rep));
}

/**
 * Adjust the agency reputation by `delta` and clamp to [0, 100].
 *
 * @param {import('./gameState.js').GameState} state
 * @param {number} delta  Amount to add (positive) or subtract (negative).
 * @returns {number}  The new reputation value after clamping.
 */
export function adjustReputation(state, delta) {
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
 * @param {import('./gameState.js').GameState} state
 * @param {number} kiaCount  Number of crew members killed.
 * @returns {number}  Total reputation change (negative).
 */
export function applyCrewDeathReputation(state, kiaCount) {
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
 * @param {import('./gameState.js').GameState} state
 * @param {number} survivingCrewCount  Number of crew safely returned.
 * @returns {number}  Total reputation change (positive).
 */
export function applySafeCrewReturnReputation(state, survivingCrewCount) {
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
 * @param {import('./gameState.js').GameState} state
 * @returns {number}  Reputation change (−3).
 */
export function applyMissionFailureReputation(state) {
  const delta = -REP_LOSS_MISSION_FAILURE;
  adjustReputation(state, delta);
  return delta;
}

/**
 * Apply reputation penalty for rocket destruction without recovery.
 *
 * −2 reputation.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}  Reputation change (−2).
 */
export function applyRocketDestructionReputation(state) {
  const delta = -REP_LOSS_ROCKET_DESTRUCTION;
  adjustReputation(state, delta);
  return delta;
}

/**
 * Apply reputation bonus for achieving a milestone.
 *
 * +10 reputation.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}  Reputation change (+10).
 */
export function applyMilestoneReputation(state) {
  const delta = REP_GAIN_MILESTONE;
  adjustReputation(state, delta);
  return delta;
}
