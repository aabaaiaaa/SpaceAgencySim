// ---------------------------------------------------------------------------
// FLIGHT-phase integrator — part 1 (atmosphere + thrust).
//
// The FLIGHT phase is the default atmospheric/ballistic integrator used when
// the craft is not in ORBIT, TRANSFER, or CAPTURE. It is significantly more
// elaborate than the other phase branches: gravity, drag, wind, docking/RCS
// local translation, steering, fuel consumption, heat, clamps, ground
// contact, parachutes, legs, science, power, and ejected crew all interact
// within a single fixed-step tick.
//
// Per requirements §8 the extraction is split across multiple tasks. This
// module currently owns the **prelude** of the FLIGHT branch — TWR throttle
// conversion, atmosphere (altitude + density), total-mass snapshot, docking-
// mode determination, and main-engine thrust. Follow-up tasks (part 2 onward)
// will move gravity/drag/wind, integration, steering, ground contact, and
// the various continuous subsystem ticks into sibling helpers that build on
// the values produced here.
//
// The ordering of operations (mass → thrust, with fuel consumption later in
// the frame) is load-bearing and must be preserved — see the "Thrust ↔ Fuel
// ↔ Mass" note in requirements §8.
// ---------------------------------------------------------------------------

import {
  BODY_RADIUS,
  ControlMode,
  FlightPhase,
  PartType,
} from '../../constants.ts';
import {
  _computeTotalMass,
  _densityForBody,
  _computeDragForce,
  _checkToppleCrash,
  _handleGroundContact,
} from '../../physics.ts';
import {
  computeThrust,
  updateThrottleFromTWR,
  type ThrustResult,
} from '../thrust.ts';
import { applySteering } from '../steering.ts';
import { applyDockingMovement } from '../docking.ts';
import { gravityForBody } from '../gravity.ts';
import {
  tickParachutes,
  tickCanopyAngles,
} from '../../parachute.ts';
import { updateHeat, updateSolarHeat } from '../../atmosphere.ts';
import { tickFuelSystem } from '../../fuelsystem.ts';
import { checkMalfunctions, tickMalfunctions } from '../../malfunction.ts';
import { tickLegs } from '../../legs.ts';
import { tickScienceModules } from '../../sciencemodule.ts';
import { tickPower } from '../../power.ts';
import { getOrbitalStateAtTime } from '../../orbit.ts';
import { getWindForce } from '../../weather.ts';
import { getPartById } from '../../../data/parts.ts';

import type { FlightState } from '../../gameState.ts';
import type { PhysicsState, RocketAssembly } from '../../physics.ts';

/**
 * Intermediate values produced by the FLIGHT-phase prelude and consumed by
 * the remaining portions of the tick.
 */
export interface FlightPhasePrelude {
  /** Clamped altitude (max(0, ps.posY)) at the start of the tick. */
  altitude: number;
  /** Atmospheric density at `altitude` for the current body. */
  density: number;
  /** Total craft mass (dry + remaining fuel + captured body) in kg. */
  totalMass: number;
  /** True when the craft is in DOCKING or RCS control mode. */
  isDockingOrRcs: boolean;
  /** X-component of main-engine thrust force (N). Zero in docking/RCS. */
  thrustX: number;
  /** Y-component of main-engine thrust force (N). Zero in docking/RCS. */
  thrustY: number;
}

export interface FlightPhasePreludeContext {
  flightState: FlightState;
  assembly: RocketAssembly;
  bodyId: string | undefined;
}

/**
 * Run the FLIGHT-phase prelude: TWR throttle conversion, atmosphere lookup,
 * total-mass snapshot, docking/RCS determination, and main-engine thrust.
 *
 * Mutates `ps.throttle` via {@link updateThrottleFromTWR} when the craft is
 * in TWR throttle mode; otherwise side-effect-free. Returns the intermediate
 * values needed by the remainder of the FLIGHT-phase tick.
 */
