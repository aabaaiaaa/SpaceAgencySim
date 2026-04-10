/**
 * _rocket.ts — Rocket assembly rendering.
 *
 * Part rectangles with labels, parachute canopy drawing, landing leg drawing,
 * malfunction overlays, heat glow overlays.
 */

import * as PIXI from 'pixi.js';
import { getPartById } from '../../data/parts.ts';
import type { PartDef } from '../../data/parts.ts';
import { PartType } from '../../core/constants.ts';
import { getHeatRatio } from '../../core/atmosphere.ts';
import { DEPLOY_DURATION } from '../../core/parachute.ts';
import { getDeployedLegFootOffset } from '../../core/legs.ts';
import type { ReadonlyPhysicsState, ReadonlyAssembly } from '../types.ts';
import type { PlacedPart } from '../../core/rocketbuilder.ts';
import { getFlightRenderState } from './_state.ts';
import { ppm, worldToScreen, computeCoM } from './_camera.ts';
import { SCALE_M_PER_PX, PART_FILL, PART_STROKE } from './_constants.ts';
import { acquireGraphics, acquireText, releaseContainerChildren } from './_pool.ts';

// ---------------------------------------------------------------------------
// Part drawing helpers
// ---------------------------------------------------------------------------

/**
 * Draw a single part rectangle into `g` in the container's local coordinate space.
 */
export function drawPartRect(g: PIXI.Graphics, placed: PlacedPart, def: PartDef, alpha = 1): void {
  const lx = placed.x;
  const ly = -placed.y;
  const pw = def.width  ?? 40;
  const ph = def.height ?? 20;

  const fill   = PART_FILL[def.type]   ?? 0x0e2040;
  const stroke = PART_STROKE[def.type] ?? 0x2060a0;

  g.rect(lx - pw / 2, ly - ph / 2, pw, ph);
  g.fill({ color: fill, alpha });
  g.stroke({ color: stroke, width: 1, alpha });
}

/**
 * Draw pulsing warning overlays on all parts with active malfunctions.
 */
export function drawMalfunctionOverlays(g: PIXI.Graphics, ps: ReadonlyPhysicsState, assembly: ReadonlyAssembly): void {
  if (!ps.malfunctions || ps.malfunctions.size === 0) return;

  const pulse = 0.30 + 0.15 * Math.sin(Date.now() * 0.012);

  for (const [instanceId, entry] of ps.malfunctions) {
    if (entry.recovered) continue;
    if (!ps.activeParts.has(instanceId)) continue;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const lx = placed.x;
    const ly = -placed.y;
    const pw = def.width  ?? 40;
    const ph = def.height ?? 20;

    g.rect(lx - pw / 2, ly - ph / 2, pw, ph);
    g.fill({ color: 0xff4422, alpha: pulse });
    g.stroke({ color: 0xff6633, width: 2, alpha: pulse + 0.2 });

    const tx = lx + pw / 2 - 3;
    const ty = ly - ph / 2 + 2;
    g.moveTo(tx, ty);
    g.lineTo(tx + 5, ty + 8);
    g.lineTo(tx - 5, ty + 8);
    g.closePath();
    g.fill({ color: 0xffaa00, alpha: 0.9 });
  }
}

/**
 * Draw heat glow overlays on parts experiencing atmospheric heating.
 */
export function drawHeatGlowOverlays(g: PIXI.Graphics, ps: ReadonlyPhysicsState, assembly: ReadonlyAssembly): void {
  if (!ps.heatMap || ps.heatMap.size === 0) return;

  const now = Date.now();

  for (const instanceId of ps.activeParts) {
    const ratio = getHeatRatio(ps, instanceId, assembly);
    if (ratio < 0.1) continue;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const lx = placed.x;
    const ly = -placed.y;
    const pw = def.width  ?? 40;
    const ph = def.height ?? 20;

    const freq = 1.5 + ratio * 2.5;
    const pulse = 0.5 + 0.5 * Math.sin(now * freq * 0.006);

    let color: number;
    if (ratio < 0.4) {
      color = 0xff6600;
    } else if (ratio < 0.7) {
      color = 0xff4400;
    } else {
      color = 0xff8844;
    }

    const baseAlpha = 0.15 + ratio * 0.45;
    const alpha = baseAlpha * (0.6 + 0.4 * pulse);

    g.rect(lx - pw / 2, ly - ph / 2, pw, ph);
    g.fill({ color, alpha });

    if (ratio > 0.3) {
      const strokeAlpha = (ratio - 0.3) * 0.8 * (0.7 + 0.3 * pulse);
      g.rect(lx - pw / 2, ly - ph / 2, pw, ph);
      g.stroke({ color: 0xffaa22, width: 2, alpha: strokeAlpha });
    }
  }
}

