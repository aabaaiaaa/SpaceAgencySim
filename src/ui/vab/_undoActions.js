/**
 * _undoActions.js — VAB undo/redo action recording.
 *
 * Provides functions to record each type of VAB mutation as an undo/redo
 * action. Each action captures the minimum data needed to reverse (undo)
 * and re-apply (redo) the operation.
 *
 * Callers must invoke refreshVabAfterUndoRedo() after calling undo()/redo().
 */

import { pushUndoAction, clearUndoRedo } from '../../core/undoRedo.js';
import { getPartById } from '../../data/parts.js';
import { getVabState } from './_state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone a StagingConfig (stages arrays + unstaged array + index).
 * @param {import('../../core/rocketbuilder.js').StagingConfig} config
 * @returns {import('../../core/rocketbuilder.js').StagingConfig}
 */
function cloneStaging(config) {
  return {
    stages: config.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
    unstaged: [...config.unstaged],
    currentStageIdx: config.currentStageIdx,
  };
}

/**
 * Overwrite the contents of `target` with a clone of `source`.
 * Preserves the object reference (important for VAB state).
 * @param {import('../../core/rocketbuilder.js').StagingConfig} target
 * @param {import('../../core/rocketbuilder.js').StagingConfig} source
 */
function restoreStaging(target, source) {
  target.stages = source.stages.map(s => ({ instanceIds: [...s.instanceIds] }));
  target.unstaged = [...source.unstaged];
  target.currentStageIdx = source.currentStageIdx;
}

/**
 * Capture a before-snapshot of staging config. Call BEFORE the operation.
 * @returns {import('../../core/rocketbuilder.js').StagingConfig}
 */
export function snapshotStaging() {
  const S = getVabState();
  return cloneStaging(S.stagingConfig);
}

// ---------------------------------------------------------------------------
// Part Placement
// ---------------------------------------------------------------------------

/**
 * Record an undo action for placing new part(s) from the parts panel.
 *
 * @param {string[]} addedIds — instanceIds of parts that were added (main + mirror)
 * @param {number} costDelta — total cost deducted (positive = amount spent)
 * @param {import('../../core/rocketbuilder.js').StagingConfig} stagingBefore
 */
export function recordPlacement(addedIds, costDelta, stagingBefore) {
  const S = getVabState();
  const assembly = S.assembly;
  const stagingConfig = S.stagingConfig;
  const addedIdSet = new Set(addedIds);

  // Capture placed part data.
  const partDatas = addedIds.map(id => ({ ...assembly.parts.get(id) }));

  // Capture connections involving any added part.
  const newConnections = assembly.connections
    .filter(c => addedIdSet.has(c.fromInstanceId) || addedIdSet.has(c.toInstanceId))
    .map(c => ({ ...c }));

  // Capture symmetry pairs involving any added part.
  const newSymmetry = assembly.symmetryPairs
    .filter(([a, b]) => addedIdSet.has(a) || addedIdSet.has(b))
    .map(([a, b]) => [a, b]);

  // Snapshot staging after placement.
  const stagingAfter = cloneStaging(stagingConfig);
  const stagingBeforeClone = cloneStaging(stagingBefore);

  const nextIdAfter = assembly._nextId;
  const nextIdBefore = nextIdAfter - addedIds.length;

  const label = partDatas.length === 1
    ? `Place ${getPartById(partDatas[0].partId)?.name ?? 'Part'}`
    : `Place ${getPartById(partDatas[0].partId)?.name ?? 'Part'} (×${partDatas.length})`;

  pushUndoAction({
    type: 'place',
    label,
    undo() {
      // Remove added parts.
      for (const id of addedIds) assembly.parts.delete(id);
      // Prune connections.
      for (let i = assembly.connections.length - 1; i >= 0; i--) {
        const c = assembly.connections[i];
        if (addedIdSet.has(c.fromInstanceId) || addedIdSet.has(c.toInstanceId)) {
          assembly.connections.splice(i, 1);
        }
      }
      // Prune symmetry pairs.
      for (let i = assembly.symmetryPairs.length - 1; i >= 0; i--) {
        const [a, b] = assembly.symmetryPairs[i];
        if (addedIdSet.has(a) || addedIdSet.has(b)) {
          assembly.symmetryPairs.splice(i, 1);
        }
      }
      assembly._nextId = nextIdBefore;
      // Restore staging.
      restoreStaging(stagingConfig, stagingBeforeClone);
      // Refund cost.
      if (S.gameState) S.gameState.money += costDelta;
    },
    redo() {
      // Re-add parts.
      for (const pd of partDatas) assembly.parts.set(pd.instanceId, { ...pd });
      // Re-add connections.
      for (const c of newConnections) assembly.connections.push({ ...c });
      // Re-add symmetry pairs.
      for (const pair of newSymmetry) assembly.symmetryPairs.push([...pair]);
      assembly._nextId = nextIdAfter;
      // Restore staging.
      restoreStaging(stagingConfig, stagingAfter);
      // Deduct cost.
      if (S.gameState) S.gameState.money -= costDelta;
    },
  });
}

