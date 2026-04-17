/**
 * topbar.ts — Persistent HTML top bar overlay, shown on all in-game screens.
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
 *   - Load Game   → opens load slot picker modal with confirmation
 *   - Exit to Menu → confirmation dialog, then navigates to main menu
 *
 * Mount with initTopBar(), remove with destroyTopBar().
 * Call refreshTopBar() after any operation that changes state.money.
 *
 * @module topbar
 */

import { payDownLoan, borrowMore } from '../core/finance.ts';
import { saveGame, loadGame, listSaves, SAVE_SLOT_COUNT, SAVE_VERSION } from '../core/saveload.ts';
import { reconcileParts } from '../core/missions.ts';
import { GameMode, MAX_LOAN_BALANCE } from '../core/constants.ts';
import { getPartById } from '../data/parts.ts';
import { openHelpPanel } from './help.ts';
import { createListenerTracker } from './listenerTracker.ts';
import { logger } from '../core/logger.ts';
import {
  formatCash,
  moneyColor,
  formatRate,
  formatMissionsBadge,
  helpSectionForScreen,
  isSaveCompatible,
  DROPDOWN_ID,
  MISSIONS_DROPDOWN_ID,
  MODAL_BACKDROP_IDS,
  getTopbarState,
  setTopbarState,
  resetTopbarState,
} from './topbar/_state.ts';
import './topbar.css';
import type { GameState } from '../core/gameState.ts';
import type { ListenerTracker } from './listenerTracker.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlightMenuItem {
  label: string;
  onClick: () => void;
  title?: string;
}

interface HubMenuItem {
  label: string;
  onClick: () => void;
  id?: string;
}

interface DropdownItem {
  label: string;
  action: () => void | Promise<void>;
  danger?: boolean;
}

