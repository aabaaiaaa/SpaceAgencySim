/**
 * topbar.js — Persistent HTML top bar overlay, shown on all in-game screens.
 *
 * Layout:
 *   Left   — agency name
 *   Centre — cash amount (clickable → loan modal)
 *   Right  — hamburger menu button (dropdown: Save Game / Load Game / Exit to Menu)
 *
 * Loan modal displays:
 *   - Outstanding loan balance
 *   - Current interest rate (3% per mission)
 *   - Estimated interest on next mission completion
 *   - Total interest accrued to date
 *   - Pay Down Loan action (validates against available cash)
 *   - Borrow More action (validates against MAX_LOAN_BALANCE cap)
 *
 * Hamburger dropdown:
 *   - Save Game   → opens save slot picker
 *   - Load Game   → navigates to main menu (load screen)
 *   - Exit to Menu → confirmation dialog, then navigates to main menu
 *
 * Mount with initTopBar(), remove with destroyTopBar().
 * Call refreshTopBar() after any operation that changes state.money.
 *
 * @module topbar
 */

import { payDownLoan, borrowMore } from '../core/finance.js';
import { saveGame, listSaves, SAVE_SLOT_COUNT } from '../core/saveload.js';
import { MAX_LOAN_BALANCE } from '../core/constants.js';
import { syncVabToGameState } from '../ui/vab.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The top bar root element. @type {HTMLElement | null} */
let _root = null;

/** The game state reference. @type {import('../core/gameState.js').GameState | null} */
let _state = null;

/** Callback invoked when the player wants to exit to the main menu. @type {(() => void) | null} */
let _onExitToMenu = null;

/**
 * Optional flight-specific menu items injected by the flight controller.
 * Each entry: { label: string, onClick: () => void, title?: string }
 * @type {Array<{ label: string, onClick: () => void, title?: string }>}
 */
