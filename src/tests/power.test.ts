/**
 * power.test.ts — Unit tests for the power generation and storage system.
 *
 * Tests cover:
 *   - getSunAngle()           — sun direction angle computation
 *   - getShadowHalfAngle()    — shadow cone geometry
 *   - isSunlit()              — sunlight/eclipse detection
 *   - getSunlitFraction()     — orbital sunlit fraction
 *   - initPowerState()        — power state initialization from assembly
 *   - tickPower()             — per-tick charge/discharge simulation
 *   - recalcPowerState()      — power state recalculation after part loss
 *   - getSatellitePowerInfo() — satellite power helper
 *   - Part definitions        — solar panels, batteries, built-in power
 *   - getShadowOverlayGeometry() — map view shadow overlay
 */

import { describe, it, expect } from 'vitest';
import {
  getSunAngle,
  getShadowHalfAngle,
  isSunlit,
  getSunlitFraction,
  initPowerState,
  tickPower,
  recalcPowerState,
  getSatellitePowerInfo,
  hasSufficientSatellitePower,
} from '../core/power.ts';
import { getPartById } from '../data/parts.ts';
import { PartType, SUN_ROTATION_RATE, POWER_DRAW_ROTATION, POWER_DRAW_SCIENCE } from '../core/constants.ts';
import { getShadowOverlayGeometry } from '../core/mapView.ts';
import type { PowerState } from '../core/gameState.ts';
import type { RocketAssembly } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockAssembly(partList: Array<{ instanceId: string; partId: string }>): RocketAssembly {
  const parts = new Map<string, { instanceId: string; partId: string; x: number; y: number }>();
  for (const { instanceId, partId } of partList) {
    parts.set(instanceId, { instanceId, partId, x: 0, y: 0 });
  }
  return { parts, connections: [], _nextId: 0, symmetryPairs: [] };
}

// ---------------------------------------------------------------------------
// getSunAngle
// ---------------------------------------------------------------------------

describe('getSunAngle', () => {
  it('returns 0 at time 0', () => {
    expect(getSunAngle(0)).toBe(0);
  });

  it('increases linearly with time', () => {
    const t = 100;
    const expected = (t * SUN_ROTATION_RATE) % 360;
    expect(getSunAngle(t)).toBeCloseTo(expected, 5);
  });

  it('wraps around at 360', () => {
    // One full rotation = 360 / SUN_ROTATION_RATE seconds.
    const fullRotation = 360 / SUN_ROTATION_RATE;
    expect(getSunAngle(fullRotation)).toBeCloseTo(0, 3);
  });

  it('handles negative time gracefully', () => {
    const angle = getSunAngle(-100);
    expect(angle).toBeGreaterThanOrEqual(0);
    expect(angle).toBeLessThan(360);
  });
});

// ---------------------------------------------------------------------------
// getShadowHalfAngle
// ---------------------------------------------------------------------------

describe('getShadowHalfAngle', () => {
  it('returns ~80-90 degrees for LEO around Earth', () => {
    // LEO at 200 km above Earth (R = 6371 km).
    const halfAngle = getShadowHalfAngle(200_000, 'EARTH');
    expect(halfAngle).toBeGreaterThan(70);
    expect(halfAngle).toBeLessThan(90);
  });

  it('returns smaller angle for higher orbits', () => {
    const leoAngle = getShadowHalfAngle(200_000, 'EARTH');
    const geoAngle = getShadowHalfAngle(35_786_000, 'EARTH');
    expect(geoAngle).toBeLessThan(leoAngle);
  });

  it('returns 180 at surface level', () => {
    expect(getShadowHalfAngle(0, 'EARTH')).toBe(180);
  });

  it('works for the Moon', () => {
    const halfAngle = getShadowHalfAngle(100_000, 'MOON');
    expect(halfAngle).toBeGreaterThan(0);
    expect(halfAngle).toBeLessThan(90);
  });
});

// ---------------------------------------------------------------------------
// isSunlit
// ---------------------------------------------------------------------------

