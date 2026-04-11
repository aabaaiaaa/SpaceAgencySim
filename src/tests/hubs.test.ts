import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import {
  EARTH_HUB_ID,
  FACILITY_DEFINITIONS,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// GameState hub initialization
// ---------------------------------------------------------------------------

describe('GameState hub fields', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('initialises hubs array with one Earth hub', () => {
    expect(state.hubs).toBeInstanceOf(Array);
    expect(state.hubs).toHaveLength(1);
    expect(state.hubs[0].id).toBe(EARTH_HUB_ID);
  });

  it('sets activeHubId to EARTH_HUB_ID', () => {
    expect(state.activeHubId).toBe(EARTH_HUB_ID);
  });

  it('Earth hub has correct base properties', () => {
    const earth = state.hubs[0];
    expect(earth.name).toBe('Earth HQ');
    expect(earth.type).toBe('surface');
    expect(earth.bodyId).toBe('EARTH');
    expect(earth.online).toBe(true);
    expect(earth.maintenanceCost).toBe(0);
    expect(earth.established).toBe(0);
    expect(earth.tourists).toEqual([]);
    expect(earth.partInventory).toEqual([]);
    expect(earth.constructionQueue).toEqual([]);
  });

  it('Earth hub facilities match starter facilities', () => {
    const earth = state.hubs[0];
    const starterIds = FACILITY_DEFINITIONS
      .filter((f) => f.starter)
      .map((f) => f.id);

    // Every starter facility should be present and built at tier 1
    for (const id of starterIds) {
      expect(earth.facilities[id]).toBeDefined();
      expect(earth.facilities[id].built).toBe(true);
      expect(earth.facilities[id].tier).toBe(1);
    }

    // No extra facilities beyond the starters
    expect(Object.keys(earth.facilities)).toHaveLength(starterIds.length);
  });

  it('Earth hub facilities match top-level state.facilities', () => {
    const earth = state.hubs[0];
    expect(earth.facilities).toEqual(state.facilities);
  });
});
