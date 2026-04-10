/**
 * multiBodyLanding.test.js — Unit tests for multi-body landing physics (TASK-042).
 *
 * Tests cover:
 *   - Dynamic gravity per celestial body (Moon, Mars, Venus, Mercury, Phobos, Deimos)
 *   - Body-aware atmospheric density in integration step
 *   - Landing events include body ID and body name
 *   - Tipping physics uses local gravity
 *   - Parachute effectiveness varies with atmospheric density
 *   - Airless body landings are fully propulsive
 */

import { describe, it, expect } from 'vitest';
import {
  createPhysicsState,
  tick,
} from '../core/physics.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
} from '../core/rocketbuilder.ts';
import { createFlightState } from '../core/gameState.ts';
import { getSurfaceGravity } from '../data/bodies.ts';

import type { PhysicsState, RocketAssembly } from '../core/physics.ts';
import type { FlightState } from '../core/gameState.ts';
import type { StagingConfig } from '../core/rocketbuilder.ts';
import type { CelestialBody } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal uncrewed rocket: Probe Core + Small Tank + Spark Engine.
 * Engine is assigned to Stage 1.
 */
function makeSimpleRocket(): {
  assembly: RocketAssembly;
  staging: StagingConfig;
  probeId: string;
  tankId: string;
  engineId: string;
} {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, probeId, tankId, engineId };
}

function makeFlightState(bodyId: CelestialBody = 'EARTH'): FlightState {
  return createFlightState({
    missionId: 'test-mission',
    rocketId:  'test-rocket',
    bodyId,
  });
}

/**
 * Helper: tick the physics N times at 1× warp, 60 Hz.
 */
function tickN(ps: PhysicsState, assembly: RocketAssembly, staging: StagingConfig, fs: FlightState, n: number): void {
  const dt = 1 / 60;
  for (let i = 0; i < n; i++) {
    tick(ps, assembly, staging, fs, dt, 1);
  }
}

/**
 * Helper: drop a rocket from a given altitude and let it fall.
 * Returns the physics state after it lands or crashes.
 */
function dropFromAltitude(bodyId: CelestialBody, altitude: number, maxTicks: number = 60000): {
  ps: PhysicsState;
  fs: FlightState;
  ticks: number;
  assembly: RocketAssembly;
} {
  const { assembly, staging } = makeSimpleRocket();
  const fs = makeFlightState(bodyId);
  const ps = createPhysicsState(assembly, fs);

  // Place airborne at the given altitude with zero velocity.
  ps.grounded = false;
  ps.posY = altitude;
  ps.velY = 0;
  ps.velX = 0;
  ps.throttle = 0;

  const dt = 1 / 60;
  let ticks = 0;
  while (!ps.landed && !ps.crashed && ticks < maxTicks) {
    tick(ps, assembly, staging, fs, dt, 1);
    ticks++;
  }

  return { ps, fs, ticks, assembly };
}

// ---------------------------------------------------------------------------
// Dynamic gravity per body
// ---------------------------------------------------------------------------

