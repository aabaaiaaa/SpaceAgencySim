/**
 * _workerBridge.ts — Manages the physics Web Worker lifecycle.
 *
 * Creates / terminates the worker, sends commands, receives readonly
 * snapshots for main-thread consumption.  The worker is the sole owner
 * of mutable physics state; the main thread stores only the latest
 * readonly snapshot.
 *
 * @module ui/flightController/_workerBridge
 */

import { logger } from '../../core/logger.ts';
import { recordWorkerSend, recordWorkerReceive } from '../../core/perfMonitor.ts';
import {
  mapToRecord,
  setToArray,
} from '../../core/physicsWorkerProtocol.ts';

import type { PhysicsState } from '../../core/physics.ts';
import type { FlightState } from '../../core/gameState.ts';
// Note: PhysicsState and FlightState types are still needed for the
// serialisation helpers used by initPhysicsWorker() and resyncWorkerState().
import type { RocketAssembly, StagingConfig, PlacedPart } from '../../core/rocketbuilder.ts';
import type {
  WorkerCommand,
  WorkerMessage,
  PhysicsSnapshot,
  FlightSnapshot,
  MainThreadSnapshot,
  SerialisedAssembly,
  SerialisedStagingConfig,
  SerialisedParachuteEntry,
} from '../../core/physicsWorkerProtocol.ts';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _worker: Worker | null = null;
let _ready = false;
let _error = false;
let _errorMessage = '';
/** Composite readonly snapshot stored directly from the worker (no field-by-field copy). */
let _latestSnapshot: MainThreadSnapshot | null = null;
let _readyResolve: (() => void) | null = null;
let _readyReject: ((err: Error) => void) | null = null;
let _readyTimeout: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true when the worker is initialised and ready to accept tick
 * commands.
 */
export function isWorkerReady(): boolean {
  return _worker !== null && _ready && !_error;
}

/**
 * Returns true when the worker encountered an unrecoverable error.
 */
export function hasWorkerError(): boolean {
  return _error;
}

/** Human-readable error message (empty string when no error). */
export function getWorkerErrorMessage(): string {
  return _errorMessage;
}

/**
 * Create the physics worker and send the 'init' command with initial state
 * and data catalogs.  Resolves when the worker posts back 'ready'.
 */
