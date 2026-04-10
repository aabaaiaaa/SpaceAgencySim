/**
 * Typed game window helper for E2E tests.
 *
 * Instead of defining ad-hoc `interface GW { ... }` in every spec file and
 * casting `(window as unknown as GW)`, specs can import `GameWindow` and the
 * `gw()` helper from this module:
 *
 *   import { GameWindow, gw } from './helpers.js';
 *
 *   // Inside page.evaluate():
 *   await page.evaluate(() => {
 *     const w = gw();       // typed as GameWindow
 *     return w.__gameState;
 *   });
 *
 * The `GameWindow` type re-exports the augmented `Window` interface from
 * `e2e/window.d.ts`, so all `__gameState`, `__flightPs`, etc. properties
 * are available with full type information.
 */

// Re-export the augmented Window type so specs can import it by name.
// The global Window interface is already augmented by e2e/window.d.ts,
// so this type alias simply provides a convenient, descriptive name.

/**
 * The game window type — the standard `Window` interface augmented with
 * all game globals (`__gameState`, `__flightPs`, `__flightState`, etc.)
 * as declared in `e2e/window.d.ts`.
 *
 * Use this as a type annotation when you need to reference the game window
 * shape without casting:
 *
 *   const gs = (window as GameWindow).__gameState;
 */
export type GameWindow = Window & typeof globalThis;

/**
 * Cast helper for use inside `page.evaluate()` callbacks.
 *
 * Returns `window` typed as `GameWindow`, giving access to all game globals
 * without the verbose `(window as unknown as GW)` pattern.
 *
 * @example
 * ```ts
 * await page.evaluate(() => {
 *   const w = gw();
 *   return w.__flightPs?.posY ?? 0;
 * });
 * ```
 *
 * Note: Because `page.evaluate()` serializes the callback and runs it in the
 * browser context, `gw()` must be available there. For callbacks that are
 * serialized (the common case), simply use `window` directly — the type
 * augmentations from `window.d.ts` already make `window.__gameState` etc.
 * available without any cast when the E2E tsconfig is active.
 *
 * This function is most useful when you want a short alias inside a callback:
 *
 * ```ts
 * await page.evaluate(() => {
 *   const w = gw();
 *   const ps = w.__flightPs;
 *   const gs = w.__gameState;
 *   // ... use ps and gs
 * });
 * ```
 */
export function gw(): GameWindow {
  return window as GameWindow;
}
