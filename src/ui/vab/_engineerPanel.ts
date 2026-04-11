/**
 * _engineerPanel.ts — Rocket engineer validation panel rendering.
 */

import { runValidation } from '../../core/rocketvalidator.ts';
import { getVabState } from './_state.ts';
import { getActiveHub } from '../../core/hubs.ts';
import { getSurfaceGravity, getBodyDef } from '../../data/bodies.ts';

/**
 * Populate the Rocket Engineer side panel with the latest validation result.
 */
export function renderEngineerPanel(): void {
  const S = getVabState();
  const body = document.getElementById('vab-engineer-body');
  if (!body) return;

  if (!S.assembly || !S.stagingConfig || !S.gameState) {
    body.innerHTML = '<p class="vab-side-empty">No rocket assembly loaded.</p>';
    return;
  }

  const result = S.lastValidation ?? runValidation(S.assembly, S.stagingConfig, S.gameState);
  const html: string[] = [];

  // Determine the active hub's body gravity for TWR recalculation.
  let bodyGravity = 9.81; // Earth default
  let bodyLabel = 'Earth';
  if (S.gameState) {
    try {
      const hub = getActiveHub(S.gameState);
      bodyGravity = getSurfaceGravity(hub.bodyId);
      const bodyDef = getBodyDef(hub.bodyId);
      bodyLabel = bodyDef?.name ?? hub.bodyId;
    } catch {
      // No active hub — use Earth defaults.
    }
  }

  // Recalculate TWR using the hub body's surface gravity.
  const adjustedTwr = result.totalMassKg > 0
    ? (result.stage1Thrust * 1000) / (result.totalMassKg * bodyGravity)
    : 0;

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
  const twrGoodClass = adjustedTwr > 1.0 ? 'vab-val-stat-good' : 'vab-val-stat-bad';
  html.push(
    `<div class="vab-val-stat-row">` +
      `<span class="vab-val-stat-label">TWR (Stage 1) [${bodyLabel}]</span>` +
      `<span class="vab-val-stat-value ${twrGoodClass}">${adjustedTwr.toFixed(2)}</span>` +
    `</div>`,
  );
  html.push('</div>');

  // ── Checks ────────────────────────────────────────────────────────────────
  html.push('<div class="vab-val-checks">');
  for (const check of result.checks) {
    let iconClass: string, iconChar: string, msgClass: string;
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
 */
export function runAndRenderValidation(vabSetLaunchEnabled: (valid: boolean) => void): void {
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
