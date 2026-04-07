/**
 * _launchFlow.ts — Launch button handler, weather warning, crew assignment
 * dialog, flight initiation.
 */

import { getPartById } from '../../data/parts.ts';
import { PartType, DEATH_FINE_PER_ASTRONAUT } from '../../core/constants.ts';
import { getCurrentWeather } from '../../core/weather.ts';
import { getActiveCrew } from '../../core/crew.ts';
import { createRocketDesign, createFlightState } from '../../core/gameState.ts';
import type { GameState } from '../../core/gameState.ts';
import type { FlightReturnSummary } from '../../core/flightReturn.ts';
import { startFlightScene } from '../flightController.ts';
import { showReturnResultsOverlay } from '../hub.ts';
import { getVabState } from './_state.ts';

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _renderStagingPanelFn: () => void = () => {};
let _runAndRenderValidationFn: () => void = () => {};

export function setLaunchFlowCallbacks({
  renderStagingPanel,
  runAndRenderValidation,
}: {
  renderStagingPanel: () => void;
  runAndRenderValidation: () => void;
}): void {
  _renderStagingPanelFn = renderStagingPanel;
  _runAndRenderValidationFn = runAndRenderValidation;
}

/**
 * Entry point called when the enabled Launch button is clicked.
 */
export function handleLaunchClicked(): void {
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
function proceedVabLaunch(): void {
  const S = getVabState();
  if (!S.assembly || !S.gameState) return;

  let totalSeats = 0;
  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def?.type === PartType.COMMAND_MODULE) {
      totalSeats += (def.properties?.seats as number) ?? 0;
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
function showVabWeatherWarning(): void {
  const S = getVabState();
  const weather = getCurrentWeather(S.gameState!);

  const overlay = document.createElement('div');
  overlay.id = 'vab-weather-warning-overlay';
  overlay.className = 'weather-warning-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'weather-warning-dialog';

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

  overlay.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.target === overlay) overlay.remove();
  });
}

/**
 * Show the crew assignment modal.
 */
function showCrewDialog(totalSeats: number): void {
  const S = getVabState();
  if (!S.gameState) return;

  const activeCrew = getActiveCrew(S.gameState);

  const crewOpts = activeCrew.map(
    (c) => `<option value="${c.id}">${c.name}</option>`,
  ).join('');

  const seatRows: string[] = [];
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

  // Show a crew death risk warning if the player hasn't done a crewed flight yet.
  const hadCrewedFlight = (S.gameState.flightHistory ?? []).some(
    (f) => Array.isArray(f.crewIds) && f.crewIds.length > 0,
  );
  const fineStr = `$${DEATH_FINE_PER_ASTRONAUT.toLocaleString('en-US')}`;
  const crewWarning = !hadCrewedFlight
    ? `<div style="background:rgba(120,80,20,0.4);border:1px solid #c09030;` +
      `border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:10px;` +
      `color:#e0c080;line-height:1.5;">` +
      `<strong style="color:#ffcc40;">Crew Risk Warning:</strong> ` +
      `If a crewed rocket is destroyed, each astronaut killed incurs a ` +
      `<strong style="color:#ff8060;">${fineStr}</strong> fine. ` +
      `Consider launching uncrewed first to test your design.</div>`
    : '';

  const overlay = document.createElement('div');
  overlay.id = 'vab-crew-overlay';
  overlay.innerHTML =
    `<div id="vab-crew-dialog">` +
      `<div class="vab-crew-dlg-hdr">Crew Assignment</div>` +
      `<div class="vab-crew-dlg-body">` +
        crewWarning +
        infoMsg +
        seatRows.join('') +
      `</div>` +
      `<div class="vab-crew-dlg-footer">` +
        `<button class="vab-btn" id="vab-crew-cancel" type="button">Cancel</button>` +
        `<button class="vab-btn vab-btn-launch" id="vab-crew-confirm" type="button">Launch</button>` +
      `</div>` +
    `</div>`;

  document.body.appendChild(overlay);

  overlay.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#vab-crew-cancel')?.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#vab-crew-confirm')?.addEventListener('click', () => {
    const selects  = overlay.querySelectorAll('.vab-crew-seat-select');
    const crewIds: string[]  = [];
    const seen     = new Set<string>();
    for (const sel of selects) {
      const id = (sel as HTMLSelectElement).value;
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
 */
function doLaunch(crewIds: string[]): void {
  const S = getVabState();
  if (!S.gameState || !S.assembly) return;

  const missionId = S.gameState.missions.accepted[0]?.id ?? '';

  let totalFuel = 0;
  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalFuel += (def.properties?.fuelMass as number) ?? 0;
  }

  const launchDesign = createRocketDesign({
    id:          'launch-' + Date.now(),
    name:        'VAB Launch ' + new Date().toLocaleDateString(),
    parts:       [...S.assembly.parts.values()].map(p => ({ partId: p.partId, position: { x: p.x, y: p.y }, ...(p.instruments?.length ? { instruments: [...p.instruments] } : {}) })),
    staging:     { stages: S.stagingConfig!.stages.map(s => [...s.instanceIds]) as unknown as number[][], unstaged: [...S.stagingConfig!.unstaged] as unknown as number[] },
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

  const vabRoot = document.getElementById('vab-root');
  if (vabRoot) vabRoot.style.display = 'none';

  const flightStagingConfig = {
    stages:          S.stagingConfig!.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
    unstaged:        [...S.stagingConfig!.unstaged],
    currentStageIdx: S.stagingConfig!.currentStageIdx,
  };

  const container = S.container ?? document.getElementById('ui-overlay');
  if (container) {
    startFlightScene(
      container,
      S.gameState,
      S.assembly,
      flightStagingConfig,
      S.gameState.currentFlight,
      (_state: GameState | null, returnResults?: unknown, navigateTo?: string) => {
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
          showReturnResultsOverlay(uiOverlay, returnResults as FlightReturnSummary);
        }
      },
    );
  }
}

/**
 * Display a temporary "launch initiated" overlay (placeholder).
 */
export function showLaunchInitiatedOverlay(): void {
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
