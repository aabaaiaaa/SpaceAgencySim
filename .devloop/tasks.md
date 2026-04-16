# Iteration 17 — Tasks

### TASK-001: Fix flaky workerBridgeTimeout test with module isolation
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/tests/workerBridgeTimeout.test.ts`, add `vi.resetModules()` in `beforeEach` to force a fresh module instance per test, preventing shared state leaks across Vitest's parallel worker pool. The test `consumeMainThreadSnapshot returns null when no snapshot available` (line 110) times out intermittently in the full suite due to module-level state contention from the dynamic `import()` of `_workerBridge.ts`. After adding the reset, verify the dynamic import in each test gets a clean module. See requirements Section 1.
- **Verification**: `npx vitest run src/tests/workerBridgeTimeout.test.ts` passes in under 5 seconds, then `npx vitest run src/tests/workerBridgeTimeout.test.ts src/tests/physics.test.ts src/tests/saveload.test.ts` passes (simulates parallel contention).

### TASK-002: Add defensive division guard in collision.ts _resolveCollision
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/collision.ts`, add an early-return guard at the top of `_resolveCollision()` (before line 495) that returns if `a.mass` or `b.mass` is falsy or <= 0. This prevents NaN/Infinity from division by zero if `_bodyMass()` or `_bodyMoI()` are ever modified to remove their `Math.max(1, ...)` floor. The guard follows the same defensive pattern used in `physics.ts` at lines 1023, 1081, 1127, 1463. See requirements Section 2.
- **Verification**: `npx vitest run src/tests/collision.test.ts` passes (or the file containing collision tests). Run `npm run typecheck` with no errors.

### TASK-003: Add unit test for zero-mass collision guard
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: Add a unit test verifying that the collision system does not produce NaN/Infinity when bodies have zero mass. If `_resolveCollision` is not directly exported, test through the public collision API. Create a scenario with two colliding bodies where mass would be zero (e.g., empty `activeParts` sets with mocked `_bodyMass` returning 0), and assert that resulting velocities/positions are finite numbers. See requirements Section 2.
- **Verification**: `npx vitest run src/tests/collision.test.ts` passes, including the new test.

### TASK-004: Add IDB availability check at startup
- **Status**: done
- **Dependencies**: none
- **Description**: At the start of `main()` in `src/main.ts` (before `initSettings()` on line 68), add a check: if `isIdbAvailable()` returns false, display a user-visible error in the DOM and return early. Import `isIdbAvailable` from `./core/idbStorage.ts`. The error message should be plain language (e.g., "This game requires IndexedDB for saving. Your browser may be blocking storage access."), displayed in a styled div inserted into `document.body`, and should prevent any further initialization. See requirements Section 3.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds. Manual inspection: the `isIdbAvailable()` call exists before `initSettings()`.

### TASK-005: Improve main.ts generic error handler to show visible errors
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Update the `main().catch()` handler at `src/main.ts:228-230` to display a user-visible error in the DOM, not just `logger.error()`. Extract the error display logic from TASK-004 into a shared helper (e.g., `_showFatalError(message: string)`) that both the IDB check and the catch handler can use. The helper should create a styled overlay div with the error message. See requirements Section 3.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds. Inspect `main.ts` — the catch handler now calls the visible error function.

### TASK-006: Add unit test for IDB-unavailable startup path
- **Status**: pending
- **Dependencies**: TASK-004, TASK-005
- **Description**: Add a test that verifies: when `isIdbAvailable()` returns false, the startup error display function is invoked and `initSettings()` is not called. This may require extracting the IDB check into a testable function or mocking `isIdbAvailable`. If testing `main()` directly is impractical (DOM dependencies), test the extracted `_showFatalError` helper and the conditional logic separately. See requirements Section 3.
- **Verification**: `npx vitest run` on the new test file passes.