export function tickFlightPhasePrelude(
  ps: PhysicsState,
  ctx: FlightPhasePreludeContext,
): FlightPhasePrelude {
  const { assembly, bodyId } = ctx;

  // --- 0. TWR-relative throttle conversion --------------------------------
  updateThrottleFromTWR(ps, assembly, bodyId);

  const altitude: number = Math.max(0, ps.posY);
  const density: number  = _densityForBody(altitude, bodyId);

  // --- 1. Total rocket mass (dry + remaining fuel) -------------------------
  const totalMass: number = _computeTotalMass(ps, assembly);

  // --- Docking / RCS mode: thrust affects local position, not orbit --------
  const isDockingOrRcs =
    ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS;

  // --- 2. Thrust vector ----------------------------------------------------
  // In docking/RCS modes, main engine thrust is suppressed — movement comes
  // from docking thrusters only (handled in _applyDockingMovement).
  let thrustX = 0;
  let thrustY = 0;
  if (!isDockingOrRcs) {
    const thrustResult: ThrustResult = computeThrust(ps, assembly, density);
    thrustX = thrustResult.thrustX;
    thrustY = thrustResult.thrustY;
  }

  return { altitude, density, totalMass, isDockingOrRcs, thrustX, thrustY };
}

export interface FlightPhaseSteeringContext {
  flightState: FlightState;
  assembly: RocketAssembly;
  bodyId: string | undefined;
  altitude: number;
  thrustX: number;
  thrustY: number;
  dt: number;
}

/**
 * Continuous steering for the FLIGHT-phase tick.
 *
 * Delegates to {@link applySteering} in `../steering.ts`, which handles
 * airborne A/D torque, grounded tipping, parachute restoring torque and
 * damping, captured-asteroid torque, and aero / RCS angular damping. The
 * wrapper exists so the FLIGHT-phase module owns the call-site composition
 * (thrust magnitude, context bundling) independently of the integration
 * loop.
 */
export function tickFlightPhaseSteering(
  ps: PhysicsState,
  ctx: FlightPhaseSteeringContext,
): void {
  const { flightState, assembly, bodyId, altitude, thrustX, thrustY, dt } = ctx;
  const thrustMagnitude: number = Math.hypot(thrustX, thrustY);
  applySteering(ps, assembly, altitude, dt, bodyId, flightState, thrustMagnitude);
}

export interface FlightPhaseParachuteContext {
  flightState: FlightState;
  assembly: RocketAssembly;
  totalMass: number;
  dt: number;
}

/**
 * Parachute state-machine tick for the FLIGHT-phase integrator.
 *
 * Advances `deploying → deployed` timers, runs the mass-safety check, and
 * updates canopy tilt angles. Skipped entirely when the craft is grounded —
 * landed-parachute handling is routed through `tickLandedParachutes` at the
 * `_handleGroundContact` path, not here.
 */
export function tickFlightPhaseParachutes(
  ps: PhysicsState,
  ctx: FlightPhaseParachuteContext,
): void {
  if (ps.grounded) return;
  const { flightState, assembly, totalMass, dt } = ctx;
  tickParachutes(ps, assembly, flightState, dt, totalMass);
  tickCanopyAngles(ps, dt);
}

export interface FlightPhaseContext {
  flightState: FlightState;
  assembly: RocketAssembly;
}

/**
 * Run the full FLIGHT-phase integrator tick.
 *
 * Covers all atmospheric/ballistic phases (PRELAUNCH, LAUNCH, FLIGHT, REENTRY,
 * MANOEUVRE) — REENTRY is not a distinct branch; the shared body handles it
 * via {@link updateHeat}. Composes the prelude (atmosphere/thrust), gravity,
 * drag, wind, Euler integration, docking-mode local movement, steering,
 * topple-crash check, fuel/malfunction/parachute/leg/science/power ticks,
 * ejected-crew physics, atmospheric heat, launch-clamp checks, liftoff
 * detection and ground contact.
 *
 * The ordering of operations (mass → thrust → gravity → drag → integrate →
 * fuel → ...) is load-bearing — see requirements §8 "Thrust ↔ Fuel ↔ Mass".
 */
