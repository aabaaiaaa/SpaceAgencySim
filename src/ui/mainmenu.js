/**
 * mainmenu.js — Main Menu & Load Screen HTML overlay UI.
 *
 * Entry point for the game. Shown before the VAB or any other screen.
 *
 * BEHAVIOUR
 * =========
 * - If any save slots contain data, the Load Screen is shown by default.
 *   Each save slot is displayed as a card with: save name, date saved,
 *   missions completed, money (formatted), accepted missions, total flights,
 *   crew count, crew KIA, and time played (h:mm:ss).
 *   Per-slot actions: Load, Delete, Export.
 *   Global actions: "New Game" (always visible), "Import Save" (file upload).
 *
 * - If no saves exist, the New Game screen is shown directly.
 *
 * - New Game prompts for an agency name then calls onGameReady() with a
 *   freshly-initialised state (cash $2M, loan $2M, no crew, tutorial missions
 *   only, starter parts only).
 *
 * @module mainmenu
 */

import {
  listSaves,
  loadGame,
  deleteSave,
  exportSave,
  importSave,
  SAVE_SLOT_COUNT,
} from '../core/saveload.js';
import { createGameState } from '../core/gameState.js';
import { initializeMissions, reconcileParts } from '../core/missions.js';
import { GameMode, FACILITY_DEFINITIONS, SANDBOX_STARTING_MONEY } from '../core/constants.js';
import { getAllParts } from '../data/parts.js';
import { TECH_NODES } from '../data/techtree.js';

// ---------------------------------------------------------------------------
// Shooting stars
// ---------------------------------------------------------------------------

/** @type {number|null} */
let _shootingStarTimer = null;

function _startShootingStars() {
  _stopShootingStars();
  _spawnShootingStar();
  _scheduleNext();
}

function _scheduleNext() {
  const delay = 1500 + Math.random() * 4000; // 1.5–5.5s between stars
  _shootingStarTimer = setTimeout(() => {
    _spawnShootingStar();
    _scheduleNext();
  }, delay);
}

function _stopShootingStars() {
  if (_shootingStarTimer !== null) {
    clearTimeout(_shootingStarTimer);
    _shootingStarTimer = null;
  }
}

function _spawnShootingStar() {
  if (!_overlay) return;

  const star = document.createElement('div');
  star.className = 'mm-shooting-star';

  const w = window.innerWidth;
  const h = window.innerHeight;

  // Random start in the upper 80% of the screen
  const x = Math.random() * w;
  const y = Math.random() * h * 0.8;

  // Random angle — mostly downward, can go left or right
  // Range: 100°–250° (broadly downward, left-to-right or right-to-left)
  const angleDeg = 100 + Math.random() * 150;
  const angleRad = angleDeg * Math.PI / 180;

  // Direction vector
  const dx = Math.cos(angleRad);
  const dy = Math.sin(angleRad);

  // Random travel distance and tail length
  const travel = 150 + Math.random() * 350;
  const tailLen = 30 + Math.random() * 100;
  const thickness = Math.random() < 0.3 ? 2 : 1;
  const duration = 0.4 + Math.random() * 0.8;

  // The tail gradient points opposite to travel direction
  star.style.width = tailLen + 'px';
  star.style.height = thickness + 'px';
  star.style.left = x + 'px';
  star.style.top = y + 'px';
  star.style.borderRadius = thickness + 'px';

  // Rotate so the element aligns with the travel direction
  // Trail fades behind, bright end is the leading edge (right side of element)
  star.style.transform = `rotate(${angleDeg}deg)`;
  star.style.background = `linear-gradient(90deg, transparent, rgba(255,255,255,${0.5 + Math.random() * 0.4}))`;

  // Animate using JS for true directional movement
  const endX = x + dx * travel;
  const endY = y + dy * travel;

  const anim = star.animate([
    { left: x + 'px', top: y + 'px', opacity: 0 },
    { opacity: 1, offset: 0.1 },
    { opacity: 0.7, offset: 0.6 },
    { left: endX + 'px', top: endY + 'px', opacity: 0 },
  ], {
    duration: duration * 1000,
    easing: 'linear',
    fill: 'forwards',
  });

  _overlay.appendChild(star);

  anim.onfinish = () => star.remove();
}

// ---------------------------------------------------------------------------
// Starter parts — vary by game mode.
// Tutorial mode gates some parts behind mission rewards; non-tutorial mode
// gives the full starter set immediately.
// ---------------------------------------------------------------------------

/**
 * Part IDs available at the start of a tutorial game.
 * cmd-mk1, science-module-mk1, and thermometer-mk1 are gated behind
 * tutorial mission rewards (see missions.js).
 * @type {string[]}
 */
