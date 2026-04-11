# Iteration 9 Code Review Report

**Date:** 2026-04-11
**Scope:** Resource Generation & Transportation System (26 tasks)

---

## Requirements vs Implementation

### All Requirements Met

All 26 tasks are marked `done` and every requirement section from the spec has a corresponding implementation:

| Requirement Section | Status | Notes |
|---|---|---|
| 1. Resource Data Model | Complete | 10 resources, 3 states, 10 mining module types, body profiles, 3 cargo parts, 10 mining parts |
| 2. Mining Sites | Complete | Site creation, proximity grouping, module placement, pipe connections, power budget, extraction |
| 3. Routes & Automation | Complete | Proven legs, route assembly, automation economics, route safety |
| 4. Logistics Center Facility | Complete | Two-tab panel (mining sites + route management), hub integration, in-flight map overlay |
| 5. Contract Progression | Complete | 12 sequential resource contracts using canGenerate/generate pattern |
| 6. Tech Tree | Complete | Logistics branch with 5 nodes across tiers 1-5 |
| 7. Game Loop Integration | Complete | processMiningSites -> processRefineries -> processSurfaceLaunchPads -> processRoutes |
| 8. New Body Test Coverage | Complete | CERES, JUPITER, SATURN, TITAN all have property-value tests |
| 9. Testing Strategy | Complete | Unit tests for all core modules, E2E test for mining deployment |

### Two Partial Implementations

1. **Route Revenue Display (UI):** The route management table has a "Revenue/Period" column header but the cell is hardcoded to `'-'` (`src/ui/logistics.ts:484`). The data is available (route resource type + throughput + `RESOURCES_BY_ID[type].baseValuePerKg`) but the calculation isn't wired into the UI. This is a display gap — the underlying revenue calculation in `processRoutes()` works correctly.

2. **Route Creation UI:** The route management tab displays existing routes and proven legs, and supports toggling route status (active/paused). However, there is no UI to **create new routes** by chaining proven legs, or to **assign additional craft** to legs. Requirements section 4 Panel 2 specifies "Create new routes by chaining proven legs" and "Assign additional craft to legs (triggers build cost)." The core functions `createRoute()` and `addCraftToLeg()` exist and are tested, but no UI button or workflow invokes them. Routes can only be created programmatically (e.g., via contracts or dev console).

### No Scope Creep

No features were implemented beyond what the requirements specify. The logistics panel, route overlay, and all data model additions align with the spec. Styling in `logistics.css` uses design tokens consistently and doesn't introduce new design patterns.

---

## Code Quality

### Bugs

**1. Route cost deducted before destination validation (Medium severity)**

In `src/core/routes.ts:314-335`, `spend(state, route.totalCostPerPeriod)` is called before checking whether the destination mining site exists. If the route's destination is a non-Earth body with no mining site, the operating cost is deducted but the transported resources are silently discarded:

```
Line 314: spend(state, route.totalCostPerPeriod)  // money spent
Line 317-318: deduct from source orbital buffer    // resources removed
Line 331: destSite = state.miningSites.find(...)   // may be null
Line 332-335: if (destSite) { ... }                // resources lost if null
```

**Impact:** Player loses both money and resources with no feedback. This scenario can occur if a mining site is somehow removed or if a route is misconfigured.

**Fix:** Either validate the destination site before calling `spend()`, or deposit into a fallback buffer and warn the player.

**2. Storage capacity calculation simplification (Low severity)**

In `src/core/mining.ts:270-283`, storage capacity is computed by summing all connected storage module capacities, then subtracting the total stored for that resource site-wide. This is correct for single-storage setups but can overstate available capacity when multiple storage modules of the same type exist and one is already full while another is empty. In practice this is unlikely to cause issues with the current game balance (single storage modules per resource type is the expected pattern), but it's worth noting for when Mk2 modules with different capacities are added.

### Dead Code

**`MiningSite.production` field is unused.**

`gameState.ts` defines `production: Partial<Record<ResourceType, number>>` on `MiningSite`. It's initialized to `{}` in `createMiningSite()` (`mining.ts:63`) and asserted empty in tests (`mining.test.ts:56`), but is never read or written by any production code or UI. It was likely intended for a production rate summary but was never implemented. Should be removed or utilized.

### Logic & Edge Cases

- **Power efficiency is well-guarded.** `getPowerEfficiency()` returns 1.0 when no power is required, clamps to [0,1], and handles division-by-zero. All processing functions correctly multiply by efficiency.
- **Refinery processing is transactional.** `processRefineries()` validates all inputs AND outputs have connected storage before consuming anything — no partial recipe execution.
- **BFS for connected storage is correct.** `getConnectedStorage()` uses a visited set to prevent infinite loops in the bidirectional adjacency graph.
- **Route throughput bottleneck is correct.** `calculateRouteThroughput()` returns the minimum of (capacity * craftCount) across all legs.

