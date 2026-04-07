/**
 * rocketbuilder.ts — Core rocket assembly logic for the VAB.
 *
 * The rocket being built is represented as a directed graph:
 *   Nodes  — PlacedPart instances: unique instanceId + catalog partId + world position.
 *   Edges  — PartConnection records that pair two snap-point sockets.
 *
 * COORDINATE CONVENTIONS
 * ======================
 * World space: X = 0 is the rocket centreline, Y increases upward.
 * Snap-point offsets (from parts.ts) use screen-style Y (positive = downward),
 * so the world Y of a snap socket is:  worldSnapY = partCentreY − offsetY
 *
 * This module has no DOM or canvas dependencies and can be unit-tested headlessly.
 */

import { getPartById, ActivationBehaviour } from '../data/parts.ts';
import { getInstrumentKey }                from './sciencemodule.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Screen pixels within which a dragged socket "snaps" to a target socket. */
export const SNAP_DISTANCE_PX = 30;

const OPPOSITE_SIDE: Readonly<Record<string, string>> = Object.freeze({
  top:    'bottom',
  bottom: 'top',
  left:   'right',
  right:  'left',
});

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * A placed part in the rocket assembly.
 */
export interface PlacedPart {
  /** Unique ID for this instance in the build session. */
  instanceId: string;
  /** Part catalog ID referencing a PartDef. */
  partId: string;
  /** World X of part centre. */
  x: number;
  /** World Y of part centre (Y-up world space). */
  y: number;
  /** Instrument IDs loaded in this part (science modules only). */
  instruments?: string[];
}

/**
 * One edge in the rocket part graph.
 */
export interface PartConnection {
  fromInstanceId: string;
  /** Index into the source part's snapPoints array. */
  fromSnapIndex: number;
  toInstanceId: string;
  /** Index into the target part's snapPoints array. */
  toSnapIndex: number;
}

/**
 * The full rocket assembly.
 */
export interface RocketAssembly {
  /** Instance ID → PlacedPart. */
  parts: Map<string, PlacedPart>;
  /** Array of connections between parts. */
  connections: PartConnection[];
  /** Internal ID counter for generating instanceIds. */
  _nextId: number;
  /** Pairs of mirrored instance IDs [id1, id2]. */
  symmetryPairs: Array<[string, string]>;
}

/**
 * A snap candidate for placing a part.
 */
export interface SnapCandidate {
  /** Placed part the dragged part would attach to. */
  targetInstanceId: string;
  /** Socket index on the target part. */
  targetSnapIndex: number;
  /** Socket index on the dragged part (complementary side). */
  dragSnapIndex: number;
  /** World X the dragged part's centre would land at. */
  snapWorldX: number;
  /** World Y the dragged part's centre would land at. */
  snapWorldY: number;
  /** World X of the target socket (for highlight rendering). */
  targetSnapWorldX: number;
  /** World Y of the target socket (for highlight rendering). */
  targetSnapWorldY: number;
  /** Screen-pixel distance between the two sockets. */
  screenDist: number;
}

/**
 * A mirror snap candidate.
 */
export interface MirrorCandidate {
  /** Snap index on the parent for the mirror. */
  mirrorTargetSnapIndex: number;
  /** Snap index on the drag part for the mirror. */
  mirrorDragSnapIndex: number;
  /** World X where the mirror part centre lands. */
  mirrorWorldX: number;
  /** World Y where the mirror part centre lands. */
  mirrorWorldY: number;
}

/**
 * One stage in a staging configuration.
 */
export interface StageData {
  /** Instance IDs of activatable parts assigned to this stage. */
  instanceIds: string[];
}

/**
 * Staging configuration for a rocket assembly.
 *
 * stages[0] = Stage 1 (fires first).
 * stages[n-1] = Stage n (fires last).
 * Visually, Stage 1 is at the bottom; higher stages are above it.
 */
export interface StagingConfig {
  /** Ordered stage slots. Index 0 = Stage 1 (fires first). */
  stages: StageData[];
  /** Instance IDs of activatable parts not yet staged. */
  unstaged: string[];
  /** 0-based index of the next stage to fire (used in flight). */
  currentStageIdx: number;
}

/**
 * Result of firing a staging step.
 */
export interface StagingStepResult {
  /** 0-based index of the stage that was just activated. */
  firedStageIndex: number;
  /** 0-based index of the next stage, or null when all stages spent. */
  nextStageIndex: number | null;
  /** Parts from the fired stage to activate in the physics sim. */
  instanceIds: string[];
}

