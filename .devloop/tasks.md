# Iteration 15 — Tasks

### TASK-001: Add storageKey parameter to loadGame and exportSave
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/saveload.ts`, add an optional `storageKey?: string` parameter to `loadGame()` (line ~430) and `exportSave()` (line ~655). When provided, use it directly and skip `assertValidSlot()` + `slotKey()` derivation. Follow the exact pattern already used by `deleteSave()`: `const key = storageKey ?? (assertValidSlot(slotIndex), slotKey(slotIndex));`. Replace all subsequent uses of `slotKey(slotIndex)` in both functions with the resolved `key` variable. See requirements.md Section 1 for full context.
- **Verification**: `npx vitest run src/tests/saveload.test.ts`

### TASK-002: Wire mainmenu handlers to pass storageKey through
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: In `src/ui/mainmenu.ts`: (1) In `_handleLoad()` (line ~599), change `loadGame(slotIndex)` to `loadGame(slotIndex, storageKey)`. (2) In `_handleExport()` (line ~634), rename the parameter from `_storageKey` to `storageKey` and change `exportSave(slotIndex)` to `exportSave(slotIndex, storageKey)`. See requirements.md Section 1 for the bug flow.
- **Verification**: `npx tsc --noEmit src/ui/mainmenu.ts && npx vitest run src/tests/saveload.test.ts`

### TASK-003: Unit tests for overflow save load and export
- **Status**: pending
- **Dependencies**: TASK-002
- **Description**: Add unit tests to `src/tests/saveload.test.ts` covering: (1) Write a save to slot 7 via localStorage, then `loadGame(-1, 'spaceAgencySave_7')` returns a valid GameState. (2) Write to `spaceAgencySave_auto` key, load via `loadGame(-1, 'spaceAgencySave_auto')`. (3) `exportSave(-1, 'spaceAgencySave_7')` does not throw (mock `URL.createObjectURL` and `document.createElement('a')`). (4) Backward compat: `loadGame(0)` without storageKey still works for manual slots. See requirements.md Section 1 for details.
- **Verification**: `npx vitest run src/tests/saveload.test.ts`

### TASK-004: E2E test — load an overflow auto-save card
- **Status**: pending
- **Dependencies**: TASK-002
- **Description**: In `e2e/auto-save.spec.ts`, add a test (or extend the existing auto-save visibility test) that: (1) Seeds 5 full manual slots plus an auto-save in an overflow slot. (2) Navigates to the load screen and verifies the auto-save card is visible. (3) Clicks the Load button on the auto-save card. (4) Verifies the game starts — hub overlay is visible and agency name matches the seeded save. Tag with `@smoke`. See requirements.md Section 1.
- **Verification**: `npx playwright test e2e/auto-save.spec.ts`

### TASK-005: Stabilize flaky asteroid belt E2E test
- **Status**: done
- **Dependencies**: none
- **Description**: In `e2e/asteroid-belt.spec.ts`, in the test at line ~386 ("belt zones are defined on the Sun body with correct boundaries"), add `await page.waitForFunction(() => window.__celestialBodies?.SUN?.altitudeBands?.length > 0, { timeout: 10_000 })` before the `page.evaluate()` call that reads belt zone data. This fixes the race condition where the hub overlay appears before `__celestialBodies` is fully populated. See requirements.md Section 2.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.ts --grep "belt zones"`

