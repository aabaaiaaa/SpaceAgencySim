/**
 * _init.ts — Orchestrator containing all 11 public exports.
 *
 * initFlightRenderer creates PixiJS containers and sets up handlers.
 * renderFlightFrame calls sub-module render functions in order.
 * destroyFlightRenderer cleans up.
 */

import * as PIXI from 'pixi.js';
import { getApp } from '../index.ts';
import { airDensity } from '../../core/atmosphere.ts';
import { getAirDensity as bodyAirDensity } from '../../data/bodies.ts';
import type { ReadonlyPhysicsState, ReadonlyAssembly, ReadonlySurfaceItem } from '../types.ts';
import { getFlightRenderState } from './_state.ts';
import { MIN_ZOOM, MAX_ZOOM } from './_constants.ts';
import { updateCamera } from './_camera.ts';
import { updateBodyVisuals, renderSky, renderStars, renderHorizon, renderWeatherHaze, generateStars } from './_sky.ts';
import { renderGround, renderSurfaceItems, renderBiomeLabel } from './_ground.ts';
import { renderRocket, hitTestFlightPart as _hitTestFlightPart } from './_rocket.ts';
import {
  emitSmokeSegments, updateTrails, renderTrails,
  updatePlumeStates, renderPlumes,
  renderRcsPlumes, renderMachEffects, trailDt,
} from './_trails.ts';
import { renderDebris, renderDockingTarget, renderEjectedCrew } from './_debris.ts';
import { getProximityObjects } from '../../core/transferObjects.ts';
import { renderTransferObjects } from './_transferObjects.ts';
import { onMouseMove, onWheel } from './_input.ts';
import { drainPools, releaseGraphics } from './_pool.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the flight scene PixiJS layers.
 */
export function initFlightRenderer(): void {
  const s   = getFlightRenderState();
  const app = getApp();

  // Remove any stale flight containers left from a previous flight.
  if (s.skyGraphics)          app.stage.removeChild(s.skyGraphics);
  if (s.starsContainer)       app.stage.removeChild(s.starsContainer);
  if (s.horizonGraphics)      app.stage.removeChild(s.horizonGraphics);
  if (s.groundGraphics)       app.stage.removeChild(s.groundGraphics);
  if (s.surfaceItemsGraphics) app.stage.removeChild(s.surfaceItemsGraphics);
  if (s.debrisContainer)      app.stage.removeChild(s.debrisContainer);
  if (s.trailContainer)       app.stage.removeChild(s.trailContainer);
  if (s.rocketContainer)      app.stage.removeChild(s.rocketContainer);
  if (s.canopyContainer)      app.stage.removeChild(s.canopyContainer);
  if (s.biomeLabelContainer)  app.stage.removeChild(s.biomeLabelContainer);
  if (s.hazeGraphics)         app.stage.removeChild(s.hazeGraphics);

  s.skyGraphics           = new PIXI.Graphics();
  s.starsContainer        = new PIXI.Container();
  s.horizonGraphics       = new PIXI.Graphics();
  s.groundGraphics        = new PIXI.Graphics();
  s.surfaceItemsGraphics  = new PIXI.Graphics();
  s.debrisContainer       = new PIXI.Container();
  s.trailContainer        = new PIXI.Container();
  s.rocketContainer       = new PIXI.Container();
  s.canopyContainer       = new PIXI.Container();
  s.hazeGraphics          = new PIXI.Graphics();
  s.biomeLabelContainer   = new PIXI.Container();

  app.stage.addChild(s.skyGraphics);
  app.stage.addChild(s.starsContainer);
  app.stage.addChild(s.horizonGraphics);
  app.stage.addChild(s.groundGraphics);
  app.stage.addChild(s.surfaceItemsGraphics);
  app.stage.addChild(s.debrisContainer);
  app.stage.addChild(s.trailContainer);
  app.stage.addChild(s.rocketContainer);
  app.stage.addChild(s.canopyContainer);
  app.stage.addChild(s.hazeGraphics);
  app.stage.addChild(s.biomeLabelContainer);

  generateStars();

  s.trailSegments = [];
  s.lastTrailTime = null;
  s.plumeStates   = new Map();

  s.camWorldX   = 0;
  s.camWorldY   = 0;
  s.lastCamTime = null;
  s.camSnap     = true;
  s.prevTargetX = null;
  s.prevTargetY = null;
  s.camOffsetX  = 0;
  s.camOffsetY  = 0;

  s.currentBiomeName = null;
  s.biomeLabelAlpha  = 0;

  s.zoomLevel = 1.0;
  s.mouseX    = window.innerWidth  / 2;
  s.mouseY    = window.innerHeight / 2;

  s.wheelHandler     = onWheel;
  s.mouseMoveHandler = onMouseMove;
  window.addEventListener('wheel',     s.wheelHandler,     { passive: false });
  window.addEventListener('mousemove', s.mouseMoveHandler);

}

