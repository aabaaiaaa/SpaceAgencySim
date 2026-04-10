# Iteration 6 — Task List

See `.devloop/requirements.md` for full context and rationale behind each task.

---

## Section 1: Bug Fix

### TASK-001: Fix saveload.ts CrewStatus.DEAD / AstronautStatus.KIA enum mismatch
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/core/saveload.ts`, `countKIA()` (line 256) and `countLivingCrew()` (line 263) compare `c.status === CrewStatus.DEAD` but `CrewMember.status` is now typed as `AstronautStatus` after the iteration 5 type unification. Replace `CrewStatus.DEAD` (value `'DEAD'`) with `AstronautStatus.KIA` (value `'kia'`) in both functions. Also tighten the parameter types from `{ crew?: Array<{ status: string }> }` to use `AstronautStatus` instead of bare `string`. Update `src/tests/saveload.test.ts` mock data at lines 151, 242, 354-368 that use `CrewStatus.DEAD` — these currently validate the wrong behavior.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` — all tests pass with corrected enum values.

---

## Section 2: Test Map Regeneration

### TASK-002: Create generate-test-map.mjs script
- **Status**: pending
- **Dependencies**: none
- **Description**: Create `scripts/generate-test-map.mjs` that auto-generates `test-map.json` from import analysis. The script should: (1) scan all unit test files (`src/tests/**/*.test.ts`) and E2E spec files (`e2e/**/*.spec.ts`), (2) parse each file's imports to determine which source modules it tests, (3) group results by source area using the existing naming convention (e.g., `core/physics`, `ui/vab`, `render/flight`), (4) output the same JSON structure as the current `test-map.json` with `{ areas: { [name]: { sources, unit, e2e } } }`, (5) handle barrel re-exports (if a test imports from a barrel like `src/ui/vab.ts`, trace through to sub-modules), (6) include an `e2e-infra` area for E2E helpers. The script should accept a `--dry-run` flag that prints the output to stdout without writing the file.
- **Verification**: `node scripts/generate-test-map.mjs --dry-run` runs without error and outputs valid JSON to stdout.

### TASK-003: Generate test-map.json and add npm script
- **Status**: pending
- **Dependencies**: TASK-002
- **Description**: Run the generator to produce a fresh `test-map.json`. Review the output for completeness — check that: (1) all source areas from the old map are present, (2) no stale `.spec.js` or `.js` references remain, (3) the `e2e-infra` area references `.ts` files. Add `"test-map:generate": "node scripts/generate-test-map.mjs"` to `package.json` scripts. If the generator missed any E2E-to-source mappings that are exercised indirectly (not via direct imports), manually add them.
- **Verification**: `node scripts/run-affected.mjs --dry-run --base HEAD~1` runs without error and resolves test file paths that exist on disk (no missing file warnings).

---

## Section 3: Lint Warning Cleanup

### TASK-004: Clean up lint warnings in source files
- **Status**: pending
- **Dependencies**: none
- **Description**: Remove all unused imports and variables flagged by `@typescript-eslint/no-unused-vars` in production source files. Files with warnings include: `src/core/` (~20 files: achievements.ts, asteroidBelt.ts, atmosphere.ts, construction.ts, controlMode.ts, customChallenges.ts, designLibrary.ts, docking.ts, flightPhase.ts, grabbing.ts, library.ts, malfunction.ts, manoeuvre.ts, mapView.ts, orbit.ts, physics.ts, reputation.ts, sciencemodule.ts, settings.ts, surfaceOps.ts, techtree.ts, weather.ts), `src/data/challenges.ts`, `src/main.ts`, `src/render/` (flight/_debris.ts, flight/_rocket.ts, flight/_trails.ts, map.ts), `src/ui/` (flightController/_keyboard.ts, flightController/_mapView.ts, hub.ts, library.ts, rdLab.ts, vab/_engineerPanel.ts). For each file: identify the unused import/variable in the ESLint warning, delete the import or declaration, verify the file still compiles.
- **Verification**: `npx eslint src/core/ src/data/ src/render/ src/ui/ src/main.ts --max-warnings 0` — 0 warnings, 0 errors.

