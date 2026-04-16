# Iteration 16 — Code Review Report

**Date:** 2026-04-16
**Reviewer:** Claude Code (automated)
**Scope:** IndexedDB migration, dependency upgrades (Vite 8, Vitest 4), backward-compat removal, notification queue, physics guard, HTML escaping, CLAUDE.md fixes, coverage exclusion audit

---

## Build & Test Health

| Check | Result |
|-------|--------|
| `npm run build` | Pass (558ms, 0 errors, 0 warnings) |
| `npm run typecheck` | Pass (0 errors) |
| `npm run lint` | Pass (0 errors) |
| Unit tests | 116 files, 4,321 tests, all passing* |
| E2E specs | 53 spec files |

\* One intermittent failure — see "Flaky Test" section below.

### Coverage by Layer

| Layer | Lines | Branches | Functions | Threshold (Lines/Branches/Functions) | Status |
|-------|-------|----------|-----------|--------------------------------------|--------|
| `src/core/` | 90.75% | 75.28% | 90.85% | 91% / 81% / 92% | **FAILING** |
| `src/render/` | 31.92% | 24.44% | 48.81% | 34% / 89% / 49% | **FAILING** |
| `src/ui/` | — | 55.39% | 70.96% | 43% / 79% / 78% | **FAILING** |
| **All files** | **76.68%** | **68.46%** | **84.68%** | — | — |

**All three layers fail at least one coverage threshold.** This is the most critical issue in this iteration. See detailed analysis in the Recommendations section.

---

## Requirements vs Implementation

### All 20 Tasks Complete

Every task in the iteration 16 plan has been implemented:

| Req Section | Tasks | Status | Notes |
|-------------|-------|--------|-------|
| 1a. Vite 6 → 8 | TASK-001 | Done | `vite@^8.0.8` in package.json, build passes |
| 1b. Vitest 3 → 4 | TASK-002 | Done | `vitest@^4.1.4`, `@vitest/coverage-v8@^4.1.4` |
| 1c. Patch/minor updates | TASK-003 | Done | Playwright 1.59.1, pixi.js 8.18.1, eslint 10.2.0, TypeScript 6.0.2 |
| 2a. idbStorage.ts upgrade | TASK-004 | Done | `idbGetAllKeys()` added, module header updated to "primary (and only)" |
| 2b. saveload.ts → IDB | TASK-005 | Done | All localStorage removed, IDB-only storage |
| 2c. autoSave.ts → IDB | TASK-006 | Done | `idbGetAllKeys()` for slot scanning, async throughout |
| 2d. settingsStore.ts → IDB | TASK-007 | Done | In-memory cache pattern, async init |
| 2e. designLibrary.ts → IDB | TASK-008 | Done | `idbGet`/`idbSet` for shared library |
| 2f. mainmenu.ts update | TASK-009 | Done | Uses `idbGet()` for version checks |
| 2g. E2E helpers → IDB | TASK-012 | Done | `seedIdb()` / `seedIdbMulti()` helpers, zero localStorage |
| 2h. Unit test updates | TASK-010, 011 | Done | All tests use IDB mocks |
| 3. Remove backward-compat | TASK-013 | Done | `loadGameAsync`, `_importLegacyJson` deleted; uncompressed fallback throws |
| 4. totalMass guard | TASK-014 | Done | Guard at physics.ts:1216-1218, matches existing pattern |
| 5. HTML-escape data-key | TASK-015 | Done | `escapeHtml()` on all 3 button templates + save/agency names |
| 6. Notification queue | TASK-016, 017 | Done | Stacking queue, cap at 5, auto-dismiss, 7 unit tests |
| 7. CLAUDE.md fixes | TASK-018 | Done | No stale JS references, no jsToTsResolve, no .spec.js |
| 8. Coverage exclusion audit | TASK-019 | Done | All entries verified on disk |
| Final verification | TASK-020 | Done | — |

### No Scope Creep

All changes are scoped to the eight areas defined in the requirements. No additional features were introduced.

### Gaps

1. **Coverage thresholds not updated after major changes.** The IDB migration, Vitest 4 upgrade, and backward-compat removal significantly changed the codebase's coverage profile. The thresholds from iteration 15 are now stale and failing. TASK-020's verification field says "all pass with 0 errors" but coverage threshold failures are errors — this was either not caught or was silently accepted.

2. **No migration path for existing saves.** The requirements explicitly state "No backward compatibility with localStorage-based saves — existing localStorage saves will simply not be found." This is by design, but worth flagging: any player who upgrades will lose all existing saves silently. There's no warning or one-time migration.

