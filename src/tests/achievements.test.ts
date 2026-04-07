// @ts-nocheck
/**
 * achievements.test.js — Unit tests for the prestige milestone system.
 *
 * Covers:
 *   - checkAchievements() — detection and awarding of new achievements
 *   - getAchievementStatus() — status listing for UI
 *   - Individual achievement criteria
 *   - No double-awarding of achievements
 *   - Cash and reputation rewards
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { checkAchievements, getAchievementStatus, ACHIEVEMENTS } from '../core/achievements.ts';
import { CelestialBody, SatelliteType } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal achievement check context. */
function makeCtx(overrides = {}) {
  return {
    flightState: null,
    ps: null,
    isLanded: false,
    landingBodyId: 'EARTH',
    ...overrides,
  };
}

/** Create a state with a completed mission that had a REACH_ORBIT objective. */
function stateWithCompletedOrbitMission() {
  const state = createGameState();
  state.missions.completed.push({
    id: 'orbit-mission',
    title: 'Reach Orbit',
    objectives: [{ type: 'REACH_ORBIT', completed: true }],
    reward: 50000,
  });
  return state;
}

// ---------------------------------------------------------------------------
// ACHIEVEMENTS constant
// ---------------------------------------------------------------------------

describe('ACHIEVEMENTS constant', () => {
  it('has 10 defined achievements', () => {
    expect(ACHIEVEMENTS).toHaveLength(10);
  });

  it('each achievement has required fields', () => {
    for (const ach of ACHIEVEMENTS) {
      expect(ach.id).toBeTruthy();
      expect(ach.title).toBeTruthy();
      expect(ach.description).toBeTruthy();
      expect(ach.cashReward).toBeGreaterThan(0);
      expect(ach.repReward).toBeGreaterThan(0);
      expect(typeof ach.check).toBe('function');
    }
  });

  it('has unique IDs', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// getAchievementStatus()
// ---------------------------------------------------------------------------

describe('getAchievementStatus()', () => {
  it('returns all achievements as not earned on fresh state', () => {
    const state = createGameState();
    const status = getAchievementStatus(state);

    expect(status).toHaveLength(ACHIEVEMENTS.length);
    for (const ach of status) {
      expect(ach.earned).toBe(false);
      expect(ach.earnedPeriod).toBeNull();
    }
  });

  it('marks earned achievements correctly', () => {
    const state = createGameState();
    state.achievements = [{ id: 'FIRST_ORBIT', earnedPeriod: 5 }];

    const status = getAchievementStatus(state);
    const orbit = status.find((a) => a.id === 'FIRST_ORBIT');
    expect(orbit.earned).toBe(true);
    expect(orbit.earnedPeriod).toBe(5);

    const satellite = status.find((a) => a.id === 'FIRST_SATELLITE');
    expect(satellite.earned).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkAchievements()
// ---------------------------------------------------------------------------

describe('checkAchievements()', () => {
  it('initializes achievements array if missing', () => {
    const state = createGameState();
    delete state.achievements;
    checkAchievements(state, makeCtx());
    expect(Array.isArray(state.achievements)).toBe(true);
  });

  it('does not award anything on fresh state', () => {
    const state = createGameState();
    const result = checkAchievements(state, makeCtx());
    expect(result).toHaveLength(0);
  });

  it('does not double-award achievements', () => {
    const state = stateWithCompletedOrbitMission();
    const ctx = makeCtx();

    // First check should award FIRST_ORBIT.
    const first = checkAchievements(state, ctx);
    expect(first.some((a) => a.id === 'FIRST_ORBIT')).toBe(true);

    // Second check should not re-award.
    const second = checkAchievements(state, ctx);
    expect(second.some((a) => a.id === 'FIRST_ORBIT')).toBe(false);
    expect(state.achievements.filter((a) => a.id === 'FIRST_ORBIT')).toHaveLength(1);
  });

  it('awards cash and reputation on achievement', () => {
    const state = stateWithCompletedOrbitMission();
    const moneyBefore = state.money;
    const repBefore = state.reputation;

    checkAchievements(state, makeCtx());

    // FIRST_ORBIT: $200k + 20 rep
    expect(state.money).toBe(moneyBefore + 200_000);
    expect(state.reputation).toBe(repBefore + 20);
  });

  it('records earnedPeriod', () => {
    const state = stateWithCompletedOrbitMission();
    state.currentPeriod = 7;
    checkAchievements(state, makeCtx());

    const record = state.achievements.find((a) => a.id === 'FIRST_ORBIT');
    expect(record).toBeTruthy();
    expect(record.earnedPeriod).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Individual achievement criteria
// ---------------------------------------------------------------------------

describe('FIRST_ORBIT', () => {
  it('triggers when a completed mission has REACH_ORBIT objective', () => {
    const state = stateWithCompletedOrbitMission();
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_ORBIT')).toBe(true);
  });

  it('triggers when there are Earth satellites', () => {
    const state = createGameState();
    state.satelliteNetwork.satellites.push({
      id: 's1', bodyId: 'EARTH', satelliteType: 'COMMUNICATION',
      orbitalObjectId: 'o1', partId: 'sat-comm', bandId: 'LEO',
      health: 100, autoMaintain: false, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_ORBIT')).toBe(true);
  });
});

describe('FIRST_SATELLITE', () => {
  it('triggers when a satellite exists in the network', () => {
    const state = createGameState();
    state.satelliteNetwork.satellites.push({
      id: 's1', bodyId: 'EARTH', satelliteType: 'COMMUNICATION',
      orbitalObjectId: 'o1', partId: 'sat-comm', bandId: 'LEO',
      health: 100, autoMaintain: false, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_SATELLITE')).toBe(true);
  });

  it('does not trigger with no satellites', () => {
    const state = createGameState();
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_SATELLITE')).toBe(false);
  });
});

describe('FIRST_CONSTELLATION', () => {
  it('triggers with 3+ satellites of the same type', () => {
    const state = createGameState();
    // Also need FIRST_ORBIT completed to not interfere.
    for (let i = 0; i < 3; i++) {
      state.satelliteNetwork.satellites.push({
        id: `s${i}`, bodyId: 'EARTH', satelliteType: 'GPS',
        orbitalObjectId: `o${i}`, partId: 'sat-gps', bandId: 'MEO',
        health: 100, autoMaintain: false, deployedPeriod: 1,
      });
    }
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_CONSTELLATION')).toBe(true);
  });

  it('does not trigger with 2 satellites of the same type', () => {
    const state = createGameState();
    for (let i = 0; i < 2; i++) {
      state.satelliteNetwork.satellites.push({
        id: `s${i}`, bodyId: 'EARTH', satelliteType: 'GPS',
        orbitalObjectId: `o${i}`, partId: 'sat-gps', bandId: 'MEO',
        health: 100, autoMaintain: false, deployedPeriod: 1,
      });
    }
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_CONSTELLATION')).toBe(false);
  });
});

describe('FIRST_LUNAR_FLYBY', () => {
  it('triggers when an orbital object exists around the Moon', () => {
    const state = createGameState();
    state.orbitalObjects.push({
      id: 'obj1', bodyId: 'MOON', type: 'CRAFT', name: 'Lunar Probe',
      elements: { semiMajorAxis: 2000000, eccentricity: 0 },
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_LUNAR_FLYBY')).toBe(true);
  });

  it('triggers when a flag is planted on the Moon (implies visit)', () => {
    const state = createGameState();
    state.surfaceItems.push({
      id: 'flag1', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_LUNAR_FLYBY')).toBe(true);
  });
});

describe('FIRST_LUNAR_ORBIT', () => {
  it('triggers when a satellite orbits the Moon', () => {
    const state = createGameState();
    state.satelliteNetwork.satellites.push({
      id: 's1', bodyId: 'MOON', satelliteType: 'RELAY',
      orbitalObjectId: 'o1', partId: 'sat-relay', bandId: 'LUNAR_LOW',
      health: 100, autoMaintain: false, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_LUNAR_ORBIT')).toBe(true);
  });

  it('triggers when there are surface items on the Moon (landing implies orbit)', () => {
    const state = createGameState();
    state.surfaceItems.push({
      id: 'flag1', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_LUNAR_ORBIT')).toBe(true);
  });
});

describe('FIRST_LUNAR_LANDING', () => {
  it('triggers when a flag is planted on the Moon', () => {
    const state = createGameState();
    state.surfaceItems.push({
      id: 'flag1', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_LUNAR_LANDING')).toBe(true);
  });
});

describe('FIRST_LUNAR_RETURN', () => {
  it('triggers when Moon samples have been returned', () => {
    const state = createGameState();
    state.surfaceItems.push(
      { id: 'flag1', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1 },
      { id: 'sample1', type: 'SURFACE_SAMPLE', bodyId: 'MOON', posX: 10, deployedPeriod: 1, collected: true },
    );
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_LUNAR_RETURN')).toBe(true);
  });

  it('does not trigger with Moon landing alone (no return evidence)', () => {
    const state = createGameState();
    state.surfaceItems.push(
      { id: 'flag1', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1 },
    );
    // No collected samples and not currently landing on Earth from Moon.
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_LUNAR_RETURN')).toBe(false);
  });

  it('triggers during a flight returning from the Moon to Earth', () => {
    const state = createGameState();
    state.surfaceItems.push(
      { id: 'flag1', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1 },
    );
    const ctx = makeCtx({
      isLanded: true,
      landingBodyId: 'EARTH',
      flightState: {
        bodyId: 'EARTH',
        transferState: { originBodyId: 'MOON', destinationBodyId: 'EARTH' },
        phaseLog: [],
        events: [],
      },
    });
    const result = checkAchievements(state, ctx);
    expect(result.some((a) => a.id === 'FIRST_LUNAR_RETURN')).toBe(true);
  });
});

describe('FIRST_MARS_ORBIT', () => {
  it('triggers when a satellite orbits Mars', () => {
    const state = createGameState();
    state.satelliteNetwork.satellites.push({
      id: 's1', bodyId: 'MARS', satelliteType: 'SCIENCE',
      orbitalObjectId: 'o1', partId: 'sat-sci', bandId: 'MARS_LOW',
      health: 100, autoMaintain: false, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_MARS_ORBIT')).toBe(true);
  });
});

describe('FIRST_MARS_LANDING', () => {
  it('triggers when a flag is planted on Mars', () => {
    const state = createGameState();
    state.surfaceItems.push({
      id: 'flag1', type: 'FLAG', bodyId: 'MARS', posX: 0, deployedPeriod: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_MARS_LANDING')).toBe(true);
  });
});

describe('FIRST_SOLAR_SCIENCE', () => {
  it('triggers when science log has a SUN_ biome entry', () => {
    const state = createGameState();
    state.scienceLog.push({
      instrumentId: 'solar-probe',
      biomeId: 'SUN_OUTER_CORONA',
      count: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_SOLAR_SCIENCE')).toBe(true);
  });

  it('does not trigger without solar biome data', () => {
    const state = createGameState();
    state.scienceLog.push({
      instrumentId: 'thermometer',
      biomeId: 'LOW_ATMOSPHERE',
      count: 1,
    });
    const result = checkAchievements(state, makeCtx());
    expect(result.some((a) => a.id === 'FIRST_SOLAR_SCIENCE')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple achievements in one check
// ---------------------------------------------------------------------------

describe('multiple achievements', () => {
  it('can award multiple achievements in a single check', () => {
    const state = createGameState();
    // Set up state to earn FIRST_ORBIT + FIRST_SATELLITE + FIRST_LUNAR_FLYBY
    state.missions.completed.push({
      id: 'orbit-m', title: 'Orbit',
      objectives: [{ type: 'REACH_ORBIT', completed: true }],
      reward: 10000,
    });
    state.satelliteNetwork.satellites.push({
      id: 's1', bodyId: 'EARTH', satelliteType: 'COMMUNICATION',
      orbitalObjectId: 'o1', partId: 'sat-comm', bandId: 'LEO',
      health: 100, autoMaintain: false, deployedPeriod: 1,
    });
    state.orbitalObjects.push({
      id: 'obj1', bodyId: 'MOON', type: 'CRAFT', name: 'Probe',
      elements: {},
    });

    const result = checkAchievements(state, makeCtx());
    const ids = result.map((a) => a.id);
    expect(ids).toContain('FIRST_ORBIT');
    expect(ids).toContain('FIRST_SATELLITE');
    expect(ids).toContain('FIRST_LUNAR_FLYBY');
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});
