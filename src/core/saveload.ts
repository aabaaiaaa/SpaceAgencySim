/**
 * saveload.ts — Save/Load system for the Space Agency simulation.
 *
 * Supports up to 5 named save slots stored in IndexedDB.
 * Storage keys: `spaceAgencySave_0` through `spaceAgencySave_4`.
 *
 * Each slot serialises the full game state as a JSON envelope:
 *   { saveName, timestamp, state }
 *
 * Play time is tracked by recording the session start time and accumulating
 * elapsed seconds into `state.playTimeSeconds` on each save.
 *
 * @module saveload
 */

import { AstronautStatus, GameMode } from './constants.ts';
import { logger } from './logger.ts';
import { idbSet, idbGet, idbDelete, idbGetAllKeys } from './idbStorage.ts';
import {
  buildBinaryEnvelope,
  compressSaveData,
  decompressSaveData,
  hasMagicBytes,
  parseBinaryEnvelope,
  _validateState,
  _validateNestedStructures,
} from './saveEncoding.ts';

export { compressSaveData, decompressSaveData } from './saveEncoding.ts';
export { _validateState, _validateNestedStructures } from './saveEncoding.ts';
import { loadSettings, migrateSettings, saveSettings } from './settingsStore.ts';

import type { GameState } from './gameState.ts';
import type { MalfunctionMode as MalfunctionModeType } from './constants.ts';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when an IndexedDB write fails because storage quota has been
 * exceeded. Callers (UI) can catch this to surface an actionable message
 * ("Save storage full — delete old saves") rather than a fatal error.
 */
