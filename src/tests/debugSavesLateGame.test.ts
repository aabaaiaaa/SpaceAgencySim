/**
 * Tests for the late-game debug save definitions (Stages A–F).
 *
 * Each stage is validated for:
 * - presence and correct category in DEBUG_SAVE_DEFINITIONS
 * - key state invariants specific to the stage (satellites, hubs, routes, etc.)
 * - that generated state survives basic structural sanity (mutation safety,
 *   linked IDs between orbital objects and satellite records, etc.)
 */

import { describe, it, expect } from 'vitest';
import { DEBUG_SAVE_DEFINITIONS } from '../core/debugSaves.ts';
import { SatelliteType, FieldCraftStatus } from '../core/constants.ts';
import { PARTS } from '../data/parts.ts';

const CATEGORY = 'Late Game — Interplanetary';

function findStage(id: string) {
  const def = DEBUG_SAVE_DEFINITIONS.find(d => d.id === id);
  if (!def) throw new Error(`Late-game debug save not found: ${id}`);
  return def;
}

const PART_IDS = new Set(PARTS.map(p => p.id));

function allSavedDesignsUseRealParts(state: { savedDesigns?: Array<{ parts?: Array<{ partId: string }> }> }) {
  for (const d of state.savedDesigns ?? []) {
    for (const p of d.parts ?? []) {
      if (!PART_IDS.has(p.partId)) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Stage A — interplanetary-capable
// ---------------------------------------------------------------------------

describe('Stage A — interplanetary-capable', () => {
  it('@smoke is registered in the late-game category', () => {
    const def = findStage('interplanetary-capable');
    expect(def.category).toBe(CATEGORY);
  });

  it('produces 2 field craft related to Mars', () => {
    const s = findStage('interplanetary-capable').generate();
    const marsCraft = s.fieldCraft.filter(fc => fc.bodyId === 'MARS');
    expect(marsCraft.length).toBe(2);
  });

  it('has no satellites and no hubs beyond Earth HQ', () => {
    const s = findStage('interplanetary-capable').generate();
    expect(s.satelliteNetwork.satellites).toHaveLength(0);
    expect(s.hubs).toHaveLength(1);
    expect(s.hubs[0].bodyId).toBe('EARTH');
  });

  it('has functional saved designs including Mars capability', () => {
    const s = findStage('interplanetary-capable').generate();
    expect(s.savedDesigns.length).toBeGreaterThanOrEqual(3);
    expect(allSavedDesignsUseRealParts(s)).toBe(true);
    expect(s.savedDesigns.some(d => /mars/i.test(d.name))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage B — first-constellation
// ---------------------------------------------------------------------------

describe('Stage B — first-constellation', () => {
  it('@smoke is registered in the late-game category', () => {
    const def = findStage('first-constellation');
    expect(def.category).toBe(CATEGORY);
  });

  it('has 3 Earth LEO COMM satellites for a constellation bonus', () => {
    const s = findStage('first-constellation').generate();
    const earthCommLeo = s.satelliteNetwork.satellites.filter(
      sat => sat.bodyId === 'EARTH' && sat.bandId === 'LEO' && sat.satelliteType === SatelliteType.COMMUNICATION,
    );
    expect(earthCommLeo.length).toBe(3);
  });

  it('each satellite links to a matching orbital object', () => {
    const s = findStage('first-constellation').generate();
    const orbitalIds = new Set(s.orbitalObjects.map(o => o.id));
    for (const sat of s.satelliteNetwork.satellites) {
      expect(orbitalIds.has(sat.orbitalObjectId), `missing orbital object for ${sat.id}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Stage C — multi-body-networks
// ---------------------------------------------------------------------------

describe('Stage C — multi-body-networks', () => {
  it('@smoke is registered in the late-game category', () => {
    const def = findStage('multi-body-networks');
    expect(def.category).toBe(CATEGORY);
  });

  it('has at least one RELAY satellite for deep-space comms', () => {
    const s = findStage('multi-body-networks').generate();
    const relays = s.satelliteNetwork.satellites.filter(sat => sat.satelliteType === SatelliteType.RELAY);
    expect(relays.length).toBeGreaterThanOrEqual(1);
  });

  it('has satellites on both Earth and Moon', () => {
    const s = findStage('multi-body-networks').generate();
    const bodies = new Set(s.satelliteNetwork.satellites.map(sat => sat.bodyId));
    expect(bodies.has('EARTH')).toBe(true);
    expect(bodies.has('MOON')).toBe(true);
  });

  it('has at least one leased satellite and at least one degraded (health < 30) satellite', () => {
    const s = findStage('multi-body-networks').generate();
    expect(s.satelliteNetwork.satellites.some(sat => sat.leased === true)).toBe(true);
    expect(s.satelliteNetwork.satellites.some(sat => sat.health < 30)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage D — first-off-world-hub
// ---------------------------------------------------------------------------

describe('Stage D — first-off-world-hub', () => {
  it('@smoke is registered in the late-game category', () => {
    const def = findStage('first-off-world-hub');
    expect(def.category).toBe(CATEGORY);
  });

  it('has a surface hub on the Mun', () => {
    const s = findStage('first-off-world-hub').generate();
    const munHub = s.hubs.find(h => h.bodyId === 'MOON' && h.type === 'surface');
    expect(munHub).toBeDefined();
  });

  it('the Mun hub has a mid-progress construction project', () => {
    const s = findStage('first-off-world-hub').generate();
    const munHub = s.hubs.find(h => h.bodyId === 'MOON');
    expect(munHub?.constructionQueue.length).toBeGreaterThanOrEqual(1);
    const proj = munHub!.constructionQueue[0];
    const delivered = proj.resourcesDelivered[0]?.amount ?? 0;
    const required = proj.resourcesRequired[0]?.amount ?? 0;
    expect(delivered).toBeGreaterThan(0);
    expect(delivered).toBeLessThan(required);
  });

  it('inherits Stage C constellations (not empty)', () => {
    const s = findStage('first-off-world-hub').generate();
    expect(s.satelliteNetwork.satellites.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Stage E — multi-hub-logistics
// ---------------------------------------------------------------------------

describe('Stage E — multi-hub-logistics', () => {
  it('@smoke is registered in the late-game category', () => {
    const def = findStage('multi-hub-logistics');
    expect(def.category).toBe(CATEGORY);
  });

  it('has an orbital LEO hub in addition to Earth and Mun surface', () => {
    const s = findStage('multi-hub-logistics').generate();
    const orbital = s.hubs.find(h => h.type === 'orbital');
    expect(orbital).toBeDefined();
    expect(orbital!.bodyId).toBe('EARTH');
  });

  it('has at least 2 active routes and 1 paused route', () => {
    const s = findStage('multi-hub-logistics').generate();
    const active = s.routes.filter(r => r.status === 'active');
    const paused = s.routes.filter(r => r.status === 'paused');
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(paused.length).toBeGreaterThanOrEqual(1);
  });

  it('each route leg references a real saved design', () => {
    const s = findStage('multi-hub-logistics').generate();
    const designIds = new Set(s.savedDesigns.map(d => d.id));
    for (const route of s.routes) {
      for (const leg of route.legs) {
        expect(designIds.has(leg.craftDesignId), `route ${route.id} leg ${leg.id}: missing design ${leg.craftDesignId}`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Stage F — interplanetary-empire
// ---------------------------------------------------------------------------

describe('Stage F — interplanetary-empire', () => {
  it('@smoke is registered in the late-game category', () => {
    const def = findStage('interplanetary-empire');
    expect(def.category).toBe(CATEGORY);
  });

  it('satellites cover all 7 supported bodies', () => {
    const s = findStage('interplanetary-empire').generate();
    const bodies = new Set(s.satelliteNetwork.satellites.map(sat => sat.bodyId));
    for (const expected of ['EARTH', 'MOON', 'MARS', 'VENUS', 'MERCURY', 'PHOBOS', 'DEIMOS']) {
      expect(bodies.has(expected), `missing satellites at ${expected}`).toBe(true);
    }
  });

  it('has at least 5 hubs across multiple bodies', () => {
    const s = findStage('interplanetary-empire').generate();
    expect(s.hubs.length).toBeGreaterThanOrEqual(5);
    const hubBodies = new Set(s.hubs.map(h => h.bodyId));
    expect(hubBodies.size).toBeGreaterThanOrEqual(3);
  });

  it('has at least 4 active routes and 1 broken route', () => {
    const s = findStage('interplanetary-empire').generate();
    expect(s.routes.filter(r => r.status === 'active').length).toBeGreaterThanOrEqual(4);
    expect(s.routes.filter(r => r.status === 'broken').length).toBeGreaterThanOrEqual(1);
  });

  it('field craft distributed across at least 4 bodies', () => {
    const s = findStage('interplanetary-empire').generate();
    const bodies = new Set(s.fieldCraft.map(fc => fc.bodyId));
    expect(bodies.size).toBeGreaterThanOrEqual(4);
    expect(s.fieldCraft.length).toBeGreaterThanOrEqual(6);
  });

  it('at least one field craft is LANDED and at least one is IN_ORBIT', () => {
    const s = findStage('interplanetary-empire').generate();
    expect(s.fieldCraft.some(fc => fc.status === FieldCraftStatus.LANDED)).toBe(true);
    expect(s.fieldCraft.some(fc => fc.status === FieldCraftStatus.IN_ORBIT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: existing stages not regressed
// ---------------------------------------------------------------------------

describe('existing debug saves unchanged', () => {
  it('all legacy debug saves still generate without throwing', () => {
    const legacy = DEBUG_SAVE_DEFINITIONS.filter(d => d.category !== CATEGORY);
    for (const def of legacy) {
      expect(() => def.generate()).not.toThrow();
    }
  });
});
