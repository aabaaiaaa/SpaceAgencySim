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

describe('workerBridge — public API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installWorkerStub();
  });

  afterEach(async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();
    restoreWorkerStub();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('consumeMainThreadSnapshot returns null when no snapshot available', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();
    expect(bridge.consumeMainThreadSnapshot()).toBeNull();
  });

  it('consumeMainThreadSnapshot returns snapshot and clears it', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    // Simulate a snapshot message
    latestMockWorker!._simulateMessage({
      type: 'snapshot',
      physics: { posX: 10, posY: 20, velX: 1, velY: 2, landed: false, crashed: false, grounded: false, angularVelocity: 0, isTipping: false, tippingContactX: 0, tippingContactY: 0, controlMode: 'NORMAL', baseOrbit: null, hasLaunchClamps: false, weatherIspModifier: 1.0, firingEngines: [], activeParts: [], deployedParts: [], rcsActiveDirections: [], ejectedCrewIds: [], ejectedCrew: [], fuelStore: {}, heatMap: {}, parachuteStates: {}, legStates: {}, ejectorStates: {}, instrumentStates: {}, scienceModuleStates: {}, dockingPortStates: {}, debris: [], powerState: null, malfunctions: null, dockingAltitudeBand: null, dockingOffsetAlongTrack: 0, dockingOffsetRadial: 0, capturedBody: null, thrustAligned: false },
      flight: { phase: 'FLIGHT', timeElapsed: 10, altitude: 1000, velocity: 500, fuelRemaining: 90, deltaVRemaining: 400, aborted: false, inOrbit: false, orbitalElements: null, bodyId: 'EARTH', orbitBandId: null, currentBiome: null, maxAltitude: 1000, maxVelocity: 500, dockingState: null, transferState: null, phaseLog: [], events: [], biomesVisited: [], crewIds: [], missionId: 'm1', rocketId: 'r1', crewCount: 0, horizontalVelocity: 0, powerState: null, commsState: null },
      frame: 1,
      currentStageIdx: 0,
    });

    const snap = bridge.consumeMainThreadSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.physics.posX).toBe(10);
    expect(snap!.frame).toBe(1);

    // Second consumption returns null
    expect(bridge.consumeMainThreadSnapshot()).toBeNull();
  });

  it('handles error message and sets error state', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    expect(bridge.hasWorkerError()).toBe(false);

    latestMockWorker!._simulateMessage({
      type: 'error',
      message: 'Physics computation failed',
      stack: 'Error: Physics computation failed\n    at tick',
    });

    expect(bridge.hasWorkerError()).toBe(true);
    expect(bridge.getWorkerErrorMessage()).toBe('Physics computation failed');
  });

  it('handles stopped message without error', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    // Stopped message should not change error state
    latestMockWorker!._simulateMessage({ type: 'stopped' });

    expect(bridge.hasWorkerError()).toBe(false);
    expect(bridge.isWorkerReady()).toBe(true);
  });

  it('resyncWorkerState rejects when worker is not available', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    await expect(
      bridge.resyncWorkerState(
        makeMinimalPhysicsState(),
        makeMinimalAssembly(),
        makeMinimalStagingConfig(),
        makeMinimalFlightState(),
      ),
    ).rejects.toThrow('Worker not available');
  });

  it('resyncWorkerState resolves when worker sends ready again', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const initPromise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await initPromise;

    const resyncPromise = bridge.resyncWorkerState(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    // Worker re-inits and sends ready again
    latestMockWorker!._simulateMessage({ type: 'ready' });

    await expect(resyncPromise).resolves.toBeUndefined();
  });

  it('sendTick posts a message to the worker', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    const callsBefore = latestMockWorker!._postMessageCalls.length;
    bridge.sendTick(0.016, 1);
    expect(latestMockWorker!._postMessageCalls.length).toBe(callsBefore + 1);
    const lastCall = latestMockWorker!._postMessageCalls[latestMockWorker!._postMessageCalls.length - 1] as Record<string, unknown>;
    expect(lastCall.type).toBe('tick');
  });

  it('sendThrottle posts throttle state to the worker', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    bridge.sendThrottle(0.75, 'twr', 1.5);
    const lastCall = latestMockWorker!._postMessageCalls[latestMockWorker!._postMessageCalls.length - 1] as Record<string, unknown>;
    expect(lastCall.type).toBe('setThrottle');
    expect(lastCall.throttle).toBe(0.75);
  });

  it('sendAngle posts angle to the worker', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    bridge.sendAngle(1.57);
    const lastCall = latestMockWorker!._postMessageCalls[latestMockWorker!._postMessageCalls.length - 1] as Record<string, unknown>;
    expect(lastCall.type).toBe('setAngle');
    expect(lastCall.angle).toBe(1.57);
  });

  it('sendStage posts stage command', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    bridge.sendStage();
    const lastCall = latestMockWorker!._postMessageCalls[latestMockWorker!._postMessageCalls.length - 1] as Record<string, unknown>;
    expect(lastCall.type).toBe('stage');
  });

  it('sendAbort posts abort command', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    bridge.sendAbort();
    const lastCall = latestMockWorker!._postMessageCalls[latestMockWorker!._postMessageCalls.length - 1] as Record<string, unknown>;
    expect(lastCall.type).toBe('abort');
  });

  it('sendKeyDown and sendKeyUp post key events', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    bridge.sendKeyDown('a');
    let lastCall = latestMockWorker!._postMessageCalls[latestMockWorker!._postMessageCalls.length - 1] as Record<string, unknown>;
    expect(lastCall.type).toBe('keyDown');
    expect(lastCall.key).toBe('a');

    bridge.sendKeyUp('a');
    lastCall = latestMockWorker!._postMessageCalls[latestMockWorker!._postMessageCalls.length - 1] as Record<string, unknown>;
    expect(lastCall.type).toBe('keyUp');
    expect(lastCall.key).toBe('a');
  });

  it('terminatePhysicsWorker resets all state', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    expect(bridge.isWorkerReady()).toBe(true);

    bridge.terminatePhysicsWorker();

    expect(bridge.isWorkerReady()).toBe(false);
    expect(bridge.hasWorkerError()).toBe(false);
    expect(bridge.getWorkerErrorMessage()).toBe('');
    expect(bridge.consumeMainThreadSnapshot()).toBeNull();
  });

  it('_post is a no-op when worker is in error state', async () => {
    const bridge = await import('../ui/flightController/_workerBridge.ts');
    bridge.terminatePhysicsWorker();

    const promise = bridge.initPhysicsWorker(
      makeMinimalPhysicsState(),
      makeMinimalAssembly(),
      makeMinimalStagingConfig(),
      makeMinimalFlightState(),
    );

    vi.advanceTimersByTime(100);
    latestMockWorker!._simulateMessage({ type: 'ready' });
    await promise;

    // Force error state via error message
    latestMockWorker!._simulateMessage({ type: 'error', message: 'fatal', stack: '' });
    expect(bridge.hasWorkerError()).toBe(true);

    const callsBefore = latestMockWorker!._postMessageCalls.length;
    bridge.sendTick(0.016, 1);
    // No new message should have been posted
    expect(latestMockWorker!._postMessageCalls.length).toBe(callsBefore);
  });
});

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
