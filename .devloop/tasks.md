# Iteration 16 — Tasks

### TASK-001: Upgrade Vite from v6 to v8
- **Status**: done
- **Dependencies**: none
- **Description**: Upgrade Vite to the latest v8 release. Review Vite 7 and 8 migration guides for breaking changes. Update `vite.config.ts` if any config options changed. Verify `resolve.extensions` still works for .ts resolution from .js specifiers. See requirements.md section 1a.
- **Verification**: `npm run build` succeeds with 0 errors/warnings and `npm run dev` starts without errors. Run `npx vite --version` to confirm v8.

### TASK-002: Upgrade Vitest from v3 to v4
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Upgrade Vitest to the latest v4 release. Upgrade `@vitest/coverage-v8` to the matching version. Update `vite.config.ts` line 1 import if the `vitest/config` re-export changed. Update any changed CLI flags in `package.json` scripts. See requirements.md section 1b.
- **Verification**: `npm run test:unit` — all unit tests pass. `npx vitest --version` confirms v4.

### TASK-003: Update remaining dependencies to latest versions
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: Update `@playwright/test`, `pixi.js`, `eslint`, `@typescript-eslint/*`, `jsdom`, `globals`, `lz-string`, and `typescript` to their latest compatible versions. Run `npx playwright install` if Playwright was updated. See requirements.md section 1c.
- **Verification**: `npm run build && npm run typecheck && npm run lint && npm run test:unit` — all pass.

### TASK-004: Add getAllKeys to idbStorage.ts
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: The existing `idbStorage.ts` provides `idbSet`, `idbGet`, `idbDelete`, and `isIdbAvailable`. Add an `idbGetAllKeys()` function that returns all keys from the IDB object store. This is needed for `listSaves()` and `discoverOverflowKeys()` which currently scan localStorage keys. Also update module comments to reflect IDB is now the primary (and only) storage backend — remove "mirror" language and fallback references. See requirements.md section 2a.
- **Verification**: `npx vitest run src/tests/idbStorage.test.ts` — existing tests pass plus new test for `idbGetAllKeys()`.

### TASK-005: Migrate saveload.ts from localStorage to IndexedDB
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Replace all `localStorage.getItem`/`setItem`/`removeItem` calls in `saveload.ts` with `idbGet`/`idbSet`/`idbDelete`. Key changes: `_persistCompressed()` writes to IDB only; `loadGame()` reads from IDB only (remove dual-source logic and sync-back); `deleteSave()` uses `idbDelete`; `exportSave()` reads from IDB; `listSaves()`/`discoverOverflowKeys()` use `idbGetAllKeys()` to scan keys. All public functions are already async. See requirements.md section 2b.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` — all non-removed tests pass (some tests will be updated in TASK-010).

### TASK-006: Migrate autoSave.ts from localStorage to IndexedDB
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Replace all localStorage calls in `autoSave.ts` with IDB equivalents. `_findAutoSaveKey()` scans IDB; `triggerAutoSave()` writes to IDB only; `hasAutoSave()` checks IDB (becomes async — update callers); `deleteAutoSave()` removes from IDB. See requirements.md section 2c.
- **Verification**: `npx vitest run src/tests/autoSave.test.ts` — all tests pass.

### TASK-007: Migrate settingsStore.ts from localStorage to IndexedDB
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Replace localStorage with IDB for settings persistence. `loadSettings()` reads from IDB (async). `persistSettings()` writes to IDB. `_hasExistingSettings()` checks IDB. Implement an in-memory cache: settings are loaded from IDB once at init (awaited), then served synchronously from cache. Only writes go to IDB. This preserves the current synchronous read pattern for consumers. See requirements.md section 2d.
- **Verification**: `npx vitest run src/tests/settingsStore.test.ts` — all tests pass.

### TASK-008: Migrate designLibrary.ts from localStorage to IndexedDB
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Replace localStorage with IDB in `loadSharedLibrary()` and `saveSharedLibrary()`. These become async — update callers (`saveDesignToSharedLibrary`, `deleteDesignFromSharedLibrary`, `getAllDesigns`, etc.) to await. See requirements.md section 2e.
- **Verification**: `npx vitest run src/tests/designLibrary.test.ts` — all tests pass.

### TASK-009: Update mainmenu.ts for IDB-based save discovery
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: `mainmenu.ts` calls `listSaves()` and `discoverOverflowKeys()` to populate the load screen. These are now async IDB-backed (changed in TASK-005). Ensure `mainmenu.ts` awaits these calls correctly. The load screen rendering should handle the async data fetch. See requirements.md section 2f.
- **Verification**: `npm run typecheck` passes with no errors in `mainmenu.ts`.

### TASK-010: Update saveload.test.ts for IDB and remove backward-compat tests
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Two changes: (1) Rewrite all 48 localStorage references in `saveload.test.ts` to use an IDB mock (e.g. `fake-indexeddb` or the existing test mock pattern). All save round-trip, corruption, version-check, and overflow tests must work against IDB. (2) Remove backward-compat tests: the `loadGame(0) without storageKey` test at line 1908, the `backward compatibility with uncompressed saves` describe block at lines 1417-1470, and the `imports a legacy JSON envelope string` test at line 1655. Keep all version-rejection tests (lines 918, 1032, 1045) and the incompatible-saves-appear-in-UI test (line 619). See requirements.md sections 2h and 3.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` — all remaining tests pass, no localStorage references remain.

