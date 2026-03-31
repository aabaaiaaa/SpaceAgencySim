/**
 * hub.js — Space Agency Hub HTML overlay UI.
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

import { showHubScene, hideHubScene, setHubWeather } from '../render/hub.js';
import { FACILITY_DEFINITIONS, FacilityId, FACILITY_UPGRADE_DEFS, getFacilityUpgradeDef, getReputationTier } from '../core/constants.js';
import {
  hasFacility, canBuildFacility, buildFacility,
  canUpgradeFacility, upgradeFacility, getFacilityTier,
  getDiscountedMoneyCost,
} from '../core/construction.js';
import { isBankrupt } from '../core/finance.js';
import { initWeather, getCurrentWeather, getWeatherForecast } from '../core/weather.js';
import { isWeatherPredictionAvailable } from '../core/mapView.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const HUB_STYLES = `
/* ── Hub overlay ──────────────────────────────────────────────────────────── */
#hub-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: system-ui, sans-serif;
}

/* ── Return Results overlay ───────────────────────────────────────────────── */
#return-results-overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.94);
  z-index: 500;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: system-ui, sans-serif;
  color: #d0e0f0;
  pointer-events: auto;
  overflow: hidden;
}

.rr-content {
  width: 100%;
  max-width: 640px;
  padding: 36px 24px 44px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

#return-results-overlay h1 {
  font-size: 1.7rem;
  font-weight: 700;
  margin: 0 0 8px;
  letter-spacing: 0.04em;
  color: #80c8ff;
}

.rr-subtitle {
  font-size: 0.85rem;
  color: #5080a0;
  margin: 0 0 28px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rr-section {
  width: 100%;
  margin-bottom: 24px;
}

.rr-section h2 {
  font-size: 0.78rem;
  font-weight: 700;
  color: #5880a0;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.rr-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 5px 0;
  font-size: 0.92rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.rr-row:last-child {
  border-bottom: none;
}

.rr-label {
  color: #a0b8d0;
}

.rr-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.rr-value-positive {
  color: #50d870;
}

.rr-value-negative {
  color: #ff8080;
}

.rr-value-neutral {
  color: #c0d8f0;
}

.rr-parts-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.rr-parts-list li {
  padding: 4px 0;
  font-size: 0.9rem;
  color: #90d0f0;
}

.rr-parts-list li::before {
  content: '+ ';
  color: #50d870;
}

.rr-missions-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.rr-missions-list li {
  padding: 5px 0;
  display: flex;
  justify-content: space-between;
  font-size: 0.92rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.rr-missions-list li:last-child {
  border-bottom: none;
}

.rr-mission-title {
  color: #c0d8f0;
}

.rr-mission-reward {
  color: #50d870;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.rr-divider {
  width: 100%;
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 0 12px;
}

.rr-net-change {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 0;
  font-size: 1.05rem;
  font-weight: 700;
  width: 100%;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.rr-dismiss-btn {
  margin-top: 24px;
  padding: 12px 40px;
  background: #1a4070;
  border: 1px solid #4080b0;
  border-radius: 6px;
  color: #c8e8ff;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.15s;
  letter-spacing: 0.03em;
}

.rr-dismiss-btn:hover {
  background: #235a90;
}

/* ── Bankruptcy banner ───────────────────────────────────────────────────── */
#bankruptcy-banner {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  padding: 14px 28px;
  background: rgba(120, 20, 20, 0.92);
  border: 1px solid #ff4040;
  border-radius: 8px;
  color: #ffc0c0;
  font-size: 0.92rem;
  font-weight: 600;
  text-align: center;
  pointer-events: auto;
  z-index: 25;
  max-width: 500px;
  line-height: 1.4;
  animation: bankruptcy-pulse 2s ease-in-out infinite;
}

#bankruptcy-banner .bankruptcy-title {
  font-size: 1.05rem;
  color: #ff6060;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

#bankruptcy-banner .bankruptcy-hint {
  font-size: 0.8rem;
  font-weight: 400;
  color: #d09090;
}

@keyframes bankruptcy-pulse {
  0%, 100% { border-color: #ff4040; }
  50% { border-color: #ff8080; }
}

/* ── Construction button ─────────────────────────────────────────────────── */
#hub-construction-btn {
  position: absolute;
  top: 60px;
  right: 16px;
  padding: 10px 20px;
  background: #1a4070;
  border: 1px solid #4080b0;
  border-radius: 6px;
  color: #c8e8ff;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.15s;
  letter-spacing: 0.03em;
  z-index: 20;
}

#hub-construction-btn:hover {
  background: #235a90;
}

/* ── Construction panel overlay ──────────────────────────────────────────── */
#construction-panel {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.92);
  z-index: 400;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: system-ui, sans-serif;
  color: #d0e0f0;
  pointer-events: auto;
  overflow: hidden;
}

.cp-content {
  width: 100%;
  max-width: 600px;
  padding: 36px 24px 44px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

#construction-panel h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 6px;
  letter-spacing: 0.04em;
  color: #80c8ff;
}

.cp-subtitle {
  font-size: 0.82rem;
  color: #5080a0;
  margin: 0 0 24px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.cp-facility-list {
  width: 100%;
  list-style: none;
  padding: 0;
  margin: 0 0 24px;
}

.cp-facility-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  transition: border-color 0.15s;
}

.cp-facility-item:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.cp-facility-info {
  flex: 1;
  min-width: 0;
}

.cp-facility-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: #c0d8f0;
  margin: 0 0 3px;
}

