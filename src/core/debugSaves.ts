/**
 * debugSaves.ts — Barrel re-export for the debug save system.
 *
 * Implementation lives in `./debugSaves/`. External consumers continue to
 * import from this path unchanged.
 */

export { DEBUG_SAVE_DEFINITIONS } from './debugSaves/definitions.ts';
export type { DebugSaveDefinition } from './debugSaves/definitions.ts';
