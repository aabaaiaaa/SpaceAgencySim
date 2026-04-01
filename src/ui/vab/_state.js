/**
 * _state.js — Shared mutable state for the VAB UI sub-modules.
 *
 * All module-level `let _xxx` variables from the original vab.js are
 * consolidated here.  Sub-modules access them via getVabState() and
 * mutate them via setVabState(patch).
 */

/** The panel width for each side panel. */
export const SIDE_PANEL_WIDTH = 300;

/**
 * @typedef {Object} VabState
 * @property {import('../../core/rocketbuilder.js').RocketAssembly | null} assembly
 * @property {import('../../core/gameState.js').GameState | null} gameState
 * @property {HTMLElement | null} container
 * @property {{ partId: string, instanceId: string | null, startX: number, startY: number, hasMoved: boolean } | null} dragState
 * @property {HTMLElement | null} ctxMenu
 * @property {import('../../core/rocketbuilder.js').StagingConfig | null} stagingConfig
 * @property {number} dvAltitude
 * @property {boolean} flightActive
 * @property {import('../../core/rocketvalidator.js').ValidationResult | null} lastValidation
 * @property {(() => void) | null} onBack
 * @property {boolean} autoZoomEnabled
 * @property {boolean} symmetryMode
 * @property {string | null} selectedInstanceId
 * @property {string | null} currentDesignId
 * @property {string} currentDesignName
 * @property {Set<string>} openPanels
 * @property {Map<string, import('../../core/gameState.js').InventoryPart>} inventoryUsedParts
 * @property {HTMLElement | null} canvasArea
 * @property {{ hit: any, startX: number, startY: number } | null} pendingPickup
 * @property {HTMLElement | null} scaleTicks
 * @property {number} buildAreaHeight
 * @property {boolean} libraryCssInjected
 */

/** @type {VabState} */
const _state = {
  assembly:            null,
  gameState:           null,
  container:           null,
  dragState:           null,
  ctxMenu:             null,
  stagingConfig:       null,
  dvAltitude:          0,
  flightActive:        false,
  lastValidation:      null,
  onBack:              null,
  autoZoomEnabled:     true,
  symmetryMode:        true,
  selectedInstanceId:  null,
  currentDesignId:     null,
  currentDesignName:   '',
  openPanels:          new Set(),
  inventoryUsedParts:  new Map(),
  canvasArea:          null,
  pendingPickup:       null,
  scaleTicks:          null,
  buildAreaHeight:     0,
  libraryCssInjected:  false,
};

/**
 * Get the current VAB state object (read/write — callers may mutate directly).
 * @returns {VabState}
 */
export function getVabState() {
  return _state;
}

/**
 * Patch the VAB state with the supplied key/value pairs.
 * @param {Partial<VabState>} patch
 */
export function setVabState(patch) {
  Object.assign(_state, patch);
}

/**
 * Reset all VAB state to initial values.
 */
export function resetVabState() {
  _state.assembly            = null;
  _state.gameState           = null;
  _state.container           = null;
  _state.dragState           = null;
  _state.ctxMenu             = null;
  _state.stagingConfig       = null;
  _state.dvAltitude          = 0;
  _state.flightActive        = false;
  _state.lastValidation      = null;
  _state.onBack              = null;
  _state.autoZoomEnabled     = true;
  _state.symmetryMode        = true;
  _state.selectedInstanceId  = null;
  _state.currentDesignId     = null;
  _state.currentDesignName   = '';
  _state.openPanels          = new Set();
  _state.inventoryUsedParts  = new Map();
  _state.canvasArea          = null;
  _state.pendingPickup       = null;
  _state.scaleTicks          = null;
  _state.buildAreaHeight     = 0;
  _state.libraryCssInjected  = false;
}
