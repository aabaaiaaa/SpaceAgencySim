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

import { showHubScene, hideHubScene } from '../render/hub.js';

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
  font-family: 'Segoe UI', system-ui, sans-serif;
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
  font-family: 'Segoe UI', system-ui, sans-serif;
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
    xCenterPct: 0.14,
    widthPct:   0.09,
    heightPct:  0.22,
  },
  {
    id:         'vab',
    label:      'Vehicle Assembly Building',
    xCenterPct: 0.35,
    widthPct:   0.16,
    heightPct:  0.32,
  },
  {
    id:         'mission-control',
    label:      'Mission Control Centre',
    xCenterPct: 0.58,
    widthPct:   0.13,
    heightPct:  0.24,
  },
  {
    id:         'crew-admin',
    label:      'Crew Administration',
    xCenterPct: 0.78,
    widthPct:   0.11,
    heightPct:  0.18,
  },
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The hub overlay root element. @type {HTMLElement | null} */
let _overlay = null;

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
export function initHubUI(container, _state, onNavigate) {
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

  // Show the PixiJS background.
  showHubScene();

  console.log('[Hub UI] Initialized');
}

/**
 * Remove the hub HTML overlay and hide the PixiJS background.
 * Call this before mounting a different screen (e.g. the VAB).
 */
export function destroyHubUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
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
  subtitle.textContent = `Flight ${summary.totalFlights} summary`;
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

  // Interest row.
  if (summary.interestCharged > 0) {
    finSection.appendChild(_rrRow(
      'Loan interest',
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

  // ── Dismiss button ────────────────────────────────────────────────────────
  const dismissBtn = document.createElement('button');
  dismissBtn.id        = 'return-results-dismiss-btn';
  dismissBtn.className = 'rr-dismiss-btn';
  dismissBtn.textContent = 'Return to Hub →';

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
