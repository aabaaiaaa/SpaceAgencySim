# Iteration 7 — Tasks

See `.devloop/requirements.md` for full context and rationale behind each task.

---

### TASK-001: Fix saveload.test.ts CrewStatus mock data
- **Status**: done
- **Dependencies**: none
- **Description**: Replace incorrect `CrewStatus.IDLE` and `CrewStatus.ON_MISSION` values with correct `AstronautStatus.ACTIVE` (or appropriate `AstronautStatus` values) in crew mock data at lines 134, 143, 241, 1111, 1183, 1215, 1324 of `src/tests/saveload.test.ts`. Import `AstronautStatus` from `gameState.ts` if not already imported. Where possible, use the `makeCrewMember()` factory. See requirements section 1.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` — all tests pass. Grep for `CrewStatus.IDLE` and `CrewStatus.ON_MISSION` in `src/tests/saveload.test.ts` — zero matches in crew `status` fields.

### TASK-002: Extract computeVabStageDeltaV to core/stagingCalc.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/core/stagingCalc.ts` with the `computeStageDeltaV()` function extracted from `src/ui/vab/_staging.ts` (lines 69-131). The function should accept explicit parameters (`stageIndex`, `assembly`, `stagingConfig`, `dvAltitude`) instead of reading global VAB state. Export the result type as `StageDeltaVResult`. Update `_staging.ts` to import and call the new function, passing state from `getVabState()`. Remove the old private function. See requirements section 2.
- **Verification**: `npm run typecheck` — no errors. `npx vitest run src/tests/ui-vabStaging.test.ts` — existing integration tests still pass.

### TASK-003: Add unit tests for stagingCalc.ts
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: Create `src/tests/stagingCalc.test.ts` with direct unit tests for `computeStageDeltaV()`. Test cases: single engine with fuel (known delta-v), TWR at sea level and altitude, multi-engine thrust-weighted Isp averaging, jettison behavior (previous stage parts excluded), no-engine stage (returns `{ dv: 0, engines: false }`), zero fuel (dv = 0), high altitude (near-vacuum Isp). Use real types — no `as unknown as` casts. Tag 1-2 representative tests with `@smoke`. See requirements section 2.
- **Verification**: `npx vitest run src/tests/stagingCalc.test.ts` — all tests pass with zero `as unknown as` casts in the file.

### TASK-004: Audit cast types and extend _factories.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Scan all 23 unit test files with `as unknown as` casts. For each cast, identify the target type. For any type with 3+ occurrences across files that doesn't already have a factory in `src/tests/_factories.ts`, add a new factory function following the existing pattern (real types, `Partial<T>` overrides, sensible defaults, no `any`). Likely candidates: Worker/MessagePort mocks, pool object shapes. Document in a code comment at the top of the file which types each factory covers. See requirements section 3.
- **Verification**: `npm run typecheck` — no errors. New factories compile cleanly and return properly typed objects.

### TASK-005: Migrate branchCoverage.test.ts to factories and @ts-expect-error
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Migrate the 44 `as unknown as` casts in `src/tests/branchCoverage.test.ts`. For casts that construct valid partial objects, use the appropriate factory. For casts that deliberately pass invalid/malformed data to test error paths, replace `as unknown as T` with `// @ts-expect-error` on the preceding line. See requirements section 4, "branchCoverage" row.
- **Verification**: `npx vitest run src/tests/branchCoverage.test.ts` — all tests pass. Cast count in this file should drop to under 5.

