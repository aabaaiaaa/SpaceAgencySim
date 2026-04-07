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

import { CrewStatus, FACILITY_DEFINITIONS, GameMode, DEFAULT_DIFFICULTY_SETTINGS } from './constants.js';
import { loadSharedLibrary, saveSharedLibrary } from './designLibrary.js';
import { logger } from './logger.js';
import { idbSet, idbGet, idbDelete, isIdbAvailable } from './idbStorage.js';

import type { GameState } from './gameState.js';

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
export const SAVE_VERSION = 1;

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
}

/** Raw save envelope stored in localStorage. */
interface SaveEnvelope {
  saveName: string;
  timestamp: string;
  version?: number;
  state: any;
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
 * Returns the count of crew members with status DEAD (KIA).
 */
function countKIA(state: any): number {
  return (state.crew ?? []).filter((c: any) => c.status === CrewStatus.DEAD).length;
}

/**
 * Returns the count of living (non-dead) crew members.
 */
function countLivingCrew(state: any): number {
  return (state.crew ?? []).filter((c: any) => c.status !== CrewStatus.DEAD).length;
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

  const envelope: SaveEnvelope = {
    saveName: String(saveName),
    timestamp: new Date().toISOString(),
    version: SAVE_VERSION,
    // Deep-clone via JSON round-trip so the stored snapshot is immutable and
    // unaffected by subsequent in-memory mutations.
    state: JSON.parse(JSON.stringify(state)),
  };

  const json = JSON.stringify(envelope);
  const key = slotKey(slotIndex);

  try {
    localStorage.setItem(key, json);
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError') {
      // localStorage full — attempt IndexedDB as fallback.
      if (isIdbAvailable()) {
        await idbSet(key, json);
        return summaryFromEnvelope(slotIndex, envelope);
      }
      throw new Error('Storage full — unable to save. Delete old saves to free space.', { cause: err });
    }
    throw err;
  }

  // Mirror to IndexedDB (fire-and-forget).
  if (isIdbAvailable()) {
    idbSet(key, json).catch(() => {});
  }

  return summaryFromEnvelope(slotIndex, envelope);
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Parses a raw JSON envelope string and returns the parsed envelope object,
 * or null if the data is missing, corrupt, or structurally invalid.
 */
function parseEnvelope(raw: string | null): SaveEnvelope | null {
  if (raw === null) return null;
  try {
    const envelope = JSON.parse(raw);
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
      const parsed = JSON.parse(lsRaw);
      if (!parsed || typeof parsed !== 'object' || !parsed.state) {
        throw new Error(`Save slot ${slotIndex} contains corrupt data (missing state field).`);
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error(`Save slot ${slotIndex} contains corrupt data (invalid JSON).`);
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
  const toMigrate: any[] = [];
  const toKeep: any[] = [];
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
    const existingIds = new Set(shared.map((s: any) => s.id));
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

  return envelope.state as GameState;
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
    idbDelete(key).catch(() => {});
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
      const envelope = JSON.parse(raw);
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
 * Triggers a browser file-download of the specified save slot as a JSON file.
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

  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(raw);
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
  const filename = `spaceAgency_slot${slotIndex}_${safeName}.json`;

  const blob = new Blob([raw], { type: 'application/json' });
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
 * Parses and validates a JSON string, then writes it to the specified slot.
 *
 * The envelope and its embedded state are checked for required fields and
 * correct types before anything is written to localStorage; invalid input
 * is rejected with a descriptive error.
 *
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the JSON is malformed or required fields are absent.
 */
export function importSave(jsonString: string, slotIndex: number): SaveSlotSummary {
  assertValidSlot(slotIndex);

  // --- Parse ----------------------------------------------------------------
  let envelope: SaveEnvelope;
  try {
    envelope = JSON.parse(jsonString);
  } catch {
    throw new Error('Import failed: the provided data is not valid JSON.');
  }

  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Import failed: JSON root must be a plain object.');
  }

  // --- Validate envelope fields ---------------------------------------------
  if (typeof envelope.saveName !== 'string') {
    throw new Error('Import failed: envelope.saveName must be a string.');
  }
  if (typeof envelope.timestamp !== 'string') {
    throw new Error('Import failed: envelope.timestamp must be a string.');
  }
  if (!envelope.state || typeof envelope.state !== 'object' || Array.isArray(envelope.state)) {
    throw new Error('Import failed: envelope.state must be a plain object.');
  }

  // --- Validate game state fields -------------------------------------------
  _validateState(envelope.state);

  // --- Persist --------------------------------------------------------------
  const json = JSON.stringify(envelope);
  const key = slotKey(slotIndex);
  try {
    localStorage.setItem(key, json);
  } catch (err: any) {
    if (err?.name === 'QuotaExceededError') {
      throw new Error('Storage full — unable to import save. Delete old saves to free space.', { cause: err });
    }
    throw err;
  }

  // Mirror to IndexedDB (fire-and-forget).
  if (isIdbAvailable()) {
    idbSet(key, json).catch(() => {});
  }

  return summaryFromEnvelope(slotIndex, envelope);
}

// ---------------------------------------------------------------------------
// State Validation (used by importSave)
// ---------------------------------------------------------------------------

/**
 * Validates that an object looks like a serialised GameState.
 * Checks types of all top-level required fields; rejects on the first error.
 *
 * Exported with an underscore prefix so it can be tested independently;
 * treat it as an internal implementation detail.
 *
 * @throws {Error} Describing the first validation failure found.
 */
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
}
