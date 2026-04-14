/**
 * hubManagement.ts — Hub management modal panel.
 *
 * Shows detailed hub info (name, body, status, facilities, crew, economy)
 * with actions for renaming, reactivation, and abandonment.
 *
 * @module ui/hubManagement
 */

import type { GameState } from '../core/gameState.ts';
import type { HubManagementInfo } from '../core/hubTypes.ts';
import {
  getHubManagementInfo,
  renameHub,
  reactivateHub,
  abandonHub,
} from '../core/hubs.ts';
import './hubManagement.css';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _backdrop: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _hubId: string | null = null;

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

  const info = getHubManagementInfo(state, hubId);

  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.id = 'hub-mgmt-backdrop';
  backdrop.className = 'hub-mgmt-backdrop';
  backdrop.addEventListener('click', () => hideHubManagementPanel());

  // Panel
  const panel = document.createElement('div');
  panel.className = 'hub-mgmt-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Hub Management');
  panel.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

  panel.appendChild(_buildHeader(info));
  panel.appendChild(_buildNameError());
  panel.appendChild(_buildInfoGrid(info));
  panel.appendChild(_buildFacilitiesSection(info));
  panel.appendChild(_buildPopulationSection(info));
  panel.appendChild(_buildEconomySection(info));
  panel.appendChild(_buildActions(info));

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  _backdrop = backdrop;

  // Keyboard: Escape closes
  backdrop.addEventListener('keydown', _onKeydown);
  // Focus the name input
  const nameInput = panel.querySelector<HTMLInputElement>('.hub-mgmt-name-input');
  if (nameInput) nameInput.focus();
}

/**
 * Hides the hub management panel and cleans up references.
 */
export function hideHubManagementPanel(): void {
  if (_backdrop) {
    _backdrop.removeEventListener('keydown', _onKeydown);
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
// Header — editable name + close button
// ---------------------------------------------------------------------------

function _buildHeader(info: HubManagementInfo): HTMLDivElement {
  const header = document.createElement('div');
  header.className = 'hub-mgmt-header';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'hub-mgmt-name-input';
  nameInput.value = info.name;
  nameInput.maxLength = 40;
  nameInput.setAttribute('aria-label', 'Hub name');

  if (!info.canRename) {
    nameInput.readOnly = true;
  } else {
    let originalName = info.name;

    const commitRename = (): void => {
      if (!_state || !_hubId) return;
      const trimmed = nameInput.value.trim();
      if (trimmed === originalName) return;

      const result = renameHub(_state, _hubId, trimmed);
      const errorEl = _backdrop?.querySelector<HTMLDivElement>('.hub-mgmt-name-error');
      if (!result.success) {
        if (errorEl) errorEl.textContent = result.error ?? 'Rename failed';
        nameInput.value = originalName;
      } else {
        if (errorEl) errorEl.textContent = '';
        originalName = trimmed;
      }
    };

    nameInput.addEventListener('blur', commitRename);
    nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      } else if (e.key === 'Escape') {
        nameInput.value = originalName;
        const errorEl = _backdrop?.querySelector<HTMLDivElement>('.hub-mgmt-name-error');
        if (errorEl) errorEl.textContent = '';
        nameInput.blur();
        e.stopPropagation(); // Prevent panel close on Escape while editing
      }
    });
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'hub-mgmt-close';
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close hub management panel');
  closeBtn.addEventListener('click', () => hideHubManagementPanel());

  header.appendChild(nameInput);
  header.appendChild(closeBtn);
  return header;
}

// ---------------------------------------------------------------------------
// Name validation error
// ---------------------------------------------------------------------------

function _buildNameError(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'hub-mgmt-name-error';
  el.setAttribute('role', 'alert');
  return el;
}

// ---------------------------------------------------------------------------
// Info grid — body, type, status, established
// ---------------------------------------------------------------------------

function _buildInfoGrid(info: HubManagementInfo): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'hub-mgmt-info-grid';

  _addGridRow(grid, 'Body', info.bodyName);
  _addGridRow(grid, 'Type', info.type === 'surface' ? 'Surface' : 'Orbital');

  // Status badge
  const statusLabel = document.createElement('span');
  statusLabel.className = 'hub-mgmt-info-label';
  statusLabel.textContent = 'Status';

  const statusBadge = document.createElement('span');
  const statusInfo = _getStatusInfo(info);
  statusBadge.className = `hub-mgmt-status ${statusInfo.className}`;
  statusBadge.textContent = statusInfo.label;

  grid.appendChild(statusLabel);
  grid.appendChild(statusBadge);

  _addGridRow(grid, 'Established', `Period ${info.established}`);

  return grid;
}

function _getStatusInfo(info: HubManagementInfo): { label: string; className: string } {
  if (info.online) {
    return { label: 'Online', className: 'hub-mgmt-status--online' };
  }
  // Check for in-progress construction (facilities under construction)
  const hasBuilding = info.facilities.some(f => f.underConstruction);
  if (hasBuilding) {
    return { label: 'Building', className: 'hub-mgmt-status--building' };
  }
  return { label: 'Offline', className: 'hub-mgmt-status--offline' };
}

function _addGridRow(grid: HTMLDivElement, label: string, value: string): void {
  const labelEl = document.createElement('span');
  labelEl.className = 'hub-mgmt-info-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'hub-mgmt-info-value';
  valueEl.textContent = value;

  grid.appendChild(labelEl);
  grid.appendChild(valueEl);
}

// ---------------------------------------------------------------------------
// Facilities section
// ---------------------------------------------------------------------------

