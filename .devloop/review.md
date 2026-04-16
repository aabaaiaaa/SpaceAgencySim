# Iteration 17 — Code Review Report

**Date:** 2026-04-16
**Reviewer:** Claude Code (automated)
**Scope:** Flaky test fix, collision.ts defensive guards, IDB-unavailable startup error, debug log suppression, smoke tag additions, preview layout extraction

---

## Build & Test Health

| Check | Result |
|-------|--------|
| `npm run build` | Pass (587ms, 0 errors, 0 warnings) |
| `npm run typecheck` | Pass (0 errors) |
| `npm run lint` | Pass (0 errors) |
| Unit tests | 120 files, 4,561 tests, all passing |
| Coverage thresholds | All passing (no threshold failures) |

### Coverage Summary

| Metric | Value |
|--------|-------|
| Statements | 89.89% |
| Branches | 78.23% |
| Functions | 92.47% |
| Lines | 92.74% |

Coverage thresholds (which were the critical failing issue from iteration 16) now all pass cleanly.

---

## Requirements vs Implementation

### All 13 Tasks Complete

Every task in the iteration 17 plan has been implemented:

| Req Section | Task(s) | Status | Notes |
|-------------|---------|--------|-------|
| 1. Flaky workerBridgeTimeout fix | TASK-001 | Done | `vi.resetModules()` in both `describe` blocks' `beforeEach`; 18 tests pass in 53ms |
| 2. Collision.ts defensive guard | TASK-002, TASK-003 | Done | Early-return guard at `collision.ts:457`; 2 unit tests for zero-mass |
| 3. IDB-unavailable startup error | TASK-004, TASK-005, TASK-006 | Done | `showFatalError()` helper, IDB check before `initSettings()`, `main().catch()` improved, 3 tests in `mainStartup.test.ts` |
| 4. Suppress debug log spam | TASK-007, TASK-008 | Done | `logger.setLevel('warn')` in `saveload.test.ts`, `autoSave.test.ts`, `storageErrors.test.ts`, `debugMode.test.ts` |
| 5. Smoke tags for IDB tests | TASK-009, TASK-010 | Done | 10 smoke-tagged tests across 4 IDB test files |
| 6. Preview scaling extraction | TASK-011, TASK-012 | Done | `previewLayout.ts` extracted, 5 unit tests including edge cases |
| Final verification | TASK-013 | Done | Build, typecheck, lint, test:unit, test:smoke:unit all pass |

### No Scope Creep

All changes are scoped to the six areas defined in the requirements. No additional features were introduced.

### Gaps

1. **`test-map.json` not updated for new files.** Three new test/source files were created in this iteration but are not mapped in `test-map.json`:
   - `src/core/previewLayout.ts` → `src/tests/previewLayout.test.ts` (no entry)
   - `src/main.ts` → `src/tests/mainStartup.test.ts` (no entry)
   - `src/ui/notification.ts` → `src/tests/notification.test.ts` (no entry, from iteration 16)

   This means `scripts/run-affected.mjs` won't discover these tests when the corresponding source files are modified. The iteration 17 TASK-010 specifically said to "review `test-map.json` and ensure mappings... are correct" but only checked the four IDB-related entries; the three new files above were missed.

2. **Collision guard covers mass but not moment of inertia.** The early-return guard at `collision.ts:457` checks `a.mass` and `b.mass` but the function also divides by `Ia` and `Ib` (moment of inertia) at lines 533 and 537. These are protected upstream by `_bodyMoI()` returning `Math.max(1, I)` at line 238, so they are currently safe. However, the requirements noted divisions at "Lines 530, 534: `torqueA * dt / Ia` and `torqueB * dt / Ib`" as part of the problem — and only the mass guard was added, not an `Ia`/`Ib` guard. This is consistent with the requirements' proposed fix (`if (!a.mass || a.mass <= 0 || !b.mass || b.mass <= 0) return;`) but leaves the MoI divisions relying solely on the upstream guarantee, just as before.

   **Severity:** Very low. `_bodyMoI` has its own early return (`if (totalMass <= 0) return 1;`) and a final `Math.max(1, I)`, making it doubly protected. The mass guard is the higher-value protection.

---

## Code Quality

### 1. Flaky Test Fix — Correct and Thorough

