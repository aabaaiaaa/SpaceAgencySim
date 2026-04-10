# Iteration 5 — Final Code Review

**Date:** 2026-04-10
**Scope:** TypeScript hardening & remaining stabilization — 149 tasks across settings migration, type unification, config conversion, and full test codebase TypeScript conversion
**Codebase:** ~41,700 lines of production source across 154 modules, ~49,900 lines of unit tests (95 files), 40 E2E specs (all TypeScript)

---

## Requirements vs Implementation

### Fully Implemented

| Req | Section | Status | Notes |
|-----|---------|--------|-------|
| 1 | Settings schema migration chain | **Complete** | `_migrateSettings()` infrastructure in place in `settingsStore.ts`. `isValidEnvelope()` accepts `version <= SCHEMA_VERSION`, rejects higher versions with warning. Migration registry is an empty array (correct for v1). `loadSettings()` calls `_migrateSettings()` after validation, before `mergeWithDefaults()`. |
| 2 | Map renderer null guards | **Complete** | `_drawBody` (line 626) guards `if (!_mapRoot \|\| !_bodyGraphics) return`. `_drawShadow` (line 1339) guards `if (!_mapRoot \|\| !_shadowGraphics) return`. Both `!` non-null assertions removed. `_commsGraphics = null` added in `destroyMapRenderer()` at line 360. |
| 3 | CrewMember/Astronaut type unification | **Partial** | `Astronaut` interface deleted from `crew.ts`. All fields merged into `CrewMember` in `gameState.ts:177-209`. `_crew()` cast helper removed. `status` field is `AstronautStatus`. **However, `saveload.ts` still uses `CrewStatus.DEAD` instead of `AstronautStatus.KIA` — see Bug #1 below.** |
| 4.1 | vite.config.js → TypeScript | **Complete** | Renamed to `vite.config.ts`. Properly typed with `defineConfig` from `vitest/config`. Coverage thresholds configured. |
| 4.2 | playwright.config.js → TypeScript + e2e/tsconfig | **Complete** | Renamed to `playwright.config.ts`. `e2e/tsconfig.json` created with `strict: true`, `noEmit: true`. `testMatch` accepts both `.js` and `.ts`. `typecheck` script chains both `tsc --noEmit` and `tsc --noEmit -p e2e/tsconfig.json`. |
| 5.2 | Unit test setup helper | **Complete** | `src/tests/setup.ts` — `@ts-nocheck` removed, strict TypeScript. |
| 5.3 | Unit test conversion (90 files) | **Complete** | All 95 unit test files are strict TypeScript. Zero `@ts-nocheck` directives remain. Zero explicit `any` type annotations. |
| 5.4 | E2E helper conversion (12 files) | **Complete** | All sub-modules and barrels converted from `.js` to `.ts`. Zero `.js` files remain in `e2e/`. |
| 5.5 | E2E spec conversion (40 files) | **Complete** | All 40 specs converted from `.spec.js` to `.spec.ts`. Original `.js` files deleted. Zero `.js` files remain in `e2e/`. |
| 6 | ESLint enforcement | **Complete** | `no-explicit-any` is `error` globally (line 87) and in the test override block (line 159). Covers `src/tests/**` and `e2e/**`. |

### Verification Criteria Status

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| `npm run typecheck` | No errors | No errors | **Pass** |
| `npm run lint` | No errors | 0 errors, 350 warnings | **Pass** |
| `npm run build` | Succeeds | Succeeds (5.6s) | **Pass** |
| `@ts-nocheck` directives | Zero | Zero | **Pass** |
| `.js` files in `e2e/` | Zero | Zero | **Pass** |
| `any` in test code | Zero (ESLint enforced) | Zero | **Pass** |
| `as unknown as` in prod source | <= 2 | 2 (both in `perfMonitor.ts`) | **Pass** |

### Gaps

**1. Bug: `saveload.ts` uses wrong enum for crew death status (HIGH)**

`countKIA()` (line 256) and `countLivingCrew()` (line 263) compare `c.status === CrewStatus.DEAD`. But after the type unification (TASK-004), `CrewMember.status` is typed as `AstronautStatus`, and crew death is recorded via `AstronautStatus.KIA` (value: `'kia'`). `CrewStatus.DEAD` has value `'DEAD'`.

