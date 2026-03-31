/**
 * techtree.js — Technology tree research system.
 *
 * Manages researching tech nodes using science points and funds.
 * Research unlocks new parts and instruments for use in the VAB.
 *
 * RULES
 * =====
 *   - R&D Lab facility must be built to access the tech tree.
 *   - Each node requires the previous tier in the same branch to be
 *     unlocked (researched or effectively unlocked via tutorial rewards).
 *   - Dual currency: science points AND funds are deducted on research.
 *   - Starter parts do not appear in the tree.
 *   - Tutorial mission rewards appear as "Unlocked via tutorial" on nodes
 *     whose parts the player already owns.
 *   - Non-tutorial players can purchase any node normally, providing
 *     an alternative unlock path to tutorial-gated content.
 *
 * @module core/techtree
 */

import { FacilityId, GameMode, RD_TIER_MAX_TECH } from './constants.js';
import { hasFacility } from './construction.js';
import { spend } from './finance.js';
import {
  TECH_NODES,
  getTechNodeById,
  getNodeByBranchAndTier,
} from '../data/techtree.js';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Check whether a tech node has been explicitly researched by the player.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} nodeId
 * @returns {boolean}
 */
export function isNodeResearched(state, nodeId) {
  return (state.techTree?.researched ?? []).includes(nodeId);
}

/**
 * Check whether a node's rewards are already owned (e.g. via tutorial
 * mission completion) without the node having been explicitly researched.
 *
 * A node is considered tutorial-unlocked when:
 *   1. It has NOT been explicitly researched.
 *   2. Every part in `unlocksParts` is already in `state.parts`.
 *   3. Every instrument in `unlocksInstruments` is already in
 *      `state.techTree.unlockedInstruments`.
 *   4. The node actually unlocks something (empty nodes can't be
 *      tutorial-unlocked).
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} nodeId
 * @returns {boolean}
 */
export function isNodeTutorialUnlocked(state, nodeId) {
  if (isNodeResearched(state, nodeId)) return false;

  const node = getTechNodeById(nodeId);
  if (!node) return false;

  const hasSomething =
    node.unlocksParts.length > 0 || node.unlocksInstruments.length > 0;
  if (!hasSomething) return false;

  const ownedParts = new Set(state.parts ?? []);
  const partsOk =
    node.unlocksParts.length === 0 ||
    node.unlocksParts.every((pid) => ownedParts.has(pid));

  const ownedInstruments = new Set(state.techTree?.unlockedInstruments ?? []);
  const instrumentsOk =
    node.unlocksInstruments.length === 0 ||
    node.unlocksInstruments.every((iid) => ownedInstruments.has(iid));

  return partsOk && instrumentsOk;
}

/**
 * A node is "unlocked" if it has been researched OR is tutorial-unlocked.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} nodeId
 * @returns {boolean}
 */
export function isNodeUnlocked(state, nodeId) {
  return isNodeResearched(state, nodeId) || isNodeTutorialUnlocked(state, nodeId);
}

/**
 * Return the maximum tech tier the player can currently research,
 * based on their R&D Lab facility tier.
 *
 * Returns 0 if the R&D Lab is not built.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}
 */
export function getMaxResearchableTier(state) {
  if (!hasFacility(state, FacilityId.RD_LAB)) return 0;
  const rdTier = state.facilities[FacilityId.RD_LAB]?.tier ?? 1;
  return RD_TIER_MAX_TECH[rdTier] ?? 5;
}

/**
 * Check whether the player can research a specific node right now.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} nodeId
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canResearchNode(state, nodeId) {
  const node = getTechNodeById(nodeId);
  if (!node) {
    return { allowed: false, reason: 'Unknown tech node.' };
  }

  if (isNodeResearched(state, nodeId)) {
    return { allowed: false, reason: 'Already researched.' };
  }

  // Sandbox mode: skip all prerequisite and cost checks.
  // Must be checked before isNodeTutorialUnlocked since sandbox has all parts
  // owned, which would otherwise flag every node as tutorial-unlocked.
  if (state.gameMode === GameMode.SANDBOX) {
    return { allowed: true, reason: '' };
  }

  if (isNodeTutorialUnlocked(state, nodeId)) {
    return { allowed: false, reason: 'Already unlocked via tutorial.' };
  }

  if (!hasFacility(state, FacilityId.RD_LAB)) {
    return { allowed: false, reason: 'R&D Lab must be built first.' };
  }

  // R&D tier gates tech tiers.
  const maxTier = getMaxResearchableTier(state);
  if (node.tier > maxTier) {
    return {
      allowed: false,
      reason: `R&D Lab must be upgraded to research Tier ${node.tier} nodes.`,
    };
  }

  // Previous tier in the same branch must be unlocked.
  if (node.tier > 1) {
    const prevNode = getNodeByBranchAndTier(node.branch, node.tier - 1);
    if (prevNode && !isNodeUnlocked(state, prevNode.id)) {
      return {
        allowed: false,
        reason: `Requires ${prevNode.name} (Tier ${prevNode.tier}) first.`,
      };
    }
  }

  // Enough science points?
  if ((state.sciencePoints ?? 0) < node.scienceCost) {
    return {
      allowed: false,
      reason: `Insufficient science (need ${node.scienceCost}, have ${Math.floor(state.sciencePoints ?? 0)}).`,
    };
  }

  // Enough funds?
  if (state.money < node.fundsCost) {
    return {
      allowed: false,
      reason: `Insufficient funds (need $${node.fundsCost.toLocaleString('en-US')}).`,
    };
  }

  return { allowed: true, reason: '' };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Research a tech node, deducting science points and funds.
 *
 * Unlocked parts are added to `state.parts`; unlocked instruments are
 * added to `state.techTree.unlockedInstruments`.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} nodeId
 * @returns {{
 *   success: boolean,
 *   reason: string,
 *   unlockedParts: string[],
 *   unlockedInstruments: string[]
 * }}
 */
