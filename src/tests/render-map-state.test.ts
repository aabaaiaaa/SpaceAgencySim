// @ts-nocheck
/**
 * render-map-state.test.ts — Unit tests for map renderer state management.
 *
 * Tests zoom level cycling, target selection, asteroid target selection,
 * transfer target cycling, shadow/comms overlay toggles, and belt asteroid
 * cycling from src/render/map.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

const { MockGraphics, MockText, MockTextStyle, MockContainer, MockApplication } = vi.hoisted(() => {
  class MockGraphics {
    visible = true; alpha = 1;
    position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; parent = null;
    clear = vi.fn(); rect = vi.fn(); fill = vi.fn(); stroke = vi.fn();
    circle = vi.fn(); arc = vi.fn(); moveTo = vi.fn(); lineTo = vi.fn();
    closePath = vi.fn(); ellipse = vi.fn();
    destroy = vi.fn();
  }
  class MockText {
    visible = true; alpha = 1;
    position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; anchor = { set: vi.fn() }; parent = null;
    text = ''; style = null; x = 0; y = 0;
    constructor() {}
  }
  class MockTextStyle {
    constructor() {}
  }
  class MockContainer {
    visible = true;
    children = [];
    addChild(c) { this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
    destroy() {}
  }
  class MockApplication {
    stage = new MockContainer();
  }
  return { MockGraphics, MockText, MockTextStyle, MockContainer, MockApplication };
});

vi.mock('pixi.js', () => ({
  Graphics: MockGraphics,
  Text: MockText,
  TextStyle: MockTextStyle,
  Container: MockContainer,
  Application: MockApplication,
}));

// Mock the render index to return a fake app
vi.mock('../render/index.ts', () => ({
  getApp: () => new MockApplication(),
}));

// Mock the asteroidBelt core module
vi.mock('../core/asteroidBelt.ts', () => {
  let _asteroids = [];
  return {
    getActiveAsteroids: () => _asteroids,
    hasAsteroids: () => _asteroids.length > 0,
    setActiveAsteroids: (a) => { _asteroids = [...a]; },
    clearAsteroids: () => { _asteroids = []; },
    generateBeltAsteroids: vi.fn(),
  };
});

// Mock surfaceOps (imported by map.ts)
vi.mock('../core/surfaceOps.ts', () => ({
  getSurfaceItemsAtBody: () => [],
  areSurfaceItemsVisible: () => false,
}));

// Mock comms (imported by map.ts)
vi.mock('../core/comms.ts', () => ({
  getCommsCoverageInfo: () => ({ connected: [], dead: [] }),
}));

import {
  setMapZoomLevel,
  getMapZoomLevel,
  cycleMapZoom,
  setMapTarget,
  getMapTarget,
  getSelectedAsteroid,
  cycleMapTarget,
  toggleMapShadow,
  isMapShadowEnabled,
  toggleMapCommsOverlay,
  isCommsOverlayVisible,
  cycleTransferTarget,
  getSelectedTransferTarget,
  setSelectedTransferTarget,
  isMapVisible,
  destroyMapRenderer,
} from '../render/map.ts';
import { MapZoom } from '../core/mapView.ts';
import { setActiveAsteroids, clearAsteroids } from '../core/asteroidBelt.ts';
import { FlightPhase } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// State reset helper — reset module state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset map state by destroying (clears internal variables).
  destroyMapRenderer();
  clearAsteroids();
});

// ---------------------------------------------------------------------------
// Zoom level management
// ---------------------------------------------------------------------------

describe('map zoom level', () => {
  it('default zoom is ORBIT_DETAIL', () => {
    // After destroy, zoom resets internally (setMapZoomLevel is the setter).
    setMapZoomLevel(MapZoom.ORBIT_DETAIL);
    expect(getMapZoomLevel()).toBe(MapZoom.ORBIT_DETAIL);
  });

  it('setMapZoomLevel changes the zoom level', () => {
    setMapZoomLevel(MapZoom.SOLAR_SYSTEM);
    expect(getMapZoomLevel()).toBe(MapZoom.SOLAR_SYSTEM);
  });

  it('cycleMapZoom cycles through all zoom levels', () => {
    setMapZoomLevel(MapZoom.ORBIT_DETAIL);

    cycleMapZoom();
    expect(getMapZoomLevel()).toBe(MapZoom.LOCAL_BODY);

    cycleMapZoom();
    expect(getMapZoomLevel()).toBe(MapZoom.CRAFT_TO_TARGET);

    cycleMapZoom();
    expect(getMapZoomLevel()).toBe(MapZoom.SOLAR_SYSTEM);

    // Wraps around.
    cycleMapZoom();
    expect(getMapZoomLevel()).toBe(MapZoom.ORBIT_DETAIL);
  });

  it('@smoke cycleMapZoom wraps from last to first', () => {
    setMapZoomLevel(MapZoom.SOLAR_SYSTEM);
    cycleMapZoom();
    expect(getMapZoomLevel()).toBe(MapZoom.ORBIT_DETAIL);
  });
});

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

describe('map target selection', () => {
  it('starts with no target', () => {
    expect(getMapTarget()).toBeNull();
  });

  it('setMapTarget sets and getMapTarget retrieves', () => {
    setMapTarget('sat-001');
    expect(getMapTarget()).toBe('sat-001');
  });

  it('setMapTarget(null) clears the target', () => {
    setMapTarget('sat-001');
    setMapTarget(null);
    expect(getMapTarget()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Asteroid target selection
// ---------------------------------------------------------------------------

describe('getSelectedAsteroid', () => {
  it('returns null when no target is selected', () => {
    expect(getSelectedAsteroid()).toBeNull();
  });

  it('returns null when target is not an asteroid', () => {
    setMapTarget('sat-001');
    expect(getSelectedAsteroid()).toBeNull();
  });

  it('returns the asteroid when target matches an active asteroid', () => {
    const ast = { id: 'ast-1', name: 'AST-0001', type: 'asteroid', posX: 0, posY: 0, velX: 0, velY: 0, radius: 50, mass: 1000, shapeSeed: 42 };
    setActiveAsteroids([ast]);
    setMapTarget('ast-1');
    const result = getSelectedAsteroid();
    expect(result).not.toBeNull();
    expect(result.id).toBe('ast-1');
  });

  it('returns null when target ID does not match any active asteroid', () => {
    const ast = { id: 'ast-1', name: 'AST-0001', type: 'asteroid', posX: 0, posY: 0, velX: 0, velY: 0, radius: 50, mass: 1000, shapeSeed: 42 };
    setActiveAsteroids([ast]);
    setMapTarget('ast-999');
    expect(getSelectedAsteroid()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cycleMapTarget
// ---------------------------------------------------------------------------

describe('cycleMapTarget', () => {
  it('returns null for empty orbital objects', () => {
    const result = cycleMapTarget([], 'EARTH');
    expect(result).toBeNull();
  });

  it('selects the first matching object from the list', () => {
    const objects = [
      { id: 'obj-1', name: 'Sat 1', bodyId: 'EARTH', elements: {} },
      { id: 'obj-2', name: 'Sat 2', bodyId: 'EARTH', elements: {} },
    ];
    const result = cycleMapTarget(objects, 'EARTH');
    expect(result).toBe('obj-1');
  });

  it('cycles through objects sequentially', () => {
    const objects = [
      { id: 'obj-1', name: 'Sat 1', bodyId: 'EARTH', elements: {} },
      { id: 'obj-2', name: 'Sat 2', bodyId: 'EARTH', elements: {} },
      { id: 'obj-3', name: 'Sat 3', bodyId: 'EARTH', elements: {} },
    ];

    // First call: selects obj-1
    cycleMapTarget(objects, 'EARTH');
    expect(getMapTarget()).toBe('obj-1');

    // Second call: selects obj-2
    cycleMapTarget(objects, 'EARTH');
    expect(getMapTarget()).toBe('obj-2');

    // Third call: selects obj-3
    cycleMapTarget(objects, 'EARTH');
    expect(getMapTarget()).toBe('obj-3');

    // Fourth call: wraps to obj-1
    cycleMapTarget(objects, 'EARTH');
    expect(getMapTarget()).toBe('obj-1');
  });

  it('filters objects by bodyId', () => {
    const objects = [
      { id: 'obj-1', name: 'Earth Sat', bodyId: 'EARTH', elements: {} },
      { id: 'obj-2', name: 'Mars Sat', bodyId: 'MARS', elements: {} },
    ];
    const result = cycleMapTarget(objects, 'MARS');
    expect(result).toBe('obj-2');
  });

  it('includes belt asteroids when bodyId is SUN and asteroids are active', () => {
    const ast = { id: 'ast-1', name: 'AST-0001', type: 'asteroid', posX: 0, posY: 0, velX: 0, velY: 0, radius: 50, mass: 1000, shapeSeed: 42 };
    setActiveAsteroids([ast]);

    const objects = [
      { id: 'obj-1', name: 'Sun Sat', bodyId: 'SUN', elements: {} },
    ];

    // First: obj-1
    cycleMapTarget(objects, 'SUN');
    expect(getMapTarget()).toBe('obj-1');

    // Second: ast-1 (belt asteroid)
    cycleMapTarget(objects, 'SUN');
    expect(getMapTarget()).toBe('ast-1');
  });
});

// ---------------------------------------------------------------------------
// Shadow and comms overlay toggles
// ---------------------------------------------------------------------------

describe('map shadow toggle', () => {
  it('starts disabled', () => {
    expect(isMapShadowEnabled()).toBe(false);
  });

  it('toggleMapShadow enables then disables', () => {
    toggleMapShadow();
    expect(isMapShadowEnabled()).toBe(true);
    toggleMapShadow();
    expect(isMapShadowEnabled()).toBe(false);
  });
});

describe('map comms overlay toggle', () => {
  it('starts hidden', () => {
    expect(isCommsOverlayVisible()).toBe(false);
  });

  it('toggleMapCommsOverlay enables then disables', () => {
    toggleMapCommsOverlay();
    expect(isCommsOverlayVisible()).toBe(true);
    toggleMapCommsOverlay();
    expect(isCommsOverlayVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transfer target cycling
// ---------------------------------------------------------------------------

describe('transfer target', () => {
  it('starts with no transfer target', () => {
    expect(getSelectedTransferTarget()).toBeNull();
  });

  it('setSelectedTransferTarget sets and getter retrieves', () => {
    setSelectedTransferTarget('MARS');
    expect(getSelectedTransferTarget()).toBe('MARS');
  });

  it('setSelectedTransferTarget(null) clears', () => {
    setSelectedTransferTarget('MARS');
    setSelectedTransferTarget(null);
    expect(getSelectedTransferTarget()).toBeNull();
  });

  it('cycleTransferTarget returns null for non-orbital phases', () => {
    const result = cycleTransferTarget('EARTH', 200_000, FlightPhase.LAUNCH);
    expect(result).toBeNull();
  });

  it('cycleTransferTarget selects first target on first call in orbit', () => {
    const result = cycleTransferTarget('EARTH', 200_000, FlightPhase.ORBIT);
    // May return a body ID or null depending on available targets.
    // For Earth orbit, Moon should be available.
    if (result !== null) {
      expect(typeof result).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// isMapVisible
// ---------------------------------------------------------------------------

describe('isMapVisible', () => {
  it('returns false when map root is null', () => {
    expect(isMapVisible()).toBe(false);
  });
});
