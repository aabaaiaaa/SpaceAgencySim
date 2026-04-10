/**
 * render-camera.test.ts — Unit tests for camera helpers and coordinate transforms.
 *
 * Tests computeCoM, hasCommandModule, ppm, worldToScreen from
 * src/render/flight/_camera.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

vi.mock('pixi.js', () => ({
  Graphics: class {},
  Text: class { constructor() {} },
  TextStyle: class {},
  Container: class {
    children: unknown[] = [];
    addChild(c: unknown) { this.children.push(c); }
    removeChildAt(i: number) { return this.children.splice(i, 1)[0]; }
    removeChild(c: unknown) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  },
}));

// Mock getPartById to return controlled part definitions
vi.mock('../data/parts.ts', () => ({
  getPartById: vi.fn(),
}));

import { getPartById } from '../data/parts.ts';
import type { PartDef } from '../data/parts.ts';
import { PartType } from '../core/constants.ts';
import {
  resetFlightRenderState,
  setFlightRenderState,
} from '../render/flight/_state.ts';
import {
  computeCoM,
  hasCommandModule,
  ppm,
  worldToScreen,
} from '../render/flight/_camera.ts';
import { FLIGHT_PIXELS_PER_METRE } from '../render/flight/_constants.ts';
import type { ReadonlyAssembly } from '../render/types.ts';
import type { PlacedPart } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDef(overrides: Partial<PartDef> = {}): PartDef {
  return {
    id: 'test-part',
    name: 'Test Part',
    type: PartType.FUEL_TANK,
    mass: 100,
    cost: 500,
    width: 40,
    height: 20,
    snapPoints: [],
    animationStates: [],
    activatable: false,
    activationBehaviour: 'none',
    properties: {},
    ...overrides,
  };
}

function makePlaced(overrides: Partial<PlacedPart> = {}): PlacedPart {
  return {
    instanceId: 'inst-1',
    partId: 'test-part',
    x: 0,
    y: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ppm()', () => {
  beforeEach(() => {
    resetFlightRenderState();
    vi.mocked(getPartById).mockReset();
  });

  it('returns FLIGHT_PIXELS_PER_METRE at zoom 1', () => {
    expect(ppm()).toBe(FLIGHT_PIXELS_PER_METRE);
  });

  it('scales with zoom level', () => {
    setFlightRenderState({ zoomLevel: 2 });
    expect(ppm()).toBe(FLIGHT_PIXELS_PER_METRE * 2);
  });

  it('scales with fractional zoom', () => {
    setFlightRenderState({ zoomLevel: 0.5 });
    expect(ppm()).toBe(FLIGHT_PIXELS_PER_METRE * 0.5);
  });
});

describe('worldToScreen()', () => {
  beforeEach(() => {
    resetFlightRenderState();
    vi.mocked(getPartById).mockReset();
  });

  it('maps origin to screen center when camera is at origin', () => {
    const { sx, sy } = worldToScreen(0, 0, 800, 600);
    expect(sx).toBe(400); // 800/2
    expect(sy).toBe(300); // 600/2
  });

  it('offsets correctly for positive world X', () => {
    const { sx } = worldToScreen(10, 0, 800, 600);
    expect(sx).toBeGreaterThan(400); // right of center
  });

  it('offsets correctly for positive world Y (Y-up becomes Y-down)', () => {
    const { sy } = worldToScreen(0, 10, 800, 600);
    expect(sy).toBeLessThan(300); // above center in screen space
  });

  it('accounts for camera position', () => {
    setFlightRenderState({ camWorldX: 5, camWorldY: 5 });
    const { sx, sy } = worldToScreen(5, 5, 800, 600);
    // Camera is at the same position as the point — should be at screen center
    expect(sx).toBe(400);
    expect(sy).toBe(300);
  });

  it('scales with zoom level', () => {
    const zoom1 = worldToScreen(10, 0, 800, 600);
    setFlightRenderState({ zoomLevel: 2 });
    const zoom2 = worldToScreen(10, 0, 800, 600);
    // At 2x zoom, offset from center should double
    const offset1 = zoom1.sx - 400;
    const offset2 = zoom2.sx - 400;
    expect(offset2).toBeCloseTo(offset1 * 2);
  });
});

describe('hasCommandModule()', () => {
  beforeEach(() => {
    resetFlightRenderState();
    vi.mocked(getPartById).mockReset();
  });

  it('returns true when set contains a COMMAND_MODULE', () => {
    const placed = makePlaced({ instanceId: 'cmd-1', partId: 'pod' });
    const def = makeDef({ id: 'pod', type: PartType.COMMAND_MODULE });
    vi.mocked(getPartById).mockReturnValue(def);

    const parts = new Map<string, PlacedPart>([['cmd-1', placed]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['cmd-1']);

    expect(hasCommandModule(partSet, assembly)).toBe(true);
  });

  it('returns true when set contains a COMPUTER_MODULE', () => {
    const placed = makePlaced({ instanceId: 'comp-1', partId: 'computer' });
    const def = makeDef({ id: 'computer', type: PartType.COMPUTER_MODULE });
    vi.mocked(getPartById).mockReturnValue(def);

    const parts = new Map<string, PlacedPart>([['comp-1', placed]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['comp-1']);

    expect(hasCommandModule(partSet, assembly)).toBe(true);
  });

  it('returns false when set has no command modules', () => {
    const placed = makePlaced({ instanceId: 'tank-1', partId: 'tank' });
    const def = makeDef({ id: 'tank', type: PartType.FUEL_TANK });
    vi.mocked(getPartById).mockReturnValue(def);

    const parts = new Map<string, PlacedPart>([['tank-1', placed]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['tank-1']);

    expect(hasCommandModule(partSet, assembly)).toBe(false);
  });

  it('returns false for empty part set', () => {
    const assembly: ReadonlyAssembly = { parts: new Map<string, PlacedPart>(), connections: [] };
    expect(hasCommandModule(new Set<string>(), assembly)).toBe(false);
  });

  it('handles missing part lookup gracefully', () => {
    vi.mocked(getPartById).mockReturnValue(undefined);
    const parts = new Map<string, PlacedPart>([['x', makePlaced({ instanceId: 'x' })]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    expect(hasCommandModule(new Set(['x']), assembly)).toBe(false);
  });
});

describe('computeCoM()', () => {
  beforeEach(() => {
    resetFlightRenderState();
    vi.mocked(getPartById).mockReset();
  });

  it('returns origin when part set is empty', () => {
    const assembly: ReadonlyAssembly = { parts: new Map<string, PlacedPart>(), connections: [] };
    const result = computeCoM(new Map<string, number>(), assembly, new Set<string>(), 100, 200);
    expect(result.x).toBe(100);
    expect(result.y).toBe(200);
  });

  it('returns part position for a single part with no fuel', () => {
    const placed = makePlaced({ instanceId: 'p1', partId: 'part1', x: 0, y: 0 });
    const def = makeDef({ id: 'part1', mass: 50 });
    vi.mocked(getPartById).mockReturnValue(def);

    const parts = new Map<string, PlacedPart>([['p1', placed]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['p1']);
    const fuelStore = new Map<string, number>();

    const result = computeCoM(fuelStore, assembly, partSet, 10, 20);
    // Part at x=0, y=0 in local coords: worldX = 10 + 0*SCALE, worldY = 20 + 0*SCALE
    expect(result.x).toBeCloseTo(10);
    expect(result.y).toBeCloseTo(20);
  });

  it('@smoke computes weighted average for two parts with different masses', () => {
    const placed1 = makePlaced({ instanceId: 'p1', partId: 'part1', x: -20, y: 0 });
    const placed2 = makePlaced({ instanceId: 'p2', partId: 'part2', x: 20, y: 0 });
    const def1 = makeDef({ id: 'part1', mass: 100 });
    const def2 = makeDef({ id: 'part2', mass: 100 });
    vi.mocked(getPartById).mockImplementation((id: string) => {
      if (id === 'part1') return def1;
      if (id === 'part2') return def2;
      return undefined;
    });

    const parts = new Map<string, PlacedPart>([['p1', placed1], ['p2', placed2]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['p1', 'p2']);
    const fuelStore = new Map<string, number>();

    const result = computeCoM(fuelStore, assembly, partSet, 0, 0);
    // Equal mass, symmetric placement → CoM at origin
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it('includes fuel mass in calculation', () => {
    const placed = makePlaced({ instanceId: 'p1', partId: 'part1', x: 0, y: 0 });
    const def = makeDef({ id: 'part1', mass: 50 });
    vi.mocked(getPartById).mockReturnValue(def);

    const parts = new Map<string, PlacedPart>([['p1', placed]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['p1']);
    const fuelStore = new Map<string, number>([['p1', 200]]);

    const result = computeCoM(fuelStore, assembly, partSet, 0, 0);
    // With fuel, total mass = 50 + 200 = 250
    // Position unchanged since only one part
    expect(result.x).toBeCloseTo(0);
    expect(result.y).toBeCloseTo(0);
  });

  it('shifts CoM toward heavier part', () => {
    const placed1 = makePlaced({ instanceId: 'p1', partId: 'part1', x: -20, y: 0 });
    const placed2 = makePlaced({ instanceId: 'p2', partId: 'part2', x: 20, y: 0 });
    const def1 = makeDef({ id: 'part1', mass: 300 }); // heavy
    const def2 = makeDef({ id: 'part2', mass: 100 }); // light
    vi.mocked(getPartById).mockImplementation((id: string) => {
      if (id === 'part1') return def1;
      if (id === 'part2') return def2;
      return undefined;
    });

    const parts = new Map<string, PlacedPart>([['p1', placed1], ['p2', placed2]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['p1', 'p2']);
    const fuelStore = new Map<string, number>();

    const result = computeCoM(fuelStore, assembly, partSet, 0, 0);
    // CoM should be shifted toward p1 (negative X)
    expect(result.x).toBeLessThan(0);
  });

  it('skips missing parts gracefully', () => {
    vi.mocked(getPartById).mockReturnValue(undefined);
    const parts = new Map<string, PlacedPart>([['p1', makePlaced({ instanceId: 'p1' })]]);
    const assembly: ReadonlyAssembly = { parts, connections: [] };
    const partSet = new Set(['p1']);

    const result = computeCoM(new Map<string, number>(), assembly, partSet, 5, 10);
    // No valid parts → returns origin
    expect(result.x).toBe(5);
    expect(result.y).toBe(10);
  });
});
