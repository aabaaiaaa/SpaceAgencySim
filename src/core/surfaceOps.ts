/**
 * surfaceOps.ts — Surface operations system.
 *
 * Handles all activities performed while landed on a celestial body's surface:
 *   - Plant flag      (one per body, crewed only, milestone bonus)
 *   - Collect sample  (crewed module required, must physically return to lab)
 *   - Deploy instrument (science module with surface instrument, passive science)
 *   - Deploy beacon   (shows on map, allows returning to landing site)
 *
 * Visibility rule: deployed items appear on the map if the body has GPS
 * satellite coverage, or if the body is EARTH (direct line of sight to hub).
 *
 * @module core/surfaceOps
 */

import {
  SurfaceItemType,
  FLAG_MILESTONE_BONUS,
  FLAG_MILESTONE_REP,
  SURFACE_SAMPLE_BASE_SCIENCE,
  SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD,
  GPS_VISIBILITY_THRESHOLD,
  SatelliteType,
  CelestialBody,
  PartType,
} from './constants.ts';
import { earnReward } from './finance.ts';
import { getActiveSatellites } from './satellites.ts';
import { getPartById } from '../data/parts.ts';
import type { GameState, FlightState, SurfaceItem } from './gameState.ts';
import type { PhysicsState, RocketAssembly } from './physics.ts';
import type { PartDef } from '../data/parts.ts';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface SurfaceActionResult {
  success: boolean;
  reason?: string;
  item?: SurfaceItem;
}

interface SurfaceAction {
  id: string;
  label: string;
  enabled: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 1;

/** Generate a unique surface-item ID. */
function _generateId(): string {
  return `surface-${Date.now()}-${_nextId++}`;
}

/**
 * Get all surface items on a specific body.
 */
export function getSurfaceItemsAtBody(state: GameState, bodyId: string): SurfaceItem[] {
  return (state.surfaceItems ?? []).filter((i) => i.bodyId === bodyId);
}

/**
 * Check if a flag has already been planted on a body.
 */
export function hasFlag(state: GameState, bodyId: string): boolean {
  return (state.surfaceItems ?? []).some(
    (i) => i.type === SurfaceItemType.FLAG && i.bodyId === bodyId,
  );
}

/**
 * Check if the current flight has crew aboard (command module with crewIds).
 */
export function isCrewedFlight(flightState: FlightState): boolean {
  return !!(flightState.crewIds && flightState.crewIds.length > 0);
}

/**
 * Check if the rocket assembly contains a science module (SERVICE_MODULE).
 */
export function hasScienceModule(assembly: RocketAssembly, ps: PhysicsState): boolean {
  if (!assembly || !ps) return false;
  for (const [idx, placed] of assembly.parts.entries()) {
    if (!ps.activeParts.has(idx)) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.SERVICE_MODULE) {
      return true;
    }
  }
  return false;
}

/**
 * Check whether surface items are visible on the map for a given body.
 *
 * Visibility requires either:
 *   - The body is EARTH (direct line of sight to agency hub)
 *   - GPS satellite(s) in orbit around that body
 */
