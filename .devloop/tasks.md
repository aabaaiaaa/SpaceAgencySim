# Iteration 3 — Tasks

### TASK-001: Add try-catch error handling to the flight controller RAF loop
- **Status**: done
- **Dependencies**: none
- **Description**: Wrap the main simulation loop body in `src/ui/flightController/_loop.js:58-158` (physics tick through render call) in try-catch. Add a consecutive error counter that resets on successful frames. After 5 consecutive errors, display an abort-to-hub banner matching the pattern in `flightHud.js`. Log errors with `console.error()`. On non-consecutive errors, log and continue. See requirements Section 1.1.
- **Verification**: `npm run test:unit` passes. New unit tests verify: tick() throwing is caught, consecutive errors trigger abort path, intermittent errors allow recovery.

### TASK-002: Add defensive null guards to designLibrary.js
- **Status**: done
- **Dependencies**: none
- **Description**: Add `if (!Array.isArray(state.savedDesigns)) state.savedDesigns = [];` before all `.findIndex()`, `.filter()`, and `.push()` calls on `state.savedDesigns` in `src/core/designLibrary.js`. Audit all functions in the file for this pattern. See requirements Section 1.2.
- **Verification**: `npm run test:unit` passes. New unit test covers `saveDesignToLibrary()` with `state.savedDesigns` as undefined and null.

### TASK-003: Add defensive null guards to flightReturn.js
- **Status**: done
- **Dependencies**: none
- **Description**: Replace `state.crew.find(...)` at line 292 of `src/core/flightReturn.js` with `(state.crew ?? []).find(...)`. Audit the rest of flightReturn.js for similar unguarded state access patterns and fix any found. See requirements Section 1.2.
- **Verification**: `npm run test:unit` passes. New unit test covers flight return functions with `state.crew` as null/undefined.

### TASK-004: Clamp sqrt arguments in orbital mechanics functions
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/orbit.ts`, add `Math.max(0, 1 - e * e)` before `Math.sqrt(1 - e * e)` in `meanAnomalyToTrue()` (line 169) and `trueToEccentricAnomaly()` (line 186). See requirements Section 1.3.
- **Verification**: `npm run test:unit` passes. New unit tests verify `meanAnomalyToTrue()` and `trueToEccentricAnomaly()` with e values at 0.9999, 1.0, and 1.001 return finite numbers (no NaN).

### TASK-005: Cap synodic period search duration in orbit.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/orbit.ts` at line 648, add a `Number.isFinite(T_syn)` check and cap T_syn at `10 * Math.max(T_craft, T_target)`. If exceeded, fall back to `Math.max(T_craft, T_target)`. See requirements Section 1.3.
- **Verification**: `npm run test:unit` passes. New unit test verifies synodic period calculation with nearly-equal orbital periods (periodDiff 0.01–0.1) produces a reasonable search duration.