### TASK-006: Migrate saveload.test.ts remaining casts to factories
- **Status**: done
- **Dependencies**: TASK-001, TASK-004
- **Description**: Migrate the remaining `as unknown as` casts in `src/tests/saveload.test.ts` (after TASK-001 fixes the CrewStatus values). Use `makeGameState()`, `makeCrewMember()`, `makeMissionInstance()` and other factories for complex nested state objects. For any casts testing intentionally invalid data, use `@ts-expect-error`. See requirements section 4, "saveload" row.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` — all tests pass. Cast count in this file should drop to under 5.

### TASK-007: Migrate render-sky.test.ts and render-ground.test.ts to factories
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Migrate the 25 casts in `render-sky.test.ts` and 21 casts in `render-ground.test.ts`. Both files cast to PixiJS Graphics-like shapes — use `makeGraphics()` from `_factories.ts`. Replace each `as unknown as Graphics` (or similar) with the factory call, passing any needed overrides. See requirements section 4.
- **Verification**: `npx vitest run src/tests/render-sky.test.ts src/tests/render-ground.test.ts` — all tests pass. Combined cast count across both files should drop to under 5.

### TASK-008: Migrate collision.test.ts to factories
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Migrate the 21 `as unknown as` casts in `src/tests/collision.test.ts`. These are primarily PhysicsState shapes — use `makePhysicsState()` with appropriate overrides for each test case. See requirements section 4.
- **Verification**: `npx vitest run src/tests/collision.test.ts` — all tests pass. Cast count should drop to under 3.

### TASK-009: Migrate ui-rocketCardUtil.test.ts to factories
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Migrate the 18 `as unknown as` casts in `src/tests/ui-rocketCardUtil.test.ts`. These are primarily DOM element mocks — use `makeMockElement()` from `_factories.ts`. See requirements section 4.
- **Verification**: `npx vitest run src/tests/ui-rocketCardUtil.test.ts` — all tests pass. Cast count should drop to under 3.

### TASK-010: Migrate medium-cast unit tests batch 1 (sciencemodule, pool, fuelsystem)
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Migrate casts in `sciencemodule.test.ts` (8 casts), `pool.test.ts` (8 casts), and `fuelsystem.test.ts` (7 casts). Use existing factories (`makePhysicsState`, `makeGameState`, etc.) or new factories from TASK-004 as appropriate. See requirements section 4, medium-cast table.
- **Verification**: `npx vitest run src/tests/sciencemodule.test.ts src/tests/pool.test.ts src/tests/fuelsystem.test.ts` — all tests pass. Combined cast count across 3 files should drop to under 5.

### TASK-011: Migrate medium-cast unit tests batch 2 (workerBridge, mapView, escapeHtml, controlMode)
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Migrate casts in `workerBridgeTimeout.test.ts` (6 casts), `ui-mapView.test.ts` (6 casts), `escapeHtml.test.ts` (4 casts), and `controlMode.test.ts` (4 casts). Use existing or new factories as appropriate. See requirements section 4, medium-cast table.
- **Verification**: `npx vitest run src/tests/workerBridgeTimeout.test.ts src/tests/ui-mapView.test.ts src/tests/escapeHtml.test.ts src/tests/controlMode.test.ts` — all tests pass. Combined cast count across 4 files should drop to under 4.

### TASK-012: Migrate low-cast unit test files (9 files, 13 casts total)
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Migrate remaining casts in: `ui-escapeHtml.test.ts` (3), `loopErrorHandling.test.ts` (3), `mccTiers.test.ts` (2), `contracts.test.ts` (2), `render-input.test.ts` (1), `render-flight-pool.test.ts` (1), `render-camera.test.ts` (1), `perfMonitor.test.ts` (1), `challenges.test.ts` (1). Use existing factories. See requirements section 4, low-cast table.
- **Verification**: `npx vitest run src/tests/ui-escapeHtml.test.ts src/tests/loopErrorHandling.test.ts src/tests/mccTiers.test.ts src/tests/contracts.test.ts src/tests/render-input.test.ts src/tests/render-flight-pool.test.ts src/tests/render-camera.test.ts src/tests/perfMonitor.test.ts src/tests/challenges.test.ts` — all tests pass. Combined cast count across 9 files should be 0.

### TASK-013: E2E migration — asteroid-belt.spec.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Migrate the 38 `as unknown as` casts in `e2e/asteroid-belt.spec.ts` to use the `gw()` helper from `e2e/helpers/_gameWindow.ts`. Replace all `(window as unknown as GW).prop` or `(window as unknown as { ... }).prop` patterns with `gw().prop` inside `page.evaluate()` callbacks. Remove the local `GW` interface if it becomes unused. If any globals are missing from `e2e/window.d.ts`, add them. See requirements section 5.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.ts` — all tests pass. `grep -c "as unknown as" e2e/asteroid-belt.spec.ts` returns 0.

