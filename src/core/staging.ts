/**
 * staging.ts — Flight staging and stage separation logic.
 *
 * This module is the authoritative implementation of the in-flight staging
 * sequence.  It handles activating each part in a stage, creating DebrisState
 * objects for any rocket sections that become disconnected from the command
 * module after a decoupler fires, and simulating those debris fragments each
 * physics tick.
 *
 * PART ACTIVATION BEHAVIOUR
 *   ENGINE  (activationBehaviour: IGNITE)   → added to ps.firingEngines
 *   SRB     (activationBehaviour: IGNITE)   → same as ENGINE
 *   DECOUPLER (SEPARATE)                    → severs graph; disconnected parts
 *                                              become a DebrisState fragment
 *   PARACHUTE / LANDING_LEGS (DEPLOY)       → added to ps.deployedParts
 *   EJECT   (EJECT)                         → CREW_EJECTED event emitted
 *   RELEASE (RELEASE)                       → SATELLITE_RELEASED event emitted
 *   COLLECT_SCIENCE                         → delegates to sciencemodule.js;
 *                                              starts timed experiment (idle→running);
 *                                              SCIENCE_COLLECTED fires when timer expires
 *
 * DEBRIS SIMULATION
 *   Jettisoned stage sections continue to be simulated independently.  They
 *   fall under gravity and experience atmospheric drag.  Any SRBs that were
 *   still burning at the moment of separation continue to burn on the debris.
 *   The player has no control over debris — no steering, no throttle, no
 *   further staging.
 *
 * PUBLIC API
 *   activateCurrentStage(ps, assembly, stagingConfig, flightState) → DebrisState[]
 *   recomputeActiveGraph(ps, assembly)                             → DebrisState[]
 *   tickDebris(debris, assembly, dt)                               → void
 *
 * @module staging
 */

import { getPartById }              from '../data/parts.js';
import { PartType }                 from './constants.js';
import { airDensity, SEA_LEVEL_DENSITY } from './atmosphere.js';
import { tickFuelSystem }           from './fuelsystem.js';
import { deployParachute, DEPLOY_DURATION, LOW_DENSITY_THRESHOLD } from './parachute.js';
import { deployLandingLeg, getDeployedLegFootOffset } from './legs.js';
import { activateEjectorSeat } from './ejector.js';
import { activateScienceModule, activateInstrument, parseInstrumentKey } from './sciencemodule.js';
import { applySeparationImpulse } from './collision.js';
import { getMalfunction } from './malfunction.js';
import { MalfunctionType } from './constants.js';

import type { PhysicsState, RocketAssembly } from './physics.js';
import type { FlightState, FlightEvent } from './gameState.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard gravity (m/s²). */
const G0 = 9.81;

/** Scale factor: metres per pixel at default 1× zoom. */
const SCALE_M_PER_PX = 0.05;

/** Landing speed below which ground contact is considered safe (m/s). */
const DEFAULT_SAFE_LANDING_SPEED = 10;

/** Number of physics ticks to skip collision detection after separation.
 *  Must match the value in collision.js. */
const SEPARATION_COOLDOWN_TICKS = 10;

// ---------------------------------------------------------------------------
// Internal ID counter for debris fragments
// ---------------------------------------------------------------------------

let _debrisNextId = 1;

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** Per-parachute lifecycle entry (mirrored from physics.ts). */
interface ParachuteEntry {
  state: string;
  deployTimer: number;
  canopyAngle: number;
  canopyAngularVel: number;
  stowTimer?: number;
}

/** Per-landing-leg lifecycle entry (mirrored from physics.ts). */
interface LegEntry {
  state: string;
  deployTimer: number;
}

/**
 * A jettisoned rocket fragment that continues to be simulated physically
 * after stage separation.  It falls under gravity and atmospheric drag;
 * any SRBs still burning at separation keep burning.  The player has no
 * control over debris — there is no steering, throttle, or further staging.
 *
 * The property names deliberately mirror those of PhysicsState so that helper
 * functions such as tickFuelSystem can operate on a DebrisState
 * without modification.
 */
