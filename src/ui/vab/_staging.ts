/**
 * _staging.ts — Staging panel rendering, delta-v computation, staging drag-and-drop reorder.
 */

import { getPartById } from '../../data/parts.ts';
import {
  syncStagingWithAssembly,
  addStageToConfig,
  removeStageFromConfig,
  assignPartToStage,
  movePartBetweenStages,
  returnPartToUnstaged,
  validateStagingConfig,
  moveStage,
} from '../../core/rocketbuilder.ts';
import { airDensity } from '../../core/atmosphere.ts';
import { computeStageDeltaV } from '../../core/stagingCalc.ts';
import { getVabState } from './_state.ts';
import { snapshotStaging, recordStagingChange } from './_undoActions.ts';
import { getVabListenerTracker } from './_listenerTracker.ts';
import { setHoveredPart } from './_canvasInteraction.ts';

/**
 * Register a DOM listener through the VAB tracker so it is cleaned up when
 * the VAB is destroyed.
 */
function _addTracked(
  target: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const tracker = getVabListenerTracker();
  if (tracker) tracker.add(target, event, handler, options);
}

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _runAndRenderValidationFn: () => void = () => {};
let _updateStatusBarFn: () => void = () => {};
let _updateScaleBarExtentsFn: () => void = () => {};
let _updateOffscreenIndicatorsFn: () => void = () => {};
let _doZoomToFitFn: () => void = () => {};

export function setStagingCallbacks({
  runAndRenderValidation,
  updateStatusBar,
  updateScaleBarExtents,
  updateOffscreenIndicators,
  doZoomToFit,
}: {
  runAndRenderValidation: () => void;
  updateStatusBar: () => void;
  updateScaleBarExtents: () => void;
  updateOffscreenIndicators: () => void;
  doZoomToFit: () => void;
}): void {
  _runAndRenderValidationFn = runAndRenderValidation;
  _updateStatusBarFn = updateStatusBar;
  _updateScaleBarExtentsFn = updateScaleBarExtents;
  _updateOffscreenIndicatorsFn = updateOffscreenIndicators;
  _doZoomToFitFn = doZoomToFit;
}

/**
 * Sync staging config with the current assembly and re-render the staging panel.
 * Call after any part add or remove operation.
 */
export function syncAndRenderStaging(): void {
  const S = getVabState();
  if (S.assembly && S.stagingConfig) {
    syncStagingWithAssembly(S.assembly, S.stagingConfig);
    renderStagingPanel();
    _runAndRenderValidationFn();
    _updateStatusBarFn();
    _updateScaleBarExtentsFn();
    _updateOffscreenIndicatorsFn();
    if (S.autoZoomEnabled) _doZoomToFitFn();
  }
}

/**
 * Update only the delta-v values and altitude label in the staging panel.
 */
function updateStagingDvValues(body: HTMLElement): void {
  const S = getVabState();
  if (!S.stagingConfig || !S.assembly) return;

  const numStages = S.stagingConfig.stages.length;
  let totalDv = 0;
  const stageDvs: Array<{ dv: number; twr?: number; engines: boolean }> = [];
  for (let i = 0; i < numStages; i++) {
    const result = computeStageDeltaV(i, S.assembly!, S.stagingConfig!, S.dvAltitude);
    stageDvs.push(result);
    totalDv += result.dv;
  }

  const density = airDensity(S.dvAltitude);
  const altStr = S.dvAltitude >= 1000
    ? (S.dvAltitude / 1000).toFixed(1) + ' km'
    : S.dvAltitude + ' m';
  const altEl = body.querySelector('.vab-dv-alt-label');
  if (altEl) altEl.textContent = altStr;
  const densEl = body.querySelector('.vab-dv-density-label');
  if (densEl) densEl.textContent = `Air density: ${density.toFixed(3)} kg/m\u00B3`;

  const totalEl = body.querySelector('.vab-staging-dv-total');
  if (totalEl) {
    totalEl.textContent = `Total \u0394V: ~${Math.round(totalDv).toLocaleString()} m/s`;
  }

  body.querySelectorAll('.vab-staging-stage').forEach((stageEl) => {
    const idx = parseInt((stageEl as HTMLElement).dataset.stageIndex ?? '0', 10);
    const sdv = stageDvs[idx];
    const dvEl = stageEl.querySelector('.vab-stage-dv');
    if (dvEl) {
      dvEl.textContent = sdv && sdv.dv > 0
        ? `\u0394V ~${Math.round(sdv.dv).toLocaleString()} m/s`
        : '';
    }
    const twrEl = stageEl.querySelector('.vab-stage-twr');
    if (twrEl && sdv) {
      twrEl.textContent = sdv.twr !== undefined && sdv.twr > 0 ? `TWR ${sdv.twr.toFixed(2)}` : '';
      twrEl.className = sdv.twr !== undefined && sdv.twr > 0 && sdv.twr < 1
        ? 'vab-stage-twr warn'
        : 'vab-stage-twr';
    }
  });
}

