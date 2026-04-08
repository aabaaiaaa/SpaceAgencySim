/**
 * physics.ts — Flight physics simulation engine.
 *
 * Fixed-timestep integration loop at dt = 1/60 s, scaled by a time-warp
 * multiplier.  Each integration step:
 *   1. Compute total rocket mass (dry parts + remaining fuel).
 *   2. Compute net thrust from all firing engines/SRBs.
 *   3. Apply gravity: body-specific, inverse-square law from surface.
 *   4. Compute atmospheric drag using an exponential density model.
 *   5. Integrate Newton's 2nd law → update velocity and position.
 *   6. Consume fuel from tanks/SRBs proportional to engine mass-flow rate.
 *   7. Clamp to ground plane and emit landing/crash events.
 *
 * COORDINATE SYSTEM
 *   posX / velX = horizontal (positive = right)
 *   posY / velY = vertical   (positive = up, matches world space in rocketbuilder)
 *   angle       = rocket orientation in radians
 *                 0 = pointing straight up (+Y)
 *                 positive = tilted clockwise / to the right
 *
 * STEERING
 *   A / D (or ArrowLeft / ArrowRight) keys apply a rotation rate to the
 *   rocket's orientation.  Hold the key to keep turning.
 *   In vacuum (altitude > 70 000 m) with an RCS-capable command module the
 *   turn rate is multiplied by RCS_TURN_MULTIPLIER (×2.5).
 *
 * THROTTLE
 *   W / ArrowUp  increase throttle by 5 % per keypress.
 *   S / ArrowDown decrease throttle by 5 % per keypress.
 *   Range 0 – 100 %.  SRBs always run at full thrust and ignore throttle.
 *
 * STAGING
 *   Spacebar calls fireNextStage(), which advances the StagingConfig and
 *   activates each part in the just-fired stage.
 *
 * PUBLIC API
 *   createPhysicsState(assembly, flightState)                      → PhysicsState
 *   tick(ps, assembly, stagingConfig, flightState, realDt, warp)   → void
 *   handleKeyDown(ps, assembly, key)                               → void
 *   handleKeyUp(ps, key)                                           → void
 *   fireNextStage(ps, assembly, stagingConfig, flightState)        → void
 *
 * @module physics
 */

import { getPartById } from '../data/parts.ts';
import { PartType, ControlMode, BODY_RADIUS } from './constants.ts';
import {
  airDensity,
  airDensityForBody,
  ATMOSPHERE_TOP,
  SEA_LEVEL_DENSITY,
  updateHeat,
  updateSolarHeat,
} from './atmosphere.ts';
import {
  getSurfaceGravity,
  hasAtmosphere,
  getAtmosphereTop,
  getAirDensity as bodyAirDensity,
} from '../data/bodies.ts';
import { tickFuelSystem } from './fuelsystem.ts';
import { activateCurrentStage, tickDebris } from './staging.ts';
import { tickCollisions } from './collision.ts';
import {
  initParachuteStates,
  tickParachutes,
  tickCanopyAngles,
  tickLandedParachutes,
  ParachuteState,
  DEPLOY_DURATION,
  LOW_DENSITY_THRESHOLD,
} from './parachute.ts';
import {
  initLegStates,
  tickLegs,
  countDeployedLegs,
  getDeployedLegFootOffset,
  LegState,
} from './legs.ts';
import { initEjectorStates } from './ejector.ts';
import {
  initScienceModuleStates,
  tickScienceModules,
  onSafeLanding,
} from './sciencemodule.ts';
import { getBiomeId } from './biomes.ts';
import {
  initMalfunctionState,
  checkMalfunctions,
  tickMalfunctions,
  hasMalfunction,
  getMalfunction,
} from './malfunction.ts';
import { MalfunctionType, REDUCED_THRUST_FACTOR, PARTIAL_CHUTE_FACTOR } from './constants.ts';
import { getWindForce, getCurrentWeather } from './weather.ts';
import { initPowerState, tickPower, recalcPowerState } from './power.ts';
import { getOrbitalStateAtTime } from './orbit.ts';

import type { AltitudeBand, ControlMode as ControlModeType } from './constants.ts';
import type { FlightState, FlightEvent, OrbitalElements, PowerState, GameState, InventoryPart } from './gameState.ts';

// ---------------------------------------------------------------------------
// Types for modules still in .js
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
interface StageData {
  /** Instance IDs of activatable parts assigned to this stage. */
  instanceIds: string[];
}

/** Staging configuration for a rocket assembly. */
interface StagingConfig {
  /** Ordered stage slots. Index 0 = Stage 1 (fires first). */
  stages: StageData[];
  /** Instance IDs of activatable parts not yet staged. */
  unstaged: string[];
  /** 0-based index of the next stage to fire (used in flight). */
  currentStageIdx: number;
}