### TASK-006: Route dockingTargetGfx through PixiJS object pool
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/render/flight/_debris.js:85`, replace `new PIXI.Graphics()` for `dockingTargetGfx` with `acquireGraphics()` from `_pool.js`. Ensure it is released during cleanup. See requirements Section 1.4.
- **Verification**: `npm run test:unit` passes. Grep for `new PIXI.Graphics()` in `_debris.js` returns no results.

### TASK-007: Add save format version field
- **Status**: done
- **Dependencies**: none
- **Description**: Add a `version` integer field (starting at 1) to the save envelope in `src/core/saveload.js`. On load: missing version = version 0 (apply all migrations), matching version = load directly, higher version = warn user. See requirements Section 2.1.
- **Verification**: `npm run test:unit` passes. Unit tests verify: saves include version field, version-0 saves load with migrations, future-version saves trigger warning.

### TASK-008: Implement IndexedDB backup storage layer
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Create an IndexedDB key-value store module that mirrors localStorage save operations. Use raw IndexedDB API — one database, one object store. Keys match localStorage keys. Mirror all saves (manual and auto) to IndexedDB. On load, check both layers and use most recent valid save. Handle IndexedDB unavailability gracefully. See requirements Section 2.2.
- **Verification**: `npm run test:unit` passes. Unit tests verify: writes go to both localStorage and IndexedDB, reads check both and use most recent, IndexedDB unavailability falls back to localStorage-only.

### TASK-009: Implement auto-save system with cancel UI
- **Status**: done
- **Dependencies**: TASK-008
- **Description**: Implement auto-save triggers at end of flight (when post-flight summary appears) and on return to hub. Use a dedicated auto-save slot separate from manual saves. Display a small toast notification with cancel button for 3-5 seconds before saving. Add "Auto-save" toggle to settings panel (enabled by default, persists across sessions). See requirements Section 2.2.
- **Verification**: `npm run test:unit` passes. `npm run test:e2e` passes. E2E test verifies: auto-save fires after flight, cancel button prevents save, toggle in settings disables auto-save.

### TASK-010: Add save migration edge case unit tests
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Add unit tests for `loadGame()` migration paths: savedDesigns as null, savedDesigns as undefined, saveSharedLibrary() throwing during migration, invalid malfunctionMode values, pre-version saves, future-version saves. See requirements Section 2.3.
- **Verification**: `npm run test:unit` passes. All 6 edge case tests exist and pass.

### TASK-011: Add character counters to name input fields
- **Status**: done
- **Dependencies**: none
- **Description**: Add "X / Y" character counters below/beside name inputs in: agency name (`src/ui/mainmenu.js`, max 48), crew names (`src/ui/crewAdmin.js`, max 60), design name (`src/ui/vab/_designLibrary.js`, max 60). Update on every keystroke. Use muted text style. Change to `--color-warning` when within 5 characters of limit. See requirements Section 3.1.
- **Verification**: `npm run test:e2e` passes. Visual inspection confirms counters appear, update on input, and change color near limit.

### TASK-012: Add keyboard navigation — focus ring style and core panels
- **Status**: pending
- **Dependencies**: none
- **Description**: Define a global focus ring CSS style using design tokens. Add keyboard navigation (Tab/Shift+Tab, Enter/Space activation, Escape to close) to: main menu, hub, settings, and topbar menu. Arrow keys for topbar menu items. See requirements Section 3.2.
- **Verification**: `npm run test:e2e` passes. E2E test verifies Tab cycles through interactive elements on main menu and hub. Focus ring is visible on focused elements.

### TASK-012b: Add keyboard navigation — VAB, Mission Control, Crew Admin, Help
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: Extend keyboard navigation to remaining panels: VAB (parts panel, staging panel, toolbar buttons), Mission Control (tabs then items within each tab), Crew Admin (crew cards and action buttons), Help panel (section tabs). Reuse the focus ring style from TASK-012. See requirements Section 3.2.
- **Verification**: `npm run test:e2e` passes. E2E test verifies Tab cycles through interactive elements on VAB and Mission Control panels.

### TASK-013: Implement VAB undo/redo stack
- **Status**: done
- **Dependencies**: none
- **Description**: Implement a delta-based undo/redo stack for the VAB. Track: part placement, deletion, movement, staging changes. Record inverse operations. Depth limit of 50 actions. Ctrl+Z = undo, Ctrl+Y = redo. Add undo/redo buttons to VAB toolbar (greyed when empty). Loading a design clears the stack. See requirements Section 3.3.
- **Verification**: `npm run test:unit` passes. Unit tests verify: undo reverses placement/deletion/move/staging, redo re-applies, stack depth limit works, new action after undo clears redo stack. E2E test verifies Ctrl+Z undoes a part placement.

### TASK-014: Add debug FPS/frame-time monitor
- **Status**: done
- **Dependencies**: TASK-016
- **Description**: Create a lightweight FPS/frame-time overlay for flight mode. Shows FPS, frame time (ms), and a mini graph of last ~60 frame times. Updates every ~500ms. Semi-transparent background, top-right corner. Only visible when debug mode is enabled. Expose data on `window.__perfStats`. No per-frame allocations. See requirements Section 3.4.
- **Verification**: `npm run test:e2e` passes. E2E test verifies: monitor not visible with debug off, visible with debug on during flight, `window.__perfStats` contains fps and frameTime values.

### TASK-015: Add debug mode toggle to settings
- **Status**: done
- **Dependencies**: none
- **Description**: Add a "Debug Mode" toggle to game settings (`src/ui/settings.js`). Default: off. Persists across sessions. When off: Ctrl+Shift+D shortcut does nothing, debug saves inaccessible, FPS monitor hidden. When on: all debug features accessible. Expose `window.__enableDebugMode()` for E2E tests. See requirements Section 3.5.
- **Verification**: `npm run test:unit` passes. Setting toggles correctly and persists in game state.

### TASK-016: Gate all debug features behind debug mode setting
- **Status**: done
- **Dependencies**: TASK-015
- **Description**: Update `src/ui/hub.js` to check debug mode before binding Ctrl+Shift+D. Update any other debug UI to check the setting. Update all E2E tests that use debug features to call `window.__enableDebugMode()` first. See requirements Section 3.5.
- **Verification**: `npm run test:e2e` passes. E2E tests verify: Ctrl+Shift+D does nothing when debug off, works when debug on, setting persists across save/load.

### TASK-017: Convert data layer to TypeScript (src/data/)
- **Status**: done
- **Dependencies**: none
- **Description**: Convert all 8 JS files in `src/data/` to TypeScript: bodies.js, challenges.js, contracts.js, index.js, instruments.js, missions.js, parts.js, techtree.js. Add proper type annotations. Use existing types from `gameState.ts` and `constants.ts`. Don't refactor logic. See requirements Section 4.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. No `.js` files remain in `src/data/`.

### TASK-018: Convert core layer to TypeScript (src/core/) — batch 1
- **Status**: done
- **Dependencies**: TASK-017
- **Description**: Convert the first half of remaining core JS files to TypeScript (~22 files): achievements.js, atmosphere.js, biomes.js, challenges.js, collision.js, comms.js, construction.js, contracts.js, controlMode.js, crew.js, customChallenges.js, debugSaves.js, designLibrary.js, docking.js, ejector.js, finance.js, flightPhase.js, flightReturn.js, fuelsystem.js, grabbing.js, index.js, legs.js. Add proper type annotations. See requirements Section 4.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. All listed files are now `.ts`.

### TASK-019: Convert core layer to TypeScript (src/core/) — batch 2
- **Status**: done
- **Dependencies**: TASK-018
- **Description**: Convert remaining core JS files to TypeScript (~22 files): library.js, lifeSupport.js, malfunction.js, manoeuvre.js, mapView.js, missions.js, parachute.js, partInventory.js, period.js, power.js, reputation.js, rocketbuilder.js, rocketvalidator.js, satellites.js, saveload.js, sciencemodule.js, settings.js, staging.js, surfaceOps.js, techtree.js, testFlightBuilder.js, weather.js. See requirements Section 4.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. No `.js` files remain in `src/core/`.

### TASK-020: Convert render layer to TypeScript (src/render/)
- **Status**: done
- **Dependencies**: TASK-019
- **Description**: Convert all 17 JS files in `src/render/` to TypeScript: flight.js, hub.js, index.js, map.js, vab.js, and all 12 files in `src/render/flight/`. Use PixiJS types from the `pixi.js` package. See requirements Section 4.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. No `.js` files remain in `src/render/`.

### TASK-021: Convert UI layer to TypeScript (src/ui/) — batch 1
- **Status**: done
- **Dependencies**: TASK-020
- **Description**: Convert the first batch of UI files to TypeScript (~25 files): all files in `src/ui/flightController/` EXCEPT `_css.js` (12 files), all files in `src/ui/missionControl/` EXCEPT `_css.js` (8 files including barrel), plus crewAdmin.js, debugSaves.js, design-tokens.js, flightContextMenu.js, flightHud.js, help.js. Skip `_css.js` files — they will be replaced by `.css` files in TASK-024. Use proper DOM types. See requirements Section 4.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. All listed files are now `.ts`.

### TASK-022: Convert UI layer to TypeScript (src/ui/) — batch 2
- **Status**: done
- **Dependencies**: TASK-021
- **Description**: Convert the second batch of UI files to TypeScript (~25 files): all files in `src/ui/vab/` EXCEPT `_css.js` (12 files including barrel), plus hub.js, index.js, injectStyle.js, launchPad.js, library.js, listenerTracker.js, mainmenu.js, missionControl.js, rdLab.js, rocketCardUtil.js, satelliteOps.js, settings.js, topbar.js, trackingStation.js, flightController.js. Skip `_css.js` files — they will be replaced by `.css` files in TASK-024. See requirements Section 4.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. All listed files are now `.ts`.

### TASK-023: Convert entry point and test files to TypeScript
- **Status**: done
- **Dependencies**: TASK-022
- **Description**: Convert `src/main.js` to TypeScript. Convert all 60 test files in `src/tests/` from `.test.js` to `.test.ts`. Test files may use looser typing (any for fixtures, partial state). Do NOT convert E2E test files or Playwright config. See requirements Section 4.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. No `.js` files remain in `src/` (excluding E2E files in `e2e/`).

### TASK-024: Extract CSS from JS template literals into .css files
- **Status**: done
- **Dependencies**: none
- **Description**: For each of the 18 UI modules using `injectStyleOnce()`, extract the CSS into co-located `.css` files and import via Vite's CSS import. Replace dedicated CSS modules (`vab/_css.js`, `flightController/_css.js`, `missionControl/_css.js`) entirely with `.css` files and delete the JS originals. Migrate design-tokens.js `:root` properties and utility classes to `design-tokens.css`. Handle dynamic interpolations by hardcoding constants or using CSS custom properties. Note: the `_css.js` files were deliberately excluded from TS migration (TASK-021/022) since they are replaced here. See requirements Section 4.2.
- **Verification**: `npm run build` succeeds. `npm run test:e2e` passes. Grep for `injectStyleOnce` returns zero results in `src/`. All UI modules import `.css` files instead. No `_css.js` files remain.

### TASK-025: Migrate inline styles to CSS classes using design tokens
- **Status**: done
- **Dependencies**: TASK-024
- **Description**: Replace inline `style.cssText` strings in runtime UI elements (error banners, abort overlays, modals in flightHud.js, _showErrorBanner, etc.) with CSS classes defined in the module's .css file. Classes should reference design token custom properties. See requirements Section 4.4.
- **Verification**: `npm run test:e2e` passes. Grep for `style.cssText` in `src/ui/` returns zero results (or only in cases where truly dynamic per-instance styles are needed).

### TASK-026: Implement structured logger
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/core/logger.ts` with log levels (debug, info, warn, error), categories, timestamps, and optional data objects. Output to console.log/warn/error. Configurable minimum level (warn in production, debug in dev). Replace existing console.warn/error calls in error handling paths (saveload, designLibrary, flightHud — whether .js or .ts at time of execution) with logger calls. Add logger.debug at key lifecycle points. See requirements Section 4.3.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. `npm run lint` passes. Grep for bare `console.warn` and `console.error` in `src/core/` and `src/ui/` returns only the logger module itself.

