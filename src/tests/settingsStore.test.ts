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
 *   - Independent persistence (survives unrelated IDB key changes)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory IDB mock — shared between mock factory and test code
// ---------------------------------------------------------------------------

const _idbStore = new Map<string, string>();

vi.mock('../core/idbStorage.js', () => ({
  idbSet: vi.fn((key: string, value: string) => {
    _idbStore.set(key, value);
    return Promise.resolve();
  }),
  idbGet: vi.fn((key: string) => {
    return Promise.resolve(_idbStore.has(key) ? _idbStore.get(key)! : null);
  }),
  idbDelete: vi.fn((key: string) => {
    _idbStore.delete(key);
    return Promise.resolve();
  }),
  idbGetAllKeys: vi.fn(() => {
    return Promise.resolve([..._idbStore.keys()]);
  }),
}));

import {
  initSettings,
  loadSettings,
  saveSettings,
  migrateSettings,
  _resetCacheForTesting,
} from '../core/settingsStore.ts';
import type { PersistedSettings } from '../core/settingsStore.ts';
import { DEFAULT_DIFFICULTY_SETTINGS, MalfunctionMode } from '../core/constants.ts';
import { StorageQuotaError } from '../core/saveload.ts';
import { idbSet } from '../core/idbStorage.ts';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _idbStore.clear();
  _resetCacheForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The IDB key used by settingsStore.ts. */
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
    it('should save settings and load them back identically @smoke', async () => {
      const settings = customSettings();
      await saveSettings(settings);

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Default values when no settings exist
  // -----------------------------------------------------------------------

  describe('default values', () => {
    it('should return default settings when IDB is empty', async () => {
      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 3. Corrupt data handling
  // -----------------------------------------------------------------------

  describe('corrupt data handling', () => {
    it('should return defaults when stored value is invalid JSON', async () => {
      _idbStore.set(STORAGE_KEY, '{not valid json!!!');

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when stored value is a bare string', async () => {
      _idbStore.set(STORAGE_KEY, '"just a string"');

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 4. Invalid envelope handling
  // -----------------------------------------------------------------------

  describe('invalid envelope handling', () => {
    it('should return defaults when envelope has no version field', async () => {
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        settings: expectedDefaults(),
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when envelope has no settings field', async () => {
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 1,
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when envelope settings field is null', async () => {
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings: null,
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when stored value is null JSON', async () => {
      _idbStore.set(STORAGE_KEY, 'null');

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 5. Wrong version handling
  // -----------------------------------------------------------------------

  describe('wrong version handling', () => {
    it('should return defaults when envelope has version 0', async () => {
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 0,
        settings: customSettings(),
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should return defaults when envelope has version 99 (future version) and log a warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 99,
        settings: customSettings(),
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/newer schema version.*99/);

      warnSpy.mockRestore();
    });

    it('should return defaults when version is a string instead of number', async () => {
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: '1',
        settings: customSettings(),
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });
  });

  // -----------------------------------------------------------------------
  // 5b. Schema migration infrastructure
  // -----------------------------------------------------------------------

  describe('schema migration', () => {
    it('should pass a version-1 envelope through the migration path unchanged', async () => {
      const settings = customSettings();
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings,
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });

    it('should reject version < 1 and return defaults', async () => {
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: -1,
        settings: customSettings(),
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should reject version 0 and return defaults', async () => {
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 0,
        settings: customSettings(),
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
    });

    it('should reject version > SCHEMA_VERSION with a console warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 50,
        settings: customSettings(),
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(warnSpy.mock.calls[0][0]).toMatch(/newer schema version.*50/);

      warnSpy.mockRestore();
    });

    it('should load valid settings through the full migration code path', async () => {
      // Write a valid version-1 envelope with non-default settings and verify
      // it loads correctly through isValidEnvelope -> _migrateSettings -> mergeWithDefaults.
      const settings = customSettings();
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings,
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded.autoSaveEnabled).to.equal(false);
      expect(loaded.debugMode).to.equal(true);
      expect(loaded.showPerfDashboard).to.equal(true);
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.FORCED);
    });

    it('should fill missing fields from defaults after migration (partial envelope)', async () => {
      // Save an envelope at version 1 with only autoSaveEnabled and debugMode.
      // The migration pipeline (isValidEnvelope -> _migrateSettings -> mergeWithDefaults)
      // should preserve the specified fields and fill the rest from defaults.
      const partialEnvelope = {
        version: 1,
        settings: {
          autoSaveEnabled: false,
          debugMode: true,
        },
      };
      _idbStore.set(STORAGE_KEY, JSON.stringify(partialEnvelope));

      await initSettings();
      const loaded = loadSettings();

      // Specified fields retain their saved values
      expect(loaded.autoSaveEnabled).to.equal(false);
      expect(loaded.debugMode).to.equal(true);

      // Missing fields filled from defaults
      expect(loaded.showPerfDashboard).to.equal(false);
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.NORMAL);
      expect(loaded.difficultySettings).to.deep.equal({ ...DEFAULT_DIFFICULTY_SETTINGS });
    });

    it('should preserve all fields exactly when a version-1 envelope has every field populated', async () => {
      // A fully-populated version-1 envelope should pass through the migration
      // pipeline completely unchanged — no field should be overwritten by defaults.
      const settings = customSettings();
      _idbStore.set(STORAGE_KEY, JSON.stringify({
        version: 1,
        settings,
      }));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
      // Verify individual fields to confirm nothing was silently replaced
      expect(loaded.autoSaveEnabled).to.equal(false);
      expect(loaded.debugMode).to.equal(true);
      expect(loaded.showPerfDashboard).to.equal(true);
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.FORCED);
      expect(loaded.difficultySettings.malfunctionFrequency).to.equal('high');
    });

    it('should fill all fields from defaults when version-1 envelope has an empty settings object', async () => {
      // An empty settings object is still a valid object — the envelope passes
      // isValidEnvelope, _migrateSettings is a no-op (version already 1), and
      // mergeWithDefaults fills every field from defaults.
      const emptyEnvelope = {
        version: 1,
        settings: {},
      };
      _idbStore.set(STORAGE_KEY, JSON.stringify(emptyEnvelope));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded).to.deep.equal(expectedDefaults());
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

    it('should not overwrite existing settings when dedicated key already exists', async () => {
      const original = customSettings();
      await saveSettings(original);

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
    it('should fill in missing fields from defaults', async () => {
      // Manually write an envelope with a partial settings object
      const partialEnvelope = {
        version: 1,
        settings: {
          autoSaveEnabled: false,
          debugMode: true,
          // showPerfDashboard, malfunctionMode, difficultySettings are missing
        },
      };
      _idbStore.set(STORAGE_KEY, JSON.stringify(partialEnvelope));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded.autoSaveEnabled).to.equal(false);
      expect(loaded.debugMode).to.equal(true);
      expect(loaded.showPerfDashboard).to.equal(false);  // default
      expect(loaded.malfunctionMode).to.equal(MalfunctionMode.NORMAL);  // default
      expect(loaded.difficultySettings).to.deep.equal({ ...DEFAULT_DIFFICULTY_SETTINGS }); // default
    });

    it('should merge partial difficultySettings with defaults', async () => {
      const partialEnvelope = {
        version: 1,
        settings: {
          difficultySettings: {
            malfunctionFrequency: 'high',
            // weatherSeverity, financialPressure, injuryDuration are missing
          },
        },
      };
      _idbStore.set(STORAGE_KEY, JSON.stringify(partialEnvelope));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded.difficultySettings.malfunctionFrequency).to.equal('high');
      expect(loaded.difficultySettings.weatherSeverity).to.equal(DEFAULT_DIFFICULTY_SETTINGS.weatherSeverity);
      expect(loaded.difficultySettings.financialPressure).to.equal(DEFAULT_DIFFICULTY_SETTINGS.financialPressure);
      expect(loaded.difficultySettings.injuryDuration).to.equal(DEFAULT_DIFFICULTY_SETTINGS.injuryDuration);
    });

    it('should use default difficultySettings when stored value is not an object', async () => {
      const partialEnvelope = {
        version: 1,
        settings: {
          difficultySettings: 'invalid',
          autoSaveEnabled: false,
        },
      };
      _idbStore.set(STORAGE_KEY, JSON.stringify(partialEnvelope));

      await initSettings();
      const loaded = loadSettings();
      expect(loaded.difficultySettings).to.deep.equal({ ...DEFAULT_DIFFICULTY_SETTINGS });
      expect(loaded.autoSaveEnabled).to.equal(false);
    });
  });

  // -----------------------------------------------------------------------
  // 8b. QuotaExceededError propagation
  // -----------------------------------------------------------------------

  describe('QuotaExceededError propagation', () => {
    it('throws StorageQuotaError when idbSet throws QuotaExceededError', async () => {
      const quotaErr = Object.assign(new Error('The quota has been exceeded.'), {
        name: 'QuotaExceededError',
      });
      vi.mocked(idbSet).mockRejectedValueOnce(quotaErr);

      await expect(saveSettings(customSettings())).rejects.toBeInstanceOf(StorageQuotaError);
    });

    it('StorageQuotaError preserves the original error as cause', async () => {
      const quotaErr = Object.assign(new Error('The quota has been exceeded.'), {
        name: 'QuotaExceededError',
      });
      vi.mocked(idbSet).mockRejectedValueOnce(quotaErr);

      try {
        await saveSettings(customSettings());
        expect.fail('saveSettings should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(StorageQuotaError);
        expect((err as StorageQuotaError).cause).to.equal(quotaErr);
      }
    });

    it('rethrows non-quota errors unchanged', async () => {
      const genericErr = new Error('Connection lost');
      vi.mocked(idbSet).mockRejectedValueOnce(genericErr);

      await expect(saveSettings(customSettings())).rejects.toBe(genericErr);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Independent persistence
  // -----------------------------------------------------------------------

  describe('independent persistence', () => {
    it('should survive clearing unrelated IDB keys', async () => {
      const settings = customSettings();
      await saveSettings(settings);

      // Add and then remove unrelated keys
      _idbStore.set('someOtherApp_data', '{}');
      _idbStore.set('spaceAgency_save_0', '{"state":{}}');
      _idbStore.delete('someOtherApp_data');
      _idbStore.delete('spaceAgency_save_0');

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });

    it('should persist independently of save slot data', async () => {
      const settings = customSettings();
      await saveSettings(settings);

      // Simulate clearing all save slots without affecting settings
      for (let i = 0; i < 5; i++) {
        _idbStore.delete(`spaceAgency_save_${i}`);
      }

      const loaded = loadSettings();
      expect(loaded).to.deep.equal(settings);
    });
  });
});
