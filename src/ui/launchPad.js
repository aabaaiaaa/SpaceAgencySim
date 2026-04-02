/**
 * launchPad.js — Launch Pad Building HTML overlay UI.
 *
 * Displays previously launched rocket designs and allows the player to
 * relaunch them directly.  Each saved design (stored in gameState.rockets)
 * is shown as a card with name, stats, and a Launch button.
 *
 * Launch flow:
 *   1. Player selects a rocket design card and clicks Launch.
 *   2. The assembly and staging config are reconstructed from the saved design.
 *   3. If the rocket has crew seats, a crew assignment dialog is shown.
 *   4. A FlightState is created and the flight scene is started.
 *   5. On flight end, the player returns to the hub with optional results.
 *
 * @module launchPad
 */

import { getPartById } from '../data/parts.js';
import { PartType, FacilityId, LAUNCH_PAD_MAX_MASS, LAUNCH_PAD_TIER_LABELS } from '../core/constants.js';
import { getCurrentWeather, getWeatherSkipCost, skipWeather } from '../core/weather.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
} from '../core/rocketbuilder.js';
import { getActiveCrew } from '../core/crew.js';
import { getFacilityTier } from '../core/construction.js';
import { getTotalMass } from '../core/rocketvalidator.js';
import { createFlightState } from '../core/gameState.js';
import { startFlightScene } from './flightController.js';
import { showReturnResultsOverlay } from './hub.js';
import { renderRocketPreview, buildRocketCard, injectRocketCardCSS } from './rocketCardUtil.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const LAUNCH_PAD_STYLES = `
/* ── Launch Pad overlay ────────────────────────────────────────────────────── */
#launch-pad-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 20, 0.96);
  z-index: 20;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  font-family: system-ui, sans-serif;
  color: #e8e8e8;
  /* leave room for the persistent top bar (approx 44px) */
  padding-top: 44px;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
#launch-pad-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px 0;
  flex-shrink: 0;
}

#launch-pad-back-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.85rem;
  padding: 6px 14px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
#launch-pad-back-btn:hover {
  background: rgba(255,255,255,0.16);
}

#launch-pad-title {
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #f0f0f0;
  margin: 0;
}

/* ── Content area ────────────────────────────────────────────────────────── */
#launch-pad-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  gap: 16px;
  overflow-y: auto;
}

#launch-pad-status {
  font-size: 1.1rem;
  color: #8090a8;
  text-align: center;
}

#launch-pad-hint {
  font-size: 0.88rem;
  color: #5a6880;
  text-align: center;
  font-style: italic;
  max-width: 420px;
  line-height: 1.55;
}

/* ── Rocket list ─────────────────────────────────────────────────────────── */
#launch-pad-rocket-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 600px;
}

.lp-rocket-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: background 0.15s;
}
.lp-rocket-card:hover {
  background: rgba(255,255,255,0.07);
}

.lp-rocket-preview {
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px;
  background: rgba(0,0,0,0.3);
}

.lp-rocket-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.lp-rocket-name {
  font-size: 1rem;
  font-weight: 600;
  color: #e8e8e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lp-rocket-stats {
  font-size: 0.78rem;
  color: #7888a0;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.lp-rocket-date {
  font-size: 0.72rem;
  color: #5a6880;
}

.lp-launch-btn {
  background: #2a6040;
  border: 1px solid rgba(255,255,255,0.15);
  color: #e8e8e8;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 8px 20px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
}
.lp-launch-btn:hover:not(:disabled) {
  background: #357a50;
}
.lp-launch-btn:disabled {
  background: #3a3a3a;
  color: #666;
  cursor: not-allowed;
  border-color: rgba(255,255,255,0.08);
}

.lp-rocket-cost {
  font-size: 0.82rem;
  font-weight: 600;
  color: #80c8a0;
}
.lp-rocket-cost-insufficient {
  color: #c07040;
}

