# Iteration 5 — TypeScript Hardening & Remaining Stabilization

This iteration has two goals: resolve the three outstanding technical debt items from the iteration 4 review, and convert the entire test codebase to strict TypeScript. The stabilization work (settings migration, null guards, type unification) is modest. The TypeScript conversion is high-volume — 143 files across unit tests, E2E specs, helpers, and config — but each individual file is a small, mechanical task.

The codebase currently has 95 unit test files (all `.ts` but 90 with `// @ts-nocheck`), 40 E2E spec files (all `.js`), 12 E2E helper/barrel files (all `.js`), 2 config files (`.js`), and 1 unit test setup helper (`.ts` with `@ts-nocheck`). After this iteration, every test-related file will be strict TypeScript with no `any`, no `@ts-nocheck`, and full type coverage enforced by ESLint.

---

## 1. Settings Schema Migration Chain

**Problem:** `settingsStore.ts` validates `version === SCHEMA_VERSION` in `isValidEnvelope()` (line 167-176) but has no migration path. The first time `SCHEMA_VERSION` increments, all existing user settings will silently reset to defaults because the strict equality check rejects older versions. This is the most time-sensitive architectural gap in the codebase.

**Current state:**
- `SCHEMA_VERSION = 1` (line 29)
- `PersistedSettings` interface has 5 fields: `difficultySettings`, `autoSaveEnabled`, `debugMode`, `showPerfDashboard`, `malfunctionMode`
- Settings are wrapped in `SettingsEnvelope { version: number; settings: PersistedSettings }`
- `isValidEnvelope()` returns `false` if version doesn't match — `loadSettings()` then returns defaults
- `mergeWithDefaults()` already fills missing fields, but is only called after validation passes

**Approach:** Model the migration chain after the existing `_applySaveMigrations` pattern in `saveload.ts`, but with versioned migration functions rather than unconditional `??=` defaults. The settings schema is simpler and more likely to have breaking changes (field renames, type changes), so explicit per-version migrations are safer.

**Implementation:**
1. Change `isValidEnvelope()` to accept `version <= SCHEMA_VERSION` (not strict equality). Reject `version > SCHEMA_VERSION` with a warning. Reject `version < 1` as invalid.
2. Add a `_migrateSettings(envelope: SettingsEnvelope): SettingsEnvelope` function that sequentially applies migrations from the stored version to `SCHEMA_VERSION`.
3. Define a migration registry — an array or map of `[fromVersion, migrationFn]` pairs. Each migration transforms the settings from version N to N+1.
4. Call `_migrateSettings()` in `loadSettings()` after validation but before `mergeWithDefaults()`.
5. No actual migrations are needed yet (current version is 1). The infrastructure must be in place so the next schema change just adds a migration function.
6. Add unit tests: verify that an envelope with `version: 0` is rejected, `version: 1` passes through unchanged, `version: 2` (future) is rejected with a warning, and the migration chain executes in order when multiple migrations exist (test with mock migrations).

---

## 2. Map Renderer Null Guards

**Problem:** `_drawBody` (line 626) and `_drawShadow` (line 1339) in `src/render/map.ts` guard `_mapRoot` but use `_bodyGraphics!` and `_shadowGraphics!` with non-null assertions. During rapid destroy/init transitions, `_mapRoot` could be truthy while the individual graphics are null, causing a crash.

**Fix:** Change the guards to also check the relevant graphics object:
- `_drawBody`: `if (!_mapRoot || !_bodyGraphics) return;` — then remove the `!` assertion on `_bodyGraphics`
- `_drawShadow`: `if (!_mapRoot || !_shadowGraphics) return;` — then remove the `!` assertion on `_shadowGraphics`

This is a one-line-per-function change. No test changes needed — the existing map rendering tests cover these paths.

---

## 3. CrewMember / Astronaut Type Unification

**Problem:** `GameState.crew` is typed as `CrewMember[]` but at runtime all crew records have the full `Astronaut` fields. `crew.ts` uses a helper `_crew(state): Astronaut[]` that casts `state.crew as unknown as Astronaut[]` to bridge the gap. This is the root cause of the last avoidable `as unknown as` cast in the core layer.

