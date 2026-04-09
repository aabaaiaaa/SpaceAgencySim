/**
 * asteroidBelt.ts — Procedural asteroid generation for belt zone encounters.
 *
 * When the player enters ORBIT phase within an asteroid belt zone (around
 * the Sun), this module generates a set of nearby asteroids as TransferObjects.
 * Asteroids are transient — they exist only for the duration of the belt
 * encounter and are not persisted in GameState.
 *
 * Belt zones are defined on the Sun body in `src/data/bodies.ts`:
 *   - OUTER_A: 329–374 billion m (sparse, 10 asteroids)
 *   - DENSE:   374–419 billion m (high density, 30 asteroids)
 *   - OUTER_B: 419–479 billion m (sparse, 10 asteroids)
 *
 * @module core/asteroidBelt
 */

import type { TransferObject } from './transferObjects.js';
import { BeltZone, BODY_GM } from './constants.js';
import { CELESTIAL_BODIES, type AltitudeBand } from '../data/bodies.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An asteroid in the belt, extending TransferObject with extra fields. */
export interface Asteroid extends TransferObject {
  /** Always 'asteroid'. */
  type: 'asteroid';
  /** Seed for procedural shape generation in the renderer. */
  shapeSeed: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of asteroids to generate per zone type. */
const ASTEROID_COUNT: Readonly<Record<BeltZone, number>> = {
  [BeltZone.OUTER_A]: 10,
  [BeltZone.OUTER_B]: 10,
  [BeltZone.DENSE]: 30,
};

/** Average rock density in kg/m^3 (stony asteroid). */
const ROCK_DENSITY = 2_500;

/** Minimum asteroid radius in metres. */
const MIN_RADIUS = 1;

/** Maximum asteroid radius in metres. */
const MAX_RADIUS = 1_000;

/**
 * Power-law exponent for size distribution.
 * Higher = more small asteroids. Dense zone uses a smaller exponent
 * (biased toward larger rocks).
 */
const SIZE_EXPONENT_SPARSE = 3.0;
const SIZE_EXPONENT_DENSE = 2.0;

/** Maximum relative velocity perturbation in m/s. */
const MAX_VELOCITY_PERTURBATION = 50;

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32)
// ---------------------------------------------------------------------------

/**
 * Mulberry32 — a simple 32-bit seeded PRNG.
 * Returns a function that produces floats in [0, 1) on each call.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ---------------------------------------------------------------------------
// Module state (transient — not in GameState)
// ---------------------------------------------------------------------------

let _activeAsteroids: Asteroid[] = [];
let _sessionCounter = 0;

// ---------------------------------------------------------------------------
// Belt zone lookup
// ---------------------------------------------------------------------------

/** Cached belt bands from the Sun body definition. */
let _beltBands: readonly AltitudeBand[] | null = null;

function _getBeltBands(): readonly AltitudeBand[] {
  if (!_beltBands) {
    const sun = CELESTIAL_BODIES.SUN;
    _beltBands = sun.altitudeBands.filter(
      (b): b is AltitudeBand & { beltZone: BeltZone } => b.beltZone !== undefined,
    );
  }
  return _beltBands;
}

/**
 * Determine which belt zone (if any) corresponds to a given altitude
 * from the Sun's centre.
 *
 * @param altitude  Altitude in metres from the Sun's surface.
 * @returns The BeltZone, or null if the altitude is not within a belt zone.
 */
