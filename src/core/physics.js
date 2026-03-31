/**
 * physics.js — Flight physics simulation engine.
 *
 * Fixed-timestep integration loop at dt = 1/60 s, scaled by a time-warp
 * multiplier.  Each integration step:
 *   1. Compute total rocket mass (dry parts + remaining fuel).
 *   2. Compute net thrust from all firing engines/SRBs.
 *   3. Apply gravity: 9.81 m/s² downward (constant, simplified).
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

import { getPartById } from '../data/parts.js';
import { PartType, ControlMode } from './constants.js';
import {
  airDensity,
  airDensityForBody,
  ATMOSPHERE_TOP,
  SEA_LEVEL_DENSITY,
  updateHeat,
} from './atmosphere.js';
import { tickFuelSystem } from './fuelsystem.js';
import { activateCurrentStage, tickDebris } from './staging.js';
import { tickCollisions } from './collision.js';
import {
  initParachuteStates,
  tickParachutes,
  tickCanopyAngles,
  tickLandedParachutes,
  ParachuteState,
  DEPLOY_DURATION,
  LOW_DENSITY_THRESHOLD,
} from './parachute.js';
import {
  initLegStates,
  tickLegs,
  countDeployedLegs,
  getDeployedLegFootOffset,
  LegState,
} from './legs.js';
import { initEjectorStates } from './ejector.js';
import {
  initScienceModuleStates,
  tickScienceModules,
  onSafeLanding,
} from './sciencemodule.js';
import { getBiomeId } from './biomes.js';
import {
  initMalfunctionState,
  checkMalfunctions,
  tickMalfunctions,
  hasMalfunction,
  getMalfunction,
} from './malfunction.js';
import { MalfunctionType, REDUCED_THRUST_FACTOR, PARTIAL_CHUTE_FACTOR } from './constants.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard gravity (m/s²). */
const G0 = 9.81;

/** Fixed physics timestep (seconds). */
const FIXED_DT = 1 / 60;

/** Scale factor: metres per pixel at default 1× zoom. */
const SCALE_M_PER_PX = 0.05;

/**
 * Base rocket turn rate in radians/second.
 * At 30°/s, a 90° turn takes 3 seconds — deliberately sluggish.
 */
const BASE_TURN_RATE = Math.PI / 6;

/** Turn-rate multiplier applied when RCS is available in vacuum. */
const RCS_TURN_MULTIPLIER = 2.5;

/** Throttle change per keypress (5 %). */
const THROTTLE_STEP = 0.05;

/** Target TWR change per keypress in TWR mode. */
const TWR_STEP = 0.1;

/**
 * Drag coefficient multiplier applied to an open parachute.
 * An open chute is modelled as having 80× its stowed Cd — very high drag.
 */
const CHUTE_DRAG_MULTIPLIER = 80;

/** Landing speed below which a contact is considered "safe" (m/s). */
const DEFAULT_SAFE_LANDING_SPEED = 10;

/** Default crash threshold (m/s) for parts without an explicit crashThreshold. */
const DEFAULT_CRASH_THRESHOLD = 10;

// -- Ground tipping constants ------------------------------------------------
/** N·m of torque applied by player A/D input while grounded. */
const PLAYER_TIP_TORQUE = 50_000;
/** Angle (radians) past which a grounded tipping rocket crashes (~80°). */
const TOPPLE_CRASH_ANGLE = Math.PI * 0.44;
/** Per-tick angular velocity damping while tipping on the ground.
 *  0.92 gives roughly 0.92^60 ≈ 0.007 decay per second — settles in ~2s. */
const GROUND_ANGULAR_DAMPING = 0.98;
/** Maximum angular acceleration (rad/s²) from player tipping input.
 *  Prevents tiny landed parts from instantly toppling, but must exceed the
 *  gravity restoring acceleration for a typical capsule (~5 rad/s²). */
const MAX_PLAYER_TIP_ACCEL = 10.0;
/** Angle threshold below which a near-upright rocket snaps to 0. */
const TILT_SNAP_THRESHOLD = 0.005;
/** Angular velocity threshold below which snap to rest. */
const ANGULAR_VEL_SNAP_THRESHOLD = 0.05;

// -- Airborne torque-based rotation constants --------------------------------
/** N·m of torque applied by player A/D input while airborne. */
const PLAYER_FLIGHT_TORQUE = 2000;
/** Torque multiplier when in vacuum with RCS-capable command module. */
const RCS_TORQUE_MULTIPLIER = 2.5;
/** Angular damping coefficient in atmosphere (proportional to density). */
const AERO_ANGULAR_DAMPING = 0.02;
/** Active RCS braking torque (N·m per rad/s) when keys released. */
const RCS_ANGULAR_DAMPING = 3.0;
/** Tuning knob for parachute stabilization torque strength. */
const CHUTE_TORQUE_SCALE = 3.0;
/** Angular velocity decay rate (1/s) for deployed parachutes.
 *  Models line/canopy drag resisting pendulum swing.
 *  Applied as a fixed decay rate (not divided by I) so it works correctly
 *  for both tiny capsules and heavy rockets. */
const CHUTE_DIRECT_DAMPING = 5.0;
/** Maximum angular acceleration (rad/s²) from player input.
 *  Prevents tiny rockets from spinning uncontrollably. */
const MAX_PLAYER_ANGULAR_ACCEL = 2.0;
/** Maximum angular acceleration (rad/s²) from parachute torques.
 *  Prevents integration blow-up on small, light capsules. */
