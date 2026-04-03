/**
 * _constants.ts — All constant values for the flight renderer.
 *
 * Colour tables, scale factors, zoom limits, trail/plume parameters,
 * camera constants, star count, etc.
 *
 */

import { PartType, SurfaceItemType } from '../../core/constants.js';

// ---------------------------------------------------------------------------
// Scale constants
// ---------------------------------------------------------------------------

/** Screen pixels per metre in the flight view at zoom 1x. */
export const FLIGHT_PIXELS_PER_METRE = 20;

/** Metres per VAB world unit (1 VAB world unit = 1 CSS pixel at zoom 1). */
export const SCALE_M_PER_PX = 0.05;

/** Minimum zoom level (very zoomed out). */
export const MIN_ZOOM = 0.1;

/** Maximum zoom level (very close up). */
export const MAX_ZOOM = 5.0;

// ---------------------------------------------------------------------------
// Sky colours (Earth defaults — overridden per-body at runtime)
// ---------------------------------------------------------------------------

/** Sky colour at sea level (light blue). */
export const SKY_SEA_LEVEL = 0x87ceeb;

/** Sky colour at 30,000 m (dark blue). */
export const SKY_HIGH_ALT = 0x1a1a4e;

/** Sky colour above 70,000 m (near-black — space). */
export const SKY_SPACE = 0x000005;

// ---------------------------------------------------------------------------
// Ground / terrain colour (Earth default)
// ---------------------------------------------------------------------------

/** Desert sandy-tan ground colour below world Y = 0. */
export const GROUND_COLOR = 0xc4a882;

// ---------------------------------------------------------------------------
// Star parameters (Earth defaults)
// ---------------------------------------------------------------------------

/** Altitude (m) at which stars start to become visible. */
export const STAR_FADE_START = 50_000;

/** Altitude (m) at which stars reach full opacity. */
export const STAR_FADE_FULL = 70_000;

/** Total number of star dots pre-generated for the star field. */
export const STAR_COUNT = 200;

// ---------------------------------------------------------------------------
// Engine trail constants
// ---------------------------------------------------------------------------

/** Lifetime of a single fire trail segment at throttle=1 in vacuum (seconds). */
export const TRAIL_MAX_AGE = 0.18;

/** Lifetime multiplier added by atmospheric density (dense air -> longer smoke). */
export const TRAIL_ATMOSPHERE_AGE_BONUS = 3.0;

/** Air density threshold (kg/m^3) below which engine trails are suppressed. */
export const TRAIL_DENSITY_THRESHOLD = 0.01;

/** Speed (m/s) at which fire trail segments drift away from the engine nozzle. */
export const TRAIL_DRIFT_SPEED = 30;

/** Lateral smoke fan speed (m/s) at zero velocity (launch-pad smoke spread). */
export const TRAIL_FAN_SPEED = 18;

/** Velocity (m/s) at which the lateral fanning effect disappears. */
export const TRAIL_FAN_VELOCITY_CUTOFF = 80;

// ---------------------------------------------------------------------------
// Plume constants
// ---------------------------------------------------------------------------

/** Number of sample points per plume edge. */
export const PLUME_SEGMENTS = 18;

/** Sine phase advance rate (radians/second) for liquid engines. */
export const PLUME_PHASE_RATE_LIQUID = 18;

/** Sine phase advance rate (radians/second) for SRBs (more turbulent). */
export const PLUME_PHASE_RATE_SRB = 25;

// ---------------------------------------------------------------------------
// Camera constants
// ---------------------------------------------------------------------------

/** Rate at which the CoM offset decays (metres per second). */
export const CAM_OFFSET_DECAY_RATE = 2.0;

// ---------------------------------------------------------------------------
// Part-type fill colours (identical palette to vab.js for visual consistency)
// ---------------------------------------------------------------------------

export const PART_FILL: Record<string, number> = {
  [PartType.COMMAND_MODULE]:       0x1a3860,
  [PartType.COMPUTER_MODULE]:      0x122848,
  [PartType.SERVICE_MODULE]:       0x1c2c58,
  [PartType.FUEL_TANK]:            0x0e2040,
  [PartType.ENGINE]:               0x3a1a08,
  [PartType.SOLID_ROCKET_BOOSTER]: 0x301408,
  [PartType.STACK_DECOUPLER]:      0x142030,
  [PartType.RADIAL_DECOUPLER]:     0x142030,
  [PartType.DECOUPLER]:            0x142030,
  [PartType.LANDING_LEG]:          0x102018,
  [PartType.LANDING_LEGS]:         0x102018,
  [PartType.PARACHUTE]:            0x2e1438,
  [PartType.SATELLITE]:            0x142240,
  [PartType.HEAT_SHIELD]:          0x2c1000,
  [PartType.RCS_THRUSTER]:         0x182c30,
  [PartType.SOLAR_PANEL]:          0x0a2810,
  [PartType.LAUNCH_CLAMP]:         0x2a2818,
};

export const PART_STROKE: Record<string, number> = {
  [PartType.COMMAND_MODULE]:       0x4080c0,
  [PartType.COMPUTER_MODULE]:      0x2870a0,
  [PartType.SERVICE_MODULE]:       0x3860b0,
  [PartType.FUEL_TANK]:            0x2060a0,
  [PartType.ENGINE]:               0xc06020,
  [PartType.SOLID_ROCKET_BOOSTER]: 0xa04818,
  [PartType.STACK_DECOUPLER]:      0x305080,
  [PartType.RADIAL_DECOUPLER]:     0x305080,
  [PartType.DECOUPLER]:            0x305080,
  [PartType.LANDING_LEG]:          0x207840,
  [PartType.LANDING_LEGS]:         0x207840,
  [PartType.PARACHUTE]:            0x8040a0,
  [PartType.SATELLITE]:            0x2868b0,
  [PartType.HEAT_SHIELD]:          0xa04010,
  [PartType.RCS_THRUSTER]:         0x2890a0,
  [PartType.SOLAR_PANEL]:          0x20a040,
  [PartType.LAUNCH_CLAMP]:         0x807040,
};

// ---------------------------------------------------------------------------
// Surface item colours
// ---------------------------------------------------------------------------

export const SURFACE_ITEM_COLORS: Record<string, number> = {
  [SurfaceItemType.FLAG]:               0xff4444,
  [SurfaceItemType.SURFACE_SAMPLE]:     0xddcc88,
  [SurfaceItemType.SURFACE_INSTRUMENT]: 0x44aaff,
  [SurfaceItemType.BEACON]:             0x44ff44,
};

// ---------------------------------------------------------------------------
// Biome label fade speed
// ---------------------------------------------------------------------------

/** Rate at which the biome label fades in/out (per second). */
export const BIOME_LABEL_FADE_SPEED = 3.0;

// ---------------------------------------------------------------------------
// RCS plume constants
// ---------------------------------------------------------------------------

/** RCS plume colour (blue-white). */
export const RCS_PLUME_COLOR = 0x88ccff;

/** RCS plume length in metres. */
export const RCS_PLUME_LENGTH = 1.5;

/** RCS plume base half-width in metres. */
export const RCS_PLUME_HALF_WIDTH = 0.3;

// ---------------------------------------------------------------------------
// Mach effect constants
// ---------------------------------------------------------------------------

/** Speed of sound at sea level (m/s). */
export const MACH_1 = 343;
