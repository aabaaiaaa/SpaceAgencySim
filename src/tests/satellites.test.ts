/**
 * satellites.test.js — Unit tests for the satellite network system.
 *
 * Tests cover:
 *   - deploySatellite()        — deployment, validation, capacity checks
 *   - getActiveSatellites()    — active satellite filtering
 *   - countSatellitesByType()  — type-specific counting
 *   - hasConstellationBonus()  — constellation threshold (3+)
 *   - getBenefitMultiplier()   — benefit multiplier with/without constellation
 *   - getNetworkBenefits()     — aggregate benefits across all types
 *   - processSatelliteNetwork() — degradation, auto-maintenance, science
 *   - maintainSatellite()      — manual maintenance
 *   - setAutoMaintenance()     — auto-maintenance toggle
 *   - decommissionSatellite()  — manual decommission
 *   - deploySatellitesFromFlight() — auto-deploy from flight events
 *   - Integration with advancePeriod()
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  deploySatellite,
  getActiveSatellites,
  getSatellitesByType,
  countSatellitesByType,
  hasConstellationBonus,
  getBenefitMultiplier,
  getNetworkBenefits,
  processSatelliteNetwork,
  maintainSatellite,
  setAutoMaintenance,
  decommissionSatellite,
  getNetworkSummary,
  deploySatellitesFromFlight,
  setSatelliteLease,
  getSatelliteLeaseIncome,
  getTotalLeaseIncome,
  repositionSatellite,
  getRepositionTargets,
} from '../core/satellites.ts';
import { advancePeriod } from '../core/period.ts';
import {
  SatelliteType,
  FacilityId,
  SATELLITE_DEGRADATION_PER_PERIOD,
  SATELLITE_AUTO_MAINTENANCE_COST,
  SATELLITE_AUTO_MAINTENANCE_HEAL,
  CONSTELLATION_THRESHOLD,
  STARTING_MONEY,
  SATELLITE_LEASE_INCOME,
  SATELLITE_LEASE_INCOME_DEFAULT,
  SATELLITE_LEASE_BENEFIT_PENALTY,
  SATELLITE_REPOSITION_COST,
  SATELLITE_REPOSITION_HEALTH_COST,
} from '../core/constants.ts';

import type { GameState, OrbitalElements, FlightState } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  const state = createGameState();
  // Build the Satellite Ops facility so deployment works.
  state.facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 1 };
  return state;
}

/** Default orbital elements for a LEO satellite. */
const LEO_ELEMENTS: OrbitalElements = {
  semiMajorAxis: 6_371_000 + 150_000, // ~150 km altitude
  eccentricity: 0.001,
  argPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
};

/** Default orbital elements for a MEO satellite. */
const MEO_ELEMENTS: OrbitalElements = {
  semiMajorAxis: 6_371_000 + 500_000, // ~500 km altitude
  eccentricity: 0.001,
  argPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
};

/** Default orbital elements for a HEO satellite. */
const HEO_ELEMENTS: OrbitalElements = {
  semiMajorAxis: 6_371_000 + 5_000_000, // ~5000 km altitude
  eccentricity: 0.001,
  argPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
};

