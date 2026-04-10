/**
 * construction.ts — Facility construction and upgrade system.
 *
 * Manages building new facilities on the hub and upgrading existing ones.
 * Each facility is defined in `FACILITY_DEFINITIONS` (constants.js) and
 * tracked in `state.facilities`.
 *
 * Tutorial mode:  Building is locked — facilities are awarded via tutorial
 *                 missions.  Only upgrades are available once a building
 *                 exists (Phase 5).
 * Non-tutorial:   All facilities available to build from the start.
 *
 * Upgrades:
 *   - Any facility in FACILITY_UPGRADE_DEFS can be upgraded through tiers.
 *   - All costs are money only, except R&D Lab (money + science).
 *   - Reputation discounts apply to the money portion only.
 *   - R&D Lab is the only facility that costs both money AND science points.
 *
 * @module core/construction
 */

import {
  FACILITY_DEFINITIONS,
  GameMode,
  getFacilityUpgradeDef,
  getReputationDiscount,
} from './constants.ts';
import { spend } from './finance.ts';

import type { FacilityDefinition } from './constants.ts';
import type { GameState } from './gameState.ts';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result from a build/upgrade check. */
export interface BuildCheckResult {
  allowed: boolean;
  reason: string;
}

/** Result from an upgrade check with additional cost info. */
export interface UpgradeCheckResult {
  allowed: boolean;
  reason: string;
  nextTier: number;
  moneyCost: number;
  scienceCost: number;
  description: string;
}

