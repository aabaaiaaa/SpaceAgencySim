/**
 * period.js — Period (flight) advancement and operating costs.
 *
 * A "period" equals one completed flight.  The period counter advances only
 * when the player finishes a flight and returns to the Space Agency hub.
 * Time-warping does NOT advance the counter.
 *
 * Each period-end charges:
 *   1. Crew salaries — $5,000 per ACTIVE astronaut.
 *   2. Facility upkeep — $10,000 base (future: scales with upgrades).
 *
 * These costs are mandatory: if the player cannot cover them, cash goes
 * negative, creating financial pressure.
 *
 * @module core/period
 */

import { AstronautStatus, CREW_SALARY_PER_PERIOD, FACILITY_UPKEEP_PER_PERIOD } from './constants.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PeriodSummary
 * @property {number} newPeriod        - The period number after advancement.
 * @property {number} crewSalaryCost   - Total crew salary charged this period.
 * @property {number} facilityUpkeep   - Facility upkeep charged this period.
 * @property {number} totalOperatingCost - Sum of all operating costs.
 * @property {number} activeCrewCount  - Number of active crew members charged.
 * @property {string[]} expiredMissionIds - IDs of missions that expired this period.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Advance the period counter by one and apply all period-end costs.
 *
 * Call this once per flight return, inside `processFlightReturn()`.
 *
 * Side effects on `state`:
 *   - Increments `state.currentPeriod`.
 *   - Deducts crew salaries and facility upkeep from `state.money`.
 *     These deductions are mandatory and can drive cash below zero.
 *   - Moves deadline-expired accepted missions to the EXPIRED state
 *     (infrastructure ready for TASK-008 contract system).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {PeriodSummary}
 */
export function advancePeriod(state) {
  // ── 1. Increment the period counter ────────────────────────────────────
  state.currentPeriod = (state.currentPeriod ?? 0) + 1;

  // ── 2. Crew salaries ──────────────────────────────────────────────────
  const activeCrew = state.crew.filter(
    (c) => c.status === AstronautStatus.ACTIVE,
  );
  const crewSalaryCost = activeCrew.length * CREW_SALARY_PER_PERIOD;

  // ── 3. Facility upkeep — base cost per built facility ─────────────────
  const builtCount = state.facilities
    ? Object.values(state.facilities).filter((f) => f.built).length
    : 1; // fallback for legacy saves
  const facilityUpkeep = FACILITY_UPKEEP_PER_PERIOD * builtCount;

  // ── 4. Deduct operating costs (mandatory — can go negative) ───────────
  const totalOperatingCost = crewSalaryCost + facilityUpkeep;
  state.money -= totalOperatingCost;

  // ── 5. Expire deadline-passed missions ────────────────────────────────
  //    Missions store a `deadlinePeriod` (number) once the contract system
  //    (TASK-008) is implemented.  For now, check if the field exists and
  //    expire any missions whose deadline period has been reached.
  const expiredMissionIds = [];
  if (Array.isArray(state.missions.accepted)) {
    for (const mission of state.missions.accepted) {
      if (
        typeof mission.deadlinePeriod === 'number' &&
        state.currentPeriod > mission.deadlinePeriod
      ) {
        mission.state = 'EXPIRED';
        expiredMissionIds.push(mission.id);
      }
    }
    // Remove expired missions from the accepted list.
    if (expiredMissionIds.length > 0) {
      state.missions.accepted = state.missions.accepted.filter(
        (m) => !expiredMissionIds.includes(m.id),
      );
    }
  }

  return {
    newPeriod: state.currentPeriod,
    crewSalaryCost,
    facilityUpkeep,
    totalOperatingCost,
    activeCrewCount: activeCrew.length,
    expiredMissionIds,
  };
}