let _flightMenuItems = [];

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const TOPBAR_STYLES = `
/* ══════════════════════════════════════════════════════════════════
   Game Top Bar — fixed 44 px strip visible on every in-game screen
   ══════════════════════════════════════════════════════════════════ */

#game-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 8px;
  background: rgba(4, 8, 20, 0.92);
  border-bottom: 1px solid rgba(100, 160, 220, 0.22);
  pointer-events: auto;
  z-index: 100;
  box-sizing: border-box;
  font-family: system-ui, sans-serif;
  user-select: none;
}

/* Agency name — left, takes all remaining space */
#topbar-agency {
  font-size: 0.83rem;
  font-weight: 600;
  color: #cce4f8;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Cash button — centre */
#topbar-cash {
  border: none;
  background: none;
  padding: 4px 12px;
  margin: 0;
  font-family: inherit;
  font-size: 0.92rem;
  font-weight: 600;
  color: #5ddb50;
  letter-spacing: 0.02em;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.12s;
  white-space: nowrap;
}
#topbar-cash:hover {
  background: rgba(93, 219, 80, 0.12);
}
#topbar-cash:active {
  background: rgba(93, 219, 80, 0.22);
}

/* Hamburger button — right */
#topbar-menu-btn {
  border: none;
  background: none;
  padding: 4px 8px;
  margin: 0;
  font-family: inherit;
  font-size: 1.25rem;
  line-height: 1;
  color: #8eb8d8;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.12s, color 0.12s;
}
#topbar-menu-btn:hover {
  background: rgba(140, 184, 216, 0.14);
  color: #cce4f8;
}

/* ══════════════════════════════════════════════════════════════════
   Hamburger dropdown
   ══════════════════════════════════════════════════════════════════ */

#topbar-dropdown {
  position: fixed;
  top: 44px;
  right: 8px;
  min-width: 186px;
  background: #0d1520;
  border: 1px solid rgba(100, 160, 220, 0.28);
  border-radius: 6px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55);
  z-index: 150;
  overflow: hidden;
  pointer-events: auto;
}

.topbar-dropdown-item {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 16px;
  border: none;
  background: none;
  text-align: left;
  font-family: inherit;
  font-size: 0.88rem;
  color: #cce4f8;
  cursor: pointer;
  transition: background 0.1s;
}
.topbar-dropdown-item:hover {
  background: rgba(100, 160, 220, 0.12);
}
.topbar-dropdown-item.danger {
  color: #e88080;
}
.topbar-dropdown-item.danger:hover {
  background: rgba(232, 80, 80, 0.10);
}

.topbar-dropdown-sep {
  border: none;
  border-top: 1px solid rgba(100, 160, 220, 0.14);
  margin: 0;
}

/* ══════════════════════════════════════════════════════════════════
   Modal backdrop
   ══════════════════════════════════════════════════════════════════ */

.topbar-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}

/* ══════════════════════════════════════════════════════════════════
   Shared modal box
   ══════════════════════════════════════════════════════════════════ */

.topbar-modal {
  background: #0d1520;
  border: 1px solid rgba(100, 160, 220, 0.28);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
  padding: 26px 30px 22px;
  width: 440px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  box-sizing: border-box;
  pointer-events: auto;
  font-family: system-ui, sans-serif;
  color: #cce4f8;
}

.topbar-modal-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.topbar-modal-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: #e8f4ff;
  margin: 0;
}
.topbar-modal-close {
  border: none;
  background: none;
  font-size: 1.1rem;
  color: #7a9ab8;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
  border-radius: 3px;
  transition: color 0.1s;
}
.topbar-modal-close:hover {
  color: #cce4f8;
}

/* ══════════════════════════════════════════════════════════════════
   Loan stat rows
   ══════════════════════════════════════════════════════════════════ */

#loan-stats-container {
  border: 1px solid rgba(100, 160, 220, 0.12);
  border-radius: 6px;
  overflow: hidden;
}
.loan-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(100, 160, 220, 0.08);
  font-size: 0.87rem;
}
.loan-stat-row:last-child {
  border-bottom: none;
}
.loan-stat-label {
  color: #8eb8d8;
}
.loan-stat-value {
  font-weight: 600;
  color: #e8f4ff;
}
.loan-stat-value.negative {
  color: #e07070;
}

/* ══════════════════════════════════════════════════════════════════
   Loan action sections
   ══════════════════════════════════════════════════════════════════ */

.loan-action {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(100, 160, 220, 0.14);
}
.loan-action-label {
  display: block;
  font-size: 0.80rem;
  color: #8eb8d8;
  margin-bottom: 6px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.loan-action-hint {
  font-size: 0.78rem;
  color: #556680;
  margin-bottom: 8px;
}
.loan-action-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.loan-action-input {
  flex: 1;
  padding: 7px 10px;
  background: #141e2e;
  border: 1px solid rgba(100, 160, 220, 0.22);
  border-radius: 5px;
  color: #e8f4ff;
  font-family: inherit;
  font-size: 0.88rem;
  outline: none;
  box-sizing: border-box;
}
.loan-action-input:focus {
  border-color: rgba(100, 160, 220, 0.50);
}
.loan-action-btn {
  padding: 7px 16px;
  border: none;
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.1s, background 0.1s;
}
.loan-action-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
.loan-pay-btn {
  background: #2a6038;
  color: #a8f0b8;
}
.loan-pay-btn:hover:not(:disabled) {
  background: #347548;
}
.loan-borrow-btn {
  background: #2a4060;
  color: #a8d0f0;
}
.loan-borrow-btn:hover:not(:disabled) {
  background: #345078;
}
.loan-feedback {
  font-size: 0.80rem;
  margin-top: 5px;
  min-height: 1.1em;
  color: #e8c050;
}

/* ══════════════════════════════════════════════════════════════════
   Save slot picker
   ══════════════════════════════════════════════════════════════════ */

.save-slot-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border: 1px solid rgba(100, 160, 220, 0.16);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
  box-sizing: border-box;
}
.save-slot-card:last-child {
  margin-bottom: 0;
}
.save-slot-card:hover {
  background: rgba(100, 160, 220, 0.10);
  border-color: rgba(100, 160, 220, 0.36);
}
.save-slot-info strong {
  display: block;
  font-size: 0.90rem;
  color: #cce4f8;
  margin-bottom: 2px;
}
.save-slot-info span {
  font-size: 0.80rem;
  color: #8eb8d8;
}
.save-slot-info span.empty-slot {
  color: #455870;
}
.save-slot-action-tag {
  font-size: 0.78rem;
  padding: 3px 10px;
  border: 1px solid rgba(100, 160, 220, 0.24);
  border-radius: 4px;
  background: rgba(60, 120, 200, 0.12);
  color: #8eb8d8;
  white-space: nowrap;
  pointer-events: none;
  flex-shrink: 0;
  margin-left: 10px;
}

/* ══════════════════════════════════════════════════════════════════
   Confirmation dialog
   ══════════════════════════════════════════════════════════════════ */

.confirm-msg {
  font-size: 0.90rem;
  color: #aac8e8;
  margin-bottom: 22px;
  line-height: 1.55;
}
.confirm-btn-row {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.confirm-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 5px;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.1s;
}
.confirm-btn-cancel {
  background: rgba(100, 160, 220, 0.14);
  color: #aac8e8;
}
.confirm-btn-cancel:hover {
  background: rgba(100, 160, 220, 0.24);
}
.confirm-btn-danger {
  background: #7a2020;
  color: #f8d0d0;
}
.confirm-btn-danger:hover {
  background: #9a2a2a;
}
`;

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a dollar amount as $X,XXX,XXX.
 * @param {number} n
 * @returns {string}
 */
