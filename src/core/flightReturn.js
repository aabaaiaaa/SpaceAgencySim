/**
 * flightReturn.js — End-of-flight game-state processing.
 *
 * Called once when the player dismisses the post-flight summary and returns
 * to the Space Agency hub.  Responsible for:
 *
 *   1. Completing any accepted missions whose objectives were all met.
 *   2. Crediting mission rewards (delegated to completeMission → finance.earn).
 *   3. Unlocking downstream missions and parts (delegated to completeMission).
 *   4. Crediting part-recovery cash (60 % of cost for each intact landed part).
 *   5. Applying loan interest — once per flight.
 *   6. Applying death fines for KIA crew (if not already charged mid-flight).
 *   7. Recording the flight in state.flightHistory and clearing currentFlight.
 *
 * The function is pure in the sense that every mutation goes through the
 * established finance / mission helpers so that the logic is testable in
 * isolation.
 *
 * @module core/flightReturn
 */

import { completeMission } from './missions.js';
import { earn, applyInterest, applyDeathFine } from './finance.js';
import { advancePeriod } from './period.js';
import { initWeather } from './weather.js';
import { getPartById } from '../data/parts.js';
import { PartType, DEATH_FINE_PER_ASTRONAUT, FlightOutcome } from './constants.js';
import { processContractCompletions, generateContracts } from './contracts.js';
import { deploySatellitesFromFlight } from './satellites.js';
import { awardFlightXP, getMaxCrewSkill, processFlightInjuries } from './crew.js';
import { recoverPartsToInventory } from './partInventory.js';
import {
  applyCrewDeathReputation,
  applySafeCrewReturnReputation,
  applyMissionFailureReputation,
  applyRocketDestructionReputation,
} from './reputation.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CompletedMissionEntry
 * @property {import('../data/missions.js').MissionDef} mission  - The completed mission instance.
 * @property {number}   reward                 - Cash reward earned.
 * @property {string[]} unlockedParts          - Part IDs newly unlocked.
 * @property {import('../data/missions.js').MissionDef[]} newlyAvailableMissions - Missions now visible.
 */

/**
 * @typedef {Object} FlightReturnSummary
 * @property {CompletedMissionEntry[]} completedMissions  - Missions completed this flight.
 * @property {number}  recoveryValue   - Cash credited for landed parts.
 * @property {number}  interestCharged - Total interest added to the loan.
 * @property {number}  loanBalance     - Loan balance after interest is applied.
 * @property {number}  deathFineTotal  - Total death fines applied.
 * @property {number}  operatingCosts  - Total operating costs charged (salaries + upkeep).
 * @property {number}  crewSalaryCost  - Crew salary portion of operating costs.
 * @property {number}  facilityUpkeep  - Facility upkeep portion of operating costs.
 * @property {number}  activeCrewCount - Number of active crew charged salaries.
 * @property {number}  netCashChange   - Net change in state.money (positive = gained).
 * @property {number}  totalFlights    - New total flight count (state.flightHistory.length).
 * @property {number}  currentPeriod   - Period number after this flight.
 * @property {string[]} expiredMissionIds - Mission IDs that expired this period.
 * @property {Array<{contract: import('./gameState.js').Contract, reward: number}>} completedContracts - Contracts completed this flight.
 * @property {import('./gameState.js').Contract[]} newContracts - Newly generated board contracts.
 * @property {boolean}  bankrupt        - True if the player is bankrupt after this flight.
 * @property {Array<{satelliteId: string, satelliteType: string}>} deployedSatellites - Satellites deployed during this flight.
 * @property {Array<{id: string, name: string, piloting: number, engineering: number, science: number}>} crewXPGains - Skill XP gains per crew member.
 * @property {Array<{crewId: string, crewName: string, cause: string, periods: number, altitude: number}>} crewInjuries - Crew injuries sustained this flight.
 * @property {import('./gameState.js').InventoryPart[]} recoveredParts - Parts recovered to inventory.
 * @property {number}  reputationChange - Net reputation change this flight.
 * @property {number}  reputationAfter  - Reputation value after all changes.
 */

