/**
 * workerBridgeTimeout.test.ts — Unit tests for the Web Worker ready timeout
 * in _workerBridge.ts.
 *
 * Tests that initPhysicsWorker() rejects after 10s when the worker never sends
 * 'ready', and that the timeout is cleared when 'ready' arrives in time.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PhysicsState } from '../core/physics.ts';
import type { FlightState } from '../core/gameState.ts';
import type { RocketAssembly, StagingConfig } from '../core/rocketbuilder.ts';

// ---------------------------------------------------------------------------
// Mock the logger so warn/error calls don't throw
// ---------------------------------------------------------------------------
vi.mock('../core/logger.ts', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock perfMonitor to avoid side effects
vi.mock('../core/perfMonitor.ts', () => ({
  recordWorkerSend: vi.fn(),
  recordWorkerReceive: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Minimal mock Worker class
// ---------------------------------------------------------------------------

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  _postMessageCalls: unknown[] = [];

  postMessage(data: unknown): void {
    this._postMessageCalls.push(data);
  }

  terminate(): void {
    // no-op
  }

  /** Simulate the worker sending a message back to the main thread. */
  _simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }

  /** Simulate the worker firing an error. */
  _simulateError(message: string): void {
    if (this.onerror) {
      this.onerror({ message } as ErrorEvent);
    }
  }
}

// ---------------------------------------------------------------------------
// Capture the Worker constructor so we can intercept new Worker() calls
// ---------------------------------------------------------------------------

let latestMockWorker: MockWorker | null = null;

// Stub the global Worker constructor
const _OriginalWorker = globalThis.Worker;

function installWorkerStub(): void {
  latestMockWorker = null;
  (globalThis as unknown as { Worker: unknown }).Worker = function MockWorkerConstructor() {
    const w = new MockWorker();
    latestMockWorker = w;
    return w;
  } as unknown as typeof Worker;
}

function restoreWorkerStub(): void {
  if (_OriginalWorker) {
    globalThis.Worker = _OriginalWorker;
  } else {
    delete (globalThis as Record<string, unknown>).Worker;
  }
}

// ---------------------------------------------------------------------------
// Minimal state factories (just enough to pass serialisation)
// ---------------------------------------------------------------------------

function makeMinimalPhysicsState(): PhysicsState {
  return {
    posX: 0, posY: 0, velX: 0, velY: 0,
    angle: 0, throttle: 1, throttleMode: 'absolute', targetTWR: 1.5,
    firingEngines: new Set<string>(),
    fuelStore: new Map<string, number>(),
    activeParts: new Set<string>(),
    deployedParts: new Set<string>(),
    parachuteStates: new Map(),
    legStates: new Map(),
    ejectorStates: new Map(),
    ejectedCrewIds: new Set<string>(),
    ejectedCrew: [],
    instrumentStates: new Map(),
    scienceModuleStates: new Map(),
    heatMap: new Map(),
    debris: [],
    landed: false, crashed: false, grounded: true,
    angularVelocity: 0, isTipping: false,
    tippingContactX: 0, tippingContactY: 0,
    _heldKeys: new Set<string>(), _accumulator: 0,
    controlMode: 'NORMAL',
    baseOrbit: null, dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0, dockingOffsetRadial: 0,
    rcsActiveDirections: new Set<string>(),
    dockingPortStates: new Map(),
    _dockedCombinedMass: 0,
    weatherIspModifier: 1.0,
    hasLaunchClamps: false,
    powerState: null,
    malfunctions: null,
  } as unknown as PhysicsState;
}

function makeMinimalFlightState(): FlightState {
  return {
    missionId: 'm1', rocketId: 'r1',
    crewIds: [], crewCount: 0,
    timeElapsed: 0, altitude: 0, velocity: 0,
    fuelRemaining: 100, deltaVRemaining: 500,
    events: [], aborted: false,
    phase: 'PRELAUNCH', phaseLog: [],
    inOrbit: false, orbitalElements: null,
    bodyId: 'EARTH', orbitBandId: null,
    currentBiome: null, biomesVisited: [],
    maxAltitude: 0, maxVelocity: 0,
    dockingState: null, transferState: null,
    powerState: null, commsState: null,
  } as unknown as FlightState;
}

function makeMinimalAssembly(): RocketAssembly {
  return {
    parts: new Map(),
    connections: [],
    _nextId: 1,
    symmetryPairs: [],
  } as unknown as RocketAssembly;
}

function makeMinimalStagingConfig(): StagingConfig {
  return {
    stages: [],
    unstaged: [],
    currentStageIdx: 0,
  } as unknown as StagingConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workerBridge — ready timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installWorkerStub();
  });

  afterEach(async () => {
    // Clean up: import and terminate to reset module state
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();
    restoreWorkerStub();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('rejects with timeout error when worker never sends ready', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker(); // reset state

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    // Worker never sends 'ready'. Advance past the 10s timeout.
    vi.advanceTimersByTime(10_001);

    await expect(promise).rejects.toThrow('Physics worker did not respond within 10s');
  });

  it('resolves successfully when worker sends ready before timeout', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker(); // reset state

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    // Worker sends 'ready' after 500ms
    vi.advanceTimersByTime(500);
    latestMockWorker!._simulateMessage({ type: 'ready' });

    await expect(promise).resolves.toBeUndefined();
    expect(bridge.isWorkerReady()).toBe(true);
  });

  it('timeout does not fire after worker sends ready', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker(); // reset state

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    // Worker sends 'ready' quickly
    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });

    await expect(promise).resolves.toBeUndefined();

    // Advance past 10s — should not throw or reject
    vi.advanceTimersByTime(15_000);

    // Bridge should still be in good state
    expect(bridge.isWorkerReady()).toBe(true);
    expect(bridge.hasWorkerError()).toBe(false);
  });

  it('rejects with error when worker fires onerror before timeout', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker(); // reset state

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    // Worker fires an error
    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateError('Script parse error');

    await expect(promise).rejects.toThrow('Script parse error');
    expect(bridge.hasWorkerError()).toBe(true);
  });
});
