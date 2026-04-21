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

interface MockCanvasContext {
  clearRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

interface MockElement {
  id: string;
  style: Record<string, string>;
  textContent: string;
  className: string;
  classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  width: number;
  height: number;
  offsetWidth: number;
  offsetHeight: number;
  appendChild: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  getContext: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
  getBoundingClientRect: ReturnType<typeof vi.fn>;
}

// We need a minimal DOM for the module to function.
// Create the minimum DOM elements it expects.
const _elements = new Map<string, MockElement>();

const mockDocument = {
  createElement: vi.fn((_tag: string): MockElement => {
    const el: MockElement = {
      id: '',
      style: {},
      textContent: '',
      className: '',
      classList: { add: vi.fn(), remove: vi.fn() },
      width: 0,
      height: 0,
      offsetWidth: 100,
      offsetHeight: 40,
      appendChild: vi.fn(),
      remove: vi.fn(),
      getContext: vi.fn((): MockCanvasContext => ({
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
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({
        left: 0, top: 0, right: 100, bottom: 40,
        width: 100, height: 40, x: 0, y: 0, toJSON: () => ({}),
      })),
    };
    return el;
  }),
  body: {
    appendChild: vi.fn(),
  },
  getElementById: vi.fn((): null => null),
};

// Set up globals before importing the module.
vi.stubGlobal('document', mockDocument);

// Ensure window exists with the APIs the draggable overlay wiring needs.
const mockWindow = {
  __perfStats: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  innerWidth: 1024,
  innerHeight: 768,
};
vi.stubGlobal('window', mockWindow);

// The module also imports settingsStore.ts which touches idbStorage — mock
// it to avoid the real IndexedDB code path during these DOM-focused tests.
vi.mock('../core/idbStorage.ts', () => ({
  idbSet: vi.fn(() => Promise.resolve()),
  idbGet: vi.fn(() => Promise.resolve(null)),
  idbDelete: vi.fn(() => Promise.resolve()),
  idbGetAllKeys: vi.fn(() => Promise.resolve([])),
}));

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
      expect(window.__perfStats!.fps).toBe(0);
      expect(window.__perfStats!.frameTime).toBe(0);
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
      expect(window.__perfStats!.fps).toBeCloseTo(60, 0);
      expect(window.__perfStats!.frameTime).toBeCloseTo(16.7, 0);
    });

    it('computes average frame time from multiple frames', () => {
      recordFrame(10, 1000);
      recordFrame(20, 1020);
      recordFrame(30, 1050);

      // Average of 10, 20, 30 = 20
      expect(window.__perfStats!.frameTime).toBeCloseTo(20, 0);
      // FPS = 1000 / 20 = 50
      expect(window.__perfStats!.fps).toBeCloseTo(50, 0);
    });

    it('tracks min and max frame times', () => {
      recordFrame(10, 1000);
      recordFrame(50, 1050);
      recordFrame(20, 1070);

      expect(window.__perfStats!.minFrameTime).toBeCloseTo(10, 0);
      expect(window.__perfStats!.maxFrameTime).toBeCloseTo(50, 0);
    });

    it('handles zero frame time without crashing', () => {
      recordFrame(0, 1000);
      expect(window.__perfStats!.fps).toBe(0); // 1000/0 → handled
    });

    it('fills ring buffer up to 60 entries', () => {
      // Record 60 frames
      for (let i = 0; i < 60; i++) {
        recordFrame(16, 1000 + i * 16);
      }
      // FPS is 1000/16 = 62.5, but Math.round(62.5) = 63 in JS.
      expect(window.__perfStats!.fps).toBe(63);
    });