/* ── Crew dialog ─────────────────────────────────────────────────────────── */
#lp-crew-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}
#lp-crew-dialog {
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  padding: 20px;
  min-width: 280px;
  max-width: 360px;
  color: #e8e8e8;
  font-family: system-ui, sans-serif;
}
.lp-crew-dlg-hdr {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 12px;
  text-align: center;
}
.lp-crew-seat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.lp-crew-seat-label {
  font-size: 0.85rem;
  color: #a0b0c0;
}
.lp-crew-seat-select {
  background: #222838;
  border: 1px solid rgba(255,255,255,0.15);
  color: #e8e8e8;
  font-size: 0.82rem;
  padding: 4px 8px;
  border-radius: 4px;
  max-width: 180px;
}
.lp-crew-dlg-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}
.lp-crew-dlg-footer button {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.82rem;
  padding: 6px 16px;
  border-radius: 5px;
  cursor: pointer;
}
.lp-crew-dlg-footer .lp-crew-confirm-btn {
  background: #2a6040;
}
.lp-crew-dlg-footer .lp-crew-confirm-btn:hover {
  background: #357a50;
}
`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The root overlay element. @type {HTMLElement | null} */
let _overlay = null;

/** The #ui-overlay container reference. @type {HTMLElement | null} */
let _container = null;

/** The game state reference. @type {import('../core/gameState.js').GameState | null} */
let _state = null;

/** Callback to navigate back to the hub. @type {(() => void) | null} */
let _onBack = null;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a number with commas.
 * @param {number} n
 * @returns {string}
 */
function _fmt(n) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Format a dollar amount.
 * @param {number} n
 * @returns {string}
 */
function _fmt$(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/**
 * Compute the total cost of a rocket design by summing part costs.
 * @param {import('../core/gameState.js').RocketDesign} design
 * @returns {number}
 */
function _computeDesignCost(design) {
  let total = 0;
  for (const part of design.parts) {
    const def = getPartById(part.partId);
    if (def) total += def.cost;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Rocket preview rendering (Canvas 2D)
// ---------------------------------------------------------------------------

/** Part fill colours keyed by PartType (CSS hex strings). */
const PART_FILL = {
  [PartType.COMMAND_MODULE]:       '#1a3860',
  [PartType.COMPUTER_MODULE]:      '#122848',
  [PartType.SERVICE_MODULE]:       '#1c2c58',
  [PartType.FUEL_TANK]:            '#0e2040',
  [PartType.ENGINE]:               '#3a1a08',
  [PartType.SOLID_ROCKET_BOOSTER]: '#301408',
  [PartType.STACK_DECOUPLER]:      '#142030',
  [PartType.RADIAL_DECOUPLER]:     '#142030',
  [PartType.DECOUPLER]:            '#142030',
  [PartType.LANDING_LEG]:          '#102018',
  [PartType.LANDING_LEGS]:         '#102018',
  [PartType.PARACHUTE]:            '#2e1438',
  [PartType.SATELLITE]:            '#142240',
  [PartType.HEAT_SHIELD]:          '#2c1000',
  [PartType.RCS_THRUSTER]:         '#182c30',
  [PartType.SOLAR_PANEL]:          '#0a2810',
  [PartType.LAUNCH_CLAMP]:         '#2a2818',
};

/** Part stroke colours keyed by PartType (CSS hex strings). */
const PART_STROKE = {
  [PartType.COMMAND_MODULE]:       '#4080c0',
  [PartType.COMPUTER_MODULE]:      '#2870a0',
  [PartType.SERVICE_MODULE]:       '#3860b0',
  [PartType.FUEL_TANK]:            '#2060a0',
  [PartType.ENGINE]:               '#c06020',
  [PartType.SOLID_ROCKET_BOOSTER]: '#a04818',
  [PartType.STACK_DECOUPLER]:      '#305080',
  [PartType.RADIAL_DECOUPLER]:     '#305080',
  [PartType.DECOUPLER]:            '#305080',
  [PartType.LANDING_LEG]:          '#207840',
  [PartType.LANDING_LEGS]:         '#207840',
  [PartType.PARACHUTE]:            '#8040a0',
  [PartType.SATELLITE]:            '#2868b0',
  [PartType.HEAT_SHIELD]:          '#a04010',
  [PartType.RCS_THRUSTER]:         '#2890a0',
  [PartType.SOLAR_PANEL]:          '#20a040',
  [PartType.LAUNCH_CLAMP]:         '#807040',
};

const PREVIEW_W = 80;
const PREVIEW_H = 120;
const PREVIEW_PAD = 6;

/**
 * Draw a miniature rocket preview onto a 2D canvas element.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {import('../core/gameState.js').RocketDesign} design
 */
function _renderRocketPreview(canvas, design) {
  canvas.width  = PREVIEW_W;
  canvas.height = PREVIEW_H;
  canvas.className = 'lp-rocket-preview';

  const ctx = canvas.getContext('2d');
  if (!ctx || !design.parts || design.parts.length === 0) return;

  // Resolve part defs and compute bounding box.
  const resolved = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of design.parts) {
    const def = getPartById(p.partId);
    if (!def) continue;
    const hw = (def.width  ?? 40) / 2;
    const hh = (def.height ?? 20) / 2;
    const px = p.position.x;
    const py = p.position.y;
    minX = Math.min(minX, px - hw);
    maxX = Math.max(maxX, px + hw);
    minY = Math.min(minY, py - hh);
    maxY = Math.max(maxY, py + hh);
    resolved.push({ px, py, hw, hh, def });
  }

  if (resolved.length === 0) return;

  const rocketW = maxX - minX;
  const rocketH = maxY - minY;

  // Scale to fit canvas with padding, preserving aspect ratio.
  const drawW = PREVIEW_W - PREVIEW_PAD * 2;
  const drawH = PREVIEW_H - PREVIEW_PAD * 2;
  const scale = Math.min(drawW / Math.max(rocketW, 1), drawH / Math.max(rocketH, 1));

  const cx = PREVIEW_W  / 2;
  const cy = PREVIEW_H / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  for (const { px, py, hw, hh, def } of resolved) {
    // Canvas coords: centre on canvas, Y-up → Y-down flip.
    const sx = cx + (px - midX) * scale;
    const sy = cy - (py - midY) * scale;
    const sw = hw * 2 * scale;
    const sh = hh * 2 * scale;

    ctx.fillStyle   = PART_FILL[def.type]   ?? '#0e2040';
    ctx.strokeStyle = PART_STROKE[def.type]  ?? '#2060a0';
    ctx.lineWidth   = 1;
    ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);
    ctx.strokeRect(sx - sw / 2, sy - sh / 2, sw, sh);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Launch Pad overlay.
 *
 * @param {HTMLElement} container   The #ui-overlay div.
 * @param {import('../core/gameState.js').GameState} state
 * @param {{ onBack: () => void }} callbacks
 */
export function initLaunchPadUI(container, state, { onBack }) {
  _container = container;
  _state     = state;
  _onBack    = onBack;

  // Inject CSS once.
  injectRocketCardCSS();
  if (!document.getElementById('launch-pad-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'launch-pad-styles';
    styleEl.textContent = LAUNCH_PAD_STYLES;
    document.head.appendChild(styleEl);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'launch-pad-overlay';
  container.appendChild(_overlay);

  _renderShell();

  console.log('[Launch Pad UI] Initialized');
}

/**
 * Remove the Launch Pad overlay from the DOM.
 */
export function destroyLaunchPadUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _container = null;
  _state     = null;
  _onBack    = null;
  console.log('[Launch Pad UI] Destroyed');
}

// ---------------------------------------------------------------------------
// Private — rendering
// ---------------------------------------------------------------------------

/**
 * Build the screen layout: header with back button + rocket list or
 * empty-state placeholder.
 */
function _renderShell() {
  if (!_overlay || !_state) return;

  // Header
  const header = document.createElement('div');
  header.id = 'launch-pad-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'launch-pad-back-btn';
  backBtn.textContent = '\u2190 Hub';
  backBtn.addEventListener('click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroyLaunchPadUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const padTier = getFacilityTier(_state, FacilityId.LAUNCH_PAD);
  const padTierLabel = LAUNCH_PAD_TIER_LABELS[padTier] || '';
  const title = document.createElement('h1');
  title.id = 'launch-pad-title';
  title.textContent = `Launch Pad \u2014 Tier ${padTier}` + (padTierLabel ? ` (${padTierLabel})` : '');
  header.appendChild(title);

  // Show pad capability details
  const maxMass = LAUNCH_PAD_MAX_MASS[padTier] ?? LAUNCH_PAD_MAX_MASS[1];
  const tierInfo = document.createElement('span');
  tierInfo.style.cssText =
    'font-size:0.82rem;color:#6888a8;margin-left:auto;padding:4px 12px;' +
    'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);' +
    'border-radius:4px;white-space:nowrap;';
  const massLabel = isFinite(maxMass) ? `${(maxMass / 1000).toFixed(0)}t` : 'Unlimited';
  const features = [];
  if (padTier >= 2) features.push('Fuel Top-Off');
  if (padTier >= 3) features.push('Launch Clamps');
  const featureStr = features.length > 0 ? ` | ${features.join(', ')}` : '';
  tierInfo.textContent = `Max Mass: ${massLabel}${featureStr}`;
  header.appendChild(tierInfo);

  _overlay.appendChild(header);

  // Weather bar with skip button
  _renderWeatherBar();

  // Content
  const content = document.createElement('div');
  content.id = 'launch-pad-content';

  const rockets = _state.rockets;

  if (!rockets || rockets.length === 0) {
    // Empty state
    const status = document.createElement('p');
    status.id = 'launch-pad-status';
    status.textContent = 'No rockets are ready for launch.';
    content.appendChild(status);

    const hint = document.createElement('p');
    hint.id = 'launch-pad-hint';
    hint.textContent =
      'Build a rocket in the Vehicle Assembly Building and launch it. ' +
      'Previously launched designs will appear here for relaunch.';
    content.appendChild(hint);
  } else {
    // Rocket list
    const list = document.createElement('div');
    list.id = 'launch-pad-rocket-list';

    for (const design of rockets) {
      list.appendChild(_buildRocketCard(design));
    }

    content.appendChild(list);
  }

  _overlay.appendChild(content);
}

/**
 * Render a compact weather info bar at the top of the launch pad with a Skip Day button.
 */
function _renderWeatherBar() {
  if (!_overlay || !_state) return;

  // Remove stale bar.
  const existing = document.getElementById('lp-weather-bar');
  if (existing) existing.remove();

  const weather = getCurrentWeather(_state);
  if (weather.description === 'No atmosphere') return;

  const bar = document.createElement('div');
  bar.id = 'lp-weather-bar';
  bar.style.cssText =
    'display:flex;align-items:center;justify-content:space-between;gap:16px;' +
    'padding:10px 20px;margin:0 20px 8px;' +
    'background:rgba(10,20,40,0.85);border:1px solid #304868;border-radius:8px;' +
    'color:#c8dce8;font-size:0.82rem;font-family:system-ui,sans-serif;';

  // Weather summary
  const info = document.createElement('div');
  info.style.cssText = 'display:flex;gap:16px;align-items:center;flex-wrap:wrap;';

  const descSpan = document.createElement('span');
  descSpan.style.fontWeight = '600';
  descSpan.style.fontSize = '0.9rem';
  if (weather.extreme) {
    descSpan.style.color = '#ff6060';
  } else if (weather.windSpeed < 6) {
    descSpan.style.color = '#50d870';
  } else {
    descSpan.style.color = '#e0c050';
  }
  descSpan.textContent = weather.description;
  info.appendChild(descSpan);

  const windSpan = document.createElement('span');
  windSpan.style.color = '#7090a0';
  windSpan.textContent = `Wind: ${weather.windSpeed.toFixed(1)} m/s`;
  info.appendChild(windSpan);

  const tempPct = ((weather.temperature - 1) * 100).toFixed(1);
  const tempSpan = document.createElement('span');
  tempSpan.style.color = '#7090a0';
  tempSpan.textContent = `ISP: ${weather.temperature >= 1 ? '+' : ''}${tempPct}%`;
  info.appendChild(tempSpan);

  bar.appendChild(info);

  // Skip button
  const skipCost = getWeatherSkipCost(_state);
  const canAfford = _state.money >= skipCost;

  const skipBtn = document.createElement('button');
  skipBtn.id = 'lp-weather-skip-btn';
  skipBtn.style.cssText =
    'padding:7px 18px;background:#1a3060;border:1px solid #3070b0;border-radius:6px;' +
    'color:#a0c8f0;font-size:0.82rem;font-weight:600;cursor:pointer;white-space:nowrap;' +
    'transition:background 0.15s;';
  skipBtn.textContent = `Skip Day ($${(skipCost / 1000).toFixed(0)}k)`;

  if (!canAfford) {
    skipBtn.disabled = true;
    skipBtn.style.opacity = '0.4';
    skipBtn.style.cursor = 'not-allowed';
    skipBtn.title = 'Insufficient funds';
  }

  skipBtn.addEventListener('click', () => {
    if (!_state) return;
    const result = skipWeather(_state, 'EARTH');
    if (result.success) {
      // Re-render the weather bar with new conditions.
      _renderWeatherBar();
    }
  });

  bar.appendChild(skipBtn);
  _overlay.appendChild(bar);
}

/**
 * Build a single rocket design card.
 *
 * Uses the shared `buildRocketCard` from rocketCardUtil for the base layout,
 * then appends launch-pad-specific cost info and a Launch button.
 *
 * @param {import('../core/gameState.js').RocketDesign} design
 * @returns {HTMLElement}
 */
function _buildRocketCard(design) {
  const cost      = _computeDesignCost(design);
  const canAfford = _state ? _state.money >= cost : false;

  // Check mass against launch pad tier limit.
  const assembly = _designToAssembly(design);
  const rocketMass = getTotalMass(assembly);
  const padTier = _state ? getFacilityTier(_state, FacilityId.LAUNCH_PAD) : 1;
  const maxMass = LAUNCH_PAD_MAX_MASS[padTier] ?? LAUNCH_PAD_MAX_MASS[1];
  const tooHeavy = rocketMass > maxMass;

  const card = buildRocketCard(design, []);
  card.classList.add('lp-rocket-card');

  // Insert cost info into the info column (before the date element).
  const info = card.querySelector('.rocket-card-info');
  if (info) {
    const costEl = document.createElement('div');
    costEl.className = 'lp-rocket-cost' + (canAfford ? '' : ' lp-rocket-cost-insufficient');
    costEl.textContent = `Launch cost: ${_fmt$(cost)}`;
    const dateEl = info.querySelector('.rocket-card-date');
    info.insertBefore(costEl, dateEl);

    // Show mass and limit info.
    const massEl = document.createElement('div');
    massEl.style.cssText = `font-size:0.75rem;color:${tooHeavy ? '#c06040' : '#607888'};`;
    const massStr = _fmt(Math.round(rocketMass));
    const limitStr = isFinite(maxMass) ? _fmt(maxMass) : 'Unlimited';
    massEl.textContent = `Mass: ${massStr} kg / ${limitStr} kg`;
    if (tooHeavy) {
      massEl.textContent += ' (over limit!)';
    }
    info.insertBefore(massEl, dateEl);
  }

  // Replace the empty actions container with a Launch button.
  const launchBtn = document.createElement('button');
  launchBtn.className = 'lp-launch-btn';
  launchBtn.dataset.action = 'launch';
  launchBtn.textContent = `Launch (${_fmt$(cost)})`;
  if (!canAfford || tooHeavy) {
    launchBtn.disabled = true;
    launchBtn.title = tooHeavy
      ? `Rocket too heavy for Tier ${padTier} pad (max ${isFinite(maxMass) ? _fmt(maxMass) + ' kg' : 'unlimited'})`
      : 'Insufficient funds';
  }
  launchBtn.addEventListener('click', () => _handleLaunch(design));
  card.appendChild(launchBtn);

  return card;
}

// ---------------------------------------------------------------------------
// Private — launch flow
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const OPPOSITE_SIDE = Object.freeze({
  top: 'bottom', bottom: 'top', left: 'right', right: 'left',
});

/** Positional tolerance for snap-point matching (world units). */
const SNAP_TOLERANCE = 1;

/**
 * Reconstruct a live RocketAssembly from a saved RocketDesign.
 * Parts are added in the same order they were saved, so the auto-generated
 * instanceIds (inst-1, inst-2, ...) match the original staging references.
 *
 * After placing parts, connections are rebuilt by finding pairs of snap points
 * that coincide positionally — this is required for the fuel system's BFS
 * traversal to route propellant from tanks to engines.
 *
 * @param {import('../core/gameState.js').RocketDesign} design
 * @returns {import('../core/rocketbuilder.js').RocketAssembly}
 */
function _designToAssembly(design) {
  const assembly = createRocketAssembly();
  for (const part of design.parts) {
    addPartToAssembly(assembly, part.partId, part.position.x, part.position.y);
  }

  // Rebuild connections from snap-point positions.
  _rebuildConnections(assembly);

  return assembly;
}

/**
 * Infer part connections by checking snap-point overlap.
 *
 * For every pair of parts, check whether a snap point from one part coincides
 * (within tolerance) with a complementary-side snap point from the other.
 * When a match is found, record a connection so the fuel system can traverse
 * the assembly graph.
 *
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 */
function _rebuildConnections(assembly) {
  const parts = [...assembly.parts.values()];
  const occupied = new Set(); // "instanceId:snapIndex" → already connected

  for (let i = 0; i < parts.length; i++) {
    const pA = parts[i];
    const defA = getPartById(pA.partId);
    if (!defA) continue;

    for (let j = i + 1; j < parts.length; j++) {
      const pB = parts[j];
      const defB = getPartById(pB.partId);
      if (!defB) continue;

      for (let si = 0; si < defA.snapPoints.length; si++) {
        const spA = defA.snapPoints[si];
        const keyA = `${pA.instanceId}:${si}`;
        if (occupied.has(keyA)) continue;

        // World position of snap A (offsetY: positive = below centre in screen coords).
        const awx = pA.x + spA.offsetX;
        const awy = pA.y - spA.offsetY;

        const neededSide = OPPOSITE_SIDE[spA.side];

        for (let sj = 0; sj < defB.snapPoints.length; sj++) {
          const spB = defB.snapPoints[sj];
          if (spB.side !== neededSide) continue;

          const keyB = `${pB.instanceId}:${sj}`;
          if (occupied.has(keyB)) continue;

          const bwx = pB.x + spB.offsetX;
          const bwy = pB.y - spB.offsetY;

          if (Math.abs(awx - bwx) < SNAP_TOLERANCE && Math.abs(awy - bwy) < SNAP_TOLERANCE) {
            connectParts(assembly, pA.instanceId, si, pB.instanceId, sj);
            occupied.add(keyA);
            occupied.add(keyB);
          }
        }
      }
    }
  }
}

/**
 * Reconstruct a live StagingConfig from a saved RocketDesign's staging data.
 * Falls back to a default single-stage config if staging data is missing.
 *
 * @param {import('../core/gameState.js').RocketDesign} design
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {import('../core/rocketbuilder.js').StagingConfig}
 */
function _designToStagingConfig(design, assembly) {
  const staging = design.staging;

  if (staging && Array.isArray(staging.stages)) {
    const config = {
      stages:          staging.stages.map(ids => ({
        instanceIds: Array.isArray(ids) ? [...ids] : [],
      })),
      unstaged:        Array.isArray(staging.unstaged) ? [...staging.unstaged] : [],
      currentStageIdx: 0,
    };
    // Clean up any stale references.
    syncStagingWithAssembly(assembly, config);
    return config;
  }

  // Fallback: create default staging and let sync populate it.
  const config = createStagingConfig();
  syncStagingWithAssembly(assembly, config);
  return config;
}

/**
 * Handle clicking Launch on a rocket design card.
 * Checks for crew seats and shows a crew dialog if needed.
 *
 * @param {import('../core/gameState.js').RocketDesign} design
 */
function _handleLaunch(design) {
  if (!_state) return;

  const assembly      = _designToAssembly(design);
  const stagingConfig = _designToStagingConfig(design, assembly);

  // Check for extreme weather — show a warning before launching.
  const weather = getCurrentWeather(_state);
  if (weather.extreme) {
    _showExtremeWeatherWarning(design, assembly, stagingConfig);
    return;
  }

  _proceedToLaunch(design, assembly, stagingConfig);
}

/**
 * Continue the launch flow after weather checks.
 * Counts crew seats and shows crew dialog if needed.
 */
function _proceedToLaunch(design, assembly, stagingConfig) {
  if (!_state) return;

  // Count crew seats across command modules.
  let totalSeats = 0;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def?.type === PartType.COMMAND_MODULE) {
      totalSeats += def.properties?.seats ?? 0;
    }
  }

  if (totalSeats > 0) {
    _showCrewDialog(totalSeats, design, assembly, stagingConfig);
  } else {
    _doLaunch([], design, assembly, stagingConfig);
  }
}

/**
 * Show a warning dialog when launching in extreme weather.
 */
function _showExtremeWeatherWarning(design, assembly, stagingConfig) {
  const weather = getCurrentWeather(_state);

  const overlay = document.createElement('div');
  overlay.id = 'lp-weather-warning-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:rgba(20,0,0,0.85);z-index:600;' +
    'display:flex;align-items:center;justify-content:center;' +
    'font-family:system-ui,sans-serif;pointer-events:auto;';

  const dialog = document.createElement('div');
  dialog.style.cssText =
    'background:#1a1020;border:2px solid #ff4040;border-radius:12px;' +
    'padding:28px 36px;max-width:400px;text-align:center;color:#e0d0d0;';

  dialog.innerHTML =
    `<div style="font-size:1.2rem;font-weight:700;color:#ff5050;margin-bottom:8px;">` +
      `Extreme Weather Warning</div>` +
    `<div style="font-size:0.88rem;color:#c0a0a0;margin-bottom:16px;line-height:1.5;">` +
      `Current conditions: <strong style="color:#ff8060;">${weather.description}</strong><br>` +
      `Wind: ${weather.windSpeed.toFixed(1)} m/s<br>` +
      `Launching in these conditions is highly inadvisable.</div>` +
    `<div style="display:flex;gap:12px;justify-content:center;">` +
      `<button id="lp-weather-cancel" style="padding:10px 24px;background:#302020;` +
        `border:1px solid #804040;border-radius:6px;color:#e0c0c0;cursor:pointer;` +
        `font-size:0.9rem;">Cancel</button>` +
      `<button id="lp-weather-proceed" style="padding:10px 24px;background:#601010;` +
        `border:1px solid #ff4040;border-radius:6px;color:#ffa0a0;cursor:pointer;` +
        `font-size:0.9rem;font-weight:600;">Launch Anyway</button>` +
    `</div>`;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.querySelector('#lp-weather-cancel')?.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#lp-weather-proceed')?.addEventListener('click', () => {
    overlay.remove();
    _proceedToLaunch(design, assembly, stagingConfig);
  });

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/**
 * Show a crew assignment dialog before launch.
 *
 * @param {number} totalSeats
 * @param {import('../core/gameState.js').RocketDesign} design
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @param {import('../core/rocketbuilder.js').StagingConfig} stagingConfig
 */
