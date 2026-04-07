/**
 * achievements.ts — Prestige milestones and one-time achievement system.
 *
 * Tracks major firsts (first orbit, first satellite, first lunar landing, etc.)
 * and awards one-time cash + reputation bonuses when they are achieved.
 *
 * Each achievement has criteria that are checked after every flight return.
 * Once unlocked, an achievement is recorded in `state.achievements` and never
 * re-awarded.
 *
 * @module core/achievements
 */

import { earnReward } from './finance.ts';
import { adjustReputation } from './reputation.ts';
import { CelestialBody, CONSTELLATION_THRESHOLD, SatelliteType } from './constants.ts';

import type { GameState, FlightState } from './gameState.ts';
import type { PhysicsState } from './physics.ts';

// ---------------------------------------------------------------------------
// Achievement Definitions
// ---------------------------------------------------------------------------

/** Context passed to achievement check functions with info about the just-completed flight. */
export interface AchievementCheckContext {
  flightState: FlightState | null;
  ps: PhysicsState | null;
  isLanded: boolean;
  landingBodyId: string;
}

/** Definition for a single achievement. */
export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  cashReward: number;
  repReward: number;
  check: (state: GameState, ctx: AchievementCheckContext) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'FIRST_ORBIT',
    title: 'First Orbit',
    description: 'Achieve a stable orbit around Earth.',
    cashReward: 200_000,
    repReward: 20,
    check: (state: GameState, ctx: AchievementCheckContext): boolean => {
      // The flight reached orbit at any point (flightHistory records it,
      // or the current flight was in orbit). We check flight history for
      // any flight where the craft entered orbit around Earth.
      return _anyFlightReachedOrbit(state, CelestialBody.EARTH);
    },
  },
  {
    id: 'FIRST_SATELLITE',
    title: 'First Satellite',
    description: 'Deploy a satellite into orbit.',
    cashReward: 150_000,
    repReward: 15,
    check: (state: GameState): boolean => {
      return (state.satelliteNetwork?.satellites?.length ?? 0) >= 1;
    },
  },
  {
    id: 'FIRST_CONSTELLATION',
    title: 'First Constellation',
    description: `Deploy ${CONSTELLATION_THRESHOLD}+ satellites of the same type.`,
    cashReward: 300_000,
    repReward: 25,
    check: (state: GameState): boolean => {
      return _hasAnyConstellation(state);
    },
  },
  {
    id: 'FIRST_LUNAR_FLYBY',
    title: 'First Lunar Flyby',
    description: 'Send a craft to the Moon\'s sphere of influence.',
    cashReward: 500_000,
    repReward: 30,
    check: (state: GameState): boolean => {
      return _anyFlightVisitedBody(state, CelestialBody.MOON);
    },
  },
  {
    id: 'FIRST_LUNAR_ORBIT',
    title: 'First Lunar Orbit',
    description: 'Achieve a stable orbit around the Moon.',
    cashReward: 750_000,
    repReward: 35,
    check: (state: GameState): boolean => {
      return _anyFlightReachedOrbit(state, CelestialBody.MOON);
    },
  },
  {
    id: 'FIRST_LUNAR_LANDING',
    title: 'First Lunar Landing',
    description: 'Land safely on the Moon.',
    cashReward: 1_000_000,
    repReward: 40,
    check: (state: GameState): boolean => {
      return _anyFlightLandedOn(state, CelestialBody.MOON);
    },
  },
  {
    id: 'FIRST_LUNAR_RETURN',
    title: 'First Lunar Return',
    description: 'Land on the Moon and return safely to Earth.',
    cashReward: 2_000_000,
    repReward: 50,
    check: (state: GameState, ctx: AchievementCheckContext): boolean => {
      // Must have landed on the Moon (flag or surface item as proof)
      // AND have completed a flight that ended with a safe Earth landing
      // after visiting the Moon.
      return _hasLunarReturn(state, ctx);
    },
  },
  {
    id: 'FIRST_MARS_ORBIT',
    title: 'First Mars Orbit',
    description: 'Achieve a stable orbit around Mars.',
    cashReward: 3_000_000,
    repReward: 50,
    check: (state: GameState): boolean => {
      return _anyFlightReachedOrbit(state, CelestialBody.MARS);
    },
  },
  {
    id: 'FIRST_MARS_LANDING',
    title: 'First Mars Landing',
    description: 'Land safely on Mars.',
    cashReward: 5_000_000,
    repReward: 60,
    check: (state: GameState): boolean => {
      return _anyFlightLandedOn(state, CelestialBody.MARS);
    },
  },
  {
    id: 'FIRST_SOLAR_SCIENCE',
    title: 'First Solar Science',
    description: 'Collect science data near the Sun.',
    cashReward: 4_000_000,
    repReward: 50,
    check: (state: GameState): boolean => {
      return _hasCollectedSolarScience(state);
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Info about a newly awarded achievement. */
export interface AwardedAchievement {
  id: string;
  title: string;
  cashReward: number;
  repReward: number;
}

/**
 * Check all achievements against current state and award any newly-earned ones.
 * Called after every flight return.
 */
export function checkAchievements(
  state: GameState,
  ctx: AchievementCheckContext,
): AwardedAchievement[] {
  if (!Array.isArray(state.achievements)) {
    state.achievements = [];
  }

  const earned = new Set(state.achievements.map((a) => a.id));
  const newlyAwarded: AwardedAchievement[] = [];

  for (const def of ACHIEVEMENTS) {
    if (earned.has(def.id)) continue;

    let met: boolean;
    try {
      met = def.check(state, ctx);
    } catch {
      // Silently skip achievements that fail their check (defensive).
      continue;
    }

    if (met) {
      // Award cash and reputation.
      earnReward(state, def.cashReward);
      adjustReputation(state, def.repReward);

      // Record achievement.
      state.achievements.push({
        id: def.id,
        earnedPeriod: state.currentPeriod ?? 0,
      });

      newlyAwarded.push({
        id: def.id,
        title: def.title,
        cashReward: def.cashReward,
        repReward: def.repReward,
      });
    }
  }

  return newlyAwarded;
}

/** Achievement status entry with earned info. */
export interface AchievementStatusEntry {
  id: string;
  title: string;
  description: string;
  cashReward: number;
  repReward: number;
  earned: boolean;
  earnedPeriod: number | null;
}

/**
 * Returns the full list of achievement definitions with earned status.
 */
export function getAchievementStatus(state: GameState): AchievementStatusEntry[] {
  const earnedMap = new Map<string, number>(
    (state.achievements ?? []).map((a) => [a.id, a.earnedPeriod]),
  );

  return ACHIEVEMENTS.map((def) => ({
    id: def.id,
    title: def.title,
    description: def.description,
    cashReward: def.cashReward,
    repReward: def.repReward,
    earned: earnedMap.has(def.id),
    earnedPeriod: earnedMap.get(def.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Private helpers — Achievement condition checks
// ---------------------------------------------------------------------------

/**
 * Checks if any flight in history reached orbit around the given body,
 * OR if the current flight is/was in orbit there.
 * We look at orbital objects (satellites stay in orbit) and flight events.
 */
function _anyFlightReachedOrbit(state: GameState, bodyId: string): boolean {
  // Check orbital objects — if any orbits this body, someone achieved orbit there.
  const hasOrbitalObject = (state.orbitalObjects ?? []).some(
    (obj) => obj.bodyId === bodyId,
  );
  if (hasOrbitalObject) return true;

  // Check satellite network.
  const hasSatellite = (state.satelliteNetwork?.satellites ?? []).some(
    (s) => s.bodyId === bodyId,
  );
  if (hasSatellite) return true;

  // Check flight history events for orbit entry at this body.
  for (const flight of state.flightHistory ?? []) {
    if (flight.notes && flight.notes.includes(`orbit at ${bodyId}`)) return true;
  }

  // Check surface items — if we have items on a body, we at minimum flew by it.
  // But orbit specifically? Landing implies orbit (you orbit before landing).
  if (bodyId !== CelestialBody.EARTH) {
    // If we landed on the body, we must have orbited it first.
    if (_anyFlightLandedOn(state, bodyId)) return true;
  }

  // For Earth orbit: check if any mission was completed that required orbit.
  if (bodyId === CelestialBody.EARTH) {
    const orbitMissions = (state.missions?.completed ?? []).some(
      (m) => Array.isArray(m.objectives) &&
             m.objectives.some((o) => o.type === 'REACH_ORBIT' && o.completed),
    );
    if (orbitMissions) return true;

    // Also check if we have satellites around Earth.
    const earthSats = (state.satelliteNetwork?.satellites ?? []).some(
      (s) => s.bodyId === CelestialBody.EARTH,
    );
    if (earthSats) return true;
  }

  return false;
}

/**
 * Checks if any flight has visited the given body (transfer/flyby).
 * Evidence: surface items, orbital objects, flight history, or satellite presence.
 */
function _anyFlightVisitedBody(state: GameState, bodyId: string): boolean {
  // Surface items on the body.
  if ((state.surfaceItems ?? []).some((item) => item.bodyId === bodyId)) return true;

  // Orbital objects around the body.
  if ((state.orbitalObjects ?? []).some((obj) => obj.bodyId === bodyId)) return true;

  // Satellites around the body.
  if ((state.satelliteNetwork?.satellites ?? []).some((s) => s.bodyId === bodyId)) return true;

  // If we reached orbit or landed, we visited.
  if (_anyFlightReachedOrbit(state, bodyId)) return true;

  return false;
}

/**
 * Checks if any flight successfully landed on the given body.
 * Evidence: surface items (flags, samples, instruments) on that body.
 */
function _anyFlightLandedOn(state: GameState, bodyId: string): boolean {
  // Flags are the strongest evidence of landing.
  if ((state.surfaceItems ?? []).some(
    (item) => item.bodyId === bodyId && item.type === 'FLAG',
  )) return true;

  // Any surface item on the body means we landed there.
  if ((state.surfaceItems ?? []).some(
    (item) => item.bodyId === bodyId,
  )) return true;

  return false;
}

/**
 * Checks if the player has achieved a lunar return (landed on Moon, returned to Earth).
 * Evidence: has surface items on the Moon AND a flight that ended with safe Earth landing
 * that had visited the Moon (transfer to Moon and back).
 */
function _hasLunarReturn(state: GameState, ctx: AchievementCheckContext): boolean {
  // Must have evidence of a Moon landing.
  if (!_anyFlightLandedOn(state, CelestialBody.MOON)) return false;

  // The current flight must have returned to Earth safely after visiting the Moon.
  if (ctx && ctx.isLanded && ctx.landingBodyId === CelestialBody.EARTH) {
    // Check if the current flight visited the Moon (via transfer state or events).
    if (ctx.flightState) {
      const fs = ctx.flightState;
      // Did this flight involve a transfer to/from the Moon?
      if (fs.transferState?.originBodyId === CelestialBody.MOON ||
          fs.transferState?.destinationBodyId === CelestialBody.MOON) {
        return true;
      }
      // Check if flight was ever at the Moon body.
      if (fs.bodyId === CelestialBody.MOON) return true;
      // Check phase log for Moon visits.
      if (Array.isArray(fs.phaseLog)) {
        for (const entry of fs.phaseLog) {
          if (entry.reason && entry.reason.toLowerCase().includes('moon')) return true;
        }
      }
      // Check events.
      if (Array.isArray(fs.events)) {
        for (const evt of fs.events) {
          if (evt.description && evt.description.toLowerCase().includes('moon')) return true;
        }
      }
    }
  }

  // Also check historical evidence: any completed flight where bodyId ended at Earth
  // after a Moon visit would show up as a flag on Moon + Earth landing history.
  // A simpler heuristic: if there's a flag on the Moon and a surface sample from the Moon
  // that was collected (returned), that implies a lunar return.
  const moonSamplesReturned = (state.surfaceItems ?? []).some(
    (item) => item.bodyId === CelestialBody.MOON &&
              item.type === 'SURFACE_SAMPLE' &&
              item.collected,
  );
  if (moonSamplesReturned) return true;

  return false;
}

/**
 * Checks if any constellation exists (3+ satellites of the same type).
 */
function _hasAnyConstellation(state: GameState): boolean {
  const typeCounts: Record<string, number> = {};
  for (const sat of state.satelliteNetwork?.satellites ?? []) {
    const t = sat.satelliteType || 'GENERIC';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
    if (typeCounts[t] >= CONSTELLATION_THRESHOLD) return true;
  }
  return false;
}

/**
 * Checks if the player has ever collected science data near the Sun.
 * Evidence: science log entries with Sun-related biome IDs,
 * or completed science experiments at the Sun.
 */
function _hasCollectedSolarScience(state: GameState): boolean {
  // Check science log for Sun biomes.
  for (const entry of state.scienceLog ?? []) {
    if (entry.biomeId && entry.biomeId.startsWith('SUN_')) return true;
  }
  return false;
}
