/**
 * render-ground.test.ts — Unit tests for ground rendering functions.
 *
 * Tests renderGround and renderSurfaceItems from src/render/flight/_ground.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Graphics } from 'pixi.js';
import type { ReadonlySurfaceItem } from '../render/types.ts';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

const { MockGraphics, MockText, MockTextStyle, MockContainer } = vi.hoisted(() => {
  class MockGraphics {
    visible = true; alpha = 1; position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; parent = null; clear = vi.fn(); rect = vi.fn();
    fill = vi.fn(); stroke = vi.fn(); circle = vi.fn(); moveTo = vi.fn();
    lineTo = vi.fn(); closePath = vi.fn(); ellipse = vi.fn();
  }
  class MockText {
    visible = true; alpha = 1; position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; anchor = { set: vi.fn() }; parent = null;
    text = ''; style = null; x = 0; y = 0;
    constructor() {}
  }
  class MockTextStyle {}
  class MockContainer {
    children: unknown[] = [];
    addChild(c: unknown) { this.children.push(c); return c; }
    removeChildAt(i: number) { return this.children.splice(i,1)[0]; }
    removeChild(c: unknown) { const i = this.children.indexOf(c); if(i>=0) this.children.splice(i,1); return c; }
  }
  return { MockGraphics, MockText, MockTextStyle, MockContainer };
});

vi.mock('pixi.js', () => ({
  Graphics: MockGraphics,
  Text: MockText,
  TextStyle: MockTextStyle,
  Container: MockContainer,
}));

// Mock biome functions for renderBiomeLabel tests
vi.mock('../core/biomes.ts', () => ({
  getBiome: vi.fn(),
  getBiomeTransition: vi.fn(),
}));

import { getBiome, getBiomeTransition } from '../core/biomes.ts';
import { SurfaceItemType } from '../core/constants.ts';
import {
  getFlightRenderState,
  resetFlightRenderState,
} from '../render/flight/_state.ts';
import { BIOME_LABEL_FADE_SPEED } from '../render/flight/_constants.ts';
import { renderGround, renderSurfaceItems, renderBiomeLabel } from '../render/flight/_ground.ts';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('renderGround', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('does nothing when groundGraphics is null', () => {
    renderGround(800, 600);
    // Should not throw
  });

  it('clears and draws ground when visible', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.groundGraphics = mockGfx as unknown as Graphics;
    s.camWorldY = -10; // camera looking down at ground

    renderGround(800, 600);

    expect(mockGfx.clear).toHaveBeenCalled();
    expect(mockGfx.rect).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('skips drawing when ground is entirely above viewport', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.groundGraphics = mockGfx as unknown as Graphics;
    s.camWorldY = -10000; // camera looking way up

    renderGround(800, 600);

    expect(mockGfx.clear).toHaveBeenCalled();
    // Ground screen Y would be way below the viewport
  });
});

describe('renderSurfaceItems', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('does nothing when surfaceItemsGraphics is null', () => {
    renderSurfaceItems([], 800, 600);
    // Should not throw
  });

  it('does nothing for empty items array', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    renderSurfaceItems([], 800, 600);
    expect(mockGfx.clear).toHaveBeenCalled();
  });

  it('renders a FLAG surface item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.camWorldX = 0;
    s.camWorldY = 0;
    s.zoomLevel = 1;

    const items: ReadonlySurfaceItem[] = [{ id: '1', type: SurfaceItemType.FLAG, bodyId: 'earth', posX: 10, deployedPeriod: 0 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.rect).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders a SURFACE_SAMPLE item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.zoomLevel = 1;

    const items: ReadonlySurfaceItem[] = [{ id: '2', type: SurfaceItemType.SURFACE_SAMPLE, bodyId: 'earth', posX: 5, deployedPeriod: 0 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.circle).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders a SURFACE_INSTRUMENT item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.zoomLevel = 1;

    const items: ReadonlySurfaceItem[] = [{ id: '3', type: SurfaceItemType.SURFACE_INSTRUMENT, bodyId: 'earth', posX: 0, deployedPeriod: 0 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.moveTo).toHaveBeenCalled();
    expect(mockGfx.lineTo).toHaveBeenCalled();
    expect(mockGfx.closePath).toHaveBeenCalled();
  });

  it('renders a BEACON item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.zoomLevel = 1;

    const items: ReadonlySurfaceItem[] = [{ id: '4', type: SurfaceItemType.BEACON, bodyId: 'earth', posX: -5, deployedPeriod: 0 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.moveTo).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders multiple items of different types', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.zoomLevel = 1;

    const items: ReadonlySurfaceItem[] = [
      { id: '5', type: SurfaceItemType.FLAG, bodyId: 'earth', posX: -10, deployedPeriod: 0 },
      { id: '6', type: SurfaceItemType.SURFACE_SAMPLE, bodyId: 'earth', posX: 0, deployedPeriod: 0 },
      { id: '7', type: SurfaceItemType.BEACON, bodyId: 'earth', posX: 10, deployedPeriod: 0 },
    ];
    renderSurfaceItems(items, 800, 600);

    // Multiple draw calls
    expect(mockGfx.fill.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('skips items that are off-screen', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.camWorldX = 0;
    s.zoomLevel = 1;

    // Item very far off-screen
    const items: ReadonlySurfaceItem[] = [{ id: '8', type: SurfaceItemType.FLAG, bodyId: 'earth', posX: 100000, deployedPeriod: 0 }];
    renderSurfaceItems(items, 800, 600);

    // rect should not be called because item is off-screen
    expect(mockGfx.rect).not.toHaveBeenCalled();
  });

  it('skips rendering when ground is off-screen', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.camWorldY = -100000; // ground way below viewport
    s.zoomLevel = 1;

    const items: ReadonlySurfaceItem[] = [{ id: '9', type: SurfaceItemType.FLAG, bodyId: 'earth', posX: 0, deployedPeriod: 0 }];
    renderSurfaceItems(items, 800, 600);

    // Should have cleared but not drawn any items
    expect(mockGfx.clear).toHaveBeenCalled();
  });

  it('skips rendering when ground is above the viewport (positive camWorldY)', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx as unknown as Graphics;
    s.camWorldY = 100000; // camera way above → groundScreenY = h/2 + camWorldY * p which is huge
    s.zoomLevel = 1;

    const items: ReadonlySurfaceItem[] = [{ id: '10', type: SurfaceItemType.FLAG, bodyId: 'earth', posX: 0, deployedPeriod: 0 }];
    renderSurfaceItems(items, 800, 600);

    // groundScreenY is way above h+50, so no items drawn
    expect(mockGfx.clear).toHaveBeenCalled();
  });
});

describe('renderGround edge cases', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('draws ground starting at 0 when groundScreenY is negative', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.groundGraphics = mockGfx as unknown as Graphics;
    s.camWorldY = 5; // camera slightly above ground -> groundScreenY slightly positive

    renderGround(800, 600);

    expect(mockGfx.rect).toHaveBeenCalled();
  });

  it('draws ground when groundScreenY equals viewport height exactly', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.groundGraphics = mockGfx as unknown as Graphics;
    // groundScreenY = h/2 + camWorldY * ppm() => need it exactly at h
    // h/2 + camWorldY * 20 = 600 => camWorldY = (600 - 300) / 20 = 15
    s.camWorldY = 15;

    renderGround(800, 600);

    // groundScreenY = 600 which is >= h (600) so it should skip drawing
    expect(mockGfx.clear).toHaveBeenCalled();
    expect(mockGfx.rect).not.toHaveBeenCalled();
  });
});

describe('renderBiomeLabel', () => {
  beforeEach(() => {
    resetFlightRenderState();
    vi.mocked(getBiome).mockReset();
    vi.mocked(getBiomeTransition).mockReset();
  });

  it('does nothing when biomeLabelContainer is null', () => {
    vi.mocked(getBiome).mockReturnValue(null);
    renderBiomeLabel(1000, 800, 600, 0.016);
    // Should not throw
  });

  it('returns early when getBiome returns null', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    vi.mocked(getBiome).mockReturnValue(null);
    vi.mocked(getBiomeTransition).mockReturnValue(null);

    renderBiomeLabel(1000, 800, 600, 0.016, 'EARTH');

    expect(mockContainer.children.length).toBe(0);
  });

  it('renders biome label when biome is found', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    s.biomeLabelAlpha = 1.0;

    vi.mocked(getBiome).mockReturnValue({
      id: 'troposphere',
      name: 'Troposphere',
      min: 0,
      max: 12000,
      scienceMultiplier: 1.0,
    });
    vi.mocked(getBiomeTransition).mockReturnValue(null);

    renderBiomeLabel(5000, 800, 600, 0.016, 'EARTH');

    // Should add two children (label + sublabel)
    expect(mockContainer.children.length).toBe(2);
  });

  it('resets alpha to 0 when biome name changes', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    s.currentBiomeName = 'Old Biome';
    s.biomeLabelAlpha = 1.0;

    vi.mocked(getBiome).mockReturnValue({
      id: 'stratosphere',
      name: 'Stratosphere',
      min: 12000,
      max: 50000,
      scienceMultiplier: 1.5,
    });
    vi.mocked(getBiomeTransition).mockReturnValue(null);

    renderBiomeLabel(20000, 800, 600, 0.016, 'EARTH');

    // Alpha was reset to 0 because name changed, then incremented slightly
    expect(s.currentBiomeName).toBe('Stratosphere');
    // With dt=0.016 and BIOME_LABEL_FADE_SPEED=3, alpha increases by 0.048
    expect(s.biomeLabelAlpha).toBeCloseTo(BIOME_LABEL_FADE_SPEED * 0.016, 3);
  });

  it('uses transition.from name when ratio < 0.5', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    s.biomeLabelAlpha = 1.0;
    s.currentBiomeName = 'Lower Atmosphere';

    vi.mocked(getBiome).mockReturnValue({
      id: 'lower-atmo',
      name: 'Lower Atmosphere',
      min: 0,
      max: 12000,
      scienceMultiplier: 1.0,
    });
    vi.mocked(getBiomeTransition).mockReturnValue({
      ratio: 0.3,
      from: { id: 'lower-atmo', name: 'Lower Atmosphere', min: 0, max: 12000, scienceMultiplier: 1.0 },
      to: { id: 'upper-atmo', name: 'Upper Atmosphere', min: 12000, max: 50000, scienceMultiplier: 1.5 },
    });

    renderBiomeLabel(11950, 800, 600, 0.016, 'EARTH');

    // Should use the 'from' biome name
    expect(s.currentBiomeName).toBe('Lower Atmosphere');
  });

  it('uses transition.to name when ratio >= 0.5', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    s.biomeLabelAlpha = 0.5;
    s.currentBiomeName = 'Lower Atmosphere';

    vi.mocked(getBiome).mockReturnValue({
      id: 'lower-atmo',
      name: 'Lower Atmosphere',
      min: 0,
      max: 12000,
      scienceMultiplier: 1.0,
    });
    vi.mocked(getBiomeTransition).mockReturnValue({
      ratio: 0.7,
      from: { id: 'lower-atmo', name: 'Lower Atmosphere', min: 0, max: 12000, scienceMultiplier: 1.0 },
      to: { id: 'upper-atmo', name: 'Upper Atmosphere', min: 12000, max: 50000, scienceMultiplier: 1.5 },
    });

    renderBiomeLabel(12050, 800, 600, 0.016, 'EARTH');

    // Name changes to 'to' biome, alpha resets to 0
    expect(s.currentBiomeName).toBe('Upper Atmosphere');
  });

  it('returns early when biomeLabelAlpha drops below 0.01', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    s.biomeLabelAlpha = 0;
    s.currentBiomeName = null;

    vi.mocked(getBiome).mockReturnValue({
      id: 'troposphere',
      name: 'Troposphere',
      min: 0,
      max: 12000,
      scienceMultiplier: 1.0,
    });
    vi.mocked(getBiomeTransition).mockReturnValue(null);

    // With dt=0 the alpha stays at 0 and the function returns early
    renderBiomeLabel(5000, 800, 600, 0, 'EARTH');

    expect(mockContainer.children.length).toBe(0);
  });

  it('fades alpha down when biomeLabelAlpha exceeds targetAlpha', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    s.biomeLabelAlpha = 1.0;
    s.currentBiomeName = 'Lower Atmosphere';

    vi.mocked(getBiome).mockReturnValue({
      id: 'lower-atmo',
      name: 'Lower Atmosphere',
      min: 0,
      max: 12000,
      scienceMultiplier: 1.0,
    });
    // Transition with low ratio means targetAlpha < 1.0
    vi.mocked(getBiomeTransition).mockReturnValue({
      ratio: 0.4,
      from: { id: 'lower-atmo', name: 'Lower Atmosphere', min: 0, max: 12000, scienceMultiplier: 1.0 },
      to: { id: 'upper-atmo', name: 'Upper Atmosphere', min: 12000, max: 50000, scienceMultiplier: 1.5 },
    });

    renderBiomeLabel(11980, 800, 600, 0.1, 'EARTH');

    // targetAlpha = 1.0 - (0.4 / 0.5) = 0.2, current was 1.0, so it should have decreased
    expect(s.biomeLabelAlpha).toBeLessThan(1.0);
  });

  it('defaults bodyId to EARTH when not provided', () => {
    const s = getFlightRenderState();
    const mockContainer = new MockContainer();
    s.biomeLabelContainer = mockContainer as unknown as import('pixi.js').Container;
    s.biomeLabelAlpha = 1.0;

    vi.mocked(getBiome).mockReturnValue({
      id: 'troposphere',
      name: 'Troposphere',
      min: 0,
      max: 12000,
      scienceMultiplier: 1.0,
    });
    vi.mocked(getBiomeTransition).mockReturnValue(null);

    // Call without bodyId
    renderBiomeLabel(5000, 800, 600, 0.016);

    // getBiome should have been called with 'EARTH'
    expect(vi.mocked(getBiome)).toHaveBeenCalledWith(5000, 'EARTH');
  });
});