### TASK-027: Define readonly render snapshot interfaces
- **Status**: done
- **Dependencies**: TASK-020
- **Description**: Define `ReadonlyPhysicsState`, `ReadonlyFlightState`, `ReadonlyGameState`, and `ReadonlyAssembly` interfaces in `src/render/types.ts`. Update render function signatures in all render modules to accept these readonly types. Callers pass mutable state (TS allows mutable→readonly). See requirements Section 4.5.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. Attempting to add a state mutation in a render module causes a TypeScript error.

### TASK-028: Split E2E test helpers into focused sub-modules
- **Status**: done
- **Dependencies**: none
- **Description**: Split `e2e/helpers/_interactions.js` (415 lines) into: `_flight.js` (teleport, flight control), `_timewarp.js` (time warp API, wait helpers), `_state.js` (state seeding, queries), `_navigation.js` (screen navigation). Maintain barrel re-export at `e2e/helpers.js`. See requirements Section 5.3.
- **Verification**: `npm run test:e2e` passes. `_interactions.js` no longer exists. Each sub-module is under 150 lines.

### TASK-029: Add E2E tests for debug mode toggle
- **Status**: pending
- **Dependencies**: TASK-016
- **Description**: Add E2E tests verifying: Ctrl+Shift+D does nothing with debug off, enabling debug in settings makes it work, setting persists across save/load, FPS monitor only visible in debug mode during flight, E2E helper enables debug mode programmatically. See requirements Section 5.4.
- **Verification**: `npm run test:e2e` passes. New debug-mode E2E spec has at least 5 passing tests.

### TASK-030: Achieve 80%+ branch coverage and lock thresholds
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-012b, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025, TASK-026, TASK-027, TASK-028, TASK-029
- **Description**: Run coverage analysis after all code and test tasks are complete. Identify modules with lowest branch coverage. Write targeted tests to bring branches above 80%. Set all three thresholds (lines, branches, functions) to match actual coverage — 80% floor minimum. If coverage exceeds 80%, set thresholds at the higher value. See requirements Section 5.1.
- **Verification**: `npm run test:coverage` passes. All three thresholds are >= 80%. Thresholds match or are within 1% of actual coverage.

### TASK-031: Verification pass — run all checks
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-012b, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025, TASK-026, TASK-027, TASK-028, TASK-029, TASK-030
- **Description**: Run all verification checks from requirements Section 6: typecheck, lint, unit tests, E2E tests, coverage thresholds. Fix any failures found. Also check for any `.js` files in `src/` — after the full TypeScript migration (TASK-023), any `.js` file in `src/` is unintended and should be converted to TypeScript with proper type annotations. E2E files in `e2e/` are excluded from this check.
- **Verification**: All 5 commands pass: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run test:coverage`. Glob for `src/**/*.js` returns zero results.