/** One attachment socket on a part definition. */
interface SnapPoint {
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
interface PartDef {
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

/** A debris fragment simulated after stage separation. */
interface DebrisState {
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
interface MalfunctionEntry {
  /** MalfunctionType enum value describing the malfunction kind. */
  type: MalfunctionType;
  /** True if the malfunction has been successfully recovered. */
  recovered: boolean;
}

/**
 * Subset of PhysicsState / DebrisState fields shared by mass/geometry helpers.
 * Both PhysicsState and DebrisState satisfy this constraint so that
 * _computeTotalMass, _computeCoMLocal, and _computeMomentOfInertia can
 * operate on either.
 */
interface MassQueryable {
  activeParts: Set<string>;
  fuelStore: Map<string, number>;
}

// ---------------------------------------------------------------------------
// PhysicsState interface
// ---------------------------------------------------------------------------

/**
 * Internal physics state for an active flight.
 *
 * This object is created once per launch via {@link createPhysicsState} and
 * mutated in-place on every {@link tick}.  It is NOT part of the serialised
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

/** An ejected crew capsule tracked for physics/rendering. */
interface EjectedCrewEntry {
  x: number;
  y: number;
  velX: number;
  velY: number;
  hasChute?: boolean;
  chuteOpen: boolean;
  chuteTimer: number;
}

/** Result of thrust calculation. */
interface ThrustResult {
  thrustX: number;
  thrustY: number;
}

/** A 2D point in VAB local pixel coordinates. */
interface Point2D {
  x: number;
  y: number;
}

/** Entry in the bottom-part-layer array used for cascading destruction. */
interface BottomLayerEntry {
  instanceId: string;
  bottomY: number;
  placed: PlacedPart;
  def: PartDef;
}

/** Corner entry used for ground-contact softmax computation. */
interface CornerEntry {
  cx: number;
  cy: number;
  gp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard gravity (m/s²). */
const G0: number = 9.81;

/** Fixed physics timestep (seconds). */
const FIXED_DT: number = 1 / 60;

/** Scale factor: metres per pixel at default 1× zoom. */
const SCALE_M_PER_PX: number = 0.05;

/**
 * Base rocket turn rate in radians/second.
 * At 30°/s, a 90° turn takes 3 seconds — deliberately sluggish.
 */
const BASE_TURN_RATE: number = Math.PI / 6;

/** Turn-rate multiplier applied when RCS is available in vacuum. */
const RCS_TURN_MULTIPLIER: number = 2.5;

/** Throttle change per keypress (5 %). */
const THROTTLE_STEP: number = 0.05;

/** Target TWR change per keypress in TWR mode. */
const TWR_STEP: number = 0.1;

/**
 * Drag coefficient multiplier applied to an open parachute.
 * An open chute is modelled as having 80× its stowed Cd — very high drag.
 */
const CHUTE_DRAG_MULTIPLIER: number = 80;

/** Landing speed below which a contact is considered "safe" (m/s). */
const DEFAULT_SAFE_LANDING_SPEED: number = 10;

/** Default crash threshold (m/s) for parts without an explicit crashThreshold. */
const DEFAULT_CRASH_THRESHOLD: number = 10;

// -- Ground tipping constants ------------------------------------------------
/** N·m of torque applied by player A/D input while grounded. */
const PLAYER_TIP_TORQUE: number = 50_000;
/** Angle (radians) past which a grounded tipping rocket crashes (~80°). */
const TOPPLE_CRASH_ANGLE: number = Math.PI * 0.44;
/** Per-tick angular velocity damping while tipping on the ground. */
const GROUND_ANGULAR_DAMPING: number = 0.98;
/** Maximum angular acceleration (rad/s²) from player tipping input. */
const MAX_PLAYER_TIP_ACCEL: number = 10.0;
/** Angle threshold below which a near-upright rocket snaps to 0. */
const TILT_SNAP_THRESHOLD: number = 0.005;
/** Angular velocity threshold below which snap to rest. */
const ANGULAR_VEL_SNAP_THRESHOLD: number = 0.05;

// -- Airborne torque-based rotation constants --------------------------------
/** N·m of torque applied by player A/D input while airborne. */
const PLAYER_FLIGHT_TORQUE: number = 2000;
/** Torque multiplier when in vacuum with RCS-capable command module. */
const RCS_TORQUE_MULTIPLIER: number = 2.5;
/** Angular damping coefficient in atmosphere (proportional to density). */
const AERO_ANGULAR_DAMPING: number = 0.02;
/** Active RCS braking torque (N·m per rad/s) when keys released. */
const RCS_ANGULAR_DAMPING: number = 3.0;
/** Tuning knob for parachute stabilization torque strength. */
const CHUTE_TORQUE_SCALE: number = 3.0;
/** Angular velocity decay rate (1/s) for deployed parachutes. */
const CHUTE_DIRECT_DAMPING: number = 5.0;
/** Maximum angular acceleration (rad/s²) from player input. */
const MAX_PLAYER_ANGULAR_ACCEL: number = 2.0;
/** Maximum angular acceleration (rad/s²) from parachute torques. */
const MAX_CHUTE_ANGULAR_ACCEL: number = 50.0;

// ---------------------------------------------------------------------------
// Multi-body gravity helper
// ---------------------------------------------------------------------------

/**
 * Compute gravitational acceleration at a given altitude above a celestial body.
 *
 * Uses inverse-square law: g = g₀ × (R / (R + h))²
 * Falls back to Earth's 9.81 m/s² if bodyId is undefined.
 */
function _gravityForBody(bodyId: string | undefined, altitude: number): number {
  const g0: number = bodyId ? getSurfaceGravity(bodyId) : G0;
  const R: number = bodyId ? (BODY_RADIUS[bodyId] ?? 6_371_000) : 6_371_000;
  const h: number = Math.max(0, altitude);
  // Inverse-square: negligible effect at low altitudes, significant in orbit.
  return g0 * (R * R) / ((R + h) * (R + h));
}

/**
 * Look up the highest value of a crew skill among the flight's crew.
 * Uses ps._gameState (set by flightController) and flightState.crewIds.
 */
function _getMaxCrewSkill(
  ps: PhysicsState,
  flightState: FlightState | null,
  skill: 'piloting' | 'engineering' | 'science',
): number {
  const gameState = ps?._gameState;
  const crewIds = flightState?.crewIds;
  if (!gameState || !crewIds || !crewIds.length) return 0;

  let max = 0;
  for (const id of crewIds) {
    const member = gameState.crew?.find((c) => c.id === id);
    if (member?.skills?.[skill] != null) {
      max = Math.max(max, member.skills[skill]);
    }
  }
  return max;
}

/**
 * Return the atmospheric density for the current flight body.
 * Delegates to body-aware density when bodyId is present, otherwise
 * falls back to Earth's default model.
 */
function _densityForBody(altitude: number, bodyId: string | undefined): number {
  if (bodyId && bodyId !== 'EARTH') {
    return airDensityForBody(altitude, bodyId);
  }
  return airDensity(altitude);
}

/**
 * Return the atmosphere top altitude for a body.
 * Falls back to Earth's ATMOSPHERE_TOP if bodyId is not given.
 */
function _atmosphereTopForBody(bodyId: string | undefined): number {
  if (bodyId && bodyId !== 'EARTH') {
    return getAtmosphereTop(bodyId);
  }
  return ATMOSPHERE_TOP;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an initial PhysicsState for a rocket about to launch.
 *
 * Populates the fuel store from tank/SRB `fuelMass` properties and marks
 * every part in the assembly as active.
 */
export function createPhysicsState(assembly: RocketAssembly, flightState: FlightState): PhysicsState {
  const fuelStore = new Map<string, number>();
  let totalFuel = 0;

  for (const [instanceId, placed] of assembly.parts) {
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass: number = def.properties?.fuelMass ?? 0;
    if (fuelMass > 0) {
      fuelStore.set(instanceId, fuelMass);
      totalFuel += fuelMass;
    }
  }

  // Seed the FlightState with the full fuel load.
  if (flightState) {
    flightState.fuelRemaining = totalFuel;
  }

  const ps: PhysicsState = {
    posX: 0,
    posY: 0,
    velX: 0,
    velY: 0,
    angle: 0,
    throttle: 1.0,
    throttleMode: 'twr',       // 'twr' or 'absolute'
    targetTWR: 1.1,            // desired TWR; default to efficient ascent
    firingEngines: new Set(),
    fuelStore,
    activeParts: new Set(assembly.parts.keys()),
    deployedParts: new Set(),
    parachuteStates: new Map(),
    legStates: new Map(),
    ejectorStates: new Map(),
    ejectedCrewIds: new Set(),
    ejectedCrew: [],
    instrumentStates: new Map(),
    scienceModuleStates: new Map(),
    heatMap: new Map(),
    debris: [],
    landed: false,
    crashed: false,
    grounded: true,
    angularVelocity: 0,
    isTipping: false,
    tippingContactX: 0,
    tippingContactY: 0,
    _heldKeys: new Set(),
    _accumulator: 0,
    // -- Control mode state (TASK-005) --
    controlMode: ControlMode.NORMAL,
    baseOrbit: null,
    dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0,
    dockingOffsetRadial: 0,
    rcsActiveDirections: new Set(),
    dockingPortStates: new Map(),
    _dockedCombinedMass: 0,
    weatherIspModifier: 1.0,
    weatherWindSpeed: 0,
    weatherWindAngle: 0,
    hasLaunchClamps: false,
    powerState: null,
  };

  // Detect launch clamps in the assembly.
  for (const [instanceId, placed] of assembly.parts) {
    const clampDef: PartDef | undefined = getPartById(placed.partId);
    if (clampDef && clampDef.type === PartType.LAUNCH_CLAMP) {
      ps.hasLaunchClamps = true;
      break;
    }
  }

  // Initialise the parachute state machine for all PARACHUTE parts in the assembly.
  initParachuteStates(ps, assembly);

  // Initialise the landing leg state machine for all LANDING_LEGS/LANDING_LEG parts.
  initLegStates(ps, assembly);

  // Initialise the ejector seat state machine for all crewed COMMAND_MODULE parts.
  initEjectorStates(ps, assembly);

  // Initialise the science module state machine for all SERVICE_MODULE parts
  // with COLLECT_SCIENCE activation behaviour.
  initScienceModuleStates(ps, assembly);

  // Initialise the malfunction system for all parts.
  initMalfunctionState(ps, assembly);

  // Initialise docking port states.
  for (const [instanceId, placed] of assembly.parts) {
    const def: PartDef | undefined = getPartById(placed.partId);
    if (def && def.type === PartType.DOCKING_PORT) {
      ps.dockingPortStates.set(instanceId, 'retracted');
    }
  }

  // Initialise the power system (solar panels, batteries, built-in power).
  ps.powerState = initPowerState(assembly, ps.activeParts);

  // Flag on flightState so mission objective checking knows whether science
  // modules are present (used to gate HOLD_ALTITUDE time accumulation).
  if (flightState) {
    flightState.hasScienceModules = ps.scienceModuleStates.size > 0 || ps.instrumentStates.size > 0;
    flightState.scienceModuleRunning = false;
    flightState.powerState = ps.powerState;
  }

  return ps;
}

// ---------------------------------------------------------------------------
// Public API — Tick
// ---------------------------------------------------------------------------

/**
 * Advance the physics simulation by one real-time frame.
 *
 * Uses a fixed-step accumulator so the simulation is decoupled from the
 * render frame rate.  Pass the real elapsed seconds since the previous call.
 *
 * After this call, `flightState.altitude`, `flightState.velocity`, and
 * `flightState.fuelRemaining` reflect the updated simulation state.
 * New events may have been appended to `flightState.events`.
 */
export function tick(
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
  realDeltaTime: number,
  timeWarp: number = 1,
): void {
  // Allow re-liftoff from a landed state when engines are producing thrust.
  if (ps.landed && ps.firingEngines.size > 0 && ps.throttle > 0) {
    ps.landed = false;
    ps.grounded = true;
  }

  if (ps.crashed || flightState.aborted) return;

  // When landed: run tipping physics and/or parachute post-landing swing.
  if (ps.landed) {
    const left  = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
    const right = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');
    let needsTipping = ps.isTipping || left || right ||
      Math.abs(ps.angle) > TILT_SNAP_THRESHOLD ||
      Math.abs(ps.angularVelocity) > ANGULAR_VEL_SNAP_THRESHOLD;
    // Smooth settle: when tipping physics is no longer needed but angle/velocity
    // are not yet exactly zero, decay them gradually to avoid a visible jump.
    if (!needsTipping && (ps.angle !== 0 || ps.angularVelocity !== 0)) {
      ps.angle *= 0.9;
      ps.angularVelocity *= 0.85;
      ps.isTipping = false;
      if (Math.abs(ps.angle) < 1e-4 && Math.abs(ps.angularVelocity) < 1e-4) {
        ps.angle = 0;
        ps.angularVelocity = 0;
        ps._contactCX = undefined;
        ps._contactCY = undefined;
      }
    }
    const needsParachuteTick = _hasActiveParachutes(ps);

    if (needsTipping || needsParachuteTick) {
      ps._accumulator += realDeltaTime * timeWarp;
      while (ps._accumulator >= FIXED_DT) {
        ps._accumulator -= FIXED_DT;
        if (needsTipping) {
          _applyGroundedSteering(ps, assembly, left, right, FIXED_DT);
          // No topple crash for landed vessels — tipping over from rest is
          // harmless. _checkToppleCrash only applies to grounded (launch pad).
        }
        if (needsParachuteTick) {
          tickLandedParachutes(ps, FIXED_DT);
        }
        flightState.timeElapsed += FIXED_DT;

        // Advance debris while tipping.
        for (const debris of ps.debris) {
          tickDebris(debris, assembly, FIXED_DT);
          if (debris.landed && !debris.crashed) tickDebrisGround(debris, assembly, FIXED_DT, flightState?.bodyId);
        }
        tickCollisions(ps, assembly, FIXED_DT);

        if (ps.crashed) break;
      }
      if (ps._accumulator > FIXED_DT * 10) {
        ps._accumulator = FIXED_DT * 10;
      }
      _syncFlightState(ps, assembly, flightState);
    }
    return;
  }

  // Scale real time by the warp factor and add to the accumulator.
  ps._accumulator += realDeltaTime * timeWarp;

  // Run as many fixed-step iterations as the accumulator allows.
  while (ps._accumulator >= FIXED_DT) {
    ps._accumulator -= FIXED_DT;
    _integrate(ps, assembly, flightState);
    flightState.timeElapsed += FIXED_DT;

    // Advance all debris fragments by the same fixed timestep.
    for (const debris of ps.debris) {
      tickDebris(debris, assembly, FIXED_DT);
      if (debris.landed && !debris.crashed) tickDebrisGround(debris, assembly, FIXED_DT, flightState?.bodyId);
    }
    tickCollisions(ps, assembly, FIXED_DT);

    // Stop integrating if the flight has ended this step.
    if (ps.landed || ps.crashed) break;
  }

  // Cap the accumulator so a lag spike doesn't cause a physics explosion.
  if (ps._accumulator > FIXED_DT * 10) {
    ps._accumulator = FIXED_DT * 10;
  }

  _syncFlightState(ps, assembly, flightState);
}

// ---------------------------------------------------------------------------
// Public API — Input handling
// ---------------------------------------------------------------------------

/**
 * Handle a key-down event.
 *
 * One-shot actions (throttle change) are processed immediately.
 * Continuous actions (steering) are recorded in `ps._heldKeys` and applied
 * each integration step.
 */
export function handleKeyDown(ps: PhysicsState, assembly: RocketAssembly, key: string): void {
  ps._heldKeys.add(key);

  // In docking/RCS modes, W/S/A/D are handled continuously by
  // _applyDockingMovement — skip one-shot throttle changes.
  const isDockingOrRcs = ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS;
  if (isDockingOrRcs) {
    // Only allow X (cut throttle) and Z (max throttle) as safety overrides.
    switch (key) {
      case 'x': case 'X': ps.throttle = 0; break;
      case 'z': case 'Z': ps.throttle = 0; break; // In docking, Z also cuts (no full thrust)
    }
    return;
  }

  const twrMode = ps.throttleMode === 'twr';

  switch (key) {
    case 'w':
    case 'ArrowUp':
    case 'Shift':
      if (twrMode) {
        ps.targetTWR = ps.targetTWR === Infinity
          ? Infinity
          : ps.targetTWR + TWR_STEP;
      } else {
        ps.throttle = Math.min(1, ps.throttle + THROTTLE_STEP);
      }
      break;
    case 's':
    case 'ArrowDown':
    case 'Control':
      if (twrMode) {
        ps.targetTWR = ps.targetTWR === Infinity
          ? Math.max(0, 10 - TWR_STEP) // step down from "max" to a large finite value
          : Math.max(0, ps.targetTWR - TWR_STEP);
      } else {
        ps.throttle = Math.max(0, ps.throttle - THROTTLE_STEP);
      }
      break;
    case 'x':
    case 'X':
      if (twrMode) {
        ps.targetTWR = 0;
        ps.throttle  = 0;
      } else {
        ps.throttle = 0;
      }
      break;
    case 'z':
    case 'Z':
      if (twrMode) {
        ps.targetTWR = Infinity;
        ps.throttle  = 1;
      } else {
        ps.throttle = 1;
      }
      break;
    // A/D and ArrowLeft/ArrowRight are handled continuously in _integrate.
    default:
      break;
  }
}

/**
 * Handle a key-up event.
 * Removes the key from the held-key set so continuous steering stops.
 */
export function handleKeyUp(ps: PhysicsState, key: string): void {
  ps._heldKeys.delete(key);
}

// ---------------------------------------------------------------------------
// Public API — Staging
// ---------------------------------------------------------------------------

/**
 * Fire the next stage (called when the player presses Spacebar).
 *
 * Delegates to {@link activateCurrentStage} (staging.js) which activates each
 * part in the current stage and creates {@link DebrisState} objects for any
 * rocket sections that become disconnected after a decoupler fires.  Newly
 * created debris fragments are appended to `ps.debris` so they are simulated
 * on every subsequent {@link tick}.
 */
export function fireNextStage(
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
): void {
  if (ps.crashed || flightState.aborted) return;

  // Allow staging while landed — transition to grounded so physics resumes.
  if (ps.landed) {
    ps.landed = false;
    ps.grounded = true;
  }

  const newDebris: DebrisState[] = activateCurrentStage(ps, assembly, stagingConfig, flightState);
  ps.debris.push(...newDebris);
}

// ---------------------------------------------------------------------------
// TWR-relative throttle conversion (private)
// ---------------------------------------------------------------------------

/**
 * When in TWR throttle mode, compute the raw throttle needed to achieve
 * `ps.targetTWR` and write it to `ps.throttle`.
 */
function _updateThrottleFromTWR(ps: PhysicsState, assembly: RocketAssembly, bodyId: string | undefined): void {
  if (ps.throttleMode !== 'twr') return;

  // Infinity means "max thrust"
  if (ps.targetTWR === Infinity) {
    ps.throttle = 1;
    return;
  }
  if (ps.targetTWR <= 0) {
    ps.throttle = 0;
    return;
  }

  let totalMass        = 0;
  let maxLiquidThrustN = 0;
  let srbThrustN       = 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;

    totalMass += (def.mass ?? 0) + (ps.fuelStore.get(instanceId) ?? 0);

    if (ps.firingEngines.has(instanceId)) {
      const thrustN: number = (def.properties?.thrust ?? 0) * 1_000; // kN → N
      if (def.type === PartType.SOLID_ROCKET_BOOSTER) {
        srbThrustN += thrustN;
      } else {
        maxLiquidThrustN += thrustN;
      }
    }
  }

  if (maxLiquidThrustN <= 0) return; // can't throttle SRBs
  if (totalMass <= 0) return;

  const localG: number = _gravityForBody(bodyId, Math.max(0, ps.posY));
  const needed: number = ps.targetTWR * totalMass * localG - srbThrustN;
  ps.throttle = Math.max(0, Math.min(1, needed / maxLiquidThrustN));
}

// ---------------------------------------------------------------------------
// Integration step (private)
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by exactly FIXED_DT seconds.
 */
function _integrate(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  const bodyId: string | undefined = flightState?.bodyId;

  // --- 0. TWR-relative throttle conversion --------------------------------
  _updateThrottleFromTWR(ps, assembly, bodyId);

  const altitude: number = Math.max(0, ps.posY);
  const density: number  = _densityForBody(altitude, bodyId);

  // --- 1. Total rocket mass (dry + remaining fuel) -------------------------
  const totalMass: number = _computeTotalMass(ps, assembly);

  // --- Docking / RCS mode: thrust affects local position, not orbit --------
  const isDockingOrRcs = ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS;

  // --- 2. Thrust vector ----------------------------------------------------
  // In docking/RCS modes, main engine thrust is suppressed — movement comes
  // from docking thrusters only (handled in _applyDockingMovement).
  let thrustX = 0;
  let thrustY = 0;
  if (!isDockingOrRcs) {
    const thrustResult: ThrustResult = _computeThrust(ps, assembly, density);
    thrustX = thrustResult.thrustX;
    thrustY = thrustResult.thrustY;
  }

  // --- 3. Gravity force (body-specific, inverse-square) --------------------
  const gravAccel: number = _gravityForBody(bodyId, altitude);
  const gravFX = 0;
  const gravFY: number = -gravAccel * totalMass;

  // --- 4. Drag force -------------------------------------------------------
  const speed: number    = Math.hypot(ps.velX, ps.velY);
  const dragMag: number  = _computeDragForce(ps, assembly, density, speed);
  let dragFX = 0;
  let dragFY = 0;
  if (speed > 1e-6) {
    dragFX = -dragMag * (ps.velX / speed);
    dragFY = -dragMag * (ps.velY / speed);
  }

  // --- 4b. Wind force (weather system) -------------------------------------
  let windFX = 0;
  let windFY = 0;
  if (density > 0 && ps.weatherWindSpeed > 0) {
    const windWeather = {
      windSpeed: ps.weatherWindSpeed,
      windAngle: ps.weatherWindAngle,
      temperature: 1, visibility: 0, extreme: false, description: '', bodyId: bodyId as string,
    };
    const windAccel = getWindForce(windWeather, altitude, bodyId);
    // Wind acts as a force on the rocket (acceleration × mass → force component).
    windFX = windAccel.windFX * totalMass;
    windFY = windAccel.windFY * totalMass;
  }

  // --- 5. Net acceleration -------------------------------------------------
  const netFX: number = thrustX + gravFX + dragFX + windFX;
  const netFY: number = thrustY + gravFY + dragFY + windFY;

  let accX: number = netFX / totalMass;
  let accY: number = netFY / totalMass;

  // Ground reaction: prevent downward acceleration while on launch pad.
  if (ps.grounded && accY < 0) {
    accY = 0;
    accX = 0; // no horizontal drift on pad
  }

  // Launch clamp hold: while clamps are active, prevent all movement.
  // Engines can fire (for engine spool-up visuals) but the rocket stays put.
  if (ps.grounded && ps.hasLaunchClamps) {
    accX = 0;
    accY = 0;
  }

  // --- 6. Euler integration ------------------------------------------------
  ps.velX += accX * FIXED_DT;
  ps.velY += accY * FIXED_DT;
  ps.posX += ps.velX * FIXED_DT;
  ps.posY += ps.velY * FIXED_DT;

  // --- 6b. Docking / RCS mode local movement --------------------------------
  if (isDockingOrRcs) {
    _applyDockingMovement(ps, assembly, totalMass, FIXED_DT);
  }

  // --- 7. Continuous steering ----------------------------------------------
  _applySteering(ps, assembly, altitude, FIXED_DT, bodyId, flightState);

  // --- 7b. Topple-crash check (grounded tipping) -------------------------
  if (ps.grounded) {
    _checkToppleCrash(ps, assembly, flightState);
    if (ps.crashed) return;
  }

  // --- 8. Fuel consumption (segment-aware, via fuelsystem.js) -------------
  tickFuelSystem(ps, assembly, FIXED_DT, density);

  // --- 8b. Malfunction tick (continuous effects like fuel leaks) ----------
  tickMalfunctions(ps, assembly, FIXED_DT);

  // --- 8c. Pending malfunction check (delayed after biome transition) -----
  if (ps._malfunctionCheckPending) {
    ps._malfunctionCheckTimer = (ps._malfunctionCheckTimer ?? 0) - FIXED_DT;
    if (ps._malfunctionCheckTimer <= 0) {
      ps._malfunctionCheckPending = false;
      checkMalfunctions(ps, assembly, flightState, ps._gameState ?? undefined);
    }
  }

  // --- 9. Parachute state machine ------------------------------------------
  // Advance deploying → deployed timers and run the mass-safety check.
  // totalMass was computed at step 1 above.
  if (!ps.grounded) {
    tickParachutes(ps, assembly, flightState, FIXED_DT, totalMass);
    tickCanopyAngles(ps, FIXED_DT);
  }

  // --- 9b. Landing leg state machine ---------------------------------------
  // Advance deploying → deployed timers for all landing legs.
  tickLegs(ps, assembly, flightState, FIXED_DT);

  // --- 9c. Science module experiment timers --------------------------------
  // Decrement running experiment countdowns; emit SCIENCE_COLLECTED on
  // completion; update flightState.scienceModuleRunning.
  tickScienceModules(ps, assembly, flightState, FIXED_DT);

  // --- 9d. Power system (solar generation, battery, consumers) ------------
  if (ps.powerState) {
    // Count active science instruments for power draw calculation.
    let activeScienceCount = 0;
    for (const [, entry] of ps.instrumentStates) {
      if (entry.state === 'COLLECTING' || entry.state === 'RUNNING') {
        activeScienceCount++;
      }
    }

    // Compute angular position for orbital sunlight check.
    let angularPositionDeg: number | undefined = undefined;
    if (flightState.inOrbit && flightState.orbitalElements) {
      const oState = getOrbitalStateAtTime(
        flightState.orbitalElements,
        flightState.timeElapsed,
        flightState.bodyId || 'EARTH',
      );
      angularPositionDeg = oState.angularPositionDeg;
    }

    tickPower(ps.powerState, {
      dt: FIXED_DT,
      altitude: Math.max(0, ps.posY),
      bodyId: flightState.bodyId || 'EARTH',
      gameTimeSeconds: flightState.timeElapsed,
      angularPositionDeg,
      inOrbit: flightState.inOrbit,
      scienceRunning: flightState.scienceModuleRunning,
      activeScienceCount,
      commsActive: false, // comms are passive for player craft
    });
  }

  // --- 9e. Ejected crew physics --------------------------------------------
  if (ps.ejectedCrew) {
    const crewG: number = _gravityForBody(bodyId, Math.max(0, ps.posY));
    for (const crew of ps.ejectedCrew) {
      // Countdown to chute deployment
      if (!crew.chuteOpen && crew.chuteTimer > 0) {
        crew.chuteTimer -= FIXED_DT;
        if (crew.chuteTimer <= 0) crew.chuteOpen = true;
      }

      // Gravity (body-specific)
      crew.velY -= crewG * FIXED_DT;

      // Parachute drag when open (terminal velocity ~5 m/s)
      if (crew.chuteOpen && crew.velY < 0) {
        const drag: number = 0.5 * crew.velY * crew.velY * 0.08;
        crew.velY += drag * FIXED_DT;
        if (crew.velY > -5) crew.velY = Math.max(crew.velY, -5);
      }

      // Air drag on horizontal velocity
      crew.velX *= (1 - 0.5 * FIXED_DT);

      crew.x += crew.velX * FIXED_DT;
      crew.y += crew.velY * FIXED_DT;

      // Stop at ground
      if (crew.y <= 0) {
        crew.y = 0;
        crew.velX = 0;
        crew.velY = 0;
      }
    }
  }

  // --- 10. Atmospheric heat model -------------------------------------------
  if (!ps.grounded) {
    // density is already body-aware (computed above via _densityForBody).
    updateHeat(ps, assembly, flightState, speed, altitude, density);

    // Solar proximity heat: escalating radiant heat when near the Sun.
    if (bodyId === 'SUN') {
      updateSolarHeat(ps, assembly, flightState, altitude);
    }
  }

  // --- 10. Launch clamp check -----------------------------------------------
  // If launch clamps were flagged, re-check whether any clamp parts remain
  // in the active assembly.  Once all clamps are staged away, clear the flag.
  if (ps.hasLaunchClamps) {
    let clampsRemain = false;
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const cDef: PartDef | null | undefined = placed ? getPartById(placed.partId) : null;
      if (cDef && cDef.type === PartType.LAUNCH_CLAMP) {
        clampsRemain = true;
        break;
      }
    }
    if (!clampsRemain) {
      ps.hasLaunchClamps = false;
    }
  }

