/**
 * launchPad.ts — Launch Pad Building HTML overlay UI.
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

import type { GameState, RocketDesign } from '../core/gameState.ts';
import type { RocketAssembly, StagingConfig } from '../core/rocketbuilder.ts';
import type { PartDef } from '../data/parts.ts';
import { getPartById } from '../data/parts.ts';
import { PartType, FacilityId, LAUNCH_PAD_MAX_MASS, LAUNCH_PAD_TIER_LABELS, DEATH_FINE_PER_ASTRONAUT } from '../core/constants.ts';
import { getCurrentWeather, getWeatherSkipCost, skipWeather } from '../core/weather.ts';
import {
  designToAssembly,
  designToStagingConfig,
} from '../core/rocketbuilder.ts';
import { getActiveCrew } from '../core/crew.ts';
import { getFacilityTier } from '../core/construction.ts';
import { getTotalMass } from '../core/rocketvalidator.ts';
import { createFlightState } from '../core/gameState.ts';
import type { CelestialBody } from '../core/constants.ts';
import { getActiveHub } from '../core/hubs.ts';
import { startFlightScene } from './flightController/_init.ts';
import { handleFlightEndReturnToHub } from './index.ts';
import { buildRocketCard } from './rocketCardUtil.ts';
import { createListenerTracker, type ListenerTracker } from './listenerTracker.ts';
import './launchPad.css';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The root overlay element. */
let _overlay: HTMLDivElement | null = null;

/** The #ui-overlay container reference. */
let _container: HTMLElement | null = null;

/** The game state reference. */
let _state: GameState | null = null;

/** Callback to navigate back to the hub. */
let _onBack: (() => void) | null = null;

/** Tracker for DOM listeners created during the launch-pad's lifetime. */
let _listeners: ListenerTracker | null = null;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a number with commas.
 */
function _fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Format a dollar amount.
 */