const TUTORIAL_STARTER_PARTS = [
  'probe-core-mk1', // Uncrewed probe core
  'tank-small',      // Small fuel tank
  'engine-spark',    // Starter liquid engine
  'parachute-mk1',   // Basic parachute
];

/**
 * Part IDs available at the start of a non-tutorial (free play) game.
 * All starter-tier parts are unlocked immediately.
 * @type {string[]}
 */
const FREE_STARTER_PARTS = [
  'probe-core-mk1',     // Uncrewed probe core
  'tank-small',          // Small fuel tank
  'engine-spark',        // Starter liquid engine
  'parachute-mk1',       // Basic parachute
  'science-module-mk1',  // Science instrument container
  'thermometer-mk1',     // Starter science instrument
  'cmd-mk1',             // Crewed command module
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Formats a dollar amount with commas and a dollar sign.
 * e.g. 2000000 → "$2,000,000"
 *
 * @param {number} amount
 * @returns {string}
 */
function formatMoney(amount) {
  return '$' + Math.round(amount).toLocaleString('en-US');
}

/**
 * Formats seconds as h:mm:ss.
 * e.g. 3725 → "1:02:05"
 *
 * @param {number} totalSeconds
 * @returns {string}
 */
function formatPlayTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours   = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs    = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `${hours}:${mm}:${ss}`;
}

/**
 * Formats an ISO 8601 timestamp as a localised short date + time string.
 *
 * @param {string} isoTimestamp
 * @returns {string}
 */
