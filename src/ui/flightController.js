/**
 * flightController.js — Flight scene controller (barrel module).
 *
 * Re-exports the public API from the split sub-modules so that external
 * imports continue to work unchanged.
 *
 * @module ui/flightController
 */

export { startFlightScene, stopFlightScene } from './flightController/_init.js';
