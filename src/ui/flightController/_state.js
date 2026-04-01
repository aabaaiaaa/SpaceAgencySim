/**
 * _state.js — Shared mutable state for the flight controller sub-modules.
 *
 * All module-level `let _xxx` variables from the original monolithic
 * flightController.js are collected here as properties of a single object.
 * Sub-modules access them via getFCState() and mutate via setFCState(patch).
 *
 * @module ui/flightController/_state
 */

// ---------------------------------------------------------------------------
// Default state shape
// ---------------------------------------------------------------------------

/** @returns {object} A fresh default state. */
function _createDefaultState() {
  return {
    // Core references
    /** @type {number|null} requestAnimationFrame handle. */
    rafId: null,
    /** @type {import('../../core/physics.js').PhysicsState|null} */
    ps: null,
    /** @type {import('../../core/rocketbuilder.js').RocketAssembly|null} */
    assembly: null,
    /** @type {import('../../core/rocketbuilder.js').StagingConfig|null} */
    stagingConfig: null,
    /** @type {import('../../core/gameState.js').FlightState|null} */
    flightState: null,
    /** @type {import('../../core/gameState.js').GameState|null} */
    state: null,
    /** @type {HTMLElement|null} The #ui-overlay container. */
    container: null,
    /** @type {((state: any) => void)|null} */
    onFlightEnd: null,
    /** @type {number|null} Timestamp of previous animation frame (ms). */
    lastTs: null,

    // Event listener references
    /** @type {((e: KeyboardEvent) => void)|null} */
    keydownHandler: null,
    /** @type {((e: KeyboardEvent) => void)|null} */
    keyupHandler: null,

    // DOM elements
    /** @type {HTMLElement|null} The in-flight control overlay DOM element. */
    flightOverlay: null,

    // Assembly snapshots for restart
    /** @type {import('../../core/rocketbuilder.js').RocketAssembly|null} */
    originalAssembly: null,
    /** @type {import('../../core/rocketbuilder.js').StagingConfig|null} */
    originalStagingConfig: null,

    // Summary guard
    /** True while the post-flight summary overlay is visible. */
    summaryShown: false,

    // Map view state
    /** True when the map view is the active scene. */
    mapActive: false,
    /** Set of orbital-relative thrust keys held in map view. */
    mapHeldKeys: new Set(),
    /** True while the craft is thrusting due to map-view orbital controls. */
    mapThrusting: false,
    /** Set of orbital-relative thrust keys held in NORMAL orbit mode. */
    normalOrbitHeldKeys: new Set(),
    /** True while the craft is thrusting due to normal-orbit WASD controls. */
    normalOrbitThrusting: false,
    /** @type {HTMLElement|null} The map-view HUD overlay. */
    mapHud: null,

    // Docking state
    /** @type {HTMLElement|null} DOM element for the docking guidance overlay. */
    dockingHud: null,

    // Time-warp state
    /** Current time-warp multiplier (1 = real-time). */
    timeWarp: 1,
    /** Time-warp value saved when the hamburger menu opens. */
    preMenuTimeWarp: 1,
    /** performance.now() timestamp at which the staging lockout expires. */
    stagingLockoutUntil: 0,
    /** Altitude (m) at the previous frame. */
    prevAltitude: 0,
    /** Whether the rocket was in space on the previous frame. */
    prevInSpace: false,

    // Deorbit warning flag
    /** True while the deorbit warning banner is visible. */
    deorbitWarningActive: false,
  };
}

// ---------------------------------------------------------------------------
// Singleton state instance
// ---------------------------------------------------------------------------

let _fcState = _createDefaultState();

/**
 * Get the current flight controller state object.
 * @returns {object}
 */
export function getFCState() {
  return _fcState;
}

/**
 * Patch the flight controller state with one or more new values.
 * @param {object} patch
 */
export function setFCState(patch) {
  Object.assign(_fcState, patch);
}

/**
 * Reset the flight controller state to defaults.
 */
export function resetFCState() {
  _fcState = _createDefaultState();
}
