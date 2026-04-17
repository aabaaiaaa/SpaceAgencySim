// ---------------------------------------------------------------------------
// Body-aware atmosphere helpers. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { airDensity, airDensityForBody, ATMOSPHERE_TOP } from '../atmosphere.ts';
import { getAtmosphereTop } from '../../data/bodies.ts';

/**
 * Return the atmospheric density for the current flight body.
 * Delegates to body-aware density when bodyId is present, otherwise
 * falls back to Earth's default model.
 */
export function _densityForBody(altitude: number, bodyId: string | undefined): number {
  if (bodyId && bodyId !== 'EARTH') {
    return airDensityForBody(altitude, bodyId);
  }
  return airDensity(altitude);
}

/**
 * Return the atmosphere top altitude for a body.
 * Falls back to Earth's ATMOSPHERE_TOP if bodyId is not given.
 */
export function _atmosphereTopForBody(bodyId: string | undefined): number {
  if (bodyId && bodyId !== 'EARTH') {
    return getAtmosphereTop(bodyId);
  }
  return ATMOSPHERE_TOP;
}
