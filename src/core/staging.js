/**
 * staging.js — Flight staging and stage separation logic.
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
 *   Each debris fragment maintains its own position, velocity, and angle,
 *   all inherited from the parent rocket at the moment of separation.
 *
 * GRAPH RECOMPUTATION
 *   After a decoupler fires, `recomputeActiveGraph` performs a BFS from every
 *   COMMAND_MODULE and COMPUTER_MODULE still in `ps.activeParts`.  Any part
 *   not reachable from a command module is moved out of `ps.activeParts` into
 *   a new DebrisState returned by the function.
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
import { deployLandingLeg } from './legs.js';
import { activateEjectorSeat } from './ejector.js';
import { activateScienceModule } from './sciencemodule.js';
import { applySeparationImpulse } from './collision.js';

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
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * A jettisoned rocket fragment that continues to be simulated physically
 * after stage separation.  It falls under gravity and atmospheric drag;
 * any SRBs still burning at separation keep burning.  The player has no
 * control over debris — there is no steering, throttle, or further staging.
 *
 * The property names deliberately mirror those of PhysicsState so that helper
 * functions such as {@link tickFuelSystem} can operate on a DebrisState
 * without modification.
 *
 * @typedef {Object} DebrisState
 * @property {string}              id            Unique fragment identifier
 *   (e.g. 'debris-1').
 * @property {Set<string>}         activeParts   Instance IDs of parts
 *   currently belonging to this fragment.
 * @property {Set<string>}         firingEngines Instance IDs of engines /
 *   SRBs that were burning at the moment of separation and are still active.
 * @property {Map<string,number>}  fuelStore     Remaining propellant (kg)
 *   per part instance ID.
 * @property {Set<string>}         deployedParts Instance IDs of parachutes
 *   or legs that were deployed at separation time.
 * @property {Map<string, import('./parachute.js').ParachuteEntry>} parachuteStates
 *   Parachute lifecycle states inherited from the parent rocket at separation.
 *   Keyed by instance ID.  An empty map when the debris has no parachutes.
 * @property {Map<string, import('./legs.js').LegEntry>} legStates
 *   Landing leg lifecycle states inherited from the parent rocket at separation.
 *   Keyed by instance ID.  An empty map when the debris has no landing legs.
 * @property {Map<string,number>}  heatMap       Accumulated reentry heat per
 *   part instance ID (heat units).
 * @property {number}              posX          Horizontal position (m;
 *   inherited from parent rocket at separation).
 * @property {number}              posY          Vertical position (m; 0 =
 *   ground; inherited from parent rocket).
 * @property {number}              velX          Horizontal velocity (m/s;
 *   inherited from parent rocket at separation).
 * @property {number}              velY          Vertical velocity (m/s;
 *   inherited from parent rocket at separation).
 * @property {number}              angle         Orientation (radians; 0 =
 *   pointing straight up; inherited from parent).
 * @property {number}              throttle      Always 1.0 — SRBs ignore
 *   throttle.  Liquid engines are removed from firingEngines at separation
 *   (no command module to control them).
 * @property {number}              angularVelocity  Angular velocity (rad/s;
 *   positive = clockwise).  Inherited from the parent rocket at separation
 *   plus a small random perturbation.
 * @property {boolean}             isTipping     True when the debris fragment
 *   is on the ground and tilted — rotation is around the ground contact point.
 * @property {number}              tippingContactX  Ground contact pivot X in
 *   VAB local pixels (only meaningful when `isTipping` is true).
 * @property {number}              tippingContactY  Ground contact pivot Y in
 *   VAB local pixels (only meaningful when `isTipping` is true).
 * @property {boolean}             landed        True after a safe touchdown
 *   (speed ≤ {@link DEFAULT_SAFE_LANDING_SPEED}).
 * @property {boolean}             crashed       True after a high-speed
 *   ground impact.
 */

// ---------------------------------------------------------------------------
// Public API — activateCurrentStage
// ---------------------------------------------------------------------------