### TASK-005: Clean up lint warnings in unit test files
- **Status**: pending
- **Dependencies**: none
- **Description**: Remove all unused imports and variables in unit test files flagged by `@typescript-eslint/no-unused-vars`. There are ~35 test files with warnings in `src/tests/`. For each file: run `npx eslint <file>` to see the specific warning, remove the unused import or variable, verify the test still passes. Files include: achievements.test.ts, atmosphere.test.ts, autoSave.test.ts, bankruptcy.test.ts, branchCoverage.test.ts, challenges.test.ts, collision.test.ts, comms.test.ts, construction.test.ts, contracts.test.ts, controlMode.test.ts, crew.test.ts, docking.test.ts, e2e-infrastructure.test.ts, flightReturn.test.ts, fuelsystem.test.ts, grabbing.test.ts, instruments.test.ts, launchPadTiers.test.ts, malfunction.test.ts, manoeuvre.test.ts, mccTiers.test.ts, multiBodyLanding.test.ts, orbit.test.ts, parachute-deploy.test.ts, parachute-descent.test.ts, partInventory.test.ts, period.test.ts, physics.test.ts, physicsWorker.test.ts, power.test.ts, render-flight-pool.test.ts, render-sky.test.ts, rocketvalidator.test.ts, sandbox.test.ts, satellites.test.ts, sciencemodule.test.ts, staging.test.ts, surfaceOps.test.ts, undoRedo.test.ts, weather.test.ts.
- **Verification**: `npx eslint src/tests/ --max-warnings 0` — 0 warnings, 0 errors.

### TASK-006: Clean up lint warnings in E2E files and fix remaining warning types
- **Status**: pending
- **Dependencies**: TASK-004, TASK-005
- **Description**: (1) Remove unused imports/variables in E2E files with warnings: additional-systems.spec.ts, agency-depth.spec.ts, biomes-science.spec.ts, collision.spec.ts, destinations.spec.ts, facilities-infrastructure.spec.ts, failure-paths.spec.ts, fixtures.ts, flight.spec.ts, mission-progression.spec.ts, orbital-operations.spec.ts, phase-transitions.spec.ts, reliability-risk.spec.ts, sandbox-replayability.spec.ts, saveload.spec.ts, tutorial-revisions.spec.ts. (2) Fix the 2 `require-await` warnings — remove the `async` keyword if the function doesn't need to be async, or add the missing `await`. (3) Fix the 1 `no-useless-assignment` — remove the dead assignment.
- **Verification**: `npm run lint 2>&1 | tail -5` — reports "0 problems" (0 errors, 0 warnings).

---

## Section 4: Typed Test Factory Functions

