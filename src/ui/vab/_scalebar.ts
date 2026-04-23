/**
 * _scalebar.ts — Scale bar tick drawing and extent updates.
 */

import { getPartById } from '../../data/parts.ts';
import {
  VAB_TOOLBAR_HEIGHT,
  VAB_PIXELS_PER_METRE,
  vabGetCamera,
} from '../../render/vab.ts';
import { VAB_MAX_HEIGHT, FacilityId } from '../../core/constants.ts';
import { getFacilityTier } from '../../core/construction.ts';
import { getVabState } from './_state.ts';

/**
 * Find the lowest world-Y across all placed parts (pixel units).
 * Returns null when no parts are placed.
 */
function _getRocketBottomWorldY(): number | null {
  const S = getVabState();
  if (!S.assembly || S.assembly.parts.size === 0) return null;
  let minY = Infinity;
  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    const bottom = placed.y - def.height / 2;
    if (bottom < minY) minY = bottom;
  }
  return isFinite(minY) ? minY : null;
}

/**
 * Regenerate the scale-bar tick marks to match the current camera state.
 * This is called on init, on window resize, and whenever the camera moves.
 *
 * The "0m" reference tracks the rocket's lowest point when any parts are
 * placed — so the max-height marker always represents room *above the
 * current craft* rather than above an arbitrary world origin.  With no
 * parts, 0m is the world origin (launch pad line).
 */
export function drawScaleTicks(): void {
  const S = getVabState();
  if (!S.scaleTicks || S.buildAreaHeight === 0) return;

  const { zoom, y: camY } = vabGetCamera();
  const pxPerMetre = VAB_PIXELS_PER_METRE * zoom;
  const h = S.buildAreaHeight;

  const scaleBarTop  = S.scaleTicks.getBoundingClientRect().top;
  const anchorWorldY = _getRocketBottomWorldY() ?? 0;
  // Screen Y of the 0m anchor (either rocket bottom or world origin).
  const adjustedCamY = VAB_TOOLBAR_HEIGHT + camY - scaleBarTop - anchorWorldY * zoom;

  // Choose a readable tick interval (in metres) based on current zoom.
  let tickM = 1;
  if      (pxPerMetre < 5)   tickM = 200;
  else if (pxPerMetre < 10)  tickM = 100;
  else if (pxPerMetre < 20)  tickM = 50;
  else if (pxPerMetre < 40)  tickM = 10;
  else if (pxPerMetre < 80)  tickM = 5;
  else if (pxPerMetre < 160) tickM = 2;

  const majorEvery = 5; // label every Nth tick

  // Altitude at the top and bottom of the scale bar.
  const topM  = adjustedCamY / pxPerMetre;
  const botM  = (adjustedCamY - h) / pxPerMetre;

  const startM = Math.ceil(botM  / tickM) * tickM;
  const endM   = Math.floor(topM / tickM) * tickM;

  const frags: string[] = [];
  let idx = 0;

  // Always show 0m tick if it's on screen.
  const zeroBarY = adjustedCamY; // 0m world = adjustedCamY screen offset
  const zeroVisible = zeroBarY >= 0 && zeroBarY <= h;

  for (let m = startM; m <= endM; m += tickM, idx++) {
    const barY = adjustedCamY - m * pxPerMetre;
    if (barY < 0 || barY > h) continue;

    const isMajor = m === 0 || idx % majorEvery === 0;
    frags.push(
      `<div class="vab-tick ${isMajor ? 'vab-tick-major' : 'vab-tick-minor'}" ` +
        `style="top:${barY.toFixed(1)}px">` +
        (isMajor ? `<span class="vab-tick-label">${m}m</span>` : '') +
      `</div>`,
    );
  }

  // If 0m wasn't hit by the regular loop but is visible, add it explicitly.
  if (zeroVisible && (startM > 0 || endM < 0)) {
    frags.push(
      `<div class="vab-tick vab-tick-major" style="top:${zeroBarY.toFixed(1)}px">` +
        `<span class="vab-tick-label">0m</span>` +
      `</div>`,
    );
  }

  S.scaleTicks.innerHTML = frags.join('');

  // Draw the VAB's maximum-height marker (tier-gated).
  _drawMaxHeightMarker(adjustedCamY, pxPerMetre, h);

  // Draw rocket extent markers.
  updateScaleBarExtents();
}

