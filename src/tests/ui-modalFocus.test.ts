// @vitest-environment jsdom
/**
 * ui-modalFocus.test.ts — TASK-020: focus management for welcome and
 * confirmation modals.
 *
 * Verifies that on open the primary action button receives focus, and on
 * close focus is restored to the element that was focused before the modal
 * opened (when that element is still connected to the document).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock CSS and PixiJS-dependent render modules so hub.ts/mainmenu.ts can load
// under jsdom.
// ---------------------------------------------------------------------------

vi.mock('../ui/hub.css', () => ({}));
vi.mock('../ui/mainmenu.css', () => ({}));

vi.mock('../render/hub.ts', () => ({
  showHubScene: vi.fn(),
  hideHubScene: vi.fn(),
  setHubWeather: vi.fn(),
  setBuiltFacilities: vi.fn(),
  setHubBodyVisuals: vi.fn(),
}));

import { showWelcomeModal } from '../ui/hub.ts';
import { _showConfirmModal } from '../ui/mainmenu.ts';
import { createGameState } from '../core/gameState.ts';

describe('welcome modal focus management', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the dismiss button on open and restores focus on close', () => {
    // Set up a previously-focused element in the DOM.
    const trigger = document.createElement('button');
    trigger.id = 'trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const container = document.createElement('div');
    document.body.appendChild(container);

    const state = createGameState();
    state.agencyName = 'Test Agency';

    showWelcomeModal(container, state);

    // After open, focus should be on the primary (dismiss) button.
    const dismissBtn = document.getElementById('welcome-dismiss-btn') as HTMLButtonElement;
    expect(dismissBtn).not.toBeNull();
    expect(document.activeElement).toBe(dismissBtn);

    // Close the modal.
    dismissBtn.click();

    // Modal is gone and focus returns to the trigger.
    expect(document.getElementById('welcome-modal')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(state.welcomeShown).toBe(true);
  });

  it('does not throw when the previously-focused element is removed from the DOM', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const container = document.createElement('div');
    document.body.appendChild(container);

    const state = createGameState();
    showWelcomeModal(container, state);

    // Remove the previously-focused element before closing.
    trigger.remove();

    const dismissBtn = document.getElementById('welcome-dismiss-btn') as HTMLButtonElement;
    expect(() => dismissBtn.click()).not.toThrow();
    expect(document.getElementById('welcome-modal')).toBeNull();
  });
});

describe('confirm modal focus management', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the confirm button on open and restores focus on cancel', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    _showConfirmModal('Delete Save', 'Sure?', 'Delete', () => {});

    const confirmBtn = document.getElementById('mm-modal-confirm') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    expect(document.activeElement).toBe(confirmBtn);

    // Close via cancel.
    const cancelBtn = document.getElementById('mm-modal-cancel') as HTMLButtonElement;
    cancelBtn.click();

    expect(document.querySelector('.mm-modal-backdrop')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('invokes onConfirm and restores focus when confirm is clicked', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const onConfirm = vi.fn();
    _showConfirmModal('Delete Save', 'Sure?', 'Delete', onConfirm);

    const confirmBtn = document.getElementById('mm-modal-confirm') as HTMLButtonElement;
    confirmBtn.click();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.mm-modal-backdrop')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
