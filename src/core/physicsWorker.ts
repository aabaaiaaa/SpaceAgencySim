/**
 * physicsWorker.ts — Web Worker module for off-thread physics simulation.
 *
 * Runs `tick()`, orbital mechanics, and flight phase evaluation on a
 * dedicated thread.  Receives commands from the main thread via postMessage
 * and sends back state snapshots for rendering.
 *
 * LIFECYCLE
 *   1. Main thread sends 'init' with data catalogs + initial state.
 *   2. Worker rebuilds mutable PhysicsState/FlightState from snapshots.
 *   3. On each 'tick' command, worker calls tick() then sends back a snapshot.
 *   4. Input commands (throttle, stage, abort, key events) mutate state between ticks.
 *   5. 'stop' command terminates the worker.
 *
 * The worker imports core physics functions directly — Vite bundles this
 * file as a separate entry when loaded via `new Worker(new URL(...), { type: 'module' })`.
 *
 * @module core/physicsWorker
 */

import { tick, createPhysicsState, handleKeyDown, handleKeyUp, fireNextStage } from './physics.js';
import { evaluateAutoTransitions } from './flightPhase.js';
import { checkOrbitStatus } from './orbit.js';
import type { PhysicsState, RocketAssembly, PlacedPart, PartConnection } from './physics.js';
import type { FlightState } from './gameState.js';
import type {
  WorkerCommand,
  WorkerMessage,
  SnapshotMessage,
  PhysicsSnapshot,
  FlightSnapshot,
  SerialisedAssembly,
  SerialisedStagingConfig,
  SerialisedParachuteEntry,
  SerialisedDebrisState,
  SerialisedEjectedCrewEntry,
  InitCommand,
} from './physicsWorkerProtocol.js';

// Re-import helpers as values (the type-only imports above are erased).
import {
  mapToRecord as _mapToRecord,
  recordToMap as _recordToMap,
  setToArray as _setToArray,
  arrayToSet as _arrayToSet,
} from './physicsWorkerProtocol.js';

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

/** Mutable physics state owned by the worker. */
let ps: PhysicsState | null = null;

/** Mutable flight state owned by the worker. */
let flightState: FlightState | null = null;

/** Rocket assembly (immutable after init). */
let assembly: RocketAssembly | null = null;

/** Staging config (mutated by fireNextStage). */
let stagingConfig: { stages: { instanceIds: string[] }[]; unstaged: string[]; currentStageIdx: number } | null = null;

/** Frame counter for snapshot sequencing. */
let frameCounter = 0;

/** Whether the worker has been initialised. */
let initialised = false;

// ---------------------------------------------------------------------------
// Deserialisation: snapshot → mutable state
// ---------------------------------------------------------------------------

/**
 * Rebuild a mutable PhysicsState from a serialised snapshot.
 */
function deserialisePhysicsState(snap: PhysicsSnapshot): PhysicsState {
  return {
    posX: snap.posX,
    posY: snap.posY,
    velX: snap.velX,
    velY: snap.velY,
    angle: snap.angle,
    throttle: snap.throttle,
    throttleMode: snap.throttleMode,
    targetTWR: snap.targetTWR,
    firingEngines: _arrayToSet(snap.firingEngines),
    fuelStore: _recordToMap(snap.fuelStore),
    activeParts: _arrayToSet(snap.activeParts),
    deployedParts: _arrayToSet(snap.deployedParts),
    parachuteStates: _recordToMap(snap.parachuteStates),
    legStates: _recordToMap(snap.legStates),
    ejectorStates: _recordToMap(snap.ejectorStates),
    ejectedCrewIds: _arrayToSet(snap.ejectedCrewIds),
    ejectedCrew: snap.ejectedCrew.map(e => ({ ...e })),
    instrumentStates: _recordToMap(snap.instrumentStates as Record<string, any>),
    scienceModuleStates: _recordToMap(snap.scienceModuleStates as Record<string, object>),
    heatMap: _recordToMap(snap.heatMap),
    debris: snap.debris.map(deserialiseDebris),
    landed: snap.landed,
    crashed: snap.crashed,
    grounded: snap.grounded,
    angularVelocity: snap.angularVelocity,
    isTipping: snap.isTipping,
    tippingContactX: snap.tippingContactX,
    tippingContactY: snap.tippingContactY,
    _heldKeys: new Set<string>(),
    _accumulator: 0,
    controlMode: snap.controlMode as any,
    baseOrbit: snap.baseOrbit,
    dockingAltitudeBand: snap.dockingAltitudeBand as any,
    dockingOffsetAlongTrack: snap.dockingOffsetAlongTrack,
    dockingOffsetRadial: snap.dockingOffsetRadial,
    rcsActiveDirections: _arrayToSet(snap.rcsActiveDirections),
    dockingPortStates: _recordToMap(snap.dockingPortStates),
    _dockedCombinedMass: 0,
    weatherIspModifier: snap.weatherIspModifier,
    hasLaunchClamps: snap.hasLaunchClamps,
    powerState: snap.powerState,
    malfunctions: snap.malfunctions
      ? _recordToMap(Object.fromEntries(
          Object.entries(snap.malfunctions).map(([k, v]) => [k, v as any]),
        ) as Record<string, any>)
      : undefined,
  };
}

