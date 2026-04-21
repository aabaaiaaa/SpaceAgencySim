/**
 * fpsMonitor.ts — Lightweight FPS/frame-time overlay for debug mode.
 *
 * Shows FPS, frame time (ms), and a mini graph of the last ~60 frame times.
 * Only visible during flight when debug mode is enabled.
 * Updates the display every ~500ms to minimise performance impact.
 * Exposes data on window.__perfStats for E2E testing.
 *
 * No per-frame allocations — reuses pre-allocated arrays and DOM elements.
 *
 * @module ui/fpsMonitor
 */

import './fpsMonitor.css';
import { makeDraggableOverlay, type DraggableOverlayHandle } from './draggableOverlay.ts';
import { loadSettings, saveSettings } from '../core/settingsStore.ts';

interface PerfStats {
  fps: number;
  frameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
}

declare global {
  interface Window {
    __perfStats: PerfStats | null;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HISTORY_SIZE = 60;
const DISPLAY_INTERVAL_MS = 500;
const GRAPH_W = 120;
const GRAPH_H = 30;


// ---------------------------------------------------------------------------
// Module state (pre-allocated, no per-frame allocs)
// ---------------------------------------------------------------------------

/** Ring buffer of frame times (ms). */
const _frameTimes = new Float64Array(HISTORY_SIZE);
let _frameIdx = 0;
let _frameCount = 0;

/** Timestamps for display throttling. */
let _lastDisplayUpdate = 0;

/** DOM element references (created once, reused). */
let _container: HTMLDivElement | null = null;
let _fpsText: HTMLDivElement | null = null;
let _ftText: HTMLDivElement | null = null;
let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;

/** Drag handle returned by makeDraggableOverlay — cleaned up on destroy. */
let _dragHandle: DraggableOverlayHandle | null = null;

/** Whether the monitor is currently active. */
let _active = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the FPS monitor. Creates the DOM elements but does NOT make them
 * visible — call show()/hide() based on debug mode state.
 */
export function initFpsMonitor(): void {
  if (_container) return; // already initialised

  _container = document.createElement('div');
  _container.id = 'fps-monitor';
  _container.style.display = 'none';

  _fpsText = document.createElement('div');
  _fpsText.id = 'fps-monitor-fps';
  _fpsText.textContent = 'FPS: --';

  _ftText = document.createElement('div');
  _ftText.id = 'fps-monitor-ft';
  _ftText.textContent = 'Frame: -- ms';

  _canvas = document.createElement('canvas');
  _canvas.id = 'fps-monitor-graph';
  _canvas.width = GRAPH_W;
  _canvas.height = GRAPH_H;
  _ctx = _canvas.getContext('2d');

  _container.appendChild(_fpsText);
  _container.appendChild(_ftText);
  _container.appendChild(_canvas);
  document.body.appendChild(_container);

  // Make the overlay draggable and restore any persisted position.
  const initialPosition = loadSettings().fpsMonitorPosition;
  _dragHandle = makeDraggableOverlay(_container, {
    initialPosition,
    onPositionChange: (pos) => {
      void saveSettings({ ...loadSettings(), fpsMonitorPosition: pos });
    },
  });

  // Reset ring buffer.
  _frameTimes.fill(0);
  _frameIdx = 0;
  _frameCount = 0;
  _lastDisplayUpdate = 0;
  _active = false;

  // Expose perf stats for E2E tests.
  if (typeof window !== 'undefined') {
    window.__perfStats = { fps: 0, frameTime: 0, minFrameTime: 0, maxFrameTime: 0 };
  }
}

/**
 * Show the FPS monitor overlay.
 */
export function showFpsMonitor(): void {
  if (!_container) return;
  _container.style.display = '';
  _active = true;
}

/**
 * Hide the FPS monitor overlay.
 */
export function hideFpsMonitor(): void {
  if (!_container) return;
  _container.style.display = 'none';
  _active = false;
}

/**
 * Compute aggregate stats from a buffer of frame times.
 * Pure function — no side effects, no DOM access.
 */
export function computeFrameStats(
  frameTimes: Float64Array,
  count: number,
): { fps: number; avgFrameTime: number; minFrameTime: number; maxFrameTime: number } {
  if (count <= 0) return { fps: 0, avgFrameTime: 0, minFrameTime: 0, maxFrameTime: 0 };

  let sum = 0;
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < count; i++) {
    const t = frameTimes[i];
    sum += t;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const avgFrameTime = sum / count;
  const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
  return { fps, avgFrameTime, minFrameTime: min, maxFrameTime: max };
}

/**
 * Record a frame time and update the display if enough time has elapsed.
 * Called once per animation frame from the flight loop.
 */
export function recordFrame(frameTimeMs: number, timestamp: number): void {
  // Always record data even when hidden — so stats are available immediately
  // when toggled on.
  _frameTimes[_frameIdx] = frameTimeMs;
  _frameIdx = (_frameIdx + 1) % HISTORY_SIZE;
  if (_frameCount < HISTORY_SIZE) _frameCount++;

  // Compute stats.
  const { fps, avgFrameTime, minFrameTime, maxFrameTime } = computeFrameStats(_frameTimes, _frameCount);

  // Update window.__perfStats every frame (lightweight).
  if (typeof window !== 'undefined' && window.__perfStats) {
    window.__perfStats.fps = Math.round(fps);
    window.__perfStats.frameTime = Math.round(avgFrameTime * 10) / 10;
    window.__perfStats.minFrameTime = Math.round(minFrameTime * 10) / 10;
    window.__perfStats.maxFrameTime = Math.round(maxFrameTime * 10) / 10;
  }

  // Only update the DOM display every ~500ms.
  if (!_active) return;
  if (timestamp - _lastDisplayUpdate < DISPLAY_INTERVAL_MS) return;
  _lastDisplayUpdate = timestamp;

  _fpsText!.textContent = `FPS: ${Math.round(fps)}`;
  _ftText!.textContent = `Frame: ${avgFrameTime.toFixed(1)} ms`;

  // Draw mini graph.
  _drawGraph(minFrameTime, maxFrameTime);
}

/**
 * Tear down the FPS monitor — remove DOM elements and clear state.
 */
export function destroyFpsMonitor(): void {
  if (_dragHandle) {
    _dragHandle.destroy();
    _dragHandle = null;
  }
  if (_container) {
    _container.remove();
    _container = null;
  }
  _fpsText = null;
  _ftText = null;
  _canvas = null;
  _ctx = null;
  _active = false;
  _frameTimes.fill(0);
  _frameIdx = 0;
  _frameCount = 0;
  _lastDisplayUpdate = 0;

  if (typeof window !== 'undefined') {
    window.__perfStats = null;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Draw the mini frame-time graph on the canvas.
 */
function _drawGraph(minFt: number, maxFt: number): void {
  if (!_ctx || !_canvas) return;

  const w = GRAPH_W;
  const h = GRAPH_H;
  const count = _frameCount;

  _ctx.clearRect(0, 0, w, h);

  // Background.
  _ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  _ctx.fillRect(0, 0, w, h);

  if (count < 2) return;

  // Scale: clamp range so flat lines still show.
  const rangeMin = Math.max(0, minFt - 2);
  const rangeMax = Math.max(maxFt + 2, rangeMin + 4);
  const range = rangeMax - rangeMin;

  // 16.67ms line (60fps target) — draw if in range.
  const targetMs = 16.67;
  if (targetMs >= rangeMin && targetMs <= rangeMax) {
    const ty = h - ((targetMs - rangeMin) / range) * h;
    _ctx.strokeStyle = 'rgba(100, 200, 100, 0.3)';
    _ctx.lineWidth = 1;
    _ctx.beginPath();
    _ctx.moveTo(0, ty);
    _ctx.lineTo(w, ty);
    _ctx.stroke();
  }

  // Frame time line.
  _ctx.strokeStyle = '#a8e8c0';
  _ctx.lineWidth = 1;
  _ctx.beginPath();

  // Read from oldest to newest in ring buffer order.
  for (let i = 0; i < count; i++) {
    const idx = (_frameIdx - count + i + HISTORY_SIZE) % HISTORY_SIZE;
    const t = _frameTimes[idx];
    const x = (i / (count - 1)) * w;
    const y = h - ((t - rangeMin) / range) * h;
    if (i === 0) _ctx.moveTo(x, y);
    else _ctx.lineTo(x, y);
  }
  _ctx.stroke();
}
