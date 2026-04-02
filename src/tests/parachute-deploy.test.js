/**
 * parachute-deploy.test.js — Unit tests for parachute deployment triggers,
 * state machine transitions, drag multiplier, and context menu helpers.
 *
 * The existing parachute test files cover descent steering and post-landing
 * behaviour.  This file covers the previously untested deployment trigger
 * logic:
 *
 *   - deployParachute() state transitions and edge cases
 *   - initParachuteStates() population from assembly
 *   - tickParachutes() deploying→deployed timer and mass-safety check
 *   - tickCanopyAngles() spring/damping canopy physics
 *   - getChuteMultiplier() drag calculation by state and density
 *   - getParachuteStatus() query helper
 *   - getParachuteContextMenuItems() menu builder
 */

import { describe, it, expect } from 'vitest';
import {
  ParachuteState,
  DEPLOY_DURATION,
  LOW_DENSITY_THRESHOLD,
  initParachuteStates,
  deployParachute,
  tickParachutes,
  tickCanopyAngles,
  getChuteMultiplier,
  getParachuteStatus,
  getParachuteContextMenuItems,
} from '../core/parachute.js';
import { PartType } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal physics state with a single parachute entry.
 * Defaults to PACKED state with sensible physics values.
 */
function makePs(overrides = {}) {
  const entry = {
    state:            ParachuteState.PACKED,
    deployTimer:      0,
    canopyAngle:      0,
    canopyAngularVel: 0,
    stowTimer:        0,
    ...overrides,
  };
  return {
    parachuteStates: new Map([['chute-1', entry]]),
    activeParts:     new Set(['chute-1', 'probe-1']),
    deployedParts:   new Set(),
    posY:            5000,
    angle:           0.3,
  };
}

/**
 * Build a minimal assembly with one parachute part and one probe.
 */
function makeAssembly() {
  return {
    parts: new Map([
      ['chute-1', { partId: 'parachute-mk1' }],
      ['probe-1', { partId: 'probe-core-mk1' }],
    ]),
  };
}

/** Minimal flight state for tickParachutes. */
function makeFlightState() {
  return { events: [], timeElapsed: 42.0 };
}

// ---------------------------------------------------------------------------
// deployParachute()
// ---------------------------------------------------------------------------