// ---------------------------------------------------------------------------
// Landing leg helpers
// ---------------------------------------------------------------------------

interface LegLikeState {
  legStates?: ReadonlyMap<string, { state: string; deployTimer: number }>;
}

function _getLegSide(placed: PlacedPart, assembly: ReadonlyAssembly): number {
  if (assembly?.connections) {
    for (const conn of assembly.connections) {
      let parentInstanceId: string | undefined, parentSnapIndex: number | undefined;
      if (conn.fromInstanceId === placed.instanceId) {
        parentInstanceId = conn.toInstanceId;
        parentSnapIndex  = conn.toSnapIndex;
      } else if (conn.toInstanceId === placed.instanceId) {
        parentInstanceId = conn.fromInstanceId;
        parentSnapIndex  = conn.fromSnapIndex;
      } else {
        continue;
      }
      const parentPlaced = assembly.parts.get(parentInstanceId!);
      if (!parentPlaced) continue;
      const parentDef = getPartById(parentPlaced.partId);
      if (!parentDef) continue;
      const snap = parentDef.snapPoints[parentSnapIndex!];
      if (snap) {
        if (snap.side === 'left')  return -1;
        if (snap.side === 'right') return  1;
      }
    }
  }
  return (placed.x >= 0) ? 1 : -1;
}

/**
 * Draw a landing leg with state-aware deployment animation.
 */
export function drawLandingLeg(
  g: PIXI.Graphics,
  placed: PlacedPart,
  def: PartDef,
  ps: LegLikeState,
  assembly: ReadonlyAssembly,
  alpha = 1,
): void {
  const lx = placed.x;
  const ly = -placed.y;
  const pw = def.width  ?? 40;
  const ph = def.height ?? 20;

  const fill   = PART_FILL[def.type]   ?? 0x0e2040;
  const stroke = PART_STROKE[def.type] ?? 0x2060a0;

  const side = _getLegSide(placed, assembly);

  const { dx, dy, t } = getDeployedLegFootOffset(placed.instanceId, def, ps.legStates);

  // Housing rectangle
  const housingW = pw * 0.5;
  const housingH = ph * 0.4;
  g.rect(lx - housingW / 2, ly - housingH / 2, housingW, housingH);
  g.fill({ color: fill, alpha });
  g.stroke({ color: stroke, width: 1, alpha });

  // Foot point
  const footX = lx + dx * side;
  const footY = ly + dy;

  // Upper strut
  const upperStartX = lx;
  const upperStartY = ly - ph / 4;
  g.moveTo(upperStartX, upperStartY);
  g.lineTo(footX, footY);
  g.stroke({ color: stroke, width: 2, alpha });

  // Lower strut
  const lowerStartX = lx;
  const lowerStartY = ly + ph / 4;
  g.moveTo(lowerStartX, lowerStartY);
  g.lineTo(footX, footY);
  g.stroke({ color: stroke, width: 2, alpha });

  // Foot pad
  if (t > 0) {
    const padHalf = pw * 0.3 * t;
    g.moveTo(footX - padHalf, footY);
    g.lineTo(footX + padHalf, footY);
    g.stroke({ color: stroke, width: 3, alpha });
  }
}

/**
 * Create a PIXI.Text label for a part.
 */
export function makePartLabel(placed: PlacedPart, def: PartDef, alpha = 1): PIXI.Text {
  const label = acquireText();
  label.text = def.name;
  label.style = new PIXI.TextStyle({
    fill:       '#c0ddf0',
    fontSize:   48,
    fontFamily: 'Courier New, Courier, monospace',
    fontWeight: 'bold',
  });
  label.anchor.set(0.5, 0.5);
  label.x     = placed.x;
  label.y     = -placed.y;
  const containerScale = ppm() * SCALE_M_PER_PX;
  label.scale.set(10 / 48 / containerScale);
  label.alpha = alpha;
  return label;
}

// ---------------------------------------------------------------------------
// Parachute canopy rendering
// ---------------------------------------------------------------------------

/**
 * Draw deployed canopies above every deploying or deployed PARACHUTE part.
 */
