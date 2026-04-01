/**
 * _engineerPanel.js — Rocket engineer validation panel rendering.
 */

import { runValidation } from '../../core/rocketvalidator.js';
import { getVabState } from './_state.js';

/**
 * Populate the Rocket Engineer side panel with the latest validation result.
 */
export function renderEngineerPanel() {
  const S = getVabState();
  const body = /** @type {HTMLElement|null} */ (document.getElementById('vab-engineer-body'));
  if (!body) return;

  if (!S.assembly || !S.stagingConfig || !S.gameState) {
    body.innerHTML = '<p class="vab-side-empty">No rocket assembly loaded.</p>';
    return;
  }

  const result = S.lastValidation ?? runValidation(S.assembly, S.stagingConfig, S.gameState);
  const html   = [];

  // ── Stats ─────────────────────────────────────────────────────────────────
  html.push('<div class="vab-val-stats">');
  html.push(
    `<div class="vab-val-stat-row">` +
      `<span class="vab-val-stat-label">Total Mass</span>` +
      `<span class="vab-val-stat-value">${result.totalMassKg.toLocaleString('en-US')} kg</span>` +
    `</div>`,
  );
  html.push(
    `<div class="vab-val-stat-row">` +
      `<span class="vab-val-stat-label">Stage 1 Thrust</span>` +
      `<span class="vab-val-stat-value">${result.stage1Thrust.toFixed(0)} kN</span>` +
    `</div>`,
  );
  const twrGoodClass = result.twr > 1.0 ? 'vab-val-stat-good' : 'vab-val-stat-bad';
  html.push(
    `<div class="vab-val-stat-row">` +
      `<span class="vab-val-stat-label">TWR (Stage 1)</span>` +
      `<span class="vab-val-stat-value ${twrGoodClass}">${result.twr.toFixed(2)}</span>` +
    `</div>`,
  );
  html.push('</div>');

  // ── Checks ────────────────────────────────────────────────────────────────
  html.push('<div class="vab-val-checks">');
  for (const check of result.checks) {
    let iconClass, iconChar, msgClass;
    if (check.pass) {
      iconClass = 'vab-val-icon-pass';
      iconChar  = '&#x2713;';
      msgClass  = 'vab-val-msg-pass';
    } else if (check.warn) {
      iconClass = 'vab-val-icon-warn';
      iconChar  = '&#x26a0;';
      msgClass  = 'vab-val-msg-warn';
    } else {
      iconClass = 'vab-val-icon-fail';
      iconChar  = '&#x2717;';
      msgClass  = 'vab-val-msg-fail';
    }
    html.push(
      `<div class="vab-val-check">` +
        `<div class="vab-val-icon ${iconClass}">${iconChar}</div>` +
        `<div class="vab-val-text">` +
          `<div class="vab-val-label">${check.label}</div>` +
          `<div class="vab-val-msg ${msgClass}">${check.message}</div>` +
        `</div>` +
      `</div>`,
    );
  }
  html.push('</div>');

  // ── Launch status summary ─────────────────────────────────────────────────
  const statusClass = result.canLaunch ? 'vab-val-status-ready' : 'vab-val-status-blocked';
  const statusText  = result.canLaunch ? 'Ready for launch.' : 'Resolve failures to enable launch.';
  html.push(`<div class="vab-val-status ${statusClass}">${statusText}</div>`);

  body.innerHTML = html.join('');
}

/**
 * Run the rocket validation, cache the result, update the Launch button, and
 * refresh the Rocket Engineer panel if it is currently visible.
 *
 * @param {(valid: boolean) => void} vabSetLaunchEnabled
 */
export function runAndRenderValidation(vabSetLaunchEnabled) {
  const S = getVabState();
  if (!S.assembly || !S.stagingConfig || !S.gameState) {
    vabSetLaunchEnabled(false);
    return;
  }

  S.lastValidation = runValidation(S.assembly, S.stagingConfig, S.gameState);
  vabSetLaunchEnabled(S.lastValidation.canLaunch);

  const panel = document.getElementById('vab-engineer-panel');
  if (panel && !panel.hasAttribute('hidden')) {
    renderEngineerPanel();
  }
}