interface FlightStateArg {
  readonly bodyId?: string;
  readonly phase?: string;
}

/**
 * Render a single flight frame.
 */
export function renderFlightFrame(
  ps: ReadonlyPhysicsState,
  assembly: ReadonlyAssembly,
  flightState: FlightStateArg,
  surfaceItems: readonly ReadonlySurfaceItem[],
): void {
  const w        = window.innerWidth;
  const h        = window.innerHeight;
  const altitude = Math.max(0, ps.posY);
  const bodyId   = flightState?.bodyId;

  updateBodyVisuals(bodyId);

  updateCamera(ps, assembly);

  renderSky(altitude, w, h);

  renderStars(altitude, w, h);

  renderHorizon(altitude, w, h, flightState?.phase);

  if (altitude < 5_000) {
    renderGround(w, h);
    renderSurfaceItems(surfaceItems, w, h);
  }

  renderDebris(ps.debris, assembly, w, h);

  // Transfer objects (asteroids, craft, debris during TRANSFER phase).
  if (flightState?.phase === 'TRANSFER') {
    const proximityObjects = getProximityObjects(ps.posX, ps.posY, ps.velX, ps.velY);
    renderTransferObjects(proximityObjects, w, h, ps.posX, ps.posY);
  }

  const trailDensity = bodyId ? bodyAirDensity(altitude, bodyId) : airDensity(altitude);
  const dt           = trailDt();
  emitSmokeSegments(ps, assembly, trailDensity);
  updateTrails(dt);
  renderTrails(w, h);
  updatePlumeStates(ps, assembly, dt);
  renderPlumes(ps, assembly, trailDensity, w, h);

  renderRcsPlumes(ps, assembly, w, h);

  renderEjectedCrew(ps, w, h);

  renderRocket(ps, assembly, w, h);

  renderDockingTarget(ps, w, h);

  renderMachEffects(ps, assembly, trailDensity, w, h, dt);

  renderBiomeLabel(altitude, w, h, dt, bodyId);

  renderWeatherHaze(altitude, w, h, bodyId);
}

/**
 * Tear down the flight scene.
 */
