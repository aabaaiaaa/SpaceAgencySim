/**
 * period.ts — Period (flight) advancement and operating costs.
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

import { AstronautStatus, CREW_SALARY_PER_PERIOD, FACILITY_UPKEEP_PER_PERIOD, FacilityId } from './constants.ts';
import { expireBoardContracts, expireActiveContracts } from './contracts.ts';
import { isBankrupt } from './finance.ts';
import { processSatelliteNetwork } from './satellites.ts';
import { checkInjuryRecovery, processTraining } from './crew.ts';
import { getFacilityTier } from './construction.ts';
import { processSurfaceOps } from './surfaceOps.ts';
import { processLifeSupport } from './lifeSupport.ts';
import { getFinancialMultipliers } from './settings.ts';
import { processMiningSites, processSurfaceLaunchPads } from './mining.ts';
import { processRefineries } from './refinery.ts';
import { processRoutes } from './routes.ts';
import { processHubMaintenance, processConstructionProjects } from './hubs.ts';
import { processCrewTransits } from './hubCrew.ts';
import { processTouristRevenue } from './hubTourists.ts';

import type { GameState, MissionInstance } from './gameState.ts';
import type { ResourceType } from './constants.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TraineeInfo {
  id: string;
  name: string;
  skill: string;
  gain: number;
  completed: boolean;
}

export interface LifeSupportWarning {
  craftId: string;
  craftName: string;
  suppliesRemaining: number;
  crewIds: string[];
}

export interface LifeSupportDeath {
  craftId: string;
  craftName: string;
  crewId: string;
  crewName: string;
}

export interface PeriodSummary {
  newPeriod: number;
  crewSalaryCost: number;
  facilityUpkeep: number;
  totalOperatingCost: number;
  activeCrewCount: number;
  expiredMissionIds: string[];
  expiredBoardContractIds: string[];
  expiredActiveContractIds: string[];
  satelliteMaintenanceCost: number;
  satelliteScienceEarned: number;
  satelliteLeaseIncome: number;
  decommissionedSatellites: string[];
  healedCrewIds: string[];
  trainingCost: number;
  trainees: TraineeInfo[];
  surfaceScienceEarned: number;
  lifeSupportWarnings: LifeSupportWarning[];
  lifeSupportDeaths: LifeSupportDeath[];
  // Resource system
  miningExtracted: Partial<Record<ResourceType, number>>;
  refineryProduced: Partial<Record<ResourceType, number>>;
  refineryConsumed: Partial<Record<ResourceType, number>>;
  launchPadTransferred: Partial<Record<ResourceType, number>>;
  routeRevenue: number;
  routeOperatingCost: number;
  routeDeliveries: Partial<Record<ResourceType, number>>;
  bankrupt: boolean;
}

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
 */
export function advancePeriod(state: GameState): PeriodSummary {
  // ── 1. Increment the period counter ────────────────────────────────────
  state.currentPeriod = (state.currentPeriod ?? 0) + 1;

  // ── 2. Crew salaries (use per-astronaut salary, fallback to constant) ──
  const { costMult } = getFinancialMultipliers(state);
  const crew = state.crew;
  const activeCrew = crew.filter(
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
  const expiredMissionIds: string[] = [];
  if (Array.isArray(state.missions.accepted)) {
    for (const mission of state.missions.accepted) {
      const m = mission as MissionInstance & { deadlinePeriod?: number };
      if (
        typeof m.deadlinePeriod === 'number' &&
        state.currentPeriod > m.deadlinePeriod
      ) {
        m.state = 'EXPIRED';
        expiredMissionIds.push(m.id);
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
  const satResult = processSatelliteNetwork(state) as {
    maintenanceCost: number;
    scienceEarned: number;
    leaseIncome: number;
    decommissioned: string[];
  };

  // ── 8. Crew injury recovery — clear injuries whose period has elapsed ─
  const healedCrewIds = checkInjuryRecovery(state);

  // ── 9. Crew training — award XP and charge training costs (Tier 2+) ──
  const crewAdminTier = getFacilityTier(state, FacilityId.CREW_ADMIN);
  const trainingResult = crewAdminTier >= 2
    ? processTraining(state)
    : { trainingCost: 0, trainees: [] as TraineeInfo[] };

  // ── 10. Surface operations — passive science from deployed instruments ─
  const surfaceResult = processSurfaceOps(state) as { scienceEarned: number };

  // ── 11. Life support — tick down supplies for crewed field vessels ─────
  const lifeSupportResult = processLifeSupport(state) as {
    warnings: LifeSupportWarning[];
    deaths: LifeSupportDeath[];
  };

  // ── 11c. Hub processing — maintenance, construction, crew transits, tourism ──
  processHubMaintenance(state);
  processConstructionProjects(state);
  processCrewTransits(state);
  processTouristRevenue(state);

  // ── 11d. Resource processing — extraction, refining, launch, transport ──
  const miningResult = processMiningSites(state);
  const refineryResult = processRefineries(state);
  const launchPadResult = processSurfaceLaunchPads(state);
  const routeResult = processRoutes(state);

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
    trainees: trainingResult.trainees as TraineeInfo[],
    surfaceScienceEarned: surfaceResult.scienceEarned,
    lifeSupportWarnings: lifeSupportResult.warnings,
    lifeSupportDeaths: lifeSupportResult.deaths,
    miningExtracted: miningResult.extracted,
    refineryProduced: refineryResult.produced,
    refineryConsumed: refineryResult.consumed,
    launchPadTransferred: launchPadResult.transferred,
    routeRevenue: routeResult.revenue,
    routeOperatingCost: routeResult.operatingCost,
    routeDeliveries: routeResult.delivered,
    bankrupt,
  };
}
