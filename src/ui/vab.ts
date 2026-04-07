/**
 * vab.ts — Vehicle Assembly Building HTML overlay UI.
 *
 * Thin barrel re-export so external imports remain unchanged.
 * All implementation has been split into sub-modules under src/ui/vab/.
 */

export {
  syncVabToGameState,
  initVabUI,
  resetVabUI,
  vabRefreshParts,
  getVabInventoryUsedParts,
  vabSetLaunchEnabled,
} from './vab/_init.ts';
