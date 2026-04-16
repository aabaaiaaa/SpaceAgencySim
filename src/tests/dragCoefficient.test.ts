import { describe, it, expect } from 'vitest';
import { computePartCdA } from '../core/dragCoefficient.ts';
import { PartType } from '../core/constants.ts';
import { LOW_DENSITY_THRESHOLD } from '../core/parachute.ts';
import type { PartDef } from '../data/parts.ts';

const SCALE_M_PER_PX = 0.05;

function makePart(overrides: Partial<PartDef> & Pick<PartDef, 'type'>): PartDef {
  return {
    id: 'test-part',
    name: 'Test Part',
    mass: 100,
    cost: 0,
    width: 40,
    height: 40,
    snapPoints: [],
    animationStates: [],
    activatable: false,
    activationBehaviour: 'none',
    properties: {},
    ...overrides,
  };
}

describe('computePartCdA', () => {
  describe('non-parachute parts', () => {
    it('returns Cd × A using circular cross-section', () => {
      const def = makePart({
        type: PartType.COMMAND_MODULE,
        width: 40,
        properties: { dragCoefficient: 0.3 },
      });
      const widthM = 40 * SCALE_M_PER_PX;
      const area = Math.PI * (widthM / 2) ** 2;
      const expected = 0.3 * area;
      expect(computePartCdA(def, 0, 1.225)).toBeCloseTo(expected, 12);
    });

    it('defaults to dragCoefficient=0.2 when the property is missing', () => {
      const def = makePart({ type: PartType.FUEL_TANK, width: 40, properties: {} });
      const widthM = 40 * SCALE_M_PER_PX;
      const area = Math.PI * (widthM / 2) ** 2;
      expect(computePartCdA(def, 0, 1.225)).toBeCloseTo(0.2 * area, 12);
    });

    it('ignores deployProgress and atmosphere density for non-parachute parts', () => {
      const def = makePart({
        type: PartType.ENGINE,
        width: 60,
        properties: { dragCoefficient: 0.4 },
      });
      const a = computePartCdA(def, 0, 1.225);
      const b = computePartCdA(def, 1, 0);
      const c = computePartCdA(def, 0.5, 100);
      expect(a).toBe(b);
      expect(a).toBe(c);
    });
  });

  describe('parachute parts', () => {
    const chuteDef = makePart({
      type: PartType.PARACHUTE,
      width: 40,
      properties: {
        dragCoefficient: 0.05,
        deployedDiameter: 10,
        deployedCd: 0.75,
      },
    });

    const widthM = 40 * SCALE_M_PER_PX;
    const area = Math.PI * (widthM / 2) ** 2;
    const stowedCdA = 0.05 * area;
    const deployedR = 5;
    const deployedCdA = 0.75 * Math.PI * deployedR * deployedR;

    it('returns stowed CdA when undeployed (progress=0)', () => {
      expect(computePartCdA(chuteDef, 0, 1.225)).toBeCloseTo(stowedCdA, 12);
    });

    it('returns fully-deployed CdA at progress=1 in dense atmosphere', () => {
      // density ≥ LOW_DENSITY_THRESHOLD clamps densityScale to 1
      expect(computePartCdA(chuteDef, 1, 1.225)).toBeCloseTo(deployedCdA, 12);
    });

    it('interpolates linearly for partial deployment', () => {
      const progress = 0.4;
      const expected =
        stowedCdA + (deployedCdA - stowedCdA) * progress; // densityScale = 1
      expect(computePartCdA(chuteDef, progress, 1.225)).toBeCloseTo(expected, 12);
    });

    it('scales deployment drag by atmospheric density below the threshold', () => {
      const density = LOW_DENSITY_THRESHOLD / 2; // densityScale = 0.5
      const progress = 1;
      const expected = stowedCdA + (deployedCdA - stowedCdA) * progress * 0.5;
      expect(computePartCdA(chuteDef, progress, density)).toBeCloseTo(expected, 12);
    });

    it('returns stowed CdA at zero atmospheric density regardless of progress', () => {
      expect(computePartCdA(chuteDef, 0, 0)).toBeCloseTo(stowedCdA, 12);
      expect(computePartCdA(chuteDef, 0.5, 0)).toBeCloseTo(stowedCdA, 12);
      expect(computePartCdA(chuteDef, 1, 0)).toBeCloseTo(stowedCdA, 12);
    });

    it('uses default parachute properties when missing', () => {
      const bareChute = makePart({
        type: PartType.PARACHUTE,
        width: 40,
        properties: {},
      });
      // defaults: dragCoefficient=0.05, deployedDiameter=10, deployedCd=0.75
      expect(computePartCdA(bareChute, 0, 1.225)).toBeCloseTo(stowedCdA, 12);
      expect(computePartCdA(bareChute, 1, 1.225)).toBeCloseTo(deployedCdA, 12);
    });
  });
});