function formatDate(isoTimestamp) {
  try {
    const d = new Date(isoTimestamp);
    return d.toLocaleString('en-US', {
      year:   'numeric',
      month:  'short',
      day:    'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoTimestamp;
  }
}

// ---------------------------------------------------------------------------
// CSS injection
// ---------------------------------------------------------------------------

const MENU_STYLES = `
/* ── Main Menu Overlay ──────────────────────────────────────────────────── */
#main-menu-overlay {
  position: fixed;
  inset: 0;
  background: linear-gradient(180deg, #05080f 0%, #0a1628 60%, #0d1e38 100%);
  z-index: var(--z-topbar);
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
  pointer-events: auto;
  font-family: var(--font-family);
  color: #d0dce8;
}

/* Starfield pseudo-element */
#main-menu-overlay::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image:
    radial-gradient(1px 1px at 10% 15%, rgba(255,255,255,0.8) 0%, transparent 100%),
    radial-gradient(1px 1px at 25% 40%, rgba(255,255,255,0.5) 0%, transparent 100%),
    radial-gradient(1px 1px at 40% 8%,  rgba(255,255,255,0.7) 0%, transparent 100%),
    radial-gradient(1px 1px at 55% 55%, rgba(255,255,255,0.6) 0%, transparent 100%),
    radial-gradient(1px 1px at 70% 22%, rgba(255,255,255,0.9) 0%, transparent 100%),
    radial-gradient(1px 1px at 82% 70%, rgba(255,255,255,0.5) 0%, transparent 100%),
    radial-gradient(1px 1px at 92% 12%, rgba(255,255,255,0.7) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 5%  88%, rgba(255,255,255,0.6) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 35% 75%, rgba(255,255,255,0.4) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 60% 90%, rgba(255,255,255,0.5) 0%, transparent 100%),
    radial-gradient(1px 1px at 78% 45%, rgba(255,255,255,0.8) 0%, transparent 100%),
    radial-gradient(1px 1px at 48% 28%, rgba(255,255,255,0.4) 0%, transparent 100%),
    radial-gradient(1px 1px at 18% 60%, rgba(255,255,255,0.6) 0%, transparent 100%),
    radial-gradient(1px 1px at 90% 85%, rgba(255,255,255,0.7) 0%, transparent 100%),
    radial-gradient(1px 1px at 65% 5%,  rgba(255,255,255,0.5) 0%, transparent 100%);
  pointer-events: none;
  z-index: -1;
}

/* ── Shooting stars ────────────────────────────────────────────────────── */
.mm-shooting-star {
  position: fixed;
  height: 1px;
  pointer-events: none;
  z-index: -1;
  opacity: 0;
}

/* ── Title ──────────────────────────────────────────────────────────────── */
.mm-title-block {
  text-align: center;
  padding: 48px 16px 32px;
  flex-shrink: 0;
}

.mm-logo {
  width: 96px;
  height: 96px;
  margin: 0 auto 18px;
  filter: drop-shadow(0 0 24px rgba(100,180,255,0.5));
}

.mm-title {
  font-size: 3rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: #e8f4ff;
  text-transform: uppercase;
  text-shadow: 0 0 40px rgba(100,180,255,0.6), 0 2px 4px rgba(0,0,0,0.8);
  margin: 0 0 6px;
}

.mm-subtitle {
  font-size: 1rem;
  color: #7099c0;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  margin: 0;
}

/* ── Screen containers ──────────────────────────────────────────────────── */
.mm-screen {
  width: 100%;
  max-width: 900px;
  padding: 0 24px 48px;
  flex: 1;
}

.mm-screen-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #7eb3d8;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  margin: 0 0 20px;
  border-bottom: 1px solid rgba(100,160,220,0.2);
  padding-bottom: 10px;
}

/* ── Save-slot cards grid ───────────────────────────────────────────────── */
.mm-saves-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}

.mm-save-card {
  background: var(--color-card-bg);
  border: 1px solid rgba(100,160,220,0.18);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  transition: border-color 0.15s, background 0.15s;
}

.mm-save-card:hover {
  background: rgba(100,160,220,0.07);
  border-color: rgba(100,160,220,0.35);
}

.mm-save-card-name {
  font-size: 1.05rem;
  font-weight: 600;
  color: #cce4f8;
  margin: 0 0 4px;
}

.mm-mode-badge {
  font-size: 0.6rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 3px;
  vertical-align: middle;
  letter-spacing: 0.04em;
}
.mm-mode-sandbox {
  background: rgba(230, 180, 50, 0.25);
  color: #e6b432;
  border: 1px solid rgba(230, 180, 50, 0.4);
}
.mm-mode-tutorial {
  background: rgba(80, 160, 230, 0.2);
  color: #6ab0e8;
  border: 1px solid rgba(80, 160, 230, 0.3);
}
.mm-mode-freeplay {
  background: rgba(80, 200, 120, 0.2);
  color: #60c880;
  border: 1px solid rgba(80, 200, 120, 0.3);
}

.mm-save-card-agency {
  font-size: 0.82rem;
  color: #88bce8;
  margin: 0 0 4px;
}

.mm-save-card-date {
  font-size: 0.75rem;
  color: #5c7a94;
  margin: 0 0 14px;
}

.mm-save-card-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 16px;
  margin-bottom: 16px;
}

.mm-stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.mm-stat-label {
  font-size: 0.7rem;
  color: #4e6e88;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

.mm-stat-value {
  font-size: 0.9rem;
  color: #a8c8e8;
  font-weight: 500;
}

.mm-stat-value.mm-stat-kia {
  color: #e07070;
}

.mm-save-card-actions {
  display: flex;
  gap: 8px;
}

/* ── Empty slot card ────────────────────────────────────────────────────── */
.mm-save-card.mm-empty-slot {
  opacity: 0.35;
  cursor: default;
  border-style: dashed;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
}

.mm-empty-slot-label {
  font-size: 0.8rem;
  color: #4e6e88;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* ── Buttons ────────────────────────────────────────────────────────────── */
.mm-btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 8px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  cursor: pointer;
  text-transform: uppercase;
  transition: background 0.15s, transform 0.1s, opacity 0.15s;
  outline: none;
}

.mm-btn:active {
  transform: translateY(1px);
}

.mm-btn-primary {
  background: #1e6ab4;
  color: #e8f4ff;
}

.mm-btn-primary:hover {
  background: #2480d8;
}

.mm-btn-secondary {
  background: rgba(255,255,255,0.08);
  color: #94b8d8;
  border: 1px solid rgba(100,160,220,0.25);
}

.mm-btn-secondary:hover {
  background: rgba(255,255,255,0.14);
  color: #cce4f8;
}

.mm-btn-danger {
  background: rgba(180,50,50,0.25);
  color: #e08080;
  border: 1px solid rgba(180,80,80,0.3);
}

.mm-btn-danger:hover {
  background: rgba(200,60,60,0.4);
  color: #f0a0a0;
}

.mm-btn-large {
  padding: 12px 32px;
  font-size: 0.95rem;
}

.mm-btn-full {
  width: 100%;
  text-align: center;
  margin-top: 8px;
}

/* ── Bottom toolbar (New Game / Import) ─────────────────────────────────── */
.mm-global-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  border-top: 1px solid rgba(100,160,220,0.12);
  padding-top: 20px;
}

.mm-global-actions .mm-btn-primary {
  background: #1a5fa0;
}

.mm-global-actions .mm-btn-primary:hover {
  background: #2478c8;
}

/* ── New Game form ──────────────────────────────────────────────────────── */
.mm-newgame-form {
  max-width: 480px;
  margin: 0 auto;
}

.mm-field {
  margin-bottom: 24px;
}

.mm-field label {
  display: block;
  font-size: 0.78rem;
  color: #7099c0;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 8px;
}

.mm-field input[type="text"] {
  width: 100%;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(100,160,220,0.3);
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 1rem;
  color: #d0dce8;
  outline: none;
  transition: border-color 0.15s;
}

.mm-field input[type="text"]:focus {
  border-color: rgba(100,180,255,0.6);
  background: rgba(255,255,255,0.09);
}

.mm-field input[type="text"]::placeholder {
  color: #3a5570;
}

.mm-newgame-desc {
  font-size: 0.82rem;
  color: #4e6e88;
  line-height: 1.6;
  margin-bottom: 24px;
}

.mm-newgame-actions {
  display: flex;
  gap: 12px;
}

/* ── Game mode toggle ──────────────────────────────────────────────────── */
.mm-mode-toggle {
  margin-bottom: 24px;
}

.mm-mode-toggle label {
  display: block;
  font-size: 0.78rem;
  color: #7099c0;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 10px;
}

.mm-mode-options {
  display: flex;
  gap: 10px;
}

.mm-mode-option {
  flex: 1;
  background: rgba(255,255,255,0.04);
  border: 2px solid rgba(100,160,220,0.2);
  border-radius: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.mm-mode-option:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(100,160,220,0.4);
}

.mm-mode-option.selected {
  border-color: rgba(100,180,255,0.7);
  background: rgba(100,180,255,0.08);
}

.mm-mode-option input[type="radio"] {
  display: none;
}

.mm-mode-option .mm-mode-title {
  font-size: 0.9rem;
  color: #d0dce8;
  font-weight: 600;
  margin-bottom: 4px;
}

.mm-mode-option .mm-mode-hint {
  font-size: 0.75rem;
  color: #5a7e9c;
  line-height: 1.4;
}

/* ── Sandbox options ─────────────────────────────────────────────────── */
.mm-sandbox-options {
  margin-top: 12px;
}
.mm-sandbox-options > label {
  display: block;
  font-size: 0.85rem;
  color: #b0c4d8;
  font-weight: 600;
  margin-bottom: 8px;
}
.mm-sandbox-toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mm-toggle-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.82rem;
  color: #8ab0cc;
  cursor: pointer;
}
.mm-toggle-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #4a90d9;
}

/* ── Error / info messages ──────────────────────────────────────────────── */
.mm-message {
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 0.82rem;
  margin-bottom: 16px;
}

.mm-message-error {
  background: rgba(180,50,50,0.2);
  border: 1px solid rgba(180,80,80,0.35);
  color: #e09090;
}

.mm-message-info {
  background: rgba(30,100,180,0.2);
  border: 1px solid rgba(60,140,220,0.35);
  color: #88bce8;
}

/* ── Confirm modal ──────────────────────────────────────────────────────── */
.mm-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-modal {
  background: #0d1e38;
  border: 1px solid rgba(100,160,220,0.3);
  border-radius: 12px;
  padding: 28px 32px;
  max-width: 400px;
  width: 90%;
  text-align: center;
}

.mm-modal-title {
  font-size: 1.1rem;
  font-weight: 600;
  color: #cce4f8;
  margin: 0 0 12px;
}

.mm-modal-body {
  font-size: 0.88rem;
  color: #7099c0;
  margin: 0 0 24px;
  line-height: 1.6;
}

.mm-modal-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

/* ── Hidden import input ────────────────────────────────────────────────── */
#mm-import-file-input {
  display: none;
}

/* ── Transition / fade ──────────────────────────────────────────────────── */
#main-menu-overlay {
  transition: opacity 0.4s ease;
}

#main-menu-overlay.mm-fade-out {
  opacity: 0;
  pointer-events: none;
}
`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The root overlay element. @type {HTMLElement | null} */
let _overlay = null;

/** Callback invoked when the player has chosen a game to play. @type {Function | null} */
let _onGameReady = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mounts the main menu into the given container and begins the entry flow.
 *
 * @param {HTMLElement} container  The #ui-overlay div.
 * @param {(state: import('../core/gameState.js').GameState) => void} onGameReady
 *   Called with the fully-initialised game state once the player starts or
 *   loads a game.  The caller should then boot the VAB and hide this menu.
 */
export function initMainMenu(container, onGameReady) {
  _onGameReady = onGameReady;

  // Inject styles once.
  if (!document.getElementById('mm-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'mm-styles';
    styleEl.textContent = MENU_STYLES;
    document.head.appendChild(styleEl);
  }

  // Create overlay element.
  _overlay = document.createElement('div');
  _overlay.id = 'main-menu-overlay';
  container.appendChild(_overlay);

  // Decide which screen to show first.
  const saves = listSaves();
  const hasAnySave = saves.some((s) => s !== null);

  _renderTitle(_overlay);

  if (hasAnySave) {
    _renderLoadScreen(_overlay, saves);
  } else {
    _renderNewGameScreen(_overlay, false);
  }

  _startShootingStars();

  console.log('[MainMenu] Displayed. Has saves:', hasAnySave);
}

// ---------------------------------------------------------------------------
// Private — screen renderers
// ---------------------------------------------------------------------------

/**
 * Renders the game title block.
 *
 * @param {HTMLElement} overlay
 */
function _renderTitle(overlay) {
  const block = document.createElement('div');
  block.className = 'mm-title-block';
  block.innerHTML = `
    <img class="mm-logo" src="/favicon.svg" alt="Space Agency Logo" />
    <h1 class="mm-title">Space Agency</h1>
    <p class="mm-subtitle">Simulation</p>
  `;
  overlay.appendChild(block);
}

/**
 * Renders the load/save-selection screen.
 *
 * @param {HTMLElement} overlay
 * @param {(import('../core/saveload.js').SaveSlotSummary | null)[]} saves
 */
function _renderLoadScreen(overlay, saves) {
  const screen = document.createElement('div');
  screen.className = 'mm-screen';
  screen.id = 'mm-load-screen';
  screen.setAttribute('data-screen', 'load');

  screen.innerHTML = `<h2 class="mm-screen-title">Select Save</h2>`;

  // Build the saves grid.
  const grid = document.createElement('div');
  grid.className = 'mm-saves-grid';

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const summary = saves[i];
    grid.appendChild(
      summary ? _buildSaveCard(summary) : _buildEmptySlotCard(i)
    );
  }

  screen.appendChild(grid);

  // Global actions row.
  const actions = document.createElement('div');
  actions.className = 'mm-global-actions';
  actions.innerHTML = `
    <button class="mm-btn mm-btn-primary mm-btn-large" id="mm-new-game-btn">New Game</button>
    <button class="mm-btn mm-btn-secondary" id="mm-import-btn">Import Save</button>
    <input type="file" id="mm-import-file-input" accept=".json,application/json" />
  `;
  screen.appendChild(actions);

  overlay.appendChild(screen);

  // Wire up global actions.
  screen.querySelector('#mm-new-game-btn').addEventListener('click', () => {
    _switchScreen('newgame', true);
  });

  _wireImportButton(screen);
}

/**
 * Builds a populated save-slot card element.
 *
 * @param {import('../core/saveload.js').SaveSlotSummary} summary
 * @returns {HTMLElement}
 */
function _buildSaveCard(summary) {
  const card = document.createElement('div');
  card.className = 'mm-save-card';
  card.setAttribute('data-slot', String(summary.slotIndex));

  const kiaClass = summary.crewKIA > 0 ? 'mm-stat-kia' : '';

  const modeBadge = summary.gameMode === 'sandbox'
    ? '<span class="mm-mode-badge mm-mode-sandbox">SANDBOX</span>'
    : summary.gameMode === 'tutorial'
      ? '<span class="mm-mode-badge mm-mode-tutorial">TUTORIAL</span>'
      : '<span class="mm-mode-badge mm-mode-freeplay">FREE PLAY</span>';

  card.innerHTML = `
    <p class="mm-save-card-name">${_escapeHtml(summary.saveName)} ${modeBadge}</p>
    ${summary.agencyName ? `<p class="mm-save-card-agency" data-agency-name="${_escapeHtml(summary.agencyName)}">${_escapeHtml(summary.agencyName)}</p>` : ''}
    <p class="mm-save-card-date">Saved ${formatDate(summary.timestamp)}</p>
    <div class="mm-save-card-stats">
      <div class="mm-stat">
        <span class="mm-stat-label">Cash</span>
        <span class="mm-stat-value">${formatMoney(summary.money)}</span>
      </div>
      <div class="mm-stat">
        <span class="mm-stat-label">Time Played</span>
        <span class="mm-stat-value">${formatPlayTime(summary.playTimeSeconds)}</span>
      </div>
      <div class="mm-stat">
        <span class="mm-stat-label">Flight Time</span>
        <span class="mm-stat-value">${formatPlayTime(summary.flightTimeSeconds)}</span>
      </div>
      <div class="mm-stat">
        <span class="mm-stat-label">Missions Done</span>
        <span class="mm-stat-value">${summary.missionsCompleted}</span>
      </div>
      <div class="mm-stat">
        <span class="mm-stat-label">Accepted</span>
        <span class="mm-stat-value">${summary.acceptedMissionCount}</span>
      </div>
      <div class="mm-stat">
        <span class="mm-stat-label">Total Flights</span>
        <span class="mm-stat-value">${summary.totalFlights}</span>
      </div>
      <div class="mm-stat">
        <span class="mm-stat-label">Crew</span>
        <span class="mm-stat-value">${summary.crewCount}</span>
      </div>
      <div class="mm-stat">
        <span class="mm-stat-label">KIA</span>
        <span class="mm-stat-value ${kiaClass}">${summary.crewKIA}</span>
      </div>
    </div>
    <div class="mm-save-card-actions">
      <button class="mm-btn mm-btn-primary" data-action="load" data-slot="${summary.slotIndex}">Load</button>
      <button class="mm-btn mm-btn-secondary" data-action="export" data-slot="${summary.slotIndex}">Export</button>
      <button class="mm-btn mm-btn-danger" data-action="delete" data-slot="${summary.slotIndex}">Delete</button>
    </div>
  `;

  // Wire card-level actions.
  card.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const slot   = Number(btn.dataset.slot);
    if (action === 'load')   { _handleLoad(slot); }
    if (action === 'export') { _handleExport(slot); }
    if (action === 'delete') { _handleDeleteConfirm(slot, summary.saveName); }
  });

  return card;
}

