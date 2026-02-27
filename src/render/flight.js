/**
 * flight.js — PixiJS rendering for the in-flight scene.
 *
 * Renders the active flight:
 *   - Sky background interpolated from light blue to near-black by altitude.
 *   - Stars visible above 50,000 m altitude (fading in from 50,000–70,000 m).
 *   - Ground band (desert sandy tan) drawn below world Y = 0.
 *   - The active rocket as a vertical stack of labelled part rectangles, with
 *     position and rotation applied as a PixiJS container transform.
 *   - Debris fragments (jettisoned stages) rendered in dimmed colours.
 *   - Camera auto-follows the rocket's centre of mass, or the debris fragment
 *     that contains the primary command module after separation.
 *
 * COORDINATE SYSTEM
 * =================
 * World space (physics):
 *   posX / posY — in metres; Y positive upward; (0,0) = launch-pad centre.
 *
 * Part local space (VAB world units, 20 world-units = 1 m):
 *   placed.x / placed.y — part-centre offset from rocket reference point.
 *   def.width / def.height — rendered size in pixels at default 1× zoom.
 *   SCALE_M_PER_PX = 0.05 converts "VAB world units" → metres.
 *
 * Screen space (PixiJS / CSS pixels):
 *   Y increases downward; origin is the top-left of the canvas.
 *   At FLIGHT_PIXELS_PER_METRE = 20 px/m this matches the VAB default zoom.
 *
 * @module render/flight
 */

import * as PIXI from 'pixi.js';
import { getApp }      from './index.js';
import { getPartById } from '../data/parts.js';
import { PartType }    from '../core/constants.js';

// ---------------------------------------------------------------------------
// Scale constants
// ---------------------------------------------------------------------------

/**
 * Screen pixels per metre in the flight view.
 * Matches the VAB default zoom (VAB_PIXELS_PER_METRE = 20) so part sizes
 * look the same in both scenes at their respective default views.
 */
const FLIGHT_PIXELS_PER_METRE = 20;

/**
 * Metres per VAB world unit (1 VAB world unit = 1 CSS pixel at zoom 1).
 * Converts placed.x / placed.y (world units) → metres for physics alignment.
 */
const SCALE_M_PER_PX = 0.05;

// ---------------------------------------------------------------------------
// Sky colours
// ---------------------------------------------------------------------------

/** Sky colour at sea level (light blue). */
const SKY_SEA_LEVEL = 0x87ceeb;

/** Sky colour at 30,000 m (dark blue). */
const SKY_HIGH_ALT  = 0x1a1a4e;

/** Sky colour above 70,000 m (near-black — space). */
const SKY_SPACE     = 0x000005;

// ---------------------------------------------------------------------------
// Ground / terrain colour
// ---------------------------------------------------------------------------

/** Desert sandy-tan ground colour below world Y = 0. */
const GROUND_COLOR = 0xc4a882;

// ---------------------------------------------------------------------------
// Star parameters
// ---------------------------------------------------------------------------

/** Altitude (m) at which stars start to become visible. */
const STAR_FADE_START = 50_000;

/** Altitude (m) at which stars reach full opacity. */
const STAR_FADE_FULL  = 70_000;

/** Total number of star dots pre-generated for the star field. */
const STAR_COUNT = 200;

// ---------------------------------------------------------------------------
// Part-type fill colours (identical palette to vab.js for visual consistency)
// ---------------------------------------------------------------------------

const PART_FILL = {
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
};

const PART_STROKE = {
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
};

// ---------------------------------------------------------------------------
// Module-level PixiJS scene objects
// ---------------------------------------------------------------------------

/** Full-screen sky rectangle, redrawn each frame with the interpolated colour. */
let _skyGraphics    = null;

/** Container holding the pre-generated star-dot Graphics. */
let _starsContainer = null;

/** Ground band Graphics, redrawn each frame when the ground is on screen. */
let _groundGraphics = null;

/** Container for all debris-fragment part rectangles + labels. */
let _debrisContainer = null;

/** Container for the active rocket's part rectangles + labels. */
let _rocketContainer = null;

// ---------------------------------------------------------------------------
// Pre-generated star positions — normalised [0, 1] in screen space
// ---------------------------------------------------------------------------

/** @type {Array<{ nx: number, ny: number, r: number }>} */
let _stars = [];

// ---------------------------------------------------------------------------
// Camera state — world-space centre of the viewport
// ---------------------------------------------------------------------------

