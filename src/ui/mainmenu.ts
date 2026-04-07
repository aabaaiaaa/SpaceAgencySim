/**
 * mainmenu.ts — Main Menu & Load Screen HTML overlay UI.
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
  SAVE_VERSION,
} from '../core/saveload.ts';
import { createGameState } from '../core/gameState.ts';
import { initializeMissions, reconcileParts } from '../core/missions.ts';
import { GameMode, FACILITY_DEFINITIONS, SANDBOX_STARTING_MONEY } from '../core/constants.ts';
import { getAllParts } from '../data/parts.ts';
import { TECH_NODES } from '../data/techtree.ts';
import { logger } from '../core/logger.ts';
import './mainmenu.css';
import type { GameState, SandboxSettings } from '../core/gameState.ts';
import type { SaveSlotSummary } from '../core/saveload.ts';

// ---------------------------------------------------------------------------
// Shooting stars
// ---------------------------------------------------------------------------

let _shootingStarTimer: ReturnType<typeof setTimeout> | null = null;

function _startShootingStars(): void {
  _stopShootingStars();
  _spawnShootingStar();
  _scheduleNext();
}

function _scheduleNext(): void {
  const delay: number = 1500 + Math.random() * 4000; // 1.5–5.5s between stars
  _shootingStarTimer = setTimeout(() => {
    _spawnShootingStar();
    _scheduleNext();
  }, delay);
}

function _stopShootingStars(): void {
  if (_shootingStarTimer !== null) {
    clearTimeout(_shootingStarTimer);
    _shootingStarTimer = null;
  }
}

function _spawnShootingStar(): void {
  if (!_overlay) return;

  const star: HTMLDivElement = document.createElement('div');
  star.className = 'mm-shooting-star';

  const w: number = window.innerWidth;
  const h: number = window.innerHeight;

  // Random start in the upper 80% of the screen
  const x: number = Math.random() * w;
  const y: number = Math.random() * h * 0.8;

  // Random angle — mostly downward, can go left or right
  // Range: 100°–250° (broadly downward, left-to-right or right-to-left)
  const angleDeg: number = 100 + Math.random() * 150;
  const angleRad: number = angleDeg * Math.PI / 180;

  // Direction vector
  const dx: number = Math.cos(angleRad);
  const dy: number = Math.sin(angleRad);

  // Random travel distance and tail length
  const travel: number = 150 + Math.random() * 350;
  const tailLen: number = 30 + Math.random() * 100;
  const thickness: number = Math.random() < 0.3 ? 2 : 1;
  const duration: number = 0.4 + Math.random() * 0.8;

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
  const endX: number = x + dx * travel;
  const endY: number = y + dy * travel;

  const anim: Animation = star.animate([
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
 */
const TUTORIAL_STARTER_PARTS: string[] = [
  'probe-core-mk1', // Uncrewed probe core
  'tank-small',      // Small fuel tank
  'engine-spark',    // Starter liquid engine
  'parachute-mk1',   // Basic parachute
];

/**
 * Part IDs available at the start of a non-tutorial (free play) game.
 * All starter-tier parts are unlocked immediately.
 */
