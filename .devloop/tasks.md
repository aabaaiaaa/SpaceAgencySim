# Iteration 19 Tasks

Tasks for the iteration-19 broad sweep. Each task is sized for ~10–20 min of agent work. See `.devloop/requirements.md` for full context on every section.

**Note on test-map.json:** The generator (`scripts/generate-test-map.mjs`) has hardcoded knobs (`BARREL_MAP`, `SOURCE_GROUPS`, `SKIP_SOURCES`, `subDirPatterns`, `E2E_SPEC_AREAS`) that must be edited before the generator can produce correct output for new barrels/groups/specs. Regen is done via `npm run test-map:generate`. See requirements.md §11 for the full maintenance contract.

---

## Section 1 — Bug Fixes

### TASK-001: Reposition #flight-hud-surface to right-anchored position in flightHud.css
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §1.1. Edit `src/ui/flightHud.css` rules for `#flight-hud-surface` (around lines 645–655). Change from `left: 70px` to a right-anchored position (e.g., `right: 260px; bottom: 10px`) so the panel sits left of the objectives panel and clear of the time-warp panel. Remove `max-width: 200px` only if the new zone accommodates the buttons. Preserve the `display: none` collapse when not landed.
- **Verification**: `npm run typecheck` and manual inspection by searching `src/ui/flightHud.css` for `#flight-hud-surface` to confirm the new anchor is `right:` based rather than `left: 70px`.

### TASK-002: Add E2E bounding-box non-overlap test for Surface Ops panel
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Per requirements §1.1 regression guard. Add `e2e/flight-hud-surface.spec.ts`. Test should: load a midGame fixture, start a flight, land the rocket (or use a fixture that lands), wait for `#flight-hud-surface` to become visible, then compute `getBoundingClientRect()` for both `#flight-hud-surface` and `#flight-left-panel` and assert the rects do NOT intersect. Tag the test `@smoke`. After the spec passes, add an entry for `'e2e/flight-hud-surface.spec.ts': ['ui/flightHud']` to `E2E_SPEC_AREAS` in `scripts/generate-test-map.mjs`.
- **Verification**: `npx playwright test e2e/flight-hud-surface.spec.ts` passes.

### TASK-003: Remove triggerAutoSave('post-flight') call in _postFlight.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §1.2. Open `src/ui/flightController/_postFlight.ts:647`. Remove the `triggerAutoSave(state, 'post-flight')` call and any imports that become unused. The hub-return call at `src/ui/index.ts:185` remains the sole auto-save trigger around flight end.
- **Verification**: `npm run typecheck` passes and `npx vitest run src/tests/autoSave.test.ts` passes.

### TASK-004: Verify no close-proximity auto-save triggers in _loop.ts / _menuActions.ts
- **Status**: done
- **Dependencies**: TASK-003
- **Description**: Per requirements §1.2. Grep for `triggerAutoSave` in `src/ui/flightController/_loop.ts` and `src/ui/flightController/_menuActions.ts`. If any call sites exist within ~5 seconds of the hub-return path (e.g., abort-flight flows), document them in a short comment block and confirm the review's single-toast debounce issue does not recur. No code changes expected unless a problem is found.
- **Verification**: Grep output for `triggerAutoSave` across `src/ui/flightController/**` and `src/ui/` is listed in the task's final message. No close-proximity issues found.

### TASK-005: Add E2E regression test for hub-return toast visibility
- **Status**: done
- **Dependencies**: TASK-003
- **Description**: Per requirements §1.2. Add `e2e/auto-save-hub-return.spec.ts` (or extend `e2e/auto-save.spec.ts`). Test should: start a flight from a fixture that can quickly reach landed state, click "Return to Space Agency" within 1 second, and assert the auto-save toast DOM element becomes visible on the hub scene. Tag `@smoke`. If a new spec file is created, add an entry `'e2e/auto-save-hub-return.spec.ts': ['core/saveload', 'ui/utilities']` to `E2E_SPEC_AREAS` in `scripts/generate-test-map.mjs`.
- **Verification**: `npx playwright test e2e/auto-save-hub-return.spec.ts` (or the extended auto-save.spec.ts) passes.

### TASK-006: Verify bug-fix specs pass end-to-end
- **Status**: done
- **Dependencies**: TASK-002, TASK-005
- **Description**: Run the two new/extended E2E specs together to confirm neither regressed. No code changes — this is a verification gate before moving on.
- **Verification**: `npx playwright test e2e/flight-hud-surface.spec.ts e2e/auto-save-hub-return.spec.ts` (or auto-save.spec.ts) both pass.

---

## Section 2 — E2E Keyboard Migration

### TASK-007: Add dispatchKeyDown / dispatchKeyUp helpers in _keyboard.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §2.2. Extend `e2e/helpers/_keyboard.ts` with `dispatchKeyDown(page, key)` and `dispatchKeyUp(page, key)` functions that dispatch `keydown` / `keyup` events via `page.evaluate(() => window.dispatchEvent(new KeyboardEvent(...)))`. Mirror the existing `dispatchKey` style. Ensure the helpers are re-exported from `e2e/helpers.ts` (the barrel).
- **Verification**: `npm run typecheck` passes. Grep confirms `dispatchKeyDown` and `dispatchKeyUp` are exported from the barrel.

### TASK-008: Migrate tipping.spec.ts to dispatchKeyDown / dispatchKeyUp
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Per requirements §2.2. Open `e2e/tipping.spec.ts`. Replace `page.keyboard.down('d')` at line 35 and `page.keyboard.up('d')` at line 40 with `dispatchKeyDown(page, 'd')` and `dispatchKeyUp(page, 'd')`. Import from helpers barrel.
- **Verification**: `npx playwright test e2e/tipping.spec.ts` passes.

