import { describe, it, expect } from 'vitest';
import { getBodyHazards, hasBodyHazards } from '../core/environment.ts';

describe('getBodyHazards @smoke', () => {
  it('Earth has no hazards', () => {
    expect(getBodyHazards('EARTH')).toEqual([]);
    expect(hasBodyHazards('EARTH')).toBe(false);
  });

  it('Moon has radiation and thermal hazards', () => {
    const hazards = getBodyHazards('MOON');
    expect(hazards.length).toBeGreaterThan(0);
    const labels = hazards.map((h) => h.label);
    expect(labels).toContain('Radiation');
    expect(labels).toContain('Thermal');
  });

  it('Mercury has extreme thermal and radiation', () => {
    const hazards = getBodyHazards('MERCURY');
    const extremeCount = hazards.filter((h) => h.severity === 'extreme').length;
    expect(extremeCount).toBeGreaterThanOrEqual(2);
  });

  it('Venus has surface-focused hazards (thermal + pressure)', () => {
    const labels = getBodyHazards('VENUS').map((h) => h.label);
    expect(labels).toContain('Thermal');
    expect(labels).toContain('Pressure');
  });

  it('Phobos lists microgravity as a high-severity hazard', () => {
    const micro = getBodyHazards('PHOBOS').find((h) => h.label === 'Microgravity');
    expect(micro).toBeDefined();
    expect(micro!.severity).toBe('high');
  });

  it('returns empty list for unknown bodies', () => {
    expect(getBodyHazards('UNKNOWN_BODY_XYZ')).toEqual([]);
    expect(hasBodyHazards('UNKNOWN_BODY_XYZ')).toBe(false);
  });

  it('each hazard entry has a non-empty note', () => {
    for (const bodyId of ['MOON', 'MERCURY', 'MARS', 'VENUS', 'PHOBOS', 'DEIMOS', 'CERES', 'JUPITER', 'SATURN', 'TITAN']) {
      for (const h of getBodyHazards(bodyId)) {
        expect(h.note.length).toBeGreaterThan(10);
      }
    }
  });
});
