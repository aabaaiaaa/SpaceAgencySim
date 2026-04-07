// @ts-nocheck
/**
 * ui-fpsMonitor.test.ts — Unit tests for the FPS monitor ring buffer stats.
 *
 * The fpsMonitor module is heavily DOM-dependent (creates canvases, divs),
 * so we mock document and test the recordFrame() computation logic indirectly
 * by checking window.__perfStats after calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock CSS import and minimal DOM
// ---------------------------------------------------------------------------

vi.mock('../ui/fpsMonitor.css', () => ({}));

// We need a minimal DOM for the module to function.
// Create the minimum DOM elements it expects.
const _elements = new Map();

const mockDocument = {
  createElement: vi.fn((_tag) => {
    const el = {
      id: '',
      style: { display: '' },
      textContent: '',
      className: '',
      classList: { add: vi.fn(), remove: vi.fn() },
      width: 0,
      height: 0,
      appendChild: vi.fn(),
      remove: vi.fn(),
      getContext: vi.fn(() => ({
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
      })),
    };
    return el;
  }),
  body: {
    appendChild: vi.fn(),
  },
  getElementById: vi.fn(() => null),
};

// Set up globals before importing the module.
vi.stubGlobal('document', mockDocument);

// Ensure window exists and has __perfStats slot
if (typeof globalThis.window === 'undefined') {
  vi.stubGlobal('window', { __perfStats: null });
}

import {
  initFpsMonitor,
  showFpsMonitor,
  hideFpsMonitor,
  recordFrame,
  destroyFpsMonitor,
} from '../ui/fpsMonitor.ts';

describe('fpsMonitor', () => {
  beforeEach(() => {
    // Reinitialise each test with clean state.
    destroyFpsMonitor();
    vi.clearAllMocks();
    initFpsMonitor();
  });

  afterEach(() => {
    destroyFpsMonitor();
  });

  describe('initFpsMonitor()', () => {
    it('sets up window.__perfStats', () => {
      expect(window.__perfStats).toBeDefined();
      expect(window.__perfStats.fps).toBe(0);
      expect(window.__perfStats.frameTime).toBe(0);
    });

    it('does not re-initialise if called twice', () => {
      const callsBefore = mockDocument.createElement.mock.calls.length;
      initFpsMonitor(); // second call
      expect(mockDocument.createElement.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('recordFrame() — stats computation', () => {
    it('computes FPS from a single frame time', () => {
      recordFrame(16.67, 1000);
      expect(window.__perfStats).toBeDefined();
      expect(window.__perfStats.fps).toBeCloseTo(60, 0);
      expect(window.__perfStats.frameTime).toBeCloseTo(16.7, 0);
    });

    it('computes average frame time from multiple frames', () => {
      recordFrame(10, 1000);
      recordFrame(20, 1020);
      recordFrame(30, 1050);

      // Average of 10, 20, 30 = 20
      expect(window.__perfStats.frameTime).toBeCloseTo(20, 0);
      // FPS = 1000 / 20 = 50
      expect(window.__perfStats.fps).toBeCloseTo(50, 0);
    });

    it('tracks min and max frame times', () => {
      recordFrame(10, 1000);
      recordFrame(50, 1050);
      recordFrame(20, 1070);

      expect(window.__perfStats.minFrameTime).toBeCloseTo(10, 0);
      expect(window.__perfStats.maxFrameTime).toBeCloseTo(50, 0);
    });

    it('handles zero frame time without crashing', () => {
      recordFrame(0, 1000);
      expect(window.__perfStats.fps).toBe(0); // 1000/0 → handled
    });

    it('fills ring buffer up to 60 entries', () => {
      // Record 60 frames
      for (let i = 0; i < 60; i++) {
        recordFrame(16, 1000 + i * 16);
      }
      // FPS is 1000/16 = 62.5, but Math.round(62.5) = 63 in JS.
      expect(window.__perfStats.fps).toBe(63);
    });

    it('ring buffer wraps correctly after more than 60 frames', () => {
      // Fill 60 frames at 10ms
      for (let i = 0; i < 60; i++) {
        recordFrame(10, 1000 + i * 10);
      }
      expect(window.__perfStats.frameTime).toBeCloseTo(10, 0);

      // Now add 30 frames at 20ms — old 10ms entries get overwritten
      for (let i = 0; i < 30; i++) {
        recordFrame(20, 2000 + i * 20);
      }
      // Buffer has 30 entries of 10ms and 30 entries of 20ms → avg = 15
      expect(window.__perfStats.frameTime).toBeCloseTo(15, 0);
    });
  });

  describe('showFpsMonitor() / hideFpsMonitor()', () => {
    it('can be called without error', () => {
      expect(() => showFpsMonitor()).not.toThrow();
      expect(() => hideFpsMonitor()).not.toThrow();
    });
  });

  describe('destroyFpsMonitor()', () => {
    it('clears window.__perfStats', () => {
      recordFrame(16, 1000);
      destroyFpsMonitor();
      expect(window.__perfStats).toBeNull();
    });

    it('allows re-initialization after destroy', () => {
      destroyFpsMonitor();
      initFpsMonitor();
      expect(window.__perfStats).toBeDefined();
      expect(window.__perfStats.fps).toBe(0);
    });
  });
});
