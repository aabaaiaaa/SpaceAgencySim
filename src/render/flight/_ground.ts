/**
 * _ground.ts — Ground band rendering, surface items, and biome labels.
 */

import * as PIXI from 'pixi.js';
import { SurfaceItemType } from '../../core/constants.js';
import { getBiome, getBiomeTransition } from '../../core/biomes.js';
import type { SurfaceItem } from '../../core/gameState.js';
import { getFlightRenderState } from './_state.js';
import { ppm } from './_camera.js';
import { acquireText, releaseContainerChildren } from './_pool.js';
import { SURFACE_ITEM_COLORS, BIOME_LABEL_FADE_SPEED } from './_constants.js';

// ---------------------------------------------------------------------------
// Ground rendering
// ---------------------------------------------------------------------------

/**
 * Draw the ground band below world Y = 0.
 */
export function renderGround(w: number, h: number): void {
  const s = getFlightRenderState();
  if (!s.groundGraphics) return;
  s.groundGraphics.clear();

  const groundScreenY = h / 2 + s.camWorldY * ppm();

  if (groundScreenY >= h) return;

  const drawY = Math.max(0, groundScreenY);
  const drawH = h - drawY;
  s.groundGraphics.rect(0, drawY, w, drawH);
  s.groundGraphics.fill({ color: s.bodyVisuals.ground });
}

// ---------------------------------------------------------------------------
// Surface item rendering
// ---------------------------------------------------------------------------

/**
 * Render deployed surface items on the ground surface.
 */
export function renderSurfaceItems(items: SurfaceItem[], w: number, h: number): void {
  const s = getFlightRenderState();
  if (!s.surfaceItemsGraphics) return;
  s.surfaceItemsGraphics.clear();

  if (!items || items.length === 0) return;

  const p = ppm();
  const groundScreenY = h / 2 + s.camWorldY * p;

  if (groundScreenY < -50 || groundScreenY > h + 50) return;

  for (const item of items) {
    const sx = w / 2 + (item.posX - s.camWorldX) * p;

    if (sx < -50 || sx > w + 50) continue;

    const color = SURFACE_ITEM_COLORS[item.type] || 0xffffff;

    switch (item.type) {
      case SurfaceItemType.FLAG: {
        const poleH = 20 * (s.zoomLevel || 1);
        const flagW = 12 * (s.zoomLevel || 1);
        const flagH = 8 * (s.zoomLevel || 1);
        s.surfaceItemsGraphics.rect(sx - 1, groundScreenY - poleH, 2, poleH);
        s.surfaceItemsGraphics.fill({ color: 0xcccccc });
        s.surfaceItemsGraphics.rect(sx + 1, groundScreenY - poleH, flagW, flagH);
        s.surfaceItemsGraphics.fill({ color });
        break;
      }
      case SurfaceItemType.SURFACE_SAMPLE: {
        const r = 4 * (s.zoomLevel || 1);
        s.surfaceItemsGraphics.circle(sx, groundScreenY - r, r);
        s.surfaceItemsGraphics.fill({ color, alpha: 0.8 });
        break;
      }
      case SurfaceItemType.SURFACE_INSTRUMENT: {
        const sz = 6 * (s.zoomLevel || 1);
        s.surfaceItemsGraphics.moveTo(sx, groundScreenY - sz * 2);
        s.surfaceItemsGraphics.lineTo(sx - sz, groundScreenY);
        s.surfaceItemsGraphics.lineTo(sx + sz, groundScreenY);
        s.surfaceItemsGraphics.closePath();
        s.surfaceItemsGraphics.fill({ color, alpha: 0.9 });
        break;
      }
      case SurfaceItemType.BEACON: {
        const sz = 5 * (s.zoomLevel || 1);
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 500);
        s.surfaceItemsGraphics.moveTo(sx, groundScreenY - sz * 2);
        s.surfaceItemsGraphics.lineTo(sx - sz, groundScreenY - sz);
        s.surfaceItemsGraphics.lineTo(sx, groundScreenY);
        s.surfaceItemsGraphics.lineTo(sx + sz, groundScreenY - sz);
        s.surfaceItemsGraphics.closePath();
        s.surfaceItemsGraphics.fill({ color, alpha: pulse });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Biome label rendering
// ---------------------------------------------------------------------------

/**
 * Render the current biome name as a centered label at the top of the screen.
 */
export function renderBiomeLabel(altitude: number, w: number, h: number, dt: number, bodyId?: string): void {
  const s = getFlightRenderState();
  if (!s.biomeLabelContainer) return;

  releaseContainerChildren(s.biomeLabelContainer);

  const biomeBodyId = bodyId || 'EARTH';
  const biome = getBiome(altitude, biomeBodyId);
  if (!biome) return;

  const transition = getBiomeTransition(altitude, biomeBodyId);

  let displayName = biome.name;
  let targetAlpha = 1.0;

  if (transition) {
    if (transition.ratio < 0.5) {
      displayName = transition.from.name;
      targetAlpha = 1.0 - (transition.ratio / 0.5);
    } else {
      displayName = transition.to.name;
      targetAlpha = (transition.ratio - 0.5) / 0.5;
    }
  }

  if (displayName !== s.currentBiomeName) {
    s.currentBiomeName = displayName;
    s.biomeLabelAlpha = 0;
  }

  if (s.biomeLabelAlpha < targetAlpha) {
    s.biomeLabelAlpha = Math.min(targetAlpha, s.biomeLabelAlpha + BIOME_LABEL_FADE_SPEED * dt);
  } else if (s.biomeLabelAlpha > targetAlpha) {
    s.biomeLabelAlpha = Math.max(targetAlpha, s.biomeLabelAlpha - BIOME_LABEL_FADE_SPEED * dt);
  }

  if (s.biomeLabelAlpha <= 0.01) return;

  const multiplierText = `${biome.scienceMultiplier}\u00d7 Science`;
  const label = acquireText();
  label.text = displayName;
  label.style = new PIXI.TextStyle({
    fill: '#a8e8c0',
    fontSize: 16,
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 'bold',
    dropShadow: {
      color: '#000000',
      blur: 4,
      distance: 1,
    },
  });
  label.anchor.set(0.5, 0);
  label.x = w / 2;
  label.y = 70;
  label.alpha = s.biomeLabelAlpha * 0.85;

  const subLabel = acquireText();
  subLabel.text = multiplierText;
  subLabel.style = new PIXI.TextStyle({
    fill: '#70b880',
    fontSize: 11,
    fontFamily: 'system-ui, sans-serif',
    dropShadow: {
      color: '#000000',
      blur: 3,
      distance: 1,
    },
  });
  subLabel.anchor.set(0.5, 0);
  subLabel.x = w / 2;
  subLabel.y = 90;
  subLabel.alpha = s.biomeLabelAlpha * 0.65;

  s.biomeLabelContainer.addChild(label);
  s.biomeLabelContainer.addChild(subLabel);
}