export function areSurfaceItemsVisible(state: GameState, bodyId: string): boolean {
  if (bodyId === CelestialBody.EARTH) return true;

  const gpsSats = getActiveSatellites(state).filter(
    (s) => s.satelliteType === SatelliteType.GPS && s.bodyId === bodyId,
  );
  return gpsSats.length >= GPS_VISIBILITY_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Surface Actions
// ---------------------------------------------------------------------------

/**
 * Plant a flag on the current body.
 *
 * Requirements:
 *   - Crewed flight
 *   - Landed on a body
 *   - No flag already planted on this body
 *
 * Awards milestone bonus (cash + reputation) on first flag per body.
 */
export function plantFlag(
  state: GameState,
  flightState: FlightState,
  ps: PhysicsState,
): SurfaceActionResult {
  if (!ps || !ps.landed) {
    return { success: false, reason: 'Must be landed on a surface.' };
  }
  if (!isCrewedFlight(flightState)) {
    return { success: false, reason: 'Crewed flight required to plant a flag.' };
  }
  const bodyId = flightState.bodyId;
  if (hasFlag(state, bodyId)) {
    return { success: false, reason: 'Flag already planted on this body.' };
  }

  if (!state.surfaceItems) state.surfaceItems = [];

  const item: SurfaceItem = {
    id: _generateId(),
    type: SurfaceItemType.FLAG,
    bodyId,
    posX: ps.posX,
    deployedPeriod: state.currentPeriod,
    label: `${state.agencyName || 'Agency'} — First on ${bodyId}`,
  };

  state.surfaceItems.push(item);

  // Award milestone bonus.
  earnReward(state, FLAG_MILESTONE_BONUS);
  state.reputation = Math.min(100, (state.reputation ?? 50) + FLAG_MILESTONE_REP);

  // Log flight event.
  flightState.events.push({
    time: flightState.timeElapsed,
    type: 'FLAG_PLANTED',
    description: `Planted flag on ${bodyId} — milestone bonus $${FLAG_MILESTONE_BONUS.toLocaleString()}!`,
  });

  return { success: true, item };
}

/**
 * Collect a surface sample.
 *
 * Requirements:
 *   - Crewed flight
 *   - Landed on a body
 *
 * The sample is stored but NOT yet returned — it must be physically
 * brought back to the R&D lab (safe landing on Earth) for science yield.
 */
export function collectSurfaceSample(
  state: GameState,
  flightState: FlightState,
  ps: PhysicsState,
): SurfaceActionResult {
  if (!ps || !ps.landed) {
    return { success: false, reason: 'Must be landed on a surface.' };
  }
  if (!isCrewedFlight(flightState)) {
    return { success: false, reason: 'Crewed flight required to collect samples.' };
  }

  if (!state.surfaceItems) state.surfaceItems = [];
  const bodyId = flightState.bodyId;

  const item: SurfaceItem = {
    id: _generateId(),
    type: SurfaceItemType.SURFACE_SAMPLE,
    bodyId,
    posX: ps.posX,
    deployedPeriod: state.currentPeriod,
    label: `Surface sample — ${bodyId}`,
    collected: false,
  };

  state.surfaceItems.push(item);

  flightState.events.push({
    time: flightState.timeElapsed,
    type: 'SAMPLE_COLLECTED',
    description: `Collected surface sample on ${bodyId}. Must return to lab for analysis.`,
  });

  return { success: true, item };
}

/**
 * Deploy a surface science instrument.
 *
 * Requirements:
 *   - Landed on a body
 *   - Rocket has a surviving science module (SERVICE_MODULE)
 *
 * Generates passive science per period while deployed.
 */
export function deploySurfaceInstrument(
  state: GameState,
  flightState: FlightState,
  ps: PhysicsState,
  assembly: RocketAssembly,
): SurfaceActionResult {
  if (!ps || !ps.landed) {
    return { success: false, reason: 'Must be landed on a surface.' };
  }
  if (!hasScienceModule(assembly, ps)) {
    return { success: false, reason: 'Requires a surviving science module on the rocket.' };
  }

  if (!state.surfaceItems) state.surfaceItems = [];
  const bodyId = flightState.bodyId;

  const item: SurfaceItem = {
    id: _generateId(),
    type: SurfaceItemType.SURFACE_INSTRUMENT,
    bodyId,
    posX: ps.posX,
    deployedPeriod: state.currentPeriod,
    label: `Science station — ${bodyId}`,
  };

  state.surfaceItems.push(item);

  flightState.events.push({
    time: flightState.timeElapsed,
    type: 'INSTRUMENT_DEPLOYED',
    description: `Deployed surface instrument on ${bodyId}. +${SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD} science/period.`,
  });

  return { success: true, item };
}

/**
 * Deploy a landing-site beacon.
 *
 * Requirements:
 *   - Landed on a body
 *
 * Marks the landing site on the map so the player can return.
 */
export function deployBeacon(
  state: GameState,
  flightState: FlightState,
  ps: PhysicsState,
  beaconName?: string,
): SurfaceActionResult {
  if (!ps || !ps.landed) {
    return { success: false, reason: 'Must be landed on a surface.' };
  }

  if (!state.surfaceItems) state.surfaceItems = [];
  const bodyId = flightState.bodyId;

  const item: SurfaceItem = {
    id: _generateId(),
    type: SurfaceItemType.BEACON,
    bodyId,
    posX: ps.posX,
    deployedPeriod: state.currentPeriod,
    label: beaconName || `Landing site — ${bodyId}`,
  };

  state.surfaceItems.push(item);

  flightState.events.push({
    time: flightState.timeElapsed,
    type: 'BEACON_DEPLOYED',
    description: `Deployed beacon "${item.label}" on ${bodyId}.`,
  });

  return { success: true, item };
}

// ---------------------------------------------------------------------------
// Per-Period Processing
// ---------------------------------------------------------------------------

/**
 * Process surface operations for a new period.
 *
 * Awards passive science from deployed surface instruments.
 */
export function processSurfaceOps(state: GameState): { scienceEarned: number } {
  const items = state.surfaceItems ?? [];
  let scienceEarned = 0;

  for (const item of items) {
    if (item.type === SurfaceItemType.SURFACE_INSTRUMENT) {
      scienceEarned += SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD;
    }
  }

  state.sciencePoints = (state.sciencePoints ?? 0) + scienceEarned;
  return { scienceEarned };
}

// ---------------------------------------------------------------------------
// Sample Return Processing
// ---------------------------------------------------------------------------

/**
 * Process surface sample returns after a safe landing on Earth.
 *
 * Any uncollected samples collected during flights that ended with a
 * safe Earth landing are marked as collected, and science is awarded.
 */
export function processSampleReturns(
  state: GameState,
  landingBodyId: string,
): { samplesReturned: number; scienceEarned: number } {
  if (landingBodyId !== CelestialBody.EARTH) {
    return { samplesReturned: 0, scienceEarned: 0 };
  }

  const items = state.surfaceItems ?? [];
  let samplesReturned = 0;
  let scienceEarned = 0;

  for (const item of items) {
    if (item.type === SurfaceItemType.SURFACE_SAMPLE && !item.collected) {
      item.collected = true;
      samplesReturned++;
      scienceEarned += SURFACE_SAMPLE_BASE_SCIENCE;
    }
  }

  state.sciencePoints = (state.sciencePoints ?? 0) + scienceEarned;
  return { samplesReturned, scienceEarned };
}

// ---------------------------------------------------------------------------
// Available Actions Query
// ---------------------------------------------------------------------------

/**
 * Get the list of surface actions available to the player in the current state.
 */
export function getAvailableSurfaceActions(
  state: GameState,
  flightState: FlightState,
  ps: PhysicsState,
  assembly: RocketAssembly,
): SurfaceAction[] {
  if (!ps || !ps.landed || !flightState) return [];

  const bodyId = flightState.bodyId;
  const crewed = isCrewedFlight(flightState);
  const hasSciMod = hasScienceModule(assembly, ps);
  const flagPlanted = hasFlag(state, bodyId);

  const actions: SurfaceAction[] = [];

  // Plant Flag
  actions.push({
    id: 'plant-flag',
    label: 'Plant Flag',
    enabled: crewed && !flagPlanted,
    reason: !crewed ? 'Crew required' : flagPlanted ? 'Already planted' : undefined,
  });

  // Collect Sample
  actions.push({
    id: 'collect-sample',
    label: 'Collect Sample',
    enabled: crewed,
    reason: !crewed ? 'Crew required' : undefined,
  });

  // Deploy Instrument
  actions.push({
    id: 'deploy-instrument',
    label: 'Deploy Instrument',
    enabled: hasSciMod,
    reason: !hasSciMod ? 'Science module required' : undefined,
  });

  // Deploy Beacon
  actions.push({
    id: 'deploy-beacon',
    label: 'Deploy Beacon',
    enabled: true,
  });

  return actions;
}