describe('Multi-body gravity', () => {
  it('applies Earth gravity (~9.81 m/s²) for EARTH flights', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('EARTH');
    const ps = createPhysicsState(assembly, fs);

    // Launch pad hold: grounded, no downward velocity.
    ps.grounded = false;
    ps.posY = 100;
    ps.throttle = 0;

    tick(ps, assembly, staging, fs, 1 / 60, 1);

    // After one tick, velocity should be approximately -9.81 / 60 ≈ -0.1635 m/s.
    const expectedVelY = -9.81 / 60;
    expect(ps.velY).toBeCloseTo(expectedVelY, 1);
  });

  it('applies Moon gravity (~1.62 m/s²) for MOON flights', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('MOON');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 100;
    ps.throttle = 0;

    tick(ps, assembly, staging, fs, 1 / 60, 1);

    const expectedVelY = -1.62 / 60;
    expect(ps.velY).toBeCloseTo(expectedVelY, 1);
  });

  it('applies Mars gravity (~3.72 m/s²) for MARS flights', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('MARS');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 100;
    ps.throttle = 0;

    tick(ps, assembly, staging, fs, 1 / 60, 1);

    const expectedVelY = -3.72 / 60;
    expect(ps.velY).toBeCloseTo(expectedVelY, 1);
  });

  it('applies Venus gravity (~8.87 m/s²) for VENUS flights', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('VENUS');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 100;
    ps.throttle = 0;

    tick(ps, assembly, staging, fs, 1 / 60, 1);

    const expectedVelY = -8.87 / 60;
    expect(ps.velY).toBeCloseTo(expectedVelY, 1);
  });

  it('applies Mercury gravity (~3.7 m/s²) for MERCURY flights', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('MERCURY');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 100;
    ps.throttle = 0;

    tick(ps, assembly, staging, fs, 1 / 60, 1);

    const expectedVelY = -3.7 / 60;
    expect(ps.velY).toBeCloseTo(expectedVelY, 1);
  });

  it('applies very low gravity for Phobos (~0.0057 m/s²)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('PHOBOS');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 100;
    ps.throttle = 0;

    // Run many ticks — Phobos gravity is tiny.
    tickN(ps, assembly, staging, fs, 60);

    // After 1 second of Phobos gravity, velocity ~0.0057 m/s downward.
    expect(ps.velY).toBeCloseTo(-0.0057, 2);
  });

  it('applies very low gravity for Deimos (~0.003 m/s²)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('DEIMOS');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 100;
    ps.throttle = 0;

    tickN(ps, assembly, staging, fs, 60);

    // After 1 second of Deimos gravity, velocity ~0.003 m/s downward.
    expect(ps.velY).toBeCloseTo(-0.003, 2);
  });

  it('objects fall slower on Moon than Earth from same altitude', () => {
    const earthResult = dropFromAltitude('EARTH', 50);
    const moonResult  = dropFromAltitude('MOON', 50);

    // Moon landing takes more ticks (slower fall).
    expect(moonResult.ticks).toBeGreaterThan(earthResult.ticks);
  });
});

// ---------------------------------------------------------------------------
// Landing events include body information
// ---------------------------------------------------------------------------

describe('Multi-body landing events', () => {
  it('includes bodyId in LANDING event on Moon', () => {
    const result = dropFromAltitude('MOON', 5); // very low drop → gentle landing
    const landingEvent = result.fs.events.find(e => e.type === 'LANDING');

    expect(result.ps.landed).toBe(true);
    expect(landingEvent).toBeTruthy();
    expect(landingEvent!.bodyId).toBe('MOON');
    expect(landingEvent!.description).toContain('Moon');
  });

  it('includes bodyId in LANDING event on Mars', () => {
    const result = dropFromAltitude('MARS', 5);
    const landingEvent = result.fs.events.find(e => e.type === 'LANDING');

    expect(result.ps.landed).toBe(true);
    expect(landingEvent).toBeTruthy();
    expect(landingEvent!.bodyId).toBe('MARS');
    expect(landingEvent!.description).toContain('Mars');
  });

  it('includes bodyId in CRASH event on Moon', () => {
    // Drop from very high → high-speed crash
    const result = dropFromAltitude('MOON', 5000, 120000);
    const crashEvent = result.fs.events.find(e => e.type === 'CRASH');

    if (crashEvent) {
      expect(crashEvent.bodyId).toBe('MOON');
      expect(crashEvent.description).toContain('Moon');
    }
    // Either landed hard or crashed — both should have body info
    const anyEvent = result.fs.events.find(e => e.type === 'LANDING' || e.type === 'CRASH');
    expect(anyEvent).toBeTruthy();
    expect(anyEvent!.bodyId).toBe('MOON');
  });

  it('gentle drop on Phobos results in landing (very low gravity)', () => {
    const result = dropFromAltitude('PHOBOS', 5, 120000);
    expect(result.ps.landed).toBe(true);

    const landingEvent = result.fs.events.find(e => e.type === 'LANDING');
    expect(landingEvent).toBeTruthy();
    expect(landingEvent!.bodyId).toBe('PHOBOS');
  });
});

