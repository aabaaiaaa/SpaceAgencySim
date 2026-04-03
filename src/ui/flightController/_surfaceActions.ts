/**
 * _surfaceActions.ts — Surface action handler (planting flags, collecting samples, etc.).
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
import { logger } from '../../core/logger.js';

/**
 * Callback invoked by the surface operations panel when the player clicks
 * an action button.
 */
export function onSurfaceAction(actionId: string): void {
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
      result = deploySurfaceInstrument(s.state, s.flightState, s.ps, s.assembly!);
      break;
    case 'deploy-beacon':
      result = deployBeacon(s.state, s.flightState, s.ps);
      break;
    default:
      return;
  }

  if (!result.success) {
    logger.warn('surfaceOps', `${actionId} failed`, { reason: result.reason });
  }
}