function deploySatHelper(
  state: GameState,
  partId: string,
  elements: OrbitalElements,
  altitude?: number,
): ReturnType<typeof deploySatellite> {
  return deploySatellite(state, {
    partId,
    bodyId: 'EARTH',
    elements: { ...elements },
    altitude: altitude ?? 150_000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Satellite Network — deploySatellite()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('should deploy a generic satellite successfully', () => {
    const result = deploySatHelper(state, 'satellite-mk1', LEO_ELEMENTS);
    expect(result.success).toBe(true);
    expect(result.satelliteId).toBeTruthy();
    expect(state.satelliteNetwork.satellites).toHaveLength(1);
    expect(state.orbitalObjects).toHaveLength(1);
  });

  it('should deploy a typed communication satellite', () => {
    const result = deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    expect(result.success).toBe(true);
    const sat = state.satelliteNetwork.satellites[0];
    expect(sat.satelliteType).toBe(SatelliteType.COMMUNICATION);
    expect(sat.health).toBe(100);
    expect(sat.bandId).toBe('LEO');
  });

  it('should fail without Satellite Ops facility', () => {
    delete state.facilities[FacilityId.SATELLITE_OPS];
    const result = deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not built');
  });

  it('should fail when capacity is reached', () => {
    // Tier 1 cap = 6
    for (let i = 0; i < 6; i++) {
      const r = deploySatHelper(state, 'satellite-mk1', LEO_ELEMENTS);
      expect(r.success).toBe(true);
    }
    const result = deploySatHelper(state, 'satellite-mk1', LEO_ELEMENTS);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('capacity');
  });

  it('should reject GPS satellite in LEO (wrong band)', () => {
    const result = deploySatHelper(state, 'satellite-gps', LEO_ELEMENTS);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('cannot operate');
  });

  it('should accept GPS satellite in MEO', () => {
    const result = deploySatHelper(state, 'satellite-gps', MEO_ELEMENTS, 500_000);
    expect(result.success).toBe(true);
    const sat = state.satelliteNetwork.satellites[0];
    expect(sat.bandId).toBe('MEO');
  });

  it('should reject Relay satellite in LEO', () => {
    const result = deploySatHelper(state, 'satellite-relay', LEO_ELEMENTS);
    expect(result.success).toBe(false);
  });

  it('should accept Relay satellite in HEO', () => {
    const result = deploySatHelper(state, 'satellite-relay', HEO_ELEMENTS, 5_000_000);
    expect(result.success).toBe(true);
  });

  it('should set deployedPeriod to current period', () => {
    state.currentPeriod = 5;
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    expect(state.satelliteNetwork.satellites[0].deployedPeriod).toBe(5);
  });
});

describe('Satellite Network — queries', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    deploySatHelper(state, 'satellite-science', LEO_ELEMENTS);
  });

  it('getActiveSatellites returns all healthy satellites', () => {
    expect(getActiveSatellites(state)).toHaveLength(3);
  });

  it('getActiveSatellites excludes dead satellites', () => {
    state.satelliteNetwork.satellites[0].health = 0;
    expect(getActiveSatellites(state)).toHaveLength(2);
  });

  it('getSatellitesByType filters by type', () => {
    expect(getSatellitesByType(state, SatelliteType.COMMUNICATION)).toHaveLength(2);
    expect(getSatellitesByType(state, SatelliteType.SCIENCE)).toHaveLength(1);
    expect(getSatellitesByType(state, SatelliteType.GPS)).toHaveLength(0);
  });

  it('countSatellitesByType returns count', () => {
    expect(countSatellitesByType(state, SatelliteType.COMMUNICATION)).toBe(2);
  });

  it('hasConstellationBonus requires 3+', () => {
    expect(hasConstellationBonus(state, SatelliteType.COMMUNICATION)).toBe(false);
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    expect(hasConstellationBonus(state, SatelliteType.COMMUNICATION)).toBe(true);
  });
});

describe('Satellite Network — benefits', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('returns 0 multiplier with no satellites', () => {
    expect(getBenefitMultiplier(state, SatelliteType.COMMUNICATION)).toBe(0);
  });

  it('returns 1 multiplier with 1-2 satellites', () => {
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    expect(getBenefitMultiplier(state, SatelliteType.COMMUNICATION)).toBe(1);
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    expect(getBenefitMultiplier(state, SatelliteType.COMMUNICATION)).toBe(1);
  });

  it('returns 2 multiplier with 3+ satellites (constellation)', () => {
    for (let i = 0; i < 3; i++) {
      deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    }
    expect(getBenefitMultiplier(state, SatelliteType.COMMUNICATION)).toBe(2);
  });

  it('getNetworkBenefits returns correct aggregate values', () => {
    // 1 comm satellite → base transmitYieldBonus (0.15)
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    const benefits = getNetworkBenefits(state);
    expect(benefits.transmitYieldBonus).toBeCloseTo(0.15);
    expect(benefits.sciencePerPeriod).toBe(0);
    expect(benefits.deepSpaceComms).toBe(false);
  });

  it('constellation doubles the benefit', () => {
    for (let i = 0; i < 3; i++) {
      deploySatHelper(state, 'satellite-science', LEO_ELEMENTS);
    }
    const benefits = getNetworkBenefits(state);
    expect(benefits.sciencePerPeriod).toBe(4); // 2 base × 2
  });

  it('relay enables deep space comms', () => {
    deploySatHelper(state, 'satellite-relay', HEO_ELEMENTS, 5_000_000);
    const benefits = getNetworkBenefits(state);
    expect(benefits.deepSpaceComms).toBe(true);
  });
});