Since `'kia' !== 'DEAD'`, these functions silently return incorrect results:
- `countKIA()` always returns 0 (no crew member will ever have status `'DEAD'`)
- `countLivingCrew()` incorrectly includes KIA crew

The save slot summary UI will always show `crewKIA: 0` and inflated living crew counts. This is a semantic bug introduced during the type unification — the code compiles because `countKIA` uses a loose parameter type `{ crew?: Array<{ status: string }> }` that bypasses the `AstronautStatus` typing.

The test at `saveload.test.ts:362` also uses `CrewStatus.DEAD` to set up mock data (via `as unknown as CrewMember[]`), so the test passes despite testing the wrong behavior.

**Fix:** Replace `CrewStatus.DEAD` with `AstronautStatus.KIA` in `saveload.ts:256` and `saveload.ts:263`. Update the corresponding tests at `saveload.test.ts:151,242,354-368` to use `AstronautStatus.KIA`. Tighten the parameter types of `countKIA()` and `countLivingCrew()` to use `AstronautStatus` instead of `string`.

**2. Stale `.spec.js` references in `test-map.json` (MEDIUM)**

`test-map.json` contains 62 references to `.spec.js` files, but all E2E specs have been converted to `.spec.ts`. Running `npm run test:affected` after changes to source modules that map to stale `.spec.js` references will fail to find the test files, silently skipping E2E coverage.

**Fix:** Update all `.spec.js` references in `test-map.json` to `.spec.ts`.

**3. Residual inline styles in `_mapView.ts` (LOW)**

Lines 290-291 contain inline `style=""` attributes on transfer info/progress divs. This contradicts the CSS class migration completed in iteration 4 (TASK-017) for the rename dialog in the same file.

### Scope Creep Assessment

**No scope creep detected.** All 149 tasks trace directly to the requirements document. No extraneous features or changes were added beyond what was specified.

---

## Code Quality

### Strengths

1. **Type safety is now comprehensive.** Zero `@ts-nocheck`, zero explicit `any`, and only 2 justified `as unknown as` casts (Chrome performance API in `perfMonitor.ts`). The `no-explicit-any: error` ESLint rule prevents regression across all source and test files.

2. **Settings migration infrastructure is well-designed.** Follows the same pattern as `_applySaveMigrations` in `saveload.ts`. Forward-compatible (rejects newer versions gracefully). The migration registry is ready for the first schema change with no additional plumbing needed.

3. **CrewMember type unification is clean.** Single unified type in `gameState.ts:177-209`. The `Astronaut` interface and `_crew()` cast helper are completely removed. `AstronautStatus` (career) and `CrewStatus` (activity) are properly separated as distinct enum types.

4. **Map null guards are belt-and-suspenders.** Both `_mapRoot` and individual graphics objects (`_bodyGraphics`, `_shadowGraphics`) are checked before use. No `!` non-null assertions remain on graphics objects.

5. **Build and type-check infrastructure is solid.** Config files converted to TypeScript. E2E has its own `tsconfig.json` with strict mode. The `typecheck` script validates both source and E2E code.

### Issues

| Severity | Location | Description |
|----------|----------|-------------|
| **High** | `saveload.ts:256,263` | `CrewStatus.DEAD` vs `AstronautStatus.KIA` mismatch — save summaries always show 0 KIA. See Gap #1. |
| **Medium** | `test-map.json` | 62 stale `.spec.js` references — affected test detection broken for these entries. See Gap #2. |
| **Low** | `_mapView.ts:290-291` | Inline styles on transfer info/progress divs. |
| **Info** | `src/tests/saveload.test.ts:357,368` | `as unknown as CrewMember[]` casts mask the `CrewStatus.DEAD` bug by bypassing type checking on mock data. |

### `as unknown as` Cast Inventory

**Production source (2 casts — target met):**
- `perfMonitor.ts:165` — Chrome `performance.memory` API (non-standard, justified)
- `perfMonitor.ts:205` — Same pattern, second usage site

**Test code (281 occurrences across 28 files):**
These are `as unknown as InterfaceType` casts on partial mock objects — acceptable for test fixtures where `Partial<T>` would be verbose. However, some mask real bugs (e.g., `saveload.test.ts:357` casts a `{ status: CrewStatus.DEAD }` object to `CrewMember` when `CrewMember.status` is `AstronautStatus`). Consider adding typed factory functions for frequently-mocked types (`CrewMember`, `MissionInstance`, `FlightResult`) to reduce cast count and prevent masked type mismatches.