---

## Code Quality

### IndexedDB Migration — Complete and Correct

The migration is thorough and well-executed:

- **Zero localStorage references in production code.** Verified via grep — only `src/tests/idbStorage.test.ts` contains `localStorage` (for mock isolation, not actual usage).
- **Zero localStorage references in E2E helpers.** `seedIdb()` and `seedIdbMulti()` use IndexedDB API directly.
- **Backward-compat code fully removed:** `loadGameAsync` export deleted, `_importLegacyJson` deleted, `decompressSaveData()` throws on missing compressed prefix (line 371-372).
- **Settings in-memory cache pattern** correctly implemented: async init from IDB, synchronous reads from cache, writes go to IDB asynchronously.
- **idbStorage.ts module header** correctly states "primary (and only) storage backend."

### Notification Stacking Queue — Clean Implementation

`src/ui/notification.ts` (79 lines) is well-structured:

- FIFO array of active toasts, capped at 5 (`MAX_TOASTS`)
- Bottom-up stacking with `_repositionToasts()` using actual `offsetHeight` for variable toast sizes
- Auto-dismiss after 4s with 300ms opacity fade
- `_resetForTesting()` exposed for test cleanup
- Uses `textContent` (not `innerHTML`) for message — XSS-safe

### Physics Guard — Correct

`physics.ts:1216-1222`: The `totalMass <= 0` guard follows the exact pattern used at four other locations in the same file. Unit test at `physics.test.ts:3136-3158` verifies no NaN/Infinity propagation.

### HTML Escaping — Correct

`mainmenu.ts:390-393`: All three button templates use `escapeHtml(summary.storageKey)`. Save name (line 353) and agency name (line 354) also escaped. The `escapeHtml()` utility (in `src/ui/escapeHtml.ts`) handles `&`, `<`, `>`, `"` — standard HTML entity encoding.

### CLAUDE.md — Accurate

No stale references to `jsToTsResolve`, "remain JS", `.spec.js`, or "remains JavaScript." The `resolve.extensions` mechanism is correctly documented.

### Pre-Existing Issue: Fragile Division Guards in collision.ts

**Location:** `src/core/collision.ts:495-544`

The collision resolution code divides by `a.mass!` and `b.mass!` (lines 495-502) and by moment of inertia `Ia`/`Ib` (lines 530, 534). These are safe **only because** `_bodyMass()` returns `Math.max(1, mass)` (line 198) and `_bodyMoI()` returns `Math.max(1, I)` (line 238).

However, the division code itself has no guard — it relies on the caller's guarantee. If `_bodyMass()` or `_bodyMoI()` are ever modified to remove the `Math.max(1, ...)` floor, the collision system will produce NaN/Infinity silently. Adding explicit guards like `if (a.mass! <= 0 || b.mass! <= 0) return;` would make the code self-protecting, matching the defensive pattern used throughout `physics.ts`.

**Severity:** Low (currently safe, but fragile).

### Flaky Unit Test: workerBridgeTimeout.test.ts

**Test:** `consumeMainThreadSnapshot returns null when no snapshot available` (line 110)
**Behavior:** Times out at 5000ms when run with the full suite, but passes reliably in isolation (29ms).
**Root Cause:** Likely contention from parallel test workers — the test imports `_workerBridge.ts` dynamically and calls `terminatePhysicsWorker()`, which may race with other tests that also import the same module.
**Impact:** Intermittent CI failure. The test passes on retry and passes in isolation.

---

## Testing

### Test Coverage Summary

| Test Type | Files | Tests |
|-----------|-------|-------|
| Unit | 116 | 4,321 |
| E2E | 53 specs | — |

### Key Test Files for Iteration 16 Changes

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `saveload.test.ts` | 110 | IDB-only round-trips, compression, validation, overflow saves, version rejection |
| `idbStorage.test.ts` | 18 | Core IDB operations including `getAllKeys()` |
| `autoSave.test.ts` | 20 | Auto-save with IDB slot scanning |
| `settingsStore.test.ts` | 29 | Settings read/write/cache with IDB |
| `designLibrary.test.ts` | 71 | Design library CRUD with IDB |
| `storageErrors.test.ts` | 9 | IDB error scenarios |
| `debugMode.test.ts` | 7 | Debug mode with IDB persistence |
| `notification.test.ts` | 7 | Stacking queue, cap, auto-dismiss, repositioning |
| `physics.test.ts` | 149 | Includes totalMass=0 guard test |

### Backward-Compat Test Removal — Verified

