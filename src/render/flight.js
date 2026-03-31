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
import { PartType, ControlMode, BODY_RADIUS } from '../core/constants.js';
import { airDensity }  from '../core/atmosphere.js';
import { getBiome, getBiomeTransition, BIOME_FADE_RANGE } from '../core/biomes.js';
import { DEPLOY_DURATION } from '../core/parachute.js';
import { LegState, LEG_DEPLOY_DURATION, getDeployedLegFootOffset } from '../core/legs.js';
import { hasMalfunction, MALFUNCTION_LABELS } from '../core/malfunction.js';

// ---------------------------------------------------------------------------
// Scale constants
// ---------------------------------------------------------------------------

/**
 * Screen pixels per metre in the flight view at zoom 1×.
 * Matches the VAB default zoom (VAB_PIXELS_PER_METRE = 20) so part sizes
 * look the same in both scenes at their respective default views.
 */
const FLIGHT_PIXELS_PER_METRE = 20;

/**
 * Metres per VAB world unit (1 VAB world unit = 1 CSS pixel at zoom 1).
 * Converts placed.x / placed.y (world units) → metres for physics alignment.
 */
const SCALE_M_PER_PX = 0.05;

/** Minimum zoom level (very zoomed out — see large portion of trajectory). */
const MIN_ZOOM = 0.1;

/** Maximum zoom level (very close up). */
const MAX_ZOOM = 5.0;

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
// Engine trail constants
// ---------------------------------------------------------------------------

/** Lifetime of a single fire trail segment at throttle=1 in vacuum (seconds). */
const TRAIL_MAX_AGE = 0.18;

/** Lifetime multiplier added by atmospheric density (dense air → longer smoke). */
const TRAIL_ATMOSPHERE_AGE_BONUS = 3.0;

/**
 * Air density threshold (kg/m³) below which engine trails are suppressed.
 * Corresponds to approximately 50 000 m altitude.
 */
const TRAIL_DENSITY_THRESHOLD = 0.01;

/** Speed (m/s) at which fire trail segments drift away from the engine nozzle. */
const TRAIL_DRIFT_SPEED = 30;

/** Lateral smoke fan speed (m/s) at zero velocity (launch-pad smoke spread). */
const TRAIL_FAN_SPEED = 18;

/** Velocity (m/s) at which the lateral fanning effect disappears. */
const TRAIL_FAN_VELOCITY_CUTOFF = 80;

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

/** Container for all engine-trail segment graphics (above debris, below rocket). */
let _trailContainer = null;

/** Container for the active rocket's part rectangles + labels. */
let _rocketContainer = null;

/** Container for independently-oriented parachute canopies (drawn in world space). */
let _canopyContainer = null;

/** Container for the biome label overlay (rendered above canopies). */
let _biomeLabelContainer = null;

/** Graphics layer for the curved horizon effect (rendered between stars and ground). */
let _horizonGraphics = null;

/** Currently displayed biome name (to detect changes for label animation). */
let _currentBiomeName = null;

/** Biome label opacity (0 → 1), animated on transitions. */
let _biomeLabelAlpha = 0;

// ---------------------------------------------------------------------------
// Pre-generated star positions — normalised [0, 1] in screen space
// ---------------------------------------------------------------------------

/** @type {Array<{ nx: number, ny: number, r: number }>} */
let _stars = [];

// ---------------------------------------------------------------------------
// Engine trail state
// ---------------------------------------------------------------------------

/**
 * @typedef {object} TrailSegment
 * @property {number}  worldX   World-space X position (metres).
 * @property {number}  worldY   World-space Y position (metres).
 * @property {number}  vx       Drift velocity X (m/s).
 * @property {number}  vy       Drift velocity Y (m/s).
 * @property {number}  age      Time elapsed since emission (seconds).
 * @property {number}  baseW    Emitted width in pixels.
 * @property {number}  baseH    Emitted height in pixels.
 * @property {boolean} isSRB   True when emitted from a solid-rocket booster.
 */

/** @type {TrailSegment[]} */
let _trailSegments = [];

/** `performance.now()` value at the start of the previous frame (ms). */
let _lastTrailTime = null;

// ---------------------------------------------------------------------------
// Plume state — sine-wave engine plumes
// ---------------------------------------------------------------------------

/** Per-engine plume animation state. @type {Map<string, { phase: number }>} */
let _plumeStates = new Map();

/** Number of sample points per plume edge. */
const PLUME_SEGMENTS = 18;

/** Sine phase advance rate (radians/second) for liquid engines. */
const PLUME_PHASE_RATE_LIQUID = 18;

/** Sine phase advance rate (radians/second) for SRBs (more turbulent). */
const PLUME_PHASE_RATE_SRB = 25;

// ---------------------------------------------------------------------------
// Camera state — world-space centre of the viewport
// ---------------------------------------------------------------------------

/** Rate at which the CoM offset decays (metres per second). */
const CAM_OFFSET_DECAY_RATE = 2.0;

/** World X (metres) the camera is centred on. */
let _camWorldX = 0;

/** World Y (metres) the camera is centred on. */
let _camWorldY = 0;

/** Timestamp of the last camera update (ms), used to compute dt. */
let _lastCamTime = null;

/** When true, the camera snaps instantly to target on the next update. */
let _camSnap = true;

/** Previous frame's camera target X (metres), for detecting CoM jumps. */
let _prevTargetX = null;

/** Previous frame's camera target Y (metres), for detecting CoM jumps. */
let _prevTargetY = null;

/** Residual offset X (metres) — absorbs CoM jumps, decays toward zero. */
let _camOffsetX = 0;

/** Residual offset Y (metres) — absorbs CoM jumps, decays toward zero. */
let _camOffsetY = 0;

// ---------------------------------------------------------------------------
// Zoom state
// ---------------------------------------------------------------------------

/** Current zoom level. 1.0 = default; range [MIN_ZOOM, MAX_ZOOM]. */
let _zoomLevel = 1.0;

/** Last known mouse X position (CSS pixels), for cursor-centred zoom. */
let _mouseX = 0;

/** Last known mouse Y position (CSS pixels), for cursor-centred zoom. */
let _mouseY = 0;

/** Bound wheel event handler, stored for removal on destroy. @type {((e: WheelEvent) => void)|null} */
let _wheelHandler = null;

/** Bound mousemove event handler, stored for removal on destroy. @type {((e: MouseEvent) => void)|null} */
let _mouseMoveHandler = null;

/**
 * When false, flight-specific input handlers (wheel zoom, mouse tracking)
 * are ignored.  Used by the map view to prevent conflicting scroll zoom.
 */
let _inputEnabled = true;

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

// ---------------------------------------------------------------------------
// Plume helpers — sine-wave engine plume rendering
// ---------------------------------------------------------------------------

/**
 * Return outer/mid/core plume colours interpolated by atmospheric density.
 * @param {boolean} isSRB
 * @param {number}  densityRatio  0 = vacuum, 1 = sea level.
 * @returns {{ outer: number, mid: number, core: number }}
 */
function _plumeColors(isSRB, densityRatio) {
  if (isSRB) {
    return {
      outer: _lerpColor(0xff5500, 0xff3300, densityRatio),
      mid:   _lerpColor(0xff8833, 0xff6600, densityRatio),
      core:  _lerpColor(0xffffaa, 0xffff88, densityRatio),
    };
  }
  return {
    outer: _lerpColor(0xff6020, 0xff4400, densityRatio),
    mid:   _lerpColor(0xffaa40, 0xff8800, densityRatio),
    core:  _lerpColor(0xffffff, 0xffffcc, densityRatio),
  };
}

/**
 * Compute plume geometry parameters from engine definition and conditions.
 * @param {import('../data/parts.js').PartDef} def
 * @param {number} effectiveThrottle  0-1
 * @param {number} densityRatio       0 = vacuum, 1 = sea level
 * @param {{ phase: number }} plumeState
 * @returns {object}
 */
function _computePlumeParams(def, effectiveThrottle, densityRatio, plumeState) {
  const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;
  const thrustKN = def.properties?.thrust ?? 60;

  // Engine size factor (independent of throttle — same nozzle regardless).
  const sizeFactor = thrustKN / 120; // ~0.5 for Spark, ~3 for heavy SRB

  // Throttle affects length: ranges from 40% at idle to 100% at full.
  const throttleLengthScale = 0.4 + 0.6 * effectiveThrottle;

  // Atmospheric mapping.
  const lengthMult = 1.0 + 4.0 * (1 - densityRatio);
  const baseWMult  = 0.8 + 1.0 * (1 - densityRatio);
  const tipRatio   = 0.1 + 0.6 * (1 - densityRatio);

  // Width is based on engine size only — the nozzle doesn't change.
  const baseWidthM = 0.3 * sizeFactor;

  // Length scales with both engine size and throttle.
  const baseLengthM = 1.5 * sizeFactor * throttleLengthScale;

  const length    = baseLengthM * lengthMult;
  const baseWidth = baseWidthM * baseWMult;
  const tipWidth  = baseWidth * tipRatio;

  const sineFreq = isSRB ? 5.0 : 3.5;
  const sineAmp  = baseWidth * (isSRB ? 0.15 : 0.10);

  const diamondCount = Math.round(5 * densityRatio);
  const diamondAlpha = 0.7 * densityRatio;

  return {
    length, baseWidth, tipWidth,
    sineFreq, sineAmp,
    phase: plumeState.phase,
    diamondCount, diamondAlpha,
    isSRB,
    throttle: effectiveThrottle,
    densityRatio,
  };
}

/**
 * Draw a sine-wave plume polygon path into a Graphics object.
 * The plume centerline curves from the thrust axis at the nozzle toward
 * the bend direction at the tip, simulating velocity-induced plume bending.
 *
 * @param {PIXI.Graphics} g
 * @param {number} nsx        Nozzle screen X.
 * @param {number} nsy        Nozzle screen Y.
 * @param {number} exDirX     Exhaust direction X (screen space, unit-ish).
 * @param {number} exDirY     Exhaust direction Y (screen space, unit-ish).
 * @param {number} bendX      Bend offset X at tip (screen pixels).
 * @param {number} bendY      Bend offset Y at tip (screen pixels).
 * @param {number} pLength    Plume length in screen pixels.
 * @param {number} pBaseW     Base half-width in screen pixels.
 * @param {number} pTipW      Tip half-width in screen pixels.
 * @param {number} sineAmpPx  Sine amplitude in screen pixels.
 * @param {number} sineFreq   Sine frequency (cycles per plume length).
 * @param {number} phase      Sine phase offset.
 * @param {number} segs       Number of segments per edge.
 */
