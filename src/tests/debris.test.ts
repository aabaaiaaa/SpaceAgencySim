/**
 * debris.test.ts — Focused unit tests for src/core/debris.ts (TASK-045).
 *
 * Covers:
 *   - createDebrisFromParts(): output shape, initial physics state, state
 *     transfer (fuel, firing engines, deployed parts, heat), parent cleanup.
 *   - resetDebrisIdCounter(): restarts numbering at debris-1.
 *   - nextDebrisId(): monotonic within a flight.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDebrisFromParts,
  resetDebrisIdCounter,
  nextDebrisId,
} from '../core/debris.ts';
import { createPhysicsState } from '../core/physics.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
} from '../core/rocketbuilder.ts';
import { createFlightState } from '../core/gameState.ts';

import type { PhysicsState } from '../core/physics.ts';
import type { RocketAssembly } from '../core/rocketbuilder.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Rocket {
  assembly: RocketAssembly;
  probeId: string;
  tankId: string;
  engineId: string;
}

/** Probe Core + Small Tank + Spark Engine, fully connected. */
function makeRocket(): Rocket {
  const assembly = createRocketAssembly();
  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  return { assembly, probeId, tankId, engineId };
}

function makePhysicsFixture(assembly: RocketAssembly): PhysicsState {
  return createPhysicsState(assembly, createFlightState({ missionId: 'test', rocketId: 'test' }));
}

// ---------------------------------------------------------------------------
// nextDebrisId — monotonic within a flight
// ---------------------------------------------------------------------------

describe('nextDebrisId()', () => {
  beforeEach(() => {
    resetDebrisIdCounter();
  });

  it('returns sequential IDs starting at debris-1 @smoke', () => {
    expect(nextDebrisId()).toBe('debris-1');
    expect(nextDebrisId()).toBe('debris-2');
    expect(nextDebrisId()).toBe('debris-3');
  });

  it('produces monotonically increasing IDs within a flight', () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(nextDebrisId());
    expect(ids).toEqual(['debris-1', 'debris-2', 'debris-3', 'debris-4', 'debris-5']);
  });
});

// ---------------------------------------------------------------------------
// resetDebrisIdCounter
// ---------------------------------------------------------------------------

describe('resetDebrisIdCounter()', () => {
  it('restarts numbering at debris-1', () => {
    resetDebrisIdCounter();
    expect(nextDebrisId()).toBe('debris-1');
    nextDebrisId();
    nextDebrisId();

    resetDebrisIdCounter();
    expect(nextDebrisId()).toBe('debris-1');
  });

  it('is idempotent when called repeatedly before any allocation', () => {
    resetDebrisIdCounter();
    resetDebrisIdCounter();
    resetDebrisIdCounter();
    expect(nextDebrisId()).toBe('debris-1');
  });
});

// ---------------------------------------------------------------------------
// createDebrisFromParts — output shape & initial physics state
// ---------------------------------------------------------------------------