// ---------------------------------------------------------------------------
// Assembly factory
// ---------------------------------------------------------------------------

/**
 * Create an empty rocket assembly for a new build session.
 */
export function createRocketAssembly(): RocketAssembly {
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
 * @returns The new instanceId.
 */
export function addPartToAssembly(
  assembly: RocketAssembly,
  partId: string,
  worldX: number,
  worldY: number,
): string {
  const instanceId = `inst-${assembly._nextId++}`;
  assembly.parts.set(instanceId, { instanceId, partId, x: worldX, y: worldY });
  return instanceId;
}

/**
 * Remove a part from the assembly, severing all its connections.
 */
export function removePartFromAssembly(
  assembly: RocketAssembly,
  instanceId: string,
): void {
  assembly.parts.delete(instanceId);
  _pruneConnections(assembly, instanceId);
  _pruneSymmetryPairs(assembly, instanceId);
}

/**
 * Update the world position of a placed part (called after re-dropping a
 * picked-up part at a new location).
 */
export function movePlacedPart(
  assembly: RocketAssembly,
  instanceId: string,
  worldX: number,
  worldY: number,
): void {
  const p = assembly.parts.get(instanceId);
  if (p) { p.x = worldX; p.y = worldY; }
}

/**
 * Sever all connections for a part instance (called when picking it up for
 * repositioning).
 */
export function disconnectPart(
  assembly: RocketAssembly,
  instanceId: string,
): void {
  _pruneConnections(assembly, instanceId);
}

/**
 * Register a snap connection between two parts.
 */
export function connectParts(
  assembly: RocketAssembly,
  fromInstanceId: string,
  fromSnapIndex: number,
  toInstanceId: string,
  toSnapIndex: number,
): void {
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
 * @returns Sorted nearest-first.
 */
export function findSnapCandidates(
  assembly: RocketAssembly,
  dragPartId: string,
  dragWorldX: number,
  dragWorldY: number,
  zoom: number,
): SnapCandidate[] {
  const dragDef = getPartById(dragPartId);
  if (!dragDef || assembly.parts.size === 0) return [];

  const results: SnapCandidate[] = [];

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

function _pruneConnections(assembly: RocketAssembly, instanceId: string): void {
  assembly.connections = assembly.connections.filter(
    (c) => c.fromInstanceId !== instanceId && c.toInstanceId !== instanceId,
  );
}

function _pruneSymmetryPairs(assembly: RocketAssembly, instanceId: string): void {
  if (!assembly.symmetryPairs) return;
  assembly.symmetryPairs = assembly.symmetryPairs.filter(
    ([a, b]) => a !== instanceId && b !== instanceId,
  );
}

function _snapOccupied(assembly: RocketAssembly, instanceId: string, snapIndex: number): boolean {
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
 */
export function addSymmetryPair(
  assembly: RocketAssembly,
  id1: string,
  id2: string,
): void {
  if (!assembly.symmetryPairs) assembly.symmetryPairs = [];
  assembly.symmetryPairs.push([id1, id2]);
}

/**
 * Return the instance ID of the mirror partner of the given part, or null.
 */
export function getMirrorPartId(
  assembly: RocketAssembly,
  instanceId: string,
): string | null {
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
 * Given a radial snap candidate, compute the mirror snap position on the
 * opposite side of the same parent part.
 *
 * Returns null when:
 *   - The candidate snap is not radial (not left/right side).
 *   - The parent has no socket on the opposite side that accepts the dragged
 *     part type.
 *   - The opposite-side socket is already occupied.
 *   - The dragged part has no socket on the complementary side.
 */
export function findMirrorCandidate(
  assembly: RocketAssembly,
  candidate: SnapCandidate,
  dragPartId: string,
): MirrorCandidate | null {
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
 * Create a fresh staging configuration with one empty stage.
 */
export function createStagingConfig(): StagingConfig {
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
 */
export function syncStagingWithAssembly(
  assembly: RocketAssembly,
  config: StagingConfig,
): void {
  const live = new Set(assembly.parts.keys());

  // Build the set of all valid IDs: live parts + instrument keys.
  const liveAndInstruments = new Set(live);
  for (const [id, placed] of assembly.parts) {
    if (placed.instruments?.length) {
      for (let i = 0; i < placed.instruments.length; i++) {
        liveAndInstruments.add(getInstrumentKey(id, i));
      }
    }
  }

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
        // For science modules with instruments, register each instrument
        // as a separate stageable entity instead of the module itself.
        if (def.activationBehaviour === ActivationBehaviour.COLLECT_SCIENCE
            && placed!.instruments?.length) {
          for (let i = 0; i < placed!.instruments!.length; i++) {
            const instrKey = getInstrumentKey(id, i);
            if (!tracked.has(instrKey)) config.unstaged.push(instrKey);
          }
        } else {
          config.unstaged.push(id);
        }
      }
    }
  }

  // Also register any new instrument keys for parts already tracked.
  for (const [id, placed] of assembly.parts) {
    if (placed.instruments?.length) {
      for (let i = 0; i < placed.instruments.length; i++) {
        const instrKey = getInstrumentKey(id, i);
        if (!tracked.has(instrKey) && !config.unstaged.includes(instrKey)) {
          config.unstaged.push(instrKey);
        }
      }
    }
  }

  // Prune removed parts and stale instrument keys from unstaged pool.
  config.unstaged = config.unstaged.filter((id) => liveAndInstruments.has(id));

  // Prune removed parts and stale instrument keys from all stages.
  for (const stage of config.stages) {
    stage.instanceIds = stage.instanceIds.filter((id) => liveAndInstruments.has(id));
  }
}

/**
 * Add a new empty stage at the top (highest number, fires last).
 * @returns 1-based number of the new stage.
 */
export function addStageToConfig(config: StagingConfig): number {
  config.stages.push({ instanceIds: [] });
  return config.stages.length;
}

/**
 * Remove an empty stage by its 0-based array index.
 * Refuses if the stage contains parts or is the last remaining stage.
 *
 * @returns True if removed; false otherwise.
 */
export function removeStageFromConfig(
  config: StagingConfig,
  stageIndex: number,
): boolean {
  if (stageIndex < 0 || stageIndex >= config.stages.length) return false;
  if (config.stages.length <= 1)                              return false;
  if (config.stages[stageIndex].instanceIds.length > 0)      return false;
  config.stages.splice(stageIndex, 1);
  config.currentStageIdx = Math.min(config.currentStageIdx, config.stages.length - 1);
  return true;
}

/**
 * Move a part from the unstaged pool into a specific stage.
 * @returns True if moved.
 */
export function assignPartToStage(
  config: StagingConfig,
  instanceId: string,
  stageIndex: number,
): boolean {
  if (stageIndex < 0 || stageIndex >= config.stages.length) return false;
  const pos = config.unstaged.indexOf(instanceId);
  if (pos === -1) return false;
  config.unstaged.splice(pos, 1);
  config.stages[stageIndex].instanceIds.push(instanceId);
  return true;
}

/**
 * Move a part from one stage to another.
 */
export function movePartBetweenStages(
  config: StagingConfig,
  instanceId: string,
  fromIndex: number,
  toIndex: number,
): boolean {
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
 */
export function returnPartToUnstaged(
  config: StagingConfig,
  instanceId: string,
): boolean {
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
 */
export function autoStageNewPart(
  assembly: RocketAssembly,
  config: StagingConfig,
  instanceId: string,
): void {
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
 * @returns True if the move was performed.
 */
export function moveStage(
  config: StagingConfig,
  fromIndex: number,
  toIndex: number,
): boolean {
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
 * @returns Warning strings, or an empty array when all clear.
 */
export function validateStagingConfig(
  assembly: RocketAssembly,
  config: StagingConfig,
): string[] {
  const warnings: string[] = [];

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
 * Returns:
 *   `firedStageIndex` — 0-based index of the stage that was just activated.
 *   `nextStageIndex`  — 0-based index of the next stage, or null when all stages spent.
 *   `instanceIds`     — Parts from the fired stage to activate in the physics sim.
 */
export function fireStagingStep(config: StagingConfig): StagingStepResult {
  const firedStageIndex = config.currentStageIdx;
  const instanceIds     = [...(config.stages[firedStageIndex]?.instanceIds ?? [])];
  const nextStageIndex: number | null  =
    firedStageIndex + 1 < config.stages.length ? firedStageIndex + 1 : null;
  if (nextStageIndex !== null) {
    config.currentStageIdx = nextStageIndex;
  }
  return { firedStageIndex, nextStageIndex, instanceIds };
}
