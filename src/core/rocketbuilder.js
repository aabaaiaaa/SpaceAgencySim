/**
 * rocketbuilder.js — Core rocket assembly logic for the VAB.
 *
 * The rocket being built is represented as a directed graph:
 *   Nodes  — PlacedPart instances: unique instanceId + catalog partId + world position.
 *   Edges  — PartConnection records that pair two snap-point sockets.
 *
 * COORDINATE CONVENTIONS
 * ======================
 * World space: X = 0 is the rocket centreline, Y increases upward.
 * Snap-point offsets (from parts.js) use screen-style Y (positive = downward),
 * so the world Y of a snap socket is:  worldSnapY = partCentreY − offsetY
 *
 * This module has no DOM or canvas dependencies and can be unit-tested headlessly.
 */

import { getPartById, ActivationBehaviour } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Screen pixels within which a dragged socket "snaps" to a target socket. */
export const SNAP_DISTANCE_PX = 30;

/** @type {Readonly<Record<string, string>>} */
const OPPOSITE_SIDE = Object.freeze({
  top:    'bottom',
  bottom: 'top',
  left:   'right',
  right:  'left',
});

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PlacedPart
 * @property {string} instanceId  Unique ID for this instance in the build session.
 * @property {string} partId      Part catalog ID referencing a PartDef.
 * @property {number} x           World X of part centre.
 * @property {number} y           World Y of part centre (Y-up world space).
 */

/**
 * One edge in the rocket part graph.
 * @typedef {Object} PartConnection
 * @property {string} fromInstanceId
 * @property {number} fromSnapIndex   Index into the source part's snapPoints array.
 * @property {string} toInstanceId
 * @property {number} toSnapIndex     Index into the target part's snapPoints array.
 */

/**
 * @typedef {Object} RocketAssembly
 * @property {Map<string, PlacedPart>} parts
 * @property {PartConnection[]}        connections
 * @property {number}                  _nextId       Internal ID counter.
 * @property {Array<[string, string]>} symmetryPairs Pairs of mirrored instance IDs.
 */

/**
 * @typedef {Object} SnapCandidate
 * @property {string} targetInstanceId   Placed part the dragged part would attach to.
 * @property {number} targetSnapIndex    Socket index on the target part.
 * @property {number} dragSnapIndex      Socket index on the dragged part (complementary side).
 * @property {number} snapWorldX         World X the dragged part's centre would land at.
 * @property {number} snapWorldY         World Y the dragged part's centre would land at.
 * @property {number} targetSnapWorldX   World X of the target socket (for highlight rendering).
 * @property {number} targetSnapWorldY   World Y of the target socket (for highlight rendering).
 * @property {number} screenDist         Screen-pixel distance between the two sockets.
 */

// ---------------------------------------------------------------------------
// Assembly factory
// ---------------------------------------------------------------------------

/**
 * Create an empty rocket assembly for a new build session.
 * @returns {RocketAssembly}
 */
