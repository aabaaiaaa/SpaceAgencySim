/**
 * _menuActions.ts — Menu handlers: save game, restart flight, adjust build,
 * return to agency, abort return, flight log.
 *
 * @module ui/flightController/_menuActions
 */

import { saveGame, listSaves } from '../../core/saveload.ts';
import { getPartById } from '../../data/parts.ts';
import { createFlightState } from '../../core/gameState.ts';
import { FlightPhase } from '../../core/constants.ts';
import { isPlayerLocked, getPhaseLabel, isInUnsafeBeltOrbit } from '../../core/flightPhase.ts';
import { processFlightReturn } from '../../core/flightReturn.ts';
import { refreshTopBar } from '../topbar.ts';
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';
import { showPhaseNotification } from './_flightPhase.ts';
import { showPostFlightSummary, buildFlightEventList } from './_postFlight.ts';
import { stopFlightScene, startFlightScene } from './_init.ts';

import type { RocketAssembly } from '../../core/rocketbuilder.ts';
import type { GameState } from '../../core/gameState.ts';

/**
 * Save the current game to the first available (empty) slot, or slot 0 as a
 * fallback if all slots are occupied.
 */
export async function handleSaveGame(): Promise<void> {
  const s = getFCState();
  if (!s.state) return;

  const saves      = listSaves();
  let   targetSlot = saves.findIndex((sv) => sv === null);
  if (targetSlot < 0) targetSlot = 0;

  const saveName: string = `${s.state.agencyName || 'Agency'} \u2014 In-Flight`;
  await saveGame(s.state, targetSlot, saveName);
}

/**
 * Menu action: restart the current flight from the launch pad with the same
 * rocket and staging. Deducts cost of lost parts, deep-clones the original
 * assembly, then calls startFlightScene.
 */
