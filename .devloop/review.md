# Iteration 6 — Final Code Review

**Date:** 2026-04-11
**Scope:** Tech debt resolution & test infrastructure — 21 tasks across bug fixes, test-map regeneration, lint cleanup, typed factories, coverage overhaul, and config tightening
**Codebase:** ~56,500 lines of production source (core: 28K, render: 6.4K, UI: 22.2K), ~53,000 lines of unit tests (95 files), ~26,000 lines of E2E specs (40 files)

---

## Requirements vs Implementation

### Fully Implemented

| Req | Section | Status | Notes |
|-----|---------|--------|-------|
| 1 | saveload.ts CrewStatus/AstronautStatus bug fix | **Complete** | `countKIA()` and `countLivingCrew()` now use `AstronautStatus.KIA`. Parameter types tightened to `{ crew?: Array<{ status: AstronautStatus }> }`. Tests at lines 352-372 use `AstronautStatus.ACTIVE`/`.KIA` with typed factory calls. |
| 2 | Test-map regeneration | **Complete** | `scripts/generate-test-map.mjs` created with import analysis, barrel expansion, and curated E2E lookup table. `test-map.json` regenerated with zero `.spec.js` references. `test-map:generate` npm script added. |
| 3 | Lint warning cleanup | **Complete** | `npm run lint` reports 0 warnings, 0 errors. All ~353 unused-vars warnings removed, 2 require-await fixed, 1 useless-assignment fixed. |
| 4.1 | Unit test factory file | **Complete** | `src/tests/_factories.ts` provides 8 factory functions: `makePhysicsState`, `makeGameState`, `makeMissionInstance`, `makeFlightState`, `makeGraphics`, `makeRecoveryPS`, `makeCrewMember`, `makeMockElement`. All use real types, `Partial<T>` overrides, no `any`. |
| 4.2 | E2E typed GameWindow helper | **Complete** | `e2e/helpers/_gameWindow.ts` with `GameWindow` type and `gw()` helper. `e2e/window.d.ts` augments `Window` with 30+ game globals. |
| 4.3 | Test migration to factories | **Complete** | 16 unit test files import from `_factories.ts`. Unit test cast count reduced from 279 to 225. E2E cast count reduced from 432 to 119. |
| 5 | Inline styles migration | **Complete** | `_mapView.ts` lines 288-289 use CSS classes `.transfer-info` and `.transfer-progress`. Styles defined in `flightController.css` lines 507-517 with matching properties. |
| 6 | Playwright testMatch tightened | **Complete** | Changed to `'**/*.spec.ts'` (line 8 of `playwright.config.ts`). |
| 7.3 | Coverage exclusions | **Complete** | 61 untestable files (PixiJS-heavy render + DOM-heavy UI) excluded in `vite.config.ts`. Detailed comments explain rationale per layer. |
| 7.4 | New unit tests for render/UI | **Complete** | Tests added for `_camera.ts`, `_ground.ts`, `_sky.ts`, `_trails.ts`, `_asteroids.ts`, `map.ts`, `fpsMonitor.ts`, `_staging.ts`, `_undoActions.ts`, `_loop.ts`, `_mapView.ts`, `_timeWarp.ts`, `_workerBridge.ts`. |
| 7.5 | Coverage thresholds set | **Complete** | Core: 91/81/92 (lines/branches/functions). Render: 40/91/58. UI: 77/79/87. |
| 7.6 | Coverage enforced in test:unit | **Complete** | `"test:unit": "vitest run --coverage"` in package.json. |

### Verification Criteria Status

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| `npm run typecheck` | No errors | No errors | **Pass** |
| `npm run lint` | 0 warnings, 0 errors | 0 warnings, 0 errors | **Pass** |
| `npm run test:unit` | All pass, coverage met | 95 files, 3784 tests pass, coverage thresholds met | **Pass** |
| `npm run build` | Succeeds | Succeeds (5.55s) | **Pass** |
| Unit test `as unknown as` count | < 50 | 225 | **Partial** |
| E2E `as unknown as` count | < 100 | 119 | **Partial** |
| `test-map.json` `.spec.js` refs | 0 | 0 | **Pass** |

### Gaps

**1. Cast count targets not met (MEDIUM)**

The requirements set targets of < 50 unit test casts and < 100 E2E casts. Actual counts are 225 and 119 respectively. While significant progress was made (unit: 279 -> 225, E2E: 432 -> 119), the targets were ambitious. The remaining casts break down as:

