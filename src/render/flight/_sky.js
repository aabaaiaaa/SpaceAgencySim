/**
 * _sky.js — Sky gradient, star field, horizon curvature, and weather haze.
 *
 * @module render/flight/_sky
 */

import * as PIXI from 'pixi.js';
import { getSkyVisual, getGroundVisual, getAtmosphereTop } from '../../data/bodies.js';
import { getFlightRenderState } from './_state.js';
import { ppm } from './_camera.js';
import {
  SKY_SEA_LEVEL, SKY_HIGH_ALT, SKY_SPACE,
  STAR_FADE_START, STAR_FADE_FULL, GROUND_COLOR,
  STAR_COUNT,
} from './_constants.js';

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
export function lerpColor(c1, c2, t) {
  const r1 = (c1 >> 16) & 0xff,  g1 = (c1 >> 8) & 0xff,  b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff,  g2 = (c2 >> 8) & 0xff,  b2 = c2 & 0xff;
  const r  = Math.round(r1 + (r2 - r1) * t);
  const g  = Math.round(g1 + (g2 - g1) * t);
  const b  = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

// ---------------------------------------------------------------------------
// Body visual overrides
// ---------------------------------------------------------------------------

/**
 * Update the body visual overrides based on a celestial body ID.
 * Falls back to Earth defaults when bodyId is undefined or 'EARTH'.
 *
 * @param {string|undefined} bodyId
 */
export function updateBodyVisuals(bodyId) {
  const s = getFlightRenderState();
  const sky = bodyId ? getSkyVisual(bodyId) : null;
  const gnd = bodyId ? getGroundVisual(bodyId) : null;

  s.bodyVisuals.seaLevel  = sky ? sky.seaLevelColor  : SKY_SEA_LEVEL;
  s.bodyVisuals.highAlt   = sky ? sky.highAltColor    : SKY_HIGH_ALT;
  s.bodyVisuals.space     = sky ? sky.spaceColor      : SKY_SPACE;
  s.bodyVisuals.starStart = sky ? sky.starFadeStart   : STAR_FADE_START;
  s.bodyVisuals.starEnd   = sky ? sky.starFadeEnd     : STAR_FADE_FULL;
  s.bodyVisuals.ground    = gnd ? gnd.color           : GROUND_COLOR;
}

// ---------------------------------------------------------------------------
// Sky colour
// ---------------------------------------------------------------------------

/**
 * Return the sky background colour for a given altitude.
 *
 * @param {number} altitude  Altitude in metres.
 * @returns {number}         Packed 0xRRGGBB colour.
 */
export function skyColor(altitude) {
  const s = getFlightRenderState();
  const { seaLevel, highAlt, space, starStart, starEnd } = s.bodyVisuals;

  // Airless bodies: always black/space sky.
  if (starEnd <= 0) return space;

  if (altitude >= starEnd) return space;

  const midAlt = starStart > 0 ? starStart * 0.6 : 30_000;
  if (altitude >= midAlt) {
    const t = (altitude - midAlt) / (starEnd - midAlt);
    return lerpColor(highAlt, space, Math.min(1, t));
  }
  const t = midAlt > 0 ? altitude / midAlt : 0;
  return lerpColor(seaLevel, highAlt, Math.min(1, t));
}

// ---------------------------------------------------------------------------
// Sky rendering
// ---------------------------------------------------------------------------

/**
 * Redraw the sky background rectangle with the colour appropriate for the
 * current camera altitude.
 *
 * @param {number} altitude  Camera altitude in metres.
 * @param {number} w         Canvas width in pixels.
 * @param {number} h         Canvas height in pixels.
 */
export function renderSky(altitude, w, h) {
  const s = getFlightRenderState();
  if (!s.skyGraphics) return;
  s.skyGraphics.clear();
  const color = skyColor(altitude);
  s.skyGraphics.rect(0, 0, w, h);
  s.skyGraphics.fill({ color });
}

// ---------------------------------------------------------------------------
// Stars
// ---------------------------------------------------------------------------

/**
 * Pre-generate the star field using a deterministic LCG sequence.
 */
export function generateStars() {
  const s = getFlightRenderState();
  s.stars = [];
  let seed = 0xdeadbeef;
  function rand() {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    return (seed >>> 0) / 0x100000000;
  }
  for (let i = 0; i < STAR_COUNT; i++) {
    s.stars.push({
      nx: rand(),
      ny: rand(),
      r:  0.5 + rand(),
    });
  }
}

/**
 * Render the star field, fading in as altitude rises.
 *
 * @param {number} altitude  Current camera altitude in metres.
 * @param {number} w         Canvas width in pixels.
 * @param {number} h         Canvas height in pixels.
 */
export function renderStars(altitude, w, h) {
  const s = getFlightRenderState();
  if (!s.starsContainer) return;

  const { starStart, starEnd } = s.bodyVisuals;

  let alpha;
  if (starEnd <= 0) {
    alpha = 1;
  } else {
    const range = starEnd - starStart;
    alpha = range > 0
      ? Math.max(0, Math.min(1, (altitude - starStart) / range))
      : (altitude >= starStart ? 1 : 0);
  }

  while (s.starsContainer.children.length) s.starsContainer.removeChildAt(0);
  if (alpha <= 0) return;

  const g = new PIXI.Graphics();
  s.starsContainer.addChild(g);

  for (const star of s.stars) {
    g.circle(star.nx * w, star.ny * h, star.r);
    g.fill({ color: 0xffffff, alpha });
  }
}

// ---------------------------------------------------------------------------
// Horizon curvature
// ---------------------------------------------------------------------------

/**
 * Render a curved horizon effect at high altitudes.
 *
 * @param {number} altitude  Camera altitude in metres.
 * @param {number} w         Canvas width.
 * @param {number} h         Canvas height.
 */
export function renderHorizon(altitude, w, h) {
  const s = getFlightRenderState();
  if (!s.horizonGraphics) return;
  s.horizonGraphics.clear();

  const groundScreenY = h / 2 + s.camWorldY * ppm();

  if (groundScreenY < -h) return;

  const curvatureStart = 5_000;
  const curvatureFull  = 200_000;

  if (altitude < curvatureStart) return;

  const t = Math.min(1, (altitude - curvatureStart) / (curvatureFull - curvatureStart));

  const minRadius = w * 50;
  const maxRadius = w * 1.5;
  const arcRadius = minRadius + (maxRadius - minRadius) * (t * t);

  const cx = w / 2;
  const cy = groundScreenY + arcRadius;

  const halfAngle = Math.asin(Math.min(1, (w * 0.6) / arcRadius));

  s.horizonGraphics.moveTo(0, h);
  s.horizonGraphics.arc(cx, cy, arcRadius, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
  s.horizonGraphics.lineTo(w, h);
  s.horizonGraphics.closePath();
  s.horizonGraphics.fill({ color: s.bodyVisuals.ground });

  if (altitude > 30_000) {
    const glowAlpha = Math.min(0.5, t * 0.6);
    const glowWidth = 2 + t * 3;
    s.horizonGraphics.arc(cx, cy, arcRadius - glowWidth, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
    s.horizonGraphics.stroke({ width: glowWidth, color: 0x4488cc, alpha: glowAlpha });
  }
}

// ---------------------------------------------------------------------------
// Weather haze
// ---------------------------------------------------------------------------

/**
 * Render a cosmetic fog/haze overlay that fades out with altitude.
 *
 * @param {number} altitude  Current altitude in metres.
 * @param {number} w         Viewport width.
 * @param {number} h         Viewport height.
 * @param {string} [bodyId]  Celestial body ID.
 */
export function renderWeatherHaze(altitude, w, h, bodyId) {
  const s = getFlightRenderState();
  if (!s.hazeGraphics) return;
  s.hazeGraphics.clear();

  if (s.weatherVisibility <= 0.01) return;

  const atmoTop = getAtmosphereTop(bodyId || 'EARTH') || 70_000;
  if (altitude >= atmoTop) return;

  const altFraction = Math.max(0, 1 - altitude / atmoTop);
  const hazeAlpha = s.weatherVisibility * altFraction * 0.45;

  if (hazeAlpha < 0.01) return;

  const isDust = bodyId === 'MARS';
  const hazeColor = isDust ? 0x906040 : 0xd0d0d0;

  s.hazeGraphics.rect(0, 0, w, h);
  s.hazeGraphics.fill({ color: hazeColor, alpha: hazeAlpha });
}
