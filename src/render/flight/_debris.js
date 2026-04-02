/**
 * _debris.js — Debris fragment rendering, docking target marker, ejected crew.
 *
 * @module render/flight/_debris
 */

import * as PIXI from 'pixi.js';
import { getPartById } from '../../data/parts.js';
import { PartType, ControlMode } from '../../core/constants.js';
import { getFlightRenderState } from './_state.js';
import { ppm, worldToScreen } from './_camera.js';
import { getApp } from '../index.js';
import { SCALE_M_PER_PX, FLIGHT_PIXELS_PER_METRE } from './_constants.js';
import { drawPartRect, drawLandingLeg, makePartLabel } from './_rocket.js';
import { acquireGraphics, releaseContainerChildren } from './_pool.js';

// ---------------------------------------------------------------------------
// Debris rendering
// ---------------------------------------------------------------------------

/**
 * Render all debris fragments into _debrisContainer.
 *
 * @param {import('../../core/staging.js').DebrisState[]}          debrisList
 * @param {import('../../core/rocketbuilder.js').RocketAssembly}   assembly
 * @param {number}                                                 w  Canvas width.
 * @param {number}                                                 h  Canvas height.
 */
export function renderDebris(debrisList, assembly, w, h) {
  const s = getFlightRenderState();
  if (!s.debrisContainer) return;

  releaseContainerChildren(s.debrisContainer);

  for (const debris of debrisList) {
    if (debris.activeParts.size === 0) continue;

    const { sx, sy } = worldToScreen(debris.posX, debris.posY, w, h);
    const scale = ppm() * SCALE_M_PER_PX;

    const fragContainer    = new PIXI.Container();
    fragContainer.x        = sx;
    fragContainer.y        = sy;
    fragContainer.scale.set(scale);
    fragContainer.rotation = debris.angle;
    s.debrisContainer.addChild(fragContainer);

    const g = acquireGraphics();
    fragContainer.addChild(g);

    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        drawLandingLeg(g, placed, def, debris, assembly, 0.5);
      } else {
        drawPartRect(g, placed, def, 0.5);
      }
    }

    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      fragContainer.addChild(makePartLabel(placed, def, 0.5));
    }
  }
}

// ---------------------------------------------------------------------------
// Docking target rendering
// ---------------------------------------------------------------------------

/**
 * Render a docking target marker when the craft is in docking/RCS mode
 * and has a docking target selected.
 */
export function renderDockingTarget(ps, w, h) {
  const s = getFlightRenderState();
  if (!s.rocketContainer) return;

  // Lazy-create the graphics object.
  if (!s.dockingTargetGfx) {
    s.dockingTargetGfx = acquireGraphics();
    const app = getApp();
    const rocketIdx = app.stage.getChildIndex(s.rocketContainer);
    app.stage.addChildAt(s.dockingTargetGfx, rocketIdx);
  }

  s.dockingTargetGfx.clear();

  if (ps.controlMode !== ControlMode.DOCKING && ps.controlMode !== ControlMode.RCS) {
    return;
  }

  let hasDockingActivity = false;
  if (ps.dockingPortStates) {
    for (const [, portState] of ps.dockingPortStates) {
      if (portState === 'extended' || portState === 'docked') {
        hasDockingActivity = true;
        break;
      }
    }
  }

  if (!hasDockingActivity) return;

  const offsetX = ps.dockingOffsetAlongTrack || 0;
  const offsetY = ps.dockingOffsetRadial || 0;

  if (Math.abs(offsetX) < 0.1 && Math.abs(offsetY) < 0.1) return;

  const p = FLIGHT_PIXELS_PER_METRE * (s.zoomLevel || 1.0);
  const centerX = w / 2;
  const centerY = h / 2;

  const targetSX = centerX + offsetX * p;
  const targetSY = centerY - offsetY * p;

  const margin = 40;
  const clampedX = Math.max(margin, Math.min(w - margin, targetSX));
  const clampedY = Math.max(margin, Math.min(h - margin, targetSY));
  const isOffScreen = clampedX !== targetSX || clampedY !== targetSY;

  const g = s.dockingTargetGfx;

  if (isOffScreen) {
    g.beginFill(0x00ccff, 0.7);
    g.drawCircle(clampedX, clampedY, 8);
    g.endFill();
  } else {
    const size = 16;
    g.lineStyle(2, 0x00ccff, 0.9);

    g.moveTo(targetSX, targetSY - size);
    g.lineTo(targetSX + size, targetSY);
    g.lineTo(targetSX, targetSY + size);
    g.lineTo(targetSX - size, targetSY);
    g.closePath();

    const inner = size * 0.4;
    g.moveTo(targetSX - inner, targetSY);
    g.lineTo(targetSX + inner, targetSY);
    g.moveTo(targetSX, targetSY - inner);
    g.lineTo(targetSX, targetSY + inner);

    for (const [, portState] of (ps.dockingPortStates || new Map())) {
      if (portState === 'docked') {
        g.lineStyle(0);
        g.beginFill(0x44ff44, 0.6);
        g.drawCircle(targetSX, targetSY, 6);
        g.endFill();
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ejected crew rendering
// ---------------------------------------------------------------------------

/**
 * Render ejected crew capsules as small rectangles with parachute canopies.
 *
 * @param {import('../../core/physics.js').PhysicsState} ps
 * @param {number} w  Canvas width.
 * @param {number} h  Canvas height.
 */
export function renderEjectedCrew(ps, w, h) {
  if (!ps.ejectedCrew || ps.ejectedCrew.length === 0) return;
  const s = getFlightRenderState();
  if (!s.debrisContainer) return;

  const p = ppm();

  for (const crew of ps.ejectedCrew) {
    const { sx, sy } = worldToScreen(crew.x, crew.y, w, h);

    const g = acquireGraphics();

    const capsW = 8;
    const capsH = 12;
    g.rect(sx - capsW / 2, sy - capsH / 2, capsW, capsH);
    g.fill({ color: 0xd0d8e0, alpha: 0.9 });
    g.stroke({ color: 0x8090a0, width: 1, alpha: 0.8 });

    if (crew.chuteOpen) {
      const chuteW = 28;
      const chuteH = 10;
      const chuteY = sy - capsH / 2 - 14;

      g.moveTo(sx - chuteW / 2, chuteY);
      g.bezierCurveTo(
        sx - chuteW / 4, chuteY - chuteH,
        sx + chuteW / 4, chuteY - chuteH,
        sx + chuteW / 2, chuteY,
      );
      g.fill({ color: 0xff6030, alpha: 0.8 });

      g.moveTo(sx - chuteW / 2, chuteY);
      g.lineTo(sx - capsW / 2, sy - capsH / 2);
      g.moveTo(sx + chuteW / 2, chuteY);
      g.lineTo(sx + capsW / 2, sy - capsH / 2);
      g.moveTo(sx, chuteY);
      g.lineTo(sx, sy - capsH / 2);
      g.stroke({ color: 0xc0c0c0, width: 0.5, alpha: 0.6 });
    }

    s.debrisContainer.addChild(g);
  }
}
