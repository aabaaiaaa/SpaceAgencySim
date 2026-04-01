/**
 * _rocket.js — Rocket assembly rendering.
 *
 * Part rectangles with labels, parachute canopy drawing, landing leg drawing,
 * malfunction overlays, heat glow overlays.
 *
 * @module render/flight/_rocket
 */

import * as PIXI from 'pixi.js';
import { getPartById } from '../../data/parts.js';
import { PartType } from '../../core/constants.js';
import { getHeatRatio } from '../../core/atmosphere.js';
import { DEPLOY_DURATION } from '../../core/parachute.js';
import { LegState, LEG_DEPLOY_DURATION, getDeployedLegFootOffset } from '../../core/legs.js';
import { getFlightRenderState } from './_state.js';
import { ppm, worldToScreen, computeCoM } from './_camera.js';
import { SCALE_M_PER_PX, PART_FILL, PART_STROKE, FLIGHT_PIXELS_PER_METRE } from './_constants.js';

// ---------------------------------------------------------------------------
// Part drawing helpers
// ---------------------------------------------------------------------------

/**
 * Draw a single part rectangle into `g` in the container's local coordinate space.
 *
 * @param {PIXI.Graphics}                                    g
 * @param {import('../../core/rocketbuilder.js').PlacedPart}  placed
 * @param {import('../../data/parts.js').PartDef}             def
 * @param {number}                                            [alpha=1]
 */