export function initPhysicsWorker(
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
): Promise<void> {
  // Tear down any lingering worker.
  terminatePhysicsWorker();

  return new Promise<void>((resolve, reject) => {
    try {
      _worker = new Worker(
        new URL('../../core/physicsWorker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch (err) {
      _error = true;
      _errorMessage = `Failed to create physics worker: ${err}`;
      logger.error('workerBridge', _errorMessage);
      reject(new Error(_errorMessage));
      return;
    }

    _readyResolve = resolve;
    _readyReject = reject;

    // Reject if the worker doesn't respond within 10 seconds.
    _readyTimeout = setTimeout(() => {
      _readyTimeout = null;
      if (_readyResolve) {
        _readyResolve = null;
        _readyReject = null;
        const msg = 'Physics worker did not respond within 10s';
        logger.warn('workerBridge', msg);
        reject(new Error(msg));
      }
    }, 10_000);

    _worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      _handleMessage(event.data);
    };

    _worker.onerror = (event) => {
      _error = true;
      _errorMessage = event.message ?? 'Unknown worker error';
      logger.error('workerBridge', 'Worker onerror', { message: _errorMessage });
      if (_readyResolve) {
        _readyResolve = null;
        _readyReject = null;
        _clearReadyTimeout();
        reject(new Error(_errorMessage));
      }
    };

    // Serialise and send the init command.
    // partsCatalog and bodiesCatalog are sent as empty placeholders because the
    // worker imports them directly via ES module imports (see physicsWorker.ts).
    const initCmd: WorkerCommand = {
      type: 'init',
      partsCatalog: [],
      bodiesCatalog: {},
      physicsState: _serialisePhysicsState(ps),
      flightState: _serialiseFlightState(flightState),
      assembly: _serialiseAssembly(assembly),
      stagingConfig: _serialiseStagingConfig(stagingConfig),
    };
    _worker.postMessage(initCmd);
  });
}

/**
 * Re-initialise the existing worker with the current main-thread state.
 * Used after the worker's first 'ready' to sync any changes (e.g. staging)
 * that happened while the worker was loading.  Resolves on the second
 * 'ready' message.
 */
export function resyncWorkerState(
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
): Promise<void> {
  if (!_worker || _error) return Promise.reject(new Error('Worker not available'));

  return new Promise<void>((resolve) => {
    _ready = false;
    _readyResolve = resolve;
    _latestSnapshot = null;

    // partsCatalog and bodiesCatalog are sent as empty placeholders because the
    // worker imports them directly via ES module imports (see physicsWorker.ts).
    const initCmd: WorkerCommand = {
      type: 'init',
      physicsState: _serialisePhysicsState(ps),
      flightState: _serialiseFlightState(flightState),
      assembly: _serialiseAssembly(assembly),
      stagingConfig: _serialiseStagingConfig(stagingConfig),
    };
    _worker!.postMessage(initCmd);
  });
}

/** Send a tick command to the worker. */
export function sendTick(realDeltaTime: number, timeWarp: number): void {
  recordWorkerSend();
  _post({ type: 'tick', realDeltaTime, timeWarp });
}

/** Forward throttle state to the worker. */
export function sendThrottle(throttle: number, throttleMode?: 'twr' | 'absolute', targetTWR?: number): void {
  _post({ type: 'setThrottle', throttle, throttleMode, targetTWR });
}

/** Forward a rocket angle to the worker. */
export function sendAngle(angle: number): void {
  _post({ type: 'setAngle', angle });
}

/** Forward a stage command. */
export function sendStage(): void {
  _post({ type: 'stage' });
}

/** Forward an abort command. */
export function sendAbort(): void {
  _post({ type: 'abort' });
}

/** Forward a key-down event. */
export function sendKeyDown(key: string): void {
  _post({ type: 'keyDown', key });
}

/** Forward a key-up event. */
export function sendKeyUp(key: string): void {
  _post({ type: 'keyUp', key });
}

/**
 * Consume the latest MainThreadSnapshot directly.  Returns the snapshot
 * object (or null if none available) and clears it so the same data is not
 * consumed twice.  The snapshot is stored directly from the worker message
 * with no field-by-field copy.
 *
 * Control inputs (throttle, angle) are excluded from the physics portion of
 * the snapshot — they remain main-thread authority.
 */
export function consumeMainThreadSnapshot(): MainThreadSnapshot | null {
  const snap = _latestSnapshot;
  if (snap === null) return null;
  _latestSnapshot = null;
  return snap;
}

/** Terminate the worker and reset all bridge state. */
export function terminatePhysicsWorker(): void {
  if (_worker) {
    try { _post({ type: 'stop' }); } catch { /* ignore */ }
    _worker.terminate();
    _worker = null;
  }
  _ready = false;
  _error = false;
  _errorMessage = '';
  _latestSnapshot = null;
  _readyResolve = null;
  _readyReject = null;
  _clearReadyTimeout();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _clearReadyTimeout(): void {
  if (_readyTimeout !== null) {
    clearTimeout(_readyTimeout);
    _readyTimeout = null;
  }
}

function _post(cmd: WorkerCommand): void {
  if (_worker && !_error) {
    _worker.postMessage(cmd);
  }
}

function _handleMessage(msg: WorkerMessage): void {
  switch (msg.type) {
    case 'ready':
      _ready = true;
      _clearReadyTimeout();
      if (_readyResolve) {
        const r = _readyResolve;
        _readyResolve = null;
        _readyReject = null;
        r();
      }
      break;

    case 'snapshot':
      // Record worker round-trip latency for the performance monitor.
      recordWorkerReceive();
      // Direct snapshot storage — no field-by-field copy.
      // The PhysicsSnapshot from the worker includes control input fields
      // (throttle, throttleMode, targetTWR, angle) but ReadonlyPhysicsSnapshot
      // omits them via Omit<>.  Since this is a readonly view the extra fields
      // are harmlessly present at runtime but invisible to consumers via the type.
      _latestSnapshot = {
        physics: msg.physics,
        flight: msg.flight,
        frame: msg.frame,
        currentStageIdx: msg.currentStageIdx,
      };
      break;

    case 'error':
      _error = true;
      _errorMessage = msg.message;
      logger.error('workerBridge', 'Worker error message', { message: msg.message, stack: msg.stack });
      break;

    case 'stopped':
      // Worker has shut down cleanly.
      break;
  }
}

// ---------------------------------------------------------------------------
// Serialisation helpers — main-thread state → structured-clone-safe
// ---------------------------------------------------------------------------

function _serialisePhysicsState(ps: PhysicsState): PhysicsSnapshot {
  return {
    posX: ps.posX,
    posY: ps.posY,
    velX: ps.velX,
    velY: ps.velY,
    angle: ps.angle,
    throttle: ps.throttle,
    throttleMode: ps.throttleMode,
    targetTWR: ps.targetTWR,
    firingEngines: setToArray(ps.firingEngines),
    fuelStore: mapToRecord(ps.fuelStore),
    activeParts: setToArray(ps.activeParts),
    deployedParts: setToArray(ps.deployedParts),
    parachuteStates: mapToRecord(ps.parachuteStates) as Record<string, SerialisedParachuteEntry>,
    legStates: mapToRecord(ps.legStates),
    ejectorStates: mapToRecord(ps.ejectorStates),
    ejectedCrewIds: setToArray(ps.ejectedCrewIds),
    ejectedCrew: ps.ejectedCrew.map(e => ({
      x: e.x, y: e.y, velX: e.velX, velY: e.velY,
      chuteOpen: e.chuteOpen, chuteTimer: e.chuteTimer,
    })),
    instrumentStates: mapToRecord(ps.instrumentStates) as Record<string, unknown>,
    scienceModuleStates: mapToRecord(ps.scienceModuleStates) as Record<string, unknown>,
    heatMap: mapToRecord(ps.heatMap),
    debris: ps.debris.map(d => ({
      id: d.id,
      activeParts: setToArray(d.activeParts),
      firingEngines: setToArray(d.firingEngines),
      fuelStore: mapToRecord(d.fuelStore),
      deployedParts: setToArray(d.deployedParts),
      parachuteStates: mapToRecord(d.parachuteStates) as Record<string, SerialisedParachuteEntry>,
      legStates: mapToRecord(d.legStates),
      heatMap: mapToRecord(d.heatMap),
      posX: d.posX, posY: d.posY,
      velX: d.velX, velY: d.velY,
      angle: d.angle, throttle: d.throttle,
      angularVelocity: d.angularVelocity,
      isTipping: d.isTipping,
      tippingContactX: d.tippingContactX,
      tippingContactY: d.tippingContactY,
      landed: d.landed, crashed: d.crashed,
    })),
    landed: ps.landed,
    crashed: ps.crashed,
    grounded: ps.grounded,
    angularVelocity: ps.angularVelocity,
    isTipping: ps.isTipping,
    tippingContactX: ps.tippingContactX,
    tippingContactY: ps.tippingContactY,
    controlMode: ps.controlMode,
    baseOrbit: ps.baseOrbit,
    dockingAltitudeBand: ps.dockingAltitudeBand,
    dockingOffsetAlongTrack: ps.dockingOffsetAlongTrack,
    dockingOffsetRadial: ps.dockingOffsetRadial,
    rcsActiveDirections: setToArray(ps.rcsActiveDirections),
    dockingPortStates: mapToRecord(ps.dockingPortStates),
    weatherIspModifier: ps.weatherIspModifier,
    hasLaunchClamps: ps.hasLaunchClamps,
    powerState: ps.powerState,
    malfunctions: ps.malfunctions
      ? mapToRecord(ps.malfunctions) as PhysicsSnapshot['malfunctions']
      : null,
  };
}

function _serialiseFlightState(fs: FlightState): FlightSnapshot {
  return {
    missionId: fs.missionId,
    rocketId: fs.rocketId,
    crewIds: [...fs.crewIds],
    crewCount: fs.crewCount,
    timeElapsed: fs.timeElapsed,
    altitude: fs.altitude,
    velocity: fs.velocity,
    fuelRemaining: fs.fuelRemaining,
    deltaVRemaining: fs.deltaVRemaining,
    events: fs.events.map(e => ({ ...e })),
    aborted: fs.aborted,
    phase: fs.phase,
    phaseLog: fs.phaseLog.map(p => ({ ...p })),
    inOrbit: fs.inOrbit,
    orbitalElements: fs.orbitalElements ? { ...fs.orbitalElements } : null,
    bodyId: fs.bodyId,
    orbitBandId: fs.orbitBandId,
    currentBiome: fs.currentBiome,
    biomesVisited: [...fs.biomesVisited],
    maxAltitude: fs.maxAltitude,
    maxVelocity: fs.maxVelocity,
    dockingState: fs.dockingState ? { ...fs.dockingState } : null,
    transferState: fs.transferState ? { ...fs.transferState } : null,
    powerState: fs.powerState ? { ...fs.powerState } : null,
    commsState: fs.commsState ? { ...fs.commsState } : null,
  };
}

function _serialiseAssembly(assembly: RocketAssembly): SerialisedAssembly {
  const parts: Record<string, PlacedPart> = Object.create(null);
  for (const [id, placed] of assembly.parts) {
    parts[id] = { ...placed };
  }
  return {
    parts,
    connections: assembly.connections.map(c => ({ ...c })),
    _nextId: assembly._nextId,
    symmetryPairs: assembly.symmetryPairs.map(p => [...p] as [string, string]),
  };
}

function _serialiseStagingConfig(sc: StagingConfig): SerialisedStagingConfig {
  return {
    stages: sc.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
    unstaged: [...sc.unstaged],
    currentStageIdx: sc.currentStageIdx,
  };
}
