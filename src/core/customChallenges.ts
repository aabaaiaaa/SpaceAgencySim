/**
 * customChallenges.ts — Player-created custom challenge management.
 *
 * Custom challenges are personal challenges that players define themselves.
 * They use the same objective types and scoring metrics as official challenges
 * but are stored in gameState.customChallenges and clearly marked as custom.
 *
 * Players can export/import custom challenges as JSON for sharing.
 *
 * STATE STRUCTURE
 * ===============
 * state.customChallenges = ChallengeDef[]
 *   Each entry has the same shape as a ChallengeDef from data/challenges.js
 *   with an additional `custom: true` flag.
 *
 * @module core/customChallenges
 */

import { ObjectiveType } from '../data/missions.js';
import { MedalTier, ScoreDirection } from '../data/challenges.js';
import type { GameState, ChallengeDef, ObjectiveDef } from './gameState.js';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface ObjectiveTypeField {
  key: string;
  label: string;
  type: string;
  min: number;
  optional?: boolean;
}

interface ObjectiveTypeMeta {
  label: string;
  fields: ObjectiveTypeField[];
  describe: (target: Record<string, any>) => string;
}

interface ScoreMetricOption {
  value: string;
  label: string;
  unit: string;
  direction: string;
}

interface CustomChallengeDef {
  title: string;
  description?: string;
  briefing?: string;
  objectives: Array<{ type: string; target: Record<string, any>; description?: string }>;
  scoreMetric: string;
  scoreDirection?: string;
  medals: { bronze: number; silver: number; gold: number };
  rewards: { bronze: number; silver: number; gold: number };
}

interface CreateResult {
  success: boolean;
  challenge?: ChallengeDef;
  error?: string;
}

// ---------------------------------------------------------------------------
// Objective type metadata — drives the creator form
// ---------------------------------------------------------------------------

/**
 * Metadata for each objective type describing what target fields it needs
 * and how to auto-generate a description.
 */
export const OBJECTIVE_TYPE_META: Record<string, ObjectiveTypeMeta> = {
  [ObjectiveType.REACH_ALTITUDE]: {
    label: 'Reach Altitude',
    fields: [{ key: 'altitude', label: 'Altitude (m)', type: 'number', min: 1 }],
    describe: (t: Record<string, any>) => `Reach ${t.altitude.toLocaleString()} m altitude`,
  },
  [ObjectiveType.REACH_SPEED]: {
    label: 'Reach Speed',
    fields: [{ key: 'speed', label: 'Speed (m/s)', type: 'number', min: 1 }],
    describe: (t: Record<string, any>) => `Reach ${t.speed.toLocaleString()} m/s`,
  },
  [ObjectiveType.SAFE_LANDING]: {
    label: 'Safe Landing',
    fields: [{ key: 'maxLandingSpeed', label: 'Max landing speed (m/s)', type: 'number', min: 0.1 }],
    describe: (t: Record<string, any>) => `Land safely (< ${t.maxLandingSpeed} m/s)`,
  },
  [ObjectiveType.HOLD_ALTITUDE]: {
    label: 'Hold Altitude',
    fields: [
      { key: 'minAltitude', label: 'Min altitude (m)', type: 'number', min: 0 },
      { key: 'maxAltitude', label: 'Max altitude (m)', type: 'number', min: 1 },
      { key: 'duration', label: 'Duration (seconds)', type: 'number', min: 1 },
    ],
    describe: (t: Record<string, any>) => `Hold ${t.minAltitude.toLocaleString()}–${t.maxAltitude.toLocaleString()} m for ${t.duration}s`,
  },
  [ObjectiveType.RETURN_SCIENCE_DATA]: {
    label: 'Return Science Data',
    fields: [],
    describe: () => 'Collect science data and land safely',
  },
  [ObjectiveType.CONTROLLED_CRASH]: {
    label: 'Controlled Crash',
    fields: [{ key: 'minCrashSpeed', label: 'Min crash speed (m/s)', type: 'number', min: 1 }],
    describe: (t: Record<string, any>) => `Crash at >= ${t.minCrashSpeed} m/s`,
  },
  [ObjectiveType.EJECT_CREW]: {
    label: 'Eject Crew',
    fields: [{ key: 'minAltitude', label: 'Min altitude (m)', type: 'number', min: 0 }],
    describe: (t: Record<string, any>) => `Eject crew above ${t.minAltitude.toLocaleString()} m`,
  },
  [ObjectiveType.RELEASE_SATELLITE]: {
    label: 'Release Satellite',
    fields: [
      { key: 'minAltitude', label: 'Min altitude (m)', type: 'number', min: 1 },
      { key: 'minVelocity', label: 'Min velocity (m/s, optional)', type: 'number', min: 0, optional: true },
    ],
    describe: (t: Record<string, any>) => `Release satellite above ${t.minAltitude.toLocaleString()} m` +
      (t.minVelocity ? ` at >= ${t.minVelocity} m/s` : ''),
  },
  [ObjectiveType.REACH_ORBIT]: {
    label: 'Reach Orbit',
    fields: [
      { key: 'orbitAltitude', label: 'Orbit altitude (m)', type: 'number', min: 1 },
      { key: 'orbitalVelocity', label: 'Orbital velocity (m/s)', type: 'number', min: 1 },
    ],
    describe: (t: Record<string, any>) => `Reach orbit (${(t.orbitAltitude / 1000).toFixed(0)} km+, ${t.orbitalVelocity}+ m/s)`,
  },
  [ObjectiveType.BUDGET_LIMIT]: {
    label: 'Budget Limit',
    fields: [{ key: 'maxCost', label: 'Max cost ($)', type: 'number', min: 1 }],
    describe: (t: Record<string, any>) => `Spend no more than $${t.maxCost.toLocaleString()}`,
  },
  [ObjectiveType.MAX_PARTS]: {
    label: 'Max Parts',
    fields: [{ key: 'maxParts', label: 'Max parts', type: 'number', min: 1 }],
    describe: (t: Record<string, any>) => `Use no more than ${t.maxParts} parts`,
  },
  [ObjectiveType.MULTI_SATELLITE]: {
    label: 'Multi Satellite',
    fields: [
      { key: 'count', label: 'Satellite count', type: 'number', min: 2 },
      { key: 'minAltitude', label: 'Min altitude (m)', type: 'number', min: 1 },
    ],
    describe: (t: Record<string, any>) => `Deploy ${t.count} satellites above ${t.minAltitude.toLocaleString()} m`,
  },
  [ObjectiveType.MINIMUM_CREW]: {
    label: 'Minimum Crew',
    fields: [{ key: 'minCrew', label: 'Min crew', type: 'number', min: 1 }],
    describe: (t: Record<string, any>) => `Fly with at least ${t.minCrew} crew`,
  },
};