/**
 * Builds a placeholder card for an empty save slot.
 *
 * @param {number} slotIndex
 * @returns {HTMLElement}
 */
function _buildEmptySlotCard(slotIndex) {
  const card = document.createElement('div');
  card.className = 'mm-save-card mm-empty-slot';
  card.setAttribute('data-slot', String(slotIndex));
  card.innerHTML = `<span class="mm-empty-slot-label">Empty Slot ${slotIndex + 1}</span>`;
  return card;
}

/**
 * Renders the New Game / agency-name prompt screen.
 *
 * @param {HTMLElement} overlay
 * @param {boolean} canGoBack  Whether a back button to the load screen is shown.
 */
function _renderNewGameScreen(overlay, canGoBack) {
  const screen = document.createElement('div');
  screen.className = 'mm-screen';
  screen.id = 'mm-newgame-screen';
  screen.setAttribute('data-screen', 'newgame');

  screen.innerHTML = `
    <h2 class="mm-screen-title">New Game</h2>
    <div class="mm-newgame-form">
      <p class="mm-newgame-desc">
        You are founding a new space agency with $2,000,000 in seed funding
        (matched by a $2,000,000 loan). Choose a game mode, name your agency,
        and begin your space programme.
      </p>
      <div class="mm-field">
        <label for="mm-agency-name-input">Agency Name</label>
        <input
          id="mm-agency-name-input"
          type="text"
          maxlength="48"
          placeholder="e.g. Kerbal Space Program"
          autocomplete="off"
        />
      </div>
      <div class="mm-mode-toggle">
        <label>Game Mode</label>
        <div class="mm-mode-options">
          <div class="mm-mode-option selected" data-mode="tutorial">
            <input type="radio" name="mm-game-mode" value="tutorial" checked />
            <div class="mm-mode-title">Tutorial</div>
            <div class="mm-mode-hint">Guided missions unlock parts and facilities step by step.</div>
          </div>
          <div class="mm-mode-option" data-mode="freeplay">
            <input type="radio" name="mm-game-mode" value="freeplay" />
            <div class="mm-mode-title">Free Play</div>
            <div class="mm-mode-hint">All starter parts and facility building available from the start.</div>
          </div>
          <div class="mm-mode-option" data-mode="sandbox">
            <input type="radio" name="mm-game-mode" value="sandbox" />
            <div class="mm-mode-title">Sandbox</div>
            <div class="mm-mode-hint">Everything unlocked, unlimited funds. Contracts and reputation still active.</div>
          </div>
        </div>
      </div>
      <div class="mm-sandbox-options" id="mm-sandbox-options" style="display:none">
        <label>Sandbox Options</label>
        <div class="mm-sandbox-toggles">
          <label class="mm-toggle-label">
            <input type="checkbox" id="mm-sandbox-malfunctions" />
            Enable malfunctions
          </label>
          <label class="mm-toggle-label">
            <input type="checkbox" id="mm-sandbox-weather" />
            Enable weather effects
          </label>
        </div>
      </div>
      <div id="mm-newgame-error"></div>
      <div class="mm-newgame-actions">
        <button class="mm-btn mm-btn-primary mm-btn-large" id="mm-start-btn">Start Game</button>
        ${canGoBack ? '<button class="mm-btn mm-btn-secondary" id="mm-back-btn">Back</button>' : ''}
      </div>
    </div>
  `;

  overlay.appendChild(screen);

  const nameInput  = screen.querySelector('#mm-agency-name-input');
  const startBtn   = screen.querySelector('#mm-start-btn');
  const backBtn    = screen.querySelector('#mm-back-btn');
  const errorDiv   = screen.querySelector('#mm-newgame-error');

  // Wire up game mode toggle cards.
  const modeOptions = screen.querySelectorAll('.mm-mode-option');
  const sandboxOpts = screen.querySelector('#mm-sandbox-options');
  for (const opt of modeOptions) {
    opt.addEventListener('click', () => {
      for (const o of modeOptions) o.classList.remove('selected');
      opt.classList.add('selected');
      opt.querySelector('input[type="radio"]').checked = true;
      // Show/hide sandbox-specific options.
      if (sandboxOpts) {
        sandboxOpts.style.display = opt.dataset.mode === 'sandbox' ? '' : 'none';
      }
    });
  }

  // Focus the name field immediately.
  setTimeout(() => nameInput.focus(), 50);

  // Allow pressing Enter to start.
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startBtn.click();
  });

  startBtn.addEventListener('click', () => {
    const agencyName = nameInput.value.trim();
    if (!agencyName) {
      _showMessage(errorDiv, 'Please enter an agency name.', 'error');
      nameInput.focus();
      return;
    }
    const selectedMode = screen.querySelector('input[name="mm-game-mode"]:checked').value;
    const sandboxOptions = selectedMode === 'sandbox' ? {
      malfunctionsEnabled: screen.querySelector('#mm-sandbox-malfunctions')?.checked ?? false,
      weatherEnabled: screen.querySelector('#mm-sandbox-weather')?.checked ?? false,
    } : null;
    _startNewGame(agencyName, selectedMode, sandboxOptions);
  });

  if (backBtn) {
    backBtn.addEventListener('click', () => _switchScreen('load', false));
  }
}