export interface DebrisState {
  /** Unique fragment identifier (e.g. 'debris-1'). */
  id: string;
  /** Instance IDs of parts currently belonging to this fragment. */
  activeParts: Set<string>;
  /** Instance IDs of engines/SRBs that were burning at the moment of separation and are still active. */
  firingEngines: Set<string>;
  /** Remaining propellant (kg) per part instance ID. */
  fuelStore: Map<string, number>;
  /** Instance IDs of parachutes or legs that were deployed at separation time. */
  deployedParts: Set<string>;
  /** Parachute lifecycle states inherited from the parent rocket at separation. */
  parachuteStates: Map<string, ParachuteEntry>;
  /** Landing leg lifecycle states inherited from the parent rocket at separation. */
  legStates: Map<string, LegEntry>;
  /** Accumulated reentry heat per part instance ID (heat units). */
  heatMap: Map<string, number>;
  /** Horizontal position (m; inherited from parent rocket at separation). */
  posX: number;
  /** Vertical position (m; 0 = ground; inherited from parent rocket). */
  posY: number;
  /** Horizontal velocity (m/s; inherited from parent rocket at separation). */
  velX: number;
  /** Vertical velocity (m/s; inherited from parent rocket at separation). */
  velY: number;
  /** Orientation (radians; 0 = pointing straight up; inherited from parent). */
  angle: number;
  /** Always 1.0 — SRBs ignore throttle. */
  throttle: number;
  /** Angular velocity (rad/s; positive = clockwise). */
  angularVelocity: number;
  /** True when the debris fragment is on the ground and tilted. */
  isTipping: boolean;
  /** Ground contact pivot X in VAB local pixels. */
  tippingContactX: number;
  /** Ground contact pivot Y in VAB local pixels. */
  tippingContactY: number;
  /** True after a safe touchdown. */
  landed: boolean;
  /** True after a high-speed ground impact. */
  crashed: boolean;
  /** Collision cooldown ticks remaining after separation. */
  collisionCooldown?: number;
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

// ---------------------------------------------------------------------------
// Public API — activateCurrentStage
// ---------------------------------------------------------------------------

/**
 * Fire the current stage of the rocket.
 *
 * Reads all parts assigned to `stagingConfig.stages[currentStageIdx]` and
 * activates each according to its `activationBehaviour`.
 *
 * After all activations, `stagingConfig.currentStageIdx` is incremented
 * (unless already at the final stage).
 *
 * @returns Newly created debris fragments (empty array when no decouplers fired this stage).
 */
export function activateCurrentStage(
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
): DebrisState[] {
  const idx = stagingConfig.currentStageIdx;
  const stageData = stagingConfig.stages[idx];
  if (!stageData) return [];

  const instanceIds = [...stageData.instanceIds];
  const newDebris: DebrisState[] = [];

  for (const instanceId of instanceIds) {
    // Handle individual instrument activation keys (moduleId:instr:N).
    const instrParsed = parseInstrumentKey(instanceId);
    if (instrParsed) {
      activateInstrument(ps, assembly, flightState, instanceId);
      continue;
    }

    if (!ps.activeParts.has(instanceId)) continue;

    const placed = assembly.parts.get(instanceId);
    const def = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const behaviour = def.activationBehaviour;
    const time = flightState.timeElapsed;
    const altitude = Math.max(0, ps.posY);

    switch (behaviour) {
      case 'IGNITE':
        // ENGINE or SRB — begin producing thrust.
        ps.firingEngines.add(instanceId);
        _emitEvent(flightState, {
          type:        'PART_ACTIVATED',
          time,
          partType:    def.type,
          description: `${def.name} ignited.`,
        });
        break;

      case 'SEPARATE': {
        // DECOUPLER_STUCK malfunction: skip automatic staging (player must
        // manually decouple via context menu).
        const decMalf = getMalfunction(ps, instanceId);
        if (decMalf && !decMalf.recovered && decMalf.type === MalfunctionType.DECOUPLER_STUCK) {
          _emitEvent(flightState, {
            type:        'MALFUNCTION_BLOCKED',
            time,
            instanceId,
            partType:    def.type,
            description: `${def.name} stuck — manual decouple required.`,
          });
          break;
        }

        // DECOUPLER / LAUNCH_CLAMP — fire one-shot separation charge.
        const isClamp = def.type === PartType.LAUNCH_CLAMP;
        _emitEvent(flightState, {
          type:        isClamp ? 'LAUNCH_CLAMP_RELEASED' : 'PART_ACTIVATED',
          time,
          partType:    def.type,
          description: isClamp
            ? `${def.name} released — rocket free.`
            : `${def.name} fired — stage separation.`,
        });
        // Remove the part from the rocket immediately so the BFS below
        // cannot traverse through it.
        ps.activeParts.delete(instanceId);
        ps.firingEngines.delete(instanceId);

        // The part itself becomes a small debris fragment (it detaches
        // from both sides).  Re-add temporarily so _createDebrisFromParts
        // can transfer it properly.
        ps.activeParts.add(instanceId);
        const decouplerDebris = _createDebrisFromParts(ps, [instanceId], assembly);

        // Launch clamp debris swings away laterally instead of just falling.
        if (isClamp) {
          const clampPlaced = assembly.parts.get(instanceId);
          // Swing away from the rocket centre: if clamp is to the left, push left; else push right.
          const lateralDir = (clampPlaced && clampPlaced.x < 0) ? -1 : 1;
          decouplerDebris.velX += lateralDir * 3;  // 3 m/s lateral swing
          decouplerDebris.velY += 0.5;             // slight upward before falling
          decouplerDebris.angularVelocity = lateralDir * 2.0; // visual rotation
        }
        newDebris.push(decouplerDebris);

        // Recompute which parts are still connected to a command module and
        // collect newly disconnected sections as debris.
        const fragments = recomputeActiveGraph(ps, assembly);
        for (const frag of fragments) {
          applySeparationImpulse(ps, frag, assembly);
        }
        newDebris.push(...fragments);

        // If a satellite part ended up in the disconnected debris, emit a
        // SATELLITE_RELEASED event so mission objectives can be checked.
        const separateVelocity = Math.hypot(ps.velX, ps.velY);
        for (const frag of fragments) {
          const fragSatPartId = _getFragmentSatellitePartId(frag, assembly);
          if (fragSatPartId) {
            _emitEvent(flightState, {
              type:        'SATELLITE_RELEASED',
              time,
              altitude,
              velocity:    separateVelocity,
              partId:      fragSatPartId,
              description: `Satellite detached at ${altitude.toFixed(0)} m.`,
            });
            break; // Only emit one event per stage fire.
          }
        }
        break;
      }

      case 'DEPLOY': {
        // Check for LANDING_LEGS_STUCK malfunction: block deployment via staging.
        const legMalf = getMalfunction(ps, instanceId);
        if (legMalf && !legMalf.recovered && legMalf.type === MalfunctionType.LANDING_LEGS_STUCK) {
          _emitEvent(flightState, {
            type:        'MALFUNCTION_BLOCKED',
            time,
            instanceId,
            partType:    def.type,
            description: `${def.name} stuck — manual deployment required.`,
          });
          break;
        }

        // PARACHUTE or LANDING_LEGS — deploy / extend.
        ps.deployedParts.add(instanceId);
        if (def.type === PartType.PARACHUTE) {
          deployParachute(ps, instanceId);
        } else if (
          def.type === PartType.LANDING_LEGS ||
          def.type === PartType.LANDING_LEG
        ) {
          deployLandingLeg(ps, instanceId);
        }
        _emitEvent(flightState, {
          type:        'PART_ACTIVATED',
          time,
          partType:    def.type,
          description: `${def.name} deployed at ${altitude.toFixed(0)} m.`,
        });
        break;
      }

      case 'EJECT':
        // COMMAND_MODULE ejector seat — emergency crew escape.
        activateEjectorSeat(ps, assembly, flightState, instanceId);
        break;

      case 'RELEASE': {
        // SATELLITE — release into free flight as a detached physics object.
        const releaseVelocity = Math.hypot(ps.velX, ps.velY);
        const satelliteDebris = _createDebrisFromParts(ps, [instanceId], assembly);
        newDebris.push(satelliteDebris);

        // Recompute graph in case other parts were only connected through
        // the satellite (e.g. satellite was mid-stack).
        const orphanFragments = recomputeActiveGraph(ps, assembly);
        newDebris.push(...orphanFragments);

        _emitEvent(flightState, {
          type:        'SATELLITE_RELEASED',
          time,
          altitude,
          velocity:    releaseVelocity,
          partId:      placed!.partId,
          description: `Satellite released at ${altitude.toFixed(0)} m.`,
        });
        break;
      }

      case 'COLLECT_SCIENCE':
        // SERVICE_MODULE science instrument — start the timed experiment.
        activateScienceModule(ps, assembly, flightState, instanceId);
        break;

      default:
        break;
    }
  }

  // Advance to the next stage index, but never go beyond the last stage.
  if (stagingConfig.currentStageIdx + 1 < stagingConfig.stages.length) {
    stagingConfig.currentStageIdx += 1;
  }

  // After parts have been removed, re-normalise the assembly so the lowest
  // remaining active part's bottom is at Y = 0.  posY is adjusted upward by
  // the same world-space amount so every part's absolute world position stays
  // unchanged — no visual discontinuity.
  _renormalizeAfterSeparation(ps, assembly, newDebris);

  return newDebris;
}

// ---------------------------------------------------------------------------
// Public API — activatePartDirect
// ---------------------------------------------------------------------------

/**
 * Activate a single part immediately, bypassing the stage queue.
 *
 * Fires the same activation logic as activateCurrentStage but for a
 * specific part instance selected from outside the staging system (e.g. a
 * flight-scene right-click context menu).  Only activatable parts that are
 * currently in `ps.activeParts` can be activated this way.
 *
 * @returns Newly created debris fragments, or an empty array.
 */
export function activatePartDirect(
  ps: PhysicsState,
  assembly: RocketAssembly,
  flightState: FlightState,
  instanceId: string,
): DebrisState[] {
  // Handle individual instrument activation keys (moduleId:instr:N).
  const instrParsed = parseInstrumentKey(instanceId);
  if (instrParsed) {
    activateInstrument(ps, assembly, flightState, instanceId);
    return [];
  }

  if (!ps.activeParts.has(instanceId)) return [];

  const placed = assembly.parts.get(instanceId);
  const def    = placed ? getPartById(placed.partId) : null;
  if (!def || !def.activatable) return [];

  const behaviour = def.activationBehaviour;
  const time      = flightState.timeElapsed;
  const altitude  = Math.max(0, ps.posY);
  const newDebris: DebrisState[] = [];

  switch (behaviour) {
    case 'IGNITE':
      // ENGINE or SRB — begin producing thrust.
      ps.firingEngines.add(instanceId);
      _emitEvent(flightState, {
        type:        'PART_ACTIVATED',
        time,
        instanceId,
        partType:    def.type,
        description: `${def.name} ignited.`,
      });
      break;

    case 'SEPARATE': {
      // DECOUPLER — fire one-shot separation charge.
      _emitEvent(flightState, {
        type:        'PART_ACTIVATED',
        time,
        instanceId,
        partType:    def.type,
        description: `${def.name} fired — stage separation.`,
      });
      ps.activeParts.delete(instanceId);
      ps.firingEngines.delete(instanceId);

      // The decoupler itself becomes a small debris fragment.
      ps.activeParts.add(instanceId);
      const directDecDebris = _createDebrisFromParts(ps, [instanceId], assembly);
      newDebris.push(directDecDebris);

      const fragments = recomputeActiveGraph(ps, assembly);
      for (const frag of fragments) {
        applySeparationImpulse(ps, frag, assembly);
      }
      newDebris.push(...fragments);

      // If a satellite part ended up in the disconnected debris, emit a
      // SATELLITE_RELEASED event so mission objectives can be checked.
      const directSeparateVelocity = Math.hypot(ps.velX, ps.velY);
      for (const frag of fragments) {
        const directFragSatPartId = _getFragmentSatellitePartId(frag, assembly);
        if (directFragSatPartId) {
          _emitEvent(flightState, {
            type:        'SATELLITE_RELEASED',
            time,
            altitude,
            velocity:    directSeparateVelocity,
            partId:      directFragSatPartId,
            description: `Satellite detached at ${altitude.toFixed(0)} m.`,
          });
          break;
        }
      }
      break;
    }

    case 'DEPLOY':
      // PARACHUTE or LANDING_LEGS — deploy / extend.
      ps.deployedParts.add(instanceId);
      if (def.type === PartType.PARACHUTE) {
        deployParachute(ps, instanceId);
      } else if (
        def.type === PartType.LANDING_LEGS ||
        def.type === PartType.LANDING_LEG
      ) {
        deployLandingLeg(ps, instanceId);
      }
      _emitEvent(flightState, {
        type:        'PART_ACTIVATED',
        time,
        instanceId,
        partType:    def.type,
        description: `${def.name} deployed at ${altitude.toFixed(0)} m.`,
      });
      break;

    case 'EJECT':
      // COMMAND_MODULE ejector seat — emergency crew escape.
      activateEjectorSeat(ps, assembly, flightState, instanceId);
      break;

    case 'RELEASE': {
      // SATELLITE — release into free flight as a detached physics object.
      const directReleaseVelocity = Math.hypot(ps.velX, ps.velY);
      const directSatDebris = _createDebrisFromParts(ps, [instanceId], assembly);
      newDebris.push(directSatDebris);

      // Recompute graph in case other parts were only connected through the satellite.
      const directOrphanFragments = recomputeActiveGraph(ps, assembly);
      newDebris.push(...directOrphanFragments);

      _emitEvent(flightState, {
        type:        'SATELLITE_RELEASED',
        time,
        instanceId,
        altitude,
        velocity:    directReleaseVelocity,
        partId:      placed!.partId,
        description: `Satellite released at ${altitude.toFixed(0)} m.`,
      });
      break;
    }

    case 'COLLECT_SCIENCE':
      // SERVICE_MODULE science instrument — start the timed experiment.
      activateScienceModule(ps, assembly, flightState, instanceId);
      break;

    default:
      break;
  }

  // Re-normalise the assembly origin after parts may have been removed.
  _renormalizeAfterSeparation(ps, assembly, newDebris);

  return newDebris;
}

// ---------------------------------------------------------------------------
// Public API — recomputeActiveGraph
// ---------------------------------------------------------------------------

/**
 * Recompute which parts are reachable from a command or computer module.
 *
 * Performs a BFS starting from every COMMAND_MODULE and COMPUTER_MODULE still
 * in `ps.activeParts`.  Any part not reachable from at least one command
 * module is considered disconnected: it is removed from `ps.activeParts` and
 * `ps.firingEngines`, and collected into a single new DebrisState.
 *
 * @returns Newly created debris fragments.  Empty array when all active parts
 *   remain connected to a command module.
 */
export function recomputeActiveGraph(ps: PhysicsState, assembly: RocketAssembly): DebrisState[] {
  // Seed the BFS queue with all command / computer module roots.
  let roots = _findAllCommandModules(ps, assembly);

  // Fallback: if no command module is present, treat the first active part as
  // the root so the remaining rocket structure is not incorrectly classified
  // as debris.
  if (roots.length === 0) {
    for (const id of ps.activeParts) {
      roots = [id];
      break;
    }
  }

  if (roots.length === 0) {
    // No active parts at all — nothing to do.
    return [];
  }

  // BFS: find all parts reachable from any root through active connections.
  const reachable = new Set(roots);
  const queue = [...roots];

  while (queue.length > 0) {
    const id = queue.shift()!;

    // Only expand from parts that are still in the active set.
    if (!ps.activeParts.has(id)) continue;

    for (const conn of assembly.connections) {
      let neighbor: string | null = null;
      if (conn.fromInstanceId === id)      neighbor = conn.toInstanceId;
      else if (conn.toInstanceId === id)   neighbor = conn.fromInstanceId;

      if (
        neighbor !== null &&
        !reachable.has(neighbor) &&
        ps.activeParts.has(neighbor)
      ) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Collect parts not reachable from any command module.
  const disconnected: string[] = [];
  for (const id of ps.activeParts) {
    if (!reachable.has(id)) disconnected.push(id);
  }

  if (disconnected.length === 0) return [];

  // Package all disconnected parts into one new debris fragment and remove
  // them from the active rocket.
  const debris = _createDebrisFromParts(ps, disconnected, assembly);
  return [debris];
}

// ---------------------------------------------------------------------------
// Public API — tickDebris
// ---------------------------------------------------------------------------

/**
 * Advance a debris fragment's physics by one fixed timestep.
 *
 * Simulates:
 *   - Gravitational acceleration: G0 downward.
 *   - Atmospheric drag: proportional to density × speed² × CdA.
 *   - SRB thrust (if any SRBs were burning at separation).
 *   - Fuel consumption via tickFuelSystem.
 *   - Ground contact: sets `debris.landed` or `debris.crashed`.
 *
 * This function is a no-op once `debris.landed` or `debris.crashed` is true.
 */
export function tickDebris(debris: DebrisState, assembly: RocketAssembly, dt: number): void {
  if (debris.landed || debris.crashed) return;

  const altitude = Math.max(0, debris.posY);
  const density  = airDensity(altitude);

  // --- 1. Total mass (dry parts + remaining propellant) --------------------
  const totalMass = _debrisMass(debris, assembly);

  // --- 2. SRB thrust (only SRBs; liquid engines are excluded) --------------
  let thrustX = 0;
  let thrustY = 0;

  for (const engineId of debris.firingEngines) {
    if (!debris.activeParts.has(engineId)) continue;

    const placed = assembly.parts.get(engineId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    // Only SRBs produce thrust on debris — liquid engines flame out
    // immediately (no command module to control them).
    if (def.type !== PartType.SOLID_ROCKET_BOOSTER) continue;

    const fuelLeft = debris.fuelStore.get(engineId) ?? 0;
    if (fuelLeft <= 0) continue; // Exhausted — tickFuelSystem will remove it.

    // Interpolate thrust between sea-level and vacuum values.
    const props        = (def.properties ?? {}) as Record<string, number>;
    const densityRatio = density > 0
      ? Math.min(1, density / SEA_LEVEL_DENSITY)
      : 0;
    const thrustSL  = (props.thrust    ?? 0) * 1_000; // kN → N
    const thrustVac = (props.thrustVac ?? props.thrust ?? 0) * 1_000;
    const thrustN   = densityRatio * thrustSL + (1 - densityRatio) * thrustVac;

    // Project along the debris fragment's fixed orientation axis.
    thrustX += thrustN * Math.sin(debris.angle);
    thrustY += thrustN * Math.cos(debris.angle);
  }

  // --- 3. Gravity ----------------------------------------------------------
  const gravFY = -G0 * totalMass;

  // --- 4. Drag -------------------------------------------------------------
  const speed = Math.hypot(debris.velX, debris.velY);
  let dragFX  = 0;
  let dragFY  = 0;

  if (speed > 1e-6 && density > 0) {
    const dragMag = _debrisDrag(debris, assembly, density, speed);
    dragFX = -dragMag * (debris.velX / speed);
    dragFY = -dragMag * (debris.velY / speed);
  }

  // --- 5. Euler integration ------------------------------------------------
  const netFX = thrustX + dragFX;
  const netFY = thrustY + gravFY + dragFY;

  debris.velX += (netFX / totalMass) * dt;
  debris.velY += (netFY / totalMass) * dt;
  debris.posX += debris.velX * dt;
  debris.posY += debris.velY * dt;

  // --- 6. Fuel consumption (SRBs via tickFuelSystem) -----------------------
  tickFuelSystem(debris, assembly, dt, density);

  // --- 6b. Angular dynamics (airborne) ------------------------------------
  if (debris.angularVelocity != null) {
    debris.angle += debris.angularVelocity * dt;
    // Light aerodynamic damping.
    if (density > 0) {
      debris.angularVelocity *= Math.max(0, 1 - 0.005 * density * dt);
    }
  }

  // --- 7. Ground contact ---------------------------------------------------
  if (debris.posY <= 0) {
    const impactSpeed = Math.hypot(debris.velX, debris.velY);
    debris.posY = 0;
    debris.velX = 0;
    debris.velY = 0;

    if (impactSpeed <= DEFAULT_SAFE_LANDING_SPEED) {
      debris.landed  = true;
      // If landing at an angle, begin tipping simulation.
      if (Math.abs(debris.angle) > 0.005) {
        debris.isTipping = true;
      }
    } else {
      debris.crashed = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Private — post-separation re-normalisation
// ---------------------------------------------------------------------------

/**
 * After a stage separation removes parts from the active rocket, the assembly
 * origin may no longer coincide with the lowest active part's bottom edge.
 * This shifts `posY` upward (in world space) and every remaining active
 * part's `placed.y` downward by the same amount.
 */
function _renormalizeAfterSeparation(
  ps: PhysicsState,
  assembly: RocketAssembly,
  extraDebris: DebrisState[] = [],
): void {
  if (ps.activeParts.size === 0) return;

  // Find the lowest bottom edge (assembly Y-up, pixels) among active parts.
  let lowestBottom = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    let bottom = placed!.y - (def.height ?? 40) / 2;
    // Deployed legs extend below their bounding box.
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      const footY = placed!.y - dy;
      if (footY < bottom) bottom = footY;
    }
    lowestBottom = Math.min(lowestBottom, bottom);
  }

  // Nothing to adjust if the lowest bottom is already at (or below) Y = 0.
  if (!isFinite(lowestBottom) || lowestBottom <= 0) return;

  const offsetM = lowestBottom * SCALE_M_PER_PX;

  // Shift the world origin up so it stays at the new bottom.
  ps.posY += offsetM;

  // Shift every part in the assembly downward by the same amount so their
  // absolute world positions remain unchanged.  ALL parts are shifted (not
  // just active ones) because debris rendering still references the same
  // placed objects.
  for (const [, placed] of assembly.parts) {
    placed.y -= lowestBottom;
  }

  // Debris fragments also reference the same placed objects, so their posY
  // must be compensated by the same world-space offset to stay correct.
  for (const debris of ps.debris) {
    debris.posY += offsetM;
  }

  // Also compensate newly created debris not yet in ps.debris.
  for (const debris of extraDebris) {
    debris.posY += offsetM;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Create a new DebrisState from a set of part instance IDs, extracting
 * their simulation data from the parent PhysicsState.
 */
function _createDebrisFromParts(
  ps: PhysicsState,
  partIds: string[],
  assembly: RocketAssembly,
): DebrisState {
  const activeParts     = new Set(partIds);
  const firingEngines   = new Set<string>();
  const fuelStore       = new Map<string, number>();
  const deployedParts   = new Set<string>();
  const parachuteStates = new Map<string, ParachuteEntry>();
  const legStates       = new Map<string, LegEntry>();
  const heatMap         = new Map<string, number>();

  for (const id of partIds) {
    // Transfer firing engine state.
    // Only SRBs continue burning on debris — liquid engines flame out
    // immediately (no command module to control them).
    if (ps.firingEngines.has(id)) {
      const placed = assembly.parts.get(id);
      const def    = placed ? getPartById(placed.partId) : null;
      if (def && def.type === PartType.SOLID_ROCKET_BOOSTER) {
        firingEngines.add(id);
      }
      ps.firingEngines.delete(id);
    }

    // Transfer remaining fuel.
    if (ps.fuelStore.has(id)) {
      fuelStore.set(id, ps.fuelStore.get(id)!);
    }

    // Transfer deployed state (chutes, legs).
    if (ps.deployedParts.has(id)) {
      deployedParts.add(id);
    }

    // Transfer parachute state machine entry so debris chutes keep animating.
    if (ps.parachuteStates?.has(id)) {
      // Deep-copy the entry so the debris state evolves independently.
      const src = ps.parachuteStates.get(id)!;
      parachuteStates.set(id, {
        state: src.state,
        deployTimer: src.deployTimer,
        canopyAngle: src.canopyAngle ?? 0,
        canopyAngularVel: src.canopyAngularVel ?? 0,
        stowTimer: src.stowTimer,
      });
    }

    // Transfer landing leg state machine entry.
    if (ps.legStates?.has(id)) {
      const src = ps.legStates.get(id)!;
      legStates.set(id, { state: src.state, deployTimer: src.deployTimer });
    }

    // Transfer heat accumulation.
    if (ps.heatMap.has(id)) {
      heatMap.set(id, ps.heatMap.get(id)!);
    }

    // Remove the part from the parent rocket's active set.
    ps.activeParts.delete(id);
  }

  return {
    id:             `debris-${_debrisNextId++}`,
    activeParts,
    firingEngines,
    fuelStore,
    deployedParts,
    parachuteStates,
    legStates,
    heatMap,
    posX:    ps.posX,
    posY:    ps.posY,
    velX:    ps.velX,
    velY:    ps.velY,
    angle:   ps.angle,
    angularVelocity: (ps.angularVelocity ?? 0) + (Math.random() - 0.5) * 0.3,
    throttle: 1.0,  // SRBs ignore throttle; liquid engines will flame out.
    landed:  false,
    crashed: false,
    isTipping: false,
    tippingContactX: 0,
    tippingContactY: 0,
    collisionCooldown: SEPARATION_COOLDOWN_TICKS,
  };
}

/**
 * Return the instance IDs of all COMMAND_MODULE and COMPUTER_MODULE parts
 * currently in `ps.activeParts`.
 */
function _findAllCommandModules(ps: PhysicsState, assembly: RocketAssembly): string[] {
  const roots: string[] = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    if (
      def.type === PartType.COMMAND_MODULE ||
      def.type === PartType.COMPUTER_MODULE
    ) {
      roots.push(instanceId);
    }
  }
  return roots;
}

/**
 * Compute the total mass (dry + remaining fuel) of a debris fragment.
 *
 * @returns Mass in kilograms (minimum 1 kg to avoid division by zero).
 */
function _debrisMass(debris: DebrisState, assembly: RocketAssembly): number {
  let mass = 0;

  for (const id of debris.activeParts) {
    const placed = assembly.parts.get(id);
    const def    = placed ? getPartById(placed.partId) : null;
    if (def) mass += def.mass ?? 0;
  }

  for (const [id, fuel] of debris.fuelStore) {
    if (debris.activeParts.has(id)) mass += fuel;
  }

  return Math.max(1, mass);
}

/**
 * Return the deployment progress for a parachute on a debris fragment.
 * Mirrors the same helper in physics.js but uses the debris's own parachuteStates.
 * Falls back to the binary deployedParts set for older debris objects.
 *
 * @returns 0 = packed, 0→1 = deploying, 1 = deployed.
 */
function _getDebrisChuteDeployProgress(debris: DebrisState, instanceId: string): number {
  const entry = debris.parachuteStates?.get(instanceId);
  if (!entry) {
    return debris.deployedParts?.has(instanceId) ? 1 : 0;
  }
  switch (entry.state) {
    case 'deployed':  return 1;
    case 'deploying': return Math.max(0, Math.min(1, 1 - entry.deployTimer / DEPLOY_DURATION));
    default:          return 0;
  }
}

/**
 * Compute the aerodynamic drag force magnitude (Newtons) for a debris fragment.
 *
 * dragForce = 0.5 × ρ × v² × ΣCdA  (summed over all active parts in fragment)
 */
function _debrisDrag(debris: DebrisState, assembly: RocketAssembly, density: number, speed: number): number {
  if (density <= 0 || speed <= 0) return 0;

  let totalCdA = 0;

  for (const id of debris.activeParts) {
    const placed = assembly.parts.get(id);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const props  = (def.properties ?? {}) as Record<string, number>;
    const widthM = (def.width ?? 40) * SCALE_M_PER_PX;
    const area   = Math.PI * (widthM / 2) ** 2; // stowed circular cross-section

    if (def.type === PartType.PARACHUTE) {
      const stowedCdA   = (props.dragCoefficient ?? 0.05) * area;
      const deployedR   = (props.deployedDiameter ?? 10) / 2;
      const deployedCd  = props.deployedCd ?? 0.75;
      const deployedCdA = deployedCd * Math.PI * deployedR * deployedR;
      const progress     = _getDebrisChuteDeployProgress(debris, id);
      const densityScale = Math.min(1, density / LOW_DENSITY_THRESHOLD);
      totalCdA += stowedCdA + (deployedCdA - stowedCdA) * progress * densityScale;
    } else {
      totalCdA += (props.dragCoefficient ?? 0.2) * area;
    }
  }

  return 0.5 * density * speed * speed * totalCdA;
}

/**
 * Return the part definition ID of the first SATELLITE part in a debris fragment,
 * or null if none found.
 */
function _getFragmentSatellitePartId(debris: DebrisState, assembly: RocketAssembly): string | null {
  for (const instanceId of debris.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (def && def.type === PartType.SATELLITE) return placed!.partId;
  }
  return null;
}

/**
 * Append a flight event to a FlightState event log.
 */
function _emitEvent(flightState: FlightState, event: FlightEvent): void {
  flightState.events.push(event);
}
