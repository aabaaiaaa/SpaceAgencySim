/**
 * _launchFlow.js — Launch button handler, weather warning, crew assignment
 * dialog, flight initiation.
 */

import { getPartById } from '../../data/parts.js';
import { PartType } from '../../core/constants.js';
import { getCurrentWeather } from '../../core/weather.js';
import { getActiveCrew } from '../../core/crew.js';
import { createRocketDesign, createFlightState } from '../../core/gameState.js';
import { startFlightScene } from '../flightController.js';
import { showReturnResultsOverlay } from '../hub.js';
import { getVabState } from './_state.js';

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _renderStagingPanelFn = () => {};
let _runAndRenderValidationFn = () => {};

export function setLaunchFlowCallbacks({
  renderStagingPanel,
  runAndRenderValidation,
}) {
  _renderStagingPanelFn = renderStagingPanel;
  _runAndRenderValidationFn = runAndRenderValidation;
}

/**
 * Entry point called when the enabled Launch button is clicked.
 */
export function handleLaunchClicked() {
  const S = getVabState();
  if (!S.assembly || !S.gameState || !S.lastValidation?.canLaunch) return;

  const weather = getCurrentWeather(S.gameState);
  if (weather.extreme) {
    showVabWeatherWarning();
    return;
  }

  proceedVabLaunch();
}

/**
 * Continue the VAB launch flow after weather checks.
 */
function proceedVabLaunch() {
  const S = getVabState();
  if (!S.assembly || !S.gameState) return;

  let totalSeats = 0;
  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def?.type === PartType.COMMAND_MODULE) {
      totalSeats += def.properties?.seats ?? 0;
    }
  }

  if (totalSeats > 0) {
    showCrewDialog(totalSeats);
  } else {
    doLaunch([]);
  }
}

/**
 * Show a warning dialog when launching from VAB in extreme weather.
 */
function showVabWeatherWarning() {
  const S = getVabState();
  const weather = getCurrentWeather(S.gameState);

  const overlay = document.createElement('div');
  overlay.id = 'vab-weather-warning-overlay';
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
      `<button id="vab-weather-cancel" style="padding:10px 24px;background:#302020;` +
        `border:1px solid #804040;border-radius:6px;color:#e0c0c0;cursor:pointer;` +
        `font-size:0.9rem;">Cancel</button>` +
      `<button id="vab-weather-proceed" style="padding:10px 24px;background:#601010;` +
        `border:1px solid #ff4040;border-radius:6px;color:#ffa0a0;cursor:pointer;` +
        `font-size:0.9rem;font-weight:600;">Launch Anyway</button>` +
    `</div>`;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.querySelector('#vab-weather-cancel')?.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#vab-weather-proceed')?.addEventListener('click', () => {
    overlay.remove();
    proceedVabLaunch();
  });

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/**
 * Show the crew assignment modal.
 * @param {number} totalSeats
 */