### TASK-007: Suppress debug log spam in saveload.test.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/tests/saveload.test.ts`, add `logger.setLevel('warn')` in `beforeAll` (or the outermost `beforeEach`) and restore the original level in `afterAll`. Import `logger` from `../core/logger.ts`. This suppresses the hundreds of `[DEBUG] [save] Compression stats` lines that clutter test output. See requirements Section 4.
- **Verification**: `npx vitest run src/tests/saveload.test.ts 2>&1 | grep -c "\[DEBUG\]"` returns 0 (no debug lines in output). All tests still pass.

### TASK-008: Suppress debug log spam in remaining test files
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Apply the same `logger.setLevel('warn')` pattern from TASK-007 to these test files: `src/tests/autoSave.test.ts`, `src/tests/storageErrors.test.ts`, `src/tests/debugMode.test.ts`. Each file should set logger level to `'warn'` in `beforeAll` and restore in `afterAll`. See requirements Section 4.
- **Verification**: `npx vitest run src/tests/autoSave.test.ts src/tests/storageErrors.test.ts src/tests/debugMode.test.ts 2>&1 | grep -c "\[DEBUG\]"` returns 0. All tests pass.

### TASK-009: Add @smoke tags to IDB round-trip tests
- **Status**: pending
- **Dependencies**: none
- **Description**: Add `@smoke` to the description of one representative test in each of these files: (1) `src/tests/saveload.test.ts` — a test for `listSaves()` returning saved games; (2) `src/tests/autoSave.test.ts` — a test for auto-save trigger → exists check → load; (3) `src/tests/settingsStore.test.ts` — a test for settings persistence round-trip; (4) `src/tests/idbStorage.test.ts` — a test for `idbSet` → `idbGet` round-trip. Pick the test in each file that exercises the broadest code path. See requirements Section 5.
- **Verification**: `npx vitest run --testNamePattern "@smoke" src/tests/saveload.test.ts src/tests/autoSave.test.ts src/tests/settingsStore.test.ts src/tests/idbStorage.test.ts` finds and runs at least 4 smoke-tagged tests (plus the existing one in saveload), all passing.

### TASK-010: Update test-map.json for new smoke coverage
- **Status**: pending
- **Dependencies**: TASK-009
- **Description**: Review `test-map.json` and ensure the mappings for `src/core/idbStorage.ts`, `src/core/autoSave.ts`, `src/core/settingsStore.ts`, and `src/core/saveload.ts` include their respective test files. Add any missing mappings. See requirements Section 5.
- **Verification**: `node scripts/run-affected.mjs --dry-run` runs without errors. Inspect `test-map.json` — all four source modules map to their test files.

### TASK-011: Extract preview scaling math from rocketCardUtil.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Extract the pure bounding-box and scale computation from `src/ui/rocketCardUtil.ts` (lines 95-121) into a new file `src/core/previewLayout.ts`. The function should take an array of part positions/sizes (e.g., `{ x, y, width, height }[]`) and preview dimensions (`{ width, height, padding }`), and return `{ scale: number, offsetX: number, offsetY: number }`. The UI function `renderRocketPreview()` should import and use this instead of inlining the math. See requirements Section 6.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds. The canvas rendering in `rocketCardUtil.ts` still works (uses the extracted function).

### TASK-012: Add unit tests for previewLayout.ts
- **Status**: pending
- **Dependencies**: TASK-011
- **Description**: Create `src/tests/previewLayout.test.ts` with unit tests for the extracted scaling function. Test cases: (1) normal case with multiple parts — verify scale fits within preview bounds; (2) single part — verify it centres correctly; (3) parts in a vertical line (rocketW ≈ 0) — verify no division by zero, scale is finite; (4) parts in a horizontal line (rocketH ≈ 0) — same check. See requirements Section 6.
- **Verification**: `npx vitest run src/tests/previewLayout.test.ts` passes with all 4+ tests green.

### TASK-013: Final typecheck, lint, build, and smoke test verification
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012
- **Description**: Run the full verification suite to confirm all changes work together. Check for any regressions. Verify no debug log spam in test output. Verify smoke tests include the new tags.
- **Verification**: All of these pass with 0 errors: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:smoke:unit`.
