// ---------------------------------------------------------------------------
// Physics type definitions — interfaces shared across the physics module.
// Extracted from physics.ts so that physics.ts can become a pure barrel.
// ---------------------------------------------------------------------------

import type { MalfunctionType } from '../constants.ts';
import type { AltitudeBand, ControlMode as ControlModeType } from '../constants.ts';
import type {
  FlightState as _FlightState,
  OrbitalElements,
  PowerState,
  GameState,
  InventoryPart,
} from '../gameState.ts';

// ---------------------------------------------------------------------------
// Assembly types
// ---------------------------------------------------------------------------

/** A placed part in the assembly. */
export interface PlacedPart {
  /** Unique ID for this instance in the build session. */
  instanceId: string;
  /** Part catalog ID referencing a PartDef. */
  partId: string;
  /** World X of part centre. */
  x: number;
  /** World Y of part centre (Y-up world space). */
  y: number;
  /** Instrument IDs loaded in this part (science modules only). */
  instruments?: string[];
}

/** One edge in the rocket part graph. */
export interface PartConnection {
  fromInstanceId: string;
  /** Index into the source part's snapPoints array. */
  fromSnapIndex: number;
  toInstanceId: string;
  /** Index into the target part's snapPoints array. */
  toSnapIndex: number;
}

/** The full rocket assembly. */
export interface RocketAssembly {
  /** Instance ID → PlacedPart. */
  parts: Map<string, PlacedPart>;
  /** Array of connections between parts. */
  connections: PartConnection[];
  /** Internal ID counter for generating instanceIds. */
  _nextId: number;
  /** Pairs of mirrored instance IDs [id1, id2]. */
  symmetryPairs: Array<[string, string]>;
}

/** One stage in a staging configuration. */
export interface StageData {
  /** Instance IDs of activatable parts assigned to this stage. */
  instanceIds: string[];
}

/** Staging configuration for a rocket assembly. */
export interface StagingConfig {
  /** Ordered stage slots. Index 0 = Stage 1 (fires first). */
  stages: StageData[];
  /** Instance IDs of activatable parts not yet staged. */
  unstaged: string[];
  /** 0-based index of the next stage to fire (used in flight). */
  currentStageIdx: number;
}

/** One attachment socket on a part definition. */
export interface SnapPoint {
  /** Which face of the part this socket sits on. */
  side: 'top' | 'bottom' | 'left' | 'right';
  /** Horizontal offset from the part's centre in pixels (positive = right). */
  offsetX: number;
  /** Vertical offset from the part's centre in pixels (positive = down). */
  offsetY: number;
  /** PartType values that may connect at this socket. */
  accepts: string[];
}

