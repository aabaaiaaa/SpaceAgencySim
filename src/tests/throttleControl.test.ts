/**
 * throttleControl.test.ts — Unit tests for the setThrottleInstant helper.
 */

import { describe, it, expect } from 'vitest';
import { setThrottleInstant } from '../core/throttleControl.ts';
import type { PhysicsState } from '../core/physics.ts';

function makePs(overrides: Partial<PhysicsState> = {}): PhysicsState {
  return {
    throttle: 0.5,
    throttleMode: 'twr',
    targetTWR: 1.1,
    ...overrides,
  } as PhysicsState;
}

describe('setThrottleInstant', () => {
  it('sets throttle to 0 and targetTWR to 0 in twr mode', () => {
    const ps = makePs({ throttleMode: 'twr', throttle: 0.7, targetTWR: 1.5 });
    setThrottleInstant(ps, 0);
    expect(ps.throttle).toBe(0);
    expect(ps.targetTWR).toBe(0);
  });

  it('sets throttle to 1 and targetTWR to Infinity in twr mode', () => {
    const ps = makePs({ throttleMode: 'twr', throttle: 0.3, targetTWR: 1.5 });
    setThrottleInstant(ps, 1);
    expect(ps.throttle).toBe(1);
    expect(ps.targetTWR).toBe(Infinity);
  });

  it('sets throttle to 0 in absolute mode without touching targetTWR', () => {
    const ps = makePs({ throttleMode: 'absolute', throttle: 0.7, targetTWR: 1.5 });
    setThrottleInstant(ps, 0);
    expect(ps.throttle).toBe(0);
    expect(ps.targetTWR).toBe(1.5);
  });

  it('sets throttle to 1 in absolute mode without touching targetTWR', () => {
    const ps = makePs({ throttleMode: 'absolute', throttle: 0.3, targetTWR: 1.5 });
    setThrottleInstant(ps, 1);
    expect(ps.throttle).toBe(1);
    expect(ps.targetTWR).toBe(1.5);
  });
});
