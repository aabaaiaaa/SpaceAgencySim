import { describe, it, expect, beforeEach } from 'vitest';
import { getPartById } from '../data/parts.ts';
import { PartType } from '../core/constants.ts';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import { deployOutpostCore } from '../core/hubs.ts';

describe('Outpost Core part definition', () => {
  it('exists in the parts catalog', () => {
    const part = getPartById('outpost_core');
    expect(part).toBeDefined();
  });

  it('has correct type, mass, and cost', () => {
    const part = getPartById('outpost_core')!;
    expect(part.type).toBe(PartType.OUTPOST_CORE);
    expect(part.mass).toBe(2000);
    expect(part.cost).toBe(500_000);
  });

  it('has top and bottom snap points', () => {
    const part = getPartById('outpost_core')!;
    expect(part.snapPoints).toHaveLength(2);

    const topSnap = part.snapPoints.find(sp => sp.side === 'top');
    expect(topSnap).toBeDefined();

    const bottomSnap = part.snapPoints.find(sp => sp.side === 'bottom');
    expect(bottomSnap).toBeDefined();
  });
});

describe('Outpost Core deployment', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('surface deployment creates a surface hub @smoke', () => {
    state.money = 1_000_000;
    const hub = deployOutpostCore(state, { bodyId: 'MOON', altitude: 0, inOrbit: false, landed: true }, 'Lunar Base');
    expect(hub).not.toBeNull();
    expect(hub!.type).toBe('surface');
    expect(hub!.bodyId).toBe('MOON');
    expect(hub!.name).toBe('Lunar Base');
    expect(hub!.online).toBe(false); // new hubs start offline
    // Hub should be in state.hubs
    expect(state.hubs.find(h => h.id === hub!.id)).toBeDefined();
  });

  it('orbital deployment creates an orbital hub with altitude', () => {
    state.money = 1_000_000;
    const hub = deployOutpostCore(state, { bodyId: 'MARS', altitude: 250_000, inOrbit: true }, 'Mars Station');
    expect(hub).not.toBeNull();
    expect(hub!.type).toBe('orbital');
    expect(hub!.bodyId).toBe('MARS');
    expect(hub!.altitude).toBe(250_000);
    expect(hub!.name).toBe('Mars Station');
  });

  it('deducts Crew Hab monetary cost', () => {
    state.money = 1_000_000;
    const before = state.money;
    deployOutpostCore(state, { bodyId: 'MOON', altitude: 0, inOrbit: false }, 'Test Base');
    expect(state.money).toBeLessThan(before);
    // The cost should be the OFFWORLD_FACILITY_COSTS Crew Hab moneyCost (200_000)
    expect(state.money).toBe(before - 200_000);
  });

  it('fails with insufficient money', () => {
    state.money = 100; // Not enough
    const hub = deployOutpostCore(state, { bodyId: 'MOON', altitude: 0, inOrbit: false }, 'Broke Base');
    expect(hub).toBeNull();
    // Money should be unchanged
    expect(state.money).toBe(100);
    // No hub should be added
    expect(state.hubs).toHaveLength(1); // Just the Earth hub
  });
});
