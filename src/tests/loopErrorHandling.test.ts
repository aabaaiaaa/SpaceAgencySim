// @ts-nocheck
/**
 * loopErrorHandling.test.js — Unit tests for the flight controller loop's
 * error handling: try-catch around the simulation body, consecutive error
 * counter, and abort banner trigger.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock functions — available inside vi.mock() factories.
// ---------------------------------------------------------------------------

const { mockTick, mockAbort } = vi.hoisted(() => ({
  mockTick: vi.fn(),
  mockAbort: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock every dependency imported by _loop.js so we can run in Node without
// PixiJS / DOM renderer / full game state.
// ---------------------------------------------------------------------------

vi.mock('../core/physics.js', () => ({ tick: mockTick }));
vi.mock('../core/missions.js', () => ({ checkObjectiveCompletion: vi.fn() }));
vi.mock('../core/contracts.js', () => ({ checkContractObjectives: vi.fn() }));
vi.mock('../core/challenges.js', () => ({ checkChallengeObjectives: vi.fn() }));
vi.mock('../render/flight.js', () => ({ renderFlightFrame: vi.fn() }));
vi.mock('../render/map.js', () => ({ renderMapFrame: vi.fn() }));
vi.mock('../core/mapView.js', () => ({ isDebrisTrackingAvailable: vi.fn(() => false) }));
vi.mock('../core/surfaceOps.js', () => ({ getSurfaceItemsAtBody: vi.fn(() => []) }));
vi.mock('../core/comms.js', () => ({
  evaluateComms: vi.fn(() => ({ controlLocked: false })),
}));
vi.mock('../core/constants.js', () => ({
  FlightPhase: {
    PRELAUNCH: 'PRELAUNCH', LAUNCH: 'LAUNCH', FLIGHT: 'FLIGHT',
    ORBIT: 'ORBIT', MANOEUVRE: 'MANOEUVRE', TRANSFER: 'TRANSFER',
    CAPTURE: 'CAPTURE', LANDED: 'LANDED',
  },
  PartType: { COMMAND_MODULE: 'COMMAND_MODULE' },
}));
vi.mock('../data/parts.js', () => ({ getPartById: vi.fn() }));

vi.mock('../ui/flightController/_timeWarp.js', () => ({
  checkTimeWarpResets: vi.fn(),
  applyTimeWarp: vi.fn(),
}));
vi.mock('../ui/flightController/_mapView.js', () => ({
  applyMapThrust: vi.fn(),
  updateMapHud: vi.fn(),
}));
vi.mock('../ui/flightController/_orbitRcs.js', () => ({
  applyNormalOrbitRcs: vi.fn(),
}));
vi.mock('../ui/flightController/_flightPhase.js', () => ({
  evaluateFlightPhase: vi.fn(),
}));
vi.mock('../ui/flightController/_docking.js', () => ({
  tickDockingSystem: vi.fn(),
  updateDockingHud: vi.fn(),
}));
vi.mock('../ui/flightController/_postFlight.js', () => ({
  showPostFlightSummary: vi.fn(),
}));
vi.mock('../ui/flightController/_menuActions.js', () => ({
  handleAbortReturnToAgency: mockAbort,
}));

// Mock the logger so we can verify error logging without console.error.
const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));
vi.mock('../core/logger.ts', () => ({
  logger: { error: mockLoggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mocks for modules added during the iteration 5 refactor.
vi.mock('../ui/fpsMonitor.ts', () => ({ recordFrame: vi.fn() }));
vi.mock('../core/perfMonitor.ts', () => ({
  beginFrame: vi.fn(),
  endFrame: vi.fn(),
}));
vi.mock('../ui/flightController/_workerBridge.ts', () => ({
  isWorkerReady: vi.fn(() => false),
  hasWorkerError: vi.fn(() => false),
  consumeMainThreadSnapshot: vi.fn(() => null),
  sendTick: vi.fn(),
  sendThrottle: vi.fn(),
  sendAngle: vi.fn(),
  terminatePhysicsWorker: vi.fn(),
}));
vi.mock('../core/snapshotFactory.ts', () => ({
  createSnapshotFromState: vi.fn(),
}));
vi.mock('../core/flightPhase.ts', () => ({
  getPhaseLabel: vi.fn(() => ''),
}));
vi.mock('../core/orbit.ts', () => ({
  getOrbitEntryLabel: vi.fn(() => ''),
  checkOrbitStatus: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are declared (vitest hoists
// vi.mock calls, but this makes the intent clear).
// ---------------------------------------------------------------------------

import { loop, MAX_CONSECUTIVE_LOOP_ERRORS } from '../ui/flightController/_loop.ts';
import { getFCState, setFCState, resetFCState, setPhysicsState, setFlightState } from '../ui/flightController/_state.ts';

// ---------------------------------------------------------------------------
// Minimal DOM stubs (the test environment is Node, not jsdom).
// ---------------------------------------------------------------------------

function createMockElement() {
  const el = {
    style: { cssText: '' },
    textContent: '',
    dataset: {},
    children: [],
    appendChild(child) { el.children.push(child); return child; },
    remove: vi.fn(),
    addEventListener: vi.fn(),
  };
  return el;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal flight-controller state that satisfies the loop guard. */
