/**
 * types.ts — Read-only snapshot interfaces for the render layer.
 *
 * The render layer receives game state by reference but must never mutate it.
 * These interfaces enforce that contract at compile time using ReadonlySet and
 * ReadonlyMap, which strip mutation methods (add, delete, set, clear).
 *
 * Both the mutable PhysicsState (main-thread fallback) and reconstituted
 * worker snapshots satisfy these interfaces, so render code has a single
 * type contract regardless of physics mode.
 */

import type { ControlMode, FlightPhase } from '../core/constants.ts';
import type { OrbitalElements, PowerState, TransferState, GameState, SurfaceItem } from '../core/gameState.ts';
import type { PlacedPart, PartConnection, LegEntry, ParachuteEntry } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Ejected crew
// ---------------------------------------------------------------------------

/** Visible ejected crew capsule in the flight scene. */
export interface ReadonlyEjectedCrew {
  readonly x: number;
  readonly y: number;
  readonly velX: number;
  readonly velY: number;
  readonly chuteOpen: boolean;
  readonly chuteTimer: number;
}

// ---------------------------------------------------------------------------
// Malfunction entry
// ---------------------------------------------------------------------------

/** Per-part malfunction data for render overlays. */
export interface ReadonlyMalfunctionEntry {
  readonly type: string;
  readonly recovered: boolean;
}

// ---------------------------------------------------------------------------
// Debris
// ---------------------------------------------------------------------------

/** Read-only debris fragment for render functions. */
export interface ReadonlyDebrisState {
  readonly id: string;
  readonly activeParts: ReadonlySet<string>;
  readonly firingEngines: ReadonlySet<string>;
  readonly fuelStore: ReadonlyMap<string, number>;
  readonly deployedParts: ReadonlySet<string>;
  readonly parachuteStates: ReadonlyMap<string, ParachuteEntry>;
  readonly legStates: ReadonlyMap<string, LegEntry>;
  readonly heatMap: ReadonlyMap<string, number>;
  readonly posX: number;
  readonly posY: number;
  readonly velX: number;
  readonly velY: number;
  readonly angle: number;
  readonly throttle: number;
  readonly angularVelocity: number;
  readonly isTipping: boolean;
  readonly tippingContactX: number;
  readonly tippingContactY: number;
  readonly landed: boolean;
  readonly crashed: boolean;
}

// ---------------------------------------------------------------------------
// Physics state
// ---------------------------------------------------------------------------

/** Read-only view of PhysicsState for render functions. */
export interface ReadonlyPhysicsState {
  readonly posX: number;
  readonly posY: number;
  readonly velX: number;
  readonly velY: number;
  readonly angle: number;
  readonly throttle: number;
  readonly activeParts: ReadonlySet<string>;
  readonly fuelStore: ReadonlyMap<string, number>;
  readonly firingEngines: ReadonlySet<string>;
  readonly deployedParts: ReadonlySet<string>;
  readonly parachuteStates: ReadonlyMap<string, ParachuteEntry>;
  readonly legStates: ReadonlyMap<string, LegEntry>;
  readonly heatMap: ReadonlyMap<string, number>;
  readonly malfunctions?: ReadonlyMap<string, ReadonlyMalfunctionEntry> | null;
  readonly debris: readonly ReadonlyDebrisState[];
  readonly ejectedCrew: readonly ReadonlyEjectedCrew[];
  readonly grounded: boolean;
  readonly landed: boolean;
  readonly crashed: boolean;
  readonly angularVelocity: number;
  readonly isTipping: boolean;
  readonly tippingContactX: number;
  readonly tippingContactY: number;
  readonly controlMode: ControlMode;
  readonly baseOrbit: OrbitalElements | null;
  readonly dockingOffsetAlongTrack: number;
  readonly dockingOffsetRadial: number;
  readonly rcsActiveDirections: ReadonlySet<string>;
  readonly dockingPortStates: ReadonlyMap<string, string>;
  readonly weatherIspModifier: number;
  readonly hasLaunchClamps: boolean;
  readonly powerState: PowerState | null;
}

// ---------------------------------------------------------------------------
// Flight state
// ---------------------------------------------------------------------------

/**
 * Read-only view of FlightState for the map renderer.
 *
 * Contains only the fields the map actually reads.  The flight renderer
 * uses its own narrower `FlightStateArg` locally.  Both the mutable
 * `FlightState` and reconstituted worker snapshots satisfy this interface.
 */
export interface ReadonlyFlightState {
  readonly phase: FlightPhase;
  readonly transferState: Readonly<TransferState> | null;
  readonly orbitalElements: Readonly<OrbitalElements> | null;
  readonly timeElapsed: number;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Read-only view of RocketAssembly for render functions. */
export interface ReadonlyAssembly {
  readonly parts: ReadonlyMap<string, PlacedPart>;
  readonly connections: readonly PartConnection[];
}

// ---------------------------------------------------------------------------
// Game state (top-level, for map/overlay rendering)
// ---------------------------------------------------------------------------

/**
 * Read-only view of the top-level GameState for map/overlay rendering.
 */
export type ReadonlyGameState = Readonly<GameState>;

// ---------------------------------------------------------------------------
// Surface items
// ---------------------------------------------------------------------------

/** Read-only view of a SurfaceItem. */
export type ReadonlySurfaceItem = Readonly<SurfaceItem>;