export function handleMenuRestart(): void {
  const s = getFCState();

  // Remove post-flight summary if it's showing (e.g. after a crash).
  const existingSummary = document.getElementById('post-flight-summary');
  if (existingSummary) existingSummary.remove();
  s.summaryShown = false;

  // Calculate full rocket rebuild cost.
  let totalRocketCost = 0;
  if (s.assembly) {
    for (const [, placed] of s.assembly.parts) {
      const def = getPartById(placed.partId);
      if (def) totalRocketCost += def.cost ?? 0;
    }
  }

  // Pause physics while the confirmation modal is showing.
  s.preMenuTimeWarp = s.timeWarp;
  s.timeWarp = 0;

  const host: HTMLElement = document.getElementById('ui-overlay') ?? document.body;
  const backdrop: HTMLDivElement = document.createElement('div');
  backdrop.id = 'restart-flight-backdrop';
  backdrop.className = 'topbar-modal-backdrop';

  const modal: HTMLDivElement = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Restart Flight');
  modal.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

  // Title
  const titleRow: HTMLDivElement = document.createElement('div');
  titleRow.className = 'topbar-modal-title-row';
  const h2: HTMLHeadingElement = document.createElement('h2');
  h2.className = 'topbar-modal-title';
  h2.textContent = 'Restart from Launch?';
  titleRow.appendChild(h2);
  modal.appendChild(titleRow);

  // Message
  const msg: HTMLParagraphElement = document.createElement('p');
  msg.className = 'confirm-msg';
  msg.textContent = 'This will end the current flight and rebuild the rocket from scratch.';
  modal.appendChild(msg);

  if (totalRocketCost > 0) {
    const costLine: HTMLParagraphElement = document.createElement('p');
    costLine.className = 'confirm-msg';
    costLine.style.fontWeight = '600';
    costLine.style.marginTop = '-12px';
    costLine.textContent = `Rebuild cost: \u2212$${totalRocketCost.toLocaleString('en-US')}`;
    modal.appendChild(costLine);
  }

  // Buttons
  const btnRow: HTMLDivElement = document.createElement('div');
  btnRow.className = 'confirm-btn-row';

  const cancelBtn: HTMLButtonElement = document.createElement('button');
  cancelBtn.className = 'confirm-btn confirm-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    s.timeWarp = s.preMenuTimeWarp ?? 1;
    backdrop.remove();
  });

  const confirmBtn: HTMLButtonElement = document.createElement('button');
  confirmBtn.className = 'confirm-btn confirm-btn-danger';
  confirmBtn.textContent = 'Restart';
  confirmBtn.addEventListener('click', () => {
    backdrop.remove();
    _executeRestart(totalRocketCost);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  modal.appendChild(btnRow);

  backdrop.addEventListener('click', () => {
    s.timeWarp = s.preMenuTimeWarp ?? 1;
    backdrop.remove();
  });
  backdrop.appendChild(modal);
  host.appendChild(backdrop);
}

/**
 * Execute the restart-from-launch action after confirmation.
 */
function _executeRestart(rebuildCost: number): void {
  const s = getFCState();

  if (rebuildCost > 0 && s.state) {
    s.state.money = (s.state.money ?? 0) - rebuildCost;
  }

  // Capture references before stopFlightScene nulls them.
  const origAssembly = s.originalAssembly;
  const origStaging  = s.originalStagingConfig;
  const ctr          = s.container;
  const gs           = s.state;
  const endCb        = s.onFlightEnd;
  const curFs        = getFlightState();
  const missionId    = curFs?.missionId ?? '';
  const rocketId     = curFs?.rocketId  ?? '';
  const crewIds      = curFs?.crewIds   ?? [];

  stopFlightScene();

  // If originals are missing, fall back to returning to hub.
  if (!origAssembly || !origStaging || !ctr || !gs) {
    if (endCb) endCb(gs);
    return;
  }

  // Recompute total fuel from the original (unmodified) assembly.
  let totalFuel = 0;
  for (const placed of origAssembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalFuel += (def.properties?.fuelMass as number) ?? 0;
  }

  // Reset ALL accepted mission objectives so they re-evaluate on the fresh flight.
  if (gs.missions?.accepted) {
    for (const mission of gs.missions.accepted) {
      const objectives = mission.objectives;
      if (!objectives) continue;
      for (const obj of objectives) {
        obj.completed = false;
        delete obj._holdEnteredAt;
      }
    }
  }

  // Fresh flight state.
  gs.currentFlight = createFlightState({
    missionId,
    rocketId,
    crewIds,
    fuelRemaining:   totalFuel,
    deltaVRemaining: 0,
    bodyId:          curFs?.bodyId ?? 'EARTH',
  });

  // Deep-clone the originals so the new flight gets pristine copies.
  const freshAssembly = {
    parts:         new Map([...origAssembly.parts].map(([id, p]) => [id, { ...p, ...(p.instruments ? { instruments: [...p.instruments] } : {}) }])),
    connections:   origAssembly.connections.map(c => ({ ...c })),
    symmetryPairs: origAssembly.symmetryPairs.map(sp => [...sp] as [string, string]),
    _nextId:       origAssembly._nextId,
  };
  const freshStaging = {
    stages:          origStaging.stages.map(stg => ({ instanceIds: [...stg.instanceIds] })),
    unstaged:        [...origStaging.unstaged],
    currentStageIdx: 0,
  };

  void startFlightScene(ctr, gs, freshAssembly as RocketAssembly, freshStaging, gs.currentFlight!, endCb as (state: GameState | null, results?: unknown, dest?: string) => void);
}

/**
 * Menu action: return to the VAB with the current rocket design loaded so the
 * player can tweak parts/staging and re-launch.
 */
export function handleMenuAdjustBuild(): void {
  const s = getFCState();

  // Remove post-flight summary if it's showing.
  const summary = document.getElementById('post-flight-summary');
  if (summary) summary.remove();
  s.summaryShown = false;

  const origAssembly = s.originalAssembly;
  const origStaging  = s.originalStagingConfig;
  const gs           = s.state;
  const endCb        = s.onFlightEnd;

  // Store the pristine assembly on gameState so the VAB can restore it.
  if (origAssembly && gs) {
    gs.vabAssembly = {
      parts:         [...origAssembly.parts.values()],
      connections:   origAssembly.connections,
      symmetryPairs: origAssembly.symmetryPairs,
      _nextId:       origAssembly._nextId,
    };
    gs.vabStagingConfig = origStaging ? {
      stages:          origStaging.stages.map(stg => ({ instanceIds: [...stg.instanceIds] })),
      unstaged:        [...origStaging.unstaged],
      currentStageIdx: 0,
    } : null;
  }

  stopFlightScene();
  if (endCb) (endCb as (state: unknown, results?: unknown, dest?: string) => void)(gs, null, 'vab');
}

/**
 * Menu action: process end-of-flight results and return to the Space Agency hub.
 *
 * Phase-aware behaviour:
 *   - TRANSFER / CAPTURE: blocked entirely (player is locked).
 *   - ORBIT: allowed with a brief confirmation warning.
 *   - FLIGHT / LAUNCH / PRELAUNCH: abort warning (parts at risk).
 *   - Landed / Crashed: go straight to summary.
 */
export function handleMenuReturnToAgency(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  const phase: string | null = flightState ? flightState.phase : null;

  // --- Block return during TRANSFER / CAPTURE (player locked) ---
  if (ps && phase && isPlayerLocked(phase)) {
    showPhaseNotification('Cannot leave during ' + getPhaseLabel(phase));
    return;
  }

  // --- Block return when orbiting in the dense asteroid belt ---
  if (ps && phase === FlightPhase.ORBIT && flightState) {
    const bodyId: string = flightState.bodyId || 'EARTH';
    if (isInUnsafeBeltOrbit(ps.posY, bodyId)) {
      showPhaseNotification(
        'Cannot return to hub \u2014 orbit is within the dense asteroid belt. Manoeuvre to a safe orbit first.',
        'warning',
      );
      return;
    }
  }

  // --- ORBIT: direct return with a brief warning ---
  if (ps && phase === FlightPhase.ORBIT && !ps.landed && !ps.crashed) {
    s.preMenuTimeWarp = s.timeWarp;
    s.timeWarp = 0;

    const host: HTMLElement = document.getElementById('ui-overlay') ?? document.body;
    const backdrop: HTMLDivElement = document.createElement('div');
    backdrop.id = 'abort-flight-backdrop';
    backdrop.className = 'topbar-modal-backdrop';

    const modal: HTMLDivElement = document.createElement('div');
    modal.className = 'topbar-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Return from Orbit');
    modal.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

    const titleRow: HTMLDivElement = document.createElement('div');
    titleRow.className = 'topbar-modal-title-row';
    const h2: HTMLHeadingElement = document.createElement('h2');
    h2.className = 'topbar-modal-title';
    h2.textContent = 'Return from Orbit?';
    titleRow.appendChild(h2);
    modal.appendChild(titleRow);

    const msg: HTMLParagraphElement = document.createElement('p');
    msg.className = 'confirm-msg';
    msg.textContent =
      'Your craft is in a stable orbit. Returning to the agency will complete this flight period. The craft will remain in orbit.';
    modal.appendChild(msg);

    const btnRow: HTMLDivElement = document.createElement('div');
    btnRow.className = 'confirm-btn-row';

    const continueBtn: HTMLButtonElement = document.createElement('button');
    continueBtn.className = 'confirm-btn confirm-btn-cancel';
    continueBtn.textContent = 'Stay in Orbit';
    continueBtn.dataset.testid = 'abort-continue-btn';
    continueBtn.addEventListener('click', () => {
      s.timeWarp = s.preMenuTimeWarp ?? 1;
      backdrop.remove();
    });

    const returnBtn: HTMLButtonElement = document.createElement('button');
    returnBtn.className = 'confirm-btn confirm-btn-primary';
    returnBtn.textContent = 'Return to Agency';
    returnBtn.dataset.testid = 'orbit-return-btn';
    returnBtn.addEventListener('click', () => {
      backdrop.remove();
      _handleReturnToAgency();
    });

    btnRow.appendChild(continueBtn);
    btnRow.appendChild(returnBtn);
    modal.appendChild(btnRow);

    backdrop.addEventListener('click', () => {
      s.timeWarp = s.preMenuTimeWarp ?? 1;
      backdrop.remove();
    });
    backdrop.appendChild(modal);
    host.appendChild(backdrop);
    return;
  }

  // --- Mid-flight abort: warn about lost parts ---
  if (ps && !ps.landed && !ps.crashed) {
    s.preMenuTimeWarp = s.timeWarp;
    s.timeWarp = 0;

    // Calculate total cost of active parts at risk.
    let totalCost = 0;
    if (s.assembly) {
      for (const [instanceId, placed] of s.assembly.parts) {
        if (!ps.activeParts.has(instanceId)) continue;
        const def = getPartById(placed.partId);
        if (def) totalCost += def.cost ?? 0;
      }
    }

    const host: HTMLElement = document.getElementById('ui-overlay') ?? document.body;
    const backdrop: HTMLDivElement = document.createElement('div');
    backdrop.id = 'abort-flight-backdrop';
    backdrop.className = 'topbar-modal-backdrop';

    const modal: HTMLDivElement = document.createElement('div');
    modal.className = 'topbar-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Abort Flight');
    modal.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

    // Title
    const titleRow: HTMLDivElement = document.createElement('div');
    titleRow.className = 'topbar-modal-title-row';
    const h2: HTMLHeadingElement = document.createElement('h2');
    h2.className = 'topbar-modal-title';
    h2.textContent = 'Abort Flight?';
    titleRow.appendChild(h2);
    modal.appendChild(titleRow);

    // Message
    const msg: HTMLParagraphElement = document.createElement('p');
    msg.className = 'confirm-msg';
    const costStr: string = '$' + Math.round(totalCost).toLocaleString('en-US');
    msg.textContent =
      'Your rocket is still in flight. Returning now means no parts will be recovered.';
    modal.appendChild(msg);

    const costLine: HTMLParagraphElement = document.createElement('p');
    costLine.className = 'confirm-msg';
    costLine.style.fontWeight = '600';
    costLine.style.marginTop = '-12px';
    costLine.textContent = `Parts at risk: ${costStr}`;
    modal.appendChild(costLine);

    // Buttons
    const btnRow: HTMLDivElement = document.createElement('div');
    btnRow.className = 'confirm-btn-row';

    const continueBtn: HTMLButtonElement = document.createElement('button');
    continueBtn.className = 'confirm-btn confirm-btn-cancel';
    continueBtn.textContent = 'Continue Flying';
    continueBtn.dataset.testid = 'abort-continue-btn';
    continueBtn.addEventListener('click', () => {
      s.timeWarp = s.preMenuTimeWarp ?? 1;
      backdrop.remove();
    });

    const abortBtn: HTMLButtonElement = document.createElement('button');
    abortBtn.className = 'confirm-btn confirm-btn-danger';
    abortBtn.textContent = 'Abort & Return';
    abortBtn.dataset.testid = 'abort-confirm-btn';
    abortBtn.addEventListener('click', () => {
      backdrop.remove();
      handleAbortReturnToAgency();
    });

    btnRow.appendChild(continueBtn);
    btnRow.appendChild(abortBtn);
    modal.appendChild(btnRow);

    backdrop.addEventListener('click', () => {
      s.timeWarp = s.preMenuTimeWarp ?? 1;
      backdrop.remove();
    });
    backdrop.appendChild(modal);
    host.appendChild(backdrop);
    return;
  }

  // Already landed or crashed -- go straight to the summary.
  _handleReturnToAgency();
}

