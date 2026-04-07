/**
 * challenges.ts — Hand-crafted challenge mission definitions with medal scoring.
 *
 * Challenges are replayable missions with constraints and a scoring metric.
 * Each challenge awards Bronze, Silver, or Gold medals based on performance.
 * Challenges use the same objective types as missions/contracts but add a
 * scoring dimension.
 *
 * STRUCTURE
 * =========
 * Each challenge has:
 *   - A set of objectives that MUST all be completed (pass/fail gate)
 *   - A scoring metric (what is measured for medal thresholds)
 *   - Bronze / Silver / Gold thresholds for the scoring metric
 *   - A cash reward per medal tier
 *
 * Scoring metrics are extracted from flightState at end-of-flight:
 *   - 'rocketCost'       — total build cost (lower is better)
 *   - 'landingSpeed'     — touchdown speed in m/s (lower is better)
 *   - 'partCount'        — total parts used (lower is better)
 *   - 'maxAltitude'      — peak altitude reached (higher is better)
 *   - 'timeElapsed'      — flight duration in seconds (lower is better)
 *   - 'fuelRemaining'    — fuel fraction remaining 0–1 (higher is better)
 *   - 'satellitesDeployed' — count of satellites released (higher is better)
 *
 * @module data/challenges
 */

import { ObjectiveType } from './missions.ts';
import { PartType } from '../core/constants.ts';
import type { ChallengeDef, MedalThresholds, ObjectiveDef } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Medal tiers for challenge scoring.
 */
export const MedalTier = Object.freeze({
  NONE:   'none',
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD:   'gold',
} as const);

export type MedalTier = (typeof MedalTier)[keyof typeof MedalTier];

/**
 * Scoring direction — whether lower or higher values are better.
 */
export const ScoreDirection = Object.freeze({
  LOWER_IS_BETTER:  'lower',
  HIGHER_IS_BETTER: 'higher',
} as const);

export type ScoreDirection = (typeof ScoreDirection)[keyof typeof ScoreDirection];

// ---------------------------------------------------------------------------
// Challenge Catalog
// ---------------------------------------------------------------------------