### TASK-006: Notification stacking guard
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/ui/notification.ts`, fix the `showNotification()` function so that only one toast is visible at a time. (1) Add a `data-notification-toast` attribute to the toast div when creating it (e.g., `toast.setAttribute('data-notification-toast', '')`). (2) At the top of `showNotification()`, before creating the new toast element, remove any existing toast: `document.querySelector('[data-notification-toast]')?.remove()`. See requirements.md Section 3.
- **Verification**: `npx vitest run src/tests/ui-helpers.test.ts`

### TASK-007: Export cloneStaging and restoreStaging with unit tests
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/ui/vab/_undoActions.ts`, export the `cloneStaging()` and `restoreStaging()` functions (they are currently module-private). Then create `src/tests/undoActions.test.ts` with unit tests: (1) `cloneStaging` produces independent copy — mutating original doesn't affect clone. (2) Handles empty stages array and empty unstaged array. (3) `restoreStaging` overwrites target properties in-place. (4) Preserves target object reference (same `===` identity after restore). (5) Handles empty config. Import `StagingConfig` type from `src/core/rocketbuilder.ts` for test fixtures. See requirements.md Section 4a.
- **Verification**: `npx vitest run src/tests/undoActions.test.ts`

### TASK-008: Extract computeFrameStats from fpsMonitor with unit tests
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/ui/fpsMonitor.ts`, extract the stats computation loop from `recordFrame()` (lines 138-149) into a named export `computeFrameStats(frameTimes: Float64Array, count: number): { fps: number; avgFrameTime: number; minFrameTime: number; maxFrameTime: number }`. Update `recordFrame()` to call `computeFrameStats(_frameTimes, _frameCount)`. Then create `src/tests/fpsMonitor.test.ts` with unit tests: (1) count=0 returns all zeros. (2) Single frame: fps = 1000/frameTime. (3) Full buffer with varying times: correct min/max/avg. (4) Constant frame times: min === max === avg. See requirements.md Section 4b.
- **Verification**: `npx vitest run src/tests/fpsMonitor.test.ts`

### TASK-009: Convert ui/vab.ts static imports to dynamic
- **Status**: pending
- **Dependencies**: none
- **Description**: Eliminate the static imports of `src/ui/vab.ts` so it is only dynamically imported (fixing the Vite chunk-splitting warning). Two files need changes: (1) `src/ui/topbar.ts` (line ~33): Remove the static `import { syncVabToGameState } from '../ui/vab.ts'`. At the call site (line ~979), use `const { syncVabToGameState } = await import('./vab.ts');` then call it. Ensure the containing function is async. (2) `src/ui/flightController/_init.ts` (line ~20): Remove the static `import { getVabInventoryUsedParts } from '../vab.ts'`. At the call site (line ~180), use `const { getVabInventoryUsedParts } = await import('../vab.ts');` then call it. Ensure the containing function is async. See requirements.md Section 5.
- **Verification**: `npm run build 2>&1 | grep -i "vab" && npx tsc --noEmit`

### TASK-010: Remove redundant render/vab.ts dynamic import
- **Status**: pending
- **Dependencies**: TASK-009
- **Description**: In `src/ui/index.ts`, remove `render/vab.ts` from the dynamic `Promise.all` import (line ~341) since it is already statically loaded by `src/main.ts`. (1) Add a static import at the top: `import { showVabScene, hideVabScene } from '../render/vab.ts';` — these are the only two render/vab exports used in index.ts. (2) Remove the `_cachedVabRender` variable and its type annotation (line ~28). (3) Change the dynamic import from `Promise.all([import('./vab.ts'), import('../render/vab.ts')])` to just `import('./vab.ts')`. (4) Update the VAB navigation block (~lines 339-368): replace `_cachedVabRender?.showVabScene()` / `_cachedVabRender?.hideVabScene()` with direct calls to `showVabScene()` / `hideVabScene()`. The `vabRender` destructured variable and `_cachedVabRender = vabRender` assignment are deleted. (5) Update the other `_cachedVabRender?.hideVabScene()` calls at lines ~144, ~200, ~260 to use the static import directly. See requirements.md Section 5.
- **Verification**: `npm run build 2>&1 | grep -i "vab" && npx tsc --noEmit`

### TASK-011: Final typecheck, lint, and smoke test verification
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010
- **Description**: Run full verification suite to confirm no regressions: typecheck, lint, and smoke tests (unit + E2E). Fix any issues found.
- **Verification**: `npx tsc --noEmit && npm run lint && npm run test:smoke:unit && npm run test:smoke:e2e`
