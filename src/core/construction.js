/**
 * construction.js — Facility construction system.
 *
 * Manages building new facilities on the hub.  Each facility is defined in
 * `FACILITY_DEFINITIONS` (constants.js) and tracked in `state.facilities`.
 *
 * Tutorial mode:  Building is locked — facilities are awarded via tutorial
 *                 missions.  Only upgrades are available once a building
 *                 exists (Phase 5).
 * Non-tutorial:   All facilities available to build from the start.
 *
 * @module core/construction
 */

import { FACILITY_DEFINITIONS } from './constants.js';
import { spend } from './finance.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Returns true if the facility with `facilityId` has been built.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} facilityId
 * @returns {boolean}
 */
export function hasFacility(state, facilityId) {
  return !!state.facilities[facilityId]?.built;
}

/**
 * Returns the definition for a facility, or undefined if not found.
 *
 * @param {string} facilityId
 * @returns {import('./constants.js').FACILITY_DEFINITIONS[number] | undefined}
 */
export function getFacilityDef(facilityId) {
  return FACILITY_DEFINITIONS.find((f) => f.id === facilityId);
}

/**
 * Check whether the player can build a specific facility right now.
 *
 * Returns an object with `allowed` (boolean) and `reason` (string) when
 * construction is blocked.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} facilityId
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canBuildFacility(state, facilityId) {
  const def = getFacilityDef(facilityId);
  if (!def) {
    return { allowed: false, reason: 'Unknown facility.' };
  }
  if (hasFacility(state, facilityId)) {
    return { allowed: false, reason: 'Already built.' };
  }
  if (state.tutorialMode) {
    return { allowed: false, reason: 'Locked in tutorial mode — complete missions to unlock.' };
  }
  if (def.cost > 0 && state.money < def.cost) {
    return { allowed: false, reason: `Insufficient funds (need $${def.cost.toLocaleString('en-US')}).` };
  }
  return { allowed: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Build a facility, deducting its cost from the player's cash.
 *
 * Returns `{ success, reason }`.  On success the facility is added to
 * `state.facilities` at tier 1.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} facilityId
 * @returns {{ success: boolean, reason: string }}
 */
export function buildFacility(state, facilityId) {
  const check = canBuildFacility(state, facilityId);
  if (!check.allowed) {
    return { success: false, reason: check.reason };
  }

  const def = getFacilityDef(facilityId);
  if (def.cost > 0) {
    const ok = spend(state, def.cost);
    if (!ok) {
      return { success: false, reason: 'Insufficient funds.' };
    }
  }

  state.facilities[facilityId] = { built: true, tier: 1 };
  return { success: true, reason: '' };
}

/**
 * Award a facility for free (used by tutorial missions).
 * Bypasses the tutorial-mode lock and cost check.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} facilityId
 * @returns {{ success: boolean, reason: string }}
 */
export function awardFacility(state, facilityId) {
  const def = getFacilityDef(facilityId);
  if (!def) {
    return { success: false, reason: 'Unknown facility.' };
  }
  if (hasFacility(state, facilityId)) {
    return { success: false, reason: 'Already built.' };
  }
  state.facilities[facilityId] = { built: true, tier: 1 };
  return { success: true, reason: '' };
}
