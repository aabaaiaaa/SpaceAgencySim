/**
 * autoSaveToast.ts — Auto-save toast notification with cancel button.
 *
 * Shows a small, unobtrusive toast for a few seconds before performing
 * the auto-save.  If the player clicks Cancel, the save is skipped.
 *
 * @module ui/autoSaveToast
 */

import type { GameState } from '../core/gameState.js';
import { isAutoSaveEnabled, performAutoSave } from '../core/autoSave.js';
import { injectStyleOnce } from './injectStyle.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const TOAST_STYLES = `
.auto-save-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: rgba(20, 32, 48, 0.92);
  border: 1px solid rgba(80, 140, 200, 0.35);
  border-radius: var(--radius-md, 6px);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 600;
  font-family: var(--font-family, system-ui, sans-serif);
  font-size: 0.82rem;
  color: #b0d0f0;
  pointer-events: auto;
  opacity: 1;
  transition: opacity 0.3s;
}

.auto-save-toast.fade-out {
  opacity: 0;
}

.auto-save-toast-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auto-save-toast-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(80, 140, 200, 0.3);
  border-top-color: #60a8e0;
  border-radius: 50%;
  animation: auto-save-spin 0.8s linear infinite;
}

@keyframes auto-save-spin {
  to { transform: rotate(360deg); }
}

.auto-save-toast-cancel {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--radius-sm, 4px);
  color: #90b0c8;
  font-size: 0.78rem;
  padding: 3px 10px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.auto-save-toast-cancel:hover {
  background: rgba(255, 80, 80, 0.15);
  color: #ff9090;
  border-color: rgba(255, 80, 80, 0.3);
}

.auto-save-toast-done {
  color: var(--color-success-text, #50d870);
}
`;

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

  injectStyleOnce('auto-save-toast-styles', TOAST_STYLES);

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
  _pendingTimer = window.setTimeout(() => {
    _pendingTimer = null;
    if (cancelled) return;

    const result = performAutoSave(state);

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
      errText.style.color = '#ff8080';
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
export function autoSaveImmediate(state: GameState): { success: boolean; error?: string } {
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
