# Iteration 7 — Cast Elimination, Factory Adoption & Staging Extraction

This iteration completes the test infrastructure work started in iteration 6: eliminating `as unknown as` casts across all test files, fixing incorrect mock data, and extracting one piece of pure logic from the UI layer. There is no new feature work and no bundle-size changes — this is purely a test quality and code extraction iteration.

The codebase enters this iteration with 289 `as unknown as` casts in unit tests (23 files) and 131 in E2E specs (18 files). The goal is to reduce both counts as close to zero as practical, using typed factory functions, the `gw()` GameWindow helper, and `@ts-expect-error` for intentionally invalid test data.

---

## 1. Fix `saveload.test.ts` CrewStatus Mock Data

**Problem:** The iteration 6 review identified that `saveload.test.ts` still uses `CrewStatus.IDLE` and `CrewStatus.ON_MISSION` when constructing crew member mock data, even though `CrewMember.status` is typed as `AstronautStatus`. The `as unknown as` casts mask this type mismatch. This means the round-trip serialization tests don't actually validate correct `AstronautStatus` handling.

**Affected locations:** Lines 134, 143, 241, 1111, 1183, 1215, 1324 — all places where crew mock objects are constructed with `CrewStatus` enum values for the `status` field.

**Fix:**
1. Replace `CrewStatus.IDLE` with `AstronautStatus.ACTIVE` at all affected locations.
2. Replace `CrewStatus.ON_MISSION` with `AstronautStatus.ACTIVE` (or another appropriate `AstronautStatus` value if the test context demands it).
3. Import `AstronautStatus` from `gameState.ts` if not already imported.
4. Where possible, use the `makeCrewMember()` factory from `_factories.ts` instead of hand-rolled objects.
5. Verify the round-trip tests still pass — the serialization doesn't validate enum values, so the tests should pass with correct values too.

This is a correctness fix for test data, not a production code change.

---

## 2. Extract `computeVabStageDeltaV()` to a Pure Core Module

**Problem:** `computeVabStageDeltaV()` in `src/ui/vab/_staging.ts` (lines 69-131) is a 62-line pure physics calculation that computes delta-v and thrust-to-weight ratio for a rocket stage. Despite being pure math with zero DOM or PixiJS access, it's private to the UI module and only testable through integration tests via `renderStagingPanel()`. This limits test coverage and violates the architecture rule that physics logic belongs in `src/core/`.

**Analysis:** The function accesses global VAB state via `getVabState()` to get its inputs (assembly, stagingConfig, dvAltitude). It calls `getPartById()` (pure lookup) and `airDensity()` (pure calculation). All operations are mathematical — logarithms, thrust weighting, mass accounting. The only coupling is the implicit state access, which is easily replaced with explicit parameters.

**Implementation:**