function _fmtCash(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/**
 * Format an interest rate decimal as a percentage string.
 * @param {number} r  e.g. 0.03
 * @returns {string}  e.g. "3%"
 */
function _fmtRate(r) {
  return (r * 100).toFixed(0) + '%';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the persistent top bar above all in-game screens.
 *
 * @param {HTMLElement} container
 *   The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} state
 *   The current game state.
 * @param {{ onExitToMenu: () => void }} callbacks
 *   `onExitToMenu` is called when the player confirms they want to leave.
 */
export function initTopBar(container, state, { onExitToMenu }) {
  _state = state;
  _onExitToMenu = onExitToMenu;

  // Inject styles once.
  if (!document.getElementById('topbar-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'topbar-styles';
    styleEl.textContent = TOPBAR_STYLES;
    document.head.appendChild(styleEl);
  }

  _root = document.createElement('div');
  _root.id = 'game-topbar';

  // Agency name — left
  const agency = document.createElement('span');
  agency.id = 'topbar-agency';
  agency.textContent = state.agencyName || 'Space Agency';

  // Cash button — centre
  const cash = document.createElement('button');
  cash.id = 'topbar-cash';
  cash.dataset.testid = 'topbar-cash';
  cash.setAttribute('aria-label', 'View loan details');
  cash.title = 'View loan details';
  cash.textContent = _fmtCash(state.money ?? 0);
  cash.addEventListener('click', () => _openLoanModal());

  // Hamburger button — right
  const menuBtn = document.createElement('button');
  menuBtn.id = 'topbar-menu-btn';
  menuBtn.dataset.testid = 'topbar-menu-btn';
  menuBtn.setAttribute('aria-label', 'Open menu');
  menuBtn.title = 'Menu';
  menuBtn.textContent = '☰';
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _toggleDropdown();
  });

  _root.appendChild(agency);
  _root.appendChild(cash);
  _root.appendChild(menuBtn);

  container.appendChild(_root);

  // Close dropdown when clicking anywhere outside it.
  document.addEventListener('click', _onDocClick, true);

  console.log('[TopBar] Initialized');
}

/**
 * Remove the top bar and all associated dropdowns/modals from the DOM.
 * Call before returning to the main menu.
 */
