# Iteration 6 — Tech Debt Resolution & Test Infrastructure

This iteration resolves all technical debt identified in the iteration 5 review, overhauls test infrastructure (factory functions, test-map generation, coverage configuration), and cleans up lint warnings across the codebase. There is no new feature work — this is purely a stabilization and quality iteration.

The codebase is in strong shape after iteration 5's TypeScript conversion (zero `@ts-nocheck`, zero explicit `any`, ESLint `no-explicit-any: error` everywhere). This iteration builds on that foundation by fixing the bugs and gaps that were found during the review.

---

## 1. Bug Fix: `saveload.ts` Crew Status Enum Mismatch

**Problem:** During the iteration 5 type unification (TASK-004), `CrewMember.status` was changed from `CrewStatus` to `AstronautStatus`. Two functions in `saveload.ts` were not updated:

- `countKIA()` (line 256): compares `c.status === CrewStatus.DEAD` — should be `AstronautStatus.KIA`
- `countLivingCrew()` (line 263): compares `c.status !== CrewStatus.DEAD` — should be `AstronautStatus.KIA`

Since `CrewStatus.DEAD` has value `'DEAD'` and `AstronautStatus.KIA` has value `'kia'`, the comparison always fails. Result: save slot summaries always show 0 KIA crew and inflated living crew counts.

Both functions also use a loose parameter type `{ crew?: Array<{ status: string }> }` that bypasses the `AstronautStatus` typing, which is why the compiler didn't catch the mismatch.

**Fix:**
1. Replace `CrewStatus.DEAD` with `AstronautStatus.KIA` in both functions.
2. Tighten the parameter types to use `AstronautStatus` instead of bare `string` so the compiler would catch this class of bug in the future.
3. Update the `saveload.test.ts` tests at lines 151, 242, 354-368 that use `CrewStatus.DEAD` in mock data — they currently validate the wrong behavior.
4. Import `AstronautStatus` from `gameState.ts` if not already imported.

---

## 2. Test Map Regeneration

**Problem:** `test-map.json` maps source areas to their relevant test files, consumed by `scripts/run-affected.mjs` to run only tests affected by a code change. After iteration 5's E2E conversion, 62 entries still reference `.spec.js` files that are now `.spec.ts`. The `e2e-infra` area also references `e2e/helpers.js`, `e2e/fixtures.js`, and `e2e/**/*.spec.js` — all now `.ts`.

Beyond the stale extensions, the map was manually curated and may have drifted from the actual codebase. There is no script to generate or validate it.

**Approach:** Create a generator script that builds `test-map.json` from import analysis, then regenerate the file.

**Implementation:**

1. Create `scripts/generate-test-map.mjs` that:
   - Scans all unit test files (`src/tests/**/*.test.ts`) and E2E spec files (`e2e/**/*.spec.ts`)
   - For each test file, reads its imports to determine which source modules it tests
   - Groups results by source area (using the existing area naming convention: `core/physics`, `ui/vab`, `render/flight`, etc.)
   - Outputs the same JSON structure as the current `test-map.json` (`{ areas: { [name]: { sources, unit, e2e } } }`)
   - Handles barrel re-exports (if a test imports from a barrel like `src/ui/vab.ts`, trace through to the sub-modules)
   - Includes E2E helpers in the `e2e-infra` area

2. Add an npm script: `"test-map:generate": "node scripts/generate-test-map.mjs"`

3. Run the generator to produce a fresh `test-map.json`.

