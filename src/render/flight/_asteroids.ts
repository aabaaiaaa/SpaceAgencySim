/**
 * _asteroids.ts — Render belt asteroids in the flight view.
 *
 * Handles LOD-based rendering of procedurally-generated asteroid belt
 * objects with size-dependent detail levels and selection indicators.
 *
 * LOD is determined by relative velocity to the craft:
 *   - Full  (< 5 m/s):  detailed shape with size-based rendering
 *   - Basic (< 50 m/s): simple ellipse, slightly transparent
 *   - Streak (else):     fading trail effect
 *
 * Size categories:
 *   - Small  (1–10m):    rough dots with irregular edge
 *   - Medium (10–100m):  irregular polygon (6–8 vertices)
 *   - Large  (100m–1km): larger polygon (8–10 vertices), craters, landable indicator
 *
 * @module render/flight/_asteroids
 */

import type { Asteroid } from '../../core/asteroidBelt.ts';
import { getActiveAsteroids, hasAsteroids } from '../../core/asteroidBelt.ts';
import { getFlightRenderState } from './_state.ts';
import { acquireGraphics, acquireText, releaseContainerChildren } from './_pool.ts';
import { ppm } from './_camera.ts';

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const COLOR_SMALL  = 0x886644;
const COLOR_MEDIUM = 0x997755;
const COLOR_LARGE  = 0xAA8866;
const STREAK_HEAD  = 0xffcc44;
const STREAK_TRAIL = 0xff8800;

// ---------------------------------------------------------------------------
// Seeded PRNG (simple LCG for shape generation)
// ---------------------------------------------------------------------------

/**
 * Create a simple seeded PRNG using the LCG algorithm.
 * Returns values in [0, 1).
 */
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

// ---------------------------------------------------------------------------
// Size category
// ---------------------------------------------------------------------------

type SizeCategory = 'small' | 'medium' | 'large';

function getSizeCategory(radius: number): SizeCategory {
  if (radius < 10) return 'small';
  if (radius < 100) return 'medium';
  return 'large';
}

// ---------------------------------------------------------------------------
// LOD determination
// ---------------------------------------------------------------------------

type LOD = 'full' | 'basic' | 'streak';

function getLOD(relativeSpeed: number): LOD {
  if (relativeSpeed < 5) return 'full';
  if (relativeSpeed < 50) return 'basic';
  return 'streak';
}

// ---------------------------------------------------------------------------
// Full LOD renderers (size-dependent)
// ---------------------------------------------------------------------------

function _renderSmallAsteroid(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number, screenRadius: number,
  asteroid: Asteroid,
): void {
  const rng = seededRng(asteroid.shapeSeed);
  const r = Math.max(2, screenRadius);

  // Main body.
  g.circle(x, y, r);
  g.fill({ color: COLOR_SMALL, alpha: 1.0 });

  // 2-3 tiny circles around the edge for irregular surface.
  const bumpCount = 2 + Math.floor(rng() * 2); // 2 or 3
  for (let i = 0; i < bumpCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = r * (0.5 + rng() * 0.4);
    const bumpR = r * (0.2 + rng() * 0.2);
    g.circle(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, bumpR);
    g.fill({ color: COLOR_SMALL - 0x111111, alpha: 0.7 });
  }
}

function _renderMediumAsteroid(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number, screenRadius: number,
  asteroid: Asteroid,
): void {
  const rng = seededRng(asteroid.shapeSeed);
  const r = Math.max(4, screenRadius);
  const vertexCount = 6 + Math.floor(rng() * 3); // 6-8 vertices

  // Generate irregular polygon vertices.
  const points: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (i / vertexCount) * Math.PI * 2;
    const radiusVariation = r * (0.7 + rng() * 0.6); // +/- 30% of base radius
    points.push(
      x + Math.cos(angle) * radiusVariation,
      y + Math.sin(angle) * radiusVariation,
    );
  }

  // Draw polygon using moveTo/lineTo (close the path manually).
  g.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    g.lineTo(points[i], points[i + 1]);
  }
  g.lineTo(points[0], points[1]);
  g.fill({ color: COLOR_MEDIUM, alpha: 1.0 });

  // Outline.
  g.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    g.lineTo(points[i], points[i + 1]);
  }
  g.lineTo(points[0], points[1]);
  g.stroke({ width: 1, color: 0xffffff, alpha: 0.2 });

  // A few surface bumps (small circles).
  const bumpCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < bumpCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = r * rng() * 0.5;
    const bumpR = r * (0.1 + rng() * 0.1);
    g.circle(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, bumpR);
    g.fill({ color: COLOR_MEDIUM - 0x222222, alpha: 0.5 });
  }
}

