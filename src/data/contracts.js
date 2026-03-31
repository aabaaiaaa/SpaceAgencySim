/**
 * contracts.js — Contract generation templates and scaling rules.
 *
 * Procedurally generated contracts are built from templates that define the
 * objective types, parameter ranges, and reward formulas.  Each template
 * specifies a minimum player progression requirement (e.g. "player must have
 * completed mission X" or "player must have reached altitude Y") so that
 * generated contracts match current capabilities.
 *
 * ARCHITECTURE
 * ============
 * Templates are static data consumed by `src/core/contracts.js` at generation
 * time.  They are never mutated.  Live contract instances (with mutable
 * objective completion flags, deadlines, etc.) live in `state.contracts`.
 *
 * @module data/contracts
 */

import { ContractCategory, CONTRACT_CONFLICT_TAGS, CONTRACT_BONUS_REWARD_RATE } from '../core/constants.js';
import { ObjectiveType } from './missions.js';
import { PartType } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Progression Thresholds
// ---------------------------------------------------------------------------

/**
 * Determine the player's progression tier based on completed missions.
 *
 * Tier 0: brand new (0 missions)
 * Tier 1: early game (1-3 missions)
 * Tier 2: mid game (4-7 missions)
 * Tier 3: advanced (8-11 missions)
 * Tier 4: late game (12-14 missions)
 * Tier 5: endgame (15+ missions, orbital capable)
 *
 * @param {import('../core/gameState.js').GameState} state
 * @returns {number}
 */
export function getProgressionTier(state) {
  const completed = state.missions.completed.length;
  if (completed >= 15) return 5;
  if (completed >= 12) return 4;
  if (completed >= 8) return 3;
  if (completed >= 4) return 2;
  if (completed >= 1) return 1;
  return 0;
}

/**
 * Get the player's highest achieved altitude from flight history and
 * completed mission objectives.
 *
 * @param {import('../core/gameState.js').GameState} state
 * @returns {number} Highest altitude in metres.
 */
export function getHighestAltitude(state) {
  let max = 100; // baseline
  for (const mission of state.missions.completed) {
    if (!mission.objectives) continue;
    for (const obj of mission.objectives) {
      if (obj.type === ObjectiveType.REACH_ALTITUDE && obj.target?.altitude) {
        max = Math.max(max, obj.target.altitude);
      }
      if (obj.type === ObjectiveType.REACH_ORBIT && obj.target?.orbitAltitude) {
        max = Math.max(max, obj.target.orbitAltitude);
      }
      if (obj.type === ObjectiveType.HOLD_ALTITUDE && obj.target?.maxAltitude) {
        max = Math.max(max, obj.target.maxAltitude);
      }
    }
  }
  return max;
}

/**
 * Check if the player has orbital capability (completed an orbit mission).
 *
 * @param {import('../core/gameState.js').GameState} state
 * @returns {boolean}
 */
export function hasOrbitalCapability(state) {
  return state.missions.completed.some(
    (m) => m.objectives?.some((o) => o.type === ObjectiveType.REACH_ORBIT && o.completed),
  );
}

/**
 * Check if the player has satellite deployment capability.
 *
 * @param {import('../core/gameState.js').GameState} state
 * @returns {boolean}
 */
export function hasSatelliteCapability(state) {
  return state.parts.includes('satellite-mk1');
}

/**
 * Check if the player has science module capability.
 *
 * @param {import('../core/gameState.js').GameState} state
 * @returns {boolean}
 */
export function hasScienceCapability(state) {
  return state.parts.includes('science-module-mk1');
}

// ---------------------------------------------------------------------------
// Contract Templates
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ContractTemplate
 * @property {string}   id        - Template identifier.
 * @property {string}   category  - ContractCategory value.
 * @property {number}   minTier   - Minimum progression tier to generate this.
 * @property {number}   [maxTier] - Maximum progression tier (inclusive), or undefined.
 * @property {number}   minMccTier - Minimum Mission Control Centre tier required (1, 2, or 3).
 * @property {function(import('../core/gameState.js').GameState, number): boolean} canGenerate
 *   Extra check beyond minTier (e.g. "has science module").
 * @property {function(import('../core/gameState.js').GameState, number): GeneratedContract} generate
 *   Produces the contract data given state and a random seed factor (0-1).
 */