describe('Satellite Network — processSatelliteNetwork()', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    deploySatHelper(state, 'satellite-science', LEO_ELEMENTS);
  });

  it('degrades all satellites by SATELLITE_DEGRADATION_PER_PERIOD', () => {
    processSatelliteNetwork(state);
    for (const sat of state.satelliteNetwork.satellites) {
      expect(sat.health).toBe(100 - SATELLITE_DEGRADATION_PER_PERIOD);
    }
  });

  it('decommissions satellites at 0 health', () => {
    state.satelliteNetwork.satellites[0].health = SATELLITE_DEGRADATION_PER_PERIOD;
    const result = processSatelliteNetwork(state);
    expect(result.decommissioned).toHaveLength(1);
    expect(state.satelliteNetwork.satellites[0].health).toBe(0);
  });

  it('auto-maintenance heals before degradation', () => {
    state.satelliteNetwork.satellites[0].autoMaintain = true;
    state.satelliteNetwork.satellites[0].health = 50;
    processSatelliteNetwork(state);
    // Health = 50 + 10 (heal) - 3 (degrade) = 57
    expect(state.satelliteNetwork.satellites[0].health).toBe(
      50 + SATELLITE_AUTO_MAINTENANCE_HEAL - SATELLITE_DEGRADATION_PER_PERIOD,
    );
  });

  it('auto-maintenance deducts cost from money', () => {
    state.satelliteNetwork.satellites[0].autoMaintain = true;
    const moneyBefore = state.money;
    const result = processSatelliteNetwork(state);
    expect(result.maintenanceCost).toBe(SATELLITE_AUTO_MAINTENANCE_COST);
    expect(state.money).toBe(moneyBefore - SATELLITE_AUTO_MAINTENANCE_COST);
  });

  it('awards passive science from Science satellites', () => {
    const scienceBefore = state.sciencePoints;
    const result = processSatelliteNetwork(state);
    // 1 science satellite → 2 SP per period (base, no constellation)
    expect(result.scienceEarned).toBe(2);
    expect(state.sciencePoints).toBe(scienceBefore + 2);
  });

  it('auto-maintenance caps health at 100', () => {
    state.satelliteNetwork.satellites[0].autoMaintain = true;
    state.satelliteNetwork.satellites[0].health = 95;
    processSatelliteNetwork(state);
    // Health = min(100, 95 + 10) - 3 = 100 - 3 = 97
    expect(state.satelliteNetwork.satellites[0].health).toBe(97);
  });
});

describe('Satellite Network — maintenance & decommission', () => {
  let state: GameState;
  let satId: string;
  beforeEach(() => {
    state = freshState();
    const result = deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    satId = result.satelliteId!;
  });

  it('maintainSatellite restores health to 100', () => {
    state.satelliteNetwork.satellites[0].health = 30;
    const result = maintainSatellite(state, satId);
    expect(result.success).toBe(true);
    expect(state.satelliteNetwork.satellites[0].health).toBe(100);
  });

  it('maintainSatellite fails for decommissioned satellite', () => {
    state.satelliteNetwork.satellites[0].health = 0;
    const result = maintainSatellite(state, satId);
    expect(result.success).toBe(false);
  });

  it('setAutoMaintenance toggles flag', () => {
    expect(state.satelliteNetwork.satellites[0].autoMaintain).toBe(false);
    setAutoMaintenance(state, satId, true);
    expect(state.satelliteNetwork.satellites[0].autoMaintain).toBe(true);
    setAutoMaintenance(state, satId, false);
    expect(state.satelliteNetwork.satellites[0].autoMaintain).toBe(false);
  });

  it('decommissionSatellite sets health to 0', () => {
    const result = decommissionSatellite(state, satId);
    expect(result.success).toBe(true);
    expect(state.satelliteNetwork.satellites[0].health).toBe(0);
    expect(state.satelliteNetwork.satellites[0].autoMaintain).toBe(false);
  });

  it('decommissionSatellite fails for unknown ID', () => {
    const result = decommissionSatellite(state, 'nonexistent');
    expect(result.success).toBe(false);
  });
});

describe('Satellite Network — getNetworkSummary()', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    deploySatHelper(state, 'satellite-science', LEO_ELEMENTS);
  });

  it('returns correct summary', () => {
    const summary = getNetworkSummary(state);
    expect(summary.totalActive).toBe(2);
    expect(summary.capacity).toBe(6); // tier 1
    expect(summary.byType[SatelliteType.COMMUNICATION].count).toBe(1);
    expect(summary.byType[SatelliteType.SCIENCE].count).toBe(1);
    expect(summary.byType[SatelliteType.GPS].count).toBe(0);
    expect(summary.benefits.transmitYieldBonus).toBeCloseTo(0.15);
    expect(summary.benefits.sciencePerPeriod).toBe(2);
  });
});

