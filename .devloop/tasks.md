# Iteration 18 — Tasks

### TASK-001: Extract showFatalError to src/ui/fatalError.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/ui/fatalError.ts` containing the `showFatalError` function currently defined at `src/main.ts:68-78`. Copy the function body exactly as-is. The file should export only this one function. See requirements.md section 1 for the exact code.
- **Verification**: `npx tsc --noEmit src/ui/fatalError.ts` (no type errors)

### TASK-002: Update main.ts to import showFatalError from new location
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: In `src/main.ts`: (1) Remove the `showFatalError` function definition (lines 68-78) and its JSDoc comment (lines 63-67). (2) Add `import { showFatalError } from './ui/fatalError.ts';` to the imports section. (3) Verify both usages at line ~87 (IDB check) and line ~258 (catch handler) still reference `showFatalError` correctly — they should work unchanged since the function signature is identical. Do NOT remove the `export` from the main function.
- **Verification**: `npx tsc --noEmit src/main.ts` (no type errors)

### TASK-003: Update mainStartup.test.ts mocks for fatalError extraction
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: In `src/tests/mainStartup.test.ts`: (1) Add a hoisted mock for `showFatalError` in the `mocks` object: `showFatalError: vi.fn()`. (2) Add `vi.mock('../ui/fatalError.ts', () => ({ showFatalError: mocks.showFatalError }));` to the module mocks section. (3) Update the first test ('shows fatal error...') to assert `expect(mocks.showFatalError).toHaveBeenCalledTimes(1)` and that the call argument contains 'IndexedDB', instead of checking `document.body.appendChild`. (4) Update the second test ('calls initSettings...') to assert `expect(mocks.showFatalError).not.toHaveBeenCalled()`. (5) Update the third test ('creates a styled error overlay...') to import `showFatalError` from `'../ui/fatalError.ts'` instead of `'../main.ts'`, and test it directly (this test can keep using the DOM stub approach since it tests the function's DOM behavior). Keep all existing assertions that still apply.
- **Verification**: `npx vitest run src/tests/mainStartup.test.ts`

### TASK-004: Add Ia/Ib inline guards in collision.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/collision.ts`, inside `_resolveCollision`, add inline guards before each moment-of-inertia division. At line 533: change `a.ref.angularVelocity += torqueA * dt / Ia;` to `if (Ia > 0) a.ref.angularVelocity += torqueA * dt / Ia;`. At line 537: change `b.ref.angularVelocity += torqueB * dt / Ib;` to `if (Ib > 0) b.ref.angularVelocity += torqueB * dt / Ib;`. This makes the angular impulse code self-protecting, consistent with the mass guard at line 457. See requirements.md section 2.
- **Verification**: `npx vitest run src/tests/collision.test.ts`

### TASK-005: Add @smoke tag to mainStartup.test.ts
- **Status**: done
- **Dependencies**: TASK-003
- **Description**: In `src/tests/mainStartup.test.ts`, add ` @smoke` to the description string of the first test: change `'shows fatal error and does not call initSettings when IDB is unavailable'` to `'shows fatal error and does not call initSettings when IDB is unavailable @smoke'`.
- **Verification**: `npx vitest run --testNamePattern "@smoke" src/tests/mainStartup.test.ts`

### TASK-006: Add @smoke tag to previewLayout.test.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/tests/previewLayout.test.ts`, add ` @smoke` to the description string of the second test: change `'computes scale that fits multiple parts within preview bounds'` to `'computes scale that fits multiple parts within preview bounds @smoke'`.
- **Verification**: `npx vitest run --testNamePattern "@smoke" src/tests/previewLayout.test.ts`

### TASK-007: Add IDB connection-lost handler to idbStorage.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/idbStorage.ts`: (1) Add a module-level variable `let _onConnectionLost: ((msg: string) => void) | null = null;` after the existing module-level variables. (2) Export a registration function `registerIdbErrorHandler(handler: (msg: string) => void): void` that sets `_onConnectionLost = handler`. (3) In the `openDB()` function, after `_db = request.result;` (line 58), add a `_db.onclose` handler that resets `_db = null; _dbPromise = null;` and calls `_onConnectionLost` with the message: `'The storage connection was unexpectedly closed. Your recent progress may not be saved. Try refreshing the page.'`. (4) In `_resetDbForTesting()`, add `_onConnectionLost = null;` to prevent test callback leaks. See requirements.md section 5 for exact code.
- **Verification**: `npx vitest run src/tests/idbStorage.test.ts`

### TASK-008: Register IDB error handler in main.ts
- **Status**: done
- **Dependencies**: TASK-002, TASK-007
- **Description**: In `src/main.ts`: (1) Add `registerIdbErrorHandler` to the import from `'./core/idbStorage.ts'` (which already imports `isIdbAvailable`). (2) After the IDB availability check passes (after line ~93, before `await initSettings()`), add `registerIdbErrorHandler(showFatalError);`. This wires the IDB connection-lost event to the fatal error UI overlay.
- **Verification**: `npx vitest run src/tests/mainStartup.test.ts`

### TASK-009: Add unit test for IDB connection-lost handler
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Add a test in `src/tests/idbStorage.test.ts` (in a new `describe` block named 'IDB connection-lost handler') that: (1) Registers a mock handler via `registerIdbErrorHandler(mockFn)`. (2) Performs an `idbSet` to force `openDB()` to run and cache `_db`. (3) Retrieves the cached DB's `onclose` handler and invokes it (simulating browser eviction). (4) Asserts the mock handler was called with a string containing 'unexpectedly closed'. (5) Asserts that a subsequent `idbSet`/`idbGet` attempts to reopen (doesn't use the stale connection). Import `registerIdbErrorHandler` from the module. The test may need to access internals through the `_resetDbForTesting` pattern — check what's already exported. Tag one test `@smoke` if it exercises a broad code path.
- **Verification**: `npx vitest run src/tests/idbStorage.test.ts`