### TASK-009: Migrate keyboard-nav.spec.ts — first batch
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Per requirements §2.1. In `e2e/keyboard-nav.spec.ts`, replace `page.keyboard.press` call sites at lines 29, 40, 43, 47, 54, 64, 88, 114 with `dispatchKey(page, ...)`. Import from the helpers barrel.
- **Verification**: `npx playwright test e2e/keyboard-nav.spec.ts` — the migrated tests pass (tests using remaining untouched lines may still pass or may fail individually; the migration is partial).

### TASK-010: Migrate keyboard-nav.spec.ts — second batch
- **Status**: done
- **Dependencies**: TASK-009
- **Description**: Continue migrating `e2e/keyboard-nav.spec.ts` call sites at lines 147, 152, 156, 186, 206, 228, 245, 287, 310, 324 to `dispatchKey`. After this task, the file should contain zero `page.keyboard.press` references.
- **Verification**: `npx playwright test e2e/keyboard-nav.spec.ts` passes fully. `grep -n "page.keyboard" e2e/keyboard-nav.spec.ts` returns empty.

### TASK-011: Verify migrated keyboard specs pass together
- **Status**: done
- **Dependencies**: TASK-008, TASK-010
- **Description**: No code changes. Run both migrated specs together.
- **Verification**: `npx playwright test e2e/keyboard-nav.spec.ts e2e/tipping.spec.ts` passes.

---

## Section 3 — Test Infrastructure

