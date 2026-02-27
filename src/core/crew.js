/**
 * crew.js — Astronaut management: hiring, firing, KIA tracking, and assignment.
 *
 * Each astronaut record is persisted in `state.crew` permanently — records are
 * never deleted, even for fired or KIA astronauts, so the full career history
 * is always available.
 *
 * All functions accept the central GameState as their first argument and mutate
 * it in-place, consistent with the patterns in finance.js.
 *
 * @module crew
 */

import { spend, applyDeathFine } from './finance.js';
import { AstronautStatus, HIRE_COST } from './constants.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate a UUID v4 string.
 * Uses `crypto.randomUUID()` when available (browsers, Node 14.17+), with a
 * simple RFC 4122-compliant fallback for environments that lack the Web Crypto
 * API (e.g. older test runners).
 *
 * @returns {string}
 */
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * A single astronaut record.
 *
 * Records are persisted in `state.crew` for the lifetime of the save. Fired
 * and KIA records remain permanently so they appear in the crew history screen.
 *
 * @typedef {Object} Astronaut
 * @property {string}                        id               - UUID.
 * @property {string}                        name             - Display name.
 * @property {string}                        hireDate         - ISO 8601 date hired.
 * @property {import('./constants.js').AstronautStatus} status - Career status.
 * @property {number}                        missionsFlown    - Number of completed missions.
 * @property {number}                        flightsFlown     - Number of flights taken.
 * @property {string|null}                   deathDate        - ISO 8601 date of death, or null.
 * @property {string|null}                   deathCause       - Cause of death, or null.
 * @property {string|null}                   assignedRocketId - Rocket design ID, or null if unassigned.
 */

// ---------------------------------------------------------------------------
// Internal factory
// ---------------------------------------------------------------------------

/**
 * Build a fresh astronaut record with default values.
 * External callers should use `hireCrew()`, which also handles payment.
 *
 * @param {{ name: string, hireDate?: string }} opts
 * @returns {Astronaut}
 */
function createAstronaut({ name, hireDate = new Date().toISOString() }) {
  return {
    id: generateUUID(),
    name,
    hireDate,
    status: AstronautStatus.ACTIVE,
    missionsFlown: 0,
    flightsFlown: 0,
    deathDate: null,
    deathCause: null,
    assignedRocketId: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hire a new astronaut.
 *
 * Deducts $50,000 from the player's cash via `spend()`. If the player cannot
 * afford the fee, no astronaut is added and the function returns a failure
 * result (cash is not modified).
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} name  Display name for the new astronaut.
 * @returns {{ success: boolean, astronaut?: Astronaut, error?: string }}
 */
export function hireCrew(state, name) {
  const ok = spend(state, HIRE_COST);
  if (!ok) {
    return { success: false, error: 'Insufficient funds to hire astronaut.' };
  }

  const astronaut = createAstronaut({ name });
  state.crew.push(astronaut);
  return { success: true, astronaut };
}

/**
 * Fire an astronaut.
 *
 * Sets the astronaut's status to `'fired'` and clears their rocket assignment.
 * There is no financial cost. Only active astronauts can be fired; the function
 * returns `false` if the ID is not found or the astronaut is already fired/KIA.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id  Astronaut ID.
 * @returns {boolean}  `true` if the astronaut was fired successfully.
 */
export function fireCrew(state, id) {
  const astronaut = state.crew.find((a) => a.id === id);
  if (!astronaut || astronaut.status !== AstronautStatus.ACTIVE) return false;
  astronaut.status = AstronautStatus.FIRED;
  astronaut.assignedRocketId = null;
  return true;
}

/**
 * Record an astronaut as killed in action.
 *
 * Sets status to `'kia'`, records the current timestamp as `deathDate`, stores
 * `cause` in `deathCause`, clears the rocket assignment, and immediately applies
 * the $500,000 government fine via `applyDeathFine(state, 1)`.
 *
 * Note: the fine is always applied even if it drives the player's cash negative.
 *
 * Returns `false` if the ID is not found or the astronaut is already KIA.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id     Astronaut ID.
 * @param {string} cause  Human-readable description of the cause of death.
 * @returns {boolean}  `true` if the record was updated successfully.
 */
export function recordKIA(state, id, cause) {
  const astronaut = state.crew.find((a) => a.id === id);
  if (!astronaut || astronaut.status === AstronautStatus.KIA) return false;
  astronaut.status = AstronautStatus.KIA;
  astronaut.deathDate = new Date().toISOString();
  astronaut.deathCause = cause;
  astronaut.assignedRocketId = null;
  applyDeathFine(state, 1);
  return true;
}

/**
 * Assign an astronaut to a rocket design.
 *
 * Stores `rocketId` on the astronaut so flight systems can assemble a crew list
 * from `state.crew`. Only active astronauts can be assigned.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} astronautId  Astronaut ID.
 * @param {string} rocketId     Rocket design ID.
 * @returns {boolean}  `true` if the astronaut was assigned.
 */
export function assignToCrew(state, astronautId, rocketId) {
  const astronaut = state.crew.find((a) => a.id === astronautId);
  if (!astronaut || astronaut.status !== AstronautStatus.ACTIVE) return false;
  astronaut.assignedRocketId = rocketId;
  return true;
}

/**
 * Unassign an astronaut from their rocket.
 *
 * Clears `assignedRocketId`. Succeeds for any astronaut regardless of status
 * (useful for cleanup after a flight ends).
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} astronautId  Astronaut ID.
 * @returns {boolean}  `true` if the astronaut was found and unassigned.
 */
export function unassignCrew(state, astronautId) {
  const astronaut = state.crew.find((a) => a.id === astronautId);
  if (!astronaut) return false;
  astronaut.assignedRocketId = null;
  return true;
}

/**
 * Get all currently active (employed and alive) astronauts.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {Astronaut[]}
 */
export function getActiveCrew(state) {
  return state.crew.filter((a) => a.status === AstronautStatus.ACTIVE);
}

/**
 * Get the full crew history — active, fired, and KIA records.
 *
 * Returns a shallow copy of the array so callers cannot accidentally push to
 * `state.crew` directly. Individual record objects are still references to the
 * live state, so do not mutate them outside of the crew API.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {Astronaut[]}
 */
export function getFullHistory(state) {
  return [...state.crew];
}
