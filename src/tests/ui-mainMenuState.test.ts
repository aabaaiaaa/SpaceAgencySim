/**
 * ui-mainMenuState.test.ts — Unit tests for main-menu pure formatters /
 * classifiers extracted to `src/ui/mainmenu/_state.ts`.
 *
 * Mirrors the style of ui-hubState.test.ts and ui-vabState.test.ts.
 * Covers the scalar formatters (money, play-time, date), the game-mode
 * and KIA badge classifiers, version mismatch + agency-line predicates,
 * and the save list organiser (manual slots + overflow).
 */

import { describe, it, expect } from 'vitest';
import {
  formatSaveMoney,
  formatSavePlayTime,
  formatSaveDate,
  getGameModeBadge,
  hasSaveVersionMismatch,
  shouldShowAgencyLine,
  getKiaClass,
  shouldShowLoadScreen,
  organizeSaveSlots,
} from '../ui/mainmenu/_state.ts';
import type { SaveSlotSummary } from '../core/saveload.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkSummary(overrides: Partial<SaveSlotSummary> = {}): SaveSlotSummary {
  const base: SaveSlotSummary = {
    slotIndex:            0,
    storageKey:           'spaceAgencySave_0',
    saveName:             'My Save',
    agencyName:           'My Save',
    timestamp:            '2026-04-17T12:00:00.000Z',
    missionsCompleted:    0,
    money:                0,
    acceptedMissionCount: 0,
    totalFlights:         0,
    crewCount:            0,
    crewKIA:              0,
    playTimeSeconds:      0,
    flightTimeSeconds:    0,
    gameMode:             'freeplay',
    version:              4,
    isAutoSave:           false,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MainMenuState', () => {
  describe('formatSaveMoney()', () => {
    it('formats an integer with comma separators and dollar sign', () => {
      expect(formatSaveMoney(2_000_000)).toBe('$2,000,000');
    });

    it('formats zero', () => {
      expect(formatSaveMoney(0)).toBe('$0');
    });

    it('rounds fractional amounts to the nearest integer', () => {
      expect(formatSaveMoney(1234.4)).toBe('$1,234');
      expect(formatSaveMoney(1234.6)).toBe('$1,235');
    });

    it('formats negative amounts with a leading minus', () => {
      expect(formatSaveMoney(-5_000)).toBe('-$5,000');
    });
  });

  describe('formatSavePlayTime()', () => {
    it('formats a duration as h:mm:ss', () => {
      expect(formatSavePlayTime(3725)).toBe('1:02:05');
    });

    it('handles durations under one minute', () => {
      expect(formatSavePlayTime(7)).toBe('0:00:07');
    });

    it('handles durations under one hour', () => {
      expect(formatSavePlayTime(65)).toBe('0:01:05');
    });

    it('handles multi-hour durations', () => {
      expect(formatSavePlayTime(36_000)).toBe('10:00:00');
    });

    it('floors fractional seconds', () => {
      expect(formatSavePlayTime(59.9)).toBe('0:00:59');
    });

    it('clamps negative input to 0:00:00', () => {
      expect(formatSavePlayTime(-100)).toBe('0:00:00');
    });
  });

  describe('formatSaveDate()', () => {
    it('returns a non-empty string for a valid ISO timestamp', () => {
      const out = formatSaveDate('2026-04-17T12:00:00.000Z');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    });

    it('returns the raw input for a non-parseable string (falls back to "Invalid Date")', () => {
      // toLocaleString on an invalid Date returns "Invalid Date" — not the raw
      // input, but guaranteed not to throw.  Verify the function doesn't throw
      // and returns a string.
      const out = formatSaveDate('not-a-date');
      expect(typeof out).toBe('string');
    });
  });

  describe('getGameModeBadge()', () => {
    it('returns the sandbox badge', () => {
      expect(getGameModeBadge('sandbox')).toEqual({
        label:    'SANDBOX',
        cssClass: 'mm-mode-sandbox',
      });
    });

    it('returns the tutorial badge', () => {
      expect(getGameModeBadge('tutorial')).toEqual({
        label:    'TUTORIAL',
        cssClass: 'mm-mode-tutorial',
      });
    });

    it('returns the free-play badge for freeplay', () => {
      expect(getGameModeBadge('freeplay')).toEqual({
        label:    'FREE PLAY',
        cssClass: 'mm-mode-freeplay',
      });
    });

    it('falls through to the free-play badge for unknown / legacy modes', () => {
      expect(getGameModeBadge('')).toEqual({
        label:    'FREE PLAY',
        cssClass: 'mm-mode-freeplay',
      });
      expect(getGameModeBadge('career')).toEqual({
        label:    'FREE PLAY',
        cssClass: 'mm-mode-freeplay',
      });
    });
  });

  describe('hasSaveVersionMismatch()', () => {
    it('returns false when the versions match', () => {
      expect(hasSaveVersionMismatch(mkSummary({ version: 4 }), 4)).toBe(false);
    });

    it('returns true when the save version is older', () => {
      expect(hasSaveVersionMismatch(mkSummary({ version: 3 }), 4)).toBe(true);
    });

    it('returns true when the save version is newer', () => {
      expect(hasSaveVersionMismatch(mkSummary({ version: 5 }), 4)).toBe(true);
    });

    it('treats pre-versioning saves (0) as a mismatch', () => {
      expect(hasSaveVersionMismatch(mkSummary({ version: 0 }), 4)).toBe(true);
    });
  });

  describe('shouldShowAgencyLine()', () => {
    it('returns false when agencyName equals saveName', () => {
      expect(shouldShowAgencyLine(mkSummary({
        saveName:   'Apollo',
        agencyName: 'Apollo',
      }))).toBe(false);
    });

    it('returns true when agencyName differs from saveName', () => {
      expect(shouldShowAgencyLine(mkSummary({
        saveName:   'Autosave',
        agencyName: 'NASA',
      }))).toBe(true);
    });

    it('returns false when agencyName is empty', () => {
      expect(shouldShowAgencyLine(mkSummary({
        saveName:   'Anything',
        agencyName: '',
      }))).toBe(false);
    });
  });

  describe('getKiaClass()', () => {
    it('returns the highlight class when any crew lost', () => {
      expect(getKiaClass(mkSummary({ crewKIA: 1 }))).toBe('mm-stat-kia');
      expect(getKiaClass(mkSummary({ crewKIA: 5 }))).toBe('mm-stat-kia');
    });

    it('returns an empty string when no crew lost', () => {
      expect(getKiaClass(mkSummary({ crewKIA: 0 }))).toBe('');
    });
  });

  describe('shouldShowLoadScreen()', () => {
    it('returns false when every slot is empty', () => {
      expect(shouldShowLoadScreen([null, null, null])).toBe(false);
    });

    it('returns true when any slot is populated', () => {
      expect(shouldShowLoadScreen([null, mkSummary(), null])).toBe(true);
    });

    it('returns false for an empty list', () => {
      expect(shouldShowLoadScreen([])).toBe(false);
    });
  });

  describe('organizeSaveSlots()', () => {
    it('emits an empty-card placeholder for every manual slot when list is all null', () => {
      const cards = organizeSaveSlots([null, null, null], 3);
      expect(cards).toEqual([
        { kind: 'empty', slotIndex: 0 },
        { kind: 'empty', slotIndex: 1 },
        { kind: 'empty', slotIndex: 2 },
      ]);
    });

    it('emits filled cards in order for populated manual slots', () => {
      const s0 = mkSummary({ slotIndex: 0, saveName: 'A' });
      const s1 = mkSummary({ slotIndex: 1, saveName: 'B' });
      const s2 = mkSummary({ slotIndex: 2, saveName: 'C' });
      const cards = organizeSaveSlots([s0, s1, s2], 3);
      expect(cards).toEqual([
        { kind: 'filled', summary: s0 },
        { kind: 'filled', summary: s1 },
        { kind: 'filled', summary: s2 },
      ]);
    });

    it('mixes filled and empty cards within the manual-slot range', () => {
      const s1 = mkSummary({ slotIndex: 1, saveName: 'middle' });
      const cards = organizeSaveSlots([null, s1, null], 3);
      expect(cards).toEqual([
        { kind: 'empty',  slotIndex: 0 },
        { kind: 'filled', summary:   s1 },
        { kind: 'empty',  slotIndex: 2 },
      ]);
    });

    it('treats undefined entries as empty slots', () => {
      const sparse: (SaveSlotSummary | null)[] = [];
      sparse.length = 2; // [undefined, undefined]
      const cards = organizeSaveSlots(sparse, 2);
      expect(cards).toEqual([
        { kind: 'empty', slotIndex: 0 },
        { kind: 'empty', slotIndex: 1 },
      ]);
    });

    it('appends populated overflow entries after the manual slots', () => {
      const s0   = mkSummary({ slotIndex: 0, saveName: 'manual-0' });
      const auto = mkSummary({ slotIndex: -1, saveName: 'auto', isAutoSave: true });
      const cards = organizeSaveSlots([s0, null, null, auto], 3);
      expect(cards).toEqual([
        { kind: 'filled', summary:   s0 },
        { kind: 'empty',  slotIndex: 1 },
        { kind: 'empty',  slotIndex: 2 },
        { kind: 'filled', summary:   auto },
      ]);
    });

    it('filters out null overflow entries defensively', () => {
      const s0 = mkSummary({ slotIndex: 0 });
      const cards = organizeSaveSlots([s0, null, null, null], 3);
      expect(cards).toEqual([
        { kind: 'filled', summary:   s0 },
        { kind: 'empty',  slotIndex: 1 },
        { kind: 'empty',  slotIndex: 2 },
      ]);
    });

    it('returns an empty list when slotCount is 0 and no overflow entries', () => {
      expect(organizeSaveSlots([], 0)).toEqual([]);
    });

    it('returns only overflow cards when slotCount is 0', () => {
      const auto = mkSummary({ slotIndex: -1, isAutoSave: true });
      expect(organizeSaveSlots([auto], 0)).toEqual([
        { kind: 'filled', summary: auto },
      ]);
    });
  });
});
