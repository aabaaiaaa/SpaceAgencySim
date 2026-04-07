// @ts-nocheck
/**
 * trackingStationTiers.test.js — Unit tests for Tracking Station facility tiers (TASK-035).
 *
 * Tests cover:
 *   - TRACKING_STATION_TIER_FEATURES constant validation
 *   - FACILITY_UPGRADE_DEFS for TRACKING_STATION
 *   - Map view availability gated by Tracking Station
 *   - Tier-gated helper functions (solar system map, debris, weather, transfer)
 *   - Allowed map zoom levels per tier
 */

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  FacilityId,
  TRACKING_STATION_TIER_FEATURES,
  FACILITY_UPGRADE_DEFS,
} from '../core/constants.ts';
import {
  isMapViewAvailable,
  getTrackingStationTier,
  isSolarSystemMapAvailable,
  isDebrisTrackingAvailable,
  isWeatherPredictionAvailable,
  isTransferPlanningAvailable,
  isDeepSpaceCommsAvailable,
  getAllowedMapZooms,
  MapZoom,
} from '../core/mapView.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeState(tier = 0) {
  const state = createGameState();
  if (tier > 0) {
    state.facilities[FacilityId.TRACKING_STATION] = { built: true, tier };
  }
  return state;
}

// ---------------------------------------------------------------------------
// TRACKING_STATION_TIER_FEATURES constant
// ---------------------------------------------------------------------------

