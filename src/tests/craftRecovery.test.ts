/**
 * craftRecovery.test.ts — Unit tests for the player-craft recovery flow.
 *
 * A persisted FieldCraft can be "recovered" — parts returned to inventory,
 * salvage cash credited, craft removed — only when it's within reach of an
 * online agency hub: a surface hub on the same body for landed craft, or
 * an orbital hub around the same body for craft in orbit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  canRecoverFieldCraft,
  recoverFieldCraft,
  RecoveryUnavailableError,
} from '../core/craftRecovery.ts';
import { FieldCraftStatus } from '../core/constants.ts';
import { makeGameState, makeHub, makeEarthHub, makeOrbitalHub, makeRocketDesign } from './_factories.ts';
import type { FieldCraft, GameState, RocketPart } from '../core/gameState.ts';

function addFieldCraft(state: GameState, overrides: Partial<FieldCraft> = {}): FieldCraft {
  if (!Array.isArray(state.fieldCraft)) state.fieldCraft = [];
  const craft: FieldCraft = {
    id: overrides.id ?? `fc-${state.fieldCraft.length + 1}`,
    name: overrides.name ?? 'Test Probe',
    bodyId: overrides.bodyId ?? 'MOON',
    status: overrides.status ?? FieldCraftStatus.LANDED,
    crewIds: overrides.crewIds ?? [],
    suppliesRemaining: overrides.suppliesRemaining ?? 5,
    hasExtendedLifeSupport: overrides.hasExtendedLifeSupport ?? false,
    hasCommandCapability: overrides.hasCommandCapability ?? true,
    deployedPeriod: overrides.deployedPeriod ?? 0,
    orbitalElements: overrides.orbitalElements ?? null,
    orbitBandId: overrides.orbitBandId ?? null,
    // Respect explicit undefined in overrides to test "no design linked" path.
    rocketDesignId: 'rocketDesignId' in overrides ? overrides.rocketDesignId : 'design-test-1',
  };
  state.fieldCraft.push(craft);
  return craft;
}

function simpleDesignParts(): RocketPart[] {
  // Two parts: a command module and a tank. Enough to verify parts-return.
  return [
    { partId: 'cmd-mk1', position: { x: 0, y: 0 } },
    { partId: 'tank-small', position: { x: 0, y: 1 } },
  ];
}

describe('canRecoverFieldCraft', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGameState();
    state.hubs = [makeEarthHub()];
  });

  describe('landed craft', () => {
    it('allows recovery when a surface hub exists on the same body', () => {
      state.hubs.push(makeHub({ bodyId: 'MOON', type: 'surface', online: true }));
      const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MOON' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(true);
    });

    it('disallows recovery when no hub exists on the landed body', () => {
      const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MARS' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(false);
    });

    it('disallows recovery when the surface hub is offline', () => {
      state.hubs.push(makeHub({ bodyId: 'MOON', type: 'surface', online: false }));
      const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MOON' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(false);
    });

    it('disallows recovery when only an orbital hub orbits the landed body', () => {
      state.hubs.push(makeOrbitalHub({ bodyId: 'MOON', online: true }));
      const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MOON' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(false);
    });

    it('allows recovery when landed on Earth (Earth HQ is always present)', () => {
      const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'EARTH' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(true);
    });
  });

  describe('orbital craft', () => {
    it('allows recovery when an orbital hub orbits the same body', () => {
      state.hubs.push(makeOrbitalHub({ bodyId: 'MOON', online: true }));
      const fc = addFieldCraft(state, {
        status: FieldCraftStatus.IN_ORBIT,
        bodyId: 'MOON',
        orbitalElements: { semiMajorAxis: 1_800_000, eccentricity: 0, argPeriapsis: 0, meanAnomalyAtEpoch: 0, epoch: 0 },
      });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(true);
    });

    it('disallows recovery when the orbital hub is offline', () => {
      state.hubs.push(makeOrbitalHub({ bodyId: 'MOON', online: false }));
      const fc = addFieldCraft(state, { status: FieldCraftStatus.IN_ORBIT, bodyId: 'MOON' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(false);
    });

    it('disallows recovery when only a surface hub exists on the same body', () => {
      state.hubs.push(makeHub({ bodyId: 'MOON', type: 'surface', online: true }));
      const fc = addFieldCraft(state, { status: FieldCraftStatus.IN_ORBIT, bodyId: 'MOON' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(false);
    });

    it('disallows recovery when the orbital hub orbits a different body', () => {
      state.hubs.push(makeOrbitalHub({ bodyId: 'EARTH', online: true }));
      const fc = addFieldCraft(state, { status: FieldCraftStatus.IN_ORBIT, bodyId: 'MARS' });

      expect(canRecoverFieldCraft(state, fc).allowed).toBe(false);
    });
  });
});

describe('recoverFieldCraft', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGameState();
    state.hubs = [makeEarthHub()];
    state.savedDesigns = [makeRocketDesign({ id: 'design-test-1', parts: simpleDesignParts() })];
    state.rockets = [{ id: 'design-test-1', name: 'Test Rocket' } as GameState['rockets'][number]];
  });

  it('@smoke removes the craft from state.fieldCraft on success', () => {
    state.hubs.push(makeHub({ bodyId: 'MOON', type: 'surface', online: true }));
    const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MOON' });

    const result = recoverFieldCraft(state, fc.id);

    expect(result.craftId).toBe(fc.id);
    expect(state.fieldCraft.find((c) => c.id === fc.id)).toBeUndefined();
  });

  it('returns parts to inventory based on the linked rocket design', () => {
    state.hubs.push(makeHub({ bodyId: 'MOON', type: 'surface', online: true }));
    const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MOON' });

    const before = state.partInventory?.length ?? 0;
    const result = recoverFieldCraft(state, fc.id);

    expect(result.partsRecovered).toBe(2);
    expect(state.partInventory?.length ?? 0).toBe(before + 2);
  });

  it('credits salvage cash to the player', () => {
    state.hubs.push(makeHub({ bodyId: 'MOON', type: 'surface', online: true }));
    const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MOON' });

    const cashBefore = state.money;
    const result = recoverFieldCraft(state, fc.id);

    expect(result.salvageValue).toBeGreaterThan(0);
    expect(state.money).toBe(cashBefore + result.salvageValue);
  });

  it('throws RecoveryUnavailableError when no hub is within range', () => {
    const fc = addFieldCraft(state, { status: FieldCraftStatus.LANDED, bodyId: 'MARS' });

    expect(() => recoverFieldCraft(state, fc.id)).toThrow(RecoveryUnavailableError);
    // Craft still exists.
    expect(state.fieldCraft.find((c) => c.id === fc.id)).toBeDefined();
  });

  it('throws RecoveryUnavailableError when no rocket design is linked', () => {
    state.hubs.push(makeHub({ bodyId: 'MOON', type: 'surface', online: true }));
    const fc = addFieldCraft(state, {
      status: FieldCraftStatus.LANDED,
      bodyId: 'MOON',
      rocketDesignId: undefined,
    });

    expect(() => recoverFieldCraft(state, fc.id)).toThrow(RecoveryUnavailableError);
    expect(state.fieldCraft.find((c) => c.id === fc.id)).toBeDefined();
  });

  it('throws RecoveryUnavailableError when the craft id is not found', () => {
    expect(() => recoverFieldCraft(state, 'nonexistent')).toThrow(RecoveryUnavailableError);
  });
});
