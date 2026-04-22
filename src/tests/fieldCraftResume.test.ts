import { describe, it, expect } from 'vitest';
import {
  canResumeCraft,
  canResumeFieldCraft,
  prepareCraftResume,
  prepareFieldCraftResume,
  ResumeUnavailableError,
} from '../core/fieldCraftResume.ts';
import { FlightPhase, FieldCraftStatus, OrbitalObjectType } from '../core/constants.ts';
import { makeGameState, makeRocketDesign } from './_factories.ts';
import type { FieldCraft, GameState, OrbitalElements, OrbitalObject } from '../core/gameState.ts';

function makeFieldCraft(overrides: Partial<FieldCraft> = {}): FieldCraft {
  return {
    id: 'fc-1',
    name: 'Test Craft',
    bodyId: 'EARTH',
    status: FieldCraftStatus.IN_ORBIT,
    crewIds: ['crew-1'],
    suppliesRemaining: 10,
    hasExtendedLifeSupport: false,
    deployedPeriod: 0,
    orbitalElements: makeCircularElements(200_000),
    orbitBandId: 'LEO',
    rocketDesignId: 'design-test-1',
    ...overrides,
  };
}

function makeCircularElements(altitudeM: number): OrbitalElements {
  return {
    semiMajorAxis: 6_371_000 + altitudeM,
    eccentricity: 0,
    argPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  };
}

function makeStateWithField(
  field: FieldCraft,
  designOverrides: { id?: string } = {},
): GameState {
  const design = makeRocketDesign({ id: field.rocketDesignId ?? 'design-test-1', ...designOverrides });
  const state = makeGameState({
    fieldCraft: [field],
    savedDesigns: [design],
  });
  return state;
}

describe('canResumeFieldCraft @smoke', () => {
  it('returns true when craft has a linked design that still exists', () => {
    const state = makeStateWithField(makeFieldCraft());
    expect(canResumeFieldCraft(state, 'fc-1')).toBe(true);
  });

  it('returns false when craft has no rocketDesignId', () => {
    const state = makeStateWithField(makeFieldCraft({ rocketDesignId: undefined }));
    expect(canResumeFieldCraft(state, 'fc-1')).toBe(false);
  });

  it('returns false when the linked design has been deleted', () => {
    const state = makeGameState({
      fieldCraft: [makeFieldCraft({ rocketDesignId: 'missing-design' })],
      savedDesigns: [],
    });
    expect(canResumeFieldCraft(state, 'fc-1')).toBe(false);
  });

  it('returns false when the craft id does not match any field craft', () => {
    const state = makeStateWithField(makeFieldCraft());
    expect(canResumeFieldCraft(state, 'fc-does-not-exist')).toBe(false);
  });
});

