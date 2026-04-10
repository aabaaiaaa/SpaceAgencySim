/**
 * ui-vabState.test.ts — Unit tests for VAB state management.
 *
 * Tests getVabState(), setVabState(), resetVabState() and the SIDE_PANEL_WIDTH
 * constant from src/ui/vab/_state.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getVabState,
  setVabState,
  resetVabState,
  SIDE_PANEL_WIDTH,
} from '../ui/vab/_state.ts';

describe('VabState', () => {
  beforeEach(() => {
    resetVabState();
  });

  describe('SIDE_PANEL_WIDTH', () => {
    it('is a positive number', () => {
      expect(SIDE_PANEL_WIDTH).toBe(300);
    });
  });

  describe('getVabState()', () => {
    it('returns a state object', () => {
      const s = getVabState();
      expect(s).toBeDefined();
      expect(typeof s).toBe('object');
    });

    it('returns the same object on multiple calls', () => {
      expect(getVabState()).toBe(getVabState());
    });
  });

  describe('default state values', () => {
    it('nullable references are null by default', () => {
      const s = getVabState();
      expect(s.assembly).toBeNull();
      expect(s.gameState).toBeNull();
      expect(s.container).toBeNull();
      expect(s.dragState).toBeNull();
      expect(s.ctxMenu).toBeNull();
      expect(s.stagingConfig).toBeNull();
      expect(s.lastValidation).toBeNull();
      expect(s.onBack).toBeNull();
      expect(s.selectedInstanceId).toBeNull();
      expect(s.currentDesignId).toBeNull();
      expect(s.canvasArea).toBeNull();
      expect(s.pendingPickup).toBeNull();
      expect(s.scaleTicks).toBeNull();
    });

    it('numeric values default correctly', () => {
      const s = getVabState();
      expect(s.dvAltitude).toBe(0);
      expect(s.buildAreaHeight).toBe(0);
    });

    it('boolean flags default correctly', () => {
      const s = getVabState();
      expect(s.flightActive).toBe(false);
      expect(s.autoZoomEnabled).toBe(true);
      expect(s.symmetryMode).toBe(true);
      expect(s.libraryCssInjected).toBe(false);
    });

    it('string values default correctly', () => {
      expect(getVabState().currentDesignName).toBe('');
    });

    it('collection fields are empty by default', () => {
      const s = getVabState();
      expect(s.openPanels).toBeInstanceOf(Set);
      expect(s.openPanels.size).toBe(0);
      expect(s.inventoryUsedParts).toBeInstanceOf(Map);
      expect(s.inventoryUsedParts.size).toBe(0);
    });
  });

  describe('setVabState()', () => {
    it('patches a single property', () => {
      setVabState({ dvAltitude: 5000 });
      expect(getVabState().dvAltitude).toBe(5000);
    });

    it('patches multiple properties at once', () => {
      setVabState({
        flightActive: true,
        symmetryMode: false,
        currentDesignName: 'Test Rocket',
      });
      const s = getVabState();
      expect(s.flightActive).toBe(true);
      expect(s.symmetryMode).toBe(false);
      expect(s.currentDesignName).toBe('Test Rocket');
    });

    it('does not reset unpatched properties', () => {
      setVabState({ dvAltitude: 10000 });
      setVabState({ flightActive: true });
      expect(getVabState().dvAltitude).toBe(10000);
    });

    it('preserves object identity after patching', () => {
      const before = getVabState();
      setVabState({ dvAltitude: 42 });
      expect(getVabState()).toBe(before);
    });
  });

  describe('resetVabState()', () => {
    it('resets all properties to defaults', () => {
      setVabState({
        dvAltitude: 50000,
        flightActive: true,
        autoZoomEnabled: false,
        symmetryMode: false,
        currentDesignName: 'Modified',
        buildAreaHeight: 999,
        libraryCssInjected: true,
      });

      resetVabState();
      const s = getVabState();
      expect(s.dvAltitude).toBe(0);
      expect(s.flightActive).toBe(false);
      expect(s.autoZoomEnabled).toBe(true);
      expect(s.symmetryMode).toBe(true);
      expect(s.currentDesignName).toBe('');
      expect(s.buildAreaHeight).toBe(0);
      expect(s.libraryCssInjected).toBe(false);
    });

    it('creates new collection instances after reset', () => {
      const oldPanels = getVabState().openPanels;
      oldPanels.add('staging');
      const oldMap = getVabState().inventoryUsedParts;
      oldMap.set('x', { id: 'x', partId: 'p1', wear: 10, flights: 1 });

      resetVabState();
      expect(getVabState().openPanels.size).toBe(0);
      expect(getVabState().openPanels).not.toBe(oldPanels);
      expect(getVabState().inventoryUsedParts.size).toBe(0);
      expect(getVabState().inventoryUsedParts).not.toBe(oldMap);
    });

    it('preserves the same object reference (mutates in place)', () => {
      const before = getVabState();
      resetVabState();
      // resetVabState mutates the existing _state object, not creating a new one
      expect(getVabState()).toBe(before);
    });
  });
});
