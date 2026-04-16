import { describe, it, expect } from 'vitest';
import {
  getAgencyStats,
  getRecords,
  getCrewCareers,
  getFinancialSummary,
  getExplorationProgress,
  getCelestialBodyKnowledge,
  getFrequentRockets,
} from '../core/library.ts';
import { createGameState } from '../core/gameState.ts';
import { FlightOutcome, AstronautStatus } from '../core/constants.ts';
import { ALL_BODY_IDS } from '../data/bodies.ts';
import type {
  GameState,
  FlightResult,
  CrewMember,
  RocketDesign,
} from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFlight(overrides: Partial<FlightResult> = {}): FlightResult {
  return {
    id: overrides.id ?? 'flight-1',
    missionId: overrides.missionId ?? 'mission-1',
    rocketId: overrides.rocketId ?? 'rocket-1',
    crewIds: overrides.crewIds ?? [],
    launchDate: overrides.launchDate ?? '2026-01-01T00:00:00Z',
    outcome: overrides.outcome ?? FlightOutcome.SUCCESS,
    deltaVUsed: overrides.deltaVUsed ?? 0,
    revenue: overrides.revenue ?? 0,
    notes: overrides.notes ?? '',
    maxAltitude: overrides.maxAltitude,
    maxSpeed: overrides.maxSpeed,
    bodiesVisited: overrides.bodiesVisited,
    duration: overrides.duration,
    rocketName: overrides.rocketName,
  };
}

function makeCrew(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: overrides.id ?? 'crew-1',
    name: overrides.name ?? 'Test Astronaut',
    status: overrides.status ?? AstronautStatus.ACTIVE,
    skills: overrides.skills ?? { piloting: 1, engineering: 1, science: 1 },
    salary: overrides.salary ?? 100,
    hireDate: overrides.hireDate ?? '2026-01-01',
    missionsFlown: overrides.missionsFlown ?? 0,
    flightsFlown: overrides.flightsFlown ?? 0,
    deathDate: overrides.deathDate ?? null,
    deathCause: overrides.deathCause ?? null,
    assignedRocketId: overrides.assignedRocketId ?? null,
    injuryEnds: overrides.injuryEnds ?? null,
    trainingSkill: overrides.trainingSkill ?? null,
    trainingEnds: overrides.trainingEnds ?? null,
    stationedHubId: overrides.stationedHubId ?? 'HUB_CAPE',
    transitUntil: overrides.transitUntil ?? null,
  };
}

