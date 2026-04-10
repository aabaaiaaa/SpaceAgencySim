/**
 * settingsStore.test.ts — Unit tests for the independent settings persistence module.
 *
 * Covers:
 *   - Read/write round-trip
 *   - Default values when no settings exist
 *   - Corrupt data handling (invalid JSON)
 *   - Invalid envelope handling (missing version/settings field)
 *   - Wrong version handling
 *   - Migration from old save format
 *   - Migration doesn't overwrite existing settings
 *   - Partial settings merge with defaults
 *   - Independent persistence (survives unrelated localStorage changes)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadSettings,
  saveSettings,
  migrateSettings,
} from '../core/settingsStore.ts';
import type { PersistedSettings } from '../core/settingsStore.ts';
import { DEFAULT_DIFFICULTY_SETTINGS, MalfunctionMode } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

/**
 * A simple in-memory localStorage replacement that fulfils the subset of the
 * Web Storage API used by settingsStore.ts (getItem / setItem / removeItem).
 */
function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
    setItem(key: string, value: string) { store.set(key, String(value)); },
    removeItem(key: string) { store.delete(key); },
    clear() { store.clear(); },
    get length() { return store.size; },
  };
}

let mockStorage: ReturnType<typeof createLocalStorageMock>;

beforeEach(() => {
  mockStorage = createLocalStorageMock();
  vi.stubGlobal('localStorage', mockStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The localStorage key used by settingsStore.ts. */
const STORAGE_KEY = 'spaceAgency_settings';

/** Returns a non-default settings object for testing round-trips. */
function customSettings(): PersistedSettings {
  return {
    difficultySettings: {
      ...DEFAULT_DIFFICULTY_SETTINGS,
      malfunctionFrequency: 'high' as typeof DEFAULT_DIFFICULTY_SETTINGS.malfunctionFrequency,
    },
    autoSaveEnabled: false,
    debugMode: true,
    showPerfDashboard: true,
    malfunctionMode: MalfunctionMode.FORCED,
  };
}

/** Returns the expected default settings. */
function expectedDefaults(): PersistedSettings {
  return {
    difficultySettings: { ...DEFAULT_DIFFICULTY_SETTINGS },
    autoSaveEnabled: true,
    debugMode: false,
    showPerfDashboard: false,
    malfunctionMode: MalfunctionMode.NORMAL,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settingsStore', () => {

  // -----------------------------------------------------------------------
  // 1. Read/write round-trip
  // -----------------------------------------------------------------------

  describe('round-trip', () => {
    it('should save settings and load them back identically @smoke', () => {
      const settings = customSettings();
      saveSettings(settings);

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Default values when no settings exist
  // -----------------------------------------------------------------------

  describe('default values', () => {
    it('should return default settings when localStorage is empty', () => {
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 3. Corrupt data handling
  // -----------------------------------------------------------------------

  describe('corrupt data handling', () => {
    it('should return defaults when stored value is invalid JSON', () => {
      mockStorage.setItem(STORAGE_KEY, '{not valid json!!!');

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when stored value is a bare string', () => {
      mockStorage.setItem(STORAGE_KEY, '"just a string"');

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 4. Invalid envelope handling
  // -----------------------------------------------------------------------

  describe('invalid envelope handling', () => {
    it('should return defaults when envelope has no version field', () => {
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        settings: expectedDefaults(),
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when envelope has no settings field', () => {
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when envelope settings field is null', () => {
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings: null,
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when stored value is null JSON', () => {
      mockStorage.setItem(STORAGE_KEY, 'null');

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 5. Wrong version handling
  // -----------------------------------------------------------------------

  describe('wrong version handling', () => {
    it('should return defaults when envelope has version 0', () => {
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 0,
        settings: customSettings(),
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when envelope has version 99 (future version) and log a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 99,
        settings: customSettings(),
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/newer schema version.*99/);

      warnSpy.mockRestore();
    });

    it('should return defaults when version is a string instead of number', () => {
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: '1',
        settings: customSettings(),
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 5b. Schema migration infrastructure
  // -----------------------------------------------------------------------

  describe('schema migration', () => {
    it('should pass a version-1 envelope through the migration path unchanged', () => {
      const settings = customSettings();
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings,
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });

    it('should reject version < 1 and return defaults', () => {
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: -1,
        settings: customSettings(),
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should reject version 0 and return defaults', () => {
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 0,
        settings: customSettings(),
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should reject version > SCHEMA_VERSION with a console warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 50,
        settings: customSettings(),
      }));

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/newer schema version.*50/);

      warnSpy.mockRestore();
    });

    it('should load valid settings through the full migration code path', () => {
      // Write a valid version-1 envelope with non-default settings and verify
      // it loads correctly through isValidEnvelope -> _migrateSettings -> mergeWithDefaults.
      const settings = customSettings();
      mockStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings,
      }));

      const loaded = loadSettings();
      expect(loaded.autoSaveEnabled).to.equal(false);
      expect(loaded.debugMode).to.equal(true);
      expect(loaded.showPerfDashboard).to.equal(true);
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.FORCED);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Migration from old save format
  // -----------------------------------------------------------------------

  describe('migrateSettings', () => {
    it('should extract legacy settings from gameState and persist them @smoke', () => {
      const legacyState: Record<string, unknown> = {
        autoSaveEnabled: false,
        debugMode: true,
        showPerfDashboard: true,
        malfunctionMode: MalfunctionMode.OFF,
        difficultySettings: {
          ...DEFAULT_DIFFICULTY_SETTINGS,
          malfunctionFrequency: 'high',
        },
      };

      migrateSettings(legacyState);

      const loaded = loadSettings();
      expect(loaded.autoSaveEnabled).to.equal(false);
      expect(loaded.debugMode).to.equal(true);
      expect(loaded.showPerfDashboard).to.equal(true);
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.OFF);
      expect(loaded.difficultySettings.malfunctionFrequency).to.equal('high');
    });

    it('should fill missing legacy fields with defaults', () => {
      const legacyState: Record<string, unknown> = {
        debugMode: true,
        // autoSaveEnabled, showPerfDashboard, malfunctionMode, difficultySettings all missing
      };

      migrateSettings(legacyState);

      const loaded = loadSettings();
      expect(loaded.debugMode).to.equal(true);
      expect(loaded.autoSaveEnabled).to.equal(true); // default
      expect(loaded.showPerfDashboard).to.equal(false); // default
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.NORMAL); // default
      expect(loaded.difficultySettings).to.deep.equal({ ...DEFAULT_DIFFICULTY_SETTINGS });
    });

    it('should handle empty gameState by persisting all defaults', () => {
      migrateSettings({});

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should ignore non-boolean values for boolean fields', () => {
      const legacyState: Record<string, unknown> = {
        autoSaveEnabled: 'yes',  // string, not boolean
        debugMode: 1,            // number, not boolean
      };

      migrateSettings(legacyState);

      const loaded = loadSettings();
      expect(loaded.autoSaveEnabled).to.equal(true);  // default, not 'yes'
      expect(loaded.debugMode).to.equal(false);         // default, not 1
    });

    // -------------------------------------------------------------------
    // 7. Migration doesn't overwrite existing
    // -------------------------------------------------------------------

    it('should not overwrite existing settings when dedicated key already exists', () => {
      const original = customSettings();
      saveSettings(original);

      // Attempt migration with different values
      const legacyState: Record<string, unknown> = {
        autoSaveEnabled: true,
        debugMode: false,
        showPerfDashboard: false,
        malfunctionMode: MalfunctionMode.NORMAL,
      };

      migrateSettings(legacyState);

      const loaded = loadSettings();
      // Should still be the original custom settings, not the legacy ones
      expect(loaded).to.deep.equal(original);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Partial settings merge with defaults
  // -----------------------------------------------------------------------

  describe('partial settings merge with defaults', () => {
    it('should fill in missing fields from defaults', () => {
      // Manually write an envelope with a partial settings object
      const partialEnvelope = {
        version: 1,
        settings: {
          autoSaveEnabled: false,
          debugMode: true,
          // showPerfDashboard, malfunctionMode, difficultySettings are missing
        },
      };
      mockStorage.setItem(STORAGE_KEY, JSON.stringify(partialEnvelope));

      const loaded = loadSettings();
      expect(loaded.autoSaveEnabled).to.equal(false);
      expect(loaded.debugMode).to.equal(true);
      expect(loaded.showPerfDashboard).to.equal(false);  // default
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.NORMAL);  // default
      expect(loaded.difficultySettings).to.deep.equal({ ...DEFAULT_DIFFICULTY_SETTINGS }); // default
    });

    it('should merge partial difficultySettings with defaults', () => {
      const partialEnvelope = {
        version: 1,
        settings: {
          difficultySettings: {
            malfunctionFrequency: 'high',
            // weatherSeverity, financialPressure, injuryDuration are missing
          },
        },
      };
      mockStorage.setItem(STORAGE_KEY, JSON.stringify(partialEnvelope));

      const loaded = loadSettings();
      expect(loaded.difficultySettings.malfunctionFrequency).to.equal('high');
      expect(loaded.difficultySettings.weatherSeverity).to.equal(DEFAULT_DIFFICULTY_SETTINGS.weatherSeverity);
      expect(loaded.difficultySettings.financialPressure).to.equal(DEFAULT_DIFFICULTY_SETTINGS.financialPressure);
      expect(loaded.difficultySettings.injuryDuration).to.equal(DEFAULT_DIFFICULTY_SETTINGS.injuryDuration);
    });

    it('should use default difficultySettings when stored value is not an object', () => {
      const partialEnvelope = {
        version: 1,
        settings: {
          difficultySettings: 'invalid',
          autoSaveEnabled: false,
        },
      };
      mockStorage.setItem(STORAGE_KEY, JSON.stringify(partialEnvelope));

      const loaded = loadSettings();
      expect(loaded.difficultySettings).to.deep.equal({ ...DEFAULT_DIFFICULTY_SETTINGS });
      expect(loaded.autoSaveEnabled).to.equal(false);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Independent persistence
  // -----------------------------------------------------------------------

  describe('independent persistence', () => {
    it('should survive clearing unrelated localStorage keys', () => {
      const settings = customSettings();
      saveSettings(settings);

      // Add and then remove unrelated keys
      mockStorage.setItem('someOtherApp_data', '{}');
      mockStorage.setItem('spaceAgency_save_0', '{"state":{}}');
      mockStorage.removeItem('someOtherApp_data');
      mockStorage.removeItem('spaceAgency_save_0');

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });

    it('should persist independently of save slot data', () => {
      const settings = customSettings();
      saveSettings(settings);

      // Simulate clearing all save slots without affecting settings
      for (let i = 0; i < 5; i++) {
        mockStorage.removeItem(`spaceAgency_save_${i}`);
      }

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });
  });
});
