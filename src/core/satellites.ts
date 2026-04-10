/**
 * satellites.ts — Satellite network management system.
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
  SATELLITE_AUTO_MAINTENANCE_COST,
  SATELLITE_AUTO_MAINTENANCE_HEAL,
  SATELLITE_OPS_TIER_CAPS,
  SATELLITE_LEASE_INCOME,
  SATELLITE_LEASE_INCOME_DEFAULT,
  SATELLITE_LEASE_BENEFIT_PENALTY,
  SATELLITE_REPOSITION_COST,
  SATELLITE_REPOSITION_HEALTH_COST,
  ALTITUDE_BANDS,
  OrbitalObjectType,
  FacilityId,
  BODY_RADIUS,
} from './constants.ts';
import { createOrbitalObject, getAltitudeBandId, getMinOrbitAltitude } from './orbit.ts';
import { hasFacility, getFacilityTier } from './construction.ts';
import { getPartById } from '../data/parts.ts';
import { getSunlitFraction, getSatellitePowerInfo } from './power.ts';

import type { GameState, SatelliteRecord, OrbitalElements } from './gameState.ts';

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

interface DeploySatelliteOptions {
  partId: string;
  bodyId: string;
  elements: OrbitalElements;
  name?: string;
  altitude: number;
}

interface DeployResult {
  success: boolean;
  reason?: string;
  satelliteId?: string;
}

/**
 * Deploy a satellite into the network.
 *
 * Creates an OrbitalObject for map tracking and a SatelliteRecord for
 * network benefit tracking.  Requires the Satellite Ops facility.
 */
