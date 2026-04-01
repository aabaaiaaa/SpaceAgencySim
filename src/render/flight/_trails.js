/**
 * _trails.js — Engine exhaust trail segments, sine-wave plumes, RCS plumes,
 *              and Mach cone effects.
 *
 * @module render/flight/_trails
 */

import * as PIXI from 'pixi.js';
import { getPartById } from '../../data/parts.js';
import { PartType, ControlMode } from '../../core/constants.js';
import { getFlightRenderState } from './_state.js';
import { ppm, worldToScreen, computeCoM } from './_camera.js';
import { lerpColor } from './_sky.js';
import {
  SCALE_M_PER_PX,
  FLIGHT_PIXELS_PER_METRE,
  TRAIL_MAX_AGE,
  TRAIL_ATMOSPHERE_AGE_BONUS,
  TRAIL_DENSITY_THRESHOLD,
  TRAIL_DRIFT_SPEED,
  TRAIL_FAN_SPEED,
  TRAIL_FAN_VELOCITY_CUTOFF,
  PLUME_SEGMENTS,
  PLUME_PHASE_RATE_LIQUID,
  PLUME_PHASE_RATE_SRB,
  RCS_PLUME_COLOR,
  RCS_PLUME_LENGTH,
  RCS_PLUME_HALF_WIDTH,
  MACH_1,
} from './_constants.js';

// ---------------------------------------------------------------------------
// Nozzle position helper
// ---------------------------------------------------------------------------

/**
 * Compute the world-space position of an engine's nozzle exit.
 *
 * @param {import('../../core/physics.js').PhysicsState}         ps
 * @param {import('../../core/rocketbuilder.js').PlacedPart}     placed
 * @param {import('../../data/parts.js').PartDef}                def
 * @param {{ x: number, y: number }}                             comBody
 * @returns {{ x: number, y: number }}
 */
function _nozzleWorldPos(ps, placed, def, comBody) {
  const nozzleX = placed.x * SCALE_M_PER_PX;
  const nozzleY = (placed.y - (def.height ?? 20) / 2) * SCALE_M_PER_PX;
  const dx   = nozzleX - comBody.x;
  const dy   = nozzleY - comBody.y;
  const cosA = Math.cos(ps.angle);
  const sinA = Math.sin(ps.angle);
  return {
    x: ps.posX + comBody.x + dx * cosA + dy * sinA,
    y: ps.posY + comBody.y - dx * sinA + dy * cosA,
  };
}

// ---------------------------------------------------------------------------
// Plume helpers
// ---------------------------------------------------------------------------

/**
 * Return outer/mid/core plume colours interpolated by atmospheric density.
 */
function _plumeColors(isSRB, densityRatio) {
  if (isSRB) {
    return {
      outer: lerpColor(0xff5500, 0xff3300, densityRatio),
      mid:   lerpColor(0xff8833, 0xff6600, densityRatio),
      core:  lerpColor(0xffffaa, 0xffff88, densityRatio),
    };
  }
  return {
    outer: lerpColor(0xff6020, 0xff4400, densityRatio),
    mid:   lerpColor(0xffaa40, 0xff8800, densityRatio),
    core:  lerpColor(0xffffff, 0xffffcc, densityRatio),
  };
}

/**
 * Compute plume geometry parameters.
 */
function _computePlumeParams(def, effectiveThrottle, densityRatio, plumeState) {
  const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;
  const thrustKN = def.properties?.thrust ?? 60;

  const sizeFactor = thrustKN / 120;
  const throttleLengthScale = 0.4 + 0.6 * effectiveThrottle;
  const lengthMult = 1.0 + 4.0 * (1 - densityRatio);
  const baseWMult  = 0.8 + 1.0 * (1 - densityRatio);
  const tipRatio   = 0.1 + 0.6 * (1 - densityRatio);
  const baseWidthM = 0.3 * sizeFactor;
  const baseLengthM = 1.5 * sizeFactor * throttleLengthScale;
  const length    = baseLengthM * lengthMult;
  const baseWidth = baseWidthM * baseWMult;
  const tipWidth  = baseWidth * tipRatio;
  const sineFreq = isSRB ? 5.0 : 3.5;
  const sineAmp  = baseWidth * (isSRB ? 0.15 : 0.10);
  const diamondCount = Math.round(5 * densityRatio);
  const diamondAlpha = 0.7 * densityRatio;

  return {
    length, baseWidth, tipWidth,
    sineFreq, sineAmp,
    phase: plumeState.phase,
    diamondCount, diamondAlpha,
    isSRB,
    throttle: effectiveThrottle,
    densityRatio,
  };
}

