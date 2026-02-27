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
import { PartType } from './constants.js';
import {
  airDensity,
  ATMOSPHERE_TOP,
  SEA_LEVEL_DENSITY,
  updateHeat,
} from './atmosphere.js';
import { tickFuelSystem } from './fuelsystem.js';
import { activateCurrentStage, tickDebris } from './staging.js';
import {
  initParachuteStates,
  tickParachutes,
  getChuteMultiplier,
} from './parachute.js';
import {
  initLegStates,
  tickLegs,
  countDeployedLegs,
  LegState,
} from './legs.js';
import { initEjectorStates } from './ejector.js';

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

/**
 * Drag coefficient multiplier applied to an open parachute.
 * An open chute is modelled as having 80× its stowed Cd — very high drag.
 */
const CHUTE_DRAG_MULTIPLIER = 80;

/** Landing speed below which a contact is considered "safe" (m/s). */
const DEFAULT_SAFE_LANDING_SPEED = 10;

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
 * @property {boolean}         landed        True after a successful soft touchdown.
 * @property {boolean}         crashed       True after a fatal impact.
 * @property {boolean}         grounded      True while still sitting on the launch pad.
 * @property {Map<string,number>} heatMap      Accumulated reentry heat per part (heat units).
 *                                             Keyed by instance ID; initialised to 0.
 * @property {import('./staging.js').DebrisState[]} debris  Jettisoned stage
 *   fragments that continue to be simulated independently.  New entries are
 *   appended whenever a decoupler fires via {@link fireNextStage}.
 * @property {Set<string>}     _heldKeys     Keys currently held down (for continuous steering).
 * @property {number}          _accumulator  Leftover simulation time from the previous frame.
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
    firingEngines: new Set(),
    fuelStore,
    activeParts: new Set(assembly.parts.keys()),
    deployedParts: new Set(),
    parachuteStates: new Map(),
    legStates: new Map(),
    ejectorStates: new Map(),
    ejectedCrewIds: new Set(),
    heatMap: new Map(),
    debris: [],
    landed: false,
    crashed: false,
    grounded: true,
    _heldKeys: new Set(),
    _accumulator: 0,
  };

  // Initialise the parachute state machine for all PARACHUTE parts in the assembly.
  initParachuteStates(ps, assembly);

  // Initialise the landing leg state machine for all LANDING_LEGS/LANDING_LEG parts.
  initLegStates(ps, assembly);

  // Initialise the ejector seat state machine for all crewed COMMAND_MODULE parts.
  initEjectorStates(ps, assembly);

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
  if (ps.landed || ps.crashed || flightState.aborted) return;

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
    }

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

  switch (key) {
    case 'w':
    case 'ArrowUp':
      ps.throttle = Math.min(1, ps.throttle + THROTTLE_STEP);
      break;
    case 's':
    case 'ArrowDown':
      ps.throttle = Math.max(0, ps.throttle - THROTTLE_STEP);
      break;
    case 'x':
    case 'X':
      ps.throttle = 0;
      break;
    case 'z':
    case 'Z':
      ps.throttle = 1;
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
  if (ps.landed || ps.crashed || flightState.aborted) return;

  const newDebris = activateCurrentStage(ps, assembly, stagingConfig, flightState);
  ps.debris.push(...newDebris);
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
  const altitude = Math.max(0, ps.posY);
  const density  = airDensity(altitude);

  // --- 1. Total rocket mass (dry + remaining fuel) -------------------------
  const totalMass = _computeTotalMass(ps, assembly);

  // --- 2. Thrust vector ----------------------------------------------------
  const { thrustX, thrustY } = _computeThrust(ps, assembly, density);

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

  // --- 7. Continuous steering ----------------------------------------------
  _applySteering(ps, assembly, altitude, FIXED_DT);

  // --- 8. Fuel consumption (segment-aware, via fuelsystem.js) -------------
  tickFuelSystem(ps, assembly, FIXED_DT, density);

  // --- 9. Parachute state machine ------------------------------------------
  // Advance deploying → deployed timers and run the mass-safety check.
  // totalMass was computed at step 1 above.
  if (!ps.grounded) {
    tickParachutes(ps, assembly, flightState, FIXED_DT, totalMass);
  }

  // --- 9b. Landing leg state machine ---------------------------------------
  // Advance deploying → deployed timers for all landing legs.
  if (!ps.grounded) {
    tickLegs(ps, assembly, flightState, FIXED_DT);
  }

  // --- 10. Reentry heat model ----------------------------------------------
  if (!ps.grounded) {
    updateHeat(ps, assembly, flightState, speed, altitude, density);
  }

  // --- 10. Liftoff detection -----------------------------------------------
  if (ps.grounded && ps.posY > 0) {
    ps.grounded = false;
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
    const effectiveThrustN = rawThrustN * throttleMult;

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
 * Compute the aerodynamic drag force magnitude (Newtons).
 *
 * dragForce = 0.5 × ρ × v² × Cd × A  (summed over all active parts)
 *
 * Open parachutes contribute dramatically increased drag (×80 Cd).
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

    const props    = def.properties ?? {};
    const cd       = props.dragCoefficient ?? 0.2;
    const widthM   = (def.width ?? 40) * SCALE_M_PER_PX;
    const area     = Math.PI * (widthM / 2) ** 2; // circular cross-section

    // Parachutes use a density-scaled, state-machine-driven multiplier;
    // all other parts have a fixed multiplier of 1.
    const cdMultiplier = def.type === PartType.PARACHUTE
      ? getChuteMultiplier(ps, instanceId, density)
      : 1;

    totalCdA += cd * area * cdMultiplier;
  }

  return 0.5 * density * speed * speed * totalCdA;
}