// ---------------------------------------------------------------------------
// Part Deletion
// ---------------------------------------------------------------------------

/**
 * Record an undo action for deleting part(s).
 * Call BEFORE the parts are removed from the assembly.
 *
 * @param {string[]} removedIds — instanceIds to be removed
 * @param {number} costRefund — total cost refunded (positive = amount refunded)
 * @param {import('../../core/rocketbuilder.js').StagingConfig} stagingBefore
 */
export function recordDeletion(removedIds, costRefund, stagingBefore) {
  const S = getVabState();
  const assembly = S.assembly;
  const stagingConfig = S.stagingConfig;
  const removedIdSet = new Set(removedIds);

  // Capture part data before removal.
  const partDatas = removedIds.map(id => ({ ...assembly.parts.get(id) }));

  // Capture connections involving removed parts.
  const removedConnections = assembly.connections
    .filter(c => removedIdSet.has(c.fromInstanceId) || removedIdSet.has(c.toInstanceId))
    .map(c => ({ ...c }));

  // Capture symmetry pairs involving removed parts.
  const removedSymmetry = assembly.symmetryPairs
    .filter(([a, b]) => removedIdSet.has(a) || removedIdSet.has(b))
    .map(([a, b]) => [a, b]);

  const stagingBeforeClone = cloneStaging(stagingBefore);

  const label = partDatas.length === 1
    ? `Delete ${getPartById(partDatas[0].partId)?.name ?? 'Part'}`
    : `Delete ${getPartById(partDatas[0].partId)?.name ?? 'Part'} (×${partDatas.length})`;

  pushUndoAction({
    type: 'delete',
    label,
    undo() {
      // Re-add parts.
      for (const pd of partDatas) assembly.parts.set(pd.instanceId, { ...pd });
      // Re-add connections.
      for (const c of removedConnections) assembly.connections.push({ ...c });
      // Re-add symmetry pairs.
      for (const pair of removedSymmetry) assembly.symmetryPairs.push([...pair]);
      // Restore staging.
      restoreStaging(stagingConfig, stagingBeforeClone);
      // Reverse cost refund (part is back, so deduct the refunded amount).
      if (S.gameState) S.gameState.money -= costRefund;
    },
    redo() {
      // Remove parts.
      for (const id of removedIds) assembly.parts.delete(id);
      // Prune connections.
      for (let i = assembly.connections.length - 1; i >= 0; i--) {
        const c = assembly.connections[i];
        if (removedIdSet.has(c.fromInstanceId) || removedIdSet.has(c.toInstanceId)) {
          assembly.connections.splice(i, 1);
        }
      }
      // Prune symmetry pairs.
      for (let i = assembly.symmetryPairs.length - 1; i >= 0; i--) {
        const [a, b] = assembly.symmetryPairs[i];
        if (removedIdSet.has(a) || removedIdSet.has(b)) {
          assembly.symmetryPairs.splice(i, 1);
        }
      }
      // Restore staging (to the state after deletion happened).
      // We capture this lazily — the first undo restores stagingBefore,
      // and when redo runs the staging should reflect the post-deletion state.
      // We remove deleted parts from staging config directly.
      for (const stage of stagingConfig.stages) {
        stage.instanceIds = stage.instanceIds.filter(id => !removedIdSet.has(id));
      }
      stagingConfig.unstaged = stagingConfig.unstaged.filter(id => !removedIdSet.has(id));
      // Re-apply cost refund.
      if (S.gameState) S.gameState.money += costRefund;
    },
  });
}

// ---------------------------------------------------------------------------
// Part Movement
// ---------------------------------------------------------------------------

/**
 * Record an undo action for moving a placed part to a new position.
 *
 * @param {string} instanceId
 * @param {number} oldX
 * @param {number} oldY
 * @param {number} newX
 * @param {number} newY
 * @param {{ fromInstanceId: string, fromSnapIndex: number, toInstanceId: string, toSnapIndex: number }[]} oldConnections
 * @param {{ fromInstanceId: string, fromSnapIndex: number, toInstanceId: string, toSnapIndex: number }[]} newConnections
 */