### Security

- **No XSS concerns.** `logistics.ts` uses `textContent` exclusively for all dynamic content. The single `innerHTML = ''` at line 91 is a safe clearing operation.
- **No injection vectors.** All data flows from typed game state through DOM APIs — no string interpolation into HTML.
- **No localStorage abuse.** Save/load uses the existing compression and slot system; the new fields are just additional arrays.

### Code Style & Conventions

- **Three-layer separation maintained.** All mutations happen in `src/core/`. The UI calls core functions then re-renders. The render layer reads state immutably.
- **Frozen data catalogs.** `RESOURCES`, `RESOURCES_BY_ID`, `REFINERY_RECIPES`, `RECIPES_BY_ID` are all `Object.freeze()`-d, including nested arrays.
- **Enum patterns consistent.** All new enums (`ResourceType`, `ResourceState`, `MiningModuleType`) use the existing `Object.freeze({} as const)` + companion type pattern.
- **Hub integration is clean.** Navigation goes through `src/ui/index.ts` which routes `'logistics-center'` to `openLogisticsPanel()` with proper back-button wiring.
- **`as unknown as` casts:** Only 3 remain in the entire test suite, all in `_factories.ts` JSDoc comments explaining mock patterns. Zero casts in production code.
- **Inline styles:** 18 remain across UI files — all dynamic (computed positions/widths/colors), matching the iteration 8 target. The logistics module has 5 inline styles, all using CSS custom properties (`var(--color-warning)`, `var(--font-size-body)`, etc.) which is acceptable for dynamic values.

---

## Testing

### Coverage Summary

| Test File | Tests | Smoke | Coverage |
|---|---|---|---|
| `src/tests/resources.test.ts` | 59 | 2 | Enums, catalog, body profiles, parts, contracts, tech tree |
| `src/tests/mining.test.ts` | 26 | 2 | Site creation, modules, connections, extraction, launch pads, integration |
| `src/tests/refinery.test.ts` | 13 | 1 | Recipe catalog, setter/getter, all 4 processing scenarios |
| `src/tests/routes.test.ts` | 40 | 2 | Proving, matching, throughput, creation, automation, safety |
| `src/tests/bodies.test.ts` | 69 | 1 | All 12 bodies: gravity, atmosphere, landability, hierarchy, biomes, weather |
| `e2e/mining.spec.ts` | 4 | 1 | Hub building visible, panel rendering, tab navigation, data injection |
| **Total** | **211** | **9** | |

### test-map.json

All new source files are correctly mapped to their test files. Mappings verified:
- `core/mining` -> `mining.test.ts` + `mining.spec.ts`
- `core/refinery` -> `refinery.test.ts` + `mining.spec.ts`
- `core/routes` -> `routes.test.ts` + `mining.spec.ts`
- `data/resources` -> `resources.test.ts` + `mining.spec.ts`

### Strengths

- **Integration test validates the full pipeline.** `mining.test.ts` has a smoke-tagged test that runs extraction -> refining -> launch pad transfer in sequence and verifies resources arrive in the orbital buffer.
- **Power efficiency is tested at all boundary conditions:** 0 power, partial power, full power, over-generation.
- **Route automation tests cover the financial path:** spend succeeds, spend fails (insufficient funds), Earth delivery (revenue), non-Earth delivery (orbital buffer).
- **Location matching tests are thorough:** 7 tests covering same/different bodies, altitudes, and undefined altitude tolerance.
- **Save/load round-trip** is tested for all three new state arrays (`miningSites`, `provenLegs`, `routes`).

### Gaps & Untested Edge Cases

1. **Storage capacity overflow:** No test verifies what happens when extraction exceeds total storage capacity across all connected modules. The code handles this (clamps with `Math.min`), but it's not explicitly tested.

2. **Multi-resource extraction competition:** No test for a body with multiple extractable resources and limited storage. The code processes each extractor independently, but competing extractors targeting the same storage aren't tested.

3. **Regolith electrolysis and hydrazine synthesis recipes:** Only water electrolysis and sabatier process are tested with actual processing. The other two recipes are validated in the catalog tests but never run through `processRefineries()`.

4. **Route to non-Earth body without destination site:** The silent resource loss described in the bugs section is untested.

5. **E2E coverage is minimal:** The 4 E2E tests verify panel rendering and data display but don't test any user interactions (recipe selection, route status toggling, tab switching with data).

