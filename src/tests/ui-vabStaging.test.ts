// @ts-nocheck
/**
 * ui-vabStaging.test.ts — Unit tests for VAB staging panel logic.
 *
 * Tests the setStagingCallbacks() configuration and syncAndRenderStaging()
 * orchestration logic. The delta-v computation (computeVabStageDeltaV) is
 * private, so we test it indirectly via the staging panel render path when
 * possible, or via exported functions that depend on it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../data/parts.ts', () => ({
  getPartById: vi.fn((id) => {
    const catalog = {
      'engine-1': {
        name: 'Merlin',
        mass: 500,
        cost: 1000,
        type: 'ENGINE',
        width: 40,
        height: 30,
        properties: { thrust: 100, isp: 280, ispVac: 340, fuelMass: 0 },
      },
      'tank-1': {
        name: 'Fuel Tank',
        mass: 200,
        cost: 500,
        type: 'FUEL_TANK',
        width: 40,
        height: 60,
        properties: { fuelMass: 800 },
      },
      'cmd-1': {
        name: 'Command Pod',
        mass: 100,
        cost: 2000,
        type: 'COMMAND_MODULE',
        width: 30,
        height: 20,
        properties: {},
      },
      'srb-1': {
        name: 'SRB',
        mass: 300,
        cost: 400,
        type: 'SOLID_ROCKET_BOOSTER',
        width: 20,
        height: 50,
        properties: { thrust: 200, isp: 250, ispVac: 250, fuelMass: 500 },
      },
    };
    return catalog[id] || null;
  }),
}));

vi.mock('../core/rocketbuilder.ts', () => ({
  syncStagingWithAssembly: vi.fn(),
  addStageToConfig: vi.fn(),
  removeStageFromConfig: vi.fn(),
  assignPartToStage: vi.fn(),
  movePartBetweenStages: vi.fn(),
  returnPartToUnstaged: vi.fn(),
  validateStagingConfig: vi.fn(() => []),
  moveStage: vi.fn(),
}));

vi.mock('../core/atmosphere.ts', () => ({
  airDensity: vi.fn((alt) => {
    // Simple exponential model for testing
    if (alt <= 0) return 1.225;
    if (alt >= 100000) return 0;
    return 1.225 * Math.exp(-alt / 8500);
  }),
  SEA_LEVEL_DENSITY: 1.225,
}));

vi.mock('../ui/vab/_undoActions.ts', () => ({
  snapshotStaging: vi.fn(() => ({
    stages: [{ instanceIds: [] }],
    unstaged: [],
    currentStageIdx: 0,
  })),
  recordStagingChange: vi.fn(),
}));

// Stub document so renderStagingPanel() (which accesses document.getElementById)
// doesn't crash in Node.js.
vi.stubGlobal('document', {
  getElementById: vi.fn(() => null),
  createElement: vi.fn(() => ({
    style: {}, className: '', textContent: '', innerHTML: '',
    appendChild: vi.fn(), addEventListener: vi.fn(),
  })),
});

import { setVabState, resetVabState } from '../ui/vab/_state.ts';
import { syncStagingWithAssembly } from '../core/rocketbuilder.ts';
import {
  setStagingCallbacks,
  syncAndRenderStaging,
} from '../ui/vab/_staging.ts';

describe('VAB Staging', () => {
  beforeEach(() => {
    resetVabState();
    vi.clearAllMocks();
  });

  describe('setStagingCallbacks()', () => {
    it('accepts callbacks without error', () => {
      expect(() => setStagingCallbacks({
        runAndRenderValidation: vi.fn(),
        updateStatusBar: vi.fn(),
        updateScaleBarExtents: vi.fn(),
        updateOffscreenIndicators: vi.fn(),
        doZoomToFit: vi.fn(),
      })).not.toThrow();
    });
  });

  describe('syncAndRenderStaging()', () => {
    it('does nothing when assembly is null', () => {
      setVabState({ assembly: null, stagingConfig: null });
      syncAndRenderStaging();
      expect(syncStagingWithAssembly).not.toHaveBeenCalled();
    });

    it('does nothing when stagingConfig is null', () => {
      setVabState({
        assembly: {
          parts: new Map(),
          connections: [],
          symmetryPairs: [],
          _nextId: 0,
        },
        stagingConfig: null,
      });
      syncAndRenderStaging();
      expect(syncStagingWithAssembly).not.toHaveBeenCalled();
    });

    it('calls syncStagingWithAssembly when both assembly and staging exist', () => {
      const assembly = {
        parts: new Map(),
        connections: [],
        symmetryPairs: [],
        _nextId: 0,
      };
      const staging = {
        stages: [{ instanceIds: [] }],
        unstaged: [],
        currentStageIdx: 0,
      };

      setVabState({ assembly, stagingConfig: staging });

      const runVal = vi.fn();
      const updateStatus = vi.fn();
      const updateScale = vi.fn();
      const updateOffscreen = vi.fn();
      const zoomFit = vi.fn();

      setStagingCallbacks({
        runAndRenderValidation: runVal,
        updateStatusBar: updateStatus,
        updateScaleBarExtents: updateScale,
        updateOffscreenIndicators: updateOffscreen,
        doZoomToFit: zoomFit,
      });

      syncAndRenderStaging();

      expect(syncStagingWithAssembly).toHaveBeenCalledWith(assembly, staging);
      expect(runVal).toHaveBeenCalled();
      expect(updateStatus).toHaveBeenCalled();
      expect(updateScale).toHaveBeenCalled();
      expect(updateOffscreen).toHaveBeenCalled();
    });

    it('calls doZoomToFit when autoZoomEnabled is true', () => {
      const assembly = { parts: new Map(), connections: [], symmetryPairs: [], _nextId: 0 };
      const staging = { stages: [{ instanceIds: [] }], unstaged: [], currentStageIdx: 0 };

      setVabState({ assembly, stagingConfig: staging, autoZoomEnabled: true });

      const zoomFit = vi.fn();
      setStagingCallbacks({
        runAndRenderValidation: vi.fn(),
        updateStatusBar: vi.fn(),
        updateScaleBarExtents: vi.fn(),
        updateOffscreenIndicators: vi.fn(),
        doZoomToFit: zoomFit,
      });

      syncAndRenderStaging();
      expect(zoomFit).toHaveBeenCalled();
    });

    it('does NOT call doZoomToFit when autoZoomEnabled is false', () => {
      const assembly = { parts: new Map(), connections: [], symmetryPairs: [], _nextId: 0 };
      const staging = { stages: [{ instanceIds: [] }], unstaged: [], currentStageIdx: 0 };

      setVabState({ assembly, stagingConfig: staging, autoZoomEnabled: false });

      const zoomFit = vi.fn();
      setStagingCallbacks({
        runAndRenderValidation: vi.fn(),
        updateStatusBar: vi.fn(),
        updateScaleBarExtents: vi.fn(),
        updateOffscreenIndicators: vi.fn(),
        doZoomToFit: zoomFit,
      });

      syncAndRenderStaging();
      expect(zoomFit).not.toHaveBeenCalled();
    });
  });
});
