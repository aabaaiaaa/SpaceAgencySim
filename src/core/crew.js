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
import {
  AstronautStatus,
  HIRE_COST,
  CREW_SALARY_PER_PERIOD,
  HARD_LANDING_SPEED_MIN,
  HARD_LANDING_SPEED_MAX,
  HARD_LANDING_INJURY_MIN,
  HARD_LANDING_INJURY_MAX,
  EJECTION_INJURY_PERIODS,
  MEDICAL_CARE_COST,
  TRAINING_COURSE_COST,
  TRAINING_COURSE_DURATION,
  TRAINING_SKILL_GAIN,
  TRAINING_SLOTS_BY_TIER,
  EXPERIENCED_CREW_SKILL_RANGE,
  EXPERIENCED_HIRE_COST_MULTIPLIER,
  FacilityId,
  getCrewCostModifier,
} from './constants.js';
import { getFacilityTier } from './construction.js';
import { getInjuryDurationMultiplier } from './settings.js';

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
 * @property {string|null}                   trainingSkill    - Skill being trained ('piloting', 'engineering', 'science'), or null.
 * @property {number|null}                   trainingEnds     - Period number when training course completes, or null.
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
function createAstronaut({ name, salary = CREW_SALARY_PER_PERIOD, hireDate = new Date().toISOString(), skills = null }) {
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
    skills: skills ?? { piloting: 0, engineering: 0, science: 0 },
    injuryEnds: null,
    trainingSkill: null,
    trainingEnds: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the actual crew hiring cost after applying the reputation modifier.
 *
 * @param {number} reputation  Current agency reputation (0–100).
 * @returns {number}  Adjusted hire cost (floored to whole dollars).
 */
export function getAdjustedHireCost(reputation) {
  return Math.floor(HIRE_COST * getCrewCostModifier(reputation));
}

/**
 * Hire a new astronaut.
 *
 * Deducts the reputation-adjusted hire cost from the player's cash via
 * `spend()`. If the player cannot afford the fee, no astronaut is added
 * and the function returns a failure result (cash is not modified).
 *
 * Base cost: $50,000.  Modified by reputation tier:
 *   0–20:  +50 % → $75,000
 *   21–40: +25 % → $62,500
 *   41–60: normal → $50,000
 *   61–80: −10 % → $45,000
 *   81–100:−25 % → $37,500
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} name  Display name for the new astronaut.
 * @returns {{ success: boolean, astronaut?: Astronaut, cost?: number, error?: string }}
 */
export function hireCrew(state, name) {
  const cost = getAdjustedHireCost(state.reputation ?? 50);
  const ok = spend(state, cost);
  if (!ok) {
    return { success: false, error: `Insufficient funds to hire astronaut (need $${cost.toLocaleString('en-US')}).` };
  }

  const astronaut = createAstronaut({ name });
  state.crew.push(astronaut);
  return { success: true, astronaut, cost };
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
 * from `state.crew`. Only active AND non-injured astronauts can be assigned.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} astronautId  Astronaut ID.
 * @param {string} rocketId     Rocket design ID.
 * @returns {boolean}  `true` if the astronaut was assigned.
 */
export function assignToCrew(state, astronautId, rocketId) {
  const astronaut = state.crew.find((a) => a.id === astronautId);
  if (!astronaut || astronaut.status !== AstronautStatus.ACTIVE) return false;
  if (astronaut.injuryEnds != null && astronaut.injuryEnds > (state.currentPeriod ?? 0)) return false;
  // Cancel any active training when assigned to a rocket.
  if (astronaut.trainingSkill) {
    astronaut.trainingSkill = null;
    astronaut.trainingEnds = null;
  }
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
// Injury system
// ---------------------------------------------------------------------------

/**
 * Injure an astronaut, setting their `injuryEnds` to a future period.
 *
 * The astronaut remains `AstronautStatus.ACTIVE` (still employed) but cannot
 * be assigned to flights until `state.currentPeriod >= injuryEnds`.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id         Astronaut ID.
 * @param {number} periods    Number of periods the injury lasts.
 * @returns {boolean}  `true` if the injury was applied.
 */
export function injureCrew(state, id, periods) {
  const astronaut = state.crew.find((a) => a.id === id);
  if (!astronaut || astronaut.status !== AstronautStatus.ACTIVE) return false;
  const currentPeriod = state.currentPeriod ?? 0;
  const mult = getInjuryDurationMultiplier(state);
  const adjusted = Math.max(1, Math.round(periods * mult));
  astronaut.injuryEnds = currentPeriod + adjusted;
  return true;
}

/**
 * Check if an astronaut is currently injured (injuryEnds is set and in the future).
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id  Astronaut ID.
 * @returns {boolean}
 */
export function isCrewInjured(state, id) {
  const astronaut = state.crew.find((a) => a.id === id);
  if (!astronaut) return false;
  return astronaut.injuryEnds != null && astronaut.injuryEnds > (state.currentPeriod ?? 0);
}

/**
 * Pay a medical care fee to halve an injured astronaut's remaining recovery time
 * (rounded up).  Deducts MEDICAL_CARE_COST from cash via spend().
 *
 * Returns `false` if the astronaut is not found, not injured, or the player
 * cannot afford the fee.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id  Astronaut ID.
 * @returns {{ success: boolean, newInjuryEnds?: number, error?: string }}
 */
export function payMedicalCare(state, id) {
  const astronaut = state.crew.find((a) => a.id === id);
  if (!astronaut) return { success: false, error: 'Astronaut not found.' };
  if (astronaut.injuryEnds == null || astronaut.injuryEnds <= (state.currentPeriod ?? 0)) {
    return { success: false, error: 'Astronaut is not injured.' };
  }

  const ok = spend(state, MEDICAL_CARE_COST);
  if (!ok) return { success: false, error: 'Insufficient funds for medical care.' };

  const currentPeriod = state.currentPeriod ?? 0;
  const remaining = astronaut.injuryEnds - currentPeriod;
  const halved = Math.ceil(remaining / 2);
  astronaut.injuryEnds = currentPeriod + halved;

  return { success: true, newInjuryEnds: astronaut.injuryEnds };
}

/**
 * Clear injuries for all crew whose recovery period has elapsed.
 * Called once per period advancement.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {string[]}  IDs of crew members whose injuries were cleared.
 */
export function checkInjuryRecovery(state) {
  const currentPeriod = state.currentPeriod ?? 0;
  const healed = [];

  for (const astronaut of state.crew) {
    if (
      astronaut.status === AstronautStatus.ACTIVE &&
      astronaut.injuryEnds != null &&
      currentPeriod >= astronaut.injuryEnds
    ) {
      astronaut.injuryEnds = null;
      healed.push(astronaut.id);
    }
  }

  return healed;
}

/**
 * Get all active crew members who are available for flight assignment
 * (not injured and not in training).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {Astronaut[]}
 */
export function getAssignableCrew(state) {
  const currentPeriod = state.currentPeriod ?? 0;
  return state.crew.filter(
    (a) => a.status === AstronautStatus.ACTIVE &&
           (a.injuryEnds == null || a.injuryEnds <= currentPeriod) &&
           !a.trainingSkill,
  );
}

/**
 * Process injuries for surviving crew at end of flight based on flight events.
 *
 * Injury triggers:
 *   - Hard landing (5–10 m/s impact): injured for 2–3 periods (scaled by speed).
 *   - Crew ejection: injured for 1 period.
 *   - Crew are NOT injured by nearby part failure.
 *
 * Returns an array of injury records for display in the post-flight summary.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('./physics.js').PhysicsState|null} ps
 * @returns {Array<{crewId: string, crewName: string, cause: string, periods: number, altitude: number}>}
 */
export function processFlightInjuries(state, flightState, ps) {
  /** @type {Array<{crewId: string, crewName: string, cause: string, periods: number, altitude: number}>} */
  const injuries = [];
  if (!flightState) return injuries;

  const crewIds = flightState.crewIds ?? [];
  const events = flightState.events ?? [];
  const ejectedIds = ps?.ejectedCrewIds ?? new Set();
  const isCrashed = !!(ps && ps.crashed);

  // Determine which crew survived (not KIA).
  const survivingIds = crewIds.filter((id) => {
    if (isCrashed && !ejectedIds.has(id)) return false;
    return true;
  });

  // --- Ejection injury: 1 period per ejected & surviving crew member ---
  const ejectionEvent = events.find((e) => e.type === 'CREW_EJECTED');
  if (ejectionEvent) {
    for (const crewId of survivingIds) {
      if (!ejectedIds.has(crewId)) continue;
      const astronaut = state.crew.find((a) => a.id === crewId);
      if (!astronaut || astronaut.status !== AstronautStatus.ACTIVE) continue;

      const applied = injureCrew(state, crewId, EJECTION_INJURY_PERIODS);
      if (applied) {
        const altitude = typeof ejectionEvent.altitude === 'number' ? ejectionEvent.altitude : 0;
        injuries.push({
          crewId,
          crewName: astronaut.name,
          cause: 'Ejection',
          periods: EJECTION_INJURY_PERIODS,
          altitude,
        });

        // Log injury event on flight state
        flightState.events.push({
          time: ejectionEvent.time ?? flightState.timeElapsed,
          type: 'CREW_INJURED',
          description: `${astronaut.name} injured from ejection at ${altitude.toFixed(0)} m — recovery ${EJECTION_INJURY_PERIODS} period(s).`,
          crewId,
          altitude,
          cause: 'Ejection',
        });
      }
    }
  }

  // --- Hard landing injury: 2–3 periods for 5–10 m/s impact ---
  const landingEvent = events.find((e) => e.type === 'LANDING');
  if (landingEvent && typeof landingEvent.speed === 'number') {
    const speed = landingEvent.speed;
    if (speed >= HARD_LANDING_SPEED_MIN && speed < HARD_LANDING_SPEED_MAX) {
      // Scale injury duration linearly within the 5–10 m/s range.
      const t = (speed - HARD_LANDING_SPEED_MIN) / (HARD_LANDING_SPEED_MAX - HARD_LANDING_SPEED_MIN);
      const periods = Math.round(
        HARD_LANDING_INJURY_MIN + t * (HARD_LANDING_INJURY_MAX - HARD_LANDING_INJURY_MIN),
      );

      // Only injure non-ejected surviving crew (ejected crew already handled above).
      for (const crewId of survivingIds) {
        if (ejectedIds.has(crewId)) continue; // already handled by ejection
        const astronaut = state.crew.find((a) => a.id === crewId);
        if (!astronaut || astronaut.status !== AstronautStatus.ACTIVE) continue;

        const applied = injureCrew(state, crewId, periods);
        if (applied) {
          const altitude = typeof landingEvent.altitude === 'number' ? landingEvent.altitude : 0;
          injuries.push({
            crewId,
            crewName: astronaut.name,
            cause: 'Hard landing',
            periods,
            altitude,
          });

          flightState.events.push({
            time: landingEvent.time ?? flightState.timeElapsed,
            type: 'CREW_INJURED',
            description: `${astronaut.name} injured from hard landing at ${speed.toFixed(1)} m/s — recovery ${periods} period(s).`,
            crewId,
            altitude,
            cause: 'Hard landing',
          });
        }
      }
    }
  }

  return injuries;
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

// ---------------------------------------------------------------------------
// Training system (Crew Admin Tier 2+)
// ---------------------------------------------------------------------------

/**
 * Get training slot info for the current Crew Admin tier.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ maxSlots: number, usedSlots: number, availableSlots: number }}
 */
export function getTrainingSlotInfo(state) {
  const tier = getFacilityTier(state, FacilityId.CREW_ADMIN);
  const maxSlots = TRAINING_SLOTS_BY_TIER[tier] ?? 0;
  const usedSlots = getTrainingCrew(state).length;
  return { maxSlots, usedSlots, availableSlots: maxSlots - usedSlots };
}

/**
 * Assign an astronaut to a training course.
 *
 * Requires the astronaut to be active, not injured, not assigned to a rocket,
 * and a free training slot. Charges the course cost ($20k) upfront via spend().
 * Sets `trainingSkill` and `trainingEnds` on the astronaut record.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} astronautId
 * @param {'piloting'|'engineering'|'science'} skill
 * @returns {{ success: boolean, cost?: number, error?: string }}
 */
export function assignToTraining(state, astronautId, skill) {
  const astronaut = state.crew.find((a) => a.id === astronautId);
  if (!astronaut) return { success: false, error: 'Astronaut not found.' };
  if (astronaut.status !== AstronautStatus.ACTIVE) return { success: false, error: 'Astronaut is not active.' };
  if (astronaut.injuryEnds != null && astronaut.injuryEnds > (state.currentPeriod ?? 0)) {
    return { success: false, error: 'Astronaut is injured and cannot train.' };
  }
  if (astronaut.assignedRocketId) {
    return { success: false, error: 'Astronaut is assigned to a rocket. Unassign first.' };
  }
  if (astronaut.trainingSkill) {
    return { success: false, error: 'Astronaut is already in training.' };
  }

  // Check training slot availability
  const { availableSlots } = getTrainingSlotInfo(state);
  if (availableSlots <= 0) {
    return { success: false, error: 'No training slots available. Upgrade Crew Admin for more slots.' };
  }

  // Charge course cost upfront
  const ok = spend(state, TRAINING_COURSE_COST);
  if (!ok) {
    return { success: false, error: `Insufficient funds for training (need $${TRAINING_COURSE_COST.toLocaleString('en-US')}).` };
  }

  const currentPeriod = state.currentPeriod ?? 0;
  astronaut.trainingSkill = skill;
  astronaut.trainingEnds = currentPeriod + TRAINING_COURSE_DURATION;
  return { success: true, cost: TRAINING_COURSE_COST };
}

/**
 * Remove an astronaut from training (cancels in-progress course, no refund).
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} astronautId
 * @returns {boolean}  `true` if training was cancelled.
 */
export function cancelTraining(state, astronautId) {
  const astronaut = state.crew.find((a) => a.id === astronautId);
  if (!astronaut || !astronaut.trainingSkill) return false;
  astronaut.trainingSkill = null;
  astronaut.trainingEnds = null;
  return true;
}

/**
 * Process training completions for all crew currently in training.
 * Called once per period advancement.
 *
 * Checks if any trainees have completed their course (currentPeriod >= trainingEnds).
 * Completed trainees receive TRAINING_SKILL_GAIN (+15) in their chosen skill,
 * capped at 100. No per-period cost — the course cost is paid upfront.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ trainingCost: number, trainees: Array<{id: string, name: string, skill: string, gain: number, completed: boolean}> }}
 */
export function processTraining(state) {
  const trainees = [];
  const currentPeriod = state.currentPeriod ?? 0;

  for (const astronaut of state.crew) {
    if (
      astronaut.status !== AstronautStatus.ACTIVE ||
      !astronaut.trainingSkill
    ) continue;

    const skill = astronaut.trainingSkill;

    // Check if course is complete
    if (astronaut.trainingEnds != null && currentPeriod >= astronaut.trainingEnds) {
      const before = astronaut.skills?.[skill] ?? 0;
      if (!astronaut.skills) astronaut.skills = { piloting: 0, engineering: 0, science: 0 };
      astronaut.skills[skill] = Math.min(100, before + TRAINING_SKILL_GAIN);
      const gain = Math.round((astronaut.skills[skill] - before) * 10) / 10;

      trainees.push({ id: astronaut.id, name: astronaut.name, skill, gain, completed: true });

      // Clear training state
      astronaut.trainingSkill = null;
      astronaut.trainingEnds = null;
    } else {
      // Still in progress — report for display
      trainees.push({ id: astronaut.id, name: astronaut.name, skill, gain: 0, completed: false });
    }
  }

  // No per-period cost; course cost is paid upfront in assignToTraining.
  return { trainingCost: 0, trainees };
}

/**
 * Get all crew currently in training.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {Array<import('./crew.js').Astronaut>}
 */
export function getTrainingCrew(state) {
  return state.crew.filter(
    (a) => a.status === AstronautStatus.ACTIVE && a.trainingSkill != null,
  );
}

// ---------------------------------------------------------------------------
// Experienced crew recruitment (Crew Admin Tier 3)
// ---------------------------------------------------------------------------

/**
 * Get the hire cost for an experienced crew member (Tier 3).
 *
 * @param {number} reputation  Current agency reputation (0–100).
 * @returns {number}  Adjusted hire cost (floored to whole dollars).
 */
export function getExperiencedHireCost(reputation) {
  return Math.floor(HIRE_COST * getCrewCostModifier(reputation) * EXPERIENCED_HIRE_COST_MULTIPLIER);
}

/**
 * Hire an experienced astronaut with starting skills > 0.
 * Only available at Crew Admin Tier 3.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} name  Display name for the new astronaut.
 * @returns {{ success: boolean, astronaut?: import('./crew.js').Astronaut, cost?: number, error?: string }}
 */
export function hireExperiencedCrew(state, name) {
  const cost = getExperiencedHireCost(state.reputation ?? 50);
  const ok = spend(state, cost);
  if (!ok) {
    return { success: false, error: `Insufficient funds to hire experienced astronaut (need $${cost.toLocaleString('en-US')}).` };
  }

  const { min, max } = EXPERIENCED_CREW_SKILL_RANGE;
  const randSkill = () => min + Math.floor(Math.random() * (max - min + 1));
  const skills = {
    piloting: randSkill(),
    engineering: randSkill(),
    science: randSkill(),
  };

  const astronaut = createAstronaut({ name, skills });
  state.crew.push(astronaut);
  return { success: true, astronaut, cost };
}

// ---------------------------------------------------------------------------
// Advanced medical (Crew Admin Tier 3)
// ---------------------------------------------------------------------------

/**
 * Pay for advanced medical care to reduce an injured astronaut's remaining
 * recovery time to 1/3 (rounded up). Only available at Crew Admin Tier 3.
 *
 * Deducts MEDICAL_CARE_COST from cash via spend().
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id  Astronaut ID.
 * @returns {{ success: boolean, newInjuryEnds?: number, error?: string }}
 */
export function payAdvancedMedicalCare(state, id) {
  const astronaut = state.crew.find((a) => a.id === id);
  if (!astronaut) return { success: false, error: 'Astronaut not found.' };
  if (astronaut.injuryEnds == null || astronaut.injuryEnds <= (state.currentPeriod ?? 0)) {
    return { success: false, error: 'Astronaut is not injured.' };
  }

  const ok = spend(state, MEDICAL_CARE_COST);
  if (!ok) return { success: false, error: 'Insufficient funds for advanced medical care.' };

  const currentPeriod = state.currentPeriod ?? 0;
  const remaining = astronaut.injuryEnds - currentPeriod;
  const reduced = Math.ceil(remaining / 3);
  astronaut.injuryEnds = currentPeriod + reduced;

  return { success: true, newInjuryEnds: astronaut.injuryEnds };
}
