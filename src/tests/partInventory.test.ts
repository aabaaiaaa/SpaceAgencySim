/**
 * partInventory.test.js — Unit tests for the part wear and reusability system (TASK-020).
 *
 * Tests cover:
 *   getFlightWear()            — wear calculation by part type
 *   getEffectiveReliability()  — reliability reduction from wear
 *   addToInventory()           — adding recovered parts
 *   removeFromInventory()      — removing inventory entries
 *   getInventoryCount()        — counting parts by catalog ID
 *   getInventoryForPart()      — querying sorted inventory entries
 *   refurbishPart()            — refurbishment cost and wear reset
 *   scrapPart()                — scrapping for partial value
 *   useInventoryPart()         — consuming best-condition part
 *   recoverPartsToInventory()  — full recovery flow
 */

import { describe, it, expect } from 'vitest';
import {
  getFlightWear,
  getEffectiveReliability,
  addToInventory,
  removeFromInventory,
  getInventoryCount,
  getInventoryForPart,
  refurbishPart,
  scrapPart,
  useInventoryPart,
  recoverPartsToInventory,
  computeAssemblyCashCost,
} from '../core/partInventory.ts';
import {
  PartType,
  WEAR_PER_FLIGHT_PASSIVE,
  WEAR_PER_FLIGHT_ENGINE,
  WEAR_PER_FLIGHT_SRB,
  WEAR_AFTER_REFURBISH,
  REFURBISH_COST_FRACTION,
  SCRAP_VALUE_FRACTION,
} from '../core/constants.ts';
import { createGameState } from '../core/gameState.ts';
import type { GameState, InventoryPart } from '../core/gameState.ts';
import { getPartById } from '../data/parts.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
} from '../core/rocketbuilder.ts';
import type { PhysicsState } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(money: number = 2_000_000): GameState {
  const state: GameState = createGameState();
  state.money = money;
  return state;
}

// ---------------------------------------------------------------------------
// getFlightWear
// ---------------------------------------------------------------------------

describe('getFlightWear', () => {
  it('returns high wear for engines', () => {
    expect(getFlightWear(PartType.ENGINE)).toBe(WEAR_PER_FLIGHT_ENGINE);
  });

  it('returns very high wear for SRBs', () => {
    expect(getFlightWear(PartType.SOLID_ROCKET_BOOSTER)).toBe(WEAR_PER_FLIGHT_SRB);
  });

  it('returns low wear for passive parts', () => {
    expect(getFlightWear(PartType.FUEL_TANK)).toBe(WEAR_PER_FLIGHT_PASSIVE);
    expect(getFlightWear(PartType.COMMAND_MODULE)).toBe(WEAR_PER_FLIGHT_PASSIVE);
    expect(getFlightWear(PartType.PARACHUTE)).toBe(WEAR_PER_FLIGHT_PASSIVE);
  });
});

// ---------------------------------------------------------------------------
// getEffectiveReliability
// ---------------------------------------------------------------------------