export function destroyTopBar() {
  document.removeEventListener('click', _onDocClick, true);
  _closeAllModals();
  _closeDropdown();
  if (_root) {
    _root.remove();
    _root = null;
  }
  _state = null;
  _onExitToMenu = null;
  console.log('[TopBar] Destroyed');
}

/**
 * Sync the cash display in the top bar to the current state.money value.
 * Call this after any operation that changes the player's cash balance
 * (part purchases, mission rewards, loan payments, etc.).
 */
export function refreshTopBar() {
  if (!_state) return;
  const cashEl = document.getElementById('topbar-cash');
  if (cashEl) {
    cashEl.textContent = _fmtCash(_state.money ?? 0);
  }
}

/**
 * Register flight-specific items to be shown at the top of the topbar
 * dropdown while a flight is in progress. Call `clearTopBarFlightItems()`
 * to remove them when the flight ends.
 *
 * @param {Array<{ label: string, onClick: () => void, title?: string }>} items
 */
export function setTopBarFlightItems(items) {
  _flightMenuItems = items ?? [];
}

/**
 * Remove all flight-specific items previously added via `setTopBarFlightItems`.
 */
export function clearTopBarFlightItems() {
  _flightMenuItems = [];
}

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------

function _toggleDropdown() {
  const existing = document.getElementById('topbar-dropdown');
  if (existing) {
    existing.remove();
  } else {
    _openDropdown();
  }
}

