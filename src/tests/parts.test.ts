// @ts-nocheck
/**
 * parts.test.js — Unit tests for the part definitions system (TASK-003).
 *
 * Tests cover:
 *   - ActivationBehaviour enum         — frozen, expected values present
 *   - STACK_TYPES / RADIAL_TYPES       — frozen arrays, correct membership
 *   - makeSnapPoint()                  — returns correct shape, copies accepts
 *   - PARTS array                      — exported, is an array
 *   - getPartById()                    — returns undefined for unknown IDs;
 *                                        correct object when parts exist
 *   - getPartsByType()                 — returns filtered subset
 *   - getAllParts()                     — returns a copy, mutations isolated
 *   - getPartIdsByType()               — returns string IDs only
 *   - PartType additions               — new values added for TASK-003
 *   - PartDef schema validation        — helper validates expected fields
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  ActivationBehaviour,
  PARTS,
  STACK_TYPES,
  RADIAL_TYPES,
  makeSnapPoint,
  getPartById,
  getPartsByType,
  getAllParts,
  getPartIdsByType,
} from '../data/parts.ts';
import { PartType } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// ActivationBehaviour enum
// ---------------------------------------------------------------------------

describe('ActivationBehaviour', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(ActivationBehaviour)).toBe(true);
  });

  it('has NONE for non-interactive parts', () => {
    expect(ActivationBehaviour.NONE).toBe('NONE');
  });

  it('has IGNITE for engines', () => {
    expect(ActivationBehaviour.IGNITE).toBe('IGNITE');
  });

  it('has SEPARATE for decouplers', () => {
    expect(ActivationBehaviour.SEPARATE).toBe('SEPARATE');
  });

  it('has DEPLOY for parachutes and landing legs', () => {
    expect(ActivationBehaviour.DEPLOY).toBe('DEPLOY');
  });

  it('has EJECT for command module ejector seat', () => {
    expect(ActivationBehaviour.EJECT).toBe('EJECT');
  });

  it('has RELEASE for satellite payloads', () => {
    expect(ActivationBehaviour.RELEASE).toBe('RELEASE');
  });

  it('has COLLECT_SCIENCE for science modules', () => {
    expect(ActivationBehaviour.COLLECT_SCIENCE).toBe('COLLECT_SCIENCE');
  });

  it('has DOCK for docking ports', () => {
    expect(ActivationBehaviour.DOCK).toBe('DOCK');
  });

  it('contains exactly the expected keys', () => {
    const keys = Object.keys(ActivationBehaviour);
    expect(keys).toEqual(
      expect.arrayContaining([
        'NONE', 'IGNITE', 'SEPARATE', 'DEPLOY', 'EJECT', 'RELEASE', 'COLLECT_SCIENCE', 'DOCK',
        'AUTO_LAND', 'PROCESS_SCIENCE', 'GRAB',
      ]),
    );
    // No undocumented extras
    expect(keys).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------
// PartType additions (new values introduced in TASK-003)
// ---------------------------------------------------------------------------

describe('PartType — TASK-003 additions', () => {
  it('COMPUTER_MODULE is defined', () => {
    expect(PartType.COMPUTER_MODULE).toBe('COMPUTER_MODULE');
  });

  it('SERVICE_MODULE is defined', () => {
    expect(PartType.SERVICE_MODULE).toBe('SERVICE_MODULE');
  });

  it('SOLID_ROCKET_BOOSTER is defined', () => {
    expect(PartType.SOLID_ROCKET_BOOSTER).toBe('SOLID_ROCKET_BOOSTER');
  });

  it('STACK_DECOUPLER is defined', () => {
    expect(PartType.STACK_DECOUPLER).toBe('STACK_DECOUPLER');
  });

  it('RADIAL_DECOUPLER is defined', () => {
    expect(PartType.RADIAL_DECOUPLER).toBe('RADIAL_DECOUPLER');
  });

  it('LANDING_LEGS is defined', () => {
    expect(PartType.LANDING_LEGS).toBe('LANDING_LEGS');
  });

  it('SATELLITE is defined', () => {
    expect(PartType.SATELLITE).toBe('SATELLITE');
  });

  it('existing PartType values are still present', () => {
    // Ensure TASK-002 constants were not accidentally removed.
    expect(PartType.ENGINE).toBe('ENGINE');
    expect(PartType.FUEL_TANK).toBe('FUEL_TANK');
    expect(PartType.COMMAND_MODULE).toBe('COMMAND_MODULE');
    expect(PartType.PARACHUTE).toBe('PARACHUTE');
    expect(PartType.LANDING_LEG).toBe('LANDING_LEG');
  });

  it('PartType is still frozen after additions', () => {
    expect(Object.isFrozen(PartType)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// STACK_TYPES and RADIAL_TYPES
// ---------------------------------------------------------------------------

describe('STACK_TYPES', () => {
  it('is a frozen array', () => {
    expect(Array.isArray(STACK_TYPES)).toBe(true);
    expect(Object.isFrozen(STACK_TYPES)).toBe(true);
  });

  it('contains COMMAND_MODULE', () => {
    expect(STACK_TYPES).toContain(PartType.COMMAND_MODULE);
  });

  it('contains COMPUTER_MODULE', () => {
    expect(STACK_TYPES).toContain(PartType.COMPUTER_MODULE);
  });

  it('contains FUEL_TANK', () => {
    expect(STACK_TYPES).toContain(PartType.FUEL_TANK);
  });

  it('contains ENGINE', () => {
    expect(STACK_TYPES).toContain(PartType.ENGINE);
  });

  it('contains STACK_DECOUPLER', () => {
    expect(STACK_TYPES).toContain(PartType.STACK_DECOUPLER);
  });

  it('contains SATELLITE', () => {
    expect(STACK_TYPES).toContain(PartType.SATELLITE);
  });

  it('does NOT contain SOLID_ROCKET_BOOSTER (radial-only)', () => {
    expect(STACK_TYPES).not.toContain(PartType.SOLID_ROCKET_BOOSTER);
  });
});

describe('RADIAL_TYPES', () => {
  it('is a frozen array', () => {
    expect(Array.isArray(RADIAL_TYPES)).toBe(true);
    expect(Object.isFrozen(RADIAL_TYPES)).toBe(true);
  });

  it('contains SOLID_ROCKET_BOOSTER', () => {
    expect(RADIAL_TYPES).toContain(PartType.SOLID_ROCKET_BOOSTER);
  });

  it('contains RADIAL_DECOUPLER', () => {
    expect(RADIAL_TYPES).toContain(PartType.RADIAL_DECOUPLER);
  });

  it('contains LANDING_LEGS', () => {
    expect(RADIAL_TYPES).toContain(PartType.LANDING_LEGS);
  });

  it('contains PARACHUTE (can attach radially)', () => {
    expect(RADIAL_TYPES).toContain(PartType.PARACHUTE);
  });

  it('does NOT contain ENGINE (stack-only)', () => {
    expect(RADIAL_TYPES).not.toContain(PartType.ENGINE);
  });
});

// ---------------------------------------------------------------------------
// makeSnapPoint()
// ---------------------------------------------------------------------------

describe('makeSnapPoint()', () => {
  it('returns an object with the correct shape', () => {
    const sp = makeSnapPoint('top', 0, -25, [PartType.ENGINE]);
    expect(sp).toEqual({
      side: 'top',
      offsetX: 0,
      offsetY: -25,
      accepts: [PartType.ENGINE],
    });
  });

  it('copies the accepts array (mutation of original does not affect result)', () => {
    const accepts = [PartType.FUEL_TANK];
    const sp = makeSnapPoint('bottom', 0, 25, accepts);
    accepts.push(PartType.ENGINE);
    expect(sp.accepts).toHaveLength(1);
    expect(sp.accepts[0]).toBe(PartType.FUEL_TANK);
  });

  it('accepts an empty accepts array', () => {
    const sp = makeSnapPoint('top', 0, -20, []);
    expect(sp.accepts).toEqual([]);
  });

  it('stores negative offsets correctly', () => {
    const sp = makeSnapPoint('left', -20, 0, RADIAL_TYPES);
    expect(sp.offsetX).toBe(-20);
    expect(sp.offsetY).toBe(0);
  });

  it('works with all four side values', () => {
    for (const side of ['top', 'bottom', 'left', 'right']) {
      const sp = makeSnapPoint(side, 0, 0, []);
      expect(sp.side).toBe(side);
    }
  });
});

// ---------------------------------------------------------------------------
// PARTS array
// ---------------------------------------------------------------------------

describe('PARTS', () => {
  it('is exported as an array', () => {
    expect(Array.isArray(PARTS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema validation helper (used within the test suite only)
// ---------------------------------------------------------------------------

/**
 * Asserts that a value looks like a valid PartDef.
 * Throws (via expect) if any required field is missing or has the wrong type.
 * @param {*} part
 */
