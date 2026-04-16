/**
 * _debris.ts — Debris fragment rendering, docking target marker, ejected crew.
 */

import * as PIXI from 'pixi.js';
import { getPartById } from '../../data/parts.ts';
import { PartType, ControlMode } from '../../core/constants.ts';
import type { ReadonlyPhysicsState, ReadonlyAssembly, ReadonlyDebrisState } from '../types.ts';
import { getFlightRenderState } from './_state.ts';
import { ppm, worldToScreen } from './_camera.ts';
import { getApp } from '../index.ts';
import { SCALE_M_PER_PX, FLIGHT_PIXELS_PER_METRE } from './_constants.ts';
import { drawPartRect, drawLandingLeg, makePartLabel } from './_rocket.ts';
import { acquireGraphics, releaseContainerChildren, releaseGraphics } from './_pool.ts';

// ---------------------------------------------------------------------------
// Debris rendering
// ---------------------------------------------------------------------------

export function renderDebris(debrisList: readonly ReadonlyDebrisState[], assembly: ReadonlyAssembly, w: number, h: number): void {
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
      if (!placed || !def) continue;
      if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
        drawLandingLeg(g, placed, def, debris, assembly, 0.5);
      } else {
        drawPartRect(g, placed, def, 0.5);
      }
    }

    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!placed || !def) continue;
      fragContainer.addChild(makePartLabel(placed, def, 0.5));
    }
  }
}

// ---------------------------------------------------------------------------
// Docking target rendering
// ---------------------------------------------------------------------------

export function renderDockingTarget(ps: ReadonlyPhysicsState, w: number, h: number): void {
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
    g.circle(clampedX, clampedY, 8);
    g.fill({ color: 0x00ccff, alpha: 0.7 });
  } else {
    const size = 16;

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
    g.stroke({ width: 2, color: 0x00ccff, alpha: 0.9 });

    for (const [, portState] of (ps.dockingPortStates || new Map())) {
      if (portState === 'docked') {
        g.circle(targetSX, targetSY, 6);
        g.fill({ color: 0x44ff44, alpha: 0.6 });
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ejected crew rendering
// ---------------------------------------------------------------------------

export function renderEjectedCrew(ps: ReadonlyPhysicsState, w: number, h: number): void {
  if (!ps.ejectedCrew || ps.ejectedCrew.length === 0) return;
  const s = getFlightRenderState();
  if (!s.debrisContainer) return;

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

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Destroy the debris container and release the docking-target Graphics.
 * Debris children are pooled Graphics (acquired via acquireGraphics) so they
 * are released back to the pool before destroy. dockingTargetGfx is also a
 * pooled Graphics — released rather than destroyed. Safe to call when
 * containers were never initialised. Called from destroyFlightRenderer.
 */
export function destroyDebrisRender(): void {
  const s = getFlightRenderState();

  if (s.debrisContainer) {
    releaseContainerChildren(s.debrisContainer);
    if (s.debrisContainer.parent) s.debrisContainer.parent.removeChild(s.debrisContainer);
    s.debrisContainer.destroy({ children: true });
    s.debrisContainer = null;
  }

  releaseGraphics(s.dockingTargetGfx);
  s.dockingTargetGfx = null;
}