interface TopBarCallbacks {
  onExitToMenu: () => void;
  onLoadGame?: (state: GameState) => void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The top bar root element. */
let _root: HTMLElement | null = null;

/** The game state reference. */
let _state: GameState | null = null;

/** Callback invoked when the player wants to exit to the main menu. */
let _onExitToMenu: (() => void) | null = null;

/** Callback invoked when the player loads a game from the in-game modal. */
let _onLoadGame: ((state: GameState) => void) | null = null;

/**
 * Optional flight-specific menu items injected by the flight controller.
 */
let _flightMenuItems: FlightMenuItem[] = [];

/**
 * Optional hub-specific menu items injected by the hub UI.
 */
let _hubMenuItems: HubMenuItem[] = [];

/**
 * Optional callback fired when the dropdown opens or closes.
 * Receives `true` when opening, `false` when closing.
 */
let _onDropdownToggle: ((isOpen: boolean) => void) | null = null;

/** Tracks all event listeners registered by the topbar so they can be bulk-removed on destroy. */
let _tracker: ListenerTracker = createListenerTracker();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the persistent top bar above all in-game screens.
 */
export function initTopBar(container: HTMLElement, state: GameState, { onExitToMenu, onLoadGame }: TopBarCallbacks): void {
  _state = state;
  _onExitToMenu = onExitToMenu;
  _onLoadGame = onLoadGame || null;

  _root = document.createElement('div');
  _root.id = 'game-topbar';

  // Agency name — left
  const agency: HTMLSpanElement = document.createElement('span');
  agency.id = 'topbar-agency';
  agency.textContent = state.agencyName || 'Space Agency';

  // Flight (period) counter
  const flightCounter: HTMLSpanElement = document.createElement('span');
  flightCounter.id = 'topbar-flight';
  const period: number = state.currentPeriod ?? 0;
  flightCounter.textContent = `Flight ${period}`;

  // Cash button — centre
  const cash: HTMLButtonElement = document.createElement('button');
  cash.id = 'topbar-cash';
  cash.dataset.testid = 'topbar-cash';
  cash.setAttribute('aria-label', 'View loan details');
  cash.title = 'View loan details';
  cash.textContent = formatCash(state.money ?? 0);
  cash.style.color = moneyColor(state.money ?? 0);
  _tracker.add(cash, 'click', () => _openLoanModal());

  // Hamburger button — right
  const menuBtn: HTMLButtonElement = document.createElement('button');
  menuBtn.id = 'topbar-menu-btn';
  menuBtn.dataset.testid = 'topbar-menu-btn';
  menuBtn.setAttribute('aria-label', 'Open menu');
  menuBtn.title = 'Menu';
  menuBtn.textContent = '\u2630';
  _tracker.add(menuBtn, 'click', (e: Event) => {
    e.stopPropagation();
    _toggleDropdown();
  });

  // Missions button
  const missionsBtn: HTMLButtonElement = document.createElement('button');
  missionsBtn.id = 'topbar-missions-btn';
  missionsBtn.dataset.testid = 'topbar-missions-btn';
  missionsBtn.setAttribute('aria-label', 'View accepted missions');
  missionsBtn.title = 'Accepted Missions';
  missionsBtn.textContent = 'Missions';
  _tracker.add(missionsBtn, 'click', (e: Event) => {
    e.stopPropagation();
    _toggleMissionsDropdown();
  });

  const spacer: HTMLDivElement = document.createElement('div');
  spacer.id = 'topbar-spacer';

  _root.appendChild(agency);

  // Game mode badge — always shown.
  {
    const badge: HTMLSpanElement = document.createElement('span');
    badge.id = 'topbar-mode-badge';
    if (state.gameMode === GameMode.SANDBOX) {
      badge.className = 'mode-sandbox';
      badge.textContent = 'SANDBOX';
    } else if (state.gameMode === GameMode.TUTORIAL) {
      badge.className = 'mode-tutorial';
      badge.textContent = 'TUTORIAL';
    } else {
      badge.className = 'mode-freeplay';
      badge.textContent = 'FREEPLAY';
    }
    _root.appendChild(badge);
  }

  _root.appendChild(flightCounter);
  _root.appendChild(cash);
  _root.appendChild(missionsBtn);
  _root.appendChild(spacer);
  _root.appendChild(menuBtn);

  container.appendChild(_root);
  _refreshMissionsBtn();

  // Close dropdown when clicking anywhere outside it.
  _tracker.add(document, 'click', _onDocClick, true);

  // Escape key closes dropdowns and modals.
  _tracker.add(document, 'keydown', _onDocKeydown as EventListener);
}

/**
 * Remove the top bar and all associated dropdowns/modals from the DOM.
 * Call before returning to the main menu.
 */
export function destroyTopBar(): void {
  _tracker.removeAll();
  _tracker = createListenerTracker();
  _closeAllModals();
  _closeDropdown();
  _closeMissionsDropdown();
  if (_root) {
    _root.remove();
    _root = null;
  }
  _state = null;
  _onExitToMenu = null;
  _onLoadGame = null;
  resetTopbarState();
}

/**
 * Sync the cash display in the top bar to the current state.money value.
 * Call this after any operation that changes the player's cash balance
 * (part purchases, mission rewards, loan payments, etc.).
 */
export function refreshTopBar(): void {
  if (!_state) return;
  const cashEl = document.getElementById('topbar-cash');
  if (cashEl) {
    cashEl.textContent = formatCash(_state.money ?? 0);
    cashEl.style.color = moneyColor(_state.money ?? 0);
  }
  const flightEl = document.getElementById('topbar-flight');
  if (flightEl) {
    const period: number = _state.currentPeriod ?? 0;
    flightEl.textContent = `Flight ${period}`;
  }
  _refreshMissionsBtn();
}

/**
 * Register flight-specific items to be shown at the top of the topbar
 * dropdown while a flight is in progress. Call `clearTopBarFlightItems()`
 * to remove them when the flight ends.
 */
export function setTopBarFlightItems(items: FlightMenuItem[]): void {
  _flightMenuItems = items ?? [];
}

/**
 * Remove all flight-specific items previously added via `setTopBarFlightItems`.
 */
export function clearTopBarFlightItems(): void {
  _flightMenuItems = [];
  _onDropdownToggle = null;
}

/**
 * Register hub-specific items to be shown at the top of the topbar
 * dropdown while the hub is displayed. Call `clearTopBarHubItems()`
 * to remove them when navigating away from the hub.
 */
export function setTopBarHubItems(items: HubMenuItem[]): void {
  _hubMenuItems = items ?? [];
}

/**
 * Remove all hub-specific items previously added via `setTopBarHubItems`.
 */
export function clearTopBarHubItems(): void {
  _hubMenuItems = [];
}

/**
 * Register a callback that fires when the hamburger dropdown opens or closes.
 */
export function setTopBarDropdownToggleCallback(cb: ((isOpen: boolean) => void) | null): void {
  _onDropdownToggle = cb;
}

/**
 * Set the current screen identifier so the help panel can open to the
 * relevant section by default.
 */
export function setCurrentScreen(screenId: string): void {
  setTopbarState({ currentScreen: screenId });
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function _openHelp(): void {
  const section: string = helpSectionForScreen(getTopbarState().currentScreen);
  const container: HTMLElement = _root?.parentElement || document.body;
  openHelpPanel(container, _state, section);
}

// ---------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------

function _toggleDropdown(): void {
  const existing = document.getElementById(DROPDOWN_ID);
  if (existing) {
    _closeDropdown();
  } else {
    _openDropdown();
  }
}

function _openDropdown(): void {
  _onDropdownToggle?.(true);
  const menu: HTMLDivElement = document.createElement('div');
  menu.id = DROPDOWN_ID;
  menu.setAttribute('role', 'menu');

  // Inject flight-specific items (e.g. "Return to Space Agency") when in flight.
  if (_flightMenuItems.length > 0) {
    for (const item of _flightMenuItems) {
      const btn: HTMLButtonElement = document.createElement('button');
      btn.className = 'topbar-dropdown-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      if (item.title) btn.title = item.title;
      _tracker.add(btn, 'click', (e: Event) => {
        e.stopPropagation();
        _closeDropdown();
        item.onClick();
      });
      menu.appendChild(btn);
    }
    const sep: HTMLHRElement = document.createElement('hr');
    sep.className = 'topbar-dropdown-sep';
    menu.appendChild(sep);
  }

  // Inject hub-specific items (Construction, Settings) when on the hub screen.
  if (_hubMenuItems.length > 0) {
    for (const item of _hubMenuItems) {
      const btn: HTMLButtonElement = document.createElement('button');
      btn.className = 'topbar-dropdown-item';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = item.label;
      if (item.id) btn.id = item.id;
      _tracker.add(btn, 'click', (e: Event) => {
        e.stopPropagation();
        _closeDropdown();
        item.onClick();
      });
      menu.appendChild(btn);
    }
    const sep: HTMLHRElement = document.createElement('hr');
    sep.className = 'topbar-dropdown-sep';
    menu.appendChild(sep);
  }

  const items: (DropdownItem | null)[] = [
    { label: 'Save Game',    action: _openSaveSlotPicker },
    { label: 'Load Game',    action: _doLoadGame        },
  ];

  // Sandbox Settings — only shown in sandbox mode.
  if (_state?.gameMode === GameMode.SANDBOX) {
    items.push(null); // separator
    items.push({ label: 'Sandbox Settings', action: _openSandboxSettings });
  }

  items.push(null); // separator
  items.push({ label: 'Help', action: _openHelp });
  items.push(null); // separator
  items.push({ label: 'Exit to Menu', action: _doExitToMenu, danger: true });

  for (const item of items) {
    if (item === null) {
      const sep: HTMLHRElement = document.createElement('hr');
      sep.className = 'topbar-dropdown-sep';
      menu.appendChild(sep);
      continue;
    }
    const btn: HTMLButtonElement = document.createElement('button');
    btn.className = 'topbar-dropdown-item' + (item.danger ? ' danger' : '');
    btn.setAttribute('role', 'menuitem');
    btn.textContent = item.label;
    _tracker.add(btn, 'click', (e: Event) => {
      e.stopPropagation();
      _closeDropdown();
      void item.action();
    });
    menu.appendChild(btn);
  }

  // Arrow key navigation within the dropdown.
  _tracker.add(menu, 'keydown', ((e: KeyboardEvent) => {
    const items = Array.from(menu.querySelectorAll('.topbar-dropdown-item')) as HTMLElement[];
    if (items.length === 0) return;

    const current = document.activeElement as HTMLElement;
    const idx = items.indexOf(current);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = idx < items.length - 1 ? idx + 1 : 0;
      items[next].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = idx > 0 ? idx - 1 : items.length - 1;
      items[prev].focus();
    }
  }) as EventListener);

  document.body.appendChild(menu);

  // Focus the first menu item so arrow keys work immediately.
  const firstItem = menu.querySelector('.topbar-dropdown-item') as HTMLElement | null;
  if (firstItem) firstItem.focus();
}

function _closeDropdown(): void {
  const d = document.getElementById(DROPDOWN_ID);
  if (d) {
    _onDropdownToggle?.(false);
    d.remove();
  }
}

/**
 * Keyboard handler — Escape closes dropdowns and modals.
 */
function _onDocKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;