export function drawParachuteCanopies(ps: ReadonlyPhysicsState, assembly: ReadonlyAssembly, w: number, h: number): void {
  const s = getFlightRenderState();
  if (!s.canopyContainer) return;

  releaseContainerChildren(s.canopyContainer);

  const p = ppm();
  const rocketAngle = ps.angle;
  const cosR = Math.cos(rocketAngle);
  const sinR = Math.sin(rocketAngle);

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!placed || !def || def.type !== PartType.PARACHUTE) continue;

    const entry = ps.parachuteStates?.get(instanceId);
    if (!entry || entry.state === 'packed' || entry.state === 'failed') continue;

    const progress = entry.state === 'deployed'
      ? 1
      : Math.max(0, Math.min(1, 1 - entry.deployTimer / DEPLOY_DURATION));

    if (progress <= 0) continue;

    const props = def.properties ?? {};
    const canopyAngle = entry.canopyAngle ?? 0;

    const stowedW    = def.width ?? 20;
    const deployedW  = ((props as Record<string, unknown>).deployedDiameter as number ?? 10) / SCALE_M_PER_PX;
    const currentW   = stowedW + (deployedW - stowedW) * progress;
    const halfW      = currentW / 2;

    const halfH = halfW * 0.35;

    const stowedHalfH = (def.height ?? 10) / 2;

    const stowedTopLX = placed.x;
    const stowedTopLY = -(placed.y + stowedHalfH);

    const stowedWorldX = ps.posX + (stowedTopLX * cosR - stowedTopLY * sinR) * SCALE_M_PER_PX;
    const stowedWorldY = ps.posY - (stowedTopLX * sinR + stowedTopLY * cosR) * SCALE_M_PER_PX;

    const canopyOffsetM = halfH * SCALE_M_PER_PX;
    const cosC = Math.cos(canopyAngle);
    const sinC = Math.sin(canopyAngle);
    const canopyWorldX = stowedWorldX - sinC * canopyOffsetM;
    const canopyWorldY = stowedWorldY + cosC * canopyOffsetM;

    const { sx: canopySX, sy: canopySY } = worldToScreen(canopyWorldX, canopyWorldY, w, h);
    const { sx: stowedSX, sy: stowedSY } = worldToScreen(stowedWorldX, stowedWorldY, w, h);

    const scale = p * SCALE_M_PER_PX;
    const sHalfW = halfW * scale;
    const sHalfH = halfH * scale;

    const alpha = Math.min(1, progress);
    const cg = acquireGraphics();

    cg.position.set(canopySX, canopySY);
    cg.rotation = canopyAngle;
    cg.ellipse(0, 0, sHalfW, sHalfH);
    cg.fill({ color: 0x6020a8, alpha: 0.55 * alpha });
    cg.stroke({ color: 0xc070ff, width: 1, alpha: 0.85 * alpha });

    const cordAlpha = 0.6 * alpha;
    const cordInset = (stowedW * 0.25) * scale;

    const stowedLeftX  = stowedSX + cosR * (-cordInset);
    const stowedLeftY  = stowedSY + sinR * (-cordInset);
    const stowedRightX = stowedSX + cosR * cordInset;
    const stowedRightY = stowedSY + sinR * cordInset;

    const canopyLeftX  = canopySX + cosC * (-sHalfW) - sinC * sHalfH;
    const canopyLeftY  = canopySY + sinC * (-sHalfW) + cosC * sHalfH;
    const canopyRightX = canopySX + cosC * sHalfW    - sinC * sHalfH;
    const canopyRightY = canopySY + sinC * sHalfW    + cosC * sHalfH;

    const cordGfx = acquireGraphics();
    cordGfx.moveTo(stowedLeftX, stowedLeftY);
    cordGfx.lineTo(canopyLeftX, canopyLeftY);
    cordGfx.stroke({ color: 0xc070ff, width: 0.8, alpha: cordAlpha });

    cordGfx.moveTo(stowedRightX, stowedRightY);
    cordGfx.lineTo(canopyRightX, canopyRightY);
    cordGfx.stroke({ color: 0xc070ff, width: 0.8, alpha: cordAlpha });

    s.canopyContainer.addChild(cg);
    s.canopyContainer.addChild(cordGfx);
  }
}

// ---------------------------------------------------------------------------
// Rocket rendering
// ---------------------------------------------------------------------------

/**
 * Render the main active rocket into _rocketContainer.
 */
