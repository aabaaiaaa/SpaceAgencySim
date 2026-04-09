/**
 * perfDashboard.ts — Performance dashboard UI overlay.
 *
 * Semi-transparent overlay in the top-right corner displaying FPS, frame time,
 * worker latency, memory usage, and a frame-time histogram. Data is sourced
 * from the core perfMonitor module.
 *
 * - Updates every 500ms via setInterval (not every frame).
 * - Lazy DOM creation — elements only created on first show.
 * - Destroyed via destroyPerfDashboard() for cleanup.
 *
 * @module ui/perfDashboard
 */

import './perfDashboard.css';
import { getMetrics } from '../core/perfMonitor.ts';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPDATE_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _container: HTMLDivElement | null = null;
let _fpsLarge: HTMLDivElement | null = null;
let _fpsDetails: HTMLDivElement | null = null;
let _frameTimeEl: HTMLSpanElement | null = null;
let _workerLatencyEl: HTMLSpanElement | null = null;
let _memoryEl: HTMLSpanElement | null = null;
let _histBar0: HTMLDivElement | null = null;
let _histBar1: HTMLDivElement | null = null;
let _histBar2: HTMLDivElement | null = null;
let _histBar3: HTMLDivElement | null = null;

let _intervalId: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Internal — lazy DOM creation
// ---------------------------------------------------------------------------

function _createDOM(): void {
  if (_container) return;

  _container = document.createElement('div');
  _container.id = 'perf-dashboard';
  _container.style.display = 'none';

  // FPS (large)
  _fpsLarge = document.createElement('div');
  _fpsLarge.className = 'perf-fps-large';
  _fpsLarge.textContent = '-- FPS';

  // FPS details (avg / min)
  _fpsDetails = document.createElement('div');
  _fpsDetails.className = 'perf-fps-details';
  _fpsDetails.textContent = 'avg -- / min --';

  // Metrics section
  const metricsDiv = document.createElement('div');
  metricsDiv.className = 'perf-metrics';

  _frameTimeEl = _createMetricRow(metricsDiv, 'Frame');
  _workerLatencyEl = _createMetricRow(metricsDiv, 'Worker');
  _memoryEl = _createMetricRow(metricsDiv, 'Memory');

  // Histogram
  const histSection = document.createElement('div');
  histSection.className = 'perf-histogram';

  const histTitle = document.createElement('div');
  histTitle.className = 'perf-histogram-title';
  histTitle.textContent = 'Frame time distribution';

  const barsContainer = document.createElement('div');
  barsContainer.className = 'perf-histogram-bars';

  _histBar0 = _createHistBar(barsContainer, 'perf-histogram-bar--0to8');
  _histBar1 = _createHistBar(barsContainer, 'perf-histogram-bar--8to16');
  _histBar2 = _createHistBar(barsContainer, 'perf-histogram-bar--16to33');
  _histBar3 = _createHistBar(barsContainer, 'perf-histogram-bar--33plus');

  const labelsContainer = document.createElement('div');
  labelsContainer.className = 'perf-histogram-labels';
  for (const label of ['<8', '8-16', '16-33', '33+']) {
    const el = document.createElement('div');
    el.className = 'perf-histogram-label';
    el.textContent = label;
    labelsContainer.appendChild(el);
  }

  histSection.appendChild(histTitle);
  histSection.appendChild(barsContainer);
  histSection.appendChild(labelsContainer);

  _container.appendChild(_fpsLarge);
  _container.appendChild(_fpsDetails);
  _container.appendChild(metricsDiv);
  _container.appendChild(histSection);

  document.body.appendChild(_container);
}

function _createMetricRow(parent: HTMLElement, label: string): HTMLSpanElement {
  const row = document.createElement('div');
  const labelSpan = document.createElement('span');
  labelSpan.className = 'perf-metric-label';
  labelSpan.textContent = `${label}: `;
  const valueSpan = document.createElement('span');
  valueSpan.className = 'perf-metric-value';
  valueSpan.textContent = '--';
  row.appendChild(labelSpan);
  row.appendChild(valueSpan);
  parent.appendChild(row);
  return valueSpan;
}