.cp-facility-desc {
  font-size: 0.78rem;
  color: #7090b0;
  margin: 0;
}

.cp-facility-cost {
  font-size: 0.85rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #f0d060;
  margin-right: 16px;
  white-space: nowrap;
}

.cp-facility-cost-free {
  color: #50d870;
}

.cp-build-btn {
  padding: 7px 18px;
  background: #1a5040;
  border: 1px solid #40a080;
  border-radius: 5px;
  color: #b0f0d0;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.cp-build-btn:hover:not(:disabled) {
  background: #207050;
}

.cp-build-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cp-built-badge {
  padding: 6px 14px;
  font-size: 0.8rem;
  font-weight: 600;
  color: #50d870;
  border: 1px solid rgba(80, 216, 112, 0.3);
  border-radius: 5px;
  white-space: nowrap;
}

.cp-locked-badge {
  padding: 6px 14px;
  font-size: 0.78rem;
  font-weight: 500;
  color: #a08060;
  border: 1px solid rgba(160, 128, 96, 0.3);
  border-radius: 5px;
  white-space: nowrap;
  max-width: 160px;
  text-align: center;
  line-height: 1.3;
}

.cp-close-btn {
  margin-top: 12px;
  padding: 12px 40px;
  background: #1a4070;
  border: 1px solid #4080b0;
  border-radius: 6px;
  color: #c8e8ff;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.15s;
  letter-spacing: 0.03em;
}

.cp-close-btn:hover {
  background: #235a90;
}

/* ── Construction panel — science cost ────────────────────────────────────── */
.cp-facility-cost-science {
  font-size: 0.82rem;
  font-weight: 600;
  color: #60c0f0;
  white-space: nowrap;
}

.cp-cost-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-right: 16px;
}

.cp-cost-group .cp-facility-cost {
  margin-right: 0;
}

.cp-discount-note {
  font-size: 0.7rem;
  color: #50d870;
  white-space: nowrap;
}

/* ── Construction panel — tier/upgrade ────────────────────────────────────── */
.cp-tier-badge {
  font-size: 0.72rem;
  font-weight: 600;
  color: #80c8ff;
  margin-left: 8px;
  padding: 1px 6px;
  border: 1px solid rgba(128, 200, 255, 0.3);
  border-radius: 3px;
}

.cp-upgrade-btn {
  padding: 7px 18px;
  background: #1a4070;
  border: 1px solid #4080b0;
  border-radius: 5px;
  color: #b0d0f0;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.cp-upgrade-btn:hover:not(:disabled) {
  background: #235a90;
}

.cp-upgrade-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.cp-upgrade-desc {
  font-size: 0.72rem;
  color: #6090b0;
  margin: 3px 0 0;
  font-style: italic;
}

.cp-action-group {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

/* ── Weather panel ──────────────────────────────────────────────────────── */
#weather-panel {
  position: absolute;
  top: 60px;
  left: 16px;
  padding: 12px 18px;
  background: rgba(10, 20, 40, 0.88);
  border: 1px solid #304868;
  border-radius: 8px;
  color: #c8dce8;
  font-size: 0.82rem;
  pointer-events: auto;
  z-index: 20;
  min-width: 180px;
  line-height: 1.5;
}

#weather-panel .weather-title {
  font-size: 0.72rem;
  font-weight: 700;
  color: #6090b0;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

#weather-panel .weather-description {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 6px;
}

#weather-panel .weather-description.weather-extreme {
  color: #ff6060;
}

#weather-panel .weather-description.weather-good {
  color: #50d870;
}

#weather-panel .weather-description.weather-moderate {
  color: #e0c050;
}

#weather-panel .weather-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 2px 0;
  font-size: 0.82rem;
}

#weather-panel .weather-label {
  color: #7090a0;
}

#weather-panel .weather-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

#weather-panel .weather-forecast {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.75rem;
  color: #6080a0;
}

#weather-panel .weather-forecast-day {
  display: flex;
  justify-content: space-between;
  padding: 1px 0;
}

#weather-panel .weather-warning {
  margin-top: 6px;
  padding: 4px 8px;
  background: rgba(160, 40, 40, 0.4);
  border: 1px solid rgba(255, 80, 80, 0.3);
  border-radius: 4px;
  color: #ff8080;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: center;
}