### TASK-011: Update remaining unit tests for IDB
- **Status**: done
- **Dependencies**: TASK-006, TASK-007, TASK-008
- **Description**: Update storage mocking in `autoSave.test.ts`, `settingsStore.test.ts`, `designLibrary.test.ts`, `storageErrors.test.ts`, and `debugMode.test.ts` to use IDB instead of localStorage. See requirements.md section 2h.
- **Verification**: `npx vitest run src/tests/autoSave.test.ts src/tests/settingsStore.test.ts src/tests/designLibrary.test.ts src/tests/storageErrors.test.ts src/tests/debugMode.test.ts` — all pass.

### TASK-012: Update E2E test helpers for IDB save seeding
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: 9 E2E spec files seed saves via `localStorage.setItem()` in `page.evaluate()`. Update the E2E save seeding helper in `e2e/helpers/_saveFactory.ts` and/or `e2e/helpers/_state.ts` to seed saves into IndexedDB instead. IDB operations in `page.evaluate()` are async — ensure all seeding calls use `await`. Update all 9 E2E specs that seed saves: `auto-save.spec.ts`, `saveload.spec.ts`, `agency-depth.spec.ts`, `mission-progression.spec.ts`, `save-version.spec.ts`, `launchpad.spec.ts`, `newgame.spec.ts`, and any others found in `e2e/helpers/_saveFactory.ts` or `_state.ts`. See requirements.md section 2g.
- **Verification**: `npx playwright test e2e/saveload.spec.ts e2e/auto-save.spec.ts` — both pass.

### TASK-013: Remove backward-compat code from saveload.ts
- **Status**: done
- **Dependencies**: TASK-005, TASK-010
- **Description**: Remove backward-compatibility code from `saveload.ts`: (1) Delete `loadGameAsync` export alias (line 550). (2) Delete `_importLegacyJson()` function (line 809) and the fallback call to it in the import flow. (3) In `decompressSaveData()` (line 389), remove the uncompressed-save fallback — if the compressed prefix is missing, throw an error (treat as corrupt data). Keep all version-check logic. See requirements.md section 3.
- **Verification**: `npx vitest run src/tests/saveload.test.ts && npm run typecheck` — all tests pass, no type errors. Grep for `loadGameAsync`, `_importLegacyJson`, and `legacy` in `saveload.ts` returns no results.

