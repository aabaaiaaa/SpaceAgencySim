/**
 * satellites.js — Satellite network management system.
 *
 * Manages the deployment, tracking, degradation, maintenance, and benefit
 * calculation for the satellite network.
 *
 * SATELLITE TYPES
 * ===============
 *   Communication — enables science data transmission from orbit.
 *   Weather       — reduces weather-skip cost + improves forecast.
 *   Science       — generates passive science points per period.
 *   GPS/Navigation — widens landing threshold, recovery profitability.
 *   Relay         — extends deep-space comms range.
 *
 * CONSTELLATION BONUS
 * ===================
 *   3+ operational satellites of the same type = 2× benefit (simple count).
 *
 * DEGRADATION
 * ===========
 *   Each satellite loses health per period.  Below the degraded threshold,
 *   benefits are halved.  At 0, the satellite is decommissioned.
 *   Player can enable auto-maintenance (pay per period) or fly manual
 *   maintenance missions.
 *
 * @module core/satellites
 */

import {
  SatelliteType,
  SATELLITE_VALID_BANDS,
  CONSTELLATION_THRESHOLD,
  CONSTELLATION_MULTIPLIER,
  SATELLITE_BENEFITS,
  SATELLITE_DEGRADATION_PER_PERIOD,
  SATELLITE_DEGRADED_THRESHOLD,
  SATELLITE_AUTO_MAINTENANCE_COST,
  SATELLITE_AUTO_MAINTENANCE_HEAL,
  SATELLITE_OPS_TIER_CAPS,
  OrbitalObjectType,
  FacilityId,
  BODY_RADIUS,
} from './constants.js';
import { createOrbitalObject, getAltitudeBandId, getMinOrbitAltitude } from './orbit.js';
import { hasFacility, getFacilityTier } from './construction.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/**
 * Deploy a satellite into the network.
 *
 * Creates an OrbitalObject for map tracking and a SatelliteRecord for
 * network benefit tracking.  Requires the Satellite Ops facility.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {{
 *   partId: string,
 *   bodyId: string,
 *   elements: import('./orbit.js').OrbitalElements,
 *   name?: string,
 *   altitude: number,
 * }} opts
 * @returns {{ success: boolean, reason?: string, satelliteId?: string }}
 */