`workerBridgeTimeout.test.ts` now has `vi.resetModules()` in `beforeEach` for both `describe` blocks (lines 98 and 424). This ensures each test gets a fresh module instance from the dynamic `import()` call, eliminating the state contention that caused the intermittent 5000ms timeout.

The test now passes in 53ms (total for 18 tests) both in isolation and alongside other test files. The fix addresses the root cause (shared module cache) rather than masking the symptom (increasing timeout).

### 2. Collision Guard — Correct Pattern

`collision.ts:457`:
```typescript
if (!a.mass || a.mass <= 0 || !b.mass || b.mass <= 0) return;
```

This matches the defensive pattern used at four locations in `physics.ts` (lines 1023, 1081, 1127, 1463). The guard covers both falsy values (`null`, `undefined`, `0`) and negative mass, making `_resolveCollision` self-protecting for its mass-dependent divisions.

The two unit tests (`collision.test.ts:453-513`) verify:
- Normal collision with minimal-mass bodies produces finite values (no NaN/Infinity)
- Bodies with unresolvable activeParts (no valid AABB overlap) don't crash and don't modify state

### 3. IDB-Unavailable Startup Error — Well Implemented

**`showFatalError()` in `main.ts:68-78`:**
- Creates a fixed, full-screen overlay with styled text
- Uses `textContent` (not `innerHTML`) — XSS-safe
- Exported for both internal use and testing
- Consistent dark styling matching the game's aesthetic

**IDB check at `main.ts:86-93`:**
- Calls `isIdbAvailable()` before `initSettings()`
- Displays a clear, non-technical error message
- Returns early, preventing any further initialization

**Generic catch handler at `main.ts:258-261`:**
- Now calls `showFatalError()` instead of only `logger.error()`
- User sees a visible error ("Something went wrong...") instead of a blank page

**Tests (`mainStartup.test.ts`):**
- 3 well-structured tests with thorough mocking of all `main.ts` dependencies
- Uses `vi.hoisted()` to survive `vi.resetModules()` — correct pattern
- Verifies both the IDB-unavailable path (error shown, `initSettings` not called) and the happy path (no error, `initSettings` called)
- Tests the `showFatalError()` function directly (styling, textContent, DOM attachment)

**Minor note:** The DOM stubs in `mainStartup.test.ts` replace `globalThis.document` entirely rather than patching individual methods. This works but is fragile if `main.ts` ever accesses other `document` properties during startup. The test correctly restores originals in `afterEach`.

### 4. Debug Log Suppression — Correct

All four target test files now suppress debug output:
- `saveload.test.ts:85-91` — `beforeAll`/`afterAll` with level save/restore
- `autoSave.test.ts:58-64` — same pattern
- `storageErrors.test.ts:59-65` — same pattern
- `debugMode.test.ts:42-48` — same pattern

Verified: `npx vitest run src/tests/saveload.test.ts 2>&1 | grep -c "\[DEBUG\]"` returns 0.

The pattern correctly saves the original log level in `beforeAll` and restores it in `afterAll`, preventing interference with other tests that might check logger behavior.

### 5. Smoke Tags — Correct and Well-Chosen

10 smoke-tagged tests found across the 4 IDB test files:

| File | Smoke Tests | What They Cover |
|------|-------------|----------------|
| `saveload.test.ts` | 2 | Compressed save/load cycle, `listSaves` IDB key scanning |
| `autoSave.test.ts` | 5 | Auto-save to empty slot, IDB failure, deep clone, fallback key, slot reuse |
| `settingsStore.test.ts` | 2 | Settings save/load round-trip, legacy settings extraction |
| `idbStorage.test.ts` | 1 | `idbSet` → `idbGet` round-trip |

The autoSave tests are particularly well-chosen — they exercise 5 critical code paths including the error path and the slot-selection algorithm.

### 6. Preview Layout Extraction — Clean and Well-Tested

**`previewLayout.ts` (79 lines):**
- Clean interfaces: `PartRect`, `PreviewDimensions`, `PreviewLayout`
- Returns `null` for empty input — safe API
- Uses `Math.max(rocketW, 1)` and `Math.max(rocketH, 1)` to prevent division by zero — handles degenerate cases (vertical line, horizontal line) correctly
- Returns `midX`/`midY` alongside `scale`/`offsetX`/`offsetY` so the UI module has everything it needs without recalculating
- Good JSDoc with usage example