  // --- 10b. Liftoff detection -----------------------------------------------
  // Rocket cannot lift off while launch clamps are still active.
  if (ps.grounded && ps.posY > 0 && !ps.hasLaunchClamps) {
    ps.grounded = false;
    ps.isTipping = false;
  }

  // --- 11. Ground clamping and landing detection ---------------------------
  if (!ps.grounded && ps.posY <= 0) {
    ps.posY = 0;
    _handleGroundContact(ps, assembly, flightState);
  } else if (ps.grounded) {
    // Still on pad: keep clamped.
    if (ps.posY < 0) ps.posY = 0;
    if (ps.velY < 0) ps.velY = 0;
  }
}

// ---------------------------------------------------------------------------
// Mass calculation (private)
// ---------------------------------------------------------------------------

/**
 * Compute the current total mass (dry + remaining propellant) of all parts
 * still attached to the rocket.
 */
function _computeTotalMass(ps: MassQueryable, assembly: RocketAssembly): number {
  let mass = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    // Dry mass of the part itself.
    mass += def.mass ?? 0;
  }

  // Add remaining fuel from all active fuel-bearing parts.
  for (const [instanceId, fuelRemaining] of ps.fuelStore) {
    if (ps.activeParts.has(instanceId)) {
      mass += fuelRemaining;
    }
  }

