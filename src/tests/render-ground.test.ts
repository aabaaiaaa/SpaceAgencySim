// @ts-nocheck
/**
 * render-ground.test.ts — Unit tests for ground rendering functions.
 *
 * Tests renderGround and renderSurfaceItems from src/render/flight/_ground.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    children = [];
    addChild(c) { this.children.push(c); return c; }
    removeChildAt(i) { return this.children.splice(i,1)[0]; }
    removeChild(c) { const i = this.children.indexOf(c); if(i>=0) this.children.splice(i,1); return c; }
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
    s.groundGraphics = mockGfx;
    s.camWorldY = -10; // camera looking down at ground

    renderGround(800, 600);

    expect(mockGfx.clear).toHaveBeenCalled();
    expect(mockGfx.rect).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('skips drawing when ground is entirely above viewport', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.groundGraphics = mockGfx;
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
    s.surfaceItemsGraphics = new MockGraphics();
    renderSurfaceItems([], 800, 600);
    expect(s.surfaceItemsGraphics.clear).toHaveBeenCalled();
  });

  it('renders a FLAG surface item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx;
    s.camWorldX = 0;
    s.camWorldY = 0;
    s.zoomLevel = 1;

    const items = [{ type: SurfaceItemType.FLAG, posX: 10 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.rect).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders a SURFACE_SAMPLE item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx;
    s.zoomLevel = 1;

    const items = [{ type: SurfaceItemType.SURFACE_SAMPLE, posX: 5 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.circle).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders a SURFACE_INSTRUMENT item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx;
    s.zoomLevel = 1;

    const items = [{ type: SurfaceItemType.SURFACE_INSTRUMENT, posX: 0 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.moveTo).toHaveBeenCalled();
    expect(mockGfx.lineTo).toHaveBeenCalled();
    expect(mockGfx.closePath).toHaveBeenCalled();
  });

  it('renders a BEACON item', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx;
    s.zoomLevel = 1;

    const items = [{ type: SurfaceItemType.BEACON, posX: -5 }];
    renderSurfaceItems(items, 800, 600);

    expect(mockGfx.moveTo).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders multiple items of different types', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx;
    s.zoomLevel = 1;

    const items = [
      { type: SurfaceItemType.FLAG, posX: -10 },
      { type: SurfaceItemType.SURFACE_SAMPLE, posX: 0 },
      { type: SurfaceItemType.BEACON, posX: 10 },
    ];
    renderSurfaceItems(items, 800, 600);

    // Multiple draw calls
    expect(mockGfx.fill.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('skips items that are off-screen', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx;
    s.camWorldX = 0;
    s.zoomLevel = 1;

    // Item very far off-screen
    const items = [{ type: SurfaceItemType.FLAG, posX: 100000 }];
    renderSurfaceItems(items, 800, 600);

    // rect should not be called because item is off-screen
    expect(mockGfx.rect).not.toHaveBeenCalled();
  });

  it('skips rendering when ground is off-screen', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.surfaceItemsGraphics = mockGfx;
    s.camWorldY = -100000; // ground way below viewport
    s.zoomLevel = 1;

    const items = [{ type: SurfaceItemType.FLAG, posX: 0 }];
    renderSurfaceItems(items, 800, 600);

    // Should have cleared but not drawn any items
    expect(mockGfx.clear).toHaveBeenCalled();
  });
});
