# Iteration 4 — Task List

### TASK-001: Fix deprecated PixiJS v7 API in _debris.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Replace PixiJS v7 methods (`beginFill`, `endFill`, `drawCircle`, `lineStyle`) with v8 equivalents (`circle()`, `fill()`, `stroke()`) in `src/render/flight/_debris.ts:117-141`. Remove the unsafe type casts. See requirements Section 1.1.
- **Verification**: `npm run typecheck` passes with no cast workarounds in `_debris.ts`. Docking E2E test passes without runtime errors. If no docking E2E test covers this code path, add one and verify it passes.

### TASK-002: Full PixiJS v8 API audit across render layer
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Audit all files in `src/render/` for deprecated PixiJS v7 API usage. Search for `beginFill`, `endFill`, `drawCircle`, `drawRect`, `drawRoundedRect`, `drawEllipse`, `drawPolygon`, `lineStyle`, `moveTo`, `lineTo`, `arcTo`, `bezierCurveTo`, `quadraticCurveTo`, and any `as PIXI.Graphics & { ... }` type casts. Fix all deprecated patterns found. See requirements Section 1.2.
- **Verification**: `grep -r "beginFill\|endFill\|drawCircle\|drawRect\|lineStyle\|as PIXI.Graphics &" src/render/` returns no matches. `npm run typecheck` passes. `npm run test:e2e` passes.

### TASK-003: Add try-catch to undo/redo callbacks
- **Status**: done
- **Dependencies**: none
- **Description**: Wrap `action.undo()` and `action.redo()` in `src/core/undoRedo.ts:59,70` with try-catch. On failure, push the action back to its original stack, log via `logger.error()`, and surface a brief toast to the player. See requirements Section 1.3.
- **Verification**: New unit tests pass: undo callback throwing preserves stack integrity, redo callback throwing preserves stack integrity, error is logged. `npm run test:unit` passes.

### TASK-004: Add circular reference protection to logger
- **Status**: done
- **Dependencies**: none
- **Description**: Wrap `JSON.stringify(data)` in `src/core/logger.ts:27` with try-catch. On failure, substitute `"[Unserializable data]"` or similar fallback string. See requirements Section 1.4.
- **Verification**: New unit test passes: calling `logger.error()` with a circular-reference object does not throw and produces output containing the fallback string. `npm run test:unit` passes.

### TASK-005: Convert save API to fully async
- **Status**: done
- **Dependencies**: none
- **Description**: Make `saveGame()` and `loadGame()` in `src/core/saveload.ts` async, returning Promises. The IndexedDB fallback path (localStorage full) must be awaited. Update all callers throughout the codebase to await save/load calls: auto-save, manual save UI, design library, debug saves, E2E helpers. See requirements Section 2.1.
- **Verification**: `npm run typecheck` passes. `npm run test:unit` passes. `npm run test:e2e` passes. No fire-and-forget `idbSet()` calls remain on the fallback path in `saveload.ts`.

### TASK-006: Add save version indicator on save slots
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: In the save/load UI, display the save version on each save slot. If the version doesn't match the current `SAVE_VERSION`, show a visual warning indicator (badge, colour change, or label). The indicator is informational, not blocking. See requirements Section 2.2.
- **Verification**: E2E test or manual verification: a save from a different version displays the version mismatch indicator. A save from the current version shows no warning. `npm run test:e2e` passes.

### TASK-007: Implement deeper save validation for nested structures
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Extend `_validateState()` in `src/core/saveload.ts` to validate critical nested structures: `missions.accepted`, `missions.completed`, `crew`, `orbitalObjects`, `savedDesigns`, `contracts.active`. Filter out corrupted entries rather than failing the load. Log warnings for removed entries. See requirements Section 2.3.
- **Verification**: New unit tests pass: corrupted mission entry is filtered out, corrupted crew member is filtered out, valid entries are preserved. `npm run test:unit` passes.

### TASK-008: Add save compression
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Add compression to the save pipeline (after JSON serialization, before storage write) and decompression to the load pipeline. Evaluate and select a lightweight pure-JS compression library (lz-string, fflate, or pako). Handle backward compatibility with uncompressed saves. Bump save version. See requirements Section 2.4.
- **Verification**: New unit tests pass: round-trip save/load with compression preserves data integrity, loading an uncompressed (pre-compression) save still works. `npm run test:unit` passes. `npm run build` succeeds.