**Current types:**
- `CrewMember` (`gameState.ts:178-196`): `id`, `name`, `status: CrewStatus`, `skills`, `salary`, `hiredDate`, `injuryEnds`
- `Astronaut` (`crew.ts:25-30`): Extends CrewMember with `missionsFlown`, `flightsFlown`, `deathDate`, `deathCause`, `assignedRocketId`, `trainingSkill`, `trainingEnds`, plus `status: string` (actually `AstronautStatus`) and `hireDate` (vs CrewMember's `hiredDate`)

**Status type mismatch:** `CrewMember.status` uses `CrewStatus` (what crew are *doing*: IDLE, ON_MISSION, TRAINING, INJURED). `Astronaut.status` uses `AstronautStatus` (career state: ACTIVE, FIRED, KIA). These are different concerns that were collapsed into a single `status` field.

**Approach:**
1. Merge all `Astronaut`-specific fields into `CrewMember` in `gameState.ts`. The unified type is `CrewMember` — the `Astronaut` interface is deleted.
2. Handle the status type conflict by keeping `status: CrewStatus` as the activity status and adding `careerStatus: AstronautStatus` as a separate field. Alternatively, if the runtime data shows these are stored in a single `status` field, widen `CrewMember.status` to `CrewStatus | AstronautStatus` and use type guards. Inspect the runtime data to determine the correct approach.
3. Normalize the `hiredDate` / `hireDate` field name discrepancy — pick one name and use it everywhere.
4. Remove the `Astronaut` interface from `crew.ts`.
5. Remove the `_crew()` cast helper — replace all usages with direct `state.crew` access.
6. Update all files that import or reference `Astronaut` to use `CrewMember`.
7. **Update all test files** that reference `Astronaut` or `CrewMember` types to use the unified type. Even though these files still have `@ts-nocheck` or are `.js`, update the references so the subsequent TypeScript conversion tasks don't encounter stale type names.
8. Verify the `as unknown as` cast count drops to 2 (both justified Chrome API casts in `perfMonitor.ts`).

---

## 4. Config File TypeScript Conversion

### 4.1 vite.config.js

Rename `vite.config.js` to `vite.config.ts`. Vite natively supports TypeScript config files. The conversion involves:
- Renaming the file
- Adding type imports for Vite's config types (`import { defineConfig } from 'vite'` is likely already present)
- Typing the custom `jsToTsResolve` plugin if it has untyped parameters
- Ensuring the test configuration block (Vitest) is properly typed

No functional changes — this is purely a type-safety conversion.

### 4.2 playwright.config.js + E2E tsconfig

Rename `playwright.config.js` to `playwright.config.ts`. Playwright natively supports TypeScript config files. Additionally, create `e2e/tsconfig.json` to enable type checking for E2E test code.

The `e2e/tsconfig.json` should:
- Extend or mirror the root `tsconfig.json` settings where appropriate
- Include `e2e/**/*.ts`
- Reference `@playwright/test` types
- Use `noEmit: true` (Playwright handles its own compilation)
- Set `strict: true`

Update `npm run typecheck` in `package.json` to also check E2E code: `tsc --noEmit && tsc --noEmit -p e2e/tsconfig.json`. If the existing typecheck command is just `tsc --noEmit`, chain the second check.

During the transition period (while E2E specs are being converted from `.js` to `.ts`), the Playwright config's `testMatch` pattern should accept both `.js` and `.ts` spec files. The final verification task will confirm all specs are `.ts` and tighten the pattern if needed.

---

## 5. Test Code TypeScript Conversion

### 5.1 Guiding Principles

Every test-related file in the project must be strict TypeScript after this iteration. The goal is **type regression detection** — the compiler should catch breaking changes to interfaces, function signatures, and data shapes before tests run.

**Depth of conversion (full):**
- Remove `// @ts-nocheck` directives (unit tests) or rename `.js` to `.ts` (E2E)
- Add proper type imports from `src/core/` modules (`GameState`, `PhysicsState`, `CrewMember`, etc.)
- Typed helper functions with explicit return types
- Typed test fixtures and mock objects — use the real interfaces, not ad-hoc object literals
- No `any` anywhere in test code
- Use `// @ts-expect-error` (not `any` or `@ts-ignore`) for intentional invalid-input tests
- Use Vitest's typed mock utilities (`vi.fn<>()` with type parameters) instead of untyped mocks
- `Partial<T>` is acceptable for test fixtures that only need a subset of fields, as long as the partial is explicitly typed

**What NOT to do:**
- Don't add JSDoc or method-level doc comments — test names are self-documenting
- Don't restructure test logic or change what's being tested
- Don't add new tests — this is a conversion, not a coverage expansion
- Don't change assertion patterns (keep existing `expect` style)
- Don't fix linting issues unrelated to TypeScript (those are out of scope)

### 5.2 Unit Test Setup Helper

`src/tests/setup.ts` is the shared test setup file (referenced by Vitest's `setupFiles`). It has `// @ts-nocheck`. Convert it to strict TypeScript first, since all unit test files depend on the environment it establishes. If it exports utility functions used by tests, those functions need explicit return types and typed parameters.

### 5.3 Unit Test Files (90 files)

Each of the 90 unit test files with `// @ts-nocheck` gets its own conversion task. The conversion for each file follows the same pattern:

1. Remove `// @ts-nocheck`
2. Run `npx vitest run src/tests/[file].test.ts` to see what breaks
3. Add type imports for all referenced interfaces/types from `src/core/`, `src/data/`, `src/render/`, `src/ui/`
4. Type all local helper functions (parameters + return types)
5. Type mock objects and fixtures — use real interfaces with `Partial<>` where appropriate
6. Replace any `any` usage with proper types or `unknown` + type guards
7. Add `// @ts-expect-error` comments for lines that intentionally pass wrong types
8. Run the test again to confirm it passes

**Common patterns to watch for:**
- Mock `GameState` objects — use `Partial<GameState>` or build a typed factory
- Mock DOM elements — use Vitest's `jsdom` types or `as unknown as HTMLElement` where DOM types are incomplete
- Callback parameters in `vi.fn()` — use `vi.fn<[ParamType], ReturnType>()` syntax
- Dynamic property access — use index signatures or `Record<string, T>` instead of `any`

### 5.4 E2E Helper Files (10 sub-modules + 2 barrels)

The E2E helpers live in `e2e/helpers/` with barrel re-exports at `e2e/helpers.js` and `e2e/fixtures.js`. Convert sub-modules first, then barrels.

For each sub-module (`_constants.js`, `_assertions.js`, `_state.js`, `_factories.js`, `_saveFactory.js`, `_navigation.js`, `_flight.js`, `_timewarp.js`):
1. Rename from `.js` to `.ts`
2. Add Playwright type imports (`import { Page, expect } from '@playwright/test'`)
3. Type all exported functions (parameters + return types)
4. Type internal helpers
5. Replace any `any` with proper types

For barrel exports (`helpers.js`, `fixtures.js`):
1. Rename from `.js` to `.ts`
2. Update re-export paths if needed (TypeScript module resolution with `bundler` mode resolves `.js` imports to `.ts` files, but verify)
3. Add explicit type re-exports if the barrel re-exports types

### 5.5 E2E Spec Files (40 files)

Each of the 40 E2E spec files gets its own conversion task. The conversion for each file follows this pattern:

1. Rename from `e2e/[file].spec.js` to `e2e/[file].spec.ts`
2. Delete the original `.js` file
3. Add Playwright type imports (`import { test, expect, Page } from '@playwright/test'`)
4. Import typed helpers from the converted barrel exports
5. Type all local helper functions and variables
6. Replace any `any` usage with proper types
7. Add `// @ts-expect-error` for intentional edge cases
8. Run the specific spec to confirm it passes

**Common patterns:**
- Page objects and locators are already typed by Playwright
- Helper function return types are usually `Promise<void>` or `Promise<string>`
- `page.evaluate()` callbacks need typed arguments — use the generic: `page.evaluate<ReturnType, ArgType>(fn, arg)`

---

## 6. ESLint Enforcement

After all test files are converted, escalate the `@typescript-eslint/no-explicit-any` rule from `warn` to `error` for test files in `eslint.config.js` (lines 152-160). This prevents regression — no `any` can be reintroduced in test code without a lint failure.

The source file rule is already `error` (line 87). After this change, `any` is `error` everywhere.

---

## 7. Verification Criteria

After all tasks are complete:

1. `npm run typecheck` — no errors (this must now include E2E: `tsc --noEmit && tsc --noEmit -p e2e/tsconfig.json`)
2. `npm run lint` — no errors (with `no-explicit-any: error` for tests)
3. `npm run test:unit` — all unit tests pass
4. `npm run test:e2e` — all E2E specs pass
5. `npm run build` — production build succeeds
6. Zero `// @ts-nocheck` directives in any source or test file
7. Zero `.js` files in `e2e/` (all converted to `.ts`)
8. Zero `any` in test code (enforced by ESLint)
9. `as unknown as` cast count in production source is <= 2 (down from 3 after CrewMember unification)
10. Settings schema migration infrastructure is in place and tested