/**
 * Build and inject the staging panel's inner HTML.
 */
export function renderStagingPanel(): void {
  const S = getVabState();
  const body = document.getElementById('vab-staging-body') as HTMLElement | null;
  if (!body) return;

  if (!S.stagingConfig || !S.assembly) {
    body.innerHTML = '<p class="vab-side-empty">No rocket assembly loaded.</p>';
    return;
  }

  const warnings  = validateStagingConfig(S.assembly, S.stagingConfig);
  const numStages = S.stagingConfig.stages.length;
  const html: string[]      = [];

  // ── Delta-V altitude slider + total ────────────────────────────────────────
  let totalDv = 0;
  const stageDvs: Array<{ dv: number; twr?: number; engines: boolean }> = [];
  for (let i = 0; i < numStages; i++) {
    const result = computeStageDeltaV(i, S.assembly!, S.stagingConfig!, S.dvAltitude);
    stageDvs.push(result);
    totalDv += result.dv;
  }

  const density = airDensity(S.dvAltitude);
  const altStr = S.dvAltitude >= 1000
    ? (S.dvAltitude / 1000).toFixed(1) + ' km'
    : S.dvAltitude + ' m';

  html.push('<div class="vab-dv-altitude">');
  html.push('<div class="vab-dv-altitude-row">');
  html.push('<span>Altitude</span>');
  html.push(
    `<input type="range" id="vab-dv-alt-slider" min="0" max="70000" ` +
    `step="500" value="${S.dvAltitude}">`,
  );
  html.push('</div>');
  html.push(
    `<div class="vab-dv-altitude-info">` +
    `<span class="vab-dv-alt-label">${altStr}</span>` +
    `<span class="vab-dv-density-label">Air density: ${density.toFixed(3)} kg/m\u00B3</span>` +
    `</div>`,
  );
  html.push('</div>');

  html.push('<div class="vab-staging-dv">');
  html.push(
    `<div class="vab-staging-dv-total">Total \u0394V: ~${Math.round(totalDv).toLocaleString()} m/s</div>`,
  );
  html.push('</div>');

  // ── Unstaged parts ────────────────────────────────────────────────────────
  html.push('<div class="vab-staging-section">');
  html.push('<div class="vab-staging-section-hdr">Unstaged Parts</div>');
  html.push('<div class="vab-staging-zone" data-drop-zone="unstaged">');
  if (S.stagingConfig.unstaged.length === 0) {
    html.push('<div class="vab-staging-zone-empty">All activatable parts staged.</div>');
  } else {
    for (const id of S.stagingConfig.unstaged) {
      const placed = S.assembly.parts.get(id);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      html.push(
        `<div class="vab-stage-chip" draggable="true" tabindex="0" ` +
        `data-instance-id="${id}" data-source="unstaged" ` +
        `title="${def.name}">${def.name}</div>`,
      );
    }
  }
  html.push('</div>');
  html.push('</div>');

  // ── Stages ────────────────────
  for (let i = numStages - 1; i >= 0; i--) {
    const stageNum = i + 1;
    const stage    = S.stagingConfig.stages[i];
    const isEmpty  = stage.instanceIds.length === 0;
    const isFirst  = i === 0;
    const isCurrent = i === S.stagingConfig.currentStageIdx;

    const stageClasses = [
      'vab-staging-stage',
      isFirst   ? 'vab-staging-stage-first'   : '',
      isCurrent ? 'vab-staging-stage-current' : '',
    ].filter(Boolean).join(' ');

    html.push(`<div class="${stageClasses}" data-stage-index="${i}">`);

    html.push('<div class="vab-staging-stage-hdr">');
    if (numStages > 1) {
      html.push(
        `<span class="vab-stage-drag-handle" draggable="true" ` +
        `data-stage-drag="true" data-stage-index="${i}" ` +
        `title="Drag to reorder stage">&#x2807;</span>`,
      );
    }
    const label = isFirst
      ? `Stage ${stageNum} \u2014 FIRES FIRST`
      : `Stage ${stageNum}`;
    html.push(`<span>${label}</span>`);
    if (isEmpty && numStages > 1) {
      html.push(
        `<button class="vab-staging-del" data-stage-index="${i}" ` +
        `type="button" title="Remove empty stage">&#x2715;</button>`,
      );
    }
    html.push('</div>');

    const sdv = stageDvs[i];
    if (sdv && (sdv.dv > 0 || (sdv.twr !== undefined && sdv.twr > 0))) {
      html.push('<div class="vab-stage-stats">');
      if (sdv.dv > 0) {
        html.push(`<span class="vab-stage-dv">\u0394V ~${Math.round(sdv.dv).toLocaleString()} m/s</span>`);
      }
      if (sdv.twr !== undefined && sdv.twr > 0) {
        const twrClass = sdv.twr < 1 ? 'vab-stage-twr warn' : 'vab-stage-twr';
        html.push(`<span class="${twrClass}">TWR ${sdv.twr.toFixed(2)}</span>`);
      }
      html.push('</div>');
    }

    html.push(`<div class="vab-staging-zone" data-drop-zone="stage-${i}">`);
    if (isEmpty) {
      html.push('<div class="vab-staging-zone-empty">Drop parts here</div>');
    } else {
      for (const id of stage.instanceIds) {
        const placed = S.assembly.parts.get(id);
        const def    = placed ? getPartById(placed.partId) : null;
        if (!def) continue;
        html.push(
          `<div class="vab-stage-chip" draggable="true" tabindex="0" ` +
          `data-instance-id="${id}" data-source="stage-${i}" ` +
          `title="${def.name}">${def.name}</div>`,
        );
      }
    }
    html.push('</div>');
    html.push('</div>');
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  html.push('<div class="vab-staging-controls">');
  html.push(
    '<button class="vab-btn" id="vab-staging-add" type="button">' +
    '+ Add Stage</button>',
  );
  html.push('</div>');

  // ── Validation warnings ───────────────────────────────────────────────────
  if (warnings.length > 0) {
    html.push('<div class="vab-staging-warnings">');
    for (const w of warnings) {
      html.push(`<div class="vab-staging-warn">\u26a0 ${w}</div>`);
    }
    html.push('</div>');
  }

  body.innerHTML = html.join('');

  // Re-attach button listeners.
  const stagingAddBtn = body.querySelector('#vab-staging-add');
  if (stagingAddBtn) _addTracked(stagingAddBtn, 'click', () => {
    addStageToConfig(S.stagingConfig!);
    renderStagingPanel();
  });
  const altSlider = body.querySelector('#vab-dv-alt-slider');
  if (altSlider) {
    _addTracked(altSlider, 'input', ((e: Event) => {
      S.dvAltitude = parseInt((e.target as HTMLInputElement).value, 10);
      updateStagingDvValues(body);
    }) as EventListener);
  }

  body.querySelectorAll('.vab-staging-del').forEach((btn) => {
    const el = btn as HTMLElement;
    _addTracked(el, 'click', () => {
      const idx = parseInt(el.dataset.stageIndex ?? '0', 10);
      removeStageFromConfig(S.stagingConfig!, idx);
      renderStagingPanel();
    });
  });
}

/**
 * Set up HTML5 drag-and-drop event delegation on the staging panel body.
 */
export function setupStagingDnD(panelBody: HTMLElement): void {
  const S = getVabState();

  _addTracked(panelBody, 'mouseover', ((e: MouseEvent) => {
    const chip = (e.target as Element | null)?.closest?.('.vab-stage-chip') as HTMLElement | null;
    if (!chip) return;
    const instanceId = chip.dataset.instanceId ?? '';
    if (instanceId) setHoveredPart(instanceId);
  }) as EventListener);

  _addTracked(panelBody, 'mouseleave', (() => {
    setHoveredPart(null);
  }) as EventListener);

  _addTracked(panelBody, 'dragstart', ((e: DragEvent) => {
    const handle = (e.target as Element)?.closest?.('.vab-stage-drag-handle') as HTMLElement | null;
    if (handle) {
      const stageIdx = handle.dataset.stageIndex ?? '';
      e.dataTransfer!.setData('text/plain', `stage-reorder|${stageIdx}`);
      e.dataTransfer!.effectAllowed = 'move';
      const stageEl = handle.closest('.vab-staging-stage');
      if (stageEl) stageEl.classList.add('dragging');
      return;
    }

    const chip = (e.target as Element)?.closest?.('.vab-stage-chip') as HTMLElement | null;
    if (!chip) return;
    const instanceId = chip.dataset.instanceId ?? '';
    const source     = chip.dataset.source     ?? '';
    e.dataTransfer!.setData('text/plain', `${instanceId}|${source}`);
    e.dataTransfer!.effectAllowed = 'move';
    chip.classList.add('dragging');
  }) as EventListener);

  _addTracked(panelBody, 'dragend', ((e: DragEvent) => {
    const chip = (e.target as Element)?.closest?.('.vab-stage-chip');
    if (chip) chip.classList.remove('dragging');
    const stageEl = (e.target as Element)?.closest?.('.vab-staging-stage');
    if (stageEl) stageEl.classList.remove('dragging');
    panelBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
    setHoveredPart(null);
  }) as EventListener);

  _addTracked(panelBody, 'dragover', ((e: DragEvent) => {
    const zone = (e.target as Element)?.closest?.('.vab-staging-zone, .vab-staging-stage');
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    zone.classList.add('drag-over');
  }) as EventListener);

  _addTracked(panelBody, 'dragleave', ((e: DragEvent) => {
    const zone = (e.target as Element)?.closest?.('.vab-staging-zone, .vab-staging-stage');
    if (!zone) return;
    if (!zone.contains(e.relatedTarget as Node)) {
      zone.classList.remove('drag-over');
    }
  }) as EventListener);

  _addTracked(panelBody, 'drop', ((e: DragEvent) => {
    if (!S.stagingConfig) return;

    const raw = e.dataTransfer!.getData('text/plain');
    if (!raw) return;

    const pipeIdx = raw.indexOf('|');
    const prefix  = raw.slice(0, pipeIdx);
    const suffix  = raw.slice(pipeIdx + 1);

    if (prefix === 'stage-reorder') {
      const targetStage = (e.target as Element)?.closest?.('.vab-staging-stage') as HTMLElement | null;
      if (!targetStage) return;
      e.preventDefault();
      panelBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));

      const fromIndex = parseInt(suffix, 10);
      const toIndex   = parseInt(targetStage.dataset.stageIndex ?? '0', 10);
      if (fromIndex !== toIndex) {
        const stagingBefore = snapshotStaging();
        moveStage(S.stagingConfig, fromIndex, toIndex);
        recordStagingChange(stagingBefore);
        renderStagingPanel();
        _runAndRenderValidationFn();
      }
      return;
    }

    const zone = (e.target as Element)?.closest?.('.vab-staging-zone') as HTMLElement | null;
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('drag-over');

    const instanceId = prefix;
    const source     = suffix;
    const target     = zone.dataset.dropZone ?? '';

    if (target === source) return;

    const stagingBefore = snapshotStaging();

    if (target === 'unstaged') {
      returnPartToUnstaged(S.stagingConfig, instanceId);
    } else if (target.startsWith('stage-')) {
      const toIdx = parseInt(target.slice(6), 10);
      if (source === 'unstaged') {
        assignPartToStage(S.stagingConfig, instanceId, toIdx);
      } else if (source.startsWith('stage-')) {
        const fromIdx = parseInt(source.slice(6), 10);
        movePartBetweenStages(S.stagingConfig, instanceId, fromIdx, toIdx);
      }
    }

    recordStagingChange(stagingBefore);
    renderStagingPanel();
    _runAndRenderValidationFn();
  }) as EventListener);
}