describe('deployParachute', () => {
  it('transitions a packed parachute to deploying', () => {
    const ps = makePs();
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.DEPLOYING);
  });

  it('sets the deploy timer to DEPLOY_DURATION', () => {
    const ps = makePs();
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.deployTimer).toBe(DEPLOY_DURATION);
  });

  it('initialises canopy angle to the rocket angle', () => {
    const ps = makePs();
    ps.angle = 1.2;
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.canopyAngle).toBe(1.2);
  });

  it('resets canopy angular velocity to zero on deploy', () => {
    const ps = makePs({ canopyAngularVel: 5.0 });
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.canopyAngularVel).toBe(0);
  });

  it('is a no-op when the parachute is already deploying', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.5 });
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.DEPLOYING);
    expect(entry.deployTimer).toBe(0.5); // unchanged
  });

  it('is a no-op when the parachute is already deployed', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.DEPLOYED);
  });

  it('is a no-op when the parachute has failed', () => {
    const ps = makePs({ state: ParachuteState.FAILED });
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.FAILED);
  });

  it('late-initialises an entry for an unknown instance ID', () => {
    const ps = makePs();
    deployParachute(ps, 'new-chute');

    const entry = ps.parachuteStates.get('new-chute');
    expect(entry).toBeDefined();
    expect(entry.state).toBe(ParachuteState.DEPLOYING);
    expect(entry.deployTimer).toBe(DEPLOY_DURATION);
  });

  it('does nothing when parachuteStates is absent', () => {
    const ps = { parachuteStates: undefined };
    // Should not throw.
    expect(() => deployParachute(ps, 'chute-1')).not.toThrow();
  });

  it('uses angle 0 when ps.angle is undefined', () => {
    const ps = makePs();
    delete ps.angle;
    deployParachute(ps, 'chute-1');

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.canopyAngle).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// initParachuteStates()
// ---------------------------------------------------------------------------

describe('initParachuteStates', () => {
  it('creates a packed entry for each active parachute part', () => {
    const assembly = makeAssembly();
    const ps = {
      parachuteStates: new Map(),
      activeParts: new Set(['chute-1', 'probe-1']),
    };

    initParachuteStates(ps, assembly);

    expect(ps.parachuteStates.has('chute-1')).toBe(true);
    expect(ps.parachuteStates.get('chute-1').state).toBe(ParachuteState.PACKED);
  });

  it('does not create entries for non-parachute parts', () => {
    const assembly = makeAssembly();
    const ps = {
      parachuteStates: new Map(),
      activeParts: new Set(['chute-1', 'probe-1']),
    };

    initParachuteStates(ps, assembly);

    expect(ps.parachuteStates.has('probe-1')).toBe(false);
  });

  it('does not overwrite existing entries', () => {
    const assembly = makeAssembly();
    const existingEntry = {
      state: ParachuteState.DEPLOYED,
      deployTimer: 0,
      canopyAngle: 1.5,
      canopyAngularVel: 0.2,
      stowTimer: 0,
    };
    const ps = {
      parachuteStates: new Map([['chute-1', existingEntry]]),
      activeParts: new Set(['chute-1']),
    };

    initParachuteStates(ps, assembly);

    expect(ps.parachuteStates.get('chute-1').state).toBe(ParachuteState.DEPLOYED);
    expect(ps.parachuteStates.get('chute-1').canopyAngle).toBe(1.5);
  });

  it('skips parts not in activeParts', () => {
    const assembly = makeAssembly();
    const ps = {
      parachuteStates: new Map(),
      activeParts: new Set(['probe-1']), // chute-1 not active
    };

    initParachuteStates(ps, assembly);

    expect(ps.parachuteStates.has('chute-1')).toBe(false);
  });

  it('sets default values for a new entry', () => {
    const assembly = makeAssembly();
    const ps = {
      parachuteStates: new Map(),
      activeParts: new Set(['chute-1']),
    };

    initParachuteStates(ps, assembly);

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.deployTimer).toBe(0);
    expect(entry.canopyAngle).toBe(0);
    expect(entry.canopyAngularVel).toBe(0);
    expect(entry.stowTimer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tickParachutes() — deploying → deployed / failed transition
// ---------------------------------------------------------------------------

describe('tickParachutes', () => {
  it('decrements the deploy timer each tick', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: DEPLOY_DURATION });
    const assembly = makeAssembly();
    const fs = makeFlightState();
    const dt = 1 / 60;

    tickParachutes(ps, assembly, fs, dt, 500);

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.deployTimer).toBeCloseTo(DEPLOY_DURATION - dt, 5);
    expect(entry.state).toBe(ParachuteState.DEPLOYING); // not yet expired
  });

  it('transitions to DEPLOYED when timer expires and mass is safe', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    // parachute-mk1 maxSafeMass is 1200 kg; pass 500 kg
    tickParachutes(ps, assembly, fs, 0.02, 500);

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.DEPLOYED);
  });

  it('emits a PARACHUTE_DEPLOYED event on successful deployment', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 0.02, 500);

    expect(fs.events).toHaveLength(1);
    expect(fs.events[0].type).toBe('PARACHUTE_DEPLOYED');
    expect(fs.events[0].instanceId).toBe('chute-1');
    expect(fs.events[0].partName).toBe('Mk1 Parachute');
    expect(fs.events[0].altitude).toBe(5000);
  });

  it('transitions to FAILED when mass exceeds maxSafeMass', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    // parachute-mk1 maxSafeMass is 1200 kg; pass 2000 kg
    tickParachutes(ps, assembly, fs, 0.02, 2000);

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.FAILED);
  });

  it('emits a PARACHUTE_FAILED event on mass overload', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 0.02, 2000);

    expect(fs.events).toHaveLength(1);
    expect(fs.events[0].type).toBe('PARACHUTE_FAILED');
    expect(fs.events[0].description).toContain('exceeds safe limit');
  });

  it('removes the part from activeParts and deployedParts on failure', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    ps.deployedParts.add('chute-1');
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 0.02, 2000);

    expect(ps.activeParts.has('chute-1')).toBe(false);
    expect(ps.deployedParts.has('chute-1')).toBe(false);
  });

  it('does not transition packed parachutes', () => {
    const ps = makePs({ state: ParachuteState.PACKED });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 1.0, 500);

    expect(ps.parachuteStates.get('chute-1').state).toBe(ParachuteState.PACKED);
    expect(fs.events).toHaveLength(0);
  });

  it('does not transition already deployed parachutes', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 1.0, 500);

    expect(ps.parachuteStates.get('chute-1').state).toBe(ParachuteState.DEPLOYED);
    expect(fs.events).toHaveLength(0);
  });

  it('does not transition failed parachutes', () => {
    const ps = makePs({ state: ParachuteState.FAILED });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 1.0, 500);

    expect(ps.parachuteStates.get('chute-1').state).toBe(ParachuteState.FAILED);
    expect(fs.events).toHaveLength(0);
  });

  it('handles missing parachuteStates gracefully', () => {
    const ps = { parachuteStates: undefined };
    expect(() => tickParachutes(ps, makeAssembly(), makeFlightState(), 1 / 60, 500)).not.toThrow();
  });

  it('deploys at exactly mass boundary (mass === maxSafeMass)', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    // parachute-mk1 maxSafeMass is 1200 — pass exactly 1200
    tickParachutes(ps, assembly, fs, 0.02, 1200);

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.DEPLOYED); // not failed — equal is safe
  });

  it('fails when mass is just above maxSafeMass', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 0.02, 1201);

    const entry = ps.parachuteStates.get('chute-1');
    expect(entry.state).toBe(ParachuteState.FAILED);
  });

  it('uses altitude from ps.posY in events (clamped to 0)', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    ps.posY = -10; // below ground
    const assembly = makeAssembly();
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 0.02, 500);

    expect(fs.events[0].altitude).toBe(0); // clamped
  });

  it('records timeElapsed from flightState in events', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.01 });
    const assembly = makeAssembly();
    const fs = makeFlightState();
    fs.timeElapsed = 99.5;

    tickParachutes(ps, assembly, fs, 0.02, 500);

    expect(fs.events[0].time).toBe(99.5);
  });

  it('handles multiple parachutes transitioning in the same tick', () => {
    const entry1 = { state: ParachuteState.DEPLOYING, deployTimer: 0.01, canopyAngle: 0, canopyAngularVel: 0, stowTimer: 0 };
    const entry2 = { state: ParachuteState.DEPLOYING, deployTimer: 0.01, canopyAngle: 0, canopyAngularVel: 0, stowTimer: 0 };
    const ps = {
      parachuteStates: new Map([['c1', entry1], ['c2', entry2]]),
      activeParts: new Set(['c1', 'c2']),
      deployedParts: new Set(),
      posY: 3000,
    };
    const assembly = {
      parts: new Map([
        ['c1', { partId: 'parachute-mk1' }],
        ['c2', { partId: 'parachute-mk2' }],
      ]),
    };
    const fs = makeFlightState();

    tickParachutes(ps, assembly, fs, 0.02, 500);

    expect(entry1.state).toBe(ParachuteState.DEPLOYED);
    expect(entry2.state).toBe(ParachuteState.DEPLOYED);
    expect(fs.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// tickCanopyAngles() — spring/damping physics
// ---------------------------------------------------------------------------

describe('tickCanopyAngles', () => {
  it('drives canopy angle toward zero (upright)', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED, canopyAngle: 1.0, canopyAngularVel: 0 });
    const dt = 1 / 60;

    for (let i = 0; i < 120; i++) {
      tickCanopyAngles(ps, dt);
    }

    const entry = ps.parachuteStates.get('chute-1');
    expect(Math.abs(entry.canopyAngle)).toBeLessThan(0.1);
  });

  it('damps canopy angular velocity over time', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED, canopyAngle: 0, canopyAngularVel: 5.0 });
    const dt = 1 / 60;

    for (let i = 0; i < 120; i++) {
      tickCanopyAngles(ps, dt);
    }

    const entry = ps.parachuteStates.get('chute-1');
    expect(Math.abs(entry.canopyAngularVel)).toBeLessThan(0.5);
  });

  it('also ticks canopy for DEPLOYING state', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, canopyAngle: 0.8, canopyAngularVel: 0 });
    const initialAngle = 0.8;
    const dt = 1 / 60;

    tickCanopyAngles(ps, dt);

    const entry = ps.parachuteStates.get('chute-1');
    // Angle should have moved toward zero.
    expect(Math.abs(entry.canopyAngle)).toBeLessThan(initialAngle);
  });

  it('ignores PACKED parachutes', () => {
    const ps = makePs({ state: ParachuteState.PACKED, canopyAngle: 1.0 });
    tickCanopyAngles(ps, 1 / 60);

    expect(ps.parachuteStates.get('chute-1').canopyAngle).toBe(1.0); // unchanged
  });

  it('ignores FAILED parachutes', () => {
    const ps = makePs({ state: ParachuteState.FAILED, canopyAngle: 0.5 });
    tickCanopyAngles(ps, 1 / 60);

    expect(ps.parachuteStates.get('chute-1').canopyAngle).toBe(0.5); // unchanged
  });

  it('handles missing parachuteStates gracefully', () => {
    expect(() => tickCanopyAngles({ parachuteStates: undefined }, 1 / 60)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getChuteMultiplier() — drag coefficient calculation
// ---------------------------------------------------------------------------

describe('getChuteMultiplier', () => {
  it('returns 1 for a packed parachute', () => {
    const ps = makePs({ state: ParachuteState.PACKED });
    expect(getChuteMultiplier(ps, 'chute-1', 1.225)).toBe(1);
  });

  it('returns 1 for a failed parachute', () => {
    const ps = makePs({ state: ParachuteState.FAILED });
    expect(getChuteMultiplier(ps, 'chute-1', 1.225)).toBe(1);
  });

  it('returns full multiplier (80) for a deployed parachute at sea-level density', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    expect(getChuteMultiplier(ps, 'chute-1', 1.225)).toBe(80);
  });

  it('ramps linearly during deploying state', () => {
    // At 50% through deployment
    const halfTimer = DEPLOY_DURATION / 2;
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: halfTimer });

    const mult = getChuteMultiplier(ps, 'chute-1', 1.225);
    // At 50% progress: 1 + (80-1)*0.5 = 40.5
    expect(mult).toBeCloseTo(40.5, 1);
  });

  it('starts at 1 at the beginning of deployment', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: DEPLOY_DURATION });
    const mult = getChuteMultiplier(ps, 'chute-1', 1.225);
    expect(mult).toBeCloseTo(1, 1);
  });

  it('approaches full multiplier at end of deployment', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 0.001 });
    const mult = getChuteMultiplier(ps, 'chute-1', 1.225);
    expect(mult).toBeCloseTo(80, 0);
  });

  it('reduces chute effectiveness at low atmospheric density', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    const halfDensity = LOW_DENSITY_THRESHOLD / 2;

    const mult = getChuteMultiplier(ps, 'chute-1', halfDensity);
    // 1 + (80-1) * 0.5 = 40.5
    expect(mult).toBeCloseTo(40.5, 1);
  });

  it('returns 1 when density is zero (vacuum)', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    const mult = getChuteMultiplier(ps, 'chute-1', 0);
    expect(mult).toBe(1);
  });

  it('returns full multiplier at density >= threshold', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    expect(getChuteMultiplier(ps, 'chute-1', LOW_DENSITY_THRESHOLD)).toBe(80);
    expect(getChuteMultiplier(ps, 'chute-1', LOW_DENSITY_THRESHOLD * 10)).toBe(80);
  });

  it('returns 1 for an untracked instance ID', () => {
    const ps = makePs();
    expect(getChuteMultiplier(ps, 'unknown-id', 1.225)).toBe(1);
  });

  it('falls back to legacy deployedParts check when parachuteStates is absent', () => {
    const ps = { deployedParts: new Set(['chute-1']) };
    expect(getChuteMultiplier(ps, 'chute-1', 1.225)).toBe(80);
  });

  it('returns 1 from legacy fallback when not in deployedParts', () => {
    const ps = { deployedParts: new Set() };
    expect(getChuteMultiplier(ps, 'chute-1', 1.225)).toBe(1);
  });

  it('handles negative density gracefully (clamps to 0)', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    const mult = getChuteMultiplier(ps, 'chute-1', -0.5);
    // densityScale = max(0, negative / threshold) = 0, so mult = 1
    expect(mult).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getParachuteStatus()
// ---------------------------------------------------------------------------

describe('getParachuteStatus', () => {
  it('returns the current state for a tracked parachute', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING });
    expect(getParachuteStatus(ps, 'chute-1')).toBe(ParachuteState.DEPLOYING);
  });

  it('returns PACKED for an untracked instance ID', () => {
    const ps = makePs();
    expect(getParachuteStatus(ps, 'unknown')).toBe(ParachuteState.PACKED);
  });

  it('returns PACKED when parachuteStates is absent', () => {
    expect(getParachuteStatus({}, 'chute-1')).toBe(ParachuteState.PACKED);
  });

  it('returns each possible state correctly', () => {
    for (const state of Object.values(ParachuteState)) {
      const ps = makePs({ state });
      expect(getParachuteStatus(ps, 'chute-1')).toBe(state);
    }
  });
});