4. Manually review the output and adjust any mappings that import analysis missed (E2E tests exercise code paths indirectly that static import analysis won't detect). The generator should produce a reasonable first pass; the review catches edge cases.

5. Update `scripts/run-affected.mjs` if needed to handle any structural changes.

---

## 3. Lint Warning Cleanup

**Problem:** `npm run lint` reports 353 warnings (0 errors):
- **346** `@typescript-eslint/no-unused-vars` — unused imports and variables across source files, predominantly in UI modules
- **4** `@typescript-eslint/no-unused-vars` — potentially auto-fixable
- **2** `require-await` — async functions without `await` expressions
- **1** `no-useless-assignment` — unused assignment

These accumulated from refactoring across iterations 1-5. They obscure real warnings and make lint output noisy.

**Approach:**

1. Run `npm run lint:fix` to auto-fix the 4 fixable warnings.
2. Manually remove the remaining ~346 unused imports and variables. These are mechanical deletions — remove the import or variable declaration, verify nothing breaks.
3. Fix the 2 `require-await` warnings — either remove the `async` keyword (if the function doesn't need to be async) or add the missing `await`.
4. Fix the 1 `no-useless-assignment` — remove the dead assignment.
5. After cleanup, `npm run lint` should report 0 warnings, 0 errors.

**Scope:** The warnings are spread across many files but concentrated in UI modules (`hub.ts`, `_keyboard.ts`, `_mapView.ts`, `library.ts`, `rdLab.ts`, `_engineerPanel.ts`) and a few test files. Each file's cleanup is small (1-5 lines typically).

---

## 4. Typed Test Factory Functions

**Problem:** Test files contain 279 `as unknown as <Type>` casts in unit tests and 432 in E2E tests (711 total). These bypass TypeScript's type checking on mock objects. In at least one case (the `saveload.ts` bug above), a cast masked a real type mismatch that made it into production.

**Current state:**
- `e2e/helpers/_factories.ts` already provides `buildCrewMember()`, `buildContract()`, `buildObjective()` for E2E tests
- Unit tests have no shared factory infrastructure — each test file constructs ad-hoc partial objects cast through `unknown`

**Cast breakdown (unit tests, 279 total):**

| Type | Count | Factory needed? |
|------|-------|-----------------|
| PhysicsState | 77 | Yes — highest impact |
| GameState | 22 | Yes |
| MissionInstance | 20 | Yes |
| FlightState | 20 | Yes |
| Graphics (PixiJS) | 18 | Yes — mock graphics object |
| Record | 17 | Maybe — generic, depends on usage |
| RecoveryPS | 16 | Yes |
| CrewMember | 16 | Yes (exists in E2E, needs unit test version) |
| MockElement | 13 | Yes — mock DOM element |

**Cast breakdown (E2E tests, 432 total):**

| Type | Count | Factory needed? |
|------|-------|-----------------|
| GameWindow / GW | 382 | Typed helper, not traditional factory |
| Record | 46 | Depends on usage |
| FlightWindow | 3 | Typed helper |

**Implementation:**

### 4.1 Unit Test Factory File

Create `src/tests/_factories.ts` (prefixed with `_` to match E2E convention) with factory functions for all types with 10+ casts:

- `makePhysicsState(overrides?)` — returns a valid `PhysicsState` with sensible defaults
- `makeGameState(overrides?)` — returns a minimal valid `GameState`
- `makeMissionInstance(overrides?)` — returns a `MissionInstance`
- `makeFlightState(overrides?)` — returns a `FlightState`
- `makeGraphics(overrides?)` — returns a mock PixiJS `Graphics`-like object
- `makeRecoveryPS(overrides?)` — returns a recovery physics state
- `makeCrewMember(overrides?)` — returns a `CrewMember` (mirrors E2E's `buildCrewMember`)
- `makeMockElement(overrides?)` — returns a mock DOM element

Each factory:
- Takes an optional `Partial<T>` parameter for overrides
- Returns a fully typed `T` object with sensible default values
- Uses real interfaces from `src/core/` — no `any`, no `as unknown as`
- Provides the minimum required fields for the type to be valid

### 4.2 E2E Typed Window Helper

The 382 `GameWindow`/`GW` casts in E2E tests are for accessing game globals on `window`. Create a typed helper in `e2e/helpers/` that provides type-safe window access, reducing the need for per-line casts. For example, a `getGameWindow(page)` helper that returns a typed accessor.

### 4.3 Migrate Existing Tests

After creating the factories, update test files to use them instead of `as unknown as` casts. The goal is to significantly reduce the cast count — not necessarily eliminate every single one (some casts are for intentionally invalid test data, which should use `// @ts-expect-error` instead).

**Target:** Reduce unit test `as unknown as` count from 279 to under 50. Reduce E2E `as unknown as` count from 432 to under 100.

---

## 5. Inline Styles Migration in `_mapView.ts`

**Problem:** Lines 290-291 in `src/ui/flightController/_mapView.ts` have inline `style=""` attributes:

```html
<div data-field="transfer-info" style="color:#ffcc44;margin-top:4px;display:none"></div>
<div data-field="transfer-progress" style="color:#ff6644;margin-top:4px;display:none"></div>
```

This contradicts the CSS class migration completed in iteration 4 for the rename dialog in the same file.

**Fix:**
1. Add CSS classes `.transfer-info` and `.transfer-progress` to the project's stylesheet (or reuse existing utility classes if appropriate).
2. Replace the inline styles with the CSS classes.
3. Verify the map view transfer info/progress elements still render correctly.

---

## 6. Tighten Playwright `testMatch` Pattern

**Problem:** `playwright.config.ts` line 8 uses `testMatch: '**/*.spec.{js,ts}'` to accept both `.js` and `.ts` spec files. Since all 40 specs were converted to `.ts` in iteration 5, the `.js` pattern is dead weight and could allow accidental `.js` specs to be introduced.

**Fix:** Change `testMatch` to `'**/*.spec.ts'`. This is a one-line change.

---

## 7. Coverage Overhaul

### 7.1 Problem

Coverage thresholds in `vite.config.ts` are aspirational and not enforced:

| Directory | Lines (actual) | Lines (threshold) | Status |
|-----------|---------------|-------------------|--------|
| `src/core/**` | 91.63% | 89% | Passing (+2.63% headroom) |
| `src/render/**` | 19.32% | 55% | **Failing** (-35.68%) |
| `src/ui/**` | 8.26% | 50% | **Failing** (-41.74%) |

The render and UI thresholds fail because the denominator includes PixiJS-heavy and DOM-heavy files (53 files at 0% line coverage) that cannot be meaningfully unit tested — they require a canvas/WebGL context or full browser DOM.

Additionally, `npm run test:unit` does not include `--coverage`, so these thresholds are never enforced in the normal workflow.

### 7.2 Approach

Three-part fix: exclude untestable files, add tests for testable modules, then set enforced thresholds.

### 7.3 Exclude Untestable Files

Add PixiJS-heavy and DOM-heavy files to the coverage `exclude` array. These are files at 0% line coverage where the logic is inherently tied to canvas rendering or DOM manipulation:

**Render layer (0% coverage, PixiJS-dependent):**
- `src/render/flight.ts` (barrel)
- `src/render/flight/_init.ts`
- `src/render/flight/_rocket.ts`
- `src/render/flight/_debris.ts`
- `src/render/hub.ts`
- `src/render/vab.ts`
- `src/render/transferObjects.ts`
- `src/render/index.ts`
- `src/render/types.ts` (type-only, no runtime logic)

**UI layer (0% coverage, DOM-dependent):**
- `src/ui/hub.ts`
- `src/ui/crewAdmin.ts`
- `src/ui/mainmenu.ts`
- `src/ui/help.ts`
- `src/ui/launchPad.ts`
- `src/ui/topbar.ts`
- `src/ui/settings.ts`
- `src/ui/perfDashboard.ts`
- `src/ui/satelliteOps.ts`
- `src/ui/trackingStation.ts`
- `src/ui/rdLab.ts`
- `src/ui/library.ts`
- `src/ui/autoSaveToast.ts`
- `src/ui/flightHud.ts`
- `src/ui/flightContextMenu.ts`
- `src/ui/flightController.ts` (barrel)
- `src/ui/flightController/_init.ts`
- `src/ui/flightController/_keyboard.ts`
- `src/ui/flightController/_menuActions.ts`
- `src/ui/flightController/_docking.ts`
- `src/ui/flightController/_orbitRcs.ts`
- `src/ui/flightController/_postFlight.ts`
- `src/ui/flightController/_surfaceActions.ts`
- `src/ui/flightController/_flightPhase.ts`
- `src/ui/missionControl.ts` (barrel)
- `src/ui/missionControl/_init.ts`
- `src/ui/missionControl/_shell.ts`
- `src/ui/missionControl/_missionsTab.ts`
- `src/ui/missionControl/_contractsTab.ts`
- `src/ui/missionControl/_challengesTab.ts`
- `src/ui/missionControl/_achievementsTab.ts`
- `src/ui/vab.ts` (barrel)
- `src/ui/vab/_init.ts`
- `src/ui/vab/_canvasInteraction.ts`
- `src/ui/vab/_panels.ts`
- `src/ui/vab/_partsPanel.ts`
- `src/ui/vab/_designLibrary.ts`
- `src/ui/vab/_engineerPanel.ts`
- `src/ui/vab/_launchFlow.ts`
- `src/ui/vab/_scalebar.ts`
- `src/ui/vab/_inventory.ts`
- `src/ui/debugSaves.ts` (already excluded)
- `src/ui/index.ts`

Note: Some files from the `vite.config.ts` comments were identified as having extractable pure logic (e.g., `_flightPhase.ts`, `_inventory.ts`). However, their current line coverage is 0% and the extractable logic is embedded in DOM-manipulating functions. If pure logic is later extracted into separate pure-function modules, those new modules should be included in coverage. For now, exclude the whole file if its coverage is 0%.

### 7.4 Add Unit Tests for Testable Render/UI Modules

The following render/UI files already have some unit test coverage but have room for improvement. Write new tests targeting the uncovered pure-logic code paths:

**Render layer (already partially tested):**
- `render/flight/_camera.ts` — 48.46% lines. Test: uncovered `worldToScreen` edge cases, `computeCoM` with varied inputs
- `render/flight/_ground.ts` — 52.20% lines. Test: terrain data generation logic for uncovered branches
- `render/flight/_sky.ts` — 82.46% lines. Test: uncovered sky rendering logic (lines 129-205)
- `render/flight/_trails.ts` — 8.94% lines. Test: trail point management, trail rendering calculations
- `render/flight/_asteroids.ts` — 16.47% lines. Test: asteroid rendering calculations
- `render/map.ts` — 20.55% lines. Test: orbit math helper functions (extract if needed)

**UI layer (already partially tested):**
- `ui/fpsMonitor.ts` — 69.85% lines. Test: uncovered recording/display logic
- `ui/vab/_staging.ts` — 18.54% lines. Test: `computeVabStageDeltaV()` pure physics math
- `ui/vab/_undoActions.ts` — 81.10% lines. Test: uncovered snapshot edge cases
- `ui/flightController/_loop.ts` — 40.89% lines. Test: loop tick logic, error recovery paths
- `ui/flightController/_mapView.ts` — 63.73% lines. Test: transfer calculation display logic
- `ui/flightController/_timeWarp.ts` — 90.47% lines. Test: uncovered threshold edge case (lines 73-77)
- `ui/flightController/_workerBridge.ts` — 72.66% lines. Test: uncovered message handling paths

**Goal:** After adding tests and excluding untestable files, coverage for the remaining testable render/UI files should be high enough to set meaningful thresholds.

### 7.5 Set Enforced Thresholds

After exclusions and new tests:

1. **Raise core thresholds** — current actual is 91.63% lines, 81.31% branches, 92.83% functions. Raise to: `lines: 91, branches: 81, functions: 92`.
2. **Set realistic render thresholds** — after excluding 0%-coverage files, recalculate actual coverage for the remaining testable files and set thresholds at or slightly below actual.
3. **Set realistic UI thresholds** — same approach as render.
4. Threshold values should be determined after the exclusions and new tests are in place (the task should measure and set).

### 7.6 Enforce Coverage in Test Command

Add `--coverage` to the `test:unit` npm script so thresholds are checked on every test run:

```json
"test:unit": "vitest run --coverage"
```

This means `npm run test:unit` will fail if coverage drops below thresholds, preventing silent regression.

---

## 8. Testing Strategy

All changes in this iteration must pass the existing test suite. New tests are added only where specified (section 4.3 test factory migration, section 7.4 coverage tests).

**Verification commands:**
- `npm run typecheck` — no errors (source + E2E)
- `npm run lint` — 0 warnings, 0 errors (after section 3 cleanup)
- `npm run test:unit` — all tests pass with coverage thresholds met (after section 7.6)
- `npm run test:e2e` — all E2E specs pass
- `npm run build` — production build succeeds

**Specific verification per section:**
1. **saveload bug:** `npx vitest run src/tests/saveload.test.ts` — KIA/living crew tests validate correct `AstronautStatus.KIA` behavior
2. **test-map:** `node scripts/generate-test-map.mjs` runs without error; `node scripts/run-affected.mjs --dry-run` resolves all test file paths
3. **lint:** `npm run lint` reports 0 warnings
4. **factories:** `as unknown as` count in `src/tests/` drops below 50; count in `e2e/` drops below 100
5. **inline styles:** Visual check that map transfer info/progress elements render correctly
6. **Playwright config:** `npx playwright test --list` lists all 40 specs
7. **coverage:** `npm run test:unit` passes (includes `--coverage` enforcement)
