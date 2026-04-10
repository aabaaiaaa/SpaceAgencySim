/**
 * fixtures.ts — Pre-built game state factories for E2E testing.
 *
 * Each fixture represents a specific point in game progression, allowing
 * tests to start from any phase without replaying earlier gameplay.
 *
 * Usage:
 *   import { earlyGameFixture } from './fixtures.js';
 *   const envelope = earlyGameFixture({ money: 500_000 });
 *   await seedAndLoadSave(page, envelope);
 */

import {
  STARTING_MONEY,
  STARTER_FACILITIES,
  ALL_FACILITIES,
  FacilityId,
  buildSaveEnvelope,
  buildCrewMember,
  buildContract,
  buildObjective,
} from './helpers.js';

import type {
  SaveEnvelope,
  SaveEnvelopeParams,
  ObjectiveTemplate,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Part sets at various progression stages
// ---------------------------------------------------------------------------

/** Starter parts available from the very beginning (non-tutorial). */
export const STARTER_PARTS: string[] = [
  'probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1',
  'science-module-mk1', 'thermometer-mk1', 'cmd-mk1',
];

/** Early game — starters + first mission rewards. */
export const EARLY_PARTS: string[] = [
  ...STARTER_PARTS,
  'tank-medium', 'srb-small', 'decoupler-stack-tr18',
];

/** Mid game — includes landing legs, larger tanks, science instruments. */
export const MID_PARTS: string[] = [
  ...EARLY_PARTS,
  'engine-reliant', 'tank-large', 'srb-large', 'decoupler-radial',
  'parachute-mk2', 'landing-legs-small', 'landing-legs-large',
  'satellite-mk1',
];

/** Late game — orbital-capable, all parts unlocked. */
export const ALL_PARTS: string[] = [
  ...MID_PARTS,
  'engine-poodle', 'engine-nerv',
  'satellite-comm', 'satellite-weather', 'satellite-science',
  'satellite-gps', 'satellite-relay',
  'docking-port-std', 'docking-port-small',
];

// ---------------------------------------------------------------------------
// Lightweight interfaces for mission/contract fixture parameters
// ---------------------------------------------------------------------------

/** Minimum shape for a mission passed to missionTestFixture. */
interface MissionFixtureInput {
  id: string;
  objectives: (ObjectiveTemplate | Record<string, unknown>)[];
  reward: number;
  [key: string]: unknown;
}

/** Minimum shape for a contract passed to contractTestFixture. */
interface ContractFixtureInput {
  id: string;
  objectives: (ObjectiveTemplate | Record<string, unknown>)[];
  reward: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Fixture: Fresh start (non-tutorial)
// ---------------------------------------------------------------------------

/**
 * Brand-new game, non-tutorial mode. Starter parts unlocked, starter facilities
 * built, no missions attempted.
 */
export function freshStartFixture(overrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:     'Fresh Start',
    agencyName:   'Test Agency',
    parts:        STARTER_PARTS,
    tutorialMode: false,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Fixture: Early game (a few flights completed)
// ---------------------------------------------------------------------------

/**
 * Early game: 3 missions completed, some money earned, basic parts unlocked.
 * Represents Phase 0 completion / early Phase 1.
 */
export function earlyGameFixture(overrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:       'Early Game',
    agencyName:     'Early Test Agency',
    money:          2_200_000,
    loan:           { balance: 1_800_000, interestRate: 0.03, totalInterestAccrued: 12_000 },
    parts:          EARLY_PARTS,
    currentPeriod:  3,
    tutorialMode:   false,
    missions: {
      available: [],
      accepted:  [],
      completed: [
        { id: 'mission-001', title: 'First Flight',     objectives: [{ id: 'obj-001-1', type: 'REACH_ALTITUDE', target: { altitude: 100 },  completed: true }], reward: 25_000, status: 'completed' },
      ],
    },
    flightHistory: [
      { id: 'fh-1', missionId: 'mission-001', outcome: 'SUCCESS' },
    ],
    reputation:   58,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Fixture: Mid game (crew, facilities, science)
// ---------------------------------------------------------------------------

/**
 * Mid game: multiple facilities built, crew hired, science collected,
 * tech researched. Represents Phase 2–3 gameplay.
 */
export function midGameFixture(overrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:       'Mid Game',
    agencyName:     'Mid Test Agency',
    money:          3_500_000,
    loan:           { balance: 1_000_000, interestRate: 0.03, totalInterestAccrued: 60_000 },
    parts:          MID_PARTS,
    currentPeriod:  10,
    tutorialMode:   false,
    facilities: {
      ...ALL_FACILITIES,
    },
    crew: [
      buildCrewMember({ id: 'crew-1', name: 'Alice Shepard', skills: { piloting: 70, engineering: 40, science: 30 } }),
      buildCrewMember({ id: 'crew-2', name: 'Bob Kerman',    skills: { piloting: 30, engineering: 70, science: 20 } }),
      buildCrewMember({ id: 'crew-3', name: 'Carol Ride',    skills: { piloting: 20, engineering: 20, science: 80 } }),
    ],
    missions: {
      available: [],
      accepted:  [],
      completed: [
        { id: 'mission-001', title: 'First Flight',     objectives: [], reward: 25_000, status: 'completed' },
        { id: 'mission-004', title: 'Speed Demon',      objectives: [], reward: 50_000, status: 'completed' },
        { id: 'mission-005', title: 'Safe Return I',     objectives: [], reward: 60_000, status: 'completed' },
        { id: 'mission-006', title: 'Science Flight',   objectives: [], reward: 75_000, status: 'completed' },
        { id: 'mission-007', title: 'Return Science',   objectives: [], reward: 80_000, status: 'completed' },
        { id: 'mission-008', title: 'Crash Test',       objectives: [], reward: 90_000, status: 'completed' },
      ],
    },
    flightHistory: [
      { id: 'fh-1', missionId: 'mission-001', outcome: 'SUCCESS' },
      { id: 'fh-2', missionId: 'mission-004', outcome: 'SUCCESS' },
      { id: 'fh-3', missionId: 'mission-005', outcome: 'SUCCESS' },
      { id: 'fh-4', missionId: 'mission-006', outcome: 'SUCCESS' },
      { id: 'fh-5', missionId: 'mission-007', outcome: 'SUCCESS' },
      { id: 'fh-6', missionId: 'mission-008', outcome: 'SUCCESS' },
    ],
    reputation:     72,
    sciencePoints:  45,
    scienceLog: [
      { instrumentId: 'thermometer-mk1', biomeId: 'lower-atmosphere', count: 3 },
      { instrumentId: 'thermometer-mk1', biomeId: 'upper-atmosphere', count: 2 },
    ],
    techTree: {
      researched: [],
      unlockedInstruments: ['thermometer-mk1'],
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Fixture: Orbital-capable (late game)
// ---------------------------------------------------------------------------

/**
 * Late game: orbital capability, satellites deployed, full tech tree,
 * advanced contracts. Represents Phase 5–6 gameplay.
 */
export function orbitalFixture(overrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:       'Orbital',
    agencyName:     'Orbital Test Agency',
    money:          8_000_000,
    loan:           { balance: 0, interestRate: 0.03, totalInterestAccrued: 200_000 },
    parts:          ALL_PARTS,
    currentPeriod:  25,
    tutorialMode:   false,
    facilities:     { ...ALL_FACILITIES },
    crew: [
      buildCrewMember({ id: 'crew-1', name: 'Alice Shepard', skills: { piloting: 90, engineering: 60, science: 50 }, missionsFlown: 12 }),
      buildCrewMember({ id: 'crew-2', name: 'Bob Kerman',    skills: { piloting: 40, engineering: 90, science: 40 }, missionsFlown: 10 }),
      buildCrewMember({ id: 'crew-3', name: 'Carol Ride',    skills: { piloting: 30, engineering: 30, science: 95 }, missionsFlown: 8 }),
      buildCrewMember({ id: 'crew-4', name: 'Dave Aldrin',   skills: { piloting: 80, engineering: 50, science: 60 }, missionsFlown: 6 }),
    ],
    missions: {
      available: [],
      accepted:  [],
      completed: [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map((n, i) => ({
        id: `mission-${String(n).padStart(3, '0')}`,
        title: `Completed Mission ${n}`,
        objectives: [],
        reward: 50_000 + i * 25_000,
        status: 'completed',
      })),
    },
    flightHistory: [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].map((n, i) => ({
      id: `fh-${i + 1}`,
      missionId: n <= 16 ? `mission-${String(n).padStart(3, '0')}` : null,
      outcome: 'SUCCESS',
    })),
    reputation:     90,
    sciencePoints:  120,
    scienceLog: [
      { instrumentId: 'thermometer-mk1', biomeId: 'lower-atmosphere', count: 5 },
      { instrumentId: 'thermometer-mk1', biomeId: 'upper-atmosphere', count: 4 },
      { instrumentId: 'thermometer-mk1', biomeId: 'near-space',       count: 3 },
      { instrumentId: 'barometer',        biomeId: 'lower-atmosphere', count: 3 },
      { instrumentId: 'barometer',        biomeId: 'upper-atmosphere', count: 2 },
    ],
    techTree: {
      researched: [],
      unlockedInstruments: ['thermometer-mk1', 'barometer', 'radiation-detector'],
    },
    satelliteNetwork: {
      satellites: [
        { id: 'sat-1', name: 'CommSat-1', partId: 'satellite-comm', bodyId: 'EARTH', bandId: 'LEO', health: 90, autoMaintain: true, deployedPeriod: 15 },
      ],
    },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Fixture builder: custom mission / contract in flight-ready state
// ---------------------------------------------------------------------------

/**
 * Create a fixture with a specific accepted mission, ready to fly.
 * Useful for testing individual objective types in isolation.
 */
export function missionTestFixture(mission: MissionFixtureInput, stateOverrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:     'Mission Test',
    agencyName:   'Mission Test Agency',
    parts:        ALL_PARTS,
    tutorialMode: false,
    facilities:   { ...ALL_FACILITIES },
    crew: [
      buildCrewMember({ id: 'crew-1', name: 'Test Pilot', skills: { piloting: 80, engineering: 50, science: 50 } }),
    ],
    missions: {
      available: [],
      accepted:  [{ ...mission, status: 'accepted' }],
      completed: [],
    },
    ...stateOverrides,
  });
}

/**
 * Create a fixture with a specific active contract, ready to fly.
 */
export function contractTestFixture(contract: ContractFixtureInput, stateOverrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:     'Contract Test',
    agencyName:   'Contract Test Agency',
    parts:        ALL_PARTS,
    tutorialMode: false,
    facilities:   { ...ALL_FACILITIES },
    crew: [
      buildCrewMember({ id: 'crew-1', name: 'Test Pilot', skills: { piloting: 80, engineering: 50, science: 50 } }),
    ],
    contracts: {
      board:     [],
      active:    [contract],
      completed: [],
      failed:    [],
    },
    ...stateOverrides,
  });
}
