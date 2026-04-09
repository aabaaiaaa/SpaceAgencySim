/**
 * _transferObjects.ts — Render nearby objects during TRANSFER phase.
 *
 * Uses velocity-based LOD:
 *   - Full: functional parts rendered (similar speed objects)
 *   - Basic: simple shape, no parts (medium speed)
 *   - Streak: shooting star trail effect (very fast objects)
 *
 * @module render/flight/_transferObjects
 */

import type { ProximityObject } from '../../core/transferObjects.ts';
import { getFlightRenderState } from './_state.ts';
import { acquireGraphics, releaseContainerChildren } from './_pool.ts';
import { ppm } from './_camera.ts';

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const ASTEROID_COLOR   = 0x886644;
const CRAFT_COLOR      = 0x88aacc;
const DEBRIS_COLOR     = 0x666666;
const STREAK_COLOR     = 0xffcc44;
const STREAK_TRAIL     = 0xff8800;

function objectColor(type: string): number {
  switch (type) {
    case 'asteroid': return ASTEROID_COLOR;
    case 'craft':    return CRAFT_COLOR;
    case 'debris':   return DEBRIS_COLOR;
    default:         return 0xaaaaaa;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render nearby transfer objects in the flight view.
 *
 * @param objects  Proximity objects (already filtered to render distance).
 * @param w       Canvas width.
 * @param h       Canvas height.
 * @param craftPosX  Craft position X (for relative positioning).
 * @param craftPosY  Craft position Y.
 */
export function renderTransferObjects(
  objects: readonly ProximityObject[],
  w: number,
  h: number,
  craftPosX: number,
  craftPosY: number,
): void {
  const s = getFlightRenderState();
  if (!s.transferObjectsContainer) return;

  releaseContainerChildren(s.transferObjectsContainer);
  if (objects.length === 0) return;

  const scale = ppm(); // pixels per metre
  const cx = w / 2;    // screen centre (craft position)
  const cy = h / 2;

  for (const obj of objects) {
    const g = acquireGraphics();
    s.transferObjectsContainer.addChild(g);

    // Screen position relative to craft.
    const screenX = cx + (obj.posX - craftPosX) * scale;
    const screenY = cy - (obj.posY - craftPosY) * scale; // Y inverted

    // Object size on screen (minimum 3px for visibility).
    const screenRadius = Math.max(3, obj.radius * scale);

    switch (obj.lod) {
      case 'full':
        // Full render: detailed shape with colour.
        _renderFullObject(g, screenX, screenY, screenRadius, obj);
        break;

      case 'basic':
        // Basic: simple circle, no detail.
        _renderBasicObject(g, screenX, screenY, screenRadius, obj);
        break;

      case 'streak':
        // Streak: shooting star effect with trail.
        _renderStreakObject(g, screenX, screenY, obj, craftPosX, craftPosY, scale);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// LOD renderers
// ---------------------------------------------------------------------------

function _renderFullObject(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number, radius: number,
  obj: ProximityObject,
): void {
  const color = objectColor(obj.type);

  // Main body.
  g.circle(x, y, radius);
  g.fill({ color, alpha: 1.0 });

  // Outline for visibility.
  g.circle(x, y, radius + 1);
  g.stroke({ width: 1, color: 0xffffff, alpha: 0.3 });

  // Type-specific details.
  if (obj.type === 'asteroid') {
    // Rough surface: a few smaller circles overlapping.
    g.circle(x - radius * 0.3, y - radius * 0.2, radius * 0.4);
    g.fill({ color: color - 0x111111, alpha: 0.6 });
    g.circle(x + radius * 0.2, y + radius * 0.3, radius * 0.3);
    g.fill({ color: color + 0x111111, alpha: 0.6 });
  } else if (obj.type === 'craft') {
    // Solar panels: two rectangles.
    g.rect(x - radius * 2, y - radius * 0.2, radius * 1.2, radius * 0.4);
    g.fill({ color: 0x3366aa, alpha: 0.8 });
    g.rect(x + radius * 0.8, y - radius * 0.2, radius * 1.2, radius * 0.4);
    g.fill({ color: 0x3366aa, alpha: 0.8 });
  }
}

function _renderBasicObject(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number, radius: number,
  obj: ProximityObject,
): void {
  const color = objectColor(obj.type);

  // Simple filled circle — no detail.
  g.circle(x, y, radius);
  g.fill({ color, alpha: 0.8 });
}

function _renderStreakObject(
  g: ReturnType<typeof acquireGraphics>,
  x: number, y: number,
  obj: ProximityObject,
  craftPosX: number, craftPosY: number,
  scale: number,
): void {
  // Trail direction: opposite to relative velocity.
  const dvx = obj.velX - 0; // Approximate: craft velocity not passed, but direction is from angle.
  const dvy = obj.velY - 0;
  const speed = Math.hypot(dvx, dvy);
  if (speed < 1) return;

  // Trail length proportional to speed (capped).
  const trailLength = Math.min(200, speed * scale * 0.05);

  // Direction of motion.
  const dx = dvx / speed;
  const dy = dvy / speed;

  // Draw the streak: bright head + fading trail.
  const headX = x;
  const headY = y;
  const tailX = headX - dx * trailLength * scale;
  const tailY = headY + dy * trailLength * scale; // Y inverted

  // Trail gradient: multiple segments fading out.
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
    g.stroke({ width, color: i === 0 ? STREAK_COLOR : STREAK_TRAIL, alpha });
  }

  // Bright head dot.
  g.circle(headX, headY, 3);
  g.fill({ color: STREAK_COLOR, alpha: 1.0 });
}