export function deploySatellite(
  state: GameState,
  { partId, bodyId, elements, name, altitude }: DeploySatelliteOptions,
): DeployResult {
  // Require Satellite Ops facility.
  if (!hasFacility(state, FacilityId.SATELLITE_OPS)) {
    return { success: false, reason: 'Satellite Operations Centre not built.' };
  }

  // Check capacity.
  const tier = getFacilityTier(state, FacilityId.SATELLITE_OPS);
  const cap = (SATELLITE_OPS_TIER_CAPS as Record<number, number>)[tier] ?? 6;
  const activeSats = state.satelliteNetwork.satellites.filter(s => s.health > 0);
  if (activeSats.length >= cap) {
    return { success: false, reason: `Satellite capacity reached (${cap}). Upgrade Satellite Ops for more slots.` };
  }

  // Resolve part definition.
  const partDef = getPartById(partId);
  if (!partDef) {
    return { success: false, reason: `Unknown part: ${partId}` };
  }

  const satelliteType: string = (partDef.properties.satelliteType as string) ?? 'GENERIC';

  // Determine altitude band.
  const bandId = getAltitudeBandId(altitude, bodyId);
  if (!bandId) {
    return { success: false, reason: 'Satellite is not in a valid altitude band.' };
  }

  // Validate band for typed satellites.
  if (satelliteType !== 'GENERIC') {
    const validBands = (SATELLITE_VALID_BANDS as Record<string, readonly string[]>)[satelliteType];
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
  const record: SatelliteRecord = {
    id: satId,
    orbitalObjectId: orbObjId,
    satelliteType: satelliteType as SatelliteType | 'GENERIC',
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
 */
export function deploySatellitesFromFlight(
  state: GameState,
  flightState: import('./gameState.js').FlightState | null,
): Array<{ satelliteId: string | undefined; satelliteType: string }> {
  if (!flightState) return [];
  if (!state.satelliteNetwork) {
    state.satelliteNetwork = { satellites: [] };
  }

  const deployed: Array<{ satelliteId: string | undefined; satelliteType: string }> = [];
  const releaseEvents = (flightState.events ?? []).filter(
    (e) => e.type === 'SATELLITE_RELEASED',
  );

  for (const event of releaseEvents) {
    const partId: string = (event.partId as string) ?? 'satellite-mk1';
    const altitude: number = (event.altitude as number) ?? 0;
    const bodyId: string = flightState.bodyId ?? 'EARTH';

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
      const satType: string = (partDef?.properties.satelliteType as string) ?? 'GENERIC';
      deployed.push({ satelliteId: result.satelliteId, satelliteType: satType });
    }
  }

  return deployed;
}

/**
 * Create synthetic circular orbital elements for a satellite at a given altitude.
 * Used when the flight's orbital elements aren't available.
 */
function _syntheticCircularElements(
  altitude: number,
  bodyId: string,
  epoch: number,
): OrbitalElements | null {
  const R = (BODY_RADIUS as Record<string, number>)[bodyId];
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
 */
export function getActiveSatellites(state: GameState): SatelliteRecord[] {
  return (state.satelliteNetwork?.satellites ?? []).filter(s => s.health > 0);
}

/**
 * Get active satellites of a specific type.
 */
export function getSatellitesByType(state: GameState, satelliteType: string): SatelliteRecord[] {
  return getActiveSatellites(state).filter(s => s.satelliteType === satelliteType);
}

/**
 * Count operational (health > 0) satellites of a given type.
 */
export function countSatellitesByType(state: GameState, satelliteType: string): number {
  return getSatellitesByType(state, satelliteType).length;
}

/**
 * Check if the constellation bonus is active for a satellite type.
 * Requires CONSTELLATION_THRESHOLD (3) or more operational satellites.
 */
export function hasConstellationBonus(state: GameState, satelliteType: string): boolean {
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
 */
export function getBenefitMultiplier(state: GameState, satelliteType: string): number {
  const sats = getSatellitesByType(state, satelliteType);
  if (sats.length === 0) return 0;

  // Base is 1 if any active satellite exists.
  let multiplier = 1;

  // Constellation bonus: 3+ same type = 2×.
  if (sats.length >= CONSTELLATION_THRESHOLD) {
    multiplier = CONSTELLATION_MULTIPLIER;
  }

  // Leased satellites reduce benefit: if ALL are leased, apply full penalty.
  // Mixed fleet: proportional reduction based on leased fraction.
  const leasedCount = sats.filter(s => s.leased).length;
  if (leasedCount > 0 && leasedCount < sats.length) {
    // Partial lease: blend penalty proportionally.
    const leasedFraction = leasedCount / sats.length;
    multiplier *= (1 - leasedFraction * (1 - SATELLITE_LEASE_BENEFIT_PENALTY));
  } else if (leasedCount === sats.length) {
    multiplier *= SATELLITE_LEASE_BENEFIT_PENALTY;
  }

  return multiplier;
}

interface NetworkBenefits {
  transmitYieldBonus: number;
  weatherSkipDiscount: number;
  forecastAccuracy: number;
  sciencePerPeriod: number;
  landingThresholdBonus: number;
  recoveryBonus: number;
  deepSpaceComms: boolean;
}

/**
 * Compute the aggregate network benefits across all satellite types.
 *
 * Returns an object with all benefit keys and their effective values.
 */
export function getNetworkBenefits(state: GameState): NetworkBenefits {
  const result: NetworkBenefits = {
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

    const benefits = (SATELLITE_BENEFITS as Record<string, Record<string, number | boolean>>)[type];
    if (!benefits) continue;

    if (benefits.transmitYieldBonus) {
      result.transmitYieldBonus += (benefits.transmitYieldBonus as number) * mult;
    }
    if (benefits.weatherSkipDiscount) {
      result.weatherSkipDiscount += (benefits.weatherSkipDiscount as number) * mult;
    }
    if (benefits.forecastAccuracy) {
      result.forecastAccuracy += (benefits.forecastAccuracy as number) * mult;
    }
    if (benefits.sciencePerPeriod) {
      result.sciencePerPeriod += (benefits.sciencePerPeriod as number) * mult;
    }
    if (benefits.landingThresholdBonus) {
      result.landingThresholdBonus += (benefits.landingThresholdBonus as number) * mult;
    }
    if (benefits.recoveryBonus) {
      result.recoveryBonus += (benefits.recoveryBonus as number) * mult;
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

interface SatelliteNetworkResult {
  maintenanceCost: number;
  scienceEarned: number;
  leaseIncome: number;
  decommissioned: string[];
}

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
 */
export function processSatelliteNetwork(state: GameState): SatelliteNetworkResult {
  const network = state.satelliteNetwork;
  if (!network || !network.satellites) {
    return { maintenanceCost: 0, scienceEarned: 0, leaseIncome: 0, decommissioned: [] };
  }

  let maintenanceCost = 0;
  let leaseIncome = 0;
  const decommissioned: string[] = [];

  // Step 1 & 2: Maintenance + degradation for each active satellite.
  for (const sat of network.satellites) {
    if (sat.health <= 0) continue;

    // Auto-maintenance: pay cost and heal.
    if (sat.autoMaintain) {
      maintenanceCost += SATELLITE_AUTO_MAINTENANCE_COST;
      sat.health = Math.min(100, sat.health + SATELLITE_AUTO_MAINTENANCE_HEAL);
    }

    // Lease income: collect before degradation (satellite was active this period).
    leaseIncome += getSatelliteLeaseIncome(sat);

    // Degrade.
    sat.health = Math.max(0, sat.health - SATELLITE_DEGRADATION_PER_PERIOD);

    // Decommission if dead. Also clear lease flag.
    if (sat.health <= 0) {
      sat.leased = false;
      decommissioned.push(sat.id);
    }
  }

  // Deduct maintenance cost (mandatory, can go negative like other operating costs).
  state.money -= maintenanceCost;

  // Add lease income.
  state.money += leaseIncome;

  // Step 3: Award passive science from Science satellites.
  const benefits = getNetworkBenefits(state);
  const scienceEarned = benefits.sciencePerPeriod;
  state.sciencePoints = (state.sciencePoints ?? 0) + scienceEarned;

  return { maintenanceCost, scienceEarned, leaseIncome, decommissioned };
}

// ---------------------------------------------------------------------------
// Maintenance missions
// ---------------------------------------------------------------------------

interface SuccessResult {
  success: boolean;
  reason?: string;
}

/**
 * Manually maintain a satellite (from a maintenance mission).
 * Restores health to 100.
 */
export function maintainSatellite(state: GameState, satelliteId: string): SuccessResult {
  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };
  if (sat.health <= 0) return { success: false, reason: 'Satellite is decommissioned.' };

  sat.health = 100;
  return { success: true };
}

/**
 * Toggle auto-maintenance for a satellite.
 */
export function setAutoMaintenance(state: GameState, satelliteId: string, enabled: boolean): SuccessResult {
  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };
  if (sat.health <= 0) return { success: false, reason: 'Satellite is decommissioned.' };

  sat.autoMaintain = enabled;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Leasing (Tier 2+)
// ---------------------------------------------------------------------------

/**
 * Toggle satellite lease status.
 * Leased satellites earn income per period but provide reduced network benefits.
 * Requires Satellite Ops Tier 2+.
 */
export function setSatelliteLease(state: GameState, satelliteId: string, leased: boolean): SuccessResult {
  const tier = getFacilityTier(state, FacilityId.SATELLITE_OPS);
  if (tier < 2) {
    return { success: false, reason: 'Satellite Ops Tier 2 required for leasing.' };
  }

  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };
  if (sat.health <= 0) return { success: false, reason: 'Satellite is decommissioned.' };

  sat.leased = leased;
  return { success: true };
}

/**
 * Get the per-period lease income for a single satellite.
 *
 * @returns Income in dollars (0 if not leased or dead).
 */
export function getSatelliteLeaseIncome(sat: SatelliteRecord): number {
  if (!sat.leased || sat.health <= 0) return 0;
  return (SATELLITE_LEASE_INCOME as Record<string, number>)[sat.satelliteType as string] ?? SATELLITE_LEASE_INCOME_DEFAULT;
}

/**
 * Get total lease income across the entire network per period.
 */
export function getTotalLeaseIncome(state: GameState): number {
  const sats = state.satelliteNetwork?.satellites ?? [];
  let total = 0;
  for (const sat of sats) {
    total += getSatelliteLeaseIncome(sat);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Repositioning (Tier 3)
// ---------------------------------------------------------------------------

/**
 * Reposition a satellite to a different altitude band on the same body.
 * Requires Satellite Ops Tier 3. Costs money and satellite health.
 */
export function repositionSatellite(state: GameState, satelliteId: string, targetBandId: string): SuccessResult {
  const tier = getFacilityTier(state, FacilityId.SATELLITE_OPS);
  if (tier < 3) {
    return { success: false, reason: 'Satellite Ops Tier 3 required for repositioning.' };
  }

  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };
  if (sat.health <= 0) return { success: false, reason: 'Satellite is decommissioned.' };

  if (sat.bandId === targetBandId) {
    return { success: false, reason: 'Satellite is already in that band.' };
  }

  // Validate target band exists for this body.
  const bodyBands = (ALTITUDE_BANDS as Record<string, ReadonlyArray<{ id: string; name: string; min: number; max: number }>>)[sat.bodyId];
  if (!bodyBands) return { success: false, reason: 'Unknown celestial body.' };
  const targetBand = bodyBands.find(b => b.id === targetBandId);
  if (!targetBand) {
    return { success: false, reason: `Band "${targetBandId}" does not exist for ${sat.bodyId}.` };
  }

  // Validate typed satellites can operate in the target band.
  if (sat.satelliteType !== 'GENERIC') {
    const validBands = (SATELLITE_VALID_BANDS as Record<string, readonly string[]>)[sat.satelliteType as string];
    if (validBands && !validBands.includes(targetBandId)) {
      return {
        success: false,
        reason: `${sat.satelliteType} satellites cannot operate in ${targetBandId}.`,
      };
    }
  }

  // Check cost.
  const cost = (SATELLITE_REPOSITION_COST as Record<string, number>).SAME_BODY;
  if (state.money < cost) {
    return { success: false, reason: `Insufficient funds. Repositioning costs $${(cost / 1000).toFixed(0)}k.` };
  }

  // Check health (must survive the manoeuvre).
  if (sat.health <= SATELLITE_REPOSITION_HEALTH_COST) {
    return { success: false, reason: 'Satellite health too low to survive repositioning.' };
  }

  // Apply repositioning.
  state.money -= cost;
  sat.health -= SATELLITE_REPOSITION_HEALTH_COST;
  sat.bandId = targetBandId;

  // Update orbital object elements to match new band altitude.
  const orbObj = state.orbitalObjects.find(o => o.id === sat.orbitalObjectId);
  if (orbObj) {
    const midAlt = (targetBand.min + targetBand.max) / 2;
    const R = (BODY_RADIUS as Record<string, number>)[sat.bodyId] ?? 6_371_000;
    orbObj.elements.semiMajorAxis = R + midAlt;
    orbObj.elements.eccentricity = 0;
  }

  return { success: true };
}

/**
 * Get valid repositioning targets for a satellite.
 * Returns bands the satellite can move to (excluding current band).
 */
export function getRepositionTargets(state: GameState, satelliteId: string): Array<{ id: string; name: string }> {
  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat || sat.health <= 0) return [];

  const bodyBands = (ALTITUDE_BANDS as Record<string, ReadonlyArray<{ id: string; name: string; min: number; max: number }>>)[sat.bodyId];
  if (!bodyBands) return [];

  const validBands = (sat.satelliteType !== 'GENERIC')
    ? (SATELLITE_VALID_BANDS as Record<string, readonly string[]>)[sat.satelliteType as string]
    : null;

  return bodyBands
    .filter(b => b.id !== sat.bandId)
    .filter(b => !validBands || validBands.includes(b.id))
    .map(b => ({ id: b.id, name: b.name }));
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

/**
 * Rename an orbital object by its ID.
 * Returns true if the object was found and renamed, false otherwise.
 */
export function renameOrbitalObject(state: GameState, objectId: string, newName: string): boolean {
  const obj = state.orbitalObjects?.find(o => o.id === objectId);
  if (!obj) return false;
  obj.name = newName;
  return true;
}

// ---------------------------------------------------------------------------
// Decommission
// ---------------------------------------------------------------------------

/**
 * Manually decommission a satellite (remove from active network).
 * Sets health to 0 but keeps the record for history.
 */
export function decommissionSatellite(state: GameState, satelliteId: string): SuccessResult {
  const sat = state.satelliteNetwork.satellites.find(s => s.id === satelliteId);
  if (!sat) return { success: false, reason: 'Satellite not found.' };

  sat.health = 0;
  sat.autoMaintain = false;
  sat.leased = false;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Satellite network summary (for UI)
// ---------------------------------------------------------------------------

interface NetworkSummary {
  totalActive: number;
  capacity: number;
  tier: number;
  leasedCount: number;
  totalLeaseIncome: number;
  byType: Record<string, { count: number; constellation: boolean }>;
  benefits: NetworkBenefits;
  satellites: SatelliteRecord[];
  satellitePowerInfo: Record<string, { sunlitFraction: number; avgGeneration: number; altitude: number }>;
}

/**
 * Build a summary of the satellite network for the Satellite Ops panel.
 */
export function getNetworkSummary(state: GameState): NetworkSummary {
  const tier = hasFacility(state, FacilityId.SATELLITE_OPS)
    ? getFacilityTier(state, FacilityId.SATELLITE_OPS)
    : 0;
  const capacity = tier > 0 ? ((SATELLITE_OPS_TIER_CAPS as Record<number, number>)[tier] ?? 6) : 0;

  const active = getActiveSatellites(state);

  const byType: Record<string, { count: number; constellation: boolean }> = {};
  for (const type of Object.values(SatelliteType)) {
    const count = countSatellitesByType(state, type);
    byType[type] = {
      count,
      constellation: count >= CONSTELLATION_THRESHOLD,
    };
  }

  const leasedCount = active.filter(s => s.leased).length;

  // Compute sunlit fraction and power info per satellite for UI display.
  const allSats = state.satelliteNetwork?.satellites ?? [];
  const satellitePowerInfo: Record<string, { sunlitFraction: number; avgGeneration: number; altitude: number }> = {};
  for (const sat of allSats) {
    if (sat.health <= 0) continue;
    // Look up the orbit altitude from the corresponding OrbitalObject.
    const oo = state.orbitalObjects?.find(o => o.id === sat.orbitalObjectId);
    if (oo && oo.elements) {
      const altitude = oo.elements.semiMajorAxis - ((BODY_RADIUS as Record<string, number>)[sat.bodyId] ?? 6_371_000);
      const fraction = getSunlitFraction(altitude, sat.bodyId);
      const powerInfo = getSatellitePowerInfo(altitude, sat.bodyId);
      satellitePowerInfo[sat.id] = {
        sunlitFraction: fraction,
        avgGeneration: powerInfo.avgGeneration,
        altitude,
      };
    }
  }

  return {
    totalActive: active.length,
    capacity,
    tier,
    leasedCount,
    totalLeaseIncome: getTotalLeaseIncome(state),
    byType,
    benefits: getNetworkBenefits(state),
    satellites: allSats,
    satellitePowerInfo,
  };
}
