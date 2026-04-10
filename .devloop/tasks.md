# Iteration 5 — Tasks

## Phase A: Foundations

### TASK-001: Implement settings schema migration chain
- **Status**: done
- **Dependencies**: none
- **Description**: Add a versioned migration chain to `src/core/settingsStore.ts`. Change `isValidEnvelope()` to accept `version <= SCHEMA_VERSION` (reject higher versions with a warning, reject version < 1). Add a `_migrateSettings(envelope)` function that sequentially applies migration functions from the stored version to `SCHEMA_VERSION`. Define a migration registry (array of `[fromVersion, migrationFn]` pairs). Call `_migrateSettings()` in `loadSettings()` after validation but before `mergeWithDefaults()`. No actual migrations are needed yet — just the infrastructure. See requirements §1.
- **Verification**: `npx vitest run src/tests/settingsStore.test.ts`

### TASK-002: Add unit tests for settings migration chain
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Add tests to `src/tests/settingsStore.test.ts` covering: envelope with version 0 is rejected, version 1 passes unchanged, version > SCHEMA_VERSION is rejected with warning, migration chain executes in order (test with mock migrations that increment a counter or transform a field), and `mergeWithDefaults()` still fills missing fields after migration. See requirements §1.
- **Verification**: `npx vitest run src/tests/settingsStore.test.ts`

### TASK-003: Tighten null guards in map.ts _drawBody and _drawShadow
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/render/map.ts`, change the guard in `_drawBody` (line 626) from `if (!_mapRoot) return` to `if (!_mapRoot || !_bodyGraphics) return` and remove the `!` non-null assertion on `_bodyGraphics`. Do the same in `_drawShadow` (line 1339): change to `if (!_mapRoot || !_shadowGraphics) return` and remove the `!` assertion on `_shadowGraphics`. See requirements §2.
- **Verification**: `npx vitest run src/tests/render-map-state.test.ts`

### TASK-004: Unify CrewMember and Astronaut types
- **Status**: done
- **Dependencies**: none
- **Description**: Merge all `Astronaut`-specific fields into `CrewMember` in `src/core/gameState.ts`. Handle the status type conflict (CrewStatus vs AstronautStatus) by adding a separate `careerStatus` field or widening appropriately — inspect runtime data to choose. Normalize `hiredDate`/`hireDate` to one name. Delete the `Astronaut` interface from `crew.ts`. Remove the `_crew()` cast helper and replace all usages with direct `state.crew` access. Update all source files and all test files that reference `Astronaut` to use `CrewMember`. Verify `as unknown as` count drops to 2. See requirements §3.
- **Verification**: `npm run typecheck && npx vitest run src/tests/crew.test.ts && npx vitest run src/tests/lifeSupport.test.ts`

### TASK-005: Convert vite.config.js to TypeScript
- **Status**: done
- **Dependencies**: none
- **Description**: Rename `vite.config.js` to `vite.config.ts`. Add type imports for Vite config types. Type the custom `jsToTsResolve` plugin's parameters and return values. Ensure the Vitest test configuration block is properly typed. No functional changes. See requirements §4.1.
- **Verification**: `npx vitest run src/tests/gameState.test.ts`

### TASK-006: Convert playwright.config.js to TypeScript and create e2e/tsconfig.json
- **Status**: done
- **Dependencies**: none
- **Description**: Rename `playwright.config.js` to `playwright.config.ts`. Add Playwright config type imports. Create `e2e/tsconfig.json` for E2E type checking (strict, noEmit, include `e2e/**/*.ts`, reference `@playwright/test` types). Update the `typecheck` script in `package.json` to also run `tsc --noEmit -p e2e/tsconfig.json`. Set `testMatch` in Playwright config to accept both `.js` and `.ts` specs during the transition. See requirements §4.2.
- **Verification**: `npm run typecheck`

## Phase B: Test Infrastructure

### TASK-007: Convert unit test setup helper (setup.ts) to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-004
- **Description**: Remove `// @ts-nocheck` from `src/tests/setup.ts`. Add proper type imports, type all exported functions with explicit return types and typed parameters, eliminate all `any` usage. This file is the shared test setup referenced by Vitest's `setupFiles` — all unit tests depend on it. See requirements §5.2.
- **Verification**: `npx vitest run src/tests/gameState.test.ts`

