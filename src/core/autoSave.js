/**
 * autoSave.js — Auto-save system.
 *
 * Saves to a dedicated auto-save slot (separate from the 5 manual save slots)
 * whenever a flight ends or the player returns to the hub. The save is preceded
 * by a brief toast notification with a cancel button.
 *
 * @module autoSave
 */

import { idbSet, idbDelete, isIdbAvailable } from './idbStorage.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for the dedicated auto-save slot. */
export const AUTO_SAVE_KEY = 'spaceAgencySave_auto';

/** Current save format version (mirrors saveload.js SAVE_VERSION). */
const SAVE_VERSION = 1;

// ---------------------------------------------------------------------------
// Session time (mirrors saveload.js pattern)
// ---------------------------------------------------------------------------

let _sessionStartTime = Date.now();

function getSessionSeconds() {
  return (Date.now() - _sessionStartTime) / 1000;
}

function resetSessionTimer() {
  _sessionStartTime = Date.now();
}

/**
 * Exported ONLY for unit testing — do not call from game logic.
 * @param {number} ts
 */
export function _setSessionStartTimeForTesting(ts) {
  _sessionStartTime = ts;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if auto-save is enabled on the given game state.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {boolean}
 */
export function isAutoSaveEnabled(state) {
  if (!state) return false;
  return state.autoSaveEnabled !== false;
}

/**
 * Performs the auto-save to the dedicated auto-save slot.
 *
 * Accumulates session play time, serialises the state, and writes to
 * localStorage (with IndexedDB mirror). If localStorage throws
 * QuotaExceededError, falls back to IndexedDB only.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ success: boolean, error?: string }}
 */
export function performAutoSave(state) {
  if (!state) return { success: false, error: 'No state provided' };

  // Accumulate elapsed session time.
  state.playTimeSeconds = (state.playTimeSeconds ?? 0) + getSessionSeconds();
  resetSessionTimer();

  const envelope = {
    saveName: 'Auto-Save',
    timestamp: new Date().toISOString(),
    version: SAVE_VERSION,
    state: JSON.parse(JSON.stringify(state)),
  };

  const json = JSON.stringify(envelope);

  try {
    localStorage.setItem(AUTO_SAVE_KEY, json);
  } catch (err) {
    if (err?.name === 'QuotaExceededError') {
      // Attempt IndexedDB as fallback.
      if (isIdbAvailable()) {
        idbSet(AUTO_SAVE_KEY, json).catch(() => {});
        return { success: true };
      }
      return { success: false, error: 'Storage full' };
    }
    return { success: false, error: err?.message ?? 'Unknown error' };
  }

  // Mirror to IndexedDB (fire-and-forget).
  if (isIdbAvailable()) {
    idbSet(AUTO_SAVE_KEY, json).catch(() => {});
  }

  return { success: true };
}

/**
 * Checks whether an auto-save exists in localStorage.
 *
 * @returns {boolean}
 */
export function hasAutoSave() {
  return localStorage.getItem(AUTO_SAVE_KEY) !== null;
}

/**
 * Deletes the auto-save from localStorage and IndexedDB.
 */
export function deleteAutoSave() {
  localStorage.removeItem(AUTO_SAVE_KEY);
  if (isIdbAvailable()) {
    idbDelete(AUTO_SAVE_KEY).catch(() => {});
  }
}
