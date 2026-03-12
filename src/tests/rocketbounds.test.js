/**
 * rocketbounds.test.js — Unit tests for getRocketBounds utility.
 *
 * Tests cover:
 *   - Empty assembly returns null
 *   - Single part returns bounds matching its dimensions
 *   - Multiple parts return union bounds
 *   - Unknown part IDs are ignored gracefully
 */

import { describe, it, expect } from 'vitest';
import { getRocketBounds } from '../core/rocketvalidator.js';
import {
  createRocketAssembly,
  addPartToAssembly,
} from '../core/rocketbuilder.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// getRocketBounds()
// ---------------------------------------------------------------------------

describe('getRocketBounds()', () => {
  it('returns null for empty assembly', () => {
    const assembly = createRocketAssembly();
    expect(getRocketBounds(assembly)).toBeNull();
  });

  it('returns bounds matching single part dimensions', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const def = getPartById('probe-core-mk1');
    const bounds = getRocketBounds(assembly);

    expect(bounds).not.toBeNull();
    expect(bounds.minX).toBeCloseTo(-def.width / 2);
    expect(bounds.maxX).toBeCloseTo(def.width / 2);
    expect(bounds.minY).toBeCloseTo(-def.height / 2);
    expect(bounds.maxY).toBeCloseTo(def.height / 2);
  });

  it('returns union bounds for multiple parts', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    addPartToAssembly(assembly, 'fuel-tank-small', 0, 0);
    addPartToAssembly(assembly, 'engine-spark', 0, -55);

    const bounds = getRocketBounds(assembly);
    expect(bounds).not.toBeNull();

    // Each part extends ±width/2 and ±height/2 from its placed position.
    // The union should encompass all three parts.
    for (const [partId, x, y] of [
      ['probe-core-mk1', 0, 60],
      ['fuel-tank-small', 0, 0],
      ['engine-spark', 0, -55],
    ]) {
      const def = getPartById(partId);
      if (!def) continue;
      expect(bounds.minX).toBeLessThanOrEqual(x - def.width / 2);
      expect(bounds.maxX).toBeGreaterThanOrEqual(x + def.width / 2);
      expect(bounds.minY).toBeLessThanOrEqual(y - def.height / 2);
      expect(bounds.maxY).toBeGreaterThanOrEqual(y + def.height / 2);
    }
  });

  it('ignores unknown part IDs gracefully', () => {
    const assembly = createRocketAssembly();
    // Manually insert a part with a bogus partId.
    assembly.parts.set('bogus-instance', {
      instanceId: 'bogus-instance',
      partId: 'nonexistent-part-xyz',
      x: 100,
      y: 100,
    });

    // Should still return null because the only part has no definition.
    expect(getRocketBounds(assembly)).toBeNull();
  });
});
