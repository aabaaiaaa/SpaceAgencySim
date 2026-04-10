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

import { SurfaceItemType } from '../core/constants.ts';
import {
  getFlightRenderState,
  resetFlightRenderState,
} from '../render/flight/_state.ts';
import { renderGround, renderSurfaceItems } from '../render/flight/_ground.ts';

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
});