### TASK-010: Add src/main.ts to generate-test-map.mjs SOURCE_GROUPS
- **Status**: done
- **Dependencies**: none
- **Description**: In `scripts/generate-test-map.mjs`, add an entry to the `SOURCE_GROUPS` object (around line 186): `'app/main': ['src/main.ts'],`. This ensures the test-map generator classifies `src/main.ts` imports properly and maps `mainStartup.test.ts` to the `app/main` area. Also add `'ui/fatalError': ['src/ui/fatalError.ts'],` to SOURCE_GROUPS since it's a standalone utility not grouped with other UI utilities.
- **Verification**: `node scripts/generate-test-map.mjs --dry-run 2>&1 | grep -c "app/main"` should output 1

### TASK-011: Regenerate test-map.json
- **Status**: done
- **Dependencies**: TASK-001, TASK-010
- **Description**: Run `node scripts/generate-test-map.mjs` to regenerate `test-map.json`. Then verify the output contains the expected new areas: (1) `app/main` area with `src/main.ts` in sources and `src/tests/mainStartup.test.ts` in unit. (2) `core/previewLayout` area with `src/core/previewLayout.ts` in sources and `src/tests/previewLayout.test.ts` in unit. (3) `ui/notification` area with `src/ui/notification.ts` in sources and `src/tests/notification.test.ts` in unit. (4) `ui/fatalError` area with `src/ui/fatalError.ts` in sources. If any expected area is missing, investigate and fix the generator script.
- **Verification**: `node scripts/generate-test-map.mjs --dry-run 2>&1 | grep -E "(app/main|core/previewLayout|ui/notification|ui/fatalError)" | head -10`

### TASK-012: Final typecheck, lint, build, and smoke test verification
- **Status**: done
- **Dependencies**: TASK-003, TASK-004, TASK-005, TASK-006, TASK-008, TASK-009, TASK-011
- **Description**: Run the full verification suite to confirm all changes integrate cleanly: (1) `npm run typecheck` — zero errors. (2) `npm run lint` — zero errors. (3) `npm run build` — succeeds with no errors or warnings. (4) `npm run test:unit` — all tests pass. (5) `npm run test:smoke:unit` — includes the new @smoke-tagged tests in mainStartup.test.ts and previewLayout.test.ts. Fix any failures found.
- **Verification**: All five commands above pass with zero errors.
