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

import { compressToUTF16, decompressFromUTF16 } from 'lz-string';
import { AstronautStatus, GameMode } from './constants.ts';
import { crc32 } from './crc32.ts';
import { logger } from './logger.ts';
import { idbSet, idbGet, idbDelete, idbGetAllKeys } from './idbStorage.ts';
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

/**
 * Prefix marker for compressed save strings in storage.
 * Compressed saves are stored as: COMPRESSED_PREFIX + compressToUTF16(json).
 * This allows `parseEnvelope` to detect compressed vs uncompressed data.
 */
const COMPRESSED_PREFIX = 'LZC:';

// ---------------------------------------------------------------------------
// Binary Envelope Format (for export/import only — not internal storage)
// ---------------------------------------------------------------------------
// Bytes 0-3:   Magic bytes "SASV" (Space Agency Save, ASCII)
// Bytes 4-5:   Format version (uint16, big-endian)
// Bytes 6-9:   CRC-32 checksum of the payload (uint32, big-endian)
// Bytes 10-13: Payload length in bytes (uint32, big-endian)
// Bytes 14+:   Payload (LZC-compressed JSON string, UTF-8 encoded)
// ---------------------------------------------------------------------------

/** Magic bytes identifying the binary save envelope ("SASV" in ASCII). */
const ENVELOPE_MAGIC = new Uint8Array([0x53, 0x41, 0x53, 0x56]); // S, A, S, V

/** Size of the binary envelope header in bytes. */
const ENVELOPE_HEADER_SIZE = 14;

/** Current binary envelope format version. */
const ENVELOPE_FORMAT_VERSION = 1;

/**
 * Builds a binary envelope around a payload string.
 *
 * Layout:
 *   [4 bytes magic] [2 bytes version (uint16 BE)] [4 bytes CRC-32 (uint32 BE)]
 *   [4 bytes payload length (uint32 BE)] [payload bytes]
 *
 * @param payload - The LZC-compressed save string to wrap.
 * @returns The complete envelope as a Uint8Array.
 */
function buildBinaryEnvelope(payload: string): Uint8Array {
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(payload);
  const checksum = crc32(payloadBytes);

  const envelope = new Uint8Array(ENVELOPE_HEADER_SIZE + payloadBytes.length);
  const view = new DataView(envelope.buffer);

  // Magic bytes (0-3)
  envelope.set(ENVELOPE_MAGIC, 0);
  // Format version (4-5), uint16 big-endian
  view.setUint16(4, ENVELOPE_FORMAT_VERSION, false);
  // CRC-32 checksum (6-9), uint32 big-endian
  view.setUint32(6, checksum, false);
  // Payload length (10-13), uint32 big-endian
  view.setUint32(10, payloadBytes.length, false);
  // Payload (14+)
  envelope.set(payloadBytes, ENVELOPE_HEADER_SIZE);

  return envelope;
}

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

/**
 * Checks whether the first 4 bytes of a Uint8Array match the SASV magic bytes.
 */
function hasMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < ENVELOPE_HEADER_SIZE) return false;
  return (
    bytes[0] === ENVELOPE_MAGIC[0] &&
    bytes[1] === ENVELOPE_MAGIC[1] &&
    bytes[2] === ENVELOPE_MAGIC[2] &&
    bytes[3] === ENVELOPE_MAGIC[3]
  );
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
    logger.warn('save', 'Settings sync failed during save', err);
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
 * Compresses a JSON string for storage using lz-string UTF-16 encoding.
 * Returns the compressed string with a prefix marker for detection.
 */
export function compressSaveData(json: string): string {
  return COMPRESSED_PREFIX + compressToUTF16(json);
}

/**
 * Decompresses a storage string back to JSON.
 * Throws if the compressed prefix is missing (corrupt data).
 */
export function decompressSaveData(raw: string): string {
  if (!raw.startsWith(COMPRESSED_PREFIX)) {
    throw new Error('Save data is missing the compressed prefix — possibly corrupt.');
  }
  const decompressed = decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length));
  if (decompressed === null) {
    throw new Error('Failed to decompress save data');
  }
  return decompressed;
}

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
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Read header fields.
  const version = view.getUint16(4, false);
  if (version > ENVELOPE_FORMAT_VERSION) {
    throw new Error(
      'Save was created with a newer version of the game. ' +
      `Please update to load this save (save version: ${version}, supported: ${ENVELOPE_FORMAT_VERSION}).`
    );
  }
  const expectedCrc = view.getUint32(6, false);
  const payloadLength = view.getUint32(10, false);

  // Validate payload length matches actual remaining bytes.
  const actualPayloadLength = bytes.length - ENVELOPE_HEADER_SIZE;
  if (payloadLength !== actualPayloadLength) {
    throw new Error(
      `Import failed: save file is corrupted (payload length mismatch — ` +
      `header says ${payloadLength} bytes, file contains ${actualPayloadLength}).`
    );
  }

  // Extract and verify payload.
  const payloadBytes = bytes.slice(ENVELOPE_HEADER_SIZE);
  const actualCrc = crc32(payloadBytes);
  if (expectedCrc !== actualCrc) {
    throw new Error('Import failed: save file is corrupted (CRC-32 checksum mismatch).');
  }

  // Decode payload as UTF-8 to get the LZC-compressed storage string.
  const decoder = new TextDecoder();
  const lzcString = decoder.decode(payloadBytes);

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