/**
 * Rebuild a mutable FlightState from a serialised snapshot.
 */
function deserialiseFlightState(snap: FlightSnapshot): FlightState {
  return {
    missionId: snap.missionId,
    rocketId: snap.rocketId,
    crewIds: [...snap.crewIds],
    crewCount: snap.crewCount,
    timeElapsed: snap.timeElapsed,
    altitude: snap.altitude,
    velocity: snap.velocity,
    fuelRemaining: snap.fuelRemaining,
    deltaVRemaining: snap.deltaVRemaining,
    events: snap.events.map(e => ({ ...e })),
    aborted: snap.aborted,
    phase: snap.phase,
    phaseLog: snap.phaseLog.map(p => ({ ...p })),
    inOrbit: snap.inOrbit,
    orbitalElements: snap.orbitalElements ? { ...snap.orbitalElements } : null,
    bodyId: snap.bodyId,
    orbitBandId: snap.orbitBandId,
    currentBiome: snap.currentBiome,
    biomesVisited: [...snap.biomesVisited],
    maxAltitude: snap.maxAltitude,
    maxVelocity: snap.maxVelocity,
    dockingState: snap.dockingState ? { ...snap.dockingState } : null,
    transferState: snap.transferState ? { ...snap.transferState } : null,
    powerState: snap.powerState ? { ...snap.powerState } : null,
    commsState: snap.commsState ? { ...snap.commsState } : null,
  };
}

/**
 * Rebuild a single debris state from its serialised form.
 */
function deserialiseDebris(d: SerialisedDebrisState) {
  return {
    id: d.id,
    activeParts: _arrayToSet(d.activeParts),
    firingEngines: _arrayToSet(d.firingEngines),
    fuelStore: _recordToMap(d.fuelStore),
    deployedParts: _arrayToSet(d.deployedParts),
    parachuteStates: _recordToMap(d.parachuteStates),
    legStates: _recordToMap(d.legStates),
    heatMap: _recordToMap(d.heatMap),
    posX: d.posX,
    posY: d.posY,
    velX: d.velX,
    velY: d.velY,
    angle: d.angle,
    throttle: d.throttle,
    angularVelocity: d.angularVelocity,
    isTipping: d.isTipping,
    tippingContactX: d.tippingContactX,
    tippingContactY: d.tippingContactY,
    landed: d.landed,
    crashed: d.crashed,
  };
}

/**
 * Rebuild a RocketAssembly from a serialised form.
 */
function deserialiseAssembly(sa: SerialisedAssembly): RocketAssembly {
  const parts = new Map<string, PlacedPart>();
  for (const [id, placed] of Object.entries(sa.parts)) {
    parts.set(id, { ...placed });
  }
  return {
    parts,
    connections: sa.connections.map(c => ({ ...c })),
    _nextId: sa._nextId,
    symmetryPairs: sa.symmetryPairs.map(p => [...p] as [string, string]),
  };
}

