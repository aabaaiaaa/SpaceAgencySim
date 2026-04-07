/**
 * physicsWorkerProtocol.ts — Message type definitions for the physics Web Worker.
 *
 * This module defines the communication protocol between the main thread and
 * the physics worker.  It is imported by both sides so message shapes are
 * type-checked at compile time.
 *
 * DESIGN NOTES
 *   - Sets and Maps cannot be sent via postMessage (structured clone doesn't
 *     preserve them).  All serialised snapshots use plain arrays / objects.
 *   - The worker owns mutable PhysicsState + FlightState.  The main thread
 *     receives readonly snapshots for rendering.
 *   - Data catalogs (parts, bodies) are immutable and sent once at init.
 *
 * @module core/physicsWorkerProtocol
 */

import type { OrbitalElements, FlightEvent, PhaseTransition, DockingSystemState, TransferState, PowerState, CommsState } from './gameState.js';
import type { PlacedPart, PartConnection, LegEntry } from './physics.js';
import type { FlightPhase, CelestialBody } from './constants.js';

// ---------------------------------------------------------------------------
// Serialised state shapes (structured-clone-safe)
// ---------------------------------------------------------------------------

/**
 * Parachute entry serialised for postMessage (no Maps/Sets).
 */
export interface SerialisedParachuteEntry {
  state: string;
  deployTimer: number;
  canopyAngle: number;
  canopyAngularVel: number;
  stowTimer?: number;
}

/**
 * Debris state serialised for postMessage.
 * Sets → string[], Maps → Record<string, V>.
 */
export interface SerialisedDebrisState {
  id: string;
  activeParts: string[];
  firingEngines: string[];
  fuelStore: Record<string, number>;
  deployedParts: string[];
  parachuteStates: Record<string, SerialisedParachuteEntry>;
  legStates: Record<string, LegEntry>;
  heatMap: Record<string, number>;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  angle: number;
  throttle: number;
  angularVelocity: number;
  isTipping: boolean;
  tippingContactX: number;
  tippingContactY: number;
  landed: boolean;
  crashed: boolean;
}

/**
 * Ejected crew entry (already plain objects, no conversion needed).
 */
export interface SerialisedEjectedCrewEntry {
  x: number;
  y: number;
  velX: number;
  velY: number;
  chuteOpen: boolean;
  chuteTimer: number;
}

/**
 * Physics state snapshot sent from Worker → Main.
 * All Sets/Maps are converted to arrays/records for structured clone.
 */
export interface PhysicsSnapshot {
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  angle: number;
  throttle: number;
  throttleMode: 'twr' | 'absolute';
  targetTWR: number;
  firingEngines: string[];
  fuelStore: Record<string, number>;
  activeParts: string[];
  deployedParts: string[];
  parachuteStates: Record<string, SerialisedParachuteEntry>;
  legStates: Record<string, LegEntry>;
  ejectorStates: Record<string, string>;
  ejectedCrewIds: string[];
  ejectedCrew: SerialisedEjectedCrewEntry[];
  instrumentStates: Record<string, unknown>;
  scienceModuleStates: Record<string, unknown>;
  heatMap: Record<string, number>;
  debris: SerialisedDebrisState[];
  landed: boolean;
  crashed: boolean;
  grounded: boolean;
  angularVelocity: number;
  isTipping: boolean;
  tippingContactX: number;
  tippingContactY: number;
  controlMode: string;
  baseOrbit: OrbitalElements | null;
  dockingAltitudeBand: { id: string; name: string } | null;
  dockingOffsetAlongTrack: number;
  dockingOffsetRadial: number;
  rcsActiveDirections: string[];
  dockingPortStates: Record<string, string>;
  weatherIspModifier: number;
  hasLaunchClamps: boolean;
  powerState: PowerState | null;
  malfunctions: Record<string, { type: string; recovered: boolean }> | null;
}

/**
 * Flight state snapshot sent from Worker → Main.
 */
export interface FlightSnapshot {
  missionId: string;
  rocketId: string;
  crewIds: string[];
  crewCount: number;
  timeElapsed: number;
  altitude: number;
  velocity: number;
  fuelRemaining: number;
  deltaVRemaining: number;
  events: FlightEvent[];
  aborted: boolean;
  phase: FlightPhase;
  phaseLog: PhaseTransition[];
  inOrbit: boolean;
  orbitalElements: OrbitalElements | null;
  bodyId: CelestialBody;
  orbitBandId: string | null;
  currentBiome: string | null;
  biomesVisited: string[];
  maxAltitude: number;
  maxVelocity: number;
  dockingState: DockingSystemState | null;
  transferState: TransferState | null;
  powerState: PowerState | null;
  commsState: CommsState | null;
}

