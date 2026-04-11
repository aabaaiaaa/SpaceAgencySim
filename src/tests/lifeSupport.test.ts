/**
 * lifeSupport.test.js — Unit tests for the crew life support system.
 *
 * Tests cover:
 *   - processLifeSupport()       — ticks down supplies per period
 *   - Supply exhaustion           — crew die when supplies reach 0
 *   - Extended Mission Module     — infinite supplies (no countdown)
 *   - Warnings at threshold       — warning at 1 period remaining
 *   - createFieldCraft()          — creates field craft entries correctly
 *   - hasExtendedLifeSupport()    — detects Extended Mission Module in assembly
 *   - Integration with advancePeriod()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { processLifeSupport, createFieldCraft, hasExtendedLifeSupport } from '../core/lifeSupport.ts';
import { advancePeriod } from '../core/period.ts';
import {
  AstronautStatus,
  DEFAULT_LIFE_SUPPORT_PERIODS,
  LIFE_SUPPORT_WARNING_THRESHOLD,
  FieldCraftStatus,
  CREW_SALARY_PER_PERIOD,
} from '../core/constants.ts';
import type { GameState, CrewMember, FieldCraft } from '../core/gameState.ts';
import type { RocketAssembly, PlacedPart, PhysicsState } from '../core/physics.ts';
import type { PeriodSummary } from '../core/period.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  return createGameState();
}

function addCrew(state: GameState, overrides: Partial<CrewMember> = {}): string {
  const id = overrides.id ?? `crew-${state.crew.length + 1}`;
  state.crew.push({
    id,
    name: overrides.name ?? `Astronaut ${state.crew.length + 1}`,
    status: overrides.status ?? AstronautStatus.ACTIVE,
    skills: { piloting: 0, engineering: 0, science: 0 },
    salary: overrides.salary ?? CREW_SALARY_PER_PERIOD,
    hireDate: new Date().toISOString(),
    injuryEnds: null,
    missionsFlown: 0,
    flightsFlown: 0,
    deathDate: null,
    deathCause: null,
    assignedRocketId: null,
    trainingSkill: null,
    trainingEnds: null,
    stationedHubId: 'earth',
    transitUntil: null,
  });
  return id;
}

function addFieldCraft(state: GameState, overrides: Partial<FieldCraft> = {}): FieldCraft {
  if (!Array.isArray(state.fieldCraft)) state.fieldCraft = [];
  const craft: FieldCraft = {
    id: overrides.id ?? `fc-${state.fieldCraft.length + 1}`,
    name: overrides.name ?? `Vessel ${state.fieldCraft.length + 1}`,
    bodyId: overrides.bodyId ?? 'EARTH',
    status: overrides.status ?? FieldCraftStatus.IN_ORBIT,
    crewIds: overrides.crewIds ?? [],
    suppliesRemaining: overrides.suppliesRemaining ?? DEFAULT_LIFE_SUPPORT_PERIODS,
    hasExtendedLifeSupport: overrides.hasExtendedLifeSupport ?? false,
    deployedPeriod: overrides.deployedPeriod ?? 0,
    orbitalElements: overrides.orbitalElements ?? null,
    orbitBandId: overrides.orbitBandId ?? null,
  };
  state.fieldCraft.push(craft);
  return craft;
}

// ---------------------------------------------------------------------------
// processLifeSupport()
// ---------------------------------------------------------------------------

describe('processLifeSupport()', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
  });

  it('decrements supplies by 1 each period for non-extended craft', () => {
    const crewId = addCrew(state);
    addFieldCraft(state, {
      crewIds: [crewId],
      suppliesRemaining: 5,
    });

    const result = processLifeSupport(state);

    expect(state.fieldCraft[0].suppliesRemaining).toBe(4);
    expect(result.deaths).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('does not decrement supplies for craft with Extended Mission Module', () => {
    const crewId = addCrew(state);
    addFieldCraft(state, {
      crewIds: [crewId],
      suppliesRemaining: 5,
      hasExtendedLifeSupport: true,
    });

    processLifeSupport(state);

    expect(state.fieldCraft[0].suppliesRemaining).toBe(5);
  });

  it('issues a warning when supplies reach the warning threshold', () => {
    const crewId = addCrew(state);
    addFieldCraft(state, {
      crewIds: [crewId],
      suppliesRemaining: LIFE_SUPPORT_WARNING_THRESHOLD + 1,
    });

    const result = processLifeSupport(state);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].suppliesRemaining).toBe(LIFE_SUPPORT_WARNING_THRESHOLD);
    expect(result.warnings[0].crewIds).toContain(crewId);
  });

  it('kills crew when supplies reach 0', () => {
    const crewId = addCrew(state, { name: 'Jeb' });
    addFieldCraft(state, {
      name: 'Orbiter-1',
      crewIds: [crewId],
      suppliesRemaining: 1,
    });

    const result = processLifeSupport(state);

    // Crew should be KIA.
    const astronaut = state.crew.find((a) => a.id === crewId);
    expect(astronaut!.status).toBe(AstronautStatus.KIA);
    expect(astronaut!.deathCause).toBe('Life support exhausted');

    // Death reported in result.
    expect(result.deaths).toHaveLength(1);
    expect(result.deaths[0].crewName).toBe('Jeb');
    expect(result.deaths[0].craftName).toBe('Orbiter-1');
  });

  it('kills all crew on the same craft when supplies exhaust', () => {
    const id1 = addCrew(state, { name: 'Alice' });
    const id2 = addCrew(state, { name: 'Bob' });
    addFieldCraft(state, {
      crewIds: [id1, id2],
      suppliesRemaining: 1,
    });

    const result = processLifeSupport(state);

    expect(result.deaths).toHaveLength(2);
    expect(state.crew.find((a) => a.id === id1)!.status).toBe(AstronautStatus.KIA);
    expect(state.crew.find((a) => a.id === id2)!.status).toBe(AstronautStatus.KIA);
  });

  it('removes field craft with no surviving crew', () => {
    const crewId = addCrew(state);
    addFieldCraft(state, {
      id: 'fc-doomed',
      crewIds: [crewId],
      suppliesRemaining: 1,
    });

    const result = processLifeSupport(state);

    expect(state.fieldCraft).toHaveLength(0);
    expect(result.removedCraftIds).toContain('fc-doomed');
  });

  it('handles empty fieldCraft array gracefully', () => {
    state.fieldCraft = [];
    const result = processLifeSupport(state);
    expect(result.deaths).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('handles missing fieldCraft property gracefully', () => {
    // @ts-expect-error Intentionally deleting required property to test defensive code
    delete state.fieldCraft;
    const result = processLifeSupport(state);
    expect(result.deaths).toHaveLength(0);
    expect(Array.isArray(state.fieldCraft)).toBe(true);
  });

  it('skips supply tick for field craft with no crew and removes them', () => {
    addFieldCraft(state, {
      crewIds: [],
      suppliesRemaining: 3,
    });

    const result = processLifeSupport(state);

    // Craft with no crew gets cleaned up (removed from array).
    expect(state.fieldCraft).toHaveLength(0);
    expect(result.deaths).toHaveLength(0);
  });

  it('processes multiple field craft independently', () => {
    const crew1 = addCrew(state);
    const crew2 = addCrew(state);
    addFieldCraft(state, {
      crewIds: [crew1],
      suppliesRemaining: 5,
      hasExtendedLifeSupport: false,
    });
    addFieldCraft(state, {
      crewIds: [crew2],
      suppliesRemaining: 3,
      hasExtendedLifeSupport: true,
    });

    processLifeSupport(state);

    expect(state.fieldCraft[0].suppliesRemaining).toBe(4);
    expect(state.fieldCraft[1].suppliesRemaining).toBe(3); // Unchanged (extended).
  });
});

// ---------------------------------------------------------------------------
// createFieldCraft()
// ---------------------------------------------------------------------------

describe('createFieldCraft()', () => {
  it('creates a field craft with default supply count', () => {
    const craft = createFieldCraft({
      name: 'Orbiter-1',
      bodyId: 'MOON',
      status: FieldCraftStatus.IN_ORBIT,
      crewIds: ['crew-1'],
      hasExtendedLifeSupport: false,
      deployedPeriod: 5,
    });

    expect(craft.name).toBe('Orbiter-1');
    expect(craft.bodyId).toBe('MOON');
    expect(craft.status).toBe(FieldCraftStatus.IN_ORBIT);
    expect(craft.crewIds).toEqual(['crew-1']);
    expect(craft.suppliesRemaining).toBe(DEFAULT_LIFE_SUPPORT_PERIODS);
    expect(craft.hasExtendedLifeSupport).toBe(false);
    expect(craft.deployedPeriod).toBe(5);
    expect(craft.id).toBeTruthy();
  });

  it('creates a field craft with extended life support', () => {
    const craft = createFieldCraft({
      name: 'Station Alpha',
      bodyId: 'EARTH',
      status: FieldCraftStatus.IN_ORBIT,
      crewIds: ['crew-1', 'crew-2'],
      hasExtendedLifeSupport: true,
      deployedPeriod: 10,
      orbitalElements: { semiMajorAxis: 6571000, eccentricity: 0, argPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 },
      orbitBandId: 'LEO',
    });

    expect(craft.hasExtendedLifeSupport).toBe(true);
    expect(craft.orbitalElements).not.toBeNull();
    expect(craft.orbitBandId).toBe('LEO');
  });

  it('clones crewIds array to prevent external mutation', () => {
    const crewIds = ['crew-1', 'crew-2'];
    const craft = createFieldCraft({
      name: 'Test',
      bodyId: 'MARS',
      status: FieldCraftStatus.LANDED,
      crewIds,
      hasExtendedLifeSupport: false,
      deployedPeriod: 0,
    });

    crewIds.push('crew-3');
    expect(craft.crewIds).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// hasExtendedLifeSupport()
// ---------------------------------------------------------------------------

describe('hasExtendedLifeSupport()', () => {
  it('returns false for null assembly', () => {
    expect(hasExtendedLifeSupport(null, null)).toBe(false);
  });

  it('returns true when Extended Mission Module is present', () => {
    // Mock assembly with Map-like interface.
    const assembly: Pick<RocketAssembly, 'parts'> = {
      parts: new Map<string, Pick<PlacedPart, 'partId'>>([
        ['inst-1', { partId: 'mission-module-extended' }],
        ['inst-2', { partId: 'engine-spark' }],
      ]) as Map<string, PlacedPart>,
    };

    expect(hasExtendedLifeSupport(assembly as RocketAssembly, null)).toBe(true);
  });

  it('returns false when no Extended Mission Module is present', () => {
    const assembly: Pick<RocketAssembly, 'parts'> = {
      parts: new Map<string, Pick<PlacedPart, 'partId'>>([
        ['inst-1', { partId: 'engine-spark' }],
        ['inst-2', { partId: 'cmd-mk1' }],
      ]) as Map<string, PlacedPart>,
    };

    expect(hasExtendedLifeSupport(assembly as RocketAssembly, null)).toBe(false);
  });

  it('ignores destroyed parts when physics state is available', () => {
    const assembly: Pick<RocketAssembly, 'parts'> = {
      parts: new Map<string, Pick<PlacedPart, 'partId'>>([
        ['inst-1', { partId: 'mission-module-extended' }],
      ]) as Map<string, PlacedPart>,
    };
    const ps: Pick<PhysicsState, 'activeParts'> = {
      activeParts: new Set<string>(), // inst-1 is NOT active (destroyed).
    };

    expect(hasExtendedLifeSupport(assembly as RocketAssembly, ps as PhysicsState)).toBe(false);
  });

  it('detects active Extended Mission Module in physics state', () => {
    const assembly: Pick<RocketAssembly, 'parts'> = {
      parts: new Map<string, Pick<PlacedPart, 'partId'>>([
        ['inst-1', { partId: 'mission-module-extended' }],
      ]) as Map<string, PlacedPart>,
    };
    const ps: Pick<PhysicsState, 'activeParts'> = {
      activeParts: new Set<string>(['inst-1']),
    };

    expect(hasExtendedLifeSupport(assembly as RocketAssembly, ps as PhysicsState)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration with advancePeriod()
// ---------------------------------------------------------------------------

describe('advancePeriod() life support integration', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
  });

  it('includes life support warnings in period summary', () => {
    const crewId = addCrew(state);
    addFieldCraft(state, {
      crewIds: [crewId],
      suppliesRemaining: LIFE_SUPPORT_WARNING_THRESHOLD + 1,
    });

    const summary: PeriodSummary = advancePeriod(state);

    expect(summary.lifeSupportWarnings).toHaveLength(1);
  });

  it('includes life support deaths in period summary', () => {
    const crewId = addCrew(state, { name: 'Doomed' });
    addFieldCraft(state, {
      crewIds: [crewId],
      suppliesRemaining: 1,
    });

    const summary: PeriodSummary = advancePeriod(state);

    expect(summary.lifeSupportDeaths).toHaveLength(1);
    expect(summary.lifeSupportDeaths[0].crewName).toBe('Doomed');
  });

  it('counts down supplies over multiple periods', () => {
    const crewId = addCrew(state);
    addFieldCraft(state, {
      crewIds: [crewId],
      suppliesRemaining: 3,
    });

    advancePeriod(state); // 3 → 2
    expect(state.fieldCraft[0].suppliesRemaining).toBe(2);

    advancePeriod(state); // 2 → 1 (warning)
    expect(state.fieldCraft[0].suppliesRemaining).toBe(1);

    const summary: PeriodSummary = advancePeriod(state); // 1 → 0 (death)
    expect(state.fieldCraft).toHaveLength(0); // Removed — crew dead.
    expect(summary.lifeSupportDeaths).toHaveLength(1);
  });

  it('does not tick extended life support craft over multiple periods', () => {
    const crewId = addCrew(state);
    addFieldCraft(state, {
      crewIds: [crewId],
      suppliesRemaining: DEFAULT_LIFE_SUPPORT_PERIODS,
      hasExtendedLifeSupport: true,
    });

    // Run 10 periods — supplies should never change.
    for (let i = 0; i < 10; i++) {
      advancePeriod(state);
    }

    expect(state.fieldCraft[0].suppliesRemaining).toBe(DEFAULT_LIFE_SUPPORT_PERIODS);
    expect(state.crew[0].status).toBe(AstronautStatus.ACTIVE);
  });
});
