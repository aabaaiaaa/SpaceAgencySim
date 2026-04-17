// ---------------------------------------------------------------------------
// Crew-skill lookup helper. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import type { FlightState } from '../gameState.ts';
import type { PhysicsState } from './types.ts';

/**
 * Look up the highest value of a crew skill among the flight's crew.
 * Uses ps._gameState (set by flightController) and flightState.crewIds.
 */
export function _getMaxCrewSkill(
  ps: PhysicsState,
  flightState: FlightState | null,
  skill: 'piloting' | 'engineering' | 'science',
): number {
  const gameState = ps?._gameState;
  const crewIds = flightState?.crewIds;
  if (!gameState || !crewIds || !crewIds.length) return 0;

  let max = 0;
  for (const id of crewIds) {
    const member = gameState.crew?.find((c) => c.id === id);
    if (member?.skills?.[skill] != null) {
      max = Math.max(max, member.skills[skill]);
    }
  }
  return max;
}