function _renderLargeAsteroid(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number, screenRadius: number,
  asteroid: Asteroid,
  container: import('pixi.js').Container,
): void {
  const rng = seededRng(asteroid.shapeSeed);
  const r = Math.max(6, screenRadius);
  const vertexCount = 8 + Math.floor(rng() * 3); // 8-10 vertices

  // Generate irregular polygon vertices.
  const points: number[] = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (i / vertexCount) * Math.PI * 2;
    const radiusVariation = r * (0.7 + rng() * 0.6); // +/- 30%
    points.push(
      x + Math.cos(angle) * radiusVariation,
      y + Math.sin(angle) * radiusVariation,
    );
  }

  // Draw polygon.
  g.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    g.lineTo(points[i], points[i + 1]);
  }
  g.lineTo(points[0], points[1]);
  g.fill({ color: COLOR_LARGE, alpha: 1.0 });

  // Outline.
  g.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) {
    g.lineTo(points[i], points[i + 1]);
  }
  g.lineTo(points[0], points[1]);
  g.stroke({ width: 1, color: 0xffffff, alpha: 0.25 });

  // 2-3 crater marks (small dark circles).
  const craterCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < craterCount; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = r * rng() * 0.5;
    const craterR = r * (0.12 + rng() * 0.1);
    g.circle(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, craterR);
    g.fill({ color: 0x443322, alpha: 0.6 });
    // Crater rim highlight.
    g.circle(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, craterR);
    g.stroke({ width: 0.5, color: 0xbbaa99, alpha: 0.3 });
  }

  // "LANDABLE" indicator: small green dot above the asteroid.
  const indicatorG = acquireGraphics();
  container.addChild(indicatorG);
  indicatorG.circle(x, y - r - 6, 3);
  indicatorG.fill({ color: 0x44ff44, alpha: 0.8 });

  // Add "LANDABLE" text label above the green dot.
  const label = acquireText();
  container.addChild(label);
  label.text = 'LANDABLE';
  label.style = {
    fontFamily: 'monospace',
    fontSize: 9,
    fill: 0xffffff,
    align: 'center',
  };
  label.anchor.set(0.5, 1);
  label.position.set(x, y - r - 10);
  label.alpha = 0.7;
}

// ---------------------------------------------------------------------------
// Basic LOD renderer
// ---------------------------------------------------------------------------

function _renderBasicAsteroid(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number, screenRadius: number,
): void {
  const r = Math.max(2, screenRadius);
  g.circle(x, y, r);
  g.fill({ color: COLOR_SMALL, alpha: 0.8 });
}

// ---------------------------------------------------------------------------
// Streak LOD renderer
// ---------------------------------------------------------------------------

function _renderStreakAsteroid(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number,
  relVelX: number, relVelY: number,
  scale: number,
): void {
  const speed = Math.hypot(relVelX, relVelY);
  if (speed < 1) return;

  // Trail length proportional to speed (capped).
  const trailLength = Math.min(200, speed * scale * 0.05);

  // Direction of relative motion.
  const dx = relVelX / speed;
  const dy = relVelY / speed;

  // Streak: bright head + fading trail segments.
  const headX = x;
  const headY = y;
  const tailX = headX - dx * trailLength * scale;
  const tailY = headY + dy * trailLength * scale; // Y inverted

  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const sx = headX + (tailX - headX) * t0;
    const sy = headY + (tailY - headY) * t0;
    const ex = headX + (tailX - headX) * t1;
    const ey = headY + (tailY - headY) * t1;
    const alpha = 0.8 * (1 - t0);
    const width = 3 * (1 - t0) + 1;

    g.moveTo(sx, sy);
    g.lineTo(ex, ey);
    g.stroke({ width, color: i === 0 ? STREAK_HEAD : STREAK_TRAIL, alpha });
  }

  // Bright head dot.
  g.circle(headX, headY, 3);
  g.fill({ color: STREAK_HEAD, alpha: 1.0 });
}

