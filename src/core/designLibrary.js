/**
 * designLibrary.js — Rocket design library system.
 *
 * Manages saved rocket designs with features for:
 *   - Shared storage across save slots (localStorage) with save-private toggle
 *   - Cost breakdown (parts + fuel, excluding crew salaries)
 *   - Design classification / grouping (stage count, crewed, probe, etc.)
 *   - Compatibility checking against current tech tree unlocks
 *   - Duplicate design
 *
 * STORAGE
 * =======
 *   - Shared designs live in localStorage key `spaceAgencyDesignLibrary`
 *   - Save-private designs live in each save slot's `savedDesigns` array
 *   - On load, both pools are merged for display; writes target the correct pool
 *
 * @module core/designLibrary
 */

import { getPartById } from '../data/parts.js';
import { PartType } from './constants.js';
import { TECH_NODES } from '../data/techtree.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for shared (cross-save) designs. */
const SHARED_LIBRARY_KEY = 'spaceAgencyDesignLibrary';

// ---------------------------------------------------------------------------
// Design Group Definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DesignGroup
 * @property {string} id       - Stable group identifier.
 * @property {string} label    - Display label.
 * @property {(design: import('./gameState.js').RocketDesign) => boolean} test
 *   Predicate — returns true if the design belongs to this group.
 */

/** @type {DesignGroup[]} */
const DESIGN_GROUPS = [
  {
    id: 'single-stage',
    label: 'Single Stage',
    test: (d) => _countStages(d) === 1,
  },
  {
    id: '2-stage',
    label: '2-Stage',
    test: (d) => _countStages(d) === 2,
  },
  {
    id: '3-stage',
    label: '3+ Stage',
    test: (d) => _countStages(d) >= 3,
  },
  {
    id: 'crewed',
    label: 'Crewed',
    test: (d) => _hasPartOfType(d, PartType.COMMAND_MODULE),
  },
  {
    id: 'probe',
    label: 'Probe',
    test: (d) =>
      _hasPartOfType(d, PartType.COMPUTER_MODULE) &&
      !_hasPartOfType(d, PartType.COMMAND_MODULE),
  },
  {
    id: 'satellite',
    label: 'Satellite',
    test: (d) => _hasPartOfType(d, PartType.SATELLITE),
  },
  {
    id: 'heavy',
    label: 'Heavy',
    test: (d) => (d.totalMass ?? 0) >= 50_000,
  },
];

// ---------------------------------------------------------------------------
// Group Helpers (private)
// ---------------------------------------------------------------------------

/**
 * Count the number of stages in a design.
 * @param {import('./gameState.js').RocketDesign} design
 * @returns {number}
 */
function _countStages(design) {
  if (!design.staging?.stages) return 1;
  // Filter out empty stages
  const nonEmpty = design.staging.stages.filter(
    (s) => (Array.isArray(s) ? s.length : (s?.instanceIds?.length ?? 0)) > 0,
  );
  return Math.max(nonEmpty.length, 1);
}

/**
 * Check if a design has at least one part of the given type.
 * @param {import('./gameState.js').RocketDesign} design
 * @param {string} partType  PartType enum value
 * @returns {boolean}
 */
function _hasPartOfType(design, partType) {
  if (!design.parts) return false;
  return design.parts.some((p) => {
    const def = getPartById(p.partId);
    return def?.type === partType;
  });
}

// ---------------------------------------------------------------------------
// Shared Library Storage
// ---------------------------------------------------------------------------

/**
 * Load the shared design library from localStorage.
 * @returns {import('./gameState.js').RocketDesign[]}
 */