export function destroyFlightRenderer(): void {
  const s   = getFlightRenderState();
  const app = getApp();

  if (s.skyGraphics)          app.stage.removeChild(s.skyGraphics);
  if (s.starsContainer)       app.stage.removeChild(s.starsContainer);
  if (s.horizonGraphics)      app.stage.removeChild(s.horizonGraphics);
  if (s.groundGraphics)       app.stage.removeChild(s.groundGraphics);
  if (s.surfaceItemsGraphics) app.stage.removeChild(s.surfaceItemsGraphics);
  if (s.debrisContainer)      app.stage.removeChild(s.debrisContainer);
  if (s.trailContainer)       app.stage.removeChild(s.trailContainer);
  if (s.rocketContainer)      app.stage.removeChild(s.rocketContainer);
  if (s.canopyContainer)      app.stage.removeChild(s.canopyContainer);
  if (s.biomeLabelContainer)  app.stage.removeChild(s.biomeLabelContainer);
  if (s.hazeGraphics)         app.stage.removeChild(s.hazeGraphics);
  releaseGraphics(s.dockingTargetGfx);

  s.skyGraphics           = null;
  s.starsContainer        = null;
  s.horizonGraphics       = null;
  s.groundGraphics        = null;
  s.surfaceItemsGraphics  = null;
  s.debrisContainer       = null;
  s.trailContainer        = null;
  s.rocketContainer       = null;
  s.canopyContainer       = null;
  s.biomeLabelContainer   = null;
  s.hazeGraphics          = null;
  s.weatherVisibility     = 0;
  s.stars                 = [];
  s.trailSegments         = [];
  s.lastTrailTime         = null;
  s.plumeStates           = new Map();
  s.machGraphics          = null;
  s.machPhase             = 0;
  s.dockingTargetGfx      = null;
  s.currentBiomeName      = null;
  s.biomeLabelAlpha       = 0;

  s.camWorldX   = 0;
  s.camWorldY   = 0;
  s.lastCamTime = null;
  s.camSnap     = true;
  s.prevTargetX = null;
  s.prevTargetY = null;
  s.camOffsetX  = 0;
  s.camOffsetY  = 0;

  if (s.wheelHandler) {
    window.removeEventListener('wheel', s.wheelHandler);
    s.wheelHandler = null;
  }
  if (s.mouseMoveHandler) {
    window.removeEventListener('mousemove', s.mouseMoveHandler);
    s.mouseMoveHandler = null;
  }
  s.zoomLevel = 1.0;

  drainPools();

}

export function hideFlightScene(): void {
  const s = getFlightRenderState();
  if (s.skyGraphics)          s.skyGraphics.visible = false;
  if (s.starsContainer)       s.starsContainer.visible = false;
  if (s.horizonGraphics)      s.horizonGraphics.visible = false;
  if (s.groundGraphics)       s.groundGraphics.visible = false;
  if (s.surfaceItemsGraphics) s.surfaceItemsGraphics.visible = false;
  if (s.debrisContainer)      s.debrisContainer.visible = false;
  if (s.trailContainer)       s.trailContainer.visible = false;
  if (s.rocketContainer)      s.rocketContainer.visible = false;
  if (s.canopyContainer)      s.canopyContainer.visible = false;
  if (s.biomeLabelContainer)  s.biomeLabelContainer.visible = false;
  if (s.hazeGraphics)         s.hazeGraphics.visible = false;
}

export function showFlightScene(): void {
  const s = getFlightRenderState();
  if (s.skyGraphics)          s.skyGraphics.visible = true;
  if (s.starsContainer)       s.starsContainer.visible = true;
  if (s.horizonGraphics)      s.horizonGraphics.visible = true;
  if (s.groundGraphics)       s.groundGraphics.visible = true;
  if (s.surfaceItemsGraphics) s.surfaceItemsGraphics.visible = true;
  if (s.debrisContainer)      s.debrisContainer.visible = true;
  if (s.trailContainer)       s.trailContainer.visible = true;
  if (s.rocketContainer)      s.rocketContainer.visible = true;
  if (s.canopyContainer)      s.canopyContainer.visible = true;
  if (s.biomeLabelContainer)  s.biomeLabelContainer.visible = true;
  if (s.hazeGraphics)         s.hazeGraphics.visible = true;
}

export function setFlightInputEnabled(enabled: boolean): void {
  const s = getFlightRenderState();
  s.inputEnabled = enabled;
}

export function setFlightWeather(visibility: number): void {
  const s = getFlightRenderState();
  s.weatherVisibility = visibility;
}

export function flightGetCamera(): { x: number; y: number } {
  const s = getFlightRenderState();
  return { x: s.camWorldX, y: s.camWorldY };
}

export function getZoomLevel(): number {
  const s = getFlightRenderState();
  return s.zoomLevel;
}

export function hitTestFlightPart(screenX: number, screenY: number, ps: ReadonlyPhysicsState, assembly: ReadonlyAssembly): string | null {
  return _hitTestFlightPart(screenX, screenY, ps, assembly);
}

export function setZoomLevel(zoom: number): void {
  const s = getFlightRenderState();
  s.zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
