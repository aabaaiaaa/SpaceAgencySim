/**
 * fuelsystem.ts — Segment-aware fuel system and engine thrust management.
 *
 * Each liquid engine draws fuel only from tanks in the same rocket
 * segment -- the sub-graph reachable from the engine without crossing a
 * decoupler boundary.  SRBs carry integral solid propellant and burn at a
 * fixed rate regardless of throttle.
 *
 * FUEL SEGMENTS
 *   A segment is the connected sub-graph of parts that share structural
 *   attachment without a decoupler between them.  When a decoupler fires,
 *   its two neighbours become members of different segments and can no
 *   longer share fuel.
 *
 *   Traversal rule (getConnectedTanks):
 *     Start at the engine.  BFS across all part connections.  Never cross
 *     a DECOUPLER, STACK_DECOUPLER, or RADIAL_DECOUPLER node.  Collect all
 *     FUEL_TANK nodes encountered.
 *
 * FUEL CONSUMPTION FORMULA
 *   Liquid engine:  mdot = (thrust_effective * throttle) / (Isp * g0)   kg/s
 *   SRB:            mdot = thrust_full / (Isp * g0)   kg/s  (or explicit burnRate)
 *
 * PART MASS TRACKING
 *   Tank/SRB part mass is tracked live via the PhysicsState.fuelStore map.
 *   The physics engine reads fuelStore directly when computing total rocket
 *   mass, so mass updates happen automatically as fuel drains.
 *
 * DETACHED PARTS
 *   When a decoupler fires, jettisoned parts are removed from
 *   PhysicsState.activeParts.  They retain their fuelStore entries but are
 *   ignored by getConnectedTanks (activeParts filter) and excluded from
 *   thrust calculations by the physics engine.
 *
 * PUBLIC API
 *   getConnectedTanks(engineInstanceId, assembly, activeParts) -> string[]
 *   computeEngineFlowRate(def, throttle, density)              -> number
 *   tickFuelSystem(ps, assembly, dt, density)                  -> void
 *
 * @module fuelsystem
 */

import { getPartById } from '../data/parts.ts';
import { PartType }    from './constants.ts';
import { SEA_LEVEL_DENSITY } from './atmosphere.ts';

import type { RocketAssembly } from './physics.ts';
import type { PartDef } from '../data/parts.ts';

/**
 * Structural subset of PhysicsState that tickFuelSystem actually reads/writes.
 * Both PhysicsState and DebrisState (from staging.ts) satisfy this interface.
 */
