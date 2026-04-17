/**
 * _state.ts — Shared mutable state and pure reducers for the flight HUD.
 *
 * Captures the non-DOM module state from flightHud.ts plus the pure
 * formatters/estimators extracted for unit testing.  Follows the VAB
 * reducer pattern (src/ui/vab/_state.ts).
 */

import { getPartById } from '../../data/parts.ts';
import type { RocketAssembly } from '../../core/rocketbuilder.ts';

/** Standard gravity (m/s^2) — used for ballistic apoapsis estimate. */
export const G0: number = 9.81;

export interface FlightHudState {
  timeWarp: number;
  warpLocked: boolean;
  launchTipHidden: boolean;
  consecutiveErrors: number;
}

const _state: FlightHudState = {
  timeWarp:          1,
  warpLocked:        false,
  launchTipHidden:   false,
  consecutiveErrors: 0,
};

/**
 * Get the current flight-HUD state object (read/write — callers may mutate directly).
 */
export function getFlightHudState(): FlightHudState {
  return _state;
}

/**
 * Patch the flight-HUD state with the supplied key/value pairs.
 */
export function setFlightHudState(patch: Partial<FlightHudState>): void {
  Object.assign(_state, patch);
}

/**
 * Reset flight-HUD state to initial values.
 */
export function resetFlightHudState(): void {
  _state.timeWarp          = 1;
  _state.warpLocked        = false;
  _state.launchTipHidden   = false;
  _state.consecutiveErrors = 0;
}

// ---------------------------------------------------------------------------
// Pure formatters / estimators
// ---------------------------------------------------------------------------

/**
 * Format an altitude or fuel-mass number with a thousands separator (en-US).
 */
export function formatAltitude(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Format a signed speed value to one decimal, prefixed with "+" for
 * non-negative values (e.g. "+12.3", "-4.5").
 */
export function formatSignedVelocity(ms: number): string {
  const sign = ms >= 0 ? '+' : '';
  return `${sign}${ms.toFixed(1)}`;
}

/**
 * Build the throttle display percent and label given raw throttle and mode.
 *
 * Returns the integer percent (0–100) and the textual label shown in the
 * HUD.  In TWR mode the label shows "TWR" suffix; in absolute mode it
 * shows the percent with a "%" suffix.
 */
export function formatThrottle(
  throttle: number,
  mode: 'twr' | 'absolute',
): { pct: number; label: string } {
  const clamped = Math.max(0, Math.min(1, throttle));
  const pct     = Math.round(clamped * 100);
  const label   = mode === 'twr' ? `${pct}% TWR` : `${pct}%`;
  return { pct, label };
}

/**
 * Estimate the apoapsis altitude using the ballistic parabolic equation.
 *
 * Ignores ongoing thrust and atmospheric drag — this is an instantaneous
 * "coasting" estimate suitable for a real-time HUD readout.
 *
 * Formula:  apoapsis = altitude + velY^2 / (2 x g)   (when velY > 0)
 * When descending (velY <= 0) the current altitude IS the apoapsis.
 */
export function estimateApoapsis(altitude: number, velY: number): number {
  if (velY <= 0) return altitude;
  return altitude + (velY * velY) / (2 * G0);
}

export interface FuelTankRow {
  instanceId: string;
  name: string;
  fuelKg: number;
}

/**
 * Build the active-tanks list sorted by descending fuel mass.  Tanks with
 * fuel below 0.1 kg or not in activeParts are excluded.  Returned rows
 * carry the display name resolved via `getPartById`, falling back to the
 * part id, then the instance id if neither is available.
 */
export function buildFuelTankList(
  fuelStore: Map<string, number>,
  activeParts: Set<string>,
  assembly: RocketAssembly,
): FuelTankRow[] {
  const rows: FuelTankRow[] = [];
  for (const [instanceId, fuelKg] of fuelStore) {
    if (!activeParts.has(instanceId)) continue;
    if (fuelKg < 0.1) continue;

    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    const name   = def?.name ?? placed?.partId ?? instanceId;

    rows.push({ instanceId, name, fuelKg });
  }
  rows.sort((a, b) => b.fuelKg - a.fuelKg);
  return rows;
}
