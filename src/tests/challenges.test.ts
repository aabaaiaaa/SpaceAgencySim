import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  ensureChallengeState,
  getUnlockedChallenges,
  getChallengeResult,
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
import type { GameState, FlightState, FlightEvent, ChallengeDef, MedalThresholds } from '../core/gameState.ts';
import type { PhysicsState } from '../core/physics.ts';
import { makeMissionInstance } from './_factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FlightStateOverrides {
  altitude?: number;
  velocity?: number;
  timeElapsed?: number;
  events?: FlightEvent[];
  rocketCost?: number;
  partCount?: number;
  partTypes?: string[];
  crewCount?: number;
  maxAltitude?: number;
  maxVelocity?: number;
  fuelFraction?: number;
  hasScienceModules?: boolean;
  scienceModuleRunning?: boolean;
}

function freshState(): GameState {
  const state = createGameState();
  // Provide completed missions to unlock challenges.
  state.missions.completed = [
    makeMissionInstance({ id: 'mission-001', title: 'M1', objectives: [], reward: 25000 }),
    makeMissionInstance({ id: 'mission-004', title: 'M4', objectives: [], reward: 30000 }),
  ];
  return state;
}

function stateWithOrbitalMissions(): GameState {
  const state = freshState();
  // Add orbital missions needed for advanced challenges.
  state.missions.completed.push(
    makeMissionInstance({ id: 'mission-016', title: 'M16', objectives: [], reward: 50000 }),
    makeMissionInstance({ id: 'mission-017', title: 'M17', objectives: [], reward: 60000 }),
  );
  return state;
}

