// @ts-nocheck
/**
 * techtree.test.js — Unit tests for the technology tree system.
 *
 * Tests cover:
 *   - Data definitions: TECH_NODES, TechBranch, TIER_COSTS, lookups
 *   - Core logic: isNodeResearched, isNodeTutorialUnlocked, isNodeUnlocked,
 *                 canResearchNode, researchNode
 *   - Aggregation: getTechTreeUnlockedParts, getTechTreeUnlockedInstruments,
 *                  isInstrumentAvailable, getTechTreeStatus
 *   - Integration: getUnlockedParts includes tech tree parts,
 *                  getAvailableInstruments uses tech tree state
 *   - Save/load backward compatibility
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  isNodeResearched,
  isNodeTutorialUnlocked,
  isNodeUnlocked,
  canResearchNode,
  researchNode,
  getMaxResearchableTier,
  getTechTreeUnlockedParts,
  getTechTreeUnlockedInstruments,
  isInstrumentAvailable,
  getTechTreeStatus,
} from '../core/techtree.ts';
import {
  TECH_NODES,
  TechBranch,
  TIER_COSTS,
  BRANCH_NAMES,
  getTechNodeById,
  getNodesByBranch,
  getNodeByBranchAndTier,
  getAllTechNodes,
} from '../data/techtree.ts';
import {
  getAvailableInstruments,
  getInstrumentsByTier,
} from '../data/instruments.ts';
import { getUnlockedParts } from '../core/missions.ts';
import { FacilityId, RD_TIER_MAX_TECH } from '../core/constants.ts';
import { buildFacility } from '../core/construction.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fresh game state, non-tutorial mode, with R&D Lab built. */
function readyState() {
  const state = createGameState();
  state.tutorialMode = false;
  state.money = 10_000_000;
  state.sciencePoints = 1000;
  buildFacility(state, FacilityId.RD_LAB);
  return state;
}

/** Fresh game state, non-tutorial mode, NO R&D Lab. */
function noLabState() {
  const state = createGameState();
  state.tutorialMode = false;
  state.money = 10_000_000;
  state.sciencePoints = 1000;
  return state;
}

// ===========================================================================
// Data Definitions
// ===========================================================================