  // Close dropdowns first (they sit above modals in visual hierarchy).
  const dropdown = document.getElementById(DROPDOWN_ID);
  if (dropdown) {
    _closeDropdown();
    document.getElementById('topbar-menu-btn')?.focus();
    return;
  }

  const mDropdown = document.getElementById(MISSIONS_DROPDOWN_ID);
  if (mDropdown) {
    _closeMissionsDropdown();
    document.getElementById('topbar-missions-btn')?.focus();
    return;
  }

  // Close any open topbar modal.
  for (const id of MODAL_BACKDROP_IDS) {
    const el = document.getElementById(id);
    if (el) {
      el.remove();
      return;
    }
  }
}

/**
 * Capture-phase document click handler — closes the dropdown when the user
 * clicks anywhere that isn't the menu button or the dropdown itself.
 */
function _onDocClick(e: Event): void {
  const dropdown = document.getElementById(DROPDOWN_ID);
  if (dropdown) {
    const btn = document.getElementById('topbar-menu-btn');
    if (!(btn && btn.contains(e.target as Node)) && !dropdown.contains(e.target as Node)) {
      _closeDropdown();
    }
  }

  const mDropdown = document.getElementById(MISSIONS_DROPDOWN_ID);
  if (mDropdown) {
    const mBtn = document.getElementById('topbar-missions-btn');
    if (!(mBtn && mBtn.contains(e.target as Node)) && !mDropdown.contains(e.target as Node)) {
      _closeMissionsDropdown();
    }
  }
}

// ---------------------------------------------------------------------------
// Missions Dropdown
// ---------------------------------------------------------------------------

function _toggleMissionsDropdown(): void {
  const existing = document.getElementById(MISSIONS_DROPDOWN_ID);
  if (existing) {
    _closeMissionsDropdown();
  } else {
    _openMissionsDropdown();
  }
}

