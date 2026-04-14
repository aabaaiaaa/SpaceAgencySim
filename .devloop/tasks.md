# Iteration 13 — Tasks

### TASK-001: Fix deployOutpostCore() environment scaling bug
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/hubs.ts` at line 268, `deployOutpostCore()` deducts the base Crew Hab money cost without multiplying by `envMultiplier`. Apply `getEnvironmentCostMultiplier(flight.bodyId)` to the money cost, matching the pattern already used in `createHub()` (line 116) and `startFacilityUpgrade()` (line 457). Add unit tests verifying: Mars deployment deducts 1.3x base cost, Moon deducts 1.0x, and deducted amount matches the construction project's recorded `moneyCost`. See requirements.md §1.
- **Verification**: `npx vitest run src/tests/hubs-construction.test.ts` — new env scaling tests pass, existing tests still pass.

### TASK-002: Add unit tests for UI helper functions
- **Status**: done
- **Dependencies**: none
- **Description**: Add targeted unit tests for testable UI helpers to improve `src/ui/**` coverage. Focus on pure logic and DOM-light functions: loading indicator (`showLoadingIndicator`/`hideLoadingIndicator` idempotency), hub management display helpers (`_formatMoney`, `_getStatusInfo`, `_addGridRow`), body color helper (`getBodyColor` with CSS var reading and fallback), and any untested schematic layout pure computation functions. See requirements.md §2.
- **Verification**: `npx vitest run src/tests/ui-helpers.test.ts` — all new tests pass (create this file if it doesn't exist, or add to the most appropriate existing test file).

### TASK-003: Add unit tests for render helper functions
- **Status**: done
- **Dependencies**: none
- **Description**: Add targeted unit tests for testable render helpers to improve `src/render/**` coverage. Focus on pure math/computation helpers and layout calculation functions that don't require a PixiJS context. Grep `src/render/` for exported functions that take data and return values (positions, sizes, colors, etc.) without touching the canvas. See requirements.md §2.
- **Verification**: `npx vitest run src/tests/render-helpers.test.ts` — all new tests pass (create this file if it doesn't exist, or add to the most appropriate existing test file).

### TASK-004: Update coverage thresholds and suppress chunk size warning
- **Status**: pending
- **Dependencies**: TASK-002, TASK-003
- **Description**: After the new tests from TASK-002 and TASK-003 are in place, run `npx vitest run --coverage` and read the actual coverage percentages for `src/render/**` and `src/ui/**`. Update the 5 failing thresholds in `vite.config.ts` (lines 122-138) to be 1-2% below the measured values. Also add `chunkSizeWarningLimit: 600` to the `build` config as a sibling to `rollupOptions`. See requirements.md §2 and §3.
- **Verification**: `npx vitest run --coverage` exits cleanly with no threshold failures. `npm run build` produces no chunk size warnings.

### TASK-005: Add nextHubId counter to GameState
- **Status**: done
- **Dependencies**: none
- **Description**: Add `nextHubId: number` field to the `GameState` interface in `src/core/gameState.ts`. Initialize to `1` in `createGameState()`. Earth hub keeps its hardcoded `EARTH_HUB_ID` — the counter is only for dynamically-created hubs. Bump `SAVE_VERSION` by 1 since the state shape changed. See requirements.md §5.
- **Verification**: `npx tsc --noEmit` passes. `npx vitest run src/tests/gameState.test.ts` — existing tests pass (may need `nextHubId` added to test factories).

### TASK-006: Update createHub() to use sequential hub IDs
- **Status**: pending
- **Dependencies**: TASK-005
- **Description**: In `src/core/hubs.ts`, update `createHub()` (currently line 91) to replace `'hub-' + Date.now() + '-' + random` with `'hub-' + state.nextHubId`, then increment `state.nextHubId`. Update unit test factories in `src/tests/_factories.ts` — `makeGameState()` should include `nextHubId`, and any factory that creates hubs should set appropriate counter values. Update any tests that assert on hub ID format (regex matching the old pattern). See requirements.md §5.
- **Verification**: `npx vitest run src/tests/hubs-construction.test.ts src/tests/hubs.test.ts` — all pass with new deterministic IDs.

### TASK-007: Update E2E factories for sequential hub IDs and new save version
- **Status**: pending
- **Dependencies**: TASK-005, TASK-006
- **Description**: Update E2E test factories in `e2e/helpers/_saveFactory.ts` and `e2e/helpers/_factories.ts` to include `nextHubId` in save state and use the updated `SAVE_VERSION`. Ensure `buildSaveEnvelope()` produces valid saves. Run targeted E2E tests that exercise save/load to verify.
- **Verification**: `npx playwright test e2e/saveload.spec.ts` — save/load E2E tests pass with new format.

### TASK-008: Create hubManagement sub-module directory and barrel
- **Status**: done
- **Dependencies**: none
- **Description**: Create the `src/ui/hubManagement/` directory structure. Move the current `src/ui/hubManagement.ts` content into sub-modules: `_panel.ts` (main panel orchestration: show/hide, build, refresh, module state variables, `_formatMoney`), `_header.ts` (header with name editing, blur-to-save, name error display), `_sections.ts` (info grid, facilities, population, economy section builders), `_dialogs.ts` (reactivate and abandon confirmation dialogs). Create barrel `src/ui/hubManagement.ts` that re-exports `showHubManagementPanel` and `hideHubManagementPanel` from the sub-modules. No external callers should need import path changes. See requirements.md §4.
- **Verification**: `npx tsc --noEmit` passes. `npx vitest run src/tests/hubManagement.test.ts` — existing tests pass (if any). Grep confirms no import path changes needed outside `src/ui/hubManagement/`.

### TASK-008a: Verify hub management panel split doesn't break E2E
- **Status**: pending
- **Dependencies**: TASK-008
- **Description**: Run the hub management E2E tests to verify the sub-module split didn't break any UI behavior. The barrel re-export should make this transparent, but confirm with a targeted E2E run.
- **Verification**: `npx playwright test e2e/hub-management.spec.ts` — all tests pass.

### TASK-009: Add route leg chaining validation
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/core/routes.ts`, add a `validateLegChaining(legs)` helper that returns `true` if every adjacent leg pair has matching destination→origin (`bodyId` and `locationType` match; `hubId` checked if both non-null). Apply this validation in `createRoute()` — reject route creation if legs don't chain. Apply in `processRoutes()` alongside the existing hub-existence check — mark unchained routes as `status: 'broken'`. See requirements.md §6.
- **Verification**: `npx vitest run src/tests/routes.test.ts` — existing route tests pass (no regressions).

### TASK-010: Unit tests for route leg chaining validation
- **Status**: pending
- **Dependencies**: TASK-009
- **Description**: Add unit tests for the leg chaining validation: valid 2-leg chain passes, valid 3-leg chain passes, broken chain (mismatched body) rejected, single-leg route passes, hub ID mismatch on same body handled correctly, `processRoutes()` marks unchained route as broken. See requirements.md §6.
- **Verification**: `npx vitest run src/tests/routes.test.ts` — all new chaining tests pass.

### TASK-011: Final typecheck, lint, and smoke test verification
- **Status**: pending
- **Dependencies**: TASK-001, TASK-004, TASK-006, TASK-007, TASK-008a, TASK-010
- **Description**: Run the full verification suite to confirm all iteration 13 changes integrate cleanly. Fix any issues found.
- **Verification**: `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors), `npm run build` (no warnings), `npm run test:smoke:unit` (all pass).