### TASK-008: Convert E2E helper _constants.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_constants.js` to `e2e/helpers/_constants.ts`. Add type annotations to all exported constants and enums. Add explicit types to any exported objects or arrays. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-009: Convert E2E helper _assertions.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_assertions.js` to `e2e/helpers/_assertions.ts`. Add Playwright type imports (`Page`, `Locator`, `expect`). Type all exported assertion functions with explicit parameter types and return types. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-010: Convert E2E helper _state.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_state.js` to `e2e/helpers/_state.ts`. Add Playwright type imports. Type all exported state management functions with explicit parameter types and return types. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-011: Convert E2E helper _factories.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_factories.js` to `e2e/helpers/_factories.ts`. Add Playwright type imports. Type all exported factory functions with explicit parameter types and return types. Use proper interfaces for factory output shapes. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-012: Convert E2E helper _saveFactory.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_saveFactory.js` to `e2e/helpers/_saveFactory.ts`. Add type imports for save-related types. Type all exported functions with explicit parameter types and return types. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-013: Convert E2E helper _navigation.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_navigation.js` to `e2e/helpers/_navigation.ts`. Add Playwright type imports (`Page`). Type all exported navigation functions with explicit parameter types and return types. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-014: Convert E2E helper _flight.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_flight.js` to `e2e/helpers/_flight.ts`. Add Playwright type imports. Type all exported flight helper functions with explicit parameter types and return types. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-015: Convert E2E helper _timewarp.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Rename `e2e/helpers/_timewarp.js` to `e2e/helpers/_timewarp.ts`. Add Playwright type imports. Type all exported timewarp functions with explicit parameter types and return types. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-016: Convert E2E barrel helpers.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015
- **Description**: Rename `e2e/helpers.js` to `e2e/helpers.ts`. Update re-export paths if needed for TypeScript module resolution. Add explicit type re-exports. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

### TASK-017: Convert E2E barrel fixtures.js to TypeScript
- **Status**: done
- **Dependencies**: TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015
- **Description**: Rename `e2e/fixtures.js` to `e2e/fixtures.ts`. Update any imports and re-exports for TypeScript module resolution. Add explicit types. Eliminate all `any`. See requirements §5.4.
- **Verification**: `npx playwright test e2e/smoke.spec.js --grep @smoke`

## Phase C: Unit Test Conversion

### TASK-018: Convert achievements.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/achievements.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/achievements.test.ts`

### TASK-019: Convert atmosphere.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/atmosphere.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/atmosphere.test.ts`

### TASK-020: Convert autoSave.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/autoSave.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/autoSave.test.ts`

### TASK-021: Convert bankruptcy.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/bankruptcy.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/bankruptcy.test.ts`

### TASK-022: Convert biomes.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/biomes.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/biomes.test.ts`

### TASK-023: Convert bodies.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/bodies.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/bodies.test.ts`

### TASK-024: Convert branchCoverage.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/branchCoverage.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/branchCoverage.test.ts`

### TASK-025: Convert challenges.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/challenges.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/challenges.test.ts`

### TASK-026: Convert collision.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/collision.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/collision.test.ts`

### TASK-027: Convert comms.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/comms.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/comms.test.ts`

### TASK-028: Convert construction.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/construction.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/construction.test.ts`

### TASK-029: Convert contracts.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/contracts.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/contracts.test.ts`

### TASK-030: Convert controlMode.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/controlMode.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/controlMode.test.ts`

### TASK-031: Convert crew.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/crew.test.ts`. Add proper type imports using the unified `CrewMember` type (after TASK-004 unification). Type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/crew.test.ts`

### TASK-032: Convert customChallenges.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/customChallenges.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/customChallenges.test.ts`

### TASK-033: Convert debugMode.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/debugMode.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/debugMode.test.ts`

### TASK-034: Convert designLibrary.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/designLibrary.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/designLibrary.test.ts`

### TASK-035: Convert docking.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/docking.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/docking.test.ts`

### TASK-036: Convert e2e-infrastructure.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/e2e-infrastructure.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/e2e-infrastructure.test.ts`

### TASK-037: Convert ejector.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ejector.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ejector.test.ts`

### TASK-038: Convert escapeHtml.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/escapeHtml.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/escapeHtml.test.ts`

### TASK-039: Convert finance.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/finance.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/finance.test.ts`

### TASK-040: Convert flightPhase.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/flightPhase.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/flightPhase.test.ts`

### TASK-041: Convert flightReturn.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/flightReturn.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/flightReturn.test.ts`

### TASK-042: Convert fuelsystem.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/fuelsystem.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/fuelsystem.test.ts`

### TASK-043: Convert gameState.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/gameState.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/gameState.test.ts`

### TASK-044: Convert grabbing.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/grabbing.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/grabbing.test.ts`

