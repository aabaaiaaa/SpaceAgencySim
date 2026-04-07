/**
 * _timeWarp.ts — Time warp controls, auto-reset logic, warp button click handler.
 *
 * @module ui/flightController/_timeWarp
 */

import { setHudTimeWarp, lockTimeWarp } from '../flightHud.ts';
import { ATMOSPHERE_TOP } from '../../core/atmosphere.ts';
import { getAtmosphereTop as getBodyAtmosphereTop } from '../../data/bodies.ts';
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';

/**
 * Apply a new time-warp multiplier: update internal state and synchronise the
 * HUD button highlight.
 */
export function applyTimeWarp(level: number): void {
  const s = getFCState();
  s.timeWarp = level;
  setHudTimeWarp(level);
}

/**
 * Called once per frame to check whether any automatic time-warp reset
 * condition has been triggered (landing, reentry) and whether the staging
 * lockout has expired.
 */
export function checkTimeWarpResets(timestamp: number): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !flightState) return;

  // Manage staging lockout expiry.
  if (s.stagingLockoutUntil > 0 && timestamp >= s.stagingLockoutUntil) {
    s.stagingLockoutUntil = 0;
    lockTimeWarp(false);
  }

  // Body-aware atmosphere top for space detection.
  const _twBodyId: string = (flightState && flightState.bodyId) || 'EARTH';
  const _twAtmoTop: number = getBodyAtmosphereTop(_twBodyId) || ATMOSPHERE_TOP;

  // No automatic resets needed if we're already at 1x.
  if (s.timeWarp === 1) {
    s.prevAltitude = Math.max(0, ps.posY);
    s.prevInSpace  = s.prevAltitude >= _twAtmoTop;
    return;
  }

  const altitude: number = Math.max(0, ps.posY);
  const speed: number    = Math.hypot(ps.velX, ps.velY);
  const inSpace: boolean = altitude >= _twAtmoTop;

  // Reset on successful landing or crash.
  if (ps.landed || ps.crashed) {
    applyTimeWarp(1);
  }
  // Reset on reentry: rocket was in space last frame, now below atmosphere
  // top AND travelling at high speed (> 500 m/s indicates ballistic descent).
  else if (s.prevInSpace && !inSpace && speed > 500) {
    applyTimeWarp(1);
  }

  s.prevAltitude = altitude;
  s.prevInSpace  = inSpace;
}

/**
 * Callback passed to `initFlightHud`: invoked when the player clicks a
 * time-warp button in the HUD.
 */
export function onTimeWarpButtonClick(level: number): void {
  const s = getFCState();
  // Prevent warp changes during the staging lockout window.
  if (s.stagingLockoutUntil > 0 && performance.now() < s.stagingLockoutUntil) return;
  applyTimeWarp(level);
}