describe('createDebrisFromParts()', () => {
  beforeEach(() => {
    resetDebrisIdCounter();
  });

  it('returns a DebrisState with a fresh debris-N id', () => {
    const { assembly, tankId, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);

    const d = createDebrisFromParts(ps, [tankId, engineId], assembly);
    expect(d.id).toBe('debris-1');
  });

  it('increments the debris ID counter on each call', () => {
    const { assembly, tankId, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);

    const first  = createDebrisFromParts(ps, [tankId],   assembly);
    const second = createDebrisFromParts(ps, [engineId], assembly);

    expect(first.id).toBe('debris-1');
    expect(second.id).toBe('debris-2');
  });

  it('copies parent position, velocity, and angle into initial debris state', () => {
    const { assembly, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);
    ps.posX  =  123;
    ps.posY  = 4567;
    ps.velX  =    8;
    ps.velY  =   -9;
    ps.angle =  0.5;

    const d = createDebrisFromParts(ps, [engineId], assembly);

    expect(d.posX).toBe(123);
    expect(d.posY).toBe(4567);
    expect(d.velX).toBe(8);
    expect(d.velY).toBe(-9);
    expect(d.angle).toBe(0.5);
  });

  it('initialises lifecycle flags to not-landed / not-crashed / not-tipping', () => {
    const { assembly, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);

    const d = createDebrisFromParts(ps, [engineId], assembly);

    expect(d.landed).toBe(false);
    expect(d.crashed).toBe(false);
    expect(d.isTipping).toBe(false);
    expect(d.tippingContactX).toBe(0);
    expect(d.tippingContactY).toBe(0);
  });

  it('sets throttle to 1.0 (SRBs ignore throttle on debris)', () => {
    const { assembly, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);
    ps.throttle = 0.42;

    const d = createDebrisFromParts(ps, [engineId], assembly);

    expect(d.throttle).toBe(1.0);
  });

  it('sets a non-zero collisionCooldown to avoid self-collision on separation', () => {
    const { assembly, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);

    const d = createDebrisFromParts(ps, [engineId], assembly);

    expect(d.collisionCooldown).toBeDefined();
    expect(d.collisionCooldown!).toBeGreaterThan(0);
  });

  it('produces a finite angularVelocity even when parent ps.angularVelocity is NaN', () => {
    const { assembly, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);
    ps.angularVelocity = Number.NaN;

    const d = createDebrisFromParts(ps, [engineId], assembly);

    expect(Number.isFinite(d.angularVelocity)).toBe(true);
  });

  it('populates activeParts with the supplied part IDs', () => {
    const { assembly, tankId, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);

    const d = createDebrisFromParts(ps, [tankId, engineId], assembly);

    expect(d.activeParts.has(tankId)).toBe(true);
    expect(d.activeParts.has(engineId)).toBe(true);
    expect(d.activeParts.size).toBe(2);
  });

  it('removes transferred parts from the parent ps.activeParts set', () => {
    const { assembly, probeId, tankId, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);

    expect(ps.activeParts.has(tankId)).toBe(true);
    expect(ps.activeParts.has(engineId)).toBe(true);

    createDebrisFromParts(ps, [tankId, engineId], assembly);

    expect(ps.activeParts.has(tankId)).toBe(false);
    expect(ps.activeParts.has(engineId)).toBe(false);
    // Parts not in the debris set are untouched.
    expect(ps.activeParts.has(probeId)).toBe(true);
  });

  it('transfers fuel from ps.fuelStore into the new debris.fuelStore', () => {
    const { assembly, tankId, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);
    ps.fuelStore.set(tankId, 777);

    const d = createDebrisFromParts(ps, [tankId, engineId], assembly);

    expect(d.fuelStore.get(tankId)).toBe(777);
  });

  it('transfers heat accumulation from ps.heatMap into debris.heatMap', () => {
    const { assembly, tankId, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);
    ps.heatMap.set(engineId, 42);

    const d = createDebrisFromParts(ps, [engineId, tankId], assembly);

    expect(d.heatMap.get(engineId)).toBe(42);
  });

  it('does not carry liquid-engine firing state onto debris (liquid engines flame out)', () => {
    const { assembly, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);
    ps.firingEngines.add(engineId);

    const d = createDebrisFromParts(ps, [engineId], assembly);

    // Liquid engines immediately flame out on debris — no command module.
    expect(d.firingEngines.has(engineId)).toBe(false);
    // And the parent loses its firing record too.
    expect(ps.firingEngines.has(engineId)).toBe(false);
  });

  it('transfers deployedParts flags into the debris', () => {
    const { assembly, engineId } = makeRocket();
    const ps = makePhysicsFixture(assembly);
    ps.deployedParts.add(engineId);

    const d = createDebrisFromParts(ps, [engineId], assembly);

    expect(d.deployedParts.has(engineId)).toBe(true);
  });
});