function _drawPlumePath(g, nsx, nsy, exDirX, exDirY, bendX, bendY, pLength, pBaseW, pTipW, sineAmpPx, sineFreq, phase, segs) {
  // For each sample point at parameter t (0=nozzle, 1=tip):
  //   centerline = nozzle + exDir * t * length + bend * t²
  //   The t² gives a smooth curve — no bend at nozzle, full bend at tip.
  //   Perpendicular is computed from the local tangent direction.

  // Helper: compute centerline point and local perpendicular at parameter t.
  function _sample(t) {
    const t2 = t * t;
    const cx = nsx + exDirX * t * pLength + bendX * t2;
    const cy = nsy + exDirY * t * pLength + bendY * t2;
    // Tangent = d/dt of centerline.
    const tx = exDirX * pLength + 2 * bendX * t;
    const ty = exDirY * pLength + 2 * bendY * t;
    const tLen = Math.hypot(tx, ty) || 1;
    // Perpendicular (rotated 90° CCW).
    const px = -ty / tLen;
    const py =  tx / tLen;
    return { cx, cy, px, py };
  }

  // Left edge: nozzle → tip.
  {
    const s = _sample(0);
    const hw = pBaseW + Math.sin(phase) * sineAmpPx;
    g.moveTo(s.cx - s.px * hw, s.cy - s.py * hw);
  }
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const s = _sample(t);
    const envHW = pBaseW + (pTipW - pBaseW) * t;
    const sine  = Math.sin(t * sineFreq * Math.PI * 2 + phase) * sineAmpPx * (1 - t * 0.5);
    const hw = envHW + sine;
    g.lineTo(s.cx - s.px * hw, s.cy - s.py * hw);
  }

  // Right edge: tip → nozzle (offset phase for asymmetry).
  const phaseR = phase + 1.3;
  for (let i = segs; i >= 0; i--) {
    const t = i / segs;
    const s = _sample(t);
    const envHW = pBaseW + (pTipW - pBaseW) * t;
    const sine  = Math.sin(t * sineFreq * Math.PI * 2 + phaseR) * sineAmpPx * (1 - t * 0.5);
    const hw = envHW + sine;
    g.lineTo(s.cx + s.px * hw, s.cy + s.py * hw);
  }

  g.closePath();
}

/**
 * Update per-engine plume animation state (create/remove/advance phase).
 * @param {import('../core/physics.js').PhysicsState} ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @param {number} dt  Frame delta in seconds.
 */
function _updatePlumeStates(ps, assembly, dt) {
  // Collect currently-firing engine instance IDs.
  const firingEngines = new Set();
  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const isEngine = def.type === PartType.ENGINE || def.type === PartType.SOLID_ROCKET_BOOSTER;
    if (!isEngine) continue;
    const isFiring = ps.firingEngines && ps.firingEngines.has(instanceId);
    const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;
    const effectiveThrottle = isFiring ? (isSRB ? 1 : (ps.throttle ?? 0)) : 0;
    if (effectiveThrottle <= 0) continue;

    firingEngines.add(instanceId);
    if (!_plumeStates.has(instanceId)) {
      _plumeStates.set(instanceId, { phase: Math.random() * Math.PI * 2 });
    }
    const state = _plumeStates.get(instanceId);
    const rate = isSRB ? PLUME_PHASE_RATE_SRB : PLUME_PHASE_RATE_LIQUID;
    state.phase += dt * rate;
  }

  // Remove entries for engines that stopped firing.
  for (const id of _plumeStates.keys()) {
    if (!firingEngines.has(id)) _plumeStates.delete(id);
  }
}

/**
 * Render sine-wave engine plumes for all firing engines.
 * @param {import('../core/physics.js').PhysicsState} ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @param {number} density  Air density at current altitude.
 * @param {number} w  Canvas width.
 * @param {number} h  Canvas height.
 */