function makeFlightState(overrides: FlightStateOverrides = {}): FlightState {
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
  } as FlightState;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Challenge System', () => {

  // ── State initialisation ────────────────────────────────────────────────

  describe('ensureChallengeState', () => {
    it('creates challenges property if missing', () => {
      const state = createGameState();
      // @ts-expect-error — testing defensive init when field is missing (e.g. old saves)
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
      expect(state.challenges.active!.id).toBe('challenge-penny-pincher');
    });

    it('resets objective completion on accept', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) {
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
      expect(state.challenges.active!.id).toBe('challenge-bullseye');
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

      const altObj = state.challenges.active!.objectives.find(
        (o) => o.type === ObjectiveType.REACH_ALTITUDE
      )!;
      expect(altObj.completed).toBe(true);
    });

    it('completes SAFE_LANDING objectives', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      const fs = makeFlightState({
        events: [{ type: 'LANDING', speed: 5, time: 100, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);

      const landObj = state.challenges.active!.objectives.find(
        (o) => o.type === ObjectiveType.SAFE_LANDING
      )!;
      expect(landObj.completed).toBe(true);
    });

    it('does not complete objectives when conditions are not met', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      const fs = makeFlightState({ altitude: 500 });
      checkChallengeObjectives(state, fs);

      const altObj = state.challenges.active!.objectives.find(
        (o) => o.type === ObjectiveType.REACH_ALTITUDE
      )!;
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
        events: [{ type: 'LANDING', speed: 3.5, time: 100, description: '' } as FlightEvent],
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
      // @ts-expect-error — minimal partial with only score-extraction fields
      const ps: PhysicsState = { totalFuel: 30, maxFuel: 100 };
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
      medals: { bronze: 50000, silver: 30000, gold: 15000 } as MedalThresholds,
    } as Pick<ChallengeDef, 'scoreDirection' | 'medals'> as ChallengeDef;

    const higherIsBetter = {
      scoreDirection: ScoreDirection.HIGHER_IS_BETTER,
      medals: { bronze: 100000, silver: 250000, gold: 500000 } as MedalThresholds,
    } as Pick<ChallengeDef, 'scoreDirection' | 'medals'> as ChallengeDef;

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
      for (const obj of state.challenges.active!.objectives) {
        obj.completed = true;
      }

      const fs = makeFlightState({
        rocketCost: 20000,
        events: [{ type: 'LANDING', speed: 5, time: 100, description: '' } as FlightEvent],
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
      for (const obj of state.challenges.active!.objectives) {
        obj.completed = true;
      }
      const fs = makeFlightState({ rocketCost: 20000 });
      processChallengeCompletion(state, fs, null);
      expect(state.challenges.active).toBeNull();
    });

    it('stores best result', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) {
        obj.completed = true;
      }
      const fs = makeFlightState({ rocketCost: 40000 });
      processChallengeCompletion(state, fs, null);

      const stored = getChallengeResult(state, 'challenge-penny-pincher')!;
      expect(stored).not.toBeNull();
      expect(stored.medal).toBe(MedalTier.BRONZE);
      expect(stored.score).toBe(40000);
      expect(stored.attempts).toBe(1);
    });

    it('does not complete when objectives are not all met', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      // Only complete the first objective.
      state.challenges.active!.objectives[0].completed = true;

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
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      processChallengeCompletion(state, makeFlightState({ rocketCost: 40000 }), null);

      // Second attempt: still bronze
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      processChallengeCompletion(state, makeFlightState({ rocketCost: 45000 }), null);

      const stored = getChallengeResult(state, 'challenge-penny-pincher')!;
      expect(stored.attempts).toBe(2);
      // Original better score should be preserved.
      expect(stored.score).toBe(40000);
    });

    it('upgrades medal on better replay', () => {
      const state = freshState();

      // First attempt: bronze (cost = 40000)
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      const r1 = processChallengeCompletion(state, makeFlightState({ rocketCost: 40000 }), null);
      expect(r1.medal).toBe(MedalTier.BRONZE);

      // Second attempt: gold (cost = 10000)
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      const r2 = processChallengeCompletion(state, makeFlightState({ rocketCost: 10000 }), null);
      expect(r2.medal).toBe(MedalTier.GOLD);
      expect(r2.isNewBest).toBe(true);
      // Reward should be the delta (gold - bronze reward).
      expect(r2.reward).toBeGreaterThan(0);
      expect(r2.reward).toBeLessThan(CHALLENGES.find((c) => c.id === 'challenge-penny-pincher')!.rewards.gold);

      const stored = getChallengeResult(state, 'challenge-penny-pincher')!;
      expect(stored.medal).toBe(MedalTier.GOLD);
      expect(stored.score).toBe(10000);
    });

    it('does not downgrade medal on worse replay', () => {
      const state = freshState();

      // First attempt: gold
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      processChallengeCompletion(state, makeFlightState({ rocketCost: 10000 }), null);

      // Second attempt: bronze
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      const r2 = processChallengeCompletion(state, makeFlightState({ rocketCost: 45000 }), null);
      expect(r2.isNewBest).toBe(false);
      expect(r2.reward).toBe(0);

      const stored = getChallengeResult(state, 'challenge-penny-pincher')!;
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

  // ── Untested objective types in _checkSingleObjective ──────────────────

  describe('checkChallengeObjectives — additional objective types', () => {

    // Helper: accept a challenge then replace its objectives with a custom one.
    function setupWithObjective(obj: Partial<import('../core/gameState.ts').ObjectiveDef>): GameState {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      state.challenges.active!.objectives = [{
        id: 'test-obj',
        type: obj.type ?? 'REACH_ALTITUDE',
        target: obj.target ?? {},
        completed: false,
        description: obj.description ?? 'test objective',
      }];
      return state;
    }

    it('completes REACH_SPEED when velocity meets target', () => {
      const state = setupWithObjective({
        type: ObjectiveType.REACH_SPEED,
        target: { speed: 500 },
      });
      const fs = makeFlightState({ velocity: 600 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete REACH_SPEED when velocity is below target', () => {
      const state = setupWithObjective({
        type: ObjectiveType.REACH_SPEED,
        target: { speed: 500 },
      });
      const fs = makeFlightState({ velocity: 400 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes ACTIVATE_PART when matching event exists', () => {
      const state = setupWithObjective({
        type: ObjectiveType.ACTIVATE_PART,
        target: { partType: 'PARACHUTE' },
      });
      const fs = makeFlightState({
        events: [{ type: 'PART_ACTIVATED', partType: 'PARACHUTE', time: 10, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete ACTIVATE_PART for wrong part type', () => {
      const state = setupWithObjective({
        type: ObjectiveType.ACTIVATE_PART,
        target: { partType: 'PARACHUTE' },
      });
      const fs = makeFlightState({
        events: [{ type: 'PART_ACTIVATED', partType: 'ENGINE', time: 10, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes HOLD_ALTITUDE after sustained duration in range', () => {
      const state = setupWithObjective({
        type: ObjectiveType.HOLD_ALTITUDE,
        target: { minAltitude: 5000, maxAltitude: 6000, duration: 10 },
      });

      // First tick: enter the altitude range.
      const fs1 = makeFlightState({ altitude: 5500, timeElapsed: 0 });
      checkChallengeObjectives(state, fs1);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);

      // Second tick: still in range, enough time elapsed.
      const fs2 = makeFlightState({ altitude: 5500, timeElapsed: 15 });
      checkChallengeObjectives(state, fs2);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('resets HOLD_ALTITUDE timer when altitude leaves range', () => {
      const state = setupWithObjective({
        type: ObjectiveType.HOLD_ALTITUDE,
        target: { minAltitude: 5000, maxAltitude: 6000, duration: 10 },
      });

      // Enter range.
      checkChallengeObjectives(state, makeFlightState({ altitude: 5500, timeElapsed: 0 }));
      // Leave range.
      checkChallengeObjectives(state, makeFlightState({ altitude: 7000, timeElapsed: 5 }));
      // Re-enter range — timer should have reset.
      checkChallengeObjectives(state, makeFlightState({ altitude: 5500, timeElapsed: 6 }));
      // Not enough time since re-entry.
      checkChallengeObjectives(state, makeFlightState({ altitude: 5500, timeElapsed: 12 }));
      expect(state.challenges.active!.objectives[0].completed).toBe(false);

      // Now enough time since re-entry at t=6 — need t >= 16.
      checkChallengeObjectives(state, makeFlightState({ altitude: 5500, timeElapsed: 17 }));
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('completes RETURN_SCIENCE_DATA with science collected and safe landing', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RETURN_SCIENCE_DATA,
        target: {},
      });
      const fs = makeFlightState({
        events: [
          { type: 'SCIENCE_COLLECTED', time: 50, description: '' } as FlightEvent,
          { type: 'LANDING', speed: 5, time: 100, description: '' } as FlightEvent,
        ],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete RETURN_SCIENCE_DATA without science event', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RETURN_SCIENCE_DATA,
        target: {},
      });
      const fs = makeFlightState({
        events: [
          { type: 'LANDING', speed: 5, time: 100, description: '' } as FlightEvent,
        ],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('does not complete RETURN_SCIENCE_DATA with hard landing (>10 m/s)', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RETURN_SCIENCE_DATA,
        target: {},
      });
      const fs = makeFlightState({
        events: [
          { type: 'SCIENCE_COLLECTED', time: 50, description: '' } as FlightEvent,
          { type: 'LANDING', speed: 15, time: 100, description: '' } as FlightEvent,
        ],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes CONTROLLED_CRASH when crash speed meets minimum', () => {
      const state = setupWithObjective({
        type: ObjectiveType.CONTROLLED_CRASH,
        target: { minCrashSpeed: 50 },
      });
      const fs = makeFlightState({
        events: [{ type: 'CRASH', speed: 80, time: 100, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('completes CONTROLLED_CRASH via LANDING event at high speed', () => {
      const state = setupWithObjective({
        type: ObjectiveType.CONTROLLED_CRASH,
        target: { minCrashSpeed: 50 },
      });
      const fs = makeFlightState({
        events: [{ type: 'LANDING', speed: 60, time: 100, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete CONTROLLED_CRASH when speed is below minimum', () => {
      const state = setupWithObjective({
        type: ObjectiveType.CONTROLLED_CRASH,
        target: { minCrashSpeed: 50 },
      });
      const fs = makeFlightState({
        events: [{ type: 'CRASH', speed: 30, time: 100, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes EJECT_CREW when crew ejected above minimum altitude', () => {
      const state = setupWithObjective({
        type: ObjectiveType.EJECT_CREW,
        target: { minAltitude: 1000 },
      });
      const fs = makeFlightState({
        events: [{ type: 'CREW_EJECTED', altitude: 2000, time: 50, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete EJECT_CREW when altitude is below minimum', () => {
      const state = setupWithObjective({
        type: ObjectiveType.EJECT_CREW,
        target: { minAltitude: 1000 },
      });
      const fs = makeFlightState({
        events: [{ type: 'CREW_EJECTED', altitude: 500, time: 50, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes RELEASE_SATELLITE when released above minimum altitude', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RELEASE_SATELLITE,
        target: { minAltitude: 80000 },
      });
      const fs = makeFlightState({
        events: [{ type: 'SATELLITE_RELEASED', altitude: 100000, time: 100, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('completes RELEASE_SATELLITE with velocity constraint met', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RELEASE_SATELLITE,
        target: { minAltitude: 80000, minVelocity: 2000 },
      });
      const fs = makeFlightState({
        events: [{ type: 'SATELLITE_RELEASED', altitude: 100000, velocity: 2500, time: 100, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete RELEASE_SATELLITE when velocity is below minimum', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RELEASE_SATELLITE,
        target: { minAltitude: 80000, minVelocity: 2000 },
      });
      const fs = makeFlightState({
        events: [{ type: 'SATELLITE_RELEASED', altitude: 100000, velocity: 1500, time: 100, description: '' } as FlightEvent],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes REACH_ORBIT when altitude and velocity thresholds met', () => {
      const state = setupWithObjective({
        type: ObjectiveType.REACH_ORBIT,
        target: { orbitAltitude: 80000, orbitalVelocity: 2200 },
      });
      const fs = makeFlightState({ altitude: 90000, velocity: 2500 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete REACH_ORBIT when only altitude met', () => {
      const state = setupWithObjective({
        type: ObjectiveType.REACH_ORBIT,
        target: { orbitAltitude: 80000, orbitalVelocity: 2200 },
      });
      const fs = makeFlightState({ altitude: 90000, velocity: 1500 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes BUDGET_LIMIT when rocket cost is within budget', () => {
      const state = setupWithObjective({
        type: ObjectiveType.BUDGET_LIMIT,
        target: { maxCost: 50000 },
      });
      const fs = makeFlightState({ rocketCost: 40000 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete BUDGET_LIMIT when cost exceeds budget', () => {
      const state = setupWithObjective({
        type: ObjectiveType.BUDGET_LIMIT,
        target: { maxCost: 50000 },
      });
      const fs = makeFlightState({ rocketCost: 60000 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes MAX_PARTS when part count is within limit', () => {
      const state = setupWithObjective({
        type: ObjectiveType.MAX_PARTS,
        target: { maxParts: 10 },
      });
      const fs = makeFlightState({ partCount: 8 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete MAX_PARTS when parts exceed limit', () => {
      const state = setupWithObjective({
        type: ObjectiveType.MAX_PARTS,
        target: { maxParts: 10 },
      });
      const fs = makeFlightState({ partCount: 12 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes RESTRICT_PART when forbidden type is not used', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RESTRICT_PART,
        target: { forbiddenType: 'SOLID_BOOSTER' },
      });
      const fs = makeFlightState({ partTypes: ['ENGINE', 'FUEL_TANK', 'COMMAND_MODULE'] });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete RESTRICT_PART when forbidden type is present', () => {
      const state = setupWithObjective({
        type: ObjectiveType.RESTRICT_PART,
        target: { forbiddenType: 'SOLID_BOOSTER' },
      });
      const fs = makeFlightState({ partTypes: ['ENGINE', 'SOLID_BOOSTER', 'COMMAND_MODULE'] });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes MULTI_SATELLITE when enough satellites released above altitude', () => {
      const state = setupWithObjective({
        type: ObjectiveType.MULTI_SATELLITE,
        target: { count: 3, minAltitude: 100000 },
      });
      const fs = makeFlightState({
        events: [
          { type: 'SATELLITE_RELEASED', altitude: 110000, time: 50, description: '' } as FlightEvent,
          { type: 'SATELLITE_RELEASED', altitude: 120000, time: 60, description: '' } as FlightEvent,
          { type: 'SATELLITE_RELEASED', altitude: 115000, time: 70, description: '' } as FlightEvent,
        ],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete MULTI_SATELLITE when count is insufficient', () => {
      const state = setupWithObjective({
        type: ObjectiveType.MULTI_SATELLITE,
        target: { count: 3, minAltitude: 100000 },
      });
      const fs = makeFlightState({
        events: [
          { type: 'SATELLITE_RELEASED', altitude: 110000, time: 50, description: '' } as FlightEvent,
          { type: 'SATELLITE_RELEASED', altitude: 120000, time: 60, description: '' } as FlightEvent,
        ],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('MULTI_SATELLITE ignores releases below minimum altitude', () => {
      const state = setupWithObjective({
        type: ObjectiveType.MULTI_SATELLITE,
        target: { count: 2, minAltitude: 100000 },
      });
      const fs = makeFlightState({
        events: [
          { type: 'SATELLITE_RELEASED', altitude: 110000, time: 50, description: '' } as FlightEvent,
          { type: 'SATELLITE_RELEASED', altitude: 50000, time: 60, description: '' } as FlightEvent,
        ],
      });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('completes MINIMUM_CREW when crew count meets minimum', () => {
      const state = setupWithObjective({
        type: ObjectiveType.MINIMUM_CREW,
        target: { minCrew: 3 },
      });
      const fs = makeFlightState({ crewCount: 4 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('does not complete MINIMUM_CREW when crew count is below minimum', () => {
      const state = setupWithObjective({
        type: ObjectiveType.MINIMUM_CREW,
        target: { minCrew: 3 },
      });
      const fs = makeFlightState({ crewCount: 2 });
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('skips already-completed objectives', () => {
      const state = setupWithObjective({
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 1000 },
      });
      state.challenges.active!.objectives[0].completed = true;
      const fs = makeFlightState({ altitude: 0 });
      checkChallengeObjectives(state, fs);
      // Should remain true (not reset).
      expect(state.challenges.active!.objectives[0].completed).toBe(true);
    });

    it('handles unknown objective type gracefully (default case)', () => {
      const state = setupWithObjective({
        type: 'NONEXISTENT_TYPE' as string,
        target: {},
      });
      const fs = makeFlightState({ altitude: 100000 });
      // Should not throw.
      checkChallengeObjectives(state, fs);
      expect(state.challenges.active!.objectives[0].completed).toBe(false);
    });

    it('no-ops when flightState is null', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      // Should not throw.
      checkChallengeObjectives(state, null as unknown as FlightState);
    });
  });

  // ── Additional processChallengeCompletion paths ────────────────────────

  describe('processChallengeCompletion — additional paths', () => {

    it('returns completed: false when score metric cannot be extracted', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;

      // Penny pincher uses rocketCost metric. Provide flightState without rocketCost.
      const fs = makeFlightState();
      // Remove the rocketCost so extractScoreMetric returns null.
      delete (fs as unknown as Record<string, unknown>).rocketCost;
      const result = processChallengeCompletion(state, fs, null);
      expect(result.completed).toBe(false);
      expect(state.challenges.active).toBeNull();
    });

    it('replay with same medal gives zero reward', () => {
      const state = freshState();

      // First attempt: bronze (cost = 40000).
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      const r1 = processChallengeCompletion(state, makeFlightState({ rocketCost: 40000 }), null);
      expect(r1.medal).toBe(MedalTier.BRONZE);
      expect(r1.reward).toBeGreaterThan(0);

      // Second attempt: also bronze (cost = 45000, still within bronze threshold).
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      const r2 = processChallengeCompletion(state, makeFlightState({ rocketCost: 45000 }), null);
      expect(r2.medal).toBe(MedalTier.BRONZE);
      expect(r2.isNewBest).toBe(false);
      // Same medal as before — reward delta is 0.
      expect(r2.reward).toBe(0);
    });

    it('replay with better medal gives only the delta reward', () => {
      const state = freshState();
      const challengeDef = CHALLENGES.find((c) => c.id === 'challenge-penny-pincher')!;

      // First attempt: bronze.
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      processChallengeCompletion(state, makeFlightState({ rocketCost: 40000 }), null);

      // Second attempt: silver.
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;
      const r2 = processChallengeCompletion(state, makeFlightState({ rocketCost: 25000 }), null);
      expect(r2.medal).toBe(MedalTier.SILVER);
      expect(r2.isNewBest).toBe(true);
      // Reward should be silver reward minus bronze reward.
      const expectedDelta = challengeDef.rewards.silver - challengeDef.rewards.bronze;
      expect(r2.reward).toBe(expectedDelta);
    });

    it('first completion with MedalTier.NONE gives zero reward', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;

      // Cost = 60000, above bronze threshold of 50000 => no medal.
      const result = processChallengeCompletion(state, makeFlightState({ rocketCost: 60000 }), null);
      expect(result.completed).toBe(true);
      expect(result.medal).toBe(MedalTier.NONE);
      expect(result.reward).toBe(0);
    });

    it('stores result even for MedalTier.NONE on first attempt', () => {
      const state = freshState();
      acceptChallenge(state, 'challenge-penny-pincher');
      for (const obj of state.challenges.active!.objectives) obj.completed = true;

      processChallengeCompletion(state, makeFlightState({ rocketCost: 60000 }), null);
      const stored = getChallengeResult(state, 'challenge-penny-pincher');
      expect(stored).not.toBeNull();
      expect(stored!.medal).toBe(MedalTier.NONE);
      expect(stored!.attempts).toBe(1);
    });
  });

  // ── Additional extractScoreMetric paths ────────────────────────────────

  describe('extractScoreMetric — additional metrics', () => {

    it('extracts timeElapsed', () => {
      const fs = makeFlightState({ timeElapsed: 120 });
      expect(extractScoreMetric('timeElapsed', fs, null)).toBe(120);
    });

    it('extracts satellitesDeployed from SATELLITE_RELEASED events', () => {
      const fs = makeFlightState({
        events: [
          { type: 'SATELLITE_RELEASED', altitude: 100000, time: 50, description: '' } as FlightEvent,
          { type: 'SATELLITE_RELEASED', altitude: 120000, time: 60, description: '' } as FlightEvent,
        ],
      });
      expect(extractScoreMetric('satellitesDeployed', fs, null)).toBe(2);
    });

    it('satellitesDeployed returns 0 when no releases', () => {
      const fs = makeFlightState({ events: [] });
      expect(extractScoreMetric('satellitesDeployed', fs, null)).toBe(0);
    });

    it('maxAltitude falls back to altitude when maxAltitude is not set', () => {
      const fs = makeFlightState({ altitude: 75000 });
      // Remove maxAltitude so the fallback path is hit.
      delete (fs as unknown as Record<string, unknown>).maxAltitude;
      expect(extractScoreMetric('maxAltitude', fs, null)).toBe(75000);
    });

    it('maxVelocity falls back to velocity when maxVelocity is not set', () => {
      const fs = makeFlightState({ velocity: 2000 });
      delete (fs as unknown as Record<string, unknown>).maxVelocity;
      expect(extractScoreMetric('maxVelocity', fs, null)).toBe(2000);
    });

    it('fuelRemaining returns null when no fuel data available', () => {
      const fs = makeFlightState();
      delete (fs as unknown as Record<string, unknown>).fuelFraction;
      expect(extractScoreMetric('fuelRemaining', fs, null)).toBeNull();
    });

    it('landingSpeed returns null when no LANDING event exists', () => {
      const fs = makeFlightState({ events: [] });
      expect(extractScoreMetric('landingSpeed', fs, null)).toBeNull();
    });

    it('rocketCost returns null when rocketCost is not a number', () => {
      const fs = makeFlightState();
      delete (fs as unknown as Record<string, unknown>).rocketCost;
      expect(extractScoreMetric('rocketCost', fs, null)).toBeNull();
    });

    it('partCount returns null when partCount is not a number', () => {
      const fs = makeFlightState();
      delete (fs as unknown as Record<string, unknown>).partCount;
      expect(extractScoreMetric('partCount', fs, null)).toBeNull();
    });

    it('timeElapsed returns null when timeElapsed is not a number', () => {
      const fs = makeFlightState();
      delete (fs as unknown as Record<string, unknown>).timeElapsed;
      expect(extractScoreMetric('timeElapsed', fs, null)).toBeNull();
    });
  });
});
