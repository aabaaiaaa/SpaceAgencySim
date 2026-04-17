/**
 * _state.ts — Pure reducers for the hub UI.
 *
 * Captures the pure, non-DOM computations used by hub.ts — the
 * return-results financial summary, net-cash-change formatting, and
 * facility-action classification — for unit testing.  Follows the VAB
 * reducer pattern (src/ui/vab/_state.ts).
 *
 * hub.ts itself has no non-DOM module state worth tracking (all module
 * refs are DOM/listener lifecycle), so this module exposes only pure
 * formatters/classifiers.
 */

import type { FlightReturnSummary } from '../../core/flightReturn.ts';

// ---------------------------------------------------------------------------
// Return-results financial summary
// ---------------------------------------------------------------------------

export type ReturnResultTone = 'positive' | 'negative' | 'neutral';

export interface ReturnResultRow {
  label: string;
  value: string;
  tone: ReturnResultTone;
}

/**
 * Sum of mission rewards in a flight-return summary.
 */
export function getMissionRewardTotal(summary: FlightReturnSummary): number {
  return summary.completedMissions.reduce((s, e) => s + e.reward, 0);
}

/**
 * Build the ordered list of financial-summary rows shown in the
 * "Return to Agency" overlay.  Rows are omitted when their associated
 * amount is zero (or missing), matching the original UI behaviour.
 *
 * The net-cash-change row is deliberately excluded — it has its own
 * formatter (`formatNetCashChange`) because the DOM rendering uses
 * distinct CSS classes.
 */
export function formatReturnResults(summary: FlightReturnSummary): ReturnResultRow[] {
  const rows: ReturnResultRow[] = [];

  const missionRewardTotal: number = getMissionRewardTotal(summary);

  if (missionRewardTotal > 0) {
    rows.push({
      label: 'Mission rewards',
      value: `+$${missionRewardTotal.toLocaleString('en-US')}`,
      tone: 'positive',
    });
  }

  if (summary.recoveryValue > 0) {
    rows.push({
      label: 'Part recovery (60 %)',
      value: `+$${summary.recoveryValue.toLocaleString('en-US')}`,
      tone: 'positive',
    });
  }

  if (summary.interestCharged > 0) {
    const loanBalance: number = summary.loanBalance ?? 0;
    const label: string = loanBalance > 0
      ? `Loan interest (balance: $${Math.round(loanBalance).toLocaleString('en-US')})`
      : 'Loan interest';
    rows.push({
      label,
      value: `−$${Math.round(summary.interestCharged).toLocaleString('en-US')}`,
      tone: 'negative',
    });
  }

  if (summary.deathFineTotal > 0) {
    rows.push({
      label: 'Crew death fines',
      value: `−$${summary.deathFineTotal.toLocaleString('en-US')}`,
      tone: 'negative',
    });
  }

  if (summary.operatingCosts > 0) {
    if (summary.crewSalaryCost > 0) {
      const crewLabel: string = summary.activeCrewCount === 1
        ? 'Crew salaries (1 astronaut)'
        : `Crew salaries (${summary.activeCrewCount} astronauts)`;
      rows.push({
        label: crewLabel,
        value: `−$${summary.crewSalaryCost.toLocaleString('en-US')}`,
        tone: 'negative',
      });
    }
    if (summary.facilityUpkeep > 0) {
      rows.push({
        label: 'Facility upkeep',
        value: `−$${summary.facilityUpkeep.toLocaleString('en-US')}`,
        tone: 'negative',
      });
    }
  }

  return rows;
}

export interface NetCashChangeDisplay {
  label: string;
  value: string;
  /** True when the net change is non-negative (drives CSS class selection). */
  positive: boolean;
}

/**
 * Format the net-cash-change row shown below the per-line financial
 * breakdown.  Uses the unicode minus sign (−) rather than a hyphen to
 * match the per-line rows.
 */
export function formatNetCashChange(netCashChange: number): NetCashChangeDisplay {
  const positive: boolean = netCashChange >= 0;
  const sign: string = positive ? '+' : '−';
  const value: string = `${sign}$${Math.abs(Math.round(netCashChange)).toLocaleString('en-US')}`;
  return { label: 'Net cash change', value, positive };
}

// ---------------------------------------------------------------------------
// Facility action classification
// ---------------------------------------------------------------------------

/**
 * The user-facing action variant shown for a facility in the construction
 * panel.  `hub.ts` dispatches on this to decide which DOM controls to
 * render (upgrade button, build button, badge, etc.).
 */
export type FacilityActionKind =
  | 'upgrade'    // built, upgrade available
  | 'max-tier'  // built, upgradeable definition exists but at max tier
  | 'built'     // built, no upgrades defined
  | 'locked'    // not built, tutorial mode — wait for mission unlock
  | 'build';    // not built, can purchase

/**
 * Classify the action shown for a facility row given the three boolean
 * inputs the UI already computes (facility built? upgradeable? what is
 * the next tier?).  `hasUpgradeDef` is true when the facility has any
 * upgrade schedule at all (so "Max Tier" can be distinguished from a
 * plain "Built" badge when the player is fully upgraded).
 */
export function classifyFacilityAction(
  isBuilt: boolean,
  hasUpgradeDef: boolean,
  nextTier: number,
  tutorialMode: boolean,
): FacilityActionKind {
  if (isBuilt) {
    if (nextTier > 0) return 'upgrade';
    if (hasUpgradeDef) return 'max-tier';
    return 'built';
  }
  if (tutorialMode) return 'locked';
  return 'build';
}

// ---------------------------------------------------------------------------
// Build-cost formatting (purchase)
// ---------------------------------------------------------------------------

export interface BuildCostDisplay {
  /** The primary cost label shown to the user ("Free" or "$X"). */
  costLabel: string;
  /** True when the facility costs zero dollars. */
  isFree: boolean;
  /** True when a reputation discount is currently active. */
  hasDiscount: boolean;
  /** The "(was $Y)" note to show alongside the discounted price, or null. */
  discountNote: string | null;
}

/**
 * Format the cost column for a facility build row.  Handles the free
 * case, the plain case, and the reputation-discounted case.
 */
export function formatBuildCost(baseCost: number, discountedCost: number): BuildCostDisplay {
  const isFree: boolean = baseCost === 0;
  const hasDiscount: boolean = baseCost > 0 && discountedCost < baseCost;
  return {
    costLabel:    isFree ? 'Free' : `$${discountedCost.toLocaleString('en-US')}`,
    isFree,
    hasDiscount,
    discountNote: hasDiscount ? `(was $${baseCost.toLocaleString('en-US')})` : null,
  };
}

// ---------------------------------------------------------------------------
// Upgrade-action formatting
// ---------------------------------------------------------------------------

export interface UpgradeActionDisplay {
  /** Button label ("Upgrade to Tier N"). */
  buttonLabel: string;
  /** Whether the button is enabled for the player. */
  enabled: boolean;
  /** Title/tooltip shown when the button is disabled. */
  disabledTooltip: string | null;
}

/**
 * Format the upgrade action button for a facility.  Mirrors the UI
 * behaviour in `hub.ts`: the tooltip is set only when the button is
 * disabled (driven directly by `allowed`).
 */
export function formatUpgradeAction(
  nextTier: number,
  allowed: boolean,
  reason: string,
): UpgradeActionDisplay {
  return {
    buttonLabel:     `Upgrade to Tier ${nextTier}`,
    enabled:         allowed,
    disabledTooltip: allowed ? null : reason,
  };
}