describe('Satellite Network — deploySatellitesFromFlight()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('deploys satellite from flight event when in orbit', () => {
    const flightState = {
      bodyId: 'EARTH',
      orbitalElements: { ...LEO_ELEMENTS },
      timeElapsed: 100,
      events: [
        {
          type: 'SATELLITE_RELEASED',
          time: 90,
          altitude: 150_000,
          velocity: 7800,
          partId: 'satellite-comm',
        },
      ],
    } as unknown as FlightState;
    const deployed = deploySatellitesFromFlight(state, flightState);
    expect(deployed).toHaveLength(1);
    expect(deployed[0].satelliteType).toBe(SatelliteType.COMMUNICATION);
    expect(state.satelliteNetwork.satellites).toHaveLength(1);
  });

  it('does not deploy satellite released below orbit altitude', () => {
    const flightState = {
      bodyId: 'EARTH',
      orbitalElements: null,
      timeElapsed: 50,
      events: [
        {
          type: 'SATELLITE_RELEASED',
          time: 40,
          altitude: 50_000, // below 70km minimum
          velocity: 3000,
          partId: 'satellite-comm',
        },
      ],
    } as unknown as FlightState;
    const deployed = deploySatellitesFromFlight(state, flightState);
    expect(deployed).toHaveLength(0);
  });

  it('deploys multiple satellites from a single flight', () => {
    const flightState = {
      bodyId: 'EARTH',
      orbitalElements: { ...LEO_ELEMENTS },
      timeElapsed: 200,
      events: [
        { type: 'SATELLITE_RELEASED', time: 100, altitude: 150_000, velocity: 7800, partId: 'satellite-comm' },
        { type: 'SATELLITE_RELEASED', time: 150, altitude: 150_000, velocity: 7800, partId: 'satellite-science' },
      ],
    } as unknown as FlightState;
    const deployed = deploySatellitesFromFlight(state, flightState);
    expect(deployed).toHaveLength(2);
    expect(state.satelliteNetwork.satellites).toHaveLength(2);
  });

  it('defaults to satellite-mk1 when partId is missing', () => {
    const flightState = {
      bodyId: 'EARTH',
      orbitalElements: { ...LEO_ELEMENTS },
      timeElapsed: 100,
      events: [
        { type: 'SATELLITE_RELEASED', time: 90, altitude: 150_000, velocity: 7800 },
      ],
    } as unknown as FlightState;
    const deployed = deploySatellitesFromFlight(state, flightState);
    expect(deployed).toHaveLength(1);
    expect(deployed[0].satelliteType).toBe('GENERIC');
  });
});

describe('Satellite Network — advancePeriod integration', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    deploySatHelper(state, 'satellite-science', LEO_ELEMENTS);
  });

  it('@smoke includes satellite maintenance and science in period summary', () => {
    state.satelliteNetwork.satellites[0].autoMaintain = true;
    const summary = advancePeriod(state);
    expect(summary.satelliteMaintenanceCost).toBe(SATELLITE_AUTO_MAINTENANCE_COST);
    expect(summary.satelliteScienceEarned).toBe(2);
    expect(summary.decommissionedSatellites).toEqual([]);
  });

  it('degrades satellites through multiple periods', () => {
    advancePeriod(state);
    advancePeriod(state);
    // 2 periods of degradation: 100 - 3 - 3 = 94
    expect(state.satelliteNetwork.satellites[0].health).toBe(
      100 - 2 * SATELLITE_DEGRADATION_PER_PERIOD,
    );
  });

  it('includes lease income in period summary', () => {
    state.facilities[FacilityId.SATELLITE_OPS].tier = 2;
    state.satelliteNetwork.satellites[0].leased = true; // comm satellite
    const summary = advancePeriod(state);
    expect(summary.satelliteLeaseIncome).toBe(SATELLITE_LEASE_INCOME[SatelliteType.COMMUNICATION]);
  });
});

// ---------------------------------------------------------------------------
// Satellite Leasing (Tier 2+)
// ---------------------------------------------------------------------------