export function renderRocket(ps: ReadonlyPhysicsState, assembly: ReadonlyAssembly, w: number, h: number): void {
  const s = getFlightRenderState();
  if (!s.rocketContainer) return;

  releaseContainerChildren(s.rocketContainer);
  if (ps.activeParts.size === 0) return;

  const com       = computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
  const comLocalX =  (com.x - ps.posX) / SCALE_M_PER_PX;
  const comLocalY = -(com.y - ps.posY) / SCALE_M_PER_PX;

  let lowestPartBottomPx = 0;
  if (ps.grounded || ps.landed) {
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!placed || !def) continue;
      let bottom = placed.y - (def.height ?? 40) / 2;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        const footVabY = placed.y - dy;
        if (footVabY < bottom) bottom = footVabY;
      }
      if (bottom < lowestPartBottomPx) lowestPartBottomPx = bottom;
    }
  }

  const { sx, sy } = worldToScreen(ps.posX, ps.posY, w, h);
  const scale = ppm() * SCALE_M_PER_PX;

  s.rocketContainer.scale.set(scale);

  if ((ps.grounded || ps.landed) && ps.isTipping) {
    const pivotX =  ps.tippingContactX;
    const pivotY = -ps.tippingContactY;
    const cosA = Math.cos(ps.angle);
    const sinA = Math.sin(ps.angle);

    s.rocketContainer.pivot.set(pivotX, pivotY);
    s.rocketContainer.x = sx + (ps.tippingContactX * cosA + ps.tippingContactY * sinA) * scale;

    let maxDrop = 0;
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!placed || !def) continue;
      const hw = (def.width  ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      let effHW = hw, effBottomH = hh;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        effHW = Math.max(hw, dx);
        effBottomH = Math.max(hh, dy);
      }
      const corners: [number, number][] = [
        [placed.x - effHW, placed.y - effBottomH],
        [placed.x + effHW, placed.y - effBottomH],
        [placed.x - effHW, placed.y + hh],
        [placed.x + effHW, placed.y + hh],
      ];
      for (const [cx, cy] of corners) {
        const drop = (cx - ps.tippingContactX) * sinA
                   + (ps.tippingContactY - cy) * cosA;
        if (drop > maxDrop) maxDrop = drop;
      }
    }
    s.rocketContainer.y = sy - maxDrop * scale;
  } else {
    s.rocketContainer.pivot.set(comLocalX, comLocalY);
    s.rocketContainer.x        = sx + comLocalX * scale;
    s.rocketContainer.y        = sy + (lowestPartBottomPx + comLocalY) * scale;
  }
  s.rocketContainer.rotation = ps.angle;

  const g = acquireGraphics();
  s.rocketContainer.addChild(g);

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!placed || !def) continue;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      drawLandingLeg(g, placed, def, ps, assembly, 0.9);
    } else {
      drawPartRect(g, placed, def, 0.9);
    }
  }

  drawMalfunctionOverlays(g, ps, assembly);
  drawHeatGlowOverlays(g, ps, assembly);
  drawParachuteCanopies(ps, assembly, w, h);

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!placed || !def) continue;
    s.rocketContainer.addChild(makePartLabel(placed, def, 1));
  }
}

// ---------------------------------------------------------------------------
// Hit test — spatial grid cache
// ---------------------------------------------------------------------------

interface HitEntry {
  instanceId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface HitGrid {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  grid: Map<number, HitEntry[]>;
  cols: number;
  cellSize: number;
}

const HIT_GRID_CELL_SIZE = 60;

let _hitGrid: HitGrid | null = null;
let _hitGridPartsRef: ReadonlySet<string> | null = null;
let _hitGridPartsSize = -1;

function _ensureHitGrid(activeParts: ReadonlySet<string>, assembly: ReadonlyAssembly): HitGrid {
  if (_hitGrid && _hitGridPartsRef === activeParts && _hitGridPartsSize === activeParts.size) {
    return _hitGrid;
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  const entries: HitEntry[] = [];

  for (const instanceId of activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!placed || !def) continue;

    const pw = def.width  ?? 40;
    const ph = def.height ?? 20;
    const cx = placed.x;
    const cy = -placed.y;
    const x0 = cx - pw / 2;
    const y0 = cy - ph / 2;
    const x1 = cx + pw / 2;
    const y1 = cy + ph / 2;

    entries.push({ instanceId, x0, y0, x1, y1 });

    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (y0 < minY) minY = y0;
    if (y1 > maxY) maxY = y1;
  }

  if (entries.length === 0) {
    _hitGrid = { minX: 0, maxX: 0, minY: 0, maxY: 0, grid: new Map(), cols: 0, cellSize: HIT_GRID_CELL_SIZE };
    _hitGridPartsRef  = activeParts;
    _hitGridPartsSize = activeParts.size;
    return _hitGrid;
  }

  const pad = 2;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;

  const cellSize = HIT_GRID_CELL_SIZE;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cellSize));

  const grid = new Map<number, HitEntry[]>();

  for (const entry of entries) {
    const col0 = Math.max(0, Math.floor((entry.x0 - minX) / cellSize));
    const col1 = Math.min(cols - 1, Math.floor((entry.x1 - minX) / cellSize));
    const row0 = Math.max(0, Math.floor((entry.y0 - minY) / cellSize));
    const row1 = Math.min(rows - 1, Math.floor((entry.y1 - minY) / cellSize));

    for (let r = row0; r <= row1; r++) {
      for (let c = col0; c <= col1; c++) {
        const key = r * cols + c;
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        cell.push(entry);
      }
    }
  }

  _hitGrid = { minX, maxX, minY, maxY, grid, cols, cellSize };
  _hitGridPartsRef  = activeParts;
  _hitGridPartsSize = activeParts.size;
  return _hitGrid;
}