/**
 * Fire the current stage of the rocket.
 *
 * Reads all parts assigned to `stagingConfig.stages[currentStageIdx]` and
 * activates each according to its `activationBehaviour`:
 *
 * - **IGNITE** (ENGINE, SRB): add to `ps.firingEngines`, emit PART_ACTIVATED.
 * - **SEPARATE** (any decoupler): remove decoupler from `ps.activeParts`,
 *   then call {@link recomputeActiveGraph} to identify any rocket sections now
 *   disconnected from a command module.  Those sections are collected into
 *   new {@link DebrisState} objects and returned.
 * - **DEPLOY** (parachute, landing legs): add to `ps.deployedParts`, emit
 *   PART_ACTIVATED.
 * - **EJECT**: emit CREW_EJECTED event.
 * - **RELEASE**: emit SATELLITE_RELEASED event.
 * - **COLLECT_SCIENCE**: emit PART_ACTIVATED and SCIENCE_COLLECTED events.
 *
 * After all activations, `stagingConfig.currentStageIdx` is incremented
 * (unless already at the final stage).
 *
 * @param {import('./physics.js').PhysicsState}             ps
 * @param {import('./rocketbuilder.js').RocketAssembly}     assembly
 * @param {import('./rocketbuilder.js').StagingConfig}      stagingConfig
 * @param {import('./gameState.js').FlightState}            flightState
 * @returns {DebrisState[]}  Newly created debris fragments (empty array when
 *   no decouplers fired this stage).
 */
export function activateCurrentStage(ps, assembly, stagingConfig, flightState) {
  const idx = stagingConfig.currentStageIdx;
  const stageData = stagingConfig.stages[idx];
  if (!stageData) return [];

  const instanceIds = [...stageData.instanceIds];
  const newDebris = [];

  for (const instanceId of instanceIds) {
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
        // DECOUPLER (stack or radial) — fire one-shot separation charge.
        _emitEvent(flightState, {
          type:        'PART_ACTIVATED',
          time,
          partType:    def.type,
          description: `${def.name} fired — stage separation.`,
        });
        // Remove the decoupler from the rocket immediately so the BFS below
        // cannot traverse through it.
        ps.activeParts.delete(instanceId);
        ps.firingEngines.delete(instanceId);

        // The decoupler itself becomes a small debris fragment (it detaches
        // from both sides).  Re-add temporarily so _createDebrisFromParts
        // can transfer it properly.
        ps.activeParts.add(instanceId);
        const decouplerDebris = _createDebrisFromParts(ps, [instanceId], assembly);
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
          if (_fragmentContainsSatellite(frag, assembly)) {
            _emitEvent(flightState, {
              type:        'SATELLITE_RELEASED',
              time,
              altitude,
              velocity:    separateVelocity,
              description: `Satellite detached at ${altitude.toFixed(0)} m.`,
            });
            break; // Only emit one event per stage fire.
          }
        }
        break;
      }

      case 'DEPLOY':
        // PARACHUTE or LANDING_LEGS — deploy / extend.
        // Both types start a state-machine transition:
        //   PARACHUTE    → deploying (2 s animation) → deployed
        //   LANDING_LEGS → deploying (1.5 s animation) → deployed
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

      case 'EJECT':
        // COMMAND_MODULE ejector seat — emergency crew escape.
        // Delegates to ejector.js which tracks activation state, records
        // ejected crew, and emits the CREW_EJECTED event.
        activateEjectorSeat(ps, assembly, flightState, instanceId);
        break;

      case 'RELEASE': {
        // SATELLITE — release into free flight as a detached physics object.
        // Package the satellite into its own debris fragment so it continues
        // to be simulated independently (position, velocity, drag).
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
          description: `Satellite released at ${altitude.toFixed(0)} m.`,
        });
        break;
      }

      case 'COLLECT_SCIENCE':
        // SERVICE_MODULE science instrument — start the timed experiment.
        // The SCIENCE_COLLECTED event fires later (when the timer expires in
        // sciencemodule.tickScienceModules).  PART_ACTIVATED is emitted by
        // activateScienceModule itself when the experiment begins.
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
 * Fires the same activation logic as {@link activateCurrentStage} but for a
 * specific part instance selected from outside the staging system (e.g. a
 * flight-scene right-click context menu).  Only activatable parts that are
 * currently in `ps.activeParts` can be activated this way.
 *
 * Returned debris fragments (from SEPARATE activations) should be appended to
 * `ps.debris` by the caller.
 *
 * @param {import('./physics.js').PhysicsState}             ps
 * @param {import('./rocketbuilder.js').RocketAssembly}     assembly
 * @param {import('./gameState.js').FlightState}            flightState
 * @param {string}                                          instanceId
 * @returns {DebrisState[]}  Newly created debris fragments, or an empty array.
 */
