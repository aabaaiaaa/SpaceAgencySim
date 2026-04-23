/**
 * debrisPersistence.test.ts — Unit tests for persisting controllable debris
 * as FieldCraft at flight end.
 *
 * When a multi-stage rocket decouples and a detached stage contains an intact
 * command module or probe core, and that stage ends the flight in stable
 * orbit or safely landed on a non-home body, it becomes its own persisted
 * controllable craft.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { persistControllableDebris } from '../core/debrisPersistence.ts';
import { FieldCraftStatus, BODY_GM, BODY_RADIUS } from '../core/constants.ts';
import { makeGameState, makeDebrisState, makeRocketDesign } from './_factories.ts';
import type { GameState, RocketPart } from '../core/gameState.ts';
import type { RocketAssembly, PlacedPart } from '../core/physics.ts';
import type { DebrisState } from '../core/staging.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAssembly(parts: Array<[string, string]>): RocketAssembly {
  // Each entry: [instanceId, partId]. Positions auto-generated.
  const map = new Map<string, PlacedPart>();
  let y = 0;
  for (const [id, partId] of parts) {
    map.set(id, { partId, x: 0, y } as PlacedPart);
    y += 1;
  }
  return { parts: map } as RocketAssembly;
}

function circularOrbit(altitude: number, bodyId: 'EARTH' | 'MOON' = 'EARTH'): { posX: number; posY: number; velX: number; velY: number } {
  const R = BODY_RADIUS[bodyId];
  const GM = BODY_GM[bodyId];
  const v = Math.sqrt(GM / (R + altitude));
  return { posX: 0, posY: altitude, velX: v, velY: 0 };
}

function makeFlightStateStub(bodyId: string = 'EARTH', rocketId: string = 'rocket-1'): {
  bodyId: string;
  rocketId: string;
  currentPeriod?: number;
} {
  return { bodyId, rocketId };
}

// ---------------------------------------------------------------------------

describe('persistControllableDebris', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGameState();
    state.savedDesigns = [];
    state.rockets = [makeRocketDesign({ id: 'rocket-1', name: 'Parent Rocket' })];
    state.fieldCraft = [];
  });

  it('@smoke persists a probe-bearing debris in stable orbit as a FieldCraft', () => {
    const assembly = buildAssembly([
      ['probe-1', 'probe-core-mk1'],
      ['tank-1', 'tank-small'],
    ]);
    const orbit = circularOrbit(150_000, 'EARTH');
    const debris: DebrisState = makeDebrisState({
      id: 'debris-probe',
      activeParts: new Set(['probe-1', 'tank-1']),
      ...orbit,
    });

    const result = persistControllableDebris(state, [debris], assembly, makeFlightStateStub('EARTH'));

    expect(result.length).toBe(1);
    expect(state.fieldCraft.length).toBe(1);
    const fc = state.fieldCraft[0];
    expect(fc.status).toBe(FieldCraftStatus.IN_ORBIT);
    expect(fc.bodyId).toBe('EARTH');
    expect(fc.crewIds).toEqual([]);
    expect(fc.hasCommandCapability).toBe(true);
    expect(fc.rocketDesignId).toBeTruthy();
    expect(fc.orbitalElements).not.toBeNull();
  });

  it('persists probe-bearing debris safely landed on a non-home body', () => {
    const assembly = buildAssembly([
      ['probe-1', 'probe-core-mk1'],
    ]);
    const debris: DebrisState = makeDebrisState({
      id: 'debris-landed',
      activeParts: new Set(['probe-1']),
      landed: true,
      crashed: false,
      posX: 0,
      posY: 0,
      velX: 0,
      velY: 0,
    });

    const result = persistControllableDebris(state, [debris], assembly, makeFlightStateStub('MOON'));

    expect(result.length).toBe(1);
    expect(state.fieldCraft[0].status).toBe(FieldCraftStatus.LANDED);
    expect(state.fieldCraft[0].bodyId).toBe('MOON');
  });

  it('ignores debris with no command capability (only a tank)', () => {
    const assembly = buildAssembly([
      ['tank-1', 'tank-small'],
    ]);
    const orbit = circularOrbit(150_000, 'EARTH');
    const debris: DebrisState = makeDebrisState({
      id: 'debris-tank',
      activeParts: new Set(['tank-1']),
      ...orbit,
    });

    const result = persistControllableDebris(state, [debris], assembly, makeFlightStateStub('EARTH'));

    expect(result.length).toBe(0);
    expect(state.fieldCraft.length).toBe(0);
  });

  it('ignores debris whose command module was destroyed (not in activeParts)', () => {
    const assembly = buildAssembly([
      ['probe-1', 'probe-core-mk1'],
      ['tank-1', 'tank-small'],
    ]);
    const orbit = circularOrbit(150_000, 'EARTH');
    const debris: DebrisState = makeDebrisState({
      id: 'debris-dead-probe',
      activeParts: new Set(['tank-1']), // probe destroyed
      ...orbit,
    });

    const result = persistControllableDebris(state, [debris], assembly, makeFlightStateStub('EARTH'));

    expect(result.length).toBe(0);
  });

  it('ignores crashed debris', () => {
    const assembly = buildAssembly([
      ['probe-1', 'probe-core-mk1'],
    ]);
    const debris: DebrisState = makeDebrisState({
      id: 'debris-crashed',
      activeParts: new Set(['probe-1']),
      crashed: true,
    });

    const result = persistControllableDebris(state, [debris], assembly, makeFlightStateStub('EARTH'));

    expect(result.length).toBe(0);
  });

  it('ignores debris on a suborbital trajectory', () => {
    const assembly = buildAssembly([
      ['probe-1', 'probe-core-mk1'],
    ]);
    // 10 km altitude, moving mostly upward — will reenter.
    const debris: DebrisState = makeDebrisState({
      id: 'debris-suborbital',
      activeParts: new Set(['probe-1']),
      posX: 0,
      posY: 10_000,
      velX: 200,
      velY: 500,
    });

    const result = persistControllableDebris(state, [debris], assembly, makeFlightStateStub('EARTH'));

    expect(result.length).toBe(0);
  });

  it('ignores debris landed on Earth (auto-recovery applies, no tracking)', () => {
    const assembly = buildAssembly([
      ['probe-1', 'probe-core-mk1'],
    ]);
    const debris: DebrisState = makeDebrisState({
      id: 'debris-earth',
      activeParts: new Set(['probe-1']),
      landed: true,
    });

    const result = persistControllableDebris(state, [debris], assembly, makeFlightStateStub('EARTH'));

    expect(result.length).toBe(0);
  });

  it('creates a synthetic RocketDesign per persisted debris that Take Control can find', () => {
    const assembly = buildAssembly([
      ['probe-1', 'probe-core-mk1'],
      ['tank-1', 'tank-small'],
    ]);
    const orbit = circularOrbit(150_000, 'EARTH');
    const debris: DebrisState = makeDebrisState({
      id: 'debris-probe',
      activeParts: new Set(['probe-1', 'tank-1']),
      ...orbit,
    });

    persistControllableDebris(state, [debris], assembly, makeFlightStateStub('EARTH'));

    const fc = state.fieldCraft[0];
    const design = state.rockets.find((r) => r.id === fc.rocketDesignId);
    expect(design).toBeDefined();
    expect(design!.parts.length).toBe(2);
    const partIds = design!.parts.map((p: RocketPart) => p.partId).sort();
    expect(partIds).toEqual(['probe-core-mk1', 'tank-small']);
  });

  it('persists multiple controllable debris independently from a single flight', () => {
    const assembly = buildAssembly([
      ['probe-a', 'probe-core-mk1'],
      ['probe-b', 'probe-core-mk1'],
      ['tank-1', 'tank-small'],
    ]);
    const orbit = circularOrbit(150_000, 'EARTH');
    const debrisA: DebrisState = makeDebrisState({
      id: 'debris-a',
      activeParts: new Set(['probe-a']),
      ...orbit,
    });
    const debrisB: DebrisState = makeDebrisState({
      id: 'debris-b',
      activeParts: new Set(['probe-b']),
      ...orbit,
    });

    const result = persistControllableDebris(state, [debrisA, debrisB], assembly, makeFlightStateStub('EARTH'));

    expect(result.length).toBe(2);
    expect(state.fieldCraft.length).toBe(2);
    // Each FieldCraft has its own synthetic design.
    expect(state.fieldCraft[0].rocketDesignId).not.toBe(state.fieldCraft[1].rocketDesignId);
  });
});