// ---------------------------------------------------------------------------
// Hit test
// ---------------------------------------------------------------------------

export function hitTestFlightPart(screenX: number, screenY: number, ps: ReadonlyPhysicsState, assembly: ReadonlyAssembly): string | null {
  if (!ps || !assembly) return null;

  const w = window.innerWidth;
  const h = window.innerHeight;

  const { sx, sy } = worldToScreen(ps.posX, ps.posY, w, h);

  const com       = computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
  const comLocalX =  (com.x - ps.posX) / SCALE_M_PER_PX;
  const comLocalY = -(com.y - ps.posY) / SCALE_M_PER_PX;

  let lowestPartBottomPx = 0;
  if (ps.grounded || ps.landed) {
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!placed || !def) continue;
      let bottom = placed.y - (def.height ?? 40) / 2;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        const footVabY = placed.y - dy;
        if (footVabY < bottom) bottom = footVabY;
      }
      if (bottom < lowestPartBottomPx) lowestPartBottomPx = bottom;
    }
  }

  let pivotX: number, pivotY: number, containerX: number, containerY: number;
  if ((ps.grounded || ps.landed) && ps.isTipping) {
    pivotX     =  ps.tippingContactX;
    pivotY     = -ps.tippingContactY;
    const cosA = Math.cos(ps.angle);
    const sinA = Math.sin(ps.angle);
    containerX = sx + ps.tippingContactX * cosA + ps.tippingContactY * sinA;
    let maxDrop = 0;
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!placed || !def) continue;
      const hw = (def.width  ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      let effHW = hw, effBottomH = hh;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        effHW = Math.max(hw, dx);
        effBottomH = Math.max(hh, dy);
      }
      const corners: [number, number][] = [
        [placed.x - effHW, placed.y - effBottomH],
        [placed.x + effHW, placed.y - effBottomH],
        [placed.x - effHW, placed.y + hh],
        [placed.x + effHW, placed.y + hh],
      ];
      for (const [cx, cy] of corners) {
        const drop = (cx - ps.tippingContactX) * sinA
                   + (ps.tippingContactY - cy) * cosA;
        if (drop > maxDrop) maxDrop = drop;
      }
    }
    containerY = sy - maxDrop;
  } else {
    pivotX     = comLocalX;
    pivotY     = comLocalY;
    containerX = sx + comLocalX;
    containerY = sy + lowestPartBottomPx + comLocalY;
  }

  const dx = screenX - containerX;
  const dy = screenY - containerY;

  const cosNeg = Math.cos(-ps.angle);
  const sinNeg = Math.sin(-ps.angle);
  const localX = dx * cosNeg - dy * sinNeg + pivotX;
  const localY = dx * sinNeg + dy * cosNeg + pivotY;

  // --- Spatial grid lookup (replaces O(n) linear scan) ---
  const hg = _ensureHitGrid(ps.activeParts, assembly);

  if (localX < hg.minX || localX > hg.maxX || localY < hg.minY || localY > hg.maxY) {
    return null;
  }

  const col = Math.floor((localX - hg.minX) / hg.cellSize);
  const row = Math.floor((localY - hg.minY) / hg.cellSize);
  const cell = hg.grid.get(row * hg.cols + col);
  if (!cell) return null;

  for (let i = cell.length - 1; i >= 0; i--) {
    const entry = cell[i];
    if (localX >= entry.x0 && localX <= entry.x1 &&
        localY >= entry.y0 && localY <= entry.y1) {
      return entry.instanceId;
    }
  }

  return null;
}
