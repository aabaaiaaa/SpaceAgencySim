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
} from '../../core/surfaceOps.ts';
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';
import { logger } from '../../core/logger.ts';

/**
 * Callback invoked by the surface operations panel when the player clicks
 * an action button.
 */
export function onSurfaceAction(actionId: string): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!s.state || !flightState || !ps) return;

  let result;
  switch (actionId) {
    case 'plant-flag':
      result = plantFlag(s.state, flightState, ps);
      break;
    case 'collect-sample':
      result = collectSurfaceSample(s.state, flightState, ps);
      break;
    case 'deploy-instrument':
      result = deploySurfaceInstrument(s.state, flightState, ps, s.assembly!);
      break;
    case 'deploy-beacon':
      result = deployBeacon(s.state, flightState, ps);
      break;
    default:
      return;
  }

  if (!result.success) {
    logger.warn('surfaceOps', `${actionId} failed`, { reason: result.reason });
  }
}