/**
 * Score metrics available in the creator form.
 */
export const SCORE_METRIC_OPTIONS: ScoreMetricOption[] = [
  { value: 'rocketCost',         label: 'Rocket Cost',         unit: '$',          direction: ScoreDirection.LOWER_IS_BETTER },
  { value: 'landingSpeed',       label: 'Landing Speed',       unit: 'm/s',        direction: ScoreDirection.LOWER_IS_BETTER },
  { value: 'partCount',          label: 'Part Count',          unit: 'parts',      direction: ScoreDirection.LOWER_IS_BETTER },
  { value: 'maxAltitude',        label: 'Peak Altitude',       unit: 'm',          direction: ScoreDirection.HIGHER_IS_BETTER },
  { value: 'maxVelocity',        label: 'Peak Speed',          unit: 'm/s',        direction: ScoreDirection.HIGHER_IS_BETTER },
  { value: 'timeElapsed',        label: 'Flight Duration',     unit: 's',          direction: ScoreDirection.LOWER_IS_BETTER },
  { value: 'fuelRemaining',      label: 'Fuel Remaining',      unit: '%',          direction: ScoreDirection.HIGHER_IS_BETTER },
  { value: 'satellitesDeployed', label: 'Satellites Deployed',  unit: 'satellites', direction: ScoreDirection.HIGHER_IS_BETTER },
];

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Ensure state.customChallenges exists.
 */