### TASK-045: Convert idbStorage.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/idbStorage.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/idbStorage.test.ts`

### TASK-046: Convert instruments.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/instruments.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/instruments.test.ts`

### TASK-047: Convert launchPadTiers.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/launchPadTiers.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/launchPadTiers.test.ts`

### TASK-048: Convert legs.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/legs.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/legs.test.ts`

### TASK-049: Convert lifeSupport.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/lifeSupport.test.ts`. Add proper type imports using the unified `CrewMember` type (after TASK-004 unification). Type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/lifeSupport.test.ts`

### TASK-050: Convert loopErrorHandling.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/loopErrorHandling.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/loopErrorHandling.test.ts`

### TASK-051: Convert malfunction.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/malfunction.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/malfunction.test.ts`

### TASK-052: Convert manoeuvre.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/manoeuvre.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/manoeuvre.test.ts`

### TASK-053: Convert mapView.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/mapView.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/mapView.test.ts`

### TASK-054: Convert mccTiers.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/mccTiers.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/mccTiers.test.ts`

### TASK-055: Convert missions.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/missions.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/missions.test.ts`

### TASK-056: Convert multiBodyLanding.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/multiBodyLanding.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/multiBodyLanding.test.ts`

### TASK-057: Convert orbit.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/orbit.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/orbit.test.ts`

### TASK-058: Convert parachute-deploy.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/parachute-deploy.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/parachute-deploy.test.ts`

### TASK-059: Convert parachute-descent.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/parachute-descent.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/parachute-descent.test.ts`

### TASK-060: Convert parachute-landing.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/parachute-landing.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/parachute-landing.test.ts`

### TASK-061: Convert partInventory.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/partInventory.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/partInventory.test.ts`

### TASK-062: Convert parts.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/parts.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/parts.test.ts`

### TASK-063: Convert period.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/period.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/period.test.ts`

### TASK-064: Convert physics.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/physics.test.ts`. Add proper type imports for `PhysicsState`, `CapturedBody`, and other physics types. Type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/physics.test.ts`

### TASK-065: Convert physicsWorker.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/physicsWorker.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/physicsWorker.test.ts`

### TASK-066: Convert physicsWorkerCommand.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/physicsWorkerCommand.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/physicsWorkerCommand.test.ts`

### TASK-067: Convert pool.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/pool.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/pool.test.ts`

### TASK-068: Convert power.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/power.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/power.test.ts`

### TASK-069: Convert render-asteroids.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-asteroids.test.ts`. Add proper type imports for render and asteroid types. Type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-asteroids.test.ts`

### TASK-070: Convert render-camera.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-camera.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-camera.test.ts`

### TASK-071: Convert render-constants.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-constants.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-constants.test.ts`

### TASK-072: Convert render-flight-pool.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-flight-pool.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-flight-pool.test.ts`

### TASK-073: Convert render-ground.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-ground.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-ground.test.ts`

### TASK-074: Convert render-input.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-input.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-input.test.ts`

### TASK-075: Convert render-map-state.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-map-state.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-map-state.test.ts`

### TASK-076: Convert render-sky.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-sky.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-sky.test.ts`

### TASK-077: Convert render-state.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-state.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-state.test.ts`

### TASK-078: Convert render-trails.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/render-trails.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/render-trails.test.ts`

### TASK-079: Convert reputation.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/reputation.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/reputation.test.ts`

### TASK-080: Convert rocketbounds.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/rocketbounds.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/rocketbounds.test.ts`

### TASK-081: Convert rocketbuilder.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/rocketbuilder.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/rocketbuilder.test.ts`

### TASK-082: Convert rocketvalidator.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/rocketvalidator.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/rocketvalidator.test.ts`

### TASK-083: Convert sandbox.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/sandbox.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/sandbox.test.ts`

### TASK-084: Convert satellites.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/satellites.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/satellites.test.ts`

### TASK-085: Convert saveload.test.ts to strict TypeScript
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/saveload.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/saveload.test.ts`

### TASK-086: Convert sciencemodule.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/sciencemodule.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/sciencemodule.test.ts`

### TASK-087: Convert setup.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/setup.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/setup.test.ts`

### TASK-088: Convert staging.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/staging.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/staging.test.ts`

### TASK-089: Convert storageErrors.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/storageErrors.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/storageErrors.test.ts`

### TASK-090: Convert surfaceOps.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/surfaceOps.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/surfaceOps.test.ts`

### TASK-091: Convert techtree.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/techtree.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/techtree.test.ts`

### TASK-092: Convert trackingStationTiers.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/trackingStationTiers.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/trackingStationTiers.test.ts`

