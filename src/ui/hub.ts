/**
 * hub.ts — Space Agency Hub HTML overlay UI.
 *
 * Renders the hub screen chrome over the PixiJS canvas:
 *   - Four clickable building divs positioned to sit on top of the
 *     corresponding PixiJS building rectangles in src/render/hub.js.
 *   - Each building div carries a human-readable label and a
 *     data-building-id attribute for Playwright / accessibility.
 *
 * The persistent top bar (agency name, cash readout, hamburger menu) is
 * provided by src/ui/topbar.js and mounted separately above all screens.
 *
 * LAYOUT CONTRACT
 * ===============
 * The geometry constants (GROUND_Y_PCT, each building's xCenterPct,
 * widthPct, heightPct) mirror those in src/render/hub.js.  If either file
 * is changed, both must be updated together.
 *
 * @module hub
 */

import { showHubScene, hideHubScene, setHubWeather, setBuiltFacilities, setHubBodyVisuals, destroyHubRenderer } from '../render/hub.ts';
import { FACILITY_DEFINITIONS, getFacilityUpgradeDef, getReputationTier, GameMode, EARTH_HUB_ID } from '../core/constants.ts';
import { openSettingsPanel } from './settings.ts';
import { openDebugSavePanel } from './debugSaves.ts';
import { setTopBarHubItems, clearTopBarHubItems } from './topbar.ts';
import {
  hasFacility, canBuildFacility, buildFacility,
  canUpgradeFacility, upgradeFacility, getFacilityTier,
  getDiscountedMoneyCost,
} from '../core/construction.ts';
import { getPartById } from '../data/parts.ts';
import { isBankrupt } from '../core/finance.ts';
import { initWeather, getCurrentWeather, getWeatherForecast } from '../core/weather.ts';
import { isWeatherPredictionAvailable } from '../core/mapView.ts';
import './hub.css';
import type { GameState } from '../core/gameState.ts';
import type { FlightReturnSummary } from '../core/flightReturn.ts';
import { initHubSwitcher, destroyHubSwitcher } from './hubSwitcher.ts';
import { getActiveHub } from '../core/hubs.ts';
import { createListenerTracker, type ListenerTracker } from './listenerTracker.ts';
import {
  EARTH_ONLY_FACILITIES,
  SURFACE_HUB_FACILITIES,
  ORBITAL_HUB_FACILITIES,
} from '../data/hubFacilities.ts';
import {
  formatReturnResults,
  formatNetCashChange,
  classifyFacilityAction,
  formatBuildCost,
  formatUpgradeAction,
} from './hub/_state.ts';

// ---------------------------------------------------------------------------
// Layout constants — must match src/render/hub.js
// ---------------------------------------------------------------------------

interface BuildingDef {
  id: string;
  label: string;
  xCenterPct: number;
  widthPct: number;
  heightPct: number;
}