function _createHistBar(parent: HTMLElement, className: string): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = `perf-histogram-bar ${className}`;
  bar.style.height = '2px';
  parent.appendChild(bar);
  return bar;
}

// ---------------------------------------------------------------------------
// Internal — update display
// ---------------------------------------------------------------------------

function _update(): void {
  const m = getMetrics();

  if (_fpsLarge) {
    _fpsLarge.textContent = `${Math.round(m.fpsCurrent)} FPS`;
  }
  if (_fpsDetails) {
    _fpsDetails.textContent = `avg ${Math.round(m.fpsAverage)} / min ${Math.round(m.fpsMin)}`;
  }
  if (_frameTimeEl) {
    _frameTimeEl.textContent = `${m.frameTime.toFixed(1)} ms (avg ${m.frameTimeAverage.toFixed(1)})`;
  }
  if (_workerLatencyEl) {
    _workerLatencyEl.textContent = m.workerLatency > 0
      ? `${m.workerLatency.toFixed(1)} ms`
      : 'n/a';
  }
  if (_memoryEl) {
    if (m.memoryUsedBytes > 0) {
      const usedMB = (m.memoryUsedBytes / (1024 * 1024)).toFixed(1);
      const limitMB = (m.memoryLimitBytes / (1024 * 1024)).toFixed(0);
      _memoryEl.textContent = `${usedMB} / ${limitMB} MB`;
    } else {
      _memoryEl.textContent = 'n/a';
    }
  }

  // Update histogram bars
  const total = m.histogram.bucket0to8 + m.histogram.bucket8to16
    + m.histogram.bucket16to33 + m.histogram.bucket33plus;
  const maxH = 32; // matches CSS .perf-histogram-bars height

  if (total > 0) {
    _setBarHeight(_histBar0, m.histogram.bucket0to8, total, maxH);
    _setBarHeight(_histBar1, m.histogram.bucket8to16, total, maxH);
    _setBarHeight(_histBar2, m.histogram.bucket16to33, total, maxH);
    _setBarHeight(_histBar3, m.histogram.bucket33plus, total, maxH);
  }
}

function _setBarHeight(
  bar: HTMLDivElement | null,
  count: number,
  total: number,
  maxH: number,
): void {
  if (!bar) return;
  const h = Math.max(2, (count / total) * maxH);
  bar.style.height = `${h}px`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show the performance dashboard. Creates DOM elements lazily on first call.
 */
export function showPerfDashboard(): void {
  _createDOM();
  if (!_container) return;
  _container.style.display = '';

  // Start update interval if not already running
  if (_intervalId === null) {
    _update(); // immediate first update
    _intervalId = setInterval(_update, UPDATE_INTERVAL_MS);
  }
}

/**
 * Hide the performance dashboard. Stops the update interval.
 */
export function hidePerfDashboard(): void {
  if (_container) {
    _container.style.display = 'none';
  }
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

/**
 * Toggle the performance dashboard visibility.
 */
export function togglePerfDashboard(): void {
  if (_container && _container.style.display !== 'none') {
    hidePerfDashboard();
  } else {
    showPerfDashboard();
  }
}

/**
 * Destroy the performance dashboard — remove DOM elements, clear interval,
 * and clean up all tracked listeners.
 */
export function destroyPerfDashboard(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }

  if (_container) {
    _container.remove();
    _container = null;
  }

  _fpsLarge = null;
  _fpsDetails = null;
  _frameTimeEl = null;
  _workerLatencyEl = null;
  _memoryEl = null;
  _histBar0 = null;
  _histBar1 = null;
  _histBar2 = null;
  _histBar3 = null;
}
