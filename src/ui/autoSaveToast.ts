/**
 * autoSaveToast.ts — Auto-save toast notification with cancel button.
 *
 * Shows a small, unobtrusive toast for a few seconds before performing
 * the auto-save.  If the player clicks Cancel, the save is skipped.
 *
 * @module ui/autoSaveToast
 */

import type { GameState } from '../core/gameState.ts';
import { isAutoSaveEnabled, performAutoSave } from '../core/autoSave.ts';
import './autoSaveToast.css';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Delay in ms before the auto-save executes (cancel window). */
const AUTO_SAVE_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _activeToast: HTMLElement | null = null;
let _pendingTimer: number | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Triggers an auto-save with a toast notification and cancel button.
 *
 * If auto-save is disabled in settings, this is a no-op.
 * If a toast is already showing, the new request is ignored (debounce).
 */
export function triggerAutoSave(state: GameState, _trigger?: string): void {
  if (!isAutoSaveEnabled(state)) return;
  if (_activeToast) return; // debounce

  // Build toast element.
  const toast = document.createElement('div');
  toast.className = 'auto-save-toast';
  toast.id = 'auto-save-toast';

  const label = document.createElement('span');
  label.className = 'auto-save-toast-label';

  const spinner = document.createElement('span');
  spinner.className = 'auto-save-toast-spinner';
  label.appendChild(spinner);

  const text = document.createElement('span');
  text.textContent = 'Auto-saving\u2026';
  label.appendChild(text);

  toast.appendChild(label);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'auto-save-toast-cancel';
  cancelBtn.id = 'auto-save-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  toast.appendChild(cancelBtn);

  let cancelled = false;

  cancelBtn.addEventListener('click', () => {
    cancelled = true;
    if (_pendingTimer !== null) {
      clearTimeout(_pendingTimer);
      _pendingTimer = null;
    }
    _removeToast();
  });

  document.body.appendChild(toast);
  _activeToast = toast;

  // Schedule the actual save after the delay.
  _pendingTimer = window.setTimeout(async () => {
    _pendingTimer = null;
    if (cancelled) return;

    const result = await performAutoSave(state);

    // Update toast to show completion or error.
    if (result.success) {
      label.innerHTML = '';
      const checkmark = document.createElement('span');
      checkmark.className = 'auto-save-toast-done';
      checkmark.textContent = '\u2713';
      label.appendChild(checkmark);
      const doneText = document.createElement('span');
      doneText.textContent = ' Saved';
      label.appendChild(doneText);
    } else {
      label.innerHTML = '';
      const errText = document.createElement('span');
      errText.className = 'auto-save-toast-error';
      errText.textContent = result.error || 'Save failed';
      label.appendChild(errText);
    }

    // Remove cancel button after save executes.
    cancelBtn.remove();

    // Fade out after a moment.
    setTimeout(() => _removeToast(), 1500);
  }, AUTO_SAVE_DELAY_MS);
}

/**
 * Immediately performs an auto-save without the toast UI.
 * Used by E2E tests that need deterministic saves without waiting.
 */
export async function autoSaveImmediate(state: GameState): Promise<{ success: boolean; error?: string }> {
  if (!isAutoSaveEnabled(state)) return { success: false, error: 'Disabled' };
  return performAutoSave(state);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _removeToast(): void {
  if (!_activeToast) return;
  _activeToast.classList.add('fade-out');
  const el = _activeToast;
  _activeToast = null;
  setTimeout(() => el.remove(), 300);
}

/**
 * Exported for testing — cancels any pending auto-save and removes the toast.
 */
export function _cancelPendingAutoSave(): void {
  if (_pendingTimer !== null) {
    clearTimeout(_pendingTimer);
    _pendingTimer = null;
  }
  if (_activeToast) {
    _activeToast.remove();
    _activeToast = null;
  }
}
