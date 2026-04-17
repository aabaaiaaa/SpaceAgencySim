/**
 * Debris module scaffolding.
 *
 * Owns the module-level debris ID counter and its reset function. Extracted
 * from `staging.ts` as the first step of the debris/staging split
 * (requirements §7.1). Subsequent tasks migrate `_createDebrisFromParts` and
 * related helpers here.
 */

// ---------------------------------------------------------------------------
// Internal ID counter for debris fragments
// ---------------------------------------------------------------------------

let _debrisNextId = 1;

/**
 * Reset the module-level debris ID counter back to 1.
 *
 * Call on flight start/abort so debris IDs don't grow unbounded across
 * a long session. Usually invoked via `resetFlightState` in `staging.ts`.
 */
export function resetDebrisIdCounter(): void {
  _debrisNextId = 1;
}

/**
 * Allocate the next debris ID string (e.g. `debris-1`, `debris-2`, ...).
 *
 * Provided so callers outside this module can increment the counter —
 * imported `let` bindings cannot be reassigned from consuming modules.
 */
export function nextDebrisId(): string {
  return `debris-${_debrisNextId++}`;
}