function _fmt$(n: number): string {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/**
 * Compute the total cost of a rocket design by summing part costs.
 */
function _computeDesignCost(design: RocketDesign): number {
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
const PART_FILL: Record<string, string> = {
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
const PART_STROKE: Record<string, string> = {
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
  [PartType.LAUNCH_CLAMP]:        '#807040',
};

const PREVIEW_W = 80;
const PREVIEW_H = 120;
const PREVIEW_PAD = 6;

/**
 * Draw a miniature rocket preview onto a 2D canvas element.
 */
function _renderRocketPreview(canvas: HTMLCanvasElement, design: RocketDesign): void {
  canvas.width  = PREVIEW_W;
  canvas.height = PREVIEW_H;
  canvas.className = 'lp-rocket-preview';

  const ctx = canvas.getContext('2d');
  if (!ctx || !design.parts || design.parts.length === 0) return;

  // Resolve part defs and compute bounding box.
  const resolved: Array<{ px: number; py: number; hw: number; hh: number; def: PartDef }> = [];
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
 */
export function initLaunchPadUI(
  container: HTMLElement,
  state: GameState,
  { onBack }: { onBack: () => void },
): void {
  _container = container;
  _state     = state;
  _onBack    = onBack;
  _listeners = createListenerTracker();

  _overlay = document.createElement('div');
  _overlay.id = 'launch-pad-overlay';
  container.appendChild(_overlay);

  _renderShell();
}

/**
 * Remove the Launch Pad overlay from the DOM.
 */
export function destroyLaunchPadUI(): void {
  if (_listeners) {
    _listeners.removeAll();
    _listeners = null;
  }
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _container = null;
  _state     = null;
  _onBack    = null;
}

// ---------------------------------------------------------------------------
// Private — rendering
// ---------------------------------------------------------------------------

/**
 * Build the screen layout: header with back button + rocket list or
 * empty-state placeholder.
 */
function _renderShell(): void {
  if (!_overlay || !_state) return;

  // Header
  const header = document.createElement('div');
  header.id = 'launch-pad-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'launch-pad-back-btn';
  backBtn.textContent = '\u2190 Hub';
  _listeners?.add(backBtn, 'click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroyLaunchPadUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const padTier = getFacilityTier(_state, FacilityId.LAUNCH_PAD);
  const padTierLabel = (LAUNCH_PAD_TIER_LABELS as Record<number, string>)[padTier] || '';
  const title = document.createElement('h1');
  title.id = 'launch-pad-title';
  title.textContent = `Launch Pad \u2014 Tier ${padTier}` + (padTierLabel ? ` (${padTierLabel})` : '');
  header.appendChild(title);

  // Show pad capability details
  const maxMass = (LAUNCH_PAD_MAX_MASS as Record<number, number>)[padTier] ?? (LAUNCH_PAD_MAX_MASS as Record<number, number>)[1];
  const tierInfo = document.createElement('span');
  tierInfo.className = 'lp-tier-info';
  const massLabel = isFinite(maxMass) ? `${(maxMass / 1000).toFixed(0)}t` : 'Unlimited';
  const features: string[] = [];
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
function _renderWeatherBar(): void {
  if (!_overlay || !_state) return;

  // Remove stale bar.
  const existing = document.getElementById('lp-weather-bar');
  if (existing) existing.remove();

  const weather = getCurrentWeather(_state);
  if (weather.description === 'No atmosphere') return;

  const bar = document.createElement('div');
  bar.id = 'lp-weather-bar';

  // Weather summary
  const info = document.createElement('div');
  info.className = 'lp-weather-info';

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
  skipBtn.textContent = `Skip Day ($${(skipCost / 1000).toFixed(0)}k)`;

  if (!canAfford) {
    skipBtn.disabled = true;
    skipBtn.style.opacity = '0.4';
    skipBtn.style.cursor = 'not-allowed';
    skipBtn.title = 'Insufficient funds';
  }

  _listeners?.add(skipBtn, 'click', () => {
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
 */
function _buildRocketCard(design: RocketDesign): HTMLElement {
  const cost      = _computeDesignCost(design);
  const canAfford = _state ? _state.money >= cost : false;

  // Check mass against launch pad tier limit.
  const assembly = designToAssembly(design);
  const rocketMass = getTotalMass(assembly);
  const padTier = _state ? getFacilityTier(_state, FacilityId.LAUNCH_PAD) : 1;
  const maxMass = (LAUNCH_PAD_MAX_MASS as Record<number, number>)[padTier] ?? (LAUNCH_PAD_MAX_MASS as Record<number, number>)[1];
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
    massEl.className = 'lp-rocket-mass' + (tooHeavy ? ' over-limit' : '');
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
  _listeners?.add(launchBtn, 'click', () => _handleLaunch(design));
  card.appendChild(launchBtn);

  return card;
}

// ---------------------------------------------------------------------------
// Private — launch flow
// ---------------------------------------------------------------------------

/**
 * Handle clicking Launch on a rocket design card.
 * Checks for crew seats and shows a crew dialog if needed.
 */
function _handleLaunch(design: RocketDesign): void {
  if (!_state) return;

  const assembly      = designToAssembly(design);
  const stagingConfig = designToStagingConfig(design, assembly);

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
function _proceedToLaunch(design: RocketDesign, assembly: RocketAssembly, stagingConfig: StagingConfig): void {
  if (!_state) return;

  // Count crew seats across command modules.
  let totalSeats = 0;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def?.type === PartType.COMMAND_MODULE) {
      totalSeats += (def.properties?.seats as number) ?? 0;
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
function _showExtremeWeatherWarning(design: RocketDesign, assembly: RocketAssembly, stagingConfig: StagingConfig): void {
  const weather = getCurrentWeather(_state!);

  const overlay = document.createElement('div');
  overlay.id = 'lp-weather-warning-overlay';
  overlay.className = 'weather-warning-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'weather-warning-dialog';

  dialog.innerHTML =
    `<div class="launch-dialog-title">` +
      `Extreme Weather Warning</div>` +
    `<div class="launch-dialog-subtitle">` +
      `Current conditions: <strong class="launch-dialog-warn-highlight">${weather.description}</strong><br>` +
      `Wind: ${weather.windSpeed.toFixed(1)} m/s<br>` +
      `Launching in these conditions is highly inadvisable.</div>` +
    `<div class="launch-dialog-actions">` +
      `<button id="lp-weather-cancel" class="launch-btn-abort">Cancel</button>` +
      `<button id="lp-weather-proceed" class="launch-btn-confirm">Launch Anyway</button>` +
    `</div>`;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const cancelBtn = overlay.querySelector('#lp-weather-cancel');
  if (cancelBtn) {
    _listeners?.add(cancelBtn, 'click', () => {
      overlay.remove();
    });
  }

  const proceedBtn = overlay.querySelector('#lp-weather-proceed');
  if (proceedBtn) {
    _listeners?.add(proceedBtn, 'click', () => {
      overlay.remove();
      _proceedToLaunch(design, assembly, stagingConfig);
    });
  }

  _listeners?.add(overlay, 'pointerdown', (e: Event) => {
    if (e.target === overlay) overlay.remove();
  });
}

/**
 * Show a crew assignment dialog before launch.
 */
function _showCrewDialog(
  totalSeats: number,
  design: RocketDesign,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
): void {
  if (!_state) return;

  const activeCrew = getActiveCrew(_state);

  const crewOpts = activeCrew.map(
    (c) => `<option value="${c.id}">${c.name}</option>`,
  ).join('');

  const seatRows: string[] = [];
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
    ? `<p class="launch-crew-msg-warn">` +
      `No active crew to assign.<br>Seats will launch empty.</p>`
    : `<p class="launch-crew-msg-info">` +
      `Assign crew to seats before launch.<br>Seats may be left empty.</p>`;

  // Show a crew death risk warning if the player hasn't done a crewed flight yet.
  const hadCrewedFlight = (_state.flightHistory ?? []).some(
    (f) => Array.isArray(f.crewIds) && f.crewIds.length > 0,
  );
  const fineStr = `$${DEATH_FINE_PER_ASTRONAUT.toLocaleString('en-US')}`;
  const crewWarning = !hadCrewedFlight
    ? `<div class="launch-caution-box">` +
      `<strong class="launch-caution-title">Crew Risk Warning:</strong> ` +
      `If a crewed rocket is destroyed, each astronaut killed incurs a ` +
      `<strong class="launch-caution-highlight">${fineStr}</strong> fine. ` +
      `Consider launching uncrewed first to test your design.</div>`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'lp-crew-overlay';
  overlay.innerHTML =
    `<div id="lp-crew-dialog">` +
      `<div class="lp-crew-dlg-hdr">Crew Assignment</div>` +
      `<div class="lp-crew-dlg-body">` +
        crewWarning +
        infoMsg +
        seatRows.join('') +
      `</div>` +
      `<div class="lp-crew-dlg-footer">` +
        `<button class="lp-crew-cancel-btn" type="button">Cancel</button>` +
        `<button class="lp-crew-confirm-btn" type="button">Launch</button>` +
      `</div>` +
    `</div>`;

  document.body.appendChild(overlay);

  _listeners?.add(overlay, 'pointerdown', (e: Event) => {
    if (e.target === overlay) overlay.remove();
  });

  const cancelBtn = overlay.querySelector('.lp-crew-cancel-btn');
  if (cancelBtn) {
    _listeners?.add(cancelBtn, 'click', () => {
      overlay.remove();
    });
  }

  const confirmBtn = overlay.querySelector('.lp-crew-confirm-btn');
  if (confirmBtn) {
    _listeners?.add(confirmBtn, 'click', () => {
      const selects = overlay.querySelectorAll('.lp-crew-seat-select');
      const crewIds: string[] = [];
      const seen    = new Set<string>();
      for (const sel of selects) {
        const id = (sel as HTMLSelectElement).value;
        if (id && !seen.has(id)) {
          crewIds.push(id);
          seen.add(id);
        }
      }
      overlay.remove();
      _doLaunch(crewIds, design, assembly, stagingConfig);
    });
  }
}

/**
 * Create the FlightState and transition to the flight scene.
 */
function _doLaunch(
  crewIds: string[],
  design: RocketDesign,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
): void {
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
    if (def) totalFuel += (def.properties?.fuelMass as number) ?? 0;
  }

  // Resolve launch context from the active hub so a craft launched from
  // (e.g.) the Mun base spawns on the Mun, not Earth.
  const activeHub = getActiveHub(_state);
  const isOrbitalLaunch = activeHub.type === 'orbital';

  // Write the live flight state.
  _state.currentFlight = createFlightState({
    missionId,
    rocketId:        design.id,
    crewIds,
    fuelRemaining:   totalFuel,
    deltaVRemaining: 0,
    bodyId:          activeHub.bodyId as CelestialBody,
    launchType:      isOrbitalLaunch ? 'orbital' : 'surface',
    launchHubId:     activeHub.id,
  });

  if (isOrbitalLaunch) {
    _state.currentFlight.altitude = activeHub.altitude ?? 200_000;
  }


  // Capture references before destroying the launch pad overlay.
  const container = _container;
  const onBack    = _onBack;
  const state     = _state;

  destroyLaunchPadUI();

  if (container) {
    void startFlightScene(
      container,
      state,
      assembly,
      stagingConfig,
      state.currentFlight!,
      (_finalState, returnResults, navigateTo) => {
        // Return to hub.
        if (onBack) onBack();

        // "Retry with Same Design" — auto-navigate to the VAB. The hub is
        // already mounted by onBack(); click the VAB building to enter.
        // Skip the hub-return side effects (results overlay, auto-save) since
        // the player is not staying at the hub.
        if (navigateTo === 'vab') {
          const vabEl = document.querySelector('[data-building-id="vab"]');
          if (vabEl) (vabEl as HTMLElement).click();
          return;
        }

        // Show the financial summary overlay and trigger auto-save.
        handleFlightEndReturnToHub(container, state, returnResults);
      },
    );
  }
}