export function recordMove(instanceId, oldX, oldY, newX, newY, oldConnections, newConnections) {
  const S = getVabState();
  const assembly = S.assembly;

  const oldConns = oldConnections.map(c => ({ ...c }));
  const newConns = newConnections.map(c => ({ ...c }));

  const def = assembly.parts.get(instanceId);
  const label = `Move ${getPartById(def?.partId)?.name ?? 'Part'}`;

  pushUndoAction({
    type: 'move',
    label,
    undo() {
      const p = assembly.parts.get(instanceId);
      if (p) { p.x = oldX; p.y = oldY; }
      // Remove new connections for this part.
      for (let i = assembly.connections.length - 1; i >= 0; i--) {
        const c = assembly.connections[i];
        if (c.fromInstanceId === instanceId || c.toInstanceId === instanceId) {
          assembly.connections.splice(i, 1);
        }
      }
      // Re-add old connections.
      for (const c of oldConns) assembly.connections.push({ ...c });
    },
    redo() {
      const p = assembly.parts.get(instanceId);
      if (p) { p.x = newX; p.y = newY; }
      // Remove old connections for this part.
      for (let i = assembly.connections.length - 1; i >= 0; i--) {
        const c = assembly.connections[i];
        if (c.fromInstanceId === instanceId || c.toInstanceId === instanceId) {
          assembly.connections.splice(i, 1);
        }
      }
      // Re-add new connections.
      for (const c of newConns) assembly.connections.push({ ...c });
    },
  });
}

// ---------------------------------------------------------------------------
// Staging Changes
// ---------------------------------------------------------------------------

/**
 * Record an undo action for a staging panel drag-and-drop change.
 *
 * @param {import('../../core/rocketbuilder.js').StagingConfig} stagingBefore
 */
export function recordStagingChange(stagingBefore) {
  const S = getVabState();
  const stagingConfig = S.stagingConfig;
  const before = cloneStaging(stagingBefore);
  const after = cloneStaging(stagingConfig);

  pushUndoAction({
    type: 'staging',
    label: 'Staging change',
    undo() {
      restoreStaging(stagingConfig, before);
    },
    redo() {
      restoreStaging(stagingConfig, after);
    },
  });
}

// ---------------------------------------------------------------------------
// Clear All
// ---------------------------------------------------------------------------

/**
 * Record an undo action for the Clear All operation.
 * Call BEFORE clearing the assembly.
 *
 * @param {number} totalCostRefund — total cost being refunded
 * @param {import('../../core/rocketbuilder.js').StagingConfig} stagingBefore
 */
export function recordClearAll(totalCostRefund, stagingBefore) {
  const S = getVabState();
  const assembly = S.assembly;
  const stagingConfig = S.stagingConfig;

  // Capture full assembly state.
  const savedParts = [...assembly.parts.entries()].map(([k, v]) => [k, { ...v }]);
  const savedConnections = assembly.connections.map(c => ({ ...c }));
  const savedSymmetry = assembly.symmetryPairs.map(([a, b]) => [a, b]);
  const savedNextId = assembly._nextId;
  const savedStaging = cloneStaging(stagingBefore);

  pushUndoAction({
    type: 'clearAll',
    label: 'Clear All',
    undo() {
      // Restore all parts.
      assembly.parts.clear();
      for (const [k, v] of savedParts) assembly.parts.set(k, { ...v });
      // Restore connections.
      assembly.connections.length = 0;
      assembly.connections.push(...savedConnections.map(c => ({ ...c })));
      // Restore symmetry.
      assembly.symmetryPairs.length = 0;
      assembly.symmetryPairs.push(...savedSymmetry.map(([a, b]) => [a, b]));
      assembly._nextId = savedNextId;
      // Restore staging.
      restoreStaging(stagingConfig, savedStaging);
      // Reverse refund.
      if (S.gameState) S.gameState.money -= totalCostRefund;
    },
    redo() {
      assembly.parts.clear();
      assembly.connections.length = 0;
      assembly.symmetryPairs.length = 0;
      // Restore staging to empty.
      stagingConfig.stages = [{ instanceIds: [] }];
      stagingConfig.unstaged = [];
      stagingConfig.currentStageIdx = 0;
      // Re-apply refund.
      if (S.gameState) S.gameState.money += totalCostRefund;
    },
  });
}

// Re-export clearUndoRedo for use in design loading.
export { clearUndoRedo };
