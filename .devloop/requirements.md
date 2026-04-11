# Iteration 10 — Resource System Gaps, Route Builder UI & Hardening

This iteration addresses all issues, gaps, and architectural improvements identified in the iteration 9 review for the resource generation and transportation system. No new gameplay features are added — the focus is on fixing bugs, filling UI gaps, improving the architecture for future scalability, and closing test coverage holes.

---

## 1. Bug Fix: Route Cost/Destination Validation Order

**Problem:** In `src/core/routes.ts` (lines 310–340), `processRoutes()` calls `spend(state, route.totalCostPerPeriod)` and deducts resources from the source orbital buffer *before* checking whether the destination mining site exists. If the destination site is missing (e.g., misconfigured route), both money and resources are silently lost with no player feedback.

**Fix:** Move the destination site lookup (currently at line 331) to *before* the `spend()` call. If the destination is a non-Earth body and no mining site is found, skip the route for this period and set its status to `'broken'`. This gives the player a visible signal that something is wrong.

**Validation:** The existing route automation tests should continue to pass. A new test (see Testing section) covers the missing-destination scenario.

---

## 2. Dead Field Removal: MiningSite.production

**Problem:** `MiningSite.production` (defined in `gameState.ts` line ~695) is initialized to `{}` in `createMiningSite()` (`mining.ts` line 63) but is never read or written by any production code or UI. It was likely intended for production rate tracking but was never implemented.

**Fix:** Remove the `production` field from the `MiningSite` interface in `gameState.ts`, remove the initialization in `createMiningSite()`, and remove any test assertions that reference it (e.g., `mining.test.ts` line 56). Production rate tracking is not needed — the UI already computes display rates from module properties and power efficiency.