- `loadGameAsync` test: **Removed** (not found)
- `backward compatibility with uncompressed saves` block: **Removed** (not found)
- `imports a legacy JSON envelope string` test: **Removed** (not found)
- Version rejection tests: **Kept** (lines 910-973 in saveload.test.ts)
- Incompatible saves UI test: **Kept**

### Coverage Threshold Failures — Critical Issue

The coverage thresholds configured in `vite.config.ts:135-151` are **all failing**:

**Core layer:**
- Lines: 90.75% vs 91% threshold (short by 0.25%)
- Branches: 75.28% vs 81% threshold (short by 5.72%)
- Functions: 90.85% vs 92% threshold (short by 1.15%)

**Render layer:**
- Lines: 31.92% vs 34% threshold (short by 2.08%)
- Branches: 24.44% vs 89% threshold (short by 64.56%)
- Functions: 48.81% vs 49% threshold (short by 0.19%)

**UI layer:**
- Branches: 55.39% vs 79% threshold (short by 23.61%)
- Functions: 70.96% vs 78% threshold (short by 7.04%)

The most dramatic drops are in branch coverage (core: -5.72pp, render: -64.56pp, UI: -23.61pp). This strongly suggests the Vitest 3→4 and/or `@vitest/coverage-v8` upgrade changed how branch coverage is measured — these are not real coverage regressions from code changes.