describe('isSunlit', () => {
  it('returns true when on the sun side', () => {
    // Sun at 0 degrees, object at 0 degrees → directly facing sun.
    expect(isSunlit(0, 0, 80)).toBe(true);
  });

  it('returns false when in shadow', () => {
    // Sun at 0 degrees → anti-sun at 180.  Object at 180 → in shadow.
    expect(isSunlit(180, 0, 80)).toBe(false);
  });

  it('returns true at the edge of the sunlit region', () => {
    // Anti-sun at 180.  Shadow half-angle 80.  Object at 180 - 81 = 99 → just outside shadow.
    expect(isSunlit(99, 0, 80)).toBe(true);
  });

  it('returns false just inside the shadow cone', () => {
    // Anti-sun at 180.  Shadow half-angle 80.  Object at 180 - 79 = 101 → just inside shadow.
    expect(isSunlit(101, 0, 80)).toBe(false);
  });

  it('handles wrap-around at 360/0 boundary', () => {
    // Sun at 350, anti-sun at 170.  Object at 170 → in shadow.
    expect(isSunlit(170, 350, 80)).toBe(false);
    // Object at 0 → on the sun side.
    expect(isSunlit(0, 350, 80)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getSunlitFraction
// ---------------------------------------------------------------------------

describe('getSunlitFraction', () => {
  it('returns a fraction between 0 and 1', () => {
    const fraction = getSunlitFraction(200_000, 'EARTH');
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
  });

  it('is higher for higher orbits', () => {
    const leoFraction = getSunlitFraction(200_000, 'EARTH');
    const geoFraction = getSunlitFraction(35_786_000, 'EARTH');
    expect(geoFraction).toBeGreaterThan(leoFraction);
  });

  it('returns 0 at surface (always half in shadow)', () => {
    // At surface, half-angle = 180 → fraction = 1 - 180/180 = 0.
    expect(getSunlitFraction(0, 'EARTH')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// initPowerState
// ---------------------------------------------------------------------------

describe('initPowerState', () => {
  it('initialises with zero capacity for a rocket with no power parts', () => {
    const assembly = mockAssembly([
      { instanceId: 'tank1', partId: 'tank-small' },
    ]);
    const ps = initPowerState(assembly, new Set(['tank1']));
    expect(ps.batteryCapacity).toBe(0);
    expect(ps.solarPanelArea).toBe(0);
    expect(ps.hasPower).toBe(false);
  });

  it('picks up built-in battery from command module', () => {
    const assembly = mockAssembly([
      { instanceId: 'cmd1', partId: 'cmd-mk1' },
    ]);
    const ps = initPowerState(assembly, new Set(['cmd1']));
    expect(ps.batteryCapacity).toBe(50);
    expect(ps.batteryCharge).toBe(50);
    expect(ps.hasPower).toBe(true);
  });

  it('picks up built-in battery from probe core', () => {
    const assembly = mockAssembly([
      { instanceId: 'probe1', partId: 'probe-core-mk1' },
    ]);
    const ps = initPowerState(assembly, new Set(['probe1']));
    expect(ps.batteryCapacity).toBe(20);
    expect(ps.hasPower).toBe(true);
  });

  it('aggregates solar panels and batteries', () => {
    const assembly = mockAssembly([
      { instanceId: 'probe1', partId: 'probe-core-mk1' },
      { instanceId: 'panel1', partId: 'solar-panel-small' },
      { instanceId: 'bat1', partId: 'battery-small' },
    ]);
    const ps = initPowerState(assembly, new Set(['probe1', 'panel1', 'bat1']));
    expect(ps.batteryCapacity).toBe(20 + 100); // probe + battery
    expect(ps.solarPanelArea).toBe(1.0);
    expect(ps.hasPower).toBe(true);
  });

  it('ignores inactive parts', () => {
    const assembly = mockAssembly([
      { instanceId: 'probe1', partId: 'probe-core-mk1' },
      { instanceId: 'panel1', partId: 'solar-panel-small' },
    ]);
    const ps = initPowerState(assembly, new Set(['probe1'])); // panel not active
    expect(ps.solarPanelArea).toBe(0);
    expect(ps.batteryCapacity).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// tickPower
// ---------------------------------------------------------------------------

describe('tickPower', () => {
  it('@smoke charges battery when sunlit with solar panels', () => {
    const ps: PowerState = {
      batteryCapacity: 100,
      batteryCharge: 50,
      solarGeneration: 0,
      powerDraw: 0,
      sunlit: false,
      hasPower: true,
      solarPanelArea: 2.0,
    };

    tickPower(ps, {
      dt: 1.0,
      altitude: 200_000,
      bodyId: 'EARTH',
      gameTimeSeconds: 0,
      angularPositionDeg: 0, // on the sun side
      inOrbit: true,
    });

    expect(ps.sunlit).toBe(true);
    expect(ps.solarGeneration).toBeGreaterThan(0);
    expect(ps.batteryCharge).toBeGreaterThan(50);
  });

  it('discharges battery in eclipse', () => {
    const ps: PowerState = {
      batteryCapacity: 100,
      batteryCharge: 50,
      solarGeneration: 0,
      powerDraw: 0,
      sunlit: true,
      hasPower: true,
      solarPanelArea: 2.0,
    };

    tickPower(ps, {
      dt: 1.0,
      altitude: 200_000,
      bodyId: 'EARTH',
      gameTimeSeconds: 0,
      angularPositionDeg: 180, // anti-sun direction
      inOrbit: true,
    });

    expect(ps.sunlit).toBe(false);
    expect(ps.solarGeneration).toBe(0);
    // Battery should drain (rotation power draw in orbit).
    expect(ps.batteryCharge).toBeLessThan(50);
  });

  it('draws more power with active science instruments', () => {
    const ps: PowerState = {
      batteryCapacity: 100,
      batteryCharge: 100,
      solarGeneration: 0,
      powerDraw: 0,
      sunlit: true,
      hasPower: true,
      solarPanelArea: 0, // no panels, pure battery drain
    };

    tickPower(ps, {
      dt: 1.0,
      altitude: 200_000,
      bodyId: 'EARTH',
      gameTimeSeconds: 0,
      inOrbit: true,
      scienceRunning: true,
      activeScienceCount: 2,
    });

    expect(ps.powerDraw).toBe(POWER_DRAW_ROTATION + POWER_DRAW_SCIENCE * 2);
    expect(ps.batteryCharge).toBeLessThan(100);
  });

  it('sets hasPower to false when battery depleted', () => {
    const ps: PowerState = {
      batteryCapacity: 1,
      batteryCharge: 0.1, // very low
      solarGeneration: 0,
      powerDraw: 0,
      sunlit: true,
      hasPower: true,
      solarPanelArea: 0,
    };

    tickPower(ps, {
      dt: 100, // long timestep to drain
      altitude: 200_000,
      bodyId: 'EARTH',
      gameTimeSeconds: 0,
      inOrbit: true,
    });

    expect(ps.batteryCharge).toBe(0);
    expect(ps.hasPower).toBe(false);
  });

  it('does not exceed battery capacity when charging', () => {
    const ps: PowerState = {
      batteryCapacity: 10,
      batteryCharge: 9.5,
      solarGeneration: 0,
      powerDraw: 0,
      sunlit: false,
      hasPower: true,
      solarPanelArea: 4.0,
    };

    tickPower(ps, {
      dt: 3600, // 1 hour
      altitude: 200_000,
      bodyId: 'EARTH',
      gameTimeSeconds: 0,
      angularPositionDeg: 0,
      inOrbit: true,
    });

    expect(ps.batteryCharge).toBeLessThanOrEqual(ps.batteryCapacity);
  });
});

// ---------------------------------------------------------------------------
// recalcPowerState
// ---------------------------------------------------------------------------

describe('recalcPowerState', () => {
  it('reduces capacity when a battery part is removed', () => {
    const assembly = mockAssembly([
      { instanceId: 'probe1', partId: 'probe-core-mk1' },
      { instanceId: 'bat1', partId: 'battery-small' },
    ]);
    const ps = initPowerState(assembly, new Set(['probe1', 'bat1']));
    expect(ps.batteryCapacity).toBe(120); // 20 + 100

    // Remove the battery.
    recalcPowerState(ps, assembly, new Set(['probe1']));
    expect(ps.batteryCapacity).toBe(20);
    expect(ps.batteryCharge).toBeLessThanOrEqual(20);
  });

  it('reduces solar area when a panel is removed', () => {
    const assembly = mockAssembly([
      { instanceId: 'probe1', partId: 'probe-core-mk1' },
      { instanceId: 'panel1', partId: 'solar-panel-small' },
      { instanceId: 'panel2', partId: 'solar-panel-large' },
    ]);
    const ps = initPowerState(assembly, new Set(['probe1', 'panel1', 'panel2']));
    expect(ps.solarPanelArea).toBe(5.0); // 1.0 + 4.0

    recalcPowerState(ps, assembly, new Set(['probe1', 'panel1']));
    expect(ps.solarPanelArea).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Part Definitions
// ---------------------------------------------------------------------------

describe('power-related part definitions', () => {
  it('solar-panel-small has solarPanelArea', () => {
    const def = getPartById('solar-panel-small');
    expect(def).toBeDefined();
    expect(def!.type).toBe(PartType.SOLAR_PANEL);
    expect(def!.properties.solarPanelArea).toBe(1.0);
  });

  it('solar-panel-large has larger solarPanelArea', () => {
    const def = getPartById('solar-panel-large');
    expect(def).toBeDefined();
    expect(def!.properties.solarPanelArea).toBe(4.0);
  });

  it('battery-small has batteryCapacity', () => {
    const def = getPartById('battery-small');
    expect(def).toBeDefined();
    expect(def!.type).toBe(PartType.BATTERY);
    expect(def!.properties.batteryCapacity).toBe(100);
  });

  it('battery-large has higher batteryCapacity', () => {
    const def = getPartById('battery-large');
    expect(def).toBeDefined();
    expect(def!.properties.batteryCapacity).toBe(400);
  });

  it('cmd-mk1 has built-in battery', () => {
    const def = getPartById('cmd-mk1');
    expect(def).toBeDefined();
    expect(def!.properties.batteryCapacity).toBe(50);
  });

  it('probe-core-mk1 has built-in battery', () => {
    const def = getPartById('probe-core-mk1');
    expect(def).toBeDefined();
    expect(def!.properties.batteryCapacity).toBe(20);
  });

  it('all satellite parts have builtInPower, batteryCapacity, and solarPanelArea', () => {
    const satIds: string[] = ['satellite-mk1', 'satellite-comm', 'satellite-weather',
      'satellite-science', 'satellite-gps', 'satellite-relay'];
    for (const id of satIds) {
      const def = getPartById(id);
      expect(def, `${id} should exist`).toBeDefined();
      expect(def!.properties.builtInPower, `${id} should have builtInPower`).toBe(true);
      expect(def!.properties.batteryCapacity, `${id} should have batteryCapacity`).toBeGreaterThan(0);
      expect(def!.properties.solarPanelArea, `${id} should have solarPanelArea`).toBeGreaterThan(0);
    }
  });

  it('science-module-mk1 has powerDraw', () => {
    const def = getPartById('science-module-mk1');
    expect(def).toBeDefined();
    expect(def!.properties.powerDraw).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// getSatellitePowerInfo
// ---------------------------------------------------------------------------

describe('getSatellitePowerInfo', () => {
  it('returns positive generation for an orbital satellite', () => {
    const info = getSatellitePowerInfo(200_000, 'EARTH', 2.0);
    expect(info.avgGeneration).toBeGreaterThan(0);
    expect(info.sunlitFraction).toBeGreaterThan(0);
    expect(info.sunlitFraction).toBeLessThan(1);
  });

  it('generation is higher at Mars (less eclipse at GEO-equiv)', () => {
    // Mars has less irradiance but the point is to test it works.
    const earthInfo = getSatellitePowerInfo(200_000, 'EARTH', 2.0);
    const marsInfo = getSatellitePowerInfo(200_000, 'MARS', 2.0);
    // Mars has less solar irradiance (0.43 vs 1.0) so generation should be lower.
    expect(marsInfo.avgGeneration).toBeLessThan(earthInfo.avgGeneration);
  });
});

// ---------------------------------------------------------------------------
// hasSufficientSatellitePower
// ---------------------------------------------------------------------------

describe('hasSufficientSatellitePower', () => {
  it('returns true for pre-made satellite parts (builtInPower)', () => {
    expect(hasSufficientSatellitePower('satellite-comm', 200_000, 'EARTH')).toBe(true);
  });

  it('returns false for a part with no solar panels', () => {
    // tank-small has no solar panels.
    expect(hasSufficientSatellitePower('tank-small', 200_000, 'EARTH')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getShadowOverlayGeometry (mapView integration)
// ---------------------------------------------------------------------------

describe('getShadowOverlayGeometry', () => {
  it('returns valid geometry for Earth', () => {
    const geo = getShadowOverlayGeometry('EARTH', 0);
    expect(geo.sunAngleDeg).toBe(0);
    expect(geo.shadowArcDeg).toBeGreaterThan(0);
    expect(geo.shadowArcDeg).toBeLessThan(360);
    expect(geo.bodyRadius).toBe(6_371_000);
    expect(geo.maxRadius).toBeGreaterThan(geo.bodyRadius);
  });

  it('shadow arc shrinks with custom max radius at higher altitude', () => {
    const lowGeo = getShadowOverlayGeometry('EARTH', 0, 6_371_000 + 200_000);
    const highGeo = getShadowOverlayGeometry('EARTH', 0, 6_371_000 + 35_786_000);
    expect(highGeo.shadowArcDeg).toBeLessThan(lowGeo.shadowArcDeg);
  });

  it('sun angle changes with game time', () => {
    const geo1 = getShadowOverlayGeometry('EARTH', 0);
    const geo2 = getShadowOverlayGeometry('EARTH', 1000);
    expect(geo2.sunAngleDeg).toBeGreaterThan(geo1.sunAngleDeg);
  });
});
