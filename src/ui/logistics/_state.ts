/**
 * _state.ts -- Shared mutable state for the logistics sub-modules.
 *
 * All module-level state variables from the original logistics.ts are
 * collected here.  Sub-modules access them via getLogisticsState() and
 * mutate via setLogisticsState(patch).
 *
 * @module ui/logistics/_state
 */

import type { GameState } from '../../core/gameState.ts';

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface LogisticsState {
  overlay: HTMLDivElement | null;
  state: GameState | null;
  selectedBodyId: string | null;
  activeTab: 'mining' | 'routes';
  expandedRouteIds: Set<string>;

  // Builder mode state (route creation wizard)
  builderMode: boolean;
  builderResourceType: string | null;
  builderRouteName: string;
  builderLegs: string[];           // proven leg IDs
  builderCurrentBodyId: string | null;
  builderOriginHubId: string | null;

  // Route-map view transform (persists across re-renders within a session).
  routeMapZoom: number;   // multiplier, 1 = fit, clamped to [0.4, 4]
  routeMapPanX: number;   // viewBox-space pan offset applied before zoom
  routeMapPanY: number;

  /** Persistent click-selected route — highlighted on both map + list. */
  selectedRouteId: string | null;
}

// ---------------------------------------------------------------------------
// Internal mutable state
// ---------------------------------------------------------------------------

let _logisticsState: LogisticsState = _createDefaultState();

function _createDefaultState(): LogisticsState {
  return {
    overlay: null,
    state: null,
    selectedBodyId: null,
    activeTab: 'mining',
    expandedRouteIds: new Set<string>(),

    builderMode: false,
    builderResourceType: null,
    builderRouteName: '',
    builderLegs: [],
    builderCurrentBodyId: null,
    builderOriginHubId: null,

    routeMapZoom: 1,
    routeMapPanX: 0,
    routeMapPanY: 0,

    selectedRouteId: null,
  };
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Read current logistics state. */
export function getLogisticsState(): LogisticsState {
  return _logisticsState;
}

/** Patch one or more fields on the logistics state. */
export function setLogisticsState(patch: Partial<LogisticsState>): void {
  Object.assign(_logisticsState, patch);
}

/** Reset all builder-mode state back to defaults. */
export function resetBuilderState(): void {
  _logisticsState.builderMode = false;
  _logisticsState.builderResourceType = null;
  _logisticsState.builderRouteName = '';
  _logisticsState.builderLegs = [];
  _logisticsState.builderCurrentBodyId = null;
  _logisticsState.builderOriginHubId = null;
}

/** Reset the entire logistics state to initial values. */
export function resetLogisticsState(): void {
  _logisticsState = _createDefaultState();
}

// ---------------------------------------------------------------------------
// Render callback -- set by the main module so sub-modules can trigger re-renders
// ---------------------------------------------------------------------------

let _renderFn: (() => void) | null = null;

/** Register the render callback (called once from the main module). */
export function setRenderFn(fn: () => void): void {
  _renderFn = fn;
}

/** Trigger a full re-render.  No-op if no callback registered. */
export function triggerRender(): void {
  if (_renderFn) _renderFn();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Format a module type name for display.
 * Replaces underscores with spaces and title-cases each word.
 * E.g. `MINING_DRILL` -> `Mining Drill`.
 */
export function formatModuleType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a resource type name for display.
 * E.g. `WATER_ICE` -> `Water Ice`, `CO2` -> `Co2`.
 */
export function formatResourceType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
