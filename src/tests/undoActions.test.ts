/**
 * undoActions.test.ts — Unit tests for cloneStaging() and restoreStaging()
 * pure helpers from src/ui/vab/_undoActions.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import type { StagingConfig } from '../core/rocketbuilder.ts';

// Mock dependencies that _undoActions.ts imports but we don't need for these tests.
vi.mock('../data/parts.ts', () => ({ getPartById: vi.fn(() => null) }));
vi.mock('../ui/vab/_state.ts', () => ({
  getVabState: vi.fn(() => ({})),
  setVabState: vi.fn(),
  resetVabState: vi.fn(),
}));

import { cloneStaging, restoreStaging } from '../ui/vab/_undoActions.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStagingConfig(
  stages: string[][] = [[]],
  unstaged: string[] = [],
  currentStageIdx = 0,
): StagingConfig {
  return {
    stages: stages.map(ids => ({ instanceIds: [...ids] })),
    unstaged: [...unstaged],
    currentStageIdx,
  };
}

// ---------------------------------------------------------------------------
// cloneStaging
// ---------------------------------------------------------------------------

describe('cloneStaging()', () => {
  it('produces an independent copy — mutating original does not affect clone', () => {
    const original = makeStagingConfig([['p1', 'p2'], ['p3']], ['p4'], 1);
    const clone = cloneStaging(original);

    // Mutate the original
    original.stages[0].instanceIds.push('p99');
    original.stages.push({ instanceIds: ['p100'] });
    original.unstaged.push('p101');
    original.currentStageIdx = 5;

    // Clone should be unchanged
    expect(clone.stages[0].instanceIds).toEqual(['p1', 'p2']);
    expect(clone.stages[1].instanceIds).toEqual(['p3']);
    expect(clone.stages.length).toBe(2);
    expect(clone.unstaged).toEqual(['p4']);
    expect(clone.currentStageIdx).toBe(1);
  });

  it('returns a different object reference than the original', () => {
    const original = makeStagingConfig([['p1']], ['p2']);
    const clone = cloneStaging(original);

    expect(clone).not.toBe(original);
    expect(clone.stages).not.toBe(original.stages);
    expect(clone.stages[0]).not.toBe(original.stages[0]);
    expect(clone.stages[0].instanceIds).not.toBe(original.stages[0].instanceIds);
    expect(clone.unstaged).not.toBe(original.unstaged);
  });

  it('handles empty stages array', () => {
    const original: StagingConfig = {
      stages: [],
      unstaged: ['p1'],
      currentStageIdx: 0,
    };
    const clone = cloneStaging(original);

    expect(clone.stages).toEqual([]);
    expect(clone.unstaged).toEqual(['p1']);
    expect(clone.currentStageIdx).toBe(0);
  });

  it('handles empty unstaged array', () => {
    const original = makeStagingConfig([['p1', 'p2']], []);
    const clone = cloneStaging(original);

    expect(clone.unstaged).toEqual([]);
    expect(clone.stages[0].instanceIds).toEqual(['p1', 'p2']);
  });

  it('handles fully empty config (no stages, no unstaged)', () => {
    const original: StagingConfig = {
      stages: [],
      unstaged: [],
      currentStageIdx: 0,
    };
    const clone = cloneStaging(original);

    expect(clone.stages).toEqual([]);
    expect(clone.unstaged).toEqual([]);
    expect(clone.currentStageIdx).toBe(0);
  });

  it('preserves currentStageIdx value', () => {
    const original = makeStagingConfig([['p1'], ['p2'], ['p3']], [], 2);
    const clone = cloneStaging(original);

    expect(clone.currentStageIdx).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// restoreStaging
// ---------------------------------------------------------------------------

describe('restoreStaging()', () => {
  it('overwrites target properties from source', () => {
    const target = makeStagingConfig([['old1']], ['oldU'], 0);
    const source = makeStagingConfig([['new1', 'new2'], ['new3']], ['newU1', 'newU2'], 1);

    restoreStaging(target, source);

    expect(target.stages.length).toBe(2);
    expect(target.stages[0].instanceIds).toEqual(['new1', 'new2']);
    expect(target.stages[1].instanceIds).toEqual(['new3']);
    expect(target.unstaged).toEqual(['newU1', 'newU2']);
    expect(target.currentStageIdx).toBe(1);
  });

  it('preserves target object reference (same === identity after restore)', () => {
    const target = makeStagingConfig([['old1']], ['oldU']);
    const targetRef = target;
    const source = makeStagingConfig([['new1']], ['newU'], 3);

    restoreStaging(target, source);

    expect(target).toBe(targetRef);
  });

  it('does not share array references with source after restore', () => {
    const source = makeStagingConfig([['p1', 'p2']], ['p3']);
    const target = makeStagingConfig([], []);

    restoreStaging(target, source);

    // Mutate source after restore — target should not be affected
    source.stages[0].instanceIds.push('p99');
    source.unstaged.push('p100');

    expect(target.stages[0].instanceIds).toEqual(['p1', 'p2']);
    expect(target.unstaged).toEqual(['p3']);
  });

  it('handles empty config as source', () => {
    const target = makeStagingConfig([['p1', 'p2']], ['p3'], 2);
    const source: StagingConfig = {
      stages: [],
      unstaged: [],
      currentStageIdx: 0,
    };

    restoreStaging(target, source);

    expect(target.stages).toEqual([]);
    expect(target.unstaged).toEqual([]);
    expect(target.currentStageIdx).toBe(0);
  });

  it('handles restoring into a non-empty target', () => {
    const target = makeStagingConfig([['a', 'b'], ['c']], ['d', 'e'], 1);
    const source = makeStagingConfig([['x']], [], 0);

    restoreStaging(target, source);

    expect(target.stages.length).toBe(1);
    expect(target.stages[0].instanceIds).toEqual(['x']);
    expect(target.unstaged).toEqual([]);
    expect(target.currentStageIdx).toBe(0);
  });
});