### Lint Warnings (350 total, 0 errors)

The warnings break down as:
- **~347 `no-unused-vars`** — Unused imports and variables across source files. Predominantly in UI modules (`hub.ts`, `_keyboard.ts`, `_mapView.ts`, `library.ts`, `rdLab.ts`, `_engineerPanel.ts`) and one test file (`weather.test.ts`).
- **1 `no-useless-assignment`** — Unused assignment in a test file.
- **2 `require-await`** — Async functions without `await` expressions.

These are all warnings (not errors) and do not block the build, but the unused import/variable count (347) is notably high for a codebase of this size. Many appear to be leftover from refactoring.

### Security

No security concerns introduced. The settings migration chain reads from `localStorage` only (no external input). The type unification doesn't change any input surface. All existing `escapeHtml()` usage remains intact.

---

## Testing

### Coverage Infrastructure

| Layer | Lines | Branches | Functions | Enforced |
|-------|-------|----------|-----------|----------|
| `src/core/` | 89% | 80% | 91% | Yes (vitest thresholds) |
| `src/render/` | 55% | 45% | — | Yes |
| `src/ui/` | 50% | 45% | — | Yes |

Thresholds are configured in `vite.config.ts:48-62` and enforced on every test run. This prevents coverage regression.

### Type Safety in Tests

- **95 unit test files** — all strict TypeScript, no `@ts-nocheck`, no explicit `any`
- **40 E2E spec files** — all `.ts`, all typed
- **12 E2E helper/barrel files** — all `.ts`, all typed
- **ESLint `no-explicit-any: error`** — enforced for both `src/tests/**` and `e2e/**`

This is a significant achievement. TypeScript will now catch interface changes, renamed fields, and removed functions at compile time rather than at test runtime.

### Test Gaps

| Priority | Gap | Impact |
|----------|-----|--------|
| **High** | `saveload.test.ts:351-371` tests use `CrewStatus.DEAD` in mock data — tests pass but validate wrong behavior | Save summary tests give false confidence; KIA counting is broken in production |
| **Medium** | Settings migration chain has no test with actual migrations (only infrastructure tested) | First real migration will be untested until it's written |
| **Low** | 281 `as unknown as` casts in test files bypass type checking on mock objects | Some casts mask real type mismatches (proven by the saveload bug) |
| **Info** | `test-map.json` stale references mean `npm run test:affected` won't trigger E2E tests for ~62 source-to-test mappings | Affected test detection partially broken |

---

## Recommendations

### Immediate (Before Next Iteration)

1. **Fix the `CrewStatus.DEAD` / `AstronautStatus.KIA` bug in `saveload.ts`.** This is a functional bug affecting save slot summaries. Replace `CrewStatus.DEAD` with `AstronautStatus.KIA` at lines 256 and 263. Update `saveload.test.ts` mock data to use `AstronautStatus.KIA`. Tighten the parameter types to use `AstronautStatus` instead of `string`.

2. **Update `test-map.json` to use `.spec.ts` extensions.** All 62 stale `.spec.js` references should be updated to `.spec.ts`. This restores affected test detection for E2E specs.

3. **Clean up unused imports/variables.** Run `npm run lint:fix` to auto-fix the fixable warning, then manually remove the ~347 unused imports/variables. This is a mechanical cleanup that reduces noise in future lint runs and makes genuine new warnings visible.

### Short-term (Next Iteration)

4. **Add typed test factory functions.** Create factory functions for frequently-mocked types (`makeCrewMember()`, `makeMission()`, `makeFlightResult()`) that return properly typed objects with sensible defaults. This would reduce the 281 `as unknown as` casts in test code and prevent type-mismatch bugs like the `CrewStatus.DEAD` issue from being masked.

5. **Move `_mapView.ts` inline styles to CSS.** Lines 290-291 have residual inline styles that should use CSS classes, consistent with the rename dialog migration completed in iteration 4.

6. **Tighten Playwright config `testMatch`.** Now that all specs are `.ts`, the `testMatch: '**/*.spec.{js,ts}'` pattern can be narrowed to `'**/*.spec.ts'` to prevent accidental `.js` spec files from being introduced.