export function loadSharedLibrary() {
  try {
    const raw = localStorage.getItem(SHARED_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('designLibrary: failed to parse shared library from localStorage:', err);
    return [];
  }
}

/**
 * Save the shared design library to localStorage.
 * @param {import('./gameState.js').RocketDesign[]} designs
 */
export function saveSharedLibrary(designs) {
  try {
    localStorage.setItem(SHARED_LIBRARY_KEY, JSON.stringify(designs));
  } catch (err) {
    if (err?.name === 'QuotaExceededError') {
      throw new Error('Storage full — unable to save design library. Delete old saves or designs to free space.', { cause: err });
    }
    throw err;
  }
}

/**
 * Save or overwrite a design in the shared library.
 * @param {import('./gameState.js').RocketDesign} design
 */
export function saveDesignToSharedLibrary(design) {
  const lib = loadSharedLibrary();
  const idx = lib.findIndex((d) => d.id === design.id);
  if (idx >= 0) {
    lib[idx] = design;
  } else {
    lib.push(design);
  }
  saveSharedLibrary(lib);
}

/**
 * Delete a design from the shared library by ID.
 * @param {string} designId
 */
export function deleteDesignFromSharedLibrary(designId) {
  const lib = loadSharedLibrary();
  saveSharedLibrary(lib.filter((d) => d.id !== designId));
}

// ---------------------------------------------------------------------------
// Unified Library Access
// ---------------------------------------------------------------------------

/**
 * Get all designs visible to the player, combining shared library and
 * save-private designs from the current game state.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('./gameState.js').RocketDesign[]}
 */
export function getAllDesigns(state) {
  const shared = loadSharedLibrary();
  const priv = (state.savedDesigns ?? []).filter((d) => d.savePrivate);
  // Merge, dedup by ID (private overrides shared)
  const byId = new Map();
  for (const d of shared) byId.set(d.id, d);
  for (const d of priv) byId.set(d.id, d);
  return [...byId.values()];
}

/**
 * Save a design to the appropriate storage (shared or private).
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').RocketDesign} design
 */
export function saveDesignToLibrary(state, design) {
  if (!Array.isArray(state.savedDesigns)) state.savedDesigns = [];
  if (design.savePrivate) {
    // Save to game state's private designs
    const idx = state.savedDesigns.findIndex((d) => d.id === design.id);
    if (idx >= 0) {
      state.savedDesigns[idx] = design;
    } else {
      state.savedDesigns.push(design);
    }
    // Remove from shared if it was there
    deleteDesignFromSharedLibrary(design.id);
  } else {
    // Save to shared library
    saveDesignToSharedLibrary(design);
    // Remove from private if it was there
    state.savedDesigns = state.savedDesigns.filter((d) => d.id !== design.id);
  }
}

/**
 * Delete a design from whichever storage it's in.
 * @param {import('./gameState.js').GameState} state
 * @param {string} designId
 */
export function deleteDesignFromLibrary(state, designId) {
  if (!Array.isArray(state.savedDesigns)) state.savedDesigns = [];
  // Remove from both locations
  state.savedDesigns = state.savedDesigns.filter((d) => d.id !== designId);
  deleteDesignFromSharedLibrary(designId);
}

/**
 * Duplicate a design with a new ID and name.
 * @param {import('./gameState.js').RocketDesign} original
 * @returns {import('./gameState.js').RocketDesign}
 */
export function duplicateDesign(original) {
  const now = new Date().toISOString();
  return {
    ...JSON.parse(JSON.stringify(original)),
    id: 'design-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name: original.name + ' (Copy)',
    createdDate: now,
    updatedDate: now,
  };
}

// ---------------------------------------------------------------------------
// Cost Breakdown
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CostBreakdown
 * @property {number} partsCost  - Total cost of all parts (dry cost).
 * @property {number} fuelCost   - Total cost of propellant (fuel mass × rate).
 * @property {number} totalCost  - partsCost + fuelCost.
 * @property {{ partId: string, name: string, cost: number, count: number }[]} partDetails
 *   Per-part-type cost breakdown.
 */

/** Cost per kg of fuel by type. */
const FUEL_COST_PER_KG = {
  LIQUID: 0.50,
  SOLID: 0.30,
  MONOPROPELLANT: 0.80,
  ELECTRIC: 2.00,
};

/**
 * Calculate the full launch cost breakdown for a design.
 * Includes parts and fuel; does NOT include crew salaries.
 *
 * @param {import('./gameState.js').RocketDesign} design
 * @returns {CostBreakdown}
 */
export function calculateCostBreakdown(design) {
  let partsCost = 0;
  let fuelCost = 0;

  /** @type {Map<string, { partId: string, name: string, cost: number, count: number }>} */
  const partMap = new Map();

  for (const p of design.parts ?? []) {
    const def = getPartById(p.partId);
    if (!def) continue;

    // Part cost
    partsCost += def.cost;

    // Aggregate per unique part
    const existing = partMap.get(def.id);
    if (existing) {
      existing.count++;
      existing.cost += def.cost;
    } else {
      partMap.set(def.id, { partId: def.id, name: def.name, cost: def.cost, count: 1 });
    }

    // Fuel cost
    const fuelMass = def.properties?.fuelMass ?? 0;
    const fuelType = def.properties?.fuelType ?? 'LIQUID';
    if (fuelMass > 0) {
      fuelCost += fuelMass * (FUEL_COST_PER_KG[fuelType] ?? FUEL_COST_PER_KG.LIQUID);
    }
  }

  return {
    partsCost,
    fuelCost,
    totalCost: partsCost + fuelCost,
    partDetails: [...partMap.values()].sort((a, b) => b.cost - a.cost),
  };
}

// ---------------------------------------------------------------------------
// Compatibility Checking
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CompatibilityResult
 * @property {'green'|'yellow'|'red'} status
 *   - green:  All parts unlocked — design is fully usable.
 *   - yellow: Some parts locked but none are from advanced tiers.
 *   - red:    Has locked parts.
 * @property {string[]}  lockedPartIds   - Part IDs not yet unlocked.
 * @property {{ partId: string, partName: string, techNodeId: string, techNodeName: string }[]} lockedDetails
 *   Human-readable info about each locked part and which tech node unlocks it.
 */

/**
 * Build a map from partId → tech node that unlocks it.
 * Lazily cached.
 * @type {Map<string, import('../data/techtree.js').TechNodeDef> | null}
 */
let _partToNodeCache = null;

function _getPartToNodeMap() {
  if (_partToNodeCache) return _partToNodeCache;
  _partToNodeCache = new Map();
  for (const node of TECH_NODES) {
    for (const pid of node.unlocksParts) {
      _partToNodeCache.set(pid, node);
    }
  }
  return _partToNodeCache;
}

/**
 * Check compatibility of a design against the player's current tech unlocks.
 *
 * @param {import('./gameState.js').RocketDesign} design
 * @param {import('./gameState.js').GameState} state
 * @returns {CompatibilityResult}
 */
export function checkDesignCompatibility(design, state) {
  const unlockedParts = new Set(state.parts ?? []);
  const partToNode = _getPartToNodeMap();

  // Collect unique locked parts
  /** @type {Map<string, { partId: string, partName: string, techNodeId: string, techNodeName: string }>} */
  const lockedMap = new Map();

  for (const p of design.parts ?? []) {
    // Skip parts already checked
    if (lockedMap.has(p.partId)) continue;
    // If the part is unlocked, skip
    if (unlockedParts.has(p.partId)) continue;

    // Check if it's a starter part (always available) — starter parts
    // won't have a tech node but may not be in state.parts if state.parts
    // was populated differently. The safest check: if getPartById returns a
    // definition and the part is NOT in any tech node, it's a starter.
    const node = partToNode.get(p.partId);
    if (!node) continue; // Starter part or non-tech-tree part — always available

    const def = getPartById(p.partId);
    lockedMap.set(p.partId, {
      partId: p.partId,
      partName: def?.name ?? p.partId,
      techNodeId: node.id,
      techNodeName: node.name,
    });
  }

  const lockedPartIds = [...lockedMap.keys()];
  const lockedDetails = [...lockedMap.values()];

  let status = 'green';
  if (lockedPartIds.length > 0) {
    status = 'red';
  }

  return { status, lockedPartIds, lockedDetails };
}

// ---------------------------------------------------------------------------
// Design Grouping / Filtering
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} GroupedDesigns
 * @property {string} groupId    - Group identifier.
 * @property {string} groupLabel - Human-readable label.
 * @property {import('./gameState.js').RocketDesign[]} designs
 */

/**
 * Classify designs into groups. A design can appear in multiple groups.
 * Only groups with at least one matching design are returned.
 *
 * @param {import('./gameState.js').RocketDesign[]} designs
 * @returns {GroupedDesigns[]}
 */
export function groupDesigns(designs) {
  const result = [];

  for (const group of DESIGN_GROUPS) {
    const matching = designs.filter(group.test);
    if (matching.length > 0) {
      result.push({
        groupId: group.id,
        groupLabel: group.label,
        designs: matching,
      });
    }
  }

  return result;
}

/**
 * Get all available group definitions (for filter UI).
 * @returns {{ id: string, label: string }[]}
 */
export function getDesignGroupDefs() {
  return DESIGN_GROUPS.map((g) => ({ id: g.id, label: g.label }));
}

/**
 * Filter designs by a specific group ID, or return all if groupId is null.
 * @param {import('./gameState.js').RocketDesign[]} designs
 * @param {string|null} groupId
 * @returns {import('./gameState.js').RocketDesign[]}
 */
export function filterDesignsByGroup(designs, groupId) {
  if (!groupId) return designs;
  const group = DESIGN_GROUPS.find((g) => g.id === groupId);
  if (!group) return designs;
  return designs.filter(group.test);
}