// ---------------------------------------------------------------------------
// Private — screen switching
// ---------------------------------------------------------------------------

/**
 * Replaces the current screen content (everything after the title block)
 * with a fresh render of the target screen.
 *
 * @param {'load' | 'newgame'} target
 * @param {boolean} canGoBack
 */
function _switchScreen(target, canGoBack) {
  if (!_overlay) return;

  // Remove all but the title block.
  const children = Array.from(_overlay.children);
  for (const child of children) {
    if (!child.classList.contains('mm-title-block')) {
      child.remove();
    }
  }

  if (target === 'load') {
    const saves = listSaves();
    _renderLoadScreen(_overlay, saves);
  } else if (target === 'newgame') {
    _renderNewGameScreen(_overlay, canGoBack);
  }
}

// ---------------------------------------------------------------------------
// Private — action handlers
// ---------------------------------------------------------------------------

/**
 * Loads the game from the given save slot and begins the game.
 *
 * @param {number} slotIndex
 */
function _handleLoad(slotIndex) {
  try {
    const state = loadGame(slotIndex);
    reconcileParts(state);
    _beginGame(state);
  } catch (err) {
    console.error('[MainMenu] Load failed:', err);
    _showGlobalError(`Failed to load save: ${err.message}`);
  }
}

/**
 * Exports the save in the given slot as a JSON file download.
 *
 * @param {number} slotIndex
 */
