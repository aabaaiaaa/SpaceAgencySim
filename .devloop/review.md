# Iteration 10 Code Review Report

**Date:** 2026-04-11
**Scope:** Resource System Gaps, Route Builder UI & Hardening (24 tasks)

---

## Requirements vs Implementation

### All Requirements Met

All 24 tasks are marked `done` and every requirement section from the iteration 10 spec has a corresponding implementation:

| Requirement Section | Status | Notes |
|---|---|---|
| 1. Route Cost/Destination Validation Order | Complete | Destination resolved before `spend()` in `processRoutes()` (routes.ts:337-347) |
| 2. Dead Field Removal (MiningSite.production) | Complete | Field removed from interface, `createMiningSite()`, and tests |
| 3. Per-Module Storage Accounting | Complete | `stored`, `storageCapacityKg`, `storageState` on `MiningSiteModule`; proportional distribution in extraction, refinery, and launch pads; `recomputeSiteStorage()` helper |
| 4. Route Processing Scalability | Complete | `buildSiteIndex()` creates `Map<bodyId, MiningSite[]>` for O(1) lookups |
| 5. Period Summary Reporting | Complete | `PeriodSummary` extended with 7 resource fields; all process functions return summaries |
| 6. Revenue/Period Column | Complete | Calculated from throughput x baseValuePerKg; context-aware display |
| 7. Route Creation Map-Based Builder | Complete | SVG schematic map, proven leg visualization, click-to-chain builder, craft +/- controls |
| 8. Testing Gaps | Complete | All 8 unit tests and 4 E2E test files implemented |

### No Scope Creep

No features were implemented beyond what the requirements specify. The iteration is focused entirely on closing gaps identified in the iteration 9 review.

### Two Minor Observation Points

1. **Logistics module not split into sub-modules.** The requirements suggested `src/ui/logistics/routeMap.ts` with barrel re-export for the SVG map (TASK-012), but the implementation keeps everything in the monolithic `src/ui/logistics.ts` (1108 lines). This works but deviates from the project's pattern of splitting large UI modules (e.g., `flightController/`, `vab/`, `missionControl/`) into sub-module directories.

2. **Route builder resource filtering.** The requirements specify the resource dropdown should be "filtered to resources that have at least one proven leg touching a body that produces them." The implementation filters to resources that exist in any mining site's orbital buffer or storage, which is a reasonable but slightly different interpretation - it requires resources to be actively available rather than just theoretically transportable.

---

## Code Quality

### Bugs

**No critical bugs identified.** The iteration 9 route validation bug (TASK-001) has been correctly fixed.

**One minor concern (Low severity):**

In `routes.ts:366`, the non-null assertion `destSite!.orbitalBuffer` is used in the else branch after the `destBodyId !== 'EARTH'` check. This is logically safe because the `if (!destSite)` guard at line 343 would have already set the route to broken and continued. However, the non-null assertion relies on the reader understanding that control flow - a local variable assignment with an explicit null check would be slightly clearer.

### Logic & Edge Cases - Well Handled

- **Proportional storage distribution** (mining.ts:295-330): Correctly computes per-module remaining capacity, sums totals, and distributes shares. Handles zero remaining capacity and skips gracefully.

- **Refinery transactional processing** (refinery.ts): Validates all inputs AND output space before consuming anything. No partial recipe execution possible.

- **Power efficiency** (mining.ts:203-206): Returns 1.0 when `powerRequired === 0`, clamps to [0,1], handles division-by-zero. All processing functions correctly multiply by efficiency.

- **Route destination validation** (routes.ts:337-347): Correctly resolves destination before `spend()`. Non-Earth routes with missing sites are marked `broken` with no resource or money loss.

- **`recomputeSiteStorage()`** (mining.ts:248-259): Called at the end of extraction, refinery, and launch pad processing for each site. Correctly aggregates module-level storage into site-level view.

- **BFS for connected storage** (mining.ts:212-243): Uses visited set to prevent infinite loops in the bidirectional adjacency graph.

### Security

- **No XSS concerns.** The logistics SVG map uses `setAttribute()` and `textContent` exclusively. No `innerHTML` with dynamic data.
- **No injection vectors.** All data flows from typed game state through DOM/SVG APIs.
- **Save/load migration is safe.** The backwards compatibility code (saveload.ts:634-647) only adds default values to missing fields, never overwrites existing data.

### Code Style & Conventions

