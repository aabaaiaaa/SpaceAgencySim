// ---------------------------------------------------------------------------
// Flight-state sync + delta-V estimation + event emission. Extracted from
// physics.ts.
// ---------------------------------------------------------------------------

import { getPartById } from '../../data/parts.ts';
import { getBiomeId } from '../biomes.ts';
import { recalcPowerState } from '../power.ts';
import type { FlightEvent, FlightState } from '../gameState.ts';
import { G0 } from './gravity.ts';
import type { PartDef, PhysicsState, RocketAssembly } from './types.ts';

/**
 * Append a flight event to the FlightState event log.
 */
export function _emitEvent(flightState: FlightState, event: { time: number; type: string; [key: string]: unknown }): void {
  const withDesc: FlightEvent = { description: '', ...event };
  flightState.events.push(withDesc);
}

/**
 * Estimate remaining deltaV using the Tsiolkovsky rocket equation.
 */
export function _estimateDeltaV(ps: PhysicsState, assembly: RocketAssembly): number {
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

/**
 * Copy physics state scalars into the persistent FlightState that the rest of
 * the game (mission objectives, UI, save/load) reads.
 *
 * Also recomputes `deltaVRemaining` using the simplified Tsiolkovsky equation:
 *   deltaV ~= avgIsp × g0 × ln(wetMass / dryMass)
 */
export function _syncFlightState(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  flightState.altitude = Math.max(0, ps.posY);
  flightState.velocity = Math.hypot(ps.velX, ps.velY);
  flightState.horizontalVelocity = Math.abs(ps.velX);

  if (flightState.altitude > (flightState.maxAltitude ?? 0)) {
    flightState.maxAltitude = flightState.altitude;
  }
  if (flightState.velocity > (flightState.maxVelocity ?? 0)) {
    flightState.maxVelocity = flightState.velocity;
  }

  const newBiome: string | null = getBiomeId(flightState.altitude, 'EARTH');
  if (newBiome && newBiome !== flightState.currentBiome) {
    const prevBiome: string | null = flightState.currentBiome;
    flightState.currentBiome = newBiome;
    if (!flightState.biomesVisited.includes(newBiome)) {
      flightState.biomesVisited.push(newBiome);
    }
    if (prevBiome) {
      flightState.events.push({
        type:        'BIOME_CHANGE',
        time:        flightState.timeElapsed,
        fromBiome:   prevBiome,
        toBiome:     newBiome,
        altitude:    flightState.altitude,
        description: `Entered ${newBiome.replace(/_/g, ' ').toLowerCase()} biome at ${flightState.altitude >= 1000 ? `${(flightState.altitude / 1000).toFixed(0)} km` : `${flightState.altitude.toFixed(0)} m`}.`,
      });

      if (ps._malfunctionCheckPending !== true) {
        ps._malfunctionCheckPending = true;
        ps._malfunctionCheckTimer = 0.5 + Math.random() * 1.5;
      }
    }
  }

  let totalFuel = 0;
  for (const [instanceId, fuel] of ps.fuelStore) {
    if (ps.activeParts.has(instanceId)) totalFuel += fuel;
  }
  flightState.fuelRemaining = totalFuel;

  if (ps.powerState) {
    const prevCap: number = ps.powerState.batteryCapacity;
    const prevArea: number = ps.powerState.solarPanelArea;
    recalcPowerState(ps.powerState, assembly, ps.activeParts);
    if (ps.powerState.batteryCapacity !== prevCap || ps.powerState.solarPanelArea !== prevArea) {
      flightState.powerState = ps.powerState;
    }
  }

  flightState.deltaVRemaining = _estimateDeltaV(ps, assembly);
}