const BUILDINGS: readonly BuildingDef[] = [
  {
    id:         'launch-pad',
    label:      'Launch Pad',
    xCenterPct: 0.07,
    widthPct:   0.07,
    heightPct:  0.22,
  },
  {
    id:         'vab',
    label:      'Vehicle Assembly Building',
    xCenterPct: 0.19,
    widthPct:   0.10,
    heightPct:  0.32,
  },
  {
    id:         'mission-control',
    label:      'Mission Control Centre',
    xCenterPct: 0.31,
    widthPct:   0.09,
    heightPct:  0.24,
  },
  {
    id:         'crew-admin',
    label:      'Crew Administration',
    xCenterPct: 0.42,
    widthPct:   0.08,
    heightPct:  0.18,
  },
  {
    id:         'tracking-station',
    label:      'Tracking Station',
    xCenterPct: 0.53,
    widthPct:   0.09,
    heightPct:  0.26,
  },
  {
    id:         'rd-lab',
    label:      'R&D Lab',
    xCenterPct: 0.65,
    widthPct:   0.10,
    heightPct:  0.24,
  },
  {
    id:         'satellite-ops',
    label:      'Satellite Ops',
    xCenterPct: 0.77,
    widthPct:   0.09,
    heightPct:  0.20,
  },
  {
    id:         'library',
    label:      'Library',
    xCenterPct: 0.88,
    widthPct:   0.08,
    heightPct:  0.16,
  },
  {
    id:         'logistics-center',
    label:      'Logistics Center',
    xCenterPct: 0.95,
    widthPct:   0.06,
    heightPct:  0.18,
  },
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The hub overlay root element. */
let _overlay: HTMLElement | null = null;

/** Cached reference to the game state for the construction panel. */
let _state: GameState | null = null;

/**
 * Module-scoped listener tracker. Initialised on first use (since some
 * exported modal functions — showWelcomeModal, showReturnResultsOverlay —
 * may be invoked before initHubUI). Cleared on destroyHubUI so all
 * hub-lifecycle listeners are bulk-removed.
 */
let _listeners: ListenerTracker | null = null;

/** Return the shared module listener tracker, creating it lazily if needed. */
function _getListeners(): ListenerTracker {
  if (!_listeners) {
    _listeners = createListenerTracker();
  }
  return _listeners;
}

// ---------------------------------------------------------------------------
// Welcome modal — shown once on first hub visit for a new game
// ---------------------------------------------------------------------------

/**
 * Show a welcome/introduction modal overlay on first entering the hub.
 * Content varies by game mode. Sets `state.welcomeShown = true` on dismiss.
 */
export function showWelcomeModal(container: HTMLElement, state: GameState): void {
  const existing = document.getElementById('welcome-modal');
  if (existing) existing.remove();

  const previouslyFocused: Element | null = document.activeElement;

  const overlay: HTMLDivElement = document.createElement('div');
  overlay.id = 'welcome-modal';

  const content: HTMLDivElement = document.createElement('div');
  content.className = 'welcome-content';
  overlay.appendChild(content);

  // ── Heading ────────────────────────────────────────────────────────────────
  const heading: HTMLHeadingElement = document.createElement('h1');
  heading.textContent = `Welcome to ${state.agencyName || 'Your Space Agency'}!`;
  content.appendChild(heading);

  const subtitle: HTMLParagraphElement = document.createElement('p');
  subtitle.className = 'welcome-subtitle';
  if (state.gameMode === GameMode.TUTORIAL) {
    subtitle.textContent = 'Tutorial Mode';
  } else if (state.gameMode === GameMode.SANDBOX) {
    subtitle.textContent = 'Sandbox Mode';
  } else {
    subtitle.textContent = 'Freeplay Mode';
  }
  content.appendChild(subtitle);

  // ── Body text — varies by game mode ────────────────────────────────────────
  const body: HTMLParagraphElement = document.createElement('p');
  body.className = 'welcome-body';

  if (state.gameMode === GameMode.TUTORIAL) {
    body.textContent =
      "You've secured $2M in funding (matched by a $2M loan) to build a space programme from scratch. " +
      'Head to Mission Control to accept your first mission, then build a rocket in the Vehicle Assembly Building and launch it from the Launch Pad. Good luck!';
  } else if (state.gameMode === GameMode.SANDBOX) {
    body.textContent =
      'Funds are unlimited and all parts and facilities are unlocked. ' +
      'Experiment freely with rocket designs, launch missions, and explore the solar system. ' +
      'Contracts and reputation are still active if you want objectives to pursue.';
  } else {
    // Freeplay
    body.textContent =
      "You've secured $2M in funding (matched by a $2M loan) and all starter parts are available from the start. " +
      'Build facilities, hire crew, and launch missions to grow your agency. ' +
      'Head to Mission Control to pick up a contract, or go straight to the VAB and start building!';
  }
  content.appendChild(body);

  // ── Dismiss button ─────────────────────────────────────────────────────────
  const dismissBtn: HTMLButtonElement = document.createElement('button');
  dismissBtn.className = 'welcome-dismiss-btn';
  dismissBtn.id = 'welcome-dismiss-btn';
  dismissBtn.textContent = "Let's Go!";

  _getListeners().add(dismissBtn, 'click', () => {
    state.welcomeShown = true;
    overlay.remove();
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus();
    }
  });

  content.appendChild(dismissBtn);
  container.appendChild(overlay);
  dismissBtn.focus();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the hub HTML overlay and show the PixiJS hub background.
 *
 * The persistent top bar (agency name, cash, hamburger menu) is provided by
 * src/ui/topbar.js and must be mounted separately via initTopBar() before
 * calling this function.
 */
export function initHubUI(container: HTMLElement, state: GameState, onNavigate: (destination: string) => void): void {
  _state = state;

  // Ensure the shared module listener tracker exists for this hub session.
  _getListeners();

  _overlay = document.createElement('div');
  _overlay.id = 'hub-overlay';
  container.appendChild(_overlay);

  // Set PixiJS background visuals based on the active hub's body.
  const activeHub = getActiveHub(state);
  setHubBodyVisuals(activeHub.bodyId, activeHub.type);

  // Tell the PixiJS renderer which facilities are built so it only draws those.
  // Use the active hub's facilities.
  if (state.gameMode === GameMode.SANDBOX) {
    setBuiltFacilities(null); // show all in sandbox
  } else {
    const hubFacilities = activeHub.facilities;
    const builtIds = new Set(
      Object.keys(hubFacilities).filter((id) => hubFacilities[id]?.built)
    );
    setBuiltFacilities(builtIds);
  }

  _renderBuildings(onNavigate);
  _renderBankruptcyBanner();
  _renderLeftPanel(container);
  _registerHubMenuItems(container);
  _bindDebugSavesShortcut(container);

  // Mount the hub switcher dropdown (hidden when only one hub exists).
  initHubSwitcher(_overlay, state, () => {
    // Re-render buildings and panels when hub changes
    destroyHubUI();
    initHubUI(container, state, onNavigate);
  });

  // Show the PixiJS background.
  showHubScene();

  // Preload commonly-navigated screens during idle time to prime the module cache.
  const preload = () => {
    void import('./vab.ts');
    void import('./missionControl.ts');
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(preload);
  } else {
    setTimeout(preload, 1000);
  }
}

/**
 * Remove the hub HTML overlay and hide the PixiJS background.
 * Call this before mounting a different screen (e.g. the VAB).
 */
export function destroyHubUI(): void {
  // Remove construction panel if open.
  const panel = document.getElementById('construction-panel');
  if (panel) panel.remove();

  // Remove debug save panel if open.
  const debugPanel = document.getElementById('debug-save-panel');
  if (debugPanel) debugPanel.remove();

  // Clean up hub-specific topbar items. Keyboard shortcuts registered via
  // the module listener tracker are removed at the end of this function.
  clearTopBarHubItems();

  // Tear down the hub switcher dropdown.
  destroyHubSwitcher();

  // Clear any focused building to prevent selection highlight leaking into
  // other screens (e.g. flight view).
  if (_overlay && document.activeElement && _overlay.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
  }

  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;

  // Bulk-remove all listeners registered during this hub session.
  if (_listeners) {
    _listeners.removeAll();
    _listeners = null;
  }

  hideHubScene();
  // Destroy the PixiJS scene root so its Graphics objects and the
  // RendererPool don't leak across hub ↔ VAB ↔ flight swaps.
  destroyHubRenderer();
}

/**
 * Display the "Return Results" summary overlay on top of the hub screen.
 *
 * Shows: missions completed (with rewards), parts unlocked, interest charged,
 * death fines applied, and the net change in cash.  A single "Dismiss" button
 * removes the overlay and calls `onDismiss`.
 *
 * Safe to call immediately after `initHubUI` — the overlay appends to
 * `container` (the #ui-overlay div) and stacks above the hub at z-index 500.
 */
export function showReturnResultsOverlay(container: HTMLElement, summary: FlightReturnSummary, onDismiss?: () => void): void {
  // Remove any stale overlay.
  const existing = document.getElementById('return-results-overlay');
  if (existing) existing.remove();

  const overlay: HTMLDivElement = document.createElement('div');
  overlay.id = 'return-results-overlay';

  const content: HTMLDivElement = document.createElement('div');
  content.className = 'rr-content';
  overlay.appendChild(content);

  // ── Heading ───────────────────────────────────────────────────────────────
  const heading: HTMLHeadingElement = document.createElement('h1');
  heading.textContent = 'Return to Agency';
  content.appendChild(heading);

  const subtitle: HTMLParagraphElement = document.createElement('p');
  subtitle.className = 'rr-subtitle';
  subtitle.textContent = `Flight ${summary.currentPeriod ?? summary.totalFlights} summary`;
  content.appendChild(subtitle);

  // ── Missions completed ────────────────────────────────────────────────────
  if (summary.completedMissions.length > 0) {
    const section: HTMLDivElement = document.createElement('div');
    section.className = 'rr-section';

    const sectionTitle: HTMLHeadingElement = document.createElement('h2');
    sectionTitle.textContent = 'Missions Completed';
    section.appendChild(sectionTitle);

    const list: HTMLUListElement = document.createElement('ul');
    list.className = 'rr-missions-list';

    for (const entry of summary.completedMissions) {
      const li: HTMLLIElement = document.createElement('li');

      const titleSpan: HTMLSpanElement = document.createElement('span');
      titleSpan.className = 'rr-mission-title';
      titleSpan.textContent = entry.mission.title;

      const rewardSpan: HTMLSpanElement = document.createElement('span');
      rewardSpan.className = 'rr-mission-reward';
      rewardSpan.textContent = `+$${entry.reward.toLocaleString('en-US')}`;

      li.appendChild(titleSpan);
      li.appendChild(rewardSpan);
      list.appendChild(li);
    }

    section.appendChild(list);
    content.appendChild(section);
  }

  // ── Parts unlocked ────────────────────────────────────────────────────────
  const allUnlockedParts: string[] = summary.completedMissions.flatMap((e) => e.unlockedParts);
  if (allUnlockedParts.length > 0) {
    const section: HTMLDivElement = document.createElement('div');
    section.className = 'rr-section';

    const sectionTitle: HTMLHeadingElement = document.createElement('h2');
    sectionTitle.textContent = 'Parts Unlocked';
    section.appendChild(sectionTitle);

    const list: HTMLUListElement = document.createElement('ul');
    list.className = 'rr-parts-list';

    for (const partId of allUnlockedParts) {
      const li: HTMLLIElement = document.createElement('li');
      const partDef = getPartById(partId);
      li.textContent = partDef?.name ?? partId;
      list.appendChild(li);
    }

    section.appendChild(list);
    content.appendChild(section);
  }

  // ── Financial summary ─────────────────────────────────────────────────────
  const finSection: HTMLDivElement = document.createElement('div');
  finSection.className = 'rr-section';

  const finTitle: HTMLHeadingElement = document.createElement('h2');
  finTitle.textContent = 'Financial Summary';
  finSection.appendChild(finTitle);

  for (const row of formatReturnResults(summary)) {
    finSection.appendChild(_rrRow(row.label, row.value, row.tone));
  }

  // Net cash change.
  const netDisplay = formatNetCashChange(summary.netCashChange);
  const netEl: HTMLDivElement = document.createElement('div');
  netEl.className = 'rr-net-change';

  const netLabel: HTMLSpanElement = document.createElement('span');
  netLabel.className = 'rr-label';
  netLabel.textContent = netDisplay.label;

  const netValue: HTMLSpanElement = document.createElement('span');
  netValue.className = `rr-value ${netDisplay.positive ? 'rr-value-positive' : 'rr-value-negative'}`;
  netValue.textContent = netDisplay.value;

  netEl.appendChild(netLabel);
  netEl.appendChild(netValue);
  finSection.appendChild(netEl);

  content.appendChild(finSection);

  // ── Reputation change (if any) ──────────────────────────────────────────
  if (typeof summary.reputationChange === 'number' && summary.reputationChange !== 0) {
    const repSection: HTMLDivElement = document.createElement('div');
    repSection.className = 'rr-section';

    const repTitle: HTMLHeadingElement = document.createElement('h2');
    repTitle.textContent = 'Reputation';
    repSection.appendChild(repTitle);

    const repTier = getReputationTier(summary.reputationAfter ?? 50);

    const repRow: HTMLDivElement = document.createElement('div');
    repRow.className = 'rr-row';
    const repLabel: HTMLSpanElement = document.createElement('span');
    repLabel.className = 'rr-label';
    repLabel.textContent = 'Change';
    const repValue: HTMLSpanElement = document.createElement('span');
    const repSign: string = summary.reputationChange >= 0 ? '+' : '';
    repValue.className = `rr-value ${summary.reputationChange >= 0 ? 'rr-value-positive' : 'rr-value-negative'}`;
    repValue.textContent = `${repSign}${summary.reputationChange}`;
    repRow.appendChild(repLabel);
    repRow.appendChild(repValue);
    repSection.appendChild(repRow);

    const repNowRow: HTMLDivElement = document.createElement('div');
    repNowRow.className = 'rr-row';
    const repNowLabel: HTMLSpanElement = document.createElement('span');
    repNowLabel.className = 'rr-label';
    repNowLabel.textContent = 'Current';
    const repNowValue: HTMLSpanElement = document.createElement('span');
    repNowValue.className = 'rr-value';
    repNowValue.style.color = repTier.color;
    repNowValue.textContent = `${Math.round(summary.reputationAfter ?? 50)} — ${repTier.label}`;
    repNowRow.appendChild(repNowLabel);
    repNowRow.appendChild(repNowValue);
    repSection.appendChild(repNowRow);

    content.appendChild(repSection);
  }

  // ── Deployed field craft (crew left in orbit/landed) ──────────────────────
  if (summary.deployedFieldCraft) {
    const fcSection: HTMLDivElement = document.createElement('div');
    fcSection.className = 'rr-section';

    const fcTitle: HTMLHeadingElement = document.createElement('h2');
    fcTitle.textContent = 'Crew Deployed in Field';
    fcSection.appendChild(fcTitle);

    const fc = summary.deployedFieldCraft;
    const statusLabel: string = fc.status === 'IN_ORBIT' ? 'In orbit' : 'Landed';
    const supplyLabel: string = fc.hasExtendedLifeSupport
      ? 'Supplies: Unlimited (Extended Mission Module)'
      : `Supplies: ${fc.suppliesRemaining} flights remaining`;

    fcSection.appendChild(_rrRow(fc.name, `${statusLabel} at ${fc.bodyId}`));
    fcSection.appendChild(_rrRow('Crew aboard', `${fc.crewIds.length} astronaut${fc.crewIds.length !== 1 ? 's' : ''}`));
    fcSection.appendChild(_rrRow('Life support', supplyLabel));

    content.appendChild(fcSection);
  }

  // ── Life support deaths (crew died from supply exhaustion) ──────────────
  if (Array.isArray(summary.lifeSupportDeaths) && summary.lifeSupportDeaths.length > 0) {
    const deathSection: HTMLDivElement = document.createElement('div');
    deathSection.className = 'rr-section';
    deathSection.style.background = 'rgba(120, 20, 20, 0.5)';
    deathSection.style.border = '1px solid #ff4040';
    deathSection.style.borderRadius = '6px';
    deathSection.style.padding = '14px 16px';

    const deathTitle: HTMLHeadingElement = document.createElement('h2');
    deathTitle.textContent = 'Life Support Exhausted';
    deathTitle.style.color = '#ff6060';
    deathTitle.style.borderBottom = 'none';
    deathSection.appendChild(deathTitle);

    for (const d of summary.lifeSupportDeaths) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = 'rr-row';
      const label: HTMLSpanElement = document.createElement('span');
      label.className = 'rr-label';
      label.textContent = `${d.crewName} — ${d.craftName}`;
      label.style.color = '#ffc0c0';
      const value: HTMLSpanElement = document.createElement('span');
      value.className = 'rr-value rr-value-negative';
      value.textContent = 'KIA';
      row.appendChild(label);
      row.appendChild(value);
      deathSection.appendChild(row);
    }

    content.appendChild(deathSection);
  }

  // ── Life support warnings (supplies critically low) ────────────────────
  if (Array.isArray(summary.lifeSupportWarnings) && summary.lifeSupportWarnings.length > 0) {
    const warnSection: HTMLDivElement = document.createElement('div');
    warnSection.className = 'rr-section';
    warnSection.style.background = 'rgba(120, 100, 20, 0.4)';
    warnSection.style.border = '1px solid #ffaa30';
    warnSection.style.borderRadius = '6px';
    warnSection.style.padding = '14px 16px';

    const warnTitle: HTMLHeadingElement = document.createElement('h2');
    warnTitle.textContent = 'Life Support Warning';
    warnTitle.style.color = '#ffcc40';
    warnTitle.style.borderBottom = 'none';
    warnSection.appendChild(warnTitle);

    for (const w of summary.lifeSupportWarnings) {
      const row: HTMLDivElement = document.createElement('div');
      row.className = 'rr-row';
      const label: HTMLSpanElement = document.createElement('span');
      label.className = 'rr-label';
      label.textContent = `${w.craftName} — ${w.crewIds.length} crew`;
      label.style.color = '#ffe0a0';
      const value: HTMLSpanElement = document.createElement('span');
      value.className = 'rr-value';
      value.style.color = '#ffcc40';
      value.textContent = `${w.suppliesRemaining} flight${w.suppliesRemaining !== 1 ? 's' : ''} of supplies left`;
      row.appendChild(label);
      row.appendChild(value);
      warnSection.appendChild(row);
    }

    const warnMsg: HTMLParagraphElement = document.createElement('p');
    warnMsg.style.fontSize = '0.85rem';
    warnMsg.style.color = '#ffe0a0';
    warnMsg.style.margin = '8px 0 0';
    warnMsg.textContent = 'Launch a rescue mission before supplies run out or the crew will die!';
    warnSection.appendChild(warnMsg);

    content.appendChild(warnSection);
  }

  // ── Bankruptcy warning (if applicable) ────────────────────────────────────
  if (summary.bankrupt) {
    const bankruptSection: HTMLDivElement = document.createElement('div');
    bankruptSection.className = 'rr-section';
    bankruptSection.style.background = 'rgba(120, 20, 20, 0.5)';
    bankruptSection.style.border = '1px solid #ff4040';
    bankruptSection.style.borderRadius = '6px';
    bankruptSection.style.padding = '14px 16px';

    const bankruptTitle: HTMLHeadingElement = document.createElement('h2');
    bankruptTitle.textContent = 'Agency Bankrupt';
    bankruptTitle.style.color = '#ff6060';
    bankruptTitle.style.borderBottom = 'none';
    bankruptSection.appendChild(bankruptTitle);

    const bankruptMsg: HTMLParagraphElement = document.createElement('p');
    bankruptMsg.style.fontSize = '0.88rem';
    bankruptMsg.style.color = '#ffc0c0';
    bankruptMsg.style.margin = '0';
    bankruptMsg.textContent = 'You cannot afford to build even the cheapest rocket. Fire crew to reduce salaries, take out a loan, or accept cheaper contracts.';
    bankruptSection.appendChild(bankruptMsg);

    content.appendChild(bankruptSection);
  }

  // ── Dismiss button ────────────────────────────────────────────────────────
  const dismissBtn: HTMLButtonElement = document.createElement('button');
  dismissBtn.id        = 'return-results-dismiss-btn';
  dismissBtn.className = 'rr-dismiss-btn';
  dismissBtn.textContent = '← Return to Hub';

  _getListeners().add(dismissBtn, 'click', () => {
    overlay.remove();
    if (onDismiss) onDismiss();
  });

  content.appendChild(dismissBtn);
  container.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/**
 * Build a single financial summary row `<div>`.
 */
function _rrRow(label: string, value: string, tone: 'positive' | 'negative' | 'neutral' = 'neutral'): HTMLDivElement {
  const row: HTMLDivElement = document.createElement('div');
  row.className = 'rr-row';

  const labelEl: HTMLSpanElement = document.createElement('span');
  labelEl.className = 'rr-label';
  labelEl.textContent = label;

  const valueEl: HTMLSpanElement = document.createElement('span');
  valueEl.className = `rr-value rr-value-${tone}`;
  valueEl.textContent = value;

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

/**
 * Show a bankruptcy warning banner if the player cannot afford any rocket.
 */
function _renderBankruptcyBanner(): void {
  if (!_overlay || !_state) return;

  // Remove any stale banner.
  const existing = document.getElementById('bankruptcy-banner');
  if (existing) existing.remove();

  if (!isBankrupt(_state)) return;

  const banner: HTMLDivElement = document.createElement('div');
  banner.id = 'bankruptcy-banner';

  const title: HTMLDivElement = document.createElement('div');
  title.className = 'bankruptcy-title';
  title.textContent = 'Agency Bankrupt';
  banner.appendChild(title);

  const msg: HTMLDivElement = document.createElement('div');
  msg.textContent = 'You cannot afford to build even the cheapest rocket.';
  banner.appendChild(msg);

  const hint: HTMLDivElement = document.createElement('div');
  hint.className = 'bankruptcy-hint';
  hint.textContent = 'Fire crew to reduce salaries, take out a loan, or accept cheaper contracts.';
  banner.appendChild(hint);

  _overlay.appendChild(banner);
}

/**
 * Create the left-side info panel containing the reputation badge and weather.
 */
function _renderLeftPanel(_container: HTMLElement): void {
  if (!_overlay || !_state) return;

  // Remove stale left panel.
  const existingPanel = document.getElementById('hub-left-panel');
  if (existingPanel) existingPanel.remove();

  const leftPanel: HTMLDivElement = document.createElement('div');
  leftPanel.id = 'hub-left-panel';

  _renderReputationBadge(leftPanel);
  _renderWeatherPanel(leftPanel);

  _overlay.appendChild(leftPanel);
}

/**
 * Render the reputation badge on the hub screen.
 * Shows current reputation value, tier label (colour-coded), and a progress bar.
 */
function _renderReputationBadge(parent: HTMLElement): void {
  if (!_state) return;

  // Remove existing badge if present (for refresh).
  const existing = document.getElementById('hub-reputation-badge');
  if (existing) existing.remove();

  const rep: number = _state.reputation ?? 50;
  const tier = getReputationTier(rep);

  const badge: HTMLDivElement = document.createElement('div');
  badge.id = 'hub-reputation-badge';

  // Label
  const label: HTMLSpanElement = document.createElement('span');
  label.className = 'hub-rep-label';
  label.textContent = 'Reputation';
  badge.appendChild(label);

  // Value
  const value: HTMLSpanElement = document.createElement('span');
  value.className = 'hub-rep-value';
  value.style.color = tier.color;
  value.textContent = `${Math.round(rep)}`;
  badge.appendChild(value);

  // Tier chip
  const tierChip: HTMLSpanElement = document.createElement('span');
  tierChip.className = 'hub-rep-tier';
  tierChip.style.color = tier.color;
  tierChip.style.background = `${tier.color}22`;
  tierChip.style.border = `1px solid ${tier.color}44`;
  tierChip.textContent = tier.label;
  badge.appendChild(tierChip);

  // Progress track
  const track: HTMLDivElement = document.createElement('div');
  track.className = 'hub-rep-track';
  const fill: HTMLDivElement = document.createElement('div');
  fill.className = 'hub-rep-fill';
  fill.style.width = `${Math.max(0, Math.min(100, rep))}%`;
  fill.style.backgroundColor = tier.color;
  track.appendChild(fill);
  badge.appendChild(track);

  parent.appendChild(badge);
}

/**
 * Render the weather conditions as a compact inline bar on the hub screen.
 * Matches the Launch Pad's compact weather bar format.
 * Initialises weather state if not already present.
 */
function _renderWeatherPanel(parent: HTMLElement): void {
  if (!_state) return;

  // Remove any stale panel.
  const existing = document.getElementById('weather-panel');
  if (existing) existing.remove();

  // Hide weather panel in sandbox mode when weather is disabled.
  if (_state.gameMode === GameMode.SANDBOX && !_state.sandboxSettings?.weatherEnabled) return;

  // Initialise weather if needed (first hub visit or after save load).
  if (!_state.weather) {
    initWeather(_state, 'EARTH');
  }

  const weather = getCurrentWeather(_state);

  // Don't show panel for airless bodies.
  if (weather.description === 'No atmosphere') return;

  const panel: HTMLDivElement = document.createElement('div');
  panel.id = 'weather-panel';

  // Main info row — compact inline bar with description + stats
  const info: HTMLDivElement = document.createElement('div');
  info.className = 'weather-info';

  // Description
  const desc: HTMLSpanElement = document.createElement('span');
  desc.className = 'weather-description';
  if (weather.extreme) {
    desc.classList.add('weather-extreme');
  } else if (weather.windSpeed < 6) {
    desc.classList.add('weather-good');
  } else {
    desc.classList.add('weather-moderate');
  }
  desc.textContent = weather.description;
  info.appendChild(desc);

  // Wind speed
  _addWeatherRow(info, 'Wind', `${weather.windSpeed.toFixed(1)} m/s`);

  // Temperature (ISP effect)
  const tempPct: string = ((weather.temperature - 1) * 100).toFixed(1);
  const tempStr: string = weather.temperature >= 1 ? `+${tempPct}%` : `${tempPct}%`;
  _addWeatherRow(info, 'ISP Effect', tempStr);

  // Visibility
  const visLabels: string[] = ['Clear', 'Light haze', 'Moderate haze', 'Heavy haze', 'Dense fog'];
  const visIdx: number = Math.min(4, Math.floor(weather.visibility * 5));
  _addWeatherRow(info, 'Visibility', visLabels[visIdx]);

  // Extreme weather warning (inline)
  if (weather.extreme) {
    const warn: HTMLSpanElement = document.createElement('span');
    warn.className = 'weather-warning';
    warn.textContent = 'EXTREME — Launch not recommended';
    info.appendChild(warn);
  }

  panel.appendChild(info);

  // Forecast row (if weather satellites provide data AND Tracking Station tier 2+)
  const forecast = isWeatherPredictionAvailable(_state) ? getWeatherForecast(_state, 'EARTH', 3) : [];
  if (forecast.length > 0) {
    const fcSection: HTMLDivElement = document.createElement('div');
    fcSection.className = 'weather-forecast';

    forecast.forEach((fc: { description: string; windSpeed: number; extreme: boolean }, i: number) => {
      const day: HTMLSpanElement = document.createElement('span');
      day.className = 'weather-forecast-day';
      day.textContent = `Skip ${i + 1}: ${fc.description} (${fc.windSpeed.toFixed(0)} m/s)`;
      if (fc.extreme) day.style.color = '#ff6060';
      fcSection.appendChild(day);
    });

    panel.appendChild(fcSection);
  }

  parent.appendChild(panel);

  // Update the PixiJS hub renderer with weather visuals.
  setHubWeather(weather.visibility, weather.extreme);
}

/**
 * Helper: add a compact label: value item to a weather info row.
 */
function _addWeatherRow(parent: HTMLElement, label: string, value: string): void {
  const row: HTMLSpanElement = document.createElement('span');
  row.className = 'weather-row';

  const lbl: HTMLSpanElement = document.createElement('span');
  lbl.className = 'weather-label';
  lbl.textContent = `${label}: `;
  row.appendChild(lbl);

  const val: HTMLSpanElement = document.createElement('span');
  val.className = 'weather-value';
  val.textContent = value;
  row.appendChild(val);

  parent.appendChild(row);
}

/**
 * Create and append one `<div>` per building inside the overlay.
 */
function _renderBuildings(onNavigate: (destination: string) => void): void {
  if (!_overlay || !_state) return;

  const hub = getActiveHub(_state);
  const isEarth = hub.id === EARTH_HUB_ID;
  const allowedFacilities: readonly string[] = isEarth
    ? [] // Earth shows all buildings (no filter)
    : hub.type === 'orbital'
      ? ORBITAL_HUB_FACILITIES
      : SURFACE_HUB_FACILITIES;

  // Build a set of facility IDs currently under construction (not yet completed).
  const underConstruction = new Set<string>();
  for (const project of hub.constructionQueue) {
    if (project.completedPeriod == null) {
      underConstruction.add(project.facilityId);
    }
  }

  for (const bld of BUILDINGS) {
    // For non-Earth hubs, skip Earth-only facilities and facilities not in the
    // allowed list for this hub type.
    if (!isEarth) {
      if ((EARTH_ONLY_FACILITIES as readonly string[]).includes(bld.id)) continue;
      if (!allowedFacilities.includes(bld.id)) continue;
    }

    // In sandbox mode all facilities are always built, so show all.
    // In tutorial/freeplay mode, only show facilities that have been built
    // OR are currently under construction.
    const isBuilt = hasFacility(_state, bld.id);
    const isUnderConstruction = underConstruction.has(bld.id);

    if (_state.gameMode !== GameMode.SANDBOX && !isBuilt && !isUnderConstruction) {
      continue;
    }

    const el: HTMLDivElement = document.createElement('div');
    el.className    = 'hub-building';
    el.dataset.buildingId = bld.id;
    el.setAttribute('role',       'button');
    el.setAttribute('tabindex',   '0');
    el.setAttribute('aria-label', bld.label);

    // Under-construction facilities render at 50% opacity.
    if (isUnderConstruction && !isBuilt) {
      el.style.opacity = '0.5';
      el.dataset.buildingStatus = 'under-construction';
    }

    // Position: left edge and width as % of viewport width.
    const leftPct: number  = (bld.xCenterPct - bld.widthPct / 2) * 100;
    el.style.left   = `${leftPct.toFixed(4)}%`;
    el.style.width  = `${(bld.widthPct  * 100).toFixed(4)}%`;
    // Height extends upward from the ground line.
    el.style.height = `${(bld.heightPct * 100).toFixed(4)}%`;

    // Label
    const label: HTMLSpanElement = document.createElement('span');
    label.className   = 'hub-building-label';
    label.textContent = bld.label;
    el.appendChild(label);

    // Click handler
    _getListeners().add(el, 'click', () => {
      el.blur(); // Clear focus highlight before navigating away
      onNavigate(bld.id);
    });

    // Keyboard handler (Enter / Space)
    _getListeners().add(el, 'keydown', ((e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.blur();
        onNavigate(bld.id);
      }
    }) as EventListener);

    _overlay.appendChild(el);
  }
}

/**
 * Register Construction and Settings as hub-specific items in the topbar
 * hamburger menu. Cleared automatically when the hub is destroyed.
 */
function _registerHubMenuItems(container: HTMLElement): void {
  setTopBarHubItems([
    {
      label: 'Construction',
      id: 'hub-construction-btn',
      onClick: () => _openConstructionPanel(container),
    },
    {
      label: 'Settings',
      id: 'hub-settings-btn',
      onClick: () => openSettingsPanel(container, _state!),
    },
  ]);
}

/**
 * Bind Ctrl+Shift+D to open the debug saves panel.
 *
 * Registered through the module listener tracker; removed on hub destroy
 * via the tracker's `removeAll()`.
 */
function _bindDebugSavesShortcut(container: HTMLElement): void {
  const handler = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (_state && _state.debugMode) {
        openDebugSavePanel(container, _state);
      }
    }
  };
  _getListeners().add(document, 'keydown', handler as EventListener);
}