function _handleExport(slotIndex) {
  try {
    exportSave(slotIndex);
  } catch (err) {
    console.error('[MainMenu] Export failed:', err);
    _showGlobalError(`Export failed: ${err.message}`);
  }
}

/**
 * Shows a confirmation dialog then deletes the save if confirmed.
 *
 * @param {number} slotIndex
 * @param {string} saveName  Human-readable name shown in the dialog.
 */
function _handleDeleteConfirm(slotIndex, saveName) {
  _showConfirmModal(
    'Delete Save',
    `Are you sure you want to delete "${_escapeHtml(saveName)}"? This cannot be undone.`,
    'Delete',
    () => {
      try {
        deleteSave(slotIndex);
        // Refresh the load screen.
        _switchScreen('load', false);
        const saves = listSaves();
        const hasAnySave = saves.some((s) => s !== null);
        if (!hasAnySave) {
          // All saves deleted — go straight to new game.
          _switchScreen('newgame', false);
        }
      } catch (err) {
        console.error('[MainMenu] Delete failed:', err);
        _showGlobalError(`Delete failed: ${err.message}`);
      }
    }
  );
}

/**
 * Creates a fresh game state for a new game and begins playing.
 *
 * @param {string} agencyName
 * @param {string} selectedMode  GameMode enum value ('tutorial', 'freeplay', 'sandbox').
 * @param {import('../core/gameState.js').SandboxSettings|null} sandboxOptions  Sandbox toggle settings (null if not sandbox).
 */
