import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';

describe('GameState mining/route fields', () => {
  it('createGameState() initializes miningSites as empty array', () => {
    const state = createGameState();
    expect(state.miningSites).toEqual([]);
    expect(Array.isArray(state.miningSites)).toBe(true);
  });

  it('createGameState() initializes provenLegs as empty array', () => {
    const state = createGameState();
    expect(state.provenLegs).toEqual([]);
    expect(Array.isArray(state.provenLegs)).toBe(true);
  });

  it('createGameState() initializes routes as empty array', () => {
    const state = createGameState();
    expect(state.routes).toEqual([]);
    expect(Array.isArray(state.routes)).toBe(true);
  });
});