function _renderPlumes(ps, assembly, density, w, h) {
  if (!_trailContainer || _plumeStates.size === 0) return;

  const ppm = _ppm();
  const densityRatio = Math.min(1, density / 1.225);
  const comWorld = _computeCoM(ps.fuelStore, assembly, ps.activeParts, 0, 0);
  const comBody  = { x: comWorld.x, y: comWorld.y };
  const segs = _zoomLevel < 0.3 ? 8 : PLUME_SEGMENTS;

  // Exhaust direction in screen space (opposite to rocket nose).
  // Nose in world = (sin(angle), cos(angle)).  Exhaust = negated.
  // World→screen flips Y, so exhaust screen = (-sin(angle), +cos(angle)).
  const exDirX = -Math.sin(ps.angle);
  const exDirY =  Math.cos(ps.angle);

  // Plume bends slightly when the rocket is turning (angular velocity).
  // The tip of the plume lags behind the rotation — bend perpendicular
  // to the exhaust axis in the direction opposite to the turn.
  // Perpendicular to exhaust in screen space: (-exDirY, exDirX).
  const angVel = ps.angularVelocity ?? 0;
  const bendMag = Math.min(1, Math.abs(angVel) * 2) * ppm * 2; // max 2m bend
  const bendSign = angVel > 0 ? -1 : 1; // bend opposite to rotation direction
  const bendX = -exDirY * bendSign * bendMag;
  const bendY =  exDirX * bendSign * bendMag;

  const g = new PIXI.Graphics();
  _trailContainer.addChild(g);

  for (const [instanceId, plumeState] of _plumeStates) {
    const placed = assembly.parts.get(instanceId);
    const def = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;
    const isFiring = ps.firingEngines && ps.firingEngines.has(instanceId);
    const effectiveThrottle = isFiring ? (isSRB ? 1 : (ps.throttle ?? 0)) : 0;
    if (effectiveThrottle <= 0) continue;

    // Nozzle world position.
    const nozzle = _nozzleWorldPos(ps, placed, def, comBody);
    const { sx: nsx, sy: nsy } = _worldToScreen(nozzle.x, nozzle.y, w, h);

    const params = _computePlumeParams(def, effectiveThrottle, densityRatio, plumeState);
    const colors = _plumeColors(isSRB, densityRatio);

    const lengthPx  = params.length * ppm;
    const baseHWPx  = (params.baseWidth / 2) * ppm;
    const tipHWPx   = (params.tipWidth / 2) * ppm;
    const sineAmpPx = params.sineAmp * ppm;

    // Layer 1: Outer glow.
    _drawPlumePath(g, nsx, nsy, exDirX, exDirY, bendX, bendY,
      lengthPx, baseHWPx, tipHWPx,
      sineAmpPx, params.sineFreq, params.phase, segs);
    g.fill({ color: colors.outer, alpha: 0.5 * effectiveThrottle });

    // Layer 2: Mid core (60% width, less sine).
    _drawPlumePath(g, nsx, nsy, exDirX, exDirY, bendX, bendY,
      lengthPx, baseHWPx * 0.6, tipHWPx * 0.6,
      sineAmpPx * 0.4, params.sineFreq, params.phase, segs);
    g.fill({ color: colors.mid, alpha: 0.7 * effectiveThrottle });

    // Layer 3: Inner core (25% width, no sine, 70% length).
    _drawPlumePath(g, nsx, nsy, exDirX, exDirY,
      bendX * 0.7, bendY * 0.7,  // less bend on core
      lengthPx * 0.7, baseHWPx * 0.25, tipHWPx * 0.15,
      0, params.sineFreq, params.phase, segs);
    g.fill({ color: colors.core, alpha: 0.9 * effectiveThrottle });

    // Shock diamonds — placed along the curved centerline.
    if (params.diamondCount > 0 && params.diamondAlpha > 0) {
      const spacing = lengthPx / (params.diamondCount + 1);
      for (let d = 1; d <= params.diamondCount; d++) {
        const t  = (d * spacing) / lengthPx;
        const t2 = t * t;
        const cx = nsx + exDirX * t * lengthPx + bendX * t2;
        const cy = nsy + exDirY * t * lengthPx + bendY * t2;
        const dw = (baseHWPx * 0.4 + (tipHWPx * 0.3 - baseHWPx * 0.4) * t);
        const dh = dw * 0.6;
        g.ellipse(cx, cy, Math.max(1, dw), Math.max(1, dh));
        g.fill({ color: 0xeeeeff, alpha: params.diamondAlpha * (1 - t * 0.5) * effectiveThrottle });
      }
    }
  }
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
 * Return the effective pixels-per-metre for the current zoom level.
 * @returns {number}
 */
function _ppm() {
  return FLIGHT_PIXELS_PER_METRE * _zoomLevel;
}

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
  const ppm = _ppm();
  return {
    sx: screenW / 2 + (worldX - _camWorldX) * ppm,
    sy: screenH / 2 - (worldY - _camWorldY) * ppm,
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
  // Determine target position and its reference origin (rocket or debris).
  let targetX, targetY;
  let refX, refY;

  if (_hasCommandModule(ps.activeParts, assembly)) {
    const com = _computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
    targetX = com.x;
    targetY = com.y;
    refX = ps.posX;
    refY = ps.posY;
  } else {
    // Search debris fragments for the one containing the command module.
    let found = false;
    for (const debris of ps.debris) {
      if (_hasCommandModule(debris.activeParts, assembly)) {
        const com = _computeCoM(debris.fuelStore, assembly, debris.activeParts, debris.posX, debris.posY);
        targetX = com.x;
        targetY = com.y;
        refX = debris.posX;
        refY = debris.posY;
        found = true;
        break;
      }
    }
    if (!found) {
      targetX = ps.posX;
      targetY = ps.posY;
      refX = ps.posX;
      refY = ps.posY;
    }
  }

  // Detect CoM jumps relative to the rocket body (not world position).
  // This ignores rocket velocity and only fires on structural changes like
  // staging or sudden fuel shifts.
  const relX = targetX - refX;
  const relY = targetY - refY;
  if (_prevTargetX !== null) {
    const jumpX = relX - _prevTargetX;
    const jumpY = relY - _prevTargetY;
    if (Math.abs(jumpX) > 0.05 || Math.abs(jumpY) > 0.05) {
      _camOffsetX -= jumpX;
      _camOffsetY -= jumpY;
    }
  }

  _prevTargetX = relX;
  _prevTargetY = relY;

  // Compute dt from wall-clock time.
  const now = performance.now();
  const dt  = _lastCamTime !== null ? (now - _lastCamTime) / 1000 : 0;
  _lastCamTime = now;

  // Decay the offset toward zero at a fixed rate (metres/s).
  if (_camOffsetX !== 0 || _camOffsetY !== 0) {
    const decay = CAM_OFFSET_DECAY_RATE * dt;
    const dist  = Math.sqrt(_camOffsetX * _camOffsetX + _camOffsetY * _camOffsetY);
    if (dist <= decay) {
      _camOffsetX = 0;
      _camOffsetY = 0;
    } else {
      const ratio = decay / dist;
      _camOffsetX -= _camOffsetX * ratio;
      _camOffsetY -= _camOffsetY * ratio;
    }
  }

  if (_camSnap || dt === 0) {
    _camWorldX  = targetX;
    _camWorldY  = targetY;
    _camSnap    = false;
    _camOffsetX = 0;
    _camOffsetY = 0;
  } else {
    // Always snap to target — no lag. Offset provides smooth CoM transitions.
    _camWorldX = targetX + _camOffsetX;
    _camWorldY = targetY + _camOffsetY;
  }
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
  const groundScreenY = h / 2 + _camWorldY * _ppm();

  // Only draw if the ground line is above the canvas bottom edge.
  if (groundScreenY >= h) return;

  const drawY = Math.max(0, groundScreenY);
  const drawH = h - drawY;
  _groundGraphics.rect(0, drawY, w, drawH);
  _groundGraphics.fill({ color: GROUND_COLOR });
}

// ---------------------------------------------------------------------------
// Biome label rendering
// ---------------------------------------------------------------------------

/** Rate at which the biome label fades in/out (per second). */
const BIOME_LABEL_FADE_SPEED = 3.0;

// ---------------------------------------------------------------------------
// Docking target rendering
// ---------------------------------------------------------------------------

/** Graphics object for the docking target marker. @type {PIXI.Graphics|null} */
let _dockingTargetGfx = null;

/**
 * Render a docking target marker when the craft is in docking/RCS mode
 * and has a docking target selected.
 *
 * Shows a simple diamond-shaped marker with a distance indicator at the
 * target's estimated position relative to the craft.
 */
function _renderDockingTarget(ps, w, h) {
  if (!_rocketContainer) return;

  // Lazy-create the graphics object.
  if (!_dockingTargetGfx) {
    _dockingTargetGfx = new PIXI.Graphics();
    // Insert it behind the rocket container but above debris.
    const app = getApp();
    const rocketIdx = app.stage.getChildIndex(_rocketContainer);
    app.stage.addChildAt(_dockingTargetGfx, rocketIdx);
  }

  _dockingTargetGfx.clear();

  // Only render when in docking/RCS mode.
  if (ps.controlMode !== ControlMode.DOCKING && ps.controlMode !== ControlMode.RCS) {
    return;
  }

  // Check for docking port states — if any are extended or docked, show target.
  let hasDockingActivity = false;
  if (ps.dockingPortStates) {
    for (const [, portState] of ps.dockingPortStates) {
      if (portState === 'extended' || portState === 'docked') {
        hasDockingActivity = true;
        break;
      }
    }
  }

  if (!hasDockingActivity) return;

  // Place the target marker at the docking offset position.
  // In docking mode, the target is at (dockingOffsetAlongTrack, dockingOffsetRadial)
  // relative to the craft's base orbit position.
  const offsetX = ps.dockingOffsetAlongTrack || 0;
  const offsetY = ps.dockingOffsetRadial || 0;

  // Only show if there's a meaningful offset (target selected).
  if (Math.abs(offsetX) < 0.1 && Math.abs(offsetY) < 0.1) return;

  // Convert the offset to screen coordinates.
  // The craft is at the camera centre; the target is offset from that.
  const ppm = FLIGHT_PIXELS_PER_METRE * (_zoomLevel || 1.0);
  const centerX = w / 2;
  const centerY = h / 2;

  // Target screen position (along-track is horizontal, radial is vertical).
  const targetSX = centerX + offsetX * ppm;
  const targetSY = centerY - offsetY * ppm;

  // Clamp to screen bounds with margin.
  const margin = 40;
  const clampedX = Math.max(margin, Math.min(w - margin, targetSX));
  const clampedY = Math.max(margin, Math.min(h - margin, targetSY));
  const isOffScreen = clampedX !== targetSX || clampedY !== targetSY;

  const g = _dockingTargetGfx;

  if (isOffScreen) {
    // Off-screen indicator: arrow pointing toward target.
    g.beginFill(0x00ccff, 0.7);
    g.drawCircle(clampedX, clampedY, 8);
    g.endFill();
  } else {
    // On-screen: diamond crosshair.
    const size = 16;
    g.lineStyle(2, 0x00ccff, 0.9);

    // Diamond shape.
    g.moveTo(targetSX, targetSY - size);
    g.lineTo(targetSX + size, targetSY);
    g.lineTo(targetSX, targetSY + size);
    g.lineTo(targetSX - size, targetSY);
    g.closePath();

    // Inner crosshair.
    const inner = size * 0.4;
    g.moveTo(targetSX - inner, targetSY);
    g.lineTo(targetSX + inner, targetSY);
    g.moveTo(targetSX, targetSY - inner);
    g.lineTo(targetSX, targetSY + inner);

    // Docked indicator: filled green circle.
    for (const [, portState] of (ps.dockingPortStates || new Map())) {
      if (portState === 'docked') {
        g.lineStyle(0);
        g.beginFill(0x44ff44, 0.6);
        g.drawCircle(targetSX, targetSY, 6);
        g.endFill();
        break;
      }
    }
  }
}

/**
 * Render the current biome name as a centered label at the top of the screen.
 * Fades in when entering a new biome and fades out when near a boundary.
 *
 * @param {number} altitude  Current altitude in metres.
 * @param {number} w         Canvas width.
 * @param {number} h         Canvas height.
 * @param {number} dt        Delta time in seconds.
 */
function _renderBiomeLabel(altitude, w, h, dt) {
  if (!_biomeLabelContainer) return;

  // Clear previous frame's label.
  while (_biomeLabelContainer.children.length) _biomeLabelContainer.removeChildAt(0);

  const biome = getBiome(altitude, 'EARTH');
  if (!biome) return;

  const transition = getBiomeTransition(altitude, 'EARTH');

  // Determine the display name and target alpha.
  let displayName = biome.name;
  let targetAlpha = 1.0;

  if (transition) {
    // Near a boundary — cross-fade based on ratio.
    // When ratio < 0.5, we're mostly in the 'from' biome; > 0.5, mostly in 'to'.
    if (transition.ratio < 0.5) {
      displayName = transition.from.name;
      // Fade out as we approach the boundary (ratio → 0.5).
      targetAlpha = 1.0 - (transition.ratio / 0.5);
    } else {
      displayName = transition.to.name;
      // Fade in as we move into the new biome (ratio → 1.0).
      targetAlpha = (transition.ratio - 0.5) / 0.5;
    }
  }

  // Detect biome name change and reset alpha for a smooth pop-in.
  if (displayName !== _currentBiomeName) {
    _currentBiomeName = displayName;
    _biomeLabelAlpha = 0;
  }

  // Animate alpha toward target.
  if (_biomeLabelAlpha < targetAlpha) {
    _biomeLabelAlpha = Math.min(targetAlpha, _biomeLabelAlpha + BIOME_LABEL_FADE_SPEED * dt);
  } else if (_biomeLabelAlpha > targetAlpha) {
    _biomeLabelAlpha = Math.max(targetAlpha, _biomeLabelAlpha - BIOME_LABEL_FADE_SPEED * dt);
  }

  if (_biomeLabelAlpha <= 0.01) return;

  // Draw the biome name and altitude-formatted science multiplier.
  const multiplierText = `${biome.scienceMultiplier}× Science`;
  const label = new PIXI.Text({
    text: displayName,
    style: new PIXI.TextStyle({
      fill: '#a8e8c0',
      fontSize: 16,
      fontFamily: 'system-ui, sans-serif',
      fontWeight: 'bold',
      dropShadow: true,
      dropShadowColor: '#000000',
      dropShadowBlur: 4,
      dropShadowDistance: 1,
    }),
  });
  label.anchor.set(0.5, 0);
  label.x = w / 2;
  label.y = 70;
  label.alpha = _biomeLabelAlpha * 0.85;

  const subLabel = new PIXI.Text({
    text: multiplierText,
    style: new PIXI.TextStyle({
      fill: '#70b880',
      fontSize: 11,
      fontFamily: 'system-ui, sans-serif',
      dropShadow: true,
      dropShadowColor: '#000000',
      dropShadowBlur: 3,
      dropShadowDistance: 1,
    }),
  });
  subLabel.anchor.set(0.5, 0);
  subLabel.x = w / 2;
  subLabel.y = 90;
  subLabel.alpha = _biomeLabelAlpha * 0.65;

  _biomeLabelContainer.addChild(label);
  _biomeLabelContainer.addChild(subLabel);
}

// ---------------------------------------------------------------------------
// Horizon curvature rendering
// ---------------------------------------------------------------------------

/**
 * Render a curved horizon effect.  At ground level the horizon is flat; by
 * 40 km the curvature is perceptible; in orbit it is clearly curved.
 *
 * The effect is drawn as an arc where the radius is proportional to the body's
 * actual radius, scaled down so that the curvature becomes visible at sensible
 * altitudes for gameplay.
 *
 * @param {number} altitude  Camera altitude in metres.
 * @param {number} w         Canvas width.
 * @param {number} h         Canvas height.
 */
function _renderHorizon(altitude, w, h) {
  if (!_horizonGraphics) return;
  _horizonGraphics.clear();

  // Ground screen Y for a flat world (used to position the curvature centre).
  const groundScreenY = h / 2 + _camWorldY * _ppm();

  // Only draw curvature when ground is potentially visible (within 2× canvas height).
  if (groundScreenY < -h) return;

  // Curvature factor: 0 at ground, ramps up through atmosphere, strong in orbit.
  // We use a perceptual scaling: at 40 km the curvature starts being visible,
  // at 100 km+ it is very clear.
  const curvatureStart = 5_000;   // metres — curvature begins to appear
  const curvatureFull  = 200_000; // metres — full curvature effect

  if (altitude < curvatureStart) return; // No curvature effect at low altitude.

  const t = Math.min(1, (altitude - curvatureStart) / (curvatureFull - curvatureStart));

  // The apparent radius of the horizon arc on screen.
  // At full curvature, the arc radius is ~2× canvas width (clearly curved).
  // At minimum, it is ~50× canvas width (barely perceptible).
  const minRadius = w * 50;
  const maxRadius = w * 1.5;
  const arcRadius = minRadius + (maxRadius - minRadius) * (t * t); // ease-in for smooth appearance

  // Arc centre: directly below the camera, at (w/2, groundScreenY + arcRadius).
  const cx = w / 2;
  const cy = groundScreenY + arcRadius;

  // Draw a filled arc for the ground with curvature.
  // The arc spans wide enough to cover the full canvas width plus overshoot.
  const halfAngle = Math.asin(Math.min(1, (w * 0.6) / arcRadius));

  _horizonGraphics.moveTo(0, h);
  _horizonGraphics.arc(cx, cy, arcRadius, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
  _horizonGraphics.lineTo(w, h);
  _horizonGraphics.closePath();
  _horizonGraphics.fill({ color: GROUND_COLOR });

  // Atmospheric glow along the curved horizon edge — a thin gradient line.
  if (altitude > 30_000) {
    const glowAlpha = Math.min(0.5, t * 0.6);
    const glowWidth = 2 + t * 3; // pixels
    _horizonGraphics.arc(cx, cy, arcRadius - glowWidth, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
    _horizonGraphics.stroke({ width: glowWidth, color: 0x4488cc, alpha: glowAlpha });
  }
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
 * Draw pulsing warning overlays on all parts with active malfunctions.
 *
 * A translucent red-orange rectangle is drawn over each malfunctioning part,
 * with a pulsing alpha based on the current time (sine wave, ~2 Hz).
 *
 * @param {PIXI.Graphics}                                    g
 * @param {import('../core/physics.js').PhysicsState}        ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 */
function _drawMalfunctionOverlays(g, ps, assembly) {
  if (!ps.malfunctions || ps.malfunctions.size === 0) return;

  // Pulsing alpha: oscillates between 0.15 and 0.45 at ~2 Hz.
  const pulse = 0.30 + 0.15 * Math.sin(Date.now() * 0.012);

  for (const [instanceId, entry] of ps.malfunctions) {
    if (entry.recovered) continue;
    if (!ps.activeParts.has(instanceId)) continue;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const lx = placed.x;
    const ly = -placed.y;
    const pw = def.width  ?? 40;
    const ph = def.height ?? 20;

    // Red-orange warning overlay.
    g.rect(lx - pw / 2, ly - ph / 2, pw, ph);
    g.fill({ color: 0xff4422, alpha: pulse });
    g.stroke({ color: 0xff6633, width: 2, alpha: pulse + 0.2 });

    // Small warning triangle indicator at top-right corner.
    const tx = lx + pw / 2 - 3;
    const ty = ly - ph / 2 + 2;
    g.moveTo(tx, ty);
    g.lineTo(tx + 5, ty + 8);
    g.lineTo(tx - 5, ty + 8);
    g.closePath();
    g.fill({ color: 0xffaa00, alpha: 0.9 });
  }
}

/**
 * Determine which side of the rocket a landing leg is attached to by
 * inspecting the assembly's connection graph.  Returns +1 for right-side
 * legs and -1 for left-side legs.
 *
 * @param {import('../core/rocketbuilder.js').PlacedPart}    placed
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {number}  +1 (right) or -1 (left).
 */
function _getLegSide(placed, assembly) {
  if (assembly?.connections) {
    for (const conn of assembly.connections) {
      let parentInstanceId, parentSnapIndex;
      if (conn.fromInstanceId === placed.instanceId) {
        parentInstanceId = conn.toInstanceId;
        parentSnapIndex  = conn.toSnapIndex;
      } else if (conn.toInstanceId === placed.instanceId) {
        parentInstanceId = conn.fromInstanceId;
        parentSnapIndex  = conn.fromSnapIndex;
      } else {
        continue;
      }
      const parentPlaced = assembly.parts.get(parentInstanceId);
      if (!parentPlaced) continue;
      const parentDef = getPartById(parentPlaced.partId);
      if (!parentDef) continue;
      const snap = parentDef.snapPoints[parentSnapIndex];
      if (snap) {
        if (snap.side === 'left')  return -1;
        if (snap.side === 'right') return  1;
      }
    }
  }
  // Fallback: use the leg's X position relative to centre (debris edge case).
  return (placed.x >= 0) ? 1 : -1;
}

/**
 * Draw a landing leg with state-aware deployment animation.
 *
 * Retracted: narrow rectangle flush against the rocket body.
 * Deploying: struts interpolating outward/downward over LEG_DEPLOY_DURATION.
 * Deployed:  angled struts extending below and outward with a foot pad.
 *
 * @param {PIXI.Graphics}                                    g
 * @param {import('../core/rocketbuilder.js').PlacedPart}     placed
 * @param {import('../data/parts.js').PartDef}                def
 * @param {object}                                            ps      PhysicsState or debris object (needs legStates).
 * @param {number}                                            [alpha=1]
 */
function _drawLandingLeg(g, placed, def, ps, assembly, alpha = 1) {
  const lx = placed.x;
  const ly = -placed.y;
  const pw = def.width  ?? 40;
  const ph = def.height ?? 20;

  const fill   = PART_FILL[def.type]   ?? 0x0e2040;
  const stroke = PART_STROKE[def.type] ?? 0x2060a0;

  // Determine which side of the rocket this leg is on via connection graph.
  const side = _getLegSide(placed, assembly);

  // Get deployment progress via shared helper.
  const { dx, dy, t } = getDeployedLegFootOffset(placed.instanceId, def, ps.legStates);

  // --- Housing rectangle (always drawn at attachment point) ---
  const housingW = pw * 0.5;
  const housingH = ph * 0.4;
  g.rect(lx - housingW / 2, ly - housingH / 2, housingW, housingH);
  g.fill({ color: fill, alpha });
  g.stroke({ color: stroke, width: 1, alpha });

  // --- Foot point (interpolated) ---
  const footX = lx + dx * side;
  const footY = ly + dy;

  // Upper strut: from top of housing to foot.
  const upperStartX = lx;
  const upperStartY = ly - ph / 4;
  g.moveTo(upperStartX, upperStartY);
  g.lineTo(footX, footY);
  g.stroke({ color: stroke, width: 2, alpha });

  // Lower strut: from bottom of housing to foot.
  const lowerStartX = lx;
  const lowerStartY = ly + ph / 4;
  g.moveTo(lowerStartX, lowerStartY);
  g.lineTo(footX, footY);
  g.stroke({ color: stroke, width: 2, alpha });

  // --- Foot pad (horizontal line at foot, visible when deploying/deployed) ---
  if (t > 0) {
    const padHalf = pw * 0.3 * t;
    g.moveTo(footX - padHalf, footY);
    g.lineTo(footX + padHalf, footY);
    g.stroke({ color: stroke, width: 3, alpha });
  }
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
      fill:       '#c0ddf0',
      fontSize:   48,
      fontFamily: 'Courier New, Courier, monospace',
      fontWeight: 'bold',
    }),
  });
  label.anchor.set(0.5, 0.5);
  label.x     = placed.x;
  label.y     = -placed.y;
  // Counteract the container's zoom scale so text stays a fixed screen size,
  // while the high-res texture keeps it crisp.
  const containerScale = _ppm() * SCALE_M_PER_PX;
  label.scale.set(10 / 48 / containerScale);
  label.alpha = alpha;
  return label;
}