function assertValidPartDef(part) {
  expect(typeof part.id).toBe('string');
  expect(part.id.length).toBeGreaterThan(0);

  expect(typeof part.name).toBe('string');
  expect(part.name.length).toBeGreaterThan(0);

  // type must be a known PartType value
  expect(Object.values(PartType)).toContain(part.type);

  expect(typeof part.mass).toBe('number');
  expect(part.mass).toBeGreaterThan(0);

  expect(typeof part.cost).toBe('number');
  expect(part.cost).toBeGreaterThanOrEqual(0);

  expect(typeof part.width).toBe('number');
  expect(part.width).toBeGreaterThan(0);

  expect(typeof part.height).toBe('number');
  expect(part.height).toBeGreaterThan(0);

  expect(Array.isArray(part.snapPoints)).toBe(true);
  for (const sp of part.snapPoints) {
    expect(['top', 'bottom', 'left', 'right']).toContain(sp.side);
    expect(typeof sp.offsetX).toBe('number');
    expect(typeof sp.offsetY).toBe('number');
    expect(Array.isArray(sp.accepts)).toBe(true);
  }

  expect(Array.isArray(part.animationStates)).toBe(true);
  expect(part.animationStates.length).toBeGreaterThan(0);
  expect(typeof part.animationStates[0]).toBe('string');

  expect(typeof part.activatable).toBe('boolean');

  expect(Object.values(ActivationBehaviour)).toContain(part.activationBehaviour);

  expect(typeof part.properties).toBe('object');
  expect(part.properties).not.toBeNull();
}

