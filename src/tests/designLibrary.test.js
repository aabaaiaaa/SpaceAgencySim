/**
 * designLibrary.test.js — Unit tests for rocket design library system.
 *
 * Tests cover:
 *   - Shared library persistence (localStorage read/write)
 *   - Error handling: quota errors, corrupt JSON with console.warn
 *   - Unified library access (shared + private merging)
 *   - Save/delete routing (shared vs. private)
 *   - Design duplication
 *   - Cost breakdown calculation
 *   - Tech tree compatibility checking
 *   - Design grouping and filtering
 *   - JSON import/export (cross-save sharing)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.js';
import {
  loadSharedLibrary,
  saveSharedLibrary,
  saveDesignToSharedLibrary,
  deleteDesignFromSharedLibrary,
  getAllDesigns,
  saveDesignToLibrary,
  deleteDesignFromLibrary,
  duplicateDesign,
  calculateCostBreakdown,
  checkDesignCompatibility,
  groupDesigns,
  getDesignGroupDefs,
  filterDesignsByGroup,
} from '../core/designLibrary.js';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
    get length() { return store.size; },
    _store: store,
  };
}

let mockStorage;

beforeEach(() => {
  mockStorage = createLocalStorageMock();
  vi.stubGlobal('localStorage', mockStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState() {
  return createGameState();
}

/** Create a minimal design with sensible defaults. */
function makeDesign(overrides = {}) {
  return {
    id: 'design-test-1',
    name: 'Test Rocket',
    parts: [
      { partId: 'probe-core-mk1', position: { x: 0, y: 0 } },
      { partId: 'tank-small', position: { x: 0, y: 1 } },
      { partId: 'engine-spark', position: { x: 0, y: 2 } },
    ],
    staging: { stages: [[2], []], unstaged: [] },
    totalMass: 620,
    totalThrust: 60,
    createdDate: '2025-01-01T00:00:00.000Z',
    updatedDate: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Create a crewed design (has cmd-mk1). */
function makeCrewedDesign(overrides = {}) {
  return makeDesign({
    id: 'design-crewed-1',
    name: 'Crewed Rocket',
    parts: [
      { partId: 'cmd-mk1', position: { x: 0, y: 0 } },
      { partId: 'tank-small', position: { x: 0, y: 1 } },
      { partId: 'engine-spark', position: { x: 0, y: 2 } },
    ],
    totalMass: 1410,
    ...overrides,
  });
}

/** Create a satellite design. */
function makeSatelliteDesign(overrides = {}) {
  return makeDesign({
    id: 'design-sat-1',
    name: 'Sat Launcher',
    parts: [
      { partId: 'probe-core-mk1', position: { x: 0, y: 0 } },
      { partId: 'satellite-mk1', position: { x: 0, y: 1 } },
      { partId: 'tank-small', position: { x: 0, y: 2 } },
      { partId: 'engine-spark', position: { x: 0, y: 3 } },
    ],
    ...overrides,
  });
}

/** Seed localStorage with designs. */
function seedSharedLibrary(designs) {
  mockStorage.setItem('spaceAgencyDesignLibrary', JSON.stringify(designs));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Design Library', () => {

  // ── Shared Library Storage ──────────────────────────────────────────────

  describe('loadSharedLibrary', () => {
    it('returns empty array when nothing stored', () => {
      expect(loadSharedLibrary()).toEqual([]);
    });

    it('loads stored designs', () => {
      const designs = [makeDesign()];
      seedSharedLibrary(designs);
      const loaded = loadSharedLibrary();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('design-test-1');
    });

    it('returns empty array for corrupt JSON and logs a warning', () => {
      mockStorage.setItem('spaceAgencyDesignLibrary', 'not { valid json');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = loadSharedLibrary();
      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.calls?.[0]?.[0] ?? warnSpy.mock.calls[0][0]).toContain('designLibrary');
    });

    it('returns empty array for non-array JSON', () => {
      mockStorage.setItem('spaceAgencyDesignLibrary', JSON.stringify({ not: 'array' }));
      expect(loadSharedLibrary()).toEqual([]);
    });

    it('returns empty array for null JSON', () => {
      mockStorage.setItem('spaceAgencyDesignLibrary', 'null');
      expect(loadSharedLibrary()).toEqual([]);
    });
  });

  describe('saveSharedLibrary', () => {
    it('persists designs to localStorage', () => {
      const designs = [makeDesign()];
      saveSharedLibrary(designs);
      const raw = mockStorage.getItem('spaceAgencyDesignLibrary');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('design-test-1');
    });

    it('overwrites existing data', () => {
      seedSharedLibrary([makeDesign()]);
      saveSharedLibrary([makeDesign({ id: 'design-new' })]);
      const parsed = JSON.parse(mockStorage.getItem('spaceAgencyDesignLibrary'));
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('design-new');
    });

    it('throws user-friendly message on QuotaExceededError', () => {
      mockStorage.setItem = () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      };
      expect(() => saveSharedLibrary([makeDesign()])).toThrowError(/Storage full/);
    });

    it('re-throws non-quota errors unchanged', () => {
      mockStorage.setItem = () => { throw new TypeError('test error'); };
      expect(() => saveSharedLibrary([makeDesign()])).toThrowError(TypeError);
    });
  });

  describe('saveDesignToSharedLibrary', () => {
    it('adds a new design', () => {
      saveDesignToSharedLibrary(makeDesign());
      const lib = loadSharedLibrary();
      expect(lib).toHaveLength(1);
      expect(lib[0].name).toBe('Test Rocket');
    });

    it('overwrites existing design with same ID', () => {
      saveDesignToSharedLibrary(makeDesign());
      saveDesignToSharedLibrary(makeDesign({ name: 'Updated Rocket' }));
      const lib = loadSharedLibrary();
      expect(lib).toHaveLength(1);
      expect(lib[0].name).toBe('Updated Rocket');
    });

    it('appends when IDs differ', () => {
      saveDesignToSharedLibrary(makeDesign({ id: 'a' }));
      saveDesignToSharedLibrary(makeDesign({ id: 'b' }));
      expect(loadSharedLibrary()).toHaveLength(2);
    });
  });

  describe('deleteDesignFromSharedLibrary', () => {
    it('removes design by ID', () => {
      seedSharedLibrary([makeDesign({ id: 'a' }), makeDesign({ id: 'b' })]);
      deleteDesignFromSharedLibrary('a');
      const lib = loadSharedLibrary();
      expect(lib).toHaveLength(1);
      expect(lib[0].id).toBe('b');
    });

    it('no-ops for nonexistent ID', () => {
      seedSharedLibrary([makeDesign()]);
      deleteDesignFromSharedLibrary('nonexistent');
      expect(loadSharedLibrary()).toHaveLength(1);
    });
  });

  // ── Unified Library Access ──────────────────────────────────────────────

  describe('getAllDesigns', () => {
    it('returns shared designs when no private designs exist', () => {
      seedSharedLibrary([makeDesign()]);
      const state = freshState();
      const all = getAllDesigns(state);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('design-test-1');
    });

    it('includes private designs from state', () => {
      const state = freshState();
      state.savedDesigns = [makeDesign({ id: 'priv-1', savePrivate: true })];
      const all = getAllDesigns(state);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('priv-1');
    });

    it('merges shared and private designs', () => {
      seedSharedLibrary([makeDesign({ id: 'shared-1' })]);
      const state = freshState();
      state.savedDesigns = [makeDesign({ id: 'priv-1', savePrivate: true })];
      const all = getAllDesigns(state);
      expect(all).toHaveLength(2);
    });

    it('private overrides shared when IDs collide', () => {
      seedSharedLibrary([makeDesign({ id: 'same-id', name: 'Shared Version' })]);
      const state = freshState();
      state.savedDesigns = [makeDesign({ id: 'same-id', name: 'Private Version', savePrivate: true })];
      const all = getAllDesigns(state);
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe('Private Version');
    });

    it('excludes non-private designs from savedDesigns', () => {
      const state = freshState();
      state.savedDesigns = [
        makeDesign({ id: 'public-in-state', savePrivate: false }),
        makeDesign({ id: 'private-in-state', savePrivate: true }),
      ];
      const all = getAllDesigns(state);
      // Only private designs from savedDesigns are included
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('private-in-state');
    });

    it('handles undefined savedDesigns gracefully', () => {
      const state = freshState();
      state.savedDesigns = undefined;
      expect(() => getAllDesigns(state)).not.toThrow();
      expect(getAllDesigns(state)).toEqual([]);
    });
  });

  // ── Save/Delete Routing ─────────────────────────────────────────────────

  describe('saveDesignToLibrary', () => {
    it('saves shared design to localStorage', () => {
      const state = freshState();
      const design = makeDesign({ savePrivate: false });
      saveDesignToLibrary(state, design);
      expect(loadSharedLibrary()).toHaveLength(1);
      expect(state.savedDesigns).toHaveLength(0);
    });

    it('saves private design to state.savedDesigns', () => {
      const state = freshState();
      const design = makeDesign({ savePrivate: true });
      saveDesignToLibrary(state, design);
      expect(state.savedDesigns).toHaveLength(1);
      expect(state.savedDesigns[0].id).toBe('design-test-1');
      // Should NOT be in shared library
      expect(loadSharedLibrary()).toHaveLength(0);
    });

    it('moves design from shared to private', () => {
      seedSharedLibrary([makeDesign()]);
      const state = freshState();
      saveDesignToLibrary(state, makeDesign({ savePrivate: true }));
      // Removed from shared
      expect(loadSharedLibrary()).toHaveLength(0);
      // Added to private
      expect(state.savedDesigns).toHaveLength(1);
    });

    it('moves design from private to shared', () => {
      const state = freshState();
      state.savedDesigns = [makeDesign({ savePrivate: true })];
      saveDesignToLibrary(state, makeDesign({ savePrivate: false }));
      // Added to shared
      expect(loadSharedLibrary()).toHaveLength(1);
      // Removed from private
      expect(state.savedDesigns).toHaveLength(0);
    });

    it('handles undefined savedDesigns when saving private design', () => {
      const state = freshState();
      state.savedDesigns = undefined;
      const design = makeDesign({ savePrivate: true });
      expect(() => saveDesignToLibrary(state, design)).not.toThrow();
      expect(state.savedDesigns).toHaveLength(1);
      expect(state.savedDesigns[0].id).toBe('design-test-1');
    });

    it('handles null savedDesigns when saving private design', () => {
      const state = freshState();
      state.savedDesigns = null;
      const design = makeDesign({ savePrivate: true });
      expect(() => saveDesignToLibrary(state, design)).not.toThrow();
      expect(state.savedDesigns).toHaveLength(1);
    });

    it('handles undefined savedDesigns when saving shared design', () => {
      const state = freshState();
      state.savedDesigns = undefined;
      const design = makeDesign({ savePrivate: false });
      expect(() => saveDesignToLibrary(state, design)).not.toThrow();
      expect(loadSharedLibrary()).toHaveLength(1);
      expect(state.savedDesigns).toEqual([]);
    });

    it('overwrites existing private design with same ID', () => {
      const state = freshState();
      state.savedDesigns = [makeDesign({ savePrivate: true, name: 'Old' })];
      saveDesignToLibrary(state, makeDesign({ savePrivate: true, name: 'New' }));
      expect(state.savedDesigns).toHaveLength(1);
      expect(state.savedDesigns[0].name).toBe('New');
    });
  });

  describe('deleteDesignFromLibrary', () => {
    it('removes from both shared and private storage', () => {
      seedSharedLibrary([makeDesign()]);
      const state = freshState();
      state.savedDesigns = [makeDesign({ savePrivate: true })];
      deleteDesignFromLibrary(state, 'design-test-1');
      expect(loadSharedLibrary()).toHaveLength(0);
      expect(state.savedDesigns).toHaveLength(0);
    });

    it('handles design only in shared', () => {
      seedSharedLibrary([makeDesign()]);
      const state = freshState();
      deleteDesignFromLibrary(state, 'design-test-1');
      expect(loadSharedLibrary()).toHaveLength(0);
    });

    it('handles design only in private', () => {
      const state = freshState();
      state.savedDesigns = [makeDesign()];
      deleteDesignFromLibrary(state, 'design-test-1');
      expect(state.savedDesigns).toHaveLength(0);
    });

    it('handles undefined savedDesigns', () => {
      const state = freshState();
      state.savedDesigns = undefined;
      expect(() => deleteDesignFromLibrary(state, 'design-test-1')).not.toThrow();
      expect(state.savedDesigns).toEqual([]);
    });

    it('handles null savedDesigns', () => {
      const state = freshState();
      state.savedDesigns = null;
      expect(() => deleteDesignFromLibrary(state, 'design-test-1')).not.toThrow();
      expect(state.savedDesigns).toEqual([]);
    });
  });

  // ── Duplication ─────────────────────────────────────────────────────────

  describe('duplicateDesign', () => {
    it('creates a deep copy with new ID', () => {
      const original = makeDesign();
      const copy = duplicateDesign(original);
      expect(copy.id).not.toBe(original.id);
      expect(copy.id).toMatch(/^design-/);
    });

    it('appends " (Copy)" to the name', () => {
      const copy = duplicateDesign(makeDesign({ name: 'My Rocket' }));
      expect(copy.name).toBe('My Rocket (Copy)');
    });

    it('sets new creation and update timestamps', () => {
      const original = makeDesign({
        createdDate: '2020-01-01T00:00:00.000Z',
        updatedDate: '2020-06-01T00:00:00.000Z',
      });
      const copy = duplicateDesign(original);
      expect(copy.createdDate).not.toBe(original.createdDate);
      expect(copy.updatedDate).not.toBe(original.updatedDate);
    });

    it('does not share object references with original', () => {
      const original = makeDesign();
      const copy = duplicateDesign(original);
      copy.parts.push({ partId: 'parachute-mk1', position: { x: 0, y: -1 } });
      expect(original.parts).toHaveLength(3);
      expect(copy.parts).toHaveLength(4);
    });

    it('preserves part data faithfully', () => {
      const original = makeDesign();
      const copy = duplicateDesign(original);
      expect(copy.parts[0].partId).toBe(original.parts[0].partId);
      expect(copy.totalMass).toBe(original.totalMass);
      expect(copy.totalThrust).toBe(original.totalThrust);
    });
  });

  // ── Cost Breakdown ──────────────────────────────────────────────────────

  describe('calculateCostBreakdown', () => {
    it('computes parts cost from part definitions', () => {
      const design = makeDesign();
      const cost = calculateCostBreakdown(design);
      // probe-core-mk1: $5,000, tank-small: $800, engine-spark: $6,000
      expect(cost.partsCost).toBe(5_000 + 800 + 6_000);
    });

    it('computes fuel cost for fuel-carrying parts', () => {
      const design = makeDesign();
      const cost = calculateCostBreakdown(design);
      // tank-small: 400 kg LIQUID @ $0.50/kg = $200
      expect(cost.fuelCost).toBe(200);
    });

    it('computes correct total', () => {
      const design = makeDesign();
      const cost = calculateCostBreakdown(design);
      expect(cost.totalCost).toBe(cost.partsCost + cost.fuelCost);
    });

    it('returns part details sorted by cost descending', () => {
      const design = makeDesign();
      const cost = calculateCostBreakdown(design);
      expect(cost.partDetails.length).toBeGreaterThan(0);
      for (let i = 1; i < cost.partDetails.length; i++) {
        expect(cost.partDetails[i - 1].cost).toBeGreaterThanOrEqual(cost.partDetails[i].cost);
      }
    });

    it('aggregates duplicate parts into one entry', () => {
      const design = makeDesign({
        parts: [
          { partId: 'tank-small', position: { x: 0, y: 0 } },
          { partId: 'tank-small', position: { x: 0, y: 1 } },
          { partId: 'engine-spark', position: { x: 0, y: 2 } },
        ],
      });
      const cost = calculateCostBreakdown(design);
      const tankEntry = cost.partDetails.find((d) => d.partId === 'tank-small');
      expect(tankEntry.count).toBe(2);
      expect(tankEntry.cost).toBe(800 * 2);
    });

    it('handles design with no parts', () => {
      const design = makeDesign({ parts: [] });
      const cost = calculateCostBreakdown(design);
      expect(cost.partsCost).toBe(0);
      expect(cost.fuelCost).toBe(0);
      expect(cost.totalCost).toBe(0);
      expect(cost.partDetails).toEqual([]);
    });

    it('handles undefined parts gracefully', () => {
      const design = makeDesign({ parts: undefined });
      const cost = calculateCostBreakdown(design);
      expect(cost.totalCost).toBe(0);
    });

    it('skips unknown part IDs', () => {
      const design = makeDesign({
        parts: [
          { partId: 'nonexistent-part', position: { x: 0, y: 0 } },
          { partId: 'tank-small', position: { x: 0, y: 1 } },
        ],
      });
      const cost = calculateCostBreakdown(design);
      // Only tank-small counted
      expect(cost.partsCost).toBe(800);
    });
  });

  // ── Compatibility Checking ──────────────────────────────────────────────

  describe('checkDesignCompatibility', () => {
    it('returns green when all parts are starter parts', () => {
      const state = freshState();
      // Starter parts are not in any tech node, so always available
      const design = makeDesign({
        parts: [
          { partId: 'probe-core-mk1', position: { x: 0, y: 0 } },
          { partId: 'tank-small', position: { x: 0, y: 1 } },
          { partId: 'engine-spark', position: { x: 0, y: 2 } },
        ],
      });
      const result = checkDesignCompatibility(design, state);
      expect(result.status).toBe('green');
      expect(result.lockedPartIds).toHaveLength(0);
    });

    it('returns green when all parts are unlocked', () => {
      const state = freshState();
      state.parts = ['engine-spark-improved'];
      const design = makeDesign({
        parts: [
          { partId: 'probe-core-mk1', position: { x: 0, y: 0 } },
          { partId: 'engine-spark-improved', position: { x: 0, y: 1 } },
        ],
      });
      const result = checkDesignCompatibility(design, state);
      expect(result.status).toBe('green');
    });

    it('returns red when a tech-tree part is locked', () => {
      const state = freshState();
      // engine-spark-improved is in prop-t1, not unlocked
      const design = makeDesign({
        parts: [
          { partId: 'probe-core-mk1', position: { x: 0, y: 0 } },
          { partId: 'engine-spark-improved', position: { x: 0, y: 1 } },
        ],
      });
      const result = checkDesignCompatibility(design, state);
      expect(result.status).toBe('red');
      expect(result.lockedPartIds).toContain('engine-spark-improved');
    });

    it('provides locked part details with tech node info', () => {
      const state = freshState();
      const design = makeDesign({
        parts: [{ partId: 'engine-spark-improved', position: { x: 0, y: 0 } }],
      });
      const result = checkDesignCompatibility(design, state);
      expect(result.lockedDetails).toHaveLength(1);
      expect(result.lockedDetails[0].partId).toBe('engine-spark-improved');
      expect(result.lockedDetails[0].techNodeId).toBe('prop-t1');
      expect(result.lockedDetails[0].techNodeName).toBeTruthy();
    });

    it('deduplicates locked parts', () => {
      const state = freshState();
      const design = makeDesign({
        parts: [
          { partId: 'engine-spark-improved', position: { x: 0, y: 0 } },
          { partId: 'engine-spark-improved', position: { x: 0, y: 1 } },
        ],
      });
      const result = checkDesignCompatibility(design, state);
      expect(result.lockedPartIds).toHaveLength(1);
      expect(result.lockedDetails).toHaveLength(1);
    });

    it('handles empty parts array', () => {
      const state = freshState();
      const design = makeDesign({ parts: [] });
      const result = checkDesignCompatibility(design, state);
      expect(result.status).toBe('green');
    });

    it('handles undefined parts', () => {
      const state = freshState();
      const design = makeDesign({ parts: undefined });
      const result = checkDesignCompatibility(design, state);
      expect(result.status).toBe('green');
    });

    it('handles undefined state.parts', () => {
      const state = freshState();
      state.parts = undefined;
      const design = makeDesign({
        parts: [{ partId: 'engine-spark-improved', position: { x: 0, y: 0 } }],
      });
      const result = checkDesignCompatibility(design, state);
      expect(result.status).toBe('red');
    });
  });

  // ── Design Grouping ─────────────────────────────────────────────────────

  describe('groupDesigns', () => {
    it('classifies a single-stage probe design', () => {
      const designs = [makeDesign()];
      const groups = groupDesigns(designs);
      const singleStage = groups.find((g) => g.groupId === 'single-stage');
      const probe = groups.find((g) => g.groupId === 'probe');
      expect(singleStage).toBeDefined();
      expect(singleStage.designs).toHaveLength(1);
      expect(probe).toBeDefined();
    });

    it('classifies crewed designs', () => {
      const designs = [makeCrewedDesign()];
      const groups = groupDesigns(designs);
      const crewed = groups.find((g) => g.groupId === 'crewed');
      expect(crewed).toBeDefined();
      expect(crewed.designs).toHaveLength(1);
    });

    it('classifies satellite designs', () => {
      const designs = [makeSatelliteDesign()];
      const groups = groupDesigns(designs);
      const sat = groups.find((g) => g.groupId === 'satellite');
      expect(sat).toBeDefined();
    });

    it('classifies heavy designs (>= 50,000 kg)', () => {
      const heavy = makeDesign({ totalMass: 50_000 });
      const light = makeDesign({ id: 'light', totalMass: 1000 });
      const groups = groupDesigns([heavy, light]);
      const heavyGroup = groups.find((g) => g.groupId === 'heavy');
      expect(heavyGroup).toBeDefined();
      expect(heavyGroup.designs).toHaveLength(1);
      expect(heavyGroup.designs[0].totalMass).toBe(50_000);
    });

    it('classifies 2-stage designs', () => {
      const design = makeDesign({
        staging: { stages: [[0], [1]], unstaged: [] },
      });
      const groups = groupDesigns([design]);
      const twoStage = groups.find((g) => g.groupId === '2-stage');
      expect(twoStage).toBeDefined();
    });

    it('classifies 3+ stage designs', () => {
      const design = makeDesign({
        staging: { stages: [[0], [1], [2]], unstaged: [] },
      });
      const groups = groupDesigns([design]);
      const threeStage = groups.find((g) => g.groupId === '3-stage');
      expect(threeStage).toBeDefined();
    });

    it('a design can appear in multiple groups', () => {
      const crewedHeavy = makeCrewedDesign({ totalMass: 60_000 });
      const groups = groupDesigns([crewedHeavy]);
      const crewed = groups.find((g) => g.groupId === 'crewed');
      const heavy = groups.find((g) => g.groupId === 'heavy');
      expect(crewed).toBeDefined();
      expect(heavy).toBeDefined();
    });

    it('omits groups with no matching designs', () => {
      const designs = [makeDesign({ totalMass: 100 })];
      const groups = groupDesigns(designs);
      const heavy = groups.find((g) => g.groupId === 'heavy');
      expect(heavy).toBeUndefined();
    });

    it('handles empty designs array', () => {
      expect(groupDesigns([])).toEqual([]);
    });

    it('handles design with no staging data', () => {
      const design = makeDesign({ staging: undefined });
      // Should default to single stage
      const groups = groupDesigns([design]);
      const singleStage = groups.find((g) => g.groupId === 'single-stage');
      expect(singleStage).toBeDefined();
    });

    it('filters out empty stages when counting', () => {
      const design = makeDesign({
        staging: { stages: [[0], [], [1]], unstaged: [] },
      });
      const groups = groupDesigns([design]);
      // 2 non-empty stages
      const twoStage = groups.find((g) => g.groupId === '2-stage');
      expect(twoStage).toBeDefined();
    });
  });

  describe('getDesignGroupDefs', () => {
    it('returns 7 group definitions', () => {
      const defs = getDesignGroupDefs();
      expect(defs).toHaveLength(7);
    });

    it('each definition has id and label', () => {
      for (const def of getDesignGroupDefs()) {
        expect(def.id).toBeTruthy();
        expect(def.label).toBeTruthy();
      }
    });

    it('does not expose test functions', () => {
      for (const def of getDesignGroupDefs()) {
        expect(def.test).toBeUndefined();
      }
    });
  });

  describe('filterDesignsByGroup', () => {
    it('returns all designs when groupId is null', () => {
      const designs = [makeDesign(), makeCrewedDesign()];
      expect(filterDesignsByGroup(designs, null)).toHaveLength(2);
    });

    it('returns all designs for unknown groupId', () => {
      const designs = [makeDesign()];
      expect(filterDesignsByGroup(designs, 'nonexistent-group')).toHaveLength(1);
    });

    it('filters designs by group', () => {
      const designs = [makeDesign(), makeCrewedDesign()];
      const crewed = filterDesignsByGroup(designs, 'crewed');
      expect(crewed).toHaveLength(1);
      expect(crewed[0].id).toBe('design-crewed-1');
    });

    it('returns empty array if no designs match', () => {
      const designs = [makeDesign({ totalMass: 100 })];
      const heavy = filterDesignsByGroup(designs, 'heavy');
      expect(heavy).toHaveLength(0);
    });
  });
});