// ---------------------------------------------------------------------------
// Parachute canopy rendering
// ---------------------------------------------------------------------------

/**
 * Draw a deployed-canopy above every deploying or deployed PARACHUTE part.
 *
 * The canopy swings independently from the rocket — it has its own
 * `canopyAngle` that springs toward upright.  Drawn in world space into
 * `_canopyContainer` (not the rotated rocket container).
 *
 * @param {import('../core/physics.js').PhysicsState}          ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}  assembly
 * @param {number}                                              w  Canvas width.
 * @param {number}                                              h  Canvas height.
 */
function _drawParachuteCanopies(ps, assembly, w, h) {
  if (!_canopyContainer) return;

  // Clear previous frame's canopy graphics.
  while (_canopyContainer.children.length) _canopyContainer.removeChildAt(0);

  const ppm = _ppm();
  const rocketAngle = ps.angle;
  const cosR = Math.cos(rocketAngle);
  const sinR = Math.sin(rocketAngle);

  // The rocket container has a pivot offset (CoM or tipping contact).
  // We need the same transform: local → world → screen.
  // Local part coords are in VAB pixels (Y-down for screen).
  // placed.x, placed.y are VAB coords (Y-up).
  // In local screen space: lx = placed.x, ly = -(placed.y).

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def || def.type !== PartType.PARACHUTE) continue;

    const entry = ps.parachuteStates?.get(instanceId);
    if (!entry || entry.state === 'packed' || entry.state === 'failed') continue;

    // Deployment progress 0 → 1.
    const progress = entry.state === 'deployed'
      ? 1
      : Math.max(0, Math.min(1, 1 - entry.deployTimer / DEPLOY_DURATION));

    if (progress <= 0) continue;

    const props = def.properties ?? {};
    const canopyAngle = entry.canopyAngle ?? 0;

    // Stowed width (local pixels) → deployed diameter (local pixels).
    const stowedW    = def.width ?? 20;
    const deployedW  = (props.deployedDiameter ?? 10) / SCALE_M_PER_PX;
    const currentW   = stowedW + (deployedW - stowedW) * progress;
    const halfW      = currentW / 2;

    // Canopy dome height is 35 % of its width — flat hemispherical profile.
    const halfH = halfW * 0.35;

    const stowedHalfH = (def.height ?? 10) / 2;

    // --- Stowed part top in local container space (Y-down) ---
    const stowedTopLX = placed.x;
    const stowedTopLY = -(placed.y + stowedHalfH);

    // --- Transform stowed top to world coords ---
    // Local → world (metres): rotate by rocketAngle, scale by SCALE_M_PER_PX, add rocket pos.
    const stowedWorldX = ps.posX + (stowedTopLX * cosR - stowedTopLY * sinR) * SCALE_M_PER_PX;
    const stowedWorldY = ps.posY - (stowedTopLX * sinR + stowedTopLY * cosR) * SCALE_M_PER_PX;

    // --- Canopy centre in world coords (offset along canopyAngle direction) ---
    // The canopy sits one halfH (in local pixels) above the stowed top, but rotated
    // by canopyAngle instead of rocketAngle.
    const canopyOffsetM = halfH * SCALE_M_PER_PX;
    const cosC = Math.cos(canopyAngle);
    const sinC = Math.sin(canopyAngle);
    // "Above" in canopy frame means along the -Y direction in the canopy's rotated frame.
    // In world coords, the canopy's up direction is (-sinC, cosC).
    const canopyWorldX = stowedWorldX - sinC * canopyOffsetM;
    const canopyWorldY = stowedWorldY + cosC * canopyOffsetM;

    // --- Convert world → screen ---
    const { sx: canopySX, sy: canopySY } = _worldToScreen(canopyWorldX, canopyWorldY, w, h);
    const { sx: stowedSX, sy: stowedSY } = _worldToScreen(stowedWorldX, stowedWorldY, w, h);

    // Scale the canopy dimensions from local pixels to screen pixels.
    const scale = ppm * SCALE_M_PER_PX;
    const sHalfW = halfW * scale;
    const sHalfH = halfH * scale;

    const alpha = Math.min(1, progress);
    const cg = new PIXI.Graphics();

    // Draw canopy ellipse rotated by canopyAngle.
    // PixiJS Graphics has no save/translate/rotate — use the display object transform.
    cg.position.set(canopySX, canopySY);
    cg.rotation = canopyAngle;
    cg.ellipse(0, 0, sHalfW, sHalfH);
    cg.fill({ color: 0x6020a8, alpha: 0.55 * alpha });
    cg.stroke({ color: 0xc070ff, width: 1, alpha: 0.85 * alpha });

    // Rigging lines in a separate untransformed Graphics (screen-space coords).
    const cordAlpha = 0.6 * alpha;
    const cordInset = (stowedW * 0.25) * scale;

    // Stowed attachment points (inset from edges, in rocket-rotated frame).
    const stowedLeftX  = stowedSX + cosR * (-cordInset);
    const stowedLeftY  = stowedSY + sinR * (-cordInset);
    const stowedRightX = stowedSX + cosR * cordInset;
    const stowedRightY = stowedSY + sinR * cordInset;

    // Canopy edge points (in canopy-rotated frame).
    const canopyLeftX  = canopySX + cosC * (-sHalfW) - sinC * sHalfH;
    const canopyLeftY  = canopySY + sinC * (-sHalfW) + cosC * sHalfH;
    const canopyRightX = canopySX + cosC * sHalfW    - sinC * sHalfH;
    const canopyRightY = canopySY + sinC * sHalfW    + cosC * sHalfH;

    const cordGfx = new PIXI.Graphics();
    cordGfx.moveTo(stowedLeftX, stowedLeftY);
    cordGfx.lineTo(canopyLeftX, canopyLeftY);
    cordGfx.stroke({ color: 0xc070ff, width: 0.8, alpha: cordAlpha });

    cordGfx.moveTo(stowedRightX, stowedRightY);
    cordGfx.lineTo(canopyRightX, canopyRightY);
    cordGfx.stroke({ color: 0xc070ff, width: 0.8, alpha: cordAlpha });

    _canopyContainer.addChild(cg);
    _canopyContainer.addChild(cordGfx);
  }
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

  // Compute the centre of mass in local container space (VAB pixels, Y-down).
  // This is used to set the rotation pivot so the rocket spins around its CoM
  // rather than the reference origin at the base.
  const com       = _computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
  const comLocalX =  (com.x - ps.posX) / SCALE_M_PER_PX;  // local X offset (pixels)
  const comLocalY = -(com.y - ps.posY) / SCALE_M_PER_PX;  // local Y offset (Y-down)

  // When on the ground (grounded or landed), shift the container so the lowest
  // active part's bottom edge sits exactly on the ground line.
  // lowestPartBottomPx is in VAB-pixel / local space.
  let lowestPartBottomPx = 0;
  if (ps.grounded || ps.landed) {
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      let bottom = placed.y - (def.height ?? 40) / 2;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        const footVabY = placed.y - dy;
        if (footVabY < bottom) bottom = footVabY;
      }
      if (bottom < lowestPartBottomPx) lowestPartBottomPx = bottom;
    }
  }

  const { sx, sy } = _worldToScreen(ps.posX, ps.posY, w, h);
  const scale = _ppm() * SCALE_M_PER_PX;

  _rocketContainer.scale.set(scale);

  // When tipping on the ground, rotate around the contact point (base corner)
  // instead of the centre of mass so the rocket visually tips from its base.
  // The physics provides a rotation-aware contact point that tracks the actual
  // lowest corner at the current angle, so we pin it to the ground directly.
  if ((ps.grounded || ps.landed) && ps.isTipping) {
    // Contact point in container-local coords (Y-down screen convention).
    const pivotX =  ps.tippingContactX;
    const pivotY = -ps.tippingContactY;
    const cosA = Math.cos(ps.angle);
    const sinA = Math.sin(ps.angle);

    _rocketContainer.pivot.set(pivotX, pivotY);

    // The contact's world-X position accounts for Y-up clockwise rotation:
    //   contactWorldX = posX + (lx·cosA + ly·sinA) · SCALE
    _rocketContainer.x = sx + (ps.tippingContactX * cosA + ps.tippingContactY * sinA) * scale;

    // Compute how far below the pivot the visual bottom of the rotated rocket
    // extends (the "drop"), then offset container.y so the visual bottom sits
    // at the ground line (sy) instead of the pivot.
    let maxDrop = 0;
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      const hw = (def.width  ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      let effHW = hw, effBottomH = hh;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        effHW = Math.max(hw, dx);
        effBottomH = Math.max(hh, dy);
      }
      const corners = [
        [placed.x - effHW, placed.y - effBottomH],
        [placed.x + effHW, placed.y - effBottomH],
        [placed.x - effHW, placed.y + hh],
        [placed.x + effHW, placed.y + hh],
      ];
      for (const [cx, cy] of corners) {
        // Screen-Y offset from pivot (positive = below pivot on screen).
        const drop = (cx - ps.tippingContactX) * sinA
                   + (ps.tippingContactY - cy) * cosA;
        if (drop > maxDrop) maxDrop = drop;
      }
    }
    _rocketContainer.y = sy - maxDrop * scale;
  } else {
    // Normal mode: rotate around CoM.
    _rocketContainer.pivot.set(comLocalX, comLocalY);
    _rocketContainer.x        = sx + comLocalX * scale;
    _rocketContainer.y        = sy + (lowestPartBottomPx + comLocalY) * scale;
  }
  _rocketContainer.rotation = ps.angle;

  // Batch all part rectangles into a single Graphics object.
  const g = new PIXI.Graphics();
  _rocketContainer.addChild(g);

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      _drawLandingLeg(g, placed, def, ps, assembly, 0.9);
    } else {
      _drawPartRect(g, placed, def, 0.9);
    }
  }

  // Draw malfunction overlays: pulsing red-orange border + warning stripe.
  _drawMalfunctionOverlays(g, ps, assembly);

  // Draw deployed parachute canopies independently (in world space, not rotating with rocket).
  _drawParachuteCanopies(ps, assembly, w, h);

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
    const scale = _ppm() * SCALE_M_PER_PX;

    const fragContainer    = new PIXI.Container();
    fragContainer.x        = sx;
    fragContainer.y        = sy;
    fragContainer.scale.set(scale);
    fragContainer.rotation = debris.angle;
    _debrisContainer.addChild(fragContainer);

    // Part rectangles at half opacity to indicate non-controlled status.
    const g = new PIXI.Graphics();
    fragContainer.addChild(g);

    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        _drawLandingLeg(g, placed, def, debris, assembly, 0.5);
      } else {
        _drawPartRect(g, placed, def, 0.5);
      }
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
// Ejected crew rendering
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RCS plume rendering
// ---------------------------------------------------------------------------