/** Result from a build/upgrade/award command. */
export interface CommandResult {
  success: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Returns true if the facility with `facilityId` has been built.
 */
export function hasFacility(state: GameState, facilityId: string): boolean {
  return !!state.facilities[facilityId]?.built;
}

/**
 * Returns the current tier of a built facility, or 0 if not built.
 */
export function getFacilityTier(state: GameState, facilityId: string): number {
  if (!hasFacility(state, facilityId)) return 0;
  return state.facilities[facilityId]?.tier ?? 1;
}

/**
 * Returns the definition for a facility, or undefined if not found.
 */
export function getFacilityDef(facilityId: string): FacilityDefinition | undefined {
  return FACILITY_DEFINITIONS.find((f) => f.id === facilityId);
}

/**
 * Compute the actual money cost after applying reputation discount.
 * Reputation discounts apply only to the money portion of facility costs.
 */
export function getDiscountedMoneyCost(baseMoneyCost: number, reputation: number): number {
  const discount = getReputationDiscount(reputation);
  return Math.floor(baseMoneyCost * (1 - discount));
}

/**
 * Check whether the player can build a specific facility right now.
 *
 * Returns an object with `allowed` (boolean) and `reason` (string) when
 * construction is blocked.
 */
export function canBuildFacility(state: GameState, facilityId: string): BuildCheckResult {
  const def = getFacilityDef(facilityId);
  if (!def) {
    return { allowed: false, reason: 'Unknown facility.' };
  }
  if (hasFacility(state, facilityId)) {
    return { allowed: false, reason: 'Already built.' };
  }
  // Sandbox mode: always allowed, no cost.
  if (state.gameMode === GameMode.SANDBOX) {
    return { allowed: true, reason: '' };
  }
  if (state.tutorialMode) {
    return { allowed: false, reason: 'Locked in tutorial mode — complete missions to unlock.' };
  }
  // Money check (with reputation discount).
  if (def.cost > 0) {
    const moneyCost = getDiscountedMoneyCost(def.cost, state.reputation ?? 50);
    if (state.money < moneyCost) {
      return { allowed: false, reason: `Insufficient funds (need $${moneyCost.toLocaleString('en-US')}).` };
    }
  }
  // Science cost check (R&D Lab).
  if ((def.scienceCost ?? 0) > 0) {
    if ((state.sciencePoints ?? 0) < def.scienceCost) {
      return {
        allowed: false,
        reason: `Insufficient science (need ${def.scienceCost}, have ${Math.floor(state.sciencePoints ?? 0)}).`,
      };
    }
  }
  return { allowed: true, reason: '' };
}

/**
 * Check whether a facility can be upgraded to the next tier.
 *
 * Any facility listed in FACILITY_UPGRADE_DEFS can be upgraded.
 * All facilities cost money only, except R&D Lab (money + science).
 */
export function canUpgradeFacility(state: GameState, facilityId: string): UpgradeCheckResult {
  const noUpgrade: UpgradeCheckResult = { allowed: false, reason: '', nextTier: 0, moneyCost: 0, scienceCost: 0, description: '' };

  if (!hasFacility(state, facilityId)) {
    return { ...noUpgrade, reason: 'Facility not built.' };
  }

  const upgradeDef = getFacilityUpgradeDef(facilityId);
  if (!upgradeDef) {
    return { ...noUpgrade, reason: 'This facility cannot be upgraded.' };
  }

  const currentTier = getFacilityTier(state, facilityId);
  const nextTier = currentTier + 1;

  if (nextTier > upgradeDef.maxTier) {
    return { ...noUpgrade, reason: 'Already at maximum tier.' };
  }

  const tierDef = upgradeDef.tiers[nextTier];
  if (!tierDef) {
    return { ...noUpgrade, reason: 'No upgrade definition found.' };
  }

  const moneyCost = getDiscountedMoneyCost(tierDef.moneyCost, state.reputation ?? 50);
  const scienceCost = tierDef.scienceCost;

  // Sandbox mode: skip cost checks entirely.
  if (state.gameMode !== GameMode.SANDBOX) {
    if (state.money < moneyCost) {
      return {
        ...noUpgrade,
        reason: `Insufficient funds (need $${moneyCost.toLocaleString('en-US')}).`,
        nextTier,
        moneyCost,
        scienceCost,
        description: tierDef.description,
      };
    }

    if (scienceCost > 0 && (state.sciencePoints ?? 0) < scienceCost) {
      return {
        ...noUpgrade,
        reason: `Insufficient science (need ${scienceCost}, have ${Math.floor(state.sciencePoints ?? 0)}).`,
        nextTier,
        moneyCost,
        scienceCost,
        description: tierDef.description,
      };
    }
  }

  return {
    allowed: true,
    reason: '',
    nextTier,
    moneyCost: state.gameMode === GameMode.SANDBOX ? 0 : moneyCost,
    scienceCost: state.gameMode === GameMode.SANDBOX ? 0 : scienceCost,
    description: tierDef.description,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Build a facility, deducting its cost from the player's cash (and science
 * for the R&D Lab).
 *
 * Returns `{ success, reason }`.  On success the facility is added to
 * `state.facilities` at tier 1.
 */
export function buildFacility(state: GameState, facilityId: string): CommandResult {
  const check = canBuildFacility(state, facilityId);
  if (!check.allowed) {
    return { success: false, reason: check.reason };
  }

  const def = getFacilityDef(facilityId)!;
  const isSandbox = state.gameMode === GameMode.SANDBOX;

  // Sandbox mode: skip all cost deductions.
  if (!isSandbox) {
    // Deduct science cost first (R&D Lab).
    if ((def.scienceCost ?? 0) > 0) {
      state.sciencePoints = (state.sciencePoints ?? 0) - def.scienceCost;
    }

    // Deduct money cost (with reputation discount).
    if (def.cost > 0) {
      const moneyCost = getDiscountedMoneyCost(def.cost, state.reputation ?? 50);
      const ok = spend(state, moneyCost);
      if (!ok) {
        // Rollback science.
        if ((def.scienceCost ?? 0) > 0) {
          state.sciencePoints += def.scienceCost;
        }
        return { success: false, reason: 'Insufficient funds.' };
      }
    }
  }

  state.facilities[facilityId] = { built: true, tier: 1 };
  return { success: true, reason: '' };
}

/**
 * Upgrade a facility to the next tier, deducting costs.
 *
 * Any facility listed in FACILITY_UPGRADE_DEFS can be upgraded.
 */
export function upgradeFacility(state: GameState, facilityId: string): CommandResult {
  const check = canUpgradeFacility(state, facilityId);
  if (!check.allowed) {
    return { success: false, reason: check.reason };
  }

  // Sandbox mode: skip all cost deductions (costs are returned as 0).
  if (state.gameMode !== GameMode.SANDBOX) {
    // Deduct science cost.
    if (check.scienceCost > 0) {
      state.sciencePoints = (state.sciencePoints ?? 0) - check.scienceCost;
    }

    // Deduct money cost (already discounted by canUpgradeFacility).
    if (check.moneyCost > 0) {
      const ok = spend(state, check.moneyCost);
      if (!ok) {
        // Rollback science.
        if (check.scienceCost > 0) {
          state.sciencePoints += check.scienceCost;
        }
        return { success: false, reason: 'Insufficient funds.' };
      }
    }
  }

  state.facilities[facilityId].tier = check.nextTier;
  return { success: true, reason: '' };
}

/**
 * Award a facility for free (used by tutorial missions).
 * Bypasses the tutorial-mode lock and cost check.
 */
export function awardFacility(state: GameState, facilityId: string): CommandResult {
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
