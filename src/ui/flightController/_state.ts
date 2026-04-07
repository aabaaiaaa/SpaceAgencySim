/**
 * _state.ts — Shared mutable state for the flight controller sub-modules.
 *
 * All module-level `let _xxx` variables from the original monolithic
 * flightController.js are collected here as properties of a single object.
 * Sub-modules access them via getFCState() and mutate via setFCState(patch).
 *
 * @module ui/flightController/_state
 */

import type { PhysicsState } from '../../core/physics.ts';
import type { GameState, FlightState } from '../../core/gameState.ts';
import type { RocketAssembly, StagingConfig } from '../../core/rocketbuilder.ts';

// ---------------------------------------------------------------------------
// FCState interface
// ---------------------------------------------------------------------------

export interface FCState {
  // Core references
  /** requestAnimationFrame handle. */
  rafId: number | null;
  ps: PhysicsState | null;
  assembly: RocketAssembly | null;
  stagingConfig: StagingConfig | null;
  flightState: FlightState | null;
  state: GameState | null;
  /** The #ui-overlay container. */
  container: HTMLElement | null;
  onFlightEnd: ((state: GameState | null) => void) | null;
  /** Timestamp of previous animation frame (ms). */
  lastTs: number | null;

  // Event listener references
  keydownHandler: ((e: KeyboardEvent) => void) | null;
  keyupHandler: ((e: KeyboardEvent) => void) | null;

  // DOM elements
  /** The in-flight control overlay DOM element. */
  flightOverlay: HTMLElement | null;

  // Assembly snapshots for restart
  originalAssembly: RocketAssembly | null;
  originalStagingConfig: StagingConfig | null;

  // Summary guard
  /** True while the post-flight summary overlay is visible. */
  summaryShown: boolean;

  // Map view state
  /** True when the map view is the active scene. */
  mapActive: boolean;
  /** Set of orbital-relative thrust keys held in map view. */
  mapHeldKeys: Set<string>;
  /** True while the craft is thrusting due to map-view orbital controls. */
  mapThrusting: boolean;
  /** Set of orbital-relative thrust keys held in NORMAL orbit mode. */
  normalOrbitHeldKeys: Set<string>;
  /** True while the craft is thrusting due to normal-orbit WASD controls. */
  normalOrbitThrusting: boolean;
  /** The map-view HUD overlay. */
  mapHud: HTMLElement | null;

  // Docking state
  /** DOM element for the docking guidance overlay. */
  dockingHud: HTMLElement | null;

  // Time-warp state
  /** Current time-warp multiplier (1 = real-time). */
  timeWarp: number;
  /** Time-warp value saved when the hamburger menu opens. */
  preMenuTimeWarp: number;
  /** performance.now() timestamp at which the staging lockout expires. */
  stagingLockoutUntil: number;
  /** Altitude (m) at the previous frame. */
  prevAltitude: number;
  /** Whether the rocket was in space on the previous frame. */
  prevInSpace: boolean;

  // Deorbit warning flag
  /** True while the deorbit warning banner is visible. */
  deorbitWarningActive: boolean;

  // Loop error tracking
  /** Count of consecutive loop() errors (reset to 0 on each successful frame). */
  loopConsecutiveErrors: number;
  /** The error-abort banner element, if visible. */
  loopErrorBanner: HTMLElement | null;

  // Worker physics
  /** True when the physics worker is active and handling ticks. */
  workerActive: boolean;
}

// ---------------------------------------------------------------------------
// Default state shape
// ---------------------------------------------------------------------------

function _createDefaultState(): FCState {
  return {
    // Core references
    rafId: null,
    ps: null,
    assembly: null,
    stagingConfig: null,
    flightState: null,
    state: null,
    container: null,
    onFlightEnd: null,
    lastTs: null,

    // Event listener references
    keydownHandler: null,
    keyupHandler: null,

    // DOM elements
    flightOverlay: null,

    // Assembly snapshots for restart
    originalAssembly: null,
    originalStagingConfig: null,

    // Summary guard
    summaryShown: false,

    // Map view state
    mapActive: false,
    mapHeldKeys: new Set(),
    mapThrusting: false,
    normalOrbitHeldKeys: new Set(),
    normalOrbitThrusting: false,
    mapHud: null,

    // Docking state
    dockingHud: null,

    // Time-warp state
    timeWarp: 1,
    preMenuTimeWarp: 1,
    stagingLockoutUntil: 0,
    prevAltitude: 0,
    prevInSpace: false,

    // Deorbit warning flag
    deorbitWarningActive: false,

    // Loop error tracking
    loopConsecutiveErrors: 0,
    loopErrorBanner: null,

    // Worker physics
    workerActive: false,
  };
}

// ---------------------------------------------------------------------------
// Singleton state instance
// ---------------------------------------------------------------------------

let _fcState: FCState = _createDefaultState();

/**
 * Get the current flight controller state object.
 */
export function getFCState(): FCState {
  return _fcState;
}

/**
 * Patch the flight controller state with one or more new values.
 */
export function setFCState(patch: Partial<FCState>): void {
  Object.assign(_fcState, patch);
}

/**
 * Reset the flight controller state to defaults.
 */
export function resetFCState(): void {
  _fcState = _createDefaultState();
}
