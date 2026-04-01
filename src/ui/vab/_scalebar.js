/**
 * _scalebar.js — Scale bar tick drawing and extent updates.
 */

import { getPartById } from '../../data/parts.js';
import {
  VAB_TOOLBAR_HEIGHT,
  VAB_PIXELS_PER_METRE,
  vabGetCamera,
} from '../../render/vab.js';
import { getVabState } from './_state.js';

/**
 * Regenerate the scale-bar tick marks to match the current camera state.
 * This is called on init, on window resize, and whenever the camera moves.
 */
export function drawScaleTicks() {
  const S = getVabState();
  if (!S.scaleTicks || S.buildAreaHeight === 0) return;

  const { zoom, y: camY } = vabGetCamera();
  const pxPerMetre = VAB_PIXELS_PER_METRE * zoom;
  const h = S.buildAreaHeight;

  const scaleBarTop    = S.scaleTicks.getBoundingClientRect().top;
  const adjustedCamY   = VAB_TOOLBAR_HEIGHT + camY - scaleBarTop;

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

  const frags = [];
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

  // Draw rocket extent markers.
  updateScaleBarExtents();
}

/**
 * Draw 'Top' and 'Bottom' extent markers on the scale bar based on placed parts.
 * Also draws a mid-point bracket label showing total rocket height.
 */
export function updateScaleBarExtents() {
  const S = getVabState();

  // Remove existing extent elements.
  const existingExtents = S.scaleTicks?.querySelectorAll('.vab-tick-extent');
  existingExtents?.forEach((el) => el.remove());

  if (!S.scaleTicks || S.buildAreaHeight === 0 || !S.assembly || S.assembly.parts.size === 0) return;

  const { zoom, y: camY } = vabGetCamera();
  const h = S.buildAreaHeight;

  const scaleBarTop  = S.scaleTicks.getBoundingClientRect().top;
  const adjustedCamY = VAB_TOOLBAR_HEIGHT + camY - scaleBarTop;

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

  const topBarY    = adjustedCamY - maxWorldY * zoom;
  const bottomBarY = adjustedCamY - minWorldY * zoom;
  const midBarY    = (topBarY + bottomBarY) / 2;
  const heightM    = (maxWorldY - minWorldY) / VAB_PIXELS_PER_METRE;

  // Add Top marker if on screen.
  if (topBarY >= 0 && topBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${topBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label" style="color:#4ab870">Top</span>` +
      `<span style="position:absolute;right:0;width:16px;height:1px;background:#4ab870;top:0"></span>`;
    S.scaleTicks.appendChild(el);
  }

  // Add Bottom marker if on screen.
  if (bottomBarY >= 0 && bottomBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${bottomBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label" style="color:#4ab870">Bot</span>` +
      `<span style="position:absolute;right:0;width:16px;height:1px;background:#4ab870;top:0"></span>`;
    S.scaleTicks.appendChild(el);
  }

  // Add mid-point height label if both markers are on screen.
  if (midBarY >= 0 && midBarY <= h && topBarY >= 0 && bottomBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${midBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label" style="color:#c0a040;font-size:7px">&#x21D5;${heightM.toFixed(1)}m</span>`;
    S.scaleTicks.appendChild(el);
  }
}