/* ── Building hit areas ───────────────────────────────────────────────────── */
.hub-building {
  position: absolute;

  /*
   * The ground line is at 70 % from the top of the viewport.
   * Buildings sit on the ground — "bottom: 30%" means the bottom edge of
   * the div aligns with the ground.  Height extends upward (CSS bottom +
   * height).
   */
  bottom: 30%;

  pointer-events: auto;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 6px;
  background: transparent;  /* visual drawn by PixiJS layer */
  box-sizing: border-box;
}

/* Hover highlight ring drawn over the PixiJS building */
.hub-building::after {
  content: '';
  position: absolute;
  inset: -3px;
  border: 2px solid transparent;
  border-radius: 2px;
  pointer-events: none;
  transition: border-color 0.15s;
}

.hub-building:hover::after,
.hub-building:focus-visible::after {
  border-color: rgba(255, 230, 100, 0.85);
}

.hub-building:focus-visible {
  outline: none;
}

/* ── Building labels ──────────────────────────────────────────────────────── */
.hub-building-label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #1c1000;
  text-align: center;
  line-height: 1.25;
  pointer-events: none;
  text-shadow:
    0 1px 0 rgba(255,255,255,0.55),
    0 -1px 0 rgba(255,255,255,0.3);
  max-width: 100%;
  padding: 0 4px;
  word-break: break-word;
  hyphens: auto;
  user-select: none;
}

/* ── Reputation badge (hub) ────────────────────────────────────────────── */
#hub-reputation-badge {
  position: absolute;
  top: 60px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(4, 8, 20, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  pointer-events: auto;
  z-index: 20;
  font-family: system-ui, sans-serif;
}

