/**
 * _timeWarp.js — Time warp controls, auto-reset logic, warp button click handler.
 *
 * @module ui/flightController/_timeWarp
 */

import { setHudTimeWarp, lockTimeWarp } from '../flightHud.js';
import { ATMOSPHERE_TOP } from '../../core/atmosphere.js';
import { getAtmosphereTop as getBodyAtmosphereTop } from '../../data/bodies.js';
import { getFCState } from './_state.js';

/**
 * Apply a new time-warp multiplier: update internal state and synchronise the
 * HUD button highlight.
 *
 * @param {number} level  Desired warp multiplier (1, 2, 5, 10, or 50).
 */
export function applyTimeWarp(level) {
  const s = getFCState();
  s.timeWarp = level;
  setHudTimeWarp(level);
}

/**
 * Called once per frame to check whether any automatic time-warp reset
 * condition has been triggered (landing, reentry) and whether the staging
 * lockout has expired.
 *
 * @param {number} timestamp  Current performance.now() value from rAF.
 */
export function checkTimeWarpResets(timestamp) {
  const s = getFCState();
  if (!s.ps || !s.flightState) return;

  // Manage staging lockout expiry.
  if (s.stagingLockoutUntil > 0 && timestamp >= s.stagingLockoutUntil) {
    s.stagingLockoutUntil = 0;
    lockTimeWarp(false);
  }

  // Body-aware atmosphere top for space detection.
  const _twBodyId = (s.flightState && s.flightState.bodyId) || 'EARTH';
  const _twAtmoTop = getBodyAtmosphereTop(_twBodyId) || ATMOSPHERE_TOP;

  // No automatic resets needed if we're already at 1x.
  if (s.timeWarp === 1) {
    s.prevAltitude = Math.max(0, s.ps.posY);
    s.prevInSpace  = s.prevAltitude >= _twAtmoTop;
    return;
  }

  const altitude = Math.max(0, s.ps.posY);
  const speed    = Math.hypot(s.ps.velX, s.ps.velY);
  const inSpace  = altitude >= _twAtmoTop;

  // Reset on successful landing or crash.
  if (s.ps.landed || s.ps.crashed) {
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
 *
 * @param {number} level  Requested warp level.
 */
export function onTimeWarpButtonClick(level) {
  const s = getFCState();
  // Prevent warp changes during the staging lockout window.
  if (s.stagingLockoutUntil > 0 && performance.now() < s.stagingLockoutUntil) return;
  applyTimeWarp(level);
}
