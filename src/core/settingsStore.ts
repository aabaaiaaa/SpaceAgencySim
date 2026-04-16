/**
 * settingsStore.ts — Persist user settings independently of save files.
 *
 * Settings (difficulty, auto-save, debug mode, etc.) currently live inside
 * GameState and are saved/loaded per save slot.  Deleting a save loses them.
 * This module stores settings under a dedicated IndexedDB key so they
 * survive save deletion and apply across all slots.
 *
 * Uses an in-memory cache: `initSettings()` loads from IDB once at startup
 * (must be awaited), then `loadSettings()` serves reads synchronously from
 * cache.  Only writes go to IDB.
 *
 * NO SIDE EFFECTS ON IMPORT — callers must explicitly call initSettings(),
 * loadSettings(), saveSettings(), or migrateSettings().
 */

import {
  DEFAULT_DIFFICULTY_SETTINGS,
  MalfunctionMode,
} from './constants.ts';

import { idbGet, idbSet } from './idbStorage.ts';
import { logger } from './logger.ts';
import { StorageQuotaError } from './saveload.ts';

import type { DifficultySettings, MalfunctionMode as MalfunctionModeType } from './constants.ts';
import type { GameState } from './gameState.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** IDB key for persisted settings. */
const STORAGE_KEY = 'spaceAgency_settings';

/** Current schema version — bump when the shape changes. */
const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Schema migration infrastructure
// ---------------------------------------------------------------------------

/**
 * A function that transforms settings from one schema version to the next.
 * Input may be missing new fields (from older versions); output must include them.
 */
type MigrationFn = (settings: Partial<PersistedSettings>) => Partial<PersistedSettings>;

/**
 * Registry of schema migrations.  Each entry is a tuple of
 * [fromVersion, migrationFunction].  Migrations are applied in order for all
 * entries where fromVersion >= the envelope's current version.
 *
 * Example — when SCHEMA_VERSION is bumped to 2, add:
 *   MIGRATIONS.push([1, (s) => { s.newField = 'default'; return s; }]);
 */
const MIGRATIONS: Array<[number, MigrationFn]> = [];

/**
 * Apply any pending schema migrations to a settings envelope.
 *
 * If the envelope is already at SCHEMA_VERSION, returns it unchanged.
 * Otherwise walks the MIGRATIONS array and applies each migration whose
 * fromVersion >= envelope.version, in order.  Returns a new envelope with
 * version set to SCHEMA_VERSION.
 *
 * The caller (initSettings) runs mergeWithDefaults() after this, which fills
 * any fields the migrations didn't set.
 */