/** RCS plume colour (blue-white). */
const RCS_PLUME_COLOR = 0x88ccff;

/** RCS plume length in metres. */
const RCS_PLUME_LENGTH = 1.5;

/** RCS plume base half-width in metres. */
const RCS_PLUME_HALF_WIDTH = 0.3;

/**
 * Render small RCS plumes around the craft when in docking/RCS mode
 * and directional thrust is active.
 *
 * Plumes appear at the craft's centre of mass, oriented to show thrust direction.
 *
 * @param {import('../core/physics.js').PhysicsState}          ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}  assembly
 * @param {number} w  Canvas width.
 * @param {number} h  Canvas height.
 */
function _renderRcsPlumes(ps, assembly, w, h) {
  if (!_trailContainer) return;
  if (ps.controlMode !== ControlMode.RCS && ps.controlMode !== ControlMode.DOCKING) return;
  if (!ps.rcsActiveDirections || ps.rcsActiveDirections.size === 0) return;

  const ppm = _ppm();
  const com = _computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
  const { sx: comSx, sy: comSy } = _worldToScreen(com.x, com.y, w, h);

  const g = new PIXI.Graphics();
  _trailContainer.addChild(g);

  const lenPx  = RCS_PLUME_LENGTH * ppm;
  const halfW  = RCS_PLUME_HALF_WIDTH * ppm;
  const sinA   = Math.sin(ps.angle);
  const cosA   = Math.cos(ps.angle);

  // Screen-space craft axes:
  // "Up" axis (rocket nose) in screen: (+sinA, -cosA) because screen Y is inverted.
  // "Right" axis in screen: (+cosA, +sinA).
  const upSx = sinA;
  const upSy = -cosA;
  const rtSx = cosA;
  const rtSy = sinA;

  for (const dir of ps.rcsActiveDirections) {
    // Plumes fire OPPOSITE to thrust direction.
    let plumeDirSx, plumeDirSy;
    switch (dir) {
      case 'up':    plumeDirSx = -upSx; plumeDirSy = -upSy; break; // thrust up → plume down
      case 'down':  plumeDirSx =  upSx; plumeDirSy =  upSy; break; // thrust down → plume up
      case 'left':  plumeDirSx =  rtSx; plumeDirSy =  rtSy; break; // thrust left → plume right
      case 'right': plumeDirSx = -rtSx; plumeDirSy = -rtSy; break; // thrust right → plume left
      default: continue;
    }

    // Perpendicular to plume direction for width.
    const perpSx = -plumeDirSy;
    const perpSy =  plumeDirSx;

    // Draw a simple triangle plume.
    const tipX = comSx + plumeDirSx * lenPx;
    const tipY = comSy + plumeDirSy * lenPx;
    const baseL_x = comSx + perpSx * halfW;
    const baseL_y = comSy + perpSy * halfW;
    const baseR_x = comSx - perpSx * halfW;
    const baseR_y = comSy - perpSy * halfW;

    g.moveTo(baseL_x, baseL_y);
    g.lineTo(tipX, tipY);
    g.lineTo(baseR_x, baseR_y);
    g.closePath();
    g.fill({ color: RCS_PLUME_COLOR, alpha: 0.6 });

    // Inner brighter core (narrower).
    const coreLen = lenPx * 0.5;
    const coreHW  = halfW * 0.3;
    const cTipX = comSx + plumeDirSx * coreLen;
    const cTipY = comSy + plumeDirSy * coreLen;
    const cBaseL_x = comSx + perpSx * coreHW;
    const cBaseL_y = comSy + perpSy * coreHW;
    const cBaseR_x = comSx - perpSx * coreHW;
    const cBaseR_y = comSy - perpSy * coreHW;

    g.moveTo(cBaseL_x, cBaseL_y);
    g.lineTo(cTipX, cTipY);
    g.lineTo(cBaseR_x, cBaseR_y);
    g.closePath();
    g.fill({ color: 0xffffff, alpha: 0.5 });
  }
}