/**
 * Show the post-flight summary.
 */
function _handleReturnToAgency(): void {
  const s = getFCState();
  if (s.summaryShown) return;
  s.summaryShown = true;
  showPostFlightSummary(getPhysicsState(), s.assembly, getFlightState(), s.state, s.onFlightEnd);
}

/**
 * Handle abort: skip the post-flight summary and return directly to the hub.
 */
export function handleAbortReturnToAgency(): void {
  const s = getFCState();
  if (s.summaryShown) return;
  s.summaryShown = true;

  // Capture references before stopFlightScene nulls them.
  const state       = s.state;
  const flightState = getFlightState();
  const ps          = getPhysicsState();
  const assembly    = s.assembly;
  const onFlightEnd = s.onFlightEnd;

  let returnResults: ReturnType<typeof processFlightReturn> | null = null;
  if (state && flightState) {
    returnResults = processFlightReturn(state, flightState, ps, assembly);
  }

  refreshTopBar();
  stopFlightScene();
  if (onFlightEnd) (onFlightEnd as (state: unknown, results?: unknown) => void)(state, returnResults);
}

/**
 * Menu action: show the flight log overlay.
 */
export function handleMenuFlightLog(): void {
  const s = getFCState();
  const host: HTMLElement = document.getElementById('ui-overlay') ?? document.body;

  // Remove any existing log overlay.
  const existing = document.getElementById('flight-log-overlay');
  if (existing) existing.remove();

  // Ensure game stays paused.
  const savedWarp: number = s.preMenuTimeWarp;
  s.timeWarp = 0;

  // -- Root overlay --
  const overlay: HTMLDivElement = document.createElement('div');
  overlay.id = 'flight-log-overlay';

  const content: HTMLDivElement = document.createElement('div');
  content.className = 'fl-content';
  overlay.appendChild(content);

  // Heading
  const heading: HTMLHeadingElement = document.createElement('h1');
  heading.textContent = 'Flight Log';
  content.appendChild(heading);

  // Event list
  const menuFs = getFlightState();
  const events = menuFs ? menuFs.events : [];
  content.appendChild(buildFlightEventList(events));

  // Close button
  const closeBtn: HTMLButtonElement = document.createElement('button');
  closeBtn.className = 'fl-close-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => {
    overlay.remove();
    s.timeWarp = savedWarp || 1;
  });
  content.appendChild(closeBtn);

  // Backdrop click closes the log.
  overlay.addEventListener('click', () => {
    overlay.remove();
    s.timeWarp = savedWarp || 1;
  });
  content.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

  host.appendChild(overlay);
}