function _showCrewDialog(totalSeats, design, assembly, stagingConfig) {
  if (!_state) return;

  const activeCrew = getActiveCrew(_state);

  const crewOpts = activeCrew.map(
    (c) => `<option value="${c.id}">${c.name}</option>`,
  ).join('');

  const seatRows = [];
  for (let i = 0; i < totalSeats; i++) {
    seatRows.push(
      `<div class="lp-crew-seat-row">` +
        `<span class="lp-crew-seat-label">Seat ${i + 1}</span>` +
        `<select class="lp-crew-seat-select" data-seat="${i}">` +
          `<option value="">\u2014 Empty \u2014</option>` +
          crewOpts +
        `</select>` +
      `</div>`,
    );
  }

  const infoMsg = activeCrew.length === 0
    ? `<p style="font-size:10px;color:#c07030;margin-bottom:10px;line-height:1.6;">` +
      `No active crew to assign.<br>Seats will launch empty.</p>`
    : `<p style="font-size:10px;color:#3a6080;margin-bottom:12px;line-height:1.6;">` +
      `Assign crew to seats before launch.<br>Seats may be left empty.</p>`;

  const overlay = document.createElement('div');
  overlay.id = 'lp-crew-overlay';
  overlay.innerHTML =
    `<div id="lp-crew-dialog">` +
      `<div class="lp-crew-dlg-hdr">Crew Assignment</div>` +
      `<div class="lp-crew-dlg-body">` +
        infoMsg +
        seatRows.join('') +
      `</div>` +
      `<div class="lp-crew-dlg-footer">` +
        `<button class="lp-crew-cancel-btn" type="button">Cancel</button>` +
        `<button class="lp-crew-confirm-btn" type="button">Launch</button>` +
      `</div>` +
    `</div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('.lp-crew-cancel-btn')?.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('.lp-crew-confirm-btn')?.addEventListener('click', () => {
    const selects = overlay.querySelectorAll('.lp-crew-seat-select');
    const crewIds = [];
    const seen    = new Set();
    for (const sel of selects) {
      const id = /** @type {HTMLSelectElement} */ (sel).value;
      if (id && !seen.has(id)) {
        crewIds.push(id);
        seen.add(id);
      }
    }
    overlay.remove();
    _doLaunch(crewIds, design, assembly, stagingConfig);
  });
}

/**
 * Create the FlightState and transition to the flight scene.
 *
 * @param {string[]} crewIds
 * @param {import('../core/gameState.js').RocketDesign} design
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @param {import('../core/rocketbuilder.js').StagingConfig} stagingConfig
 */
function _doLaunch(crewIds, design, assembly, stagingConfig) {
  if (!_state) return;

  // Deduct the launch cost (re-purchasing the parts for this flight).
  const cost = _computeDesignCost(design);
  _state.money -= cost;

  // Associate with the first accepted mission if one exists.
  const missionId = _state.missions.accepted[0]?.id ?? '';

  // Sum up initial fuel load.
  let totalFuel = 0;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalFuel += def.properties?.fuelMass ?? 0;
  }

  // Write the live flight state.
  _state.currentFlight = createFlightState({
    missionId,
    rocketId:        design.id,
    crewIds,
    fuelRemaining:   totalFuel,
    deltaVRemaining: 0,
  });

  console.log('[Launch Pad] Launch initiated', {
    designId:   design.id,
    designName: design.name,
    missionId:  missionId || '(none)',
    crewCount:  crewIds.length,
  });

  // Capture references before destroying the launch pad overlay.
  const container = _container;
  const onBack    = _onBack;
  const state     = _state;

  destroyLaunchPadUI();

  if (container) {
    startFlightScene(
      container,
      state,
      assembly,
      stagingConfig,
      state.currentFlight,
      (_finalState, returnResults, navigateTo) => {
        // Return to hub.
        if (onBack) onBack();

        // Show the post-flight results overlay if applicable.
        if (returnResults) {
          showReturnResultsOverlay(container, returnResults);
        }

        // "Retry with Same Design" — auto-navigate to the VAB.  The hub
        // is already mounted by onBack(); click the VAB building to enter.
        if (navigateTo === 'vab') {
          const vabEl = document.querySelector('[data-building-id="vab"]');
          if (vabEl) /** @type {HTMLElement} */ (vabEl).click();
        }
      },
    );
  }
}