export function drawPartRect(g, placed, def, alpha = 1) {
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
 *
 * @param {PIXI.Graphics}                                    g
 * @param {import('../../core/physics.js').PhysicsState}      ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 */
export function drawMalfunctionOverlays(g, ps, assembly) {
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
 *
 * @param {PIXI.Graphics}                                    g
 * @param {import('../../core/physics.js').PhysicsState}      ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 */
export function drawHeatGlowOverlays(g, ps, assembly) {
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

    let color;
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

/**
 * Determine which side of the rocket a landing leg is attached to.
 *
 * @param {import('../../core/rocketbuilder.js').PlacedPart}    placed
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {number}  +1 (right) or -1 (left).
 */
function _getLegSide(placed, assembly) {
  if (assembly?.connections) {
    for (const conn of assembly.connections) {
      let parentInstanceId, parentSnapIndex;
      if (conn.fromInstanceId === placed.instanceId) {
        parentInstanceId = conn.toInstanceId;
        parentSnapIndex  = conn.toSnapIndex;
      } else if (conn.toInstanceId === placed.instanceId) {
        parentInstanceId = conn.fromInstanceId;
        parentSnapIndex  = conn.fromSnapIndex;
      } else {
        continue;
      }
      const parentPlaced = assembly.parts.get(parentInstanceId);
      if (!parentPlaced) continue;
      const parentDef = getPartById(parentPlaced.partId);
      if (!parentDef) continue;
      const snap = parentDef.snapPoints[parentSnapIndex];
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
 *
 * @param {PIXI.Graphics}                                    g
 * @param {import('../../core/rocketbuilder.js').PlacedPart}  placed
 * @param {import('../../data/parts.js').PartDef}             def
 * @param {object}                                            ps      PhysicsState or debris.
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 * @param {number}                                            [alpha=1]
 */
export function drawLandingLeg(g, placed, def, ps, assembly, alpha = 1) {
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
 *
 * @param {import('../../core/rocketbuilder.js').PlacedPart}  placed
 * @param {import('../../data/parts.js').PartDef}             def
 * @param {number}                                            [alpha=1]
 * @returns {PIXI.Text}
 */
export function makePartLabel(placed, def, alpha = 1) {
  const label = new PIXI.Text({
    text:  def.name,
    style: new PIXI.TextStyle({
      fill:       '#c0ddf0',
      fontSize:   48,
      fontFamily: 'Courier New, Courier, monospace',
      fontWeight: 'bold',
    }),
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
 *
 * @param {import('../../core/physics.js').PhysicsState}          ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly}  assembly
 * @param {number}                                                w  Canvas width.
 * @param {number}                                                h  Canvas height.
 */
export function drawParachuteCanopies(ps, assembly, w, h) {
  const s = getFlightRenderState();
  if (!s.canopyContainer) return;

  while (s.canopyContainer.children.length) s.canopyContainer.removeChildAt(0);

  const p = ppm();
  const rocketAngle = ps.angle;
  const cosR = Math.cos(rocketAngle);
  const sinR = Math.sin(rocketAngle);

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def || def.type !== PartType.PARACHUTE) continue;

    const entry = ps.parachuteStates?.get(instanceId);
    if (!entry || entry.state === 'packed' || entry.state === 'failed') continue;

    const progress = entry.state === 'deployed'
      ? 1
      : Math.max(0, Math.min(1, 1 - entry.deployTimer / DEPLOY_DURATION));

    if (progress <= 0) continue;

    const props = def.properties ?? {};
    const canopyAngle = entry.canopyAngle ?? 0;

    const stowedW    = def.width ?? 20;
    const deployedW  = (props.deployedDiameter ?? 10) / SCALE_M_PER_PX;
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
    const cg = new PIXI.Graphics();

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

    const cordGfx = new PIXI.Graphics();
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
 *
 * @param {import('../../core/physics.js').PhysicsState}           ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly}   assembly
 * @param {number}                                                 w  Canvas width.
 * @param {number}                                                 h  Canvas height.
 */
export function renderRocket(ps, assembly, w, h) {
  const s = getFlightRenderState();
  if (!s.rocketContainer) return;

  while (s.rocketContainer.children.length) s.rocketContainer.removeChildAt(0);
  if (ps.activeParts.size === 0) return;

  const com       = computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
  const comLocalX =  (com.x - ps.posX) / SCALE_M_PER_PX;
  const comLocalY = -(com.y - ps.posY) / SCALE_M_PER_PX;

  let lowestPartBottomPx = 0;
  if (ps.grounded || ps.landed) {
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
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
      if (!def) continue;
      const hw = (def.width  ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      let effHW = hw, effBottomH = hh;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        effHW = Math.max(hw, dx);
        effBottomH = Math.max(hh, dy);
      }
      const corners = [
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

  const g = new PIXI.Graphics();
  s.rocketContainer.addChild(g);

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
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
    if (!def) continue;
    s.rocketContainer.addChild(makePartLabel(placed, def, 1));
  }
}

// ---------------------------------------------------------------------------
// Hit test
// ---------------------------------------------------------------------------

/**
 * Hit-test a screen-space pointer position against all active parts on the
 * main rocket (not debris).
 *
 * @param {number}                                              screenX
 * @param {number}                                              screenY
 * @param {import('../../core/physics.js').PhysicsState}        ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {string|null}  The hit part's instanceId, or null.
 */
export function hitTestFlightPart(screenX, screenY, ps, assembly) {
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
      if (!def) continue;
      let bottom = placed.y - (def.height ?? 40) / 2;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        const footVabY = placed.y - dy;
        if (footVabY < bottom) bottom = footVabY;
      }
      if (bottom < lowestPartBottomPx) lowestPartBottomPx = bottom;
    }
  }

  let pivotX, pivotY, containerX, containerY;
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
      if (!def) continue;
      const hw = (def.width  ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      let effHW = hw, effBottomH = hh;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        effHW = Math.max(hw, dx);
        effBottomH = Math.max(hh, dy);
      }
      const corners = [
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

  const activeIds = [...ps.activeParts];
  for (let i = activeIds.length - 1; i >= 0; i--) {
    const instanceId = activeIds[i];
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const pw = def.width  ?? 40;
    const ph = def.height ?? 20;
    const partCX = placed.x;
    const partCY = -placed.y;

    if (
      localX >= partCX - pw / 2 && localX <= partCX + pw / 2 &&
      localY >= partCY - ph / 2 && localY <= partCY + ph / 2
    ) {
      return instanceId;
    }
  }

  return null;
}