### TASK-093: Convert ui-escapeHtml.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-escapeHtml.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-escapeHtml.test.ts`

### TASK-094: Convert ui-fcState.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-fcState.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-fcState.test.ts`

### TASK-095: Convert ui-fpsMonitor.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-fpsMonitor.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-fpsMonitor.test.ts`

### TASK-096: Convert ui-listenerTracker.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-listenerTracker.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-listenerTracker.test.ts`

### TASK-097: Convert ui-mapView.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-mapView.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-mapView.test.ts`

### TASK-098: Convert ui-mcState.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-mcState.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-mcState.test.ts`

### TASK-099: Convert ui-rocketCardUtil.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-rocketCardUtil.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-rocketCardUtil.test.ts`

### TASK-100: Convert ui-timeWarp.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-timeWarp.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-timeWarp.test.ts`

### TASK-101: Convert ui-vabStaging.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-vabStaging.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-vabStaging.test.ts`

### TASK-102: Convert ui-vabState.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-vabState.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-vabState.test.ts`

### TASK-103: Convert ui-vabUndoActions.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/ui-vabUndoActions.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/ui-vabUndoActions.test.ts`

### TASK-104: Convert undoRedo.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/undoRedo.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/undoRedo.test.ts`

### TASK-105: Convert vabTiers.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/vabTiers.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/vabTiers.test.ts`

### TASK-106: Convert weather.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/weather.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/weather.test.ts`

### TASK-107: Convert workerBridgeTimeout.test.ts to strict TypeScript
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Remove `// @ts-nocheck` from `src/tests/workerBridgeTimeout.test.ts`. Add proper type imports, type all local helper functions with explicit return types, type mock objects and fixtures using real interfaces, eliminate all `any` usage. Use `// @ts-expect-error` for intentional invalid-input tests. See requirements §5.3.
- **Verification**: `npx vitest run src/tests/workerBridgeTimeout.test.ts`

## Phase D: E2E Spec Conversion

### TASK-108: Convert additional-systems.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/additional-systems.spec.js` to `e2e/additional-systems.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. Use `// @ts-expect-error` for intentional edge cases. See requirements §5.5.
- **Verification**: `npx playwright test e2e/additional-systems.spec.ts`

### TASK-109: Convert agency-depth.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/agency-depth.spec.js` to `e2e/agency-depth.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/agency-depth.spec.ts`

### TASK-110: Convert asteroid-belt.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/asteroid-belt.spec.js` to `e2e/asteroid-belt.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.ts`

### TASK-111: Convert auto-save.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/auto-save.spec.js` to `e2e/auto-save.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/auto-save.spec.ts`

### TASK-112: Convert biomes-science.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/biomes-science.spec.js` to `e2e/biomes-science.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/biomes-science.spec.ts`

### TASK-113: Convert collision.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/collision.spec.js` to `e2e/collision.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/collision.spec.ts`

### TASK-114: Convert context-menu.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/context-menu.spec.js` to `e2e/context-menu.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/context-menu.spec.ts`

### TASK-115: Convert core-mechanics.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/core-mechanics.spec.js` to `e2e/core-mechanics.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/core-mechanics.spec.ts`

### TASK-116: Convert crew.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/crew.spec.js` to `e2e/crew.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/crew.spec.ts`

### TASK-117: Convert debug-mode.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/debug-mode.spec.js` to `e2e/debug-mode.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/debug-mode.spec.ts`

### TASK-118: Convert destinations.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/destinations.spec.js` to `e2e/destinations.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/destinations.spec.ts`

### TASK-119: Convert facilities-infrastructure.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/facilities-infrastructure.spec.js` to `e2e/facilities-infrastructure.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/facilities-infrastructure.spec.ts`

### TASK-120: Convert failure-paths.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/failure-paths.spec.js` to `e2e/failure-paths.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/failure-paths.spec.ts`

### TASK-121: Convert flight-mission.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/flight-mission.spec.js` to `e2e/flight-mission.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/flight-mission.spec.ts`

### TASK-122: Convert flight.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/flight.spec.js` to `e2e/flight.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/flight.spec.ts`

### TASK-123: Convert fps-monitor.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/fps-monitor.spec.js` to `e2e/fps-monitor.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/fps-monitor.spec.ts`

### TASK-124: Convert help.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/help.spec.js` to `e2e/help.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/help.spec.ts`

### TASK-125: Convert hub-navigation.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/hub-navigation.spec.js` to `e2e/hub-navigation.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/hub-navigation.spec.ts`