function makeDesign(overrides: Partial<RocketDesign> = {}): RocketDesign {
  return {
    id: overrides.id ?? 'design-1',
    name: overrides.name ?? 'Test Rocket',
    parts: overrides.parts ?? [],
    staging: overrides.staging ?? { stages: [], unstaged: [] },
    totalMass: overrides.totalMass ?? 1000,
    totalThrust: overrides.totalThrust ?? 100,
    createdDate: overrides.createdDate ?? '2026-01-01',
    updatedDate: overrides.updatedDate ?? '2026-01-01',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('library: getAgencyStats', () => {
  it('@smoke returns zeros for a fresh game state', () => {
    const state = createGameState();
    const stats = getAgencyStats(state);
    expect(stats.totalFlights).toBe(0);
    expect(stats.successfulFlights).toBe(0);
    expect(stats.failedFlights).toBe(0);
    expect(stats.partialSuccesses).toBe(0);
    expect(stats.totalRevenue).toBe(0);
    expect(stats.activeCrew).toBe(0);
    expect(stats.totalCrewHired).toBe(0);
    expect(stats.crewLost).toBe(0);
    expect(stats.totalAchievements).toBeGreaterThan(0);
  });

  it('aggregates outcomes and revenue across flight history', () => {
    const state: GameState = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', outcome: FlightOutcome.SUCCESS, revenue: 500 }),
      makeFlight({ id: 'f2', outcome: FlightOutcome.FAILURE, revenue: 0 }),
      makeFlight({ id: 'f3', outcome: FlightOutcome.PARTIAL_SUCCESS, revenue: 100 }),
      makeFlight({ id: 'f4', outcome: FlightOutcome.SUCCESS, revenue: 200 }),
    ];
    const stats = getAgencyStats(state);
    expect(stats.totalFlights).toBe(4);
    expect(stats.successfulFlights).toBe(2);
    expect(stats.failedFlights).toBe(1);
    expect(stats.partialSuccesses).toBe(1);
    expect(stats.totalRevenue).toBe(800);
  });

  it('counts crew by status', () => {
    const state = createGameState();
    state.crew = [
      makeCrew({ id: 'a', status: AstronautStatus.ACTIVE }),
      makeCrew({ id: 'b', status: AstronautStatus.ACTIVE }),
      makeCrew({ id: 'c', status: AstronautStatus.FIRED }),
      makeCrew({ id: 'd', status: AstronautStatus.KIA }),
    ];
    const stats = getAgencyStats(state);
    expect(stats.totalCrewHired).toBe(4);
    expect(stats.activeCrew).toBe(2);
    expect(stats.crewLost).toBe(1);
  });
});

describe('library: getRecords', () => {
  it('returns zero records for fresh state', () => {
    const records = getRecords(createGameState());
    expect(records.maxAltitude.value).toBe(0);
    expect(records.maxSpeed.value).toBe(0);
    expect(records.heaviestRocket.mass).toBe(0);
    expect(records.longestFlight.duration).toBe(0);
    expect(records.mostFlightsInRow).toBe(0);
  });

  it('tracks max altitude, speed, and flight duration across history', () => {
    const state = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', maxAltitude: 1000, maxSpeed: 100, duration: 60, rocketName: 'Alpha' }),
      makeFlight({ id: 'f2', maxAltitude: 5000, maxSpeed: 50, duration: 30, rocketName: 'Beta' }),
      makeFlight({ id: 'f3', maxAltitude: 2000, maxSpeed: 300, duration: 120, rocketName: 'Gamma' }),
    ];
    const records = getRecords(state);
    expect(records.maxAltitude.value).toBe(5000);
    expect(records.maxAltitude.rocketName).toBe('Beta');
    expect(records.maxSpeed.value).toBe(300);
    expect(records.maxSpeed.rocketName).toBe('Gamma');
    expect(records.longestFlight.duration).toBe(120);
    expect(records.longestFlight.rocketName).toBe('Gamma');
  });

  it('picks the heaviest rocket from saved designs', () => {
    const state = createGameState();
    state.savedDesigns = [
      makeDesign({ id: 'd1', name: 'Light', totalMass: 500 }),
      makeDesign({ id: 'd2', name: 'Heavy', totalMass: 5000 }),
      makeDesign({ id: 'd3', name: 'Medium', totalMass: 1500 }),
    ];
    const records = getRecords(state);
    expect(records.heaviestRocket.mass).toBe(5000);
    expect(records.heaviestRocket.name).toBe('Heavy');
    expect(records.heaviestRocket.id).toBe('d2');
  });

  it('computes the longest success streak', () => {
    const state = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', outcome: FlightOutcome.SUCCESS }),
      makeFlight({ id: 'f2', outcome: FlightOutcome.SUCCESS }),
      makeFlight({ id: 'f3', outcome: FlightOutcome.FAILURE }),
      makeFlight({ id: 'f4', outcome: FlightOutcome.SUCCESS }),
      makeFlight({ id: 'f5', outcome: FlightOutcome.SUCCESS }),
      makeFlight({ id: 'f6', outcome: FlightOutcome.SUCCESS }),
      makeFlight({ id: 'f7', outcome: FlightOutcome.FAILURE }),
    ];
    const records = getRecords(state);
    expect(records.mostFlightsInRow).toBe(3);
  });

  it('fills per-body record slots and marks Earth visited', () => {
    const state = createGameState();
    const records = getRecords(state);
    for (const bodyId of ALL_BODY_IDS) {
      expect(records.recordsByBody[bodyId]).toBeDefined();
    }
    expect(records.recordsByBody['EARTH'].visited).toBe(true);
  });

  it('marks bodies as visited/orbited/landed from flights, satellites, surface items', () => {
    const state = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', bodiesVisited: ['MOON'] }),
    ];
    state.satelliteNetwork = {
      satellites: [
        {
          id: 'sat1',
          bodyId: 'MARS',
          type: 'COMM',
          altitudeBand: 'LEO',
          launchDate: '2026-01-01',
          health: 100,
          operational: true,
          incomePerPeriod: 0,
          decayTime: 0,
        } as unknown as never,
      ],
    };
    state.surfaceItems = [
      { bodyId: 'MOON', kind: 'flag' } as unknown as never,
    ];
    const records = getRecords(state);
    expect(records.recordsByBody['MOON'].visited).toBe(true);
    expect(records.recordsByBody['MOON'].landed).toBe(true);
    expect(records.recordsByBody['MARS'].visited).toBe(true);
    expect(records.recordsByBody['MARS'].orbited).toBe(true);
  });
});