// ---------------------------------------------------------------------------
// Serialisation: mutable state → snapshot
// ---------------------------------------------------------------------------

/**
 * Serialise the current PhysicsState to a structured-clone-safe snapshot.
 */
function serialisePhysicsState(ps: PhysicsState): PhysicsSnapshot {
  return {
    posX: ps.posX,
    posY: ps.posY,
    velX: ps.velX,
    velY: ps.velY,
    angle: ps.angle,
    throttle: ps.throttle,
    throttleMode: ps.throttleMode,
    targetTWR: ps.targetTWR,
    firingEngines: _setToArray(ps.firingEngines),
    fuelStore: _mapToRecord(ps.fuelStore),
    activeParts: _setToArray(ps.activeParts),
    deployedParts: _setToArray(ps.deployedParts),
    parachuteStates: _mapToRecord(ps.parachuteStates) as Record<string, SerialisedParachuteEntry>,
    legStates: _mapToRecord(ps.legStates),
    ejectorStates: _mapToRecord(ps.ejectorStates),
    ejectedCrewIds: _setToArray(ps.ejectedCrewIds),
    ejectedCrew: ps.ejectedCrew.map(e => ({
      x: e.x, y: e.y, velX: e.velX, velY: e.velY,
      chuteOpen: e.chuteOpen, chuteTimer: e.chuteTimer,
    })),
    instrumentStates: _mapToRecord(ps.instrumentStates) as Record<string, unknown>,
    scienceModuleStates: _mapToRecord(ps.scienceModuleStates) as Record<string, unknown>,
    heatMap: _mapToRecord(ps.heatMap),
    debris: ps.debris.map(serialiseDebris),
    landed: ps.landed,
    crashed: ps.crashed,
    grounded: ps.grounded,
    angularVelocity: ps.angularVelocity,
    isTipping: ps.isTipping,
    tippingContactX: ps.tippingContactX,
    tippingContactY: ps.tippingContactY,
    controlMode: ps.controlMode as string,
    baseOrbit: ps.baseOrbit,
    dockingAltitudeBand: ps.dockingAltitudeBand as { id: string; name: string } | null,
    dockingOffsetAlongTrack: ps.dockingOffsetAlongTrack,
    dockingOffsetRadial: ps.dockingOffsetRadial,
    rcsActiveDirections: _setToArray(ps.rcsActiveDirections),
    dockingPortStates: _mapToRecord(ps.dockingPortStates),
    weatherIspModifier: ps.weatherIspModifier,
    hasLaunchClamps: ps.hasLaunchClamps,
    powerState: ps.powerState,
    malfunctions: ps.malfunctions
      ? _mapToRecord(ps.malfunctions) as Record<string, { type: string; recovered: boolean }>
      : null,
  };
}

/**
 * Serialise the current FlightState to a structured-clone-safe snapshot.
 */