function _openDropdown() {
  const menu = document.createElement('div');
  menu.id = 'topbar-dropdown';
  menu.setAttribute('role', 'menu');

  // Inject flight-specific items (e.g. "Return to Space Agency") when in flight.
  if (_flightMenuItems.length > 0) {
    for (const item of _flightMenuItems) {
      const btn = document.createElement('button');
      btn.className = 'topbar-dropdown-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        _closeDropdown();
        item.onClick();
      });
      menu.appendChild(btn);
    }
    const sep = document.createElement('hr');
    sep.className = 'topbar-dropdown-sep';
    menu.appendChild(sep);
  }

  const items = [
    { label: 'Save Game',    action: _openSaveSlotPicker },
    { label: 'Load Game',    action: _doLoadGame        },
    null, // separator
    { label: 'Exit to Menu', action: _doExitToMenu, danger: true },
  ];

  for (const item of items) {
    if (item === null) {
      const sep = document.createElement('hr');
      sep.className = 'topbar-dropdown-sep';
      menu.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'topbar-dropdown-item' + (item.danger ? ' danger' : '');
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _closeDropdown();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
}

function _closeDropdown() {
  const d = document.getElementById('topbar-dropdown');
  if (d) d.remove();
}

/**
 * Capture-phase document click handler — closes the dropdown when the user
 * clicks anywhere that isn't the menu button or the dropdown itself.
 * @param {MouseEvent} e
 */
function _onDocClick(e) {
  const dropdown = document.getElementById('topbar-dropdown');
  if (!dropdown) return;
  const btn = document.getElementById('topbar-menu-btn');
  if (btn && btn.contains(e.target)) return; // the button toggle handles this
  if (!dropdown.contains(e.target)) {
    _closeDropdown();
  }
}

// ---------------------------------------------------------------------------
// Loan Modal
// ---------------------------------------------------------------------------

function _openLoanModal() {
  if (!_state) return;
  _closeAllModals();

  const backdrop = _makeBackdrop('loan-modal-backdrop');

  const modal = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Loan Details');
  modal.addEventListener('click', (e) => e.stopPropagation());

  // Title row
  modal.appendChild(_makeTitleRow('Loan Details', () => backdrop.remove()));

  // Stats section — given an id so pay/borrow can refresh it in-place
  const stats = _buildLoanStats();
  modal.appendChild(stats);

  // Pay Down section
  modal.appendChild(_buildPaySection());

  // Borrow More section
  modal.appendChild(_buildBorrowSection());

  backdrop.addEventListener('click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

/**
 * Build the read-only stats rows for the loan modal.
 * The container is given id="loan-stats-container" so it can be swapped out
 * after a pay-down or borrow operation.
 *
 * @returns {HTMLElement}
 */
function _buildLoanStats() {
  const s = _state;
  const container = document.createElement('div');
  container.id = 'loan-stats-container';

  const interestNext = s.loan.balance * s.loan.interestRate;
  const totalAccrued = s.loan.totalInterestAccrued ?? 0;

  const rows = [
    { label: 'Outstanding balance',      value: _fmtCash(s.loan.balance),      negative: s.loan.balance > 0  },
    { label: 'Interest rate',            value: _fmtRate(s.loan.interestRate) + ' per mission', negative: false },
    { label: 'Interest on next mission', value: _fmtCash(interestNext),         negative: interestNext > 0    },
    { label: 'Total interest accrued',   value: _fmtCash(totalAccrued),         negative: false               },
  ];

  for (const { label, value, negative } of rows) {
    const row = document.createElement('div');
    row.className = 'loan-stat-row';

    const lbl = document.createElement('span');
    lbl.className = 'loan-stat-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className = 'loan-stat-value' + (negative ? ' negative' : '');
    val.textContent = value;

    row.appendChild(lbl);
    row.appendChild(val);
    container.appendChild(row);
  }

  return container;
}

/**
 * Replace the existing loan stats container with freshly-computed values.
 */
function _refreshLoanStats() {
  const old = document.getElementById('loan-stats-container');
  if (!old || !_state) return;
  old.replaceWith(_buildLoanStats());
}

/**
 * Build the "Pay Down Loan" action section.
 * @returns {HTMLElement}
 */
function _buildPaySection() {
  const section = document.createElement('div');
  section.className = 'loan-action';

  const lbl = document.createElement('span');
  lbl.className = 'loan-action-label';
  lbl.textContent = 'Pay Down Loan';

  const hint = document.createElement('div');
  hint.className = 'loan-action-hint';
  hint.id = 'pay-hint';
  hint.textContent = `Available cash: ${_fmtCash(_state?.money ?? 0)}`;

  const row = document.createElement('div');
  row.className = 'loan-action-row';

  const input = document.createElement('input');
  input.className = 'loan-action-input';
  input.type = 'number';
  input.min = '1';
  input.step = '10000';
  input.placeholder = 'Amount ($)';
  input.dataset.testid = 'loan-pay-input';

  const btn = document.createElement('button');
  btn.className = 'loan-action-btn loan-pay-btn';
  btn.textContent = 'Pay Down';
  btn.dataset.testid = 'loan-pay-btn';

  const feedback = document.createElement('div');
  feedback.className = 'loan-feedback';
  feedback.id = 'pay-feedback';

  btn.addEventListener('click', () => {
    const amount = parseFloat(input.value);
    if (!_state) return;

    if (!amount || amount <= 0) {
      feedback.textContent = 'Enter a positive amount.';
      return;
    }
    if (_state.loan.balance <= 0) {
      feedback.textContent = 'No outstanding loan balance.';
      return;
    }
    if (amount > _state.money) {
      feedback.textContent = `Insufficient funds — you have ${_fmtCash(_state.money)}.`;
      return;
    }

    const { paid, newBalance } = payDownLoan(_state, amount);
    refreshTopBar();
    _refreshLoanStats();

    const hint = document.getElementById('pay-hint');
    if (hint) hint.textContent = `Available cash: ${_fmtCash(_state.money)}`;

    if (paid < amount) {
      feedback.textContent = `Paid ${_fmtCash(paid)}. Loan fully cleared!`;
    } else if (newBalance <= 0) {
      feedback.textContent = `Paid ${_fmtCash(paid)}. Loan fully cleared!`;
    } else {
      feedback.textContent = `Paid ${_fmtCash(paid)}. Remaining balance: ${_fmtCash(newBalance)}.`;
    }
    input.value = '';
  });

  row.appendChild(input);
  row.appendChild(btn);
  section.appendChild(lbl);
  section.appendChild(hint);
  section.appendChild(row);
  section.appendChild(feedback);
  return section;
}

/**
 * Build the "Borrow More" action section.
 * @returns {HTMLElement}
 */
function _buildBorrowSection() {
  const section = document.createElement('div');
  section.className = 'loan-action';

  const lbl = document.createElement('span');
  lbl.className = 'loan-action-label';
  lbl.textContent = 'Borrow More';

  const headroom = Math.max(0, MAX_LOAN_BALANCE - (_state?.loan.balance ?? 0));

  const hint = document.createElement('div');
  hint.className = 'loan-action-hint';
  hint.id = 'borrow-hint';
  hint.textContent = `Max additional: ${_fmtCash(headroom)}  (limit ${_fmtCash(MAX_LOAN_BALANCE)})`;

  const row = document.createElement('div');
  row.className = 'loan-action-row';

  const input = document.createElement('input');
  input.className = 'loan-action-input';
  input.type = 'number';
  input.min = '1';
  input.step = '100000';
  input.placeholder = 'Amount ($)';
  input.dataset.testid = 'loan-borrow-input';

  const btn = document.createElement('button');
  btn.className = 'loan-action-btn loan-borrow-btn';
  btn.textContent = 'Borrow';
  btn.dataset.testid = 'loan-borrow-btn';
  if (headroom <= 0) btn.disabled = true;

  const feedback = document.createElement('div');
  feedback.className = 'loan-feedback';
  feedback.id = 'borrow-feedback';

  btn.addEventListener('click', () => {
    const amount = parseFloat(input.value);
    if (!_state) return;

    if (!amount || amount <= 0) {
      feedback.textContent = 'Enter a positive amount.';
      return;
    }

    const currentHeadroom = Math.max(0, MAX_LOAN_BALANCE - _state.loan.balance);
    if (currentHeadroom <= 0) {
      feedback.textContent = 'Maximum loan limit reached.';
      btn.disabled = true;
      return;
    }

    const { borrowed, newBalance } = borrowMore(_state, amount);
    refreshTopBar();
    _refreshLoanStats();

    const newHeadroom = Math.max(0, MAX_LOAN_BALANCE - _state.loan.balance);
    const h = document.getElementById('borrow-hint');
    if (h) h.textContent = `Max additional: ${_fmtCash(newHeadroom)}  (limit ${_fmtCash(MAX_LOAN_BALANCE)})`;
    if (newHeadroom <= 0) btn.disabled = true;

    if (borrowed < amount) {
      feedback.textContent = `Borrowed ${_fmtCash(borrowed)} (limit reached). Balance: ${_fmtCash(newBalance)}.`;
    } else {
      feedback.textContent = `Borrowed ${_fmtCash(borrowed)}. Balance: ${_fmtCash(newBalance)}.`;
    }
    input.value = '';
  });

  row.appendChild(input);
  row.appendChild(btn);
  section.appendChild(lbl);
  section.appendChild(hint);
  section.appendChild(row);
  section.appendChild(feedback);
  return section;
}

// ---------------------------------------------------------------------------
// Save Slot Picker Modal
// ---------------------------------------------------------------------------

function _openSaveSlotPicker() {
  if (!_state) return;
  _closeAllModals();

  const backdrop = _makeBackdrop('save-modal-backdrop');

  const modal = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Save Game');
  modal.addEventListener('click', (e) => e.stopPropagation());

  modal.appendChild(_makeTitleRow('Save Game', () => backdrop.remove()));

  const saves = listSaves();

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const slot = saves[i];
    const card = document.createElement('div');
    card.className = 'save-slot-card';
    card.dataset.testid = `save-slot-${i}`;

    const info = document.createElement('div');
    info.className = 'save-slot-info';

    if (slot) {
      const name = document.createElement('strong');
      name.textContent = slot.saveName || `Slot ${i + 1}`;

      const detail = document.createElement('span');
      const ts = new Date(slot.timestamp).toLocaleString();
      detail.textContent = `${slot.agencyName} · ${ts}`;

      info.appendChild(name);
      info.appendChild(detail);
    } else {
      const name = document.createElement('strong');
      name.textContent = `Slot ${i + 1}`;

      const detail = document.createElement('span');
      detail.className = 'empty-slot';
      detail.textContent = 'Empty';

      info.appendChild(name);
      info.appendChild(detail);
    }

    const tag = document.createElement('span');
    tag.className = 'save-slot-action-tag';
    tag.textContent = slot ? 'Overwrite' : 'Save here';

    card.appendChild(info);
    card.appendChild(tag);

    // Capture slot index in closure
    const slotIndex = i;
    card.addEventListener('click', () => {
      const saveName = _state.agencyName || 'New Save';
      syncVabToGameState();
      saveGame(_state, slotIndex, saveName);
      backdrop.remove();
      console.log(`[TopBar] Game saved to slot ${slotIndex}`);
    });

    modal.appendChild(card);
  }

  backdrop.addEventListener('click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

// ---------------------------------------------------------------------------
// Load Game — navigates directly to main menu (load screen)
// ---------------------------------------------------------------------------

function _doLoadGame() {
  // Navigate to main menu without a confirmation prompt; the main menu will
  // show the load screen when existing saves are detected.
  if (_onExitToMenu) {
    _onExitToMenu();
  }
}

// ---------------------------------------------------------------------------
// Exit to Menu — confirmation dialog
// ---------------------------------------------------------------------------

function _doExitToMenu() {
  _closeAllModals();

  const backdrop = _makeBackdrop('exit-confirm-backdrop');

  const modal = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Exit to Menu');
  modal.addEventListener('click', (e) => e.stopPropagation());

  modal.appendChild(_makeTitleRow('Exit to Menu', () => backdrop.remove()));

  const msg = document.createElement('p');
  msg.className = 'confirm-msg';
  msg.textContent =
    'Any unsaved progress will be lost. Are you sure you want to return to the main menu?';
  modal.appendChild(msg);

  const btnRow = document.createElement('div');
  btnRow.className = 'confirm-btn-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'confirm-btn confirm-btn-cancel';
  cancelBtn.textContent = 'Stay';
  cancelBtn.addEventListener('click', () => backdrop.remove());

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'confirm-btn confirm-btn-danger';
  confirmBtn.textContent = 'Exit to Menu';
  confirmBtn.dataset.testid = 'exit-confirm-btn';
  confirmBtn.addEventListener('click', () => {
    backdrop.remove();
    if (_onExitToMenu) _onExitToMenu();
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  modal.appendChild(btnRow);

  backdrop.addEventListener('click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

// ---------------------------------------------------------------------------
// Shared modal helpers
// ---------------------------------------------------------------------------

/**
 * Create a backdrop div with the given id and the shared class.
 * @param {string} id
 * @returns {HTMLElement}
 */
function _makeBackdrop(id) {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'topbar-modal-backdrop';
  return el;
}

/**
 * Create a modal title row with a close button.
 * @param {string} title
 * @param {() => void} onClose
 * @returns {HTMLElement}
 */
function _makeTitleRow(title, onClose) {
  const row = document.createElement('div');
  row.className = 'topbar-modal-title-row';

  const h2 = document.createElement('h2');
  h2.className = 'topbar-modal-title';
  h2.textContent = title;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'topbar-modal-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', onClose);

  row.appendChild(h2);
  row.appendChild(closeBtn);
  return row;
}

/**
 * Remove all open topbar modals from the DOM.
 */
function _closeAllModals() {
  for (const id of ['loan-modal-backdrop', 'save-modal-backdrop', 'exit-confirm-backdrop']) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}
