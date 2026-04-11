import { describe, it, expect } from 'vitest';
import { getPartById } from '../data/parts.ts';
import { PartType } from '../core/constants.ts';

describe('Outpost Core part definition', () => {
  it('exists in the parts catalog', () => {
    const part = getPartById('outpost_core');
    expect(part).toBeDefined();
  });

  it('has correct type, mass, and cost', () => {
    const part = getPartById('outpost_core')!;
    expect(part.type).toBe(PartType.OUTPOST_CORE);
    expect(part.mass).toBe(2000);
    expect(part.cost).toBe(500_000);
  });

  it('has top and bottom snap points', () => {
    const part = getPartById('outpost_core')!;
    expect(part.snapPoints).toHaveLength(2);

    const topSnap = part.snapPoints.find(sp => sp.side === 'top');
    expect(topSnap).toBeDefined();

    const bottomSnap = part.snapPoints.find(sp => sp.side === 'bottom');
    expect(bottomSnap).toBeDefined();
  });
});