// ---------------------------------------------------------------------------
// Steering (private)
// ---------------------------------------------------------------------------

/**
 * Apply continuous steering inputs from held A/D (or arrow) keys.
 *
 * Turn rate is BASE_TURN_RATE radians/s, boosted by RCS_TURN_MULTIPLIER when
 * in vacuum AND the rocket has an RCS-capable command module.
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {number} altitude  Current altitude (m) for vacuum check.
 * @param {number} dt        Integration timestep (s).
 */
function _applySteering(ps, assembly, altitude, dt) {
  const left  = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
  const right = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');
  if (!left && !right) return;

  // Base turn rate, optionally boosted by RCS in vacuum.
  let turnRate = BASE_TURN_RATE;
  if (altitude > ATMOSPHERE_TOP && _hasRcs(ps, assembly)) {
    turnRate *= RCS_TURN_MULTIPLIER;
  }

  if (left)  ps.angle -= turnRate * dt;
  if (right) ps.angle += turnRate * dt;
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
  const impactSpeed    = Math.hypot(ps.velX, ps.velY);
  const time           = flightState.timeElapsed;
  const deployedLegs   = countDeployedLegs(ps);

  // Clamp to ground and stop motion.
  ps.posY = 0;
  ps.velX = 0;
  ps.velY = 0;

  // --- Case 3: Catastrophic speed (≥ 30 m/s) — full destruction -----------
  if (impactSpeed >= 30) {
    ps.activeParts.clear();
    ps.firingEngines.clear();
    ps.deployedParts.clear();
    ps.crashed = true;
    _emitEvent(flightState, {
      type:        'CRASH',
      time,
      speed:       impactSpeed,
      legsDestroyed: false,
      description: `Catastrophic impact at ${impactSpeed.toFixed(1)} m/s — rocket destroyed!`,
    });
    return;
  }

  // --- Case 1: Controlled landing — ≥ 2 deployed legs AND speed < 10 m/s --
  if (deployedLegs >= 2 && impactSpeed < 10) {
    ps.landed = true;
    _emitEvent(flightState, {
      type:        'LANDING',
      time,
      speed:       impactSpeed,
      legsDestroyed: false,
      description: `Controlled landing at ${impactSpeed.toFixed(1)} m/s.`,
    });
    return;
  }

  // --- Case 2: Hard landing — deployed legs but too fast (10–29 m/s) -------
  if (deployedLegs >= 1 && impactSpeed >= 10 && impactSpeed < 30) {
    // Destroy all deployed landing legs; rocket body survives.
    _destroyDeployedLegs(ps, assembly);
    ps.landed = true;
    _emitEvent(flightState, {
      type:        'LANDING',
      time,
      speed:       impactSpeed,
      legsDestroyed: true,
      description: `Hard landing at ${impactSpeed.toFixed(1)} m/s — landing legs destroyed.`,
    });
    return;
  }

  // --- Case 5: Gentle landing with no/insufficient legs (speed ≤ 5 m/s) ---
  if (impactSpeed <= 5) {
    ps.landed = true;
    _emitEvent(flightState, {
      type:        'LANDING',
      time,
      speed:       impactSpeed,
      legsDestroyed: false,
      description: `Landed at ${impactSpeed.toFixed(1)} m/s.`,
    });
    return;
  }

  // --- Case 4: No deployed legs AND speed > 5 m/s — ground contact damage --
  // Destroy the bottom-most parts (those that physically contact the ground)
  // and propagate destruction upward.
  _destroyBottomParts(ps, assembly);
  ps.crashed = true;
  _emitEvent(flightState, {
    type:        'CRASH',
    time,
    speed:       impactSpeed,
    legsDestroyed: false,
    description: `Impact without landing legs at ${impactSpeed.toFixed(1)} m/s — contact parts destroyed!`,
  });
}