describe('Tech Tree Data', () => {

  describe('TECH_NODES', () => {
    it('contains exactly 21 nodes (4 branches × 5 tiers + 1 tier-6 structural)', () => {
      expect(TECH_NODES).toHaveLength(21);
    });

    it('each node has required fields', () => {
      for (const node of TECH_NODES) {
        expect(node.id).toBeTruthy();
        expect(node.name).toBeTruthy();
        expect(Object.values(TechBranch)).toContain(node.branch);
        expect(node.tier).toBeGreaterThanOrEqual(1);
        expect(node.tier).toBeLessThanOrEqual(6);
        expect(typeof node.scienceCost).toBe('number');
        expect(typeof node.fundsCost).toBe('number');
        expect(Array.isArray(node.unlocksParts)).toBe(true);
        expect(Array.isArray(node.unlocksInstruments)).toBe(true);
        expect(node.description).toBeTruthy();
      }
    });

    it('node IDs are unique', () => {
      const ids = TECH_NODES.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('each branch has at least 5 tiers (1 through 5), structural has 6', () => {
      for (const branch of Object.values(TechBranch)) {
        const nodes = TECH_NODES.filter((n) => n.branch === branch);
        const tiers = nodes.map((n) => n.tier).sort();
        if (branch === TechBranch.STRUCTURAL) {
          expect(nodes).toHaveLength(6);
          expect(tiers).toEqual([1, 2, 3, 4, 5, 6]);
        } else {
          expect(nodes).toHaveLength(5);
          expect(tiers).toEqual([1, 2, 3, 4, 5]);
        }
      }
    });

    it('costs match the TIER_COSTS table', () => {
      for (const node of TECH_NODES) {
        const expected = TIER_COSTS[node.tier];
        expect(node.scienceCost).toBe(expected.science);
        expect(node.fundsCost).toBe(expected.funds);
      }
    });

    it('starter parts do not appear in any node', () => {
      const starterParts = [
        'probe-core-mk1', 'tank-small', 'engine-spark',
        'parachute-mk1', 'science-module-mk1', 'thermometer-mk1', 'cmd-mk1',
      ];
      for (const node of TECH_NODES) {
        for (const sp of starterParts) {
          expect(node.unlocksParts).not.toContain(sp);
        }
      }
    });
  });

  describe('TIER_COSTS', () => {
    it('T1 = 15 sci / $50k', () => {
      expect(TIER_COSTS[1]).toEqual({ science: 15, funds: 50_000 });
    });
    it('T2 = 30 sci / $100k', () => {
      expect(TIER_COSTS[2]).toEqual({ science: 30, funds: 100_000 });
    });
    it('T3 = 60 sci / $200k', () => {
      expect(TIER_COSTS[3]).toEqual({ science: 60, funds: 200_000 });
    });
    it('T4 = 120 sci / $400k', () => {
      expect(TIER_COSTS[4]).toEqual({ science: 120, funds: 400_000 });
    });
    it('T5 = 200 sci / $750k', () => {
      expect(TIER_COSTS[5]).toEqual({ science: 200, funds: 750_000 });
    });
  });

  describe('TechBranch', () => {
    it('defines 4 branches', () => {
      expect(Object.keys(TechBranch)).toHaveLength(4);
    });
    it('each branch has a display name', () => {
      for (const branch of Object.values(TechBranch)) {
        expect(BRANCH_NAMES[branch]).toBeTruthy();
      }
    });
  });

  describe('Lookup helpers', () => {
    it('getTechNodeById returns the correct node', () => {
      const node = getTechNodeById('prop-t1');
      expect(node).toBeDefined();
      expect(node.name).toBe('Improved Spark');
    });

    it('getTechNodeById returns undefined for unknown ID', () => {
      expect(getTechNodeById('nonexistent')).toBeUndefined();
    });

    it('getNodesByBranch returns 5 nodes sorted by tier', () => {
      const nodes = getNodesByBranch(TechBranch.PROPULSION);
      expect(nodes).toHaveLength(5);
      for (let i = 0; i < nodes.length - 1; i++) {
        expect(nodes[i].tier).toBeLessThan(nodes[i + 1].tier);
      }
    });

    it('getNodeByBranchAndTier returns the correct node', () => {
      const node = getNodeByBranchAndTier(TechBranch.SCIENCE, 3);
      expect(node).toBeDefined();
      expect(node.id).toBe('sci-t3');
      expect(node.name).toBe('Field Instruments');
    });

    it('getAllTechNodes returns all 21 nodes', () => {
      expect(getAllTechNodes()).toHaveLength(21);
    });
  });

  describe('Branch contents', () => {
    it('Propulsion: Improved Spark → Reliant → Poodle → Ion → Nuclear', () => {
      const names = getNodesByBranch(TechBranch.PROPULSION).map((n) => n.name);
      expect(names).toEqual([
        'Improved Spark', 'Reliant', 'Poodle', 'Ion Drive', 'Nuclear Thermal',
      ]);
    });

    it('Structural: Medium Tank → Radial Attachments → Heavy Structures → Docking Ports → Station Segments → Industrial Grapple', () => {
      const names = getNodesByBranch(TechBranch.STRUCTURAL).map((n) => n.name);
      expect(names).toEqual([
        'Medium Tank', 'Radial Attachments', 'Heavy Structures',
        'Docking Ports', 'Station Segments', 'Industrial Grapple',
      ]);
    });

    it('Recovery: Parachute Mk2 → Drogue Chute → Heat Shield → Powered Landing → Solar Approach', () => {
      const names = getNodesByBranch(TechBranch.RECOVERY).map((n) => n.name);
      expect(names).toEqual([
        'Parachute Mk2', 'Drogue Chute', 'Heat Shield',
        'Powered Landing', 'Solar Approach',
      ]);
    });

    it('Science: Barometer → Radiation Detector → Field Instruments → Science Lab → Deep Space Instruments', () => {
      const names = getNodesByBranch(TechBranch.SCIENCE).map((n) => n.name);
      expect(names).toEqual([
        'Barometer', 'Radiation Detector', 'Field Instruments',
        'Science Lab', 'Deep Space Instruments',
      ]);
    });
  });
});

// ===========================================================================
// Core Logic
// ===========================================================================

describe('Tech Tree Core Logic', () => {

  describe('isNodeResearched', () => {
    it('returns false on a fresh state', () => {
      const state = readyState();
      expect(isNodeResearched(state, 'prop-t1')).toBe(false);
    });

    it('returns true after researching', () => {
      const state = readyState();
      researchNode(state, 'prop-t1');
      expect(isNodeResearched(state, 'prop-t1')).toBe(true);
    });

    it('handles missing techTree gracefully', () => {
      const state = readyState();
      delete state.techTree;
      expect(isNodeResearched(state, 'prop-t1')).toBe(false);
    });
  });

  describe('isNodeTutorialUnlocked', () => {
    it('returns false when parts are not owned', () => {
      const state = readyState();
      expect(isNodeTutorialUnlocked(state, 'recov-t1')).toBe(false);
    });

    it('returns true when all parts in the node are already owned', () => {
      const state = readyState();
      // parachute-mk2 is the only part in recov-t1
      state.parts.push('parachute-mk2');
      expect(isNodeTutorialUnlocked(state, 'recov-t1')).toBe(true);
    });

    it('returns false if node has been explicitly researched', () => {
      const state = readyState();
      researchNode(state, 'prop-t1');
      // Even though parts are now owned, it's "researched" not "tutorial-unlocked"
      expect(isNodeTutorialUnlocked(state, 'prop-t1')).toBe(false);
    });

    it('returns true for instrument nodes when all instruments are in unlockedInstruments', () => {
      const state = readyState();
      state.techTree.unlockedInstruments.push('barometer', 'surface-sampler');
      expect(isNodeTutorialUnlocked(state, 'sci-t1')).toBe(true);
    });

    it('returns false for unknown node', () => {
      const state = readyState();
      expect(isNodeTutorialUnlocked(state, 'nonexistent')).toBe(false);
    });
  });

  describe('isNodeUnlocked', () => {
    it('returns true when researched', () => {
      const state = readyState();
      researchNode(state, 'prop-t1');
      expect(isNodeUnlocked(state, 'prop-t1')).toBe(true);
    });

    it('returns true when tutorial-unlocked', () => {
      const state = readyState();
      state.parts.push('parachute-mk2');
      expect(isNodeUnlocked(state, 'recov-t1')).toBe(true);
    });

    it('returns false when neither researched nor tutorial-unlocked', () => {
      const state = readyState();
      expect(isNodeUnlocked(state, 'prop-t1')).toBe(false);
    });
  });

  describe('getMaxResearchableTier', () => {
    it('returns 0 when R&D Lab is not built', () => {
      const state = noLabState();
      expect(getMaxResearchableTier(state)).toBe(0);
    });

    it('returns max tier 2 for R&D Lab tier 1', () => {
      const state = readyState();
      expect(getMaxResearchableTier(state)).toBe(2);
    });

    it('returns max tier 4 for R&D Lab tier 2', () => {
      const state = readyState();
      state.facilities[FacilityId.RD_LAB].tier = 2;
      expect(getMaxResearchableTier(state)).toBe(4);
    });

    it('returns max tier 6 for R&D Lab tier 3', () => {
      const state = readyState();
      state.facilities[FacilityId.RD_LAB].tier = 3;
      expect(getMaxResearchableTier(state)).toBe(6);
    });
  });

  describe('canResearchNode', () => {
    it('rejects unknown node', () => {
      const state = readyState();
      const result = canResearchNode(state, 'nonexistent');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Unknown/i);
    });

    it('rejects already-researched node', () => {
      const state = readyState();
      researchNode(state, 'prop-t1');
      const result = canResearchNode(state, 'prop-t1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Already researched/i);
    });

    it('rejects tutorial-unlocked node', () => {
      const state = readyState();
      state.parts.push('parachute-mk2');
      const result = canResearchNode(state, 'recov-t1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/tutorial/i);
    });

    it('rejects when R&D Lab is not built', () => {
      const state = noLabState();
      const result = canResearchNode(state, 'prop-t1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/R&D Lab/i);
    });

    it('rejects when previous tier not unlocked', () => {
      const state = readyState();
      const result = canResearchNode(state, 'prop-t2');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Improved Spark/i);
    });

    it('allows T2 when T1 is tutorial-unlocked (not researched)', () => {
      const state = readyState();
      // Tutorial-unlock T1 by granting its parts
      state.parts.push('engine-spark-improved');
      const result = canResearchNode(state, 'prop-t2');
      expect(result.allowed).toBe(true);
    });

    it('rejects when insufficient science points', () => {
      const state = readyState();
      state.sciencePoints = 0;
      const result = canResearchNode(state, 'prop-t1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/science/i);
    });

    it('rejects when insufficient funds', () => {
      const state = readyState();
      state.money = 0;
      const result = canResearchNode(state, 'prop-t1');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/funds/i);
    });

    it('allows T1 with enough science and funds', () => {
      const state = readyState();
      const result = canResearchNode(state, 'prop-t1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('researchNode', () => {
    it('successfully researches a T1 node', () => {
      const state = readyState();
      const scienceBefore = state.sciencePoints;
      const moneyBefore = state.money;

      const result = researchNode(state, 'prop-t1');
      expect(result.success).toBe(true);
      expect(result.unlockedParts).toContain('engine-spark-improved');
      expect(state.sciencePoints).toBe(scienceBefore - TIER_COSTS[1].science);
      expect(state.money).toBe(moneyBefore - TIER_COSTS[1].funds);
      expect(state.techTree.researched).toContain('prop-t1');
      expect(state.parts).toContain('engine-spark-improved');
    });

    it('deducts correct costs for each tier', () => {
      const state = readyState();
      state.sciencePoints = 10_000;
      state.money = 50_000_000;

      // Research T1 then T2 in propulsion
      researchNode(state, 'prop-t1');
      const sciAfterT1 = state.sciencePoints;
      const monAfterT1 = state.money;

      researchNode(state, 'prop-t2');
      expect(state.sciencePoints).toBe(sciAfterT1 - TIER_COSTS[2].science);
      expect(state.money).toBe(monAfterT1 - TIER_COSTS[2].funds);
    });

    it('unlocks instruments for Science branch nodes', () => {
      const state = readyState();
      const result = researchNode(state, 'sci-t1');

      expect(result.success).toBe(true);
      expect(result.unlockedInstruments).toContain('barometer');
      expect(result.unlockedInstruments).toContain('surface-sampler');
      expect(state.techTree.unlockedInstruments).toContain('barometer');
      expect(state.techTree.unlockedInstruments).toContain('surface-sampler');
    });

    it('does not add duplicate parts if already owned', () => {
      const state = readyState();
      state.parts.push('engine-reliant'); // Pre-own via tutorial
      researchNode(state, 'prop-t1');
      researchNode(state, 'prop-t2'); // unlocks engine-reliant

      const reliantCount = state.parts.filter((p) => p === 'engine-reliant').length;
      expect(reliantCount).toBe(1);
    });

    it('fails when preconditions are not met', () => {
      const state = readyState();
      state.sciencePoints = 0;
      const result = researchNode(state, 'prop-t1');
      expect(result.success).toBe(false);
      expect(result.unlockedParts).toHaveLength(0);
    });

    it('@smoke can chain-research a full branch (R&D Lab tier 3)', () => {
      const state = readyState();
      state.facilities[FacilityId.RD_LAB].tier = 3;
      state.sciencePoints = 10_000;
      state.money = 50_000_000;

      for (let tier = 1; tier <= 5; tier++) {
        const nodeId = `prop-t${tier}`;
        const result = researchNode(state, nodeId);
        expect(result.success).toBe(true);
      }
      expect(state.techTree.researched).toHaveLength(5);
    });

    it('blocks tier 3+ nodes when R&D Lab is tier 1', () => {
      const state = readyState();
      state.sciencePoints = 10_000;
      state.money = 50_000_000;
      // Research T1 and T2 (allowed at R&D Lab tier 1)
      researchNode(state, 'prop-t1');
      researchNode(state, 'prop-t2');
      // T3 should be blocked — R&D Lab tier 1 only allows tech tiers 1–2
      const result = canResearchNode(state, 'prop-t3');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('upgraded');
    });

    it('handles missing techTree gracefully on older saves', () => {
      const state = readyState();
      delete state.techTree;
      const result = researchNode(state, 'prop-t1');
      expect(result.success).toBe(true);
      expect(state.techTree.researched).toContain('prop-t1');
    });
  });
});

// ===========================================================================
// Aggregation Helpers
// ===========================================================================

describe('Tech Tree Aggregation', () => {

  describe('getTechTreeUnlockedParts', () => {
    it('returns empty array on fresh state', () => {
      const state = readyState();
      expect(getTechTreeUnlockedParts(state)).toEqual([]);
    });

    it('returns parts from researched nodes', () => {
      const state = readyState();
      researchNode(state, 'prop-t1');
      researchNode(state, 'struct-t1');
      const parts = getTechTreeUnlockedParts(state);
      expect(parts).toContain('engine-spark-improved');
      expect(parts).toContain('tank-medium');
    });
  });

  describe('getTechTreeUnlockedInstruments', () => {
    it('returns empty array on fresh state', () => {
      const state = readyState();
      expect(getTechTreeUnlockedInstruments(state)).toEqual([]);
    });

    it('returns instruments from researched Science nodes', () => {
      const state = readyState();
      researchNode(state, 'sci-t1');
      const instruments = getTechTreeUnlockedInstruments(state);
      expect(instruments).toContain('barometer');
      expect(instruments).toContain('surface-sampler');
    });
  });

  describe('isInstrumentAvailable', () => {
    it('starter instruments (techTier 0) are always available', () => {
      const state = readyState();
      expect(isInstrumentAvailable(state, 'thermometer-mk1', 0)).toBe(true);
    });

    it('non-starter instruments are unavailable before research', () => {
      const state = readyState();
      expect(isInstrumentAvailable(state, 'barometer', 1)).toBe(false);
    });

    it('non-starter instruments become available after research', () => {
      const state = readyState();
      researchNode(state, 'sci-t1');
      expect(isInstrumentAvailable(state, 'barometer', 1)).toBe(true);
    });
  });

  describe('getTechTreeStatus', () => {
    it('returns an entry for every node', () => {
      const state = readyState();
      const status = getTechTreeStatus(state);
      expect(status).toHaveLength(21);
    });

    it('marks researched nodes correctly', () => {
      const state = readyState();
      researchNode(state, 'prop-t1');
      const status = getTechTreeStatus(state);
      const prop1 = status.find((n) => n.id === 'prop-t1');
      expect(prop1.researched).toBe(true);
      expect(prop1.unlocked).toBe(true);
      expect(prop1.canResearch).toBe(false);
    });

    it('marks tutorial-unlocked nodes correctly', () => {
      const state = readyState();
      state.parts.push('parachute-mk2');
      const status = getTechTreeStatus(state);
      const recov1 = status.find((n) => n.id === 'recov-t1');
      expect(recov1.tutorialUnlocked).toBe(true);
      expect(recov1.unlocked).toBe(true);
      expect(recov1.researched).toBe(false);
    });

    it('marks available-to-research T1 nodes correctly', () => {
      const state = readyState();
      const status = getTechTreeStatus(state);
      const prop1 = status.find((n) => n.id === 'prop-t1');
      expect(prop1.canResearch).toBe(true);
      expect(prop1.unlocked).toBe(false);
    });
  });
});

// ===========================================================================
// Integration with Other Systems
// ===========================================================================

describe('Tech Tree Integration', () => {

  describe('getUnlockedParts (missions.js) includes tech tree parts', () => {
    it('includes parts from tech tree research', () => {
      const state = readyState();
      researchNode(state, 'struct-t1');
      const parts = getUnlockedParts(state);
      expect(parts).toContain('tank-medium');
    });

    it('deduplicates parts from missions and tech tree', () => {
      const state = readyState();
      // Simulate mission unlocking engine-reliant
      state.parts.push('engine-reliant');
      // Then also research it via tech tree
      researchNode(state, 'prop-t1');
      researchNode(state, 'prop-t2');
      const parts = getUnlockedParts(state);
      const count = parts.filter((p) => p === 'engine-reliant').length;
      expect(count).toBe(1);
    });
  });

  describe('getAvailableInstruments (instruments.js) uses tech tree state', () => {
    it('returns only starter instruments on a fresh state', () => {
      const state = readyState();
      const available = getAvailableInstruments(state);
      expect(available.length).toBeGreaterThanOrEqual(1);
      for (const inst of available) {
        expect(inst.techTier).toBe(0);
      }
    });

    it('includes tier 1 instruments after researching Science T1', () => {
      const state = readyState();
      researchNode(state, 'sci-t1');
      const available = getAvailableInstruments(state);
      expect(available.some((i) => i.id === 'barometer')).toBe(true);
      expect(available.some((i) => i.id === 'surface-sampler')).toBe(true);
      // Starter should still be there
      expect(available.some((i) => i.id === 'thermometer-mk1')).toBe(true);
    });

    it('does not include tier 2 instruments without researching Science T2', () => {
      const state = readyState();
      researchNode(state, 'sci-t1');
      const available = getAvailableInstruments(state);
      expect(available.some((i) => i.id === 'radiation-detector')).toBe(false);
    });
  });

  describe('Game state initialisation', () => {
    it('createGameState includes techTree with empty arrays', () => {
      const state = createGameState();
      expect(state.techTree).toBeDefined();
      expect(state.techTree.researched).toEqual([]);
      expect(state.techTree.unlockedInstruments).toEqual([]);
    });
  });
});