export function deploySatellite(state, { partId, bodyId, elements, name, altitude }) {
  // Require Satellite Ops facility.
  if (!hasFacility(state, FacilityId.SATELLITE_OPS)) {
    return { success: false, reason: 'Satellite Operations Centre not built.' };
  }

  // Check capacity.
  const tier = getFacilityTier(state, FacilityId.SATELLITE_OPS);
  const cap = SATELLITE_OPS_TIER_CAPS[tier] ?? 6;
  const activeSats = state.satelliteNetwork.satellites.filter(s => s.health > 0);
  if (activeSats.length >= cap) {
    return { success: false, reason: `Satellite capacity reached (${cap}). Upgrade Satellite Ops for more slots.` };
  }

  // Resolve part definition.
  const partDef = getPartById(partId);
  if (!partDef) {
    return { success: false, reason: `Unknown part: ${partId}` };
  }

  const satelliteType = partDef.properties?.satelliteType ?? 'GENERIC';

  // Determine altitude band.
  const bandId = getAltitudeBandId(altitude, bodyId);
  if (!bandId) {
    return { success: false, reason: 'Satellite is not in a valid altitude band.' };
  }

  // Validate band for typed satellites.
  if (satelliteType !== 'GENERIC') {
    const validBands = SATELLITE_VALID_BANDS[satelliteType];
    if (validBands && !validBands.includes(bandId)) {
      return {
        success: false,
        reason: `${satelliteType} satellites cannot operate in ${bandId}. Valid bands: ${validBands.join(', ')}.`,
      };
    }
  }

  // Generate IDs.
  const satId = `sat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orbObjId = `orb-${satId}`;

  // Create orbital object for map tracking.
  const satName = name ?? `${partDef.name} ${state.satelliteNetwork.satellites.length + 1}`;
  const orbObj = createOrbitalObject({
    id: orbObjId,
    bodyId,
    type: OrbitalObjectType.SATELLITE,
    name: satName,
    elements,
  });
  state.orbitalObjects.push(orbObj);

  // Create satellite record.
  /** @type {import('./gameState.js').SatelliteRecord} */
  const record = {
    id: satId,
    orbitalObjectId: orbObjId,
    satelliteType,
    partId,
    bodyId,
    bandId,
    health: 100,
    autoMaintain: false,
    deployedPeriod: state.currentPeriod,
  };
  state.satelliteNetwork.satellites.push(record);

  return { success: true, satelliteId: satId };
}

/**
 * Auto-deploy satellites released during a flight.
 *
 * Scans SATELLITE_RELEASED events in the flight log. For each, if the craft
 * was in orbit at that time (has orbital elements and is above minimum orbit
 * altitude), deploys the satellite into the network.
 *
 * Called from `processFlightReturn()`.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState|null} flightState
 * @returns {Array<{satelliteId: string, satelliteType: string}>}
 */
export function deploySatellitesFromFlight(state, flightState) {
  if (!flightState) return [];
  if (!state.satelliteNetwork) {
    state.satelliteNetwork = { satellites: [] };
  }

  const deployed = [];
  const releaseEvents = (flightState.events ?? []).filter(
    (e) => e.type === 'SATELLITE_RELEASED',
  );

  for (const event of releaseEvents) {
    const partId = event.partId ?? 'satellite-mk1';
    const altitude = event.altitude ?? 0;
    const bodyId = flightState.bodyId ?? 'EARTH';

    // Only deploy if released at orbital altitude.
    const minAlt = getMinOrbitAltitude(bodyId);
    if (altitude < minAlt) continue;

    // Use the flight's orbital elements if available, or synthesise circular ones.
    const elements = flightState.orbitalElements
      ? { ...flightState.orbitalElements }
      : _syntheticCircularElements(altitude, bodyId, flightState.timeElapsed ?? 0);

    if (!elements) continue;

    const result = deploySatellite(state, {
      partId,
      bodyId,
      elements,
      altitude,
    });

    if (result.success) {
      const partDef = getPartById(partId);
      const satType = partDef?.properties?.satelliteType ?? 'GENERIC';
      deployed.push({ satelliteId: result.satelliteId, satelliteType: satType });
    }
  }

  return deployed;
}

/**
 * Create synthetic circular orbital elements for a satellite at a given altitude.
 * Used when the flight's orbital elements aren't available.
 *
 * @param {number} altitude  Metres above surface.
 * @param {string} bodyId
 * @param {number} epoch
 * @returns {import('./orbit.js').OrbitalElements}
 */
function _syntheticCircularElements(altitude, bodyId, epoch) {
  const R = BODY_RADIUS[bodyId];
  if (!R) return null;
  return {
    semiMajorAxis: R + altitude,
    eccentricity: 0,
    argPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get all active (health > 0) satellite records.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('./gameState.js').SatelliteRecord[]}
 */
export function getActiveSatellites(state) {
  return (state.satelliteNetwork?.satellites ?? []).filter(s => s.health > 0);
}

/**
 * Get active satellites of a specific type.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} satelliteType  SatelliteType enum value.
 * @returns {import('./gameState.js').SatelliteRecord[]}
 */
export function getSatellitesByType(state, satelliteType) {
  return getActiveSatellites(state).filter(s => s.satelliteType === satelliteType);
}

/**
 * Count operational (health > 0) satellites of a given type.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} satelliteType
 * @returns {number}
 */
export function countSatellitesByType(state, satelliteType) {
  return getSatellitesByType(state, satelliteType).length;
}

/**
 * Check if the constellation bonus is active for a satellite type.
 * Requires CONSTELLATION_THRESHOLD (3) or more operational satellites.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} satelliteType
 * @returns {boolean}
 */
export function hasConstellationBonus(state, satelliteType) {
  return countSatellitesByType(state, satelliteType) >= CONSTELLATION_THRESHOLD;
}

/**
 * Get the effective benefit multiplier for a satellite type.
 *
 * Takes into account:
 *   - Number of healthy satellites of this type (must be ≥ 1).
 *   - Constellation bonus (3+ = 2×).
 *   - Degraded satellites (health < threshold) contribute 0.5× each.
 *
 * Returns 0 if no operational satellites of that type exist.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} satelliteType
 * @returns {number}  Effective multiplier (0, 1, or 2 with constellation).
 */
export function getBenefitMultiplier(state, satelliteType) {
  const sats = getSatellitesByType(state, satelliteType);
  if (sats.length === 0) return 0;

  // Base is 1 if any active satellite exists.
  let multiplier = 1;

  // Constellation bonus: 3+ same type = 2×.
  if (sats.length >= CONSTELLATION_THRESHOLD) {
    multiplier = CONSTELLATION_MULTIPLIER;
  }

  return multiplier;
}

/**
 * Compute the aggregate network benefits across all satellite types.
 *
 * Returns an object with all benefit keys and their effective values.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{
 *   transmitYieldBonus: number,
 *   weatherSkipDiscount: number,
 *   forecastAccuracy: number,
 *   sciencePerPeriod: number,
 *   landingThresholdBonus: number,
 *   recoveryBonus: number,
 *   deepSpaceComms: boolean,
 * }}
 */
export function getNetworkBenefits(state) {
  const result = {
    transmitYieldBonus: 0,
    weatherSkipDiscount: 0,
    forecastAccuracy: 0,
    sciencePerPeriod: 0,
    landingThresholdBonus: 0,
    recoveryBonus: 0,
    deepSpaceComms: false,
  };

  for (const type of Object.values(SatelliteType)) {
    const mult = getBenefitMultiplier(state, type);
    if (mult === 0) continue;

    const benefits = SATELLITE_BENEFITS[type];
    if (!benefits) continue;

    if (benefits.transmitYieldBonus) {
      result.transmitYieldBonus += benefits.transmitYieldBonus * mult;
    }
    if (benefits.weatherSkipDiscount) {
      result.weatherSkipDiscount += benefits.weatherSkipDiscount * mult;
    }
    if (benefits.forecastAccuracy) {
      result.forecastAccuracy += benefits.forecastAccuracy * mult;
    }
    if (benefits.sciencePerPeriod) {
      result.sciencePerPeriod += benefits.sciencePerPeriod * mult;
    }
    if (benefits.landingThresholdBonus) {
      result.landingThresholdBonus += benefits.landingThresholdBonus * mult;
    }
    if (benefits.recoveryBonus) {
      result.recoveryBonus += benefits.recoveryBonus * mult;
    }
    if (benefits.deepSpaceComms) {
      result.deepSpaceComms = true;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Degradation & Maintenance (called per period)
// ---------------------------------------------------------------------------

/**
 * Process satellite degradation and auto-maintenance for one period.
 *
 * Called from `advancePeriod()` each time the player returns to the agency.
 *
 * Steps:
 *   1. For auto-maintained satellites: deduct cost, restore health.
 *   2. Degrade all active satellites by SATELLITE_DEGRADATION_PER_PERIOD.
 *   3. Decommission satellites that reach 0 health.
 *   4. Award passive science from Science satellites.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{
 *   maintenanceCost: number,
 *   scienceEarned: number,
 *   decommissioned: string[],
 * }}
 */
export function processSatelliteNetwork(state) {
  const network = state.satelliteNetwork;
  if (!network || !network.satellites) {
    return { maintenanceCost: 0, scienceEarned: 0, decommissioned: [] };
  }

  let maintenanceCost = 0;
  const decommissioned = [];

  // Step 1 & 2: Maintenance + degradation for each active satellite.
  for (const sat of network.satellites) {
    if (sat.health <= 0) continue;

    // Auto-maintenance: pay cost and heal.
    if (sat.autoMaintain) {
      maintenanceCost += SATELLITE_AUTO_MAINTENANCE_COST;
      sat.health = Math.min(100, sat.health + SATELLITE_AUTO_MAINTENANCE_HEAL);
    }

    // Degrade.
    sat.health = Math.max(0, sat.health - SATELLITE_DEGRADATION_PER_PERIOD);

    // Decommission if dead.
    if (sat.health <= 0) {
      decommissioned.push(sat.id);
    }
  }

  // Deduct maintenance cost (mandatory, can go negative like other operating costs).
  state.money -= maintenanceCost;

  // Step 3: Award passive science from Science satellites.
  const benefits = getNetworkBenefits(state);
  const scienceEarned = benefits.sciencePerPeriod;
  state.sciencePoints = (state.sciencePoints ?? 0) + scienceEarned;

  return { maintenanceCost, scienceEarned, decommissioned };
}

// ---------------------------------------------------------------------------
// Maintenance missions
// ---------------------------------------------------------------------------

/**
 * Manually maintain a satellite (from a maintenance mission).
 * Restores health to 100.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} satelliteId
 * @returns {{ success: boolean, reason?: string }}
 */
export function maintainSatellite(state, satelliteId) {
  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };
  if (sat.health <= 0) return { success: false, reason: 'Satellite is decommissioned.' };

  sat.health = 100;
  return { success: true };
}

/**
 * Toggle auto-maintenance for a satellite.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} satelliteId
 * @param {boolean} enabled
 * @returns {{ success: boolean, reason?: string }}
 */
export function setAutoMaintenance(state, satelliteId, enabled) {
  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };
  if (sat.health <= 0) return { success: false, reason: 'Satellite is decommissioned.' };

  sat.autoMaintain = enabled;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Decommission
// ---------------------------------------------------------------------------

/**
 * Manually decommission a satellite (remove from active network).
 * Sets health to 0 but keeps the record for history.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} satelliteId
 * @returns {{ success: boolean, reason?: string }}
 */
export function decommissionSatellite(state, satelliteId) {
  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };

  sat.health = 0;
  sat.autoMaintain = false;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Satellite network summary (for UI)
// ---------------------------------------------------------------------------

/**
 * Build a summary of the satellite network for the Satellite Ops panel.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{
 *   totalActive: number,
 *   capacity: number,
 *   byType: Record<string, { count: number, constellation: boolean }>,
 *   benefits: ReturnType<typeof getNetworkBenefits>,
 *   satellites: import('./gameState.js').SatelliteRecord[],
 * }}
 */
export function getNetworkSummary(state) {
  const tier = hasFacility(state, FacilityId.SATELLITE_OPS)
    ? getFacilityTier(state, FacilityId.SATELLITE_OPS)
    : 0;
  const capacity = tier > 0 ? (SATELLITE_OPS_TIER_CAPS[tier] ?? 6) : 0;

  const active = getActiveSatellites(state);

  const byType = {};
  for (const type of Object.values(SatelliteType)) {
    const count = countSatellitesByType(state, type);
    byType[type] = {
      count,
      constellation: count >= CONSTELLATION_THRESHOLD,
    };
  }

  return {
    totalActive: active.length,
    capacity,
    byType,
    benefits: getNetworkBenefits(state),
    satellites: state.satelliteNetwork?.satellites ?? [],
  };
}
