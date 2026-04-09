/**
 * settingsStore.ts — Persist user settings independently of save files.
 *
 * Settings (difficulty, auto-save, debug mode, etc.) currently live inside
 * GameState and are saved/loaded per save slot.  Deleting a save loses them.
 * This module stores settings under a dedicated localStorage key so they
 * survive save deletion and apply across all slots.
 *
 * NO SIDE EFFECTS ON IMPORT — callers must explicitly call loadSettings(),
 * saveSettings(), or migrateSettings().
 */

import {
  DEFAULT_DIFFICULTY_SETTINGS,
  MalfunctionMode,
} from './constants.ts';

import type { DifficultySettings, MalfunctionMode as MalfunctionModeType } from './constants.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for persisted settings. */
const STORAGE_KEY = 'spaceAgency_settings';

/** Current schema version — bump when the shape changes. */
const SCHEMA_VERSION = 1;

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

/** Internal envelope stored in localStorage (wraps settings + metadata). */
interface SettingsEnvelope {
  version: number;
  settings: PersistedSettings;
}

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
 * Load settings from the dedicated localStorage key.
 *
 * If the key is missing, corrupt, or has an unrecognised schema version the
 * function returns default settings without throwing.
 */
export function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultSettings();

    const envelope: unknown = JSON.parse(raw);
    if (!isValidEnvelope(envelope)) return defaultSettings();

    // Merge with defaults so any newly-added fields get a value.
    return mergeWithDefaults(envelope.settings);
  } catch {
    // JSON parse error or any other runtime issue — fall back to defaults.
    return defaultSettings();
  }
}

/**
 * Persist settings to the dedicated localStorage key.
 *
 * Wraps the settings in an envelope with a schema version so future
 * migrations can detect and upgrade the format.
 */
export function saveSettings(settings: PersistedSettings): void {
  const envelope: SettingsEnvelope = {
    version: SCHEMA_VERSION,
    settings,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

/**
 * One-time migration helper: extract settings from an existing GameState
 * object (e.g. a loaded save) and write them to the dedicated key.
 *
 * Only writes if the dedicated key does not already exist, so a previously
 * persisted independent store is never overwritten by stale save data.
 *
 * @param gameState  Any object with the legacy settings fields (typically the
 *                   result of loading a save slot).  Missing fields are filled
 *                   from defaults.
 */
export function migrateSettings(gameState: Record<string, unknown>): void {
  // Do not overwrite an existing dedicated store.
  if (localStorage.getItem(STORAGE_KEY) !== null) return;

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

  saveSettings(settings);
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
  return (
    typeof obj.version === 'number' &&
    obj.version === SCHEMA_VERSION &&
    obj.settings !== null &&
    typeof obj.settings === 'object'
  );
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