  return Math.max(1, mass);
}

// ---------------------------------------------------------------------------
// Tipping geometry helpers (private)
// ---------------------------------------------------------------------------

/**
 * Compute the centre of mass in VAB local pixel coordinates.
 */
function _computeCoMLocal(ps: MassQueryable, assembly: RocketAssembly): Point2D {
  let totalMass = 0;
  let comX = 0;
  let comY = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass: number = ps.fuelStore.get(instanceId) ?? 0;
    const mass: number = (def.mass ?? 1) + fuelMass;
    comX += placed.x * mass;
    comY += placed.y * mass;
    totalMass += mass;
  }

  if (totalMass > 0) {
    return { x: comX / totalMass, y: comY / totalMass };
  }
  return { x: 0, y: 0 };
}

/**
 * Find the ground contact point (lowest corner) in the tilt direction.
 *
 * Scans active parts for the lowest bottom edge, then picks the most extreme
 * X in the tilt direction at that level.  Landing legs widen the support base.
 */
function _computeGroundContactPoint(ps: PhysicsState, assembly: RocketAssembly, tiltDirection: number): Point2D {
  let lowestY = Infinity;
  let bestX = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const halfH: number = (def.height ?? 40) / 2;
    let halfW: number = (def.width ?? 40) / 2;

    let bottomY: number = placed.y - halfH;
    // Deployed landing legs extend the foot below the housing.
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      if (dy > 0) {
        bottomY = placed.y - dy;
        halfW = Math.max(halfW, dx);
      }
    }

    if (bottomY < lowestY - 0.5) {
      // New lowest level — reset.
      lowestY = bottomY;
      bestX = placed.x + tiltDirection * halfW;
    } else if (bottomY < lowestY + 0.5) {
      // Same level — pick further out in the tilt direction.
      const candidateX: number = placed.x + tiltDirection * halfW;
      if (tiltDirection > 0 ? candidateX > bestX : candidateX < bestX) {
        bestX = candidateX;
      }
    }
  }

  // Guard: no valid parts found — return origin.
  if (!isFinite(lowestY)) return { x: 0, y: 0 };
  return { x: bestX, y: lowestY };
}

/**
 * Compute the moment of inertia about a given pivot point (point-mass approx).
 *
 * I = sum(m_i × r_i²) where r_i is the distance from each part's centre to
 * the pivot, converted to metres.
 */
function _computeMomentOfInertia(ps: MassQueryable, assembly: RocketAssembly, pivot: Point2D): number {
  let I = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass: number = ps.fuelStore.get(instanceId) ?? 0;
    const mass: number = (def.mass ?? 1) + fuelMass;
    const dx: number = (placed.x - pivot.x) * SCALE_M_PER_PX;
    const dy: number = (placed.y - pivot.y) * SCALE_M_PER_PX;
    // Self-inertia: rectangular body I = m(w² + h²)/12.
    const wM: number = (def.width  ?? 40) * SCALE_M_PER_PX;
    const hM: number = (def.height ?? 40) * SCALE_M_PER_PX;
    const Iself: number = mass * (wM * wM + hM * hM) / 12;
    I += Iself + mass * (dx * dx + dy * dy);
  }

  return Math.max(1, I);
}

// ---------------------------------------------------------------------------
// Thrust calculation (private)
// ---------------------------------------------------------------------------

/**
 * Compute the thrust force vector for the current integration step.
 *
 * Thrust is treated as acting purely along the rocket's orientation axis
 * (simplified symmetric thrust — no engine placement offsets).
 */
function _computeThrust(ps: PhysicsState, assembly: RocketAssembly, density: number): ThrustResult {
  const densityRatio: number = density / SEA_LEVEL_DENSITY; // 0 in vacuum, 1 at sea level

  let totalThrustN = 0;
  const exhausted: string[]  = [];

  for (const instanceId of ps.firingEngines) {
    // Skip parts that have been jettisoned.
    if (!ps.activeParts.has(instanceId)) {
      exhausted.push(instanceId);
      continue;
    }

    const placed = assembly.parts.get(instanceId);
    if (!placed) { exhausted.push(instanceId); continue; }

    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def)   { exhausted.push(instanceId); continue; }

    const props = def.properties ?? {};
    const isSRB: boolean = def.type === PartType.SOLID_ROCKET_BOOSTER;

    // Guard: SRBs that already have no fuel produce no thrust this step.
    if (isSRB) {
      const fuelLeft: number = ps.fuelStore.get(instanceId) ?? 0;
      if (fuelLeft <= 0) {
        exhausted.push(instanceId);
        continue;
      }
    }

    // Interpolate thrust between sea-level and vacuum values.
    // Weather temperature affects ISP → indirectly scales effective thrust.
    const ispMod: number     = ps.weatherIspModifier ?? 1.0;
    const thrustSL: number   = (props.thrust    ?? 0) * 1_000 * ispMod; // kN → N, ISP-adjusted
    const thrustVac: number  = (props.thrustVac ?? props.thrust ?? 0) * 1_000 * ispMod;
    const rawThrustN: number = densityRatio * thrustSL + (1 - densityRatio) * thrustVac;

    // Throttle: SRBs always at 100 %; liquid engines use current setting.
    const throttleMult: number     = isSRB ? 1.0 : ps.throttle;
    let   effectiveThrustN: number = rawThrustN * throttleMult;

    // Apply reduced thrust from ENGINE_REDUCED_THRUST malfunction.
    const malf = ps.malfunctions?.get(instanceId);
    if (malf && !malf.recovered && malf.type === MalfunctionType.ENGINE_REDUCED_THRUST) {
      effectiveThrustN *= REDUCED_THRUST_FACTOR;
    }

    totalThrustN += effectiveThrustN;
  }

  // Remove already-exhausted engines from the firing set.
  for (const id of exhausted) {
    ps.firingEngines.delete(id);
  }

  // Project thrust along the rocket's orientation axis.
  const thrustX: number = totalThrustN * Math.sin(ps.angle);
  const thrustY: number = totalThrustN * Math.cos(ps.angle);

  return { thrustX, thrustY };
}

// ---------------------------------------------------------------------------
// Drag calculation (private)
// ---------------------------------------------------------------------------