// ---------------------------------------------------------------------------
// Selection indicator
// ---------------------------------------------------------------------------

function _renderSelectionIndicator(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number, screenRadius: number,
): void {
  const circleRadius = screenRadius + 8;
  const arcCount = 8;
  const arcAngle = Math.PI / arcCount; // each arc + each gap = 2*PI / (2 * arcCount)

  for (let i = 0; i < arcCount; i++) {
    const startAngle = i * 2 * arcAngle;
    const endAngle = startAngle + arcAngle;

    // Draw arc segment as a series of short line segments.
    const steps = 8;
    for (let j = 0; j < steps; j++) {
      const a0 = startAngle + (endAngle - startAngle) * (j / steps);
      const a1 = startAngle + (endAngle - startAngle) * ((j + 1) / steps);
      g.moveTo(x + Math.cos(a0) * circleRadius, y + Math.sin(a0) * circleRadius);
      g.lineTo(x + Math.cos(a1) * circleRadius, y + Math.sin(a1) * circleRadius);
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Render belt asteroids in the flight view.
 *
 * @param w          Canvas width in pixels.
 * @param h          Canvas height in pixels.
 * @param craftPosX  Craft world position X (metres).
 * @param craftPosY  Craft world position Y (metres).
 * @param craftVelX  Craft velocity X (m/s).
 * @param craftVelY  Craft velocity Y (m/s).
 * @param selectedAsteroidId  Optional ID of a selected/targeted asteroid.
 */
export function renderBeltAsteroids(
  w: number,
  h: number,
  craftPosX: number,
  craftPosY: number,
  craftVelX: number,
  craftVelY: number,
  selectedAsteroidId?: string | null,
): void {
  const s = getFlightRenderState();
  if (!s.asteroidsContainer) return;

  releaseContainerChildren(s.asteroidsContainer);

  if (!hasAsteroids()) return;

  const asteroids = getActiveAsteroids();
  if (asteroids.length === 0) return;

  const scale = ppm(); // pixels per metre
  const cx = w / 2;    // screen centre (craft position)
  const cy = h / 2;

  for (const asteroid of asteroids) {
    // Screen position relative to craft.
    const screenX = cx + (asteroid.posX - craftPosX) * scale;
    const screenY = cy - (asteroid.posY - craftPosY) * scale; // Y inverted

    // Cull: skip if off screen with generous margin.
    const margin = 200;
    if (screenX < -margin || screenX > w + margin || screenY < -margin || screenY > h + margin) {
      continue;
    }

    // Object size on screen (minimum 2px for visibility).
    const screenRadius = Math.max(2, asteroid.radius * scale);

    // Relative velocity.
    const relVelX = asteroid.velX - craftVelX;
    const relVelY = asteroid.velY - craftVelY;
    const relativeSpeed = Math.hypot(relVelX, relVelY);

    const lod = getLOD(relativeSpeed);
    const sizeCategory = getSizeCategory(asteroid.radius);

    const g = acquireGraphics();
    s.asteroidsContainer.addChild(g);

    switch (lod) {
      case 'full':
        switch (sizeCategory) {
          case 'small':
            _renderSmallAsteroid(g, screenX, screenY, screenRadius, asteroid);
            break;
          case 'medium':
            _renderMediumAsteroid(g, screenX, screenY, screenRadius, asteroid);
            break;
          case 'large':
            _renderLargeAsteroid(g, screenX, screenY, screenRadius, asteroid, s.asteroidsContainer);
            break;
        }
        break;

      case 'basic':
        _renderBasicAsteroid(g, screenX, screenY, screenRadius);
        break;

      case 'streak':
        _renderStreakAsteroid(g, screenX, screenY, relVelX, relVelY, scale);
        break;
    }

    // Selection indicator.
    if (selectedAsteroidId && asteroid.id === selectedAsteroidId) {
      const selG = acquireGraphics();
      s.asteroidsContainer.addChild(selG);
      _renderSelectionIndicator(selG, screenX, screenY, screenRadius);
    }
  }
}