// ---------------------------------------------------------------------------
// Serialised assembly (structured-clone-safe)
// ---------------------------------------------------------------------------

/**
 * Rocket assembly serialised for postMessage.
 * The parts Map becomes a plain record.
 */
export interface SerialisedAssembly {
  parts: Record<string, PlacedPart>;
  connections: PartConnection[];
  _nextId: number;
  symmetryPairs: Array<[string, string]>;
}

/**
 * Staging config serialised for postMessage.
 */
export interface SerialisedStagingConfig {
  stages: Array<{ instanceIds: string[] }>;
  unstaged: string[];
  currentStageIdx: number;
}

// ---------------------------------------------------------------------------
// Main → Worker commands
// ---------------------------------------------------------------------------

/** Initialise the worker with data catalogs and initial state. */
export interface InitCommand {
  type: 'init';
  /** Part catalog — array of all part definitions. */
  partsCatalog: unknown[];
  /** Celestial body catalog — record of body definitions. */
  bodiesCatalog: Record<string, unknown>;
  /** Initial physics state snapshot. */
  physicsState: PhysicsSnapshot;
  /** Initial flight state. */
  flightState: FlightSnapshot;
  /** Rocket assembly data. */
  assembly: SerialisedAssembly;
  /** Staging configuration. */
  stagingConfig: SerialisedStagingConfig;
}

/** Advance physics by one frame. */
export interface TickCommand {
  type: 'tick';
  /** Real elapsed time since last frame (seconds, capped at 0.1). */
  realDeltaTime: number;
  /** Time warp multiplier (1 = realtime). */
  timeWarp: number;
}

/** Update throttle level. */
export interface SetThrottleCommand {
  type: 'setThrottle';
  /** Throttle value 0–1. */
  throttle: number;
}

/** Fire the next stage. */
export interface StageCommand {
  type: 'stage';
}

/** Abort the flight. */
export interface AbortCommand {
  type: 'abort';
}

/** Change the time warp multiplier. */
export interface SetTimeWarpCommand {
  type: 'setTimeWarp';
  /** New time warp multiplier. */
  timeWarp: number;
}

/** Key down event forwarded to physics. */
export interface KeyDownCommand {
  type: 'keyDown';
  key: string;
}

/** Key up event forwarded to physics. */
export interface KeyUpCommand {
  type: 'keyUp';
  key: string;
}

/** Update the rocket's orientation angle. */
export interface SetAngleCommand {
  type: 'setAngle';
  /** Angle in radians (0 = straight up). */
  angle: number;
}

/** Stop the worker and clean up. */
export interface StopCommand {
  type: 'stop';
}

/** All possible commands from Main → Worker. */
export type WorkerCommand =
  | InitCommand
  | TickCommand
  | SetThrottleCommand
  | SetAngleCommand
  | StageCommand
  | AbortCommand
  | SetTimeWarpCommand
  | KeyDownCommand
  | KeyUpCommand
  | StopCommand;

// ---------------------------------------------------------------------------
// Worker → Main messages
// ---------------------------------------------------------------------------

/** State snapshot after a tick — the primary output. */
export interface SnapshotMessage {
  type: 'snapshot';
  /** Physics state snapshot. */
  physics: PhysicsSnapshot;
  /** Flight state snapshot. */
  flight: FlightSnapshot;
  /** Monotonic frame counter from the worker. */
  frame: number;
}

/** Worker initialised successfully. */
export interface ReadyMessage {
  type: 'ready';
}

/** Worker encountered an error. */
export interface ErrorMessage {
  type: 'error';
  /** Human-readable error message. */
  message: string;
  /** Optional stack trace. */
  stack?: string;
}

/** Worker has stopped cleanly. */
export interface StoppedMessage {
  type: 'stopped';
}

/** All possible messages from Worker → Main. */
export type WorkerMessage =
  | SnapshotMessage
  | ReadyMessage
  | ErrorMessage
  | StoppedMessage;

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

/** Convert a Map to a plain Record for structured clone. */
export function mapToRecord<V>(map: Map<string, V>): Record<string, V> {
  const record: Record<string, V> = Object.create(null);
  for (const [k, v] of map) {
    record[k] = v;
  }
  return record;
}

/** Convert a plain Record back to a Map. */
export function recordToMap<V>(record: Record<string, V>): Map<string, V> {
  const map = new Map<string, V>();
  for (const key of Object.keys(record)) {
    map.set(key, record[key]);
  }
  return map;
}

/** Convert a Set to an array for structured clone. */
export function setToArray<T>(set: Set<T>): T[] {
  return Array.from(set);
}

/** Convert an array back to a Set. */
export function arrayToSet<T>(arr: T[]): Set<T> {
  return new Set(arr);
}