export interface FuelSystemState {
  firingEngines: Set<string>;
  activeParts: Set<string>;
  fuelStore: Map<string, number>;
  throttle: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard gravity (m/s^2). */
const G0: number = 9.81;

/**
 * Part types that form fuel-segment boundaries.
 * The BFS traversal in getConnectedTanks will NOT cross these node types.
 */
const DECOUPLER_TYPES: ReadonlySet<string> = Object.freeze(new Set([
  PartType.DECOUPLER,
  PartType.STACK_DECOUPLER,
  PartType.RADIAL_DECOUPLER,
]));

// ---------------------------------------------------------------------------
// Public API -- getConnectedTanks
// ---------------------------------------------------------------------------

/**
 * Return all FUEL_TANK instance IDs reachable from an engine without
 * crossing a decoupler boundary.
 *
 * The traversal:
 *   1. Starts at `engineInstanceId`.
 *   2. Expands to all directly connected neighbours.
 *   3. Skips nodes absent from `activeParts` (jettisoned parts).
 *   4. Stops expanding from a node when that node is a decoupler type
 *      (the decoupler itself is not added to the result; nothing beyond
 *      it is visited).
 *   5. Collects every FUEL_TANK node encountered.
 *
 * For SRBs, this function is not needed -- they carry integral fuel stored
 * under their own instanceId in PhysicsState.fuelStore.
 */
export function getConnectedTanks(
  engineInstanceId: string,
  assembly: RocketAssembly,
  activeParts: Set<string>,
): string[] {
  const visited = new Set<string>();
  const tanks: string[] = [];
  const queue: string[] = [engineInstanceId];
  visited.add(engineInstanceId);

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Ignore jettisoned parts.
    if (!activeParts.has(current)) continue;

    const placed = assembly.parts.get(current);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;

    // Collect fuel tanks (skip the engine itself).
    if (current !== engineInstanceId && def.type === PartType.FUEL_TANK) {
      tanks.push(current);
    }

    // Decouplers form hard segment boundaries -- do not traverse through them.
    // The decoupler node itself was already visited; we just don't expand it.
    if (current !== engineInstanceId && DECOUPLER_TYPES.has(def.type)) {
      continue;
    }

    // Expand to all neighbours via the connection list.
    for (const conn of assembly.connections) {
      let neighbor: string | null = null;
      if (conn.fromInstanceId === current) {
        neighbor = conn.toInstanceId;
      } else if (conn.toInstanceId === current) {
        neighbor = conn.fromInstanceId;
      }
      if (neighbor !== null && !visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return tanks;
}

// ---------------------------------------------------------------------------
// Public API -- computeEngineFlowRate
// ---------------------------------------------------------------------------

/**
 * Compute the propellant mass-flow rate (kg/s) for a single engine.
 *
 * Formula:  mdot = F_effective / (Isp * g0)
 *
 * Thrust and Isp are linearly interpolated between sea-level and vacuum
 * values using the current air-density ratio:
 *   value = ratio * seaLevel + (1 - ratio) * vacuum
 * where ratio = clamp(density / SEA_LEVEL_DENSITY, 0, 1).
 *
 * SRB rules:
 *   - If the part definition has an explicit `burnRate` property (kg/s),
 *     that value is returned as-is (fixed manufacturer-specified burn rate).
 *   - Otherwise the rate is derived from the thrust/Isp formula at full
 *     throttle (throttle argument is ignored for SRBs).
 */
export function computeEngineFlowRate(
  def: PartDef,
  throttle: number,
  density: number,
): number {
  const props        = def.properties ?? {};
  const isSRB        = def.type === PartType.SOLID_ROCKET_BOOSTER;
  const densityRatio = Math.max(0, Math.min(1, density / SEA_LEVEL_DENSITY));

  if (isSRB) {
    // Explicit fixed burn rate takes highest priority.
    if (props.burnRate != null) {
      return Math.max(0, props.burnRate as number);
    }

    // Derive from thrust/Isp at full throttle.
    const thrustSL  = ((props.thrust ?? 0) as number) * 1_000; // kN -> N
    const thrustVac = ((props.thrustVac ?? props.thrust ?? 0) as number) * 1_000;
    const thrustN   = densityRatio * thrustSL + (1 - densityRatio) * thrustVac;
    const ispSL     = (props.isp ?? 200) as number;
    const ispVac    = (props.ispVac ?? props.isp ?? 200) as number;
    const isp       = densityRatio * ispSL + (1 - densityRatio) * ispVac;
    return isp > 0 ? thrustN / (isp * G0) : 0;
  }

  // Liquid engine.
  const thrustSL  = ((props.thrust ?? 0) as number) * 1_000;
  const thrustVac = ((props.thrustVac ?? props.thrust ?? 0) as number) * 1_000;
  const thrustN   = densityRatio * thrustSL + (1 - densityRatio) * thrustVac;
  const ispSL     = (props.isp ?? 300) as number;
  const ispVac    = (props.ispVac ?? props.isp ?? 300) as number;
  const isp       = densityRatio * ispSL + (1 - densityRatio) * ispVac;

  const effectiveThrustN = thrustN * Math.max(0, Math.min(1, throttle));
  return isp > 0 ? effectiveThrustN / (isp * G0) : 0;
}

// ---------------------------------------------------------------------------
// Public API -- tickFuelSystem
// ---------------------------------------------------------------------------

/**
 * Advance the fuel system by one fixed-length timestep.
 *
 * Called once per physics integration step, after thrust has been computed
 * but before the next step begins.
 *
 * For each engine in `ps.firingEngines`:
 *
 *   SRBs --
 *     Drain their own integral fuelStore entry at the computed burn rate.
 *     When the integral fuel reaches 0, the SRB is removed from
 *     `ps.firingEngines` immediately so the next tick sees 0 thrust.
 *
 *   Liquid engines --
 *     Collect all FUEL_TANK parts connected to the engine in the same
 *     segment (via getConnectedTanks).  Drain fuel evenly across all tanks
 *     that still have propellant, so they empty at the same rate.
 *     If all connected tanks are exhausted, the engine flames out (removed
 *     from `ps.firingEngines`).
 *
 * Part mass updates automatically:
 *   The physics engine's mass computation reads `ps.fuelStore` directly
 *   (`partMass = dryMass + fuelStore.get(instanceId)`), so no extra work
 *   is needed here -- fuel drain is reflected in total mass on the very
 *   next integration step.
 *
 * Detached-part invariant:
 *   Parts absent from `ps.activeParts` are invisible to getConnectedTanks
 *   and are cleaned from `ps.firingEngines` at the start of this function.
 *   Their fuelStore entries are preserved (they retain whatever fuel they
 *   had when jettisoned) but are never drained or counted toward thrust.
 */
export function tickFuelSystem(
  ps: FuelSystemState,
  assembly: RocketAssembly,
  dt: number,
  density: number,
): void {
  const toRemove: string[] = [];

  for (const engineId of ps.firingEngines) {

    // Jettisoned engine -- clean up the set.
    if (!ps.activeParts.has(engineId)) {
      toRemove.push(engineId);
      continue;
    }

    const placed = assembly.parts.get(engineId);
    if (!placed) { toRemove.push(engineId); continue; }
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def)  { toRemove.push(engineId); continue; }

    const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;

    if (isSRB) {
      // -------------------------------------------------------------------
      // SRB -- drain integral fuel; fixed burn rate, ignores throttle.
      // -------------------------------------------------------------------
      const fuelLeft = ps.fuelStore.get(engineId) ?? 0;
      if (fuelLeft <= 0) {
        toRemove.push(engineId);
        continue;
      }

      const flowRate  = computeEngineFlowRate(def, 1.0, density);
      const remaining = Math.max(0, fuelLeft - flowRate * dt);
      ps.fuelStore.set(engineId, remaining);

      if (remaining <= 0) {
        toRemove.push(engineId);
      }

    } else {
      // -------------------------------------------------------------------
      // Liquid engine -- drain evenly from connected tanks in same segment.
      // -------------------------------------------------------------------
      const connected   = getConnectedTanks(engineId, assembly, ps.activeParts);
      const availTanks  = connected.filter(
        (id) => (ps.fuelStore.get(id) ?? 0) > 0,
      );

      if (availTanks.length === 0) {
        // No propellant available -- flame out.
        toRemove.push(engineId);
        continue;
      }

      const flowRate      = computeEngineFlowRate(def, ps.throttle, density);
      const totalConsumed = flowRate * dt;

      // Sum of fuel remaining across all tanks with propellant.
      const totalAvail = availTanks.reduce(
        (sum, id) => sum + (ps.fuelStore.get(id) ?? 0), 0,
      );

      if (totalAvail <= 0) {
        toRemove.push(engineId);
        continue;
      }

      // Drain proportionally so all connected tanks reach empty together.
      // drainFraction is the fraction to remove from each tank's current load.
      const drainFraction = Math.min(1, totalConsumed / totalAvail);
      for (const tankId of availTanks) {
        const current = ps.fuelStore.get(tankId) ?? 0;
        ps.fuelStore.set(tankId, Math.max(0, current * (1 - drainFraction)));
      }
    }
  }

  // Apply all pending engine removals at once.
  for (const id of toRemove) {
    ps.firingEngines.delete(id);
  }
}