/**
 * Open the construction panel overlay.
 */
function _openConstructionPanel(container: HTMLElement): void {
  // Prevent duplicate.
  if (document.getElementById('construction-panel')) return;
  if (!_state) return;

  const panel: HTMLDivElement = document.createElement('div');
  panel.id = 'construction-panel';

  const content: HTMLDivElement = document.createElement('div');
  content.className = 'cp-content';
  panel.appendChild(content);

  // ── Heading ────────────────────────────────────────────────────────────
  const heading: HTMLHeadingElement = document.createElement('h1');
  heading.textContent = 'Construction';
  content.appendChild(heading);

  const subtitle: HTMLParagraphElement = document.createElement('p');
  subtitle.className = 'cp-subtitle';
  subtitle.textContent = _state.tutorialMode
    ? 'Tutorial Mode — Facilities unlocked via missions'
    : 'Build new facilities for your agency';
  content.appendChild(subtitle);

  // ── Facility list ──────────────────────────────────────────────────────
  const list: HTMLUListElement = document.createElement('ul');
  list.className = 'cp-facility-list';

  for (const def of FACILITY_DEFINITIONS) {
    const item: HTMLLIElement = document.createElement('li');
    item.className = 'cp-facility-item';

    // Info column.
    const info: HTMLDivElement = document.createElement('div');
    info.className = 'cp-facility-info';

    const nameEl: HTMLParagraphElement = document.createElement('p');
    nameEl.className = 'cp-facility-name';
    nameEl.textContent = def.name;

    // Show tier badge for built, upgradeable facilities.
    const upgradeDef = getFacilityUpgradeDef(def.id);
    if (hasFacility(_state, def.id) && upgradeDef) {
      const tier: number = getFacilityTier(_state, def.id);
      const tierBadge: HTMLSpanElement = document.createElement('span');
      tierBadge.className = 'cp-tier-badge';
      tierBadge.textContent = `Tier ${tier}`;
      nameEl.appendChild(tierBadge);
    }

    info.appendChild(nameEl);

    const descEl: HTMLParagraphElement = document.createElement('p');
    descEl.className = 'cp-facility-desc';
    descEl.textContent = def.description;
    info.appendChild(descEl);

    item.appendChild(info);

    // ── Cost + Action columns ──────────────────────────────────────────
    const isBuilt: boolean = hasFacility(_state, def.id);
    const upgrade = isBuilt ? canUpgradeFacility(_state, def.id) : null;
    const actionKind = classifyFacilityAction(
      isBuilt,
      upgradeDef != null,
      upgrade?.nextTier ?? 0,
      _state.tutorialMode,
    );

    if (actionKind === 'upgrade' && upgrade) {
      // Show upgrade cost.
      const costGroup: HTMLDivElement = document.createElement('div');
      costGroup.className = 'cp-cost-group';

      const moneyCostEl: HTMLSpanElement = document.createElement('span');
      moneyCostEl.className = 'cp-facility-cost';
      moneyCostEl.textContent = `$${upgrade.moneyCost.toLocaleString('en-US')}`;
      costGroup.appendChild(moneyCostEl);

      if (upgrade.scienceCost > 0) {
        const sciCostEl: HTMLSpanElement = document.createElement('span');
        sciCostEl.className = 'cp-facility-cost-science';
        sciCostEl.textContent = `${upgrade.scienceCost} science`;
        costGroup.appendChild(sciCostEl);
      }

      item.appendChild(costGroup);

      // Upgrade action.
      const actionGroup: HTMLDivElement = document.createElement('div');
      actionGroup.className = 'cp-action-group';

      const upgradeDisplay = formatUpgradeAction(upgrade.nextTier, upgrade.allowed, upgrade.reason);
      const btn: HTMLButtonElement = document.createElement('button');
      btn.className = 'cp-upgrade-btn';
      btn.textContent = upgradeDisplay.buttonLabel;
      btn.disabled = !upgradeDisplay.enabled;
      if (upgradeDisplay.disabledTooltip != null) {
        btn.title = upgradeDisplay.disabledTooltip;
      }
      _getListeners().add(btn, 'click', () => {
        const result = upgradeFacility(_state!, def.id);
        if (result.success) {
          panel.remove();
          _openConstructionPanel(container);
        }
      });
      actionGroup.appendChild(btn);

      if (upgrade.description) {
        const descNote: HTMLParagraphElement = document.createElement('p');
        descNote.className = 'cp-upgrade-desc';
        descNote.textContent = upgrade.description;
        actionGroup.appendChild(descNote);
      }

      item.appendChild(actionGroup);
    } else if (actionKind === 'max-tier' || actionKind === 'built') {
      // Built, no upgrades available (or max tier).
      const costEl: HTMLSpanElement = document.createElement('span');
      costEl.className = 'cp-facility-cost cp-facility-cost-free';
      costEl.textContent = '';
      item.appendChild(costEl);

      const badge: HTMLSpanElement = document.createElement('span');
      badge.className = 'cp-built-badge';
      badge.textContent = actionKind === 'max-tier' ? 'Max Tier' : 'Built';
      item.appendChild(badge);
    } else if (actionKind === 'locked') {
      // Cost column (informational).
      const costEl: HTMLSpanElement = document.createElement('span');
      costEl.className = 'cp-facility-cost';
      costEl.textContent = '';
      item.appendChild(costEl);

      const badge: HTMLSpanElement = document.createElement('span');
      badge.className = 'cp-locked-badge';
      badge.textContent = 'Locked — complete missions to unlock';
      item.appendChild(badge);
    } else {
      // 'build' — not built, not tutorial — show build cost + button.
      const costGroup: HTMLDivElement = document.createElement('div');
      costGroup.className = 'cp-cost-group';

      const discountedCost: number = getDiscountedMoneyCost(def.cost, _state.reputation ?? 50);
      const buildCost = formatBuildCost(def.cost, discountedCost);

      const moneyCostEl: HTMLSpanElement = document.createElement('span');
      moneyCostEl.className = buildCost.isFree
        ? 'cp-facility-cost cp-facility-cost-free'
        : 'cp-facility-cost';
      moneyCostEl.textContent = buildCost.costLabel;
      costGroup.appendChild(moneyCostEl);

      if (buildCost.discountNote != null) {
        const discountNote: HTMLSpanElement = document.createElement('span');
        discountNote.className = 'cp-discount-note';
        discountNote.textContent = buildCost.discountNote;
        costGroup.appendChild(discountNote);
      }

      if ((def.scienceCost ?? 0) > 0) {
        const sciCostEl: HTMLSpanElement = document.createElement('span');
        sciCostEl.className = 'cp-facility-cost-science';
        sciCostEl.textContent = `${def.scienceCost} science`;
        costGroup.appendChild(sciCostEl);
      }

      item.appendChild(costGroup);

      // Build button.
      const check = canBuildFacility(_state, def.id);
      const btn: HTMLButtonElement = document.createElement('button');
      btn.className = 'cp-build-btn';
      btn.textContent = 'Build';
      btn.disabled = !check.allowed;
      if (!check.allowed) {
        btn.title = check.reason;
      }
      _getListeners().add(btn, 'click', () => {
        const result = buildFacility(_state!, def.id);
        if (result.success) {
          // Re-render the panel to reflect the change.
          panel.remove();
          _openConstructionPanel(container);
        }
      });
      item.appendChild(btn);
    }

    list.appendChild(item);
  }

  content.appendChild(list);

  // ── Close button ───────────────────────────────────────────────────────
  const closeBtn: HTMLButtonElement = document.createElement('button');
  closeBtn.className = 'cp-close-btn';
  closeBtn.textContent = '← Hub';
  _getListeners().add(closeBtn, 'click', () => {
    panel.remove();
  });
  content.appendChild(closeBtn);

  container.appendChild(panel);
}