/** World X (metres) the camera is centred on. */
let _camWorldX = 0;

/** World Y (metres) the camera is centred on. */
let _camWorldY = 0;

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------

/**
 * Linearly interpolate between two packed-RGB hex colours.
 *
 * @param {number} c1  Start colour (0xRRGGBB).
 * @param {number} c2  End colour   (0xRRGGBB).
 * @param {number} t   Factor in [0, 1].
 * @returns {number}   Interpolated packed-RGB colour.
 */
function _lerpColor(c1, c2, t) {
  const r1 = (c1 >> 16) & 0xff,  g1 = (c1 >> 8) & 0xff,  b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff,  g2 = (c2 >> 8) & 0xff,  b2 = c2 & 0xff;
  const r  = Math.round(r1 + (r2 - r1) * t);
  const g  = Math.round(g1 + (g2 - g1) * t);
  const b  = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

/**
 * Return the sky background colour for a given altitude.
 *   0 m         → #87CEEB  light blue
 *   30,000 m    → #1a1a4e  dark blue
 *   ≥ 70,000 m  → #000005  near-black (space)
 *
 * @param {number} altitude  Altitude in metres.
 * @returns {number}         Packed 0xRRGGBB colour.
 */
function _skyColor(altitude) {
  if (altitude >= STAR_FADE_FULL) return SKY_SPACE;
  if (altitude >= 30_000) {
    const t = (altitude - 30_000) / (STAR_FADE_FULL - 30_000);
    return _lerpColor(SKY_HIGH_ALT, SKY_SPACE, t);
  }
  const t = altitude / 30_000;
  return _lerpColor(SKY_SEA_LEVEL, SKY_HIGH_ALT, t);
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Convert a world-space position (metres, Y-up) to canvas pixels (Y-down).
 *
 * @param {number} worldX   World X in metres.
 * @param {number} worldY   World Y in metres (positive = up).
 * @param {number} screenW  Canvas width in pixels.
 * @param {number} screenH  Canvas height in pixels.
 * @returns {{ sx: number, sy: number }}  Canvas pixel coordinates.
 */
function _worldToScreen(worldX, worldY, screenW, screenH) {
  return {
    sx: screenW / 2 + (worldX - _camWorldX) * FLIGHT_PIXELS_PER_METRE,
    sy: screenH / 2 - (worldY - _camWorldY) * FLIGHT_PIXELS_PER_METRE,
  };
}

// ---------------------------------------------------------------------------
// Camera logic
// ---------------------------------------------------------------------------

/**
 * Update the camera to follow the rocket's centre of mass.
 *
 * Priority order:
 *   1. If a COMMAND_MODULE or COMPUTER_MODULE is still in ps.activeParts, the
 *      camera follows the mass-weighted CoM of the main rocket.
 *   2. If the primary command module is on a debris fragment, the camera
 *      follows that fragment's CoM instead.
 *   3. Fallback: keep the camera on the main rocket's reference point.
 *
 * @param {import('../core/physics.js').PhysicsState}           ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}   assembly
 */
function _updateCamera(ps, assembly) {
  // Check whether the primary command module is still on the main rocket.
  if (_hasCommandModule(ps.activeParts, assembly)) {
    const com = _computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
    _camWorldX = com.x;
    _camWorldY = com.y;
    return;
  }

  // Search debris fragments for the one containing the command module.
  for (const debris of ps.debris) {
    if (_hasCommandModule(debris.activeParts, assembly)) {
      const com = _computeCoM(debris.fuelStore, assembly, debris.activeParts, debris.posX, debris.posY);
      _camWorldX = com.x;
      _camWorldY = com.y;
      return;
    }
  }

  // Fallback: follow the main rocket's reference point.
  _camWorldX = ps.posX;
  _camWorldY = ps.posY;
}

/**
 * Return true if the given part set contains at least one COMMAND_MODULE or
 * COMPUTER_MODULE.
 *
 * @param {Set<string>}                                         partSet
 * @param {import('../core/rocketbuilder.js').RocketAssembly}  assembly
 * @returns {boolean}
 */
function _hasCommandModule(partSet, assembly) {
  for (const instanceId of partSet) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (
      def &&
      (def.type === PartType.COMMAND_MODULE ||
       def.type === PartType.COMPUTER_MODULE)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the mass-weighted centre of mass for a set of parts.
 *
 * The CoM is computed in world space (metres) using each part's local offset
 * from the rocket/debris origin position.  The offset is taken from the VAB
 * placed positions (not rotation-adjusted — the physics engine already tracks
 * the true CoM via Newton integration, so this gives a good visual centre).
 *
 * @param {Map<string, number>}                                 fuelStore
 * @param {import('../core/rocketbuilder.js').RocketAssembly}  assembly
 * @param {Set<string>}                                        partSet
 * @param {number}                                             originX  World X (m) of the rocket/debris reference point.
 * @param {number}                                             originY  World Y (m) of the rocket/debris reference point.
 * @returns {{ x: number, y: number }}  CoM world position in metres.
 */
function _computeCoM(fuelStore, assembly, partSet, originX, originY) {
  let totalMass = 0;
  let comX      = 0;
  let comY      = 0;

  for (const instanceId of partSet) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    // Dry mass + remaining propellant in this part (if any).
    const fuelMass = fuelStore?.get(instanceId) ?? 0;
    const mass     = (def.mass ?? 1) + fuelMass;

    // Part world position: origin + local offset converted to metres.
    const partWorldX = originX + placed.x * SCALE_M_PER_PX;
    const partWorldY = originY + placed.y * SCALE_M_PER_PX;

    comX      += partWorldX * mass;
    comY      += partWorldY * mass;
    totalMass += mass;
  }

  if (totalMass > 0) {
    return { x: comX / totalMass, y: comY / totalMass };
  }
  return { x: originX, y: originY };
}

// ---------------------------------------------------------------------------
// Sky rendering
// ---------------------------------------------------------------------------

/**
 * Redraw the sky background rectangle with the colour appropriate for the
 * current camera altitude.
 *
 * @param {number} altitude  Camera altitude in metres (used for colour lookup).
 * @param {number} w         Canvas width in pixels.
 * @param {number} h         Canvas height in pixels.
 */
function _renderSky(altitude, w, h) {
  if (!_skyGraphics) return;
  _skyGraphics.clear();
  const color = _skyColor(altitude);
  _skyGraphics.rect(0, 0, w, h);
  _skyGraphics.fill({ color });
}

// ---------------------------------------------------------------------------
// Stars rendering
// ---------------------------------------------------------------------------

/**
 * Pre-generate the star field using a deterministic LCG sequence.
 * Stars are stored as normalised [0, 1] screen-space positions.
 */
function _generateStars() {
  _stars = [];
  // LCG pseudo-random — deterministic so star positions don't change between
  // frames or game sessions.
  let seed = 0xdeadbeef;
  function rand() {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 0x100000000;
  }
  for (let i = 0; i < STAR_COUNT; i++) {
    _stars.push({
      nx: rand(),        // Normalised X in [0, 1]
      ny: rand(),        // Normalised Y in [0, 1]
      r:  0.5 + rand(), // Radius in pixels (0.5–1.5)
    });
  }
}

/**
 * Render the star field, fading in as altitude rises above STAR_FADE_START.
 *
 * @param {number} altitude  Current camera altitude in metres.
 * @param {number} w         Canvas width in pixels.
 * @param {number} h         Canvas height in pixels.
 */
function _renderStars(altitude, w, h) {
  if (!_starsContainer) return;

  // Alpha: 0 below 50 km, 1 at 70 km and above.
  const alpha = Math.max(
    0,
    Math.min(1, (altitude - STAR_FADE_START) / (STAR_FADE_FULL - STAR_FADE_START)),
  );

  while (_starsContainer.children.length) _starsContainer.removeChildAt(0);
  if (alpha <= 0) return;

  const g = new PIXI.Graphics();
  _starsContainer.addChild(g);

  for (const star of _stars) {
    g.circle(star.nx * w, star.ny * h, star.r);
    g.fill({ color: 0xffffff, alpha });
  }
}

// ---------------------------------------------------------------------------
// Ground rendering
// ---------------------------------------------------------------------------

/**
 * Draw the ground band (sandy-tan) below world Y = 0.
 * The band stretches from the ground-line screen position to the canvas bottom.
 *
 * @param {number} w  Canvas width in pixels.
 * @param {number} h  Canvas height in pixels.
 */
function _renderGround(w, h) {
  if (!_groundGraphics) return;
  _groundGraphics.clear();

  // Screen Y coordinate of world Y = 0.
  const groundScreenY = h / 2 + _camWorldY * FLIGHT_PIXELS_PER_METRE;

  // Only draw if the ground line is above the canvas bottom edge.
  if (groundScreenY >= h) return;

  const drawY = Math.max(0, groundScreenY);
  const drawH = h - drawY;
  _groundGraphics.rect(0, drawY, w, drawH);
  _groundGraphics.fill({ color: GROUND_COLOR });
}

// ---------------------------------------------------------------------------
// Part drawing helpers
// ---------------------------------------------------------------------------

/**
 * Draw a single part rectangle into `g` in the container's local coordinate
 * space.
 *
 * The part is centred on `(placed.x, −placed.y)` in container pixels:
 *   · placed.x is used directly (VAB world units = pixels at flight scale).
 *   · placed.y is negated because VAB Y-up maps to screen Y-down.
 *
 * @param {PIXI.Graphics}                                    g
 * @param {import('../core/rocketbuilder.js').PlacedPart}   placed
 * @param {import('../data/parts.js').PartDef}              def
 * @param {number}                                          [alpha=1]  Fill/stroke alpha.
 */
function _drawPartRect(g, placed, def, alpha = 1) {
  const lx = placed.x;       // Local X (pixels, right = positive)
  const ly = -placed.y;      // Local Y (pixels, down = positive — flipped from VAB Y-up)
  const pw = def.width  ?? 40;
  const ph = def.height ?? 20;

  const fill   = PART_FILL[def.type]   ?? 0x0e2040;
  const stroke = PART_STROKE[def.type] ?? 0x2060a0;

  g.rect(lx - pw / 2, ly - ph / 2, pw, ph);
  g.fill({ color: fill, alpha });
  g.stroke({ color: stroke, width: 1, alpha });
}

/**
 * Create a PIXI.Text label for a part, positioned at the part's centre in
 * local container space.
 *
 * @param {import('../core/rocketbuilder.js').PlacedPart}  placed
 * @param {import('../data/parts.js').PartDef}             def
 * @param {number}                                         [alpha=1]
 * @returns {PIXI.Text}
 */
function _makePartLabel(placed, def, alpha = 1) {
  const label = new PIXI.Text({
    text:  def.name,
    style: new PIXI.TextStyle({
      fill:       '#a8c8e8',
      fontSize:   9,
      fontFamily: 'Courier New, Courier, monospace',
    }),
  });
  label.anchor.set(0.5, 0.5);
  label.x     = placed.x;
  label.y     = -placed.y;
  label.alpha = alpha;
  return label;
}

// ---------------------------------------------------------------------------
// Rocket rendering
// ---------------------------------------------------------------------------

/**
 * Render the main active rocket into `_rocketContainer`.
 *
 * The container is positioned at the rocket's reference point in screen space
 * and rotated to match `ps.angle`.  Each active part is drawn as a filled
 * rectangle at its local offset within the container, with its name label.
 *
 * @param {import('../core/physics.js').PhysicsState}           ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}   assembly
 * @param {number}                                              w  Canvas width.
 * @param {number}                                              h  Canvas height.
 */
function _renderRocket(ps, assembly, w, h) {
  if (!_rocketContainer) return;

  while (_rocketContainer.children.length) _rocketContainer.removeChildAt(0);
  if (ps.activeParts.size === 0) return;

  // Position the container at the rocket's world-space reference point.
  const { sx, sy } = _worldToScreen(ps.posX, ps.posY, w, h);
  _rocketContainer.x        = sx;
  _rocketContainer.y        = sy;
  _rocketContainer.rotation = ps.angle;

  // Batch all part rectangles into a single Graphics object.
  const g = new PIXI.Graphics();
  _rocketContainer.addChild(g);

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    _drawPartRect(g, placed, def, 0.9);
  }

  // Add text labels as separate child objects (labels are part of the rotated
  // container, so they tilt with the rocket — acceptable for a simple renderer).
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    _rocketContainer.addChild(_makePartLabel(placed, def, 1));
  }
}

// ---------------------------------------------------------------------------
// Debris rendering
// ---------------------------------------------------------------------------

/**
 * Render all debris fragments into `_debrisContainer`.
 *
 * Each fragment gets its own child Container positioned and rotated to match
 * its physics state.  Parts are rendered at 50 % opacity so debris is visually
 * distinguishable from the player-controlled rocket.
 *
 * @param {import('../core/staging.js').DebrisState[]}          debrisList
 * @param {import('../core/rocketbuilder.js').RocketAssembly}   assembly
 * @param {number}                                              w  Canvas width.
 * @param {number}                                              h  Canvas height.
 */
function _renderDebris(debrisList, assembly, w, h) {
  if (!_debrisContainer) return;

  while (_debrisContainer.children.length) _debrisContainer.removeChildAt(0);

  for (const debris of debrisList) {
    if (debris.activeParts.size === 0) continue;

    const { sx, sy } = _worldToScreen(debris.posX, debris.posY, w, h);

    const fragContainer    = new PIXI.Container();
    fragContainer.x        = sx;
    fragContainer.y        = sy;
    fragContainer.rotation = debris.angle;
    _debrisContainer.addChild(fragContainer);

    // Part rectangles at half opacity to indicate non-controlled status.
    const g = new PIXI.Graphics();
    fragContainer.addChild(g);

    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      _drawPartRect(g, placed, def, 0.5);
    }

    // Labels at matching opacity.
    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      fragContainer.addChild(_makePartLabel(placed, def, 0.5));
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the flight scene PixiJS layers.
 *
 * Clears whatever was on the stage (e.g. the VAB scene) and creates the
 * layered containers the flight renderer writes to each frame.
 *
 * Call once when transitioning from the lobby/VAB into an active flight.
 */
export function initFlightRenderer() {
  const app = getApp();

  // Tear down whatever scene was previously on stage (e.g. the VAB).
  app.stage.removeChildren();

  // Layer order (bottom → top):
  //   sky  →  stars  →  ground  →  debris  →  active rocket
  _skyGraphics     = new PIXI.Graphics();
  _starsContainer  = new PIXI.Container();
  _groundGraphics  = new PIXI.Graphics();
  _debrisContainer = new PIXI.Container();
  _rocketContainer = new PIXI.Container();

  app.stage.addChild(_skyGraphics);
  app.stage.addChild(_starsContainer);
  app.stage.addChild(_groundGraphics);
  app.stage.addChild(_debrisContainer);
  app.stage.addChild(_rocketContainer);

  // Pre-generate the deterministic star field.
  _generateStars();

  // Reset camera to launch-pad origin.
  _camWorldX = 0;
  _camWorldY = 0;

  console.log('[Flight Renderer] Initialized');
}

/**
 * Render a single flight frame.
 *
 * Call this once per animation frame (e.g. from a PixiJS Ticker or
 * requestAnimationFrame loop) while a flight is active.  Reads the current
 * PhysicsState and assembly and redraws all scene layers.
 *
 * @param {import('../core/physics.js').PhysicsState}           ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}   assembly
 */
export function renderFlightFrame(ps, assembly) {
  const w        = window.innerWidth;
  const h        = window.innerHeight;
  const altitude = Math.max(0, ps.posY);

  // 1. Update camera to follow the relevant object's CoM.
  _updateCamera(ps, assembly);

  // 2. Sky background — full-screen rect with altitude-interpolated colour.
  _renderSky(altitude, w, h);

  // 3. Stars — visible above 50 km, fully opaque above 70 km.
  _renderStars(altitude, w, h);

  // 4. Ground band — sandy-tan terrain below world Y = 0.
  _renderGround(w, h);

  // 5. Debris fragments — dimmed, camera does not follow (unless they have
  //    the command module, which is handled by _updateCamera above).
  _renderDebris(ps.debris, assembly, w, h);

  // 6. Active rocket — full opacity, camera centred here (normally).
  _renderRocket(ps, assembly, w, h);
}

/**
 * Tear down the flight scene.
 *
 * Removes all flight-specific containers from the PixiJS stage and clears
 * module-level state.  Call when leaving the flight scene (e.g. transitioning
 * to the post-flight results screen or returning to the VAB).
 */
export function destroyFlightRenderer() {
  const app = getApp();
  app.stage.removeChildren();

  _skyGraphics     = null;
  _starsContainer  = null;
  _groundGraphics  = null;
  _debrisContainer = null;
  _rocketContainer = null;
  _stars           = [];

  _camWorldX = 0;
  _camWorldY = 0;

  console.log('[Flight Renderer] Destroyed');
}

/**
 * Read-only snapshot of the camera's current world-space position.
 * Useful for the UI layer (e.g. to display altitude/position readouts).
 *
 * @returns {{ x: number, y: number }}  Camera centre in metres (world space).
 */
export function flightGetCamera() {
  return { x: _camWorldX, y: _camWorldY };
}