export function createRocketAssembly() {
  return {
    parts:         new Map(),
    connections:   [],
    symmetryPairs: [],
    _nextId:       1,
  };
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

/**
 * Add a new part to the assembly at the given world position.
 * @param {RocketAssembly} assembly
 * @param {string} partId
 * @param {number} worldX
 * @param {number} worldY
 * @returns {string}  The new instanceId.
 */
export function addPartToAssembly(assembly, partId, worldX, worldY) {
  const instanceId = `inst-${assembly._nextId++}`;
  assembly.parts.set(instanceId, { instanceId, partId, x: worldX, y: worldY });
  return instanceId;
}

/**
 * Remove a part from the assembly, severing all its connections.
 * @param {RocketAssembly} assembly
 * @param {string} instanceId
 */
export function removePartFromAssembly(assembly, instanceId) {
  assembly.parts.delete(instanceId);
  _pruneConnections(assembly, instanceId);
  _pruneSymmetryPairs(assembly, instanceId);
}

/**
 * Update the world position of a placed part (called after re-dropping a
 * picked-up part at a new location).
 * @param {RocketAssembly} assembly
 * @param {string} instanceId
 * @param {number} worldX
 * @param {number} worldY
 */
export function movePlacedPart(assembly, instanceId, worldX, worldY) {
  const p = assembly.parts.get(instanceId);
  if (p) { p.x = worldX; p.y = worldY; }
}

/**
 * Sever all connections for a part instance (called when picking it up for
 * repositioning).
 * @param {RocketAssembly} assembly
 * @param {string} instanceId
 */
export function disconnectPart(assembly, instanceId) {
  _pruneConnections(assembly, instanceId);
}

/**
 * Register a snap connection between two parts.
 * @param {RocketAssembly} assembly
 * @param {string} fromInstanceId
 * @param {number} fromSnapIndex
 * @param {string} toInstanceId
 * @param {number} toSnapIndex
 */
export function connectParts(
  assembly,
  fromInstanceId, fromSnapIndex,
  toInstanceId,   toSnapIndex,
) {
  assembly.connections.push({
    fromInstanceId, fromSnapIndex,
    toInstanceId,   toSnapIndex,
  });
}

// ---------------------------------------------------------------------------
// Snap candidate finder
// ---------------------------------------------------------------------------

/**
 * Return all valid snap candidates for a part being dragged at the given world
 * position.
 *
 * A candidate is valid when ALL of:
 *   1. A target socket's `accepts` list includes the dragged part's type.
 *   2. The dragged part has a socket on the complementary side.
 *   3. The target socket is not already occupied by an existing connection.
 *   4. Screen-space distance between the two sockets ≤ SNAP_DISTANCE_PX.
 *
 * @param {RocketAssembly} assembly
 * @param {string}  dragPartId    Part catalog ID of the piece being dragged.
 * @param {number}  dragWorldX    Current world X of the dragged part's centre.
 * @param {number}  dragWorldY    Current world Y of the dragged part's centre.
 * @param {number}  zoom          Current camera zoom (world-unit → screen-pixel scale).
 * @returns {SnapCandidate[]}  Sorted nearest-first.
 */
export function findSnapCandidates(
  assembly, dragPartId, dragWorldX, dragWorldY, zoom,
) {
  const dragDef = getPartById(dragPartId);
  if (!dragDef || assembly.parts.size === 0) return [];

  const results = [];

  for (const placed of assembly.parts.values()) {
    const placedDef = getPartById(placed.partId);
    if (!placedDef) continue;

    for (let tsi = 0; tsi < placedDef.snapPoints.length; tsi++) {
      const tSnap = placedDef.snapPoints[tsi];

      // Rule 1: target socket must accept the dragged part type.
      if (!tSnap.accepts.includes(dragDef.type)) continue;

      // Rule 2: dragged part needs a socket on the complementary side.
      const neededSide = OPPOSITE_SIDE[tSnap.side];
      const dsi = dragDef.snapPoints.findIndex((sp) => sp.side === neededSide);
      if (dsi === -1) continue;

      // Rule 3: target socket must not be occupied.
      if (_snapOccupied(assembly, placed.instanceId, tsi)) continue;

      // World position of the target socket.
      // (snapPoint.offsetY: positive = below centre in screen → subtract from world Y)
      const tSnapWX = placed.x + tSnap.offsetX;
      const tSnapWY = placed.y - tSnap.offsetY;

      // World-space offset of the dragged part's complementary socket from its centre.
      const dSnap     = dragDef.snapPoints[dsi];
      const dSnapRelX =  dSnap.offsetX;
      const dSnapRelY = -dSnap.offsetY;   // convert screen-Y direction to world-Y direction

      // Current world position of the dragged socket.
      const dSnapWX = dragWorldX + dSnapRelX;
      const dSnapWY = dragWorldY + dSnapRelY;

      // Screen-pixel distance between the two sockets.
      const screenDist = Math.hypot(
        (dSnapWX - tSnapWX) * zoom,
        (dSnapWY - tSnapWY) * zoom,
      );

      if (screenDist > SNAP_DISTANCE_PX) continue;

      // Snap position: drag socket coincides with target socket.
      //   drag.x + dSnapRelX = tSnapWX  →  drag.x = tSnapWX − dSnapRelX
      //   drag.y + dSnapRelY = tSnapWY  →  drag.y = tSnapWY − dSnapRelY
      results.push({
        targetInstanceId: placed.instanceId,
        targetSnapIndex:  tsi,
        dragSnapIndex:    dsi,
        snapWorldX:       tSnapWX - dSnapRelX,
        snapWorldY:       tSnapWY - dSnapRelY,
        targetSnapWorldX: tSnapWX,
        targetSnapWorldY: tSnapWY,
        screenDist,
      });
    }
  }

  results.sort((a, b) => a.screenDist - b.screenDist);
  return results;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _pruneConnections(assembly, instanceId) {
  assembly.connections = assembly.connections.filter(
    (c) => c.fromInstanceId !== instanceId && c.toInstanceId !== instanceId,
  );
}

function _pruneSymmetryPairs(assembly, instanceId) {
  if (!assembly.symmetryPairs) return;
  assembly.symmetryPairs = assembly.symmetryPairs.filter(
    ([a, b]) => a !== instanceId && b !== instanceId,
  );
}

function _snapOccupied(assembly, instanceId, snapIndex) {
  return assembly.connections.some(
    (c) =>
      (c.fromInstanceId === instanceId && c.fromSnapIndex === snapIndex) ||
      (c.toInstanceId   === instanceId && c.toSnapIndex   === snapIndex),
  );
}

// ---------------------------------------------------------------------------
// Symmetry pair management
// ---------------------------------------------------------------------------

/**
 * Record a symmetry (mirror) relationship between two placed parts.
 * @param {RocketAssembly} assembly
 * @param {string} id1
 * @param {string} id2
 */
export function addSymmetryPair(assembly, id1, id2) {
  if (!assembly.symmetryPairs) assembly.symmetryPairs = [];
  assembly.symmetryPairs.push([id1, id2]);
}

/**
 * Return the instance ID of the mirror partner of the given part, or null.
 * @param {RocketAssembly} assembly
 * @param {string} instanceId
 * @returns {string | null}
 */
export function getMirrorPartId(assembly, instanceId) {
  if (!assembly.symmetryPairs) return null;
  for (const [a, b] of assembly.symmetryPairs) {
    if (a === instanceId) return b;
    if (b === instanceId) return a;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mirror candidate finder
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MirrorCandidate
 * @property {number} mirrorTargetSnapIndex  Snap index on the parent for the mirror.
 * @property {number} mirrorDragSnapIndex    Snap index on the drag part for the mirror.
 * @property {number} mirrorWorldX           World X where the mirror part centre lands.
 * @property {number} mirrorWorldY           World Y where the mirror part centre lands.
 */

/**
 * Given a radial snap candidate, compute the mirror snap position on the
 * opposite side of the same parent part.
 *
 * Returns null when:
 *   - The candidate snap is not radial (not left/right side).
 *   - The parent has no socket on the opposite side that accepts the dragged
 *     part type.
 *   - The opposite-side socket is already occupied.
 *   - The dragged part has no socket on the complementary side.
 *
 * @param {RocketAssembly} assembly
 * @param {SnapCandidate}  candidate   The primary snap candidate.
 * @param {string}         dragPartId  Part catalog ID being placed.
 * @returns {MirrorCandidate | null}
 */
export function findMirrorCandidate(assembly, candidate, dragPartId) {
  const parentPlaced = assembly.parts.get(candidate.targetInstanceId);
  if (!parentPlaced) return null;

  const parentDef = getPartById(parentPlaced.partId);
  const dragDef   = getPartById(dragPartId);
  if (!parentDef || !dragDef) return null;

  const tSnap = parentDef.snapPoints[candidate.targetSnapIndex];
  // Only radial (left/right) snaps get symmetry.
  if (tSnap.side !== 'left' && tSnap.side !== 'right') return null;

  const mirrorSide = OPPOSITE_SIDE[tSnap.side];

  // Find the mirror socket on the parent (accepts the dragged type, opposite side,
  // matching vertical offset so top-left mirrors to top-right, etc.).
  const mirrorTargetSnapIndex = parentDef.snapPoints.findIndex(
    (sp) => sp.side === mirrorSide
         && sp.accepts.includes(dragDef.type)
         && sp.offsetY === tSnap.offsetY,
  );
  if (mirrorTargetSnapIndex === -1) return null;

  // Mirror socket must be free.
  if (_snapOccupied(assembly, parentPlaced.instanceId, mirrorTargetSnapIndex)) return null;

  // Find the drag part's socket for the mirror connection.
  // mirrorTargetSnap.side = mirrorSide → drag socket must be on OPPOSITE_SIDE[mirrorSide] = tSnap.side
  const mirrorDragSnapIndex = dragDef.snapPoints.findIndex(
    (sp) => sp.side === tSnap.side,
  );
  if (mirrorDragSnapIndex === -1) return null;

  // Compute mirror part centre in world space.
  const mirrorTargetSnap = parentDef.snapPoints[mirrorTargetSnapIndex];
  const mirrorDragSnap   = dragDef.snapPoints[mirrorDragSnapIndex];

  const mirrorTSnapWX =  parentPlaced.x + mirrorTargetSnap.offsetX;
  const mirrorTSnapWY =  parentPlaced.y - mirrorTargetSnap.offsetY;

  const mirrorDSnapRelX =  mirrorDragSnap.offsetX;
  const mirrorDSnapRelY = -mirrorDragSnap.offsetY;

  return {
    mirrorTargetSnapIndex,
    mirrorDragSnapIndex,
    mirrorWorldX: mirrorTSnapWX - mirrorDSnapRelX,
    mirrorWorldY: mirrorTSnapWY - mirrorDSnapRelY,
  };
}

// ---------------------------------------------------------------------------
// Staging Configuration
// ---------------------------------------------------------------------------

/**
 * One stage in a staging configuration.
 * @typedef {Object} StageData
 * @property {string[]} instanceIds  Instance IDs of activatable parts assigned here.
 */

/**
 * Staging configuration for a rocket assembly.
 *
 * stages[0] = Stage 1 (fires first).
 * stages[n-1] = Stage n (fires last).
 * Visually, Stage 1 is at the bottom; higher stages are above it.
 *
 * @typedef {Object} StagingConfig
 * @property {StageData[]} stages           Ordered stage slots. Index 0 = Stage 1.
 * @property {string[]}    unstaged         Instance IDs of activatable parts not yet staged.
 * @property {number}      currentStageIdx  0-based index of the next stage to fire (used in flight).
 */

/**
 * Create a fresh staging configuration with one empty stage.
 * @returns {StagingConfig}
 */
export function createStagingConfig() {
  return {
    stages:          [{ instanceIds: [] }],
    unstaged:        [],
    currentStageIdx: 0,
  };
}

/**
 * Synchronise a staging config with the current rocket assembly.
 *
 * - Activatable parts newly added to the assembly are pushed into `unstaged`.
 * - References to removed parts are pruned from all stage slots and `unstaged`.
 *
 * Call this after every {@link addPartToAssembly} or {@link removePartFromAssembly}.
 *
 * @param {RocketAssembly} assembly
 * @param {StagingConfig}  config
 */
export function syncStagingWithAssembly(assembly, config) {
  const live = new Set(assembly.parts.keys());

  // All IDs currently tracked by staging.
  const tracked = new Set([
    ...config.unstaged,
    ...config.stages.flatMap((s) => s.instanceIds),
  ]);

  // New activatable parts → push into unstaged pool.
  for (const id of live) {
    if (!tracked.has(id)) {
      const placed = assembly.parts.get(id);
      const def    = placed ? getPartById(placed.partId) : null;
      if (def && def.activatable) {
        config.unstaged.push(id);
      }
    }
  }

  // Prune removed parts from unstaged pool.
  config.unstaged = config.unstaged.filter((id) => live.has(id));

  // Prune removed parts from all stages.
  for (const stage of config.stages) {
    stage.instanceIds = stage.instanceIds.filter((id) => live.has(id));
  }
}

/**
 * Add a new empty stage at the top (highest number, fires last).
 * @param {StagingConfig} config
 * @returns {number}  1-based number of the new stage.
 */
export function addStageToConfig(config) {
  config.stages.push({ instanceIds: [] });
  return config.stages.length;
}

/**
 * Remove an empty stage by its 0-based array index.
 * Refuses if the stage contains parts or is the last remaining stage.
 *
 * @param {StagingConfig} config
 * @param {number}        stageIndex  0-based index (0 = Stage 1).
 * @returns {boolean}  True if removed; false otherwise.
 */
export function removeStageFromConfig(config, stageIndex) {
  if (stageIndex < 0 || stageIndex >= config.stages.length) return false;
  if (config.stages.length <= 1)                              return false;
  if (config.stages[stageIndex].instanceIds.length > 0)      return false;
  config.stages.splice(stageIndex, 1);
  config.currentStageIdx = Math.min(config.currentStageIdx, config.stages.length - 1);
  return true;
}

/**
 * Move a part from the unstaged pool into a specific stage.
 * @param {StagingConfig} config
 * @param {string}        instanceId
 * @param {number}        stageIndex  0-based target stage.
 * @returns {boolean}  True if moved.
 */
export function assignPartToStage(config, instanceId, stageIndex) {
  if (stageIndex < 0 || stageIndex >= config.stages.length) return false;
  const pos = config.unstaged.indexOf(instanceId);
  if (pos === -1) return false;
  config.unstaged.splice(pos, 1);
  config.stages[stageIndex].instanceIds.push(instanceId);
  return true;
}

/**
 * Move a part from one stage to another.
 * @param {StagingConfig} config
 * @param {string}        instanceId
 * @param {number}        fromIndex
 * @param {number}        toIndex
 * @returns {boolean}
 */
export function movePartBetweenStages(config, instanceId, fromIndex, toIndex) {
  if (fromIndex === toIndex)                               return false;
  if (fromIndex < 0 || fromIndex >= config.stages.length) return false;
  if (toIndex   < 0 || toIndex   >= config.stages.length) return false;
  const from = config.stages[fromIndex];
  const pos  = from.instanceIds.indexOf(instanceId);
  if (pos === -1) return false;
  from.instanceIds.splice(pos, 1);
  config.stages[toIndex].instanceIds.push(instanceId);
  return true;
}

/**
 * Return a staged part to the unstaged pool.
 * @param {StagingConfig} config
 * @param {string}        instanceId
 * @returns {boolean}
 */
export function returnPartToUnstaged(config, instanceId) {
  for (const stage of config.stages) {
    const pos = stage.instanceIds.indexOf(instanceId);
    if (pos !== -1) {
      stage.instanceIds.splice(pos, 1);
      config.unstaged.push(instanceId);
      return true;
    }
  }
  return false;
}

/**
 * Automatically stage a newly placed activatable part based on its
 * activation behaviour:
 *   - IGNITE (engines, SRBs) → assign to Stage 1 (index 0).
 *   - SEPARATE (decouplers)  → create a new stage at the end, assign there.
 *   - Anything else          → leave in the unstaged pool.
 *
 * The part must already be in the `unstaged` pool (placed by
 * syncStagingWithAssembly) before calling this function.
 *
 * @param {RocketAssembly} assembly
 * @param {StagingConfig}  config
 * @param {string}         instanceId
 */
export function autoStageNewPart(assembly, config, instanceId) {
  const placed = assembly.parts.get(instanceId);
  if (!placed) return;
  const def = getPartById(placed.partId);
  if (!def || !def.activatable) return;

  const behaviour = def.activationBehaviour;

  if (behaviour === ActivationBehaviour.IGNITE) {
    // Remove from unstaged and assign to Stage 1.
    const pos = config.unstaged.indexOf(instanceId);
    if (pos !== -1) config.unstaged.splice(pos, 1);
    if (config.stages.length === 0) config.stages.push({ instanceIds: [] });
    config.stages[0].instanceIds.push(instanceId);
  } else if (behaviour === ActivationBehaviour.SEPARATE) {
    // Remove from unstaged and create a new stage at the end.
    const pos = config.unstaged.indexOf(instanceId);
    if (pos !== -1) config.unstaged.splice(pos, 1);
    config.stages.push({ instanceIds: [instanceId] });
  }
  // All other behaviours (DEPLOY, EJECT, RELEASE, COLLECT_SCIENCE, NONE)
  // stay in unstaged — the player decides where to assign them.
}

/**
 * Reorder stages by moving a stage from one index to another.
 *
 * @param {StagingConfig} config
 * @param {number}        fromIndex  0-based source index.
 * @param {number}        toIndex    0-based destination index.
 * @returns {boolean}  True if the move was performed.
 */
export function moveStage(config, fromIndex, toIndex) {
  if (fromIndex === toIndex) return false;
  if (fromIndex < 0 || fromIndex >= config.stages.length) return false;
  if (toIndex   < 0 || toIndex   >= config.stages.length) return false;

  const [stage] = config.stages.splice(fromIndex, 1);
  config.stages.splice(toIndex, 0, stage);

  // Keep currentStageIdx pointing at the same logical stage if possible.
  config.currentStageIdx = Math.min(config.currentStageIdx, config.stages.length - 1);
  return true;
}

/**
 * Validate the staging configuration and return warning messages.
 *
 * Current check: when activatable parts exist in the assembly, Stage 1 must
 * contain at least one part with IGNITE behaviour (an engine or SRB) or the
 * rocket will not lift off.
 *
 * @param {RocketAssembly} assembly
 * @param {StagingConfig}  config
 * @returns {string[]}  Warning strings, or an empty array when all clear.
 */
export function validateStagingConfig(assembly, config) {
  const warnings = [];

  // Only warn if there are activatable parts in the assembly.
  let hasActivatable = false;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def && def.activatable) { hasActivatable = true; break; }
  }
  if (!hasActivatable) return warnings;

  const stage1 = config.stages[0];
  if (stage1) {
    const hasIgnition = stage1.instanceIds.some((id) => {
      const placed = assembly.parts.get(id);
      const def    = placed ? getPartById(placed.partId) : null;
      return def && def.activationBehaviour === 'IGNITE';
    });
    if (!hasIgnition) {
      warnings.push('Stage 1 has no engine or SRB — rocket will not lift off!');
    }
  }

  return warnings;
}

/**
 * Advance to the next stage. Called by the flight system when the player
 * presses Spacebar.
 *
 * @param {StagingConfig} config
 * @returns {{
 *   firedStageIndex: number,
 *   nextStageIndex:  number | null,
 *   instanceIds:     string[]
 * }}
 *   `firedStageIndex` — 0-based index of the stage that was just activated.
 *   `nextStageIndex`  — 0-based index of the next stage, or null when all stages spent.
 *   `instanceIds`     — Parts from the fired stage to activate in the physics sim.
 */
export function fireStagingStep(config) {
  const firedStageIndex = config.currentStageIdx;
  const instanceIds     = [...(config.stages[firedStageIndex]?.instanceIds ?? [])];
  const nextStageIndex  =
    firedStageIndex + 1 < config.stages.length ? firedStageIndex + 1 : null;
  if (nextStageIndex !== null) {
    config.currentStageIdx = nextStageIndex;
  }
  return { firedStageIndex, nextStageIndex, instanceIds };
}
