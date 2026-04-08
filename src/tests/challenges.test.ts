// @ts-nocheck
/**
 * challenges.test.js — Unit tests for the challenge mission system.
 *
 * Tests cover:
 *   - Challenge unlocking based on mission prerequisites
 *   - Challenge acceptance and abandonment
 *   - Objective checking during flight
 *   - Score extraction and medal computation
 *   - Challenge completion and reward calculation
 *   - Replay with medal improvement
 *   - Save/load migration for challenge state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  ensureChallengeState,
  getUnlockedChallenges,
  getChallengeResult,
  getActiveChallenge,
  acceptChallenge,
  abandonChallenge,
  checkChallengeObjectives,
  extractScoreMetric,
  computeMedal,
  isBetterMedal,
  processChallengeCompletion,
} from '../core/challenges.ts';
import { CHALLENGES, MedalTier, ScoreDirection } from '../data/challenges.ts';
import { ObjectiveType } from '../data/missions.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState() {
  const state = createGameState();
  // Provide completed missions to unlock challenges.
  state.missions.completed = [
    { id: 'mission-001', title: 'M1', objectives: [], reward: 25000 },
    { id: 'mission-004', title: 'M4', objectives: [], reward: 30000 },
  ];
  return state;
}

function stateWithOrbitalMissions() {
  const state = freshState();
  // Add orbital missions needed for advanced challenges.
  state.missions.completed.push(
    { id: 'mission-016', title: 'M16', objectives: [], reward: 50000 },
    { id: 'mission-017', title: 'M17', objectives: [], reward: 60000 },
  );
  return state;
}

function makeFlightState(overrides = {}) {
  return {
    altitude: overrides.altitude ?? 0,
    velocity: overrides.velocity ?? 0,
    timeElapsed: overrides.timeElapsed ?? 0,
    events: overrides.events ?? [],
    rocketCost: overrides.rocketCost ?? 0,
    partCount: overrides.partCount ?? 0,
    partTypes: overrides.partTypes ?? [],
    crewCount: overrides.crewCount ?? 0,
    maxAltitude: overrides.maxAltitude ?? 0,
    maxVelocity: overrides.maxVelocity ?? 0,
    fuelFraction: overrides.fuelFraction ?? 1,
    hasScienceModules: overrides.hasScienceModules ?? false,
    scienceModuleRunning: overrides.scienceModuleRunning ?? false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Challenge System', () => {

  // ── State initialisation ────────────────────────────────────────────────

  describe('ensureChallengeState', () => {
    it('creates challenges property if missing', () => {
      const state = createGameState();
      delete state.challenges;
      ensureChallengeState(state);
      expect(state.challenges).toEqual({ active: null, results: {} });
    });

    it('preserves existing state', () => {
      const state = createGameState();
      state.challenges = { active: null, results: { 'ch-1': { medal: 'gold', score: 100, attempts: 1 } } };
      ensureChallengeState(state);
      expect(state.challenges.results['ch-1'].medal).toBe('gold');
    });
  });

  // ── Unlocking ──────────────────────────────────────────────────────────

  describe('getUnlockedChallenges', () => {
    it('returns challenges whose prerequisites are met', () => {
      const state = freshState();
      const unlocked = getUnlockedChallenges(state);
      // mission-004 is completed, so challenges requiring it should unlock.
      const pennyPincher = unlocked.find((ch) => ch.id === 'challenge-penny-pincher');
      expect(pennyPincher).toBeDefined();
    });

    it('does not return challenges with unmet prerequisites', () => {
      const state = createGameState();
      // No missions completed.
      const unlocked = getUnlockedChallenges(state);
      expect(unlocked.length).toBe(0);
    });

    it('unlocks orbital challenges after mission-016', () => {
      const state = stateWithOrbitalMissions();
      const unlocked = getUnlockedChallenges(state);
      const minimalist = unlocked.find((ch) => ch.id === 'challenge-minimalist');
      expect(minimalist).toBeDefined();
    });
  });

  // ── Acceptance ──────────────────────────────────────────────────────────

  describe('acceptChallenge', () => {
    it('sets the active challenge', () => {
      const state = freshState();
      const result = acceptChallenge(state, 'challenge-penny-pincher');
      expect(result.success).toBe(true);
      expect(state.challenges.active).not.toBeNull();
      expect(state.challenges.active.id).toBe('challenge-penny-pincher');
    });

    it('resets objective completion on accept', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) {
        expect(obj.completed).toBe(false);
      }
    });

    it('fails for unknown challenge id', () => {
      const state = freshState();
      const result = acceptChallenge(state, 'challenge-nonexistent');
      expect(result.success).toBe(false);
    });

    it('fails when prerequisites are not met', () => {
      const state = createGameState();
      const result = acceptChallenge(state, 'challenge-penny-pincher');
      expect(result.success).toBe(false);
    });

    it('replaces previously active challenge', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      acceptChallenge(state, 'challenge-bullseye');
      expect(state.challenges.active.id).toBe('challenge-bullseye');
    });
  });

  // ── Abandonment ─────────────────────────────────────────────────────────

  describe('abandonChallenge', () => {
    it('clears the active challenge', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      abandonChallenge(state);
      expect(state.challenges.active).toBeNull();
    });
  });

  // ── Objective checking ──────────────────────────────────────────────────

  describe('checkChallengeObjectives', () => {
    it('completes REACH_ALTITUDE objectives', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      const fs = makeFlightState({ altitude: 15000 });
      checkChallengeObjectives(state, fs);

      const altObj = state.challenges.active.objectives.find(
        (o) => o.type === ObjectiveType.REACH_ALTITUDE
      );
      expect(altObj.completed).toBe(true);
    });

    it('completes SAFE_LANDING objectives', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      const fs = makeFlightState({
        events: [{ type: 'LANDING', speed: 5, time: 100 }],
      });
      checkChallengeObjectives(state, fs);

      const landObj = state.challenges.active.objectives.find(
        (o) => o.type === ObjectiveType.SAFE_LANDING
      );
      expect(landObj.completed).toBe(true);
    });

    it('does not complete objectives when conditions are not met', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      const fs = makeFlightState({ altitude: 500 });
      checkChallengeObjectives(state, fs);

      const altObj = state.challenges.active.objectives.find(
        (o) => o.type === ObjectiveType.REACH_ALTITUDE
      );
      expect(altObj.completed).toBe(false);
    });

    it('no-ops when no active challenge', () => {
      const state = freshState();
      const fs = makeFlightState({ altitude: 15000 });
      // Should not throw.
      checkChallengeObjectives(state, fs);
    });
  });

  // ── Score extraction ───────────────────────────────────────────────────

  describe('extractScoreMetric', () => {
    it('extracts rocketCost', () => {
      const fs = makeFlightState({ rocketCost: 25000 });
      expect(extractScoreMetric('rocketCost', fs, null)).toBe(25000);
    });

    it('extracts landingSpeed from LANDING event', () => {
      const fs = makeFlightState({
        events: [{ type: 'LANDING', speed: 3.5, time: 100 }],
      });
      expect(extractScoreMetric('landingSpeed', fs, null)).toBe(3.5);
    });

    it('extracts partCount', () => {
      const fs = makeFlightState({ partCount: 7 });
      expect(extractScoreMetric('partCount', fs, null)).toBe(7);
    });

    it('extracts maxAltitude', () => {
      const fs = makeFlightState({ maxAltitude: 150000 });
      expect(extractScoreMetric('maxAltitude', fs, null)).toBe(150000);
    });

    it('extracts maxVelocity', () => {
      const fs = makeFlightState({ maxVelocity: 3000 });
      expect(extractScoreMetric('maxVelocity', fs, null)).toBe(3000);
    });

    it('extracts fuelRemaining from fuelFraction', () => {
      const fs = makeFlightState({ fuelFraction: 0.25 });
      expect(extractScoreMetric('fuelRemaining', fs, null)).toBe(25);
    });

    it('extracts fuelRemaining from ps when available', () => {
      const fs = makeFlightState();
      const ps = { totalFuel: 30, maxFuel: 100 };
      expect(extractScoreMetric('fuelRemaining', fs, ps)).toBe(30);
    });

    it('returns null for unknown metric', () => {
      const fs = makeFlightState();
      expect(extractScoreMetric('unknownMetric', fs, null)).toBeNull();
    });
  });

  // ── Medal computation ──────────────────────────────────────────────────

  describe('computeMedal', () => {
    const lowerIsBetter = {
      scoreDirection: ScoreDirection.LOWER_IS_BETTER,
      medals: { bronze: 50000, silver: 30000, gold: 15000 },
    };

    const higherIsBetter = {
      scoreDirection: ScoreDirection.HIGHER_IS_BETTER,
      medals: { bronze: 100000, silver: 250000, gold: 500000 },
    };

    it('awards gold for lower-is-better when score <= gold', () => {
      expect(computeMedal(lowerIsBetter, 10000)).toBe(MedalTier.GOLD);
    });

    it('awards silver for lower-is-better when score <= silver', () => {
      expect(computeMedal(lowerIsBetter, 25000)).toBe(MedalTier.SILVER);
    });

    it('awards bronze for lower-is-better when score <= bronze', () => {
      expect(computeMedal(lowerIsBetter, 45000)).toBe(MedalTier.BRONZE);
    });

    it('awards none when score exceeds bronze threshold (lower-is-better)', () => {
      expect(computeMedal(lowerIsBetter, 60000)).toBe(MedalTier.NONE);
    });

    it('awards gold for higher-is-better when score >= gold', () => {
      expect(computeMedal(higherIsBetter, 600000)).toBe(MedalTier.GOLD);
    });

    it('awards silver for higher-is-better when score >= silver', () => {
      expect(computeMedal(higherIsBetter, 300000)).toBe(MedalTier.SILVER);
    });

    it('awards bronze for higher-is-better when score >= bronze', () => {
      expect(computeMedal(higherIsBetter, 150000)).toBe(MedalTier.BRONZE);
    });

    it('awards none when score below bronze (higher-is-better)', () => {
      expect(computeMedal(higherIsBetter, 50000)).toBe(MedalTier.NONE);
    });

    it('awards exact threshold medal (boundary)', () => {
      expect(computeMedal(lowerIsBetter, 15000)).toBe(MedalTier.GOLD);
      expect(computeMedal(higherIsBetter, 500000)).toBe(MedalTier.GOLD);
    });
  });

  // ── Medal comparison ───────────────────────────────────────────────────

  describe('isBetterMedal', () => {
    it('gold is better than silver', () => {
      expect(isBetterMedal(MedalTier.GOLD, MedalTier.SILVER)).toBe(true);
    });

    it('silver is better than bronze', () => {
      expect(isBetterMedal(MedalTier.SILVER, MedalTier.BRONZE)).toBe(true);
    });

    it('bronze is better than none', () => {
      expect(isBetterMedal(MedalTier.BRONZE, MedalTier.NONE)).toBe(true);
    });

    it('same medal is not better', () => {
      expect(isBetterMedal(MedalTier.GOLD, MedalTier.GOLD)).toBe(false);
    });

    it('lower medal is not better', () => {
      expect(isBetterMedal(MedalTier.BRONZE, MedalTier.GOLD)).toBe(false);
    });
  });

  // ── Challenge completion ───────────────────────────────────────────────

  describe('processChallengeCompletion', () => {
    it('@smoke completes challenge when all objectives met and awards medal', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');

      // Mark all objectives as completed.
      for (const obj of state.challenges.active.objectives) {
        obj.completed = true;
      }

      const fs = makeFlightState({
        rocketCost: 20000,
        events: [{ type: 'LANDING', speed: 5, time: 100 }],
      });

      const result = processChallengeCompletion(state, fs, null);
      expect(result.completed).toBe(true);
      expect(result.medal).toBe(MedalTier.SILVER);
      expect(result.score).toBe(20000);
      expect(result.isNewBest).toBe(true);
      expect(result.reward).toBeGreaterThan(0);
    });

    it('clears active challenge after completion', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) {
        obj.completed = true;
      }
      const fs = makeFlightState({ rocketCost: 20000 });
      processChallengeCompletion(state, fs, null);
      expect(state.challenges.active).toBeNull();
    });

    it('stores best result', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) {
        obj.completed = true;
      }
      const fs = makeFlightState({ rocketCost: 40000 });
      processChallengeCompletion(state, fs, null);

      const stored = getChallengeResult(state, 'challenge-penny-pincher');
      expect(stored).not.toBeNull();
      expect(stored.medal).toBe(MedalTier.BRONZE);
      expect(stored.score).toBe(40000);
      expect(stored.attempts).toBe(1);
    });

    it('does not complete when objectives are not all met', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      // Only complete the first objective.
      state.challenges.active.objectives[0].completed = true;

      const fs = makeFlightState({ rocketCost: 10000 });
      const result = processChallengeCompletion(state, fs, null);
      expect(result.completed).toBe(false);
    });

    it('clears active challenge on failed attempt', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      const fs = makeFlightState({ rocketCost: 10000 });
      processChallengeCompletion(state, fs, null);
      expect(state.challenges.active).toBeNull();
    });

    it('returns completed: false when no active challenge', () => {
      const state = freshState();
      const fs = makeFlightState();
      const result = processChallengeCompletion(state, fs, null);
      expect(result.completed).toBe(false);
    });

    it('increments attempts on replay', () => {
      const state = freshState();

      // First attempt: bronze
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) obj.completed = true;
      processChallengeCompletion(state, makeFlightState({ rocketCost: 40000 }), null);

      // Second attempt: still bronze
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) obj.completed = true;
      processChallengeCompletion(state, makeFlightState({ rocketCost: 45000 }), null);

      const stored = getChallengeResult(state, 'challenge-penny-pincher');
      expect(stored.attempts).toBe(2);
      // Original better score should be preserved.
      expect(stored.score).toBe(40000);
    });

    it('upgrades medal on better replay', () => {
      const state = freshState();
      const moneyBefore = state.money;

      // First attempt: bronze (cost = 40000)
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) obj.completed = true;
      const r1 = processChallengeCompletion(state, makeFlightState({ rocketCost: 40000 }), null);
      expect(r1.medal).toBe(MedalTier.BRONZE);
      const bronzeReward = r1.reward;

      // Second attempt: gold (cost = 10000)
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) obj.completed = true;
      const r2 = processChallengeCompletion(state, makeFlightState({ rocketCost: 10000 }), null);
      expect(r2.medal).toBe(MedalTier.GOLD);
      expect(r2.isNewBest).toBe(true);
      // Reward should be the delta (gold - bronze reward).
      expect(r2.reward).toBeGreaterThan(0);
      expect(r2.reward).toBeLessThan(CHALLENGES.find((c) => c.id === 'challenge-penny-pincher').rewards.gold);

      const stored = getChallengeResult(state, 'challenge-penny-pincher');
      expect(stored.medal).toBe(MedalTier.GOLD);
      expect(stored.score).toBe(10000);
    });

    it('does not downgrade medal on worse replay', () => {
      const state = freshState();

      // First attempt: gold
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) obj.completed = true;
      processChallengeCompletion(state, makeFlightState({ rocketCost: 10000 }), null);

      // Second attempt: bronze
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active.objectives) obj.completed = true;
      const r2 = processChallengeCompletion(state, makeFlightState({ rocketCost: 45000 }), null);
      expect(r2.isNewBest).toBe(false);
      expect(r2.reward).toBe(0);

      const stored = getChallengeResult(state, 'challenge-penny-pincher');
      expect(stored.medal).toBe(MedalTier.GOLD);
      expect(stored.score).toBe(10000);
    });
  });

  // ── Data integrity ────────────────────────────────────────────────────

  describe('Challenge definitions', () => {
    it('all challenges have unique IDs', () => {
      const ids = CHALLENGES.map((ch) => ch.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all challenges have required fields', () => {
      for (const ch of CHALLENGES) {
        expect(ch.id).toBeTruthy();
        expect(ch.title).toBeTruthy();
        expect(ch.description).toBeTruthy();
        expect(ch.briefing).toBeTruthy();
        expect(Array.isArray(ch.objectives)).toBe(true);
        expect(ch.objectives.length).toBeGreaterThan(0);
        expect(ch.scoreMetric).toBeTruthy();
        expect(ch.scoreDirection).toBeTruthy();
        expect(ch.medals).toBeDefined();
        expect(typeof ch.medals.bronze).toBe('number');
        expect(typeof ch.medals.silver).toBe('number');
        expect(typeof ch.medals.gold).toBe('number');
        expect(ch.rewards).toBeDefined();
        expect(typeof ch.rewards.bronze).toBe('number');
        expect(typeof ch.rewards.silver).toBe('number');
        expect(typeof ch.rewards.gold).toBe('number');
      }
    });

    it('medal thresholds are ordered correctly', () => {
      for (const ch of CHALLENGES) {
        if (ch.scoreDirection === ScoreDirection.LOWER_IS_BETTER) {
          // Bronze > Silver > Gold (lower thresholds are harder)
          expect(ch.medals.bronze).toBeGreaterThanOrEqual(ch.medals.silver);
          expect(ch.medals.silver).toBeGreaterThanOrEqual(ch.medals.gold);
        } else {
          // Bronze < Silver < Gold (higher thresholds are harder)
          expect(ch.medals.bronze).toBeLessThanOrEqual(ch.medals.silver);
          expect(ch.medals.silver).toBeLessThanOrEqual(ch.medals.gold);
        }
      }
    });

    it('reward amounts increase with medal tier', () => {
      for (const ch of CHALLENGES) {
        expect(ch.rewards.silver).toBeGreaterThan(ch.rewards.bronze);
        expect(ch.rewards.gold).toBeGreaterThan(ch.rewards.silver);
      }
    });
  });
});