// ---------------------------------------------------------------------------
// Ejected crew rendering
// ---------------------------------------------------------------------------

/**
 * Render ejected crew capsules as small rectangles with parachute canopies.
 *
 * @param {import('../core/physics.js').PhysicsState} ps
 * @param {number} w  Canvas width.
 * @param {number} h  Canvas height.
 */
function _renderEjectedCrew(ps, w, h) {
  if (!ps.ejectedCrew || ps.ejectedCrew.length === 0) return;
  if (!_debrisContainer) return;

  const ppm = _ppm();

  for (const crew of ps.ejectedCrew) {
    const { sx, sy } = _worldToScreen(crew.x, crew.y, w, h);

    const g = new PIXI.Graphics();

    // Capsule body — small rectangle
    const capsW = 8;
    const capsH = 12;
    g.rect(sx - capsW / 2, sy - capsH / 2, capsW, capsH);
    g.fill({ color: 0xd0d8e0, alpha: 0.9 });
    g.stroke({ color: 0x8090a0, width: 1, alpha: 0.8 });

    // Parachute canopy when deployed
    if (crew.chuteOpen) {
      const chuteW = 28;
      const chuteH = 10;
      const chuteY = sy - capsH / 2 - 14;

      // Canopy dome (arc)
      g.moveTo(sx - chuteW / 2, chuteY);
      g.bezierCurveTo(
        sx - chuteW / 4, chuteY - chuteH,
        sx + chuteW / 4, chuteY - chuteH,
        sx + chuteW / 2, chuteY,
      );
      g.fill({ color: 0xff6030, alpha: 0.8 });

      // Suspension lines
      g.moveTo(sx - chuteW / 2, chuteY);
      g.lineTo(sx - capsW / 2, sy - capsH / 2);
      g.moveTo(sx + chuteW / 2, chuteY);
      g.lineTo(sx + capsW / 2, sy - capsH / 2);
      g.moveTo(sx, chuteY);
      g.lineTo(sx, sy - capsH / 2);
      g.stroke({ color: 0xc0c0c0, width: 0.5, alpha: 0.6 });
    }

    _debrisContainer.addChild(g);
  }
}

// ---------------------------------------------------------------------------
// Mach effects — vapor cone and compression waves
// ---------------------------------------------------------------------------

/** Speed of sound at sea level (m/s). */
const MACH_1 = 343;

/** Phase for animating compression wave shimmer. */
let _machPhase = 0;

/** Previous frame's Mach effect Graphics, removed at start of next frame. @type {PIXI.Graphics|null} */
let _machGraphics = null;

/**
 * Render transonic/supersonic visual effects around the rocket.
 *
 * - Vapor cone: translucent V-shape at the nose, visible Mach 0.85–1.5
 * - Compression waves: faint arcs trailing from the nose above Mach 1
 *
 * Both effects scale with atmospheric density and vanish in vacuum.
 *
 * @param {import('../core/physics.js').PhysicsState}             ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}     assembly
 * @param {number} density  Current air density.
 * @param {number} w        Canvas width.
 * @param {number} h        Canvas height.
 * @param {number} dt       Frame delta in seconds.
 */
function _renderMachEffects(ps, assembly, density, w, h, dt) {
  const speed = Math.hypot(ps.velX, ps.velY);
  const mach  = speed / MACH_1;
  const densityRatio = Math.min(1, density / 1.225);

  // Remove previous frame's Mach graphics.
  if (_machGraphics && _machGraphics.parent) {
    _machGraphics.parent.removeChild(_machGraphics);
  }
  _machGraphics = null;

  // No effects below Mach 0.85 or in near-vacuum.
  if (mach < 0.85 || densityRatio < 0.02) return;
  if (!_rocketContainer) return;

  _machPhase += dt * 10;

  const ppm = _ppm();

  // Find the nose tip — highest VAB Y among active parts.
  const comWorld = _computeCoM(ps.fuelStore, assembly, ps.activeParts, 0, 0);
  let noseVabY = -Infinity;
  let nosePartWidth = 20;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const top = placed.y + (def.height ?? 20) / 2;
    if (top > noseVabY) {
      noseVabY = top;
      nosePartWidth = def.width ?? 20;
    }
  }

  // Convert nose tip from VAB local coords to world coords.
  // VAB local: (0, noseVabY) in pixels. Convert to metres, then rotate.
  const cosA = Math.cos(ps.angle);
  const sinA = Math.sin(ps.angle);
  const noseM = noseVabY * SCALE_M_PER_PX;
  // In world space, the rocket body Y-up: nose at (posX + noseM*sinA, posY + noseM*cosA)
  // But we need to account for CoM offset since the rocket rotates around CoM.
  const comM = comWorld.y;  // CoM in metres from reference
  const noseOffsetM = noseM - comM;
  const noseWorldX = ps.posX + comWorld.x + noseOffsetM * sinA;
  const noseWorldY = ps.posY + comM + noseOffsetM * cosA;
  const { sx: noseSX, sy: noseSY } = _worldToScreen(noseWorldX, noseWorldY, w, h);

  // Direction of travel in screen space.
  const velSX =  ps.velX;
  const velSY = -ps.velY;  // world Y-up → screen Y-down
  const velLen = Math.hypot(velSX, velSY) || 1;
  const vdx = velSX / velLen;
  const vdy = velSY / velLen;

  // Perpendicular to velocity (screen space).
  const perpX = -vdy;
  const perpY =  vdx;

  const g = new PIXI.Graphics();

  // ── Sine-wave shock lines ───────────────────────────────────────────────
  // Two wavy lines emanating from ahead of the nose, spreading outward
  // and trailing behind.  They start above/ahead of the rocket and extend
  // well past it.

  // Intensity: peaks at Mach 1, persists but fades at higher Mach.
  const intensity = mach < 1
    ? (mach - 0.85) / 0.15
    : Math.max(0.3, 1 - (mach - 1) * 0.3);
  const alpha = intensity * densityRatio * 0.4;
  if (alpha < 0.01) {
    if (_rocketContainer.parent) {
      _rocketContainer.parent.addChild(g);
      _machGraphics = g;
    }
    return;
  }

  // Shock cone half-angle: wide at Mach 1, narrows at higher Mach.
  const halfAngle = mach >= 1
    ? Math.asin(Math.min(1, 1 / mach))
    : Math.PI / 2.5;

  // How far ahead of the nose the lines start, and how far behind they trail.
  const leadPx  = 20 * ppm * SCALE_M_PER_PX;   // start ahead of nose
  const trailPx = 150 * ppm * SCALE_M_PER_PX;  // extend well past the rocket
  const totalLen = leadPx + trailPx;

  // Starting point: ahead of the nose along velocity direction.
  const startX = noseSX + vdx * leadPx;
  const startY = noseSY + vdy * leadPx;

  const segs = 24;
  const sineFreq = 3 + mach * 1.5;
  const sineAmp  = 3 * ppm * SCALE_M_PER_PX;
  const lineWidth = Math.max(1, 1.5 * densityRatio);

  // Draw two symmetric shock lines (left and right).
  for (const side of [-1, 1]) {
    const sidePhase = _machPhase + side * 0.8;

    g.moveTo(startX, startY);

    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      // Distance behind the start point.
      const dist = t * totalLen;
      // Spread: increases along the line at the shock angle.
      const spread = dist * Math.tan(halfAngle) * side;
      // Sine wobble for organic look, dampened near the start.
      const wobble = Math.sin(t * sineFreq * Math.PI * 2 + sidePhase)
                   * sineAmp * Math.min(1, t * 3);

      // Position: start - velocity*dist + perpendicular*(spread + wobble)
      const px = startX - vdx * dist + perpX * (spread + wobble);
      const py = startY - vdy * dist + perpY * (spread + wobble);
      g.lineTo(px, py);
    }

    // Fade from bright near nose to transparent at tail.
    g.stroke({ color: 0xc8e0ff, width: lineWidth, alpha: alpha });
  }

  // ── Condensation flash near Mach 1 ─────────────────────────────────────
  // A brief white glow around the nose at transonic speeds.
  if (mach > 0.95 && mach < 1.15) {
    const flashIntensity = 1 - Math.abs(mach - 1.05) / 0.15;
    const flashR = nosePartWidth * ppm * SCALE_M_PER_PX * 1.5;
    g.circle(noseSX, noseSY, Math.max(3, flashR));
    g.fill({ color: 0xffffff, alpha: flashIntensity * densityRatio * 0.2 });
  }

  if (_rocketContainer.parent) {
    _rocketContainer.parent.addChild(g);
    _machGraphics = g;
  }
}

// ---------------------------------------------------------------------------
// Engine trail helpers
// ---------------------------------------------------------------------------

/**
 * Compute the world-space position of an engine's nozzle exit.
 *
 * The nozzle sits at the "bottom" of the engine part (lowest VAB Y value).
 * Rotation is applied around the rocket's centre of mass (comBody) so the
 * trail emission point matches the visual pivot used by _renderRocket.
 *
 * @param {import('../core/physics.js').PhysicsState}         ps
 * @param {import('../core/rocketbuilder.js').PlacedPart}     placed
 * @param {import('../data/parts.js').PartDef}                def
 * @param {{ x: number, y: number }}                          comBody  CoM in body-frame metres.
 * @returns {{ x: number, y: number }}  Nozzle world position in metres.
 */
function _nozzleWorldPos(ps, placed, def, comBody) {
  const nozzleX = placed.x * SCALE_M_PER_PX;
  const nozzleY = (placed.y - (def.height ?? 20) / 2) * SCALE_M_PER_PX;
  // Offset from CoM so we rotate around the same pivot as the renderer.
  const dx   = nozzleX - comBody.x;
  const dy   = nozzleY - comBody.y;
  const cosA = Math.cos(ps.angle);
  const sinA = Math.sin(ps.angle);
  return {
    x: ps.posX + comBody.x + dx * cosA + dy * sinA,
    y: ps.posY + comBody.y - dx * sinA + dy * cosA,
  };
}