export function activatePartDirect(ps, assembly, flightState, instanceId) {
  if (!ps.activeParts.has(instanceId)) return [];

  const placed = assembly.parts.get(instanceId);
  const def    = placed ? getPartById(placed.partId) : null;
  if (!def || !def.activatable) return [];

  const behaviour = def.activationBehaviour;
  const time      = flightState.timeElapsed;
  const altitude  = Math.max(0, ps.posY);
  const newDebris = [];

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
        if (_fragmentContainsSatellite(frag, assembly)) {
          _emitEvent(flightState, {
            type:        'SATELLITE_RELEASED',
            time,
            altitude,
            velocity:    directSeparateVelocity,
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
        description: `Satellite released at ${altitude.toFixed(0)} m.`,
      });
      break;
    }

    case 'COLLECT_SCIENCE':
      // SERVICE_MODULE science instrument — start the timed experiment.
      // The SCIENCE_COLLECTED event fires later (when the timer expires in
      // sciencemodule.tickScienceModules).  PART_ACTIVATED is emitted by
      // activateScienceModule itself when the experiment begins.
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
 * `ps.firingEngines`, and collected into a single new {@link DebrisState}.
 *
 * Call this after any structural severance (decoupler firing) to keep
 * `ps.activeParts` accurate and to produce the debris objects for the renderer
 * and physics simulation.
 *
 * Edge case — no command modules:
 *   If there are no COMMAND_MODULE or COMPUTER_MODULE parts in `ps.activeParts`
 *   (e.g. the command module was in the separated stage), the first active part
 *   is used as a fallback root so that the remaining rocket is not mistakenly
 *   turned into debris.
 *
 * @param {import('./physics.js').PhysicsState}         ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {DebrisState[]}  Newly created debris fragments.  Empty array when
 *   all active parts remain connected to a command module.
 */
export function recomputeActiveGraph(ps, assembly) {
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
    const id = queue.shift();

    // Only expand from parts that are still in the active set.
    if (!ps.activeParts.has(id)) continue;

    for (const conn of assembly.connections) {
      let neighbor = null;
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
  const disconnected = [];
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
 *   - Atmospheric drag: proportional to density × speed² × CdA (summed over
 *     all parts in the fragment; deployed parachutes add 80× Cd).
 *   - SRB thrust (if any SRBs were burning at separation and have not yet
 *     exhausted their fuel).  Liquid engines on detached stages flame out
 *     immediately because their tanks were severed.
 *   - Fuel consumption via `tickFuelSystem`.
 *   - Ground contact: sets `debris.landed` or `debris.crashed` and zeroes
 *     velocity.
 *
 * The player has no control over debris — there is no steering and no staging.
 * The fragment's angle is held fixed at the value inherited from the parent
 * rocket at separation.
 *
 * This function is a no-op once `debris.landed` or `debris.crashed` is true.
 *
 * @param {DebrisState}                                  debris
 * @param {import('./rocketbuilder.js').RocketAssembly}  assembly
 * @param {number} dt  Fixed timestep in seconds (typically 1/60).
 */
export function tickDebris(debris, assembly, dt) {
  if (debris.landed || debris.crashed) return;

  const altitude = Math.max(0, debris.posY);
  const density  = airDensity(altitude);

  // --- 1. Total mass (dry parts + remaining propellant) --------------------
  const totalMass = _debrisMass(debris, assembly);

  // --- 2. SRB thrust (only SRBs; liquid engines are excluded) --------------
  // Liquid engines flame out immediately on debris (no command module).
  // tickFuelSystem (step 6) drains fuel and removes exhausted SRBs.
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
    const props        = def.properties ?? {};
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
  // tickFuelSystem is compatible with DebrisState because both objects expose
  // the same field names: activeParts, firingEngines, fuelStore, throttle.
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
 * part's `placed.y` downward by the same amount so that:
 *
 *   1. The lowest active part's bottom sits at assembly Y = 0.
 *   2. Every part's absolute world position is unchanged (no visual jump).
 *   3. Ground collision at `posY ≤ 0` means the rocket's bottom touches the
 *      ground, regardless of how many lower stages were jettisoned.
 *
 * No-op when the lowest active bottom is already at Y = 0 (or below).
 *
 * @param {import('./physics.js').PhysicsState}           ps
 * @param {import('./rocketbuilder.js').RocketAssembly}   assembly
 */
function _renormalizeAfterSeparation(ps, assembly, extraDebris = []) {
  if (ps.activeParts.size === 0) return;

  // Find the lowest bottom edge (assembly Y-up, pixels) among active parts.
  let lowestBottom = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    const bottom = placed.y - (def.height ?? 40) / 2;
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
 * Create a new {@link DebrisState} from a set of part instance IDs, extracting
 * their simulation data from the parent {@link PhysicsState}.
 *
 * The fragment inherits the parent rocket's current position, velocity, and
 * angle (stage separation is instantaneous).  All specified parts are removed
 * from `ps.activeParts` and `ps.firingEngines`.
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string[]}                            partIds  Part IDs to transfer.
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {DebrisState}
 */
function _createDebrisFromParts(ps, partIds, assembly) {
  const activeParts     = new Set(partIds);
  const firingEngines   = new Set();
  const fuelStore       = new Map();
  const deployedParts   = new Set();
  const parachuteStates = new Map();
  const legStates       = new Map();
  const heatMap         = new Map();

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
      fuelStore.set(id, ps.fuelStore.get(id));
    }

    // Transfer deployed state (chutes, legs).
    if (ps.deployedParts.has(id)) {
      deployedParts.add(id);
    }

    // Transfer parachute state machine entry so debris chutes keep animating.
    if (ps.parachuteStates?.has(id)) {
      // Deep-copy the entry so the debris state evolves independently.
      const src = ps.parachuteStates.get(id);
      parachuteStates.set(id, { state: src.state, deployTimer: src.deployTimer });
    }

    // Transfer landing leg state machine entry.
    if (ps.legStates?.has(id)) {
      const src = ps.legStates.get(id);
      legStates.set(id, { state: src.state, deployTimer: src.deployTimer });
    }

    // Transfer heat accumulation.
    if (ps.heatMap.has(id)) {
      heatMap.set(id, ps.heatMap.get(id));
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
 *
 * @param {import('./physics.js').PhysicsState}         ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {string[]}
 */
function _findAllCommandModules(ps, assembly) {
  const roots = [];
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
 * @param {DebrisState}                                  debris
 * @param {import('./rocketbuilder.js').RocketAssembly}  assembly
 * @returns {number}  Mass in kilograms (minimum 1 kg to avoid division by zero).
 */
function _debrisMass(debris, assembly) {
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
 * Compute the aerodynamic drag force magnitude (Newtons) for a debris fragment.
 *
 * dragForce = 0.5 × ρ × v² × ΣCdA  (summed over all active parts in fragment)
 *
 * Open parachutes contribute 80× their stowed drag coefficient.
 *
 * @param {DebrisState}                                  debris
 * @param {import('./rocketbuilder.js').RocketAssembly}  assembly
 * @param {number} density  Air density (kg/m³).
 * @param {number} speed    Fragment speed (m/s).
 * @returns {number}  Drag force in Newtons.
 */
/**
 * Return the deployment progress for a parachute on a debris fragment.
 * Mirrors the same helper in physics.js but uses the debris's own parachuteStates.
 * Falls back to the binary deployedParts set for older debris objects.
 *
 * @param {DebrisState} debris
 * @param {string}      instanceId
 * @returns {number}  0 = packed, 0→1 = deploying, 1 = deployed.
 */
function _getDebrisChuteDeployProgress(debris, instanceId) {
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

function _debrisDrag(debris, assembly, density, speed) {
  if (density <= 0 || speed <= 0) return 0;

  let totalCdA = 0;

  for (const id of debris.activeParts) {
    const placed = assembly.parts.get(id);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const props  = def.properties ?? {};
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
 * Return true if the given debris fragment contains at least one SATELLITE part.
 *
 * Used after a decoupler fires to detect when a satellite has been released into
 * free flight so that a SATELLITE_RELEASED mission event can be emitted.
 *
 * @param {DebrisState}                                  debris
 * @param {import('./rocketbuilder.js').RocketAssembly}  assembly
 * @returns {boolean}
 */
function _fragmentContainsSatellite(debris, assembly) {
  for (const partId of debris.activeParts) {
    const placed = assembly.parts.get(partId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (def && def.type === PartType.SATELLITE) return true;
  }
  return false;
}

/**
 * Append a flight event to a FlightState event log.
 *
 * @param {import('./gameState.js').FlightState} flightState
 * @param {object} event  Must include at minimum `type` and `time`.
 */
function _emitEvent(flightState, event) {
  flightState.events.push(event);
}
