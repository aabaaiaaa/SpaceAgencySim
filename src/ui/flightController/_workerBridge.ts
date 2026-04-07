/**
 * _workerBridge.ts — Manages the physics Web Worker lifecycle.
 *
 * Creates / terminates the worker, sends commands, receives snapshots,
 * and applies snapshot data back to the main-thread mutable state objects
 * so that the render layer and UI continue to work unchanged.
 *
 * @module ui/flightController/_workerBridge
 */

import { logger } from '../../core/logger.ts';
import {
  mapToRecord,
  setToArray,
} from '../../core/physicsWorkerProtocol.ts';

import type { PhysicsState, InstrumentStateEntry, ScienceModuleStateEntry } from '../../core/physics.ts';
import type { FlightState } from '../../core/gameState.ts';
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
let _latestPhysics: PhysicsSnapshot | null = null;
let _latestFlight: FlightSnapshot | null = null;
let _latestFrame = -1;
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
    _latestPhysics = null;
    _latestFlight = null;
    _latestFrame = -1;
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
  _post({ type: 'tick', realDeltaTime, timeWarp });
}

/** Forward a throttle value to the worker. */
export function sendThrottle(throttle: number): void {
  _post({ type: 'setThrottle', throttle });
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
 * Consume the latest physics and flight snapshots.  Returns the snapshots
 * and clears them so the same data is not applied twice.  Returns null if
 * no new snapshot is available.
 */
export function consumeSnapshot(): { physics: PhysicsSnapshot; flight: FlightSnapshot; frame: number } | null {
  if (_latestPhysics === null || _latestFlight === null) return null;
  const result = { physics: _latestPhysics, flight: _latestFlight, frame: _latestFrame };
  _latestPhysics = null;
  _latestFlight = null;
  return result;
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
  _latestPhysics = null;
  _latestFlight = null;
  _latestFrame = -1;
  _latestSnapshot = null;
  _readyResolve = null;
  _readyReject = null;
  _clearReadyTimeout();
}

// ---------------------------------------------------------------------------
// Snapshot application — update mutable main-thread objects in place
// ---------------------------------------------------------------------------

/**
 * Apply a physics snapshot to the mutable PhysicsState on the main thread.
 * This updates the object in place so that all existing references (HUD,
 * render layer, E2E globals) continue to work.
 *
 * NOTE: throttle, throttleMode, and targetTWR are deliberately NOT applied
 * from the snapshot.  The main thread is the authority for control inputs
 * and syncs them to the worker via sendThrottle()/sendAngle() commands.
 * Applying them from the snapshot would overwrite keyboard/button changes
 * that occurred between frames.
 */
export function applyPhysicsSnapshot(ps: PhysicsState, snap: PhysicsSnapshot): void {
  ps.posX = snap.posX;
  ps.posY = snap.posY;
  ps.velX = snap.velX;
  ps.velY = snap.velY;
  ps.angle = snap.angle;
  // ps.throttle — NOT applied; main thread is authority for control inputs
  // ps.throttleMode — NOT applied; main thread is authority
  // ps.targetTWR — NOT applied; main thread is authority

  ps.firingEngines = new Set(snap.firingEngines);
  ps.activeParts = new Set(snap.activeParts);
  ps.deployedParts = new Set(snap.deployedParts);
  ps.ejectedCrewIds = new Set(snap.ejectedCrewIds);
  ps.rcsActiveDirections = new Set(snap.rcsActiveDirections);

  ps.fuelStore = new Map(Object.entries(snap.fuelStore));
  ps.heatMap = new Map(Object.entries(snap.heatMap));
  ps.parachuteStates = new Map(Object.entries(snap.parachuteStates));
  ps.legStates = new Map(Object.entries(snap.legStates));
  ps.ejectorStates = new Map(Object.entries(snap.ejectorStates));
  ps.instrumentStates = new Map(Object.entries(snap.instrumentStates as Record<string, InstrumentStateEntry>));
  ps.scienceModuleStates = new Map(Object.entries(snap.scienceModuleStates as Record<string, ScienceModuleStateEntry>));
  ps.dockingPortStates = new Map(Object.entries(snap.dockingPortStates));

  ps.ejectedCrew = snap.ejectedCrew.map(e => ({ ...e }));
  ps.debris = snap.debris.map(d => ({
    id: d.id,
    activeParts: new Set(d.activeParts),
    firingEngines: new Set(d.firingEngines),
    fuelStore: new Map(Object.entries(d.fuelStore)),
    deployedParts: new Set(d.deployedParts),
    parachuteStates: new Map(Object.entries(d.parachuteStates)),
    legStates: new Map(Object.entries(d.legStates)),
    heatMap: new Map(Object.entries(d.heatMap)),
    posX: d.posX, posY: d.posY,
    velX: d.velX, velY: d.velY,
    angle: d.angle, throttle: d.throttle,
    angularVelocity: d.angularVelocity,
    isTipping: d.isTipping,
    tippingContactX: d.tippingContactX,
    tippingContactY: d.tippingContactY,
    landed: d.landed, crashed: d.crashed,
  }));

  ps.landed = snap.landed;
  ps.crashed = snap.crashed;
  ps.grounded = snap.grounded;
  ps.angularVelocity = snap.angularVelocity;
  ps.isTipping = snap.isTipping;
  ps.tippingContactX = snap.tippingContactX;
  ps.tippingContactY = snap.tippingContactY;
  ps.controlMode = snap.controlMode;
  ps.baseOrbit = snap.baseOrbit;
  ps.dockingAltitudeBand = snap.dockingAltitudeBand;
  ps.dockingOffsetAlongTrack = snap.dockingOffsetAlongTrack;
  ps.dockingOffsetRadial = snap.dockingOffsetRadial;
  ps.weatherIspModifier = snap.weatherIspModifier;
  ps.hasLaunchClamps = snap.hasLaunchClamps;
  ps.powerState = snap.powerState;

  if (snap.malfunctions) {
    ps.malfunctions = new Map(
      Object.entries(snap.malfunctions).map(([k, v]) => [k, v]),
    );
  } else {
    ps.malfunctions = undefined;
  }
}

/**
 * Apply a flight snapshot to the mutable FlightState on the main thread.
 */
export function applyFlightSnapshot(fs: FlightState, snap: FlightSnapshot): void {
  fs.missionId = snap.missionId;
  fs.rocketId = snap.rocketId;
  fs.crewIds = [...snap.crewIds];
  fs.crewCount = snap.crewCount;
  fs.timeElapsed = snap.timeElapsed;
  fs.altitude = snap.altitude;
  fs.velocity = snap.velocity;
  fs.fuelRemaining = snap.fuelRemaining;
  fs.deltaVRemaining = snap.deltaVRemaining;
  fs.events = snap.events.map(e => ({ ...e }));
  fs.aborted = snap.aborted;
  fs.phase = snap.phase;
  fs.phaseLog = snap.phaseLog.map(p => ({ ...p }));
  fs.inOrbit = snap.inOrbit;
  fs.orbitalElements = snap.orbitalElements ? { ...snap.orbitalElements } : null;
  fs.bodyId = snap.bodyId;
  fs.orbitBandId = snap.orbitBandId;
  fs.currentBiome = snap.currentBiome;
  fs.biomesVisited = [...snap.biomesVisited];
  fs.maxAltitude = snap.maxAltitude;
  fs.maxVelocity = snap.maxVelocity;
  fs.dockingState = snap.dockingState ? { ...snap.dockingState } : null;
  fs.transferState = snap.transferState ? { ...snap.transferState } : null;
  fs.powerState = snap.powerState ? { ...snap.powerState } : null;
  // Note: commsState is evaluated on the main thread, not in the worker.
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
      // Legacy per-field storage (kept until all consumers migrate to consumeMainThreadSnapshot).
      _latestPhysics = msg.physics;
      _latestFlight = msg.flight;
      _latestFrame = msg.frame;

      // Direct snapshot storage — no field-by-field copy.
      // The PhysicsSnapshot from the worker includes control input fields
      // (throttle, throttleMode, targetTWR, angle) but ReadonlyPhysicsSnapshot
      // omits them via Omit<>.  Since this is a readonly view the extra fields
      // are harmlessly present at runtime but invisible to consumers via the type.
      _latestSnapshot = {
        physics: msg.physics,
        flight: msg.flight,
        frame: msg.frame,
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