/**
 * Draw a sine-wave plume polygon path into a Graphics object.
 */
function _drawPlumePath(g, nsx, nsy, exDirX, exDirY, bendX, bendY, pLength, pBaseW, pTipW, sineAmpPx, sineFreq, phase, segs) {
  function _sample(t) {
    const t2 = t * t;
    const cx = nsx + exDirX * t * pLength + bendX * t2;
    const cy = nsy + exDirY * t * pLength + bendY * t2;
    const tx = exDirX * pLength + 2 * bendX * t;
    const ty = exDirY * pLength + 2 * bendY * t;
    const tLen = Math.hypot(tx, ty) || 1;
    const px = -ty / tLen;
    const py =  tx / tLen;
    return { cx, cy, px, py };
  }

  // Left edge: nozzle -> tip.
  {
    const s = _sample(0);
    const hw = pBaseW + Math.sin(phase) * sineAmpPx;
    g.moveTo(s.cx - s.px * hw, s.cy - s.py * hw);
  }
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    const s = _sample(t);
    const envHW = pBaseW + (pTipW - pBaseW) * t;
    const sine  = Math.sin(t * sineFreq * Math.PI * 2 + phase) * sineAmpPx * (1 - t * 0.5);
    const hw = envHW + sine;
    g.lineTo(s.cx - s.px * hw, s.cy - s.py * hw);
  }

  // Right edge: tip -> nozzle.
  const phaseR = phase + 1.3;
  for (let i = segs; i >= 0; i--) {
    const t = i / segs;
    const s = _sample(t);
    const envHW = pBaseW + (pTipW - pBaseW) * t;
    const sine  = Math.sin(t * sineFreq * Math.PI * 2 + phaseR) * sineAmpPx * (1 - t * 0.5);
    const hw = envHW + sine;
    g.lineTo(s.cx + s.px * hw, s.cy + s.py * hw);
  }

  g.closePath();
}

// ---------------------------------------------------------------------------
// Plume state management
// ---------------------------------------------------------------------------

/**
 * Update per-engine plume animation state.
 */
export function updatePlumeStates(ps, assembly, dt) {
  const s = getFlightRenderState();
  const firingEngines = new Set();

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const isEngine = def.type === PartType.ENGINE || def.type === PartType.SOLID_ROCKET_BOOSTER;
    if (!isEngine) continue;
    const isFiring = ps.firingEngines && ps.firingEngines.has(instanceId);
    const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;
    const effectiveThrottle = isFiring ? (isSRB ? 1 : (ps.throttle ?? 0)) : 0;
    if (effectiveThrottle <= 0) continue;

    firingEngines.add(instanceId);
    if (!s.plumeStates.has(instanceId)) {
      s.plumeStates.set(instanceId, { phase: Math.random() * Math.PI * 2 });
    }
    const state = s.plumeStates.get(instanceId);
    const rate = isSRB ? PLUME_PHASE_RATE_SRB : PLUME_PHASE_RATE_LIQUID;
    state.phase += dt * rate;
  }

  for (const id of s.plumeStates.keys()) {
    if (!firingEngines.has(id)) s.plumeStates.delete(id);
  }
}

/**
 * Render sine-wave engine plumes for all firing engines.
 */