describe('Satellite Network — leasing', () => {
  let state: GameState;
  let satId: string;
  beforeEach(() => {
    state = freshState();
    state.facilities[FacilityId.SATELLITE_OPS].tier = 2;
    const result = deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    satId = result.satelliteId!;
  });

  it('setSatelliteLease enables leasing on Tier 2', () => {
    const result = setSatelliteLease(state, satId, true);
    expect(result.success).toBe(true);
    expect(state.satelliteNetwork.satellites[0].leased).toBe(true);
  });

  it('setSatelliteLease disables leasing', () => {
    setSatelliteLease(state, satId, true);
    const result = setSatelliteLease(state, satId, false);
    expect(result.success).toBe(true);
    expect(state.satelliteNetwork.satellites[0].leased).toBe(false);
  });

  it('setSatelliteLease fails on Tier 1', () => {
    state.facilities[FacilityId.SATELLITE_OPS].tier = 1;
    const result = setSatelliteLease(state, satId, true);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Tier 2');
  });

  it('setSatelliteLease fails for decommissioned satellite', () => {
    state.satelliteNetwork.satellites[0].health = 0;
    const result = setSatelliteLease(state, satId, true);
    expect(result.success).toBe(false);
  });

  it('getSatelliteLeaseIncome returns correct income for comm satellite', () => {
    state.satelliteNetwork.satellites[0].leased = true;
    const income = getSatelliteLeaseIncome(state.satelliteNetwork.satellites[0]);
    expect(income).toBe(SATELLITE_LEASE_INCOME[SatelliteType.COMMUNICATION]);
  });

  it('getSatelliteLeaseIncome returns 0 for non-leased satellite', () => {
    const income = getSatelliteLeaseIncome(state.satelliteNetwork.satellites[0]);
    expect(income).toBe(0);
  });

  it('getSatelliteLeaseIncome returns default for generic satellite', () => {
    deploySatHelper(state, 'satellite-mk1', LEO_ELEMENTS);
    const genericSat = state.satelliteNetwork.satellites[1];
    genericSat.leased = true;
    expect(getSatelliteLeaseIncome(genericSat)).toBe(SATELLITE_LEASE_INCOME_DEFAULT);
  });

  it('getTotalLeaseIncome sums all leased satellites', () => {
    deploySatHelper(state, 'satellite-science', LEO_ELEMENTS);
    state.satelliteNetwork.satellites[0].leased = true; // comm
    state.satelliteNetwork.satellites[1].leased = true; // science
    const total = getTotalLeaseIncome(state);
    expect(total).toBe(
      SATELLITE_LEASE_INCOME[SatelliteType.COMMUNICATION] +
      SATELLITE_LEASE_INCOME[SatelliteType.SCIENCE],
    );
  });

  it('processSatelliteNetwork adds lease income to money', () => {
    state.satelliteNetwork.satellites[0].leased = true;
    const moneyBefore = state.money;
    const result = processSatelliteNetwork(state);
    expect(result.leaseIncome).toBe(SATELLITE_LEASE_INCOME[SatelliteType.COMMUNICATION]);
    expect(state.money).toBe(moneyBefore + result.leaseIncome);
  });

  it('decommissioned satellite clears lease flag', () => {
    state.satelliteNetwork.satellites[0].leased = true;
    decommissionSatellite(state, satId);
    expect(state.satelliteNetwork.satellites[0].leased).toBe(false);
  });

  it('leased satellites reduce network benefit multiplier', () => {
    // Deploy 3 comm satellites for constellation.
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    // 3 comm sats: constellation = 2× multiplier.
    expect(getBenefitMultiplier(state, SatelliteType.COMMUNICATION)).toBe(2);

    // Lease all 3: multiplier should be 2 × 0.5 = 1.
    state.satelliteNetwork.satellites[0].leased = true;
    state.satelliteNetwork.satellites[1].leased = true;
    state.satelliteNetwork.satellites[2].leased = true;
    expect(getBenefitMultiplier(state, SatelliteType.COMMUNICATION)).toBe(
      2 * SATELLITE_LEASE_BENEFIT_PENALTY,
    );
  });

  it('partial lease reduces benefit proportionally', () => {
    // 2 comm sats, 1 leased (no constellation).
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    state.satelliteNetwork.satellites[0].leased = true;
    // 1 of 2 leased → multiplier = 1 × (1 - 0.5 × (1 - 0.5)) = 1 × 0.75 = 0.75
    const mult = getBenefitMultiplier(state, SatelliteType.COMMUNICATION);
    expect(mult).toBeCloseTo(0.75);
  });
});

// ---------------------------------------------------------------------------
// Satellite Repositioning (Tier 3)
// ---------------------------------------------------------------------------