const MAX_CHUTE_ANGULAR_ACCEL = 50.0;

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * Internal physics state for an active flight.
 *
 * This object is created once per launch via {@link createPhysicsState} and
 * mutated in-place on every {@link tick}.  It is NOT part of the serialised
 * GameState — the higher-level FlightState in gameState.js carries the
 * persisted snapshot.
 *
 * @typedef {Object} PhysicsState
 * @property {number}          posX          Horizontal position (m; 0 = launch pad).
 * @property {number}          posY          Vertical position   (m; 0 = ground).
 * @property {number}          velX          Horizontal velocity (m/s).
 * @property {number}          velY          Vertical velocity   (m/s).
 * @property {number}          angle         Rocket orientation (radians; 0 = straight up).
 * @property {number}          throttle      Current throttle level (0 – 1; 1 = 100 %).
 * @property {Set<string>}     firingEngines Instance IDs of currently burning engines/SRBs.
 * @property {Map<string,number>} fuelStore  Remaining propellant per part (kg).
 *                                           Covers both liquid tanks and SRB integral fuel.
 * @property {Set<string>}     activeParts   Instance IDs of parts still attached to the rocket.
 * @property {Set<string>}     deployedParts Instance IDs of parachutes/legs that have been deployed.
 * @property {Map<string, import('./parachute.js').ParachuteEntry>} parachuteStates
 *                                           Detailed lifecycle state for each PARACHUTE part
 *                                           (packed / deploying / deployed / failed), managed
 *                                           by parachute.js.  Keyed by instance ID.
 * @property {Map<string, import('./legs.js').LegEntry>} legStates
 *                                           Detailed lifecycle state for each LANDING_LEGS /
 *                                           LANDING_LEG part (retracted / deploying / deployed),
 *                                           managed by legs.js.  Keyed by instance ID.
 * @property {Map<string, string>} ejectorStates
 *                                           Armed/activated state for each COMMAND_MODULE part
 *                                           with an ejector seat (`hasEjectorSeat = true`),
 *                                           managed by ejector.js.  Keyed by instance ID.
 *                                           Values are EjectorState enum strings.
 * @property {Set<string>}     ejectedCrewIds  IDs of crew members who have safely ejected
 *                                           via the ejector seat system during this flight.
 *                                           Populated by `activateEjectorSeat()`.
 * @property {Map<string, import('./sciencemodule.js').InstrumentStateEntry>} instrumentStates
 *                                           Per-instrument experiment lifecycle state, keyed by
 *                                           compound key `moduleInstanceId:instr:slotIndex`.
 *                                           Managed by sciencemodule.js.
 * @property {Map<string, object>} scienceModuleStates
 *                                           Legacy module-level summary state for backward
 *                                           compatibility with mission objective checks.
 *                                           Keyed by module instance ID.
 * @property {boolean}         landed        True after a successful soft touchdown.
 * @property {boolean}         crashed       True after a fatal impact.
 * @property {boolean}         grounded      True while still sitting on the launch pad.
 * @property {Map<string,number>} heatMap      Accumulated reentry heat per part (heat units).
 *                                             Keyed by instance ID; initialised to 0.
 * @property {import('./staging.js').DebrisState[]} debris  Jettisoned stage
 *   fragments that continue to be simulated independently.  New entries are
 *   appended whenever a decoupler fires via {@link fireNextStage}.
 * @property {number}          angularVelocity  Angular velocity (rad/s; positive = clockwise).
 * @property {boolean}         isTipping     True when tilted on ground — rotation is around
 *                                           the ground contact point rather than centre of mass.
 * @property {number}          tippingContactX  Ground contact pivot X in VAB local pixels.
 * @property {number}          tippingContactY  Ground contact pivot Y in VAB local pixels.
 * @property {Set<string>}     _heldKeys     Keys currently held down (for continuous steering).
 * @property {number}          _accumulator  Leftover simulation time from the previous frame.
 * @property {string}          controlMode   Current control mode (ControlMode enum).
 * @property {import('./gameState.js').OrbitalElements|null} baseOrbit
 *                                           Frozen orbital elements in docking mode.
 * @property {Object|null}     dockingAltitudeBand  Altitude band when docking mode entered.
 * @property {number}          dockingOffsetAlongTrack  Along-track offset in docking (m).
 * @property {number}          dockingOffsetRadial      Radial offset in docking (m).
 * @property {Set<string>}     rcsActiveDirections  Active RCS thrust dirs for plume rendering.
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an initial PhysicsState for a rocket about to launch.
 *
 * Populates the fuel store from tank/SRB `fuelMass` properties and marks
 * every part in the assembly as active.
 *
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState  Used to
 *   initialise `fuelRemaining` with the full wet-fuel load.
 * @returns {PhysicsState}
 */