### TASK-014: E2E migration — mission-progression and facilities-infrastructure specs
- **Status**: done
- **Dependencies**: none
- **Description**: Migrate casts in `e2e/mission-progression.spec.ts` (15 casts) and `e2e/facilities-infrastructure.spec.ts` (15 casts) to use `gw()`. Same pattern as TASK-013. See requirements section 5.
- **Verification**: `npx playwright test e2e/mission-progression.spec.ts e2e/facilities-infrastructure.spec.ts` — all tests pass. Combined cast count across both files is 0.

### TASK-015: E2E migration — orbital-operations, collision, tutorial-revisions specs
- **Status**: done
- **Dependencies**: none
- **Description**: Migrate casts in `e2e/orbital-operations.spec.ts` (10 casts), `e2e/collision.spec.ts` (7 casts), and `e2e/tutorial-revisions.spec.ts` (6 casts) to use `gw()`. Same pattern as TASK-013. See requirements section 5.
- **Verification**: `npx playwright test e2e/orbital-operations.spec.ts e2e/collision.spec.ts e2e/tutorial-revisions.spec.ts` — all tests pass. Combined cast count across 3 files is 0.

### TASK-016: E2E migration — remaining 12 low-cast spec files
- **Status**: pending
- **Dependencies**: none
- **Description**: Migrate casts in the remaining 12 spec files: `test-infrastructure.spec.ts` (4), `sandbox-replayability.spec.ts` (4), `destinations.spec.ts` (3), `agency-depth.spec.ts` (3), `scene-cleanup.spec.ts` (2), `missions.spec.ts` (2), `context-menu.spec.ts` (2), `additional-systems.spec.ts` (2), `reliability-risk.spec.ts` (1), `launchpad.spec.ts` (1), `launchpad-relaunch.spec.ts` (1), `core-mechanics.spec.ts` (1). Use `gw()` for all window casts. See requirements section 5.
- **Verification**: Run each spec individually: `npx playwright test e2e/<filename>` for each of the 12 files. Combined cast count across all 12 files is 0.

### TASK-017: Update test-map.json for new stagingCalc module
- **Status**: pending
- **Dependencies**: TASK-002, TASK-003
- **Description**: Run `node scripts/generate-test-map.mjs` to regenerate `test-map.json` so it includes the new `src/core/stagingCalc.ts` module and its test file `src/tests/stagingCalc.test.ts`. Verify the new module appears in the appropriate area mapping.
- **Verification**: `node scripts/generate-test-map.mjs` runs without error. `node scripts/run-affected.mjs --dry-run` resolves all paths. The `core/stagingCalc` or equivalent area appears in `test-map.json`.

### TASK-018: Final verification pass
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017
- **Description**: Run all global verification commands and confirm cast count targets are met. See requirements section 6.
- **Verification**: All of the following pass:
  - `npm run typecheck` — no errors
  - `npm run lint` — 0 warnings, 0 errors
  - `npm run test:unit` — all tests pass, coverage thresholds met
  - `npm run build` — production build succeeds
  - Unit test `as unknown as` count under 30: `grep -r "as unknown as" src/tests/ --include="*.ts" -c` (sum of counts)
  - E2E `as unknown as` count under 10: `grep -r "as unknown as" e2e/ --include="*.ts" -c` (sum of counts, excluding helpers/)