export function renderPlumes(ps, assembly, density, w, h) {
  const s = getFlightRenderState();
  if (!s.trailContainer || s.plumeStates.size === 0) return;

  const p = ppm();
  const densityRatio = Math.min(1, density / 1.225);
  const comWorld = computeCoM(ps.fuelStore, assembly, ps.activeParts, 0, 0);
  const comBody  = { x: comWorld.x, y: comWorld.y };
  const segs = s.zoomLevel < 0.3 ? 8 : PLUME_SEGMENTS;

  const exDirX = -Math.sin(ps.angle);
  const exDirY =  Math.cos(ps.angle);

  const angVel = ps.angularVelocity ?? 0;
  const bendMag = Math.min(1, Math.abs(angVel) * 2) * p * 2;
  const bendSign = angVel > 0 ? -1 : 1;
  const bendX = -exDirY * bendSign * bendMag;
  const bendY =  exDirX * bendSign * bendMag;

  const g = new PIXI.Graphics();
  s.trailContainer.addChild(g);

  for (const [instanceId, plumeState] of s.plumeStates) {
    const placed = assembly.parts.get(instanceId);
    const def = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const isSRB = def.type === PartType.SOLID_ROCKET_BOOSTER;
    const isFiring = ps.firingEngines && ps.firingEngines.has(instanceId);
    const effectiveThrottle = isFiring ? (isSRB ? 1 : (ps.throttle ?? 0)) : 0;
    if (effectiveThrottle <= 0) continue;

    const nozzle = _nozzleWorldPos(ps, placed, def, comBody);
    const { sx: nsx, sy: nsy } = worldToScreen(nozzle.x, nozzle.y, w, h);

    const params = _computePlumeParams(def, effectiveThrottle, densityRatio, plumeState);
    const colors = _plumeColors(isSRB, densityRatio);

    const lengthPx  = params.length * p;
    const baseHWPx  = (params.baseWidth / 2) * p;
    const tipHWPx   = (params.tipWidth / 2) * p;
    const sineAmpPx = params.sineAmp * p;

    // Layer 1: Outer glow.
    _drawPlumePath(g, nsx, nsy, exDirX, exDirY, bendX, bendY,
      lengthPx, baseHWPx, tipHWPx,
      sineAmpPx, params.sineFreq, params.phase, segs);
    g.fill({ color: colors.outer, alpha: 0.5 * effectiveThrottle });

    // Layer 2: Mid core.
    _drawPlumePath(g, nsx, nsy, exDirX, exDirY, bendX, bendY,
      lengthPx, baseHWPx * 0.6, tipHWPx * 0.6,
      sineAmpPx * 0.4, params.sineFreq, params.phase, segs);
    g.fill({ color: colors.mid, alpha: 0.7 * effectiveThrottle });

    // Layer 3: Inner core.
    _drawPlumePath(g, nsx, nsy, exDirX, exDirY,
      bendX * 0.7, bendY * 0.7,
      lengthPx * 0.7, baseHWPx * 0.25, tipHWPx * 0.15,
      0, params.sineFreq, params.phase, segs);
    g.fill({ color: colors.core, alpha: 0.9 * effectiveThrottle });

    // Shock diamonds.
    if (params.diamondCount > 0 && params.diamondAlpha > 0) {
      const spacing = lengthPx / (params.diamondCount + 1);
      for (let d = 1; d <= params.diamondCount; d++) {
        const t  = (d * spacing) / lengthPx;
        const t2 = t * t;
        const cx = nsx + exDirX * t * lengthPx + bendX * t2;
        const cy = nsy + exDirY * t * lengthPx + bendY * t2;
        const dw = (baseHWPx * 0.4 + (tipHWPx * 0.3 - baseHWPx * 0.4) * t);
        const dh = dw * 0.6;
        g.ellipse(cx, cy, Math.max(1, dw), Math.max(1, dh));
        g.fill({ color: 0xeeeeff, alpha: params.diamondAlpha * (1 - t * 0.5) * effectiveThrottle });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Smoke trail emission, aging, and rendering
// ---------------------------------------------------------------------------

/**
 * Emit trail segments for all engines this frame.
 */
export function emitSmokeSegments(ps, assembly, density) {
  const s = getFlightRenderState();
  if (density <= TRAIL_DENSITY_THRESHOLD) return;

  const comWorld = computeCoM(ps.fuelStore, assembly, ps.activeParts, 0, 0);
  const comBody  = { x: comWorld.x, y: comWorld.y };

  const exVx = -Math.sin(ps.angle) * TRAIL_DRIFT_SPEED;
  const exVy = -Math.cos(ps.angle) * TRAIL_DRIFT_SPEED;

  const speed      = Math.hypot(ps.velX, ps.velY);
  const fanFactor  = Math.max(0, 1 - speed / TRAIL_FAN_VELOCITY_CUTOFF);
  const fanX       = Math.cos(ps.angle) * TRAIL_FAN_SPEED * fanFactor;

  const densityRatio  = Math.min(1, density / 1.225);
  const ageMultiplier = 1 + TRAIL_ATMOSPHERE_AGE_BONUS * densityRatio;

  const throttle = ps.throttle ?? 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    const def = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const isSRB    = def.type === PartType.SOLID_ROCKET_BOOSTER;
    const isEngine = def.type === PartType.ENGINE || isSRB;
    if (!isEngine) continue;

    const isFiring = ps.firingEngines && ps.firingEngines.has(instanceId);
    const effectiveThrottle = isFiring ? (isSRB ? 1 : throttle) : 0;

    if (effectiveThrottle <= 0) {
      if (!isFiring && !ps.grounded && densityRatio >= 0.1) {
        const nozzle = _nozzleWorldPos(ps, placed, def, comBody);
        s.trailSegments.push({
          worldX: nozzle.x, worldY: nozzle.y,
          vx: exVx * 0.15 + (Math.random() - 0.5) * fanX,
          vy: exVy * 0.15 + Math.abs(exVy) * 0.2 * fanFactor,
          age: 0, baseW: 2, baseH: 4, isSRB: false,
          maxAge: TRAIL_MAX_AGE * ageMultiplier * 0.4, isSmoke: true,
        });
      }
      continue;
    }

    if (densityRatio > 0.05) {
      const nozzle = _nozzleWorldPos(ps, placed, def, comBody);
      const smokeW = (isSRB ? 20 : 12) * densityRatio * (0.5 + effectiveThrottle * 0.5);
      const smokeH = (isSRB ? 44 : 26) * densityRatio * (0.5 + effectiveThrottle * 0.5);
      const lateralSign = Math.random() < 0.5 ? 1 : -1;
      s.trailSegments.push({
        worldX: nozzle.x, worldY: nozzle.y,
        vx: exVx * 0.45 + lateralSign * fanX * (0.3 + Math.random() * 0.7),
        vy: exVy * 0.45 + Math.abs(exVy) * 0.3 * fanFactor,
        age: 0, baseW: smokeW, baseH: smokeH, isSRB: false,
        maxAge: TRAIL_MAX_AGE * ageMultiplier, isSmoke: true,
      });
    }
  }
}

/**
 * Advance every trail segment by `dt` seconds and discard expired ones.
 */
export function updateTrails(dt) {
  const s = getFlightRenderState();
  for (const seg of s.trailSegments) {
    seg.age    += dt;
    seg.worldX += seg.vx * dt;
    seg.worldY += seg.vy * dt;
  }
  let write = 0;
  for (let i = 0; i < s.trailSegments.length; i++) {
    const maxAge = s.trailSegments[i].maxAge ?? TRAIL_MAX_AGE;
    if (s.trailSegments[i].age < maxAge) {
      s.trailSegments[write++] = s.trailSegments[i];
    }
  }
  s.trailSegments.length = write;
}

/**
 * Draw all live trail segments into _trailContainer.
 */
export function renderTrails(w, h) {
  const s = getFlightRenderState();
  if (!s.trailContainer) return;
  while (s.trailContainer.children.length) s.trailContainer.removeChildAt(0);
  if (s.trailSegments.length === 0) return;

  const g = new PIXI.Graphics();
  s.trailContainer.addChild(g);

  for (const seg of s.trailSegments) {
    const maxAge = seg.maxAge ?? TRAIL_MAX_AGE;
    const t      = seg.age / maxAge;
    const alpha  = Math.max(0, 1 - t);

    let color;
    if (seg.isSmoke) {
      color = t < 0.5
        ? lerpColor(0x888888, 0x444444, t / 0.5)
        : lerpColor(0x444444, 0x222222, (t - 0.5) / 0.5);
    } else {
      const birthColor = seg.isSRB ? 0xffffff : 0xffff80;
      color = t < 0.4
        ? lerpColor(birthColor, 0xff8800, t / 0.4)
        : lerpColor(0xff8800, 0xff2000, (t - 0.4) / 0.6);
    }

    const growFactor = seg.isSmoke ? (1 + t * 0.6) : (1 - t * 0.5);
    const zs = s.zoomLevel;
    const rx = Math.max(0.5, (seg.baseW * growFactor * zs) / 2);
    const ry = Math.max(0.5, (seg.baseH * (seg.isSmoke ? (1 + t * 0.4) : (1 - t * 0.3)) * zs) / 2);

    const { sx, sy } = worldToScreen(seg.worldX, seg.worldY, w, h);
    g.ellipse(sx, sy, rx, ry);
    g.fill({ color, alpha: alpha * (seg.isSmoke ? 0.55 : 1) });
  }
}

/**
 * Compute elapsed seconds since the last call, advancing lastTrailTime.
 */
export function trailDt() {
  const s = getFlightRenderState();
  const now = performance.now();
  if (s.lastTrailTime === null) {
    s.lastTrailTime = now;
    return 0;
  }
  const dt       = Math.min((now - s.lastTrailTime) / 1000, 0.05);
  s.lastTrailTime = now;
  return dt;
}

// ---------------------------------------------------------------------------
// RCS plumes
// ---------------------------------------------------------------------------

/**
 * Render small RCS plumes around the craft in docking/RCS mode.
 */
export function renderRcsPlumes(ps, assembly, w, h) {
  const s = getFlightRenderState();
  if (!s.trailContainer) return;
  if (ps.controlMode !== ControlMode.RCS && ps.controlMode !== ControlMode.DOCKING) return;
  if (!ps.rcsActiveDirections || ps.rcsActiveDirections.size === 0) return;

  const p = ppm();
  const com = computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
  const { sx: comSx, sy: comSy } = worldToScreen(com.x, com.y, w, h);

  const g = new PIXI.Graphics();
  s.trailContainer.addChild(g);

  const lenPx  = RCS_PLUME_LENGTH * p;
  const halfW  = RCS_PLUME_HALF_WIDTH * p;
  const sinA   = Math.sin(ps.angle);
  const cosA   = Math.cos(ps.angle);

  const upSx = sinA;
  const upSy = -cosA;
  const rtSx = cosA;
  const rtSy = sinA;

  for (const dir of ps.rcsActiveDirections) {
    let plumeDirSx, plumeDirSy;
    switch (dir) {
      case 'up':    plumeDirSx = -upSx; plumeDirSy = -upSy; break;
      case 'down':  plumeDirSx =  upSx; plumeDirSy =  upSy; break;
      case 'left':  plumeDirSx =  rtSx; plumeDirSy =  rtSy; break;
      case 'right': plumeDirSx = -rtSx; plumeDirSy = -rtSy; break;
      default: continue;
    }

    const perpSx = -plumeDirSy;
    const perpSy =  plumeDirSx;

    const tipX = comSx + plumeDirSx * lenPx;
    const tipY = comSy + plumeDirSy * lenPx;
    const baseL_x = comSx + perpSx * halfW;
    const baseL_y = comSy + perpSy * halfW;
    const baseR_x = comSx - perpSx * halfW;
    const baseR_y = comSy - perpSy * halfW;

    g.moveTo(baseL_x, baseL_y);
    g.lineTo(tipX, tipY);
    g.lineTo(baseR_x, baseR_y);
    g.closePath();
    g.fill({ color: RCS_PLUME_COLOR, alpha: 0.6 });

    const coreLen = lenPx * 0.5;
    const coreHW  = halfW * 0.3;
    const cTipX = comSx + plumeDirSx * coreLen;
    const cTipY = comSy + plumeDirSy * coreLen;
    const cBaseL_x = comSx + perpSx * coreHW;
    const cBaseL_y = comSy + perpSy * coreHW;
    const cBaseR_x = comSx - perpSx * coreHW;
    const cBaseR_y = comSy - perpSy * coreHW;

    g.moveTo(cBaseL_x, cBaseL_y);
    g.lineTo(cTipX, cTipY);
    g.lineTo(cBaseR_x, cBaseR_y);
    g.closePath();
    g.fill({ color: 0xffffff, alpha: 0.5 });
  }
}

// ---------------------------------------------------------------------------
// Mach effects
// ---------------------------------------------------------------------------

/**
 * Render transonic/supersonic visual effects around the rocket.
 */
export function renderMachEffects(ps, assembly, density, w, h, dt) {
  const s = getFlightRenderState();
  const speed = Math.hypot(ps.velX, ps.velY);
  const mach  = speed / MACH_1;
  const densityRatio = Math.min(1, density / 1.225);

  // Remove previous frame's Mach graphics.
  if (s.machGraphics && s.machGraphics.parent) {
    s.machGraphics.parent.removeChild(s.machGraphics);
  }
  s.machGraphics = null;

  if (mach < 0.85 || densityRatio < 0.02) return;
  if (!s.rocketContainer) return;

  s.machPhase += dt * 10;

  const p = ppm();

  // Find the nose tip.
  const comWorld = computeCoM(ps.fuelStore, assembly, ps.activeParts, 0, 0);
  let noseVabY = -Infinity;
  let nosePartWidth = 20;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const top = placed.y + (def.height ?? 20) / 2;
    if (top > noseVabY) {
      noseVabY = top;
      nosePartWidth = def.width ?? 20;
    }
  }

  const cosA = Math.cos(ps.angle);
  const sinA = Math.sin(ps.angle);
  const noseM = noseVabY * SCALE_M_PER_PX;
  const comM = comWorld.y;
  const noseOffsetM = noseM - comM;
  const noseWorldX = ps.posX + comWorld.x + noseOffsetM * sinA;
  const noseWorldY = ps.posY + comM + noseOffsetM * cosA;
  const { sx: noseSX, sy: noseSY } = worldToScreen(noseWorldX, noseWorldY, w, h);

  const velSX =  ps.velX;
  const velSY = -ps.velY;
  const velLen = Math.hypot(velSX, velSY) || 1;
  const vdx = velSX / velLen;
  const vdy = velSY / velLen;

  const perpX = -vdy;
  const perpY =  vdx;

  const g = new PIXI.Graphics();

  const intensity = mach < 1
    ? (mach - 0.85) / 0.15
    : Math.max(0.3, 1 - (mach - 1) * 0.3);
  const alpha = intensity * densityRatio * 0.4;
  if (alpha < 0.01) {
    if (s.rocketContainer.parent) {
      s.rocketContainer.parent.addChild(g);
      s.machGraphics = g;
    }
    return;
  }

  const halfAngle = mach >= 1
    ? Math.asin(Math.min(1, 1 / mach))
    : Math.PI / 2.5;

  const leadPx  = 20 * p * SCALE_M_PER_PX;
  const trailPx = 150 * p * SCALE_M_PER_PX;
  const totalLen = leadPx + trailPx;

  const startX = noseSX + vdx * leadPx;
  const startY = noseSY + vdy * leadPx;

  const segs = 24;
  const sineFreq = 3 + mach * 1.5;
  const sineAmp  = 3 * p * SCALE_M_PER_PX;
  const lineWidth = Math.max(1, 1.5 * densityRatio);

  for (const side of [-1, 1]) {
    const sidePhase = s.machPhase + side * 0.8;

    g.moveTo(startX, startY);

    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const dist = t * totalLen;
      const spread = dist * Math.tan(halfAngle) * side;
      const wobble = Math.sin(t * sineFreq * Math.PI * 2 + sidePhase)
                   * sineAmp * Math.min(1, t * 3);

      const px = startX - vdx * dist + perpX * (spread + wobble);
      const py = startY - vdy * dist + perpY * (spread + wobble);
      g.lineTo(px, py);
    }

    g.stroke({ color: 0xc8e0ff, width: lineWidth, alpha: alpha });
  }

  // Condensation flash near Mach 1.
  if (mach > 0.95 && mach < 1.15) {
    const flashIntensity = 1 - Math.abs(mach - 1.05) / 0.15;
    const flashR = nosePartWidth * p * SCALE_M_PER_PX * 1.5;
    g.circle(noseSX, noseSY, Math.max(3, flashR));
    g.fill({ color: 0xffffff, alpha: flashIntensity * densityRatio * 0.2 });
  }

  if (s.rocketContainer.parent) {
    s.rocketContainer.parent.addChild(g);
    s.machGraphics = g;
  }
}
