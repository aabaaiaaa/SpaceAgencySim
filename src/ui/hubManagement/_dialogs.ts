/**
 * _dialogs.ts — Hub management confirmation dialogs.
 *
 * Reactivation and abandonment confirmation overlays.
 *
 * @module ui/hubManagement/_dialogs
 */

import type { HubManagementInfo } from '../../core/hubTypes.ts';
import { reactivateHub, abandonHub } from '../../core/hubs.ts';
import { renderHubSwitcher } from '../hubSwitcher.ts';
import {
  getPanelState,
  getHubId,
  getBackdrop,
  formatMoney,
  refreshPanel,
  hideHubManagementPanel,
} from './_panel.ts';

// ---------------------------------------------------------------------------
// Reactivate confirmation dialog
// ---------------------------------------------------------------------------

export function showReactivateConfirmation(info: HubManagementInfo): void {
  const backdrop = getBackdrop();
  if (!backdrop) return;

  const panel = backdrop.querySelector<HTMLDivElement>('.hub-mgmt-panel');
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
  title.textContent = 'Reactivate Hub?';

  const msg = document.createElement('div');
  msg.className = 'hub-mgmt-confirm-msg';
  msg.textContent = `Reactivate ${info.name} for ${formatMoney(info.maintenanceCostPerPeriod)}? The hub will come back online.`;

  const buttons = document.createElement('div');
  buttons.className = 'hub-mgmt-confirm-buttons';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn-primary';
  confirmBtn.textContent = 'Confirm';
  confirmBtn.addEventListener('click', () => {
    const state = getPanelState();
    const hubId = getHubId();
    if (!state || !hubId) return;
    const success = reactivateHub(state, hubId);
    if (success) {
      refreshPanel();
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
// Abandon confirmation dialog
// ---------------------------------------------------------------------------

export function showAbandonConfirmation(): void {
  const backdrop = getBackdrop();
  if (!backdrop) return;

  const panel = backdrop.querySelector<HTMLDivElement>('.hub-mgmt-panel');
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
    const state = getPanelState();
    const hubId = getHubId();
    if (!state || !hubId) return;
    const result = abandonHub(state, hubId);
    if (result.success) {
      const currentState = getPanelState();
      if (currentState) renderHubSwitcher(currentState);
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