/**
 * Return the deployment progress for a parachute: 0 = packed/failed,
 * 0→1 during the deploying animation, 1 = fully deployed.
 */
function _getChuteDeployProgress(ps: PhysicsState, instanceId: string): number {
  const entry = ps.parachuteStates?.get(instanceId);
  if (!entry) return 0;
  switch (entry.state) {
    case 'deployed':  return 1;
    case 'deploying': {
      const linear: number = Math.max(0, Math.min(1, 1 - entry.deployTimer / DEPLOY_DURATION));
      return linear;
    }
    default:          return 0;
  }
}

/**
 * Compute the aerodynamic drag force magnitude (Newtons).
 *
 * dragForce = 0.5 × rho × v² × Cd × A  (summed over all active parts)
 */
function _computeDragForce(ps: PhysicsState, assembly: RocketAssembly, density: number, speed: number): number {
  if (density <= 0 || speed <= 0) return 0;

  let totalCdA = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const props  = def.properties ?? {};
    const widthM: number = (def.width ?? 40) * SCALE_M_PER_PX;
    const area: number   = Math.PI * (widthM / 2) ** 2; // stowed circular cross-section

    if (def.type === PartType.PARACHUTE) {
      // Stowed CdA — used when packed or failed.
      const stowedCdA: number = (props.dragCoefficient ?? 0.05) * area;

      // Deployed CdA — uses the real canopy diameter, not the stowed profile.
      const deployedR: number   = (props.deployedDiameter ?? 10) / 2;
      const deployedCd: number  = props.deployedCd ?? 0.75;
      const deployedCdA: number = deployedCd * Math.PI * deployedR * deployedR;

      // Linearly interpolate from stowed → deployed as the canopy opens.
      // Scale by atmospheric density so chutes are ineffective near vacuum.
      const progress: number     = _getChuteDeployProgress(ps, instanceId);
      const densityScale: number = Math.min(1, density / LOW_DENSITY_THRESHOLD);
      let   chuteCdA: number     = stowedCdA + (deployedCdA - stowedCdA) * progress * densityScale;

      // Partial deploy malfunction: 50 % of normal deployed drag.
      const cMalf = ps.malfunctions?.get(instanceId);
      if (cMalf && !cMalf.recovered && cMalf.type === MalfunctionType.PARACHUTE_PARTIAL) {
        chuteCdA = stowedCdA + (chuteCdA - stowedCdA) * PARTIAL_CHUTE_FACTOR;
      }

      totalCdA += chuteCdA;
    } else {
      totalCdA += (props.dragCoefficient ?? 0.2) * area;
    }
  }

  return 0.5 * density * speed * speed * totalCdA;
}

/**
 * Compute the restoring torque (N·m) from deployed parachutes.
 *
 * Each parachute's drag acts at an offset from the CoM — the canopy trails
 * behind on lines, so the effective application point is *opposite* to the
 * part's VAB position relative to CoM.  This creates a pendulum-like restoring
 * torque that naturally orients the rocket with the parachute on top.
 */
function _computeParachuteTorque(
  ps: PhysicsState,
  assembly: RocketAssembly,
  com: Point2D,
  density: number,
  speed: number,
): number {
  if (density <= 0 || speed <= 0 || !ps.parachuteStates) return 0;

  const q: number = 0.5 * density * speed * speed;     // dynamic pressure
  const sinA: number = Math.sin(ps.angle);

  let totalTorque = 0;

  for (const [instanceId, entry] of ps.parachuteStates) {
    if (entry.state !== 'deploying' && entry.state !== 'deployed') continue;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;

    // Chute CdA (same formula as _computeDragForce).
    const props     = def.properties ?? {};
    const widthM: number    = (def.width ?? 40) * SCALE_M_PER_PX;
    const stowedA: number   = Math.PI * (widthM / 2) ** 2;
    const stowedCdA: number = (props.dragCoefficient ?? 0.05) * stowedA;
    const deployedR: number   = (props.deployedDiameter ?? 10) / 2;
    const deployedCd: number  = props.deployedCd ?? 0.75;
    const deployedCdA: number = deployedCd * Math.PI * deployedR * deployedR;
    const progress: number     = _getChuteDeployProgress(ps, instanceId);
    const densityScale: number = Math.min(1, density / LOW_DENSITY_THRESHOLD);
    const chuteCdA: number = stowedCdA + (deployedCdA - stowedCdA) * progress * densityScale;

    // Drag magnitude (the line tension pulling the capsule toward the canopy).
    const dragMag: number = q * chuteCdA;

    // Pendulum restoring torque: the capsule hangs below the canopy on lines.
    const dx: number = (placed.x - com.x) * SCALE_M_PER_PX;
    const dy: number = (placed.y - com.y) * SCALE_M_PER_PX;
    const lineLen: number = Math.sqrt(dx * dx + dy * dy);

    totalTorque -= dragMag * lineLen * sinA;
  }

  return totalTorque * CHUTE_TORQUE_SCALE;
}

// ---------------------------------------------------------------------------
// Steering (private)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Docking / RCS mode movement (private)
// ---------------------------------------------------------------------------

/**
 * Apply docking/RCS mode translational movement.
 *
 * In DOCKING mode: A/D = along-track, W/S = radial.
 * In RCS mode: WASD = craft-relative directional translation.
 */