function _openMissionsDropdown(): void {
  _closeDropdown(); // close hamburger if open
  const panel: HTMLDivElement = document.createElement('div');
  panel.id = MISSIONS_DROPDOWN_ID;
  _buildMissionsContent(panel);

  // Position below the missions button
  const btn = document.getElementById('topbar-missions-btn');
  if (btn) {
    const rect: DOMRect = btn.getBoundingClientRect();
    panel.style.right = 'auto';
    panel.style.left = rect.left + 'px';
    panel.style.transform = 'none';
  }

  document.body.appendChild(panel);
}

function _closeMissionsDropdown(): void {
  const d = document.getElementById(MISSIONS_DROPDOWN_ID);
  if (d) d.remove();
}

function _buildMissionsContent(container: HTMLElement): void {
  container.innerHTML = '';
  if (!_state) return;
  const accepted = _state.missions?.accepted ?? [];
  if (accepted.length === 0) {
    const empty: HTMLDivElement = document.createElement('div');
    empty.className = 'topbar-missions-empty';
    empty.textContent = 'No missions accepted.';
    container.appendChild(empty);
    return;
  }
  for (const m of accepted) {
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'topbar-mission-card';

    const title: HTMLDivElement = document.createElement('div');
    title.className = 'topbar-mission-title';
    title.textContent = m.title;
    card.appendChild(title);

    const reward: HTMLDivElement = document.createElement('div');
    reward.className = 'topbar-mission-reward';
    reward.textContent = 'Reward: ' + formatCash(m.reward);
    card.appendChild(reward);

    if (Array.isArray(m.unlockedParts) && m.unlockedParts.length > 0) {
      const parts: HTMLDivElement = document.createElement('div');
      parts.className = 'topbar-mission-reward-parts';
      parts.textContent = 'Unlocks: ' + m.unlockedParts
        .map((id: string) => getPartById(id)?.name ?? id)
        .join(', ');
      card.appendChild(parts);
    }

    const desc: HTMLDivElement = document.createElement('div');
    desc.className = 'topbar-mission-desc';
    desc.textContent = m.description;
    card.appendChild(desc);

    // Objectives
    if (Array.isArray(m.objectives) && m.objectives.length > 0) {
      const objLabel: HTMLDivElement = document.createElement('div');
      objLabel.className = 'topbar-mission-obj-label';
      objLabel.textContent = 'Objectives';
      card.appendChild(objLabel);

      const objList: HTMLUListElement = document.createElement('ul');
      objList.className = 'topbar-mission-obj-list';

      for (const obj of m.objectives) {
        const item: HTMLLIElement = document.createElement('li');
        item.className = 'topbar-mission-obj-item';

        const indicator: HTMLSpanElement = document.createElement('span');
        indicator.className = `topbar-mission-obj-indicator ${obj.completed ? 'completed' : 'pending'}`;
        indicator.textContent = obj.completed ? '\u2713' : '\u25CB';
        item.appendChild(indicator);

        const text: HTMLSpanElement = document.createElement('span');
        text.className = `topbar-mission-obj-text ${obj.completed ? 'completed' : 'pending'}`;
        text.textContent = obj.description;
        item.appendChild(text);

        objList.appendChild(item);
      }

      card.appendChild(objList);
    }

    container.appendChild(card);
  }
}

/**
 * Update the missions button label (with count) and refresh dropdown if open.
 */
function _refreshMissionsBtn(): void {
  const btn = document.getElementById('topbar-missions-btn');
  if (!btn || !_state) return;
  const count: number = _state.missions?.accepted?.length ?? 0;
  const badge = formatMissionsBadge(count);
  btn.textContent = badge.label;
  btn.classList.toggle('has-missions', badge.hasMissions);

  // If the dropdown is open, refresh its content
  const dropdown = document.getElementById(MISSIONS_DROPDOWN_ID);
  if (dropdown) _buildMissionsContent(dropdown);
}

/**
 * Refresh the missions button and dropdown from the current game state.
 * Call after accepting/completing missions.
 */
export function refreshTopBarMissions(): void {
  _refreshMissionsBtn();
}

// ---------------------------------------------------------------------------
// Loan Modal
// ---------------------------------------------------------------------------

