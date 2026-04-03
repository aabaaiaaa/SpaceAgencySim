/**
 * _state.ts — Shared mutable state for the Mission Control sub-modules.
 *
 * All module-level `let` variables that were previously scattered across the
 * monolithic missionControl.js file are now held in a single object so that
 * every sub-module can read/write them without circular-dependency issues.
 *
 * @module missionControl/_state
 */

import type { GameState } from '../../core/gameState.js';

export interface MCState {
  overlay: HTMLElement | null;
  state: GameState | null;
  onBack: (() => void) | null;
  activeTab: string;
  creatorFormOpen: boolean;
}

const _mcState: MCState = {
  overlay:         null,
  state:           null,
  onBack:          null,
  activeTab:       'available',
  creatorFormOpen:  false,
};

/**
 * Return the shared mutable state object.
 * Sub-modules read/write properties directly on the returned reference.
 */
export function getMCState(): MCState {
  return _mcState;
}

/**
 * Patch (shallow-merge) one or more properties into the shared state.
 */
export function setMCState(patch: Partial<MCState>): void {
  Object.assign(_mcState, patch);
}