### TASK-126: Convert keyboard-nav.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/keyboard-nav.spec.js` to `e2e/keyboard-nav.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/keyboard-nav.spec.ts`

### TASK-127: Convert landing.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/landing.spec.js` to `e2e/landing.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/landing.spec.ts`

### TASK-128: Convert launchpad-relaunch.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/launchpad-relaunch.spec.js` to `e2e/launchpad-relaunch.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/launchpad-relaunch.spec.ts`

### TASK-129: Convert launchpad.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/launchpad.spec.js` to `e2e/launchpad.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/launchpad.spec.ts`

### TASK-130: Convert mission-progression.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/mission-progression.spec.js` to `e2e/mission-progression.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/mission-progression.spec.ts`

### TASK-131: Convert missions.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/missions.spec.js` to `e2e/missions.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/missions.spec.ts`

### TASK-132: Convert newgame.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/newgame.spec.js` to `e2e/newgame.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/newgame.spec.ts`

### TASK-133: Convert orbital-operations.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/orbital-operations.spec.js` to `e2e/orbital-operations.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/orbital-operations.spec.ts`

### TASK-134: Convert part-reconnection.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/part-reconnection.spec.js` to `e2e/part-reconnection.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/part-reconnection.spec.ts`

### TASK-135: Convert phase-transitions.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/phase-transitions.spec.js` to `e2e/phase-transitions.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/phase-transitions.spec.ts`

### TASK-136: Convert relaunch.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/relaunch.spec.js` to `e2e/relaunch.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/relaunch.spec.ts`

### TASK-137: Convert reliability-risk.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/reliability-risk.spec.js` to `e2e/reliability-risk.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/reliability-risk.spec.ts`

### TASK-138: Convert rocketbuilder.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/rocketbuilder.spec.js` to `e2e/rocketbuilder.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/rocketbuilder.spec.ts`

### TASK-139: Convert sandbox-replayability.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/sandbox-replayability.spec.js` to `e2e/sandbox-replayability.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/sandbox-replayability.spec.ts`

### TASK-140: Convert save-version.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/save-version.spec.js` to `e2e/save-version.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/save-version.spec.ts`

### TASK-141: Convert saveload.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/saveload.spec.js` to `e2e/saveload.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/saveload.spec.ts`

### TASK-142: Convert scene-cleanup.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/scene-cleanup.spec.js` to `e2e/scene-cleanup.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/scene-cleanup.spec.ts`

### TASK-143: Convert smoke.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/smoke.spec.js` to `e2e/smoke.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/smoke.spec.ts`

### TASK-144: Convert test-infrastructure.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/test-infrastructure.spec.js` to `e2e/test-infrastructure.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/test-infrastructure.spec.ts`

### TASK-145: Convert tipping.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/tipping.spec.js` to `e2e/tipping.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/tipping.spec.ts`

### TASK-146: Convert tutorial-revisions.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/tutorial-revisions.spec.js` to `e2e/tutorial-revisions.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/tutorial-revisions.spec.ts`

### TASK-147: Convert vab-undo.spec.js to TypeScript
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017
- **Description**: Rename `e2e/vab-undo.spec.js` to `e2e/vab-undo.spec.ts`. Delete the original `.js` file. Add Playwright type imports, import typed helpers from the converted barrel exports, type all local helper functions and variables, eliminate all `any` usage. See requirements §5.5.
- **Verification**: `npx playwright test e2e/vab-undo.spec.ts`

## Phase E: Enforcement & Verification

### TASK-148: Escalate ESLint no-explicit-any to error for test files
- **Status**: pending
- **Dependencies**: TASK-107, TASK-147
- **Description**: In `eslint.config.js`, change the `@typescript-eslint/no-explicit-any` rule from `warn` to `error` in the test file override (lines 152-160). This prevents regression — no `any` can be reintroduced in test code. Also add E2E test files (`e2e/**/*.ts`) to the TypeScript lint rules if not already covered. See requirements §6.
- **Verification**: `npm run lint`

### TASK-149: Final verification pass
- **Status**: pending
- **Dependencies**: TASK-148
- **Description**: Run the full verification suite from requirements §7. Confirm: `npm run typecheck` passes (including E2E), `npm run lint` passes, `npm run test:unit` passes, `npm run test:e2e` passes, `npm run build` succeeds. Verify zero `// @ts-nocheck` in source or test files, zero `.js` files in `e2e/`, zero `any` in test code, and `as unknown as` count in production source is <= 2.
- **Verification**: `npm run typecheck && npm run lint && npm run test:unit && npm run test:e2e && npm run build`