// ---------------------------------------------------------------------------
// State Validation (used by importSave)
// ---------------------------------------------------------------------------

/**
 * Validates that an object looks like a serialised GameState.
 * Checks types of all top-level required fields; rejects on the first error.
 * Then validates critical nested structures, filtering out corrupted entries
 * rather than failing the entire load.
 *
 * Exported with an underscore prefix so it can be tested independently;
 * treat it as an internal implementation detail.
 *
 * @throws {Error} Describing the first validation failure found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validates untrusted deserialized JSON
export function _validateState(state: any): void {
  // Numeric top-level fields.
  for (const field of ['money', 'playTimeSeconds']) {
    if (typeof state[field] !== 'number') {
      throw new Error(
        `Import failed: state.${field} must be a number; got ${typeof state[field]}.`
      );
    }
  }

  // Loan object.
  if (!state.loan || typeof state.loan !== 'object' || Array.isArray(state.loan)) {
    throw new Error('Import failed: state.loan must be a plain object.');
  }
  if (typeof state.loan.balance !== 'number') {
    throw new Error('Import failed: state.loan.balance must be a number.');
  }
  if (typeof state.loan.interestRate !== 'number') {
    throw new Error('Import failed: state.loan.interestRate must be a number.');
  }

  // Array fields.
  for (const field of ['crew', 'rockets', 'parts', 'flightHistory']) {
    if (!Array.isArray(state[field])) {
      throw new Error(`Import failed: state.${field} must be an array.`);
    }
  }

  // Missions sub-object.
  if (!state.missions || typeof state.missions !== 'object' || Array.isArray(state.missions)) {
    throw new Error('Import failed: state.missions must be a plain object.');
  }
  for (const field of ['available', 'accepted', 'completed']) {
    if (!Array.isArray(state.missions[field])) {
      throw new Error(`Import failed: state.missions.${field} must be an array.`);
    }
  }

  // Filter corrupted nested entries (shared with loadGame).
  _validateNestedStructures(state);
}

/**
 * Validates critical nested array structures within a game state,
 * filtering out corrupted entries rather than failing the entire load/import.
 * Logs a warning for each collection that had entries removed.
 *
 * Safe to call on partially-migrated state (missing arrays are skipped).
 *
 * Exported with an underscore prefix for testing; treat as internal.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validates untrusted deserialized JSON
export function _validateNestedStructures(state: any): void {
  // Missions: accepted and completed entries must have id (string), title (string), reward (number).
  if (state.missions && typeof state.missions === 'object') {
    for (const bucket of ['accepted', 'completed']) {
      if (!Array.isArray(state.missions[bucket])) continue;
      const original = state.missions[bucket];
      const filtered = original.filter((entry: Record<string, unknown>) => {
        if (!entry || typeof entry !== 'object') return false;
        if (typeof entry.id !== 'string') return false;
        if (typeof entry.title !== 'string') return false;
        if (typeof entry.reward !== 'number') return false;
        return true;
      });
      if (filtered.length < original.length) {
        const removed = original.length - filtered.length;
        logger.warn('save', `Filtered ${removed} corrupted entries from missions.${bucket}`, {
          originalCount: original.length,
          keptCount: filtered.length,
        });
        state.missions[bucket] = filtered;
      }
    }
  }

  // Crew: each entry must have name (string), status (defined), skills (object).
  if (Array.isArray(state.crew)) {
    const original = state.crew;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.name !== 'string') return false;
      if (entry.status === undefined || entry.status === null) return false;
      if (!entry.skills || typeof entry.skills !== 'object' || Array.isArray(entry.skills)) return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from crew`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.crew = filtered;
    }
  }

  // Orbital objects: each entry must have id (string), bodyId (string), elements (object).
  if (Array.isArray(state.orbitalObjects)) {
    const original = state.orbitalObjects;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.id !== 'string') return false;
      if (typeof entry.bodyId !== 'string') return false;
      if (!entry.elements || typeof entry.elements !== 'object' || Array.isArray(entry.elements)) return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from orbitalObjects`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.orbitalObjects = filtered;
    }
  }

  // Saved designs: each entry must have name (string), parts (array).
  if (Array.isArray(state.savedDesigns)) {
    const original = state.savedDesigns;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.name !== 'string') return false;
      if (!Array.isArray(entry.parts)) return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from savedDesigns`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.savedDesigns = filtered;
    }
  }

  // Contracts active: each entry must have id (string), reward (number).
  if (state.contracts && typeof state.contracts === 'object' && Array.isArray(state.contracts.active)) {
    const original = state.contracts.active;
    const filtered = original.filter((entry: Record<string, unknown>) => {
      if (!entry || typeof entry !== 'object') return false;
      if (typeof entry.id !== 'string') return false;
      if (typeof entry.reward !== 'number') return false;
      return true;
    });
    if (filtered.length < original.length) {
      const removed = original.length - filtered.length;
      logger.warn('save', `Filtered ${removed} corrupted entries from contracts.active`, {
        originalCount: original.length,
        keptCount: filtered.length,
      });
      state.contracts.active = filtered;
    }
  }
}
