/**
 * saveload.ts — Save/Load system for the Space Agency simulation.
 *
 * Supports up to 5 named save slots in localStorage.
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
import { AstronautStatus, FACILITY_DEFINITIONS, GameMode, DEFAULT_DIFFICULTY_SETTINGS, MiningModuleType } from './constants.ts';
import { crc32 } from './crc32.ts';
import { loadSharedLibrary, saveSharedLibrary } from './designLibrary.ts';
import { logger } from './logger.ts';
import { idbSet, idbGet, idbDelete, isIdbAvailable } from './idbStorage.ts';
import { recomputeSiteStorage } from './mining.ts';
import { loadSettings, migrateSettings, saveSettings } from './settingsStore.ts';

import type { GameState, RocketDesign } from './gameState.ts';
import type { MalfunctionMode as MalfunctionModeType } from './constants.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Total number of available save slots. */
export const SAVE_SLOT_COUNT = 5;

/** Prefix for localStorage keys. Full key = prefix + slotIndex. */
const SAVE_KEY_PREFIX = 'spaceAgencySave_';

/**
 * Current save format version. Bump this whenever the save envelope or
 * state schema changes in a way that requires new migration logic.
 */
export const SAVE_VERSION = 2;

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
  /** Slot index (0–4). */
  slotIndex: number;
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
}

/** Raw save envelope stored in localStorage. */
interface SaveEnvelope {
  saveName: string;
  timestamp: string;
  version?: number;
  compressed?: boolean;
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
 * Returns the localStorage key for a given slot index.
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
 * Builds a SaveSlotSummary from an envelope object read from localStorage.
 */
function summaryFromEnvelope(slotIndex: number, envelope: SaveEnvelope): SaveSlotSummary {
  const s = envelope.state;
  return {
    slotIndex,
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
  // Best-effort: don't let a settings write failure block the actual save.
  try {
    saveSettings({
      difficultySettings: { ...state.difficultySettings },
      autoSaveEnabled:    state.autoSaveEnabled,
      debugMode:          state.debugMode,
      showPerfDashboard:  state.showPerfDashboard,
      malfunctionMode:    state.malfunctionMode as MalfunctionModeType,
    });
  } catch {
    // Settings sync is non-critical — the save itself is what matters.
  }

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
    localStorage.setItem(key, compressed);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      // localStorage full — attempt IndexedDB as fallback.
      if (isIdbAvailable()) {
        await idbSet(key, compressed);
        return summaryFromEnvelope(slotIndex, envelope);
      }
      throw new Error('Storage full — unable to save. Delete old saves to free space.', { cause: err });
    }
    throw err;
  }

  // Mirror to IndexedDB (fire-and-forget).
  if (isIdbAvailable()) {
    idbSet(key, compressed).catch(err => logger.debug('saveload', 'IDB mirror write failed', err));
  }

