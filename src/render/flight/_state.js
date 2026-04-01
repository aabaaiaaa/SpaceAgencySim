/**
 * _state.js — Mutable module-level state for the flight renderer.
 *
 * All PixiJS container references, camera position, trail arrays,
 * plume state, zoom level, weather visibility, etc. are stored in a
 * single state object.  Sub-modules import getFlightRenderState() to
 * read/write shared state.
 *
 * @module render/flight/_state
 */

/**
 * @typedef {object} FlightRenderState
 * @property {import('pixi.js').Graphics|null}   skyGraphics
 * @property {import('pixi.js').Container|null}  starsContainer
 * @property {import('pixi.js').Graphics|null}   groundGraphics
 * @property {import('pixi.js').Graphics|null}   surfaceItemsGraphics
 * @property {import('pixi.js').Container|null}  debrisContainer
 * @property {import('pixi.js').Container|null}  trailContainer
 * @property {import('pixi.js').Container|null}  rocketContainer
 * @property {import('pixi.js').Container|null}  canopyContainer
 * @property {import('pixi.js').Container|null}  biomeLabelContainer
 * @property {import('pixi.js').Graphics|null}   hazeGraphics
 * @property {import('pixi.js').Graphics|null}   horizonGraphics
 * @property {import('pixi.js').Graphics|null}   dockingTargetGfx
 * @property {import('pixi.js').Graphics|null}   machGraphics
 * @property {number}  weatherVisibility
 * @property {string|null}  currentBiomeName
 * @property {number}  biomeLabelAlpha
 * @property {Array<{ nx: number, ny: number, r: number }>}  stars
 * @property {Array}   trailSegments
 * @property {number|null}  lastTrailTime
 * @property {Map}     plumeStates
 * @property {number}  machPhase
 * @property {number}  camWorldX
 * @property {number}  camWorldY
 * @property {number|null}  lastCamTime
 * @property {boolean} camSnap
 * @property {number|null}  prevTargetX
 * @property {number|null}  prevTargetY
 * @property {number}  camOffsetX
 * @property {number}  camOffsetY
 * @property {number}  zoomLevel
 * @property {number}  mouseX
 * @property {number}  mouseY
 * @property {((e: WheelEvent) => void)|null}    wheelHandler
 * @property {((e: MouseEvent) => void)|null}    mouseMoveHandler
 * @property {boolean} inputEnabled
 * @property {{ seaLevel: number, highAlt: number, space: number, starStart: number, starEnd: number, ground: number }} bodyVisuals
 */

import {
  SKY_SEA_LEVEL, SKY_HIGH_ALT, SKY_SPACE,
  STAR_FADE_START, STAR_FADE_FULL, GROUND_COLOR,
} from './_constants.js';

/** @returns {FlightRenderState} */
function _createDefaultState() {
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

/** @type {FlightRenderState} */
let _state = _createDefaultState();

/**
 * Get the mutable flight render state object.
 * Sub-modules read and write properties directly on this object.
 *
 * @returns {FlightRenderState}
 */
export function getFlightRenderState() {
  return _state;
}

/**
 * Merge a partial update into the flight render state.
 *
 * @param {Partial<FlightRenderState>} patch
 */
export function setFlightRenderState(patch) {
  Object.assign(_state, patch);
}

/**
 * Reset all flight render state to defaults.
 */
export function resetFlightRenderState() {
  _state = _createDefaultState();
}