function _startNewGame(agencyName, selectedMode, sandboxOptions = null) {
  const state = createGameState();
  state.agencyName = agencyName;
  state.tutorialMode = selectedMode === GameMode.TUTORIAL;
  state.gameMode = selectedMode;

  if (selectedMode === GameMode.SANDBOX) {
    // -- Sandbox initialisation -----------------------------------------------
    state.sandboxSettings = {
      malfunctionsEnabled: sandboxOptions?.malfunctionsEnabled ?? false,
      weatherEnabled: sandboxOptions?.weatherEnabled ?? false,
    };

    // Unlimited funds, no loan.
    state.money = SANDBOX_STARTING_MONEY;
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

    // All facilities built at tier 1.
    for (const def of FACILITY_DEFINITIONS) {
      state.facilities[def.id] = { built: true, tier: 1 };
    }

    // All parts unlocked.
    state.parts = getAllParts().map((p) => p.id);

    // All tech tree nodes researched and instruments unlocked.
    const researched = [];
    const instruments = [];
    for (const node of TECH_NODES) {
      researched.push(node.id);
      for (const iid of node.unlocksInstruments) {
        if (!instruments.includes(iid)) instruments.push(iid);
      }
    }
    state.techTree = { researched, unlockedInstruments: instruments };
  } else {
    // Tutorial or free-play — existing logic.
    state.parts = selectedMode === GameMode.TUTORIAL
      ? [...TUTORIAL_STARTER_PARTS]
      : [...FREE_STARTER_PARTS];
  }

  // Seed tutorial missions (applies to all modes for contract generation).
  initializeMissions(state);

  console.log(`[MainMenu] New game started (${selectedMode}). Agency:`, agencyName);
  _beginGame(state);
}