export function tickFlightPhase(
  ps: PhysicsState,
  dt: number,
  ctx: FlightPhaseContext,
): void {
  const { flightState, assembly } = ctx;
  const bodyId: string | undefined = flightState?.bodyId;

  // --- 0–2. Prelude (TWR throttle, atmosphere, mass, thrust) -----------------
  const { altitude, density, totalMass, isDockingOrRcs, thrustX, thrustY } =
    tickFlightPhasePrelude(ps, { flightState, assembly, bodyId });

  // --- 3. Gravity force (body-specific, inverse-square) ---------------------
  const gravAccel: number = gravityForBody(bodyId, altitude);
  let gravFX: number;
  let gravFY: number;

  // ORBIT/MANOEUVRE: radial gravity (toward body centre) so orbital burns
  // produce correct orbit changes. FLIGHT and other atmospheric phases use
  // flat vertical gravity (the 2D ground model).
  const useRadialGravity =
    flightState?.phase === FlightPhase.MANOEUVRE ||
    (flightState?.phase === FlightPhase.ORBIT && ps.firingEngines.size > 0);

  if (useRadialGravity && bodyId) {
    const R: number = (BODY_RADIUS[bodyId] ?? 6_371_000);
    const rx: number = ps.posX;
    const ry: number = ps.posY + R;
    const r: number = Math.hypot(rx, ry);
    const gravMag: number = gravAccel * totalMass;
    gravFX = -gravMag * rx / r;
    gravFY = -gravMag * ry / r;
  } else {
    gravFX = 0;
    gravFY = -gravAccel * totalMass;
  }

  // --- 4. Drag force --------------------------------------------------------
  const speed: number   = Math.hypot(ps.velX, ps.velY);
  const dragMag: number = _computeDragForce(ps, assembly, density, speed);
  let dragFX = 0;
  let dragFY = 0;
  if (speed > 1e-6) {
    dragFX = -dragMag * (ps.velX / speed);
    dragFY = -dragMag * (ps.velY / speed);
  }

  // --- 4b. Wind force (weather system) --------------------------------------
  let windFX = 0;
  let windFY = 0;
  if (density > 0 && ps.weatherWindSpeed > 0) {
    const windWeather = {
      windSpeed: ps.weatherWindSpeed,
      windAngle: ps.weatherWindAngle,
      temperature: 1, visibility: 0, extreme: false, description: '', bodyId: bodyId as string,
    };
    const windAccel = getWindForce(windWeather, altitude, bodyId);
    windFX = windAccel.windFX * totalMass;
    windFY = windAccel.windFY * totalMass;
  }

  // --- 5. Net acceleration --------------------------------------------------
  const netFX: number = thrustX + gravFX + dragFX + windFX;
  const netFY: number = thrustY + gravFY + dragFY + windFY;

  let accX: number;
  let accY: number;
  if (totalMass <= 0) {
    accX = 0;
    accY = 0;
  } else {
    accX = netFX / totalMass;
    accY = netFY / totalMass;
  }

  // Ground reaction: prevent downward acceleration while on launch pad.
  if (ps.grounded && accY < 0) {
    accY = 0;
    accX = 0;
  }

  // Launch clamp hold: clamps freeze the rocket while engines may spool up.
  if (ps.grounded && ps.hasLaunchClamps) {
    accX = 0;
    accY = 0;
  }

  // --- 6. Euler integration -------------------------------------------------
  ps.velX += accX * dt;
  ps.velY += accY * dt;
  ps.posX += ps.velX * dt;
  ps.posY += ps.velY * dt;

  // --- 6b. Docking / RCS mode local movement --------------------------------
  if (isDockingOrRcs) {
    applyDockingMovement(ps, assembly, totalMass, dt, bodyId);
  }

  // --- 7. Continuous steering -----------------------------------------------
  tickFlightPhaseSteering(ps, {
    flightState, assembly, bodyId, altitude, thrustX, thrustY, dt,
  });

  // --- 7b. Topple-crash check (grounded tipping) ----------------------------
  if (ps.grounded) {
    _checkToppleCrash(ps, assembly, flightState);
    if (ps.crashed) return;
  }

  // --- 8. Fuel consumption (segment-aware) ----------------------------------
  tickFuelSystem(ps, assembly, dt, density);

  // --- 8b. Malfunction tick (continuous effects like fuel leaks) ------------
  tickMalfunctions(ps, assembly, dt);

  // --- 8c. Pending malfunction check (delayed after biome transition) -------
  if (ps._malfunctionCheckPending) {
    ps._malfunctionCheckTimer = (ps._malfunctionCheckTimer ?? 0) - dt;
    if (ps._malfunctionCheckTimer <= 0) {
      ps._malfunctionCheckPending = false;
      checkMalfunctions(ps, assembly, flightState, ps._gameState ?? undefined);
    }
  }

  // --- 9. Parachute state machine -------------------------------------------
  tickFlightPhaseParachutes(ps, { flightState, assembly, totalMass, dt });

  // --- 9b. Landing leg state machine ----------------------------------------
  tickLegs(ps, assembly, flightState, dt);

  // --- 9c. Science module experiment timers ---------------------------------
  tickScienceModules(ps, assembly, flightState, dt);

  // --- 9d. Power system (solar generation, battery, consumers) --------------
  if (ps.powerState) {
    let activeScienceCount = 0;
    for (const [, entry] of ps.instrumentStates) {
      if (entry.state === 'COLLECTING' || entry.state === 'RUNNING') {
        activeScienceCount++;
      }
    }

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
      dt,
      altitude: Math.max(0, ps.posY),
      bodyId: flightState.bodyId || 'EARTH',
      gameTimeSeconds: flightState.timeElapsed,
      angularPositionDeg,
      inOrbit: flightState.inOrbit,
      scienceRunning: flightState.scienceModuleRunning,
      activeScienceCount,
      commsActive: false,
    });
  }

  // --- 9e. Ejected crew physics ---------------------------------------------
  if (ps.ejectedCrew) {
    const crewG: number = gravityForBody(bodyId, Math.max(0, ps.posY));
    for (const crew of ps.ejectedCrew) {
      if (!crew.chuteOpen && crew.chuteTimer > 0) {
        crew.chuteTimer -= dt;
        if (crew.chuteTimer <= 0) crew.chuteOpen = true;
      }

      crew.velY -= crewG * dt;

      if (crew.chuteOpen && crew.velY < 0) {
        const drag: number = 0.5 * crew.velY * crew.velY * 0.08;
        crew.velY += drag * dt;
        if (crew.velY > -5) crew.velY = Math.max(crew.velY, -5);
      }

      crew.velX *= (1 - 0.5 * dt);

      crew.x += crew.velX * dt;
      crew.y += crew.velY * dt;

      if (crew.y <= 0) {
        crew.y = 0;
        crew.velX = 0;
        crew.velY = 0;
      }
    }
  }

  // --- 10. Atmospheric heat model -------------------------------------------
  if (!ps.grounded) {
    updateHeat(ps, assembly, flightState, speed, altitude, density);

    if (bodyId === 'SUN') {
      updateSolarHeat(ps, assembly, flightState, altitude);
    }
  }

  // --- 10. Launch clamp check -----------------------------------------------
  if (ps.hasLaunchClamps) {
    let clampsRemain = false;
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const cDef = placed ? getPartById(placed.partId) : null;
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
  if (ps.grounded && ps.posY > 0 && !ps.hasLaunchClamps) {
    ps.grounded = false;
    ps.isTipping = false;
  }

  // --- 11. Ground clamping and landing detection ----------------------------
  if (!ps.grounded && ps.posY <= 0) {
    ps.posY = 0;
    _handleGroundContact(ps, assembly, flightState);
  } else if (ps.grounded) {
    if (ps.posY < 0) ps.posY = 0;
    if (ps.velY < 0) ps.velY = 0;
  }
}
