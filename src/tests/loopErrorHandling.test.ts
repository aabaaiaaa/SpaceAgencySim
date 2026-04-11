import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CommsState, GameState, FlightState } from '../core/gameState.ts';
import type { PhysicsState } from '../core/physics.ts';
import type { FCState } from '../ui/flightController/_state.ts';
import type { StagingConfig } from '../core/rocketbuilder.ts';

// ---------------------------------------------------------------------------
// Hoisted mock functions — available inside vi.mock() factories.
// ---------------------------------------------------------------------------

const { mockEvaluateComms, mockAbort } = vi.hoisted(() => ({
  mockEvaluateComms: vi.fn<(...args: unknown[]) => CommsState>(() => ({ status: 'CONNECTED', linkType: 'DIRECT', canTransmit: true, controlLocked: false })),
  mockAbort: vi.fn<() => void>(),
}));

// ---------------------------------------------------------------------------
// Mock every dependency imported by _loop.ts so we can run in Node without
// PixiJS / DOM renderer / full game state.
// ---------------------------------------------------------------------------

vi.mock('../core/missions.js', () => ({ checkObjectiveCompletion: vi.fn() }));
vi.mock('../core/contracts.js', () => ({ checkContractObjectives: vi.fn() }));
vi.mock('../core/challenges.js', () => ({ checkChallengeObjectives: vi.fn() }));
vi.mock('../render/flight.js', () => ({ renderFlightFrame: vi.fn() }));
vi.mock('../render/map.js', () => ({ renderMapFrame: vi.fn() }));
vi.mock('../core/mapView.js', () => ({ isDebrisTrackingAvailable: vi.fn(() => false) }));
vi.mock('../core/surfaceOps.js', () => ({ getSurfaceItemsAtBody: vi.fn(() => []) }));
vi.mock('../core/comms.js', () => ({
  evaluateComms: mockEvaluateComms,
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
const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn<(category: string, message: string, data?: unknown) => void>(),
}));
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
  getWorkerErrorMessage: vi.fn(() => ''),
  consumeMainThreadSnapshot: vi.fn(() => null),
  sendTick: vi.fn(),
  sendThrottle: vi.fn(),
  sendAngle: vi.fn(),
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
import {
  isWorkerReady,
  hasWorkerError,
  getWorkerErrorMessage,
  consumeMainThreadSnapshot,
} from '../ui/flightController/_workerBridge.ts';
import { showPostFlightSummary } from '../ui/flightController/_postFlight.ts';
import { applyTimeWarp } from '../ui/flightController/_timeWarp.ts';

// ---------------------------------------------------------------------------
// Minimal DOM stubs (the test environment is Node, not jsdom).
// ---------------------------------------------------------------------------

