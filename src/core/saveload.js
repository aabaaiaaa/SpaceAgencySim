/**
 * saveload.js — Save/Load system for the Space Agency simulation.
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
import { idbSet, idbGet, idbDelete, isIdbAvailable } from './idbStorage.js';

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
 * @type {number}
 */
export const SAVE_VERSION = 1;

// ---------------------------------------------------------------------------
// Session Time Tracking
// ---------------------------------------------------------------------------

/**
 * Timestamp (ms since epoch) marking the start of the current session.
 * Mutated on every save and load so that only new time is accumulated
 * on subsequent saves.
 *
 * @type {number}
 */
let _sessionStartTime = Date.now();

/**
 * Returns elapsed seconds since the session timer was last reset
 * (module load, last save, or last load — whichever is most recent).
 *
 * @returns {number}
 */
function getSessionSeconds() {
  return (Date.now() - _sessionStartTime) / 1000;
}

/**
 * Resets the session timer to right now.
 * Called after every save and load.
 */
function resetSessionTimer() {
  _sessionStartTime = Date.now();
}

/**
 * Overrides the session start time.
 * Exported ONLY for unit testing — do not call from game logic.
 *
 * @param {number} timestampMs  - Value to assign to the internal timer (ms).
 * @returns {void}
 */
export function _setSessionStartTimeForTesting(timestampMs) {
  _sessionStartTime = timestampMs;
}

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * A lightweight summary of one save slot shown in the UI.
 *
 * @typedef {Object} SaveSlotSummary
 * @property {number}  slotIndex            - Slot index (0–4).
 * @property {string}  saveName             - Player-assigned label.
 * @property {string}  agencyName           - Player's agency name.
 * @property {string}  timestamp            - ISO 8601 date/time of the save.
 * @property {number}  missionsCompleted    - Count of completed missions.
 * @property {number}  money                - Cash balance at save time.
 * @property {number}  acceptedMissionCount - Count of currently accepted missions.
 * @property {number}  totalFlights         - Entries in flightHistory.
 * @property {number}  crewCount            - Living (non-dead) crew members.
 * @property {number}  crewKIA              - Crew killed in action.
 * @property {number}  playTimeSeconds      - Cumulative real-world play time in seconds.
 * @property {number}  flightTimeSeconds    - Cumulative in-game flight time in seconds.
 * @property {string}  gameMode             - Game mode ('tutorial', 'freeplay', or 'sandbox').
 */

// ---------------------------------------------------------------------------
// Private Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the localStorage key for a given slot index.
 *
 * @param {number} slotIndex
 * @returns {string}
 */
function slotKey(slotIndex) {
  return `${SAVE_KEY_PREFIX}${slotIndex}`;
}

/**
 * Throws a RangeError if `slotIndex` is not a valid slot (0–SAVE_SLOT_COUNT-1).
 *
 * @param {number} slotIndex
 * @throws {RangeError}
 */
function assertValidSlot(slotIndex) {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}
 */
function countKIA(state) {
  return (state.crew ?? []).filter((c) => c.status === CrewStatus.DEAD).length;
}

/**
 * Returns the count of living (non-dead) crew members.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}
 */
function countLivingCrew(state) {
  return (state.crew ?? []).filter((c) => c.status !== CrewStatus.DEAD).length;
}

/**
 * Builds a SaveSlotSummary from an envelope object read from localStorage.
 *
 * @param {number} slotIndex
 * @param {{ saveName: string, timestamp: string, state: object }} envelope
 * @returns {SaveSlotSummary}
 */
