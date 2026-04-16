/**
 * logistics-state.test.ts -- Unit tests for the logistics state container
 * and pure formatter functions.
 *
 * Source: src/ui/logistics/_state.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLogisticsState,
  setLogisticsState,
  resetBuilderState,
  resetLogisticsState,
  setRenderFn,
  triggerRender,
  formatModuleType,
  formatResourceType,
  type LogisticsState,
} from '../ui/logistics/_state.ts';

describe('Logistics _state', () => {
  // Reset everything before each test so tests are independent.
  beforeEach(() => {
    resetLogisticsState();
    // Clear any registered render callback by resetting state fully,
    // then register a null-equivalent via setRenderFn trick:
    // There's no exported clearRenderFn, but resetLogisticsState doesn't
    // clear _renderFn. We overwrite it with a no-op that we can detect.
    setRenderFn(() => {});
  });

  // -------------------------------------------------------------------------
  // formatModuleType
  // -------------------------------------------------------------------------

  describe('formatModuleType()', () => {
    it('title-cases a multi-word type', () => {
      expect(formatModuleType('MINING_DRILL')).toBe('Mining Drill');
    });

    it('title-cases a single word type', () => {
      expect(formatModuleType('REFINERY')).toBe('Refinery');
    });

    it('handles an empty string', () => {
      expect(formatModuleType('')).toBe('');
    });

    it('handles a three-word type', () => {
      expect(formatModuleType('SOLAR_PANEL_ARRAY')).toBe('Solar Panel Array');
    });
  });

  // -------------------------------------------------------------------------
  // formatResourceType
  // -------------------------------------------------------------------------

  describe('formatResourceType()', () => {
    it('formats WATER_ICE to Water Ice', () => {
      expect(formatResourceType('WATER_ICE')).toBe('Water Ice');
    });

    it('formats CO2 to Co2', () => {
      expect(formatResourceType('CO2')).toBe('Co2');
    });

    it('handles a single word', () => {
      expect(formatResourceType('IRON')).toBe('Iron');
    });
  });

  // -------------------------------------------------------------------------
  // getLogisticsState / setLogisticsState
  // -------------------------------------------------------------------------

  describe('getLogisticsState()', () => {
    it('returns a state object with default values', () => {
      const s: LogisticsState = getLogisticsState();
      expect(s).toBeDefined();
      expect(s.activeTab).toBe('mining');
      expect(s.builderMode).toBe(false);
      expect(s.builderResourceType).toBeNull();
      expect(s.builderRouteName).toBe('');
      expect(s.builderLegs).toEqual([]);
      expect(s.builderCurrentBodyId).toBeNull();
      expect(s.builderOriginHubId).toBeNull();
      expect(s.overlay).toBeNull();
      expect(s.state).toBeNull();
      expect(s.selectedBodyId).toBeNull();
      expect(s.expandedRouteIds).toBeInstanceOf(Set);
      expect(s.expandedRouteIds.size).toBe(0);
    });

    it('returns the same object on multiple calls', () => {
      expect(getLogisticsState()).toBe(getLogisticsState());
    });
  });

  describe('setLogisticsState()', () => {
    it('patches a single property @smoke', () => {
      setLogisticsState({ activeTab: 'routes' });
      expect(getLogisticsState().activeTab).toBe('routes');
    });

    it('does not reset unpatched properties', () => {
      setLogisticsState({ activeTab: 'routes' });
      setLogisticsState({ builderMode: true });
      const s = getLogisticsState();
      expect(s.activeTab).toBe('routes');
      expect(s.builderMode).toBe(true);
    });

    it('patches multiple properties at once', () => {
      setLogisticsState({ builderMode: true, builderRouteName: 'Route Alpha' });
      const s = getLogisticsState();
      expect(s.builderMode).toBe(true);
      expect(s.builderRouteName).toBe('Route Alpha');
    });
  });

  // -------------------------------------------------------------------------
  // resetBuilderState
  // -------------------------------------------------------------------------

  describe('resetBuilderState()', () => {
    it('resets builder fields to defaults', () => {
      setLogisticsState({
        builderMode: true,
        builderResourceType: 'WATER_ICE',
        builderRouteName: 'Supply Run',
        builderLegs: ['leg-1', 'leg-2'],
        builderCurrentBodyId: 'mars',
        builderOriginHubId: 'hub-1',
      });

      resetBuilderState();

      const s = getLogisticsState();
      expect(s.builderMode).toBe(false);
      expect(s.builderResourceType).toBeNull();
      expect(s.builderRouteName).toBe('');
      expect(s.builderLegs).toEqual([]);
      expect(s.builderCurrentBodyId).toBeNull();
      expect(s.builderOriginHubId).toBeNull();
    });

    it('preserves non-builder fields', () => {
      setLogisticsState({ activeTab: 'routes', selectedBodyId: 'moon' });
      setLogisticsState({ builderMode: true, builderRouteName: 'Test' });

      resetBuilderState();

      const s = getLogisticsState();
      expect(s.activeTab).toBe('routes');
      expect(s.selectedBodyId).toBe('moon');
    });
  });

  // -------------------------------------------------------------------------
  // resetLogisticsState
  // -------------------------------------------------------------------------

  describe('resetLogisticsState()', () => {
    it('resets everything to defaults', () => {
      setLogisticsState({
        activeTab: 'routes',
        builderMode: true,
        builderRouteName: 'Route X',
        selectedBodyId: 'venus',
      });

      resetLogisticsState();

      const s = getLogisticsState();
      expect(s.activeTab).toBe('mining');
      expect(s.builderMode).toBe(false);
      expect(s.builderRouteName).toBe('');
      expect(s.selectedBodyId).toBeNull();
    });

    it('creates a fresh state object (new identity)', () => {
      const before = getLogisticsState();
      resetLogisticsState();
      const after = getLogisticsState();
      // resetLogisticsState replaces the internal state object entirely
      expect(after).not.toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // setRenderFn / triggerRender
  // -------------------------------------------------------------------------

  describe('setRenderFn() / triggerRender()', () => {
    it('calls the registered render function when triggered @smoke', () => {
      const spy = vi.fn();
      setRenderFn(spy);
      triggerRender();
      expect(spy).toHaveBeenCalledOnce();
    });

    it('calls the render function multiple times', () => {
      const spy = vi.fn();
      setRenderFn(spy);
      triggerRender();
      triggerRender();
      triggerRender();
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('replaces a previously registered render function', () => {
      const first = vi.fn();
      const second = vi.fn();
      setRenderFn(first);
      setRenderFn(second);
      triggerRender();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledOnce();
    });
  });
});