function _openLoanModal(): void {
  if (!_state) return;
  _closeAllModals();

  const backdrop: HTMLDivElement = _makeBackdrop('loan-modal-backdrop');

  const modal: HTMLDivElement = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Loan Details');
  _tracker.add(modal, 'click', (e: Event) => e.stopPropagation());

  // Title row
  modal.appendChild(_makeTitleRow('Loan Details', () => backdrop.remove()));

  // Stats section — given an id so pay/borrow can refresh it in-place
  const stats: HTMLDivElement = _buildLoanStats();
  modal.appendChild(stats);

  // Pay Down section
  modal.appendChild(_buildPaySection());

  // Borrow More section
  modal.appendChild(_buildBorrowSection());

  _tracker.add(backdrop, 'click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

/**
 * Build the read-only stats rows for the loan modal.
 * The container is given id="loan-stats-container" so it can be swapped out
 * after a pay-down or borrow operation.
 */
function _buildLoanStats(): HTMLDivElement {
  const s = _state!;
  const container: HTMLDivElement = document.createElement('div');
  container.id = 'loan-stats-container';

  const interestNext: number = s.loan.balance * s.loan.interestRate;
  const totalAccrued: number = s.loan.totalInterestAccrued ?? 0;

  const rows: Array<{ label: string; value: string; negative: boolean }> = [
    { label: 'Outstanding balance',      value: formatCash(s.loan.balance),      negative: s.loan.balance > 0  },
    { label: 'Interest rate',            value: formatRate(s.loan.interestRate) + ' per mission', negative: false },
    { label: 'Interest on next mission', value: formatCash(interestNext),         negative: interestNext > 0    },
    { label: 'Total interest accrued',   value: formatCash(totalAccrued),         negative: false               },
  ];

  for (const { label, value, negative } of rows) {
    const row: HTMLDivElement = document.createElement('div');
    row.className = 'loan-stat-row';

    const lbl: HTMLSpanElement = document.createElement('span');
    lbl.className = 'loan-stat-label';
    lbl.textContent = label;

    const val: HTMLSpanElement = document.createElement('span');
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
function _refreshLoanStats(): void {
  const old = document.getElementById('loan-stats-container');
  if (!old || !_state) return;
  old.replaceWith(_buildLoanStats());
}

/**
 * Build the "Pay Down Loan" action section.
 */
function _buildPaySection(): HTMLDivElement {
  const section: HTMLDivElement = document.createElement('div');
  section.className = 'loan-action';

  const lbl: HTMLSpanElement = document.createElement('span');
  lbl.className = 'loan-action-label';
  lbl.textContent = 'Pay Down Loan';

  const hint: HTMLDivElement = document.createElement('div');
  hint.className = 'loan-action-hint';
  hint.id = 'pay-hint';
  hint.textContent = `Available cash: ${formatCash(_state?.money ?? 0)}`;

  const row: HTMLDivElement = document.createElement('div');
  row.className = 'loan-action-row';

  const input: HTMLInputElement = document.createElement('input');
  input.className = 'loan-action-input';
  input.type = 'number';
  input.min = '1';
  input.step = '10000';
  input.placeholder = 'Amount ($)';
  input.dataset.testid = 'loan-pay-input';

  const btn: HTMLButtonElement = document.createElement('button');
  btn.className = 'loan-action-btn loan-pay-btn';
  btn.textContent = 'Pay Down';
  btn.dataset.testid = 'loan-pay-btn';

  const feedback: HTMLDivElement = document.createElement('div');
  feedback.className = 'loan-feedback';
  feedback.id = 'pay-feedback';

  _tracker.add(btn, 'click', () => {
    const amount: number = parseFloat(input.value);
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
      feedback.textContent = `Insufficient funds — you have ${formatCash(_state.money)}.`;
      return;
    }

    const { paid, newBalance } = payDownLoan(_state, amount);
    refreshTopBar();
    _refreshLoanStats();

    const hint = document.getElementById('pay-hint');
    if (hint) hint.textContent = `Available cash: ${formatCash(_state.money)}`;

    if (paid < amount) {
      feedback.textContent = `Paid ${formatCash(paid)}. Loan fully cleared!`;
    } else if (newBalance <= 0) {
      feedback.textContent = `Paid ${formatCash(paid)}. Loan fully cleared!`;
    } else {
      feedback.textContent = `Paid ${formatCash(paid)}. Remaining balance: ${formatCash(newBalance)}.`;
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
 */
function _buildBorrowSection(): HTMLDivElement {
  const section: HTMLDivElement = document.createElement('div');
  section.className = 'loan-action';

  const lbl: HTMLSpanElement = document.createElement('span');
  lbl.className = 'loan-action-label';
  lbl.textContent = 'Borrow More';

  const headroom: number = Math.max(0, MAX_LOAN_BALANCE - (_state?.loan.balance ?? 0));

  const hint: HTMLDivElement = document.createElement('div');
  hint.className = 'loan-action-hint';
  hint.id = 'borrow-hint';
  hint.textContent = `Max additional: ${formatCash(headroom)}  (limit ${formatCash(MAX_LOAN_BALANCE)})`;

  const row: HTMLDivElement = document.createElement('div');
  row.className = 'loan-action-row';

  const input: HTMLInputElement = document.createElement('input');
  input.className = 'loan-action-input';
  input.type = 'number';
  input.min = '1';
  input.step = '100000';
  input.placeholder = 'Amount ($)';
  input.dataset.testid = 'loan-borrow-input';

  const btn: HTMLButtonElement = document.createElement('button');
  btn.className = 'loan-action-btn loan-borrow-btn';
  btn.textContent = 'Borrow';
  btn.dataset.testid = 'loan-borrow-btn';
  if (headroom <= 0) btn.disabled = true;

  const feedback: HTMLDivElement = document.createElement('div');
  feedback.className = 'loan-feedback';
  feedback.id = 'borrow-feedback';

  _tracker.add(btn, 'click', () => {
    const amount: number = parseFloat(input.value);
    if (!_state) return;

    if (!amount || amount <= 0) {
      feedback.textContent = 'Enter a positive amount.';
      return;
    }

    const currentHeadroom: number = Math.max(0, MAX_LOAN_BALANCE - _state.loan.balance);
    if (currentHeadroom <= 0) {
      feedback.textContent = 'Maximum loan limit reached.';
      btn.disabled = true;
      return;
    }

    const { borrowed, newBalance } = borrowMore(_state, amount);
    refreshTopBar();
    _refreshLoanStats();

    const newHeadroom: number = Math.max(0, MAX_LOAN_BALANCE - _state.loan.balance);
    const h = document.getElementById('borrow-hint');
    if (h) h.textContent = `Max additional: ${formatCash(newHeadroom)}  (limit ${formatCash(MAX_LOAN_BALANCE)})`;
    if (newHeadroom <= 0) btn.disabled = true;

    if (borrowed < amount) {
      feedback.textContent = `Borrowed ${formatCash(borrowed)} (limit reached). Balance: ${formatCash(newBalance)}.`;
    } else {
      feedback.textContent = `Borrowed ${formatCash(borrowed)}. Balance: ${formatCash(newBalance)}.`;
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

async function _openSaveSlotPicker(): Promise<void> {
  if (!_state) return;
  _closeAllModals();

  const backdrop: HTMLDivElement = _makeBackdrop('save-modal-backdrop');

  const modal: HTMLDivElement = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Save Game');
  _tracker.add(modal, 'click', (e: Event) => e.stopPropagation());

  modal.appendChild(_makeTitleRow('Save Game', () => backdrop.remove()));

  const saves = await listSaves();

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const slot = saves[i];
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'save-slot-card';
    card.dataset.testid = `save-slot-${i}`;

    const info: HTMLDivElement = document.createElement('div');
    info.className = 'save-slot-info';

    if (slot) {
      const name: HTMLElement = document.createElement('strong');
      name.textContent = slot.saveName || `Slot ${i + 1}`;

      const detail: HTMLSpanElement = document.createElement('span');
      const ts: string = new Date(slot.timestamp).toLocaleString();
      detail.textContent = `${slot.agencyName} \u00B7 ${ts}`;

      info.appendChild(name);
      info.appendChild(detail);

      if (!isSaveCompatible(slot.version, SAVE_VERSION)) {
        const versionWarn: HTMLSpanElement = document.createElement('span');
        versionWarn.className = 'save-version-warning';
        versionWarn.dataset.testid = 'version-warning';
        versionWarn.textContent = `v${slot.version} (current: v${SAVE_VERSION})`;
        info.appendChild(versionWarn);
      }
    } else {
      const name: HTMLElement = document.createElement('strong');
      name.textContent = `Slot ${i + 1}`;

      const detail: HTMLSpanElement = document.createElement('span');
      detail.className = 'empty-slot';
      detail.textContent = 'Empty';

      info.appendChild(name);
      info.appendChild(detail);
    }

    const tag: HTMLSpanElement = document.createElement('span');
    tag.className = 'save-slot-action-tag';
    tag.textContent = slot ? 'Overwrite' : 'Save here';

    card.appendChild(info);
    card.appendChild(tag);

    // Capture slot index in closure
    const slotIndex: number = i;
    _tracker.add(card, 'click', () => {
      const saveName: string = _state!.agencyName || 'New Save';
      void import('./vab.ts').then(({ syncVabToGameState }) => {
        syncVabToGameState();
        void saveGame(_state!, slotIndex, saveName).then(() => {
          backdrop.remove();
        });
      });
    });

    modal.appendChild(card);
  }

  _tracker.add(backdrop, 'click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

// ---------------------------------------------------------------------------
// Load Game — modal overlay with save slots
// ---------------------------------------------------------------------------

async function _doLoadGame(): Promise<void> {
  _closeAllModals();

  const backdrop: HTMLDivElement = _makeBackdrop('load-modal-backdrop');

  const modal: HTMLDivElement = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Load Game');
  _tracker.add(modal, 'click', (e: Event) => e.stopPropagation());

  modal.appendChild(_makeTitleRow('Load Game', () => backdrop.remove()));

  const saves = await listSaves();
  let hasAnySave: boolean = false;

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const slot = saves[i];
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'save-slot-card';
    card.dataset.testid = `load-slot-${i}`;

    const info: HTMLDivElement = document.createElement('div');
    info.className = 'save-slot-info';

    if (slot) {
      hasAnySave = true;
      const isIncompatible: boolean = !isSaveCompatible(slot.version, SAVE_VERSION);
      const name: HTMLElement = document.createElement('strong');
      name.textContent = (slot.saveName || `Slot ${i + 1}`) + (isIncompatible ? ' (Incompatible)' : '');

      const detail: HTMLSpanElement = document.createElement('span');
      const ts: string = new Date(slot.timestamp).toLocaleString();
      detail.textContent = `${slot.agencyName} \u00B7 ${ts}`;

      info.appendChild(name);
      info.appendChild(detail);

      if (isIncompatible) {
        card.classList.add('save-slot-incompatible');
        const versionWarn: HTMLSpanElement = document.createElement('span');
        versionWarn.className = 'save-version-warning';
        versionWarn.dataset.testid = 'version-warning';
        versionWarn.textContent = `v${slot.version} (current: v${SAVE_VERSION})`;
        info.appendChild(versionWarn);
      }
    } else {
      const name: HTMLElement = document.createElement('strong');
      name.textContent = `Slot ${i + 1}`;

      const detail: HTMLSpanElement = document.createElement('span');
      detail.className = 'empty-slot';
      detail.textContent = 'Empty';

      info.appendChild(name);
      info.appendChild(detail);
    }

    const tag: HTMLSpanElement = document.createElement('span');
    tag.className = 'save-slot-action-tag';
    if (slot && isSaveCompatible(slot.version, SAVE_VERSION)) {
      tag.textContent = 'Load';
      tag.classList.add('load-action');
    } else if (slot) {
      tag.textContent = 'Incompatible';
      tag.style.opacity = '0.4';
    } else {
      tag.textContent = '\u2014';
      tag.style.opacity = '0.3';
    }

    card.appendChild(info);
    card.appendChild(tag);

    if (slot && isSaveCompatible(slot.version, SAVE_VERSION)) {
      const slotIndex: number = i;
      card.style.cursor = 'pointer';
      _tracker.add(card, 'click', () => {
        _confirmAndLoad(slotIndex, backdrop);
      });
    } else if (!slot) {
      card.style.opacity = '0.5';
      card.style.cursor = 'default';
    }
    // incompatible slots: cursor/opacity handled by .save-slot-incompatible CSS

    modal.appendChild(card);
  }

  if (!hasAnySave) {
    const empty: HTMLParagraphElement = document.createElement('p');
    empty.className = 'topbar-empty-msg';
    empty.textContent = 'No saved games found.';
    modal.appendChild(empty);
  }

  _tracker.add(backdrop, 'click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

/**
 * Show a confirmation dialog, then load the save and reinitialize the game.
 */
function _confirmAndLoad(slotIndex: number, loadBackdrop: HTMLElement): void {
  loadBackdrop.remove();

  const backdrop: HTMLDivElement = _makeBackdrop('load-confirm-backdrop');
  const modal: HTMLDivElement = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  _tracker.add(modal, 'click', (e: Event) => e.stopPropagation());

  modal.appendChild(_makeTitleRow('Load Game', () => backdrop.remove()));

  const msg: HTMLParagraphElement = document.createElement('p');
  msg.className = 'confirm-msg';
  msg.textContent = 'Any unsaved progress will be lost. Are you sure you want to load this save?';
  modal.appendChild(msg);

  const btnRow: HTMLDivElement = document.createElement('div');
  btnRow.className = 'confirm-btn-row';

  const cancelBtn: HTMLButtonElement = document.createElement('button');
  cancelBtn.className = 'confirm-btn confirm-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  _tracker.add(cancelBtn, 'click', () => backdrop.remove());

  const confirmBtn: HTMLButtonElement = document.createElement('button');
  confirmBtn.className = 'confirm-btn confirm-btn-primary';
  confirmBtn.dataset.testid = 'load-confirm-btn';
  confirmBtn.textContent = 'Load Game';
  _tracker.add(confirmBtn, 'click', () => {
    backdrop.remove();
    void loadGame(slotIndex).then((loadedState) => {
      reconcileParts(loadedState);
      if (_onLoadGame) {
        _onLoadGame(loadedState);
      }
    }).catch((err: unknown) => {
      logger.error('topbar', 'Load failed', { error: String(err) });
      _showLoadErrorToast('This save was created with an older version and is not compatible.');
    });
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  modal.appendChild(btnRow);

  _tracker.add(backdrop, 'click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

// ---------------------------------------------------------------------------
// Load error toast
// ---------------------------------------------------------------------------

/**
 * Show a brief error toast when a save load fails.
 */
function _showLoadErrorToast(msg: string): void {
  const toast: HTMLDivElement = document.createElement('div');
  toast.className = 'topbar-load-error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  setTimeout(() => { toast.remove(); }, 3500);
}

// ---------------------------------------------------------------------------
// Exit to Menu — confirmation dialog
// ---------------------------------------------------------------------------

/**
 * Opens the sandbox settings modal (malfunctions/weather toggles).
 */
function _openSandboxSettings(): void {
  _closeAllModals();
  if (!_state || _state.gameMode !== GameMode.SANDBOX) return;

  const backdrop: HTMLDivElement = _makeBackdrop('sandbox-settings-backdrop');
  const modal: HTMLDivElement = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Sandbox Settings');
  _tracker.add(modal, 'click', (e: Event) => e.stopPropagation());

  modal.appendChild(_makeTitleRow('Sandbox Settings', () => backdrop.remove()));

  const settings = _state.sandboxSettings || { malfunctionsEnabled: false, weatherEnabled: false };

  const form: HTMLDivElement = document.createElement('div');
  form.className = 'topbar-settings-form';

  // Malfunctions toggle
  const malfLabel: HTMLLabelElement = document.createElement('label');
  malfLabel.className = 'topbar-toggle-label';
  const malfCheck: HTMLInputElement = document.createElement('input');
  malfCheck.type = 'checkbox';
  malfCheck.checked = settings.malfunctionsEnabled;
  malfCheck.className = 'topbar-checkbox';
  _tracker.add(malfCheck, 'change', () => {
    if (_state?.sandboxSettings) _state.sandboxSettings.malfunctionsEnabled = malfCheck.checked;
  });
  malfLabel.appendChild(malfCheck);
  malfLabel.appendChild(document.createTextNode('Enable malfunctions'));
  form.appendChild(malfLabel);

  // Weather toggle
  const wxLabel: HTMLLabelElement = document.createElement('label');
  wxLabel.className = 'topbar-toggle-label';
  const wxCheck: HTMLInputElement = document.createElement('input');
  wxCheck.type = 'checkbox';
  wxCheck.checked = settings.weatherEnabled;
  wxCheck.className = 'topbar-checkbox';
  _tracker.add(wxCheck, 'change', () => {
    if (_state?.sandboxSettings) _state.sandboxSettings.weatherEnabled = wxCheck.checked;
  });
  wxLabel.appendChild(wxCheck);
  wxLabel.appendChild(document.createTextNode('Enable weather effects'));
  form.appendChild(wxLabel);

  modal.appendChild(form);

  const closeBtn: HTMLButtonElement = document.createElement('button');
  closeBtn.className = 'confirm-btn confirm-btn-cancel';
  closeBtn.textContent = 'Close';
  closeBtn.style.marginTop = '8px';
  _tracker.add(closeBtn, 'click', () => backdrop.remove());
  modal.appendChild(closeBtn);

  _tracker.add(backdrop, 'click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

function _doExitToMenu(): void {
  _closeAllModals();

  const backdrop: HTMLDivElement = _makeBackdrop('exit-confirm-backdrop');

  const modal: HTMLDivElement = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Exit to Menu');
  _tracker.add(modal, 'click', (e: Event) => e.stopPropagation());

  modal.appendChild(_makeTitleRow('Exit to Menu', () => backdrop.remove()));

  const msg: HTMLParagraphElement = document.createElement('p');
  msg.className = 'confirm-msg';
  msg.textContent =
    'Any unsaved progress will be lost. Are you sure you want to return to the main menu?';
  modal.appendChild(msg);

  const btnRow: HTMLDivElement = document.createElement('div');
  btnRow.className = 'confirm-btn-row';

  const cancelBtn: HTMLButtonElement = document.createElement('button');
  cancelBtn.className = 'confirm-btn confirm-btn-cancel';
  cancelBtn.textContent = 'Stay';
  _tracker.add(cancelBtn, 'click', () => backdrop.remove());

  const confirmBtn: HTMLButtonElement = document.createElement('button');
  confirmBtn.className = 'confirm-btn confirm-btn-danger';
  confirmBtn.textContent = 'Exit to Menu';
  confirmBtn.dataset.testid = 'exit-confirm-btn';
  _tracker.add(confirmBtn, 'click', () => {
    backdrop.remove();
    if (_onExitToMenu) _onExitToMenu();
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  modal.appendChild(btnRow);

  _tracker.add(backdrop, 'click', () => backdrop.remove());
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}

// ---------------------------------------------------------------------------
// Shared modal helpers
// ---------------------------------------------------------------------------

/**
 * Create a backdrop div with the given id and the shared class.
 */
function _makeBackdrop(id: string): HTMLDivElement {
  const el: HTMLDivElement = document.createElement('div');
  el.id = id;
  el.className = 'topbar-modal-backdrop';
  return el;
}

/**
 * Create a modal title row with a close button.
 */
function _makeTitleRow(title: string, onClose: () => void): HTMLDivElement {
  const row: HTMLDivElement = document.createElement('div');
  row.className = 'topbar-modal-title-row';

  const h2: HTMLHeadingElement = document.createElement('h2');
  h2.className = 'topbar-modal-title';
  h2.textContent = title;

  const closeBtn: HTMLButtonElement = document.createElement('button');
  closeBtn.className = 'topbar-modal-close';
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Close';
  _tracker.add(closeBtn, 'click', onClose);

  row.appendChild(h2);
  row.appendChild(closeBtn);
  return row;
}

/**
 * Remove all open topbar modals from the DOM.
 */
function _closeAllModals(): void {
  for (const id of MODAL_BACKDROP_IDS) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }
}
