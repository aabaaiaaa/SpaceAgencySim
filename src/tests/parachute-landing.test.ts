// @ts-nocheck
/**
 * parachute-landing.test.js — Unit tests for post-landing parachute swing
 * and auto-stow behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  ParachuteState,
  tickLandedParachutes,
  deployParachute,
  POST_LANDING_STOW_DELAY,
} from '../core/parachute.js';

/** Create a minimal physics state with one parachute entry. */
function makePsWithChute(overrides = {}) {
  const entry = {
    state:            ParachuteState.DEPLOYED,
    deployTimer:      0,
    canopyAngle:      0,
    canopyAngularVel: 0,
    stowTimer:        0,
    ...overrides,
  };
  const ps = {
    parachuteStates: new Map([['chute1', entry]]),
  };
  return { ps, entry };
}

describe('tickLandedParachutes', () => {
  it('swings canopy angle toward PI over ~1s of ticking', () => {
    const { ps, entry } = makePsWithChute({ canopyAngle: 0 });
    const dt = 1 / 60;

    // Tick for ~1 second
    for (let i = 0; i < 60; i++) {
      tickLandedParachutes(ps, dt);
    }

    // Should have moved significantly toward PI
    expect(entry.canopyAngle).toBeGreaterThan(Math.PI * 0.8);
  });

  it('auto-stows to PACKED after POST_LANDING_STOW_DELAY seconds', () => {
    const { ps, entry } = makePsWithChute();
    const dt = 1 / 60;
    const totalTicks = Math.ceil((POST_LANDING_STOW_DELAY + 0.5) / dt);

    for (let i = 0; i < totalTicks; i++) {
      tickLandedParachutes(ps, dt);
    }

    expect(entry.state).toBe(ParachuteState.PACKED);
    expect(entry.canopyAngle).toBe(0);
    expect(entry.canopyAngularVel).toBe(0);
    expect(entry.stowTimer).toBe(0);
  });

  it('stowed parachute can be re-deployed', () => {
    const { ps, entry } = makePsWithChute();
    const dt = 1 / 60;
    const totalTicks = Math.ceil((POST_LANDING_STOW_DELAY + 0.5) / dt);

    // Stow it
    for (let i = 0; i < totalTicks; i++) {
      tickLandedParachutes(ps, dt);
    }
    expect(entry.state).toBe(ParachuteState.PACKED);

    // Re-deploy
    deployParachute(ps, 'chute1');
    expect(entry.state).toBe(ParachuteState.DEPLOYING);
  });

  it('ignores packed and failed parachutes', () => {
    const packed = {
      state: ParachuteState.PACKED, deployTimer: 0,
      canopyAngle: 0, canopyAngularVel: 0, stowTimer: 0,
    };
    const failed = {
      state: ParachuteState.FAILED, deployTimer: 0,
      canopyAngle: 0.5, canopyAngularVel: 0, stowTimer: 0,
    };
    const ps = {
      parachuteStates: new Map([['p', packed], ['f', failed]]),
    };

    tickLandedParachutes(ps, 1 / 60);

    expect(packed.canopyAngle).toBe(0);
    expect(packed.stowTimer).toBe(0);
    expect(failed.canopyAngle).toBe(0.5);
    expect(failed.stowTimer).toBe(0);
  });

  it('handles deploying chutes (stows mid-deploy)', () => {
    const { ps, entry } = makePsWithChute({
      state: ParachuteState.DEPLOYING,
      deployTimer: 2.0,
      canopyAngle: 0.3,
    });
    const dt = 1 / 60;
    const totalTicks = Math.ceil((POST_LANDING_STOW_DELAY + 0.5) / dt);

    for (let i = 0; i < totalTicks; i++) {
      tickLandedParachutes(ps, dt);
    }

    expect(entry.state).toBe(ParachuteState.PACKED);
  });

  it('canopy settles near PI before stow timer expires', () => {
    const { ps, entry } = makePsWithChute({ canopyAngle: 0 });
    const dt = 1 / 60;
    // Tick for 2 seconds — should be settled near PI but not yet stowed
    const ticks = Math.floor(2.0 / dt);

    for (let i = 0; i < ticks; i++) {
      tickLandedParachutes(ps, dt);
    }

    expect(entry.state).toBe(ParachuteState.DEPLOYED); // not yet stowed
    expect(Math.abs(entry.canopyAngle - Math.PI)).toBeLessThan(0.1);
  });
});