6. **Concurrent period processing:** No test runs multiple `advancePeriod()` cycles to verify state accumulates correctly over time.

---

## Recommendations

### Before Production-Ready

1. **Fix the route cost/destination validation order.** Move the destination site lookup before `spend()` in `processRoutes()`, or at minimum log a warning when resources are lost to a missing destination. This is the only functional bug identified.

2. **Wire up the Revenue/Period column.** The data is available — this is a straightforward calculation: `route.throughputPerPeriod * RESOURCES_BY_ID[route.resourceType].baseValuePerKg`. Display `$0` for non-Earth destinations.

3. **Remove or utilize `MiningSite.production`.** Dead fields in game state are a maintenance hazard — they get serialized/deserialized, take up save file space, and confuse contributors. Either remove it from the interface and `createMiningSite()`, or implement production rate tracking.

4. **Add route creation UI.** The route management tab currently has no way to create routes from proven legs. This is the most significant feature gap — players can see proven legs and existing routes but can't assemble new routes without developer console access.

### Nice to Have

5. **Add tests for the two untested refinery recipes** (regolith electrolysis, hydrazine synthesis) through `processRefineries()`.

6. **Add a test for multi-period accumulation** — run `advancePeriod()` 3-5 times and verify resources accumulate, routes generate revenue, and no state corruption occurs.

7. **Add E2E test for recipe selection dropdown** in the mining sites panel.

---

## Future Considerations

### Next Features (from requirements "Does NOT Include" section)

- **Off-world bases and habitats** — The mining site infrastructure (modules, power budget, storage) is a natural foundation. Habitats would be a new module type with crew capacity and life support consumption from storage.
- **Crew transport/taxi service** — The route system already supports arbitrary origin/destination pairs. Crew transport would need a `PassengerModule` part type and route variant.
- **Life support supply chains** — Direct consumer of the resource system. Oxygen and water consumption per crew member per period, sourced from local storage or route deliveries.
- **NPC interactions** — Trading resources with NPC agencies, competing for asteroid mining claims.

### Architectural Decisions to Revisit

1. **Bundle size.** The main chunk remains ~960 KB. As the logistics UI and route rendering grow, code-splitting the Logistics Center panel (and potentially the entire facility system) into lazy-loaded chunks would reduce initial load time. The barrel re-export pattern already used for flight/vab modules would support this.

2. **Site-level vs module-level storage accounting.** Currently, `site.storage` is a flat resource-to-amount map with no per-module tracking. If Mk2 storage modules with different capacities are added, the simplified capacity calculation (`sum all capacities - total stored`) will need per-module fill levels.

3. **Route processing scalability.** `processRoutes()` does a linear scan of `state.miningSites` for every active route every period. With many routes and sites, this becomes O(routes * sites). An index by bodyId would improve this, but isn't needed until the game has dozens of simultaneous routes.

4. **Period summary reporting.** The requirements mention extending `PeriodSummary` with resource system fields (mining revenue, route costs). This wasn't implemented — `processRoutes()` calls `earn()` and `spend()` directly without accumulating into a summary. Adding this would enable the end-of-period report to show resource income/expenses separately from mission and facility costs.

### Technical Debt Introduced

1. **`MiningSite.production` dead field** — Should be removed or implemented before it confuses future contributors.
2. **Revenue column stub** — Hardcoded `'-'` that should display calculated values.
3. **Route creation UI gap** — Core logic exists but UI workflow is missing. Players currently cannot create routes through the Logistics Center panel.
4. **Logistics panel inline styles** — 5 inline styles using CSS variables. While these use tokens correctly, they could be extracted to CSS classes for consistency with the iteration 8 inline-style migration goal.
5. **No route map rendering** — The in-flight overlay draws basic lines between bodies but is acknowledged as a placeholder. Full PixiJS route rendering with proper orbital path visualization is deferred.

---

## Summary

Iteration 9 is a solid, well-structured implementation. The resource extraction pipeline (mining -> refining -> launch -> transport) works correctly end-to-end, the data model is clean and extensible, all 12 bodies have resource profiles and comprehensive tests, and the 12-contract progression chain guides players through the system.

The one functional bug (route cost deducted before destination validation) is low-impact in normal gameplay but should be fixed. The route creation UI gap is the most significant feature omission — without it, the Logistics Center is a monitoring dashboard rather than a management tool. The dead `production` field and stubbed revenue column are minor cleanup items.

Test coverage is strong at 211 unit tests and 4 E2E tests with 9 smoke-tagged tests across the new modules. The codebase conventions (three-layer separation, frozen catalogs, TypeScript enums) are followed consistently throughout.