**`rocketCardUtil.ts` integration:**
- Properly imports `computePreviewLayout` and `PartRect` type
- Builds `rects` array from part definitions, passes to `computePreviewLayout`
- Uses destructured result for canvas drawing — clean separation of concerns

**`previewLayout.test.ts` (5 tests):**
- Empty array → null
- Multiple parts with known geometry → exact scale/offset verification
- Single part → correct centering
- Vertical line (rocketW = 0) → finite scale, no division by zero
- Horizontal line (rocketH = 0) → same check

The edge case tests (vertical/horizontal line) directly verify the `Math.max(rocketW, 1)` guard that prevents division by zero.

---

## Testing

### Test Suite Summary

| Test Type | Files | Tests | Status |
|-----------|-------|-------|--------|
| Unit | 120 | 4,561 | All passing |
| Smoke (unit) | 10+ files | ~110 | All passing |

### New Tests Added in Iteration 17

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `collision.test.ts` (additions) | 2 | Zero-mass collision guard (finite values, unresolvable parts) |
| `mainStartup.test.ts` (new) | 3 | IDB-unavailable startup path, happy path, `showFatalError` helper |
| `previewLayout.test.ts` (new) | 5 | Bounding-box math, scale computation, edge cases |

### Smoke Tag Coverage

Verified with `npx vitest run --testNamePattern "@smoke"` across the 4 IDB test files: **10 tests pass**, including the pre-existing smoke test in `saveload.test.ts`. This provides fast CI feedback for the core persistence path.

### Untested Edge Cases

1. **`showFatalError` with XSS-like content.** While `textContent` is used (which is safe), there's no test verifying that HTML-like error messages aren't rendered as HTML. Low risk since `textContent` is inherently safe.

2. **Multiple `showFatalError` calls.** If both the IDB check and the generic catch handler fire, two error overlays will be appended. This is unlikely (the IDB check returns early), but there's no deduplication. Very low severity.

3. **Concurrent test runners and workerBridge.** The flaky test fix addresses Vitest's parallel worker pool, but there's no test simulating high-concurrency scenarios (e.g., `Promise.all` of multiple `initPhysicsWorker` calls). The fix is correct for the reported symptom.

4. **`_repositionToasts` with zero-height toasts.** `notification.ts:20` reads `_activeToasts[i].offsetHeight`. In a test environment with JSDOM, `offsetHeight` returns 0. The 7 notification tests pass because the stacking logic still works (0 + TOAST_GAP = 8px gap), but the positioning won't match real browser behavior. Not a bug, but worth noting if notification positioning is ever visually verified.

---

## Recommendations

### Should Fix Soon

1. **Update `test-map.json` for new files.** Add entries for:
   - `src/core/previewLayout.ts` → `src/tests/previewLayout.test.ts`
   - `src/main.ts` → `src/tests/mainStartup.test.ts`
   - `src/ui/notification.ts` → `src/tests/notification.test.ts`

   Without these entries, `scripts/run-affected.mjs` won't run the relevant tests when these source files are modified, defeating the purpose of the affected-test infrastructure.

### Low Priority

2. **Add `@smoke` tag to `mainStartup.test.ts`.** The IDB startup check is a critical path — if it breaks, the game won't load. Adding `@smoke` to the "shows fatal error when IDB is unavailable" test would catch this in fast CI runs.

3. **Add `@smoke` tag to `previewLayout.test.ts`.** The "computes scale that fits multiple parts within preview bounds" test exercises the most common code path and would be a good smoke candidate.

4. **Consider a guard for `Ia`/`Ib` in `_resolveCollision`.** While `_bodyMoI()` guarantees `>= 1`, adding `if (Ia <= 0) return;` / `if (Ib <= 0) return;` before the divisions at lines 533 and 537 would make the angular impulse code self-protecting, fully consistent with the mass guard pattern. Very low severity since `_bodyMoI` is doubly guarded.

---

## Future Considerations

### Features & Improvements

