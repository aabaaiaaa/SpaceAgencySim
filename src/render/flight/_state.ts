/**
 * _state.ts — Mutable module-level state for the flight renderer.
 *
 * All PixiJS container references, camera position, trail arrays,
 * plume state, zoom level, weather visibility, etc. are stored in a
 * single state object.  Sub-modules import getFlightRenderState() to
 * read/write shared state.
 */

import * as PIXI from 'pixi.js';
import {
  SKY_SEA_LEVEL, SKY_HIGH_ALT, SKY_SPACE,
  STAR_FADE_START, STAR_FADE_FULL, GROUND_COLOR,
} from './_constants.ts';

export interface TrailSegment {
  worldX: number;
  worldY: number;
  vx: number;
  vy: number;
  age: number;
  baseW: number;
  baseH: number;
  isSRB: boolean;
  maxAge: number;
  isSmoke: boolean;
}

export interface PlumeState {
  phase: number;
}

export interface StarData {
  nx: number;
  ny: number;
  r: number;
}

export interface BodyVisuals {
  seaLevel: number;
  highAlt: number;
  space: number;
  starStart: number;
  starEnd: number;
  ground: number;
}

export interface FlightRenderState {
  skyGraphics: PIXI.Graphics | null;
  starsContainer: PIXI.Container | null;
  groundGraphics: PIXI.Graphics | null;
  surfaceItemsGraphics: PIXI.Graphics | null;
  debrisContainer: PIXI.Container | null;
  trailContainer: PIXI.Container | null;
  rocketContainer: PIXI.Container | null;
  canopyContainer: PIXI.Container | null;
  biomeLabelContainer: PIXI.Container | null;
  hazeGraphics: PIXI.Graphics | null;
  horizonGraphics: PIXI.Graphics | null;
  transferObjectsContainer: PIXI.Container | null;
  asteroidsContainer: PIXI.Container | null;
  dockingTargetGfx: PIXI.Graphics | null;
  machGraphics: PIXI.Graphics | null;
  weatherVisibility: number;
  currentBiomeName: string | null;
  biomeLabelAlpha: number;
  stars: StarData[];
  trailSegments: TrailSegment[];
  lastTrailTime: number | null;
  plumeStates: Map<string, PlumeState>;
  machPhase: number;
  camWorldX: number;
  camWorldY: number;
  lastCamTime: number | null;
  camSnap: boolean;
  prevTargetX: number | null;
  prevTargetY: number | null;
  camOffsetX: number;
  camOffsetY: number;
  zoomLevel: number;
  mouseX: number;
  mouseY: number;
  wheelHandler: ((e: WheelEvent) => void) | null;
  mouseMoveHandler: ((e: MouseEvent) => void) | null;
  inputEnabled: boolean;
  bodyVisuals: BodyVisuals;
}

function _createDefaultState(): FlightRenderState {
  return {
    // PixiJS scene objects
    skyGraphics:          null,
    starsContainer:       null,
    groundGraphics:       null,
    surfaceItemsGraphics: null,
    debrisContainer:      null,
    trailContainer:       null,
    rocketContainer:      null,
    canopyContainer:      null,
    biomeLabelContainer:  null,
    hazeGraphics:         null,
    horizonGraphics:      null,
    transferObjectsContainer: null,
    asteroidsContainer:   null,
    dockingTargetGfx:     null,
    machGraphics:         null,

    // Weather
    weatherVisibility: 0,

    // Biome label
    currentBiomeName: null,
    biomeLabelAlpha:  0,

    // Stars
    stars: [],

    // Engine trails
    trailSegments: [],
    lastTrailTime: null,

    // Plume animation
    plumeStates: new Map(),

    // Mach effects
    machPhase: 0,

    // Camera state
    camWorldX:   0,
    camWorldY:   0,
    lastCamTime: null,
    camSnap:     true,
    prevTargetX: null,
    prevTargetY: null,
    camOffsetX:  0,
    camOffsetY:  0,

    // Zoom state
    zoomLevel: 1.0,
    mouseX:    0,
    mouseY:    0,

    // Input handlers (stored for removal on destroy)
    wheelHandler:     null,
    mouseMoveHandler: null,
    inputEnabled:     true,

    // Current body visual overrides
    bodyVisuals: {
      seaLevel:  SKY_SEA_LEVEL,
      highAlt:   SKY_HIGH_ALT,
      space:     SKY_SPACE,
      starStart: STAR_FADE_START,
      starEnd:   STAR_FADE_FULL,
      ground:    GROUND_COLOR,
    },
  };
}

let _state: FlightRenderState = _createDefaultState();

/**
 * Get the mutable flight render state object.
 * Sub-modules read and write properties directly on this object.
 */
export function getFlightRenderState(): FlightRenderState {
  return _state;
}

/**
 * Merge a partial update into the flight render state.
 */
export function setFlightRenderState(patch: Partial<FlightRenderState>): void {
  Object.assign(_state, patch);
}

/**
 * Reset all flight render state to defaults.
 */
export function resetFlightRenderState(): void {
  _state = _createDefaultState();
}