interface MockElement {
  style: { cssText: string };
  textContent: string;
  dataset: Record<string, string>;
  children: MockElement[];
  className: string;
  appendChild(child: MockElement): MockElement;
  remove: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

function createMockElement(): MockElement {
  const el: MockElement = {
    style: { cssText: '' },
    textContent: '',
    dataset: {},
    children: [],
    className: '',
    appendChild(child: MockElement): MockElement { el.children.push(child); return child; },
    remove: vi.fn(),
    addEventListener: vi.fn(),
  };
  return el;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedFCState(overrides: Partial<FCState> = {}): void {
  setPhysicsState({
    posX: 0, posY: 0, velX: 0, velY: 0,
    throttle: 0, grounded: true, landed: false, crashed: false,
    firingEngines: new Set(), activeParts: new Set(),
  } as PhysicsState);
  setFlightState({ phase: 'FLIGHT', bodyId: 'EARTH', scienceModuleRunning: false } as FlightState);
  const defaults: Partial<FCState> = {
    assembly: { parts: new Map() } as FCState['assembly'],
    stagingConfig: { stages: [] } as Partial<StagingConfig> as StagingConfig,
    state: { missions: [], contracts: [], challenges: [] } as unknown as GameState,
    container: createMockElement() as unknown as HTMLElement,
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
  mockEvaluateComms.mockReset();
  mockEvaluateComms.mockReturnValue({ status: 'CONNECTED', linkType: 'DIRECT', canTransmit: true, controlLocked: false });
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

  it('catches a comms evaluation error and increments the consecutive error counter', () => {
    seedFCState();
    mockEvaluateComms.mockImplementation(() => { throw new Error('NaN in comms'); });

    loop(16.67);

    const s = getFCState();
    expect(s.loopConsecutiveErrors).toBe(1);
    expect(mockLoggerError).toHaveBeenCalledOnce();
    expect(mockLoggerError.mock.calls[0][0]).toBe('flightLoop');
  });

  it('resets the error counter on a successful frame after an error', () => {
    seedFCState({ loopConsecutiveErrors: 3 });

    // evaluateComms succeeds (default mock returns { controlLocked: false }).
    loop(16.67);

    expect(getFCState().loopConsecutiveErrors).toBe(0);
  });

  it('does NOT show the abort banner for fewer than 5 consecutive errors', () => {
    seedFCState();
    mockEvaluateComms.mockImplementation(() => { throw new Error('boom'); });

    for (let i = 0; i < MAX_CONSECUTIVE_LOOP_ERRORS - 1; i++) {
      loop(16.67 * (i + 1));
    }

    const s = getFCState();
    expect(s.loopConsecutiveErrors).toBe(MAX_CONSECUTIVE_LOOP_ERRORS - 1);
    expect(s.loopErrorBanner).toBeNull();
  });

  it('shows the abort banner after 5 consecutive errors', () => {
    seedFCState();
    mockEvaluateComms.mockImplementation(() => { throw new Error('boom'); });

    for (let i = 0; i < MAX_CONSECUTIVE_LOOP_ERRORS; i++) {
      loop(16.67 * (i + 1));
    }

    const s = getFCState();
    expect(s.loopConsecutiveErrors).toBe(MAX_CONSECUTIVE_LOOP_ERRORS);
    expect(s.loopErrorBanner).not.toBeNull();
  });

  it('does not create a second banner if one already exists', () => {
    seedFCState();
    mockEvaluateComms.mockImplementation(() => { throw new Error('boom'); });

    // Trigger banner creation.
    for (let i = 0; i < MAX_CONSECUTIVE_LOOP_ERRORS + 2; i++) {
      loop(16.67 * (i + 1));
    }

    const s = getFCState();
    // The container's appendChild should have been called only once for
    // the banner (once at error #5), not again at #6 or #7.
    const container = s.container as unknown as MockElement;
    const bannerAppends = container.children.filter(
      (c: MockElement) => c.dataset && c.dataset.testid === 'loop-error-banner',
    );
    expect(bannerAppends.length).toBe(1);
  });

  it('allows recovery after intermittent (non-consecutive) errors', () => {
    seedFCState();
    let callCount = 0;
    mockEvaluateComms.mockImplementation(() => {
      callCount++;
      // Fail on odd calls, succeed on even calls.
      if (callCount % 2 === 1) throw new Error('intermittent');
      return { status: 'CONNECTED', linkType: 'DIRECT', canTransmit: true, controlLocked: false };
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
    mockEvaluateComms.mockImplementation(() => { throw new Error('crash'); });

    loop(16.67);

    expect(requestAnimationFrame).toHaveBeenCalledWith(loop);
  });

  it('does not reschedule rAF when rafId is null (loop cancelled)', () => {
    seedFCState({ rafId: null });
    mockEvaluateComms.mockImplementation(() => { throw new Error('crash'); });

    loop(16.67);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});

describe('Flight controller loop — worker error detection', () => {
  beforeEach(() => {
    resetFCState();
    setPhysicsState(null);
    setFlightState(null);
    mockEvaluateComms.mockReset();
    mockEvaluateComms.mockReturnValue({ status: 'CONNECTED', linkType: 'DIRECT', canTransmit: true, controlLocked: false });
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

  it('shows error banner when worker has error and no banner exists', () => {
    seedFCState();
    vi.mocked(hasWorkerError).mockReturnValue(true);
    vi.mocked(getWorkerErrorMessage).mockReturnValue('Worker crashed');

    loop(16.67);

    const s = getFCState();
    expect(s.loopErrorBanner).not.toBeNull();
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('does not create duplicate banner when worker error persists', () => {
    seedFCState();
    vi.mocked(hasWorkerError).mockReturnValue(true);
    vi.mocked(getWorkerErrorMessage).mockReturnValue('Worker crashed');

    loop(16.67);
    const firstBanner = getFCState().loopErrorBanner;

    loop(33.34);
    expect(getFCState().loopErrorBanner).toBe(firstBanner);
  });
});

describe('Flight controller loop — guard early returns', () => {
  beforeEach(() => {
    resetFCState();
    setPhysicsState(null);
    setFlightState(null);
    mockEvaluateComms.mockReset();
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

  it('returns early when physics state is null', () => {
    seedFCState();
    setPhysicsState(null);

    loop(16.67);

    // evaluateComms should NOT have been called since the early return
    // occurs before that code path
    expect(mockEvaluateComms).not.toHaveBeenCalled();
  });

  it('returns early when assembly is null', () => {
    seedFCState({ assembly: null });

    loop(16.67);

    expect(mockEvaluateComms).not.toHaveBeenCalled();
  });

  it('returns early when stagingConfig is null', () => {
    seedFCState({ stagingConfig: null });

    loop(16.67);

    expect(mockEvaluateComms).not.toHaveBeenCalled();
  });

  it('returns early when flightState is null', () => {
    seedFCState();
    setFlightState(null);

    loop(16.67);

    expect(mockEvaluateComms).not.toHaveBeenCalled();
  });
});

describe('Flight controller loop — comms control lockout', () => {
  beforeEach(() => {
    resetFCState();
    setPhysicsState(null);
    setFlightState(null);
    mockEvaluateComms.mockReset();
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

  it('sets throttle to 0 when comms reports controlLocked', () => {
    seedFCState();
    const ps = {
      posX: 0, posY: 500000, velX: 7000, velY: 0,
      throttle: 0.8, grounded: false, landed: false, crashed: false,
      firingEngines: new Set<string>(), activeParts: new Set<string>(),
    } as PhysicsState;
    setPhysicsState(ps);

    mockEvaluateComms.mockReturnValue({
      status: 'NO_SIGNAL', linkType: 'NONE', canTransmit: false, controlLocked: true,
    });

    loop(16.67);

    expect(ps.throttle).toBe(0);
  });
});

describe('Flight controller loop — post-flight auto-trigger', () => {
  beforeEach(() => {
    resetFCState();
    setPhysicsState(null);
    setFlightState(null);
    mockEvaluateComms.mockReset();
    mockEvaluateComms.mockReturnValue({ status: 'CONNECTED', linkType: 'DIRECT', canTransmit: true, controlLocked: false });
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

  it('triggers post-flight summary on crash', () => {
    seedFCState({ summaryShown: false });
    const ps = {
      posX: 0, posY: 0, velX: 0, velY: 0,
      throttle: 0, grounded: false, landed: false, crashed: true,
      firingEngines: new Set<string>(), activeParts: new Set<string>(),
    } as PhysicsState;
    setPhysicsState(ps);

    loop(16.67);

    expect(getFCState().summaryShown).toBe(true);
    expect(showPostFlightSummary).toHaveBeenCalled();
  });

  it('triggers post-flight summary on safe landing', () => {
    seedFCState({ summaryShown: false });
    const ps = {
      posX: 0, posY: 0, velX: 0, velY: 0,
      throttle: 0, grounded: true, landed: true, crashed: false,
      firingEngines: new Set<string>(), activeParts: new Set<string>(),
    } as PhysicsState;
    setPhysicsState(ps);

    loop(16.67);

    expect(getFCState().summaryShown).toBe(true);
    expect(showPostFlightSummary).toHaveBeenCalled();
  });

  it('does not re-trigger summary when already shown', () => {
    seedFCState({ summaryShown: true });
    const ps = {
      posX: 0, posY: 0, velX: 0, velY: 0,
      throttle: 0, grounded: true, landed: true, crashed: false,
      firingEngines: new Set<string>(), activeParts: new Set<string>(),
    } as PhysicsState;
    setPhysicsState(ps);

    loop(16.67);

    expect(showPostFlightSummary).not.toHaveBeenCalled();
  });
});

describe('Flight controller loop — map active warp override', () => {
  beforeEach(() => {
    resetFCState();
    setPhysicsState(null);
    setFlightState(null);
    mockEvaluateComms.mockReset();
    mockEvaluateComms.mockReturnValue({ status: 'CONNECTED', linkType: 'DIRECT', canTransmit: true, controlLocked: false });
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

  it('forces warp to 1x when map is active in non-ORBIT non-TRANSFER non-CAPTURE phase', () => {
    seedFCState({ mapActive: true, timeWarp: 4 });
    setFlightState({ phase: 'FLIGHT', bodyId: 'EARTH', scienceModuleRunning: false } as FlightState);

    loop(16.67);

    expect(applyTimeWarp).toHaveBeenCalledWith(1);
  });

  it('does NOT force warp to 1x when map is active in ORBIT phase', () => {
    seedFCState({ mapActive: true, timeWarp: 4 });
    setFlightState({ phase: 'ORBIT', bodyId: 'EARTH', scienceModuleRunning: false } as FlightState);

    loop(16.67);

    expect(applyTimeWarp).not.toHaveBeenCalledWith(1);
  });

  it('does NOT force warp to 1x when map is active in TRANSFER phase', () => {
    seedFCState({ mapActive: true, timeWarp: 4 });
    setFlightState({ phase: 'TRANSFER', bodyId: 'EARTH', scienceModuleRunning: false } as FlightState);

    loop(16.67);

    expect(applyTimeWarp).not.toHaveBeenCalledWith(1);
  });

  it('does NOT force warp to 1x when map is active in CAPTURE phase', () => {
    seedFCState({ mapActive: true, timeWarp: 4 });
    setFlightState({ phase: 'CAPTURE', bodyId: 'EARTH', scienceModuleRunning: false } as FlightState);

    loop(16.67);

    expect(applyTimeWarp).not.toHaveBeenCalledWith(1);
  });

  it('does not force warp when already at 1x', () => {
    seedFCState({ mapActive: true, timeWarp: 1 });
    setFlightState({ phase: 'FLIGHT', bodyId: 'EARTH', scienceModuleRunning: false } as FlightState);

    loop(16.67);

    // applyTimeWarp should NOT be called since we're already at 1x
    expect(applyTimeWarp).not.toHaveBeenCalled();
  });
});