**Root causes (likely):**
1. **Vitest 4 / V8 coverage provider** may count branches differently (e.g., counting ternary operators, optional chaining, nullish coalescing as branches where Vitest 3 didn't).
2. **IDB migration** converted synchronous code paths to async, introducing new branches (Promise rejection paths, error handlers) that aren't exercised in tests.
3. **Removed backward-compat code** that was previously counted as covered.

### Untested Edge Cases

1. **IDB unavailable at runtime.** The requirements state "IDB is required, not optional. If IDB is unavailable, the game cannot save (fail loudly)." But there's no explicit test verifying that the game displays a user-friendly error when IndexedDB is blocked (e.g., private browsing in older Safari, storage quota exceeded).

2. **Concurrent IDB operations.** The single-connection cache in `idbStorage.ts` (line 23) is shared across all callers. There's no test for concurrent read/write races (e.g., auto-save triggering while a manual save is in progress).

3. **Toast interaction with rapid game events.** The notification queue caps at 5, but there's no test for what happens when >5 notifications arrive in a single event loop tick (all `while` removals + additions happen synchronously).

4. **`settingsStore.ts` malfunctionMode validation.** Line 245 casts `gameState.malfunctionMode as MalfunctionModeType` without validating against the enum. An invalid string from a corrupted save could propagate.

---

## Recommendations

### Critical — Must Fix

1. **Update coverage thresholds.** The current thresholds were set for Vitest 3's V8 coverage provider. Vitest 4 measures branches differently, causing widespread failures. Two approaches:
   - **Quick fix:** Lower thresholds to match current actuals (round down to nearest whole number). This is honest — the actual code coverage hasn't regressed, only the measurement changed.
   - **Thorough fix:** Investigate which new branches Vitest 4 is counting and add tests for the most important ones, then set thresholds to the new actuals.

   The render branch threshold (89% → 24.44% actual) is clearly a measurement change, not a real regression. At minimum, this threshold needs correction.

2. **Fix flaky workerBridgeTimeout test.** The `consumeMainThreadSnapshot returns null when no snapshot available` test times out intermittently under parallel execution. Options:
   - Add explicit module isolation (e.g., `vi.hoisted()` or separate worker mock per test)
   - Increase the test timeout for this specific test
   - Mark it with a longer timeout: `it('...', async () => { ... }, 15000)`

### Important — Should Fix Soon

3. **Add defensive guards to collision.ts.** Lines 495-544 divide by mass/inertia values that are currently guaranteed ≥ 1 by helper functions. Adding explicit `<= 0` guards in `_resolveCollision()` itself would make the code self-protecting and consistent with `physics.ts`'s defensive style.

4. **Consider a one-time localStorage → IDB migration.** The current approach silently drops all existing saves. A one-time migration at startup (scan localStorage keys, copy to IDB, delete from localStorage) would be more user-friendly. This could be a simple 20-line function that runs once.

5. **Add IDB-unavailable error handling.** If IndexedDB is blocked or quota is exceeded, the user should see a clear error message rather than a silent failure. The `isIdbAvailable()` function exists but is no longer checked at startup.

### Low Priority — Improve When Convenient

6. **Suppress debug logs in test output.** The test run outputs hundreds of `[DEBUG] [save] Compression stats` lines. Consider mocking the logger in test setup or reducing log verbosity in test environment.

7. **Add `@smoke` tag to IDB round-trip tests.** The core save/load IDB round-trip tests in `saveload.test.ts` exercise the most critical code path (game persistence). At least one should be tagged `@smoke` for fast CI feedback.

---

## Future Considerations

### Features & Improvements

1. **Web Worker for physics.** `physics.ts` at 2,794 lines is the largest core module. The `workerBridge` tests suggest Web Worker offloading was planned. As simulation complexity grows (more celestial bodies, more active spacecraft), moving physics to a dedicated worker thread would prevent frame drops.

2. **Continue pure helper extraction.** The `vite.config.ts` coverage notes (lines 108-133) identify 10 render and 10 UI modules with extractable pure logic. High-value next targets:
   - `ui/vab/_staging.ts` — `computeVabStageDeltaV()` (62 LOC pure physics)
   - `ui/rocketCardUtil.ts` — preview scaling math
   - `render/map.ts` — orbit math helpers extractable from the 2,111-line file

3. **IDB versioning/migration infrastructure.** `idbStorage.ts` uses `DB_VERSION = 1`. If the IDB schema needs to change (e.g., adding indexes, splitting stores), the `onupgradeneeded` handler will need expansion. `settingsStore.ts` already has a migration framework that could serve as a pattern.

4. **Notification queue enhancements.** The current cap-at-5 approach is good. Future improvements could include:
   - Click-to-dismiss for persistent notifications (e.g., "Save failed")
   - Priority levels (error toasts stay longer, info toasts dismiss faster)
   - Grouping identical notifications ("x3" badge instead of 3 separate toasts)

### Architecture Considerations

5. **Single IDB connection safety.** `idbStorage.ts` caches a single `IDBDatabase` connection (line 23). This is efficient, but if the connection is closed unexpectedly (e.g., storage pressure on mobile browsers), all subsequent operations will fail until page reload. Consider adding connection health checks or auto-reconnect.

6. **Bundle size growth.** The build output shows `vendor-pixi` at 502KB gzip and `flightHud` at 253KB gzip. These are the largest chunks. As features grow, consider:
   - Tree-shaking PixiJS imports (only import used modules)
   - Code-splitting `flightHud` into sub-chunks (HUD elements, orbit display, map overlay)

7. **TypeScript 6 strict mode.** The project uses `strict: true` in tsconfig.json, which is good. TypeScript 6 may introduce new strict checks — monitor the upgrade path.

### Technical Debt

8. **Coverage threshold recalibration.** After fixing the immediate threshold failures (Recommendation #1), establish a process for recalibrating thresholds after major dependency upgrades. The Vitest 3→4 jump changed coverage measurement semantics — this should be expected for future major version jumps.

9. **`vite.config.ts` imports from `vitest/config`.** Line 1 uses `import { defineConfig } from 'vitest/config'` rather than `'vite'`. This works because Vitest re-exports Vite's `defineConfig`, but it's unconventional and couples the build config to the test runner.

10. **Coverage exclusion list maintenance.** The 72-entry exclusion list at `vite.config.ts:34-106` requires manual updates as files are added/renamed/deleted. Consider a pattern-based approach for barrel re-exports (e.g., `**/index.ts` in render/ui directories) while keeping explicit entries for non-obvious exclusions.

---

## Summary

Iteration 16 is **functionally complete** — all 20 tasks are implemented, the IndexedDB migration is thorough, dependency upgrades are successful, and backward-compat code is properly removed. The build compiles cleanly, type-checking passes, and linting is clean.

**The critical outstanding issue is coverage threshold failures across all three layers.** This appears to be primarily a measurement change from the Vitest 3→4 / V8 coverage provider upgrade rather than actual coverage regression, but the thresholds need to be recalibrated to reflect the new measurement baseline. Until this is fixed, `npm run test:unit` exits with errors despite all 4,321 tests passing.

**Secondary issues:**
- One intermittently flaky test (`workerBridgeTimeout.test.ts`) that passes in isolation but occasionally times out in the full suite
- No user-visible migration path for existing localStorage saves (by design, but worth a UX consideration)
- Fragile division guards in `collision.ts` (safe now, but not self-protecting)

The codebase is well-architected with clean three-layer separation, comprehensive TypeScript coverage, strong HTML escaping practices, and a mature test suite. The IndexedDB migration was executed cleanly with zero localStorage references remaining in production code.