export class StorageQuotaError extends Error {
  constructor(message: string = 'Storage quota exceeded', public readonly cause?: unknown) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total number of available save slots. */
export const SAVE_SLOT_COUNT = 5;

/** Prefix for storage keys. Full key = prefix + slotIndex. */
const SAVE_KEY_PREFIX = 'spaceAgencySave_';

/**
 * Current save format version. Bump this whenever the save envelope or
 * state schema changes in a way that requires new migration logic.
 */
export const SAVE_VERSION = 6;

// ---------------------------------------------------------------------------
// Session Time Tracking
// ---------------------------------------------------------------------------

/**
 * Timestamp (ms since epoch) marking the start of the current session.
 * Mutated on every save and load so that only new time is accumulated
 * on subsequent saves.
 */
let _sessionStartTime: number = Date.now();

/**
 * Returns elapsed seconds since the session timer was last reset
 * (module load, last save, or last load — whichever is most recent).
 */
function getSessionSeconds(): number {
  return (Date.now() - _sessionStartTime) / 1000;
}

/**
 * Resets the session timer to right now.
 * Called after every save and load.
 */
function resetSessionTimer(): void {
  _sessionStartTime = Date.now();
}

/**
 * Overrides the session start time.
 * Exported ONLY for unit testing — do not call from game logic.
 */
export function _setSessionStartTimeForTesting(timestampMs: number): void {
  _sessionStartTime = timestampMs;
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * A lightweight summary of one save slot shown in the UI.
 */
export interface SaveSlotSummary {
  /** Slot index (0–4 for manual slots, -1 for overflow/auto). */
  slotIndex: number;
  /** The storage key for this save (e.g. 'spaceAgencySave_0', 'spaceAgencySave_auto'). */
  storageKey: string;
  /** Player-assigned label. */
  saveName: string;
  /** Player's agency name. */
  agencyName: string;
  /** ISO 8601 date/time of the save. */
  timestamp: string;
  /** Count of completed missions. */
  missionsCompleted: number;
  /** Cash balance at save time. */
  money: number;
  /** Count of currently accepted missions. */
  acceptedMissionCount: number;
  /** Entries in flightHistory. */
  totalFlights: number;
  /** Living (non-dead) crew members. */
  crewCount: number;
  /** Crew killed in action. */
  crewKIA: number;
  /** Cumulative real-world play time in seconds. */
  playTimeSeconds: number;
  /** Cumulative in-game flight time in seconds. */
  flightTimeSeconds: number;
  /** Game mode ('tutorial', 'freeplay', or 'sandbox'). */
  gameMode: string;
  /** Save format version (0 for pre-versioning saves). */
  version: number;
  /** True if this save was created by auto-save. */
  isAutoSave: boolean;
}

/** Raw save envelope stored in IndexedDB. */
interface SaveEnvelope {
  saveName: string;
  timestamp: string;
  version?: number;
  compressed?: boolean;
  autoSave?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deserialized JSON with unknown shape before migration
  state: any;
}

// ---------------------------------------------------------------------------
// Binary Envelope Format (for export/import only — not internal storage)
// ---------------------------------------------------------------------------
// The envelope build/parse and magic-byte check live in `saveEncoding.ts`.
// This module only deals with base64 framing around the binary envelope.
// ---------------------------------------------------------------------------

/**
 * Encodes a Uint8Array as a base64 string.
 * Uses browser btoa() with a binary-string intermediate.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string to a Uint8Array.
 * Returns null if the input is not valid base64.
 */
function base64ToUint8(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the storage key for a given slot index.
 */
function slotKey(slotIndex: number): string {
  return `${SAVE_KEY_PREFIX}${slotIndex}`;
}

/**
 * Throws a RangeError if `slotIndex` is not a valid slot (0–SAVE_SLOT_COUNT-1).
 */
function assertValidSlot(slotIndex: number): void {
  if (
    !Number.isInteger(slotIndex) ||
    slotIndex < 0 ||
    slotIndex >= SAVE_SLOT_COUNT
  ) {
    throw new RangeError(
      `Save slot index must be an integer between 0 and ${SAVE_SLOT_COUNT - 1}; got ${slotIndex}.`
    );
  }
}

/**
 * Returns the count of crew members with status KIA.
 */
function countKIA(state: { crew?: Array<{ status: AstronautStatus }> }): number {
  return (state.crew ?? []).filter((c) => c.status === AstronautStatus.KIA).length;
}

/**
 * Returns the count of living (non-KIA) crew members.
 */
function countLivingCrew(state: { crew?: Array<{ status: AstronautStatus }> }): number {
  return (state.crew ?? []).filter((c) => c.status !== AstronautStatus.KIA).length;
}

/**
 * Builds a SaveSlotSummary from a parsed envelope object.
 */
function summaryFromEnvelope(slotIndex: number, envelope: SaveEnvelope, storageKey: string): SaveSlotSummary {
  const s = envelope.state;
  return {
    slotIndex,
    storageKey,
    saveName: envelope.saveName,
    agencyName: s.agencyName ?? '',
    timestamp: envelope.timestamp,
    missionsCompleted: s.missions?.completed?.length ?? 0,
    money: s.money ?? 0,
    acceptedMissionCount: s.missions?.accepted?.length ?? 0,
    totalFlights: s.flightHistory?.length ?? 0,
    crewCount: countLivingCrew(s),
    crewKIA: countKIA(s),
    playTimeSeconds: s.playTimeSeconds ?? 0,
    flightTimeSeconds: s.flightTimeSeconds ?? 0,
    gameMode: s.gameMode ?? (s.tutorialMode ? GameMode.TUTORIAL : GameMode.FREEPLAY),
    version: envelope.version ?? 0,
    isAutoSave: envelope.autoSave === true || envelope.saveName === 'Auto-Save',
  };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Saves the current game state to the specified slot.
 *
 * Elapsed session time is accumulated into `state.playTimeSeconds` before
 * serialisation, and the session timer is reset so that the next save
 * only counts new time.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 */
export async function saveGame(state: GameState, slotIndex: number, saveName: string = 'New Save'): Promise<SaveSlotSummary> {
  logger.debug('save', 'Saving game', { slotIndex, saveName });
  assertValidSlot(slotIndex);

  // Accumulate elapsed session time before serialising so the stored value
  // reflects all time played up to this moment.
  state.playTimeSeconds = (state.playTimeSeconds ?? 0) + getSessionSeconds();
  resetSessionTimer();

  // Sync current settings to the dedicated settings key on every save,
  // ensuring the dedicated store stays up-to-date even if a settings
  // mutation path didn't call saveSettings() directly.
  // Cache is updated synchronously; the IDB write is intentionally not
  // awaited so a settings-sync failure does not block or fail the main
  // save. Surface any failure through the logger so it is not invisible.
  saveSettings({
    difficultySettings: { ...state.difficultySettings },
    autoSaveEnabled:    state.autoSaveEnabled,
    debugMode:          state.debugMode,
    showPerfDashboard:  state.showPerfDashboard,
    malfunctionMode:    state.malfunctionMode as MalfunctionModeType,
  }).catch((err: unknown) => {
    logger.warn('save', 'Settings sync failed during save', { err });
  });

  const envelope: SaveEnvelope = {
    saveName: String(saveName),
    timestamp: new Date().toISOString(),
    version: SAVE_VERSION,
    // Deep-clone via JSON round-trip so the stored snapshot is immutable and
    // unaffected by subsequent in-memory mutations.
    state: JSON.parse(JSON.stringify(state)),
  };

  const json = JSON.stringify(envelope);
  const compressed = compressSaveData(json);
  const key = slotKey(slotIndex);

  logger.debug('save', 'Compression stats', {
    rawSize: json.length,
    compressedSize: compressed.length,
    ratio: json.length > 0 ? ((1 - compressed.length / json.length) * 100).toFixed(1) + '%' : 'N/A',
  });

  try {
    await idbSet(key, compressed);
  } catch (err) {
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      throw new StorageQuotaError('Save failed: storage quota exceeded', err);
    }
    throw err;
  }

  return summaryFromEnvelope(slotIndex, envelope, key);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Parses a raw compressed storage string and returns the parsed envelope
 * object, or null if the data is missing, corrupt, or structurally invalid.
 */
function parseEnvelope(raw: string | null): SaveEnvelope | null {
  if (raw === null) return null;
  try {
    const json = decompressSaveData(raw);
    const envelope = JSON.parse(json);
    if (envelope && typeof envelope === 'object' && envelope.state) {
      return envelope as SaveEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Loads and returns the full game state stored in the specified slot.
 *
 * Reads exclusively from IndexedDB.
 *
 * The session timer is reset after loading so that play time continues
 * to accumulate correctly from this point forward.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the slot is empty or the stored data is corrupt.
 */
export async function loadGame(slotIndex: number, storageKey?: string): Promise<GameState> {
  logger.debug('save', 'Loading game', { slotIndex, storageKey });
  const key = storageKey ?? (assertValidSlot(slotIndex), slotKey(slotIndex));

  const raw = await idbGet(key);
  const envelope = parseEnvelope(raw);

  if (!envelope) {
    if (raw === null) {
      throw new Error(`Save slot ${slotIndex} is empty.`);
    }
    // Storage had data but it was invalid — determine why.
    try {
      const json = decompressSaveData(raw);
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || !parsed.state) {
        throw new Error(`Save slot ${slotIndex} contains corrupt data (missing state field).`);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Save slot ${slotIndex} contains corrupt data (invalid JSON).`, { cause: e });
      }
      throw e;
    }
    throw new Error(`Save slot ${slotIndex} contains corrupt data.`);
  }

  // Determine the save format version.  Pre-versioning saves have no version
  // field; treat them as version 0.
  const saveVersion = typeof envelope.version === 'number' ? envelope.version : 0;

  // Version check — reject incompatible saves.
  if (saveVersion !== SAVE_VERSION) {
    throw new Error(
      `Save slot ${slotIndex} is from an incompatible version (save: v${saveVersion}, current: v${SAVE_VERSION}).`,
    );
  }

  // Reset the timer so play time accumulated before this load is not
  // double-counted on the next save.
  resetSessionTimer();

  // Validate and filter corrupted nested entries (missions, crew, etc.).
  _validateNestedStructures(envelope.state);

  // Apply persisted settings from the dedicated settings store.
  // If no dedicated settings key exists yet (first load after this feature),
  // migrate settings from the loaded save into the dedicated key.
  // The dedicated key is authoritative — it overrides whatever was in the save.
  applyPersistedSettings(envelope.state as GameState);

  return envelope.state as GameState;
}

/**
 * Applies persisted settings from the dedicated settings store to the loaded
 * game state.  If no dedicated key exists yet (pre-settingsStore saves),
 * migrates settings from the save into the dedicated key first.
 *
 * The dedicated settings key is authoritative — its values override whatever
 * was serialised in the save file so that settings persist across saves and
 * save deletions.
 */
export function applyPersistedSettings(state: GameState): void {
  // Attempt migration first: if the dedicated key doesn't exist yet,
  // extract settings from the loaded save and write them.
  migrateSettings(state);

  // Now load the authoritative settings (either freshly migrated or
  // previously persisted) and apply them to the in-memory game state.
  const settings = loadSettings();
  state.difficultySettings = settings.difficultySettings;
  state.autoSaveEnabled    = settings.autoSaveEnabled;
  state.debugMode          = settings.debugMode;
  state.showPerfDashboard  = settings.showPerfDashboard;
  state.malfunctionMode    = settings.malfunctionMode;
}


// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes the save stored in the specified slot.
 *
 * If `storageKey` is provided it is used directly (for overflow / auto-save
 * slots that don't map to a 0–4 index). Otherwise the key is derived from
 * `slotIndex`, which must be a valid manual slot index.
 *
 * No-ops silently if the slot is already empty.
 *
 * @throws {RangeError} If slotIndex is out of bounds and no storageKey is provided.
 */
export async function deleteSave(slotIndex: number, storageKey?: string): Promise<void> {
  const key = storageKey ?? (assertValidSlot(slotIndex), slotKey(slotIndex));
  await idbDelete(key);
}

// ---------------------------------------------------------------------------
// List Saves
// ---------------------------------------------------------------------------

/**
 * Returns a summary array for all discovered save slots.
 *
 * The first `SAVE_SLOT_COUNT` (5) entries correspond to manual slots 0–4
 * and are always present (null for empty or corrupt). Additional entries
 * may follow for overflow slots (5–99) and the dedicated auto-save key
 * (`spaceAgencySave_auto`); only populated slots are included in the
 * overflow section.
 */
export async function listSaves(): Promise<(SaveSlotSummary | null)[]> {
  const result: (SaveSlotSummary | null)[] = [];

  // Always include the 5 manual slots (null for empty).
  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const key = slotKey(i);
    const raw = await idbGet(key);

    if (raw === null) {
      result.push(null);
      continue;
    }

    try {
      const json = decompressSaveData(raw);
      const envelope = JSON.parse(json);
      if (envelope && typeof envelope === 'object' && envelope.state) {
        result.push(summaryFromEnvelope(i, envelope, key));
      } else {
        result.push(null);
      }
    } catch {
      result.push(null);
    }
  }

  // Scan IDB for overflow keys (slots 5–99, auto-save, etc.).
  const allKeys = await idbGetAllKeys();
  const manualKeySet = new Set<string>();
  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    manualKeySet.add(slotKey(i));
  }

  for (const key of allKeys) {
    // Skip manual slots (already included above) and non-save keys.
    if (manualKeySet.has(key)) continue;
    if (!key.startsWith(SAVE_KEY_PREFIX)) continue;

    const raw = await idbGet(key);
    if (raw === null) continue;

    try {
      const json = decompressSaveData(raw);
      const envelope = JSON.parse(json);
      if (envelope && typeof envelope === 'object' && envelope.state) {
        result.push(summaryFromEnvelope(-1, envelope, key));
      }
    } catch {
      // Corrupt overflow save — skip silently.
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Export Save (browser-only)
// ---------------------------------------------------------------------------

/**
 * Triggers a browser file-download of the specified save slot as a binary
 * envelope file (.sav) with magic bytes, CRC-32 integrity check, and the
 * LZC-compressed payload encoded as base64.
 *
 * This function relies on browser DOM APIs (`document`, `Blob`,
 * `URL.createObjectURL`).  Calling it in a non-browser environment (e.g.
 * a Node.js test runner) throws an informative error.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the slot is empty, corrupt, or no DOM is available.
 */
export async function exportSave(slotIndex: number, storageKey?: string): Promise<void> {
  const key = storageKey ?? (assertValidSlot(slotIndex), slotKey(slotIndex));

  const raw = await idbGet(key);
  if (raw === null) {
    throw new Error(`Save slot ${slotIndex} is empty; nothing to export.`);
  }

  // Verify the stored data is valid before exporting.
  let envelope: SaveEnvelope;
  try {
    const json = decompressSaveData(raw);
    envelope = JSON.parse(json);
  } catch {
    throw new Error(`Save slot ${slotIndex} contains corrupt data (invalid JSON).`);
  }

  // Guard: DOM APIs are only available in browser environments.
  if (
    typeof document === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined'
  ) {
    throw new Error('exportSave() requires a browser environment with DOM support.');
  }

  // Build a safe filename from the save name.
  const safeName = String(envelope.saveName ?? 'save').replace(/[^a-z0-9_-]/gi, '_');
  const filename = `spaceAgency_slot${slotIndex}_${safeName}.sav`;

  // Build binary envelope around the LZC-compressed storage string and
  // encode as base64 for safe text-based transport (clipboard, file).
  const envelopeBytes = buildBinaryEnvelope(raw);
  const base64 = uint8ToBase64(envelopeBytes);

  const blob = new Blob([base64], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Import Save
// ---------------------------------------------------------------------------

/**
 * Imports a save into the specified slot.
 *
 * Accepts the binary envelope format (base64-encoded): starts with "SASV"
 * magic bytes after base64 decoding. Contains CRC-32 integrity check and
 * LZC payload.
 *
 * The envelope and its embedded state are checked for required fields and
 * correct types before anything is written to storage; invalid input
 * is rejected with a descriptive error.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the data is corrupted, malformed, or required fields are absent.
 */
export async function importSave(inputString: string, slotIndex: number): Promise<SaveSlotSummary> {
  assertValidSlot(slotIndex);

  const decoded = base64ToUint8(inputString.trim());
  if (decoded !== null && hasMagicBytes(decoded)) {
    return _importBinaryEnvelope(decoded, slotIndex);
  }

  throw new Error('Import failed: unrecognized save format.');
}

/**
 * Imports a save from the new binary envelope format.
 *
 * @throws {Error} If the envelope is corrupted, truncated, or contains invalid data.
 */
async function _importBinaryEnvelope(bytes: Uint8Array, slotIndex: number): Promise<SaveSlotSummary> {
  // Validate header + CRC and extract the LZC-compressed storage string.
  const lzcString = parseBinaryEnvelope(bytes);

  // Decompress and parse the envelope JSON.
  let json: string;
  try {
    json = decompressSaveData(lzcString);
  } catch {
    throw new Error('Import failed: save file payload could not be decompressed.');
  }

  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(json);
  } catch {
    throw new Error('Import failed: save file payload is not valid JSON.');
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Import failed: JSON root must be a plain object.');
  }

  // Validate envelope and state fields.
  _validateEnvelopeFields(envelope);
  _validateState(envelope.state);

  // Persist — store the LZC string directly (already compressed).
  await _persistImport(lzcString, slotIndex);

  return summaryFromEnvelope(slotIndex, envelope, slotKey(slotIndex));
}


/**
 * Validates the top-level envelope fields (saveName, timestamp, state).
 *
 * @throws {Error} Describing the first validation failure found.
 */
function _validateEnvelopeFields(envelope: SaveEnvelope): void {
  if (typeof envelope.saveName !== 'string') {
    throw new Error('Import failed: envelope.saveName must be a string.');
  }
  if (typeof envelope.timestamp !== 'string') {
    throw new Error('Import failed: envelope.timestamp must be a string.');
  }
  if (!envelope.state || typeof envelope.state !== 'object' || Array.isArray(envelope.state)) {
    throw new Error('Import failed: envelope.state must be a plain object.');
  }
}

/**
 * Writes a compressed save string to IndexedDB.
 */
async function _persistImport(compressed: string, slotIndex: number): Promise<void> {
  const key = slotKey(slotIndex);
  await idbSet(key, compressed);
}