**Save/load compatibility:** Old saves that include the `production` field in serialized mining sites will harmlessly ignore it during deserialization (the field simply won't be mapped to anything). No migration needed.

---

## 3. Per-Module Storage Accounting

**Problem:** Currently `site.storage` is a flat `Partial<Record<ResourceType, number>>` — a single pool per resource type per site. Storage capacity is calculated by summing all connected storage module capacities and subtracting total stored, which overstates available capacity when multiple storage modules of the same type exist with different fill levels. This also prevents future Mk2 modules with different capacities from working correctly.

**Approach:** Move storage tracking from site-level to module-level. Each storage-type module (`STORAGE_SILO`, `PRESSURE_VESSEL`, `FLUID_TANK`) gets its own `stored` record tracking what it holds and how much.

### Data Model Changes

Add to `MiningSiteModule` in `gameState.ts`:
```typescript
stored?: Partial<Record<ResourceType, number>>;  // storage modules only
storageCapacityKg?: number;                        // storage modules only
storageState?: ResourceState;                      // storage modules only
```

These optional fields are populated only for storage-type modules (determined by `MiningModuleType`). The values are copied from the part definition's properties when the module is added via `addModuleToSite()`.

### Derived Site Storage

`site.storage` becomes a **computed aggregate** — the sum of all module-level `stored` records. Rather than removing it from the interface (which would break the UI and many tests), keep it and recompute it at the end of each processing step. Add a helper function `recomputeSiteStorage(site)` that sums all module stored values.

### Extraction Changes (`processMiningSites`)

When an extractor produces resources, distribute the output **proportionally** across all connected storage modules of the matching state, based on each module's remaining capacity. Specifically:

1. Find all connected storage modules of the correct `ResourceState` (existing BFS logic).
2. For each module, compute `remainingCapacity = storageCapacityKg - sum(stored values)`.
3. Sum all remaining capacities to get `totalRemaining`.
4. If `totalRemaining <= 0`, skip (all storage full).
5. Extracted amount = `min(extractionRate * efficiency * multiplier, totalRemaining)`.
6. Distribute: each module receives `extracted * (moduleRemaining / totalRemaining)`.
7. Call `recomputeSiteStorage(site)`.

### Refinery Changes (`processRefineries`)

Refineries consume inputs from connected storage and produce outputs to connected storage. Update to:

1. **Input check:** For each input resource, sum the `stored` amounts across all connected storage modules that hold that resource. If any input is insufficient, skip.
2. **Output check:** For each output resource, sum the remaining capacity across connected storage modules of the matching state. If insufficient space, skip.
3. **Consume:** Deduct inputs from individual modules (drain from each proportionally or sequentially — proportional for consistency with extraction).
4. **Produce:** Distribute outputs proportionally to connected storage modules.
5. Call `recomputeSiteStorage(site)`.

### Launch Pad Changes (`processSurfaceLaunchPads`)

Surface launch pads pull from storage and transfer to orbital buffer. Update to read from connected storage modules rather than `site.storage`, deducting from individual modules proportionally.

### Save/Load

The new `stored`, `storageCapacityKg`, and `storageState` fields on `MiningSiteModule` will be serialized automatically. For backwards compatibility with old saves, `addModuleToSite()` should initialize `stored` to `{}` for storage modules, and deserialization should default missing `stored` to `{}` for any module that has a storage-type `MiningModuleType`.

---

## 4. Route Processing Scalability

**Problem:** `processRoutes()` calls `state.miningSites.find(s => s.bodyId === ...)` for every active route every period tick. This is O(routes × sites).

**Fix:** Add a helper function `getMiningSitesByBodyId(state)` that builds a `Map<string, MiningSite[]>` index from `state.miningSites`. Call it once at the start of `processRoutes()` and use it for all lookups within that period. The index is rebuilt each period (not cached on state) since sites can be added/removed between periods.

This is a contained optimization — it changes the internal implementation of `processRoutes()` without affecting its API or behavior.

---

## 5. Period Summary Reporting

**Problem:** `advancePeriod()` in `period.ts` (lines 177–180) calls `processMiningSites()`, `processRefineries()`, `processSurfaceLaunchPads()`, and `processRoutes()` but discards their return values. The `PeriodSummary` interface (lines 59–79) has no fields for resource system activity, so the end-of-period report can't show resource income/expenses separately.

### PeriodSummary Additions

Add these fields to the `PeriodSummary` interface:

```typescript
// Resource system
miningExtracted: Partial<Record<ResourceType, number>>;  // kg extracted per resource
refineryProduced: Partial<Record<ResourceType, number>>; // kg produced per resource
refineryConsumed: Partial<Record<ResourceType, number>>; // kg consumed per resource
launchPadTransferred: Partial<Record<ResourceType, number>>; // kg transferred to orbit
routeRevenue: number;          // total credits earned from Earth deliveries
routeOperatingCost: number;    // total route operating costs
routeDeliveries: Partial<Record<ResourceType, number>>; // kg delivered per resource
```

### Process Function Return Values

Each process function should return a summary object:

- `processMiningSites()` → `{ extracted: Partial<Record<ResourceType, number>> }`
- `processRefineries()` → `{ produced: ..., consumed: ... }`
- `processSurfaceLaunchPads()` → `{ transferred: ... }`
- `processRoutes()` → `{ revenue: number, operatingCost: number, delivered: ... }`

`advancePeriod()` captures these return values and includes them in the `PeriodSummary`.

---

## 6. Revenue/Period Column in Route Table

**Problem:** The route management table in `src/ui/logistics.ts` (line 483) has a Revenue/Period column hardcoded to `'-'`.

**Fix:** Calculate and display the expected revenue per period:
- For routes where the final leg destination is Earth: `route.throughputPerPeriod × RESOURCES_BY_ID[route.resourceType].baseValuePerKg`
- For inter-site routes: display `$0` (resources are transferred, not sold)
- For paused/broken routes: display `'-'`

Format as currency using the existing `formatMoney()` helper.

---

## 7. Route Creation Map-Based Builder

This is the most significant UI addition. The route management tab in the Logistics Center currently has no way for players to create routes from proven legs — the core functions `createRoute()` and `addCraftToLeg()` exist and are tested, but no UI invokes them.

### Schematic Body Map

Replace the placeholder `div` in the routes tab (logistics.ts line 412–415) with an **SVG-based schematic map** showing celestial bodies as labeled icons/circles, positioned in a simplified layout (not to orbital scale — schematic positioning for readability).

Body positions should be roughly: Sun center-left, inner planets (Earth, Moon) center, Mars right of center, asteroid belt (Ceres) further right, outer planets (Jupiter, Saturn, Titan) right edge. Only bodies that have mining sites OR are route endpoints should be shown — plus Earth (always shown as the universal destination).

### Proven Leg Visualization

Proven legs appear as **dashed lines** between their origin and destination bodies on the map. Each line is an SVG `<line>` or `<path>` with `stroke-dasharray`. Lines are colored by the resource state they can carry (solid=brown, gas=blue, liquid=green) or a neutral color if multiple states are possible.

When the player hovers over a proven leg line, show a tooltip with: craft design name, cargo capacity, cost per run.

### Route Creation Workflow

1. Player clicks a **"Create Route"** button below the map.
2. The UI enters **route builder mode**: a panel appears below the map with:
   - Resource type dropdown (filtered to resources that have at least one proven leg touching a body that produces them).
   - A "legs chain" area showing the sequence of legs added so far.
   - Route name text input.
3. Clicking a body on the map highlights all **outbound proven legs** from that body as solid lines (non-outbound legs stay dashed/faded). The first click sets the route origin.
4. Clicking a highlighted outbound leg adds it to the chain. The destination body of that leg becomes the new "current position," and its outbound legs are highlighted.
5. The player continues clicking legs until the chain reaches the desired destination.
6. "Confirm" button calls `createRoute()` with the selected resource type, leg IDs, and name. "Cancel" exits builder mode.
7. Validation: the chain must have at least one leg. Display an error if `createRoute()` fails.

### Active Route Visualization

Active routes appear as **solid colored lines** on the map (distinct from dashed proven legs). Paused routes are dimmer. Broken routes are red. Clicking a route line or its table row highlights it on both the map and table.

### Craft Assignment

In the route table, each route row expands to show its legs. Each leg row shows the current craft count with **inline +/−** buttons. The + button calls `addCraftToLeg()`, which triggers a build cost. The − button reduces craft count (minimum 1). Both recalculate route throughput and cost displays.

---

## 8. Testing Gaps

### Unit Tests

All new unit tests go in existing test files where the tested module already has coverage.

**Storage capacity overflow** (`mining.test.ts`): Create a site with a single storage silo (2000 kg capacity), run extraction for enough periods that output would exceed 2000 kg, verify that stored amount is clamped to capacity and no resources are lost or created.

**Multi-resource extraction competition** (`mining.test.ts`): Create a site with two different extractors (e.g., drill + gas collector on Mars) both connected to appropriate storage. Run extraction and verify both resources are extracted independently and stored correctly without interference.

**Regolith electrolysis recipe** (`refinery.test.ts`): Set up a refinery with the regolith electrolysis recipe, provide 100 kg regolith in connected storage, run `processRefineries()`, verify 15 kg oxygen produced and 100 kg regolith consumed.

**Hydrazine synthesis recipe** (`refinery.test.ts`): Set up a refinery with the hydrazine synthesis recipe, provide 50 kg hydrogen, run `processRefineries()`, verify 40 kg hydrazine produced and 50 kg hydrogen consumed.

**Route to non-Earth body without destination site** (`routes.test.ts`): Create a route targeting a non-Earth body that has no mining site. Run `processRoutes()` and verify: no money is deducted, no resources are lost from the source orbital buffer, and the route status is set to `'broken'`.

**Multi-period accumulation** (`mining.test.ts` or a new `integration.test.ts`): Set up a complete pipeline (extractor → storage → refinery → storage → launch pad → orbital buffer), run `advancePeriod()` 3–5 times, verify resources accumulate correctly at each stage with no state corruption, double-counting, or negative values.

### E2E Tests

All E2E tests use Playwright targeting Chromium. **Use Playwright MCP for interactive debugging** when tests fail — don't rerun blindly. Each E2E test must be independent (sets up its own state, no serial dependencies between tests).

**Mining panel interactions** (`e2e/mining-interactions.spec.ts`): Inject game state with a mining site that has a refinery module. Verify the recipe selection dropdown appears, change the recipe, verify the UI updates. Also verify module connection toggle works.

**Route management interactions** (`e2e/route-interactions.spec.ts`): Inject game state with an active route. Verify the route appears in the table. Toggle route status (active → paused), verify UI updates. Test the +/− craft buttons on a route leg.

**Resource contract milestones — early chain** (`e2e/resource-contracts.spec.ts`): Test contracts 1 (Lunar Survey — land BCU + Drill on Moon) and 2 (First Harvest — return 100 kg water ice to Earth). Inject state to simulate completion conditions, verify contracts complete and unlock the next stage.

**Resource contract milestones — automation chain** (`e2e/resource-contracts.spec.ts`): Test contracts 8 (Automate It — first automated route) and 12 (Supply Network — 3+ active routes). Inject state with the prerequisites, verify contract completion detection works correctly.

---

## 9. Technical Decisions

- **SVG for the route builder map** — DOM-based, fits the UI layer pattern, supports click events and hover natively, no PixiJS dependency in the UI layer.
- **Proportional storage fill** — distributes resources across connected storage modules proportionally to remaining capacity. Simple, balanced, and deterministic.
- **Body index rebuilt per period** — the `miningSitesByBodyId` map is cheap to build and avoids stale cache issues. No need to maintain it on game state.
- **Per-module storage as optional fields** — only storage-type modules populate `stored`/`storageCapacityKg`/`storageState`. Other module types ignore these fields. This avoids a parallel module hierarchy.
- **Backwards-compatible save/load** — old saves without per-module `stored` fields will have them defaulted to `{}` during deserialization. Site-level `storage` is recomputed on load.

---

## 10. What This Iteration Does NOT Include

- **No new resource types or recipes** — the 10-resource, 4-recipe system is unchanged.
- **No new parts or modules** — Mk2 storage modules are a future addition that this iteration *enables* but does not implement.
- **No off-world bases, crew transport, or life support** — still future features.
- **No full PixiJS route rendering on the in-flight map** — the placeholder overlay remains; the new SVG map is in the Logistics Center only.
- **No bundle code-splitting** — deferred as before.
