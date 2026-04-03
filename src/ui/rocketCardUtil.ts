/**
 * rocketCardUtil.ts — Shared rocket preview renderer and card builder.
 *
 * Extracted from launchPad.js so the same card UI can be reused in the
 * VAB's save/load screen.
 *
 * @module rocketCardUtil
 */

import { getPartById } from '../data/parts.js';
import { PartType } from '../core/constants.js';
import { injectStyleOnce } from './injectStyle.js';
import type { RocketDesign } from '../core/gameState.js';
import type { PartDef } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Preview rendering constants
// ---------------------------------------------------------------------------

/** Part fill colours keyed by PartType (CSS hex strings). */
const PART_FILL: Record<string, string> = {
  [PartType.COMMAND_MODULE]:       '#1a3860',
  [PartType.COMPUTER_MODULE]:      '#122848',
  [PartType.SERVICE_MODULE]:       '#1c2c58',
  [PartType.FUEL_TANK]:            '#0e2040',
  [PartType.ENGINE]:               '#3a1a08',
  [PartType.SOLID_ROCKET_BOOSTER]: '#301408',
  [PartType.STACK_DECOUPLER]:      '#142030',
  [PartType.RADIAL_DECOUPLER]:     '#142030',
  [PartType.DECOUPLER]:            '#142030',
  [PartType.LANDING_LEG]:          '#102018',
  [PartType.LANDING_LEGS]:         '#102018',
  [PartType.PARACHUTE]:            '#2e1438',
  [PartType.SATELLITE]:            '#142240',
  [PartType.HEAT_SHIELD]:          '#2c1000',
  [PartType.RCS_THRUSTER]:         '#182c30',
  [PartType.SOLAR_PANEL]:          '#0a2810',
  [PartType.LAUNCH_CLAMP]:         '#2a2818',
};

/** Part stroke colours keyed by PartType (CSS hex strings). */
const PART_STROKE: Record<string, string> = {
  [PartType.COMMAND_MODULE]:       '#4080c0',
  [PartType.COMPUTER_MODULE]:      '#2870a0',
  [PartType.SERVICE_MODULE]:       '#3860b0',
  [PartType.FUEL_TANK]:            '#2060a0',
  [PartType.ENGINE]:               '#c06020',
  [PartType.SOLID_ROCKET_BOOSTER]: '#a04818',
  [PartType.STACK_DECOUPLER]:      '#305080',
  [PartType.RADIAL_DECOUPLER]:     '#305080',
  [PartType.DECOUPLER]:            '#305080',
  [PartType.LANDING_LEG]:          '#207840',
  [PartType.LANDING_LEGS]:         '#207840',
  [PartType.PARACHUTE]:            '#8040a0',
  [PartType.SATELLITE]:            '#2868b0',
  [PartType.HEAT_SHIELD]:          '#a04010',
  [PartType.RCS_THRUSTER]:         '#2890a0',
  [PartType.SOLAR_PANEL]:          '#20a040',
  [PartType.LAUNCH_CLAMP]:         '#807040',
};

const PREVIEW_W = 80;
const PREVIEW_H = 120;
const PREVIEW_PAD = 6;

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const ROCKET_CARD_CSS = `
.rocket-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: background 0.15s;
}
.rocket-card:hover {
  background: rgba(255,255,255,0.07);
}
.rocket-card-preview {
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 4px;
  background: rgba(0,0,0,0.3);
}
.rocket-card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.rocket-card-name {
  font-size: 1rem;
  font-weight: 600;
  color: #e8e8e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rocket-card-stats {
  font-size: 0.78rem;
  color: #7888a0;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}
.rocket-card-date {
  font-size: 0.72rem;
  color: #5a6880;
}
.rocket-card-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.rocket-card-actions button {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
.rocket-card-actions button:hover {
  background: rgba(255,255,255,0.16);
}
`;

/**
 * Inject shared rocket card CSS into the document head (idempotent).
 */
export function injectRocketCardCSS(): void {
  injectStyleOnce('rocket-card-css', ROCKET_CARD_CSS);
}

// ---------------------------------------------------------------------------
// Preview renderer
// ---------------------------------------------------------------------------

/** Resolved part data for preview rendering. */
interface ResolvedPart {
  px: number;
  py: number;
  hw: number;
  hh: number;
  def: PartDef;
}