/**
 * Process all end-of-flight game-state changes and return a human-readable
 * summary suitable for display in the "Return Results" overlay.
 *
 * Side effects (on `state`):
 *   - Moves completed missions from accepted → completed bucket.
 *   - Adds mission rewards, part recovery, and loan interest to state.money / state.loan.
 *   - Pushes newly-unlocked parts into state.parts.
 *   - Appends a FlightResult record to state.flightHistory.
 *   - Clears state.currentFlight to null.
 *
 * @param {import('./gameState.js').GameState}                      state
 * @param {import('./gameState.js').FlightState}                    flightState  Live flight state at end of flight.
 * @param {import('./physics.js').PhysicsState|null}                ps           Physics state (null if unavailable).
 * @param {import('../core/rocketbuilder.js').RocketAssembly|null}  assembly     Rocket assembly (null if unavailable).
 * @returns {FlightReturnSummary}
 */
export function processFlightReturn(state, flightState, ps, assembly) {
  const cashBefore = state.money;
  const repBefore = state.reputation ?? 50;

  /** @type {CompletedMissionEntry[]} */
  const completedMissions = [];
  let recoveryValue    = 0;
  let interestCharged  = 0;
  let deathFineTotal   = 0;

  // ── 1 & 2 & 3. Mission completion, rewards, and unlocks ──────────────────
  // Snapshot the accepted list before iterating, since completeMission()
  // mutates it by splicing completed missions out.
  const acceptedSnapshot = [...state.missions.accepted];
  for (const mission of acceptedSnapshot) {
    const allObjectivesMet =
      Array.isArray(mission.objectives) &&
      mission.objectives.length > 0 &&
      mission.objectives.every((obj) => obj.completed);

    if (allObjectivesMet) {
      const result = completeMission(state, mission.id);

      if (result.success) {
        completedMissions.push({
          mission:                result.mission,
          reward:                 result.reward,
          unlockedParts:          result.unlockedParts,
          newlyAvailableMissions: result.newlyUnlockedMissions,
        });
      }
    }
  }

  // ── 4. Part recovery (landed safely only) ────────────────────────────────
  const isLanded = !!(ps && ps.landed && !ps.crashed);
  let partsRecovered = 0;
  /** @type {import('./gameState.js').InventoryPart[]} */
  let recoveredParts = [];
  if (isLanded && assembly) {
    // Engineering skill bonus: recovery value scales from 60% to 80%.
    const crewIds = flightState?.crewIds ?? [];
    const engSkill = getMaxCrewSkill(state, crewIds, 'engineering');
    const recoveryFrac = 0.6 + (engSkill / 100) * 0.2;

    // Cash recovery for all intact parts.
    for (const [instanceId, placed] of assembly.parts) {
      if (!ps.activeParts.has(instanceId)) continue;
      const def = getPartById(placed.partId);
      if (!def) continue;
      recoveryValue += Math.round((def.cost ?? 0) * recoveryFrac);
    }
    if (recoveryValue > 0) {
      earn(state, recoveryValue);
    }

    // Add recovered parts to inventory with wear tracking.
    // _usedInventoryParts is attached to ps by the VAB at launch time.
    const usedInventoryParts = ps._usedInventoryParts ?? null;
    const result = recoverPartsToInventory(state, assembly, ps, usedInventoryParts);
    partsRecovered = result.partsRecovered;
    recoveredParts = result.entries;
  }

  // ── 4b. Crew skill XP awards ──────────────────────────────────────────────
  const flightEvents = flightState?.events ?? [];
  const stagingEvents = flightEvents.filter((e) => e.type === 'PART_ACTIVATED').length;
  const scienceActivations = flightEvents.filter((e) =>
    e.type === 'PART_ACTIVATED' && e.partType === PartType.SERVICE_MODULE
  ).length;
  const scienceReturns = flightEvents.filter((e) =>
    e.type === 'SCIENCE_DATA_RETURNED' || e.type === 'SCIENCE_TRANSMITTED'
  ).length;

  const survivingCrewIds = (flightState?.crewIds ?? []).filter((id) => {
    const ejectedIds = ps?.ejectedCrewIds ?? new Set();
    // Only award XP to crew who survived (not KIA).
    if (ps?.crashed && !ejectedIds.has(id)) return false;
    return true;
  });

  const crewXPGains = awardFlightXP(state, survivingCrewIds, {
    safeLanding: isLanded,
    stagingEvents,
    partsRecovered,
    scienceReturns,
    scienceActivations,
  });

  // ── 4c. Crew injury processing ────────────────────────────────────────────
  const crewInjuries = processFlightInjuries(state, flightState, ps);

  // ── 5. Loan interest — once per flight ───────────────────────────────────
  if (state.loan && state.loan.balance > 0) {
    const cashBefore2 = state.money;
    const loanBefore  = state.loan.balance;
    applyInterest(state);
    interestCharged = (cashBefore2 - state.money) + (state.loan.balance - loanBefore);
  }

  // ── 6. Death fines (if not already applied mid-flight) ───────────────────
  if (flightState && !flightState.deathFinesApplied) {
    const isCrashed      = !!(ps && ps.crashed);
    const allCmdLost     = _allCommandModulesDestroyed(ps, assembly);

    if (isCrashed || allCmdLost) {
      const ejectedIds = (ps && ps.ejectedCrewIds) ? ps.ejectedCrewIds : new Set();
      const crewIds    = Array.isArray(flightState.crewIds) ? flightState.crewIds : [];
      const kiaCount   = crewIds.filter((id) => !ejectedIds.has(id)).length;

      if (kiaCount > 0) {
        applyDeathFine(state, kiaCount);
        deathFineTotal = kiaCount * DEATH_FINE_PER_ASTRONAUT;
      }
    }

    // Mark as applied so double-processing is impossible.
    flightState.deathFinesApplied = true;
  }

  // ── 6a. Reputation events ──────────────────────────────────────────────
  {
    const isCrashed = !!(ps && ps.crashed);
    const crewIds = Array.isArray(flightState?.crewIds) ? flightState.crewIds : [];
    const ejectedIds = ps?.ejectedCrewIds ?? new Set();
    const kiaCount = isCrashed ? crewIds.filter((id) => !ejectedIds.has(id)).length : 0;

    // Crew death: −10 per KIA.
    if (kiaCount > 0) {
      applyCrewDeathReputation(state, kiaCount);
    }

    // Safe crew return: +1 per surviving crew member on a safe landing.
    if (isLanded && crewIds.length > 0) {
      const safeCount = crewIds.length - kiaCount;
      if (safeCount > 0) {
        applySafeCrewReturnReputation(state, safeCount);
      }
    }

    // Rocket destruction without recovery: −2.
    if (isCrashed && !isLanded) {
      applyRocketDestructionReputation(state);
    }

    // Mission/contract failure: −3 if the flight ended without completing
    // any missions or contracts (outcome = FAILURE).
    const outcome = _determineOutcome(ps, completedMissions.length > 0);
    if (outcome === FlightOutcome.FAILURE) {
      applyMissionFailureReputation(state);
    }
  }

  // ── 6b. Contract completions ───────────────────────────────────────────
  const contractResult = processContractCompletions(state);

  // ── 6c. Advance the period counter and charge operating costs ─────────
  const periodSummary = advancePeriod(state);

  // ── 6d. Generate new contracts for the board ──────────────────────────
  const newContracts = generateContracts(state);

  // ── 6e. Deploy satellites released during this flight ─────────────────
  const deployedSatellites = deploySatellitesFromFlight(state, flightState);

  // ── 6f. Accumulate in-game flight time ──────────────────────────────────
  const flightSeconds = flightState?.timeElapsed ?? 0;
  state.flightTimeSeconds = (state.flightTimeSeconds ?? 0) + flightSeconds;

  // ── 6g. Reroll weather for the new day (resets skip counter) ───────────
  initWeather(state, flightState?.bodyId ?? 'EARTH');

  // ── 7. Record flight history and clear active flight ─────────────────────
  const outcome = _determineOutcome(ps, completedMissions.length > 0);

  const missionRevenueTotal = completedMissions.reduce((sum, e) => sum + e.reward, 0);

  /** @type {import('./gameState.js').FlightResult} */
  const flightResult = {
    id:          _generateId(),
    missionId:   (flightState && flightState.missionId)  ?? '',
    rocketId:    (flightState && flightState.rocketId)   ?? '',
    crewIds:     (flightState && flightState.crewIds)     ?? [],
    launchDate:  new Date().toISOString(),
    outcome,
    deltaVUsed:  0,
    revenue:     missionRevenueTotal + recoveryValue,
    notes:       '',
  };

  if (!Array.isArray(state.flightHistory)) {
    state.flightHistory = [];
  }
  state.flightHistory.push(flightResult);

  // Clear the active flight.
  state.currentFlight = null;

  // ── Return summary ────────────────────────────────────────────────────────
  return {
    completedMissions,
    recoveryValue,
    interestCharged,
    loanBalance:       state.loan?.balance ?? 0,
    deathFineTotal,
    operatingCosts:    periodSummary.totalOperatingCost,
    crewSalaryCost:    periodSummary.crewSalaryCost,
    facilityUpkeep:    periodSummary.facilityUpkeep,
    activeCrewCount:   periodSummary.activeCrewCount,
    netCashChange:     state.money - cashBefore,
    totalFlights:      state.flightHistory.length,
    currentPeriod:     periodSummary.newPeriod,
    expiredMissionIds: periodSummary.expiredMissionIds,
    completedContracts: contractResult.completedContracts,
    newContracts,
    bankrupt: periodSummary.bankrupt,
    deployedSatellites,
    crewXPGains,
    crewInjuries,
    recoveredParts,
    reputationChange: (state.reputation ?? 50) - repBefore,
    reputationAfter:  state.reputation ?? 50,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the assembly had at least one COMMAND_MODULE and all of
 * them are absent from `ps.activeParts` (destroyed or separated).
 *
 * @param {import('./physics.js').PhysicsState|null}               ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly|null} assembly
 * @returns {boolean}
 */
function _allCommandModulesDestroyed(ps, assembly) {
  if (!assembly || !ps) return false;

  let hadCommandModule = false;

  for (const [instanceId, placed] of assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;

    hadCommandModule = true;
    if (ps.activeParts.has(instanceId)) {
      // At least one command module is still active.
      return false;
    }
  }

  return hadCommandModule;
}

/**
 * Derive the flight outcome from physics state and mission completion.
 *
 * @param {import('./physics.js').PhysicsState|null} ps
 * @param {boolean} missionsCompleted  Whether at least one mission was completed.
 * @returns {string}  One of the FlightOutcome enum values.
 */
function _determineOutcome(ps, missionsCompleted) {
  if (!ps) {
    return missionsCompleted ? FlightOutcome.SUCCESS : FlightOutcome.FAILURE;
  }

  const landed  = ps.landed  && !ps.crashed;
  const crashed = ps.crashed;

  if (landed && missionsCompleted)  return FlightOutcome.SUCCESS;
  if (landed && !missionsCompleted) return FlightOutcome.PARTIAL_SUCCESS;
  if (crashed && missionsCompleted) return FlightOutcome.PARTIAL_SUCCESS;
  return FlightOutcome.FAILURE;
}

/**
 * Generate a unique ID for a flight history record.
 * Uses crypto.randomUUID when available; falls back to a timestamp string.
 *
 * @returns {string}
 */
function _generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `flight-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