### TASK-014: Add totalMass guard in physics.ts
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: At `src/core/physics.ts:1214-1215`, add a guard against `totalMass <= 0` to prevent NaN/Infinity from division by zero. Use the same pattern as lines 1023, 1081, 1127, 1463: `if (totalMass <= 0)` set `accX = 0; accY = 0` instead of dividing. Add a unit test: create a physics state where `totalMass` is 0 and verify `tick()` produces finite position/velocity values. See requirements.md section 4.
- **Verification**: `npx vitest run src/tests/physics.test.ts --testNamePattern "totalMass"` — new test passes.

### TASK-015: HTML-escape data-key attributes in mainmenu.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: At `src/ui/mainmenu.ts:390-392`, the `data-key="${summary.storageKey}"` interpolation doesn't use `escapeHtml()` (which is already imported). Wrap `summary.storageKey` with `escapeHtml()` in all three button template literals (Load, Export, Delete). See requirements.md section 5.
- **Verification**: `npm run typecheck` passes. Grep for `data-key=` in `mainmenu.ts` shows `escapeHtml` applied to all instances.

### TASK-016: Implement notification stacking queue
- **Status**: pending
- **Dependencies**: TASK-002
- **Description**: Replace the single-toast notification system in `src/ui/notification.ts` with a stacking queue. Multiple toasts stack vertically from the bottom of the screen. Each auto-dismisses after 4 seconds with the existing 0.3s fade-out. New toasts appear at the bottom; existing toasts shift up. When a toast dismisses, remaining toasts shift down. Cap at 5 visible toasts — oldest removed when cap is exceeded. See requirements.md section 6.
- **Verification**: `npx vitest run src/tests/notification.test.ts` — all tests pass.

### TASK-017: Create notification unit tests
- **Status**: pending
- **Dependencies**: TASK-016
- **Description**: Create `src/tests/notification.test.ts` with unit tests for the notification stacking queue: (1) Single notification creates one toast element. (2) Two notifications create two toast elements. (3) Toasts are stacked with different bottom positions. (4) After 4+ seconds, toasts are removed from DOM (use `vi.useFakeTimers`). (5) Maximum cap (5) is enforced — adding beyond the cap removes the oldest. See requirements.md section 6.
- **Verification**: `npx vitest run src/tests/notification.test.ts` — all tests pass.

### TASK-018: Fix CLAUDE.md inaccuracies
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002
- **Description**: Update the root `CLAUDE.md` to reflect current reality: (1) Line 98 — replace `jsToTsResolve` plugin reference with `resolve.extensions` in `vite.config.ts`. (2) Architecture section — remove "the rest remain JS with JSDoc types"; all modules are TypeScript. (3) Module listings — update any `.js` extensions to `.ts`. (4) TypeScript & Linting section — remove "Four core modules are TypeScript. The rest of the codebase remains JavaScript." (5) Testing section — update `.spec.js` references to `.spec.ts`. (6) Update any version-specific references to match new Vite/Vitest versions. See requirements.md section 7.
- **Verification**: Grep CLAUDE.md for `\.js`, `remain JS`, `jsToTsResolve`, `remains JavaScript` — no matches (except in code examples where `.js` in import specifiers is still accurate if applicable).

### TASK-019: Audit and update coverage exclusion list
- **Status**: pending
- **Dependencies**: TASK-002
- **Description**: Review the coverage exclusion list at `vite.config.ts:34-94` against the actual file tree. Remove entries for files that no longer exist (stale entries). Add entries for any new DOM-heavy or PixiJS-heavy files that should be excluded but aren't. Verify no testable pure-logic modules are incorrectly excluded. Consider consolidating patterns where possible (e.g., barrel re-exports). See requirements.md section 8.
- **Verification**: `npm run test:unit` — all tests pass, coverage thresholds still met. Every file in the exclusion list exists on disk.

### TASK-020: Final typecheck, lint, build, and smoke test verification
- **Status**: pending
- **Dependencies**: TASK-003, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019
- **Description**: Run the full verification suite to confirm all iteration 16 changes work together. This is the final gate before the iteration is complete.
- **Verification**: `npm run build && npm run typecheck && npm run lint && npm run test:unit && npm run test:smoke:e2e` — all pass with 0 errors.
