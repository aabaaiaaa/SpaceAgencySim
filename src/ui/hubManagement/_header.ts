/**
 * _header.ts — Hub management panel header with editable name + close button.
 *
 * @module ui/hubManagement/_header
 */

import type { HubManagementInfo } from '../../core/hubTypes.ts';
import { renameHub } from '../../core/hubs.ts';
import { renderHubSwitcher } from '../hubSwitcher.ts';
import { getPanelState, getHubId, getBackdrop, hideHubManagementPanel } from './_panel.ts';

// ---------------------------------------------------------------------------
// Header — editable name + close button
// ---------------------------------------------------------------------------

export function buildHeader(info: HubManagementInfo): HTMLDivElement {
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
      const state = getPanelState();
      const hubId = getHubId();
      if (!state || !hubId) return;
      const trimmed = nameInput.value.trim();
      if (trimmed === originalName) return;

      const result = renameHub(state, hubId, trimmed);
      const backdrop = getBackdrop();
      const errorEl = backdrop?.querySelector<HTMLDivElement>('.hub-mgmt-name-error');
      if (!result.success) {
        if (errorEl) errorEl.textContent = result.error ?? 'Rename failed';
        nameInput.value = originalName;
      } else {
        if (errorEl) errorEl.textContent = '';
        originalName = trimmed;
        const currentState = getPanelState();
        if (currentState) renderHubSwitcher(currentState);
      }
    };

    nameInput.addEventListener('blur', commitRename);
    nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nameInput.blur();
      } else if (e.key === 'Escape') {
        nameInput.value = originalName;
        const backdrop = getBackdrop();
        const errorEl = backdrop?.querySelector<HTMLDivElement>('.hub-mgmt-name-error');
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

export function buildNameError(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'hub-mgmt-name-error';
  el.setAttribute('role', 'alert');
  return el;
}