### TASK-009: Generalize object pool for hub and VAB renderers
- **Status**: done
- **Dependencies**: none
- **Description**: Extend or generalize the flight object pool (`src/render/flight/_pool.ts`) so hub and VAB renderers can use it. Refactor `hub.ts:183-222` and `vab.ts:304,335,370` to reuse Graphics objects from the pool instead of creating new ones per frame. Ensure pool cleanup on renderer destroy. Existing flight pool behaviour must not change. See requirements Section 3.1.
- **Verification**: `npm run test:unit` passes. `npm run test:e2e` passes. No `new PIXI.Graphics()` calls remain in `hub.ts` `_drawScene()` or VAB per-frame render paths.

### TASK-010: Implement Web Worker physics — worker module and message protocol
- **Status**: done
- **Dependencies**: none
- **Description**: Create the Web Worker module that runs `tick()`, orbital mechanics, and flight phase evaluation. Define the message protocol: Main→Worker commands (throttle, stage, abort, time warp, start/stop) and Worker→Main state snapshots matching the readonly interfaces. The worker receives immutable data catalogs on initialization. See requirements Section 3.2.
- **Verification**: New unit tests pass for the message protocol: command→snapshot round trip works correctly. Worker module compiles and loads without errors.

### TASK-011: Integrate Web Worker physics with flight controller
- **Status**: done
- **Dependencies**: TASK-010
- **Description**: Refactor the flight controller loop to send commands to the physics worker and receive state snapshots for rendering, instead of calling `tick()` directly. Handle time warp (worker runs multiple ticks, main thread renders latest snapshot). Handle worker errors with fallback to main-thread physics. Add a settings flag to control worker vs main-thread mode. See requirements Section 3.2.
- **Verification**: Run a few e2e tests that would use the Web Worker physics. Flight simulation works correctly during normal flight and time warp. Fallback to main-thread physics works when worker is disabled.

### TASK-012: Eliminate `as any` casts — staging.ts, challenges.ts, contracts.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Remove all `as any` casts from `staging.ts` (28), `challenges.ts` (15), and `contracts.ts` (11) by adding proper type definitions, extending interfaces, or using type guards. Do not change runtime behaviour. See requirements Section 4.1.
- **Verification**: `grep "as any" src/core/staging.ts src/core/challenges.ts src/core/contracts.ts` returns no matches. `npm run typecheck` passes. `npm run test:unit` passes.

### TASK-013: Eliminate `as any` casts — crew.ts, debugSaves.ts, docking.ts, flightReturn.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Remove all `as any` casts from `crew.ts` (8), `debugSaves.ts` (8), `docking.ts` (8), and `flightReturn.ts` (7) by adding proper types. For `debugSaves.ts`, `Partial<T>` and test-specific factory types are acceptable. See requirements Section 4.1.
- **Verification**: `grep "as any"` on these four files returns no matches. `npm run typecheck` passes. `npm run test:unit` passes.

### TASK-014: Eliminate `as any` casts — grabbing.ts, physics.ts, and remaining 17 files
- **Status**: pending
- **Dependencies**: none
- **Description**: Remove all `as any` casts from `grabbing.ts` (7), `physics.ts` (5), and the remaining ~17 files (~33 casts total). See requirements Section 4.1.
- **Verification**: `grep -r "as any" src/` returns no matches (or only justified exceptions documented with comments). `npm run typecheck` passes. `npm run test:unit` passes.

### TASK-015: Add ESLint rule to prevent new `as any` usage
- **Status**: pending
- **Dependencies**: TASK-012, TASK-013, TASK-014
- **Description**: Add `@typescript-eslint/no-explicit-any` as a warning (or error) in the ESLint configuration to prevent new `as any` casts from being introduced. See requirements Section 4.1.
- **Verification**: `npm run lint` passes. Adding a new `as any` cast to any file triggers the lint rule. No existing files violate the rule.