// ---------------------------------------------------------------------------
// getParachuteContextMenuItems()
// ---------------------------------------------------------------------------

describe('getParachuteContextMenuItems', () => {
  it('returns items only for parachute parts in activeParts', () => {
    const ps = makePs();
    const assembly = makeAssembly();

    const items = getParachuteContextMenuItems(ps, assembly);

    expect(items).toHaveLength(1);
    expect(items[0].instanceId).toBe('chute-1');
    expect(items[0].name).toBe('Mk1 Parachute');
  });

  it('marks packed parachutes as canDeploy: true', () => {
    const ps = makePs({ state: ParachuteState.PACKED });
    const assembly = makeAssembly();

    const items = getParachuteContextMenuItems(ps, assembly);

    expect(items[0].canDeploy).toBe(true);
    expect(items[0].statusLabel).toBe('Packed (ready)');
  });

  it('marks deploying parachutes as canDeploy: false with timer', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYING, deployTimer: 1.3 });
    const assembly = makeAssembly();

    const items = getParachuteContextMenuItems(ps, assembly);

    expect(items[0].canDeploy).toBe(false);
    expect(items[0].deployTimer).toBeCloseTo(1.3, 1);
    expect(items[0].statusLabel).toContain('Deploying');
  });

  it('marks deployed parachutes as canDeploy: false', () => {
    const ps = makePs({ state: ParachuteState.DEPLOYED });
    const assembly = makeAssembly();

    const items = getParachuteContextMenuItems(ps, assembly);

    expect(items[0].canDeploy).toBe(false);
    expect(items[0].statusLabel).toBe('Deployed');
    expect(items[0].deployTimer).toBeNull();
  });

  it('marks failed parachutes as canDeploy: false', () => {
    const ps = makePs({ state: ParachuteState.FAILED });
    // Failed parachutes are removed from activeParts; add it back for this test.
    ps.activeParts.add('chute-1');
    const assembly = makeAssembly();

    const items = getParachuteContextMenuItems(ps, assembly);

    expect(items[0].canDeploy).toBe(false);
    expect(items[0].statusLabel).toBe('Failed (destroyed)');
  });

  it('returns an empty array when no parachutes are active', () => {
    const ps = makePs();
    ps.activeParts.delete('chute-1');
    const assembly = makeAssembly();

    const items = getParachuteContextMenuItems(ps, assembly);

    expect(items).toHaveLength(0);
  });

  it('handles multiple parachutes', () => {
    const entry1 = { state: ParachuteState.PACKED, deployTimer: 0, canopyAngle: 0, canopyAngularVel: 0, stowTimer: 0 };
    const entry2 = { state: ParachuteState.DEPLOYED, deployTimer: 0, canopyAngle: 0, canopyAngularVel: 0, stowTimer: 0 };
    const ps = {
      parachuteStates: new Map([['c1', entry1], ['c2', entry2]]),
      activeParts: new Set(['c1', 'c2']),
      deployedParts: new Set(),
      posY: 1000,
    };
    const assembly = {
      parts: new Map([
        ['c1', { partId: 'parachute-mk1' }],
        ['c2', { partId: 'parachute-mk2' }],
      ]),
    };

    const items = getParachuteContextMenuItems(ps, assembly);

    expect(items).toHaveLength(2);
    const packed = items.find(i => i.instanceId === 'c1');
    const deployed = items.find(i => i.instanceId === 'c2');
    expect(packed.canDeploy).toBe(true);
    expect(deployed.canDeploy).toBe(false);
  });
});
