/**
 * _state.ts — Shared mutable state for the VAB UI sub-modules.
 *
 * All module-level `let _xxx` variables from the original vab.js are
 * consolidated here.  Sub-modules access them via getVabState() and
 * mutate them via setVabState(patch).
 */

import type { RocketAssembly, StagingConfig, PlacedPart } from '../../core/rocketbuilder.ts';
import type { GameState, InventoryPart } from '../../core/gameState.ts';
import type { ValidationResult } from '../../core/rocketvalidator.ts';

/** The panel width for each side panel. */
export const SIDE_PANEL_WIDTH: number = 300;

/** The parts panel width (must match #vab-parts-panel in vab.css). */
export const PARTS_PANEL_WIDTH: number = 280;

export interface VabDragState {
  partId: string;
  instanceId: string | null;
  startX: number;
  startY: number;
  hasMoved: boolean;
  /** If set, drag originated from the inventory panel and will consume this
   *  specific inventory entry on drop (instead of buying a new part). */
  inventoryEntryId?: string;
}

export interface VabPendingPickup {
  hit: PlacedPart;
  startX: number;
  startY: number;
}

export interface VabState {
  assembly: RocketAssembly | null;
  gameState: GameState | null;
  container: HTMLElement | null;
  dragState: VabDragState | null;
  ctxMenu: HTMLElement | null;
  stagingConfig: StagingConfig | null;
  dvAltitude: number;
  flightActive: boolean;
  lastValidation: ValidationResult | null;
  onBack: (() => void) | null;
  autoZoomEnabled: boolean;
  symmetryMode: boolean;
  selectedInstanceId: string | null;
  currentDesignId: string | null;
  currentDesignName: string;
  openPanels: Set<string>;
  inventoryUsedParts: Map<string, InventoryPart>;
  expandedInventoryGroups: Set<string>;
  canvasArea: HTMLElement | null;
  pendingPickup: VabPendingPickup | null;
  scaleTicks: HTMLElement | null;
  buildAreaHeight: number;
  libraryCssInjected: boolean;
}

const _state: VabState = {
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
  openPanels:              new Set(),
  inventoryUsedParts:      new Map(),
  expandedInventoryGroups: new Set(),
  canvasArea:          null,
  pendingPickup:       null,
  scaleTicks:          null,
  buildAreaHeight:     0,
  libraryCssInjected:  false,
};

/**
 * Get the current VAB state object (read/write — callers may mutate directly).
 */
export function getVabState(): VabState {
  return _state;
}

/**
 * Patch the VAB state with the supplied key/value pairs.
 */
export function setVabState(patch: Partial<VabState>): void {
  Object.assign(_state, patch);
}

/**
 * Reset all VAB state to initial values.
 */
export function resetVabState(): void {
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
  _state.openPanels              = new Set();
  _state.inventoryUsedParts      = new Map();
  _state.expandedInventoryGroups = new Set();
  _state.canvasArea          = null;
  _state.pendingPickup       = null;
  _state.scaleTicks          = null;
  _state.buildAreaHeight     = 0;
  _state.libraryCssInjected  = false;
}