    it('ring buffer wraps correctly after more than 60 frames', () => {
      // Fill 60 frames at 10ms
      for (let i = 0; i < 60; i++) {
        recordFrame(10, 1000 + i * 10);
      }
      expect(window.__perfStats!.frameTime).toBeCloseTo(10, 0);

      // Now add 30 frames at 20ms — old 10ms entries get overwritten
      for (let i = 0; i < 30; i++) {
        recordFrame(20, 2000 + i * 20);
      }
      // Buffer has 30 entries of 10ms and 30 entries of 20ms → avg = 15
      expect(window.__perfStats!.frameTime).toBeCloseTo(15, 0);
    });
  });

  describe('showFpsMonitor() / hideFpsMonitor()', () => {
    it('can be called without error', () => {
      expect(() => showFpsMonitor()).not.toThrow();
      expect(() => hideFpsMonitor()).not.toThrow();
    });
  });

  describe('recordFrame() — display update and graph', () => {
    it('updates DOM text when active and display interval elapsed', () => {
      showFpsMonitor();

      // Record a frame, but not enough time has passed (timestamp 0 → 100)
      recordFrame(16.67, 100);

      // Now pass enough time (> 500ms) to trigger display update
      recordFrame(16.67, 700);

      // Verify that createElement was called (for _fpsText, _ftText, _canvas)
      // The fpsText element should have been updated with the FPS value
      const createdElements = mockDocument.createElement.mock.results;
      // First 3 createElement calls are: container div, fpsText div, ftText div, canvas
      // We check the divs have textContent set
      const fpsDiv = createdElements[1].value as MockElement;
      const ftDiv = createdElements[2].value as MockElement;

      expect(fpsDiv.textContent).toContain('FPS:');
      expect(ftDiv.textContent).toContain('Frame:');
    });

    it('does not update DOM when not active', () => {
      // Monitor is hidden by default after init
      hideFpsMonitor();

      const createdElements = mockDocument.createElement.mock.results;
      const fpsDiv = createdElements[1].value as MockElement;
      // Set initial text to track changes
      fpsDiv.textContent = 'FPS: --';

      recordFrame(16.67, 0);
      recordFrame(16.67, 600); // enough time passed but not active

      // Text should remain as set during init, not updated
      expect(fpsDiv.textContent).toBe('FPS: --');
    });

    it('invokes canvas draw methods when display interval elapses', () => {
      showFpsMonitor();

      // Need at least 2 frames in the buffer for _drawGraph to draw lines
      recordFrame(10, 0);
      recordFrame(20, 600); // triggers display update

      // The canvas context should have had drawing methods called
      const canvasEl = mockDocument.createElement.mock.results[3].value as MockElement;
      const ctx = canvasEl.getContext.mock.results[0].value as MockCanvasContext;

      expect(ctx.clearRect).toHaveBeenCalled();
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('draws 60fps target line when in range', () => {
      showFpsMonitor();

      // Record frames around 16.67ms so the target line is in range
      recordFrame(14, 0);
      recordFrame(18, 600);

      const canvasEl = mockDocument.createElement.mock.results[3].value as MockElement;
      const ctx = canvasEl.getContext.mock.results[0].value as MockCanvasContext;

      // The target line at 16.67ms should be drawn (moveTo + lineTo at that y)
      // clearRect for background, then a strokeStyle for the target line
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.lineTo).toHaveBeenCalled();
    });

    it('skips graph body when frameCount < 2', () => {
      showFpsMonitor();

      // Record only one frame with enough time elapsed
      recordFrame(16, 600);

      const canvasEl = mockDocument.createElement.mock.results[3].value as MockElement;
      const ctx = canvasEl.getContext.mock.results[0].value as MockCanvasContext;

      // clearRect is called (background is drawn), but beginPath for the line
      // should not be called since count < 2
      expect(ctx.clearRect).toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalled(); // background rect
      // beginPath is called zero times for the frame time line
      // (it may be called for the target line check, but with only 1 frame the
      //  function returns early before drawing any lines)
      expect(ctx.lineTo).not.toHaveBeenCalled();
    });

    it('throttles display updates within DISPLAY_INTERVAL_MS', () => {
      showFpsMonitor();

      recordFrame(16, 0);
      recordFrame(16, 600); // triggers update

      const createdElements = mockDocument.createElement.mock.results;
      const fpsDiv = createdElements[1].value as MockElement;

      // Record the text after the first display update
      const textAfterFirst = fpsDiv.textContent;

      // Record another frame only 100ms later — should NOT trigger display update
      recordFrame(50, 700); // 700 - 600 = 100ms < 500ms

      // Text shouldn't change because display interval hasn't elapsed
      expect(fpsDiv.textContent).toBe(textAfterFirst);

      // But __perfStats should still be updated
      expect(window.__perfStats!.maxFrameTime).toBeCloseTo(50, 0);
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
      expect(window.__perfStats!.fps).toBe(0);
    });
  });
});
