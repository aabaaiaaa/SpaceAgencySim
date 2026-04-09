/**
 * autoSave.ts — Auto-save system.
 *
 * Saves to a dedicated auto-save slot (separate from the 5 manual save slots)
 * whenever a flight ends or the player returns to the hub. The save is preceded
 * by a brief toast notification with a cancel button.
 *
 * @module autoSave
 */

import { idbSet, idbDelete, isIdbAvailable } from './idbStorage.ts';
import { compressSaveData } from './saveload.ts';
import { logger } from './logger.ts';

import type { GameState } from './gameState.ts';

/** Prefix for manual save localStorage keys. */
const MANUAL_SAVE_PREFIX = 'spaceAgencySave_';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for the dedicated auto-save slot (fallback). */
export const AUTO_SAVE_KEY = 'spaceAgencySave_auto';

/** Remembered slot for this session (picked once, reused). */
let _autoSaveSlotKey: string | null = null;

/** Current save format version (mirrors saveload.ts SAVE_VERSION). */
const SAVE_VERSION = 2;

// ---------------------------------------------------------------------------
// Session time (mirrors saveload.js pattern)
// ---------------------------------------------------------------------------

let _sessionStartTime: number = Date.now();

function getSessionSeconds(): number {
  return (Date.now() - _sessionStartTime) / 1000;
}

function resetSessionTimer(): void {
  _sessionStartTime = Date.now();
}

/**
 * Exported ONLY for unit testing — do not call from game logic.
 */
export function _setSessionStartTimeForTesting(ts: number): void {
  _sessionStartTime = ts;
}

/**
 * Exported ONLY for unit testing — resets the remembered auto-save slot.
 */
export function _resetAutoSaveSlotForTesting(): void {
  _autoSaveSlotKey = null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if auto-save is enabled on the given game state.
 */
export function isAutoSaveEnabled(state: GameState | null | undefined): boolean {
  if (!state) return false;
  return state.autoSaveEnabled !== false;
}

/**
 * Determine which localStorage key to use for auto-saves.
 * Picks the first empty slot starting from 0, with no upper limit —
 * there's always a spare slot available beyond the occupied ones.
 * The choice is remembered for the session so we don't switch slots.
 */
function _getAutoSaveKey(): string {
  if (_autoSaveSlotKey !== null) return _autoSaveSlotKey;

  for (let i = 0; ; i++) {
    const key = `${MANUAL_SAVE_PREFIX}${i}`;
    if (localStorage.getItem(key) === null) {
      _autoSaveSlotKey = key;
      return key;
    }
  }
}

/**
 * Performs the auto-save to the first available save slot.
 *
 * Prefers an empty manual slot (0–4) so the save is visible in the load
 * screen. Falls back to the dedicated auto-save key if all manual slots
 * are occupied.
 *
 * Accumulates session play time, serialises the state, and writes to
 * localStorage (with IndexedDB mirror). If localStorage throws
 * QuotaExceededError, falls back to IndexedDB only.
 */
export async function performAutoSave(
  state: GameState | null | undefined,
): Promise<{ success: boolean; error?: string }> {
  if (!state) return { success: false, error: 'No state provided' };

  // Accumulate elapsed session time.
  state.playTimeSeconds = (state.playTimeSeconds ?? 0) + getSessionSeconds();
  resetSessionTimer();

  const saveKey = _getAutoSaveKey();

  const envelope = {
    saveName: 'Auto-Save',
    timestamp: new Date().toISOString(),
    version: SAVE_VERSION,
    state: JSON.parse(JSON.stringify(state)),
  };

  const json = JSON.stringify(envelope);
  const compressed = compressSaveData(json);

  try {
    localStorage.setItem(saveKey, compressed);
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };
    if (error?.name === 'QuotaExceededError') {
      // Attempt IndexedDB as fallback — await to ensure the save completes.
      if (isIdbAvailable()) {
        await idbSet(saveKey, compressed);
        return { success: true };
      }
      return { success: false, error: 'Storage full' };
    }
    return { success: false, error: error?.message ?? 'Unknown error' };
  }

  // Mirror to IndexedDB (fire-and-forget — LS already has the data).
  if (isIdbAvailable()) {
    idbSet(saveKey, compressed).catch(err => logger.debug('autoSave', 'IDB mirror write failed', err));
  }

  return { success: true };
}

/**
 * Checks whether an auto-save exists in localStorage.
 */
export function hasAutoSave(): boolean {
  return localStorage.getItem(AUTO_SAVE_KEY) !== null;
}

/**
 * Deletes the auto-save from localStorage and IndexedDB.
 */
export function deleteAutoSave(): void {
  localStorage.removeItem(AUTO_SAVE_KEY);
  if (isIdbAvailable()) {
    idbDelete(AUTO_SAVE_KEY).catch(err => logger.debug('autoSave', 'IDB mirror delete failed', err));
  }
}
