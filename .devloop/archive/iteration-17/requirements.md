# Iteration 17 — Test Stability, Defensive Guards, Error Handling & Cleanup

**Date:** 2026-04-16
**Scope:** Flaky test fix, collision.ts defensive guards, IDB-unavailable user error, test log noise suppression, smoke tag additions, pure helper extraction
**Builds on:** Iteration 16 (IndexedDB migration, Vitest 4 upgrade, notification queue)
**Review driving this iteration:** `.devloop/archive/iteration-16/review.md`

---

## 1. Fix Flaky workerBridgeTimeout Test

**Location:** `src/tests/workerBridgeTimeout.test.ts`, line 110

**Problem:** The test `consumeMainThreadSnapshot returns null when no snapshot available` times out at 5000ms when run in the full suite, but passes reliably in isolation (29ms). The root cause is module-level state contention: the test uses a dynamic `import()` of `_workerBridge.ts` and calls `terminatePhysicsWorker()`, which races with other tests that also import the same module under Vitest's parallel worker pool.

**Fix:** Isolate the module state per test. The `afterEach` already calls `terminatePhysicsWorker()` and `vi.restoreAllMocks()`, but the dynamic import shares cached module state across the worker. Options:

- **Option A (preferred):** Use `vi.resetModules()` in `beforeEach` to force a fresh module instance per test, ensuring no shared state leaks between tests. This is the cleanest approach.
- **Option B:** Add `{ timeout: 15000 }` to the specific test. This masks the symptom rather than fixing the cause — use only if Option A causes other issues.

After the fix, verify the test passes both in isolation (`npx vitest run src/tests/workerBridgeTimeout.test.ts`) and in the full suite (`npm run test:unit`). The test should complete in well under 1 second.

---

## 2. Defensive Division Guards in collision.ts

**Location:** `src/core/collision.ts`, lines 495-544 (function `_resolveCollision`)

**Problem:** The collision response code divides by `a.mass!`, `b.mass!`, `Ia`, and `Ib` at multiple locations without local guards:

- Line 495: `1 / a.mass! + 1 / b.mass!` (inverse mass sum)
- Lines 499-502: `j / a.mass!` and `j / b.mass!` (velocity impulse)
- Lines 530, 534: `torqueA * dt / Ia` and `torqueB * dt / Ib` (angular impulse)
- Lines 541-544: `1 / a.mass!` and `1 / b.mass!` (positional correction)

These divisions are currently safe because `_bodyMass()` (line 198) returns `Math.max(1, mass)` and `_bodyMoI()` (line 238) returns `Math.max(1, I)`. However, the division code relies entirely on this upstream guarantee. If the helpers are ever modified, the collision system will silently produce NaN/Infinity.

**Fix:** Add an early-return guard at the top of `_resolveCollision()`, before any division:

```typescript
if (!a.mass || a.mass <= 0 || !b.mass || b.mass <= 0) return;
```

This matches the defensive pattern used at four locations in `physics.ts` (lines 1023, 1081, 1127, 1463) and makes the collision code self-protecting.

**Tests:** Add a unit test in `src/tests/collision.test.ts` (or the appropriate existing test file) that verifies `_resolveCollision` does not produce NaN/Infinity when given zero-mass bodies. If `_resolveCollision` is not directly exported, test through the public collision API that calls it.

---

## 3. IDB-Unavailable Startup Error

**Problem:** With IndexedDB as the sole storage backend, if IDB is unavailable (e.g., private browsing in older Safari, storage quota exceeded, browser security restrictions), the game fails silently. `main.ts:228-230` catches the error with `logger.error()` to the console only — the player sees a blank or broken page with no explanation.

The `isIdbAvailable()` function exists in `idbStorage.ts:79-81` but is never called at startup.

**Fix:** Add an IDB availability check at the very start of `main()` in `src/main.ts`, before `initSettings()`. If `isIdbAvailable()` returns false, display a user-visible error message in the DOM and return early (do not continue initialization). The error should:

- Be displayed in the existing `#ui-overlay` element (or a new element if the overlay isn't yet available at that point)
- Use plain, non-technical language: e.g., "This game requires IndexedDB for saving. Your browser may be blocking storage access. Try disabling private browsing mode or checking your browser settings."
- Be styled consistently with the game's existing UI (dark background, readable text)
- Not attempt to initialize the renderer, settings, or any other system

Also update the generic `main().catch()` handler at line 228 to display a visible error in the DOM rather than only logging to console, since any uncaught startup error (not just IDB) leaves the player stranded on a blank page.

**Tests:** Add a unit test that verifies: when `isIdbAvailable()` returns false, the startup path displays an error and does not call `initSettings()`. This may require extracting the check into a testable function.

---

## 4. Suppress Debug Log Spam in Tests

**Problem:** The test suite outputs hundreds of `[DEBUG] [save] Compression stats` lines during `npm run test:unit`. This comes from `src/core/saveload.ts:343`:

```typescript
logger.debug('save', 'Compression stats', { rawSize, compressedSize, ratio });
```

The logger (`src/core/logger.ts:16`) defaults to `'debug'` level in non-production environments, so all debug output appears during test runs. Other test files (like `branchCoverage.test.ts`) already call `logger.setLevel('warn')` to suppress this, but `saveload.test.ts` and several other high-traffic test files don't.

**Fix:** Add `logger.setLevel('warn')` in the `beforeEach` (or `beforeAll`) of test files that exercise save/load code paths, and restore the original level in `afterEach`/`afterAll`. The affected test files are:

- `src/tests/saveload.test.ts` (primary source of compression stats spam)
- `src/tests/autoSave.test.ts`
- `src/tests/storageErrors.test.ts`
- `src/tests/debugMode.test.ts`

Alternatively, if there's a Vitest setup file that runs before all tests, setting the logger level there would be a single-point fix. Check for `vitest.setup.ts` or similar.

After the fix, run `npm run test:unit` and verify that `[DEBUG]` lines no longer appear in the output (warnings and errors should still appear).

---

## 5. Add @smoke Tags to IDB Round-Trip Tests

**Context:** The `@smoke` tag system allows running a fast subset of critical-path tests. Currently only one IDB test has a smoke tag (`saveload.test.ts:1372` — compressed save/load cycle). The IDB migration was the largest change in iteration 16, and the core persistence path should have better smoke coverage.

**Add `@smoke` to these tests:**

- **`saveload.test.ts`**: One test for `listSaves()` returning saved games (verifies IDB key scanning works)
- **`autoSave.test.ts`**: One test for the auto-save round-trip (trigger → check exists → load)
- **`settingsStore.test.ts`**: One test for settings persistence round-trip (save → load from IDB → verify cache)
- **`idbStorage.test.ts`**: One test for basic `idbSet` → `idbGet` round-trip

Pick the most representative test in each file — the one that exercises the broadest code path. Tag it by adding `@smoke` to its description string.

After tagging, verify with `npm run test:smoke:unit` that the new smoke tests are discovered and pass.

Also update `test-map.json` if any new mappings are needed for the affected test files.

---

## 6. Extract Preview Scaling Math from rocketCardUtil.ts

**Location:** `src/ui/rocketCardUtil.ts`, lines 110-133

**Context:** The review identified three helper extraction candidates. Two are already done:
- `_staging.ts` → `computeStageDeltaV` already extracted to `src/core/stagingCalc.ts`
- `map.ts` → orbit math already imported from `core/orbit.ts`, `core/mapView.ts`, `core/mapGeometry.ts`

The remaining candidate is `rocketCardUtil.ts`, which contains ~10 lines of pure preview scaling math embedded in the canvas rendering function `renderRocketPreview()`.

**What to extract:** The bounding-box calculation (lines 95-106: min/max X/Y from parts) and the scale/offset computation (lines 110-121: computing `scale`, `cx`, `cy`, `midX`, `midY` from the bounding box and preview dimensions) are pure geometry with no DOM or canvas dependency. The actual canvas drawing (lines 122-133: `ctx.fillRect`/`ctx.strokeRect`) stays in the UI module.

**Extract to:** A new function in an existing core utility or a small new file (e.g., `src/core/previewLayout.ts`) that takes an array of part positions/sizes and preview dimensions, and returns `{ scale, offsetX, offsetY }`. The UI function then uses these values for the canvas drawing.

**Tests:** Add a unit test for the extracted function: given known part positions and preview dimensions, verify the computed scale and offsets are correct. Test edge cases: single part, parts in a vertical line (rocketW ≈ 0), parts in a horizontal line (rocketH ≈ 0).

---

## Testing Strategy

| Area | What Changes |
|------|-------------|
| `workerBridgeTimeout.test.ts` | Add `vi.resetModules()` in beforeEach; verify passes in full suite |
| `collision.test.ts` (or equivalent) | Add test for zero-mass collision guard |
| `main.ts` / new startup test | Test IDB-unavailable error display |
| `saveload.test.ts` | Add `logger.setLevel('warn')` to suppress debug spam |
| `autoSave.test.ts` | Add `logger.setLevel('warn')` and `@smoke` tag |
| `settingsStore.test.ts` | Add `@smoke` tag |
| `idbStorage.test.ts` | Add `@smoke` tag |
| `previewLayout.test.ts` (new) | Unit tests for extracted scaling math |

### Verification

After all changes: `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run test:unit` must all pass with zero errors. `npm run test:smoke:unit` must include the newly tagged smoke tests.

---

## Technical Decisions

- **Module isolation over timeouts.** The flaky test is fixed by resetting module cache, not by increasing timeouts. Timeouts mask problems.
- **Early-return guard pattern.** Collision guards use early return (not clamping), matching the existing physics.ts defensive style.
- **User-visible startup errors.** Any fatal startup error (IDB or otherwise) should produce a visible DOM message, not just a console log.
- **Logger suppression in tests.** Per-file `logger.setLevel('warn')` in beforeEach/afterEach, not a global test setup change, to keep the fix targeted and visible.
- **Minimal extraction scope.** Only the bounding-box and scale computation are extracted from rocketCardUtil.ts — the canvas rendering stays in place.