describe('getEffectiveReliability', () => {
  it('returns base reliability when wear is 0', () => {
    expect(getEffectiveReliability(0.92, 0)).toBeCloseTo(0.92);
  });

  it('reduces reliability by wear × factor', () => {
    // wear 50%, factor 0.5 → effective = 0.92 × (1 - 0.25) = 0.92 × 0.75 = 0.69
    expect(getEffectiveReliability(0.92, 50)).toBeCloseTo(0.69);
  });

  it('halves reliability at 100% wear', () => {
    // wear 100% → effective = 0.92 × (1 - 0.5) = 0.46
    expect(getEffectiveReliability(0.92, 100)).toBeCloseTo(0.46);
  });

  it('returns 0 when base reliability is 0', () => {
    expect(getEffectiveReliability(0, 50)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addToInventory / removeFromInventory
// ---------------------------------------------------------------------------

describe('addToInventory', () => {
  it('adds a part entry to inventory', () => {
    const state = makeState();
    const entry = addToInventory(state, 'engine-spark', 15, 1);

    expect(entry.partId).toBe('engine-spark');
    expect(entry.wear).toBe(15);
    expect(entry.flights).toBe(1);
    expect(entry.id).toBeTruthy();
    expect(state.partInventory).toHaveLength(1);
    expect(state.partInventory[0]).toBe(entry);
  });

  it('clamps wear to 0–100', () => {
    const state = makeState();
    const low = addToInventory(state, 'engine-spark', -10);
    expect(low.wear).toBe(0);

    const high = addToInventory(state, 'engine-spark', 150);
    expect(high.wear).toBe(100);
  });

  it('initialises partInventory if missing', () => {
    const state = makeState();
    // @ts-expect-error testing defensive guard when partInventory is missing
    delete state.partInventory;
    addToInventory(state, 'engine-spark', 10);
    expect(state.partInventory).toHaveLength(1);
  });
});

describe('removeFromInventory', () => {
  it('removes and returns the entry', () => {
    const state = makeState();
    const entry = addToInventory(state, 'engine-spark', 20);
    const removed = removeFromInventory(state, entry.id);

    expect(removed).toBe(entry);
    expect(state.partInventory).toHaveLength(0);
  });

  it('returns null for non-existent ID', () => {
    const state = makeState();
    expect(removeFromInventory(state, 'no-such-id')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getInventoryCount / getInventoryForPart
// ---------------------------------------------------------------------------

describe('getInventoryCount', () => {
  it('returns 0 when no inventory', () => {
    const state = makeState();
    expect(getInventoryCount(state, 'engine-spark')).toBe(0);
  });

  it('counts only matching partId', () => {
    const state = makeState();
    addToInventory(state, 'engine-spark', 10);
    addToInventory(state, 'engine-spark', 30);
    addToInventory(state, 'tank-small', 5);

    expect(getInventoryCount(state, 'engine-spark')).toBe(2);
    expect(getInventoryCount(state, 'tank-small')).toBe(1);
    expect(getInventoryCount(state, 'cmd-mk1')).toBe(0);
  });
});

describe('getInventoryForPart', () => {
  it('returns entries sorted by wear (lowest first)', () => {
    const state = makeState();
    addToInventory(state, 'engine-spark', 40);
    addToInventory(state, 'engine-spark', 10);
    addToInventory(state, 'engine-spark', 25);

    const entries = getInventoryForPart(state, 'engine-spark');
    expect(entries).toHaveLength(3);
    expect(entries[0].wear).toBe(10);
    expect(entries[1].wear).toBe(25);
    expect(entries[2].wear).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// refurbishPart
// ---------------------------------------------------------------------------

describe('refurbishPart', () => {
  it('pays cost and resets wear to 10%', () => {
    const state = makeState(100_000);
    const entry = addToInventory(state, 'engine-spark', 50);
    const def = getPartById('engine-spark')!;
    const expectedCost = Math.round(def.cost * REFURBISH_COST_FRACTION);

    const result = refurbishPart(state, entry.id);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(expectedCost);
    expect(entry.wear).toBe(WEAR_AFTER_REFURBISH);
    expect(state.money).toBe(100_000 - expectedCost);
  });

  it('fails when insufficient funds', () => {
    const state = makeState(0);
    const entry = addToInventory(state, 'engine-spark', 50);

    const result = refurbishPart(state, entry.id);
    expect(result.success).toBe(false);
    expect(entry.wear).toBe(50); // unchanged
  });

  it('fails for non-existent inventory ID', () => {
    const state = makeState();
    const result = refurbishPart(state, 'no-such-id');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scrapPart
// ---------------------------------------------------------------------------

describe('scrapPart', () => {
  it('removes part and earns scrap value', () => {
    const state = makeState(100_000);
    const entry = addToInventory(state, 'engine-spark', 60);
    const def = getPartById('engine-spark')!;
    const expectedValue = Math.round(def.cost * SCRAP_VALUE_FRACTION);

    const result = scrapPart(state, entry.id);

    expect(result.success).toBe(true);
    expect(result.value).toBe(expectedValue);
    expect(state.partInventory).toHaveLength(0);
    expect(state.money).toBe(100_000 + expectedValue);
  });

  it('fails for non-existent inventory ID', () => {
    const state = makeState();
    const result = scrapPart(state, 'no-such-id');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useInventoryPart
// ---------------------------------------------------------------------------

describe('useInventoryPart', () => {
  it('uses the lowest-wear part', () => {
    const state = makeState();
    addToInventory(state, 'engine-spark', 40);
    addToInventory(state, 'engine-spark', 10);
    addToInventory(state, 'engine-spark', 25);

    const used = useInventoryPart(state, 'engine-spark')!;
    expect(used.wear).toBe(10);
    expect(state.partInventory).toHaveLength(2);
  });

  it('returns null when no inventory', () => {
    const state = makeState();
    expect(useInventoryPart(state, 'engine-spark')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recoverPartsToInventory
// ---------------------------------------------------------------------------

describe('recoverPartsToInventory', () => {
  it('recovers intact parts with wear based on type', () => {
    const state = makeState();
    const assembly = createRocketAssembly();
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',     0, 0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);
    connectParts(assembly, probeId, 1, tankId, 0);
    connectParts(assembly, tankId, 1, engineId, 0);

    const ps: Partial<PhysicsState> = {
      activeParts: new Set([probeId, tankId, engineId]),
      landed: true,
      crashed: false,
    };

    const result = recoverPartsToInventory(state, assembly, ps as PhysicsState, null);

    expect(result.partsRecovered).toBe(3);
    expect(state.partInventory).toHaveLength(3);

    // Check wear values by part type.
    const invByPartId: Record<string, InventoryPart> = {};
    for (const e of state.partInventory) {
      invByPartId[e.partId] = e;
    }
    expect(invByPartId['probe-core-mk1'].wear).toBe(WEAR_PER_FLIGHT_PASSIVE);
    expect(invByPartId['tank-small'].wear).toBe(WEAR_PER_FLIGHT_PASSIVE);
    expect(invByPartId['engine-spark'].wear).toBe(WEAR_PER_FLIGHT_ENGINE);
  });

  it('skips parts not in activeParts (jettisoned)', () => {
    const state = makeState();
    const assembly = createRocketAssembly();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    addPartToAssembly(assembly, 'tank-small',     0, 0);

    const ps: Partial<PhysicsState> = {
      activeParts: new Set([probeId]), // tank was jettisoned
      landed: true,
      crashed: false,
    };

    const result = recoverPartsToInventory(state, assembly, ps as PhysicsState, null);

    expect(result.partsRecovered).toBe(1);
    expect(state.partInventory).toHaveLength(1);
    expect(state.partInventory[0].partId).toBe('probe-core-mk1');
  });

  it('accumulates wear on previously used inventory parts', () => {
    const state = makeState();
    const assembly = createRocketAssembly();
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, 0);

    const ps: Partial<PhysicsState> = {
      activeParts: new Set([engineId]),
      landed: true,
      crashed: false,
    };

    // Simulate a part from inventory with existing wear.
    const usedInvParts = new Map<string, InventoryPart>();
    usedInvParts.set(engineId, { id: 'inv-old', partId: 'engine-spark', wear: 30, flights: 2 });

    const result = recoverPartsToInventory(state, assembly, ps as PhysicsState, usedInvParts);

    expect(result.partsRecovered).toBe(1);
    const recovered = state.partInventory[0];
    expect(recovered.wear).toBe(30 + WEAR_PER_FLIGHT_ENGINE); // 30 + 15 = 45
    expect(recovered.flights).toBe(3); // 2 + 1
  });

  it('skips parts at 100% accumulated wear', () => {
    const state = makeState();
    const assembly = createRocketAssembly();
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, 0);

    const ps: Partial<PhysicsState> = {
      activeParts: new Set([engineId]),
      landed: true,
      crashed: false,
    };

    // Part already at 90% wear — adding 15% engine wear would exceed 100%.
    const usedInvParts = new Map<string, InventoryPart>();
    usedInvParts.set(engineId, { id: 'inv-old', partId: 'engine-spark', wear: 90, flights: 5 });

    const result = recoverPartsToInventory(state, assembly, ps as PhysicsState, usedInvParts);

    // 90 + 15 = 105 → capped at 100 → skipped (wear >= 100)
    expect(result.partsRecovered).toBe(0);
    expect(state.partInventory).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe('wear constants', () => {
  it('passive < engine < SRB', () => {
    expect(WEAR_PER_FLIGHT_PASSIVE).toBeLessThan(WEAR_PER_FLIGHT_ENGINE);
    expect(WEAR_PER_FLIGHT_ENGINE).toBeLessThan(WEAR_PER_FLIGHT_SRB);
  });

  it('refurbishment resets wear to expected level', () => {
    expect(WEAR_AFTER_REFURBISH).toBe(10);
  });

  it('scrap value is less than refurbish cost', () => {
    expect(SCRAP_VALUE_FRACTION).toBeLessThan(REFURBISH_COST_FRACTION);
  });
});

// ---------------------------------------------------------------------------
// computeAssemblyCashCost
// ---------------------------------------------------------------------------

describe('computeAssemblyCashCost', () => {
  it('sums def.cost across all placed parts when none are from inventory', () => {
    const assembly = createRocketAssembly();
    const cmdId  = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, -40);

    const total = computeAssemblyCashCost(assembly, new Set());

    const expected = getPartById('cmd-mk1')!.cost + getPartById('tank-small')!.cost;
    expect(total).toBe(expected);
    // Guard against future part-catalog shifts making this a tautology:
    expect(cmdId).not.toBe(tankId);
  });

  it('excludes parts whose instanceIds are in the inventory-sourced set', () => {
    const assembly = createRocketAssembly();
    const cmdId  = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, -40);

    const total = computeAssemblyCashCost(assembly, new Set([tankId]));

    expect(total).toBe(getPartById('cmd-mk1')!.cost);
    expect(cmdId).not.toBe(tankId);
  });

  it('returns 0 for an empty assembly', () => {
    const assembly = createRocketAssembly();
    expect(computeAssemblyCashCost(assembly, new Set())).toBe(0);
  });

  it('returns 0 when every placed part is inventory-sourced', () => {
    const assembly = createRocketAssembly();
    const cmdId  = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, -40);

    const total = computeAssemblyCashCost(assembly, new Set([cmdId, tankId]));

    expect(total).toBe(0);
  });

  it('treats unknown part IDs as cost 0', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    addPartToAssembly(assembly, 'no-such-part', 0, -40);

    const total = computeAssemblyCashCost(assembly, new Set());

    expect(total).toBe(getPartById('cmd-mk1')!.cost);
  });
});
