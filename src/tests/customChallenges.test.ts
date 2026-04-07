// @ts-nocheck
/**
 * customChallenges.test.js — Unit tests for player-created custom challenges.
 *
 * Tests cover:
 *   - State initialisation (ensureCustomChallengeState)
 *   - Challenge creation with validation
 *   - Challenge deletion and state cleanup
 *   - Export to shareable JSON
 *   - Import from JSON with validation
 *   - Edge cases and error handling
 *   - OBJECTIVE_TYPE_META and SCORE_METRIC_OPTIONS constants
 */

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  OBJECTIVE_TYPE_META,
  SCORE_METRIC_OPTIONS,
  ensureCustomChallengeState,
  createCustomChallenge,
  deleteCustomChallenge,
  exportChallengeJSON,
  importChallengeJSON,
} from '../core/customChallenges.ts';
import { ObjectiveType } from '../data/missions.ts';
import { ScoreDirection } from '../data/challenges.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState() {
  const state = createGameState();
  ensureCustomChallengeState(state);
  return state;
}

/** Minimal valid challenge definition. */
function validDef(overrides = {}) {
  return {
    title: 'Test Challenge',
    description: 'A test challenge',
    objectives: [
      { type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 10000 } },
    ],
    scoreMetric: 'rocketCost',
    medals: { bronze: 50000, silver: 30000, gold: 15000 },
    rewards: { bronze: 5000, silver: 10000, gold: 20000 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Custom Challenges', () => {

  // ── Constants ─────────────────────────────────────────────────────────

  describe('OBJECTIVE_TYPE_META', () => {
    it('has metadata for all standard objective types', () => {
      const expectedTypes = [
        ObjectiveType.REACH_ALTITUDE,
        ObjectiveType.REACH_SPEED,
        ObjectiveType.SAFE_LANDING,
        ObjectiveType.HOLD_ALTITUDE,
        ObjectiveType.RETURN_SCIENCE_DATA,
        ObjectiveType.CONTROLLED_CRASH,
        ObjectiveType.EJECT_CREW,
        ObjectiveType.RELEASE_SATELLITE,
        ObjectiveType.REACH_ORBIT,
        ObjectiveType.BUDGET_LIMIT,
        ObjectiveType.MAX_PARTS,
        ObjectiveType.MULTI_SATELLITE,
        ObjectiveType.MINIMUM_CREW,
      ];
      for (const type of expectedTypes) {
        expect(OBJECTIVE_TYPE_META[type]).toBeDefined();
        expect(OBJECTIVE_TYPE_META[type].label).toBeTruthy();
        expect(typeof OBJECTIVE_TYPE_META[type].describe).toBe('function');
      }
    });

    it('generates descriptions from targets', () => {
      const desc = OBJECTIVE_TYPE_META[ObjectiveType.REACH_ALTITUDE].describe({ altitude: 5000 });
      expect(desc).toContain('5');
      expect(desc).toContain('m');
    });

    it('HOLD_ALTITUDE requires three fields', () => {
      const meta = OBJECTIVE_TYPE_META[ObjectiveType.HOLD_ALTITUDE];
      expect(meta.fields.length).toBe(3);
      const keys = meta.fields.map((f) => f.key);
      expect(keys).toContain('minAltitude');
      expect(keys).toContain('maxAltitude');
      expect(keys).toContain('duration');
    });

    it('RETURN_SCIENCE_DATA has no fields', () => {
      const meta = OBJECTIVE_TYPE_META[ObjectiveType.RETURN_SCIENCE_DATA];
      expect(meta.fields.length).toBe(0);
    });
  });

  describe('SCORE_METRIC_OPTIONS', () => {
    it('has 8 scoring metrics', () => {
      expect(SCORE_METRIC_OPTIONS.length).toBe(8);
    });

    it('each metric has value, label, unit, and direction', () => {
      for (const metric of SCORE_METRIC_OPTIONS) {
        expect(metric.value).toBeTruthy();
        expect(metric.label).toBeTruthy();
        expect(typeof metric.unit).toBe('string');
        expect(metric.direction).toBeTruthy();
      }
    });

    it('contains rocketCost as a lower-is-better metric', () => {
      const cost = SCORE_METRIC_OPTIONS.find((m) => m.value === 'rocketCost');
      expect(cost).toBeDefined();
      expect(cost.direction).toBe(ScoreDirection.LOWER_IS_BETTER);
    });

    it('contains maxAltitude as a higher-is-better metric', () => {
      const alt = SCORE_METRIC_OPTIONS.find((m) => m.value === 'maxAltitude');
      expect(alt).toBeDefined();
      expect(alt.direction).toBe(ScoreDirection.HIGHER_IS_BETTER);
    });
  });

  // ── State initialisation ──────────────────────────────────────────────

  describe('ensureCustomChallengeState', () => {
    it('creates customChallenges array if missing', () => {
      const state = createGameState();
      delete state.customChallenges;
      ensureCustomChallengeState(state);
      expect(Array.isArray(state.customChallenges)).toBe(true);
      expect(state.customChallenges.length).toBe(0);
    });

    it('preserves existing custom challenges', () => {
      const state = createGameState();
      state.customChallenges = [{ id: 'custom-abc', title: 'Existing' }];
      ensureCustomChallengeState(state);
      expect(state.customChallenges.length).toBe(1);
      expect(state.customChallenges[0].id).toBe('custom-abc');
    });

    it('replaces non-array value with empty array', () => {
      const state = createGameState();
      state.customChallenges = 'not an array';
      ensureCustomChallengeState(state);
      expect(Array.isArray(state.customChallenges)).toBe(true);
      expect(state.customChallenges.length).toBe(0);
    });
  });

  // ── Creation ──────────────────────────────────────────────────────────

  describe('createCustomChallenge', () => {
    it('creates a valid custom challenge', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef());
      expect(result.success).toBe(true);
      expect(result.challenge).toBeDefined();
      expect(result.challenge.custom).toBe(true);
      expect(result.challenge.title).toBe('Test Challenge');
      expect(state.customChallenges.length).toBe(1);
    });

    it('generates a unique ID starting with "custom-"', () => {
      const state = freshState();
      const r1 = createCustomChallenge(state, validDef());
      const r2 = createCustomChallenge(state, validDef({ title: 'Another' }));
      expect(r1.challenge.id).toMatch(/^custom-/);
      expect(r2.challenge.id).toMatch(/^custom-/);
      expect(r1.challenge.id).not.toBe(r2.challenge.id);
    });

    it('trims whitespace from title', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ title: '  Spaces  ' }));
      expect(result.challenge.title).toBe('Spaces');
    });

    it('uses default description when none provided', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ description: '' }));
      expect(result.challenge.description).toBe('A custom challenge.');
    });

    it('maps objectives with auto-generated descriptions', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({
        objectives: [
          { type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 5000 } },
          { type: ObjectiveType.SAFE_LANDING, target: { maxLandingSpeed: 10 } },
        ],
      }));
      expect(result.challenge.objectives.length).toBe(2);
      expect(result.challenge.objectives[0].id).toBe('custom-obj-0');
      expect(result.challenge.objectives[1].id).toBe('custom-obj-1');
      expect(result.challenge.objectives[0].completed).toBe(false);
      expect(result.challenge.objectives[1].completed).toBe(false);
    });

    it('uses provided objective description over auto-generated', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({
        objectives: [
          { type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 5000 }, description: 'Go high!' },
        ],
      }));
      expect(result.challenge.objectives[0].description).toBe('Go high!');
    });

    it('copies target values without sharing references', () => {
      const state = freshState();
      const target = { altitude: 5000 };
      const result = createCustomChallenge(state, validDef({
        objectives: [{ type: ObjectiveType.REACH_ALTITUDE, target }],
      }));
      target.altitude = 99999;
      expect(result.challenge.objectives[0].target.altitude).toBe(5000);
    });

    it('resolves score label and unit from SCORE_METRIC_OPTIONS', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ scoreMetric: 'rocketCost' }));
      expect(result.challenge.scoreLabel).toBe('Rocket Cost');
      expect(result.challenge.scoreUnit).toBe('$');
    });

    it('falls back to metric name when metric not in SCORE_METRIC_OPTIONS', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ scoreMetric: 'unknownMetric' }));
      expect(result.challenge.scoreLabel).toBe('unknownMetric');
      expect(result.challenge.scoreUnit).toBe('');
    });

    it('resolves scoreDirection from SCORE_METRIC_OPTIONS when not specified', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ scoreMetric: 'maxAltitude' }));
      expect(result.challenge.scoreDirection).toBe(ScoreDirection.HIGHER_IS_BETTER);
    });

    it('uses explicit scoreDirection over auto-resolved', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({
        scoreMetric: 'rocketCost',
        scoreDirection: ScoreDirection.HIGHER_IS_BETTER,
      }));
      expect(result.challenge.scoreDirection).toBe(ScoreDirection.HIGHER_IS_BETTER);
    });

    it('converts medal thresholds to numbers', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({
        medals: { bronze: '50000', silver: '30000', gold: '15000' },
      }));
      expect(result.challenge.medals.bronze).toBe(50000);
      expect(result.challenge.medals.silver).toBe(30000);
      expect(result.challenge.medals.gold).toBe(15000);
    });

    it('defaults medal values to 0 for missing fields', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ medals: {} }));
      expect(result.challenge.medals.bronze).toBe(0);
      expect(result.challenge.medals.silver).toBe(0);
      expect(result.challenge.medals.gold).toBe(0);
    });

    it('sets requiredMissions to empty array', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef());
      expect(result.challenge.requiredMissions).toEqual([]);
    });

    // ── Validation errors ───────────────────────────────────────────────

    it('fails with empty title', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ title: '' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Title');
    });

    it('fails with whitespace-only title', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ title: '   ' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Title');
    });

    it('fails with missing title', () => {
      const state = freshState();
      const def = validDef();
      delete def.title;
      const result = createCustomChallenge(state, def);
      expect(result.success).toBe(false);
    });

    it('fails with empty objectives array', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ objectives: [] }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('objective');
    });

    it('fails with missing objectives', () => {
      const state = freshState();
      const def = validDef();
      delete def.objectives;
      const result = createCustomChallenge(state, def);
      expect(result.success).toBe(false);
    });

    it('fails with missing scoreMetric', () => {
      const state = freshState();
      const result = createCustomChallenge(state, validDef({ scoreMetric: '' }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('scoring metric');
    });

    it('does not add challenge to state on validation failure', () => {
      const state = freshState();
      createCustomChallenge(state, validDef({ title: '' }));
      expect(state.customChallenges.length).toBe(0);
    });

    it('initialises state.customChallenges if missing before creation', () => {
      const state = createGameState();
      delete state.customChallenges;
      const result = createCustomChallenge(state, validDef());
      expect(result.success).toBe(true);
      expect(Array.isArray(state.customChallenges)).toBe(true);
    });
  });

  // ── Deletion ──────────────────────────────────────────────────────────

  describe('deleteCustomChallenge', () => {
    it('removes a custom challenge by ID', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());
      expect(state.customChallenges.length).toBe(1);

      const result = deleteCustomChallenge(state, challenge.id);
      expect(result.success).toBe(true);
      expect(state.customChallenges.length).toBe(0);
    });

    it('fails for nonexistent challenge ID', () => {
      const state = freshState();
      const result = deleteCustomChallenge(state, 'custom-nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('clears active challenge slot if deleted challenge was active', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());

      // Simulate accepting the custom challenge.
      state.challenges = { active: { ...challenge }, results: {} };

      deleteCustomChallenge(state, challenge.id);
      expect(state.challenges.active).toBeNull();
    });

    it('clears results for deleted challenge', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());

      // Simulate stored results.
      state.challenges = {
        active: null,
        results: { [challenge.id]: { medal: 'gold', score: 100, attempts: 1 } },
      };

      deleteCustomChallenge(state, challenge.id);
      expect(state.challenges.results[challenge.id]).toBeUndefined();
    });

    it('does not affect other challenges when deleting one', () => {
      const state = freshState();
      const { challenge: c1 } = createCustomChallenge(state, validDef({ title: 'First' }));
      createCustomChallenge(state, validDef({ title: 'Second' }));
      expect(state.customChallenges.length).toBe(2);

      deleteCustomChallenge(state, c1.id);
      expect(state.customChallenges.length).toBe(1);
      expect(state.customChallenges[0].title).toBe('Second');
    });

    it('preserves active challenge when deleting a different one', () => {
      const state = freshState();
      const { challenge: c1 } = createCustomChallenge(state, validDef({ title: 'First' }));
      const { challenge: c2 } = createCustomChallenge(state, validDef({ title: 'Second' }));

      state.challenges = { active: { ...c2 }, results: {} };

      deleteCustomChallenge(state, c1.id);
      expect(state.challenges.active.id).toBe(c2.id);
    });
  });

  // ── Export ─────────────────────────────────────────────────────────────

  describe('exportChallengeJSON', () => {
    it('produces valid JSON', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());
      const json = exportChallengeJSON(challenge);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('includes format marker and version', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());
      const data = JSON.parse(exportChallengeJSON(challenge));
      expect(data._format).toBe('SpaceAgencySim-CustomChallenge');
      expect(data._version).toBe(1);
    });

    it('preserves challenge content', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef({
        title: 'Export Test',
        description: 'Testing export',
      }));
      const data = JSON.parse(exportChallengeJSON(challenge));
      expect(data.title).toBe('Export Test');
      expect(data.description).toBe('Testing export');
      expect(data.scoreMetric).toBe('rocketCost');
      expect(data.objectives.length).toBe(1);
      expect(data.objectives[0].type).toBe(ObjectiveType.REACH_ALTITUDE);
    });

    it('strips runtime ID field', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());
      const data = JSON.parse(exportChallengeJSON(challenge));
      expect(data.id).toBeUndefined();
    });

    it('does not share object references with original', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());
      const data = JSON.parse(exportChallengeJSON(challenge));
      data.medals.bronze = 999999;
      expect(challenge.medals.bronze).toBe(50000);
    });

    it('strips completed flag from objectives', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());
      challenge.objectives[0].completed = true;
      const data = JSON.parse(exportChallengeJSON(challenge));
      expect(data.objectives[0].completed).toBeUndefined();
    });
  });

  // ── Import ─────────────────────────────────────────────────────────────

  describe('importChallengeJSON', () => {
    it('imports a valid exported challenge', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef({ title: 'Original' }));
      const json = exportChallengeJSON(challenge);

      const state2 = freshState();
      const result = importChallengeJSON(state2, json);
      expect(result.success).toBe(true);
      expect(result.challenge.title).toBe('Original');
      expect(result.challenge.custom).toBe(true);
      expect(state2.customChallenges.length).toBe(1);
    });

    it('generates a new ID on import', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef());
      const json = exportChallengeJSON(challenge);

      const state2 = freshState();
      const result = importChallengeJSON(state2, json);
      expect(result.challenge.id).toMatch(/^custom-/);
      expect(result.challenge.id).not.toBe(challenge.id);
    });

    it('round-trips objectives correctly', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef({
        objectives: [
          { type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 10000 } },
          { type: ObjectiveType.SAFE_LANDING, target: { maxLandingSpeed: 8 } },
        ],
      }));
      const json = exportChallengeJSON(challenge);

      const state2 = freshState();
      const result = importChallengeJSON(state2, json);
      expect(result.challenge.objectives.length).toBe(2);
      expect(result.challenge.objectives[0].type).toBe(ObjectiveType.REACH_ALTITUDE);
      expect(result.challenge.objectives[0].target.altitude).toBe(10000);
      expect(result.challenge.objectives[1].type).toBe(ObjectiveType.SAFE_LANDING);
    });

    it('round-trips medal and reward values', () => {
      const state = freshState();
      const { challenge } = createCustomChallenge(state, validDef({
        medals: { bronze: 50000, silver: 30000, gold: 15000 },
        rewards: { bronze: 5000, silver: 10000, gold: 20000 },
      }));
      const json = exportChallengeJSON(challenge);

      const state2 = freshState();
      const result = importChallengeJSON(state2, json);
      expect(result.challenge.medals).toEqual({ bronze: 50000, silver: 30000, gold: 15000 });
      expect(result.challenge.rewards).toEqual({ bronze: 5000, silver: 10000, gold: 20000 });
    });

    // ── Import validation errors ────────────────────────────────────────

    it('fails on invalid JSON', () => {
      const state = freshState();
      const result = importChallengeJSON(state, 'not json {{{');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JSON');
    });

    it('fails on non-object data', () => {
      const state = freshState();
      const result = importChallengeJSON(state, '"just a string"');
      expect(result.success).toBe(false);
    });

    it('fails on null data', () => {
      const state = freshState();
      const result = importChallengeJSON(state, 'null');
      expect(result.success).toBe(false);
    });

    it('fails on unrecognised format marker', () => {
      const state = freshState();
      const result = importChallengeJSON(state, JSON.stringify({
        _format: 'SomeOtherGame',
        title: 'Test',
        objectives: [{ type: 'REACH_ALTITUDE', target: {} }],
        scoreMetric: 'rocketCost',
      }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('format');
    });

    it('accepts data without format marker (raw format)', () => {
      const state = freshState();
      const result = importChallengeJSON(state, JSON.stringify({
        title: 'No Format',
        objectives: [{ type: 'REACH_ALTITUDE', target: { altitude: 1000 } }],
        scoreMetric: 'rocketCost',
      }));
      expect(result.success).toBe(true);
    });

    it('fails on missing title', () => {
      const state = freshState();
      const result = importChallengeJSON(state, JSON.stringify({
        objectives: [{ type: 'REACH_ALTITUDE', target: {} }],
        scoreMetric: 'rocketCost',
      }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('title');
    });

    it('fails on empty objectives', () => {
      const state = freshState();
      const result = importChallengeJSON(state, JSON.stringify({
        title: 'Test',
        objectives: [],
        scoreMetric: 'rocketCost',
      }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('objectives');
    });

    it('fails on missing scoreMetric', () => {
      const state = freshState();
      const result = importChallengeJSON(state, JSON.stringify({
        title: 'Test',
        objectives: [{ type: 'REACH_ALTITUDE', target: {} }],
      }));
      expect(result.success).toBe(false);
      expect(result.error).toContain('scoreMetric');
    });

    it('defaults missing objective type to REACH_ALTITUDE', () => {
      const state = freshState();
      const result = importChallengeJSON(state, JSON.stringify({
        _format: 'SpaceAgencySim-CustomChallenge',
        title: 'Fallback Type',
        objectives: [{ target: { altitude: 1000 } }],
        scoreMetric: 'rocketCost',
      }));
      expect(result.success).toBe(true);
      expect(result.challenge.objectives[0].type).toBe('REACH_ALTITUDE');
    });

    it('defaults missing medals and rewards to zero', () => {
      const state = freshState();
      const result = importChallengeJSON(state, JSON.stringify({
        title: 'No Medals',
        objectives: [{ type: 'REACH_ALTITUDE', target: { altitude: 1000 } }],
        scoreMetric: 'rocketCost',
      }));
      expect(result.success).toBe(true);
      expect(result.challenge.medals).toEqual({ bronze: 0, silver: 0, gold: 0 });
      expect(result.challenge.rewards).toEqual({ bronze: 0, silver: 0, gold: 0 });
    });

    it('does not add challenge to state on import failure', () => {
      const state = freshState();
      importChallengeJSON(state, 'invalid json!!');
      expect(state.customChallenges.length).toBe(0);
    });
  });
});
