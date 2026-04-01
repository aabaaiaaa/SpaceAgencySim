/**
 * missionControl.js — Barrel re-export for the Mission Control Centre UI.
 *
 * The implementation has been split into focused sub-modules under
 * `./missionControl/`.  This file preserves the original public API so that
 * external consumers (e.g. `src/ui/index.js`) do not need to change their
 * import paths.
 *
 * @module missionControl
 */

export { initMissionControlUI, destroyMissionControlUI } from './missionControl/_init.js';