export function ensureCustomChallengeState(state: GameState): void {
  if (!Array.isArray(state.customChallenges)) {
    state.customChallenges = [];
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Generate a unique ID for a custom challenge.
 */
function _generateId(): string {
  return 'custom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * Create a new custom challenge and add it to state.
 *
 * Accepts a partial definition — fills in defaults and generates an ID.
 * No validation beyond basic structure; broken missions are accepted per spec.
 */
export function createCustomChallenge(state: GameState, def: CustomChallengeDef): CreateResult {
  ensureCustomChallengeState(state);

  if (!def.title || !def.title.trim()) {
    return { success: false, error: 'Title is required.' };
  }
  if (!Array.isArray(def.objectives) || def.objectives.length === 0) {
    return { success: false, error: 'At least one objective is required.' };
  }
  if (!def.scoreMetric) {
    return { success: false, error: 'A scoring metric is required.' };
  }

  const metricInfo = SCORE_METRIC_OPTIONS.find((m) => m.value === def.scoreMetric);

  const challenge: ChallengeDef = {
    id: _generateId(),
    custom: true,
    title: def.title.trim(),
    description: (def.description || '').trim() || 'A custom challenge.',
    briefing: (def.briefing || '').trim() || '',
    objectives: def.objectives.map((obj, i): ObjectiveDef => ({
      id: `custom-obj-${i}`,
      type: obj.type,
      target: { ...obj.target },
      completed: false,
      description: obj.description || _autoDescription(obj.type, obj.target),
    })),
    scoreMetric: def.scoreMetric,
    scoreLabel: metricInfo?.label ?? def.scoreMetric,
    scoreUnit: metricInfo?.unit ?? '',
    scoreDirection: def.scoreDirection || metricInfo?.direction || ScoreDirection.LOWER_IS_BETTER,
    medals: {
      bronze: Number(def.medals?.bronze) || 0,
      silver: Number(def.medals?.silver) || 0,
      gold:   Number(def.medals?.gold)   || 0,
    },
    rewards: {
      bronze: Number(def.rewards?.bronze) || 0,
      silver: Number(def.rewards?.silver) || 0,
      gold:   Number(def.rewards?.gold)   || 0,
    },
    requiredMissions: [],
  };

  state.customChallenges.push(challenge);
  return { success: true, challenge };
}

/**
 * Auto-generate an objective description from type + target.
 */
function _autoDescription(type: string, target: Record<string, any>): string {
  const meta = OBJECTIVE_TYPE_META[type];
  if (meta && meta.describe) {
    try { return meta.describe(target); } catch { /* fall through */ }
  }
  return type;
}

/**
 * Delete a custom challenge by ID.
 *
 * Also clears it from active slot and results if present.
 */
export function deleteCustomChallenge(state: GameState, challengeId: string): { success: boolean; error?: string } {
  ensureCustomChallengeState(state);

  const idx = state.customChallenges.findIndex((c) => c.id === challengeId);
  if (idx === -1) {
    return { success: false, error: 'Custom challenge not found.' };
  }

  state.customChallenges.splice(idx, 1);

  // Clear from active if it was the active challenge.
  if (state.challenges?.active?.id === challengeId) {
    state.challenges.active = null;
  }
  // Clear results.
  if (state.challenges?.results?.[challengeId]) {
    delete state.challenges.results[challengeId];
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

/** Version tag embedded in exported JSON for forward compatibility. */
const EXPORT_VERSION = 1;

/**
 * Export a single custom challenge as a shareable JSON string.
 *
 * Strips runtime fields (id, custom flag is kept for re-import detection).
 */
export function exportChallengeJSON(challenge: ChallengeDef): string {
  const exportData = {
    _format: 'SpaceAgencySim-CustomChallenge',
    _version: EXPORT_VERSION,
    title: challenge.title,
    description: challenge.description,
    briefing: challenge.briefing,
    objectives: challenge.objectives.map((obj) => ({
      type: obj.type,
      target: { ...obj.target },
      description: obj.description,
    })),
    scoreMetric: challenge.scoreMetric,
    scoreLabel: challenge.scoreLabel,
    scoreUnit: challenge.scoreUnit,
    scoreDirection: challenge.scoreDirection,
    medals: { ...challenge.medals },
    rewards: { ...challenge.rewards },
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * Import a custom challenge from a JSON string.
 *
 * Performs basic structural validation but accepts potentially broken
 * configurations per the spec ("assumes player understands what they're doing").
 */
export function importChallengeJSON(state: GameState, jsonStr: string): CreateResult {
  ensureCustomChallengeState(state);

  let data: any;
  try {
    data = JSON.parse(jsonStr);
  } catch (e: any) {
    return { success: false, error: 'Invalid JSON: ' + e.message };
  }

  if (!data || typeof data !== 'object') {
    return { success: false, error: 'Invalid data format.' };
  }

  // Accept both raw and wrapped formats.
  if (data._format && data._format !== 'SpaceAgencySim-CustomChallenge') {
    return { success: false, error: 'Unrecognised format: ' + data._format };
  }

  if (!data.title || typeof data.title !== 'string') {
    return { success: false, error: 'Missing or invalid title.' };
  }
  if (!Array.isArray(data.objectives) || data.objectives.length === 0) {
    return { success: false, error: 'Missing or empty objectives.' };
  }
  if (!data.scoreMetric || typeof data.scoreMetric !== 'string') {
    return { success: false, error: 'Missing scoreMetric.' };
  }

  return createCustomChallenge(state, {
    title: data.title,
    description: data.description || '',
    briefing: data.briefing || '',
    objectives: data.objectives.map((obj: any) => ({
      type: obj.type || 'REACH_ALTITUDE',
      target: obj.target || {},
      description: obj.description || '',
    })),
    scoreMetric: data.scoreMetric,
    scoreDirection: data.scoreDirection,
    medals: data.medals || { bronze: 0, silver: 0, gold: 0 },
    rewards: data.rewards || { bronze: 0, silver: 0, gold: 0 },
  });
}