/**
 * @typedef {Object} GeneratedContract
 * @property {string}   title
 * @property {string}   description
 * @property {string}   category
 * @property {import('./missions.js').ObjectiveDef[]} objectives
 * @property {import('./missions.js').ObjectiveDef[]} [bonusObjectives] - Optional over-performance targets.
 * @property {number}   [bonusReward] - Extra cash awarded when all bonus objectives are met.
 * @property {number}   reward
 * @property {number|null} deadlineFlights - Flights until deadline, or null for open-ended.
 * @property {string|null} chainId
 * @property {number|null} chainPart
 * @property {number|null} chainTotal
 * @property {string[]} [conflictTags] - Tags indicating potential conflict with other contracts.
 */

/**
 * All contract generation templates.
 * @type {ContractTemplate[]}
 */
export const CONTRACT_TEMPLATES = [

  // ── Altitude Records ─────────────────────────────────────────────────────
  {
    id: 'altitude-push',
    category: ContractCategory.ALTITUDE_RECORD,
    minTier: 1,
    minMccTier: 1,
    canGenerate: () => true,
    generate(state, rand) {
      const highest = getHighestAltitude(state);
      // Push 20-80% beyond current record
      const factor = 1.2 + rand * 0.6;
      const target = Math.round(highest * factor / 100) * 100; // round to nearest 100
      const reward = Math.round(target * 0.8 + 5_000);

      const bonusTarget = Math.round(target * 1.5 / 100) * 100;
      const bonusReward = Math.round(reward * CONTRACT_BONUS_REWARD_RATE);

      return {
        title: `Altitude Record: ${_fmtAlt(target)}`,
        description: `Push beyond current altitude records. Reach ${_fmtAlt(target)} to claim the bonus.`,
        category: ContractCategory.ALTITUDE_RECORD,
        objectives: [{
          id: 'obj-alt-1',
          type: ObjectiveType.REACH_ALTITUDE,
          target: { altitude: target },
          completed: false,
          description: `Reach ${_fmtAlt(target)} altitude`,
        }],
        bonusObjectives: [{
          id: 'obj-alt-bonus',
          type: ObjectiveType.REACH_ALTITUDE,
          target: { altitude: bonusTarget },
          completed: false,
          description: `Over-perform: reach ${_fmtAlt(bonusTarget)} (+${_fmtCash(bonusReward)} bonus)`,
          bonus: true,
        }],
        bonusReward,
        reward,
        deadlineFlights: null, // open-ended
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Speed Records ────────────────────────────────────────────────────────
  {
    id: 'speed-push',
    category: ContractCategory.SPEED_RECORD,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state, rand) {
      const tier = getProgressionTier(state);
      const baseSpeed = [100, 200, 500, 1000, 3000, 7000][Math.min(tier, 5)];
      const target = Math.round(baseSpeed * (1.0 + rand * 0.5));
      const reward = Math.round(target * 15 + 10_000);

      const bonusSpeed = Math.round(target * 1.3);
      const bonusReward = Math.round(reward * CONTRACT_BONUS_REWARD_RATE);

      return {
        title: `Speed Trial: ${target} m/s`,
        description: `Demonstrate high-velocity flight. Achieve a speed of ${target} m/s during any phase of flight.`,
        category: ContractCategory.SPEED_RECORD,
        objectives: [{
          id: 'obj-spd-1',
          type: ObjectiveType.REACH_SPEED,
          target: { speed: target },
          completed: false,
          description: `Reach ${target} m/s`,
        }],
        bonusObjectives: [{
          id: 'obj-spd-bonus',
          type: ObjectiveType.REACH_SPEED,
          target: { speed: bonusSpeed },
          completed: false,
          description: `Over-perform: reach ${bonusSpeed} m/s (+${_fmtCash(bonusReward)} bonus)`,
          bonus: true,
        }],
        bonusReward,
        reward,
        deadlineFlights: 6 + Math.floor(rand * 4),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Safe Recovery ────────────────────────────────────────────────────────
  {
    id: 'safe-recovery',
    category: ContractCategory.SAFE_RECOVERY,
    minTier: 1,
    minMccTier: 1,
    canGenerate: () => true,
    generate(state, rand) {
      const tier = getProgressionTier(state);
      const maxSpeeds = [10, 8, 6, 5, 4, 3];
      const maxSpeed = maxSpeeds[Math.min(tier, 5)];
      const reward = Math.round(20_000 + (10 - maxSpeed) * 5_000 + rand * 10_000);

      const bonusMaxSpeed = Math.max(1, maxSpeed - 2);
      const bonusReward = Math.round(reward * CONTRACT_BONUS_REWARD_RATE);

      return {
        title: `Safe Recovery: ${maxSpeed} m/s`,
        description: `Demonstrate precision landing capability. Land at ${maxSpeed} m/s or less to recover the vehicle intact.`,
        category: ContractCategory.SAFE_RECOVERY,
        objectives: [{
          id: 'obj-safe-1',
          type: ObjectiveType.SAFE_LANDING,
          target: { maxLandingSpeed: maxSpeed },
          completed: false,
          description: `Land at ${maxSpeed} m/s or less`,
        }],
        bonusObjectives: [{
          id: 'obj-safe-bonus',
          type: ObjectiveType.SAFE_LANDING,
          target: { maxLandingSpeed: bonusMaxSpeed },
          completed: false,
          description: `Over-perform: land at ${bonusMaxSpeed} m/s or less (+${_fmtCash(bonusReward)} bonus)`,
          bonus: true,
        }],
        bonusReward,
        reward,
        deadlineFlights: null, // open-ended
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
      };
    },
  },

  // ── Science Survey ───────────────────────────────────────────────────────
  {
    id: 'science-survey',
    category: ContractCategory.SCIENCE_SURVEY,
    minTier: 2,
    minMccTier: 2,
    canGenerate: (state) => hasScienceCapability(state),
    generate(state, rand) {
      const highest = getHighestAltitude(state);
      const minAlt = Math.round((200 + rand * highest * 0.6) / 100) * 100;
      const maxAlt = minAlt + Math.round((200 + rand * 400) / 100) * 100;
      const duration = 20 + Math.floor(rand * 30);
      const reward = Math.round(40_000 + minAlt * 0.5 + duration * 500);

      return {
        title: `Science Survey: ${_fmtAlt(minAlt)}-${_fmtAlt(maxAlt)}`,
        description: `Conduct a science experiment between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for ${duration} seconds, then return the data safely.`,
        category: ContractCategory.SCIENCE_SURVEY,
        objectives: [
          {
            id: 'obj-sci-1',
            type: ObjectiveType.HOLD_ALTITUDE,
            target: { minAltitude: minAlt, maxAltitude: maxAlt, duration },
            completed: false,
            description: `Hold altitude between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for ${duration}s`,
          },
          {
            id: 'obj-sci-2',
            type: ObjectiveType.RETURN_SCIENCE_DATA,
            target: {},
            completed: false,
            description: 'Activate Science Module and return data via safe landing',
          },
        ],
        reward,
        deadlineFlights: 5 + Math.floor(rand * 5),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Science Survey Chain (3-part) ────────────────────────────────────────
  {
    id: 'science-chain',
    category: ContractCategory.SCIENCE_SURVEY,
    minTier: 3,
    minMccTier: 3,
    canGenerate: (state) => hasScienceCapability(state),
    generate(state, rand) {
      const chainId = `chain-sci-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Part 1 of 3 — low altitude survey
      const minAlt = 400 + Math.floor(rand * 600);
      const maxAlt = minAlt + 400;
      const reward = Math.round(30_000 + rand * 15_000);

      return {
        title: `Atmospheric Survey I: ${_fmtAlt(minAlt)}`,
        description: `Part 1 of 3: Conduct a low-altitude science survey between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for 20 seconds. Completing this unlocks the next part of the survey chain.`,
        category: ContractCategory.SCIENCE_SURVEY,
        objectives: [
          {
            id: 'obj-chain-1',
            type: ObjectiveType.HOLD_ALTITUDE,
            target: { minAltitude: minAlt, maxAltitude: maxAlt, duration: 20 },
            completed: false,
            description: `Hold between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for 20s`,
          },
          {
            id: 'obj-chain-2',
            type: ObjectiveType.RETURN_SCIENCE_DATA,
            target: {},
            completed: false,
            description: 'Return science data safely',
          },
        ],
        reward,
        deadlineFlights: 6,
        chainId,
        chainPart: 1,
        chainTotal: 3,
      };
    },
  },

  // ── Satellite Deployment ─────────────────────────────────────────────────
  {
    id: 'satellite-deploy',
    category: ContractCategory.SATELLITE_DEPLOY,
    minTier: 3,
    minMccTier: 3,
    canGenerate: (state) => hasSatelliteCapability(state),
    generate(state, rand) {
      const highest = getHighestAltitude(state);
      const minAlt = Math.round(Math.max(5_000, highest * (0.3 + rand * 0.5)) / 1000) * 1000;
      const reward = Math.round(80_000 + minAlt * 1.5);

      return {
        title: `Satellite Delivery: ${_fmtAlt(minAlt)}`,
        description: `Deploy a satellite payload above ${_fmtAlt(minAlt)}. Landing is not required — this is a one-way delivery mission.`,
        category: ContractCategory.SATELLITE_DEPLOY,
        objectives: [{
          id: 'obj-sat-1',
          type: ObjectiveType.RELEASE_SATELLITE,
          target: { minAltitude: minAlt },
          completed: false,
          description: `Release satellite above ${_fmtAlt(minAlt)}`,
        }],
        reward,
        deadlineFlights: 8 + Math.floor(rand * 4),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Crash Test ───────────────────────────────────────────────────────────
  {
    id: 'crash-test',
    category: ContractCategory.CRASH_TEST,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state, rand) {
      const tier = getProgressionTier(state);
      const minSpeed = 30 + Math.floor(tier * 20 + rand * 30);
      const reward = Math.round(25_000 + minSpeed * 300);

      return {
        title: `Impact Test: ${minSpeed} m/s`,
        description: `Structural engineering needs crash data. Impact the ground at ${minSpeed} m/s or faster. No recovery expected.`,
        category: ContractCategory.CRASH_TEST,
        objectives: [{
          id: 'obj-crash-1',
          type: ObjectiveType.CONTROLLED_CRASH,
          target: { minCrashSpeed: minSpeed },
          completed: false,
          description: `Impact at ${minSpeed} m/s or faster`,
        }],
        reward,
        deadlineFlights: null, // open-ended
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
      };
    },
  },

  // ── Orbital Mission ──────────────────────────────────────────────────────
  {
    id: 'orbital-mission',
    category: ContractCategory.ORBITAL,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state) => hasOrbitalCapability(state),
    generate(state, rand) {
      const reward = Math.round(200_000 + rand * 300_000);

      return {
        title: 'Orbital Insertion',
        description: 'Reach Low Earth Orbit and maintain orbital velocity. A routine contract for an established space agency.',
        category: ContractCategory.ORBITAL,
        objectives: [{
          id: 'obj-orb-1',
          type: ObjectiveType.REACH_ORBIT,
          target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
          completed: false,
          description: 'Reach orbit (>80 km at >=7,800 m/s)',
        }],
        reward,
        deadlineFlights: 10 + Math.floor(rand * 5),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Orbital Satellite Deployment ─────────────────────────────────────────
  {
    id: 'orbital-satellite',
    category: ContractCategory.SATELLITE_DEPLOY,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state) => hasOrbitalCapability(state) && hasSatelliteCapability(state),
    generate(state, rand) {
      const reward = Math.round(350_000 + rand * 200_000);

      return {
        title: 'Orbital Satellite Deployment',
        description: 'Reach orbit and deploy a satellite payload. The backbone of commercial space operations.',
        category: ContractCategory.SATELLITE_DEPLOY,
        objectives: [
          {
            id: 'obj-osat-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit (>80 km at >=7,800 m/s)',
          },
          {
            id: 'obj-osat-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000 },
            completed: false,
            description: 'Release satellite above 80 km while in orbit',
          },
        ],
        reward,
        deadlineFlights: 12,
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Budget Challenge ───────────────────────────────────────────────────
  {
    id: 'budget-challenge',
    category: ContractCategory.ALTITUDE_RECORD,
    minTier: 1,
    minMccTier: 1,
    canGenerate: () => true,
    generate(state, rand) {
      const highest = getHighestAltitude(state);
      const target = Math.round(highest * (0.6 + rand * 0.4) / 100) * 100;
      const maxCost = Math.round((30_000 + target * 3) * (0.7 + rand * 0.3));
      const reward = Math.round(target * 1.2 + 15_000);

      return {
        title: `Budget Launch: ${_fmtAlt(target)}`,
        description: `Reach ${_fmtAlt(target)} with a rocket costing no more than ${_fmtCash(maxCost)}. Prove that frugal engineering can reach the sky.`,
        category: ContractCategory.ALTITUDE_RECORD,
        objectives: [
          {
            id: 'obj-budg-1',
            type: ObjectiveType.REACH_ALTITUDE,
            target: { altitude: target },
            completed: false,
            description: `Reach ${_fmtAlt(target)} altitude`,
          },
          {
            id: 'obj-budg-2',
            type: ObjectiveType.BUDGET_LIMIT,
            target: { maxCost },
            completed: false,
            description: `Rocket cost must not exceed ${_fmtCash(maxCost)}`,
          },
        ],
        reward,
        deadlineFlights: null,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.BUDGET],
      };
    },
  },

  // ── Minimalist Challenge ───────────────────────────────────────────────
  {
    id: 'minimalist',
    category: ContractCategory.ALTITUDE_RECORD,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state, rand) {
      const tier = getProgressionTier(state);
      const maxParts = 3 + Math.floor(rand * 2); // 3-4 parts
      const altTarget = Math.round((300 + tier * 200 + rand * 500) / 100) * 100;
      const reward = Math.round(25_000 + altTarget * 0.8 + (6 - maxParts) * 10_000);

      return {
        title: `Minimalist: ${maxParts} Parts`,
        description: `Reach ${_fmtAlt(altTarget)} using no more than ${maxParts} parts. Sometimes less is more.`,
        category: ContractCategory.ALTITUDE_RECORD,
        objectives: [
          {
            id: 'obj-min-1',
            type: ObjectiveType.REACH_ALTITUDE,
            target: { altitude: altTarget },
            completed: false,
            description: `Reach ${_fmtAlt(altTarget)} altitude`,
          },
          {
            id: 'obj-min-2',
            type: ObjectiveType.MAX_PARTS,
            target: { maxParts },
            completed: false,
            description: `Use ${maxParts} or fewer parts`,
          },
        ],
        reward,
        deadlineFlights: null,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.MINIMALIST],
      };
    },
  },

  // ── No-Parachute Recovery ──────────────────────────────────────────────
  {
    id: 'no-chute-recovery',
    category: ContractCategory.SAFE_RECOVERY,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state, rand) {
      const tier = getProgressionTier(state);
      const maxSpeed = 8 + Math.floor((5 - Math.min(tier, 4)) * 1.5);
      const altTarget = Math.round((200 + tier * 150 + rand * 300) / 100) * 100;
      const reward = Math.round(40_000 + altTarget * 0.5 + rand * 15_000);

      return {
        title: `Unpowered Recovery: ${_fmtAlt(altTarget)}`,
        description: `Reach ${_fmtAlt(altTarget)} and land safely at ${maxSpeed} m/s — without using any parachutes. Engine braking or creative solutions only.`,
        category: ContractCategory.SAFE_RECOVERY,
        objectives: [
          {
            id: 'obj-nochute-1',
            type: ObjectiveType.REACH_ALTITUDE,
            target: { altitude: altTarget },
            completed: false,
            description: `Reach ${_fmtAlt(altTarget)} altitude`,
          },
          {
            id: 'obj-nochute-2',
            type: ObjectiveType.SAFE_LANDING,
            target: { maxLandingSpeed: maxSpeed },
            completed: false,
            description: `Land at ${maxSpeed} m/s or less`,
          },
          {
            id: 'obj-nochute-3',
            type: ObjectiveType.RESTRICT_PART,
            target: { forbiddenType: PartType.PARACHUTE },
            completed: false,
            description: 'No parachutes allowed',
          },
        ],
        reward,
        deadlineFlights: null,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
      };
    },
  },

  // ── Multi-Satellite Deployment ─────────────────────────────────────────
  {
    id: 'multi-satellite',
    category: ContractCategory.SATELLITE_DEPLOY,
    minTier: 4,
    minMccTier: 3,
    canGenerate: (state) => hasSatelliteCapability(state),
    generate(state, rand) {
      const count = 2 + Math.floor(rand * 2); // 2-3 satellites
      const highest = getHighestAltitude(state);
      const minAlt = Math.round(Math.max(3_000, highest * (0.2 + rand * 0.3)) / 1000) * 1000;
      const reward = Math.round(100_000 * count + minAlt * 0.8);

      return {
        title: `Constellation: ${count} Satellites`,
        description: `Deploy ${count} satellites above ${_fmtAlt(minAlt)} in a single flight. Landing is not required — this is a deployment mission.`,
        category: ContractCategory.SATELLITE_DEPLOY,
        objectives: [{
          id: 'obj-msat-1',
          type: ObjectiveType.MULTI_SATELLITE,
          target: { count, minAltitude: minAlt },
          completed: false,
          description: `Deploy ${count} satellites above ${_fmtAlt(minAlt)}`,
        }],
        reward,
        deadlineFlights: 10 + Math.floor(rand * 5),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Crewed Orbital Mission ─────────────────────────────────────────────
  {
    id: 'crewed-orbital',
    category: ContractCategory.ORBITAL,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state) => hasOrbitalCapability(state),
    generate(state, rand) {
      const minCrew = 1 + Math.floor(rand * 2); // 1-2 crew
      const reward = Math.round(250_000 + minCrew * 100_000 + rand * 150_000);

      return {
        title: `Crewed Orbit: ${minCrew} Astronaut${minCrew > 1 ? 's' : ''}`,
        description: `Send ${minCrew} crew member${minCrew > 1 ? 's' : ''} to orbit. Human spaceflight is the ultimate achievement.`,
        category: ContractCategory.ORBITAL,
        objectives: [
          {
            id: 'obj-crew-orb-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit (>80 km at >=7,800 m/s)',
          },
          {
            id: 'obj-crew-orb-2',
            type: ObjectiveType.MINIMUM_CREW,
            target: { minCrew },
            completed: false,
            description: `Fly with ${minCrew} or more crew member${minCrew > 1 ? 's' : ''}`,
          },
        ],
        reward,
        deadlineFlights: 12 + Math.floor(rand * 4),
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.CREW_HEAVY],
      };
    },
  },

  // ── Budget Orbital ─────────────────────────────────────────────────────
  {
    id: 'budget-orbital',
    category: ContractCategory.ORBITAL,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state) => hasOrbitalCapability(state),
    generate(state, rand) {
      const maxCost = Math.round(300_000 + rand * 200_000);
      const reward = Math.round(350_000 + rand * 200_000);

      return {
        title: `Budget Orbit: ${_fmtCash(maxCost)}`,
        description: `Achieve orbit with a rocket costing no more than ${_fmtCash(maxCost)}. Cost-efficient access to space is the future.`,
        category: ContractCategory.ORBITAL,
        objectives: [
          {
            id: 'obj-borb-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit (>80 km at >=7,800 m/s)',
          },
          {
            id: 'obj-borb-2',
            type: ObjectiveType.BUDGET_LIMIT,
            target: { maxCost },
            completed: false,
            description: `Rocket cost must not exceed ${_fmtCash(maxCost)}`,
          },
        ],
        reward,
        deadlineFlights: 15,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.BUDGET],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Chain continuation templates
// ---------------------------------------------------------------------------

/**
 * Generates the next part of a science survey chain contract.
 *
 * @param {string} chainId - The chain identifier from part 1.
 * @param {number} partNumber - Which part to generate (2 or 3).
 * @param {number} rand - Random factor 0-1.
 * @returns {GeneratedContract}
 */
export function generateChainContinuation(chainId, partNumber, rand) {
  const altMultiplier = partNumber === 2 ? 3 : 8;
  const minAlt = Math.round((500 * altMultiplier + rand * 2000) / 100) * 100;
  const maxAlt = minAlt + 600;
  const duration = 20 + (partNumber - 1) * 10;
  const reward = Math.round(40_000 * partNumber + rand * 20_000);

  const isLast = partNumber === 3;
  const desc = isLast
    ? `Part 3 of 3 (Final): High-altitude survey between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)}. Complete all three surveys for maximum payout.`
    : `Part ${partNumber} of 3: Mid-altitude survey between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)}.`;

  return {
    title: `Atmospheric Survey ${partNumber === 2 ? 'II' : 'III'}: ${_fmtAlt(minAlt)}`,
    description: desc,
    category: ContractCategory.SCIENCE_SURVEY,
    objectives: [
      {
        id: `obj-chain-${partNumber}-1`,
        type: ObjectiveType.HOLD_ALTITUDE,
        target: { minAltitude: minAlt, maxAltitude: maxAlt, duration },
        completed: false,
        description: `Hold between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for ${duration}s`,
      },
      {
        id: `obj-chain-${partNumber}-2`,
        type: ObjectiveType.RETURN_SCIENCE_DATA,
        target: {},
        completed: false,
        description: 'Return science data safely',
      },
    ],
    reward,
    deadlineFlights: 6,
    chainId,
    chainPart: partNumber,
    chainTotal: 3,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format altitude for display.
 * @param {number} alt - Altitude in metres.
 * @returns {string}
 */
function _fmtAlt(alt) {
  if (alt >= 1000) {
    return `${(alt / 1000).toFixed(alt % 1000 === 0 ? 0 : 1)} km`;
  }
  return `${alt} m`;
}

/**
 * Format a cash amount as a dollar string.
 * @param {number} amount
 * @returns {string}
 */
function _fmtCash(amount) {
  return '$' + amount.toLocaleString();
}