/**
 * Emit trail segments for all engines this frame.
 *
 * Fire/glow segments are scaled by throttle.  Smoke segments are always emitted
 * (even at throttle = 0) but scaled by air density for atmosphere-wide trails.
 * At low velocity (e.g. on the launch pad) smoke fans out sideways.
 *
 * @param {import('../core/physics.js').PhysicsState}           ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}   assembly
 * @param {number}                                              density  Current air density (kg/m³).
 */
function _emitSmokeSegments(ps, assembly, density) {
  if (density <= TRAIL_DENSITY_THRESHOLD) return;

  const comWorld = _computeCoM(ps.fuelStore, assembly, ps.activeParts, 0, 0);
  const comBody  = { x: comWorld.x, y: comWorld.y };

  const exVx = -Math.sin(ps.angle) * TRAIL_DRIFT_SPEED;
  const exVy = -Math.cos(ps.angle) * TRAIL_DRIFT_SPEED;

  const speed      = Math.hypot(ps.velX, ps.velY);
  const fanFactor  = Math.max(0, 1 - speed / TRAIL_FAN_VELOCITY_CUTOFF);
  const fanX       = Math.cos(ps.angle) * TRAIL_FAN_SPEED * fanFactor;

  const densityRatio  = Math.min(1, density / 1.225);
  const ageMultiplier = 1 + TRAIL_ATMOSPHERE_AGE_BONUS * densityRatio;

  const throttle = ps.throttle ?? 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    const def = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const isSRB    = def.type === PartType.SOLID_ROCKET_BOOSTER;
    const isEngine = def.type === PartType.ENGINE || isSRB;
    if (!isEngine) continue;

    const isFiring = ps.firingEngines && ps.firingEngines.has(instanceId);
    const effectiveThrottle = isFiring ? (isSRB ? 1 : throttle) : 0;

    if (effectiveThrottle <= 0) {
      // Residual heat smoke.
      if (!isFiring && !ps.grounded && densityRatio >= 0.1) {
        const nozzle = _nozzleWorldPos(ps, placed, def, comBody);
        _trailSegments.push({
          worldX: nozzle.x, worldY: nozzle.y,
          vx: exVx * 0.15 + (Math.random() - 0.5) * fanX,
          vy: exVy * 0.15 + Math.abs(exVy) * 0.2 * fanFactor,
          age: 0, baseW: 2, baseH: 4, isSRB: false,
          maxAge: TRAIL_MAX_AGE * ageMultiplier * 0.4, isSmoke: true,
        });
      }
      continue;
    }

    // Atmosphere smoke only (fire is now handled by _renderPlumes).
    if (densityRatio > 0.05) {
      const nozzle = _nozzleWorldPos(ps, placed, def, comBody);
      const smokeW = (isSRB ? 20 : 12) * densityRatio * (0.5 + effectiveThrottle * 0.5);
      const smokeH = (isSRB ? 44 : 26) * densityRatio * (0.5 + effectiveThrottle * 0.5);
      const lateralSign = Math.random() < 0.5 ? 1 : -1;
      _trailSegments.push({
        worldX: nozzle.x, worldY: nozzle.y,
        vx: exVx * 0.45 + lateralSign * fanX * (0.3 + Math.random() * 0.7),
        vy: exVy * 0.45 + Math.abs(exVy) * 0.3 * fanFactor,
        age: 0, baseW: smokeW, baseH: smokeH, isSRB: false,
        maxAge: TRAIL_MAX_AGE * ageMultiplier, isSmoke: true,
      });
    }
  }
}

/**
 * Advance every trail segment by `dt` seconds and discard expired ones.
 *
 * @param {number} dt  Elapsed time in seconds.
 */
function _updateTrails(dt) {
  for (const seg of _trailSegments) {
    seg.age    += dt;
    seg.worldX += seg.vx * dt;
    seg.worldY += seg.vy * dt;
  }
  // Compact array in place — avoids allocation of a filtered copy.
  let write = 0;
  for (let i = 0; i < _trailSegments.length; i++) {
    const maxAge = _trailSegments[i].maxAge ?? TRAIL_MAX_AGE;
    if (_trailSegments[i].age < maxAge) {
      _trailSegments[write++] = _trailSegments[i];
    }
  }
  _trailSegments.length = write;
}

/**
 * Draw all live trail segments into `_trailContainer`.
 *
 * Colour gradient over normalised lifetime t ∈ [0, 1]:
 *   0.0–0.4  bright yellow-white → orange        (SRBs start at pure white)
 *   0.4–1.0  orange → dark red-orange, alpha → 0
 *
 * Size shrinks to 50 % width and 70 % height over the segment's lifetime.
 *
 * @param {number} w  Canvas width in pixels.
 * @param {number} h  Canvas height in pixels.
 */
function _renderTrails(w, h) {
  if (!_trailContainer) return;
  while (_trailContainer.children.length) _trailContainer.removeChildAt(0);
  if (_trailSegments.length === 0) return;

  const g = new PIXI.Graphics();
  _trailContainer.addChild(g);

  for (const seg of _trailSegments) {
    const maxAge = seg.maxAge ?? TRAIL_MAX_AGE;
    const t      = seg.age / maxAge;
    const alpha  = Math.max(0, 1 - t);

    let color;
    if (seg.isSmoke) {
      // Smoke: grey at birth → dark grey at death.
      color = t < 0.5
        ? _lerpColor(0x888888, 0x444444, t / 0.5)
        : _lerpColor(0x444444, 0x222222, (t - 0.5) / 0.5);
    } else {
      // Fire/glow: bright at birth → orange → dark red at death.
      const birthColor = seg.isSRB ? 0xffffff : 0xffff80;
      color = t < 0.4
        ? _lerpColor(birthColor, 0xff8800, t / 0.4)
        : _lerpColor(0xff8800, 0xff2000, (t - 0.4) / 0.6);
    }

    // Radius grows slightly as smoke disperses, shrinks for fire.
    const growFactor = seg.isSmoke ? (1 + t * 0.6) : (1 - t * 0.5);
    const zs = _zoomLevel;
    const rx = Math.max(0.5, (seg.baseW * growFactor * zs) / 2);
    const ry = Math.max(0.5, (seg.baseH * (seg.isSmoke ? (1 + t * 0.4) : (1 - t * 0.3)) * zs) / 2);

    const { sx, sy } = _worldToScreen(seg.worldX, seg.worldY, w, h);
    g.ellipse(sx, sy, rx, ry);
    g.fill({ color, alpha: alpha * (seg.isSmoke ? 0.55 : 1) });
  }
}

/**
 * Compute elapsed seconds since the last call, advancing `_lastTrailTime`.
 * Returns 0 on the very first call.  Output is capped at 50 ms (20 fps floor).
 *
 * @returns {number}
 */
function _trailDt() {
  const now = performance.now();
  if (_lastTrailTime === null) {
    _lastTrailTime = now;
    return 0;
  }
  const dt       = Math.min((now - _lastTrailTime) / 1000, 0.05);
  _lastTrailTime = now;
  return dt;
}

// ---------------------------------------------------------------------------
// Zoom input handlers (private)
// ---------------------------------------------------------------------------

/**
 * Track the current mouse position so the wheel handler can compute the
 * world coordinate under the cursor.
 *
 * @param {MouseEvent} e
 */
function _onMouseMove(e) {
  _mouseX = e.clientX;
  _mouseY = e.clientY;
}

/**
 * Handle mouse-wheel scroll to zoom the camera in / out.
 *
 * Zooming is centred on the cursor: the world-space coordinate currently
 * under the pointer stays at the same screen position after the zoom change.
 * The camera then re-snaps to the rocket on the next frame via _updateCamera,
 * so persistent camera drift is avoided.
 *
 * @param {WheelEvent} e
 */