  return summaryFromEnvelope(slotIndex, envelope);
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
 * If the string doesn't have the compressed prefix, returns it as-is
 * (backward compatibility with uncompressed saves).
 */
export function decompressSaveData(raw: string): string {
  if (raw.startsWith(COMPRESSED_PREFIX)) {
    const decompressed = decompressFromUTF16(raw.slice(COMPRESSED_PREFIX.length));
    if (decompressed === null) {
      throw new Error('Failed to decompress save data');
    }
    return decompressed;
  }
  // Uncompressed (pre-compression) save — return as-is.
  return raw;
}

/**
 * Parses a raw storage string (possibly compressed) and returns the parsed
 * envelope object, or null if the data is missing, corrupt, or structurally
 * invalid. Handles both compressed and uncompressed formats.
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
 * Checks both localStorage and IndexedDB, using the most recent valid save.
 * Falls back to localStorage-only if IndexedDB is unavailable or errors.
 *
 * The session timer is reset after loading so that play time continues
 * to accumulate correctly from this point forward.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the slot is empty or the stored data is corrupt.
 */
export async function loadGame(slotIndex: number): Promise<GameState> {
  logger.debug('save', 'Loading game', { slotIndex });
  assertValidSlot(slotIndex);

  const key = slotKey(slotIndex);

  // Check localStorage.
  const lsRaw = localStorage.getItem(key);
  const lsEnvelope = parseEnvelope(lsRaw);

  // Check IndexedDB for a potentially newer or fallback save.
  let idbEnvelope: SaveEnvelope | null = null;
  let idbRaw: string | null = null;
  if (isIdbAvailable()) {
    try {
      idbRaw = await idbGet(key);
      idbEnvelope = parseEnvelope(idbRaw);
    } catch {
      // IndexedDB failed — proceed with localStorage only.
    }
  }

  // Pick the most recent valid envelope.
  let envelope: SaveEnvelope | null;
  if (lsEnvelope && idbEnvelope) {
    const lsTime = new Date(lsEnvelope.timestamp).getTime();
    const idbTime = new Date(idbEnvelope.timestamp).getTime();
    envelope = idbTime > lsTime ? idbEnvelope : lsEnvelope;
  } else {
    envelope = lsEnvelope ?? idbEnvelope;
  }

  if (!envelope) {
    // Provide specific error messages matching original behaviour.
    if (lsRaw === null) {
      throw new Error(`Save slot ${slotIndex} is empty.`);
    }
    // localStorage had data but it was invalid — determine why.
    try {
      const json = decompressSaveData(lsRaw);
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

  // Write the chosen envelope back to localStorage if it came from IDB and
  // localStorage was missing or stale, so subsequent loads see it.
  if (envelope === idbEnvelope && envelope !== lsEnvelope && idbRaw) {
    try {
      localStorage.setItem(key, idbRaw);
    } catch {
      // Storage full — not critical, we already have the data.
    }
  }

  // Determine the save format version.  Pre-versioning saves have no version
  // field; treat them as version 0 so all migrations run.
  const saveVersion = typeof envelope.version === 'number' ? envelope.version : 0;

  if (saveVersion > SAVE_VERSION) {
    logger.warn('save', `Save slot ${slotIndex} was created by a newer version`, { saveVersion, currentVersion: SAVE_VERSION });
  }

  // Reset the timer so play time accumulated before this load is not
  // double-counted on the next save.
  resetSessionTimer();

  // Default savedDesigns for saves created before this feature existed.
  envelope.state.savedDesigns ??= [];

  // Default malfunctionMode for saves created before it moved to gameState.
  envelope.state.malfunctionMode ??= 'normal';

  // Migrate legacy savedDesigns: designs without a savePrivate flag are
  // migrated to the shared library (cross-save) and removed from the
  // per-slot array. Designs explicitly marked savePrivate stay in the slot.
  const toMigrate: RocketDesign[] = [];
  const toKeep: RocketDesign[] = [];
  for (const d of envelope.state.savedDesigns) {
    if (d.savePrivate === undefined || d.savePrivate === null) {
      d.savePrivate = false;
      toMigrate.push(d);
    } else if (d.savePrivate) {
      toKeep.push(d);
    } else {
      toMigrate.push(d);
    }
  }
  if (toMigrate.length > 0) {
    const shared = loadSharedLibrary();
    const existingIds = new Set(shared.map((s) => s.id));
    for (const d of toMigrate) {
      if (!existingIds.has(d.id)) {
        shared.push(d);
      }
    }
    saveSharedLibrary(shared);
  }
  envelope.state.savedDesigns = toKeep;

  // Default facilities for saves created before the construction system.
  if (!envelope.state.facilities || typeof envelope.state.facilities !== 'object') {
    envelope.state.facilities = Object.fromEntries(
      FACILITY_DEFINITIONS
        .filter((f) => f.starter)
        .map((f) => [f.id, { built: true, tier: 1 }]),
    );
  }
  envelope.state.tutorialMode ??= true;

  // Default gameMode for saves created before the game mode system.
  if (!envelope.state.gameMode) {
    envelope.state.gameMode = envelope.state.tutorialMode ? GameMode.TUTORIAL : GameMode.FREEPLAY;
  }
  envelope.state.sandboxSettings ??= null;

  // Default contracts for saves created before the contract system.
  if (!envelope.state.contracts || typeof envelope.state.contracts !== 'object') {
    envelope.state.contracts = { board: [], active: [], completed: [], failed: [] };
  }
  envelope.state.reputation ??= 50;

  // Default science tracking for saves created before the instrument system.
  envelope.state.sciencePoints ??= 0;
  envelope.state.scienceLog ??= [];

  // Default tech tree state for saves created before the tech tree system.
  if (!envelope.state.techTree || typeof envelope.state.techTree !== 'object') {
    envelope.state.techTree = { researched: [], unlockedInstruments: [] };
  }
  envelope.state.techTree.researched ??= [];
  envelope.state.techTree.unlockedInstruments ??= [];

  // Default part inventory for saves created before the reusability system.
  envelope.state.partInventory ??= [];

  // Default achievements for saves created before the achievement system.
  envelope.state.achievements ??= [];

  // Default challenges for saves created before the challenge system.
  if (!envelope.state.challenges || typeof envelope.state.challenges !== 'object') {
    envelope.state.challenges = { active: null, results: {} };
  }
  envelope.state.challenges.results ??= {};

  // Default custom challenges for saves created before the custom challenge system.
  if (!Array.isArray(envelope.state.customChallenges)) {
    envelope.state.customChallenges = [];
  }

  // Default difficulty settings for saves created before the settings system.
  if (!envelope.state.difficultySettings || typeof envelope.state.difficultySettings !== 'object') {
    envelope.state.difficultySettings = { ...DEFAULT_DIFFICULTY_SETTINGS };
  }
  envelope.state.difficultySettings.malfunctionFrequency ??= DEFAULT_DIFFICULTY_SETTINGS.malfunctionFrequency;
  envelope.state.difficultySettings.weatherSeverity      ??= DEFAULT_DIFFICULTY_SETTINGS.weatherSeverity;
  envelope.state.difficultySettings.financialPressure    ??= DEFAULT_DIFFICULTY_SETTINGS.financialPressure;
  envelope.state.difficultySettings.injuryDuration       ??= DEFAULT_DIFFICULTY_SETTINGS.injuryDuration;

  // Default welcomeShown for saves created before the welcome modal.
  // Existing saves should not see the welcome modal, so default to true.
  envelope.state.welcomeShown ??= true;

  // Default autoSaveEnabled for saves created before the auto-save system.
  envelope.state.autoSaveEnabled ??= true;

  // Default debugMode for saves created before the debug mode toggle.
  envelope.state.debugMode ??= false;

  // Remove obsolete useWorkerPhysics — worker physics is now the only mode.
  delete (envelope.state as Record<string, unknown>).useWorkerPhysics;

  // Default showPerfDashboard for saves created before the perf dashboard feature.
  envelope.state.showPerfDashboard ??= false;

  // Remove missions 002 and 003 (consolidated into mission-001 in iteration 6).
  const removedMissionIds = new Set(['mission-002', 'mission-003']);
  if (envelope.state.missions) {
    for (const bucket of ['available', 'accepted', 'completed'] as const) {
      if (Array.isArray(envelope.state.missions[bucket])) {
        envelope.state.missions[bucket] = envelope.state.missions[bucket].filter(
          (m: { id: string }) => !removedMissionIds.has(m.id),
        );
      }
    }
  }

  // Default horizontalVelocity on in-progress flights.
  if (envelope.state.flightState && envelope.state.flightState.horizontalVelocity == null) {
    envelope.state.flightState.horizontalVelocity = 0;
  }

  // Default mining/route fields for saves created before the resource system.
  envelope.state.miningSites ??= [];
  envelope.state.provenLegs ??= [];
  envelope.state.routes ??= [];

  // Backfill per-module storage fields for saves created before per-module storage.
  const STORAGE_MODULE_TYPES = new Set([
    MiningModuleType.STORAGE_SILO,
    MiningModuleType.PRESSURE_VESSEL,
    MiningModuleType.FLUID_TANK,
  ]);
  for (const site of envelope.state.miningSites) {
    for (const mod of site.modules ?? []) {
      if (STORAGE_MODULE_TYPES.has(mod.type) && mod.stored == null) {
        mod.stored = {};
      }
    }
    recomputeSiteStorage(site);
  }

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

/**
 * Backward-compatible alias for loadGame.
 * @deprecated Use loadGame() directly — it now checks both localStorage and IndexedDB.
 */
export const loadGameAsync = loadGame;

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes the save stored in the specified slot.
 *
 * No-ops silently if the slot is already empty.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 */
export function deleteSave(slotIndex: number): void {
  assertValidSlot(slotIndex);
  const key = slotKey(slotIndex);
  localStorage.removeItem(key);

  // Mirror deletion to IndexedDB (fire-and-forget).
  if (isIdbAvailable()) {
    idbDelete(key).catch(err => logger.debug('saveload', 'IDB mirror delete failed', err));
  }
}

// ---------------------------------------------------------------------------
// List Saves
// ---------------------------------------------------------------------------

/**
 * Returns a summary array for all save slots.
 *
 * The array always has exactly `SAVE_SLOT_COUNT` (5) entries, one per slot.
 * Empty or corrupt slots are represented as `null`.
 */
export function listSaves(): (SaveSlotSummary | null)[] {
  const result: (SaveSlotSummary | null)[] = [];

  for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
    const raw = localStorage.getItem(slotKey(i));

    if (raw === null) {
      result.push(null);
      continue;
    }

    try {
      const json = decompressSaveData(raw);
      const envelope = JSON.parse(json);
      if (envelope && typeof envelope === 'object' && envelope.state) {
        result.push(summaryFromEnvelope(i, envelope));
      } else {
        result.push(null); // Malformed envelope — treat as empty.
      }
    } catch {
      result.push(null); // Corrupt JSON — treat as empty.
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
export function exportSave(slotIndex: number): void {
  assertValidSlot(slotIndex);

  const raw = localStorage.getItem(slotKey(slotIndex));
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
 * Accepts two formats:
 * 1. **New binary envelope** (base64-encoded): starts with "SASV" magic bytes
 *    after base64 decoding.  Contains CRC-32 integrity check and LZC payload.
 * 2. **Legacy JSON string**: plain JSON text as exported by older versions.
 *
 * The envelope and its embedded state are checked for required fields and
 * correct types before anything is written to localStorage; invalid input
 * is rejected with a descriptive error.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the data is corrupted, malformed, or required fields are absent.
 */
export function importSave(inputString: string, slotIndex: number): SaveSlotSummary {
  assertValidSlot(slotIndex);

  // --- Attempt new binary envelope format -----------------------------------
  const decoded = base64ToUint8(inputString.trim());
  if (decoded !== null && hasMagicBytes(decoded)) {
    return _importBinaryEnvelope(decoded, slotIndex);
  }

  // --- Fall back to legacy JSON import --------------------------------------
  return _importLegacyJson(inputString, slotIndex);
}

/**
 * Imports a save from the new binary envelope format.
 *
 * @throws {Error} If the envelope is corrupted, truncated, or contains invalid data.
 */
function _importBinaryEnvelope(bytes: Uint8Array, slotIndex: number): SaveSlotSummary {
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

  // Validate envelope and state fields (same checks as legacy path).
  _validateEnvelopeFields(envelope);
  _validateState(envelope.state);

  // Persist — store the LZC string directly (already compressed).
  _persistImport(lzcString, slotIndex);

  return summaryFromEnvelope(slotIndex, envelope);
}

/**
 * Imports a save from the legacy JSON string format (backward compatibility).
 *
 * @throws {Error} If the JSON is malformed or required fields are absent.
 */
function _importLegacyJson(jsonString: string, slotIndex: number): SaveSlotSummary {
  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(jsonString);
  } catch {
    throw new Error('Import failed: the provided data is not valid JSON.');
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Import failed: JSON root must be a plain object.');
  }

  _validateEnvelopeFields(envelope);
  _validateState(envelope.state);

  // Persist — compress and store.
  const json = JSON.stringify(envelope);
  const compressed = compressSaveData(json);
  _persistImport(compressed, slotIndex);

  return summaryFromEnvelope(slotIndex, envelope);
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
 * Writes a compressed save string to localStorage (and mirrors to IndexedDB).
 *
 * @throws {Error} If localStorage is full and IndexedDB is unavailable.
 */
function _persistImport(compressed: string, slotIndex: number): void {
  const key = slotKey(slotIndex);
  try {
    localStorage.setItem(key, compressed);
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error('Storage full — unable to import save. Delete old saves to free space.', { cause: err });
    }
    throw err;
  }

  // Mirror to IndexedDB (fire-and-forget).
  if (isIdbAvailable()) {
    idbSet(key, compressed).catch(err => logger.debug('saveload', 'IDB mirror write failed', err));
  }
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
