/**
 * flight.js — Barrel re-export for the flight renderer sub-modules.
 *
 * The implementation has been split into focused sub-modules inside
 * `src/render/flight/`.  This file re-exports the public API so that
 * no external imports need to change.
 *
 * @module render/flight
 */

export {
  initFlightRenderer,
  renderFlightFrame,
  destroyFlightRenderer,
  hideFlightScene,
  showFlightScene,
  setFlightInputEnabled,
  setFlightWeather,
  flightGetCamera,
  getZoomLevel,
  hitTestFlightPart,
  setZoomLevel,
} from './flight/_init.js';