function _onWheel(e) {
  if (!_inputEnabled) return;
  e.preventDefault();

  // Scroll up (deltaY < 0) = zoom in; scroll down = zoom out.
  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  _zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, _zoomLevel * factor));
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

  // Remove any stale flight containers left from a previous flight (defensive).
  // We deliberately do NOT call app.stage.removeChildren() because the hub and
  // VAB renderers keep persistent containers on the stage that must survive the
  // flight scene lifecycle.
  if (_skyGraphics)          app.stage.removeChild(_skyGraphics);
  if (_starsContainer)       app.stage.removeChild(_starsContainer);
  if (_horizonGraphics)      app.stage.removeChild(_horizonGraphics);
  if (_groundGraphics)       app.stage.removeChild(_groundGraphics);
  if (_debrisContainer)      app.stage.removeChild(_debrisContainer);
  if (_trailContainer)       app.stage.removeChild(_trailContainer);
  if (_rocketContainer)      app.stage.removeChild(_rocketContainer);
  if (_canopyContainer)      app.stage.removeChild(_canopyContainer);
  if (_biomeLabelContainer)  app.stage.removeChild(_biomeLabelContainer);

  // Layer order (bottom → top):
  //   sky → stars → horizon → ground → debris → engine trails → active rocket → canopies → biome label
  _skyGraphics          = new PIXI.Graphics();
  _starsContainer       = new PIXI.Container();
  _horizonGraphics      = new PIXI.Graphics();
  _groundGraphics       = new PIXI.Graphics();
  _debrisContainer      = new PIXI.Container();
  _trailContainer       = new PIXI.Container();
  _rocketContainer      = new PIXI.Container();
  _canopyContainer      = new PIXI.Container();
  _biomeLabelContainer  = new PIXI.Container();

  app.stage.addChild(_skyGraphics);
  app.stage.addChild(_starsContainer);
  app.stage.addChild(_horizonGraphics);
  app.stage.addChild(_groundGraphics);
  app.stage.addChild(_debrisContainer);
  app.stage.addChild(_trailContainer);
  app.stage.addChild(_rocketContainer);
  app.stage.addChild(_canopyContainer);
  app.stage.addChild(_biomeLabelContainer);

  // Pre-generate the deterministic star field.
  _generateStars();

  // Reset trail and plume state.
  _trailSegments = [];
  _lastTrailTime = null;
  _plumeStates   = new Map();

  // Reset camera to launch-pad origin.
  _camWorldX   = 0;
  _camWorldY   = 0;
  _lastCamTime = null;
  _camSnap     = true;
  _prevTargetX = null;
  _prevTargetY = null;
  _camOffsetX  = 0;
  _camOffsetY  = 0;

  // Reset biome label state.
  _currentBiomeName = null;
  _biomeLabelAlpha  = 0;

  // Reset zoom and initialise mouse tracking.
  _zoomLevel = 1.0;
  _mouseX    = window.innerWidth  / 2;
  _mouseY    = window.innerHeight / 2;

  // Register zoom input handlers.
  _wheelHandler     = _onWheel;
  _mouseMoveHandler = _onMouseMove;
  window.addEventListener('wheel',     _wheelHandler,     { passive: false });
  window.addEventListener('mousemove', _mouseMoveHandler);

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

  // 4a. Horizon curvature — curved ground for high-altitude visual.
  _renderHorizon(altitude, w, h);

  // 4b. Ground band — sandy-tan terrain below world Y = 0.
  //     At high altitudes the curved horizon replaces the flat ground band,
  //     so we only draw the flat ground when the curvature is not active.
  if (altitude < 5_000) {
    _renderGround(w, h);
  }

  // 5. Debris fragments — dimmed, camera does not follow (unless they have
  //    the command module, which is handled by _updateCamera above).
  _renderDebris(ps.debris, assembly, w, h);

  // 6. Engine exhaust — smoke particles + sine-wave plumes.
  const trailDensity = airDensity(altitude);
  const dt           = _trailDt();
  _emitSmokeSegments(ps, assembly, trailDensity);
  _updateTrails(dt);
  _renderTrails(w, h);
  _updatePlumeStates(ps, assembly, dt);
  _renderPlumes(ps, assembly, trailDensity, w, h);

  // 6b. RCS plumes — small directional plumes when in docking/RCS mode.
  _renderRcsPlumes(ps, assembly, w, h);

  // 6c. Ejected crew capsules with parachutes.
  _renderEjectedCrew(ps, w, h);

  // 7. Active rocket — full opacity, camera centred here (normally).
  _renderRocket(ps, assembly, w, h);

  // 7b. Docking target — rendered as a marker when approaching in docking mode.
  _renderDockingTarget(ps, w, h);

  // 8. Mach effects — vapor cone and compression waves at transonic/supersonic.
  _renderMachEffects(ps, assembly, trailDensity, w, h, dt);

  // 9. Biome label — shows current altitude biome with fade transitions.
  _renderBiomeLabel(altitude, w, h, dt);
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

  // Remove only the flight-specific containers.  Using removeChildren() would
  // also strip the persistent hub/VAB containers from the stage, causing them
  // to become invisible after returning from a flight.
  if (_skyGraphics)          app.stage.removeChild(_skyGraphics);
  if (_starsContainer)       app.stage.removeChild(_starsContainer);
  if (_horizonGraphics)      app.stage.removeChild(_horizonGraphics);
  if (_groundGraphics)       app.stage.removeChild(_groundGraphics);
  if (_debrisContainer)      app.stage.removeChild(_debrisContainer);
  if (_trailContainer)       app.stage.removeChild(_trailContainer);
  if (_rocketContainer)      app.stage.removeChild(_rocketContainer);
  if (_canopyContainer)      app.stage.removeChild(_canopyContainer);
  if (_biomeLabelContainer)  app.stage.removeChild(_biomeLabelContainer);
  if (_dockingTargetGfx)     app.stage.removeChild(_dockingTargetGfx);

  _skyGraphics          = null;
  _starsContainer       = null;
  _horizonGraphics      = null;
  _groundGraphics       = null;
  _debrisContainer      = null;
  _trailContainer       = null;
  _rocketContainer      = null;
  _canopyContainer      = null;
  _biomeLabelContainer  = null;
  _stars                = [];
  _trailSegments        = [];
  _lastTrailTime        = null;
  _plumeStates          = new Map();
  _machGraphics         = null;
  _machPhase            = 0;
  _dockingTargetGfx     = null;
  _currentBiomeName     = null;
  _biomeLabelAlpha      = 0;

  _camWorldX   = 0;
  _camWorldY   = 0;
  _lastCamTime = null;
  _camSnap     = true;
  _prevTargetX = null;
  _prevTargetY = null;
  _camOffsetX  = 0;
  _camOffsetY  = 0;

  // Remove zoom input handlers.
  if (_wheelHandler) {
    window.removeEventListener('wheel', _wheelHandler);
    _wheelHandler = null;
  }
  if (_mouseMoveHandler) {
    window.removeEventListener('mousemove', _mouseMoveHandler);
    _mouseMoveHandler = null;
  }
  _zoomLevel = 1.0;

  console.log('[Flight Renderer] Destroyed');
}

/**
 * Hide all flight-scene containers (used when the map view is active).
 * The containers are not destroyed — just made invisible so rendering
 * doesn't consume GPU time while the map covers the screen.
 */
export function hideFlightScene() {
  if (_skyGraphics)          _skyGraphics.visible = false;
  if (_starsContainer)       _starsContainer.visible = false;
  if (_horizonGraphics)      _horizonGraphics.visible = false;
  if (_groundGraphics)       _groundGraphics.visible = false;
  if (_debrisContainer)      _debrisContainer.visible = false;
  if (_trailContainer)       _trailContainer.visible = false;
  if (_rocketContainer)      _rocketContainer.visible = false;
  if (_canopyContainer)      _canopyContainer.visible = false;
  if (_biomeLabelContainer)  _biomeLabelContainer.visible = false;
}

/**
 * Show all flight-scene containers (used when returning from the map view).
 */
export function showFlightScene() {
  if (_skyGraphics)          _skyGraphics.visible = true;
  if (_starsContainer)       _starsContainer.visible = true;
  if (_horizonGraphics)      _horizonGraphics.visible = true;
  if (_groundGraphics)       _groundGraphics.visible = true;
  if (_debrisContainer)      _debrisContainer.visible = true;
  if (_trailContainer)       _trailContainer.visible = true;
  if (_rocketContainer)      _rocketContainer.visible = true;
  if (_canopyContainer)      _canopyContainer.visible = true;
  if (_biomeLabelContainer)  _biomeLabelContainer.visible = true;
}

/**
 * Enable or disable flight-specific input handling (scroll zoom, mouse
 * tracking).  Disabled while the map view is active to prevent conflicting
 * wheel events.
 *
 * @param {boolean} enabled
 */
export function setFlightInputEnabled(enabled) {
  _inputEnabled = enabled;
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

/**
 * Get the current zoom level (1.0 = default, 0.1 = fully zoomed out, 5.0 = fully zoomed in).
 *
 * @returns {number}
 */
export function getZoomLevel() {
  return _zoomLevel;
}

/**
 * Hit-test a screen-space pointer position against all active parts on the
 * main rocket (not debris), returning the instance ID of the topmost part
 * whose bounding rectangle contains the pointer, or `null` if no part was hit.
 *
 * The test accounts for the rocket container's translation and rotation.
 * Parts are NOT visually scaled with zoom (the container is not scaled, only
 * positioned), so the hit test is performed entirely in container-local pixel
 * space by rotating the offset vector by the inverse of `ps.angle`.
 *
 * @param {number}                                              screenX  CSS pixel X.
 * @param {number}                                              screenY  CSS pixel Y.
 * @param {import('../core/physics.js').PhysicsState}           ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}   assembly
 * @returns {string|null}  The hit part's instanceId, or null.
 */
export function hitTestFlightPart(screenX, screenY, ps, assembly) {
  if (!ps || !assembly) return null;

  const w = window.innerWidth;
  const h = window.innerHeight;

  // Base screen position of the rocket's world origin.
  const { sx, sy } = _worldToScreen(ps.posX, ps.posY, w, h);

  // Replicate the same pivot + ground offset that _renderRocket applies to the
  // PixiJS container so the hit-test matches the visual placement exactly.
  const com       = _computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
  const comLocalX =  (com.x - ps.posX) / SCALE_M_PER_PX;
  const comLocalY = -(com.y - ps.posY) / SCALE_M_PER_PX;

  let lowestPartBottomPx = 0;
  if (ps.grounded || ps.landed) {
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      let bottom = placed.y - (def.height ?? 40) / 2;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        const footVabY = placed.y - dy;
        if (footVabY < bottom) bottom = footVabY;
      }
      if (bottom < lowestPartBottomPx) lowestPartBottomPx = bottom;
    }
  }

  let pivotX, pivotY, containerX, containerY;
  if ((ps.grounded || ps.landed) && ps.isTipping) {
    pivotX     =  ps.tippingContactX;
    pivotY     = -ps.tippingContactY;
    const cosA = Math.cos(ps.angle);
    const sinA = Math.sin(ps.angle);
    containerX = sx + ps.tippingContactX * cosA + ps.tippingContactY * sinA;
    // Compute visual drop (same logic as _renderRocket tipping path).
    let maxDrop = 0;
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      const hw = (def.width  ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      let effHW = hw, effBottomH = hh;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        effHW = Math.max(hw, dx);
        effBottomH = Math.max(hh, dy);
      }
      const corners = [
        [placed.x - effHW, placed.y - effBottomH],
        [placed.x + effHW, placed.y - effBottomH],
        [placed.x - effHW, placed.y + hh],
        [placed.x + effHW, placed.y + hh],
      ];
      for (const [cx, cy] of corners) {
        const drop = (cx - ps.tippingContactX) * sinA
                   + (ps.tippingContactY - cy) * cosA;
        if (drop > maxDrop) maxDrop = drop;
      }
    }
    containerY = sy - maxDrop;
  } else {
    pivotX     = comLocalX;
    pivotY     = comLocalY;
    containerX = sx + comLocalX;
    containerY = sy + lowestPartBottomPx + comLocalY;
  }

  // Offset of the click from the container's screen position.
  const dx = screenX - containerX;
  const dy = screenY - containerY;

  // Rotate by the inverse of the container rotation to get pivot-relative
  // local space, then add the pivot to recover container-local coordinates.
  const cosNeg = Math.cos(-ps.angle);
  const sinNeg = Math.sin(-ps.angle);
  const localX = dx * cosNeg - dy * sinNeg + pivotX;
  const localY = dx * sinNeg + dy * cosNeg + pivotY;

  // Test each active part in reverse insertion order (topmost rendered last).
  const activeIds = [...ps.activeParts];
  for (let i = activeIds.length - 1; i >= 0; i--) {
    const instanceId = activeIds[i];
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const pw = def.width  ?? 40;
    const ph = def.height ?? 20;
    // Part centre in container local space: (placed.x, -placed.y)
    const partCX = placed.x;
    const partCY = -placed.y;

    if (
      localX >= partCX - pw / 2 && localX <= partCX + pw / 2 &&
      localY >= partCY - ph / 2 && localY <= partCY + ph / 2
    ) {
      return instanceId;
    }
  }

  return null;
}

/**
 * Programmatically set the zoom level, clamped to [MIN_ZOOM, MAX_ZOOM].
 *
 * @param {number} zoom  Desired zoom level.
 */
export function setZoomLevel(zoom) {
  _zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