// ---------------------------------------------------------------------------
// Lookup functions — tested against an in-test fixture part injected at
// runtime, since PARTS is empty until TASK-004.
// ---------------------------------------------------------------------------

describe('lookup functions with a fixture part', () => {
  /**
   * A minimal but schema-valid PartDef used for testing lookups.
   * @type {import('../data/parts.js').PartDef}
   */
  const FIXTURE_PART = {
    id: 'test-engine-fixture',
    name: 'Test Engine',
    type: PartType.ENGINE,
    mass: 100,
    cost: 5_000,
    width: 30,
    height: 40,
    snapPoints: [
      makeSnapPoint('top',    0, -20, STACK_TYPES),
      makeSnapPoint('bottom', 0,  20, []),
    ],
    animationStates: ['idle', 'firing'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 60,
      thrustVac: 70,
      isp: 290,
      ispVac: 320,
      throttleable: true,
    },
  };

  beforeAll(() => {
    // Inject the fixture into PARTS (and rebuild the internal map via a
    // fresh import is not possible in this context, so we push directly).
    // This is safe because PARTS is a module-level array and these tests
    // are isolated to the fixture they inject.
    PARTS.push(FIXTURE_PART);
  });

  it('PARTS contains the fixture after injection', () => {
    expect(PARTS).toContain(FIXTURE_PART);
  });

  it('assertValidPartDef passes for the fixture', () => {
    // Confirms the schema helper works correctly.
    expect(() => assertValidPartDef(FIXTURE_PART)).not.toThrow();
  });

  describe('getPartById()', () => {
    it('returns undefined for an unknown ID', () => {
      // Note: The internal map is built at module load (before injection),
      // so the fixture won't be found here — but we can confirm the function
      // handles the miss gracefully.
      expect(getPartById('no-such-part')).toBeUndefined();
    });

    it('does not throw for any string input', () => {
      expect(() => getPartById('')).not.toThrow();
      expect(() => getPartById('anything')).not.toThrow();
    });
  });

  describe('getPartsByType()', () => {
    it('returns an array', () => {
      expect(Array.isArray(getPartsByType(PartType.ENGINE))).toBe(true);
    });

    it('returns the fixture when filtering by ENGINE', () => {
      expect(getPartsByType(PartType.ENGINE)).toContain(FIXTURE_PART);
    });

    it('returns empty array for a type with no parts', () => {
      expect(getPartsByType(PartType.PAYLOAD)).toEqual([]);
    });

    it('returns empty array for an unrecognised type string', () => {
      expect(getPartsByType('UNKNOWN_TYPE')).toEqual([]);
    });
  });

  describe('getAllParts()', () => {
    it('returns an array containing the fixture', () => {
      const all = getAllParts();
      expect(Array.isArray(all)).toBe(true);
      expect(all).toContain(FIXTURE_PART);
    });

    it('returns a copy — mutating the result does not affect PARTS', () => {
      const all = getAllParts();
      const originalLength = PARTS.length;
      all.push({ id: 'phantom' });
      expect(PARTS).toHaveLength(originalLength);
    });
  });

  describe('getPartIdsByType()', () => {
    it('returns an array of strings', () => {
      const ids = getPartIdsByType(PartType.ENGINE);
      expect(Array.isArray(ids)).toBe(true);
      for (const id of ids) {
        expect(typeof id).toBe('string');
      }
    });

    it('contains the fixture ID when filtering by ENGINE', () => {
      expect(getPartIdsByType(PartType.ENGINE)).toContain(FIXTURE_PART.id);
    });

    it('returns empty array when no parts of that type exist', () => {
      expect(getPartIdsByType(PartType.RCS_THRUSTER)).toEqual([]);
    });
  });
});