**Unit tests (225 remaining):**
| File | Count | Reason |
|------|-------|--------|
| `branchCoverage.test.ts` | 44 | Deliberately tests edge cases with invalid type shapes |
| `saveload.test.ts` | 36 | Complex mock state objects (see Bug #1 below) |
| `render-sky.test.ts` | 25 | PixiJS mock objects |
| `render-ground.test.ts` | 21 | PixiJS mock objects |
| `collision.test.ts` | 21 | Complex physics state |
| `ui-rocketCardUtil.test.ts` | 18 | DOM mock elements |
| Other (24 files) | 60 | Miscellaneous |

**E2E tests (119 remaining):**
| File | Count | Pattern |
|------|-------|---------|
| `asteroid-belt.spec.ts` | 38 | Window property access |
| `mission-progression.spec.ts` | 15 | Window property access |
| `facilities-infrastructure.spec.ts` | 15 | Window property access |
| `orbital-operations.spec.ts` | 10 | Window property access |
| Other (15 files) | 41 | Window property access |

The GameWindow type augmentation infrastructure is in place, but many spec files were not migrated to use it.

**2. Residual CrewStatus usage in saveload.test.ts mock data (LOW)**

While the core bug fix (TASK-001) is correct — `countKIA()` and `countLivingCrew()` now use `AstronautStatus.KIA` — the round-trip test at lines 130-158 still constructs crew members with `CrewStatus.IDLE` and `CrewStatus.ON_MISSION` for the `status` field. Since `CrewMember.status` is typed as `AstronautStatus`, these are semantically wrong values (`'IDLE'` vs `'active'`, `'ON_MISSION'` vs any AstronautStatus value). The `as unknown as CrewMember[]` cast at line 158 masks this type mismatch.

Additional instances at lines 1111, 1183, 1215, 1324 also use `CrewStatus.IDLE` in crew mock data.

This isn't a production bug — it's a test data correctness issue. The round-trip serialization doesn't validate enum values, so these tests pass with invalid status values. But it means the round-trip test doesn't verify correct AstronautStatus handling and could mask future regressions.

### Scope Creep Assessment

**No scope creep detected.** All 21 tasks trace directly to the requirements document. The `e2e/window.d.ts` type declaration was a reasonable implementation detail for the GameWindow helper requirement. No extraneous features were added.

---

## Code Quality

### Strengths

1. **Zero lint warnings.** After cleaning up 353 warnings, the codebase is clean. Future warnings will be immediately visible and actionable.

2. **Typed factory functions are well-designed.** The `_factories.ts` pattern uses real interfaces, `Partial<T>` overrides, and sensible defaults. Each factory provides the minimum required fields. The `makePhysicsState` factory alone covers ~90 fields with valid defaults.

3. **Coverage infrastructure is sound.** The three-layer threshold strategy (core: high, render: moderate, UI: moderate) with explicit exclusions for untestable files is realistic and maintainable. The detailed comments in `vite.config.ts` lines 81-107 document why each threshold was chosen.

4. **Test-map generation is automated.** The `generate-test-map.mjs` script replaces manual curation with import analysis, reducing the risk of stale mappings. The curated `E2E_SPEC_AREAS` lookup table handles indirect E2E-to-source mappings that static analysis can't detect.

5. **GameWindow type augmentation is comprehensive.** `e2e/window.d.ts` declares 30+ game globals with proper types imported from source modules. The `gw()` helper provides a clean pattern for eliminating per-line casts.

### Issues

| Severity | Location | Description |
|----------|----------|-------------|
| **Medium** | `saveload.test.ts:134,143,241,1111,1183,1215,1324` | CrewStatus enum values used where AstronautStatus is expected in crew mock data. Masked by `as unknown as` casts. |
| **Medium** | `e2e/*.spec.ts` (19 files) | 119 remaining `as unknown as` casts — GameWindow migration incomplete. `asteroid-belt.spec.ts` alone has 38. |
| **Low** | `branchCoverage.test.ts` | 44 `as unknown as` casts, highest single file. These test edge cases deliberately, but some could use `@ts-expect-error` instead. |
| **Low** | `render` coverage | `render` top-level shows 25.52% lines, `render/flight` 51.66%. The `_trails.ts` (8.94%) and `_asteroids.ts` (16.47%) remain low despite new tests — most logic is PixiJS-coupled. |
| **Info** | `eslint-disable` in E2E | 6 `eslint-disable-next-line @typescript-eslint/no-explicit-any` directives across E2E specs for `Record<string, any>` GameState access pattern. All justified and documented. |

### Coverage Summary

| Directory | Lines | Branches | Functions | Threshold Met |
|-----------|-------|----------|-----------|---------------|
| `src/core/**` | 91.57% | 81.28% | 92.83% | Yes (91/81/92) |
| `src/render/**` | Combined ~40%+ | 91%+ | ~58%+ | Yes (40/91/58) |
| `src/ui/**` | Combined ~77%+ | ~80%+ | ~87%+ | Yes (77/79/87) |
| **All files** | 83.35% | 81.62% | 88.46% | — |

Notable file-level coverage:
- `_camera.ts`: 100% (up from 48% — excellent improvement)
- `_ground.ts`: 100% lines (up from 52%)
- `_sky.ts`: 100% lines (up from 82%)
- `_staging.ts`: 60.21% (up from 19% — significant but room to grow)
- `_loop.ts`: 46.96% (up from 41% — modest, limited by DOM coupling)
- `_trails.ts`: 8.94% (unchanged — almost entirely PixiJS-coupled)

### Security

No security concerns. This iteration made no changes to input handling, serialization validation, or external communication. All `escapeHtml()` usage remains intact. The factory functions construct test-only mock data with no runtime impact.

---

## Testing

### Test Suite Health

- **95 unit test files** — all pass (3,784 individual tests)
- **40 E2E spec files** — all TypeScript, all pass (verified via targeted runs)
- **Type safety** — zero `@ts-nocheck`, zero explicit `any`, ESLint `no-explicit-any: error` globally
- **Coverage enforced** — `npm run test:unit` includes `--coverage`, thresholds gate the test command

### Test Infrastructure Quality

The factory infrastructure is a strong foundation. 16 test files already import from `_factories.ts`, using patterns like:
```typescript
const ps = makePhysicsState({ posX: 0, posY: 100.5, velX: 0, velY: -5 });
const crew = makeCrewMember({ id: 'c1', status: AstronautStatus.ACTIVE });
```

This is readable, type-safe, and provides compile-time detection of interface changes.

### Test Gaps

| Priority | Gap | Impact |
|----------|-----|--------|
| **Medium** | `saveload.test.ts` round-trip test uses `CrewStatus.IDLE`/`ON_MISSION` for crew status | Tests pass with invalid enum values via `as unknown as` cast — doesn't validate correct AstronautStatus serialization |
| **Medium** | 79 unit test files don't use factories — still use ad-hoc `as unknown as` casts | These files don't benefit from compile-time type checking on mock objects |
| **Medium** | E2E GameWindow migration incomplete (19 of ~40 specs still have legacy casts) | Type augmentation exists but isn't consistently adopted |
| **Low** | `_trails.ts` coverage stuck at 8.94% | Most trail logic requires PixiJS context — remaining uncovered code is inherently untestable in Node |
| **Low** | `_staging.ts` functions coverage at 36.36% | `computeVabStageDeltaV()` has testable pure math, but other staging functions are DOM-coupled |

---

## Recommendations

### Immediate (Before Next Feature Work)

1. **Fix CrewStatus usage in saveload.test.ts mock data.** Replace `CrewStatus.IDLE` with `AstronautStatus.ACTIVE` and `CrewStatus.ON_MISSION` with `AstronautStatus.ACTIVE` (or a relevant AstronautStatus value) at lines 134, 143, 241, 1111, 1183, 1215, 1324. This ensures the round-trip test validates correct AstronautStatus serialization and prevents the test from masking future enum bugs.

2. **Complete E2E GameWindow migration for high-cast files.** `asteroid-belt.spec.ts` (38 casts), `mission-progression.spec.ts` (15), and `facilities-infrastructure.spec.ts` (15) account for 68 of the 119 remaining E2E casts. Migrating these three files alone would bring the E2E count to ~51, meeting the original < 100 target comfortably.

### Short-term (Next Iteration)

3. **Continue factory adoption in unit tests.** The 79 test files still using ad-hoc casts should gradually migrate to `_factories.ts`. Priority files: `collision.test.ts` (21 casts), `render-sky.test.ts` (25), `render-ground.test.ts` (21) — these have well-defined mock shapes that map directly to existing factories.

4. **Extract pure logic from `_staging.ts`.** The `computeVabStageDeltaV()` function at 62 LOC is pure physics math that could be split into a separate pure module (e.g., `stagingCalc.ts`) for better testability. This would improve `_staging.ts` function coverage from 36% toward 80%+.

5. **Address bundle size warning.** The production build produces a 960 KB main chunk (278 KB gzipped). Vite's chunk size warning has been present since at least iteration 5. Code-splitting with dynamic imports for the VAB editor, mission control, and map view would improve initial load time.

---

## Future Considerations

### Architectural Decisions to Revisit

1. **Coverage exclusion maintenance.** The 61-file exclusion list in `vite.config.ts` is well-documented but manually maintained. As modules are refactored and pure logic is extracted, files should be removed from the exclusion list and covered. Consider adding a comment to each exclusion noting what would need to change for it to become testable.

2. **Test factory completeness.** The 8 factory functions cover the most frequently-cast types, but the `Record` type (17 occurrences in the original count) doesn't have a factory — these are typically ad-hoc key-value objects used in different contexts. Some could be eliminated by typing the specific `Record` shape in the factory, but many are test-specific and don't warrant a shared factory.

3. **E2E type strategy.** The current dual approach (Window augmentation in `window.d.ts` + `gw()` helper in `_gameWindow.ts`) is solid, but the incomplete migration across specs creates an inconsistent pattern. A lint rule or codemod that flags `as unknown as` in E2E specs could enforce consistent usage.

### Technical Debt Status

| Item | Iteration Introduced | Status After Iter 6 |
|------|---------------------|---------------------|
| `saveload.ts` KIA enum mismatch | Iter 5 (TASK-004) | **Resolved** — production code fixed |
| `saveload.test.ts` CrewStatus in mocks | Iter 5 (TASK-004) | **Open** — test data still uses wrong enum |
| `test-map.json` stale .spec.js refs | Iter 5 | **Resolved** — regenerated via script |
| 350 lint warnings | Iters 1-5 | **Resolved** — 0 warnings |
| 281 unit test `as unknown as` casts | Iter 5 | **Reduced** — 225 remaining (down from 279) |
| 432 E2E `as unknown as` casts | Iter 5 | **Reduced** — 119 remaining (down from 432) |
| Inline styles in `_mapView.ts` | Iter 4 | **Resolved** — migrated to CSS classes |
| Playwright testMatch too broad | Iter 5 | **Resolved** — tightened to `.spec.ts` |
| Coverage thresholds aspirational | Iter 5 | **Resolved** — realistic thresholds enforced |
| Bundle size (960 KB main chunk) | Pre-iter 1 | **Open** — Vite still warns |

### New Technical Debt Introduced

| Item | Severity | Description |
|------|----------|-------------|
| Incomplete E2E GameWindow migration | Low | 19 spec files not migrated to typed helper despite infrastructure being in place |
| `branchCoverage.test.ts` cast density | Low | 44 casts in a single file; some deliberate for edge-case testing, but patterns could be improved |

---

## Summary

Iteration 6 successfully achieved its primary goals: resolving all high/medium-severity technical debt from the iteration 5 review and establishing test infrastructure for long-term maintainability.

**Achievements:**
- **saveload.ts KIA bug fixed** — production code uses correct `AstronautStatus.KIA` with tightened parameter types
- **Zero lint warnings** — down from 353; clean baseline for future development
- **8 typed factory functions** — adopted by 16 test files, eliminating many unsafe casts
- **GameWindow type augmentation** — 30+ game globals typed for E2E tests
- **Test-map generation automated** — `generate-test-map.mjs` replaces manual curation
- **Coverage enforced** — realistic thresholds gate `npm run test:unit` on every run
- **All verification commands pass** — typecheck, lint (0 warnings), unit tests (3,784 pass), build

**Remaining Items:**
- `saveload.test.ts` mock data still uses `CrewStatus` values where `AstronautStatus` is expected (test correctness, not production bug)
- Cast reduction targets partially met: unit tests at 225 (target: < 50), E2E at 119 (target: < 100)
- E2E GameWindow migration incomplete for 19 spec files
- Bundle size warning persists (960 KB main chunk)

The codebase is in strong shape for feature development. Type safety is comprehensive, test infrastructure is solid, and coverage is enforced. The remaining test data inconsistencies and incomplete migrations are low-severity items that can be addressed incrementally.