### TASK-007: Create unit test factory file
- **Status**: pending
- **Dependencies**: none
- **Description**: Create `src/tests/_factories.ts` with typed factory functions for all types that have 10+ `as unknown as` casts in unit tests. Each factory takes an optional `Partial<T>` parameter for overrides and returns a fully typed object with sensible defaults. Required factories: `makePhysicsState(overrides?)` (77 casts), `makeGameState(overrides?)` (22 casts), `makeMissionInstance(overrides?)` (20 casts), `makeFlightState(overrides?)` (20 casts), `makeGraphics(overrides?)` for mock PixiJS Graphics (18 casts), `makeRecord(overrides?)` or appropriate typed alternative (17 casts), `makeRecoveryPS(overrides?)` (16 casts), `makeCrewMember(overrides?)` (16 casts — mirrors E2E's `buildCrewMember` pattern), `makeMockElement(overrides?)` for mock DOM elements (13 casts). Import real interfaces from `src/core/` modules. No `any` allowed — use proper types throughout. Export all factories.
- **Verification**: `npx vitest run src/tests/_factories.test.ts 2>&1 || echo "No test file yet"` — file compiles without errors: `npx tsc --noEmit src/tests/_factories.ts 2>&1 | head -5` should show no errors. Also `npx eslint src/tests/_factories.ts --max-warnings 0`.

### TASK-008: Create E2E typed GameWindow helper
- **Status**: pending
- **Dependencies**: none
- **Description**: Create a typed helper in `e2e/helpers/` that provides type-safe access to game globals on `window`, reducing the 382 `as unknown as GameWindow` and `as unknown as GW` casts across E2E specs. The current pattern is `(window as unknown as GameWindow).someProperty` inside `page.evaluate()` callbacks. Design a helper (e.g., a typed `evaluateGame()` wrapper or a `GameWindow` type declaration that augments the `Window` interface for E2E context) that eliminates the need for per-line casts. Update the barrel export in `e2e/helpers.ts` to include the new helper.
- **Verification**: `npx tsc --noEmit -p e2e/tsconfig.json` — no type errors. The helper compiles and is exported from the barrel.

### TASK-009: Migrate unit tests to factories — physics and flight tests
- **Status**: pending
- **Dependencies**: TASK-006, TASK-007
- **Description**: Update unit test files that primarily use `PhysicsState` and flight-related `as unknown as` casts to use the new factory functions from `src/tests/_factories.ts`. Target files include those with PhysicsState casts: physics.test.ts, physicsWorker.test.ts, physicsWorkerCommand.test.ts, flightPhase.test.ts, parachute-deploy.test.ts, parachute-descent.test.ts, parachute-landing.test.ts, atmosphere.test.ts, collision.test.ts, fuelsystem.test.ts, orbit.test.ts, manoeuvre.test.ts, legs.test.ts, controlMode.test.ts, staging.test.ts, ejector.test.ts. Replace `{...} as unknown as PhysicsState` with `makePhysicsState({...})`. Also replace any other factory-eligible casts in these files (FlightState, GameState, etc.).
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/physicsWorker.test.ts src/tests/flightPhase.test.ts src/tests/collision.test.ts src/tests/orbit.test.ts` — all pass. Count PhysicsState casts remaining: `grep -c "as unknown as PhysicsState" src/tests/*.test.ts 2>/dev/null | grep -v ":0$" | wc -l` should be 0 or near-0.

### TASK-010: Migrate unit tests to factories — state, mission, and crew tests
- **Status**: pending
- **Dependencies**: TASK-006, TASK-007
- **Description**: Update unit test files that primarily use `GameState`, `MissionInstance`, `CrewMember`, and `RecoveryPS` casts to use factory functions. Target files include: gameState.test.ts, crew.test.ts, missions.test.ts, contracts.test.ts, challenges.test.ts, customChallenges.test.ts, saveload.test.ts, finance.test.ts, bankruptcy.test.ts, designLibrary.test.ts, achievements.test.ts, flightReturn.test.ts, multiBodyLanding.test.ts, reputation.test.ts, malfunction.test.ts, partInventory.test.ts, construction.test.ts, launchPadTiers.test.ts, mccTiers.test.ts, techtree.test.ts, satellites.test.ts, comms.test.ts, power.test.ts, lifeSupport.test.ts, biomes.test.ts, sciencemodule.test.ts, surfaceOps.test.ts, instruments.test.ts. Replace `{...} as unknown as GameState` with `makeGameState({...})`, and similarly for other types.
- **Verification**: `npx vitest run src/tests/gameState.test.ts src/tests/crew.test.ts src/tests/missions.test.ts src/tests/saveload.test.ts src/tests/flightReturn.test.ts` — all pass. Total unit test `as unknown as` count: `grep -r "as unknown as" src/tests/ | wc -l` should be under 120 (down from 279).

### TASK-011: Migrate unit tests to factories — render and UI tests
- **Status**: pending
- **Dependencies**: TASK-006, TASK-007
- **Description**: Update remaining unit test files (primarily render and UI tests) that use `Graphics`, `MockElement`, and other `as unknown as` casts to use factory functions. Target files include: render-camera.test.ts, render-sky.test.ts, render-ground.test.ts, render-constants.test.ts, render-trails.test.ts, render-input.test.ts, render-flight-pool.test.ts, render-state.test.ts, render-map-state.test.ts, render-asteroids.test.ts, ui-fcState.test.ts, ui-timeWarp.test.ts, ui-vabStaging.test.ts, ui-vabState.test.ts, ui-vabUndoActions.test.ts, ui-mcState.test.ts, ui-mapView.test.ts, ui-fpsMonitor.test.ts, ui-escapeHtml.test.ts, ui-listenerTracker.test.ts, ui-rocketCardUtil.test.ts, docking.test.ts, grabbing.test.ts, undoRedo.test.ts, sandbox.test.ts, weather.test.ts, e2e-infrastructure.test.ts, branchCoverage.test.ts, autoSave.test.ts, idbStorage.test.ts, storageErrors.test.ts. Replace casts with factory calls.
- **Verification**: `npx vitest run src/tests/render-camera.test.ts src/tests/ui-vabStaging.test.ts src/tests/docking.test.ts src/tests/weather.test.ts` — all pass. Total unit test `as unknown as` count: `grep -r "as unknown as" src/tests/ | wc -l` should be under 50.

### TASK-012: Migrate E2E specs to typed window helper — batch 1
- **Status**: pending
- **Dependencies**: TASK-006, TASK-008
- **Description**: Update the first batch of E2E specs to use the typed GameWindow helper instead of `as unknown as GameWindow` / `as unknown as GW` casts. Files: additional-systems.spec.ts, agency-depth.spec.ts, biomes-science.spec.ts, core-mechanics.spec.ts, crew.spec.ts, debug-mode.spec.ts, facilities-infrastructure.spec.ts, failure-paths.spec.ts, fps-monitor.spec.ts, landing.spec.ts. For each file: import the typed helper, replace all GameWindow/GW cast patterns with the helper usage.
- **Verification**: `npx playwright test e2e/additional-systems.spec.ts e2e/crew.spec.ts e2e/landing.spec.ts --reporter=list` — all pass. Cast count in batch: `grep -c "as unknown as G" e2e/additional-systems.spec.ts e2e/agency-depth.spec.ts e2e/biomes-science.spec.ts e2e/core-mechanics.spec.ts e2e/crew.spec.ts e2e/debug-mode.spec.ts e2e/facilities-infrastructure.spec.ts e2e/failure-paths.spec.ts e2e/fps-monitor.spec.ts e2e/landing.spec.ts | grep -v ":0$"` should show 0 remaining casts.

### TASK-013: Migrate E2E specs to typed window helper — batch 2
- **Status**: pending
- **Dependencies**: TASK-006, TASK-008
- **Description**: Update the second batch of E2E specs to use the typed GameWindow helper. Files: launchpad-relaunch.spec.ts, launchpad.spec.ts, mission-progression.spec.ts, missions.spec.ts, part-reconnection.spec.ts, phase-transitions.spec.ts, relaunch.spec.ts, sandbox-replayability.spec.ts, saveload.spec.ts. For each file: import the typed helper, replace all GameWindow/GW cast patterns.
- **Verification**: `npx playwright test e2e/missions.spec.ts e2e/saveload.spec.ts e2e/sandbox-replayability.spec.ts --reporter=list` — all pass. Total E2E `as unknown as G` count: `grep -r "as unknown as G" e2e/ | wc -l` should be 0 or near-0.

---

## Section 5+6: Small Fixes

### TASK-014: Move _mapView.ts inline styles to CSS and tighten Playwright testMatch
- **Status**: pending
- **Dependencies**: none
- **Description**: Two small fixes: (1) In `src/ui/flightController/_mapView.ts` lines 290-291, replace the inline `style=""` attributes on the `transfer-info` and `transfer-progress` divs with CSS classes. The transfer-info div uses `color:#ffcc44;margin-top:4px;display:none` and transfer-progress uses `color:#ff6644;margin-top:4px;display:none`. Add CSS classes (e.g., `.transfer-info`, `.transfer-progress`) to the project stylesheet and apply them. (2) In `playwright.config.ts` line 8, change `testMatch: '**/*.spec.{js,ts}'` to `testMatch: '**/*.spec.ts'` since all specs are now TypeScript.
- **Verification**: `npx tsc --noEmit` — no type errors. `npx playwright test --list 2>&1 | head -5` — lists specs successfully (no "no tests found" error). `grep "style=" src/ui/flightController/_mapView.ts` should return no results for those lines.

---

## Section 7: Coverage Overhaul

### TASK-015: Update vite.config.ts coverage exclusions
- **Status**: pending
- **Dependencies**: none
- **Description**: Add untestable PixiJS-heavy and DOM-heavy files to the coverage `exclude` array in `vite.config.ts`. These are files at 0% unit test line coverage where the logic is inherently tied to canvas rendering or DOM manipulation. See the full exclusion list in requirements.md section 7.3 — it includes render barrels/init/rocket/debris/hub/vab, UI barrels/screens (crewAdmin, mainmenu, help, launchPad, topbar, settings, perfDashboard, satelliteOps, trackingStation, rdLab, library, etc.), flightController sub-modules (init, keyboard, menuActions, docking, orbitRcs, postFlight, surfaceActions, flightPhase), missionControl sub-modules (init, shell, tabs), and vab sub-modules (init, canvasInteraction, panels, partsPanel, designLibrary, engineerPanel, launchFlow, scalebar, inventory). Keep all files that currently have non-zero line coverage.
- **Verification**: `npx vitest run --coverage 2>&1 | grep "ERROR"` — no coverage threshold errors (exclusions should bring actual coverage above the current aspirational thresholds for the remaining files).

### TASK-016: Add unit tests for render/flight/_camera.ts, _ground.ts, and _sky.ts
- **Status**: pending
- **Dependencies**: TASK-006, TASK-015
- **Description**: Add new unit tests targeting uncovered code paths in three render/flight modules: (1) `_camera.ts` (48% lines) — test uncovered `worldToScreen` edge cases, `computeCoM` with varied inputs, lines 114-190. (2) `_ground.ts` (52% lines) — test terrain data generation logic, uncovered branches, lines 111-186. (3) `_sky.ts` (82% lines) — test uncovered sky rendering logic, lines 129-205. Add tests to the existing test files (`render-camera.test.ts`, `render-ground.test.ts`, `render-sky.test.ts`). Focus on testable pure-logic paths — don't try to test PixiJS rendering calls.
- **Verification**: `npx vitest run src/tests/render-camera.test.ts src/tests/render-ground.test.ts src/tests/render-sky.test.ts --coverage 2>&1 | grep -E "(_camera|_ground|_sky)"` — line coverage improved for all three files.

### TASK-017: Add unit tests for render/flight/_trails.ts, _asteroids.ts, and render/map.ts
- **Status**: pending
- **Dependencies**: TASK-006, TASK-015
- **Description**: Add new unit tests targeting uncovered code paths: (1) `_trails.ts` (9% lines) — test trail point management, trail calculation logic. Much of this module is PixiJS-heavy, so focus on any extractable pure-logic functions. (2) `_asteroids.ts` (16% lines) — test asteroid rendering calculation logic. (3) `render/map.ts` (21% lines) — test orbit math helper functions that are pure calculations. Add tests to existing files (`render-trails.test.ts`, `render-asteroids.test.ts`, `render-map-state.test.ts`) or create new test files if appropriate.
- **Verification**: `npx vitest run src/tests/render-trails.test.ts src/tests/render-asteroids.test.ts src/tests/render-map-state.test.ts --coverage 2>&1 | grep -E "(_trails|_asteroids|map)"` — line coverage improved for all three files.

### TASK-018: Add unit tests for UI modules: fpsMonitor.ts, vab/_staging.ts, vab/_undoActions.ts
- **Status**: pending
- **Dependencies**: TASK-006, TASK-015
- **Description**: Add new unit tests targeting uncovered code paths: (1) `fpsMonitor.ts` (70% lines) — test uncovered recording/display logic, lines 161-169 and 201-248. (2) `vab/_staging.ts` (19% lines) — test `computeVabStageDeltaV()` pure physics math and other testable stage logic. This is the biggest coverage gap in testable UI code. (3) `vab/_undoActions.ts` (81% lines) — test uncovered snapshot edge cases, lines 149-253 and 262-266. Add to existing test files (`ui-fpsMonitor.test.ts`, `ui-vabStaging.test.ts`, `ui-vabUndoActions.test.ts`).
- **Verification**: `npx vitest run src/tests/ui-fpsMonitor.test.ts src/tests/ui-vabStaging.test.ts src/tests/ui-vabUndoActions.test.ts --coverage 2>&1 | grep -E "(fpsMonitor|_staging|_undoActions)"` — line coverage improved for all three files.

### TASK-019: Add unit tests for flightController modules
- **Status**: pending
- **Dependencies**: TASK-006, TASK-015
- **Description**: Add new unit tests targeting uncovered code paths in flightController sub-modules: (1) `_loop.ts` (41% lines) — test loop tick logic, error recovery paths. (2) `_mapView.ts` (64% lines) — test transfer calculation display logic. (3) `_timeWarp.ts` (90% lines) — test uncovered threshold edge case at lines 73-77 (small addition). (4) `_workerBridge.ts` (73% lines) — test uncovered message handling paths. Add to existing test files (`ui-timeWarp.test.ts`, etc.) or create new test files for modules that don't have them.
- **Verification**: `npx vitest run src/tests/ui-timeWarp.test.ts src/tests/loopErrorHandling.test.ts src/tests/workerBridgeTimeout.test.ts --coverage 2>&1 | grep -E "(_loop|_mapView|_timeWarp|_workerBridge)"` — line coverage improved.

### TASK-020: Set final coverage thresholds and enforce --coverage in test:unit
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017, TASK-018, TASK-019
- **Description**: After all coverage exclusions and new tests are in place: (1) Run `npx vitest run --coverage` and record actual coverage percentages for `src/core/**`, `src/render/**`, and `src/ui/**`. (2) Set thresholds in `vite.config.ts` at or slightly below the measured values — round down to the nearest integer. For core, the threshold should be at least 91% lines, 81% branches, 92% functions (matching or exceeding current actuals). For render and UI, set based on the post-exclusion measurements. (3) Change `package.json` script `"test:unit"` from `"vitest run"` to `"vitest run --coverage"` so thresholds are enforced on every test run.
- **Verification**: `npm run test:unit` — all tests pass AND no coverage threshold errors (exit code 0).

---

## Final

### TASK-021: Final verification pass
- **Status**: pending
- **Dependencies**: TASK-001, TASK-003, TASK-006, TASK-011, TASK-013, TASK-014, TASK-020
- **Description**: Run the full verification suite to confirm all iteration 6 goals are met: (1) `npm run typecheck` — no errors. (2) `npm run lint` — 0 warnings, 0 errors. (3) `npm run test:unit` — all unit tests pass with coverage thresholds enforced. (4) Run a targeted selection of E2E specs to verify no regressions: `npx playwright test e2e/smoke.spec.ts e2e/saveload.spec.ts e2e/crew.spec.ts`. (5) `npm run build` — production build succeeds. (6) Verify cast counts: `grep -r "as unknown as" src/tests/ | wc -l` < 50 and `grep -r "as unknown as" e2e/ | wc -l` < 100. (7) `node scripts/run-affected.mjs --dry-run --base HEAD~5` resolves test paths without errors.
- **Verification**: All 7 checks above pass. Report final numbers for: lint warnings, unit test `as unknown as` count, E2E `as unknown as` count, coverage percentages per directory.
