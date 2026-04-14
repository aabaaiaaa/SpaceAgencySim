import { describe, it, expect } from 'vitest';
import { getImportTaxMultiplier } from '../core/hubs.ts';
import { DEFAULT_IMPORT_TAX } from '../data/hubFacilities.ts';
import { getPartById } from '../data/parts.ts';

describe('Off-world VAB import tax multipliers', () => {
  it('Earth has 1.0x import tax', () => {
    expect(getImportTaxMultiplier('EARTH')).toBe(1.0);
  });

  it('Moon has 1.2x import tax', () => {
    expect(getImportTaxMultiplier('MOON')).toBe(1.2);
  });

  it('Mars has 1.5x import tax', () => {
    expect(getImportTaxMultiplier('MARS')).toBe(1.5);
  });

  it('Saturn has 3.0x import tax', () => {
    expect(getImportTaxMultiplier('SATURN')).toBe(3.0);
  });

  it('unknown body gets default 2.0x', () => {
    expect(getImportTaxMultiplier('UNKNOWN_PLANET')).toBe(DEFAULT_IMPORT_TAX);
    expect(getImportTaxMultiplier('UNKNOWN_PLANET')).toBe(2.0);
  });
});

describe('Part cost with import tax', () => {
  it('part cost at off-world hub is base cost times multiplier @smoke', () => {
    // Use an actual part from the catalog
    const testPart = getPartById('engine-spark');
    expect(testPart).toBeDefined();

    const baseCost = testPart!.cost;
    expect(baseCost).toBeGreaterThan(0);

    // Test multiplier calculations for various bodies
    const moonCost = baseCost * getImportTaxMultiplier('MOON');
    expect(moonCost).toBe(baseCost * 1.2);

    const marsCost = baseCost * getImportTaxMultiplier('MARS');
    expect(marsCost).toBe(baseCost * 1.5);

    const saturnCost = baseCost * getImportTaxMultiplier('SATURN');
    expect(saturnCost).toBe(baseCost * 3.0);

    // Earth should be 1x (no tax)
    const earthCost = baseCost * getImportTaxMultiplier('EARTH');
    expect(earthCost).toBe(baseCost);
  });
});