function summaryFromEnvelope(slotIndex, envelope) {
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
 * @param {import('./gameState.js').GameState} state  Game state to persist.
 * @param {number} slotIndex   Destination slot index (0–4).
 * @param {string} [saveName]  Human-readable label for the save (default: 'New Save').
 * @returns {SaveSlotSummary}  Summary of the slot that was just written.
 * @throws {RangeError} If slotIndex is out of bounds.
 */
export function saveGame(state, slotIndex, saveName = 'New Save') {
  assertValidSlot(slotIndex);

  // Accumulate elapsed session time before serialising so the stored value
  // reflects all time played up to this moment.
  state.playTimeSeconds = (state.playTimeSeconds ?? 0) + getSessionSeconds();
  resetSessionTimer();

  const envelope = {
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
  } catch (err) {
    if (err?.name === 'QuotaExceededError') {
      // localStorage full — attempt IndexedDB as fallback.
      if (isIdbAvailable()) {
        idbSet(key, json).catch(() => {});
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
 * Loads and returns the full game state stored in the specified slot.
 *
 * The session timer is reset after loading so that play time continues
 * to accumulate correctly from this point forward.
 *
 * @param {number} slotIndex  Source slot index (0–4).
 * @returns {import('./gameState.js').GameState}  The restored game state.
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the slot is empty or the stored data is corrupt.
 */
export function loadGame(slotIndex) {
  assertValidSlot(slotIndex);

  const raw = localStorage.getItem(slotKey(slotIndex));
  if (raw === null) {
    throw new Error(`Save slot ${slotIndex} is empty.`);
  }

  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error(`Save slot ${slotIndex} contains corrupt data (invalid JSON).`);
  }

  if (!envelope || typeof envelope !== 'object' || !envelope.state) {
    throw new Error(`Save slot ${slotIndex} contains corrupt data (missing state field).`);
  }

  // Determine the save format version.  Pre-versioning saves have no version
  // field; treat them as version 0 so all migrations run.
  const saveVersion = typeof envelope.version === 'number' ? envelope.version : 0;

  if (saveVersion > SAVE_VERSION) {
    console.warn(
      `Save slot ${slotIndex} was created by a newer version (v${saveVersion}, ` +
      `current is v${SAVE_VERSION}). It may not load correctly.`
    );
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
  const toMigrate = [];
  const toKeep = [];
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
    const existingIds = new Set(shared.map(s => s.id));
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

  return envelope.state;
}

// ---------------------------------------------------------------------------
// Async Load (IndexedDB + localStorage)
// ---------------------------------------------------------------------------

/**
 * Parses a raw JSON envelope string and returns the parsed envelope object,
 * or null if the data is missing, corrupt, or structurally invalid.
 *
 * @param {string | null} raw
 * @returns {{ saveName: string, timestamp: string, version?: number, state: object } | null}
 */
function parseEnvelope(raw) {
  if (raw === null) return null;
  try {
    const envelope = JSON.parse(raw);
    if (envelope && typeof envelope === 'object' && envelope.state && envelope.timestamp) {
      return envelope;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Async version of loadGame that checks both localStorage and IndexedDB,
 * using the most recent valid save.
 *
 * Falls back to localStorage-only if IndexedDB is unavailable or errors.
 * If both layers have a save for the same slot, the one with the more
 * recent timestamp is used.
 *
 * @param {number} slotIndex  Source slot index (0–4).
 * @returns {Promise<import('./gameState.js').GameState>} The restored game state.
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If both layers are empty or corrupt.
 */
export async function loadGameAsync(slotIndex) {
  assertValidSlot(slotIndex);

  const key = slotKey(slotIndex);
  const lsRaw = localStorage.getItem(key);
  const lsEnvelope = parseEnvelope(lsRaw);

  let idbEnvelope = null;
  let idbRaw = null;
  if (isIdbAvailable()) {
    try {
      idbRaw = await idbGet(key);
      idbEnvelope = parseEnvelope(idbRaw);
    } catch {
      // IndexedDB failed — proceed with localStorage only.
    }
  }

  // Pick the most recent valid envelope.
  let chosen = null;
  if (lsEnvelope && idbEnvelope) {
    const lsTime = new Date(lsEnvelope.timestamp).getTime();
    const idbTime = new Date(idbEnvelope.timestamp).getTime();
    chosen = idbTime > lsTime ? idbEnvelope : lsEnvelope;
  } else {
    chosen = lsEnvelope ?? idbEnvelope;
  }

  if (!chosen) {
    throw new Error(`Save slot ${slotIndex} is empty.`);
  }

  // Write the chosen envelope back to localStorage if it came from IDB and
  // localStorage was missing or stale, so subsequent sync loads see it.
  if (chosen === idbEnvelope && chosen !== lsEnvelope && idbRaw) {
    try {
      localStorage.setItem(key, idbRaw);
    } catch {
      // Storage full — not critical, we already have the data.
    }
  }

  // Run the same migration and loading logic as the sync loadGame.
  // Temporarily inject the chosen envelope into localStorage so loadGame
  // can process it (it reads from localStorage).
  if (chosen === idbEnvelope && idbRaw) {
    try {
      localStorage.setItem(key, JSON.stringify(chosen));
    } catch {
      // If we can't write it, loadGame may still work if lsEnvelope was valid.
    }
  }

  return loadGame(slotIndex);
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Deletes the save stored in the specified slot.
 *
 * No-ops silently if the slot is already empty.
 *
 * @param {number} slotIndex  Slot to clear (0–4).
 * @returns {void}
 * @throws {RangeError} If slotIndex is out of bounds.
 */
export function deleteSave(slotIndex) {
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
 *
 * @returns {(SaveSlotSummary | null)[]}
 */
export function listSaves() {
  const result = [];

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
 * @param {number} slotIndex  Slot to export (0–4).
 * @returns {void}
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the slot is empty, corrupt, or no DOM is available.
 */
export function exportSave(slotIndex) {
  assertValidSlot(slotIndex);

  const raw = localStorage.getItem(slotKey(slotIndex));
  if (raw === null) {
    throw new Error(`Save slot ${slotIndex} is empty; nothing to export.`);
  }

  let envelope;
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
 * @param {string} jsonString  Raw JSON string (e.g. from a file-upload reader).
 * @param {number} slotIndex   Destination slot (0–4).
 * @returns {SaveSlotSummary}  Summary of the imported slot.
 * @throws {RangeError} If slotIndex is out of bounds.
 * @throws {Error}      If the JSON is malformed or required fields are absent.
 */
export function importSave(jsonString, slotIndex) {
  assertValidSlot(slotIndex);

  // --- Parse ----------------------------------------------------------------
  let envelope;
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
  } catch (err) {
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
 * @param {unknown} state
 * @returns {void}
 * @throws {Error} Describing the first validation failure found.
 */
export function _validateState(state) {
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