function _applyDockingMovement(ps: PhysicsState, assembly: RocketAssembly, totalMass: number, dt: number): void {
  const isDocking: boolean = ps.controlMode === ControlMode.DOCKING;
  const isRcs: boolean     = ps.controlMode === ControlMode.RCS;
  if (!isDocking && !isRcs) return;

  // Clear RCS active directions each step; re-set below if active.
  ps.rcsActiveDirections.clear();

  const w: boolean = ps._heldKeys.has('w') || ps._heldKeys.has('ArrowUp');
  const s: boolean = ps._heldKeys.has('s') || ps._heldKeys.has('ArrowDown');
  const a: boolean = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
  const d: boolean = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');

  if (!w && !s && !a && !d) return;

  // Determine thrust magnitude based on mode.
  // When docked, use combined mass for thrust calculations.
  const thrustN: number = isRcs ? 500 : 2000; // N
  const effectiveMass: number = ps._dockedCombinedMass > 0
    ? Math.max(totalMass, ps._dockedCombinedMass)
    : totalMass;
  const accel: number = thrustN / Math.max(1, effectiveMass);

  if (isRcs) {
    // RCS mode: WASD = craft-relative translation.
    let dvAlongAxis = 0;
    let dvPerpAxis = 0;
    if (w) { dvAlongAxis += accel * dt; ps.rcsActiveDirections.add('up'); }
    if (s) { dvAlongAxis -= accel * dt; ps.rcsActiveDirections.add('down'); }
    if (a) { dvPerpAxis -= accel * dt;  ps.rcsActiveDirections.add('left'); }
    if (d) { dvPerpAxis += accel * dt;  ps.rcsActiveDirections.add('right'); }

    // Convert craft-relative to world coordinates.
    const sinA: number = Math.sin(ps.angle);
    const cosA: number = Math.cos(ps.angle);
    ps.velX += dvAlongAxis * sinA + dvPerpAxis * cosA;
    ps.velY += dvAlongAxis * cosA - dvPerpAxis * sinA;
  } else {
    // DOCKING mode: A/D = along-track, W/S = radial.
    const speed: number = Math.hypot(ps.velX, ps.velY);
    let progX: number, progY: number, radOutX: number, radOutY: number;

    if (speed > 1e-3) {
      progX = ps.velX / speed;
      progY = ps.velY / speed;
    } else {
      progX = Math.sin(ps.angle);
      progY = Math.cos(ps.angle);
    }
    // Radial out = perpendicular to prograde, pointing away from body.
    radOutX = progY;
    radOutY = -progX;
    // Ensure radial out actually points away from body centre.
    const radCheck: number = radOutX * ps.posX + radOutY * (ps.posY + 6_371_000);
    if (radCheck < 0) {
      radOutX = -radOutX;
      radOutY = -radOutY;
    }

    let dvX = 0;
    let dvY = 0;
    if (d) { dvX += accel * dt * progX; dvY += accel * dt * progY; }   // along-track forward
    if (a) { dvX -= accel * dt * progX; dvY -= accel * dt * progY; }   // along-track backward
    if (w) { dvX += accel * dt * radOutX; dvY += accel * dt * radOutY; } // radial out
    if (s) { dvX -= accel * dt * radOutX; dvY -= accel * dt * radOutY; } // radial in

    // Band limit clamping — prevent leaving the altitude band.
    if (ps.dockingAltitudeBand) {
      const band = ps.dockingAltitudeBand;
      const alt: number = Math.max(0, ps.posY);
      if (alt >= band.max - 2500 && dvY > 0) dvY = 0;
      if (alt <= band.min + 2500 && dvY < 0) dvY = 0;
    }

    ps.velX += dvX;
    ps.velY += dvY;

    // Track offsets for reference.
    ps.dockingOffsetAlongTrack += (d ? 1 : 0) - (a ? 1 : 0);
    ps.dockingOffsetRadial     += (w ? 1 : 0) - (s ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// Steering (private)
// ---------------------------------------------------------------------------

function _applySteering(
  ps: PhysicsState,
  assembly: RocketAssembly,
  altitude: number,
  dt: number,
  bodyId: string | undefined,
  flightState: FlightState,
): void {
  // In RCS mode, rotation is disabled.
  if (ps.controlMode === ControlMode.RCS) return;

  // In DOCKING mode, A/D don't rotate — they're handled by _applyDockingMovement.
  if (ps.controlMode === ControlMode.DOCKING) return;

  const left: boolean  = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
  const right: boolean = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');

  // Grounded or landed: delegate to tipping physics (always runs for gravity torque).
  if (ps.grounded || ps.landed) {
    _applyGroundedSteering(ps, assembly, left, right, dt, bodyId);
    return;
  }

  // --- Airborne torque-based rotation ---
  const com: Point2D = _computeCoMLocal(ps, assembly);
  const I: number = _computeMomentOfInertia(ps, assembly, com);
  const density: number = _densityForBody(Math.max(0, ps.posY), bodyId);
  const speed: number   = Math.hypot(ps.velX, ps.velY);
  const atmoTop: number = _atmosphereTopForBody(bodyId);

  // Player input torque — compute angular acceleration and cap it so light
  // rockets don't spin uncontrollably.
  // Piloting skill bonus: up to +30% torque at max skill.
  const pilotingSkill: number = _getMaxCrewSkill(ps, flightState, 'piloting');
  const pilotingBonus: number = 1 + (pilotingSkill / 100) * 0.3;
  let baseTorque: number = PLAYER_FLIGHT_TORQUE * pilotingBonus;
  if (altitude > atmoTop && _hasRcs(ps, assembly)) {
    baseTorque *= RCS_TORQUE_MULTIPLIER;
  }
  let playerAlpha = 0;
  if (right) playerAlpha += baseTorque / I;
  if (left)  playerAlpha -= baseTorque / I;
  playerAlpha = Math.max(-MAX_PLAYER_ANGULAR_ACCEL, Math.min(MAX_PLAYER_ANGULAR_ACCEL, playerAlpha));

  // Parachute restoring torque (pendulum effect) — capped per angular accel
  // to prevent integration blow-up on very light capsules.
  let restoringTorque: number = _computeParachuteTorque(ps, assembly, com, density, speed);
  let restoringAlpha: number = restoringTorque / I;
  restoringAlpha = Math.max(-MAX_CHUTE_ANGULAR_ACCEL, Math.min(MAX_CHUTE_ANGULAR_ACCEL, restoringAlpha));

  const alpha: number = playerAlpha + restoringAlpha;
  ps.angularVelocity += alpha * dt;

  // Parachute angular damping — applied as implicit exponential decay so it
  // is unconditionally stable even for tiny moments of inertia.
  if (density > 0 && ps.parachuteStates) {
    let hasActiveChute = false;
    for (const [, entry] of ps.parachuteStates) {
      if (entry.state === 'deploying' || entry.state === 'deployed') {
        hasActiveChute = true;
        break;
      }
    }
    if (hasActiveChute) {
      const densityFrac: number = Math.min(1, density / LOW_DENSITY_THRESHOLD);
      ps.angularVelocity *= Math.exp(-CHUTE_DIRECT_DAMPING * densityFrac * dt);
    }
  }

  // Damping (when no input).
  if (!left && !right) {
    // Aerodynamic damping (proportional to density).
    const aeroDamping: number = AERO_ANGULAR_DAMPING * density;
    ps.angularVelocity -= aeroDamping * ps.angularVelocity * dt;

    // RCS active braking in vacuum.
    if (altitude > atmoTop && _hasRcs(ps, assembly)) {
      const rcsBrake: number = RCS_ANGULAR_DAMPING * ps.angularVelocity / I;
      // Don't overshoot zero.
      if (Math.abs(rcsBrake * dt) > Math.abs(ps.angularVelocity)) {
        ps.angularVelocity = 0;
      } else {
        ps.angularVelocity -= rcsBrake * dt;
      }
    }
  }

  ps.angle += ps.angularVelocity * dt;
}

/** Returns true if any parachute is currently deploying or deployed. */
function _hasActiveParachutes(ps: PhysicsState): boolean {
  if (!ps.parachuteStates) return false;
  for (const [, entry] of ps.parachuteStates) {
    if (entry.state === ParachuteState.DEPLOYING || entry.state === ParachuteState.DEPLOYED) return true;
  }
  return false;
}

function _hasAsymmetricLegs(ps: PhysicsState, assembly: RocketAssembly): boolean {
  if (!ps.legStates || ps.legStates.size === 0) return false;
  let hasDeployed = false;
  let hasRetracted = false;
  for (const instanceId of ps.activeParts) {
    const entry = ps.legStates.get(instanceId);
    if (!entry) continue;
    if (entry.state === LegState.DEPLOYED || entry.state === LegState.DEPLOYING) {
      hasDeployed = true;
    } else {
      hasRetracted = true;
    }
    if (hasDeployed && hasRetracted) return true;
  }
  return false;
}

/**
 * Apply ground-contact tipping physics.
 *
 * When the rocket is on the ground (grounded or landed), rotation happens
 * around the base contact corner, not the centre of mass.  Gravity produces
 * a restoring or toppling torque depending on how far the CoM has moved past
 * the support base.  Player A/D input adds an additional torque.
 */
function _applyGroundedSteering(
  ps: PhysicsState,
  assembly: RocketAssembly,
  left: boolean,
  right: boolean,
  dt: number,
  bodyId?: string,
): void {
  const surfaceG: number = _gravityForBody(bodyId, 0);
  // If fully at rest with no input, nothing to do —
  // UNLESS legs are asymmetrically deployed (one deployed, one retracted),
  // which creates an off-centre contact point that should cause tipping.
  if (
    !left && !right &&
    ps.angle === 0 && ps.angularVelocity === 0 &&
    !_hasAsymmetricLegs(ps, assembly)
  ) {
    ps.isTipping = false;
    ps._contactCX = undefined;
    ps._contactCY = undefined;
    return;
  }

  // --- Find ground contact point ---
  const cosA: number = Math.cos(ps.angle);
  const sinA: number = Math.sin(ps.angle);

  // Collect all corners with their gp values, tracking the maximum.
  const allCorners: CornerEntry[] = [];
  let maxGP = -Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const hw: number = (def.width  ?? 40) / 2;
    const hh: number = (def.height ?? 40) / 2;

    let halfW: number = hw;
    let bottomHH: number = hh;
    // Deployed landing legs extend the foot below and outward.
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      if (dy > 0) {
        halfW = Math.max(halfW, dx);
        bottomHH = Math.max(hh, dy);
      }
    }

    const corners: [number, number][] = [
      [placed.x - halfW, placed.y - bottomHH],
      [placed.x + halfW, placed.y - bottomHH],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ];
    for (const [cx, cy] of corners) {
      const gp: number = cx * sinA - cy * cosA;
      allCorners.push({ cx, cy, gp });
      if (gp > maxGP) maxGP = gp;
    }
  }

  // Softmax-weighted average: corners near the ground dominate.
  const CONTACT_SHARPNESS = 2.0;
  let sumW = 0, sumWX = 0, sumWY = 0;
  for (const c of allCorners) {
    const w: number = Math.exp(CONTACT_SHARPNESS * (c.gp - maxGP));
    sumW  += w;
    sumWX += w * c.cx;
    sumWY += w * c.cy;
  }
  const contactLX: number = sumWX / sumW;
  const contactLY: number = sumWY / sumW;

  const contact: Point2D = { x: contactLX, y: contactLY };

  // Where is this contact point in world space right now?
  const contactWorldX: number = ps.posX + (contactLX * cosA + contactLY * sinA) * SCALE_M_PER_PX;

  // Compute moment of inertia about the contact point.
  const I: number = _computeMomentOfInertia(ps, assembly, contact);

  // Compute CoM position relative to contact point, then rotate to get
  // the world-X offset (horizontal distance for gravity torque).
  const com: Point2D = _computeCoMLocal(ps, assembly);
  const relX: number = (com.x - contactLX) * SCALE_M_PER_PX;
  const relY: number = (com.y - contactLY) * SCALE_M_PER_PX;
  const rotatedX: number = relX * cosA + relY * sinA;

  // Gravity torque: weight × horizontal distance from contact to CoM.
  const totalMass: number = _computeTotalMass(ps, assembly);
  const gravityTorque: number = totalMass * surfaceG * rotatedX;

  // Player input torque — capped per angular acceleration so light parts
  // don't instantly topple.
  let inputAccel = 0;
  if (right) inputAccel += PLAYER_TIP_TORQUE / I;
  if (left)  inputAccel -= PLAYER_TIP_TORQUE / I;
  inputAccel = Math.max(-MAX_PLAYER_TIP_ACCEL, Math.min(MAX_PLAYER_TIP_ACCEL, inputAccel));

  // Net angular acceleration.
  const gravAccel: number = gravityTorque / I;
  const angAccel: number = gravAccel + inputAccel;

  // Euler integrate.
  ps.angularVelocity += angAccel * dt;

  // Heavy damping during active player input limits overshoot; lighter
  // damping during free rocking allows several visible oscillations.
  const hasLegBase: boolean = countDeployedLegs(ps) >= 2;
  const effectiveDamping: number = (left || right) ? 0.85 : 0.99;
  ps.angularVelocity *= effectiveDamping;

  ps.angle += ps.angularVelocity * dt;

  // --- Reposition so the contact corner stays on the ground surface ---
  const cosB: number = Math.cos(ps.angle);
  const sinB: number = Math.sin(ps.angle);
  ps.posX = contactWorldX - (contactLX * cosB + contactLY * sinB) * SCALE_M_PER_PX;
  ps.posY = 0;

  // Update tipping state for renderer.
  ps.isTipping = Math.abs(ps.angle) > TILT_SNAP_THRESHOLD;
  ps.tippingContactX = contactLX;
  ps.tippingContactY = contactLY;

  // --- Smooth settle ---
  if (!left && !right && Math.abs(ps.angularVelocity) < ANGULAR_VEL_SNAP_THRESHOLD) {
    const comSnap: Point2D  = _computeCoMLocal(ps, assembly);
    const sRelX: number    = (comSnap.x - contactLX) * SCALE_M_PER_PX;
    const sRelY: number    = (comSnap.y - contactLY) * SCALE_M_PER_PX;
    const sRotX: number    = sRelX * cosB + sRelY * sinB;
    const snapGrav: number = totalMass * surfaceG * sRotX;
    const snapAccel: number = Math.abs(snapGrav / I);

    if (snapAccel < 0.5) {
      // Near equilibrium — smoothly decay velocity.
      ps.angularVelocity *= 0.85;
      // If also near upright, smoothly decay angle toward 0.
      if (Math.abs(ps.angle) < TILT_SNAP_THRESHOLD) {
        ps.angle *= 0.9;
      }
      // Final cleanup when truly negligible.
      if (Math.abs(ps.angularVelocity) < 1e-4) {
        ps.angularVelocity = 0;
      }
      if (Math.abs(ps.angle) < 1e-4) {
        ps.angle = 0;
        ps.isTipping = false;
        ps._contactCX = undefined;
        ps._contactCY = undefined;
      }
    }
  }
}

/**
 * Check if the rocket has toppled past the crash angle and trigger a crash.
 */
function _checkToppleCrash(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  if (Math.abs(ps.angle) <= TOPPLE_CRASH_ANGLE) return;

  // Compute tip speed: linear velocity of the farthest part from the
  // tipping contact pivot.
  const cx: number = ps.tippingContactX ?? 0;
  const cy: number = ps.tippingContactY ?? 0;
  let maxDist = 0;
  let minThreshold = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const hw: number = (def.width  ?? 40) / 2;
    const hh: number = (def.height ?? 40) / 2;
    // Check all four corners for max distance from pivot.
    for (const [px, py] of [
      [placed.x - hw, placed.y - hh],
      [placed.x + hw, placed.y - hh],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ] as [number, number][]) {
      const dx: number = (px - cx) * SCALE_M_PER_PX;
      const dy: number = (py - cy) * SCALE_M_PER_PX;
      const dist: number = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) maxDist = dist;
    }
    const threshold: number = def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
    if (threshold < minThreshold) minThreshold = threshold;
  }

  const tipSpeed: number = Math.abs(ps.angularVelocity) * maxDist;
  if (tipSpeed <= minThreshold) return; // gentle topple — no crash

  // Destructive topple — crash.
  ps.crashed = true;
  ps.angularVelocity = 0;
  ps.firingEngines.clear();

  const time: number = flightState.timeElapsed;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    _emitEvent(flightState, {
      type:       'PART_DESTROYED',
      time,
      instanceId,
      partId:     placed?.partId,
      speed:      tipSpeed,
      toppled:    true,
    });
  }

  ps.activeParts.clear();
  ps.deployedParts.clear();

  _emitEvent(flightState, {
    type: 'CRASH',
    time,
    speed: tipSpeed,
    toppled: true,
    description: `Rocket toppled over at ${tipSpeed.toFixed(1)} m/s and crashed!`,
  });
}