describe('Satellite Network — repositioning', () => {
  let state: GameState;
  let satId: string;
  beforeEach(() => {
    state = freshState();
    state.facilities[FacilityId.SATELLITE_OPS].tier = 3;
    state.money = 1_000_000;
    const result = deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
    satId = result.satelliteId!;
  });

  it('repositionSatellite moves satellite to new band', () => {
    const result = repositionSatellite(state, satId, 'MEO');
    expect(result.success).toBe(true);
    expect(state.satelliteNetwork.satellites[0].bandId).toBe('MEO');
  });

  it('repositionSatellite deducts cost', () => {
    const moneyBefore = state.money;
    repositionSatellite(state, satId, 'MEO');
    expect(state.money).toBe(moneyBefore - SATELLITE_REPOSITION_COST.SAME_BODY);
  });

  it('repositionSatellite reduces health', () => {
    repositionSatellite(state, satId, 'MEO');
    expect(state.satelliteNetwork.satellites[0].health).toBe(100 - SATELLITE_REPOSITION_HEALTH_COST);
  });

  it('repositionSatellite fails on Tier 2', () => {
    state.facilities[FacilityId.SATELLITE_OPS].tier = 2;
    const result = repositionSatellite(state, satId, 'MEO');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Tier 3');
  });

  it('repositionSatellite fails if already in target band', () => {
    const result = repositionSatellite(state, satId, 'LEO');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('already');
  });

  it('repositionSatellite fails for invalid band', () => {
    const result = repositionSatellite(state, satId, 'NONEXISTENT');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('does not exist');
  });

  it('repositionSatellite fails if insufficient funds', () => {
    state.money = 100;
    const result = repositionSatellite(state, satId, 'MEO');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Insufficient');
  });

  it('repositionSatellite fails if health too low', () => {
    state.satelliteNetwork.satellites[0].health = SATELLITE_REPOSITION_HEALTH_COST;
    const result = repositionSatellite(state, satId, 'MEO');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('health');
  });

  it('repositionSatellite rejects GPS to invalid band (LEO)', () => {
    const gpsResult = deploySatHelper(state, 'satellite-gps', MEO_ELEMENTS, 500_000);
    const gpsId = gpsResult.satelliteId!;
    // GPS only valid in MEO, MLO — try to move to LEO (invalid).
    const result = repositionSatellite(state, gpsId, 'LEO');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('cannot operate');
  });

  it('repositionSatellite updates orbital object elements', () => {
    repositionSatellite(state, satId, 'MEO');
    const orbObj = state.orbitalObjects.find(
      o => o.id === state.satelliteNetwork.satellites[0].orbitalObjectId,
    );
    // MEO for Earth: min 200000, max 2000000, mid = 1100000
    // semiMajorAxis = 6371000 + 1100000 = 7471000
    expect(orbObj!.elements.semiMajorAxis).toBe(6_371_000 + 1_100_000);
  });

  it('getRepositionTargets returns valid bands excluding current', () => {
    const targets = getRepositionTargets(state, satId);
    // Comm satellite in LEO, valid bands: LEO, MEO, HEO (+ lunar ones).
    // Excluding LEO leaves MEO, HEO (for EARTH).
    const earthTargets = targets.filter(t => ['MEO', 'HEO'].includes(t.id));
    expect(earthTargets.length).toBe(2);
    expect(targets.find(t => t.id === 'LEO')).toBeUndefined();
  });

  it('getRepositionTargets returns empty for decommissioned satellite', () => {
    state.satelliteNetwork.satellites[0].health = 0;
    const targets = getRepositionTargets(state, satId);
    expect(targets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Network summary with tier info
// ---------------------------------------------------------------------------

describe('Satellite Network — getNetworkSummary with tiers', () => {
  let state: GameState;
  beforeEach(() => {
    state = freshState();
    state.facilities[FacilityId.SATELLITE_OPS].tier = 2;
    deploySatHelper(state, 'satellite-comm', LEO_ELEMENTS);
  });

  it('includes tier in summary', () => {
    const summary = getNetworkSummary(state);
    expect(summary.tier).toBe(2);
  });

  it('includes leased count and income', () => {
    state.satelliteNetwork.satellites[0].leased = true;
    const summary = getNetworkSummary(state);
    expect(summary.leasedCount).toBe(1);
    expect(summary.totalLeaseIncome).toBe(SATELLITE_LEASE_INCOME[SatelliteType.COMMUNICATION]);
  });

  it('shows zero lease income when nothing leased', () => {
    const summary = getNetworkSummary(state);
    expect(summary.leasedCount).toBe(0);
    expect(summary.totalLeaseIncome).toBe(0);
  });
});
