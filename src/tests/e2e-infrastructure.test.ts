// @ts-nocheck
/**
 * e2e-infrastructure.test.js — Unit tests for the E2E test infrastructure.
 *
 * Validates that:
 *   1. buildSaveEnvelope produces structurally valid save envelopes.
 *   2. All fixture factories (freshStart, earlyGame, midGame, orbital) produce
 *      states that pass the saveload _validateState check.
 *   3. Factory helpers (buildCrewMember, buildContract, buildObjective) produce
 *      well-formed objects.
 *   4. Malfunction mode values match the MalfunctionMode enum.
 */

import { describe, it, expect } from 'vitest';
import { _validateState } from '../core/saveload.ts';
import { MalfunctionMode } from '../core/constants.ts';
import { buildTestRocket } from '../core/testFlightBuilder.ts';

// Import the E2E helpers and fixtures (they are plain JS, no browser APIs needed).
// We use a dynamic import approach since e2e/ is outside src/tests/ — Vitest
// resolves relative paths from the project root.
import {
  buildSaveEnvelope,
  buildCrewMember,
  buildContract,
  buildObjective,
  STARTING_MONEY,
  STARTER_FACILITIES,
  ALL_FACILITIES,
} from '../../e2e/helpers.js';

import {
  freshStartFixture,
  earlyGameFixture,
  midGameFixture,
  orbitalFixture,
  missionTestFixture,
  contractTestFixture,
  STARTER_PARTS,
  EARLY_PARTS,
  MID_PARTS,
  ALL_PARTS,
} from '../../e2e/fixtures.js';

// ---------------------------------------------------------------------------
// Suite 1: buildSaveEnvelope structure
// ---------------------------------------------------------------------------