describe('library: getCrewCareers', () => {
  it('returns empty list for fresh state', () => {
    expect(getCrewCareers(createGameState())).toEqual([]);
  });

  it('counts flights per crew member from flight history', () => {
    const state = createGameState();
    state.crew = [
      makeCrew({ id: 'c1', name: 'Alice' }),
      makeCrew({ id: 'c2', name: 'Bob' }),
    ];
    state.flightHistory = [
      makeFlight({ id: 'f1', crewIds: ['c1'] }),
      makeFlight({ id: 'f2', crewIds: ['c1', 'c2'] }),
      makeFlight({ id: 'f3', crewIds: ['c2'] }),
    ];
    const careers = getCrewCareers(state);
    const alice = careers.find((c) => c.id === 'c1')!;
    const bob = careers.find((c) => c.id === 'c2')!;
    expect(alice.flightsFlown).toBe(2);
    expect(bob.flightsFlown).toBe(2);
    expect(alice.name).toBe('Alice');
  });
});

describe('library: getFinancialSummary', () => {
  it('reports balances from game state', () => {
    const state = createGameState();
    state.money = 12345;
    state.loan = { balance: 9999, interestRate: 0.05, totalInterestAccrued: 42 };
    state.reputation = 75;
    const summary = getFinancialSummary(state);
    expect(summary.currentBalance).toBe(12345);
    expect(summary.loanBalance).toBe(9999);
    expect(summary.totalInterestPaid).toBe(42);
    expect(summary.reputation).toBe(75);
  });

  it('sums mission and contract revenue', () => {
    const state = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', revenue: 100 }),
      makeFlight({ id: 'f2', revenue: 250 }),
    ];
    state.contracts.completed = [
      { reward: 500 } as unknown as never,
      { reward: 300 } as unknown as never,
    ];
    const summary = getFinancialSummary(state);
    expect(summary.totalMissionRevenue).toBe(350);
    expect(summary.totalContractRevenue).toBe(800);
  });
});

describe('library: getExplorationProgress', () => {
  it('always includes Earth as discovered', () => {
    const progress = getExplorationProgress(createGameState());
    expect(progress.discoveredBodies).toContain('EARTH');
    expect(progress.totalBodies).toBe(ALL_BODY_IDS.length);
  });

  it('adds bodies from flight history and surface items', () => {
    const state = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', bodiesVisited: ['MOON'] }),
    ];
    state.surfaceItems = [
      { bodyId: 'MARS', kind: 'flag' } as unknown as never,
    ];
    const progress = getExplorationProgress(state);
    expect(progress.discoveredBodies).toContain('MOON');
    expect(progress.bodiesLandedOn).toContain('MARS');
    expect(progress.surfaceItemCount).toBe(1);
  });

  it('counts biomes explored via science log', () => {
    const state = createGameState();
    state.scienceLog = [
      { biomeId: 'moon-highlands' } as unknown as never,
      { biomeId: 'moon-mare' } as unknown as never,
      { biomeId: 'moon-highlands' } as unknown as never,
    ];
    const progress = getExplorationProgress(state);
    expect(progress.biomesExplored).toBe(2);
  });
});