export const CHALLENGES: ChallengeDef[] = [

  // =========================================================================
  // 1. Penny Pincher — reach 10 km on a tight budget
  // =========================================================================
  {
    id: 'challenge-penny-pincher',
    title: 'Penny Pincher',
    description:
      'The board of directors wants results on a shoestring budget. ' +
      'Reach 10 km altitude and land safely — spending as little as possible.',
    briefing: 'Reach 10 km altitude, land safely. Scored on rocket cost (lower is better).',
    objectives: [
      {
        id: 'ch-pp-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 10_000 },
        completed: false,
        description: 'Reach 10,000 m altitude',
      },
      {
        id: 'ch-pp-2',
        type: ObjectiveType.SAFE_LANDING,
        target: { maxLandingSpeed: 8 },
        completed: false,
        description: 'Land safely (< 8 m/s)',
      },
    ],
    scoreMetric: 'rocketCost',
    scoreLabel: 'Rocket Cost',
    scoreUnit: '$',
    scoreDirection: ScoreDirection.LOWER_IS_BETTER,
    medals: {
      bronze: 50_000,
      silver: 30_000,
      gold:   15_000,
    },
    rewards: {
      bronze: 20_000,
      silver: 50_000,
      gold:   100_000,
    },
    requiredMissions: ['mission-004'],
  },

  // =========================================================================
  // 2. Bullseye — land with the lowest possible speed
  // =========================================================================
  {
    id: 'challenge-bullseye',
    title: 'Bullseye',
    description:
      'A perfect landing is an art form. Reach at least 5 km altitude, then ' +
      'touch down as gently as humanly possible. The judges are watching.',
    briefing: 'Reach 5 km, then land. Scored on landing speed (lower is better).',
    objectives: [
      {
        id: 'ch-bull-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 5_000 },
        completed: false,
        description: 'Reach 5,000 m altitude',
      },
      {
        id: 'ch-bull-2',
        type: ObjectiveType.SAFE_LANDING,
        target: { maxLandingSpeed: 10 },
        completed: false,
        description: 'Land safely (< 10 m/s)',
      },
    ],
    scoreMetric: 'landingSpeed',
    scoreLabel: 'Landing Speed',
    scoreUnit: 'm/s',
    scoreDirection: ScoreDirection.LOWER_IS_BETTER,
    medals: {
      bronze: 5.0,
      silver: 2.0,
      gold:   0.5,
    },
    rewards: {
      bronze: 15_000,
      silver: 40_000,
      gold:   80_000,
    },
    requiredMissions: ['mission-004'],
  },

  // =========================================================================
  // 3. Minimalist — reach orbit with the fewest parts
  // =========================================================================
  {
    id: 'challenge-minimalist',
    title: 'Minimalist',
    description:
      'Less is more. Reach orbit using the fewest parts possible. ' +
      'Every bolt counts — strip your rocket down to the bare essentials.',
    briefing: 'Reach orbit. Scored on total part count (lower is better).',
    objectives: [
      {
        id: 'ch-min-1',
        type: ObjectiveType.REACH_ORBIT,
        target: { orbitAltitude: 80_000, orbitalVelocity: 2200 },
        completed: false,
        description: 'Reach stable orbit (80 km+, 2200+ m/s)',
      },
    ],
    scoreMetric: 'partCount',
    scoreLabel: 'Total Parts',
    scoreUnit: 'parts',
    scoreDirection: ScoreDirection.LOWER_IS_BETTER,
    medals: {
      bronze: 12,
      silver: 8,
      gold:   5,
    },
    rewards: {
      bronze: 25_000,
      silver: 60_000,
      gold:   120_000,
    },
    requiredMissions: ['mission-016'],
  },

  // =========================================================================
  // 4. Heavy Lifter — deploy 3 satellites in one flight
  // =========================================================================
  {
    id: 'challenge-heavy-lifter',
    title: 'Heavy Lifter',
    description:
      'Our satellite network needs expansion — fast. Deploy three satellites ' +
      'in a single flight, all above 100 km. Efficiency is king.',
    briefing: 'Deploy 3 satellites above 100 km in one flight. Scored on rocket cost.',
    objectives: [
      {
        id: 'ch-hl-1',
        type: ObjectiveType.MULTI_SATELLITE,
        target: { count: 3, minAltitude: 100_000 },
        completed: false,
        description: 'Deploy 3 satellites above 100 km',
      },
    ],
    scoreMetric: 'rocketCost',
    scoreLabel: 'Rocket Cost',
    scoreUnit: '$',
    scoreDirection: ScoreDirection.LOWER_IS_BETTER,
    medals: {
      bronze: 500_000,
      silver: 300_000,
      gold:   150_000,
    },
    rewards: {
      bronze: 50_000,
      silver: 100_000,
      gold:   200_000,
    },
    requiredMissions: ['mission-017'],
  },

  // =========================================================================
  // 5. Sky High — reach the highest altitude possible
  // =========================================================================
  {
    id: 'challenge-sky-high',
    title: 'Sky High',
    description:
      'How high can you go? Push your rocket to the absolute limit. ' +
      'No orbit required — just raw altitude. The sky is NOT the limit.',
    briefing: 'Reach the highest altitude you can. Scored on peak altitude.',
    objectives: [
      {
        id: 'ch-sh-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 50_000 },
        completed: false,
        description: 'Reach at least 50 km altitude',
      },
    ],
    scoreMetric: 'maxAltitude',
    scoreLabel: 'Peak Altitude',
    scoreUnit: 'm',
    scoreDirection: ScoreDirection.HIGHER_IS_BETTER,
    medals: {
      bronze: 100_000,
      silver: 250_000,
      gold:   500_000,
    },
    rewards: {
      bronze: 20_000,
      silver: 50_000,
      gold:   100_000,
    },
    requiredMissions: ['mission-004'],
  },

  // =========================================================================
  // 6. Speed Demon — reach the fastest speed
  // =========================================================================
  {
    id: 'challenge-speed-demon',
    title: 'Speed Demon',
    description:
      'Velocity is everything. Build the fastest rocket you can and push it ' +
      'to its limits. Safety is... optional.',
    briefing: 'Reach the highest speed possible. No landing required.',
    objectives: [
      {
        id: 'ch-sd-1',
        type: ObjectiveType.REACH_SPEED,
        target: { speed: 1000 },
        completed: false,
        description: 'Reach at least 1,000 m/s',
      },
    ],
    scoreMetric: 'maxVelocity',
    scoreLabel: 'Peak Speed',
    scoreUnit: 'm/s',
    scoreDirection: ScoreDirection.HIGHER_IS_BETTER,
    medals: {
      bronze: 1_500,
      silver: 2_500,
      gold:   4_000,
    },
    rewards: {
      bronze: 20_000,
      silver: 50_000,
      gold:   100_000,
    },
    requiredMissions: ['mission-004'],
  },

  // =========================================================================
  // 7. Budget Orbiter — reach orbit as cheaply as possible
  // =========================================================================
  {
    id: 'challenge-budget-orbiter',
    title: 'Budget Orbiter',
    description:
      'Space on a budget! Reach orbit and return safely while spending as ' +
      'little as possible. Every dollar saved is a dollar earned.',
    briefing: 'Reach orbit, land safely. Scored on rocket cost (lower is better).',
    objectives: [
      {
        id: 'ch-bo-1',
        type: ObjectiveType.REACH_ORBIT,
        target: { orbitAltitude: 80_000, orbitalVelocity: 2200 },
        completed: false,
        description: 'Reach stable orbit (80 km+, 2200+ m/s)',
      },
      {
        id: 'ch-bo-2',
        type: ObjectiveType.SAFE_LANDING,
        target: { maxLandingSpeed: 8 },
        completed: false,
        description: 'Land safely (< 8 m/s)',
      },
    ],
    scoreMetric: 'rocketCost',
    scoreLabel: 'Rocket Cost',
    scoreUnit: '$',
    scoreDirection: ScoreDirection.LOWER_IS_BETTER,
    medals: {
      bronze: 300_000,
      silver: 150_000,
      gold:   75_000,
    },
    rewards: {
      bronze: 40_000,
      silver: 80_000,
      gold:   150_000,
    },
    requiredMissions: ['mission-016'],
  },

  // =========================================================================
  // 8. Featherweight — land with minimal fuel remaining (efficiency)
  // =========================================================================
  {
    id: 'challenge-featherweight',
    title: 'Featherweight',
    description:
      'A true pilot uses every last drop. Reach 20 km, land safely, and ' +
      'use as much of your fuel as possible. Waste not, want not.',
    briefing: 'Reach 20 km, land safely. Scored on fuel remaining (lower is better).',
    objectives: [
      {
        id: 'ch-fw-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 20_000 },
        completed: false,
        description: 'Reach 20,000 m altitude',
      },
      {
        id: 'ch-fw-2',
        type: ObjectiveType.SAFE_LANDING,
        target: { maxLandingSpeed: 8 },
        completed: false,
        description: 'Land safely (< 8 m/s)',
      },
    ],
    scoreMetric: 'fuelRemaining',
    scoreLabel: 'Fuel Remaining',
    scoreUnit: '%',
    scoreDirection: ScoreDirection.LOWER_IS_BETTER,
    medals: {
      bronze: 30,
      silver: 15,
      gold:    5,
    },
    rewards: {
      bronze: 15_000,
      silver: 40_000,
      gold:   80_000,
    },
    requiredMissions: ['mission-004'],
  },

];