1. Create `src/core/stagingCalc.ts` with the extracted function:
   - Rename to `computeStageDeltaV()` (drop the "Vab" prefix since it's now in core)
   - Accept explicit parameters: `stageIndex`, `assembly` (RocketAssembly), `stagingConfig` (StagingConfig), `dvAltitude` (number)
   - Return `{ dv: number; twr?: number; engines: boolean }`
   - Import `getPartById` from the parts data module and `airDensity`/`SEA_LEVEL_DENSITY` from physics
   - Export the result type as `StageDeltaVResult`

2. Update `src/ui/vab/_staging.ts`:
   - Import `computeStageDeltaV` from `src/core/stagingCalc.ts`
   - Replace the private `computeVabStageDeltaV(stageIdx)` with a call to `computeStageDeltaV(stageIdx, S.assembly, S.stagingConfig, S.dvAltitude)` where `S = getVabState()`
   - Remove the old private function

3. Add direct unit tests in `src/tests/stagingCalc.test.ts`:
   - Test delta-v calculation with known inputs (single engine, single fuel tank, known Isp)
   - Test TWR calculation at sea level and at altitude
   - Test multi-engine stages with different Isp values (thrust-weighted average)
   - Test jettison behavior (parts from previous stages excluded from mass)
   - Test edge cases: no engines (returns `{ dv: 0, engines: false }`), zero fuel (dv = 0), very high altitude (near-vacuum Isp)
   - All tests use real types — no `as unknown as` casts

4. Verify existing `ui-vabStaging.test.ts` integration tests still pass — they exercise the same code path through the UI layer.

---

## 3. Audit and Extend Unit Test Factories

**Problem:** The 8 factory functions in `src/tests/_factories.ts` cover the most common cast types (PhysicsState, GameState, MissionInstance, FlightState, Graphics, RecoveryPS, CrewMember, MockElement), but some test files cast to types that don't have factories. Before migrating all files, we need to identify gaps and fill them.

**Approach:**

1. Scan each of the 23 files with `as unknown as` casts to identify what types are being cast to.
2. For any type with 3+ casts across files, add a factory function to `_factories.ts`.
3. Likely new factories based on preliminary analysis:
   - Worker/MessagePort mocks (for `workerBridgeTimeout.test.ts`, `ui-mapView.test.ts`)
   - Pool object mocks (for `pool.test.ts`)
   - Any other recurring mock shapes discovered during the audit
4. Each new factory follows the same pattern: real types, `Partial<T>` overrides, sensible defaults, no `any`.

---

## 4. Unit Test Factory Migration — All Files

**Goal:** Reduce unit test `as unknown as` count from 289 to under 30.

The 23 files with casts are listed below with their counts and the migration strategy for each:

### High-cast files (20+ casts each)

| File | Casts | Strategy |
|------|------:|----------|
| `branchCoverage.test.ts` | 44 | Special case — many casts are for deliberately invalid/partial objects to test edge cases. Convert appropriate ones to `@ts-expect-error` (for intentionally wrong types) or factories (for valid shapes). Some casts may remain where the test is explicitly testing behavior with malformed input. |
| `saveload.test.ts` | 36 | Use `makeGameState()`, `makeCrewMember()`, and `makeMissionInstance()` factories. Fix CrewStatus values (section 1). Many casts are for complex nested state objects that can be built from factories with overrides. |
| `render-sky.test.ts` | 25 | Use `makeGraphics()` for PixiJS mock objects. All casts are for Graphics-like shapes. |
| `render-ground.test.ts` | 21 | Same as render-sky — `makeGraphics()` for all PixiJS mocks. |
| `collision.test.ts` | 21 | Use `makePhysicsState()` for all physics state mocks. |
| `ui-rocketCardUtil.test.ts` | 18 | Use `makeMockElement()` for DOM element mocks. |

### Medium-cast files (4-8 casts each)

| File | Casts | Strategy |
|------|------:|----------|
| `sciencemodule.test.ts` | 8 | Likely PhysicsState/GameState — use existing factories |
| `pool.test.ts` | 8 | May need a pool-specific mock factory or use existing factories for pooled objects |
| `fuelsystem.test.ts` | 7 | Likely PhysicsState — use `makePhysicsState()` |
| `workerBridgeTimeout.test.ts` | 6 | Worker/MessagePort mocks — may need new factory from section 3 |
| `ui-mapView.test.ts` | 6 | Mixed — likely state + DOM mocks |
| `escapeHtml.test.ts` | 4 | Likely DOM-related — use `makeMockElement()` |
| `controlMode.test.ts` | 4 | Likely state mocks — use existing factories |

### Low-cast files (1-3 casts each)

| File | Casts | Strategy |
|------|------:|----------|
| `ui-escapeHtml.test.ts` | 3 | DOM mocks |
| `loopErrorHandling.test.ts` | 3 | State mocks |
| `mccTiers.test.ts` | 2 | State mocks |
| `contracts.test.ts` | 2 | State/mission mocks |
| `render-input.test.ts` | 1 | Graphics mock |
| `render-flight-pool.test.ts` | 1 | Graphics mock |
| `render-camera.test.ts` | 1 | State mock |
| `perfMonitor.test.ts` | 1 | DOM or state mock |
| `challenges.test.ts` | 1 | State mock |

### Migration rules

- Replace `as unknown as T` with the appropriate factory call (e.g., `makePhysicsState({ posX: 100 })`)
- For intentionally invalid test data (testing error paths with wrong types), replace `as unknown as T` with `@ts-expect-error` on the preceding line — this documents the intentional type violation and will flag if the type ever changes to accept the value
- Do NOT change test logic or assertions — only replace how mock objects are constructed
- If a cast doesn't fit any factory and isn't worth creating a factory for (one-off shapes), leave it but document why with a comment
- After migration, each file should have zero or near-zero `as unknown as` casts

---

## 5. E2E GameWindow Migration — All Remaining Specs

**Goal:** Reduce E2E `as unknown as` count from 131 to under 10.

The infrastructure is already in place from iteration 6:
- `e2e/window.d.ts` augments `Window` with 30+ typed game globals
- `e2e/helpers/_gameWindow.ts` exports `gw()` which returns `window` typed as `GameWindow`
- 22 of 40 spec files are already migrated

The 18 remaining files all follow the same pattern: they define a local `interface GW { ... }` or inline `(window as unknown as { prop: type })` casts inside `page.evaluate()` callbacks. The migration pattern is:

1. Import `gw` from the helpers (or use the existing import if the file already imports from helpers)
2. Replace `(window as unknown as GW).prop` or `(window as unknown as { prop: Type }).prop` with `gw().prop`
3. Remove the local `GW` interface declaration if it becomes unused
4. If any game global accessed by the spec is NOT declared in `e2e/window.d.ts`, add it there before migrating

### Files to migrate

| File | Casts | Notes |
|------|------:|-------|
| `asteroid-belt.spec.ts` | 38 | Largest — likely accesses many different globals |
| `mission-progression.spec.ts` | 15 | |
| `facilities-infrastructure.spec.ts` | 15 | |
| `orbital-operations.spec.ts` | 10 | |
| `collision.spec.ts` | 7 | |
| `tutorial-revisions.spec.ts` | 6 | |
| `test-infrastructure.spec.ts` | 4 | |
| `sandbox-replayability.spec.ts` | 4 | |
| `destinations.spec.ts` | 3 | |
| `agency-depth.spec.ts` | 3 | |
| `scene-cleanup.spec.ts` | 2 | |
| `missions.spec.ts` | 2 | |
| `context-menu.spec.ts` | 2 | |
| `additional-systems.spec.ts` | 2 | |
| `reliability-risk.spec.ts` | 1 | |
| `launchpad.spec.ts` | 1 | |
| `launchpad-relaunch.spec.ts` | 1 | |
| `core-mechanics.spec.ts` | 1 | |

### Migration rules

- Use `gw()` for all window global access inside `page.evaluate()` callbacks
- If a spec accesses a global not in `window.d.ts`, add the declaration there first
- Do NOT change test logic, assertions, or flow — only replace the cast pattern
- Remove unused local `GW`/`GameWindow` interface declarations after migration
- Verify each migrated spec still passes by running it individually

---

## 6. Verification Strategy

All changes must pass the existing test suite. The iteration adds new tests only for the extracted `stagingCalc` module (section 2).

**Global verification commands:**
- `npm run typecheck` — no errors
- `npm run lint` — 0 warnings, 0 errors
- `npm run test:unit` — all tests pass, coverage thresholds met
- `npm run build` — production build succeeds

**Per-section verification:**
1. **saveload mock fix:** `npx vitest run src/tests/saveload.test.ts` — all tests pass with correct AstronautStatus values
2. **staging extraction:** `npx vitest run src/tests/stagingCalc.test.ts src/tests/ui-vabStaging.test.ts` — new direct tests pass, existing integration tests unaffected
3. **factory audit:** `npm run typecheck` — new factories compile cleanly
4. **unit test migration:** Per-file verification with `npx vitest run src/tests/<file>`. Final count: `grep -r "as unknown as" src/tests/ --include="*.ts" | wc -l` should be under 30
5. **E2E migration:** Per-file verification with `npx playwright test e2e/<file>`. Final count: `grep -r "as unknown as" e2e/ --include="*.ts" | wc -l` should be under 10
6. **Final:** Full `npm run test:unit` and `npm run typecheck` pass

---

## 7. What This Iteration Does NOT Include

- **No bundle splitting / code splitting** — the 960 KB main chunk warning is acknowledged but deferred
- **No new game features** — strictly test quality and one code extraction
- **No production code changes** beyond the `stagingCalc` extraction and the `_staging.ts` refactor to call it
- **No coverage threshold changes** — existing thresholds from iteration 6 remain as-is (the new `stagingCalc.ts` module will be covered by its new tests and should meet core thresholds automatically)
