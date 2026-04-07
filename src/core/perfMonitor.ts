/**
 * perfMonitor.ts — Lightweight performance monitoring for gameplay metrics.
 *
 * Collects FPS, frame time, worker round-trip latency, and memory usage
 * without touching the DOM. Uses pre-allocated fixed-size circular buffers
 * to avoid GC pressure in the hot path.
 *
 * @module core/perfMonitor
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FrameTimeHistogram {
  /** 0–8 ms (excellent, >120 fps) */
  bucket0to8: number;
  /** 8–16 ms (good, 60–120 fps) */
  bucket8to16: number;
  /** 16–33 ms (acceptable, 30–60 fps) */
  bucket16to33: number;
  /** 33 ms+ (poor, <30 fps) */
  bucket33plus: number;
}

export interface PerfMetrics {
  /** Current frame FPS (1000 / last frame time). */
  fpsCurrent: number;
  /** Rolling average FPS over the buffer window. */
  fpsAverage: number;
  /** Minimum FPS observed in the buffer window. */
  fpsMin: number;
  /** Current frame time in ms. */
  frameTime: number;
  /** Rolling average frame time in ms. */
  frameTimeAverage: number;
  /** Frame time histogram over the buffer window. */
  histogram: FrameTimeHistogram;
  /** Worker round-trip latency in ms (0 if no data). */
  workerLatency: number;
  /** JS heap size in bytes (0 if unavailable). */
  memoryUsedBytes: number;
  /** JS heap size limit in bytes (0 if unavailable). */
  memoryLimitBytes: number;
  /** Number of frames recorded in the buffer. */
  frameCount: number;
}

// Chrome-only performance.memory typing
interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUFFER_SIZE = 60;

// ---------------------------------------------------------------------------
// Module state (pre-allocated, zero per-frame allocations)
// ---------------------------------------------------------------------------

/** Ring buffer of frame times (ms). */
const _frameTimes = new Float64Array(BUFFER_SIZE);
let _bufferIdx = 0;
let _frameCount = 0;

/** Frame start timestamp from beginFrame(). */
let _frameStart = 0;

/** Worker latency tracking. */
let _workerSendTime = 0;
let _workerLatency = 0;

/** Histogram counts (reset on each getMetrics call? No — accumulated over buffer). */
// We recompute from the buffer on each getMetrics() call to stay accurate
// as old entries rotate out.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mark the beginning of a frame. Call at the start of the render loop.
 * Uses `performance.now()` for high-resolution timing.
 */
export function beginFrame(): void {
  _frameStart = performance.now();
}

/**
 * Mark the end of a frame. Call at the end of the render loop.
 * Records the elapsed time into the circular buffer.
 */
export function endFrame(): void {
  const elapsed = performance.now() - _frameStart;
  _frameTimes[_bufferIdx] = elapsed;
  _bufferIdx = (_bufferIdx + 1) % BUFFER_SIZE;
  if (_frameCount < BUFFER_SIZE) _frameCount++;
}

/**
 * Record the timestamp when a message is sent to the physics worker.
 */
export function recordWorkerSend(): void {
  _workerSendTime = performance.now();
}

/**
 * Record the timestamp when a response is received from the physics worker.
 * Computes round-trip latency from the last `recordWorkerSend()` call.
 */
export function recordWorkerReceive(): void {
  if (_workerSendTime > 0) {
    _workerLatency = performance.now() - _workerSendTime;
    _workerSendTime = 0;
  }
}

/**
 * Return a snapshot of all current performance metrics.
 * Recomputes aggregates from the circular buffer on each call.
 */
export function getMetrics(): PerfMetrics {
  const count = _frameCount;

  if (count === 0) {
    return _emptyMetrics();
  }

  // Single pass over the buffer for all aggregates.
  let sum = 0;
  let maxFrameTime = 0;
  let bucket0to8 = 0;
  let bucket8to16 = 0;
  let bucket16to33 = 0;
  let bucket33plus = 0;

  for (let i = 0; i < count; i++) {
    const t = _frameTimes[i];
    sum += t;
    if (t > maxFrameTime) maxFrameTime = t;

    if (t < 8) bucket0to8++;
    else if (t < 16) bucket8to16++;
    else if (t < 33) bucket16to33++;
    else bucket33plus++;
  }

  const avgFrameTime = sum / count;
  // Current frame time is the most recently written entry.
  const currentIdx = (_bufferIdx - 1 + BUFFER_SIZE) % BUFFER_SIZE;
  const currentFrameTime = _frameTimes[currentIdx];
  const fpsCurrent = currentFrameTime > 0 ? 1000 / currentFrameTime : 0;
  const fpsAverage = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
  // Min FPS corresponds to the longest frame time.
  const fpsMin = maxFrameTime > 0 ? 1000 / maxFrameTime : 0;

  // Memory (Chrome-only, graceful no-op).
  let memoryUsedBytes = 0;
  let memoryLimitBytes = 0;
  const perfAny = performance as unknown as { memory?: PerformanceMemory };
  if (perfAny.memory) {
    memoryUsedBytes = perfAny.memory.usedJSHeapSize;
    memoryLimitBytes = perfAny.memory.jsHeapSizeLimit;
  }

  return {
    fpsCurrent,
    fpsAverage,
    fpsMin,
    frameTime: currentFrameTime,
    frameTimeAverage: avgFrameTime,
    histogram: { bucket0to8, bucket8to16, bucket16to33, bucket33plus },
    workerLatency: _workerLatency,
    memoryUsedBytes,
    memoryLimitBytes,
    frameCount: count,
  };
}

/**
 * Reset all buffers and tracked state.
 */
export function reset(): void {
  _frameTimes.fill(0);
  _bufferIdx = 0;
  _frameCount = 0;
  _frameStart = 0;
  _workerSendTime = 0;
  _workerLatency = 0;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function _emptyMetrics(): PerfMetrics {
  // Memory (Chrome-only, graceful no-op).
  let memoryUsedBytes = 0;
  let memoryLimitBytes = 0;
  const perfAny = performance as unknown as { memory?: PerformanceMemory };
  if (perfAny.memory) {
    memoryUsedBytes = perfAny.memory.usedJSHeapSize;
    memoryLimitBytes = perfAny.memory.jsHeapSizeLimit;
  }

  return {
    fpsCurrent: 0,
    fpsAverage: 0,
    fpsMin: 0,
    frameTime: 0,
    frameTimeAverage: 0,
    histogram: { bucket0to8: 0, bucket8to16: 0, bucket16to33: 0, bucket33plus: 0 },
    workerLatency: 0,
    memoryUsedBytes,
    memoryLimitBytes,
    frameCount: 0,
  };
}
