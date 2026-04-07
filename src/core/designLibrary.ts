/**
 * designLibrary.ts — Rocket design library system.
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
import { logger } from './logger.js';
import { TECH_NODES } from '../data/techtree.js';
import type { PartDef } from '../data/parts.js';
import type { TechNodeDef } from '../data/techtree.js';
import type { GameState, RocketDesign } from './gameState.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for shared (cross-save) designs. */
const SHARED_LIBRARY_KEY = 'spaceAgencyDesignLibrary';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CostBreakdown {
  partsCost: number;
  fuelCost: number;
  totalCost: number;
  partDetails: Array<{ partId: string; name: string; cost: number; count: number }>;
}

export interface CompatibilityResult {
  status: 'green' | 'yellow' | 'red';
  lockedPartIds: string[];
  lockedDetails: Array<{ partId: string; partName: string; techNodeId: string; techNodeName: string }>;
}

export interface GroupedDesigns {
  groupId: string;
  groupLabel: string;
  designs: RocketDesign[];
}

interface DesignGroup {
  id: string;
  label: string;
  test: (design: RocketDesign) => boolean;
}

// ---------------------------------------------------------------------------
// Design Group Definitions
// ---------------------------------------------------------------------------

const DESIGN_GROUPS: DesignGroup[] = [
  { id: 'single-stage', label: 'Single Stage', test: (d) => _countStages(d) === 1 },
  { id: '2-stage', label: '2-Stage', test: (d) => _countStages(d) === 2 },
  { id: '3-stage', label: '3+ Stage', test: (d) => _countStages(d) >= 3 },
  { id: 'crewed', label: 'Crewed', test: (d) => _hasPartOfType(d, PartType.COMMAND_MODULE) },
  { id: 'probe', label: 'Probe', test: (d) => _hasPartOfType(d, PartType.COMPUTER_MODULE) && !_hasPartOfType(d, PartType.COMMAND_MODULE) },
  { id: 'satellite', label: 'Satellite', test: (d) => _hasPartOfType(d, PartType.SATELLITE) },
  { id: 'heavy', label: 'Heavy', test: (d) => (d.totalMass ?? 0) >= 50_000 },
];

// ---------------------------------------------------------------------------
// Group Helpers (private)
// ---------------------------------------------------------------------------

function _countStages(design: RocketDesign): number {
  if (!design.staging?.stages) return 1;
  const nonEmpty = design.staging.stages.filter(
    (s: any) => (Array.isArray(s) ? s.length : (s?.instanceIds?.length ?? 0)) > 0,
  );
  return Math.max(nonEmpty.length, 1);
}

function _hasPartOfType(design: RocketDesign, partType: string): boolean {
  if (!design.parts) return false;
  return design.parts.some((p) => {
    const def = getPartById(p.partId);
    return def?.type === partType;
  });
}

// ---------------------------------------------------------------------------
// Shared Library Storage
// ---------------------------------------------------------------------------

export function loadSharedLibrary(): RocketDesign[] {
  try {
    const raw = localStorage.getItem(SHARED_LIBRARY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn('designLibrary', 'Failed to parse shared library from localStorage', { error: String(err) });
    return [];
  }
}

export function saveSharedLibrary(designs: RocketDesign[]): void {
  try {
    localStorage.setItem(SHARED_LIBRARY_KEY, JSON.stringify(designs));
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError') {
      throw new Error('Storage full — unable to save design library. Delete old saves or designs to free space.', { cause: err });
    }
    throw err;
  }
}

export function saveDesignToSharedLibrary(design: RocketDesign): void {
  const lib = loadSharedLibrary();
  const idx = lib.findIndex((d) => d.id === design.id);
  if (idx >= 0) { lib[idx] = design; } else { lib.push(design); }
  saveSharedLibrary(lib);
}

export function deleteDesignFromSharedLibrary(designId: string): void {
  const lib = loadSharedLibrary();
  saveSharedLibrary(lib.filter((d) => d.id !== designId));
}

// ---------------------------------------------------------------------------
// Unified Library Access
// ---------------------------------------------------------------------------

export function getAllDesigns(state: GameState): RocketDesign[] {
  const shared = loadSharedLibrary();
  const priv = (state.savedDesigns ?? []).filter((d) => d.savePrivate);
  const byId = new Map<string, RocketDesign>();
  for (const d of shared) byId.set(d.id, d);
  for (const d of priv) byId.set(d.id, d);
  return [...byId.values()];
}