---

## Future Considerations

### Features for Next Iterations

1. **Asteroid mining/science gameplay.** The CapturedBody struct, landing system, and orbital mechanics are all in place but have no gameplay payoff. Science data collection, resource extraction, or mining contracts would give purpose to the capture mechanics.

2. **Multi-asteroid capture.** `capturedBody: CapturedBody | null` limits capture to one asteroid. Expanding to `capturedBodies: CapturedBody[]` would enable towing multiple small asteroids with aggregate mass/CoM/MoI calculations.

3. **Crew skills connected to belt operations.** The crew system exists but isn't connected to asteroid operations. Skill bonuses for capture efficiency or mining yield would add depth.

### Architectural Decisions to Revisit

4. **`CapturedBody` → `AttachedBody` generalization.** As the game adds attachable objects (fuel depots, station modules, captured satellites), the concept could generalize to a flexible attachment system.

5. **Test mock infrastructure.** The 281 `as unknown as` casts are a code smell indicating the test infrastructure doesn't have proper typed factories. A `createMockGameState()` function with `DeepPartial<GameState>` overrides would be more maintainable and type-safe than ad-hoc partial objects cast through `unknown`.

6. **Bundle size.** The production build produces a 960 KB main chunk (278 KB gzipped). Vite warns about this. Code-splitting with dynamic imports (e.g., lazy-loading the VAB editor, mission control, or map view) would improve initial load time.

### Technical Debt Introduced

| Item | Severity | Description |
|------|----------|-------------|
| `saveload.ts` enum mismatch | **High** | `CrewStatus.DEAD` should be `AstronautStatus.KIA` — functional bug |
| `test-map.json` stale refs | **Medium** | 62 `.spec.js` references to files that are now `.spec.ts` |
| 281 `as unknown as` in tests | **Low** | Bypasses type checking on mock objects; masks bugs |
| 350 lint warnings | **Low** | Mostly unused imports/variables from refactoring |
| Inline styles in `_mapView.ts` | **Low** | 2 remaining inline style attributes |

### Technical Debt Resolved

| Item | Status |
|------|--------|
| `CrewMember` / `Astronaut` type split | **Resolved** — unified to single `CrewMember` type |
| Settings schema migration chain | **Resolved** — migration infrastructure in place |
| `_drawBody` / `_drawShadow` null guards | **Resolved** — both graphics objects checked |
| 90 unit test `@ts-nocheck` directives | **Resolved** — all removed, strict TypeScript |
| 40 E2E `.js` specs | **Resolved** — all converted to `.ts` |
| 12 E2E helper `.js` files | **Resolved** — all converted to `.ts` |
| Config files in JavaScript | **Resolved** — both `vite.config.ts` and `playwright.config.ts` |
| `no-explicit-any` as `warn` for tests | **Resolved** — escalated to `error` |
| `as unknown as` count at 3 | **Resolved** — reduced to 2 (both justified Chrome API casts) |

---

## Summary

Iteration 5 successfully achieved its primary goals: full TypeScript conversion of the test codebase, settings migration infrastructure, and remaining stabilization from the iteration 4 review.

**Achievements:**
- **143 files converted** to strict TypeScript (90 unit tests, 40 E2E specs, 12 E2E helpers, 1 setup file)
- **Zero `@ts-nocheck`** directives remain anywhere in the project
- **Zero explicit `any`** in all source and test code, enforced by ESLint `error` rule
- **`as unknown as` casts reduced** from 3 to 2 in production source
- **Settings migration chain** ready for future schema changes
- **E2E tsconfig** with strict mode enables compile-time error detection in E2E code
- **Full type-check pipeline** validates both source and E2E code

**Critical Issue:**
- The `saveload.ts` `CrewStatus.DEAD` / `AstronautStatus.KIA` mismatch is a functional bug that causes save slot summaries to always show 0 KIA crew. This was introduced during the type unification (TASK-004) and not caught because tests use the same wrong enum value via `as unknown as` casts. **This should be fixed before the next iteration begins.**

**Maintenance Item:**
- `test-map.json` has 62 stale `.spec.js` references that should be updated to `.spec.ts` to restore affected test detection.