// ---------------------------------------------------------------------------
// Debris ground tipping physics
// ---------------------------------------------------------------------------

/**
 * Apply simplified ground tipping physics to a landed debris fragment.
 *
 * This is a stripped-down version of `_applyGroundedSteering` with no player
 * input — debris just rocks under gravity, settles if balanced, and crashes
 * if it topples too fast.
 */
export function tickDebrisGround(debris: DebrisState, assembly: RocketAssembly, dt: number, bodyId?: string): void {
  if (debris.crashed) return;
  const debrisG: number = _gravityForBody(bodyId, 0);

  // Check if tipping is needed
  const needsTipping: boolean = debris.isTipping ||
    Math.abs(debris.angle) > TILT_SNAP_THRESHOLD ||
    Math.abs(debris.angularVelocity) > ANGULAR_VEL_SNAP_THRESHOLD;

  if (!needsTipping) {
    // Smooth settle residuals
    if (debris.angle !== 0 || debris.angularVelocity !== 0) {
      debris.angle *= 0.9;
      debris.angularVelocity *= 0.85;
      debris.isTipping = false;
      if (Math.abs(debris.angle) < 1e-4 && Math.abs(debris.angularVelocity) < 1e-4) {
        debris.angle = 0;
        debris.angularVelocity = 0;
      }
    }
    return;
  }

  // Reuse the same tipping math as _applyGroundedSteering but with no player input
  const cosA: number = Math.cos(debris.angle);
  const sinA: number = Math.sin(debris.angle);

  // Find ground contact point via softmax (same as rocket)
  const allCorners: CornerEntry[] = [];
  let maxGP = -Infinity;
  for (const instanceId of debris.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    let halfW: number = (def.width ?? 40) / 2;
    let bottomHH: number = (def.height ?? 40) / 2;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dx, dy } = getDeployedLegFootOffset(instanceId, def, debris.legStates);
      if (dy > 0) { halfW = Math.max(halfW, dx); bottomHH = Math.max(bottomHH, dy); }
    }
    const hw: number = (def.width ?? 40) / 2;
    const hh: number = (def.height ?? 40) / 2;
    for (const [cx, cy] of [
      [placed.x - halfW, placed.y - bottomHH],
      [placed.x + halfW, placed.y - bottomHH],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ] as [number, number][]) {
      const gp: number = cx * sinA - cy * cosA;
      allCorners.push({ cx, cy, gp });
      if (gp > maxGP) maxGP = gp;
    }
  }

  if (allCorners.length === 0) return;

  const CONTACT_SHARPNESS = 2.0;
  let sumW = 0, sumWX = 0, sumWY = 0;
  for (const c of allCorners) {
    const w: number = Math.exp(CONTACT_SHARPNESS * (c.gp - maxGP));
    sumW += w; sumWX += w * c.cx; sumWY += w * c.cy;
  }
  const contactLX: number = sumWX / sumW;
  const contactLY: number = sumWY / sumW;
  const contact: Point2D = { x: contactLX, y: contactLY };

  const contactWorldX: number = debris.posX + (contactLX * cosA + contactLY * sinA) * SCALE_M_PER_PX;

  // Moment of inertia, CoM, gravity torque
  const I: number = _computeMomentOfInertia(debris, assembly, contact);
  const com: Point2D = _computeCoMLocal(debris, assembly);
  const relX: number = (com.x - contactLX) * SCALE_M_PER_PX;
  const relY: number = (com.y - contactLY) * SCALE_M_PER_PX;
  const rotatedX: number = relX * cosA + relY * sinA;
  const totalMass: number = _computeTotalMass(debris, assembly);
  const gravityTorque: number = totalMass * debrisG * rotatedX;

  // Angular integration (no player input)
  const angAccel: number = gravityTorque / I;
  debris.angularVelocity += angAccel * dt;
  debris.angularVelocity *= 0.99; // light damping
  debris.angle += debris.angularVelocity * dt;

  // Reposition to keep contact on ground
  const cosB: number = Math.cos(debris.angle);
  const sinB: number = Math.sin(debris.angle);
  debris.posX = contactWorldX - (contactLX * cosB + contactLY * sinB) * SCALE_M_PER_PX;
  debris.posY = 0;

  debris.isTipping = Math.abs(debris.angle) > TILT_SNAP_THRESHOLD;
  debris.tippingContactX = contactLX;
  debris.tippingContactY = contactLY;

  // Smooth settle
  if (Math.abs(debris.angularVelocity) < ANGULAR_VEL_SNAP_THRESHOLD) {
    const sRelX: number = (com.x - contactLX) * SCALE_M_PER_PX;
    const sRelY: number = (com.y - contactLY) * SCALE_M_PER_PX;
    const sRotX: number = sRelX * cosB + sRelY * sinB;
    const snapGrav: number = totalMass * debrisG * sRotX;
    if (Math.abs(snapGrav / I) < 0.5) {
      debris.angularVelocity *= 0.85;
      if (Math.abs(debris.angle) < TILT_SNAP_THRESHOLD) debris.angle *= 0.9;
      if (Math.abs(debris.angularVelocity) < 1e-4) debris.angularVelocity = 0;
      if (Math.abs(debris.angle) < 1e-4) { debris.angle = 0; debris.isTipping = false; }
    }
  }

  // Topple crash — simplified (no flight events, just set crashed)
  if (Math.abs(debris.angle) > TOPPLE_CRASH_ANGLE) {
    const dcx: number = debris.tippingContactX ?? 0;
    const dcy: number = debris.tippingContactY ?? 0;
    let maxDist = 0;
    let minThreshold = Infinity;
    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      if (!placed) continue;
      const def: PartDef | undefined = getPartById(placed.partId);
      if (!def) continue;
      const hw: number = (def.width ?? 40) / 2;
      const hh: number = (def.height ?? 40) / 2;
      for (const [px, py] of [
        [placed.x - hw, placed.y - hh], [placed.x + hw, placed.y - hh],
        [placed.x - hw, placed.y + hh], [placed.x + hw, placed.y + hh],
      ] as [number, number][]) {
        const ddx: number = (px - dcx) * SCALE_M_PER_PX;
        const ddy: number = (py - dcy) * SCALE_M_PER_PX;
        const dist: number = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist > maxDist) maxDist = dist;
      }
      const threshold: number = def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
      if (threshold < minThreshold) minThreshold = threshold;
    }
    const tipSpeed: number = Math.abs(debris.angularVelocity) * maxDist;
    if (tipSpeed > minThreshold) {
      debris.crashed = true;
      debris.angularVelocity = 0;
    }
  }
}

/**
 * Return true if the rocket has at least one active RCS-capable command module.
 */
