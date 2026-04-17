// @vitest-environment jsdom
/**
 * ui-topbarState.test.ts — Unit tests for topbar state management and
 * pure formatters.
 *
 * Mirrors ui-vabState.test.ts style.  Tests getTopbarState(),
 * setTopbarState(), resetTopbarState(), the pure formatters (cash,
 * money color, rate, missions badge), screen → help section mapping,
 * save-slot compatibility check, and the document-backed dropdown /
 * modal visibility helpers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MONEY_HEALTH_THRESHOLDS,
  getTopbarState,
  setTopbarState,
  resetTopbarState,
  formatCash,
  moneyColor,
  formatRate,
  formatMissionsBadge,
  SCREEN_TO_HELP_SECTION,
  helpSectionForScreen,
  isSaveCompatible,
  DROPDOWN_ID,
  MISSIONS_DROPDOWN_ID,
  MODAL_BACKDROP_IDS,
  isDropdownOpen,
  isMissionsDropdownOpen,
  isAnyModalOpen,
} from '../ui/topbar/_state.ts';

describe('TopbarState', () => {
  beforeEach(() => {
    resetTopbarState();
    document.body.innerHTML = '';
  });

  describe('MONEY_HEALTH_THRESHOLDS', () => {
    it('danger is below warning', () => {
      expect(MONEY_HEALTH_THRESHOLDS.danger).toBeLessThan(MONEY_HEALTH_THRESHOLDS.warning);
    });

    it('has expected values', () => {
      expect(MONEY_HEALTH_THRESHOLDS.danger).toBe(20_000);
      expect(MONEY_HEALTH_THRESHOLDS.warning).toBe(100_000);
    });
  });

  describe('getTopbarState()', () => {
    it('returns a state object', () => {
      const s = getTopbarState();
      expect(s).toBeDefined();
      expect(typeof s).toBe('object');
    });

    it('returns the same object on multiple calls', () => {
      expect(getTopbarState()).toBe(getTopbarState());
    });

    it('defaults currentScreen to "hub"', () => {
      expect(getTopbarState().currentScreen).toBe('hub');
    });
  });

  describe('setTopbarState()', () => {
    it('patches currentScreen', () => {
      setTopbarState({ currentScreen: 'vab' });
      expect(getTopbarState().currentScreen).toBe('vab');
    });

    it('preserves object identity after patching', () => {
      const before = getTopbarState();
      setTopbarState({ currentScreen: 'flight' });
      expect(getTopbarState()).toBe(before);
    });
  });

  describe('resetTopbarState()', () => {
    it('restores currentScreen to "hub"', () => {
      setTopbarState({ currentScreen: 'mission-control' });
      resetTopbarState();
      expect(getTopbarState().currentScreen).toBe('hub');
    });

    it('preserves the same object reference (mutates in place)', () => {
      const before = getTopbarState();
      setTopbarState({ currentScreen: 'crew-admin' });
      resetTopbarState();
      expect(getTopbarState()).toBe(before);
    });
  });

  describe('formatCash()', () => {
    it('formats zero', () => {
      expect(formatCash(0)).toBe('$0');
    });

    it('formats small amounts without separator', () => {
      expect(formatCash(123)).toBe('$123');
    });

    it('inserts thousands separators', () => {
      expect(formatCash(1_234_567)).toBe('$1,234,567');
    });

    it('rounds non-integer inputs', () => {
      expect(formatCash(1999.4)).toBe('$1,999');
      expect(formatCash(1999.6)).toBe('$2,000');
    });

    it('handles negative values', () => {
      expect(formatCash(-1500)).toBe('$-1,500');
    });
  });

  describe('moneyColor()', () => {
    it('returns danger below the danger threshold', () => {
      expect(moneyColor(0)).toBe('var(--color-danger-text)');
      expect(moneyColor(MONEY_HEALTH_THRESHOLDS.danger - 1)).toBe('var(--color-danger-text)');
    });

    it('returns warning between danger and warning thresholds', () => {
      expect(moneyColor(MONEY_HEALTH_THRESHOLDS.danger)).toBe('var(--color-warning)');
      expect(moneyColor(MONEY_HEALTH_THRESHOLDS.warning - 1)).toBe('var(--color-warning)');
    });

    it('returns money above the warning threshold', () => {
      expect(moneyColor(MONEY_HEALTH_THRESHOLDS.warning)).toBe('var(--color-money)');
      expect(moneyColor(1_000_000)).toBe('var(--color-money)');
    });
  });

  describe('formatRate()', () => {
    it('formats zero', () => {
      expect(formatRate(0)).toBe('0%');
    });

    it('formats common rates as whole percent', () => {
      expect(formatRate(0.05)).toBe('5%');
      expect(formatRate(0.12)).toBe('12%');
      expect(formatRate(1)).toBe('100%');
    });

    it('rounds fractional percentages', () => {
      expect(formatRate(0.126)).toBe('13%');
    });
  });

  describe('formatMissionsBadge()', () => {
    it('returns plain label and false when count is 0', () => {
      expect(formatMissionsBadge(0)).toEqual({
        label: 'Missions',
        hasMissions: false,
      });
    });

    it('embeds count in label when positive', () => {
      expect(formatMissionsBadge(1)).toEqual({
        label: 'Missions (1)',
        hasMissions: true,
      });
      expect(formatMissionsBadge(7)).toEqual({
        label: 'Missions (7)',
        hasMissions: true,
      });
    });
  });

  describe('SCREEN_TO_HELP_SECTION', () => {
    it('maps the known screens', () => {
      expect(SCREEN_TO_HELP_SECTION['hub']).toBe('overview');
      expect(SCREEN_TO_HELP_SECTION['vab']).toBe('vab');
      expect(SCREEN_TO_HELP_SECTION['flight']).toBe('flight');
      expect(SCREEN_TO_HELP_SECTION['mission-control']).toBe('missions');
      expect(SCREEN_TO_HELP_SECTION['crew-admin']).toBe('crew');
    });
  });

  describe('helpSectionForScreen()', () => {
    it('returns the mapped section for known screens', () => {
      expect(helpSectionForScreen('vab')).toBe('vab');
      expect(helpSectionForScreen('satellite-ops')).toBe('satellites');
      expect(helpSectionForScreen('launch-pad')).toBe('vab');
    });

    it('falls back to "overview" for unknown screens', () => {
      expect(helpSectionForScreen('nonexistent')).toBe('overview');
      expect(helpSectionForScreen('')).toBe('overview');
    });
  });

  describe('isSaveCompatible()', () => {
    it('returns true when versions match', () => {
      expect(isSaveCompatible(3, 3)).toBe(true);
    });

    it('returns false when versions differ', () => {
      expect(isSaveCompatible(2, 3)).toBe(false);
      expect(isSaveCompatible(4, 3)).toBe(false);
    });
  });

  describe('dropdown / modal id constants', () => {
    it('DROPDOWN_ID is the hamburger dropdown id', () => {
      expect(DROPDOWN_ID).toBe('topbar-dropdown');
    });

    it('MISSIONS_DROPDOWN_ID is the missions dropdown id', () => {
      expect(MISSIONS_DROPDOWN_ID).toBe('topbar-missions-dropdown');
    });

    it('MODAL_BACKDROP_IDS is a non-empty list of unique strings', () => {
      expect(MODAL_BACKDROP_IDS.length).toBeGreaterThan(0);
      expect(new Set(MODAL_BACKDROP_IDS).size).toBe(MODAL_BACKDROP_IDS.length);
    });
  });

  describe('isDropdownOpen()', () => {
    it('returns false when no dropdown element exists', () => {
      expect(isDropdownOpen()).toBe(false);
    });

    it('returns true when the dropdown element is mounted', () => {
      const el = document.createElement('div');
      el.id = DROPDOWN_ID;
      document.body.appendChild(el);
      expect(isDropdownOpen()).toBe(true);
    });
  });

  describe('isMissionsDropdownOpen()', () => {
    it('returns false when no missions dropdown exists', () => {
      expect(isMissionsDropdownOpen()).toBe(false);
    });

    it('returns true when the missions dropdown is mounted', () => {
      const el = document.createElement('div');
      el.id = MISSIONS_DROPDOWN_ID;
      document.body.appendChild(el);
      expect(isMissionsDropdownOpen()).toBe(true);
    });
  });

  describe('isAnyModalOpen()', () => {
    it('returns false when no modal backdrops exist', () => {
      expect(isAnyModalOpen()).toBe(false);
    });

    it('returns true when any known backdrop is mounted', () => {
      for (const id of MODAL_BACKDROP_IDS) {
        document.body.innerHTML = '';
        const el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
        expect(isAnyModalOpen()).toBe(true);
      }
    });

    it('returns false for unrelated elements', () => {
      const el = document.createElement('div');
      el.id = 'some-other-modal';
      document.body.appendChild(el);
      expect(isAnyModalOpen()).toBe(false);
    });
  });
});
