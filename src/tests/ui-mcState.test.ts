// @ts-nocheck
/**
 * ui-mcState.test.ts — Unit tests for Mission Control state management.
 *
 * Tests getMCState() and setMCState() from src/ui/missionControl/_state.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getMCState, setMCState } from '../ui/missionControl/_state.ts';

describe('MCState', () => {
  // Reset to known defaults before each test by patching back.
  beforeEach(() => {
    setMCState({
      overlay: null,
      state: null,
      onBack: null,
      activeTab: 'available',
      creatorFormOpen: false,
      _escapeHandler: null,
    });
  });

  describe('getMCState()', () => {
    it('returns a state object', () => {
      const s = getMCState();
      expect(s).toBeDefined();
      expect(typeof s).toBe('object');
    });

    it('returns the same object on multiple calls', () => {
      expect(getMCState()).toBe(getMCState());
    });
  });

  describe('default state values', () => {
    it('nullable references are null', () => {
      const s = getMCState();
      expect(s.overlay).toBeNull();
      expect(s.state).toBeNull();
      expect(s.onBack).toBeNull();
      expect(s._escapeHandler).toBeNull();
    });

    it('activeTab defaults to "available"', () => {
      expect(getMCState().activeTab).toBe('available');
    });

    it('creatorFormOpen defaults to false', () => {
      expect(getMCState().creatorFormOpen).toBe(false);
    });
  });

  describe('setMCState()', () => {
    it('patches a single property', () => {
      setMCState({ activeTab: 'contracts' });
      expect(getMCState().activeTab).toBe('contracts');
    });

    it('patches multiple properties at once', () => {
      setMCState({ activeTab: 'challenges', creatorFormOpen: true });
      const s = getMCState();
      expect(s.activeTab).toBe('challenges');
      expect(s.creatorFormOpen).toBe(true);
    });

    it('does not reset unpatched properties', () => {
      setMCState({ activeTab: 'contracts' });
      setMCState({ creatorFormOpen: true });
      expect(getMCState().activeTab).toBe('contracts');
    });

    it('preserves object identity', () => {
      const before = getMCState();
      setMCState({ activeTab: 'challenges' });
      expect(getMCState()).toBe(before);
    });

    it('can set the onBack callback', () => {
      const cb = () => {};
      setMCState({ onBack: cb });
      expect(getMCState().onBack).toBe(cb);
    });
  });
});
