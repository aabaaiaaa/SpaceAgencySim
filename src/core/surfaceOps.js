/**
 * surfaceOps.js — Surface operations system.
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
} from './constants.js';
import { earnReward } from './finance.js';
import { getActiveSatellites } from './satellites.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 1;

/** Generate a unique surface-item ID. */
function _generateId() {
  return `surface-${Date.now()}-${_nextId++}`;
}

/**
 * Get all surface items on a specific body.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} bodyId
 * @returns {import('./gameState.js').SurfaceItem[]}
 */
export function getSurfaceItemsAtBody(state, bodyId) {
  return (state.surfaceItems ?? []).filter(i => i.bodyId === bodyId);
}

/**
 * Check if a flag has already been planted on a body.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} bodyId
 * @returns {boolean}
 */
export function hasFlag(state, bodyId) {
  return (state.surfaceItems ?? []).some(
    i => i.type === SurfaceItemType.FLAG && i.bodyId === bodyId,
  );
}

/**
 * Check if the current flight has crew aboard (command module with crewIds).
 *
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {boolean}
 */
export function isCrewedFlight(flightState) {
  return flightState.crewIds && flightState.crewIds.length > 0;
}

/**
 * Check if the rocket assembly contains a science module (SERVICE_MODULE).
 *
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @param {import('../core/physics.js').PhysicsState} ps
 * @returns {boolean}
 */
export function hasScienceModule(assembly, ps) {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} bodyId
 * @returns {boolean}
 */
export function areSurfaceItemsVisible(state, bodyId) {
  if (bodyId === CelestialBody.EARTH) return true;

  const gpsSats = getActiveSatellites(state).filter(
    s => s.satelliteType === SatelliteType.GPS && s.bodyId === bodyId,
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('../core/physics.js').PhysicsState} ps
 * @returns {{ success: boolean, reason?: string, item?: import('./gameState.js').SurfaceItem }}
 */
export function plantFlag(state, flightState, ps) {
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

  const item = {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('../core/physics.js').PhysicsState} ps
 * @returns {{ success: boolean, reason?: string, item?: import('./gameState.js').SurfaceItem }}
 */
export function collectSurfaceSample(state, flightState, ps) {
  if (!ps || !ps.landed) {
    return { success: false, reason: 'Must be landed on a surface.' };
  }
  if (!isCrewedFlight(flightState)) {
    return { success: false, reason: 'Crewed flight required to collect samples.' };
  }

  if (!state.surfaceItems) state.surfaceItems = [];
  const bodyId = flightState.bodyId;

  const item = {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('../core/physics.js').PhysicsState} ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {{ success: boolean, reason?: string, item?: import('./gameState.js').SurfaceItem }}
 */
export function deploySurfaceInstrument(state, flightState, ps, assembly) {
  if (!ps || !ps.landed) {
    return { success: false, reason: 'Must be landed on a surface.' };
  }
  if (!hasScienceModule(assembly, ps)) {
    return { success: false, reason: 'Requires a surviving science module on the rocket.' };
  }

  if (!state.surfaceItems) state.surfaceItems = [];
  const bodyId = flightState.bodyId;

  const item = {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('../core/physics.js').PhysicsState} ps
 * @param {string} [beaconName]  Optional custom name for the beacon.
 * @returns {{ success: boolean, reason?: string, item?: import('./gameState.js').SurfaceItem }}
 */
export function deployBeacon(state, flightState, ps, beaconName) {
  if (!ps || !ps.landed) {
    return { success: false, reason: 'Must be landed on a surface.' };
  }

  if (!state.surfaceItems) state.surfaceItems = [];
  const bodyId = flightState.bodyId;

  const item = {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ scienceEarned: number }}
 */
export function processSurfaceOps(state) {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} landingBodyId  Body where the craft landed.
 * @returns {{ samplesReturned: number, scienceEarned: number }}
 */
export function processSampleReturns(state, landingBodyId) {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {import('../core/physics.js').PhysicsState} ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {Array<{ id: string, label: string, enabled: boolean, reason?: string }>}
 */
export function getAvailableSurfaceActions(state, flightState, ps, assembly) {
  if (!ps || !ps.landed || !flightState) return [];

  const bodyId = flightState.bodyId;
  const crewed = isCrewedFlight(flightState);
  const hasSciMod = hasScienceModule(assembly, ps);
  const flagPlanted = hasFlag(state, bodyId);

  const actions = [];

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