describe('TRACKING_STATION_TIER_FEATURES', () => {
  it('defines features for tiers 1, 2, and 3', () => {
    expect(TRACKING_STATION_TIER_FEATURES[1]).toBeDefined();
    expect(TRACKING_STATION_TIER_FEATURES[2]).toBeDefined();
    expect(TRACKING_STATION_TIER_FEATURES[3]).toBeDefined();
  });

  it('each tier has a label and features array', () => {
    for (const tier of [1, 2, 3]) {
      const info = TRACKING_STATION_TIER_FEATURES[tier];
      expect(typeof info.label).toBe('string');
      expect(info.label.length).toBeGreaterThan(0);
      expect(Array.isArray(info.features)).toBe(true);
      expect(info.features.length).toBeGreaterThan(0);
    }
  });

  it('Tier 1 is "Basic" with local map view', () => {
    expect(TRACKING_STATION_TIER_FEATURES[1].label).toBe('Basic');
    expect(TRACKING_STATION_TIER_FEATURES[1].features.some(f => /local/i.test(f))).toBe(true);
  });

  it('Tier 2 is "Advanced" with solar system and debris tracking', () => {
    expect(TRACKING_STATION_TIER_FEATURES[2].label).toBe('Advanced');
    expect(TRACKING_STATION_TIER_FEATURES[2].features.some(f => /solar system/i.test(f))).toBe(true);
    expect(TRACKING_STATION_TIER_FEATURES[2].features.some(f => /debris/i.test(f))).toBe(true);
  });

  it('Tier 3 is "Deep Space" with deep space comms and transfer planning', () => {
    expect(TRACKING_STATION_TIER_FEATURES[3].label).toBe('Deep Space');
    expect(TRACKING_STATION_TIER_FEATURES[3].features.some(f => /deep space/i.test(f))).toBe(true);
    expect(TRACKING_STATION_TIER_FEATURES[3].features.some(f => /transfer/i.test(f))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// FACILITY_UPGRADE_DEFS — TRACKING_STATION
// ---------------------------------------------------------------------------

describe('FACILITY_UPGRADE_DEFS — TRACKING_STATION', () => {
  const def = FACILITY_UPGRADE_DEFS[FacilityId.TRACKING_STATION];

  it('exists in FACILITY_UPGRADE_DEFS', () => {
    expect(def).toBeDefined();
  });

  it('has maxTier 3', () => {
    expect(def.maxTier).toBe(3);
  });

  it('Tier 2 costs $500,000', () => {
    expect(def.tiers[2].moneyCost).toBe(500_000);
    expect(def.tiers[2].scienceCost).toBe(0);
  });

  it('Tier 3 costs $1,000,000', () => {
    expect(def.tiers[3].moneyCost).toBe(1_000_000);
    expect(def.tiers[3].scienceCost).toBe(0);
  });

  it('Tier 2 description mentions solar system and debris', () => {
    expect(def.tiers[2].description).toMatch(/solar system/i);
    expect(def.tiers[2].description).toMatch(/debris/i);
  });

  it('Tier 3 description mentions deep space', () => {
    expect(def.tiers[3].description).toMatch(/deep space/i);
  });
});

// ---------------------------------------------------------------------------
// Map view availability
// ---------------------------------------------------------------------------

describe('isMapViewAvailable', () => {
  it('returns false when Tracking Station is not built', () => {
    const state = makeState(0);
    expect(isMapViewAvailable(state)).toBe(false);
  });

  it('returns true when Tracking Station is built (tier 1)', () => {
    const state = makeState(1);
    expect(isMapViewAvailable(state)).toBe(true);
  });

  it('returns true at higher tiers', () => {
    expect(isMapViewAvailable(makeState(2))).toBe(true);
    expect(isMapViewAvailable(makeState(3))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getTrackingStationTier
// ---------------------------------------------------------------------------

describe('getTrackingStationTier', () => {
  it('returns 0 when not built', () => {
    expect(getTrackingStationTier(makeState(0))).toBe(0);
  });

  it('returns 1 at tier 1', () => {
    expect(getTrackingStationTier(makeState(1))).toBe(1);
  });

  it('returns 2 at tier 2', () => {
    expect(getTrackingStationTier(makeState(2))).toBe(2);
  });

  it('returns 3 at tier 3', () => {
    expect(getTrackingStationTier(makeState(3))).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tier-gated capability checks
// ---------------------------------------------------------------------------

describe('isSolarSystemMapAvailable', () => {
  it('returns false at tier 0 and 1', () => {
    expect(isSolarSystemMapAvailable(makeState(0))).toBe(false);
    expect(isSolarSystemMapAvailable(makeState(1))).toBe(false);
  });

  it('returns true at tier 2+', () => {
    expect(isSolarSystemMapAvailable(makeState(2))).toBe(true);
    expect(isSolarSystemMapAvailable(makeState(3))).toBe(true);
  });
});

describe('isDebrisTrackingAvailable', () => {
  it('returns false at tier 0 and 1', () => {
    expect(isDebrisTrackingAvailable(makeState(0))).toBe(false);
    expect(isDebrisTrackingAvailable(makeState(1))).toBe(false);
  });

  it('returns true at tier 2+', () => {
    expect(isDebrisTrackingAvailable(makeState(2))).toBe(true);
    expect(isDebrisTrackingAvailable(makeState(3))).toBe(true);
  });
});

describe('isWeatherPredictionAvailable', () => {
  it('returns false at tier 0 and 1', () => {
    expect(isWeatherPredictionAvailable(makeState(0))).toBe(false);
    expect(isWeatherPredictionAvailable(makeState(1))).toBe(false);
  });

  it('returns true at tier 2+', () => {
    expect(isWeatherPredictionAvailable(makeState(2))).toBe(true);
    expect(isWeatherPredictionAvailable(makeState(3))).toBe(true);
  });
});

describe('isTransferPlanningAvailable', () => {
  it('returns false at tier 0, 1, and 2', () => {
    expect(isTransferPlanningAvailable(makeState(0))).toBe(false);
    expect(isTransferPlanningAvailable(makeState(1))).toBe(false);
    expect(isTransferPlanningAvailable(makeState(2))).toBe(false);
  });

  it('returns true at tier 3', () => {
    expect(isTransferPlanningAvailable(makeState(3))).toBe(true);
  });
});

describe('isDeepSpaceCommsAvailable', () => {
  it('returns false at tier 0, 1, and 2', () => {
    expect(isDeepSpaceCommsAvailable(makeState(0))).toBe(false);
    expect(isDeepSpaceCommsAvailable(makeState(1))).toBe(false);
    expect(isDeepSpaceCommsAvailable(makeState(2))).toBe(false);
  });

  it('returns true at tier 3', () => {
    expect(isDeepSpaceCommsAvailable(makeState(3))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getAllowedMapZooms
// ---------------------------------------------------------------------------

describe('getAllowedMapZooms', () => {
  it('Tier 0 returns only ORBIT_DETAIL and LOCAL_BODY', () => {
    const zooms = getAllowedMapZooms(makeState(0));
    expect(zooms).toContain(MapZoom.ORBIT_DETAIL);
    expect(zooms).toContain(MapZoom.LOCAL_BODY);
    expect(zooms).not.toContain(MapZoom.SOLAR_SYSTEM);
    expect(zooms).not.toContain(MapZoom.CRAFT_TO_TARGET);
  });

  it('Tier 1 returns only ORBIT_DETAIL and LOCAL_BODY', () => {
    const zooms = getAllowedMapZooms(makeState(1));
    expect(zooms).toContain(MapZoom.ORBIT_DETAIL);
    expect(zooms).toContain(MapZoom.LOCAL_BODY);
    expect(zooms).not.toContain(MapZoom.SOLAR_SYSTEM);
    expect(zooms).not.toContain(MapZoom.CRAFT_TO_TARGET);
  });

  it('Tier 2 returns all zoom levels', () => {
    const zooms = getAllowedMapZooms(makeState(2));
    expect(zooms).toContain(MapZoom.ORBIT_DETAIL);
    expect(zooms).toContain(MapZoom.LOCAL_BODY);
    expect(zooms).toContain(MapZoom.CRAFT_TO_TARGET);
    expect(zooms).toContain(MapZoom.SOLAR_SYSTEM);
  });

  it('Tier 3 returns all zoom levels', () => {
    const zooms = getAllowedMapZooms(makeState(3));
    expect(zooms.length).toBe(4);
  });
});
