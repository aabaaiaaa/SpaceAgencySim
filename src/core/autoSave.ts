/**
 * autoSave.ts — Auto-save system.
 *
 * Saves to a dedicated auto-save slot (separate from the 5 manual save slots)
 * whenever a flight ends or the player returns to the hub. The save is preceded
 * by a brief toast notification with a cancel button.
 *
 * @module autoSave
 */

import { idbSet, idbGet, idbDelete, idbGetAllKeys } from './idbStorage.ts';
import { compressSaveData, decompressSaveData, SAVE_VERSION } from './saveload.ts';

import type { GameState } from './gameState.ts';

/** Prefix for save keys. */
const MANUAL_SAVE_PREFIX = 'spaceAgencySave_';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Key for the dedicated auto-save slot (fallback). */
export const AUTO_SAVE_KEY = 'spaceAgencySave_auto';

/** Remembered slot for this session (picked once, reused). */
let _autoSaveSlotKey: string | null = null;

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
 * Determine which key to use for auto-saves by scanning IndexedDB.
 * Picks the first empty slot starting from 0, capped at 100.
 * Falls back to the dedicated auto-save key if all slots are occupied.
 * The choice is remembered for the session so we don't switch slots.
 */
async function _getAutoSaveKey(agencyName: string): Promise<string> {
  if (_autoSaveSlotKey !== null) return _autoSaveSlotKey;

  // Build a set of occupied keys from IDB for fast lookup.
  const allKeys = new Set(await idbGetAllKeys());

  // First pass: find an existing auto-save slot for the same agency.
  let firstEmptySlot: string | null = null;
  for (let i = 0; i < 100; i++) {
    const key = `${MANUAL_SAVE_PREFIX}${i}`;
    if (!allKeys.has(key)) {
      if (firstEmptySlot === null) firstEmptySlot = key;
      continue;
    }
    try {
      const raw = await idbGet(key);
      if (raw === null) {
        if (firstEmptySlot === null) firstEmptySlot = key;
        continue;
      }
      const json = decompressSaveData(raw);
      const envelope = JSON.parse(json);
      if ((envelope.autoSave === true || envelope.saveName === 'Auto-Save') && envelope.state?.agencyName === agencyName) {
        _autoSaveSlotKey = key;
        return key;
      }
    } catch {
      // Corrupted or non-JSON data — skip this slot.
    }
  }

  // Second pass result: use the first empty slot found during the scan.
  if (firstEmptySlot !== null) {
    _autoSaveSlotKey = firstEmptySlot;
    return firstEmptySlot;
  }

  // All slots occupied — fall back to the dedicated auto-save key.
  _autoSaveSlotKey = AUTO_SAVE_KEY;
  return AUTO_SAVE_KEY;
}

/**
 * Performs the auto-save to the first available save slot.
 *
 * Prefers an empty manual slot (0–4) so the save is visible in the load
 * screen. Falls back to the dedicated auto-save key if all manual slots
 * are occupied.
 *
 * Accumulates session play time, serialises the state, and writes to
 * IndexedDB.
 */
export async function performAutoSave(
  state: GameState | null | undefined,
): Promise<{ success: boolean; error?: string }> {
  if (!state) return { success: false, error: 'No state provided' };

  // Accumulate elapsed session time.
  state.playTimeSeconds = (state.playTimeSeconds ?? 0) + getSessionSeconds();
  resetSessionTimer();

  const saveKey = await _getAutoSaveKey(state.agencyName);

  const envelope = {
    saveName: state.agencyName || 'Auto-Save',
    timestamp: new Date().toISOString(),
    version: SAVE_VERSION,
    autoSave: true,
    state: JSON.parse(JSON.stringify(state)),
  };

  const json = JSON.stringify(envelope);
  const compressed = compressSaveData(json);

  try {
    await idbSet(saveKey, compressed);
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string };
    return { success: false, error: error?.message ?? 'Unknown error' };
  }

  return { success: true };
}

/**
 * Checks whether an auto-save exists in IndexedDB.
 */
export async function hasAutoSave(): Promise<boolean> {
  const raw = await idbGet(AUTO_SAVE_KEY);
  return raw !== null;
}

/**
 * Deletes the auto-save from IndexedDB.
 */
export async function deleteAutoSave(): Promise<void> {
  await idbDelete(AUTO_SAVE_KEY);
}
