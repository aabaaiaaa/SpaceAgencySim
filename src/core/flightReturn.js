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
import { getPartById } from '../data/parts.js';
import { PartType, DEATH_FINE_PER_ASTRONAUT, FlightOutcome } from './constants.js';

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
 * @property {number}  netCashChange   - Net change in state.money (positive = gained).
 * @property {number}  totalFlights    - New total flight count (state.flightHistory.length).
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
  if (isLanded && assembly) {
    for (const [instanceId, placed] of assembly.parts) {
      if (!ps.activeParts.has(instanceId)) continue;
      const def = getPartById(placed.partId);
      if (!def) continue;
      recoveryValue += Math.round((def.cost ?? 0) * 0.6);
    }
    if (recoveryValue > 0) {
      earn(state, recoveryValue);
    }
  }

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

  // ── 6b. Accumulate in-game flight time ──────────────────────────────────
  const flightSeconds = flightState?.timeElapsed ?? 0;
  state.flightTimeSeconds = (state.flightTimeSeconds ?? 0) + flightSeconds;

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
    loanBalance:   state.loan?.balance ?? 0,
    deathFineTotal,
    netCashChange: state.money - cashBefore,
    totalFlights:  state.flightHistory.length,
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
