// @ts-nocheck
/**
 * ui-mapView.test.ts — Unit tests for the map view UI controller.
 *
 * Tests toggleMapView, applyMapThrust, handleRenameAsteroid early-returns
 * from src/ui/flightController/_mapView.ts.
 *
 * The test environment is Node (no DOM), so DOM-heavy functions
 * (buildMapHud, updateMapHud) are not tested here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pixi.js (needed transitively by render modules)
// ---------------------------------------------------------------------------

vi.mock('pixi.js', () => ({
  Graphics: class {},
  Text: class { constructor() {} },
  TextStyle: class {},
  Container: class {
    visible = true;
    children = [];
    addChild(c) { this.children.push(c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
    destroy() {}
  },
  Application: class { stage = { addChild: vi.fn(), removeChild: vi.fn() }; },
}));

// Mock render/flight.ts
vi.mock('../render/flight.ts', () => ({
  hideFlightScene: vi.fn(),
  showFlightScene: vi.fn(),
  setFlightInputEnabled: vi.fn(),
}));

// Mock render/map.ts
const _mapMock = vi.hoisted(() => {
  let _target = null;
  return {
    _setTarget: (t) => { _target = t; },
    showMapScene: vi.fn(),
    hideMapScene: vi.fn(),
    getMapZoomLevel: vi.fn(() => 'ORBIT_DETAIL'),
    setMapZoomLevel: vi.fn(),
    getMapTarget: vi.fn(() => _target),
    setMapTarget: vi.fn((t) => { _target = t; }),
    getSelectedTransferTarget: vi.fn(() => null),
    getSelectedAsteroid: vi.fn(() => null),
  };
});

vi.mock('../render/map.ts', () => _mapMock);

// Mock render/index.ts (transitively required)
vi.mock('../render/index.ts', () => ({
  getApp: vi.fn(),
}));

// Mock core modules
vi.mock('../core/mapView.ts', () => ({
  MapZoom: {
    ORBIT_DETAIL: 'ORBIT_DETAIL',
    LOCAL_BODY: 'LOCAL_BODY',
    CRAFT_TO_TARGET: 'CRAFT_TO_TARGET',
    SOLAR_SYSTEM: 'SOLAR_SYSTEM',
  },
  MapThrustDir: {
    PROGRADE: 'PROGRADE',
    RETROGRADE: 'RETROGRADE',
    RADIAL_IN: 'RADIAL_IN',
    RADIAL_OUT: 'RADIAL_OUT',
  },
  computeOrbitalThrustAngle: vi.fn(() => Math.PI / 2),
  isMapViewAvailable: vi.fn(() => true),
  getMapTransferTargets: vi.fn(() => []),
  getTransferProgressInfo: vi.fn(() => null),
  getAllowedMapZooms: vi.fn(() => ['ORBIT_DETAIL', 'LOCAL_BODY']),
}));

vi.mock('../core/orbit.ts', () => ({
  warpToTarget: vi.fn(() => ({ possible: false })),
  computeOrbitalElements: vi.fn(),
  circularOrbitVelocity: vi.fn(),
}));

vi.mock('../core/flightPhase.ts', () => ({
  isPlayerLocked: vi.fn(() => false),
  getPhaseLabel: vi.fn((p) => p),
}));

vi.mock('../core/satellites.ts', () => ({
  renameOrbitalObject: vi.fn(() => true),
}));

vi.mock('../ui/escapeHtml.ts', () => ({
  escapeHtml: (s) => s,
}));

// ---------------------------------------------------------------------------
// Minimal DOM stub — buildMapHud/destroyMapHud use document.createElement etc.
// Node.js test environment has no DOM.
// ---------------------------------------------------------------------------

function _stubElement() {
  const el = {
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    style: { display: '', cssText: '', setProperty() {} },
    children: [],
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
  };
  return el;
}

globalThis.document = globalThis.document || {
  createElement: () => _stubElement(),
  getElementById: () => null,
  body: _stubElement(),
};

const _notifyMock = vi.hoisted(() => ({
  showPhaseNotification: vi.fn(),
}));

vi.mock('../ui/flightController/_flightPhase.ts', () => _notifyMock);

vi.mock('../ui/flightController/_workerBridge.ts', () => ({
  resyncWorkerState: vi.fn(() => Promise.resolve()),
}));

import {
  getFCState,
  resetFCState,
  setPhysicsState,
  setFlightState,
  getFlightState,
} from '../ui/flightController/_state.ts';
import {
  toggleMapView,
  applyMapThrust,
  handleRenameAsteroid,
  handleWarpToTarget,
} from '../ui/flightController/_mapView.ts';
import { showPhaseNotification } from '../ui/flightController/_flightPhase.ts';
import { isPlayerLocked } from '../core/flightPhase.ts';
import { isMapViewAvailable } from '../core/mapView.ts';
import { computeOrbitalThrustAngle } from '../core/mapView.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUpFCState(overrides = {}) {
  resetFCState();
  const s = getFCState();
  s.state = { orbitalObjects: [], facilities: {} };
  setPhysicsState({
    posX: 0, posY: 200_000, velX: 7800, velY: 0,
    angle: 0, throttle: 0,
  });
  setFlightState({
    phase: 'ORBIT',
    bodyId: 'EARTH',
    timeElapsed: 0,
    orbitalElements: null,
    events: [],
    transferState: null,
  });
  Object.assign(s, overrides);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toggleMapView', () => {
  beforeEach(() => {
    setUpFCState();
    vi.clearAllMocks();
  });

  it('activates map view on first toggle', () => {
    const s = getFCState();
    expect(s.mapActive).toBe(false);
    toggleMapView();
    expect(s.mapActive).toBe(true);
  });

  it('@smoke deactivates map view on second toggle', () => {
    const s = getFCState();
    toggleMapView();
    expect(s.mapActive).toBe(true);
    toggleMapView();
    expect(s.mapActive).toBe(false);
  });

  it('returns early when physics state is null', () => {
    setPhysicsState(null);
    const s = getFCState();
    toggleMapView();
    expect(s.mapActive).toBe(false);
  });

  it('returns early when flight state is null', () => {
    setFlightState(null);
    const s = getFCState();
    toggleMapView();
    expect(s.mapActive).toBe(false);
  });

  it('shows notification when locked during TRANSFER', () => {
    vi.mocked(isPlayerLocked).mockReturnValueOnce(true);
    const s = getFCState();
    s.mapActive = true;
    toggleMapView();
    expect(showPhaseNotification).toHaveBeenCalled();
    // Should remain active since toggle was blocked.
    expect(s.mapActive).toBe(true);
  });

  it('shows notification when tracking station unavailable', () => {
    vi.mocked(isMapViewAvailable).mockReturnValueOnce(false);
    const s = getFCState();
    toggleMapView();
    expect(showPhaseNotification).toHaveBeenCalledWith('Tracking Station required');
    expect(s.mapActive).toBe(false);
  });

  it('cuts map thrust on deactivation', () => {
    const s = getFCState();
    const ps = { posX: 0, posY: 200_000, velX: 7800, velY: 0, angle: 0, throttle: 1 };
    setPhysicsState(ps);

    s.mapActive = true;
    s.mapThrusting = true;
    toggleMapView();
    expect(ps.throttle).toBe(0);
    expect(s.mapThrusting).toBe(false);
  });
});

describe('applyMapThrust', () => {
  beforeEach(() => {
    setUpFCState({ mapActive: true });
    vi.clearAllMocks();
  });

  it('does nothing when map is not active', () => {
    const s = getFCState();
    s.mapActive = false;
    applyMapThrust();
    expect(s.mapThrusting).toBe(false);
  });

  it('sets prograde direction when W is held', () => {
    const s = getFCState();
    s.mapHeldKeys.add('w');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
    expect(computeOrbitalThrustAngle).toHaveBeenCalled();
  });

  it('sets retrograde direction when S is held', () => {
    const s = getFCState();
    s.mapHeldKeys.add('s');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
  });

  it('sets radial_in direction when A is held', () => {
    const s = getFCState();
    s.mapHeldKeys.add('a');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
  });

  it('sets radial_out direction when D is held', () => {
    const s = getFCState();
    s.mapHeldKeys.add('d');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
  });

  it('W key takes priority over S key', () => {
    const s = getFCState();
    s.mapHeldKeys.add('w');
    s.mapHeldKeys.add('s');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
    // The first matching key is 'w' (prograde), so that's the direction used.
    expect(computeOrbitalThrustAngle).toHaveBeenCalled();
  });

  it('cuts thrust when no keys are held after thrusting', () => {
    const s = getFCState();
    const ps = { posX: 0, posY: 200_000, velX: 7800, velY: 0, angle: 0, throttle: 1 };
    setPhysicsState(ps);
    s.mapThrusting = true;
    applyMapThrust();
    expect(ps.throttle).toBe(0);
    expect(s.mapThrusting).toBe(false);
  });

  it('does nothing in LAUNCH phase', () => {
    const s = getFCState();
    setFlightState({
      phase: 'LAUNCH', bodyId: 'EARTH', timeElapsed: 0,
      orbitalElements: null, events: [], transferState: null,
    });
    s.mapHeldKeys.add('w');
    applyMapThrust();
    expect(s.mapThrusting).toBe(false);
  });

  it('cuts thrust in non-orbital phase if was thrusting', () => {
    const s = getFCState();
    const ps = { posX: 0, posY: 200_000, velX: 7800, velY: 0, angle: 0, throttle: 1 };
    setPhysicsState(ps);
    s.mapThrusting = true;
    setFlightState({
      phase: 'LAUNCH', bodyId: 'EARTH', timeElapsed: 0,
      orbitalElements: null, events: [], transferState: null,
    });
    applyMapThrust();
    expect(ps.throttle).toBe(0);
    expect(s.mapThrusting).toBe(false);
  });

  it('allows thrust in MANOEUVRE phase', () => {
    const s = getFCState();
    setFlightState({
      phase: 'MANOEUVRE', bodyId: 'EARTH', timeElapsed: 0,
      orbitalElements: null, events: [], transferState: null,
    });
    s.mapHeldKeys.add('w');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
  });

  it('allows thrust in TRANSFER phase', () => {
    const s = getFCState();
    setFlightState({
      phase: 'TRANSFER', bodyId: 'EARTH', timeElapsed: 0,
      orbitalElements: null, events: [], transferState: null,
    });
    s.mapHeldKeys.add('w');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
  });

  it('allows thrust in CAPTURE phase', () => {
    const s = getFCState();
    setFlightState({
      phase: 'CAPTURE', bodyId: 'EARTH', timeElapsed: 0,
      orbitalElements: null, events: [], transferState: null,
    });
    s.mapHeldKeys.add('w');
    applyMapThrust();
    expect(s.mapThrusting).toBe(true);
  });
});

describe('handleRenameAsteroid', () => {
  beforeEach(() => {
    setUpFCState();
    vi.clearAllMocks();
  });

  it('shows notification when no target is selected', () => {
    handleRenameAsteroid();
    expect(showPhaseNotification).toHaveBeenCalledWith('No target selected');
  });

  it('returns early when state is null', () => {
    const s = getFCState();
    s.state = null;
    expect(() => handleRenameAsteroid()).not.toThrow();
    expect(showPhaseNotification).not.toHaveBeenCalled();
  });
});

describe('handleWarpToTarget', () => {
  beforeEach(() => {
    setUpFCState();
    vi.clearAllMocks();
  });

  it('returns early when flightState is null', () => {
    setFlightState(null);
    expect(() => handleWarpToTarget()).not.toThrow();
  });

  it('shows notification when no target is selected', () => {
    // Provide orbitalElements so handleWarpToTarget doesn't early-return.
    const fs = getFlightState();
    fs.orbitalElements = { sma: 6771000, ecc: 0, inc: 0, argPe: 0, lan: 0, trueAnomaly: 0 };
    _mapMock._setTarget(null);
    handleWarpToTarget();
    expect(showPhaseNotification).toHaveBeenCalledWith(
      expect.stringContaining('No target'),
    );
  });

  it('shows notification when target not found in orbital objects', () => {
    const fs = getFlightState();
    fs.orbitalElements = { sma: 6771000, ecc: 0, inc: 0, argPe: 0, lan: 0, trueAnomaly: 0 };
    _mapMock._setTarget('nonexistent');
    handleWarpToTarget();
    expect(showPhaseNotification).toHaveBeenCalledWith('Target not found');
  });
});