function serialiseFlightState(fs: FlightState): FlightSnapshot {
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

/**
 * Serialise a debris state to a structured-clone-safe form.
 */
function serialiseDebris(d: {
  id: string;
  activeParts: Set<string>;
  firingEngines: Set<string>;
  fuelStore: Map<string, number>;
  deployedParts: Set<string>;
  parachuteStates: Map<string, any>;
  legStates: Map<string, any>;
  heatMap: Map<string, number>;
  posX: number; posY: number;
  velX: number; velY: number;
  angle: number; throttle: number;
  angularVelocity: number;
  isTipping: boolean;
  tippingContactX: number; tippingContactY: number;
  landed: boolean; crashed: boolean;
}): SerialisedDebrisState {
  return {
    id: d.id,
    activeParts: _setToArray(d.activeParts),
    firingEngines: _setToArray(d.firingEngines),
    fuelStore: _mapToRecord(d.fuelStore),
    deployedParts: _setToArray(d.deployedParts),
    parachuteStates: _mapToRecord(d.parachuteStates),
    legStates: _mapToRecord(d.legStates),
    heatMap: _mapToRecord(d.heatMap),
    posX: d.posX,
    posY: d.posY,
    velX: d.velX,
    velY: d.velY,
    angle: d.angle,
    throttle: d.throttle,
    angularVelocity: d.angularVelocity,
    isTipping: d.isTipping,
    tippingContactX: d.tippingContactX,
    tippingContactY: d.tippingContactY,
    landed: d.landed,
    crashed: d.crashed,
  };
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

/**
 * Handle the 'init' command: receive catalogs, rebuild mutable state.
 */
function handleInit(cmd: InitCommand, post: (msg: WorkerMessage) => void): void {
  assembly = deserialiseAssembly(cmd.assembly);
  ps = deserialisePhysicsState(cmd.physicsState);
  flightState = deserialiseFlightState(cmd.flightState);
  stagingConfig = {
    stages: cmd.stagingConfig.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
    unstaged: [...cmd.stagingConfig.unstaged],
    currentStageIdx: cmd.stagingConfig.currentStageIdx,
  };
  frameCounter = 0;
  initialised = true;

  post({ type: 'ready' });
}

/**
 * Handle the 'tick' command: advance physics, send snapshot.
 */
function handleTick(realDeltaTime: number, timeWarp: number, post: (msg: WorkerMessage) => void): void {
  if (!ps || !assembly || !stagingConfig || !flightState) return;

  // Advance physics simulation.
  tick(ps, assembly, stagingConfig as any, flightState, realDeltaTime, timeWarp);

  // Evaluate flight phase transitions.
  const orbitStatus = checkOrbitStatus(
    ps.posX, ps.posY, ps.velX, ps.velY, flightState.bodyId,
  );
  evaluateAutoTransitions(flightState, ps, orbitStatus);

  frameCounter++;

  // Send snapshot to main thread.
  const msg: SnapshotMessage = {
    type: 'snapshot',
    physics: serialisePhysicsState(ps),
    flight: serialiseFlightState(flightState),
    frame: frameCounter,
  };
  post(msg);
}

// ---------------------------------------------------------------------------
// Message handler (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Process a single command.  In the worker, this is called by onmessage.
 * In unit tests, it can be called directly.
 *
 * @param cmd   The command to process.
 * @param post  Function to send a message back (defaults to self.postMessage
 *              when running in a real worker context).
 */
export function handleCommand(cmd: WorkerCommand, post: (msg: WorkerMessage) => void): void {
  try {
    switch (cmd.type) {
      case 'init':
        handleInit(cmd, post);
        break;

      case 'tick':
        handleTick(cmd.realDeltaTime, cmd.timeWarp, post);
        break;

      case 'setThrottle':
        if (ps) ps.throttle = Math.max(0, Math.min(1, cmd.throttle));
        break;

      case 'setAngle':
        if (ps) ps.angle = cmd.angle;
        break;

      case 'stage':
        if (ps && assembly && stagingConfig && flightState) {
          fireNextStage(ps, assembly, stagingConfig as any, flightState);
        }
        break;

      case 'abort':
        if (flightState) flightState.aborted = true;
        break;

      case 'setTimeWarp':
        // Time warp is handled via tick command parameters.
        // This command is a no-op — the main thread passes warp via tick.
        break;

      case 'keyDown':
        if (ps && assembly) handleKeyDown(ps, assembly, cmd.key);
        break;

      case 'keyUp':
        if (ps) handleKeyUp(ps, cmd.key);
        break;

      case 'stop':
        ps = null;
        flightState = null;
        assembly = null;
        stagingConfig = null;
        initialised = false;
        frameCounter = 0;
        post({ type: 'stopped' });
        break;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// Worker message listener (only attaches in a real worker context)
// ---------------------------------------------------------------------------

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = (event: MessageEvent<WorkerCommand>) => {
    handleCommand(event.data, (msg) => self.postMessage(msg));
  };
}

// ---------------------------------------------------------------------------
// Exported for testing (when imported as a module rather than as a worker)
// ---------------------------------------------------------------------------

export {
  serialisePhysicsState,
  serialiseFlightState,
  deserialisePhysicsState,
  deserialiseFlightState,
  deserialiseAssembly,
  serialiseDebris,
  deserialiseDebris,
};

