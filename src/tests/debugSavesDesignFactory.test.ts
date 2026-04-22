/**
 * Tests for the debug-save design factory.
 *
 * The factory produces minimum-viable functional RocketDesigns for use in
 * late-game debug save states. Each design must reference real parts from
 * the catalog and have coherent staging + mass/thrust totals.
 */

import { describe, it, expect } from 'vitest';
import { makeDesign } from '../core/debugSaves/designFactory.ts';
import { PARTS } from '../data/parts.ts';
import type { PartDef } from '../core/physics/types.ts';

const PARTS_BY_ID: Map<string, PartDef> = new Map(PARTS.map(p => [p.id, p]));

const ALL_ROLES = [
  'sub-orbital-tourist',
  'leo-launcher',
  'satellite-deployer-leo',
  'heo-deployer',
  'lunar-transfer',
  'lunar-cargo-lander',
  'mars-injection',
  'leo-tug',
  'lunar-tug',
  'venus-orbiter',
  'mercury-probe',
  'phobos-lander',
  'deimos-lander',
] as const;

describe('makeDesign', () => {
  describe('@smoke leo-launcher role', () => {
    it('returns a design with id and name from input', () => {
      const design = makeDesign({ id: 'd-test-001', name: 'Test Launcher', role: 'leo-launcher' });
      expect(design.id).toBe('d-test-001');
      expect(design.name).toBe('Test Launcher');
    });

    it('produces a non-empty parts array', () => {
      const design = makeDesign({ id: 'd-1', name: 'x', role: 'leo-launcher' });
      expect(design.parts.length).toBeGreaterThan(0);
    });

    it('all parts reference real part definitions', () => {
      const design = makeDesign({ id: 'd-1', name: 'x', role: 'leo-launcher' });
      for (const p of design.parts) {
        expect(PARTS_BY_ID.has(p.partId), `unknown partId: ${p.partId}`).toBe(true);
      }
    });

    it('totalMass equals sum of PartDef.mass across all parts', () => {
      const design = makeDesign({ id: 'd-1', name: 'x', role: 'leo-launcher' });
      const expected = design.parts.reduce((sum, p) => sum + (PARTS_BY_ID.get(p.partId)?.mass ?? 0), 0);
      expect(design.totalMass).toBe(expected);
    });

    it('totalThrust sums engine thrust properties', () => {
      const design = makeDesign({ id: 'd-1', name: 'x', role: 'leo-launcher' });
      const expected = design.parts.reduce((sum, p) => {
        const def = PARTS_BY_ID.get(p.partId);
        const thrust = def?.properties?.thrust;
        return sum + (typeof thrust === 'number' ? thrust : 0);
      }, 0);
      expect(design.totalThrust).toBe(expected);
    });

    it('has at least one stage and every stage index is a valid parts index', () => {
      const design = makeDesign({ id: 'd-1', name: 'x', role: 'leo-launcher' });
      expect(design.staging.stages.length).toBeGreaterThan(0);
      for (const stage of design.staging.stages) {
        for (const idx of stage) {
          expect(typeof idx).toBe('number');
          expect(idx as number).toBeGreaterThanOrEqual(0);
          expect(idx as number).toBeLessThan(design.parts.length);
        }
      }
    });

    it('has ISO string createdDate and updatedDate', () => {
      const design = makeDesign({ id: 'd-1', name: 'x', role: 'leo-launcher' });
      expect(() => new Date(design.createdDate).toISOString()).not.toThrow();
      expect(() => new Date(design.updatedDate).toISOString()).not.toThrow();
    });
  });

  describe('all roles produce valid designs', () => {
    for (const role of ALL_ROLES) {
      it(`role "${role}" has valid parts, staging, and totals`, () => {
        const design = makeDesign({ id: `d-${role}`, name: `Test ${role}`, role });
        expect(design.parts.length).toBeGreaterThan(0);
        expect(design.staging.stages.length).toBeGreaterThan(0);
        expect(design.totalMass).toBeGreaterThan(0);

        for (const p of design.parts) {
          expect(PARTS_BY_ID.has(p.partId), `role ${role}: unknown partId ${p.partId}`).toBe(true);
        }

        for (const stage of design.staging.stages) {
          for (const idx of stage) {
            expect(typeof idx).toBe('number');
            expect(idx as number).toBeGreaterThanOrEqual(0);
            expect(idx as number).toBeLessThan(design.parts.length);
          }
        }
      });
    }
  });
});