### TASK-016: Update all import specifiers from .js to .ts extensions
- **Status**: pending
- **Dependencies**: none
- **Description**: Update all import specifiers across the source codebase from `.js` extensions to `.ts` extensions. This is a mechanical find-and-replace. Do not update E2E test files or Playwright config. See requirements Section 4.2.
- **Verification**: `grep -r "from '.*\.js'" src/ | grep -v node_modules` returns no matches. `npm run typecheck` passes.

### TASK-017: Remove jsToTsResolve Vite plugin
- **Status**: pending
- **Dependencies**: TASK-016
- **Description**: Remove the `jsToTsResolve` plugin from `vite.config.js` now that all import specifiers use `.ts` extensions. See requirements Section 4.2.
- **Verification**: `npm run build` succeeds. `npm run dev` starts without errors. `npm run typecheck` passes. `npm run test:unit` passes.

### TASK-018: Standardize event listener cleanup in crewAdmin.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Migrate `crewAdmin.ts` from direct `addEventListener` calls to use `createListenerTracker()`, matching the pattern used by all other UI modules. See requirements Section 5.1.
- **Verification**: No direct `addEventListener` calls remain in `crewAdmin.ts` (only tracker-mediated calls). Crew admin panel e2e tests pass.

### TASK-019: Migrate remaining inline styles to CSS classes
- **Status**: pending
- **Dependencies**: none
- **Description**: Replace inline style assignments in `crewAdmin.ts` (lines 348, 567-569), `autoSaveToast.ts` (line 100), and `flightHud.ts` (lines 392, 406, 423) with CSS classes using design token custom properties. See requirements Section 5.2.
- **Verification**: `grep -n "\.style\." src/ui/crewAdmin.ts src/ui/autoSaveToast.ts src/ui/flightController/flightHud.ts` returns no inline style assignments for the identified lines. Crew admin panel e2e tests pass.

### TASK-020: Raise branch coverage for fuelsystem.ts and staging.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Identify uncovered branches in `fuelsystem.ts` (67% branches, SRB edge cases) and `staging.ts` (67% branches, debris physics, landing legs). Write targeted unit tests to bring both modules to >= 80% branch coverage. See requirements Section 6.1.
- **Verification**: `npm run test:coverage` shows both `fuelsystem.ts` and `staging.ts` at >= 80% branch coverage.

### TASK-021: Raise branch coverage for mapView.ts, atmosphere.ts, and grabbing.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Identify uncovered branches/lines in `mapView.ts` (67% branches), `atmosphere.ts` (66% lines), and `grabbing.ts` (53% lines). Write targeted unit tests to bring all three to >= 80% coverage. See requirements Section 6.1.
- **Verification**: `npm run test:coverage` shows all three modules at >= 80% branch/line coverage.

### TASK-022: Write tests for all new iteration 4 code
- **Status**: pending
- **Dependencies**: TASK-003, TASK-004, TASK-005, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011
- **Description**: Ensure all new code from this iteration has adequate test coverage. This includes: Web Worker message protocol, save compression round-trip, async save error propagation, deeper save validation, undo/redo error handling, logger circular reference, object pool in hub/VAB. See requirements Section 6.2. Tests specified inline in each section should already exist; this task is a verification sweep to catch any gaps.
- **Verification**: `npm run test:unit` passes. `npm run test:coverage` shows new code is covered. No new module is below 80% branch coverage.

### TASK-023: Update coverage thresholds and lock gains
- **Status**: pending
- **Dependencies**: TASK-020, TASK-021, TASK-022
- **Description**: After all new tests are written, run coverage analysis. Set all three thresholds (lines, branches, functions) in `vite.config.js` to match actual coverage or slightly below, with 80% as the absolute floor. If coverage exceeds previous thresholds, lock the higher values. See requirements Section 6.1.
- **Verification**: `npm run test:coverage` passes with the new thresholds. Thresholds are >= previous values (lines 89%, branches 80%, functions 91%).

### TASK-024: Verification pass — run all checks
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023
- **Description**: Run the full verification suite from requirements Section 7: `npm run typecheck`, `npm run lint`, `npm run test:coverage`, `npm run test:e2e` and `npm run build`. All must pass. Fix any issues found.
- **Verification**: All six commands complete with zero errors. No `as any` casts remain (or only justified exceptions). No deprecated PixiJS v7 API usage. No `jsToTsResolve` plugin. Coverage thresholds met.