function _hasRcs(ps: PhysicsState, assembly: RocketAssembly): boolean {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def: PartDef | null | undefined = placed ? getPartById(placed.partId) : null;
    if (def && def.properties?.hasRcs === true) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Ground contact (private)
// ---------------------------------------------------------------------------

/**
 * Handle the rocket touching down (or crashing into) the ground.
 *
 * Landing outcome depends on how many legs are deployed and impact speed:
 *
 *   1. >= 2 deployed legs AND speed < 10 m/s
 *        -> Controlled landing (LANDING event, ps.landed = true).
 *
 *   2. >= 1 deployed leg AND 10 m/s <= speed < 30 m/s
 *        -> Hard landing: legs (and their connected parts) are destroyed but
 *          the rocket body may survive (LANDING event with legs_destroyed flag).
 *
 *   3. speed >= 30 m/s (any leg state)
 *        -> Catastrophic impact: all parts destroyed (CRASH event, ps.crashed = true).
 *
 *   4. 0 deployed legs AND speed > 5 m/s
 *        -> Contact without leg support: bottom-most parts damaged/destroyed
 *          (CRASH event, ps.crashed = true).
 *
 *   5. speed <= 5 m/s (no legs or fewer than 2 legs)
 *        -> Gentle touchdown (LANDING event, ps.landed = true).
 *
 * Emits LANDING or CRASH event and sets ps.landed / ps.crashed accordingly.
 */
function _handleGroundContact(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  const impactSpeed: number = Math.hypot(ps.velX, ps.velY);
  const time: number        = flightState.timeElapsed;

  // Clamp to ground and stop motion.
  ps.posY = 0;
  ps.velX = 0;
  ps.velY = 0;

  // --- Cascading per-part crash threshold system ---
  let remainingSpeed: number = impactSpeed;
  let anyDestroyed = false;

  while (remainingSpeed > 0 && ps.activeParts.size > 0) {
    const layer: BottomLayerEntry[] = _getBottomPartLayer(ps, assembly);
    if (layer.length === 0) break;

    // Find the minimum crashThreshold in the bottom layer.
    let minThreshold = Infinity;
    for (const entry of layer) {
      const threshold: number = entry.def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
      if (threshold < minThreshold) minThreshold = threshold;
    }

    // If remaining speed is within the layer's tolerance, it survives.
    if (remainingSpeed <= minThreshold) break;

    // Destroy all parts in this layer.
    for (const entry of layer) {
      _removePartFromState(ps, entry.instanceId, assembly);
      _emitEvent(flightState, {
        type:       'PART_DESTROYED',
        time,
        instanceId: entry.instanceId,
        partId:     entry.placed.partId,
        speed:      remainingSpeed,
      });
    }

    anyDestroyed = true;

    // Each destroyed layer absorbs impact speed equal to its crash threshold.
    remainingSpeed -= minThreshold;
  }

  // --- Renormalize surviving rocket so its new bottom sits at ground level ---
  if (anyDestroyed && ps.activeParts.size > 0) {
    const bottomAfter: number = _getLowestBottomEdge(ps, assembly);
    if (isFinite(bottomAfter) && bottomAfter > 0) {
      const offsetM: number = bottomAfter * SCALE_M_PER_PX;
      ps.posY += offsetM;
      for (const [, placed] of assembly.parts) {
        placed.y -= bottomAfter;
      }
      for (const deb of ps.debris) {
        deb.posY += offsetM;
      }
    }
  }

  // --- Determine outcome ---
  const allCmdLost: boolean = _allCommandModulesGone(ps, assembly);

  const landingBodyId: string = flightState.bodyId || 'EARTH';
  const bodyNames: Record<string, string> = {
    SUN: 'Sun', MERCURY: 'Mercury', VENUS: 'Venus', EARTH: 'Earth',
    MOON: 'Moon', MARS: 'Mars', PHOBOS: 'Phobos', DEIMOS: 'Deimos',
  };
  const bodyName: string = bodyNames[landingBodyId] || landingBodyId;

  if (allCmdLost) {
    // All command / computer modules are destroyed — rocket is lost.
    ps.crashed = true;
    _emitEvent(flightState, {
      type:        'CRASH',
      time,
      speed:       impactSpeed,
      bodyId:      landingBodyId,
      description: `Impact on ${bodyName} at ${impactSpeed.toFixed(1)} m/s — rocket destroyed!`,
    });
  } else {
    // Rocket survives (possibly with partial damage).
    ps.landed = true;
    const desc: string = anyDestroyed
      ? `Hard landing on ${bodyName} at ${impactSpeed.toFixed(1)} m/s — some parts destroyed.`
      : `Landed on ${bodyName} at ${impactSpeed.toFixed(1)} m/s.`;
    _emitEvent(flightState, {
      type:          'LANDING',
      time,
      speed:         impactSpeed,
      bodyId:        landingBodyId,
      partsDestroyed: anyDestroyed,
      description:   desc,
    });
    onSafeLanding(ps, assembly, flightState);
  }
}

// ---------------------------------------------------------------------------
// Destruction helpers (private)
// ---------------------------------------------------------------------------

/** Band (VAB world units) around the minimum Y to treat as the same layer. */
const DESTRUCTION_BAND: number = 5;

/**
 * Return the bottom-most layer of active parts — all parts whose bottom
 * edge is within DESTRUCTION_BAND of the lowest bottom edge.
 */
function _getBottomPartLayer(ps: PhysicsState, assembly: RocketAssembly): BottomLayerEntry[] {
  const entries: BottomLayerEntry[] = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const halfH: number   = (def.height ?? 40) / 2;
    let bottomY: number = placed.y - halfH;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      const footY: number = placed.y - dy;
      if (footY < bottomY) bottomY = footY;
    }
    entries.push({ instanceId, bottomY, placed, def });
  }
  if (entries.length === 0) return [];

  entries.sort((a, b) => a.bottomY - b.bottomY);
  const minY: number = entries[0].bottomY;
  return entries.filter((e) => e.bottomY <= minY + DESTRUCTION_BAND);
}

/**
 * Remove a single part from all physics state tracking sets/maps.
 */
function _removePartFromState(ps: PhysicsState, instanceId: string, assembly: RocketAssembly): void {
  ps.activeParts.delete(instanceId);
  ps.firingEngines.delete(instanceId);
  ps.deployedParts.delete(instanceId);
  ps.legStates?.delete(instanceId);
  ps.parachuteStates?.delete(instanceId);
  ps.heatMap?.delete(instanceId);

  // Recalculate power state after losing a part (may have lost panels/batteries).
  if (ps.powerState && assembly) {
    recalcPowerState(ps.powerState, assembly, ps.activeParts);
  }
}

/**
 * Return the lowest bottom edge (VAB world Y) across all active parts.
 */
function _getLowestBottomEdge(ps: PhysicsState, assembly: RocketAssembly): number {
  let lowest = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    let bottomY: number = placed.y - (def.height ?? 40) / 2;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      const footY: number = placed.y - dy;
      if (footY < bottomY) bottomY = footY;
    }
    if (bottomY < lowest) lowest = bottomY;
  }
  return lowest;
}

/**
 * Return true if all COMMAND_MODULE and COMPUTER_MODULE parts in the assembly
 * have been removed from activeParts.
 */
function _allCommandModulesGone(ps: PhysicsState, assembly: RocketAssembly): boolean {
  let hadCmd = false;
  for (const [instanceId, placed] of assembly.parts) {
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    if (def.type === PartType.COMMAND_MODULE || def.type === PartType.COMPUTER_MODULE) {
      hadCmd = true;
      if (ps.activeParts.has(instanceId)) return false; // at least one survives
    }
  }
  return hadCmd; // true only if there were cmd modules and none survive
}

// ---------------------------------------------------------------------------
// FlightState sync (private)
// ---------------------------------------------------------------------------

/**
 * Copy physics state scalars into the persistent FlightState that the rest of
 * the game (mission objectives, UI, save/load) reads.
 *
 * Also recomputes `deltaVRemaining` using the simplified Tsiolkovsky equation:
 *   deltaV ~= avgIsp × g0 × ln(wetMass / dryMass)
 */
function _syncFlightState(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  flightState.altitude = Math.max(0, ps.posY);
  flightState.velocity = Math.hypot(ps.velX, ps.velY);
  flightState.horizontalVelocity = Math.abs(ps.velX);

  // Track peak altitude and velocity for records/statistics.
  if (flightState.altitude > (flightState.maxAltitude ?? 0)) {
    flightState.maxAltitude = flightState.altitude;
  }
  if (flightState.velocity > (flightState.maxVelocity ?? 0)) {
    flightState.maxVelocity = flightState.velocity;
  }

  // Track current biome and record visited biomes.
  const newBiome: string | null = getBiomeId(flightState.altitude, 'EARTH');
  if (newBiome && newBiome !== flightState.currentBiome) {
    const prevBiome: string | null = flightState.currentBiome;
    flightState.currentBiome = newBiome;
    if (!flightState.biomesVisited.includes(newBiome)) {
      flightState.biomesVisited.push(newBiome);
    }
    // Emit a biome change event (useful for orbital science tracking).
    if (prevBiome) {
      flightState.events.push({
        type:        'BIOME_CHANGE',
        time:        flightState.timeElapsed,
        fromBiome:   prevBiome,
        toBiome:     newBiome,
        altitude:    flightState.altitude,
        description: `Entered ${newBiome.replace(/_/g, ' ').toLowerCase()} biome at ${flightState.altitude >= 1000 ? `${(flightState.altitude / 1000).toFixed(0)} km` : `${flightState.altitude.toFixed(0)} m`}.`,
      });

      // Schedule a malfunction check with a small random delay (0.5–2.0 s)
      if (ps._malfunctionCheckPending !== true) {
        ps._malfunctionCheckPending = true;
        ps._malfunctionCheckTimer = 0.5 + Math.random() * 1.5;
      }
    }
  }

  // Total remaining fuel.
  let totalFuel = 0;
  for (const [instanceId, fuel] of ps.fuelStore) {
    if (ps.activeParts.has(instanceId)) totalFuel += fuel;
  }
  flightState.fuelRemaining = totalFuel;

  // Recalculate power state if active part count changed (staging/destruction).
  if (ps.powerState) {
    const prevCap: number = ps.powerState.batteryCapacity;
    const prevArea: number = ps.powerState.solarPanelArea;
    recalcPowerState(ps.powerState, assembly, ps.activeParts);
    // Only sync to flightState if capacity changed (avoids unnecessary writes).
    if (ps.powerState.batteryCapacity !== prevCap || ps.powerState.solarPanelArea !== prevArea) {
      flightState.powerState = ps.powerState;
    }
  }

  // Estimate remaining deltaV using current wet/dry mass split and average Isp.
  flightState.deltaVRemaining = _estimateDeltaV(ps, assembly);
}

/**
 * Estimate remaining deltaV using the Tsiolkovsky rocket equation.
 */
function _estimateDeltaV(ps: PhysicsState, assembly: RocketAssembly): number {
  let dryMass  = 0;
  let wetMass  = 0;
  let totalIspTimesMdot = 0;
  let totalMdot         = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def: PartDef | null | undefined = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    dryMass += def.mass ?? 0;
    const fuel: number = ps.fuelStore.get(instanceId) ?? 0;
    wetMass   += (def.mass ?? 0) + fuel;
  }

  // Average Isp from all active engines/SRBs (vacuum, for deltaV budget).
  for (const instanceId of ps.firingEngines) {
    const placed = assembly.parts.get(instanceId);
    const def: PartDef | null | undefined = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    const isp: number   = def.properties?.ispVac ?? def.properties?.isp ?? 300;
    const thrust: number = (def.properties?.thrustVac ?? def.properties?.thrust ?? 0) * 1_000;
    const mdot: number  = thrust > 0 ? thrust / (isp * G0) : 0;
    totalIspTimesMdot += isp * mdot;
    totalMdot         += mdot;
  }

  if (dryMass <= 0 || wetMass <= dryMass) return 0;

  const avgIsp: number = totalMdot > 0 ? totalIspTimesMdot / totalMdot : 300;
  return avgIsp * G0 * Math.log(wetMass / dryMass);
}

// ---------------------------------------------------------------------------
// Event helpers (private)
// ---------------------------------------------------------------------------

/**
 * Append a flight event to the FlightState event log.
 */
function _emitEvent(flightState: FlightState, event: { time: number; type: string; [key: string]: unknown }): void {
  const withDesc: FlightEvent = { description: '', ...event };
  flightState.events.push(withDesc);
}