1. **Global test logger configuration.** Four test files now independently set `logger.setLevel('warn')`. As the test suite grows, this pattern will need to be replicated in every new file that exercises save/load paths. Consider a Vitest setup file (`vitest.setup.ts`) that sets logger to `'warn'` globally for all tests, with individual tests opting into `'debug'` when they specifically test logger behavior. This would be a single-point fix that prevents log spam from new tests automatically.

2. **`test-map.json` auto-generation.** The map requires manual updates (already missed 3 files this iteration). The comment at the top says "Auto-generated by `scripts/generate-test-map.mjs`" — if this script exists, it should be run as part of the development workflow (or as a pre-commit hook) to keep mappings current. If it doesn't fully auto-generate, consider making it do so by scanning import graphs.

3. **Continue pure helper extraction.** With `previewLayout.ts` done, the three extraction candidates from the iteration 16 review are now complete:
   - `stagingCalc.ts` — done (prior iteration)
   - `mapGeometry.ts` / `mapView.ts` — done (prior iteration)
   - `previewLayout.ts` — done (this iteration)

   The next extraction candidates (from `vite.config.ts` coverage notes) would be in `ui/vab/_staging.ts` (45.26% line coverage, 35.25% branch) which has the lowest coverage in the `ui/vab` directory. Extracting its pure delta-V computation would improve both testability and coverage.

### Architecture Considerations

4. **`showFatalError` placement.** The function is defined in `main.ts` and exported. If other modules need to show fatal errors (e.g., IDB connection drop during gameplay), they'd need to import from `main.ts`, which creates a circular dependency risk. Consider moving `showFatalError` to a utility module (e.g., `src/ui/fatalError.ts`) if it's needed elsewhere.

5. **Notification accessibility.** The current toast system uses purely visual feedback (`opacity: 0` transition, CSS positioning). For accessibility:
   - Add `role="alert"` or `role="status"` to toast elements so screen readers announce them
   - Consider `aria-live="polite"` for info toasts and `aria-live="assertive"` for error toasts
   This is a UX improvement, not a bug.

6. **Single IDB connection resilience.** The iteration 16 review noted that `idbStorage.ts` caches a single `IDBDatabase` connection. With the startup error check now in place, the "IDB unavailable at page load" case is handled. The remaining risk is IDB becoming unavailable *during* gameplay (e.g., storage pressure eviction on mobile). The `showFatalError` helper could be used to surface such errors if IDB operations start failing mid-session.

### Technical Debt

7. **Coverage exclusion list growth.** `vite.config.ts` exclusion list was audited in iteration 16 but `previewLayout.ts` (a testable core module) was correctly not excluded. As new modules are extracted from UI code into core, the exclusion list should continue to shrink. Monitor that new modules are testable and contribute to coverage rather than being excluded.

8. **Test file count growth.** The suite went from 116 files (iteration 16) to 120 files (iteration 17), with 4,561 tests (up from 4,321). The full suite takes ~71 seconds — still fast enough for development feedback loops, but worth monitoring. The smoke test infrastructure (`@smoke` tags + `test-map.json`) is the right approach to keep fast CI feedback as the suite grows.

---

## Summary

Iteration 17 is **fully complete** — all 13 tasks are implemented, the build is clean, type-checking passes, linting is clean, and all 4,561 unit tests pass with all coverage thresholds met.

**Quality highlights:**
- The flaky `workerBridgeTimeout` test fix addresses the root cause (module state contention) rather than masking the symptom
- The `showFatalError` helper is well-designed: exported, tested, XSS-safe (`textContent`), shared between the IDB check and the generic catch handler
- The `previewLayout.ts` extraction is a clean separation with comprehensive edge-case tests
- Debug log suppression uses a disciplined save/restore pattern that doesn't leak between test files
- Smoke tag choices are well-targeted, especially the 5 autoSave tests covering error and fallback paths

**The only actionable issue is the missing `test-map.json` entries** for `previewLayout.ts`, `main.ts`/`mainStartup.test.ts`, and `notification.ts`/`notification.test.ts`. This is a minor maintenance gap — the tests exist and pass, they just won't be discovered by `run-affected.mjs` when their source files change.

The codebase continues to be well-architected with clean three-layer separation, comprehensive TypeScript coverage, a mature test suite with good smoke coverage, and a healthy build pipeline.
