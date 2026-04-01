/**
 * _surfaceActions.js — Surface action handler (planting flags, collecting samples, etc.).
 *
 * @module ui/flightController/_surfaceActions
 */

import {
  plantFlag,
  collectSurfaceSample,
  deploySurfaceInstrument,
  deployBeacon,
} from '../../core/surfaceOps.js';
import { getFCState } from './_state.js';

/**
 * Callback invoked by the surface operations panel when the player clicks
 * an action button.
 *
 * @param {string} actionId  Surface action identifier.
 */
export function onSurfaceAction(actionId) {
  const s = getFCState();
  if (!s.state || !s.flightState || !s.ps) return;

  let result;
  switch (actionId) {
    case 'plant-flag':
      result = plantFlag(s.state, s.flightState, s.ps);
      break;
    case 'collect-sample':
      result = collectSurfaceSample(s.state, s.flightState, s.ps);
      break;
    case 'deploy-instrument':
      result = deploySurfaceInstrument(s.state, s.flightState, s.ps, s.assembly);
      break;
    case 'deploy-beacon':
      result = deployBeacon(s.state, s.flightState, s.ps);
      break;
    default:
      return;
  }

  if (!result.success) {
    console.warn(`[Surface Ops] ${actionId} failed: ${result.reason}`);
  }
}