/**
 * Draw a miniature rocket preview onto a 2D canvas element.
 */
export function renderRocketPreview(canvas: HTMLCanvasElement, design: RocketDesign): void {
  canvas.width  = PREVIEW_W;
  canvas.height = PREVIEW_H;
  canvas.className = 'rocket-card-preview';

  const ctx = canvas.getContext('2d');
  if (!ctx || !design.parts || design.parts.length === 0) return;

  const resolved: ResolvedPart[] = [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const p of design.parts) {
    const def = getPartById(p.partId);
    if (!def) continue;
    const hw = (def.width  ?? 40) / 2;
    const hh = (def.height ?? 20) / 2;
    const px = p.position.x;
    const py = p.position.y;
    minX = Math.min(minX, px - hw);
    maxX = Math.max(maxX, px + hw);
    minY = Math.min(minY, py - hh);
    maxY = Math.max(maxY, py + hh);
    resolved.push({ px, py, hw, hh, def });
  }

  if (resolved.length === 0) return;

  const rocketW = maxX - minX;
  const rocketH = maxY - minY;

  const drawW = PREVIEW_W - PREVIEW_PAD * 2;
  const drawH = PREVIEW_H - PREVIEW_PAD * 2;
  const scale = Math.min(drawW / Math.max(rocketW, 1), drawH / Math.max(rocketH, 1));

  const cx = PREVIEW_W  / 2;
  const cy = PREVIEW_H / 2;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  for (const { px, py, hw, hh, def } of resolved) {
    const sx = cx + (px - midX) * scale;
    const sy = cy - (py - midY) * scale;
    const sw = hw * 2 * scale;
    const sh = hh * 2 * scale;

    ctx.fillStyle   = PART_FILL[def.type]   ?? '#0e2040';
    ctx.strokeStyle = PART_STROKE[def.type]  ?? '#2060a0';
    ctx.lineWidth   = 1;
    ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);
    ctx.strokeRect(sx - sw / 2, sy - sh / 2, sw, sh);
  }
}

// ---------------------------------------------------------------------------
// Card builder
// ---------------------------------------------------------------------------

/**
 * Format a number with commas.
 */
function _fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Action button definition for a rocket card. */
export interface RocketCardAction {
  label: string;
  className?: string;
  onClick: () => void;
}

/**
 * Build a rocket design card element.
 */
export function buildRocketCard(design: RocketDesign, actions: RocketCardAction[]): HTMLDivElement {
  injectRocketCardCSS();

  const card: HTMLDivElement = document.createElement('div');
  card.className = 'rocket-card';
  card.dataset.rocketId = design.id;

  // Preview thumbnail
  const previewCanvas: HTMLCanvasElement = document.createElement('canvas');
  renderRocketPreview(previewCanvas, design);
  card.appendChild(previewCanvas);

  // Info column
  const info: HTMLDivElement = document.createElement('div');
  info.className = 'rocket-card-info';

  const name: HTMLDivElement = document.createElement('div');
  name.className = 'rocket-card-name';
  name.textContent = design.name || 'Unnamed Rocket';
  info.appendChild(name);

  const stats: HTMLDivElement = document.createElement('div');
  stats.className = 'rocket-card-stats';
  stats.innerHTML =
    `<span>Parts: ${design.parts?.length ?? 0}</span>` +
    `<span>Mass: ${_fmt(design.totalMass)} kg</span>` +
    `<span>Thrust: ${_fmt(design.totalThrust)} kN</span>`;
  info.appendChild(stats);

  const date: HTMLDivElement = document.createElement('div');
  date.className = 'rocket-card-date';
  if (design.createdDate) {
    const d = new Date(design.createdDate);
    date.textContent = `Created: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  }
  info.appendChild(date);

  card.appendChild(info);

  // Action buttons
  if (actions && actions.length > 0) {
    const actionsEl: HTMLDivElement = document.createElement('div');
    actionsEl.className = 'rocket-card-actions';
    for (const action of actions) {
      const btn: HTMLButtonElement = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      if (action.className) btn.className = action.className;
      btn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        action.onClick();
      });
      actionsEl.appendChild(btn);
    }
    card.appendChild(actionsEl);
  }

  return card;
}