export function saveDesignToLibrary(state: GameState, design: RocketDesign): void {
  if (!Array.isArray(state.savedDesigns)) state.savedDesigns = [];
  if (design.savePrivate) {
    const idx = state.savedDesigns.findIndex((d) => d.id === design.id);
    if (idx >= 0) { state.savedDesigns[idx] = design; } else { state.savedDesigns.push(design); }
    deleteDesignFromSharedLibrary(design.id);
  } else {
    saveDesignToSharedLibrary(design);
    state.savedDesigns = state.savedDesigns.filter((d) => d.id !== design.id);
  }
}

export function deleteDesignFromLibrary(state: GameState, designId: string): void {
  if (!Array.isArray(state.savedDesigns)) state.savedDesigns = [];
  state.savedDesigns = state.savedDesigns.filter((d) => d.id !== designId);
  deleteDesignFromSharedLibrary(designId);
}

export function duplicateDesign(original: RocketDesign): RocketDesign {
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

const FUEL_COST_PER_KG: Record<string, number> = { LIQUID: 0.50, SOLID: 0.30, MONOPROPELLANT: 0.80, ELECTRIC: 2.00 };

export function calculateCostBreakdown(design: RocketDesign): CostBreakdown {
  let partsCost = 0;
  let fuelCost = 0;
  const partMap = new Map<string, { partId: string; name: string; cost: number; count: number }>();

  for (const p of design.parts ?? []) {
    const def = getPartById(p.partId);
    if (!def) continue;
    partsCost += def.cost;
    const existing = partMap.get(def.id);
    if (existing) { existing.count++; existing.cost += def.cost; }
    else { partMap.set(def.id, { partId: def.id, name: def.name, cost: def.cost, count: 1 }); }
    const fuelMass = (def.properties.fuelMass as number) ?? 0;
    const fuelType = (def.properties.fuelType as string) ?? 'LIQUID';
    if (fuelMass > 0) { fuelCost += fuelMass * (FUEL_COST_PER_KG[fuelType] ?? FUEL_COST_PER_KG.LIQUID); }
  }

  return { partsCost, fuelCost, totalCost: partsCost + fuelCost, partDetails: [...partMap.values()].sort((a, b) => b.cost - a.cost) };
}

// ---------------------------------------------------------------------------
// Compatibility Checking
// ---------------------------------------------------------------------------

let _partToNodeCache: Map<string, TechNodeDef> | null = null;

function _getPartToNodeMap(): Map<string, TechNodeDef> {
  if (_partToNodeCache) return _partToNodeCache;
  _partToNodeCache = new Map();
  for (const node of TECH_NODES) {
    for (const pid of node.unlocksParts) { _partToNodeCache.set(pid, node); }
  }
  return _partToNodeCache;
}

export function checkDesignCompatibility(design: RocketDesign, state: GameState): CompatibilityResult {
  const unlockedParts = new Set(state.parts ?? []);
  const partToNode = _getPartToNodeMap();
  const lockedMap = new Map<string, { partId: string; partName: string; techNodeId: string; techNodeName: string }>();

  for (const p of design.parts ?? []) {
    if (lockedMap.has(p.partId)) continue;
    if (unlockedParts.has(p.partId)) continue;
    const node = partToNode.get(p.partId);
    if (!node) continue;
    const def = getPartById(p.partId);
    lockedMap.set(p.partId, { partId: p.partId, partName: def?.name ?? p.partId, techNodeId: node.id, techNodeName: node.name });
  }

  const lockedPartIds = [...lockedMap.keys()];
  const lockedDetails = [...lockedMap.values()];
  let status: 'green' | 'yellow' | 'red' = 'green';
  if (lockedPartIds.length > 0) status = 'red';
  return { status, lockedPartIds, lockedDetails };
}

// ---------------------------------------------------------------------------
// Design Grouping / Filtering
// ---------------------------------------------------------------------------

export function groupDesigns(designs: RocketDesign[]): GroupedDesigns[] {
  const result: GroupedDesigns[] = [];
  for (const group of DESIGN_GROUPS) {
    const matching = designs.filter(group.test);
    if (matching.length > 0) { result.push({ groupId: group.id, groupLabel: group.label, designs: matching }); }
  }
  return result;
}

export function getDesignGroupDefs(): Array<{ id: string; label: string }> {
  return DESIGN_GROUPS.map((g) => ({ id: g.id, label: g.label }));
}

export function filterDesignsByGroup(designs: RocketDesign[], groupId: string | null): RocketDesign[] {
  if (!groupId) return designs;
  const group = DESIGN_GROUPS.find((g) => g.id === groupId);
  if (!group) return designs;
  return designs.filter(group.test);
}