// ---------------------------------------------------------------------------
// Destruction helpers (private)
// ---------------------------------------------------------------------------

/**
 * Destroy all deployed landing legs by removing them from the active parts
 * and state maps.  Call this after a hard landing (speed 10–29 m/s with legs).
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 */
function _destroyDeployedLegs(ps, assembly) {
  const toDestroy = [];

  for (const [instanceId, entry] of (ps.legStates ?? [])) {
    if (entry.state !== LegState.DEPLOYED) continue;
    toDestroy.push(instanceId);
  }

  for (const instanceId of toDestroy) {
    ps.activeParts.delete(instanceId);
    ps.deployedParts.delete(instanceId);
    ps.legStates.delete(instanceId);
  }
}

/**
 * Destroy the bottom-most part(s) of the rocket and propagate damage upward.
 *
 * "Bottom" is determined by ascending placed.y (the most negative placed.y
 * value corresponds to the physically lowest point of the rocket when upright).
 * In a simplified model, we destroy the single lowest part; if there are
 * multiple parts at the same Y level they are all destroyed together.
 *
 * After removal, any parts that depended on the destroyed part for structural
 * connectivity are also removed (simple propagation: all parts with placed.y
 * below the rocket's median are removed).
 *
 * @param {PhysicsState}                               ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 */
function _destroyBottomParts(ps, assembly) {
  if (ps.activeParts.size === 0) return;

  // Collect placed Y positions of all active parts.
  const entries = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    entries.push({ instanceId, y: placed.y });
  }

  if (entries.length === 0) return;

  // Sort ascending (lowest Y first).
  entries.sort((a, b) => a.y - b.y);

  // Find the minimum Y value.
  const minY = entries[0].y;

  // Destroy all parts at (or very near) the minimum Y.
  // "Very near" = within 5 VAB world units of the minimum (accounts for
  // parts that span the same row, e.g., radial SRBs).
  const DESTRUCTION_BAND = 5;
  for (const { instanceId, y } of entries) {
    if (y <= minY + DESTRUCTION_BAND) {
      ps.activeParts.delete(instanceId);
      ps.deployedParts.delete(instanceId);
      ps.firingEngines.delete(instanceId);
      ps.legStates?.delete(instanceId);
    }
  }
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
