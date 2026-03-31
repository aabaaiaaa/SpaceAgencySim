/**
 * testFlightBuilder.js — Programmatic rocket builder for E2E testing.
 *
 * Builds a valid RocketAssembly + StagingConfig from a list of part IDs,
 * stacking them vertically with proper connections. This bypasses the VAB
 * drag-and-drop UI so E2E tests can launch flights deterministically.
 *
 * NOT used in production — only exposed via window.__e2eBuildRocket during
 * E2E test runs.
 *
 * @module testFlightBuilder
 */

import { getPartById } from '../data/parts.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  autoStageNewPart,
} from './rocketbuilder.js';

/**
 * Build a rocket assembly and staging config from an ordered list of part IDs.
 *
 * Parts are stacked vertically (top to bottom in array order), with each part's
 * bottom snap connecting to the next part's top snap. The first part is placed
 * at (0, 0) and subsequent parts are positioned below based on part heights.
 *
 * Engines and SRBs are auto-staged into Stage 1; decouplers get their own
 * stages; everything else goes to unstaged.
 *
 * @param {string[]} partIds  Ordered list of part catalog IDs (top → bottom).
 * @returns {{ assembly: import('./rocketbuilder.js').RocketAssembly, stagingConfig: import('./rocketbuilder.js').StagingConfig }}
 */
export function buildTestRocket(partIds) {
  const assembly      = createRocketAssembly();
  const stagingConfig = createStagingConfig();

  let currentY = 0;
  let prevInstanceId = null;

  for (const partId of partIds) {
    const def = getPartById(partId);
    if (!def) {
      console.warn(`[testFlightBuilder] Unknown part ID: ${partId}`);
      continue;
    }

    // Place at x=0, y stacking downward from center of previous part.
    const halfH = def.height / 2;
    const worldY = currentY + halfH;

    const instanceId = addPartToAssembly(assembly, partId, 0, worldY);

    // Connect to previous part (bottom→top).
    if (prevInstanceId) {
      const prevDef = getPartById(assembly.parts.get(prevInstanceId).partId);
      // Find bottom snap on prev, top snap on current.
      const prevBottomIdx = prevDef?.snapPoints?.findIndex(s => s.side === 'bottom') ?? -1;
      const curTopIdx     = def.snapPoints?.findIndex(s => s.side === 'top') ?? -1;

      if (prevBottomIdx >= 0 && curTopIdx >= 0) {
        connectParts(assembly, prevInstanceId, prevBottomIdx, instanceId, curTopIdx);
      }
    }

    // Sync staging and auto-stage.
    syncStagingWithAssembly(assembly, stagingConfig);
    autoStageNewPart(assembly, stagingConfig, instanceId);

    currentY = worldY + halfH;
    prevInstanceId = instanceId;
  }

  return { assembly, stagingConfig };
}
