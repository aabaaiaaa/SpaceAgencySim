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
import { AstronautStatus, HIRE_COST, CREW_SALARY_PER_PERIOD } from './constants.js';

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
 * @property {number}                        salary           - Per-period salary (dollars).
 * @property {number}                        missionsFlown    - Number of completed missions.
 * @property {number}                        flightsFlown     - Number of flights taken.
 * @property {string|null}                   deathDate        - ISO 8601 date of death, or null.
 * @property {string|null}                   deathCause       - Cause of death, or null.
 * @property {string|null}                   assignedRocketId - Rocket design ID, or null if unassigned.
 * @property {{ piloting: number, engineering: number, science: number }} skills
 *           Skill levels (0–100). Gains apply diminishing returns.
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
function createAstronaut({ name, salary = CREW_SALARY_PER_PERIOD, hireDate = new Date().toISOString() }) {
  return {
    id: generateUUID(),
    name,
    hireDate,
    status: AstronautStatus.ACTIVE,
    salary,
    missionsFlown: 0,
    flightsFlown: 0,
    deathDate: null,
    deathCause: null,
    assignedRocketId: null,
    skills: { piloting: 0, engineering: 0, science: 0 },
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

// ---------------------------------------------------------------------------
// Skill progression
// ---------------------------------------------------------------------------

/**
 * Apply diminishing-returns XP gain to a specific skill.
 * Effective XP = rawXP × (100 - currentSkill) / 100.
 * At skill 0 → 100 % gain; at skill 90 → 10 % gain; at skill 100 → 0.
 *
 * @param {Astronaut} astronaut
 * @param {'piloting'|'engineering'|'science'} skill
 * @param {number} rawXP  Base XP before diminishing returns.
 */
export function awardSkillXP(astronaut, skill, rawXP) {
  if (!astronaut.skills) astronaut.skills = { piloting: 0, engineering: 0, science: 0 };
  const current = astronaut.skills[skill] ?? 0;
  const effective = rawXP * (100 - current) / 100;
  astronaut.skills[skill] = Math.min(100, current + effective);
}

/**
 * Award XP to all crew members who flew on a completed flight.
 *
 * XP sources:
 *   Piloting:    +5 safe landing, +3 per flight, +2 per staging event
 *   Engineering: +3 per part recovered, +2 per staging event
 *   Science:     +5 per science data return, +3 per science activation
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string[]} crewIds              IDs of crew who flew.
 * @param {object}   flightStats          Summary of flight events.
 * @param {boolean}  flightStats.safeLanding      Whether the rocket landed safely.
 * @param {number}   flightStats.stagingEvents    Number of staging events.
 * @param {number}   flightStats.partsRecovered   Number of parts recovered.
 * @param {number}   flightStats.scienceReturns   Number of science data returns.
 * @param {number}   flightStats.scienceActivations Number of science activations.
 * @returns {{ id: string, name: string, piloting: number, engineering: number, science: number }[]}
 *   Skill gains per crew member (for display in the summary).
 */
export function awardFlightXP(state, crewIds, flightStats) {
  const results = [];

  for (const crewId of crewIds) {
    const astronaut = state.crew.find((a) => a.id === crewId);
    if (!astronaut || astronaut.status !== AstronautStatus.ACTIVE) continue;

    const before = {
      piloting: astronaut.skills?.piloting ?? 0,
      engineering: astronaut.skills?.engineering ?? 0,
      science: astronaut.skills?.science ?? 0,
    };

    // Piloting XP
    awardSkillXP(astronaut, 'piloting', 3); // per flight
    if (flightStats.safeLanding) awardSkillXP(astronaut, 'piloting', 5);
    for (let i = 0; i < flightStats.stagingEvents; i++) {
      awardSkillXP(astronaut, 'piloting', 2);
    }

    // Engineering XP
    for (let i = 0; i < flightStats.stagingEvents; i++) {
      awardSkillXP(astronaut, 'engineering', 2);
    }
    for (let i = 0; i < flightStats.partsRecovered; i++) {
      awardSkillXP(astronaut, 'engineering', 3);
    }

    // Science XP
    for (let i = 0; i < flightStats.scienceReturns; i++) {
      awardSkillXP(astronaut, 'science', 5);
    }
    for (let i = 0; i < flightStats.scienceActivations; i++) {
      awardSkillXP(astronaut, 'science', 3);
    }

    results.push({
      id: astronaut.id,
      name: astronaut.name,
      piloting: Math.round((astronaut.skills.piloting - before.piloting) * 10) / 10,
      engineering: Math.round((astronaut.skills.engineering - before.engineering) * 10) / 10,
      science: Math.round((astronaut.skills.science - before.science) * 10) / 10,
    });
  }

  return results;
}

/**
 * Get the maximum value of a skill among a set of crew members.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string[]} crewIds
 * @param {'piloting'|'engineering'|'science'} skill
 * @returns {number}  Highest skill value (0–100) among the crew, or 0 if none.
 */
export function getMaxCrewSkill(state, crewIds, skill) {
  let max = 0;
  for (const id of crewIds) {
    const member = state.crew?.find((c) => c.id === id);
    if (member?.skills?.[skill] != null) {
      max = Math.max(max, member.skills[skill]);
    }
  }
  return max;
}