export function createPhysicsState(assembly, flightState) {
  const fuelStore = new Map();
  let totalFuel = 0;

  for (const [instanceId, placed] of assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass = def.properties?.fuelMass ?? 0;
    if (fuelMass > 0) {
      fuelStore.set(instanceId, fuelMass);
      totalFuel += fuelMass;
    }
  }

  // Seed the FlightState with the full fuel load.
  if (flightState) {
    flightState.fuelRemaining = totalFuel;
  }

  const ps = {
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
    ejectedCrew: [],              // { x, y, velX, velY } — visible ejected crew capsules
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
    /** Current control mode (NORMAL, DOCKING, or RCS). */
    controlMode: ControlMode.NORMAL,
    /** Frozen orbital elements when in docking mode (reference frame). */
    baseOrbit: null,
    /** Altitude band the craft was in when docking mode was entered. */
    dockingAltitudeBand: null,
    /** Accumulated along-track offset in docking mode (m). */
    dockingOffsetAlongTrack: 0,
    /** Accumulated radial offset in docking mode (m). */
    dockingOffsetRadial: 0,
    /** Active RCS thrust directions for plume rendering (set of 'up'|'down'|'left'|'right'). */
    rcsActiveDirections: new Set(),
    /** Docking port states: instanceId → 'retracted'|'extended'|'docked'. */
    dockingPortStates: new Map(),
    /** Combined mass when docked (0 = not docked, use craft mass only). */
    _dockedCombinedMass: 0,
  };

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
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.DOCKING_PORT) {
      ps.dockingPortStates.set(instanceId, 'retracted');
    }
  }

  // Flag on flightState so mission objective checking knows whether science
  // modules are present (used to gate HOLD_ALTITUDE time accumulation).
  if (flightState) {
    flightState.hasScienceModules = ps.scienceModuleStates.size > 0 || ps.instrumentStates.size > 0;
    flightState.scienceModuleRunning = false;
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
 *
 * @param {PhysicsState}                                  ps
 * @param {import('./rocketbuilder.js').RocketAssembly}   assembly
 * @param {import('./rocketbuilder.js').StagingConfig}    stagingConfig
 * @param {import('./gameState.js').FlightState}          flightState
 * @param {number}  realDeltaTime  Seconds since the last frame.
 * @param {number}  [timeWarp=1]   Time-acceleration multiplier.
 */
export function tick(ps, assembly, stagingConfig, flightState, realDeltaTime, timeWarp = 1) {
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
          if (debris.landed && !debris.crashed) tickDebrisGround(debris, assembly, FIXED_DT);
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
      if (debris.landed && !debris.crashed) tickDebrisGround(debris, assembly, FIXED_DT);
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
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly  Needed for
 *   RCS lookup in the turn-rate calculation. May be omitted (pass null) if
 *   steering is handled externally.
 * @param {string} key  KeyboardEvent.key value (e.g. 'a', 'ArrowUp').
 */
export function handleKeyDown(ps, assembly, key) {
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
 *
 * @param {PhysicsState} ps
 * @param {string}       key  KeyboardEvent.key value.
 */
export function handleKeyUp(ps, key) {
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
 *
 * @param {PhysicsState}                                 ps
 * @param {import('./rocketbuilder.js').RocketAssembly}  assembly
 * @param {import('./rocketbuilder.js').StagingConfig}   stagingConfig
 * @param {import('./gameState.js').FlightState}         flightState
 */
export function fireNextStage(ps, assembly, stagingConfig, flightState) {
  if (ps.crashed || flightState.aborted) return;

  // Allow staging while landed — transition to grounded so physics resumes.
  if (ps.landed) {
    ps.landed = false;
    ps.grounded = true;
  }

  const newDebris = activateCurrentStage(ps, assembly, stagingConfig, flightState);
  ps.debris.push(...newDebris);
}

// ---------------------------------------------------------------------------
// TWR-relative throttle conversion (private)
// ---------------------------------------------------------------------------

/**
 * When in TWR throttle mode, compute the raw throttle needed to achieve
 * `ps.targetTWR` and write it to `ps.throttle`.
 *
 * Formula: throttle = clamp((targetTWR * totalMass * G0 - srbThrustN) / maxLiquidThrustN, 0, 1)
 *
 * If targetTWR is Infinity, sets throttle = 1 (max thrust).
 * If no liquid engines are firing, does nothing (can't throttle SRBs).
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 */
function _updateThrottleFromTWR(ps, assembly) {
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
    const def = getPartById(placed.partId);
    if (!def) continue;

    totalMass += (def.mass ?? 0) + (ps.fuelStore.get(instanceId) ?? 0);

    if (ps.firingEngines.has(instanceId)) {
      const thrustN = (def.properties?.thrust ?? 0) * 1_000; // kN → N
      if (def.type === PartType.SOLID_ROCKET_BOOSTER) {
        srbThrustN += thrustN;
      } else {
        maxLiquidThrustN += thrustN;
      }
    }
  }

  if (maxLiquidThrustN <= 0) return; // can't throttle SRBs
  if (totalMass <= 0) return;

  const needed = ps.targetTWR * totalMass * G0 - srbThrustN;
  ps.throttle = Math.max(0, Math.min(1, needed / maxLiquidThrustN));
}

// ---------------------------------------------------------------------------
// Integration step (private)
// ---------------------------------------------------------------------------

/**
 * Advance the simulation by exactly FIXED_DT seconds.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState
 */
function _integrate(ps, assembly, flightState) {
  // --- 0. TWR-relative throttle conversion --------------------------------
  _updateThrottleFromTWR(ps, assembly);

  const altitude = Math.max(0, ps.posY);
  const density  = airDensity(altitude);

  // --- 1. Total rocket mass (dry + remaining fuel) -------------------------
  const totalMass = _computeTotalMass(ps, assembly);

  // --- Docking / RCS mode: thrust affects local position, not orbit --------
  const isDockingOrRcs = ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS;

  // --- 2. Thrust vector ----------------------------------------------------
  // In docking/RCS modes, main engine thrust is suppressed — movement comes
  // from docking thrusters only (handled in _applyDockingMovement).
  let thrustX = 0;
  let thrustY = 0;
  if (!isDockingOrRcs) {
    const thrustResult = _computeThrust(ps, assembly, density);
    thrustX = thrustResult.thrustX;
    thrustY = thrustResult.thrustY;
  }

  // --- 3. Gravity force (constant downward) --------------------------------
  const gravFX = 0;
  const gravFY = -G0 * totalMass;

  // --- 4. Drag force -------------------------------------------------------
  const speed    = Math.hypot(ps.velX, ps.velY);
  const dragMag  = _computeDragForce(ps, assembly, density, speed);
  let dragFX = 0;
  let dragFY = 0;
  if (speed > 1e-6) {
    dragFX = -dragMag * (ps.velX / speed);
    dragFY = -dragMag * (ps.velY / speed);
  }

  // --- 5. Net acceleration -------------------------------------------------
  const netFX = thrustX + gravFX + dragFX;
  const netFY = thrustY + gravFY + dragFY;

  let accX = netFX / totalMass;
  let accY = netFY / totalMass;

  // Ground reaction: prevent downward acceleration while on launch pad.
  if (ps.grounded && accY < 0) {
    accY = 0;
    accX = 0; // no horizontal drift on pad
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
  _applySteering(ps, assembly, altitude, FIXED_DT);

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
    ps._malfunctionCheckTimer -= FIXED_DT;
    if (ps._malfunctionCheckTimer <= 0) {
      ps._malfunctionCheckPending = false;
      checkMalfunctions(ps, assembly, flightState, ps._gameState ?? null);
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

  // --- 9d. Ejected crew physics --------------------------------------------
  if (ps.ejectedCrew) {
    const G = 9.81;
    for (const crew of ps.ejectedCrew) {
      // Countdown to chute deployment
      if (!crew.chuteOpen && crew.chuteTimer > 0) {
        crew.chuteTimer -= FIXED_DT;
        if (crew.chuteTimer <= 0) crew.chuteOpen = true;
      }

      // Gravity
      crew.velY -= G * FIXED_DT;

      // Parachute drag when open (terminal velocity ~5 m/s)
      if (crew.chuteOpen && crew.velY < 0) {
        const drag = 0.5 * crew.velY * crew.velY * 0.08;
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
    // Use body-aware density for heat when flying at a non-Earth body.
    const bodyId = flightState.bodyId;
    const heatDensity = (bodyId && bodyId !== 'EARTH')
      ? airDensityForBody(altitude, bodyId)
      : density;
    updateHeat(ps, assembly, flightState, speed, altitude, heatDensity);
  }

  // --- 10. Liftoff detection -----------------------------------------------
  if (ps.grounded && ps.posY > 0) {
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
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {number}  Mass in kilograms (minimum 1 kg to avoid division-by-zero).
 */
function _computeTotalMass(ps, assembly) {
  let mass = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
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
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {{ x: number, y: number }}  CoM in VAB pixels (Y-up).
 */
function _computeCoMLocal(ps, assembly) {
  let totalMass = 0;
  let comX = 0;
  let comY = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass = ps.fuelStore.get(instanceId) ?? 0;
    const mass = (def.mass ?? 1) + fuelMass;
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
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {number} tiltDirection  +1 for rightward tilt, -1 for leftward.
 * @returns {{ x: number, y: number }}  Contact point in VAB pixels.
 */
function _computeGroundContactPoint(ps, assembly, tiltDirection) {
  let lowestY = Infinity;
  let bestX = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const halfH = (def.height ?? 40) / 2;
    let halfW = (def.width ?? 40) / 2;

    let bottomY = placed.y - halfH;
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
      const candidateX = placed.x + tiltDirection * halfW;
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
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {{ x: number, y: number }} pivot  Pivot in VAB local pixels.
 * @returns {number}  Moment of inertia in kg·m² (minimum 1).
 */
function _computeMomentOfInertia(ps, assembly, pivot) {
  let I = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass = ps.fuelStore.get(instanceId) ?? 0;
    const mass = (def.mass ?? 1) + fuelMass;
    const dx = (placed.x - pivot.x) * SCALE_M_PER_PX;
    const dy = (placed.y - pivot.y) * SCALE_M_PER_PX;
    // Self-inertia: rectangular body I = m(w² + h²)/12.
    const wM = (def.width  ?? 40) * SCALE_M_PER_PX;
    const hM = (def.height ?? 40) * SCALE_M_PER_PX;
    const Iself = mass * (wM * wM + hM * hM) / 12;
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
 *
 * Fuel consumption is handled separately by tickFuelSystem (fuelsystem.js),
 * which runs after this function each step.  The only fuel check performed
 * here is a cheap guard against SRBs that were already empty at the start
 * of the step.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {number} density  Current atmospheric density (kg/m³).
 * @returns {{ thrustX: number, thrustY: number }}
 */
function _computeThrust(ps, assembly, density) {
  const densityRatio = density / SEA_LEVEL_DENSITY; // 0 in vacuum, 1 at sea level

  let totalThrustN = 0;
  const exhausted  = [];

  for (const instanceId of ps.firingEngines) {
    // Skip parts that have been jettisoned.
    if (!ps.activeParts.has(instanceId)) {
      exhausted.push(instanceId);
      continue;
    }

    const placed = assembly.parts.get(instanceId);
    if (!placed) { exhausted.push(instanceId); continue; }

    const def = getPartById(placed.partId);
    if (!def)   { exhausted.push(instanceId); continue; }

    const props = def.properties ?? {};
    const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;

    // Guard: SRBs that already have no fuel produce no thrust this step.
    if (isSRB) {
      const fuelLeft = ps.fuelStore.get(instanceId) ?? 0;
      if (fuelLeft <= 0) {
        exhausted.push(instanceId);
        continue;
      }
    }

    // Interpolate thrust between sea-level and vacuum values.
    const thrustSL   = (props.thrust    ?? 0) * 1_000; // kN → N
    const thrustVac  = (props.thrustVac ?? props.thrust ?? 0) * 1_000;
    const rawThrustN = densityRatio * thrustSL + (1 - densityRatio) * thrustVac;

    // Throttle: SRBs always at 100 %; liquid engines use current setting.
    const throttleMult     = isSRB ? 1.0 : ps.throttle;
    let   effectiveThrustN = rawThrustN * throttleMult;

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
  const thrustX = totalThrustN * Math.sin(ps.angle);
  const thrustY = totalThrustN * Math.cos(ps.angle);

  return { thrustX, thrustY };
}

// ---------------------------------------------------------------------------
// Drag calculation (private)
// ---------------------------------------------------------------------------

/**
 * Return the deployment progress for a parachute: 0 = packed/failed,
 * 0→1 during the deploying animation, 1 = fully deployed.
 *
 * @param {PhysicsState} ps
 * @param {string}       instanceId
 * @returns {number}
 */
function _getChuteDeployProgress(ps, instanceId) {
  const entry = ps.parachuteStates?.get(instanceId);
  if (!entry) return 0;
  switch (entry.state) {
    case 'deployed':  return 1;
    case 'deploying': {
      const linear = Math.max(0, Math.min(1, 1 - entry.deployTimer / DEPLOY_DURATION));
      return linear;
    }
    default:          return 0;
  }
}

/**
 * Compute the aerodynamic drag force magnitude (Newtons).
 *
 * dragForce = 0.5 × ρ × v² × Cd × A  (summed over all active parts)
 *
 * For PARACHUTE parts, CdA is interpolated between the small stowed profile
 * and the large deployed canopy area (from `properties.deployedDiameter` and
 * `properties.deployedCd`) based on the deployment state machine progress.
 * Both ends are scaled by atmospheric density so chutes are ineffective in
 * near-vacuum conditions.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {number} density  Air density (kg/m³).
 * @param {number} speed    Current rocket speed (m/s).
 * @returns {number}  Drag force in Newtons.
 */
function _computeDragForce(ps, assembly, density, speed) {
  if (density <= 0 || speed <= 0) return 0;

  let totalCdA = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const props  = def.properties ?? {};
    const widthM = (def.width ?? 40) * SCALE_M_PER_PX;
    const area   = Math.PI * (widthM / 2) ** 2; // stowed circular cross-section

    if (def.type === PartType.PARACHUTE) {
      // Stowed CdA — used when packed or failed.
      const stowedCdA = (props.dragCoefficient ?? 0.05) * area;

      // Deployed CdA — uses the real canopy diameter, not the stowed profile.
      const deployedR   = (props.deployedDiameter ?? 10) / 2;
      const deployedCd  = props.deployedCd ?? 0.75;
      const deployedCdA = deployedCd * Math.PI * deployedR * deployedR;

      // Linearly interpolate from stowed → deployed as the canopy opens.
      // Scale by atmospheric density so chutes are ineffective near vacuum.
      const progress     = _getChuteDeployProgress(ps, instanceId);
      const densityScale = Math.min(1, density / LOW_DENSITY_THRESHOLD);
      let   chuteCdA     = stowedCdA + (deployedCdA - stowedCdA) * progress * densityScale;

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
 *
 * Translational drag is already handled by `_computeDragForce()`; this
 * function only returns the rotational (torque) component.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {{ x: number, y: number }}                   com  CoM in VAB pixels.
 * @param {number} density  Air density (kg/m³).
 * @param {number} speed    Current rocket speed (m/s).
 * @returns {number}  Net torque in N·m (positive = clockwise).
 */
function _computeParachuteTorque(ps, assembly, com, density, speed) {
  if (density <= 0 || speed <= 0 || !ps.parachuteStates) return 0;

  const q = 0.5 * density * speed * speed;     // dynamic pressure
  const sinA = Math.sin(ps.angle);

  let totalTorque = 0;

  for (const [instanceId, entry] of ps.parachuteStates) {
    if (entry.state !== 'deploying' && entry.state !== 'deployed') continue;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    // Chute CdA (same formula as _computeDragForce).
    const props     = def.properties ?? {};
    const widthM    = (def.width ?? 40) * SCALE_M_PER_PX;
    const stowedA   = Math.PI * (widthM / 2) ** 2;
    const stowedCdA = (props.dragCoefficient ?? 0.05) * stowedA;
    const deployedR   = (props.deployedDiameter ?? 10) / 2;
    const deployedCd  = props.deployedCd ?? 0.75;
    const deployedCdA = deployedCd * Math.PI * deployedR * deployedR;
    const progress     = _getChuteDeployProgress(ps, instanceId);
    const densityScale = Math.min(1, density / LOW_DENSITY_THRESHOLD);
    const chuteCdA = stowedCdA + (deployedCdA - stowedCdA) * progress * densityScale;

    // Drag magnitude (the line tension pulling the capsule toward the canopy).
    const dragMag = q * chuteCdA;

    // Pendulum restoring torque: the capsule hangs below the canopy on lines.
    // When tilted by angle θ, the horizontal component of line tension
    // provides a restoring torque = -dragMag * lineLength * sin(θ).
    // The effective line length is the distance from CoM to the chute part.
    const dx = (placed.x - com.x) * SCALE_M_PER_PX;
    const dy = (placed.y - com.y) * SCALE_M_PER_PX;
    const lineLen = Math.sqrt(dx * dx + dy * dy);

    totalTorque -= dragMag * lineLen * sinA;
  }

  return totalTorque * CHUTE_TORQUE_SCALE;
}

// ---------------------------------------------------------------------------
// Steering (private)
// ---------------------------------------------------------------------------

/**
 * Apply continuous steering inputs from held A/D (or arrow) keys.
 *
 * Torque-based rotation: heavier/longer rockets turn slower.
 * When grounded, delegates to `_applyGroundedSteering` for tipping physics.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {number} altitude  Current altitude (m) for vacuum check.
 * @param {number} dt        Integration timestep (s).
 */
// ---------------------------------------------------------------------------
// Docking / RCS mode movement (private)
// ---------------------------------------------------------------------------

/**
 * Apply docking/RCS mode translational movement.
 *
 * In DOCKING mode: A/D = along-track, W/S = radial.
 * In RCS mode: WASD = craft-relative directional translation.
 * Movement is applied as small velocity deltas restricted to the altitude band.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {number} totalMass  Total rocket mass (kg).
 * @param {number} dt         Timestep (s).
 */
function _applyDockingMovement(ps, assembly, totalMass, dt) {
  const isDocking = ps.controlMode === ControlMode.DOCKING;
  const isRcs     = ps.controlMode === ControlMode.RCS;
  if (!isDocking && !isRcs) return;

  // Clear RCS active directions each step; re-set below if active.
  ps.rcsActiveDirections.clear();

  const w = ps._heldKeys.has('w') || ps._heldKeys.has('ArrowUp');
  const s = ps._heldKeys.has('s') || ps._heldKeys.has('ArrowDown');
  const a = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
  const d = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');

  if (!w && !s && !a && !d) return;

  // Determine thrust magnitude based on mode.
  // When docked, use combined mass for thrust calculations.
  const thrustN = isRcs ? 500 : 2000; // N
  const effectiveMass = ps._dockedCombinedMass > 0
    ? Math.max(totalMass, ps._dockedCombinedMass)
    : totalMass;
  const accel = thrustN / Math.max(1, effectiveMass);

  if (isRcs) {
    // RCS mode: WASD = craft-relative translation.
    // W = forward (along rocket axis), S = backward,
    // A = left, D = right (perpendicular to rocket axis).
    let dvAlongAxis = 0;
    let dvPerpAxis = 0;
    if (w) { dvAlongAxis += accel * dt; ps.rcsActiveDirections.add('up'); }
    if (s) { dvAlongAxis -= accel * dt; ps.rcsActiveDirections.add('down'); }
    if (a) { dvPerpAxis -= accel * dt;  ps.rcsActiveDirections.add('left'); }
    if (d) { dvPerpAxis += accel * dt;  ps.rcsActiveDirections.add('right'); }

    // Convert craft-relative to world coordinates.
    // Rocket angle: 0 = pointing up (+Y), positive = clockwise.
    const sinA = Math.sin(ps.angle);
    const cosA = Math.cos(ps.angle);
    // Along axis (rocket's up direction): (+sinA, +cosA)
    // Perpendicular (rocket's right direction): (+cosA, -sinA)
    ps.velX += dvAlongAxis * sinA + dvPerpAxis * cosA;
    ps.velY += dvAlongAxis * cosA - dvPerpAxis * sinA;
  } else {
    // DOCKING mode: A/D = along-track, W/S = radial.
    // Along-track = velocity direction (prograde/retrograde).
    // Radial = perpendicular to velocity (toward/away from body).
    const speed = Math.hypot(ps.velX, ps.velY);
    let progX, progY, radOutX, radOutY;

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
    // Body centre is at (0, -R) in game coords, so radial out from craft
    // should point in the direction of (posX, posY + R).
    const radCheck = radOutX * ps.posX + radOutY * (ps.posY + 6_371_000);
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
      const alt = Math.max(0, ps.posY);
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

function _applySteering(ps, assembly, altitude, dt) {
  // In RCS mode, rotation is disabled.
  if (ps.controlMode === ControlMode.RCS) return;

  // In DOCKING mode, A/D don't rotate — they're handled by _applyDockingMovement.
  if (ps.controlMode === ControlMode.DOCKING) return;

  const left  = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
  const right = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');

  // Grounded or landed: delegate to tipping physics (always runs for gravity torque).
  if (ps.grounded || ps.landed) {
    _applyGroundedSteering(ps, assembly, left, right, dt);
    return;
  }

  // --- Airborne torque-based rotation ---
  const com = _computeCoMLocal(ps, assembly);
  const I = _computeMomentOfInertia(ps, assembly, com);
  const density = airDensity(Math.max(0, ps.posY));
  const speed   = Math.hypot(ps.velX, ps.velY);

  // Player input torque — compute angular acceleration and cap it so light
  // rockets don't spin uncontrollably.
  let baseTorque = PLAYER_FLIGHT_TORQUE;
  if (altitude > ATMOSPHERE_TOP && _hasRcs(ps, assembly)) {
    baseTorque *= RCS_TORQUE_MULTIPLIER;
  }
  let playerAlpha = 0;
  if (right) playerAlpha += baseTorque / I;
  if (left)  playerAlpha -= baseTorque / I;
  playerAlpha = Math.max(-MAX_PLAYER_ANGULAR_ACCEL, Math.min(MAX_PLAYER_ANGULAR_ACCEL, playerAlpha));

  // Parachute restoring torque (pendulum effect) — capped per angular accel
  // to prevent integration blow-up on very light capsules.
  let restoringTorque = _computeParachuteTorque(ps, assembly, com, density, speed);
  let restoringAlpha = restoringTorque / I;
  restoringAlpha = Math.max(-MAX_CHUTE_ANGULAR_ACCEL, Math.min(MAX_CHUTE_ANGULAR_ACCEL, restoringAlpha));

  const alpha = playerAlpha + restoringAlpha;
  ps.angularVelocity += alpha * dt;

  // Parachute angular damping — applied as implicit exponential decay so it
  // is unconditionally stable even for tiny moments of inertia.
  // Uses a fixed decay rate modelling line/canopy drag on the pendulum swing,
  // scaled by atmospheric density so it vanishes in vacuum.
  if (density > 0 && ps.parachuteStates) {
    let hasActiveChute = false;
    for (const [, entry] of ps.parachuteStates) {
      if (entry.state === 'deploying' || entry.state === 'deployed') {
        hasActiveChute = true;
        break;
      }
    }
    if (hasActiveChute) {
      const densityFrac = Math.min(1, density / LOW_DENSITY_THRESHOLD);
      ps.angularVelocity *= Math.exp(-CHUTE_DIRECT_DAMPING * densityFrac * dt);
    }
  }

  // Damping (when no input).
  if (!left && !right) {
    // Aerodynamic damping (proportional to density).
    const aeroDamping = AERO_ANGULAR_DAMPING * density;
    ps.angularVelocity -= aeroDamping * ps.angularVelocity * dt;

    // RCS active braking in vacuum.
    if (altitude > ATMOSPHERE_TOP && _hasRcs(ps, assembly)) {
      const rcsBrake = RCS_ANGULAR_DAMPING * ps.angularVelocity / I;
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

/**
 * Apply ground-contact tipping physics.
 *
 * When the rocket is on the ground (grounded or landed), rotation happens
 * around the base contact corner, not the centre of mass.  Gravity produces
 * a restoring or toppling torque depending on how far the CoM has moved past
 * the support base.  Player A/D input adds an additional torque.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {boolean} left   A/ArrowLeft held.
 * @param {boolean} right  D/ArrowRight held.
 * @param {number}  dt     Integration timestep (s).
 */

/** Returns true if any parachute is currently deploying or deployed. */
function _hasActiveParachutes(ps) {
  if (!ps.parachuteStates) return false;
  for (const [, entry] of ps.parachuteStates) {
    if (entry.state === ParachuteState.DEPLOYING || entry.state === ParachuteState.DEPLOYED) return true;
  }
  return false;
}

function _hasAsymmetricLegs(ps, assembly) {
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

function _applyGroundedSteering(ps, assembly, left, right, dt) {
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
  // VAB local coords are Y-up (positive Y = upward, away from ground).
  // All rotation formulas below use the standard Y-up clockwise rotation:
  //   worldX = lx·cos + ly·sin,  worldY = -lx·sin + ly·cos
  //
  // Ground contact = softmax-weighted average of all corners, where the
  // "ground projection" gp is the dot product with the world-downward
  // direction (-sin, -cos) in local coords.  max gp = closest to ground.
  // The softmax gives:
  //   - A single corner when one is clearly the lowest (sharp selection).
  //   - A smooth midpoint when a flat face rests on the ground (no oscillation).
  //   - Continuous transitions as the rocket rolls between orientations.
  const cosA = Math.cos(ps.angle);
  const sinA = Math.sin(ps.angle);

  // Collect all corners with their gp values, tracking the maximum.
  const allCorners = [];
  let maxGP = -Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const hw = (def.width  ?? 40) / 2;
    const hh = (def.height ?? 40) / 2;

    let halfW = hw;
    let bottomHH = hh;
    // Deployed landing legs extend the foot below and outward.
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      if (dy > 0) {
        halfW = Math.max(halfW, dx);
        bottomHH = Math.max(hh, dy);
      }
    }

    const corners = [
      [placed.x - halfW, placed.y - bottomHH],
      [placed.x + halfW, placed.y - bottomHH],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ];
    for (const [cx, cy] of corners) {
      // Project onto the world-downward direction so max gp = closest to
      // ground.  In Y-up local coords with clockwise rotation convention
      // (worldY = -lx·sinA + ly·cosA), the downward direction (0,-1) maps
      // to local (sinA, -cosA), so gp = cx·sinA - cy·cosA.
      const gp = cx * sinA - cy * cosA;
      allCorners.push({ cx, cy, gp });
      if (gp > maxGP) maxGP = gp;
    }
  }

  // Softmax-weighted average: corners near the ground dominate; corners far
  // above contribute negligibly.  CONTACT_SHARPNESS controls the transition
  // width (~1-2 px of gp difference at sharpness 2.0).
  const CONTACT_SHARPNESS = 2.0;
  let sumW = 0, sumWX = 0, sumWY = 0;
  for (const c of allCorners) {
    const w = Math.exp(CONTACT_SHARPNESS * (c.gp - maxGP));
    sumW  += w;
    sumWX += w * c.cx;
    sumWY += w * c.cy;
  }
  const contactLX = sumWX / sumW;
  const contactLY = sumWY / sumW;

  const contact = { x: contactLX, y: contactLY };

  // Where is this contact point in world space right now?
  // Y-up local, clockwise rotation by angle A:
  //   worldX = posX + (lx·cos + ly·sin) * SCALE
  const contactWorldX = ps.posX + (contactLX * cosA + contactLY * sinA) * SCALE_M_PER_PX;

  // Compute moment of inertia about the contact point.
  const I = _computeMomentOfInertia(ps, assembly, contact);

  // Compute CoM position relative to contact point, then rotate to get
  // the world-X offset (horizontal distance for gravity torque).
  // Y-up clockwise rotation: worldX = relX·cos + relY·sin
  const com = _computeCoMLocal(ps, assembly);
  const relX = (com.x - contactLX) * SCALE_M_PER_PX;
  const relY = (com.y - contactLY) * SCALE_M_PER_PX;
  const rotatedX = relX * cosA + relY * sinA;

  // Gravity torque: weight × horizontal distance from contact to CoM.
  // Positive rotatedX → CoM is to the right of contact → positive (clockwise) torque.
  const totalMass = _computeTotalMass(ps, assembly);
  const gravityTorque = totalMass * G0 * rotatedX;

  // Player input torque — capped per angular acceleration so light parts
  // don't instantly topple.
  let inputAccel = 0;
  if (right) inputAccel += PLAYER_TIP_TORQUE / I;
  if (left)  inputAccel -= PLAYER_TIP_TORQUE / I;
  inputAccel = Math.max(-MAX_PLAYER_TIP_ACCEL, Math.min(MAX_PLAYER_TIP_ACCEL, inputAccel));

  // Net angular acceleration.
  const gravAccel = gravityTorque / I;
  const angAccel = gravAccel + inputAccel;

  // Euler integrate.
  ps.angularVelocity += angAccel * dt;

  // Heavy damping during active player input limits overshoot; lighter
  // damping during free rocking allows several visible oscillations
  // before the rocket settles upright on its legs or engine bell.
  const hasLegBase = countDeployedLegs(ps) >= 2;
  const effectiveDamping = (left || right) ? 0.85 : 0.99;
  ps.angularVelocity *= effectiveDamping;

  ps.angle += ps.angularVelocity * dt;

  // --- Reposition so the contact corner stays on the ground surface ---
  // posY stays at 0 — the renderer handles visual ground-pinning via the pivot.
  // Only posX updates so the box rolls horizontally along the ground.
  const cosB = Math.cos(ps.angle);
  const sinB = Math.sin(ps.angle);
  ps.posX = contactWorldX - (contactLX * cosB + contactLY * sinB) * SCALE_M_PER_PX;
  ps.posY = 0;

  // Update tipping state for renderer.
  ps.isTipping = Math.abs(ps.angle) > TILT_SNAP_THRESHOLD;
  ps.tippingContactX = contactLX;
  ps.tippingContactY = contactLY;

  // --- Smooth settle ---
  // When angular velocity is small and gravity torque is negligible, the
  // rocket is near a stable equilibrium (upright, on its side, etc.).
  // Smoothly decay velocity (and angle if near upright) to avoid visible
  // one-frame jumps and infinite micro-oscillation.
  if (!left && !right && Math.abs(ps.angularVelocity) < ANGULAR_VEL_SNAP_THRESHOLD) {
    const comSnap  = _computeCoMLocal(ps, assembly);
    const sRelX    = (comSnap.x - contactLX) * SCALE_M_PER_PX;
    const sRelY    = (comSnap.y - contactLY) * SCALE_M_PER_PX;
    const sRotX    = sRelX * cosB + sRelY * sinB;
    const snapGrav = totalMass * G0 * sRotX;
    const snapAccel = Math.abs(snapGrav / I);

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
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState
 */
function _checkToppleCrash(ps, assembly, flightState) {
  if (Math.abs(ps.angle) <= TOPPLE_CRASH_ANGLE) return;

  // Compute tip speed: linear velocity of the farthest part from the
  // tipping contact pivot.  Compare against the weakest part's crash
  // threshold — if tip speed is below that, it's a gentle topple.
  const cx = ps.tippingContactX ?? 0;
  const cy = ps.tippingContactY ?? 0;
  let maxDist = 0;
  let minThreshold = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const hw = (def.width  ?? 40) / 2;
    const hh = (def.height ?? 40) / 2;
    // Check all four corners for max distance from pivot.
    for (const [px, py] of [
      [placed.x - hw, placed.y - hh],
      [placed.x + hw, placed.y - hh],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ]) {
      const dx = (px - cx) * SCALE_M_PER_PX;
      const dy = (py - cy) * SCALE_M_PER_PX;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) maxDist = dist;
    }
    const threshold = def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
    if (threshold < minThreshold) minThreshold = threshold;
  }

  const tipSpeed = Math.abs(ps.angularVelocity) * maxDist;
  if (tipSpeed <= minThreshold) return; // gentle topple — no crash

  // Destructive topple — crash.
  ps.crashed = true;
  ps.angularVelocity = 0;
  ps.firingEngines.clear();

  const time = flightState.timeElapsed;
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
 *
 * @param {import('./staging.js').DebrisState}          debris
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {number}                                      dt  Fixed timestep (s).
 */
export function tickDebrisGround(debris, assembly, dt) {
  if (debris.crashed) return;

  // Check if tipping is needed
  const needsTipping = debris.isTipping ||
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
  const cosA = Math.cos(debris.angle);
  const sinA = Math.sin(debris.angle);

  // Find ground contact point via softmax (same as rocket)
  const allCorners = [];
  let maxGP = -Infinity;
  for (const instanceId of debris.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    let halfW = (def.width ?? 40) / 2;
    let bottomHH = (def.height ?? 40) / 2;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dx, dy } = getDeployedLegFootOffset(instanceId, def, debris.legStates);
      if (dy > 0) { halfW = Math.max(halfW, dx); bottomHH = Math.max(bottomHH, dy); }
    }
    const hw = (def.width ?? 40) / 2;
    const hh = (def.height ?? 40) / 2;
    for (const [cx, cy] of [
      [placed.x - halfW, placed.y - bottomHH],
      [placed.x + halfW, placed.y - bottomHH],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ]) {
      const gp = cx * sinA - cy * cosA;
      allCorners.push({ cx, cy, gp });
      if (gp > maxGP) maxGP = gp;
    }
  }

  if (allCorners.length === 0) return;

  const CONTACT_SHARPNESS = 2.0;
  let sumW = 0, sumWX = 0, sumWY = 0;
  for (const c of allCorners) {
    const w = Math.exp(CONTACT_SHARPNESS * (c.gp - maxGP));
    sumW += w; sumWX += w * c.cx; sumWY += w * c.cy;
  }
  const contactLX = sumWX / sumW;
  const contactLY = sumWY / sumW;
  const contact = { x: contactLX, y: contactLY };

  const contactWorldX = debris.posX + (contactLX * cosA + contactLY * sinA) * SCALE_M_PER_PX;

  // Moment of inertia, CoM, gravity torque
  const I = _computeMomentOfInertia(debris, assembly, contact);
  const com = _computeCoMLocal(debris, assembly);
  const relX = (com.x - contactLX) * SCALE_M_PER_PX;
  const relY = (com.y - contactLY) * SCALE_M_PER_PX;
  const rotatedX = relX * cosA + relY * sinA;
  const totalMass = _computeTotalMass(debris, assembly);
  const gravityTorque = totalMass * G0 * rotatedX;

  // Angular integration (no player input)
  const angAccel = gravityTorque / I;
  debris.angularVelocity += angAccel * dt;
  debris.angularVelocity *= 0.99; // light damping
  debris.angle += debris.angularVelocity * dt;

  // Reposition to keep contact on ground
  const cosB = Math.cos(debris.angle);
  const sinB = Math.sin(debris.angle);
  debris.posX = contactWorldX - (contactLX * cosB + contactLY * sinB) * SCALE_M_PER_PX;
  debris.posY = 0;

  debris.isTipping = Math.abs(debris.angle) > TILT_SNAP_THRESHOLD;
  debris.tippingContactX = contactLX;
  debris.tippingContactY = contactLY;

  // Smooth settle
  if (Math.abs(debris.angularVelocity) < ANGULAR_VEL_SNAP_THRESHOLD) {
    const sRelX = (com.x - contactLX) * SCALE_M_PER_PX;
    const sRelY = (com.y - contactLY) * SCALE_M_PER_PX;
    const sRotX = sRelX * cosB + sRelY * sinB;
    const snapGrav = totalMass * G0 * sRotX;
    if (Math.abs(snapGrav / I) < 0.5) {
      debris.angularVelocity *= 0.85;
      if (Math.abs(debris.angle) < TILT_SNAP_THRESHOLD) debris.angle *= 0.9;
      if (Math.abs(debris.angularVelocity) < 1e-4) debris.angularVelocity = 0;
      if (Math.abs(debris.angle) < 1e-4) { debris.angle = 0; debris.isTipping = false; }
    }
  }

  // Topple crash — simplified (no flight events, just set crashed)
  if (Math.abs(debris.angle) > TOPPLE_CRASH_ANGLE) {
    const cx = debris.tippingContactX ?? 0;
    const cy = debris.tippingContactY ?? 0;
    let maxDist = 0;
    let minThreshold = Infinity;
    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      if (!placed) continue;
      const def = getPartById(placed.partId);
      if (!def) continue;
      const hw = (def.width ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      for (const [px, py] of [
        [placed.x - hw, placed.y - hh], [placed.x + hw, placed.y - hh],
        [placed.x - hw, placed.y + hh], [placed.x + hw, placed.y + hh],
      ]) {
        const ddx = (px - cx) * SCALE_M_PER_PX;
        const ddy = (py - cy) * SCALE_M_PER_PX;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist > maxDist) maxDist = dist;
      }
      const threshold = def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
      if (threshold < minThreshold) minThreshold = threshold;
    }
    const tipSpeed = Math.abs(debris.angularVelocity) * maxDist;
    if (tipSpeed > minThreshold) {
      debris.crashed = true;
      debris.angularVelocity = 0;
    }
  }
}

/**
 * Return true if the rocket has at least one active RCS-capable command module.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {boolean}
 */
function _hasRcs(ps, assembly) {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
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
 *   1. ≥ 2 deployed legs AND speed < 10 m/s
 *        → Controlled landing (LANDING event, ps.landed = true).
 *
 *   2. ≥ 1 deployed leg AND 10 m/s ≤ speed < 30 m/s
 *        → Hard landing: legs (and their connected parts) are destroyed but
 *          the rocket body may survive (LANDING event with legs_destroyed flag).
 *
 *   3. speed ≥ 30 m/s (any leg state)
 *        → Catastrophic impact: all parts destroyed (CRASH event, ps.crashed = true).
 *
 *   4. 0 deployed legs AND speed > 5 m/s
 *        → Contact without leg support: bottom-most parts damaged/destroyed
 *          (CRASH event, ps.crashed = true).
 *
 *   5. speed ≤ 5 m/s (no legs or fewer than 2 legs)
 *        → Gentle touchdown (LANDING event, ps.landed = true).
 *
 * Emits LANDING or CRASH event and sets ps.landed / ps.crashed accordingly.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState
 */
function _handleGroundContact(ps, assembly, flightState) {
  const impactSpeed = Math.hypot(ps.velX, ps.velY);
  const time        = flightState.timeElapsed;

  // Clamp to ground and stop motion.
  ps.posY = 0;
  ps.velX = 0;
  ps.velY = 0;

  // --- Cascading per-part crash threshold system ---
  let remainingSpeed = impactSpeed;
  let anyDestroyed   = false;

  while (remainingSpeed > 0 && ps.activeParts.size > 0) {
    const layer = _getBottomPartLayer(ps, assembly);
    if (layer.length === 0) break;

    // Find the minimum crashThreshold in the bottom layer.
    let minThreshold = Infinity;
    for (const entry of layer) {
      const threshold = entry.def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
      if (threshold < minThreshold) minThreshold = threshold;
    }

    // If remaining speed is within the layer's tolerance, it survives.
    if (remainingSpeed <= minThreshold) break;

    // Destroy all parts in this layer.
    for (const entry of layer) {
      _removePartFromState(ps, entry.instanceId);
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
    // This creates predictable tiers: an engine (threshold 12) absorbs 12 m/s,
    // so a 15 m/s impact leaves only 3 m/s for the next layer.
    remainingSpeed -= minThreshold;
  }

  // --- Renormalize surviving rocket so its new bottom sits at ground level ---
  // Same approach as _renormalizeAfterSeparation in staging.js: shift all
  // assembly part positions down so the lowest edge is at VAB Y=0, and adjust
  // posY by the corresponding world-space offset.
  if (anyDestroyed && ps.activeParts.size > 0) {
    const bottomAfter = _getLowestBottomEdge(ps, assembly);
    if (isFinite(bottomAfter) && bottomAfter > 0) {
      const offsetM = bottomAfter * SCALE_M_PER_PX;
      ps.posY += offsetM;
      for (const [, placed] of assembly.parts) {
        placed.y -= bottomAfter;
      }
      for (const debris of ps.debris) {
        debris.posY += offsetM;
      }
    }
  }

  // --- Determine outcome ---
  const allCmdLost = _allCommandModulesGone(ps, assembly);

  if (allCmdLost) {
    // All command / computer modules are destroyed — rocket is lost.
    ps.crashed = true;
    _emitEvent(flightState, {
      type:        'CRASH',
      time,
      speed:       impactSpeed,
      description: `Impact at ${impactSpeed.toFixed(1)} m/s — rocket destroyed!`,
    });
  } else {
    // Rocket survives (possibly with partial damage).
    ps.landed = true;
    const desc = anyDestroyed
      ? `Hard landing at ${impactSpeed.toFixed(1)} m/s — some parts destroyed.`
      : `Landed at ${impactSpeed.toFixed(1)} m/s.`;
    _emitEvent(flightState, {
      type:          'LANDING',
      time,
      speed:         impactSpeed,
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
const DESTRUCTION_BAND = 5;

/**
 * Return the bottom-most layer of active parts — all parts whose bottom
 * edge is within DESTRUCTION_BAND of the lowest bottom edge.
 *
 * Uses `placed.y - halfHeight` as the bottom edge (world Y is positive-up),
 * matching the tipping physics ground-contact calculation.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {Array<{instanceId: string, bottomY: number, placed: object, def: object}>}
 */
function _getBottomPartLayer(ps, assembly) {
  const entries = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const halfH   = (def.height ?? 40) / 2;
    let bottomY = placed.y - halfH;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      const footY = placed.y - dy;
      if (footY < bottomY) bottomY = footY;
    }
    entries.push({ instanceId, bottomY, placed, def });
  }
  if (entries.length === 0) return [];

  entries.sort((a, b) => a.bottomY - b.bottomY);
  const minY = entries[0].bottomY;
  return entries.filter((e) => e.bottomY <= minY + DESTRUCTION_BAND);
}

/**
 * Remove a single part from all physics state tracking sets/maps.
 *
 * @param {PhysicsState} ps
 * @param {string}       instanceId
 */
function _removePartFromState(ps, instanceId) {
  ps.activeParts.delete(instanceId);
  ps.firingEngines.delete(instanceId);
  ps.deployedParts.delete(instanceId);
  ps.legStates?.delete(instanceId);
  ps.parachuteStates?.delete(instanceId);
  ps.heatMap?.delete(instanceId);
}

/**
 * Return the lowest bottom edge (VAB world Y) across all active parts.
 * Used to compute how far the rocket should drop after bottom parts are removed.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {number}  Lowest bottom edge Y value, or Infinity if no parts.
 */
function _getLowestBottomEdge(ps, assembly) {
  let lowest = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    let bottomY = placed.y - (def.height ?? 40) / 2;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      const footY = placed.y - dy;
      if (footY < bottomY) bottomY = footY;
    }
    if (bottomY < lowest) lowest = bottomY;
  }
  return lowest;
}

/**
 * Return true if all COMMAND_MODULE and COMPUTER_MODULE parts in the assembly
 * have been removed from activeParts.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {boolean}
 */
function _allCommandModulesGone(ps, assembly) {
  let hadCmd = false;
  for (const [instanceId, placed] of assembly.parts) {
    const def = getPartById(placed.partId);
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
 *   ΔV ≈ avgIsp × g₀ × ln(wetMass / dryMass)
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState
 */
function _syncFlightState(ps, assembly, flightState) {
  flightState.altitude = Math.max(0, ps.posY);
  flightState.velocity = Math.hypot(ps.velX, ps.velY);

  // Track current biome and record visited biomes.
  const newBiome = getBiomeId(flightState.altitude, 'EARTH');
  if (newBiome && newBiome !== flightState.currentBiome) {
    const prevBiome = flightState.currentBiome;
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
        description: `Entered ${newBiome.replace(/_/g, ' ').toLowerCase()} biome at ${flightState.altitude.toFixed(0)} m.`,
      });

      // Schedule a malfunction check with a small random delay (0.5–2.0 s)
      // so it doesn't fire at the exact biome boundary — adds unpredictability.
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

  // Estimate remaining ΔV using current wet/dry mass split and average Isp.
  flightState.deltaVRemaining = _estimateDeltaV(ps, assembly);
}

/**
 * Estimate remaining ΔV using the Tsiolkovsky rocket equation.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {number}  Estimated ΔV in m/s.
 */
function _estimateDeltaV(ps, assembly) {
  let dryMass  = 0;
  let wetMass  = 0;
  let totalIspTimesMdot = 0;
  let totalMdot         = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    dryMass += def.mass ?? 0;
    const fuel = ps.fuelStore.get(instanceId) ?? 0;
    wetMass   += (def.mass ?? 0) + fuel;
  }

  // Average Isp from all active engines/SRBs (vacuum, for ΔV budget).
  for (const instanceId of ps.firingEngines) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    const isp   = def.properties?.ispVac ?? def.properties?.isp ?? 300;
    const thrust = (def.properties?.thrustVac ?? def.properties?.thrust ?? 0) * 1_000;
    const mdot  = thrust > 0 ? thrust / (isp * G0) : 0;
    totalIspTimesMdot += isp * mdot;
    totalMdot         += mdot;
  }

  if (dryMass <= 0 || wetMass <= dryMass) return 0;

  const avgIsp = totalMdot > 0 ? totalIspTimesMdot / totalMdot : 300;
  return avgIsp * G0 * Math.log(wetMass / dryMass);
}

// ---------------------------------------------------------------------------
// Event helpers (private)
// ---------------------------------------------------------------------------

/**
 * Append a flight event to the FlightState event log.
 *
 * @param {import('./gameState.js').FlightState} flightState
 * @param {object} event  Must include at minimum `type` and `time`.
 */
function _emitEvent(flightState, event) {
  flightState.events.push(event);
}