describe('library: getCelestialBodyKnowledge', () => {
  it('returns at least the Earth entry for a fresh game', () => {
    const entries = getCelestialBodyKnowledge(createGameState());
    const earth = entries.find((e) => e.id === 'EARTH');
    expect(earth).toBeDefined();
    expect(earth!.radius).toBeGreaterThan(0);
  });

  it('includes visit counts aggregated across flights', () => {
    const state = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', bodiesVisited: ['MOON'] }),
      makeFlight({ id: 'f2', bodiesVisited: ['MOON'] }),
    ];
    const entries = getCelestialBodyKnowledge(state);
    const moon = entries.find((e) => e.id === 'MOON');
    expect(moon).toBeDefined();
    expect(moon!.timesVisited).toBe(2);
  });
});

describe('library: getFrequentRockets', () => {
  it('returns empty list for a fresh state', () => {
    expect(getFrequentRockets(createGameState())).toEqual([]);
  });

  it('sorts rockets by flight count and limits to 5', () => {
    const state = createGameState();
    state.flightHistory = [];
    // rocket-1: 4 flights, rocket-2: 2 flights, rockets 3..7: 1 flight each.
    for (let i = 0; i < 4; i++) {
      state.flightHistory.push(
        makeFlight({
          id: `f1-${i}`,
          rocketId: 'rocket-1',
          rocketName: 'Alpha',
          outcome: FlightOutcome.SUCCESS,
          revenue: 100,
        }),
      );
    }
    for (let i = 0; i < 2; i++) {
      state.flightHistory.push(
        makeFlight({
          id: `f2-${i}`,
          rocketId: 'rocket-2',
          rocketName: 'Beta',
          outcome: FlightOutcome.FAILURE,
        }),
      );
    }
    for (let i = 3; i < 8; i++) {
      state.flightHistory.push(
        makeFlight({
          id: `f${i}`,
          rocketId: `rocket-${i}`,
          rocketName: `R${i}`,
          outcome: FlightOutcome.SUCCESS,
        }),
      );
    }

    const top = getFrequentRockets(state);
    expect(top.length).toBe(5);
    expect(top[0].rocketId).toBe('rocket-1');
    expect(top[0].flightCount).toBe(4);
    expect(top[0].successCount).toBe(4);
    expect(top[0].successRate).toBe(100);
    expect(top[0].totalRevenue).toBe(400);
    expect(top[1].rocketId).toBe('rocket-2');
    expect(top[1].flightCount).toBe(2);
    expect(top[1].failureCount).toBe(2);
    expect(top[1].successRate).toBe(0);
  });

  it('ignores flights without rocketId', () => {
    const state = createGameState();
    state.flightHistory = [
      makeFlight({ id: 'f1', rocketId: '' }),
      makeFlight({ id: 'f2', rocketId: 'rocket-1', rocketName: 'Alpha' }),
    ];
    const top = getFrequentRockets(state);
    expect(top.length).toBe(1);
    expect(top[0].rocketId).toBe('rocket-1');
  });

  it('falls back to savedDesigns name when flight rocketName is missing', () => {
    const state = createGameState();
    state.savedDesigns = [makeDesign({ id: 'rocket-1', name: 'Design Name' })];
    state.flightHistory = [
      makeFlight({ id: 'f1', rocketId: 'rocket-1', rocketName: '' }),
    ];
    const top = getFrequentRockets(state);
    expect(top[0].rocketName).toBe('Design Name');
  });
});
