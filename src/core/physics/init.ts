// ---------------------------------------------------------------------------
// Physics state factory — createPhysicsState and its initial-state helpers
// ---------------------------------------------------------------------------

import { getPartById, type PartDef } from '../../data/parts.ts';
import { getSurfaceGravity } from '../../data/bodies.ts';
import { PartType, ControlMode, FlightPhase, BODY_RADIUS } from '../constants.ts';
import { initParachuteStates } from '../parachute.ts';
import { initLegStates } from '../legs.ts';
import { initEjectorStates } from '../ejector.ts';
import { initScienceModuleStates } from '../sciencemodule.ts';
import { initMalfunctionState } from '../malfunction.ts';
import { initPowerState } from '../power.ts';

import type { FlightState } from '../gameState.ts';
import type { PhysicsState, RocketAssembly } from '../physics.ts';

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
    const fuelMass: number = (def.properties?.fuelMass as number) ?? 0;
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
    capturedBody: null,
    thrustAligned: false,
    weatherIspModifier: 1.0,
    weatherWindSpeed: 0,
    weatherWindAngle: 0,
    hasLaunchClamps: false,
    powerState: null,
  };

  // Detect launch clamps in the assembly.
  for (const [_instanceId, placed] of assembly.parts) {
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

  // Handle orbital launches: spawn at station altitude with orbital velocity.
  if (flightState && flightState.launchType === 'orbital' && flightState.altitude > 0) {
    const bodyId = flightState.bodyId;
    const R: number = BODY_RADIUS[bodyId] ?? BODY_RADIUS.EARTH;
    const alt: number = flightState.altitude;
    const r: number = R + alt;
    // GM = g_surface * R^2, then v_orbit = sqrt(GM / r)
    const gSurface: number = getSurfaceGravity(bodyId);
    const GM: number = gSurface * R * R;
    const orbitalVelocity: number = Math.sqrt(GM / r);

    ps.posY = alt;
    ps.velX = orbitalVelocity;
    ps.velY = 0;
    ps.landed = false;
    ps.grounded = false;

    // Skip PRELAUNCH — go directly to ORBIT phase.
    flightState.phase = FlightPhase.ORBIT;
    flightState.inOrbit = true;
  }

  return ps;
}