- **Three-layer separation maintained.** All state mutations happen in `src/core/`. The UI calls core functions then re-renders.
- **Frozen data catalogs.** `REFINERY_RECIPES`, `RECIPES_BY_ID` are `Object.freeze()`-d including nested arrays.
- **Enum patterns consistent.** No new enums added in iteration 10; existing patterns used correctly.
- **Return type consistency.** All four process functions (`processMiningSites`, `processRefineries`, `processSurfaceLaunchPads`, `processRoutes`) follow the same return-value-captured-by-caller pattern.
- **`buildSiteIndex()` is properly scoped.** Rebuilt each period tick, not cached on game state - avoids stale index issues.

---

## Testing

### Test Suite Health

| Metric | Value |
|---|---|
| Total unit test files | 100 |
| Total unit tests | 3,973 |
| All passing | Yes |
| TypeScript (`tsc --noEmit`) | Clean |
| ESLint | Clean |

### Iteration 10 Test Coverage

| Test File | New Tests | Coverage |
|---|---|---|
| `mining.test.ts` (946 lines) | Storage overflow, multi-resource extraction, multi-period accumulation | Comprehensive pipeline testing |
| `refinery.test.ts` (459 lines) | Regolith electrolysis, hydrazine synthesis | All 4 recipes now tested through `processRefineries()` |
| `routes.test.ts` (795 lines) | Missing destination site (broken route) | Error path for missing infrastructure |
| `saveload.test.ts` (1948 lines) | Per-module storage round-trip, backwards compatibility | Full persistence verification |
| `e2e/mining-interactions.spec.ts` (170 lines) | Panel rendering, recipe dropdown, module list | Mining tab UI interactions |
| `e2e/route-interactions.spec.ts` (192 lines) | Route table, status toggle, leg expansion | Route management UI interactions |
| `e2e/resource-contracts.spec.ts` (340 lines) | Contracts 1, 2, 8, 12 milestones | Contract chain progression |

### Strengths

1. **Multi-period accumulation test is excellent.** Sets up a full pipeline (extractor -> storage -> refinery -> storage -> launch pad -> orbital buffer), runs `advancePeriod()` 3 times, and verifies 5 integrity conditions: resource accumulation, no negative values, no double-counting (module totals match site.storage), orbital buffer growth, and non-zero PeriodSummary fields.

2. **Storage overflow test is well-designed.** Pre-fills a silo to 1980/2000 kg, runs extraction that would produce 250 kg, and verifies clamping to capacity.

3. **Backwards compatibility test for save/load.** Strips `stored` fields from serialized modules to simulate old saves, loads them, and verifies storage modules default to `{}` while non-storage modules don't get the field.

4. **E2E tests are properly independent.** Each test injects its own state via `page.evaluate()`, no serial dependencies.

5. **E2E tests use stable selectors.** `data-route-id`, `data-testid`, and class-based selectors used throughout.

### Gaps & Untested Edge Cases

**Unit tests missing:**
- Concurrent refineries with different recipes competing for the same storage modules
- Launch pad processing when orbital buffer would overflow (is it capped?)
- Route with multiple legs where an intermediate leg's destination site is missing
- Power efficiency at exact boundary (powerGenerated === powerRequired, expect exactly 1.0)

**E2E tests missing:**
- Craft count +/- button actions (buttons are verified to exist but click behavior untested)
- Revenue/cost column display values in route table
- SVG route map interactive features (body clicking, leg clicking in builder mode)
- Route builder confirm/cancel flow end-to-end
- Mining site creation via landing (full gameplay flow)

**Integration tests missing:**
- Full end-to-end flow: mining -> refining -> launch -> route -> Earth delivery -> revenue in PeriodSummary
- Multiple concurrent routes with resource contention at the same source orbital buffer
- Route status lifecycle: active -> broken (missing site) -> site rebuilt -> manual reactivation

---

## Recommendations

### Before Production-Ready

1. **Split `src/ui/logistics.ts` into sub-modules.** At 1108 lines, this is the largest UI module and is monolithic. The project convention (established with `flightController/`, `vab/`, `missionControl/`) is to split large UI modules into sub-directories with barrel re-exports. Suggested split:
   - `logistics/miningSites.ts` - mining tab rendering
   - `logistics/routeMap.ts` - SVG map component
   - `logistics/routeBuilder.ts` - builder mode interaction
   - `logistics/routeTable.ts` - route table and craft controls
   - `logistics/index.ts` - barrel re-export

2. **Add E2E tests for craft +/- button functionality.** The buttons exist and render correctly, but no test verifies that clicking + actually increases the craft count, triggers a build cost, and recalculates throughput. This is a core user interaction in the route management panel.

3. **Add E2E test for the route builder confirm flow.** The most complex UI feature in this iteration has no end-to-end test verifying that creating a route via the map builder actually persists a new route in game state.