### TASK-012: Create src/tests/setup.ts with logger default level
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §3.1. Create `src/tests/setup.ts` that imports `logger` from `src/core/logger.ts` and calls `logger.setLevel('warn')` in a `beforeEach` hook (use `vitest`'s `beforeEach` via `globalSetup` or a top-level import that auto-registers). The file should be importable by Vitest's `setupFiles` configuration.
- **Verification**: `npm run typecheck` passes on the new file (`npx tsc --noEmit src/tests/setup.ts` — or confirm inclusion via full typecheck).

### TASK-013: Create vitest.config.ts with setup, workers, timeouts, coverage
- **Status**: done
- **Dependencies**: TASK-012
- **Description**: Per requirements §3.1. Create `vitest.config.ts` at the repo root with: `setupFiles: ['./src/tests/setup.ts']`; explicit worker cap (match Playwright's 2 workers on Windows); default test timeout (e.g., 10_000); `coverage` config using `@vitest/coverage-v8` with `include: ['src/']`, `exclude: ['src/tests/**', 'src/main.ts']`. Don't set `globals: true` — tests already import `describe`, `it`, etc. explicitly.
- **Verification**: `npx vitest run src/tests/logger.test.ts` (or any single test) passes with the new config. `npm run typecheck` passes.

### TASK-014: Remove per-file logger.setLevel('warn') from saveload.test.ts
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Per requirements §3.1. Open `src/tests/saveload.test.ts`. Remove the `beforeEach(() => logger.setLevel('warn'))` block — the global setup now handles it. Remove the unused `logger` import if it becomes unused.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` passes.

### TASK-015: Remove per-file logger.setLevel('warn') from autoSave.test.ts
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Per requirements §3.1. Same treatment as TASK-014, applied to `src/tests/autoSave.test.ts`.
- **Verification**: `npx vitest run src/tests/autoSave.test.ts` passes.

### TASK-016: Remove per-file logger.setLevel('warn') from storageErrors.test.ts
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Per requirements §3.1. Same treatment, applied to `src/tests/storageErrors.test.ts`.
- **Verification**: `npx vitest run src/tests/storageErrors.test.ts` passes.

### TASK-017: Remove per-file logger.setLevel('warn') from debugMode.test.ts
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Per requirements §3.1. Same treatment, applied to `src/tests/debugMode.test.ts`.
- **Verification**: `npx vitest run src/tests/debugMode.test.ts` passes.

### TASK-018: Create src/tests/library.test.ts with round-trip tests
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Per requirements §3.2. Create `src/tests/library.test.ts`. Cover: (1) save craft → list includes it; (2) save → load → parts/stages/mass identical; (3) delete → list excludes it; (4) rename → new name round-trips and old name is absent; (5) duplicate-name save — document current behaviour in the test and assert it. Mock IDB if tests touch the storage layer. Tag one test `@smoke`.
- **Verification**: `npx vitest run src/tests/library.test.ts` passes.

### TASK-019: Update generator + test-map.json for library
- **Status**: done
- **Dependencies**: TASK-018
- **Description**: Per requirements §11. First edit `scripts/generate-test-map.mjs`: remove `'src/core/library.ts'` from the `SKIP_SOURCES` set (approx line 228). Then run `npm run test-map:generate` and verify `src/core/library.ts` now maps to `src/tests/library.test.ts` in `test-map.json`. Commit both the generator change and the regenerated `test-map.json`.
- **Verification**: `grep -A 3 '"src/core/library.ts"' test-map.json` shows `src/tests/library.test.ts` in its `unit` list. `grep -n "src/core/library" scripts/generate-test-map.mjs` does not show it under SKIP_SOURCES.

### TASK-020: Add mission→finance smoke E2E test
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Per requirements §3.3. Create `e2e/mission-finance-loop.spec.ts` (or add a new `@smoke` test to an existing mission spec). Flow: load mid-game fixture → complete a specific mission (preferably via test-helper API rather than a full flight) → assert funds increased by the expected reward → assert a previously-unaffordable part in the catalog is now affordable. Runtime under 10 s.
- **Verification**: `npx playwright test e2e/mission-finance-loop.spec.ts` passes (or the extended spec).

### TASK-021: Update generator + test-map.json after new mission-finance spec
- **Status**: done
- **Dependencies**: TASK-020
- **Description**: Per requirements §11. First edit `scripts/generate-test-map.mjs`: add an entry `'e2e/mission-finance-loop.spec.ts': ['core/missions', 'core/finance']` to `E2E_SPEC_AREAS`. If the spec was added to an existing file rather than as a new spec, skip the generator edit. Then run `npm run test-map:generate` and verify the mapping.
- **Verification**: `grep -B 1 -A 5 'mission-finance-loop.spec.ts' test-map.json` shows the spec under the correct area(s). (If added to an existing spec, confirm that spec's existing mapping still covers `core/missions` + `core/finance`.)

---

## Section 4 — High-Value Cleanups

### TASK-022: Delete RocketAssembly / StagingConfig any aliases in testFlightBuilder.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §4.1. Open `src/core/testFlightBuilder.ts` lines 27–30. Delete the local `type RocketAssembly = any` and `type StagingConfig = any` declarations plus the surrounding `/* eslint-disable ... */` comment. Import the real types from `src/core/rocketbuilder.ts`.
- **Verification**: `npm run typecheck` passes. `grep -n "RocketAssembly = any" src/core/testFlightBuilder.ts` returns empty.

### TASK-023: Add logger.warn to swallowed settings-sync error in saveload.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §4.2. Open `src/core/saveload.ts:345–347` (the fire-and-forget `void saveSettings(...)` call). Replace with `.catch(err => logger.warn('save', 'Settings sync failed during save', { err }))`. Preserve the non-blocking semantics.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` passes. `npm run typecheck` passes.

### TASK-024: Add 5-second timeout to resyncWorkerState in _workerBridge.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §4.3. Open `src/ui/flightController/_workerBridge.ts:152–177` (`resyncWorkerState()`). Wrap the resync promise in `Promise.race` with a 5-second timeout. On timeout, log a `logger.warn('worker', 'resync timed out', ...)` and either throw or return a resolved value appropriate to the existing contract (read the callers before choosing).
- **Verification**: `npx vitest run src/tests/workerBridgeTimeout.test.ts` passes. Extend the test to cover the new timeout if feasible.

### TASK-025: Add low-level guard in orbit.ts for r <= 0
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §4.4. Identify the lowest-level helper in `src/core/orbit.ts` that divides by `r` (radius) and add a `if (r <= 0) return null;` guard at the top. Pick the helper that is most upstream in the orbital math chain so the guard propagates naturally. Add a unit test in `src/tests/orbit.test.ts` that exercises the guard.
- **Verification**: `npx vitest run src/tests/orbit.test.ts` passes.

---

## Section 5 — Render Scene Teardown

### TASK-026: Audit src/render/vab.ts for scene-root destroy
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §5.1. Read `src/render/vab.ts`. Identify the top-level scene container (the one that owns all VAB sprites/graphics). On the VAB teardown path (called when switching away from VAB — find the caller in `src/ui/vab/*.ts`), call `<container>.destroy({ children: true })` and drain the `RendererPool` if one is in use here. Do not break existing `__vabPartsContainer` / `__vabWorldToScreen` test-only globals.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/ui-vab*.test.ts` passes. Manual review confirms a destroy call exists on teardown.

### TASK-027: Audit src/render/hub.ts for scene-root destroy
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §5.2. Same treatment applied to `src/render/hub.ts`. Identify scene root, add `destroy({ children: true })` on teardown from the hub UI layer.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/hub*.test.ts` passes.

### TASK-028: Audit src/render/flight/rocket.ts for destroy
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §5.3. Read `src/render/flight/rocket.ts`. Identify the container(s) it creates. Add a destroy hook callable from the flight scene's teardown path.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/render-*.test.ts` passes.

### TASK-029: Audit src/render/flight/camera.ts for destroy
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §5.3. Same treatment, `src/render/flight/camera.ts`.
- **Verification**: `npm run typecheck` passes.

### TASK-030: Audit src/render/flight/sky.ts for destroy
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §5.3. Same treatment, `src/render/flight/sky.ts`.
- **Verification**: `npm run typecheck` passes.

### TASK-031: Audit src/render/flight/trails.ts for destroy
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §5.3. Same treatment, `src/render/flight/trails.ts`.
- **Verification**: `npm run typecheck` passes.

### TASK-032: Audit remaining src/render/flight/* sub-modules for destroy
- **Status**: done
- **Dependencies**: TASK-028, TASK-029, TASK-030, TASK-031
- **Description**: Per requirements §5.3. Sweep remaining files under `src/render/flight/` (debris renderer, particles, etc.). For any that create PixiJS containers, add a destroy hook. Wire all hooks into the flight scene's single teardown entry point so one call tears everything down cleanly.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/render-*.test.ts` passes.

### TASK-033: Add unit test for RendererPool drain behaviour
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §5.4. Check `src/tests/` for existing RendererPool tests. If drain isn't covered, add a test: acquire several Graphics + Text, call `drain()`, assert pool is empty and assert `destroy()` was called on each acquired item (via mock). Mock PixiJS primitives if needed.
- **Verification**: `npx vitest run src/tests/render-pool.test.ts` (or wherever the new test lives) passes.

---

## Section 6 — Listener Tracker Migration

### TASK-034: Migrate listeners in flightController/_menuActions.ts through ListenerTracker
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §6.1. Open `src/ui/flightController/_menuActions.ts:75` and any other raw `addEventListener` calls in the file. Route registrations through a `ListenerTracker` instance tied to the flight-controller lifecycle. Mirror the pattern used by `topbar.ts` and `crewAdmin.ts`. Ensure the tracker is cleared on flight-controller teardown.
- **Verification**: `npm run typecheck` passes. `grep -n "addEventListener" src/ui/flightController/_menuActions.ts` returns zero raw calls or only those wrapped by the tracker.

### TASK-035: Migrate listeners in launchPad.ts through ListenerTracker
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §6.2. Open `src/ui/launchPad.ts:631–640`. Route listener registrations through a `ListenerTracker` instance. Clear the tracker on launch-pad teardown.
- **Verification**: `npm run typecheck` passes.

### TASK-036: Migrate listeners in library.ts through ListenerTracker
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §6.3. Open `src/ui/library.ts:133`. Route listener registrations through a `ListenerTracker` instance. Clear the tracker on library teardown.
- **Verification**: `npm run typecheck` passes.

### TASK-037: Audit src/ui/ for remaining raw addEventListener sites
- **Status**: done
- **Dependencies**: TASK-034, TASK-035, TASK-036
- **Description**: Per requirements §6.4. Run `grep -rn "addEventListener" src/ui/` and list all sites not routed through a `ListenerTracker` and not paired with an explicit `removeEventListener` in a visible cleanup path. Produce a task-result summary with the list. Don't migrate in this task — just enumerate.
- **Verification**: The task's final message contains a bulleted list of remaining sites with file:line and a brief note about each.

### TASK-038: Migrate remaining UI listener sites — batch 1
- **Status**: done
- **Dependencies**: TASK-037
- **Description**: Per requirements §6.4. From the list produced by TASK-037, migrate the first half of the remaining sites to `ListenerTracker`. Skip any that are legitimately self-removing (one-shot handlers that call `removeEventListener` from inside themselves) — document these in the task message.
- **Verification**: `npm run typecheck` passes. Each migrated site's module's tests still pass.

### TASK-039: Migrate remaining UI listener sites — batch 2
- **Status**: done
- **Dependencies**: TASK-038
- **Description**: Per requirements §6.4. Migrate the remaining sites from TASK-037's list. After this task, the only raw `addEventListener` calls in `src/ui/` should be: (a) inside the `ListenerTracker` implementation itself, (b) in one-shot handlers that self-remove.
- **Verification**: `npm run typecheck` passes. Grep confirms zero remaining non-tracker, non-self-removing sites.

### TASK-040: Add unit test for listener cleanup across migrated modules
- **Status**: done
- **Dependencies**: TASK-039
- **Description**: Per requirements §6.5. Extend `src/tests/ui-listenerTracker.test.ts` or add a new test that exercises the full lifecycle (init → register → destroy → assert zero residual listeners) for `_menuActions`, `launchPad`, and `library`. Mock `window.addEventListener`/`removeEventListener` to track counts.
- **Verification**: `npx vitest run src/tests/ui-listenerTracker.test.ts` passes.

---

## Section 7 — Core Refactors

### TASK-041: Create src/core/debris.ts scaffolding
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §7.1. Create `src/core/debris.ts` with the module structure: export `_debrisNextId` counter state (move from `staging.ts`), export `resetDebrisIdCounter()` function (move from wherever it currently lives). Leave the existing `staging.ts` functions in place; this task only stands up the new module.
- **Verification**: `npm run typecheck` passes. `src/core/debris.ts` exists with the moved exports.

### TASK-042: Move _createDebrisFromParts to debris.ts
- **Status**: done
- **Dependencies**: TASK-041
- **Description**: Per requirements §7.1. Move the `_createDebrisFromParts` function from `staging.ts` (approx. lines 756–813) to `src/core/debris.ts` as an exported function (e.g., `createDebrisFromParts`). Update `staging.ts` to import it. Preserve all behaviour.
- **Verification**: `npx vitest run src/tests/staging.test.ts` passes. `npm run typecheck` passes.

### TASK-043: Move _renormalizeAfterSeparation to debris.ts (if applicable)
- **Status**: done
- **Dependencies**: TASK-042
- **Description**: Per requirements §7.1. If `_renormalizeAfterSeparation` (or a similarly-named helper) fits the debris module's scope, move it too. If it is more about the remaining craft post-separation than about debris, leave it in `staging.ts` and note why in the task message.
- **Verification**: `npx vitest run src/tests/staging.test.ts` passes.

### TASK-044: Update staging.ts to import all moved debris helpers
- **Status**: done
- **Dependencies**: TASK-042, TASK-043
- **Description**: Per requirements §7.1. Ensure `src/core/staging.ts` cleanly imports the moved functions and has no dead references. Optionally re-export them from `staging.ts` for backward compat if any internal consumer imports them from there.
- **Verification**: `npx vitest run src/tests/staging.test.ts` passes. `npm run typecheck` passes.

### TASK-045: Create src/tests/debris.test.ts
- **Status**: done
- **Dependencies**: TASK-042
- **Description**: Per requirements §7.1. Create `src/tests/debris.test.ts` with focused tests for: `createDebrisFromParts` output (count, IDs, initial physics state), `resetDebrisIdCounter` effects, ID monotonicity within a flight. Tag one test `@smoke`.
- **Verification**: `npx vitest run src/tests/debris.test.ts` passes.

### TASK-046: Update test-map.json for debris module
- **Status**: done
- **Dependencies**: TASK-045
- **Description**: Per requirements §11. `src/core/debris.ts` should classify to area `core/debris` via the generator's default pattern — no script edits expected. Run `npm run test-map:generate` and confirm the mapping. If the generator misses the file, add a SOURCE_GROUPS entry (e.g., add to `'core/staging'` or create `'core/debris'`) and regenerate.
- **Verification**: `grep -A 3 '"src/core/debris.ts"' test-map.json` shows the test.

### TASK-047: Create src/core/saveEncoding.ts scaffolding
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §7.2. Create `src/core/saveEncoding.ts`. Move the CRC32 lookup table and `crc32()` function from `saveload.ts`. Leave `saveload.ts` importing them via `export { crc32 } from './saveEncoding.ts'` if any external consumer depends on the export.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/saveload.test.ts` passes.

### TASK-048: Move envelope build/parse to saveEncoding.ts
- **Status**: done
- **Dependencies**: TASK-047
- **Description**: Per requirements §7.2. Move the binary envelope builder (header: magic(4) + version(2) + crc(4) + length(4) + payload) and its parser from `saveload.ts` to `saveEncoding.ts`. Update `saveload.ts` to import them.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` passes.

### TASK-049: Move LZ-string compress/decompress wrappers to saveEncoding.ts
- **Status**: done
- **Dependencies**: TASK-048
- **Description**: Per requirements §7.2. If `saveload.ts` wraps `lz-string` with project-specific helpers, move the wrappers to `saveEncoding.ts`. If `lz-string` is called inline, leave it alone.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` passes.

### TASK-050: Move payload validation (any-typed guards) to saveEncoding.ts
- **Status**: done
- **Dependencies**: TASK-048
- **Description**: Per requirements §7.2. Move the post-parse validators (the ones with `eslint-disable no-explicit-any` at `saveload.ts:804, 856`) to `saveEncoding.ts`. `saveload.ts` imports them.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` passes. `npm run lint` passes.

### TASK-051: Create src/tests/saveEncoding.test.ts
- **Status**: done
- **Dependencies**: TASK-050
- **Description**: Per requirements §7.2. Create `src/tests/saveEncoding.test.ts` with round-trip tests for: envelope build/parse with known magic/version, CRC32 known values, compress/decompress round-trip, payload validation (valid input and each invalid branch). Tag one test `@smoke`.
- **Verification**: `npx vitest run src/tests/saveEncoding.test.ts` passes.

### TASK-052: Update generator + test-map.json for saveEncoding module
- **Status**: done
- **Dependencies**: TASK-051
- **Description**: Per requirements §11. Recommended: add `'src/core/saveEncoding.ts'` to `SOURCE_GROUPS['core/saveload']` in `scripts/generate-test-map.mjs` so it groups with the rest of save I/O (saveload, autoSave, idbStorage). If you prefer saveEncoding to be its own area, skip the group edit and let the default classifier assign `core/saveEncoding`. Run `npm run test-map:generate` and confirm the mapping.
- **Verification**: `grep -A 3 'saveEncoding' test-map.json` shows the test file mapped to the expected area.

---

## Section 8 — physics.ts Full Barrel Split + Integration Loop Refactor

### TASK-053: Create src/core/physics/ directory with stub barrel
- **Status**: done
- **Dependencies**: none
- **Description**: Per requirements §8. Create the directory `src/core/physics/`. Do NOT move any code yet. Create an empty (or comment-only) placeholder in `src/core/physics/index.ts` if useful. Leave `physics.ts` untouched. This task simply stages the directory.
- **Verification**: `src/core/physics/` directory exists. `npm run typecheck` passes (no behaviour change).

### TASK-054: Extract src/core/physics/gravity.ts
- **Status**: done
- **Dependencies**: TASK-053
- **Description**: Per requirements §8, recommended extraction order step 1. Move `_gravityForBody()` (physics.ts line ~554) and any supporting gravity helpers to `src/core/physics/gravity.ts`. Export them. Update `physics.ts` to import them. Preserve all call-site behaviour.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes. `npm run typecheck` passes.

### TASK-055: Extract src/core/physics/keyboard.ts
- **Status**: done
- **Dependencies**: TASK-054
- **Description**: Per requirements §8. Move `handleKeyDown` and `handleKeyUp` (physics.ts lines 877–947) to `src/core/physics/keyboard.ts`. Re-export from `physics.ts` so external imports keep working.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/throttleControl.test.ts` passes.

### TASK-056: Extract src/core/physics/capturedBody.ts
- **Status**: done
- **Dependencies**: TASK-055
- **Description**: Per requirements §8. Move `setCapturedBody`, `clearCapturedBody`, `setThrustAligned` (physics.ts lines ~2803–2824) to `src/core/physics/capturedBody.ts`. Re-export from `physics.ts`.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes.

### TASK-057: Extract src/core/physics/init.ts
- **Status**: pending
- **Dependencies**: TASK-056
- **Description**: Per requirements §8. Move `createPhysicsState()` and its immediate initial-state helpers (physics.ts around line 618) to `src/core/physics/init.ts`. Re-export from `physics.ts`.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes.

### TASK-058: Extract src/core/physics/thrust.ts
- **Status**: pending
- **Dependencies**: TASK-057
- **Description**: Per requirements §8. Identify thrust-computation helpers in `physics.ts` (thrust calculation, TWR lookups, throttle interpretation). Move to `src/core/physics/thrust.ts`. Careful: this interacts with fuel and mass — don't break the fuel → thrust → mass ordering in the integration loop.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes.

### TASK-059: Extract src/core/physics/rcs.ts
- **Status**: pending
- **Dependencies**: TASK-058
- **Description**: Per requirements §8. Move RCS-specific helpers (RCS damping used in steering, RCS thrust application as called from docking mode) to `src/core/physics/rcs.ts`. Note the coupling with control-mode state flagged in requirements.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/controlMode.test.ts` passes.

### TASK-060: Extract src/core/physics/docking.ts
- **Status**: pending
- **Dependencies**: TASK-059
- **Description**: Per requirements §8. Move `_applyDockingMovement` (physics.ts ~1795–1885) and `computeDockingRadialOut` to `src/core/physics/docking.ts`. Re-export from `physics.ts`. Preserve the iter-18 body-aware radial check.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/docking*.test.ts` passes.

### TASK-061: Extract src/core/physics/steering.ts
- **Status**: pending
- **Dependencies**: TASK-060
- **Description**: Per requirements §8. Move `_applySteering()` including its parachute-torque and parachute-damping branches (physics.ts ~1977–2028, ~1985–2011) to `src/core/physics/steering.ts`. Do NOT fragment parachute handling further — keep it in steering.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/parachute*.test.ts` passes.

### TASK-062: Extract src/core/physics/debrisGround.ts
- **Status**: pending
- **Dependencies**: TASK-061
- **Description**: Per requirements §8. Move `tickDebrisGround()` (physics.ts starting ~line 2303, ~500 LOC) to `src/core/physics/debrisGround.ts`. Re-export from `physics.ts`. Biggest single extraction in the iteration — verify carefully.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/collision.test.ts` passes.

### TASK-063: Create src/core/physics/integrate.ts shell
- **Status**: pending
- **Dependencies**: TASK-062
- **Description**: Per requirements §8. Create `src/core/physics/integrate.ts` with a skeleton `_integrate(ps, dt)` function. Import from all the newly-extracted modules. DO NOT move logic yet — this task stands up the shell with the existing body inlined as a starting point.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes.

### TASK-064: Extract src/core/physics/phases/orbitPhase.ts
- **Status**: pending
- **Dependencies**: TASK-063
- **Description**: Per requirements §8. In `_integrate`, the ORBIT-phase branch becomes its own function `tickOrbitPhase(ps, dt, ctx)` in `src/core/physics/phases/orbitPhase.ts`. Update `integrate.ts` to dispatch.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes. Orbit-specific tests confirmed in `src/tests/orbit*.test.ts`.

### TASK-065: Extract src/core/physics/phases/transferPhase.ts
- **Status**: pending
- **Dependencies**: TASK-064
- **Description**: Per requirements §8. Same treatment for TRANSFER phase.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/manoeuvre.test.ts` passes.

### TASK-066: Extract src/core/physics/phases/capturePhase.ts
- **Status**: pending
- **Dependencies**: TASK-065
- **Description**: Per requirements §8. Same treatment for CAPTURE phase.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes.

### TASK-067: Extract src/core/physics/phases/flightPhase.ts — part 1 (atmosphere + thrust)
- **Status**: pending
- **Dependencies**: TASK-066
- **Description**: Per requirements §8. Move the FLIGHT-phase branch's atmosphere/thrust/fuel section to `src/core/physics/phases/flightPhase.ts` (first half). Preserve thrust → fuel → mass ordering.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/atmosphere.test.ts src/tests/fuelsystem.test.ts` passes.

### TASK-068: Extract src/core/physics/phases/flightPhase.ts — part 2 (steering + parachutes)
- **Status**: pending
- **Dependencies**: TASK-067
- **Description**: Per requirements §8. Complete `flightPhase.ts` by adding the steering/parachute branch. Reuse `steering.ts` helpers.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/parachute*.test.ts` passes.

### TASK-069: Extract src/core/physics/phases/descentPhase.ts if distinct
- **Status**: pending
- **Dependencies**: TASK-068
- **Description**: Per requirements §8. If `_integrate` has a distinct DESCENT/re-entry branch, extract it to `src/core/physics/phases/descentPhase.ts`. If DESCENT is folded into FLIGHT, document this and skip the extraction.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes.

### TASK-070: Refactor _integrate to pure dispatcher
- **Status**: pending
- **Dependencies**: TASK-069
- **Description**: Per requirements §8 integration-loop refactor. After all phase extractions, `_integrate` in `integrate.ts` should be a short dispatcher (~30 LOC): read phase, call corresponding `tickXxxPhase(ps, dt, ctx)`, handle cross-phase transitions. Delete duplicated logic now living in phase files.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes. `integrate.ts` is < 100 LOC.

### TASK-071: Convert physics.ts to barrel re-export
- **Status**: pending
- **Dependencies**: TASK-070
- **Description**: Per requirements §8. Rewrite `src/core/physics.ts` as a pure barrel: `export * from './physics/init'; export * from './physics/integrate'; export * from './physics/keyboard';` etc. No logic remaining in `physics.ts`. All public API surface is preserved.
- **Verification**: `wc -l src/core/physics.ts` shows ≤ 30 LOC. All of `physics.test.ts`, `throttleControl.test.ts`, `controlMode.test.ts`, `parachute*.test.ts`, `atmosphere.test.ts`, `fuelsystem.test.ts`, `collision.test.ts`, `orbit*.test.ts`, `manoeuvre.test.ts`, `docking*.test.ts` pass.

### TASK-072: Update generator + test-map.json for physics sub-modules
- **Status**: pending
- **Dependencies**: TASK-071
- **Description**: Per requirements §11. Edit `scripts/generate-test-map.mjs` to teach it about the new physics barrel: (a) add `'src/core/physics.ts': 'src/core/physics'` to `BARREL_MAP`; (b) add `{ re: /^src\/core\/physics\//, area: 'core/physics' }` to `subDirPatterns` inside `classifySource`. Then run `npm run test-map:generate` and verify each physics sub-module classifies to the existing `core/physics` area (keeping all sub-modules grouped with the barrel + existing physics tests).
- **Verification**: `grep -B 1 -A 10 '"src/core/physics/' test-map.json` shows entries. The `core/physics` area includes sources `src/core/physics.ts` plus all new `src/core/physics/*.ts` and `src/core/physics/phases/*.ts` files.

### TASK-073: Add focused unit test for physics/gravity.ts
- **Status**: pending
- **Dependencies**: TASK-072
- **Description**: Per requirements §8 (tests only where new seams are usefully testable). Add `src/tests/physics-gravity.test.ts`. Cover flat-mode gravity, radial-mode gravity on Earth, radial-mode gravity on a non-Earth body (Mun) — catches a recurrence of the body-aware bug class.
- **Verification**: `npx vitest run src/tests/physics-gravity.test.ts` passes.

### TASK-074: Add focused unit test for physics/docking.ts
- **Status**: pending
- **Dependencies**: TASK-072
- **Description**: Per requirements §8. Add `src/tests/physics-docking.test.ts`. Cover `_applyDockingMovement` translation in RCS mode and `computeDockingRadialOut` across bodies. Reuse existing docking test fixtures where possible.
- **Verification**: `npx vitest run src/tests/physics-docking.test.ts` passes.

### TASK-075: Add focused unit test for physics/thrust.ts
- **Status**: pending
- **Dependencies**: TASK-072
- **Description**: Per requirements §8. Add `src/tests/physics-thrust.test.ts`. Cover thrust-from-throttle, TWR lookup edge cases (zero-mass, max throttle), fuel starvation (zero thrust when no fuel).
- **Verification**: `npx vitest run src/tests/physics-thrust.test.ts` passes.

---

## Section 9 — constants.ts Topical Split

### TASK-076: Create src/core/constants/ directory
- **Status**: pending
- **Dependencies**: none
- **Description**: Per requirements §9. Create the directory `src/core/constants/`. Do not move anything yet. Touch an empty file if needed so git picks up the directory.
- **Verification**: `src/core/constants/` exists.

### TASK-077: Extract src/core/constants/bodies.ts
- **Status**: pending
- **Dependencies**: TASK-076
- **Description**: Per requirements §9, recommended order step 1 (self-contained). Move the celestial-body + altitude-band + biome + surface-op + life-support constants (approx. lines 773–1074 and 1738–1959 of `constants.ts`) to `src/core/constants/bodies.ts`. Update `constants.ts` to re-export from the new file so all 123 consumers stay working.
- **Verification**: `npm run typecheck` passes. `npm run lint` passes. `npm run build` succeeds.

### TASK-078: Extract src/core/constants/gameplay.ts
- **Status**: pending
- **Dependencies**: TASK-077
- **Description**: Per requirements §9. Move weather + hard landing + injury + medical + part wear + difficulty + comms + resources + mining constants to `src/core/constants/gameplay.ts`. Re-export from `constants.ts`.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds.

### TASK-079: Extract src/core/constants/satellites.ts
- **Status**: pending
- **Dependencies**: TASK-078
- **Description**: Per requirements §9. Move SatelliteType + constellation + lease + reposition + degradation constants (approx. lines 1487–1647) to `src/core/constants/satellites.ts`. Re-export from `constants.ts`. Note: this file imports altitude-band keys from `bodies.ts`.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/satellite*.test.ts` passes.

### TASK-080: Extract src/core/constants/economy.ts
- **Status**: pending
- **Dependencies**: TASK-079
- **Description**: Per requirements §9. Move finance + facilities + contracts + reputation + training + crew-cost constants to `src/core/constants/economy.ts`. Re-export from `constants.ts`. Imports `PartType` from `flight.ts` (which is extracted next).
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/finance.test.ts src/tests/contracts.test.ts` passes.

### TASK-081: Extract src/core/constants/flight.ts
- **Status**: pending
- **Dependencies**: TASK-080
- **Description**: Per requirements §9. Move remaining flight/orbit/docking/power/malfunction/part-type constants to `src/core/constants/flight.ts`. At this point, `constants.ts` is a barrel of 5 topical files.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds. `npm run test:smoke:unit` passes.

### TASK-082: Rewrite constants.ts as pure barrel
- **Status**: pending
- **Dependencies**: TASK-081
- **Description**: Per requirements §9. Ensure `src/core/constants.ts` contains only `export * from './constants/flight';` etc. — no constant definitions. Should be ≤ 20 LOC.
- **Verification**: `wc -l src/core/constants.ts` shows ≤ 20. `npm run typecheck` passes.

### TASK-083: Update generator + test-map.json for constants sub-modules
- **Status**: pending
- **Dependencies**: TASK-082
- **Description**: Per requirements §11. Edit `scripts/generate-test-map.mjs` to teach it about the new constants barrel: (a) add `'src/core/constants.ts': 'src/core/constants'` to `BARREL_MAP`; (b) add `{ re: /^src\/core\/constants\//, area: 'core/constants' }` to `subDirPatterns`; (c) decide whether to leave `'src/core/constants.ts'` in `SOURCE_GROUPS['core/gameState']` (keeps existing grouping; sub-files become a separate `core/constants` area) or remove it and create a new `core/constants` SOURCE_GROUP explicitly (unifies barrel + sub-files in one area — recommended). Run `npm run test-map:generate` and verify mappings.
- **Verification**: `grep -B 1 -A 5 '"src/core/constants' test-map.json` shows entries for all topical files. `npm run typecheck` and `npm run build` still pass (mapping changes don't affect runtime).

---

## Section 10 — UI Reducer Extraction

### TASK-084: Extract flightHud reducer to src/ui/flightHud/_state.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Per requirements §10.1. Create the directory `src/ui/flightHud/` and inside it `_state.ts`. Define `FlightHudState` interface, `getFlightHudState()`, `setFlightHudState(patch)`, `resetFlightHudState()` — follow `src/ui/vab/_state.ts` pattern exactly. Extract: throttle display formatter, altitude/velocity formatter, apoapsis estimator, fuel tank list builder.
- **Verification**: `npm run typecheck` passes. The new file exists and exports the state API.

### TASK-085: Update flightHud.ts to use the new reducer
- **Status**: pending
- **Dependencies**: TASK-084
- **Description**: Per requirements §10.1. In `src/ui/flightHud.ts`, replace the ad-hoc module-level state and pure helpers with calls to `getFlightHudState` / `setFlightHudState`. DOM wiring, event listeners, and PixiJS calls stay in `flightHud.ts`.
- **Verification**: `npm run typecheck` passes. `npx playwright test e2e/flight.spec.ts` passes (the flight E2E exercises flightHud).

### TASK-086: Create src/tests/ui-flightHudState.test.ts
- **Status**: pending
- **Dependencies**: TASK-084
- **Description**: Per requirements §10.1. Create `src/tests/ui-flightHudState.test.ts`. Cover defaults, patching, reset. Test pure formatters/reducers directly with known inputs.
- **Verification**: `npx vitest run src/tests/ui-flightHudState.test.ts` passes.

### TASK-087: Extract topbar reducer to src/ui/topbar/_state.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Per requirements §10.2. Create `src/ui/topbar/_state.ts` with `TopbarState` + getters/setters following the VAB pattern. Extract: cash color / health-based formatting, mission count badge visibility, dropdown open state, modal visibility helpers.
- **Verification**: `npm run typecheck` passes.

### TASK-088: Update topbar.ts to use the new reducer
- **Status**: pending
- **Dependencies**: TASK-087
- **Description**: Per requirements §10.2. Update `src/ui/topbar.ts` to delegate to the reducer. Keep DOM/listener code in place.
- **Verification**: `npm run typecheck` passes. `npx playwright test e2e/topbar*.spec.ts` passes (if such specs exist) or run the affected suite for topbar.

### TASK-089: Create src/tests/ui-topbarState.test.ts
- **Status**: pending
- **Dependencies**: TASK-087
- **Description**: Per requirements §10.2. Create `src/tests/ui-topbarState.test.ts` mirroring `ui-vabState.test.ts` style.
- **Verification**: `npx vitest run src/tests/ui-topbarState.test.ts` passes.

### TASK-090: Extract hub reducer to src/ui/hub/_state.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Per requirements §10.3. Create `src/ui/hub/_state.ts`. Extract: `formatReturnResults` pure function, facility upgrade eligibility check, financial summary calculations.
- **Verification**: `npm run typecheck` passes.

### TASK-091: Update hub.ts to use the new reducer
- **Status**: pending
- **Dependencies**: TASK-090
- **Description**: Per requirements §10.3. Update `src/ui/hub.ts` to delegate to the reducer.
- **Verification**: `npm run typecheck` passes. Hub-related E2E specs pass — target: `npx playwright test e2e/hub*.spec.ts` (or whichever spec exercises hub).

### TASK-092: Create src/tests/ui-hubState.test.ts
- **Status**: pending
- **Dependencies**: TASK-090
- **Description**: Per requirements §10.3. Create `src/tests/ui-hubState.test.ts`.
- **Verification**: `npx vitest run src/tests/ui-hubState.test.ts` passes.

### TASK-093: Extract mainmenu reducer to src/ui/mainmenu/_state.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Per requirements §10.4. Create `src/ui/mainmenu/_state.ts`. Extract: save slot card formatting (date, duration, crew count, money), save list sort/filter order. Skip shooting-stars animation state.
- **Verification**: `npm run typecheck` passes.

### TASK-094: Update mainmenu.ts to use the new reducer
- **Status**: pending
- **Dependencies**: TASK-093
- **Description**: Per requirements §10.4. Update `src/ui/mainmenu.ts`.
- **Verification**: `npm run typecheck` passes. `npx playwright test e2e/mainmenu*.spec.ts` passes (if present).

### TASK-095: Create src/tests/ui-mainMenuState.test.ts
- **Status**: pending
- **Dependencies**: TASK-093
- **Description**: Per requirements §10.4. Create `src/tests/ui-mainMenuState.test.ts`.
- **Verification**: `npx vitest run src/tests/ui-mainMenuState.test.ts` passes.

### TASK-096: Extract crewAdmin reducer to src/ui/crewAdmin/_state.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Per requirements §10.5. Create `src/ui/crewAdmin/_state.ts`. Extract: `formatCrewRow`, `skillBarHTML` (if the pure HTML-string builder can be separated from the DOM mount), hire capacity check + cost calculation, training period calculation.
- **Verification**: `npm run typecheck` passes.

### TASK-097: Update crewAdmin.ts to use the new reducer
- **Status**: pending
- **Dependencies**: TASK-096
- **Description**: Per requirements §10.5. Update `src/ui/crewAdmin.ts`.
- **Verification**: `npm run typecheck` passes. `npx playwright test e2e/crew*.spec.ts` passes (if present).

### TASK-098: Create src/tests/ui-crewAdminState.test.ts
- **Status**: pending
- **Dependencies**: TASK-096
- **Description**: Per requirements §10.5. Create `src/tests/ui-crewAdminState.test.ts`.
- **Verification**: `npx vitest run src/tests/ui-crewAdminState.test.ts` passes.

### TASK-099: Update generator + test-map.json for UI state files and tests
- **Status**: pending
- **Dependencies**: TASK-086, TASK-089, TASK-092, TASK-095, TASK-098
- **Description**: Per requirements §11. Files like `src/ui/flightHud/_state.ts` will classify to `ui/flightHud` via the generator's fallback regex for deep paths — no script edits strictly required. Recommended (cleaner + explicit): add to `subDirPatterns` in `scripts/generate-test-map.mjs`: entries for `src/ui/flightHud/`, `src/ui/topbar/`, `src/ui/hub/`, `src/ui/mainmenu/`, `src/ui/crewAdmin/` with their corresponding areas. Then run `npm run test-map:generate` and confirm each `_state.ts` maps into the expected area and each `ui-*State.test.ts` is in that area's `unit` list.
- **Verification**: For each of the five UI state modules: `grep -B 1 -A 8 '"src/ui/<panel>/_state.ts"' test-map.json` shows the expected area and the corresponding test file appears in its `unit` list.

---

## Section 11 — Final Verification

### TASK-100: Run typecheck, lint, and build
- **Status**: pending
- **Dependencies**: TASK-006, TASK-011, TASK-019, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025, TASK-033, TASK-040, TASK-046, TASK-052, TASK-072, TASK-083, TASK-099
- **Description**: Per requirements §12. Run `npm run typecheck && npm run lint && npm run build`. All three must produce zero errors.
- **Verification**: All three commands exit 0.

### TASK-101: Run full unit test suite
- **Status**: pending
- **Dependencies**: TASK-100
- **Description**: Per requirements §12. Run `npm run test:unit`. All tests pass.
- **Verification**: Exit 0. No skipped or failing tests.

### TASK-102: Run smoke test suite (unit + E2E)
- **Status**: pending
- **Dependencies**: TASK-101
- **Description**: Per requirements §12. Run `npm run test:smoke:unit` and `npm run test:smoke:e2e` sequentially. Smoke E2E must pass — note: smoke subset only per standing preference, NEVER the full E2E suite.
- **Verification**: Both commands exit 0.

### TASK-103: Run targeted E2E for migrated and new specs
- **Status**: pending
- **Dependencies**: TASK-102
- **Description**: Per requirements §12. Run `npx playwright test e2e/keyboard-nav.spec.ts e2e/tipping.spec.ts e2e/flight-hud-surface.spec.ts` plus whichever spec covers hub-return auto-save (`e2e/auto-save-hub-return.spec.ts` or the extended `e2e/auto-save.spec.ts`) and the new `e2e/mission-finance-loop.spec.ts`.
- **Verification**: All five/six specs pass.

### TASK-104: Run affected-test suite against master
- **Status**: pending
- **Dependencies**: TASK-103
- **Description**: Per requirements §12. Run `node scripts/run-affected.mjs --base master`. This confirms the affected-test tooling recognizes our changes and surfaces the right tests. Should exit 0.
- **Verification**: Exit 0. Task message summarizes the areas that were detected as affected.