/**
 * Wires up the "Import Save" button and hidden file input.
 *
 * @param {HTMLElement} screen
 */
function _wireImportButton(screen) {
  const importBtn   = screen.querySelector('#mm-import-btn');
  const fileInput   = screen.querySelector('#mm-import-file-input');

  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    fileInput.value = ''; // Reset so the same file can be re-imported.

    const reader = new FileReader();
    reader.onload = (event) => {
      const jsonString = event.target.result;

      // Find the first empty slot; if all are full, use slot 0 (overwrites oldest).
      const saves = listSaves();
      let targetSlot = saves.findIndex((s) => s === null);
      if (targetSlot === -1) targetSlot = 0;

      try {
        importSave(jsonString, targetSlot);
        // Refresh the load screen to show the imported save.
        _switchScreen('load', false);
      } catch (err) {
        console.error('[MainMenu] Import failed:', err);
        _showGlobalError(`Import failed: ${err.message}`);
      }
    };
    reader.onerror = () => {
      _showGlobalError('Failed to read the selected file.');
    };
    reader.readAsText(file);
  });
}

/**
 * Fades out the menu and invokes the onGameReady callback.
 *
 * @param {import('../core/gameState.js').GameState} state
 */
function _beginGame(state) {
  if (!_overlay) return;

  _stopShootingStars();
  _overlay.classList.add('mm-fade-out');

  setTimeout(() => {
    if (_overlay && _overlay.parentNode) {
      _overlay.parentNode.removeChild(_overlay);
    }
    _overlay = null;
    if (_onGameReady) {
      _onGameReady(state);
    }
  }, 420);
}

// ---------------------------------------------------------------------------
// Private — modal / message helpers
// ---------------------------------------------------------------------------

/**
 * Shows a confirm/cancel modal dialog.
 *
 * @param {string}   title       Modal heading.
 * @param {string}   body        Body text (HTML-escaped internally).
 * @param {string}   confirmText Label for the confirm button.
 * @param {Function} onConfirm   Called if the player confirms.
 */
function _showConfirmModal(title, body, confirmText, onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.className = 'mm-modal-backdrop';
  backdrop.innerHTML = `
    <div class="mm-modal" role="dialog" aria-modal="true">
      <p class="mm-modal-title">${_escapeHtml(title)}</p>
      <p class="mm-modal-body">${body}</p>
      <div class="mm-modal-actions">
        <button class="mm-btn mm-btn-danger" id="mm-modal-confirm">${_escapeHtml(confirmText)}</button>
        <button class="mm-btn mm-btn-secondary" id="mm-modal-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const remove = () => backdrop.remove();

  backdrop.querySelector('#mm-modal-confirm').addEventListener('click', () => {
    remove();
    onConfirm();
  });
  backdrop.querySelector('#mm-modal-cancel').addEventListener('click', remove);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) remove();
  });
}

/**
 * Displays an error message banner at the top of the current screen.
 *
 * @param {string} message
 */
function _showGlobalError(message) {
  if (!_overlay) return;

  // Remove any previous global error banner.
  const existing = _overlay.querySelector('.mm-global-error');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className = 'mm-message mm-message-error mm-global-error';
  banner.textContent = message;

  // Insert after the title block.
  const screen = _overlay.querySelector('.mm-screen');
  if (screen) {
    screen.insertBefore(banner, screen.firstChild);
  } else {
    _overlay.appendChild(banner);
  }
}

/**
 * Shows an inline message (error or info) inside a target container.
 *
 * @param {HTMLElement} container
 * @param {string}      message
 * @param {'error'|'info'} type
 */
function _showMessage(container, message, type) {
  container.className = `mm-message mm-message-${type}`;
  container.textContent = message;
}

// ---------------------------------------------------------------------------
// Private — utility
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe insertion as HTML text content.
 *
 * @param {string} str
 * @returns {string}
 */
function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