function seedFCState(overrides = {}) {
  setPhysicsState({
    posX: 0, posY: 0, velX: 0, velY: 0,
    throttle: 0, grounded: true, landed: false, crashed: false,
    firingEngines: new Set(), activeParts: new Set(),
    surfaceAltitude: 0,
  });
  setFlightState({ phase: 'FLIGHT', bodyId: 'EARTH', scienceModuleRunning: false });
  const defaults = {
    assembly: { parts: new Map() },
    stagingConfig: { stages: [] },
    state: { missions: [], contracts: [], challenges: [] },
    container: createMockElement(),
    rafId: 1,
    lastTs: 0,
    mapActive: false,
    timeWarp: 1,
    summaryShown: false,
    loopConsecutiveErrors: 0,
    loopErrorBanner: null,
  };
  setFCState({ ...defaults, ...overrides });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetFCState();
  setPhysicsState(null);
  setFlightState(null);
  mockTick.mockReset();
  mockAbort.mockReset();
  mockLoggerError.mockReset();

  vi.stubGlobal('document', {
    createElement: () => createMockElement(),
    body: createMockElement(),
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Flight controller loop error handling', () => {
  it('exports the consecutive error threshold', () => {
    expect(MAX_CONSECUTIVE_LOOP_ERRORS).toBe(5);
  });

  it('catches a tick() error and increments the consecutive error counter', () => {
    seedFCState();
    mockTick.mockImplementation(() => { throw new Error('NaN in physics'); });

    loop(16.67);

    const s = getFCState();
    expect(s.loopConsecutiveErrors).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError.mock.calls[0][0]).toBe('flightLoop');
  });

  it('resets the error counter on a successful frame after an error', () => {
    seedFCState({ loopConsecutiveErrors: 3 });

    // tick succeeds (default mock does nothing).
    mockTick.mockImplementation(() => {});
    loop(16.67);

    expect(getFCState().loopConsecutiveErrors).toBe(0);
  });

  it('does NOT show the abort banner for fewer than 5 consecutive errors', () => {
    seedFCState();
    mockTick.mockImplementation(() => { throw new Error('boom'); });

    for (let i = 0; i < MAX_CONSECUTIVE_LOOP_ERRORS - 1; i++) {
      loop(16.67 * (i + 1));
    }

    const s = getFCState();
    expect(s.loopConsecutiveErrors).toBe(MAX_CONSECUTIVE_LOOP_ERRORS - 1);
    expect(s.loopErrorBanner).toBeNull();
  });

  it('shows the abort banner after 5 consecutive errors', () => {
    seedFCState();
    mockTick.mockImplementation(() => { throw new Error('boom'); });

    for (let i = 0; i < MAX_CONSECUTIVE_LOOP_ERRORS; i++) {
      loop(16.67 * (i + 1));
    }

    const s = getFCState();
    expect(s.loopConsecutiveErrors).toBe(MAX_CONSECUTIVE_LOOP_ERRORS);
    expect(s.loopErrorBanner).not.toBeNull();
  });

  it('does not create a second banner if one already exists', () => {
    seedFCState();
    mockTick.mockImplementation(() => { throw new Error('boom'); });

    // Trigger banner creation.
    for (let i = 0; i < MAX_CONSECUTIVE_LOOP_ERRORS + 2; i++) {
      loop(16.67 * (i + 1));
    }

    const s = getFCState();
    // The container's appendChild should have been called only once for
    // the banner (once at error #5), not again at #6 or #7.
    const container = s.container;
    const bannerAppends = container.children.filter(
      (c) => c.dataset && c.dataset.testid === 'loop-error-banner',
    );
    expect(bannerAppends.length).toBe(1);
  });

  it('allows recovery after intermittent (non-consecutive) errors', () => {
    seedFCState();
    let callCount = 0;
    mockTick.mockImplementation(() => {
      callCount++;
      // Fail on odd calls, succeed on even calls.
      if (callCount % 2 === 1) throw new Error('intermittent');
    });

    // Run 10 frames: error, success, error, success, ...
    for (let i = 0; i < 10; i++) {
      loop(16.67 * (i + 1));
    }

    const s = getFCState();
    // After an even frame (successful), counter should be 0.
    // After an odd frame (error), counter should be 1 (never accumulates past 1).
    // The last frame (i=9, callCount=10) is even → success.
    expect(s.loopConsecutiveErrors).toBe(0);
    expect(s.loopErrorBanner).toBeNull();
  });

  it('reschedules rAF even after an error', () => {
    seedFCState();
    mockTick.mockImplementation(() => { throw new Error('crash'); });

    loop(16.67);

    expect(requestAnimationFrame).toHaveBeenCalledWith(loop);
  });

  it('does not reschedule rAF when rafId is null (loop cancelled)', () => {
    seedFCState({ rafId: null });
    mockTick.mockImplementation(() => { throw new Error('crash'); });

    loop(16.67);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
