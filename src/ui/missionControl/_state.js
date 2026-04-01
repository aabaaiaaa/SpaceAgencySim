/**
 * _state.js — Shared mutable state for the Mission Control sub-modules.
 *
 * All module-level `let` variables that were previously scattered across the
 * monolithic missionControl.js file are now held in a single object so that
 * every sub-module can read/write them without circular-dependency issues.
 *
 * @module missionControl/_state
 */

/**
 * @typedef {Object} MCState
 * @property {HTMLElement|null}  overlay         The root overlay element.
 * @property {import('../../core/gameState.js').GameState|null} state  Reference to the game state.
 * @property {(() => void)|null} onBack          Callback to navigate back to the hub.
 * @property {string}            activeTab       Currently active tab id.
 * @property {boolean}           creatorFormOpen  Whether the custom challenge creator form is visible.
 */

/** @type {MCState} */
const _mcState = {
  overlay:         null,
  state:           null,
  onBack:          null,
  activeTab:       'available',
  creatorFormOpen:  false,
};

/**
 * Return the shared mutable state object.
 * Sub-modules read/write properties directly on the returned reference.
 *
 * @returns {MCState}
 */
export function getMCState() {
  return _mcState;
}

/**
 * Patch (shallow-merge) one or more properties into the shared state.
 *
 * @param {Partial<MCState>} patch
 */
export function setMCState(patch) {
  Object.assign(_mcState, patch);
}