describe('buildSaveEnvelope', () => {
  it('produces a valid envelope with default values', () => {
    const envelope = buildSaveEnvelope();

    expect(envelope).toHaveProperty('saveName', 'E2E Test');
    expect(envelope).toHaveProperty('timestamp');
    expect(typeof envelope.timestamp).toBe('string');
    expect(envelope).toHaveProperty('state');

    const s = envelope.state;
    expect(s.agencyName).toBe('Test Agency');
    expect(s.money).toBe(STARTING_MONEY);
    expect(s.loan).toEqual({ balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 });
    expect(Array.isArray(s.crew)).toBe(true);
    expect(Array.isArray(s.rockets)).toBe(true);
    expect(Array.isArray(s.savedDesigns)).toBe(true);
    expect(Array.isArray(s.parts)).toBe(true);
    expect(Array.isArray(s.flightHistory)).toBe(true);
    expect(s.missions).toEqual({ available: [], accepted: [], completed: [] });
    expect(s.currentPeriod).toBe(0);
    expect(s.playTimeSeconds).toBe(0);
    expect(s.flightTimeSeconds).toBe(0);
    expect(s.currentFlight).toBeNull();
    expect(Array.isArray(s.orbitalObjects)).toBe(true);
    expect(s.vabAssembly).toBeNull();
    expect(s.vabStagingConfig).toBeNull();
    expect(s.tutorialMode).toBe(true);
    expect(s.contracts).toEqual({ board: [], active: [], completed: [], failed: [] });
    expect(s.reputation).toBe(50);
    expect(s.sciencePoints).toBe(0);
    expect(Array.isArray(s.scienceLog)).toBe(true);
    expect(s.techTree).toEqual({ researched: [], unlockedInstruments: [] });
    expect(s.satelliteNetwork).toEqual({ satellites: [] });
  });

  it('state passes _validateState', () => {
    const envelope = buildSaveEnvelope();
    expect(() => _validateState(envelope.state)).not.toThrow();
  });

  it('respects custom overrides', () => {
    const envelope = buildSaveEnvelope({
      money: 999,
      reputation: 100,
      sciencePoints: 42,
      agencyName: 'Custom',
    });
    expect(envelope.state.money).toBe(999);
    expect(envelope.state.reputation).toBe(100);
    expect(envelope.state.sciencePoints).toBe(42);
    expect(envelope.state.agencyName).toBe('Custom');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: Fixture factories produce valid states
// ---------------------------------------------------------------------------

describe('Fixture factories', () => {
  const fixtureTests = [
    ['freshStartFixture', freshStartFixture],
    ['earlyGameFixture',  earlyGameFixture],
    ['midGameFixture',    midGameFixture],
    ['orbitalFixture',    orbitalFixture],
  ];

  for (const [name, factory] of fixtureTests) {
    describe(name, () => {
      it('produces a valid save envelope', () => {
        const envelope = factory();
        expect(envelope).toHaveProperty('saveName');
        expect(envelope).toHaveProperty('timestamp');
        expect(envelope).toHaveProperty('state');
      });

      it('state passes _validateState', () => {
        const envelope = factory();
        expect(() => _validateState(envelope.state)).not.toThrow();
      });

      it('has required top-level state fields', () => {
        const s = factory().state;
        expect(typeof s.money).toBe('number');
        expect(typeof s.playTimeSeconds).toBe('number');
        expect(typeof s.reputation).toBe('number');
        expect(typeof s.sciencePoints).toBe('number');
        expect(typeof s.currentPeriod).toBe('number');
        expect(Array.isArray(s.crew)).toBe(true);
        expect(Array.isArray(s.rockets)).toBe(true);
        expect(Array.isArray(s.parts)).toBe(true);
        expect(Array.isArray(s.flightHistory)).toBe(true);
        expect(s.missions).toHaveProperty('available');
        expect(s.missions).toHaveProperty('accepted');
        expect(s.missions).toHaveProperty('completed');
        expect(s.contracts).toHaveProperty('board');
        expect(s.contracts).toHaveProperty('active');
        expect(s.contracts).toHaveProperty('completed');
        expect(s.contracts).toHaveProperty('failed');
        expect(s.techTree).toHaveProperty('researched');
        expect(s.techTree).toHaveProperty('unlockedInstruments');
        expect(s.satelliteNetwork).toHaveProperty('satellites');
      });

      it('accepts overrides without breaking validation', () => {
        const envelope = factory({ money: 1, reputation: 0 });
        expect(() => _validateState(envelope.state)).not.toThrow();
        expect(envelope.state.money).toBe(1);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Suite 3: Mission / contract test fixtures
// ---------------------------------------------------------------------------

describe('missionTestFixture', () => {
  const mission = {
    id: 'test-m',
    title: 'Test',
    description: 'Test mission.',
    objectives: [{ id: 'o1', type: 'REACH_ALTITUDE', target: { altitude: 100 }, completed: false }],
    reward: 10_000,
    unlocksAfter: [],
    unlockedParts: [],
  };

  it('injects the mission as accepted', () => {
    const envelope = missionTestFixture(mission);
    const s = envelope.state;
    expect(s.missions.accepted).toHaveLength(1);
    expect(s.missions.accepted[0].id).toBe('test-m');
    expect(s.missions.accepted[0].status).toBe('accepted');
  });

  it('state passes _validateState', () => {
    const envelope = missionTestFixture(mission);
    expect(() => _validateState(envelope.state)).not.toThrow();
  });

  it('includes crew and all parts for flight readiness', () => {
    const s = missionTestFixture(mission).state;
    expect(s.crew.length).toBeGreaterThan(0);
    expect(s.parts.length).toBeGreaterThan(0);
  });
});

describe('contractTestFixture', () => {
  const contract = buildContract({
    id: 'test-c',
    title: 'Test Contract',
    objectives: [
      buildObjective({ id: 'co1', type: 'REACH_ALTITUDE', target: { altitude: 200 } }),
    ],
    reward: 50_000,
  });

  it('injects the contract as active', () => {
    const envelope = contractTestFixture(contract);
    const s = envelope.state;
    expect(s.contracts.active).toHaveLength(1);
    expect(s.contracts.active[0].id).toBe('test-c');
  });

  it('state passes _validateState', () => {
    const envelope = contractTestFixture(contract);
    expect(() => _validateState(envelope.state)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Helper factories
// ---------------------------------------------------------------------------

describe('buildCrewMember', () => {
  it('produces a crew member with defaults', () => {
    const crew = buildCrewMember();
    expect(crew.id).toBe('crew-test-1');
    expect(crew.name).toBe('Test Astronaut');
    expect(crew.status).toBe('IDLE');
    expect(crew.salary).toBe(5_000);
    expect(crew.skills).toEqual({ piloting: 50, engineering: 50, science: 50 });
  });

  it('respects overrides', () => {
    const crew = buildCrewMember({ id: 'c-1', name: 'Alice', skills: { piloting: 90, engineering: 10, science: 10 } });
    expect(crew.id).toBe('c-1');
    expect(crew.name).toBe('Alice');
    expect(crew.skills.piloting).toBe(90);
  });
});

describe('buildContract', () => {
  it('produces a contract with defaults', () => {
    const c = buildContract();
    expect(c.id).toBe('contract-test-1');
    expect(c.title).toBe('Test Contract');
    expect(c.reward).toBe(50_000);
    expect(Array.isArray(c.objectives)).toBe(true);
    expect(Array.isArray(c.bonusObjectives)).toBe(true);
    expect(Array.isArray(c.conflictTags)).toBe(true);
  });
});

describe('buildObjective', () => {
  it('produces an objective with defaults', () => {
    const o = buildObjective();
    expect(o.id).toBe('obj-test-1');
    expect(o.type).toBe('REACH_ALTITUDE');
    expect(o.completed).toBe(false);
  });

  it('supports all objective types', () => {
    const types = [
      'REACH_ALTITUDE', 'REACH_SPEED', 'SAFE_LANDING', 'ACTIVATE_PART',
      'HOLD_ALTITUDE', 'RETURN_SCIENCE_DATA', 'CONTROLLED_CRASH',
      'EJECT_CREW', 'RELEASE_SATELLITE', 'REACH_ORBIT',
      'BUDGET_LIMIT', 'MAX_PARTS', 'RESTRICT_PART',
      'MULTI_SATELLITE', 'MINIMUM_CREW',
    ];
    for (const type of types) {
      const o = buildObjective({ type, id: `obj-${type}` });
      expect(o.type).toBe(type);
      expect(o.completed).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Part sets are progressive subsets
// ---------------------------------------------------------------------------

describe('Part sets', () => {
  it('STARTER_PARTS is a subset of EARLY_PARTS', () => {
    for (const part of STARTER_PARTS) {
      expect(EARLY_PARTS).toContain(part);
    }
  });

  it('EARLY_PARTS is a subset of MID_PARTS', () => {
    for (const part of EARLY_PARTS) {
      expect(MID_PARTS).toContain(part);
    }
  });

  it('MID_PARTS is a subset of ALL_PARTS', () => {
    for (const part of MID_PARTS) {
      expect(ALL_PARTS).toContain(part);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 6: MalfunctionMode values match constants
// ---------------------------------------------------------------------------

describe('MalfunctionMode constants', () => {
  it('defines the three modes used by E2E tests', () => {
    expect(MalfunctionMode.NORMAL).toBe('normal');
    expect(MalfunctionMode.OFF).toBe('off');
    expect(MalfunctionMode.FORCED).toBe('forced');
  });
});

// ---------------------------------------------------------------------------
// Suite 7: buildTestRocket — programmatic rocket assembly
// ---------------------------------------------------------------------------

describe('buildTestRocket', () => {
  it('builds a valid assembly from 3 part IDs', () => {
    const { assembly, stagingConfig } = buildTestRocket([
      'probe-core-mk1', 'tank-small', 'engine-spark',
    ]);

    expect(assembly.parts.size).toBe(3);
    expect(assembly.connections.length).toBe(2);

    // Engine should be auto-staged into Stage 1
    const stage1 = stagingConfig.stages[0];
    expect(stage1.instanceIds.length).toBeGreaterThan(0);
  });

  it('connects parts in order (top to bottom)', () => {
    const { assembly, stagingConfig } = buildTestRocket([
      'cmd-mk1', 'tank-medium', 'engine-spark',
    ]);

    expect(assembly.parts.size).toBe(3);
    expect(assembly.connections.length).toBe(2);

    // All parts should be positioned vertically (increasing Y)
    const parts = [...assembly.parts.values()];
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].y).toBeGreaterThan(parts[i - 1].y);
    }
  });

  it('auto-stages engines into Stage 1', () => {
    const { stagingConfig } = buildTestRocket([
      'probe-core-mk1', 'tank-small', 'engine-spark',
    ]);

    // Stage 1 should contain the engine instance ID
    expect(stagingConfig.stages[0].instanceIds.length).toBe(1);
    expect(stagingConfig.currentStageIdx).toBe(0);
  });

  it('handles a single part', () => {
    const { assembly, stagingConfig } = buildTestRocket(['probe-core-mk1']);
    expect(assembly.parts.size).toBe(1);
    expect(assembly.connections.length).toBe(0);
  });

  it('handles unknown part IDs gracefully', () => {
    const { assembly } = buildTestRocket(['nonexistent-part']);
    expect(assembly.parts.size).toBe(0);
  });
});