function showCrewDialog(totalSeats) {
  const S = getVabState();
  if (!S.gameState) return;

  const activeCrew = getActiveCrew(S.gameState);

  const crewOpts = activeCrew.map(
    (c) => `<option value="${c.id}">${c.name}</option>`,
  ).join('');

  const seatRows = [];
  for (let i = 0; i < totalSeats; i++) {
    seatRows.push(
      `<div class="vab-crew-seat-row">` +
        `<span class="vab-crew-seat-label">Seat ${i + 1}</span>` +
        `<select class="vab-crew-seat-select" data-seat="${i}">` +
          `<option value="">— Empty —</option>` +
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
  overlay.id = 'vab-crew-overlay';
  overlay.innerHTML =
    `<div id="vab-crew-dialog">` +
      `<div class="vab-crew-dlg-hdr">Crew Assignment</div>` +
      `<div class="vab-crew-dlg-body">` +
        infoMsg +
        seatRows.join('') +
      `</div>` +
      `<div class="vab-crew-dlg-footer">` +
        `<button class="vab-btn" id="vab-crew-cancel" type="button">Cancel</button>` +
        `<button class="vab-btn vab-btn-launch" id="vab-crew-confirm" type="button">Launch</button>` +
      `</div>` +
    `</div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#vab-crew-cancel')?.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#vab-crew-confirm')?.addEventListener('click', () => {
    const selects  = overlay.querySelectorAll('.vab-crew-seat-select');
    const crewIds  = [];
    const seen     = new Set();
    for (const sel of selects) {
      const id = /** @type {HTMLSelectElement} */ (sel).value;
      if (id && !seen.has(id)) {
        crewIds.push(id);
        seen.add(id);
      }
    }
    overlay.remove();
    doLaunch(crewIds);
  });
}

/**
 * Create the initial FlightState, store it in game state, and transition to
 * the flight scene.
 * @param {string[]} crewIds
 */
function doLaunch(crewIds) {
  const S = getVabState();
  if (!S.gameState || !S.assembly) return;

  const missionId = S.gameState.missions.accepted[0]?.id ?? '';

  let totalFuel = 0;
  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalFuel += def.properties?.fuelMass ?? 0;
  }

  const launchDesign = createRocketDesign({
    id:          'launch-' + Date.now(),
    name:        'VAB Launch ' + new Date().toLocaleDateString(),
    parts:       [...S.assembly.parts.values()].map(p => ({ partId: p.partId, position: { x: p.x, y: p.y }, ...(p.instruments?.length ? { instruments: [...p.instruments] } : {}) })),
    staging:     { stages: S.stagingConfig.stages.map(s => [...s.instanceIds]), unstaged: [...S.stagingConfig.unstaged] },
    totalMass:   S.lastValidation?.totalMassKg ?? 0,
    totalThrust: S.lastValidation?.stage1Thrust ?? 0,
  });
  S.gameState.rockets.push(launchDesign);

  S.gameState.currentFlight = createFlightState({
    missionId,
    rocketId:        launchDesign.id,
    crewIds,
    fuelRemaining:   totalFuel,
    deltaVRemaining: 0,
  });

  console.log('[VAB] Launch initiated', {
    missionId:    missionId || '(none)',
    crewCount:    crewIds.length,
    crewIds,
    totalMassKg:  S.lastValidation?.totalMassKg ?? 0,
    stage1Thrust: S.lastValidation?.stage1Thrust ?? 0,
    twr:          (S.lastValidation?.twr ?? 0).toFixed(2),
  });

  const vabRoot = document.getElementById('vab-root');
  if (vabRoot) vabRoot.style.display = 'none';

  const flightStagingConfig = {
    stages:          S.stagingConfig.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
    unstaged:        [...S.stagingConfig.unstaged],
    currentStageIdx: S.stagingConfig.currentStageIdx,
  };

  const container = S.container ?? document.getElementById('ui-overlay');
  if (container) {
    startFlightScene(
      container,
      S.gameState,
      S.assembly,
      flightStagingConfig,
      S.gameState.currentFlight,
      (_state, returnResults, navigateTo) => {
        if (navigateTo === 'vab') {
          if (vabRoot) vabRoot.style.display = '';
          _renderStagingPanelFn();
          _runAndRenderValidationFn();
          return;
        }

        if (vabRoot) vabRoot.style.display = '';
        S.onBack?.();

        if (returnResults) {
          const uiOverlay = container;
          showReturnResultsOverlay(uiOverlay, returnResults);
        }
      },
    );
  }
}

/**
 * Display a temporary "launch initiated" overlay (placeholder).
 */
export function showLaunchInitiatedOverlay() {
  const S = getVabState();
  const banner = document.createElement('div');
  banner.id = 'vab-launch-banner';
  banner.innerHTML =
    `<div class="vab-launch-msg">` +
      `<div class="vab-launch-title">Launch Initiated</div>` +
      `<div class="vab-launch-sub">` +
        `Crew aboard: ${S.gameState?.currentFlight?.crewIds?.length ?? 0}<br>` +
        `TWR: ${(S.lastValidation?.twr ?? 0).toFixed(2)}<br>` +
        `<br>Flight scene coming in a later build.` +
      `</div>` +
      `<button class="vab-btn" id="vab-launch-dismiss" type="button" ` +
              `style="margin-top:14px">Return to VAB</button>` +
    `</div>`;

  document.body.appendChild(banner);

  banner.querySelector('#vab-launch-dismiss')?.addEventListener('click', () => {
    if (S.gameState) S.gameState.currentFlight = null;
    banner.remove();
  });
}