function _buildFacilitiesSection(info: HubManagementInfo): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'hub-mgmt-section';

  const title = document.createElement('div');
  title.className = 'hub-mgmt-section-title';
  title.textContent = 'Facilities';
  section.appendChild(title);

  if (info.facilities.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hub-mgmt-empty';
    empty.textContent = 'No facilities built yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'hub-mgmt-facility-list';

  for (const facility of info.facilities) {
    const li = document.createElement('li');
    li.className = 'hub-mgmt-facility-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = facility.name;

    const tierBadge = document.createElement('span');
    tierBadge.className = 'hub-mgmt-tier-badge';
    tierBadge.textContent = `T${facility.tier}`;

    li.appendChild(nameSpan);
    li.appendChild(tierBadge);

    if (facility.underConstruction) {
      const tag = document.createElement('span');
      tag.className = 'hub-mgmt-building-tag';
      tag.textContent = '(Building)';
      li.appendChild(tag);
    }

    list.appendChild(li);
  }

  section.appendChild(list);
  return section;
}

// ---------------------------------------------------------------------------
// Population section
// ---------------------------------------------------------------------------

function _buildPopulationSection(info: HubManagementInfo): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'hub-mgmt-section';

  const title = document.createElement('div');
  title.className = 'hub-mgmt-section-title';
  title.textContent = 'Population';
  section.appendChild(title);

  const crewLine = document.createElement('div');
  crewLine.className = 'hub-mgmt-population';
  crewLine.textContent = `Crew: ${info.crewCount}`;
  section.appendChild(crewLine);

  if (info.crewCount > 0 && info.crewCount < 10) {
    const namesLine = document.createElement('div');
    namesLine.className = 'hub-mgmt-crew-names';
    namesLine.textContent = info.crewNames.join(', ');
    section.appendChild(namesLine);
  }

  const touristLine = document.createElement('div');
  touristLine.className = 'hub-mgmt-population';
  touristLine.style.marginTop = '4px';
  touristLine.textContent = `Tourists: ${info.touristCount}`;
  section.appendChild(touristLine);

  return section;
}

// ---------------------------------------------------------------------------
// Economy section
// ---------------------------------------------------------------------------

function _buildEconomySection(info: HubManagementInfo): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'hub-mgmt-section';

  const title = document.createElement('div');
  title.className = 'hub-mgmt-section-title';
  title.textContent = 'Economy';
  section.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'hub-mgmt-economy-grid';

  const maintLabel = document.createElement('span');
  maintLabel.className = 'hub-mgmt-economy-label';
  maintLabel.textContent = 'Maintenance / period';

  const maintValue = document.createElement('span');
  maintValue.className = 'hub-mgmt-economy-value';
  maintValue.textContent = _formatMoney(info.maintenanceCostPerPeriod);

  const investLabel = document.createElement('span');
  investLabel.className = 'hub-mgmt-economy-label';
  investLabel.textContent = 'Total investment';

  const investValue = document.createElement('span');
  investValue.className = 'hub-mgmt-economy-value';
  investValue.textContent = _formatMoney(info.totalInvestment);

  grid.appendChild(maintLabel);
  grid.appendChild(maintValue);
  grid.appendChild(investLabel);
  grid.appendChild(investValue);
  section.appendChild(grid);

  return section;
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
    btn.addEventListener('click', () => {
      if (!_state || !_hubId) return;
      const success = reactivateHub(_state, _hubId);
      if (success) {
        _refreshPanel();
      }
    });
    row.appendChild(btn);
  }

  if (info.canAbandon) {
    const btn = document.createElement('button');
    btn.className = 'btn-danger';
    btn.textContent = 'Abandon';
    btn.title = 'Permanently abandon this hub';
    btn.addEventListener('click', () => {
      _showAbandonConfirmation();
    });
    row.appendChild(btn);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Abandon confirmation dialog
// ---------------------------------------------------------------------------

function _showAbandonConfirmation(): void {
  if (!_backdrop) return;

  const panel = _backdrop.querySelector<HTMLDivElement>('.hub-mgmt-panel');
  if (!panel) return;

  // Remove any existing confirmation overlay
  const existing = panel.querySelector('.hub-mgmt-confirm-overlay');
  if (existing) existing.remove();

  // Make the panel position relative for the overlay
  panel.style.position = 'relative';

  const overlay = document.createElement('div');
  overlay.className = 'hub-mgmt-confirm-overlay';
  overlay.addEventListener('click', (e: MouseEvent) => e.stopPropagation());

  const box = document.createElement('div');
  box.className = 'hub-mgmt-confirm-box';

  const title = document.createElement('div');
  title.className = 'hub-mgmt-confirm-title';
  title.textContent = 'Abandon Hub?';

  const msg = document.createElement('div');
  msg.className = 'hub-mgmt-confirm-msg';
  msg.textContent = 'This action is permanent. All crew will be evacuated to Earth. Routes using this hub will break.';

  const buttons = document.createElement('div');
  buttons.className = 'hub-mgmt-confirm-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-danger';
  confirmBtn.textContent = 'Abandon';
  confirmBtn.addEventListener('click', () => {
    if (!_state || !_hubId) return;
    const result = abandonHub(_state, _hubId);
    if (result.success) {
      hideHubManagementPanel();
    }
  });

  buttons.appendChild(cancelBtn);
  buttons.appendChild(confirmBtn);
  box.appendChild(title);
  box.appendChild(msg);
  box.appendChild(buttons);
  overlay.appendChild(box);
  panel.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Panel refresh (after reactivation etc.)
// ---------------------------------------------------------------------------

function _refreshPanel(): void {
  if (!_state || !_hubId) return;
  showHubManagementPanel(_state, _hubId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _formatMoney(amount: number): string {
  if (amount === 0) return '$0';
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}k`;
  }
  return `$${amount.toLocaleString()}`;
}
