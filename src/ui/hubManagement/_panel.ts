/**
 * _panel.ts — Hub management panel orchestration.
 *
 * Holds module state, show/hide logic, and the panel refresh cycle.
 * Sub-modules (_header, _sections, _dialogs) import shared state accessors
 * and helpers from here.
 *
 * @module ui/hubManagement/_panel
 */

import type { GameState } from '../../core/gameState.ts';
import type { HubManagementInfo } from '../../core/hubTypes.ts';
import { getHubManagementInfo } from '../../core/hubs.ts';
import { buildHeader, buildNameError } from './_header.ts';
import {
  buildInfoGrid,
  buildFacilitiesSection,
  buildPopulationSection,
  buildEconomySection,
} from './_sections.ts';
import { showReactivateConfirmation, showAbandonConfirmation } from './_dialogs.ts';
import { createListenerTracker, type ListenerTracker } from '../listenerTracker.ts';
import '../hubManagement.css';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _backdrop: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _hubId: string | null = null;
let _listeners: ListenerTracker | null = null;

// ---------------------------------------------------------------------------
// State accessors (for sub-modules)
// ---------------------------------------------------------------------------

export function getPanelState(): GameState | null { return _state; }
export function getHubId(): string | null { return _hubId; }
export function getBackdrop(): HTMLDivElement | null { return _backdrop; }
export function getPanelListeners(): ListenerTracker | null { return _listeners; }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shows the hub management panel for the given hub.
 * If a panel is already open it is closed first.
 */
export function showHubManagementPanel(state: GameState, hubId: string): void {
  hideHubManagementPanel();

  _state = state;
  _hubId = hubId;
  _listeners = createListenerTracker();

  const info = getHubManagementInfo(state, hubId);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'hub-mgmt-backdrop';
  backdrop.className = 'hub-mgmt-backdrop';
  _listeners.add(backdrop, 'click', () => hideHubManagementPanel());

  // Panel
  const panel = document.createElement('div');
  panel.className = 'hub-mgmt-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Hub Management');
  _listeners.add(panel, 'click', (e: Event) => (e as MouseEvent).stopPropagation());

  panel.appendChild(buildHeader(info));
  panel.appendChild(buildNameError());
  panel.appendChild(buildInfoGrid(info));
  panel.appendChild(buildFacilitiesSection(info));
  panel.appendChild(buildPopulationSection(info));
  panel.appendChild(buildEconomySection(info));
  panel.appendChild(_buildActions(info));

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  _backdrop = backdrop;

  // Keyboard: Escape closes
  _listeners.add(backdrop, 'keydown', _onKeydown as EventListener);
  // Focus the name input
  const nameInput = panel.querySelector<HTMLInputElement>('.hub-mgmt-name-input');
  if (nameInput) nameInput.focus();
}

/**
 * Hides the hub management panel and cleans up references.
 */
export function hideHubManagementPanel(): void {
  if (_listeners) {
    _listeners.removeAll();
    _listeners = null;
  }
  if (_backdrop) {
    _backdrop.remove();
    _backdrop = null;
  }
  _state = null;
  _hubId = null;
}

// ---------------------------------------------------------------------------
// Keyboard handler
// ---------------------------------------------------------------------------

function _onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    hideHubManagementPanel();
  }
}

// ---------------------------------------------------------------------------
// Actions row
// ---------------------------------------------------------------------------

function _buildActions(info: HubManagementInfo): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'hub-mgmt-actions';

  if (info.canReactivate) {
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = 'Reactivate';
    btn.title = 'Pay one period of maintenance to bring this hub back online';
    _listeners?.add(btn, 'click', () => {
      showReactivateConfirmation(info);
    });
    row.appendChild(btn);
  }

  if (info.canAbandon) {
    const btn = document.createElement('button');
    btn.className = 'btn-danger';
    btn.textContent = 'Abandon';
    btn.title = 'Permanently abandon this hub';
    _listeners?.add(btn, 'click', () => {
      showAbandonConfirmation();
    });
    row.appendChild(btn);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Panel refresh (after reactivation etc.)
// ---------------------------------------------------------------------------

export function refreshPanel(): void {
  if (!_state || !_hubId) return;
  showHubManagementPanel(_state, _hubId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatMoney(amount: number): string {
  if (amount === 0) return '$0';
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}k`;
  }
  return `$${amount.toLocaleString()}`;
}