/** A part definition from the catalog. */
export interface PartDef {
  /** Stable unique identifier. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Short description shown in detail panel. */
  description?: string;
  /** Part category (PartType enum value). */
  type: string;
  /** Dry mass in kg. */
  mass: number;
  /** Purchase price in dollars. */
  cost: number;
  /** Rendered width in pixels at 1× zoom. */
  width: number;
  /** Rendered height in pixels at 1× zoom. */
  height: number;
  /** Attachment sockets. */
  snapPoints: SnapPoint[];
  /** Named visual states for the renderer. */
  animationStates: string[];
  /** True if the player can manually trigger this part in flight. */
  activatable: boolean;
  /** How the part responds when activated (ActivationBehaviour enum value). */
  activationBehaviour: string;
  /** Base reliability rating (0.0–1.0). Defaults to 1.0. */
  reliability?: number;
  /** Type-specific values (thrust, fuel, seats, drag, etc.). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- unstructured property bag varies by part type
  properties: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Per-part lifecycle entries
// ---------------------------------------------------------------------------

/** Per-parachute lifecycle entry. */
export interface ParachuteEntry {
  /** Lifecycle state: 'packed' | 'deploying' | 'deployed' | 'failed'. */
  state: string;
  /** Seconds remaining in deploying animation. */
  deployTimer: number;
  /** Independent canopy orientation (radians, 0 = upright). */
  canopyAngle: number;
  /** Angular velocity of canopy (rad/s). */
  canopyAngularVel: number;
  /** Seconds remaining until auto-stow (post-landing). */
  stowTimer?: number;
}

/** Per-landing-leg lifecycle entry. */
export interface LegEntry {
  /** Lifecycle state: 'retracted' | 'deploying' | 'deployed'. */
  state: string;
  /** Seconds remaining in deploying animation. */
  deployTimer: number;
}

/** Per-instrument experiment lifecycle entry. */
export interface InstrumentStateEntry {
  /** ID of the instrument definition. */
  instrumentId: string;
  /** Instance ID of the parent science module. */
  moduleInstanceId: string;
  /** 0-based slot position within the module. */
  slotIndex: number;
  /** Lifecycle state: 'idle' | 'running' | 'complete' | 'data_returned' | 'transmitted'. */
  state: string;
  /** Countdown in seconds (positive while running). */
  timer: number;
  /** Data type: 'SAMPLE' or 'ANALYSIS'. */
  dataType: string;
  /** Base science points from the instrument definition. */
  baseYield: number;
  /** Biome ID where experiment was started. */
  startBiome: string | null;
  /** Biome ID where experiment completed. */
  completeBiome: string | null;
  /** Biome science multiplier at completion. */
  scienceMultiplier: number;
}

/** Legacy science module state entry. Keyed by module instance ID. */
export interface ScienceModuleStateEntry {
  state: string;
  timer: number;
  startBiome?: string | null;
  completeBiome?: string | null;
  scienceMultiplier?: number;
  recovered?: boolean;
  type?: string;
}

/** Malfunction entry for a part. */
export interface MalfunctionEntry {
  /** MalfunctionType enum value describing the malfunction kind. */
  type: MalfunctionType;
  /** True if the malfunction has been successfully recovered. */
  recovered: boolean;
}

/** Describes a body (asteroid) captured by a grabbing arm and attached to the craft. */
export interface CapturedBody {
  mass: number;           // kg
  radius: number;         // metres
  offset: { x: number; y: number };  // craft-local frame
  name: string;           // for UI display
}

/**
 * Subset of PhysicsState / DebrisState fields shared by mass/geometry helpers.
 * Both PhysicsState and DebrisState satisfy this constraint so that
 * _computeTotalMass, _computeCoMLocal, and _computeMomentOfInertia can
 * operate on either.
 */
export interface MassQueryable {
  activeParts: Set<string>;
  fuelStore: Map<string, number>;
  /** Captured body attached to the craft, null when none captured. Optional for DebrisState. */
  capturedBody?: CapturedBody | null;
}

/** A debris fragment simulated after stage separation. */
export interface DebrisState {
  /** Unique fragment identifier (e.g. 'debris-1'). */
  id: string;
  /** Instance IDs of parts in this fragment. */
  activeParts: Set<string>;
  /** Instance IDs of engines/SRBs still burning. */
  firingEngines: Set<string>;
  /** Remaining propellant (kg) per instance ID. */
  fuelStore: Map<string, number>;
  /** Instance IDs of deployed parachutes/legs. */
  deployedParts: Set<string>;
  /** Parachute lifecycle states per instance ID. */
  parachuteStates: Map<string, ParachuteEntry>;
  /** Landing leg lifecycle states per instance ID. */
  legStates: Map<string, LegEntry>;
  /** Accumulated reentry heat per instance ID. */
  heatMap: Map<string, number>;
  /** Horizontal position (m). */
  posX: number;
  /** Vertical position (m, 0 = ground). */
  posY: number;
  /** Horizontal velocity (m/s). */
  velX: number;
  /** Vertical velocity (m/s). */
  velY: number;
  /** Orientation (radians, 0 = straight up). */
  angle: number;
  /** Throttle (always 1.0 for debris). */
  throttle: number;
  /** Angular velocity (rad/s). */
  angularVelocity: number;
  /** True when on ground and tilted. */
  isTipping: boolean;
  /** Ground contact pivot X (VAB local pixels). */
  tippingContactX: number;
  /** Ground contact pivot Y (VAB local pixels). */
  tippingContactY: number;
  /** True after safe touchdown. */
  landed: boolean;
  /** True after high-speed impact. */
  crashed: boolean;
  /** Collision cooldown ticks remaining after separation. */
  collisionCooldown?: number;
}

// ---------------------------------------------------------------------------
// PhysicsState
// ---------------------------------------------------------------------------

/** An ejected crew capsule tracked for physics/rendering. */
export interface EjectedCrewEntry {
  x: number;
  y: number;
  velX: number;
  velY: number;
  hasChute?: boolean;
  chuteOpen: boolean;
  chuteTimer: number;
}

/** A 2D point in VAB local pixel coordinates. */
export interface Point2D {
  x: number;
  y: number;
}

/** Entry in the bottom-part-layer array used for cascading destruction. */
export interface BottomLayerEntry {
  instanceId: string;
  bottomY: number;
  placed: PlacedPart;
  def: PartDef;
}

/** Corner entry used for ground-contact softmax computation. */
export interface CornerEntry {
  cx: number;
  cy: number;
  gp: number;
}

/**
 * Internal physics state for an active flight.
 *
 * This object is created once per launch via createPhysicsState and
 * mutated in-place on every tick.  It is NOT part of the serialised
 * GameState — the higher-level FlightState in gameState.ts carries the
 * persisted snapshot.
 */
export interface PhysicsState {
  /** Horizontal position (m; 0 = launch pad). */
  posX: number;
  /** Vertical position (m; 0 = ground). */
  posY: number;
  /** Horizontal velocity (m/s). */
  velX: number;
  /** Vertical velocity (m/s). */
  velY: number;
  /** Rocket orientation (radians; 0 = straight up). */
  angle: number;
  /** Current throttle level (0 – 1; 1 = 100 %). */
  throttle: number;
  /** Throttle mode: 'twr' (TWR-relative) or 'absolute'. */
  throttleMode: 'twr' | 'absolute';
  /** Target TWR when in TWR throttle mode. */
  targetTWR: number;
  /** Instance IDs of currently burning engines/SRBs. */
  firingEngines: Set<string>;
  /** Remaining propellant per part (kg). Keyed by instance ID. */
  fuelStore: Map<string, number>;
  /** Instance IDs of parts still attached to the rocket. */
  activeParts: Set<string>;
  /** Instance IDs of parachutes/legs that have been deployed. */
  deployedParts: Set<string>;
  /** Detailed lifecycle state for each PARACHUTE part. Keyed by instance ID. */
  parachuteStates: Map<string, ParachuteEntry>;
  /** Detailed lifecycle state for each LANDING_LEGS/LANDING_LEG part. Keyed by instance ID. */
  legStates: Map<string, LegEntry>;
  /** Armed/activated state for each ejector-seat-capable COMMAND_MODULE. Keyed by instance ID. */
  ejectorStates: Map<string, string>;
  /** IDs of crew members who have safely ejected during this flight. */
  ejectedCrewIds: Set<string>;
  /** Visible ejected crew capsules. */
  ejectedCrew: EjectedCrewEntry[];
  /** Per-instrument experiment lifecycle state. Keyed by compound key. */
  instrumentStates: Map<string, InstrumentStateEntry>;
  /** Legacy module-level summary state. Keyed by module instance ID. */
  scienceModuleStates: Map<string, ScienceModuleStateEntry>;
  /** Accumulated reentry heat per part (heat units). Keyed by instance ID. */
  heatMap: Map<string, number>;
  /** Jettisoned stage fragments simulated independently. */
  debris: DebrisState[];
  /** True after a successful soft touchdown. */
  landed: boolean;
  /** True after a fatal impact. */
  crashed: boolean;
  /** True while still sitting on the launch pad. */
  grounded: boolean;
  /** Angular velocity (rad/s; positive = clockwise). */
  angularVelocity: number;
  /** True when tilted on ground. */
  isTipping: boolean;
  /** Ground contact pivot X in VAB local pixels. */
  tippingContactX: number;
  /** Ground contact pivot Y in VAB local pixels. */
  tippingContactY: number;
  /** Keys currently held down (for continuous steering). */
  _heldKeys: Set<string>;
  /** Leftover simulation time from the previous frame. */
  _accumulator: number;
  /** Current control mode (ControlMode enum). */
  controlMode: ControlModeType;
  /** Frozen orbital elements in docking mode. */
  baseOrbit: OrbitalElements | null;
  /** Altitude band when docking mode entered. */
  dockingAltitudeBand: AltitudeBand | null;
  /** Along-track offset in docking (m). */
  dockingOffsetAlongTrack: number;
  /** Radial offset in docking (m). */
  dockingOffsetRadial: number;
  /** Active RCS thrust dirs for plume rendering. */
  rcsActiveDirections: Set<string>;
  /** Docking port states: instanceId -> 'retracted'|'extended'|'docked'. */
  dockingPortStates: Map<string, string>;
  /** Combined mass when docked (0 = not docked). */
  _dockedCombinedMass: number;
  /** Captured body (asteroid) attached to the craft, null when none captured. */
  capturedBody: CapturedBody | null;
  /** True when thrust is aligned through the combined CoM after asteroid capture. */
  thrustAligned: boolean;
  /** Weather-based ISP modifier (0.95–1.05). */
  weatherIspModifier: number;
  /** Weather wind speed in m/s (0 = calm). */
  weatherWindSpeed: number;
  /** Weather wind angle in radians (0 = east). */
  weatherWindAngle: number;
  /** True while launch clamps are still active. */
  hasLaunchClamps: boolean;
  /** Power system state. */
  powerState: PowerState | null;
  /** Per-part malfunction entries. */
  malfunctions?: Map<string, MalfunctionEntry>;
  /** Malfunction mode (serialized to worker; mirrors gameState.malfunctionMode). */
  malfunctionMode?: string;
  /** Reference to game state (set by flightController). */
  _gameState?: GameState;
  /** Cached contact corner X for tipping. */
  _contactCX?: number;
  /** Cached contact corner Y for tipping. */
  _contactCY?: number;
  /** True when a malfunction check is pending after biome transition. */
  _malfunctionCheckPending?: boolean;
  /** Countdown timer for pending malfunction check (seconds). */
  _malfunctionCheckTimer?: number;
  /** Map of instanceId → InventoryPart for parts sourced from inventory (wear tracking). */
  _usedInventoryParts?: Map<string, InventoryPart>;
}