const FREE_STARTER_PARTS: string[] = [
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
 */
function formatMoney(amount: number): string {
  return '$' + Math.round(amount).toLocaleString('en-US');
}

/**
 * Formats seconds as h:mm:ss.
 * e.g. 3725 → "1:02:05"
 */
function formatPlayTime(totalSeconds: number): string {
  const s: number = Math.max(0, Math.floor(totalSeconds));
  const hours: number   = Math.floor(s / 3600);
  const minutes: number = Math.floor((s % 3600) / 60);
  const secs: number    = s % 60;
  const mm: string = String(minutes).padStart(2, '0');
  const ss: string = String(secs).padStart(2, '0');
  return `${hours}:${mm}:${ss}`;
}

/**
 * Formats an ISO 8601 timestamp as a localised short date + time string.
 */
function formatDate(isoTimestamp: string): string {
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
// Module state
// ---------------------------------------------------------------------------

/** The root overlay element. */
let _overlay: HTMLElement | null = null;

/** Callback invoked when the player has chosen a game to play. */
let _onGameReady: ((state: GameState) => void) | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mounts the main menu into the given container and begins the entry flow.
 */
export function initMainMenu(container: HTMLElement, onGameReady: (state: GameState) => void): void {
  _onGameReady = onGameReady;

  // Create overlay element.
  _overlay = document.createElement('div');
  _overlay.id = 'main-menu-overlay';
  container.appendChild(_overlay);

  // Decide which screen to show first.
  const saves = listSaves();
  const hasAnySave: boolean = saves.some((s) => s !== null);

  _renderTitle(_overlay);

  if (hasAnySave) {
    _renderLoadScreen(_overlay, saves);
  } else {
    _renderNewGameScreen(_overlay, false);
  }

  _startShootingStars();


}

// ---------------------------------------------------------------------------
// Private — screen renderers
// ---------------------------------------------------------------------------

/**
 * Renders the game title block.
 */
function _renderTitle(overlay: HTMLElement): void {
  const block: HTMLDivElement = document.createElement('div');
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
 */
function _renderLoadScreen(overlay: HTMLElement, saves: (SaveSlotSummary | null)[]): void {
  const screen: HTMLDivElement = document.createElement('div');
  screen.className = 'mm-screen';
  screen.id = 'mm-load-screen';
  screen.setAttribute('data-screen', 'load');

  screen.innerHTML = `<h2 class="mm-screen-title">Select Save</h2>`;

  // Build the saves grid.
  const grid: HTMLDivElement = document.createElement('div');
  grid.className = 'mm-saves-grid';

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const summary = saves[i];
    grid.appendChild(
      summary ? _buildSaveCard(summary) : _buildEmptySlotCard(i)
    );
  }

  screen.appendChild(grid);

  // Global actions row.
  const actions: HTMLDivElement = document.createElement('div');
  actions.className = 'mm-global-actions';
  actions.innerHTML = `
    <button class="mm-btn mm-btn-primary mm-btn-large" id="mm-new-game-btn">New Game</button>
    <button class="mm-btn mm-btn-secondary" id="mm-import-btn">Import Save</button>
    <input type="file" id="mm-import-file-input" accept=".json,application/json" />
  `;
  screen.appendChild(actions);

  overlay.appendChild(screen);

  // Wire up global actions.
  screen.querySelector('#mm-new-game-btn')!.addEventListener('click', () => {
    _switchScreen('newgame', true);
  });

  _wireImportButton(screen);
}

/**
 * Builds a populated save-slot card element.
 */
function _buildSaveCard(summary: SaveSlotSummary): HTMLDivElement {
  const card: HTMLDivElement = document.createElement('div');
  card.className = 'mm-save-card';
  card.setAttribute('data-slot', String(summary.slotIndex));

  const kiaClass: string = summary.crewKIA > 0 ? 'mm-stat-kia' : '';

  const modeBadge: string = summary.gameMode === 'sandbox'
    ? '<span class="mm-mode-badge mm-mode-sandbox">SANDBOX</span>'
    : summary.gameMode === 'tutorial'
      ? '<span class="mm-mode-badge mm-mode-tutorial">TUTORIAL</span>'
      : '<span class="mm-mode-badge mm-mode-freeplay">FREE PLAY</span>';

  const versionMismatch = summary.version !== SAVE_VERSION;
  const versionBadge = versionMismatch
    ? `<span class="mm-version-warning" data-testid="version-warning">v${summary.version} (current: v${SAVE_VERSION})</span>`
    : '';

  card.innerHTML = `
    <p class="mm-save-card-name">${_escapeHtml(summary.saveName)} ${modeBadge}</p>
    ${summary.agencyName ? `<p class="mm-save-card-agency" data-agency-name="${_escapeHtml(summary.agencyName)}">${_escapeHtml(summary.agencyName)}</p>` : ''}
    <p class="mm-save-card-date">Saved ${formatDate(summary.timestamp)}${versionBadge}</p>
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
  card.addEventListener('click', (e: MouseEvent) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
    if (!btn) return;
    const action: string | undefined = btn.dataset.action;
    const slot: number   = Number(btn.dataset.slot);
    if (action === 'load')   { _handleLoad(slot); }
    if (action === 'export') { _handleExport(slot); }
    if (action === 'delete') { _handleDeleteConfirm(slot, summary.saveName); }
  });

  return card;
}

/**
 * Builds a placeholder card for an empty save slot.
 */
function _buildEmptySlotCard(slotIndex: number): HTMLDivElement {
  const card: HTMLDivElement = document.createElement('div');
  card.className = 'mm-save-card mm-empty-slot';
  card.setAttribute('data-slot', String(slotIndex));
  card.innerHTML = `<span class="mm-empty-slot-label">Empty Slot ${slotIndex + 1}</span>`;
  return card;
}

/**
 * Renders the New Game / agency-name prompt screen.
 */
function _renderNewGameScreen(overlay: HTMLElement, canGoBack: boolean): void {
  const screen: HTMLDivElement = document.createElement('div');
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
        <div id="mm-agency-name-counter" class="mm-char-counter">0 / 48</div>
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

  const nameInput  = screen.querySelector('#mm-agency-name-input') as HTMLInputElement;
  const startBtn   = screen.querySelector('#mm-start-btn') as HTMLButtonElement;
  const backBtn    = screen.querySelector('#mm-back-btn') as HTMLButtonElement | null;
  const errorDiv   = screen.querySelector('#mm-newgame-error') as HTMLElement;

  // Wire up game mode toggle cards.
  const modeOptions = screen.querySelectorAll('.mm-mode-option');
  const sandboxOpts = screen.querySelector('#mm-sandbox-options') as HTMLElement | null;
  for (const opt of modeOptions) {
    // Make cards keyboard-focusable.
    (opt as HTMLElement).setAttribute('tabindex', '0');
    (opt as HTMLElement).setAttribute('role', 'radio');
    (opt as HTMLElement).setAttribute('aria-checked', opt.classList.contains('selected') ? 'true' : 'false');

    const selectOption = (): void => {
      for (const o of modeOptions) {
        o.classList.remove('selected');
        (o as HTMLElement).setAttribute('aria-checked', 'false');
      }
      opt.classList.add('selected');
      (opt as HTMLElement).setAttribute('aria-checked', 'true');
      (opt.querySelector('input[type="radio"]') as HTMLInputElement).checked = true;
      // Show/hide sandbox-specific options.
      if (sandboxOpts) {
        sandboxOpts.style.display = (opt as HTMLElement).dataset.mode === 'sandbox' ? '' : 'none';
      }
    };

    opt.addEventListener('click', selectOption);

    // Keyboard activation: Enter or Space selects the option.
    opt.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        ke.preventDefault();
        selectOption();
      }
    });
  }

  // Character counter for agency name.
  const nameCounter = screen.querySelector('#mm-agency-name-counter') as HTMLElement;
  const updateNameCounter = (): void => {
    const len: number = nameInput.value.length;
    nameCounter.textContent = `${len} / 48`;
    nameCounter.classList.toggle('warning', len >= 43);
  };
  nameInput.addEventListener('input', updateNameCounter);

  // Focus the name field immediately.
  setTimeout(() => nameInput.focus(), 50);

  // Allow pressing Enter to start.
  nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') startBtn.click();
  });

  startBtn.addEventListener('click', () => {
    const agencyName: string = nameInput.value.trim();
    if (!agencyName) {
      _showMessage(errorDiv, 'Please enter an agency name.', 'error');
      nameInput.focus();
      return;
    }
    const selectedMode: string = (screen.querySelector('input[name="mm-game-mode"]:checked') as HTMLInputElement).value;
    const sandboxOptions: SandboxSettings | null = selectedMode === 'sandbox' ? {
      malfunctionsEnabled: (screen.querySelector('#mm-sandbox-malfunctions') as HTMLInputElement | null)?.checked ?? false,
      weatherEnabled: (screen.querySelector('#mm-sandbox-weather') as HTMLInputElement | null)?.checked ?? false,
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
 */
function _switchScreen(target: 'load' | 'newgame', canGoBack: boolean): void {
  if (!_overlay) return;

  // Remove all but the title block.
  const children: Element[] = Array.from(_overlay.children);
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
 */
async function _handleLoad(slotIndex: number): Promise<void> {
  try {
    const state = await loadGame(slotIndex);
    reconcileParts(state);
    _beginGame(state);
  } catch (err: unknown) {
    logger.error('mainMenu', 'Load failed', { error: String(err) });
    _showGlobalError(`Failed to load save: ${(err as Error).message}`);
  }
}

/**
 * Exports the save in the given slot as a JSON file download.
 */
function _handleExport(slotIndex: number): void {
  try {
    exportSave(slotIndex);
  } catch (err: unknown) {
    logger.error('mainMenu', 'Export failed', { error: String(err) });
    _showGlobalError(`Export failed: ${(err as Error).message}`);
  }
}

/**
 * Shows a confirmation dialog then deletes the save if confirmed.
 */
function _handleDeleteConfirm(slotIndex: number, saveName: string): void {
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
        const hasAnySave: boolean = saves.some((s) => s !== null);
        if (!hasAnySave) {
          // All saves deleted — go straight to new game.
          _switchScreen('newgame', false);
        }
      } catch (err: unknown) {
        logger.error('mainMenu', 'Delete failed', { error: String(err) });
        _showGlobalError(`Delete failed: ${(err as Error).message}`);
      }
    }
  );
}

/**
 * Creates a fresh game state for a new game and begins playing.
 */
function _startNewGame(agencyName: string, selectedMode: string, sandboxOptions: SandboxSettings | null = null): void {
  const state = createGameState();
  state.agencyName = agencyName;
  state.tutorialMode = selectedMode === GameMode.TUTORIAL;
  state.gameMode = selectedMode as GameMode;

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
    state.parts = getAllParts().map((p: { id: string }) => p.id);

    // All tech tree nodes researched and instruments unlocked.
    const researched: string[] = [];
    const instruments: string[] = [];
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


  _beginGame(state);
}

/**
 * Wires up the "Import Save" button and hidden file input.
 */
function _wireImportButton(screen: HTMLElement): void {
  const importBtn   = screen.querySelector('#mm-import-btn') as HTMLButtonElement;
  const fileInput   = screen.querySelector('#mm-import-file-input') as HTMLInputElement;

  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file: File | undefined = fileInput.files?.[0];
    if (!file) return;
    fileInput.value = ''; // Reset so the same file can be re-imported.

    const reader = new FileReader();
    reader.onload = (event: ProgressEvent<FileReader>) => {
      const jsonString = event.target?.result as string;

      // Find the first empty slot; if all are full, use slot 0 (overwrites oldest).
      const saves = listSaves();
      let targetSlot: number = saves.findIndex((s) => s === null);
      if (targetSlot === -1) targetSlot = 0;

      try {
        importSave(jsonString, targetSlot);
        // Refresh the load screen to show the imported save.
        _switchScreen('load', false);
      } catch (err: unknown) {
        logger.error('mainMenu', 'Import failed', { error: String(err) });
        _showGlobalError(`Import failed: ${(err as Error).message}`);
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
 */
function _beginGame(state: GameState): void {
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
 */
function _showConfirmModal(title: string, body: string, confirmText: string, onConfirm: () => void): void {
  const backdrop: HTMLDivElement = document.createElement('div');
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

  const remove = (): void => {
    document.removeEventListener('keydown', onEscape);
    backdrop.remove();
  };

  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') remove();
  };
  document.addEventListener('keydown', onEscape);

  backdrop.querySelector('#mm-modal-confirm')!.addEventListener('click', () => {
    remove();
    onConfirm();
  });
  backdrop.querySelector('#mm-modal-cancel')!.addEventListener('click', remove);
  backdrop.addEventListener('click', (e: MouseEvent) => {
    if (e.target === backdrop) remove();
  });

  // Focus the cancel button so Escape works immediately and focus is trapped.
  (backdrop.querySelector('#mm-modal-cancel') as HTMLElement)?.focus();
}

/**
 * Displays an error message banner at the top of the current screen.
 */
function _showGlobalError(message: string): void {
  if (!_overlay) return;

  // Remove any previous global error banner.
  const existing = _overlay.querySelector('.mm-global-error');
  if (existing) existing.remove();

  const banner: HTMLDivElement = document.createElement('div');
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
 */
function _showMessage(container: HTMLElement, message: string, type: 'error' | 'info'): void {
  container.className = `mm-message mm-message-${type}`;
  container.textContent = message;
}

// ---------------------------------------------------------------------------
// Private — utility
// ---------------------------------------------------------------------------

/**
 * Escapes a string for safe insertion as HTML text content.
 */
function _escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
