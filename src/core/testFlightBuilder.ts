/**
 * testFlightBuilder.ts — Programmatic rocket builder for E2E testing.
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

import { getPartById } from '../data/parts.ts';
import { logger } from './logger.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  autoStageNewPart,
} from './rocketbuilder.ts';

// Use `any` for rocketbuilder objects — the JS module's inferred JSDoc types
// do not have .d.ts declarations, so we avoid re-declaring conflicting shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RocketAssembly = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StagingConfig = any;

export interface TestRocketResult {
  assembly: RocketAssembly;
  stagingConfig: StagingConfig;
}

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
 * @param partIds  Ordered list of part catalog IDs (top → bottom).
 */
export function buildTestRocket(partIds: string[]): TestRocketResult {
  const assembly: RocketAssembly      = createRocketAssembly();
  const stagingConfig: StagingConfig  = createStagingConfig();

  let currentY = 0;
  let prevInstanceId: string | null = null;

  for (const partId of partIds) {
    const def = getPartById(partId);
    if (!def) {
      logger.warn('testFlightBuilder', 'Unknown part ID', { partId });
      continue;
    }

    // Place at x=0, y stacking downward from center of previous part.
    const halfH = def.height / 2;
    const worldY = currentY + halfH;

    const instanceId: string = addPartToAssembly(assembly, partId, 0, worldY);

    // Connect to previous part (bottom→top).
    if (prevInstanceId) {
      const prevPlaced = assembly.parts.get(prevInstanceId);
      const prevDef = prevPlaced ? getPartById(prevPlaced.partId) : undefined;
      // Find bottom snap on prev, top snap on current.
      const prevBottomIdx = prevDef?.snapPoints?.findIndex((s) => s.side === 'bottom') ?? -1;
      const curTopIdx     = def.snapPoints?.findIndex((s) => s.side === 'top') ?? -1;

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
