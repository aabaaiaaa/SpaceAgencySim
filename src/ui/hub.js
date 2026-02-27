/**
 * hub.js — Space Agency Hub HTML overlay UI.
 *
 * Renders the hub screen chrome over the PixiJS canvas:
 *   - Four clickable building divs positioned to sit on top of the
 *     corresponding PixiJS building rectangles in src/render/hub.js.
 *   - Each building div carries a human-readable label and a
 *     data-building-id attribute for Playwright / accessibility.
 *
 * The top bar showing agency name, cash, and the hamburger menu is handled
 * by TASK-009 (TopBar & Loan Modal) and is not included here.
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

/* ── Hub top bar ──────────────────────────────────────────────────────────── */
#hub-topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
  background: rgba(5, 8, 15, 0.72);
  border-bottom: 1px solid rgba(100,160,220,0.18);
  pointer-events: auto;
  z-index: 20;
  box-sizing: border-box;
}

#hub-topbar-agency {
  font-size: 0.85rem;
  font-weight: 600;
  color: #cce4f8;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#hub-cash {
  font-size: 0.88rem;
  font-weight: 600;
  color: #5ddb50;
  letter-spacing: 0.02em;
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
 * @param {HTMLElement} container
 *   The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} _state
 *   The current game state (reserved for future use — e.g. top bar display).
 * @param {(destination: string) => void} onNavigate
 *   Callback invoked when a building is clicked.
 *   Possible destination values: 'vab', 'mission-control', 'crew-admin',
 *   'launch-pad'.
 */
export function initHubUI(container, state, onNavigate) {
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

  _renderTopBar(state);
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

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/**
 * Create and append the top bar (agency name + cash readout) to the overlay.
 *
 * @param {import('../core/gameState.js').GameState} state
 */
function _renderTopBar(state) {
  if (!_overlay) return;

  const bar = document.createElement('div');
  bar.id = 'hub-topbar';

  const agency = document.createElement('span');
  agency.id = 'hub-topbar-agency';
  agency.textContent = state.agencyName || 'Space Agency';

  const cash = document.createElement('span');
  cash.id = 'hub-cash';
  cash.textContent = '$' + Math.round(state.money ?? 0).toLocaleString('en-US');

  bar.appendChild(agency);
  bar.appendChild(cash);
  _overlay.appendChild(bar);
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