export function researchNode(state, nodeId) {
  const check = canResearchNode(state, nodeId);
  if (!check.allowed) {
    return {
      success: false,
      reason: check.reason,
      unlockedParts: [],
      unlockedInstruments: [],
    };
  }

  const node = getTechNodeById(nodeId);

  // Sandbox mode: skip cost deductions.
  if (state.gameMode !== GameMode.SANDBOX) {
    // Deduct science points.
    state.sciencePoints -= node.scienceCost;

    // Deduct funds.
    const ok = spend(state, node.fundsCost);
    if (!ok) {
      // Rollback science — should not happen since canResearchNode checked.
      state.sciencePoints += node.scienceCost;
      return {
        success: false,
        reason: 'Insufficient funds.',
        unlockedParts: [],
        unlockedInstruments: [],
      };
    }
  }

  // Ensure techTree state is initialised (handles older saves).
  if (!state.techTree) {
    state.techTree = { researched: [], unlockedInstruments: [] };
  }
  if (!state.techTree.researched) state.techTree.researched = [];
  if (!state.techTree.unlockedInstruments) state.techTree.unlockedInstruments = [];

  // Mark node as researched.
  state.techTree.researched.push(nodeId);

  // Unlock parts.
  const ownedParts = new Set(state.parts);
  const unlockedParts = [];
  for (const partId of node.unlocksParts) {
    if (!ownedParts.has(partId)) {
      state.parts.push(partId);
      ownedParts.add(partId);
      unlockedParts.push(partId);
    }
  }

  // Unlock instruments.
  const ownedInstruments = new Set(state.techTree.unlockedInstruments);
  const unlockedInstruments = [];
  for (const instId of node.unlocksInstruments) {
    if (!ownedInstruments.has(instId)) {
      state.techTree.unlockedInstruments.push(instId);
      ownedInstruments.add(instId);
      unlockedInstruments.push(instId);
    }
  }

  return { success: true, reason: '', unlockedParts, unlockedInstruments };
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

/**
 * Return all part IDs unlocked via researched tech tree nodes.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {string[]}
 */
export function getTechTreeUnlockedParts(state) {
  const researched = state.techTree?.researched ?? [];
  const parts = new Set();
  for (const nodeId of researched) {
    const node = getTechNodeById(nodeId);
    if (node) {
      for (const pid of node.unlocksParts) {
        parts.add(pid);
      }
    }
  }
  return [...parts];
}

/**
 * Return all instrument IDs unlocked via the tech tree.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {string[]}
 */
export function getTechTreeUnlockedInstruments(state) {
  return [...(state.techTree?.unlockedInstruments ?? [])];
}

/**
 * Check whether a specific instrument is available for use.
 *
 * An instrument is available if:
 *   1. Its techTier is 0 (starter instrument), OR
 *   2. Its ID is in `state.techTree.unlockedInstruments`.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} instrumentId
 * @param {number} techTier  The instrument's techTier from its definition.
 * @returns {boolean}
 */
export function isInstrumentAvailable(state, instrumentId, techTier) {
  if (techTier === 0) return true;
  return (state.techTree?.unlockedInstruments ?? []).includes(instrumentId);
}

/**
 * Return the display status of every tech node for UI rendering.
 *
 * Each entry includes the full node definition plus computed status fields:
 *   - `researched`:       Explicitly researched by the player.
 *   - `tutorialUnlocked`: All rewards already owned via tutorial missions.
 *   - `unlocked`:         Either researched or tutorial-unlocked.
 *   - `canResearch`:      Player can research this node right now.
 *   - `reason`:           Why canResearch is false (empty if true).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {Array<TechNodeDef & {
 *   researched: boolean,
 *   tutorialUnlocked: boolean,
 *   unlocked: boolean,
 *   canResearch: boolean,
 *   reason: string
 * }>}
 */
export function getTechTreeStatus(state) {
  return TECH_NODES.map((node) => {
    const check = canResearchNode(state, node.id);
    return {
      ...node,
      researched: isNodeResearched(state, node.id),
      tutorialUnlocked: isNodeTutorialUnlocked(state, node.id),
      unlocked: isNodeUnlocked(state, node.id),
      canResearch: check.allowed,
      reason: check.reason,
    };
  });
}
