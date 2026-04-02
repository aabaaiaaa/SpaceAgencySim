/**
 * _init.js — Orchestrator containing all 11 public exports.
 *
 * initFlightRenderer creates PixiJS containers and sets up handlers.
 * renderFlightFrame calls sub-module render functions in order.
 * destroyFlightRenderer cleans up.
 *
 * @module render/flight/_init
 */

import * as PIXI from 'pixi.js';
import { getApp } from '../index.js';
import { airDensity } from '../../core/atmosphere.js';
import { getAirDensity as bodyAirDensity } from '../../data/bodies.js';
import { getFlightRenderState } from './_state.js';
import { MIN_ZOOM, MAX_ZOOM } from './_constants.js';
import { updateCamera } from './_camera.js';
import { updateBodyVisuals, renderSky, renderStars, renderHorizon, renderWeatherHaze, generateStars } from './_sky.js';
import { renderGround, renderSurfaceItems, renderBiomeLabel } from './_ground.js';
import { renderRocket, hitTestFlightPart as _hitTestFlightPart } from './_rocket.js';
import {
  emitSmokeSegments, updateTrails, renderTrails,
  updatePlumeStates, renderPlumes,
  renderRcsPlumes, renderMachEffects, trailDt,
} from './_trails.js';
import { renderDebris, renderDockingTarget, renderEjectedCrew } from './_debris.js';
import { onMouseMove, onWheel } from './_input.js';
import { drainPools } from './_pool.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the flight scene PixiJS layers.
 *
 * Call once when transitioning from the lobby/VAB into an active flight.
 */
export function initFlightRenderer() {
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

  // Layer order (bottom -> top):
  //   sky -> stars -> horizon -> ground -> surface items -> debris -> engine trails -> active rocket -> canopies -> haze -> biome label
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

  // Pre-generate the deterministic star field.
  generateStars();

  // Reset trail and plume state.
  s.trailSegments = [];
  s.lastTrailTime = null;
  s.plumeStates   = new Map();

  // Reset camera to launch-pad origin.
  s.camWorldX   = 0;
  s.camWorldY   = 0;
  s.lastCamTime = null;
  s.camSnap     = true;
  s.prevTargetX = null;
  s.prevTargetY = null;
  s.camOffsetX  = 0;
  s.camOffsetY  = 0;

  // Reset biome label state.
  s.currentBiomeName = null;
  s.biomeLabelAlpha  = 0;

  // Reset zoom and initialise mouse tracking.
  s.zoomLevel = 1.0;
  s.mouseX    = window.innerWidth  / 2;
  s.mouseY    = window.innerHeight / 2;

  // Register zoom input handlers.
  s.wheelHandler     = onWheel;
  s.mouseMoveHandler = onMouseMove;
  window.addEventListener('wheel',     s.wheelHandler,     { passive: false });
  window.addEventListener('mousemove', s.mouseMoveHandler);

  console.log('[Flight Renderer] Initialized');
}

/**
 * Render a single flight frame.
 *
 * @param {import('../../core/physics.js').PhysicsState}           ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly}   assembly
 * @param {object}                                                 flightState
 * @param {Array}                                                  surfaceItems
 */
export function renderFlightFrame(ps, assembly, flightState, surfaceItems) {
  const w        = window.innerWidth;
  const h        = window.innerHeight;
  const altitude = Math.max(0, ps.posY);
  const bodyId   = flightState?.bodyId;

  // Update per-body sky/ground/star visuals.
  updateBodyVisuals(bodyId);

  // 1. Update camera to follow the relevant object's CoM.
  updateCamera(ps, assembly);

  // 2. Sky background.
  renderSky(altitude, w, h);

  // 3. Stars.
  renderStars(altitude, w, h);

  // 4a. Horizon curvature.
  renderHorizon(altitude, w, h);

  // 4b. Ground band.
  if (altitude < 5_000) {
    renderGround(w, h);
    // 4c. Deployed surface items.
    renderSurfaceItems(surfaceItems, w, h);
  }

  // 5. Debris fragments.
  renderDebris(ps.debris, assembly, w, h);

  // 6. Engine exhaust.
  const trailDensity = bodyId ? bodyAirDensity(altitude, bodyId) : airDensity(altitude);
  const dt           = trailDt();
  emitSmokeSegments(ps, assembly, trailDensity);
  updateTrails(dt);
  renderTrails(w, h);
  updatePlumeStates(ps, assembly, dt);
  renderPlumes(ps, assembly, trailDensity, w, h);

  // 6b. RCS plumes.
  renderRcsPlumes(ps, assembly, w, h);

  // 6c. Ejected crew capsules.
  renderEjectedCrew(ps, w, h);

  // 7. Active rocket.
  renderRocket(ps, assembly, w, h);

  // 7b. Docking target.
  renderDockingTarget(ps, w, h);

  // 8. Mach effects.
  renderMachEffects(ps, assembly, trailDensity, w, h, dt);

  // 9. Biome label.
  renderBiomeLabel(altitude, w, h, dt, bodyId);

  // 10. Weather haze overlay.
  renderWeatherHaze(altitude, w, h, bodyId);
}

/**
 * Tear down the flight scene.
 */
export function destroyFlightRenderer() {
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
  if (s.dockingTargetGfx)     app.stage.removeChild(s.dockingTargetGfx);

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

  console.log('[Flight Renderer] Destroyed');
}

/**
 * Hide all flight-scene containers (used when the map view is active).
 */
export function hideFlightScene() {
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

/**
 * Show all flight-scene containers (used when returning from the map view).
 */
export function showFlightScene() {
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

/**
 * Enable or disable flight-specific input handling.
 *
 * @param {boolean} enabled
 */
export function setFlightInputEnabled(enabled) {
  const s = getFlightRenderState();
  s.inputEnabled = enabled;
}

/**
 * Set the flight renderer's weather visibility for fog/haze effects.
 * @param {number} visibility  0 = clear, 1 = dense fog.
 */
export function setFlightWeather(visibility) {
  const s = getFlightRenderState();
  s.weatherVisibility = visibility;
}

/**
 * Read-only snapshot of the camera's current world-space position.
 *
 * @returns {{ x: number, y: number }}
 */
export function flightGetCamera() {
  const s = getFlightRenderState();
  return { x: s.camWorldX, y: s.camWorldY };
}

/**
 * Get the current zoom level.
 *
 * @returns {number}
 */
export function getZoomLevel() {
  const s = getFlightRenderState();
  return s.zoomLevel;
}

/**
 * Hit-test a screen-space pointer position against all active parts.
 *
 * @param {number} screenX
 * @param {number} screenY
 * @param {import('../../core/physics.js').PhysicsState} ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {string|null}
 */
export function hitTestFlightPart(screenX, screenY, ps, assembly) {
  return _hitTestFlightPart(screenX, screenY, ps, assembly);
}

/**
 * Programmatically set the zoom level, clamped to [MIN_ZOOM, MAX_ZOOM].
 *
 * @param {number} zoom
 */
export function setZoomLevel(zoom) {
  const s = getFlightRenderState();
  s.zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}