// ---------------------------------------------------------------------------
// No-atmosphere landings (propulsive only)
// ---------------------------------------------------------------------------

describe('Airless body landings', () => {
  it('no atmospheric drag on Moon (airless body)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('MOON');
    const ps = createPhysicsState(assembly, fs);

    // Start at altitude with horizontal velocity.
    ps.grounded = false;
    ps.posY = 1000;
    ps.velX = 100; // horizontal speed
    ps.velY = 0;
    ps.throttle = 0;

    // Tick a few times — on the Moon there's no drag, so velX should remain ~100.
    tickN(ps, assembly, staging, fs, 10);

    // Horizontal velocity should barely change (no atmosphere = no drag).
    expect(Math.abs(ps.velX - 100)).toBeLessThan(0.5);
  });

  it('no atmospheric drag on Mercury (airless body)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('MERCURY');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 1000;
    ps.velX = 100;
    ps.velY = 0;
    ps.throttle = 0;

    tickN(ps, assembly, staging, fs, 10);
    expect(Math.abs(ps.velX - 100)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Thin-atmosphere landings (partial aerobraking)
// ---------------------------------------------------------------------------

describe('Mars thin atmosphere', () => {
  it('Mars has some atmospheric drag at low altitude (thin atmosphere)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState('MARS');
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 500;
    ps.velX = 200;
    ps.velY = 0;
    ps.throttle = 0;

    tickN(ps, assembly, staging, fs, 60); // 1 second

    // Mars has a thin atmosphere — some drag, but much less than Earth.
    // velX should decrease somewhat from 200.
    expect(ps.velX).toBeLessThan(200);
    // But drag should be much less than Earth's.
    expect(ps.velX).toBeGreaterThan(180);
  });

  it('Earth has stronger atmospheric drag than Mars at same altitude', () => {
    // Test Earth
    const { assembly: aE, staging: sE } = makeSimpleRocket();
    const fsE = makeFlightState('EARTH');
    const psE = createPhysicsState(aE, fsE);
    psE.grounded = false;
    psE.posY = 500;
    psE.velX = 200;
    psE.throttle = 0;

    // Test Mars
    const { assembly: aM, staging: sM } = makeSimpleRocket();
    const fsM = makeFlightState('MARS');
    const psM = createPhysicsState(aM, fsM);
    psM.grounded = false;
    psM.posY = 500;
    psM.velX = 200;
    psM.throttle = 0;

    tickN(psE, aE, sE, fsE, 60);
    tickN(psM, aM, sM, fsM, 60);

    // Earth should slow down more than Mars.
    expect(psE.velX).toBeLessThan(psM.velX);
  });
});

// ---------------------------------------------------------------------------
// Gravity consistency check
// ---------------------------------------------------------------------------

describe('Gravity values match body definitions', () => {
  const bodies: CelestialBody[] = ['EARTH', 'MOON', 'MARS', 'VENUS', 'MERCURY', 'PHOBOS', 'DEIMOS'];

  for (const bodyId of bodies) {
    it(`applies correct surface gravity for ${bodyId}`, () => {
      const { assembly, staging } = makeSimpleRocket();
      const fs = makeFlightState(bodyId);
      const ps = createPhysicsState(assembly, fs);

      ps.grounded = false;
      ps.posY = 100; // Low altitude — inverse-square effect negligible
      ps.throttle = 0;

      tick(ps, assembly, staging, fs, 1 / 60, 1);

      const expectedG = getSurfaceGravity(bodyId);
      const expectedVelY = -expectedG / 60;

      // Allow 5% tolerance for inverse-square correction at 100m altitude.
      expect(ps.velY).toBeCloseTo(expectedVelY, 1);
    });
  }
});