export function getBeltZoneAtAltitude(altitude: number): BeltZone | null {
  const bands = _getBeltBands();
  for (const band of bands) {
    if (altitude >= band.min && altitude < band.max) {
      return band.beltZone!;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Orbital velocity helper
// ---------------------------------------------------------------------------

/**
 * Compute the circular orbital speed at a given distance from the Sun.
 * v = sqrt(GM / r)
 */
function _circularSpeed(distanceFromCentre: number): number {
  const gm = BODY_GM.SUN;
  return Math.sqrt(gm / distanceFromCentre);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate a set of asteroids for a belt zone encounter.
 *
 * @param zone            The belt zone the player is in.
 * @param playerX         Player craft X position (metres, Sun-centred frame).
 * @param playerY         Player craft Y position (metres, Sun-centred frame).
 * @param renderDistance   Maximum distance from player to place asteroids (metres).
 * @returns Array of generated asteroids.
 */
export function generateBeltAsteroids(
  zone: BeltZone,
  playerX: number,
  playerY: number,
  renderDistance: number,
): Asteroid[] {
  _sessionCounter++;
  const seed = (_sessionCounter * 2654435761) ^ (Date.now() & 0xffffffff);
  const rng = mulberry32(seed);

  const count = ASTEROID_COUNT[zone];
  const sizeExponent =
    zone === BeltZone.DENSE ? SIZE_EXPONENT_DENSE : SIZE_EXPONENT_SPARSE;

  // Player distance from Sun centre (for orbital velocity direction).
  const playerDist = Math.hypot(playerX, playerY);

  // Orbital velocity direction at player position (tangent to orbit, prograde).
  // For a circular orbit the velocity is perpendicular to the radius vector.
  // Direction: 90 degrees counter-clockwise from the radius vector.
  const radAngle = Math.atan2(playerY, playerX);
  const progradeAngle = radAngle + Math.PI / 2;

  const asteroids: Asteroid[] = [];

  for (let i = 0; i < count; i++) {
    // Position: random within renderDistance of player.
    const angle = rng() * 2 * Math.PI;
    // Use sqrt for uniform area distribution.
    const dist = Math.sqrt(rng()) * renderDistance;
    const posX = playerX + Math.cos(angle) * dist;
    const posY = playerY + Math.sin(angle) * dist;

    // Asteroid distance from Sun centre (for its own orbital velocity).
    const astDist = Math.hypot(posX, posY);
    const astSpeed = astDist > 0 ? _circularSpeed(astDist) : 0;

    // Orbital velocity direction at asteroid position (tangent, prograde).
    const astRadAngle = Math.atan2(posY, posX);
    const astProgradeAngle = astRadAngle + Math.PI / 2;

    // Base co-orbital velocity with small random perturbation.
    const perturbX = (rng() - 0.5) * 2 * MAX_VELOCITY_PERTURBATION;
    const perturbY = (rng() - 0.5) * 2 * MAX_VELOCITY_PERTURBATION;
    const velX = Math.cos(astProgradeAngle) * astSpeed + perturbX;
    const velY = Math.sin(astProgradeAngle) * astSpeed + perturbY;

    // Size: power-law distribution biased toward smaller.
    // r = MIN + (MAX - MIN) * u^exponent, where u ~ Uniform(0,1).
    const u = rng();
    const radius = MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.pow(u, sizeExponent);

    // Mass: sphere of rock.
    const volume = (4 / 3) * Math.PI * radius * radius * radius;
    const mass = volume * ROCK_DENSITY;

    // Unique ID and name.
    const nameNum = Math.floor(rng() * 10000);
    const nameStr = String(nameNum).padStart(4, '0');
    const id = `AST-${nameStr}-${i}`;
    const name = `AST-${nameStr}`;

    // Shape seed for procedural rendering.
    const shapeSeed = (rng() * 0xffffffff) >>> 0;

    asteroids.push({
      id,
      type: 'asteroid',
      name,
      posX,
      posY,
      velX,
      velY,
      radius,
      mass,
      shapeSeed,
    });
  }

  return asteroids;
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Get the currently active asteroids for this belt encounter.
 */
export function getActiveAsteroids(): readonly Asteroid[] {
  return _activeAsteroids;
}

/**
 * Check whether asteroids are currently active.
 */
export function hasAsteroids(): boolean {
  return _activeAsteroids.length > 0;
}

/**
 * Set the active asteroids (called after generation).
 */
export function setActiveAsteroids(asteroids: Asteroid[]): void {
  _activeAsteroids = [...asteroids];
}

/**
 * Clear all active asteroids (called on exit from belt orbit).
 */
export function clearAsteroids(): void {
  _activeAsteroids = [];
}