function _migrateSettings(envelope: SettingsEnvelope): SettingsEnvelope {
  if (envelope.version === SCHEMA_VERSION) return envelope;

  let settings: Partial<PersistedSettings> = { ...envelope.settings };

  for (const [fromVersion, migrate] of MIGRATIONS) {
    if (fromVersion >= envelope.version) {
      settings = migrate(settings);
    }
  }

  // After migrations + the subsequent mergeWithDefaults(), all fields are present.
  // The Partial is safe because mergeWithDefaults fills any gaps.
  return { version: SCHEMA_VERSION, settings: settings as PersistedSettings };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Settings that are persisted independently of any save slot.
 *
 * This is the public contract — consumers read and write these fields.
 */
export interface PersistedSettings {
  /** Difficulty sliders (malfunction frequency, weather, finance, injury). */
  difficultySettings: DifficultySettings;
  /** Whether auto-save triggers at end of flight / return to hub. */
  autoSaveEnabled: boolean;
  /** Debug mode — enables debug saves, FPS overlay, etc. */
  debugMode: boolean;
  /** Whether the real-time performance dashboard overlay is visible. */
  showPerfDashboard: boolean;
  /** Malfunction mode override ('normal', 'off', 'forced'). */
  malfunctionMode: MalfunctionModeType;
}

/** Internal envelope stored in IDB (wraps settings + metadata). */
interface SettingsEnvelope {
  version: number;
  settings: PersistedSettings;
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

/**
 * Cached settings loaded from IDB.  Populated by initSettings(), read by
 * loadSettings(), updated by saveSettings().
 */
let _cache: PersistedSettings | null = null;

/**
 * True once settings have been persisted to IDB at least once (either loaded
 * during init or written via saveSettings).  Used by migrateSettings() to
 * skip writing when a dedicated settings key already exists.
 */
let _hasPersistedSettings = false;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Returns a fresh copy of the default settings.  Used when no persisted
 * settings exist yet (first launch) or when the stored data is corrupt.
 */
function defaultSettings(): PersistedSettings {
  return {
    difficultySettings: { ...DEFAULT_DIFFICULTY_SETTINGS },
    autoSaveEnabled: true,
    debugMode: false,
    showPerfDashboard: false,
    malfunctionMode: MalfunctionMode.NORMAL,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the settings cache from IndexedDB.  Must be awaited once at
 * application startup before any other settings function is called.
 *
 * After this returns, `loadSettings()` serves reads synchronously from cache.
 */
export async function initSettings(): Promise<void> {
  try {
    const raw = await idbGet(STORAGE_KEY);
    if (raw !== null) {
      const envelope: unknown = JSON.parse(raw);
      if (isValidEnvelope(envelope)) {
        const migrated = _migrateSettings(envelope);
        _cache = mergeWithDefaults(migrated.settings);
        _hasPersistedSettings = true;
        return;
      }
    }
  } catch {
    // JSON parse error or IDB failure — fall through to defaults.
  }
  _cache = defaultSettings();
}

/**
 * Load settings from the in-memory cache (synchronous).
 *
 * If initSettings() has not been called yet, returns default settings.
 * If the cached data was corrupt or missing, returns default settings.
 */
export function loadSettings(): PersistedSettings {
  return _cache ?? defaultSettings();
}

/**
 * Persist settings to IndexedDB.
 *
 * Updates the in-memory cache synchronously so subsequent `loadSettings()`
 * calls immediately reflect the change.  The IDB write happens asynchronously;
 * callers that do not need confirmation of the write can ignore the returned
 * Promise.
 */
export async function saveSettings(settings: PersistedSettings): Promise<void> {
  // Update cache immediately so synchronous reads see the new values.
  _cache = { ...settings };
  _hasPersistedSettings = true;

  const envelope: SettingsEnvelope = {
    version: SCHEMA_VERSION,
    settings,
  };
  try {
    await idbSet(STORAGE_KEY, JSON.stringify(envelope));
  } catch (err) {
    if (err instanceof Error && err.name === 'QuotaExceededError') {
      throw new StorageQuotaError('Settings save failed: storage quota exceeded', err);
    }
    throw err;
  }
}

/**
 * One-time migration helper: extract settings from an existing GameState
 * object (e.g. a loaded save) and write them to the dedicated key.
 *
 * Only writes if the dedicated key does not already exist, so a previously
 * persisted independent store is never overwritten by stale save data.
 *
 * The IDB write is fire-and-forget — the in-memory cache is updated
 * synchronously so a subsequent loadSettings() returns the migrated values.
 *
 * @param gameState  Any object with the legacy settings fields (typically the
 *                   result of loading a save slot).  Missing fields are filled
 *                   from defaults.
 */
export function migrateSettings(gameState: GameState | Record<string, unknown>): void {
  // Do not overwrite an existing dedicated store.
  if (_hasPersistedSettings) return;

  const settings = defaultSettings();

  if (gameState.difficultySettings != null && typeof gameState.difficultySettings === 'object') {
    settings.difficultySettings = {
      ...settings.difficultySettings,
      ...(gameState.difficultySettings as Partial<DifficultySettings>),
    };
  }

  if (typeof gameState.autoSaveEnabled === 'boolean') {
    settings.autoSaveEnabled = gameState.autoSaveEnabled;
  }

  if (typeof gameState.debugMode === 'boolean') {
    settings.debugMode = gameState.debugMode;
  }

  if (typeof gameState.showPerfDashboard === 'boolean') {
    settings.showPerfDashboard = gameState.showPerfDashboard;
  }

  if (typeof gameState.malfunctionMode === 'string') {
    settings.malfunctionMode = gameState.malfunctionMode as MalfunctionModeType;
  }

  void saveSettings(settings);
}

/**
 * Resets the in-memory cache and persistence flag.
 * Exported ONLY for testing — do not call from game logic.
 */
export function _resetCacheForTesting(): void {
  _cache = null;
  _hasPersistedSettings = false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Type guard: checks that `value` looks like a valid SettingsEnvelope.
 */
function isValidEnvelope(value: unknown): value is SettingsEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.version !== 'number') return false;
  if (obj.version < 1) return false;
  if (obj.version > SCHEMA_VERSION) {
    logger.warn(
      'settings',
      `Settings were saved with a newer schema version (${obj.version}) ` +
      `than this build supports (${SCHEMA_VERSION}). Using defaults.`,
    );
    return false;
  }
  return obj.settings !== null && typeof obj.settings === 'object';
}

/**
 * Merge a (possibly partial) settings object with defaults so that any
 * newly-introduced fields always have a value.
 */
function mergeWithDefaults(stored: Partial<PersistedSettings>): PersistedSettings {
  const defaults = defaultSettings();
  return {
    difficultySettings:
      stored.difficultySettings != null && typeof stored.difficultySettings === 'object'
        ? { ...defaults.difficultySettings, ...stored.difficultySettings }
        : defaults.difficultySettings,
    autoSaveEnabled:
      typeof stored.autoSaveEnabled === 'boolean'
        ? stored.autoSaveEnabled
        : defaults.autoSaveEnabled,
    debugMode:
      typeof stored.debugMode === 'boolean'
        ? stored.debugMode
        : defaults.debugMode,
    showPerfDashboard:
      typeof stored.showPerfDashboard === 'boolean'
        ? stored.showPerfDashboard
        : defaults.showPerfDashboard,
    malfunctionMode:
      typeof stored.malfunctionMode === 'string'
        ? stored.malfunctionMode as MalfunctionModeType
        : defaults.malfunctionMode,
  };
}