.hub-rep-label {
  font-size: 0.75rem;
  color: #8898b0;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.hub-rep-value {
  font-size: 0.95rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.hub-rep-tier {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.hub-rep-track {
  width: 80px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.hub-rep-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s, background-color 0.3s;
}
`;

// ---------------------------------------------------------------------------
// Layout constants — must match src/render/hub.js
// ---------------------------------------------------------------------------

/**
 * Building definitions.
 * Geometry fractions (x, width, height) are relative to viewport dimensions.
 * They must be kept in sync with the BUILDINGS array in src/render/hub.js.
 *
 * @type {Array<{
 *   id: string,
 *   label: string,
 *   xCenterPct: number,
 *   widthPct: number,
 *   heightPct: number,
 * }>}
 */
const BUILDINGS = [
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
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The hub overlay root element. @type {HTMLElement | null} */
let _overlay = null;

/** Cached reference to the game state for the construction panel. @type {import('../core/gameState.js').GameState | null} */
let _state = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the hub HTML overlay and show the PixiJS hub background.
 *
 * The persistent top bar (agency name, cash, hamburger menu) is provided by
 * src/ui/topbar.js and must be mounted separately via initTopBar() before
 * calling this function.
 *
 * @param {HTMLElement} container
 *   The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} _state
 *   The current game state (unused here; passed to maintain a consistent
 *   screen API signature).
 * @param {(destination: string) => void} onNavigate
 *   Callback invoked when a building is clicked.
 *   Possible destination values: 'vab', 'mission-control', 'crew-admin',
 *   'launch-pad'.
 */
export function initHubUI(container, state, onNavigate) {
  _state = state;

  // Inject styles once.
  if (!document.getElementById('hub-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'hub-styles';
    styleEl.textContent = HUB_STYLES;
    document.head.appendChild(styleEl);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'hub-overlay';
  container.appendChild(_overlay);

  _renderBuildings(onNavigate);
  _renderConstructionButton(container);
  _renderBankruptcyBanner();
  _renderReputationBadge();
  _renderWeatherPanel();

  // Show the PixiJS background.
  showHubScene();

  console.log('[Hub UI] Initialized');
}

/**
 * Remove the hub HTML overlay and hide the PixiJS background.
 * Call this before mounting a different screen (e.g. the VAB).
 */
export function destroyHubUI() {
  // Remove construction panel if open.
  const panel = document.getElementById('construction-panel');
  if (panel) panel.remove();

  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  hideHubScene();
  console.log('[Hub UI] Destroyed');
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
 *
 * @param {HTMLElement} container
 *   The #ui-overlay div.
 * @param {import('../core/flightReturn.js').FlightReturnSummary} summary
 *   The result of `processFlightReturn()`.
 * @param {() => void} [onDismiss]
 *   Called when the player dismisses the overlay.
 */
export function showReturnResultsOverlay(container, summary, onDismiss) {
  // Inject styles if not already present (hub-styles covers these).
  if (!document.getElementById('hub-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'hub-styles';
    styleEl.textContent = HUB_STYLES;
    document.head.appendChild(styleEl);
  }

  // Remove any stale overlay.
  const existing = document.getElementById('return-results-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'return-results-overlay';

  const content = document.createElement('div');
  content.className = 'rr-content';
  overlay.appendChild(content);

  // ── Heading ───────────────────────────────────────────────────────────────
  const heading = document.createElement('h1');
  heading.textContent = 'Return to Agency';
  content.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'rr-subtitle';
  subtitle.textContent = `Flight ${summary.currentPeriod ?? summary.totalFlights} summary`;
  content.appendChild(subtitle);

  // ── Missions completed ────────────────────────────────────────────────────
  if (summary.completedMissions.length > 0) {
    const section = document.createElement('div');
    section.className = 'rr-section';

    const sectionTitle = document.createElement('h2');
    sectionTitle.textContent = 'Missions Completed';
    section.appendChild(sectionTitle);

    const list = document.createElement('ul');
    list.className = 'rr-missions-list';

    for (const entry of summary.completedMissions) {
      const li = document.createElement('li');

      const titleSpan = document.createElement('span');
      titleSpan.className = 'rr-mission-title';
      titleSpan.textContent = entry.mission.title;

      const rewardSpan = document.createElement('span');
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
  const allUnlockedParts = summary.completedMissions.flatMap((e) => e.unlockedParts);
  if (allUnlockedParts.length > 0) {
    const section = document.createElement('div');
    section.className = 'rr-section';

    const sectionTitle = document.createElement('h2');
    sectionTitle.textContent = 'Parts Unlocked';
    section.appendChild(sectionTitle);

    const list = document.createElement('ul');
    list.className = 'rr-parts-list';

    for (const partId of allUnlockedParts) {
      const li = document.createElement('li');
      li.textContent = partId;
      list.appendChild(li);
    }

    section.appendChild(list);
    content.appendChild(section);
  }

  // ── Financial summary ─────────────────────────────────────────────────────
  const finSection = document.createElement('div');
  finSection.className = 'rr-section';

  const finTitle = document.createElement('h2');
  finTitle.textContent = 'Financial Summary';
  finSection.appendChild(finTitle);

  const missionRewardTotal = summary.completedMissions.reduce((s, e) => s + e.reward, 0);

  // Mission rewards row.
  if (missionRewardTotal > 0) {
    finSection.appendChild(_rrRow(
      'Mission rewards',
      `+$${missionRewardTotal.toLocaleString('en-US')}`,
      'positive',
    ));
  }

  // Part recovery row.
  if (summary.recoveryValue > 0) {
    finSection.appendChild(_rrRow(
      'Part recovery (60 %)',
      `+$${summary.recoveryValue.toLocaleString('en-US')}`,
      'positive',
    ));
  }

  // Interest row (shows loan balance alongside).
  if (summary.interestCharged > 0) {
    const loanBalance = summary.loanBalance ?? 0;
    const interestLabel = loanBalance > 0
      ? `Loan interest (balance: $${Math.round(loanBalance).toLocaleString('en-US')})`
      : 'Loan interest';
    finSection.appendChild(_rrRow(
      interestLabel,
      `−$${Math.round(summary.interestCharged).toLocaleString('en-US')}`,
      'negative',
    ));
  }

  // Death fines row.
  if (summary.deathFineTotal > 0) {
    finSection.appendChild(_rrRow(
      'Crew death fines',
      `−$${summary.deathFineTotal.toLocaleString('en-US')}`,
      'negative',
    ));
  }

  // Operating costs rows.
  if (summary.operatingCosts > 0) {
    if (summary.crewSalaryCost > 0) {
      const crewLabel = summary.activeCrewCount === 1
        ? 'Crew salaries (1 astronaut)'
        : `Crew salaries (${summary.activeCrewCount} astronauts)`;
      finSection.appendChild(_rrRow(
        crewLabel,
        `−$${summary.crewSalaryCost.toLocaleString('en-US')}`,
        'negative',
      ));
    }
    if (summary.facilityUpkeep > 0) {
      finSection.appendChild(_rrRow(
        'Facility upkeep',
        `−$${summary.facilityUpkeep.toLocaleString('en-US')}`,
        'negative',
      ));
    }
  }

  // Net cash change.
  const netEl = document.createElement('div');
  netEl.className = 'rr-net-change';

  const netLabel = document.createElement('span');
  netLabel.className = 'rr-label';
  netLabel.textContent = 'Net cash change';

  const netValue = document.createElement('span');
  netValue.className = `rr-value ${summary.netCashChange >= 0 ? 'rr-value-positive' : 'rr-value-negative'}`;
  const sign = summary.netCashChange >= 0 ? '+' : '−';
  netValue.textContent = `${sign}$${Math.abs(Math.round(summary.netCashChange)).toLocaleString('en-US')}`;

  netEl.appendChild(netLabel);
  netEl.appendChild(netValue);
  finSection.appendChild(netEl);

  content.appendChild(finSection);

  // ── Reputation change (if any) ──────────────────────────────────────────
  if (typeof summary.reputationChange === 'number' && summary.reputationChange !== 0) {
    const repSection = document.createElement('div');
    repSection.className = 'rr-section';

    const repTitle = document.createElement('h2');
    repTitle.textContent = 'Reputation';
    repSection.appendChild(repTitle);

    const repTier = getReputationTier(summary.reputationAfter ?? 50);

    const repRow = document.createElement('div');
    repRow.className = 'rr-row';
    const repLabel = document.createElement('span');
    repLabel.className = 'rr-label';
    repLabel.textContent = 'Change';
    const repValue = document.createElement('span');
    const repSign = summary.reputationChange >= 0 ? '+' : '';
    repValue.className = `rr-value ${summary.reputationChange >= 0 ? 'rr-value-positive' : 'rr-value-negative'}`;
    repValue.textContent = `${repSign}${summary.reputationChange}`;
    repRow.appendChild(repLabel);
    repRow.appendChild(repValue);
    repSection.appendChild(repRow);

    const repNowRow = document.createElement('div');
    repNowRow.className = 'rr-row';
    const repNowLabel = document.createElement('span');
    repNowLabel.className = 'rr-label';
    repNowLabel.textContent = 'Current';
    const repNowValue = document.createElement('span');
    repNowValue.className = 'rr-value';
    repNowValue.style.color = repTier.color;
    repNowValue.textContent = `${Math.round(summary.reputationAfter ?? 50)} — ${repTier.label}`;
    repNowRow.appendChild(repNowLabel);
    repNowRow.appendChild(repNowValue);
    repSection.appendChild(repNowRow);

    content.appendChild(repSection);
  }

  // ── Bankruptcy warning (if applicable) ────────────────────────────────────
  if (summary.bankrupt) {
    const bankruptSection = document.createElement('div');
    bankruptSection.className = 'rr-section';
    bankruptSection.style.background = 'rgba(120, 20, 20, 0.5)';
    bankruptSection.style.border = '1px solid #ff4040';
    bankruptSection.style.borderRadius = '6px';
    bankruptSection.style.padding = '14px 16px';

    const bankruptTitle = document.createElement('h2');
    bankruptTitle.textContent = 'Agency Bankrupt';
    bankruptTitle.style.color = '#ff6060';
    bankruptTitle.style.borderBottom = 'none';
    bankruptSection.appendChild(bankruptTitle);

    const bankruptMsg = document.createElement('p');
    bankruptMsg.style.fontSize = '0.88rem';
    bankruptMsg.style.color = '#ffc0c0';
    bankruptMsg.style.margin = '0';
    bankruptMsg.textContent = 'You cannot afford to build even the cheapest rocket. Fire crew to reduce salaries, take out a loan, or accept cheaper contracts.';
    bankruptSection.appendChild(bankruptMsg);

    content.appendChild(bankruptSection);
  }

  // ── Dismiss button ────────────────────────────────────────────────────────
  const dismissBtn = document.createElement('button');
  dismissBtn.id        = 'return-results-dismiss-btn';
  dismissBtn.className = 'rr-dismiss-btn';
  dismissBtn.textContent = '← Return to Hub';

  dismissBtn.addEventListener('click', () => {
    overlay.remove();
    if (onDismiss) onDismiss();
  });

  content.appendChild(dismissBtn);
  container.appendChild(overlay);

  console.log('[Hub UI] Return Results overlay shown', summary);
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/**
 * Build a single financial summary row `<div>`.
 *
 * @param {string} label
 * @param {string} value
 * @param {'positive'|'negative'|'neutral'} [tone='neutral']
 * @returns {HTMLElement}
 */
function _rrRow(label, value, tone = 'neutral') {
  const row = document.createElement('div');
  row.className = 'rr-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'rr-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = `rr-value rr-value-${tone}`;
  valueEl.textContent = value;

  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

/**
 * Show a bankruptcy warning banner if the player cannot afford any rocket.
 */
function _renderBankruptcyBanner() {
  if (!_overlay || !_state) return;

  // Remove any stale banner.
  const existing = document.getElementById('bankruptcy-banner');
  if (existing) existing.remove();

  if (!isBankrupt(_state)) return;

  const banner = document.createElement('div');
  banner.id = 'bankruptcy-banner';

  const title = document.createElement('div');
  title.className = 'bankruptcy-title';
  title.textContent = 'Agency Bankrupt';
  banner.appendChild(title);

  const msg = document.createElement('div');
  msg.textContent = 'You cannot afford to build even the cheapest rocket.';
  banner.appendChild(msg);

  const hint = document.createElement('div');
  hint.className = 'bankruptcy-hint';
  hint.textContent = 'Fire crew to reduce salaries, take out a loan, or accept cheaper contracts.';
  banner.appendChild(hint);

  _overlay.appendChild(banner);
}

/**
 * Render the reputation badge on the hub screen.
 * Shows current reputation value, tier label (colour-coded), and a progress bar.
 */
function _renderReputationBadge() {
  if (!_overlay || !_state) return;

  // Remove existing badge if present (for refresh).
  const existing = document.getElementById('hub-reputation-badge');
  if (existing) existing.remove();

  const rep = _state.reputation ?? 50;
  const tier = getReputationTier(rep);

  const badge = document.createElement('div');
  badge.id = 'hub-reputation-badge';

  // Label
  const label = document.createElement('span');
  label.className = 'hub-rep-label';
  label.textContent = 'Reputation';
  badge.appendChild(label);

  // Value
  const value = document.createElement('span');
  value.className = 'hub-rep-value';
  value.style.color = tier.color;
  value.textContent = `${Math.round(rep)}`;
  badge.appendChild(value);

  // Tier chip
  const tierChip = document.createElement('span');
  tierChip.className = 'hub-rep-tier';
  tierChip.style.color = tier.color;
  tierChip.style.background = `${tier.color}22`;
  tierChip.style.border = `1px solid ${tier.color}44`;
  tierChip.textContent = tier.label;
  badge.appendChild(tierChip);

  // Progress track
  const track = document.createElement('div');
  track.className = 'hub-rep-track';
  const fill = document.createElement('div');
  fill.className = 'hub-rep-fill';
  fill.style.width = `${Math.max(0, Math.min(100, rep))}%`;
  fill.style.backgroundColor = tier.color;
  track.appendChild(fill);
  badge.appendChild(track);

  _overlay.appendChild(badge);
}

/**
 * Render the weather conditions panel on the hub screen.
 * Initialises weather state if not already present.
 */
function _renderWeatherPanel() {
  if (!_overlay || !_state) return;

  // Remove any stale panel.
  const existing = document.getElementById('weather-panel');
  if (existing) existing.remove();

  // Initialise weather if needed (first hub visit or after save load).
  if (!_state.weather) {
    initWeather(_state, 'EARTH');
  }

  const weather = getCurrentWeather(_state);

  // Don't show panel for airless bodies.
  if (weather.description === 'No atmosphere') return;

  const panel = document.createElement('div');
  panel.id = 'weather-panel';

  // Title
  const title = document.createElement('div');
  title.className = 'weather-title';
  title.textContent = 'Launch Conditions';
  panel.appendChild(title);

  // Description
  const desc = document.createElement('div');
  desc.className = 'weather-description';
  if (weather.extreme) {
    desc.classList.add('weather-extreme');
  } else if (weather.windSpeed < 6) {
    desc.classList.add('weather-good');
  } else {
    desc.classList.add('weather-moderate');
  }
  desc.textContent = weather.description;
  panel.appendChild(desc);

  // Wind speed
  _addWeatherRow(panel, 'Wind', `${weather.windSpeed.toFixed(1)} m/s`);

  // Temperature (ISP effect)
  const tempPct = ((weather.temperature - 1) * 100).toFixed(1);
  const tempStr = weather.temperature >= 1 ? `+${tempPct}%` : `${tempPct}%`;
  _addWeatherRow(panel, 'ISP Effect', tempStr);

  // Visibility
  const visLabels = ['Clear', 'Light haze', 'Moderate haze', 'Heavy haze', 'Dense fog'];
  const visIdx = Math.min(4, Math.floor(weather.visibility * 5));
  _addWeatherRow(panel, 'Visibility', visLabels[visIdx]);

  // Extreme weather warning
  if (weather.extreme) {
    const warn = document.createElement('div');
    warn.className = 'weather-warning';
    warn.textContent = 'EXTREME — Launch not recommended';
    panel.appendChild(warn);
  }

  // Forecast (if weather satellites provide data AND Tracking Station tier 2+)
  const forecast = isWeatherPredictionAvailable(_state) ? getWeatherForecast(_state, 'EARTH', 3) : [];
  if (forecast.length > 0) {
    const fcSection = document.createElement('div');
    fcSection.className = 'weather-forecast';

    const fcTitle = document.createElement('div');
    fcTitle.style.fontWeight = '600';
    fcTitle.style.marginBottom = '2px';
    fcTitle.textContent = 'Forecast';
    fcSection.appendChild(fcTitle);

    forecast.forEach((fc, i) => {
      const row = document.createElement('div');
      row.className = 'weather-forecast-day';

      const dayLabel = document.createElement('span');
      dayLabel.textContent = `Skip ${i + 1}`;
      row.appendChild(dayLabel);

      const dayDesc = document.createElement('span');
      dayDesc.textContent = `${fc.description} (${fc.windSpeed.toFixed(0)} m/s)`;
      if (fc.extreme) dayDesc.style.color = '#ff6060';
      row.appendChild(dayDesc);

      fcSection.appendChild(row);
    });

    panel.appendChild(fcSection);
  }

  _overlay.appendChild(panel);

  // Update the PixiJS hub renderer with weather visuals.
  setHubWeather(weather.visibility, weather.extreme);
}

/**
 * Helper: add a label–value row to the weather panel.
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {string} value
 */
function _addWeatherRow(parent, label, value) {
  const row = document.createElement('div');
  row.className = 'weather-row';

  const lbl = document.createElement('span');
  lbl.className = 'weather-label';
  lbl.textContent = label;
  row.appendChild(lbl);

  const val = document.createElement('span');
  val.className = 'weather-value';
  val.textContent = value;
  row.appendChild(val);

  parent.appendChild(row);
}

/**
 * Create and append one `<div>` per building inside the overlay.
 *
 * @param {(destination: string) => void} onNavigate
 */
function _renderBuildings(onNavigate) {
  if (!_overlay) return;

  for (const bld of BUILDINGS) {
    const el = document.createElement('div');
    el.className    = 'hub-building';
    el.dataset.buildingId = bld.id;
    el.setAttribute('role',       'button');
    el.setAttribute('tabindex',   '0');
    el.setAttribute('aria-label', bld.label);

    // Position: left edge and width as % of viewport width.
    const leftPct  = (bld.xCenterPct - bld.widthPct / 2) * 100;
    el.style.left   = `${leftPct.toFixed(4)}%`;
    el.style.width  = `${(bld.widthPct  * 100).toFixed(4)}%`;
    // Height extends upward from the ground line.
    el.style.height = `${(bld.heightPct * 100).toFixed(4)}%`;

    // Label
    const label = document.createElement('span');
    label.className   = 'hub-building-label';
    label.textContent = bld.label;
    el.appendChild(label);

    // Click handler
    el.addEventListener('click', () => {
      console.log(`[Hub UI] Building clicked: ${bld.id}`);
      onNavigate(bld.id);
    });

    // Keyboard handler (Enter / Space)
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onNavigate(bld.id);
      }
    });

    _overlay.appendChild(el);
  }
}

/**
 * Render the "Construction" button in the hub overlay.
 *
 * @param {HTMLElement} container  The #ui-overlay div.
 */
function _renderConstructionButton(container) {
  if (!_overlay) return;

  const btn = document.createElement('button');
  btn.id          = 'hub-construction-btn';
  btn.textContent = 'Construction';
  btn.setAttribute('aria-label', 'Open construction menu');

  btn.addEventListener('click', () => {
    _openConstructionPanel(container);
  });

  _overlay.appendChild(btn);
}

/**
 * Open the construction panel overlay.
 *
 * @param {HTMLElement} container  The #ui-overlay div.
 */
function _openConstructionPanel(container) {
  // Prevent duplicate.
  if (document.getElementById('construction-panel')) return;
  if (!_state) return;

  const panel = document.createElement('div');
  panel.id = 'construction-panel';

  const content = document.createElement('div');
  content.className = 'cp-content';
  panel.appendChild(content);

  // ── Heading ────────────────────────────────────────────────────────────
  const heading = document.createElement('h1');
  heading.textContent = 'Construction';
  content.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'cp-subtitle';
  subtitle.textContent = _state.tutorialMode
    ? 'Tutorial Mode — Facilities unlocked via missions'
    : 'Build new facilities for your agency';
  content.appendChild(subtitle);

  // ── Facility list ──────────────────────────────────────────────────────
  const list = document.createElement('ul');
  list.className = 'cp-facility-list';

  for (const def of FACILITY_DEFINITIONS) {
    const item = document.createElement('li');
    item.className = 'cp-facility-item';

    // Info column.
    const info = document.createElement('div');
    info.className = 'cp-facility-info';

    const nameEl = document.createElement('p');
    nameEl.className = 'cp-facility-name';
    nameEl.textContent = def.name;

    // Show tier badge for built, upgradeable facilities.
    const upgradeDef = getFacilityUpgradeDef(def.id);
    if (hasFacility(_state, def.id) && upgradeDef) {
      const tier = getFacilityTier(_state, def.id);
      const tierBadge = document.createElement('span');
      tierBadge.className = 'cp-tier-badge';
      tierBadge.textContent = `Tier ${tier}`;
      nameEl.appendChild(tierBadge);
    }

    info.appendChild(nameEl);

    const descEl = document.createElement('p');
    descEl.className = 'cp-facility-desc';
    descEl.textContent = def.description;
    info.appendChild(descEl);

    item.appendChild(info);

    // ── Cost + Action columns ──────────────────────────────────────────
    const isBuilt = hasFacility(_state, def.id);

    if (isBuilt) {
      // Check if upgradeable (R&D Lab).
      const upgrade = canUpgradeFacility(_state, def.id);
      if (upgrade.nextTier > 0) {
        // Show upgrade cost.
        const costGroup = document.createElement('div');
        costGroup.className = 'cp-cost-group';

        const moneyCostEl = document.createElement('span');
        moneyCostEl.className = 'cp-facility-cost';
        moneyCostEl.textContent = `$${upgrade.moneyCost.toLocaleString('en-US')}`;
        costGroup.appendChild(moneyCostEl);

        if (upgrade.scienceCost > 0) {
          const sciCostEl = document.createElement('span');
          sciCostEl.className = 'cp-facility-cost-science';
          sciCostEl.textContent = `${upgrade.scienceCost} science`;
          costGroup.appendChild(sciCostEl);
        }

        item.appendChild(costGroup);

        // Upgrade action.
        const actionGroup = document.createElement('div');
        actionGroup.className = 'cp-action-group';

        const btn = document.createElement('button');
        btn.className = 'cp-upgrade-btn';
        btn.textContent = `Upgrade to Tier ${upgrade.nextTier}`;
        btn.disabled = !upgrade.allowed;
        if (!upgrade.allowed) {
          btn.title = upgrade.reason;
        }
        btn.addEventListener('click', () => {
          const result = upgradeFacility(_state, def.id);
          if (result.success) {
            console.log(`[Hub UI] Upgraded facility: ${def.name} → Tier ${upgrade.nextTier}`);
            panel.remove();
            _openConstructionPanel(container);
          }
        });
        actionGroup.appendChild(btn);

        if (upgrade.description) {
          const descNote = document.createElement('p');
          descNote.className = 'cp-upgrade-desc';
          descNote.textContent = upgrade.description;
          actionGroup.appendChild(descNote);
        }

        item.appendChild(actionGroup);
      } else {
        // Built, no upgrades available (or max tier).
        const costEl = document.createElement('span');
        costEl.className = 'cp-facility-cost cp-facility-cost-free';
        costEl.textContent = '';
        item.appendChild(costEl);

        const badge = document.createElement('span');
        badge.className = 'cp-built-badge';
        badge.textContent = upgradeDef ? 'Max Tier' : 'Built';
        item.appendChild(badge);
      }
    } else if (_state.tutorialMode) {
      // Cost column (informational).
      const costEl = document.createElement('span');
      costEl.className = 'cp-facility-cost';
      costEl.textContent = '';
      item.appendChild(costEl);

      const badge = document.createElement('span');
      badge.className = 'cp-locked-badge';
      badge.textContent = 'Locked — complete missions to unlock';
      item.appendChild(badge);
    } else {
      // Not built, not tutorial — show build cost + button.
      const costGroup = document.createElement('div');
      costGroup.className = 'cp-cost-group';

      const discountedCost = getDiscountedMoneyCost(def.cost, _state.reputation ?? 50);
      const hasDiscount = def.cost > 0 && discountedCost < def.cost;

      const moneyCostEl = document.createElement('span');
      moneyCostEl.className = def.cost === 0
        ? 'cp-facility-cost cp-facility-cost-free'
        : 'cp-facility-cost';
      moneyCostEl.textContent = def.cost === 0
        ? 'Free'
        : `$${discountedCost.toLocaleString('en-US')}`;
      costGroup.appendChild(moneyCostEl);

      if (hasDiscount) {
        const discountNote = document.createElement('span');
        discountNote.className = 'cp-discount-note';
        discountNote.textContent = `(was $${def.cost.toLocaleString('en-US')})`;
        costGroup.appendChild(discountNote);
      }

      if ((def.scienceCost ?? 0) > 0) {
        const sciCostEl = document.createElement('span');
        sciCostEl.className = 'cp-facility-cost-science';
        sciCostEl.textContent = `${def.scienceCost} science`;
        costGroup.appendChild(sciCostEl);
      }

      item.appendChild(costGroup);

      // Build button.
      const check = canBuildFacility(_state, def.id);
      const btn = document.createElement('button');
      btn.className = 'cp-build-btn';
      btn.textContent = 'Build';
      btn.disabled = !check.allowed;
      if (!check.allowed) {
        btn.title = check.reason;
      }
      btn.addEventListener('click', () => {
        const result = buildFacility(_state, def.id);
        if (result.success) {
          console.log(`[Hub UI] Built facility: ${def.name}`);
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
  const closeBtn = document.createElement('button');
  closeBtn.className = 'cp-close-btn';
  closeBtn.textContent = '← Back to Hub';
  closeBtn.addEventListener('click', () => {
    panel.remove();
  });
  content.appendChild(closeBtn);

  container.appendChild(panel);
  console.log('[Hub UI] Construction panel opened');
}