4. **Test orbital buffer overflow.** The `processSurfaceLaunchPads()` function transfers resources to `site.orbitalBuffer` without checking for any capacity limit. While orbital buffers may intentionally be unlimited, this should be explicitly documented or capped if unintentional.

### Nice to Have

5. **Extract inline SVG body colors to CSS.** `_getBodyColor()` in logistics.ts hardcodes color values. These could use CSS custom properties for consistency with the design token system.

6. **Add a route revenue integration test.** Run `advancePeriod()` with an active Earth-bound route and verify the PeriodSummary's `routeRevenue` field matches the expected `throughput * baseValuePerKg`.

---

## Future Considerations

### Next Features (from requirements "Does NOT Include" section)

- **Off-world bases and habitats** - The per-module storage architecture (iteration 10) makes this straightforward: habitats would be a new module type with crew capacity, consuming oxygen/water from connected storage modules.

- **Crew transport / taxi service** - The route system supports arbitrary origin/destination pairs. Crew transport would need a `PassengerModule` part type and a route variant that carries crew instead of resources.

- **Life support supply chains** - Direct consumer of the resource system. Oxygen and water consumption per crew member per period, sourced from local module storage.

- **Mk2 storage modules** - The per-module storage refactor was explicitly designed to enable modules with different capacities. Each module tracks its own `stored` and `storageCapacityKg`, so Mk2 modules with larger capacities will work correctly without further architectural changes.

### Architectural Decisions to Revisit

1. **Bundle size.** Not addressed in this iteration (acknowledged as deferred). As the logistics UI grows, code-splitting the Logistics Center panel into a lazy-loaded chunk would reduce initial load. The barrel re-export pattern supports this.

2. **Orbital buffer capacity.** Currently unbounded. As routes and launch pads scale up, consider whether orbital buffers need capacity limits (perhaps tied to deployed orbital storage modules) to add gameplay depth.

3. **Route leg failure granularity.** Routes can go `'broken'` when a destination site is missing, but there's no mechanism for individual leg failures in multi-leg routes. If intermediate infrastructure is removed, the route breaks entirely rather than degrading gracefully.

4. **SVG map scalability.** The schematic map uses fixed positions for 8 bodies in an 800x200 viewBox. If new celestial bodies are added (asteroids, moons of Jupiter/Saturn), the layout will need dynamic positioning or a larger canvas.

5. **In-flight route rendering.** Still a placeholder - the in-flight map overlay draws basic lines but doesn't use PixiJS. As the route system matures, a proper PixiJS implementation showing actual orbital paths would improve the player experience significantly.

### Technical Debt Introduced

1. **Monolithic logistics.ts** (1108 lines) - Should be split into sub-modules per project convention. This was noted but not required by the iteration 10 spec.

2. **Non-null assertions in routes.ts** - `destSite!.orbitalBuffer` at line 366 is logically safe but could be restructured for clarity.

3. **No E2E coverage of route builder interactions** - The SVG map builder is the most complex UI feature added but has no end-to-end test coverage for the actual creation flow.

4. **In-flight map overlay placeholder** - Carried forward from iteration 9. Still basic lines without proper PixiJS rendering.

---

## Summary

Iteration 10 is a well-executed hardening pass that addresses every issue raised in the iteration 9 review:

- The **route validation bug** is fixed correctly - destination is resolved before money or resources are committed.
- **Per-module storage** is cleanly implemented with proportional distribution, proper aggregation via `recomputeSiteStorage()`, and full backwards compatibility in save/load.
- The **route scalability index** (`buildSiteIndex`) is a simple, effective optimization.
- **PeriodSummary** now captures all resource system metrics, enabling proper end-of-period reporting.
- The **route creation UI** fills the most significant feature gap from iteration 9, with an SVG schematic map, click-to-chain builder, and inline craft controls.
- **Revenue/Period** column now displays calculated values with proper context (Earth vs non-Earth, active vs paused).

The codebase is in strong shape: **3,973 unit tests all passing**, TypeScript compiles clean, ESLint reports no issues. The three-layer architecture is maintained consistently. The most significant remaining debt is the monolithic logistics.ts module (1108 lines) and the lack of E2E test coverage for the route builder interaction flow.

Test coverage is comprehensive for core logic (extraction, refining, launch, routing, save/load) with good edge case coverage (overflow, multi-resource, missing destinations, backwards compatibility). The E2E tests verify rendering and basic interactions but could be strengthened with tests for the craft +/- buttons and route builder confirm flow.

Overall: **iteration 10 delivers on its promise of closing gaps and hardening the resource system.** The foundation is solid for future features (off-world bases, crew transport, life support) and the per-module storage architecture is explicitly future-proofed for Mk2 modules.
