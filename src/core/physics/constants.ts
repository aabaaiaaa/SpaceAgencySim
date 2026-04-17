// ---------------------------------------------------------------------------
// Physics constants. Extracted from physics.ts so that physics.ts can become
// a pure barrel.
// ---------------------------------------------------------------------------

/** Fixed physics timestep (seconds). */
export const FIXED_DT: number = 1 / 60;

/** Scale factor: metres per pixel at default 1× zoom. */
export const SCALE_M_PER_PX: number = 0.05;

/** Default crash threshold (m/s) for parts without an explicit crashThreshold. */
export const DEFAULT_CRASH_THRESHOLD: number = 10;

// -- Ground tipping constants ------------------------------------------------
/** N·m of torque applied by player A/D input while grounded. */
export const PLAYER_TIP_TORQUE: number = 50_000;
/** Angle (radians) past which a grounded tipping rocket crashes (~80°). */
export const TOPPLE_CRASH_ANGLE: number = Math.PI * 0.44;
/** Maximum angular acceleration (rad/s²) from player tipping input. */
export const MAX_PLAYER_TIP_ACCEL: number = 10.0;
/** Angle threshold below which a near-upright rocket snaps to 0. */
export const TILT_SNAP_THRESHOLD: number = 0.005;
/** Angular velocity threshold below which snap to rest. */
export const ANGULAR_VEL_SNAP_THRESHOLD: number = 0.05;

// -- Airborne torque-based rotation constants --------------------------------
/** Tuning knob for parachute stabilization torque strength. */
export const CHUTE_TORQUE_SCALE: number = 3.0;

// -- Captured asteroid torque scaling ----------------------------------------
/**
 * Torque scaling constant for off-CoM thrust with a captured asteroid.
 *
 * When the asteroid's mass shifts the combined CoM away from the thrust axis,
 * engines produce a torque proportional to the mass asymmetry.  This constant
 * controls how quickly the craft spins (rad/s² per newton of thrust) and is
 * tuned for gameplay rather than strict realism.
 */
export const ASTEROID_TORQUE_FACTOR = 0.00002;

// -- Ground contact destruction band -----------------------------------------
/** Band (VAB world units) around the minimum Y to treat as the same layer. */
export const DESTRUCTION_BAND: number = 5;
