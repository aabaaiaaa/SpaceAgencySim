/**
 * _staging.js — Staging panel rendering, delta-v computation, staging drag-and-drop reorder.
 */

import { getPartById } from '../../data/parts.js';
import {
  syncStagingWithAssembly,
  addStageToConfig,
  removeStageFromConfig,
  assignPartToStage,
  movePartBetweenStages,
  returnPartToUnstaged,
  validateStagingConfig,
  moveStage,
} from '../../core/rocketbuilder.js';
import { airDensity, SEA_LEVEL_DENSITY } from '../../core/atmosphere.js';
import { getVabState } from './_state.js';

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _runAndRenderValidationFn = () => {};
let _updateStatusBarFn = () => {};
let _updateScaleBarExtentsFn = () => {};
let _updateOffscreenIndicatorsFn = () => {};
let _doZoomToFitFn = () => {};

export function setStagingCallbacks({
  runAndRenderValidation,
  updateStatusBar,
  updateScaleBarExtents,
  updateOffscreenIndicators,
  doZoomToFit,
}) {
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
export function syncAndRenderStaging() {
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
 * Compute the delta-v for a given stage index in the VAB.
 * @param {number} stageIdx
 * @returns {{ dv: number, twr?: number, engines: boolean }}
 */
function computeVabStageDeltaV(stageIdx) {
  const S = getVabState();
  if (!S.assembly || !S.stagingConfig) return { dv: 0, engines: false };
  const stage = S.stagingConfig.stages[stageIdx];
  if (!stage) return { dv: 0, engines: false };

  const G0 = 9.81;

  const density = airDensity(S.dvAltitude);
  const atmFrac = Math.min(1, density / SEA_LEVEL_DENSITY);

  const jettisoned = new Set();
  for (let s = 0; s < stageIdx; s++) {
    for (const id of S.stagingConfig.stages[s].instanceIds) {
      jettisoned.add(id);
    }
  }

  let totalMass = 0;
  let totalFuel = 0;
  for (const [instanceId, placed] of S.assembly.parts) {
    if (jettisoned.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass = def.properties?.fuelMass ?? 0;
    totalMass += (def.mass ?? 0) + fuelMass;
    if (fuelMass > 0) totalFuel += fuelMass;
  }

  let thrustTotal    = 0;
  let ispTimesThrust = 0;
  let hasEngines     = false;
  for (const instanceId of stage.instanceIds) {
    if (jettisoned.has(instanceId)) continue;
    const placed = S.assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    const thrustKN = def.properties?.thrust ?? 0;
    if (thrustKN > 0) {
      hasEngines = true;
      const thrustN = thrustKN * 1000;
      const ispSL  = def.properties?.isp    ?? 300;
      const ispVac = def.properties?.ispVac ?? ispSL;
      const isp = ispSL * atmFrac + ispVac * (1 - atmFrac);
      thrustTotal    += thrustN;
      ispTimesThrust += isp * thrustN;
    }
  }

  const twr = totalMass > 0 && thrustTotal > 0
    ? thrustTotal / (totalMass * G0)
    : 0;

  if (totalFuel <= 0 || thrustTotal <= 0 || totalMass <= 0) {
    return { dv: 0, twr, engines: hasEngines };
  }

  const avgIsp = ispTimesThrust / thrustTotal;
  const dryMass = totalMass - totalFuel;
  if (dryMass <= 0) return { dv: 0, twr, engines: hasEngines };

  return { dv: avgIsp * G0 * Math.log(totalMass / dryMass), twr, engines: true };
}

/**
 * Update only the delta-v values and altitude label in the staging panel.
 * @param {HTMLElement} body
 */
function updateStagingDvValues(body) {
  const S = getVabState();
  if (!S.stagingConfig || !S.assembly) return;

  const numStages = S.stagingConfig.stages.length;
  let totalDv = 0;
  const stageDvs = [];
  for (let i = 0; i < numStages; i++) {
    const result = computeVabStageDeltaV(i);
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
    const idx = parseInt(/** @type {HTMLElement} */ (stageEl).dataset.stageIndex ?? '0', 10);
    const sdv = stageDvs[idx];
    const dvEl = stageEl.querySelector('.vab-stage-dv');
    if (dvEl) {
      dvEl.textContent = sdv && sdv.dv > 0
        ? `\u0394V ~${Math.round(sdv.dv).toLocaleString()} m/s`
        : '';
    }
    const twrEl = stageEl.querySelector('.vab-stage-twr');
    if (twrEl && sdv) {
      twrEl.textContent = sdv.twr > 0 ? `TWR ${sdv.twr.toFixed(2)}` : '';
      twrEl.className = sdv.twr > 0 && sdv.twr < 1
        ? 'vab-stage-twr warn'
        : 'vab-stage-twr';
    }
  });
}

/**
 * Build and inject the staging panel's inner HTML.
 */
export function renderStagingPanel() {
  const S = getVabState();
  const body = /** @type {HTMLElement|null} */ (document.getElementById('vab-staging-body'));
  if (!body) return;

  if (!S.stagingConfig || !S.assembly) {
    body.innerHTML = '<p class="vab-side-empty">No rocket assembly loaded.</p>';
    return;
  }

  const warnings  = validateStagingConfig(S.assembly, S.stagingConfig);
  const numStages = S.stagingConfig.stages.length;
  const html      = [];

  // ── Delta-V altitude slider + total ────────────────────────────────────────
  let totalDv = 0;
  const stageDvs = [];
  for (let i = 0; i < numStages; i++) {
    const result = computeVabStageDeltaV(i);
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
        `<div class="vab-stage-chip" draggable="true" ` +
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
    if (sdv && (sdv.dv > 0 || sdv.twr > 0)) {
      html.push('<div class="vab-stage-stats">');
      if (sdv.dv > 0) {
        html.push(`<span class="vab-stage-dv">\u0394V ~${Math.round(sdv.dv).toLocaleString()} m/s</span>`);
      }
      if (sdv.twr > 0) {
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
          `<div class="vab-stage-chip" draggable="true" ` +
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
  body.querySelector('#vab-staging-add')?.addEventListener('click', () => {
    addStageToConfig(S.stagingConfig);
    renderStagingPanel();
  });
  const altSlider = body.querySelector('#vab-dv-alt-slider');
  if (altSlider) {
    altSlider.addEventListener('input', (e) => {
      S.dvAltitude = parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10);
      updateStagingDvValues(body);
    });
  }

  body.querySelectorAll('.vab-staging-del').forEach((btn) => {
    const el = /** @type {HTMLElement} */ (btn);
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.stageIndex ?? '0', 10);
      removeStageFromConfig(S.stagingConfig, idx);
      renderStagingPanel();
    });
  });
}

/**
 * Set up HTML5 drag-and-drop event delegation on the staging panel body.
 * @param {HTMLElement} panelBody
 */
export function setupStagingDnD(panelBody) {
  const S = getVabState();

  panelBody.addEventListener('dragstart', (e) => {
    const handle = /** @type {HTMLElement} */ (
      /** @type {Element} */ (e.target).closest?.('.vab-stage-drag-handle')
    );
    if (handle) {
      const stageIdx = handle.dataset.stageIndex ?? '';
      e.dataTransfer.setData('text/plain', `stage-reorder|${stageIdx}`);
      e.dataTransfer.effectAllowed = 'move';
      const stageEl = handle.closest('.vab-staging-stage');
      if (stageEl) stageEl.classList.add('dragging');
      return;
    }

    const chip = /** @type {HTMLElement} */ (
      /** @type {Element} */ (e.target).closest?.('.vab-stage-chip')
    );
    if (!chip) return;
    const instanceId = chip.dataset.instanceId ?? '';
    const source     = chip.dataset.source     ?? '';
    e.dataTransfer.setData('text/plain', `${instanceId}|${source}`);
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  });

  panelBody.addEventListener('dragend', (e) => {
    const chip = /** @type {Element} */ (e.target).closest?.('.vab-stage-chip');
    if (chip) chip.classList.remove('dragging');
    const stageEl = /** @type {Element} */ (e.target).closest?.('.vab-staging-stage');
    if (stageEl) stageEl.classList.remove('dragging');
    panelBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  });

  panelBody.addEventListener('dragover', (e) => {
    const zone = /** @type {Element} */ (e.target).closest?.('.vab-staging-zone, .vab-staging-stage');
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');
  });

  panelBody.addEventListener('dragleave', (e) => {
    const zone = /** @type {Element} */ (e.target).closest?.('.vab-staging-zone, .vab-staging-stage');
    if (!zone) return;
    if (!zone.contains(/** @type {Node} */ (e.relatedTarget))) {
      zone.classList.remove('drag-over');
    }
  });

  panelBody.addEventListener('drop', (e) => {
    if (!S.stagingConfig) return;

    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;

    const pipeIdx = raw.indexOf('|');
    const prefix  = raw.slice(0, pipeIdx);
    const suffix  = raw.slice(pipeIdx + 1);

    if (prefix === 'stage-reorder') {
      const targetStage = /** @type {HTMLElement} */ (
        /** @type {Element} */ (e.target).closest?.('.vab-staging-stage')
      );
      if (!targetStage) return;
      e.preventDefault();
      panelBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));

      const fromIndex = parseInt(suffix, 10);
      const toIndex   = parseInt(targetStage.dataset.stageIndex ?? '0', 10);
      if (fromIndex !== toIndex) {
        moveStage(S.stagingConfig, fromIndex, toIndex);
        renderStagingPanel();
        _runAndRenderValidationFn();
      }
      return;
    }

    const zone = /** @type {HTMLElement} */ (
      /** @type {Element} */ (e.target).closest?.('.vab-staging-zone')
    );
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('drag-over');

    const instanceId = prefix;
    const source     = suffix;
    const target     = zone.dataset.dropZone ?? '';

    if (target === source) return;

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

    renderStagingPanel();
    _runAndRenderValidationFn();
  });
}