describe('prepareFieldCraftResume', () => {
  it('returns a ready-to-start flight for an in-orbit craft', () => {
    const state = makeStateWithField(makeFieldCraft());
    const prep = prepareFieldCraftResume(state, 'fc-1');

    expect(prep.design.id).toBe('design-test-1');
    expect(prep.flightState.bodyId).toBe('EARTH');
    expect(prep.flightState.inOrbit).toBe(true);
    expect(prep.flightState.phase).toBe(FlightPhase.ORBIT);
    expect(prep.flightState.rocketId).toBe('design-test-1');
    expect(prep.flightState.crewIds).toEqual(['crew-1']);
    expect(prep.flightState.orbitalElements).not.toBeNull();
    expect(prep.flightState.orbitBandId).toBe('LEO');
    expect(prep.initialState.posY).toBeGreaterThan(0);
    // Circular orbit at 200 km should have a finite tangential velocity.
    expect(Number.isFinite(prep.initialState.velX)).toBe(true);
    expect(Math.abs(prep.initialState.velX)).toBeGreaterThan(0);
  });

  it('returns a landed-flight setup for a landed craft', () => {
    const landed = makeFieldCraft({
      status: FieldCraftStatus.LANDED,
      bodyId: 'MOON',
      orbitalElements: null,
      orbitBandId: null,
    });
    const state = makeStateWithField(landed);
    const prep = prepareFieldCraftResume(state, 'fc-1');

    expect(prep.flightState.inOrbit).toBe(false);
    expect(prep.flightState.bodyId).toBe('MOON');
    expect(prep.flightState.orbitalElements).toBeNull();
    expect(prep.initialState.posX).toBe(0);
    expect(prep.initialState.posY).toBe(0);
    expect(prep.initialState.velX).toBe(0);
    expect(prep.initialState.velY).toBe(0);
  });

  it('throws ResumeUnavailableError when the field craft is missing', () => {
    const state = makeStateWithField(makeFieldCraft());
    expect(() => prepareFieldCraftResume(state, 'fc-missing')).toThrow(ResumeUnavailableError);
    try {
      prepareFieldCraftResume(state, 'fc-missing');
    } catch (err) {
      expect((err as ResumeUnavailableError).reason).toBe('craftNotFound');
    }
  });

  it('throws ResumeUnavailableError when the craft has no design link', () => {
    const state = makeStateWithField(makeFieldCraft({ rocketDesignId: undefined }));
    try {
      prepareFieldCraftResume(state, 'fc-1');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ResumeUnavailableError);
      expect((err as ResumeUnavailableError).reason).toBe('noDesignLinked');
    }
  });

  it('throws ResumeUnavailableError when the linked design has been deleted', () => {
    const state = makeGameState({
      fieldCraft: [makeFieldCraft({ rocketDesignId: 'gone' })],
      savedDesigns: [],
    });
    try {
      prepareFieldCraftResume(state, 'fc-1');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ResumeUnavailableError);
      expect((err as ResumeUnavailableError).reason).toBe('designNotFound');
    }
  });

  it('does not mutate the field craft or design arrays on success', () => {
    const state = makeStateWithField(makeFieldCraft());
    const craftBefore = state.fieldCraft.length;
    const designsBefore = state.savedDesigns.length;
    prepareFieldCraftResume(state, 'fc-1');
    expect(state.fieldCraft.length).toBe(craftBefore);
    expect(state.savedDesigns.length).toBe(designsBefore);
  });
});

describe('canResumeCraft / prepareCraftResume for orbital-object CRAFTs', () => {
  function makeState(overrides: { objectType?: string; designId?: string | null } = {}): GameState {
    const obj: OrbitalObject = {
      id: 'orb-1',
      name: 'Undocked Orbiter',
      type: overrides.objectType ?? OrbitalObjectType.CRAFT,
      bodyId: 'EARTH',
      elements: makeCircularElements(300_000),
      rocketDesignId: overrides.designId === null ? undefined : (overrides.designId ?? 'design-test-1'),
    };
    const design = makeRocketDesign({ id: 'design-test-1' });
    return makeGameState({ orbitalObjects: [obj], savedDesigns: [design] });
  }

  it('resumes a CRAFT-type orbital object with a linked design', () => {
    const state = makeState();
    expect(canResumeCraft(state, 'orb-1')).toBe(true);
    const prep = prepareCraftResume(state, 'orb-1');
    expect(prep.source).toBe('orbitalObject');
    expect(prep.sourceId).toBe('orb-1');
    expect(prep.flightState.inOrbit).toBe(true);
    expect(prep.flightState.phase).toBe(FlightPhase.ORBIT);
    expect(prep.initialState.posY).toBeGreaterThan(0);
  });

  it('resumes a STATION-type orbital object', () => {
    const state = makeState({ objectType: OrbitalObjectType.STATION });
    expect(canResumeCraft(state, 'orb-1')).toBe(true);
  });

  it('resumes a SATELLITE with a linked design', () => {
    const state = makeState({ objectType: OrbitalObjectType.SATELLITE });
    expect(canResumeCraft(state, 'orb-1')).toBe(true);
    const prep = prepareCraftResume(state, 'orb-1');
    expect(prep.source).toBe('orbitalObject');
  });

  it('refuses to resume DEBRIS', () => {
    const state = makeState({ objectType: OrbitalObjectType.DEBRIS });
    expect(canResumeCraft(state, 'orb-1')).toBe(false);
    try {
      prepareCraftResume(state, 'orb-1');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ResumeUnavailableError);
      expect((err as ResumeUnavailableError).reason).toBe('notResumable');
    }
  });

  it('returns designNotFound when the linked design is missing', () => {
    const state = makeState({ designId: 'missing' });
    try {
      prepareCraftResume(state, 'orb-1');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ResumeUnavailableError);
      expect((err as ResumeUnavailableError).reason).toBe('designNotFound');
    }
  });

  it('returns noDesignLinked when the object has no rocketDesignId', () => {
    const state = makeState({ designId: null });
    expect(canResumeCraft(state, 'orb-1')).toBe(false);
  });
});
