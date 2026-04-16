/**
 * _sky.ts — Sky gradient, star field, horizon curvature, and weather haze.
 */

import { getSkyVisual, getGroundVisual, getAtmosphereTop } from '../../data/bodies.ts';
import { getFlightRenderState } from './_state.ts';
import { ppm } from './_camera.ts';
import { acquireGraphics, releaseContainerChildren } from './_pool.ts';
import {
  SKY_SEA_LEVEL, SKY_HIGH_ALT, SKY_SPACE,
  STAR_FADE_START, STAR_FADE_FULL, GROUND_COLOR,
  STAR_COUNT,
} from './_constants.ts';

// ---------------------------------------------------------------------------
// Colour utilities
// ---------------------------------------------------------------------------

/**
 * Linearly interpolate between two packed-RGB hex colours.
 */
export function lerpColor(c1: number, c2: number, t: number): number {
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
 */
export function updateBodyVisuals(bodyId: string | undefined): void {
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
 */
export function skyColor(altitude: number): number {
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
 */
export function renderSky(altitude: number, w: number, h: number): void {
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
export function generateStars(): void {
  const s = getFlightRenderState();
  s.stars = [];
  let seed = 0xdeadbeef;
  function rand(): number {
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
 */
export function renderStars(altitude: number, w: number, h: number): void {
  const s = getFlightRenderState();
  if (!s.starsContainer) return;

  const { starStart, starEnd } = s.bodyVisuals;

  let alpha: number;
  if (starEnd <= 0) {
    alpha = 1;
  } else {
    const range = starEnd - starStart;
    alpha = range > 0
      ? Math.max(0, Math.min(1, (altitude - starStart) / range))
      : (altitude >= starStart ? 1 : 0);
  }

  releaseContainerChildren(s.starsContainer);
  if (alpha <= 0) return;

  const g = acquireGraphics();
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
 * In ORBIT/MANOEUVRE phase, renders the body as a distant curved horizon at
 * the bottom of the screen, scaled by altitude.  Higher orbits show a smaller
 * body arc; lower orbits show a larger one.  The ground is never reachable
 * in orbit — the horizon is purely visual orientation ("down" = toward body).
 */
export function renderHorizon(altitude: number, w: number, h: number, phase?: string): void {
  const s = getFlightRenderState();
  if (!s.horizonGraphics) return;
  s.horizonGraphics.clear();

  // --- ORBIT / MANOEUVRE / CAPTURE: distant body horizon ---
  // In CAPTURE, the body grows from small to large as the craft approaches.
  const isOrbital = phase === 'ORBIT' || phase === 'MANOEUVRE' || phase === 'CAPTURE';
  if (isOrbital) {
    // The body appears as a curved arc at the bottom of the screen.
    // At low orbit (~80km), the arc fills most of the lower half.
    // At high orbit (~2000km), the arc is a thin sliver at the bottom.
    const minOrbitAlt = 70_000;
    const highOrbitAlt = 2_000_000;
    const orbitalT = Math.min(1, Math.max(0, (altitude - minOrbitAlt) / (highOrbitAlt - minOrbitAlt)));

    // Arc radius: small radius = large body (close), large radius = small arc (far).
    const closeRadius = w * 1.2;    // Low orbit: body fills the view
    const farRadius   = w * 8;      // High orbit: body is a thin arc
    const arcRadius = closeRadius + (farRadius - closeRadius) * orbitalT;

    // The arc centre sits below the screen bottom. Higher orbit = further below.
    const closeOffset = h * 0.3;    // Low orbit: arc top is 30% from bottom
    const farOffset   = h * 0.05;   // High orbit: arc barely visible
    const arcTopFromBottom = closeOffset + (farOffset - closeOffset) * orbitalT;
    const cy = h - arcTopFromBottom + arcRadius;
    const cx = w / 2;

    const halfAngle = Math.asin(Math.min(1, (w * 0.7) / arcRadius));

    s.horizonGraphics.moveTo(0, h);
    s.horizonGraphics.arc(cx, cy, arcRadius, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
    s.horizonGraphics.lineTo(w, h);
    s.horizonGraphics.closePath();
    s.horizonGraphics.fill({ color: s.bodyVisuals.ground });

    // Atmosphere glow along the horizon edge.
    const glowAlpha = 0.4 - orbitalT * 0.3;
    const glowWidth = 3 + (1 - orbitalT) * 4;
    if (glowAlpha > 0.05) {
      s.horizonGraphics.arc(cx, cy, arcRadius - glowWidth, -Math.PI / 2 - halfAngle, -Math.PI / 2 + halfAngle);
      s.horizonGraphics.stroke({ width: glowWidth, color: 0x4488cc, alpha: glowAlpha });
    }
    return;
  }

  // --- TRANSFER: deep space, no body horizon ---
  if (phase === 'TRANSFER') return;

  // --- FLIGHT / REENTRY: camera-relative ground horizon ---
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
 */
export function renderWeatherHaze(altitude: number, w: number, h: number, bodyId?: string): void {
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

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Destroy the sky/stars/horizon/haze containers and reset sky-owned state.
 * Pooled star Graphics are released back to the pool before destroying the
 * stars container so destroy doesn't corrupt pool entries. The other three
 * graphics own no pooled children. Safe to call when containers were never
 * initialised. Called from destroyFlightRenderer.
 */
export function destroySkyRender(): void {
  const s = getFlightRenderState();

  if (s.skyGraphics) {
    if (s.skyGraphics.parent) s.skyGraphics.parent.removeChild(s.skyGraphics);
    s.skyGraphics.destroy({ children: true });
    s.skyGraphics = null;
  }
  if (s.starsContainer) {
    releaseContainerChildren(s.starsContainer);
    if (s.starsContainer.parent) s.starsContainer.parent.removeChild(s.starsContainer);
    s.starsContainer.destroy({ children: true });
    s.starsContainer = null;
  }
  if (s.horizonGraphics) {
    if (s.horizonGraphics.parent) s.horizonGraphics.parent.removeChild(s.horizonGraphics);
    s.horizonGraphics.destroy({ children: true });
    s.horizonGraphics = null;
  }
  if (s.hazeGraphics) {
    if (s.hazeGraphics.parent) s.hazeGraphics.parent.removeChild(s.hazeGraphics);
    s.hazeGraphics.destroy({ children: true });
    s.hazeGraphics = null;
  }

  s.stars             = [];
  s.weatherVisibility = 0;
}