/**
 * Draw a horizontal "max build height" guide line on the scale bar so the
 * player can see at a glance how tall the current VAB tier allows.  No
 * marker is drawn when the tier is unlimited (Infinity).
 */
function _drawMaxHeightMarker(adjustedCamY: number, pxPerMetre: number, h: number): void {
  const S = getVabState();
  if (!S.scaleTicks || !S.gameState) return;

  const vabTier = getFacilityTier(S.gameState, FacilityId.VAB);
  const maxWorldPx = VAB_MAX_HEIGHT[vabTier] ?? VAB_MAX_HEIGHT[1];
  if (!isFinite(maxWorldPx)) return; // Tier 3: unlimited — no line to draw.

  // Convert: VAB_MAX_HEIGHT is in world pixels; world coords use
  // VAB_PIXELS_PER_METRE (20 px = 1 m).
  const maxMetres = maxWorldPx / VAB_PIXELS_PER_METRE;

  // World-Y of the cap (relative to launch pad at Y=0, positive = up).
  // pxPerMetre already includes the current zoom, so metres * pxPerMetre
  // gives the screen-space offset from the 0m baseline.
  const barY = adjustedCamY - maxMetres * pxPerMetre;
  if (barY < 0 || barY > h) return; // Off-screen at current scroll.

  const el = document.createElement('div');
  el.className = 'vab-tick vab-tick-max-height';
  el.style.top = `${barY.toFixed(1)}px`;
  el.innerHTML =
    `<span class="vab-tick-label vab-tick-max-height-label">Max ${maxMetres}m</span>` +
    `<span class="vab-tick-max-height-line"></span>`;
  S.scaleTicks.appendChild(el);
}

/**
 * Draw 'Top' and 'Bottom' extent markers on the scale bar based on placed parts.
 * Also draws a mid-point bracket label showing total rocket height.
 */
export function updateScaleBarExtents(): void {
  const S = getVabState();

  // Remove existing extent elements.
  const existingExtents = S.scaleTicks?.querySelectorAll('.vab-tick-extent');
  existingExtents?.forEach((el) => el.remove());

  if (!S.scaleTicks || S.buildAreaHeight === 0 || !S.assembly || S.assembly.parts.size === 0) return;

  const { zoom, y: camY } = vabGetCamera();
  const h = S.buildAreaHeight;

  // Find the world-Y extent of all placed parts.
  let maxWorldY = -Infinity;
  let minWorldY = Infinity;

  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    const top    = placed.y + def.height / 2;
    const bottom = placed.y - def.height / 2;
    if (top    > maxWorldY) maxWorldY = top;
    if (bottom < minWorldY) minWorldY = bottom;
  }

  if (!isFinite(maxWorldY) || !isFinite(minWorldY)) return;

  // Anchor adjustedCamY to the rocket's bottom (the 0m reference) so the
  // Top / Bot markers align with the re-anchored tick grid.
  const scaleBarTop  = S.scaleTicks.getBoundingClientRect().top;
  const adjustedCamY = VAB_TOOLBAR_HEIGHT + camY - scaleBarTop - minWorldY * zoom;

  const rocketHeightPx = (maxWorldY - minWorldY) * zoom;
  const topBarY    = adjustedCamY - rocketHeightPx;
  const bottomBarY = adjustedCamY;
  const midBarY    = (topBarY + bottomBarY) / 2;
  const heightM    = (maxWorldY - minWorldY) / VAB_PIXELS_PER_METRE;

  // Add Top marker if on screen.
  if (topBarY >= 0 && topBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${topBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label vab-tick-extent-label">Top</span>` +
      `<span class="vab-tick-extent-line"></span>`;
    S.scaleTicks.appendChild(el);
  }

  // Add Bottom marker if on screen.
  if (bottomBarY >= 0 && bottomBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${bottomBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label vab-tick-extent-label">Bot</span>` +
      `<span class="vab-tick-extent-line"></span>`;
    S.scaleTicks.appendChild(el);
  }

  // Add mid-point height label if both markers are on screen.
  if (midBarY >= 0 && midBarY <= h && topBarY >= 0 && bottomBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${midBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label vab-tick-height-label">&#x21D5;${heightM.toFixed(1)}m</span>`;
    S.scaleTicks.appendChild(el);
  }
}
