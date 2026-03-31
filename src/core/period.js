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

import { AstronautStatus, CREW_SALARY_PER_PERIOD, FACILITY_UPKEEP_PER_PERIOD, FacilityId } from './constants.js';
import { expireBoardContracts, expireActiveContracts } from './contracts.js';
import { isBankrupt } from './finance.js';
import { processSatelliteNetwork } from './satellites.js';
import { checkInjuryRecovery, processTraining } from './crew.js';
import { getFacilityTier } from './construction.js';
import { processSurfaceOps } from './surfaceOps.js';
import { processLifeSupport } from './lifeSupport.js';
import { getFinancialMultipliers } from './settings.js';

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
 * @property {string[]} expiredBoardContractIds - Board contract IDs that expired this period.
 * @property {string[]} expiredActiveContractIds - Active contract IDs that expired this period.
 * @property {number}   satelliteMaintenanceCost - Satellite auto-maintenance cost this period.
 * @property {number}   satelliteScienceEarned  - Passive science from Science satellites.
 * @property {number}   satelliteLeaseIncome    - Income from leased satellites this period.
 * @property {string[]} decommissionedSatellites - Satellite IDs that reached 0 health.
 * @property {string[]} healedCrewIds  - IDs of crew members whose injuries were cleared.
 * @property {number}   trainingCost  - Total crew training cost this period (0 — courses are paid upfront).
 * @property {Array<{id: string, name: string, skill: string, gain: number, completed: boolean}>} trainees - Training status; completed entries received their skill gain.
 * @property {Array<{craftId: string, craftName: string, suppliesRemaining: number, crewIds: string[]}>} lifeSupportWarnings - Field craft with critically low supplies.
 * @property {Array<{craftId: string, craftName: string, crewId: string, crewName: string}>} lifeSupportDeaths - Crew who died from life support exhaustion.
 * @property {boolean} bankrupt        - True if the player is bankrupt after this period.
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

  // ── 2. Crew salaries (use per-astronaut salary, fallback to constant) ──
  const { costMult } = getFinancialMultipliers(state);
  const activeCrew = state.crew.filter(
    (c) => c.status === AstronautStatus.ACTIVE,
  );
  const crewSalaryCost = Math.round(activeCrew.reduce(
    (sum, c) => sum + (c.salary ?? CREW_SALARY_PER_PERIOD),
    0,
  ) * costMult);

  // ── 3. Facility upkeep — base cost per built facility ─────────────────
  const builtCount = state.facilities
    ? Object.values(state.facilities).filter((f) => f.built).length
    : 1; // fallback for legacy saves
  const facilityUpkeep = Math.round(FACILITY_UPKEEP_PER_PERIOD * builtCount * costMult);

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

  // ── 6. Expire contracts ────────────────────────────────────────────────
  const expiredBoardContractIds = expireBoardContracts(state);
  const expiredActiveContractIds = expireActiveContracts(state);

  // ── 7. Satellite network — degradation, maintenance, passive science ─
  const satResult = processSatelliteNetwork(state);

  // ── 8. Crew injury recovery — clear injuries whose period has elapsed ─
  const healedCrewIds = checkInjuryRecovery(state);

  // ── 9. Crew training — award XP and charge training costs (Tier 2+) ──
  const crewAdminTier = getFacilityTier(state, FacilityId.CREW_ADMIN);
  const trainingResult = crewAdminTier >= 2 ? processTraining(state) : { trainingCost: 0, trainees: [] };

  // ── 10. Surface operations — passive science from deployed instruments ─
  const surfaceResult = processSurfaceOps(state);

  // ── 11. Life support — tick down supplies for crewed field vessels ─────
  const lifeSupportResult = processLifeSupport(state);

  // ── 12. Bankruptcy check ──────────────────────────────────────────────
  const bankrupt = isBankrupt(state);

  return {
    newPeriod: state.currentPeriod,
    crewSalaryCost,
    facilityUpkeep,
    totalOperatingCost,
    activeCrewCount: activeCrew.length,
    expiredMissionIds,
    expiredBoardContractIds,
    expiredActiveContractIds,
    satelliteMaintenanceCost: satResult.maintenanceCost,
    satelliteScienceEarned: satResult.scienceEarned,
    satelliteLeaseIncome: satResult.leaseIncome,
    decommissionedSatellites: satResult.decommissioned,
    healedCrewIds,
    trainingCost: trainingResult.trainingCost,
    trainees: trainingResult.trainees,
    surfaceScienceEarned: surfaceResult.scienceEarned,
    lifeSupportWarnings: lifeSupportResult.warnings,
    lifeSupportDeaths: lifeSupportResult.deaths,
    bankrupt,
  };
}
