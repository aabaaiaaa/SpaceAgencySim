/**
 * hubs-save-migration.test.ts — Unit tests for the hub save/load migration.
 *
 * Verifies that legacy saves (pre-hub) are correctly migrated to include
 * an Earth HQ hub, and that saves already containing hubs are left untouched.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- migrateToHubs takes raw deserialized JSON */

import { describe, it, expect } from 'vitest';
import { EARTH_HUB_ID } from '../core/constants.ts';
import { migrateToHubs } from '../core/saveload.ts';

describe('migrateToHubs', () => {
  it('creates an Earth hub from a legacy save', () => {
    const facilities = {
      launch_pad: { built: true, tier: 1 },
      vab: { built: true, tier: 1 },
    };
    const partInventory = [
      { partId: 'engine_basic', count: 3 },
      { partId: 'fuel_tank_small', count: 5 },
    ];
    const state: any = {
      facilities,
      partInventory,
      crew: [],
    };

    migrateToHubs(state);

    expect(state.hubs).toBeInstanceOf(Array);
    expect(state.hubs).toHaveLength(1);

    const hub = state.hubs[0];
    expect(hub.id).toBe(EARTH_HUB_ID);
    expect(hub.name).toBe('Earth HQ');
    expect(hub.type).toBe('surface');
    expect(hub.bodyId).toBe('EARTH');
    expect(hub.coordinates).toEqual({ x: 0, y: 0 });
    expect(hub.facilities).toEqual(facilities);
    expect(hub.partInventory).toEqual(partInventory);
    expect(hub.tourists).toEqual([]);
    expect(hub.constructionQueue).toEqual([]);
    expect(hub.maintenanceCost).toBe(0);
    expect(hub.established).toBe(0);
    expect(hub.online).toBe(true);
    expect(state.activeHubId).toBe(EARTH_HUB_ID);
  });

  it('defaults missing facilities and partInventory gracefully', () => {
    const state: any = {};

    migrateToHubs(state);

    expect(state.hubs).toHaveLength(1);
    expect(state.hubs[0].facilities).toEqual({});
    expect(state.hubs[0].partInventory).toEqual([]);
  });

  it('sets stationedHubId and transitUntil on legacy crew', () => {
    const state: any = {
      crew: [
        { id: 'crew-1', name: 'Alice' },
        { id: 'crew-2', name: 'Bob' },
      ],
    };

    migrateToHubs(state);

    for (const c of state.crew) {
      expect(c.stationedHubId).toBe(EARTH_HUB_ID);
      expect(c.transitUntil).toBeNull();
    }
  });

  it('does not overwrite existing stationedHubId on crew', () => {
    const state: any = {
      crew: [
        { id: 'crew-1', name: 'Alice', stationedHubId: 'moon-base', transitUntil: 5 },
      ],
    };

    migrateToHubs(state);

    expect(state.crew[0].stationedHubId).toBe('moon-base');
    expect(state.crew[0].transitUntil).toBe(5);
  });

  it('does not double-migrate when hubs already exist', () => {
    const existingHubs = [
      { id: 'earth', name: 'Earth HQ', type: 'surface' },
      { id: 'moon-base', name: 'Lunar Outpost', type: 'surface' },
    ];
    const state: any = {
      hubs: existingHubs,
      activeHubId: 'earth',
    };

    migrateToHubs(state);

    expect(state.hubs).toBe(existingHubs); // same reference — untouched
    expect(state.hubs).toHaveLength(2);
  });

  it('round-trip JSON serialisation preserves the migrated hub structure', () => {
    const facilities = {
      launch_pad: { built: true, tier: 2 },
      mission_control: { built: true, tier: 1 },
    };
    const partInventory = [{ partId: 'capsule_mk1', count: 1 }];
    const state: any = {
      facilities,
      partInventory,
      crew: [{ id: 'crew-1', name: 'Alice' }],
    };

    migrateToHubs(state);

    // Serialise and deserialise
    const json = JSON.stringify(state);
    const restored = JSON.parse(json);

    expect(restored.hubs).toHaveLength(1);
    const hub = restored.hubs[0];
    expect(hub.id).toBe(EARTH_HUB_ID);
    expect(hub.name).toBe('Earth HQ');
    expect(hub.type).toBe('surface');
    expect(hub.bodyId).toBe('EARTH');
    expect(hub.coordinates).toEqual({ x: 0, y: 0 });
    expect(hub.facilities).toEqual(facilities);
    expect(hub.partInventory).toEqual(partInventory);
    expect(hub.tourists).toEqual([]);
    expect(hub.constructionQueue).toEqual([]);
    expect(hub.maintenanceCost).toBe(0);
    expect(hub.established).toBe(0);
    expect(hub.online).toBe(true);
    expect(restored.activeHubId).toBe(EARTH_HUB_ID);
    expect(restored.crew[0].stationedHubId).toBe(EARTH_HUB_ID);
    expect(restored.crew[0].transitUntil).toBeNull();
  });
});
