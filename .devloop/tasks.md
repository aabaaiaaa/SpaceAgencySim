# Iteration 10 — Tasks

See `.devloop/requirements.md` for full context on all items below.

---

## Bug Fixes & Cleanup

### TASK-001: Fix route cost/destination validation order in processRoutes()
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/core/routes.ts` (around lines 310–340), move the destination mining site lookup to *before* the `spend()` call. If the route's final destination is a non-Earth body and no mining site is found for that body, skip processing that route for this period and set its status to `'broken'`. Do not deduct money or resources. See requirements.md section 1.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-002: Remove dead MiningSite.production field
- **Status**: pending
- **Dependencies**: none
- **Description**: Remove the `production` field from the `MiningSite` interface in `src/core/gameState.ts`, remove its initialization (`production: {}`) in `createMiningSite()` in `src/core/mining.ts`, and remove any test assertions that reference it (e.g., in `src/tests/mining.test.ts`). See requirements.md section 2.
- **Verification**: `npx vitest run src/tests/mining.test.ts && npx tsc --noEmit src/core/gameState.ts src/core/mining.ts`

---

## Per-Module Storage Refactor

### TASK-003: Add per-module storage fields to MiningSiteModule
- **Status**: pending
- **Dependencies**: TASK-002
- **Description**: In `src/core/gameState.ts`, add optional fields to `MiningSiteModule`: `stored?: Partial<Record<ResourceType, number>>`, `storageCapacityKg?: number`, `storageState?: ResourceState`. In `src/core/mining.ts`, update `addModuleToSite()` to populate these fields from the part definition's properties when the module type is a storage type (STORAGE_SILO, PRESSURE_VESSEL, FLUID_TANK). Initialize `stored` to `{}` for storage modules. Add a `recomputeSiteStorage(site)` helper that aggregates all module `stored` values into `site.storage`. See requirements.md section 3.
- **Verification**: `npx vitest run src/tests/mining.test.ts && npx tsc --noEmit src/core/gameState.ts src/core/mining.ts`

### TASK-004: Refactor extraction to use per-module storage
- **Status**: pending
- **Dependencies**: TASK-003
- **Description**: In `src/core/mining.ts`, update `processMiningSites()` to distribute extracted resources proportionally across connected storage modules based on each module's remaining capacity (see requirements.md section 3 "Extraction Changes"). After distributing, call `recomputeSiteStorage(site)`. Update existing extraction tests in `mining.test.ts` to verify resources appear in individual module `stored` records as well as `site.storage`.
- **Verification**: `npx vitest run src/tests/mining.test.ts`

### TASK-005: Refactor refinery processing to use per-module storage
- **Status**: pending
- **Dependencies**: TASK-003
- **Description**: In `src/core/refinery.ts`, update `processRefineries()` to read input resources from individual connected storage modules' `stored` fields and write output resources to individual connected storage modules proportionally. Consume inputs proportionally from source modules. After processing, call `recomputeSiteStorage(site)`. Update existing refinery tests in `refinery.test.ts` to verify module-level storage changes. See requirements.md section 3 "Refinery Changes".
- **Verification**: `npx vitest run src/tests/refinery.test.ts`

### TASK-006: Refactor launch pad to use per-module storage
- **Status**: pending
- **Dependencies**: TASK-004, TASK-005
- **Description**: In `src/core/mining.ts`, update `processSurfaceLaunchPads()` to read from connected storage modules' individual `stored` fields instead of `site.storage`. Deduct from individual modules proportionally. After transferring to orbital buffer, call `recomputeSiteStorage(site)`. See requirements.md section 3 "Launch Pad Changes".
- **Verification**: `npx vitest run src/tests/mining.test.ts`

### TASK-007: Update save/load for per-module storage
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: In `src/core/saveload.ts`, ensure the new `stored`, `storageCapacityKg`, and `storageState` fields on `MiningSiteModule` are serialized. For backwards compatibility, add deserialization logic that defaults `stored` to `{}` for any module with a storage-type `MiningModuleType` if the field is missing. After loading, call `recomputeSiteStorage()` on each site to rebuild `site.storage` from module-level data. Update or add a round-trip save/load test.
- **Verification**: `npx vitest run src/tests/mining.test.ts && npx vitest run src/tests/saveload.test.ts`

---

## Route Processing Scalability

### TASK-008: Add miningSitesByBodyId index to processRoutes()
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: In `src/core/routes.ts`, add a helper function `buildSiteIndex(sites: MiningSite[]): Map<string, MiningSite[]>` that groups mining sites by `bodyId`. At the start of `processRoutes()`, build this index once and use `index.get(bodyId)` instead of `state.miningSites.find(...)` for all site lookups within the function. This is an internal optimization — no API or behavior changes. See requirements.md section 4.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

---

## Period Summary Reporting

### TASK-009: Extend PeriodSummary with resource system fields
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/core/period.ts`, add the following fields to the `PeriodSummary` interface: `miningExtracted`, `refineryProduced`, `refineryConsumed`, `launchPadTransferred` (all `Partial<Record<ResourceType, number>>`), plus `routeRevenue: number`, `routeOperatingCost: number`, `routeDeliveries: Partial<Record<ResourceType, number>>`. Define return types for each process function as described in requirements.md section 5.
- **Verification**: `npx tsc --noEmit src/core/period.ts`

### TASK-010: Wire process function return values into advancePeriod()
- **Status**: pending
- **Dependencies**: TASK-009, TASK-008
- **Description**: Update `processMiningSites()`, `processRefineries()`, `processSurfaceLaunchPads()`, and `processRoutes()` to return summary objects (extracted amounts, produced/consumed, transferred, revenue/cost/delivered). In `advancePeriod()` (period.ts lines 177–180), capture these return values and include them in the `PeriodSummary` return object. See requirements.md section 5.
- **Verification**: `npx vitest run src/tests/mining.test.ts && npx vitest run src/tests/refinery.test.ts && npx vitest run src/tests/routes.test.ts`

---

## Revenue Display

### TASK-011: Wire up Revenue/Period column in route management table
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/ui/logistics.ts` (around line 483), replace the hardcoded `'-'` in the Revenue/Period column with a calculated value. For active routes where the final leg destination body is Earth: `route.throughputPerPeriod × RESOURCES_BY_ID[route.resourceType].baseValuePerKg`, formatted with `formatMoney()`. For inter-site routes: display `$0`. For paused/broken routes: display `'-'`. See requirements.md section 6.
- **Verification**: `npx vitest run src/tests/routes.test.ts && npx tsc --noEmit src/ui/logistics.ts`

---

## Route Creation UI — Map Builder

### TASK-012: Build SVG schematic body map component
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/ui/logistics.ts` (or a new sub-module `src/ui/logistics/routeMap.ts` with barrel re-export), replace the placeholder div in the routes tab (around line 412–415) with an SVG-based schematic map. Render celestial bodies as labeled circles positioned schematically (Sun left, Earth/Moon center, Mars right-center, Ceres further right, Jupiter/Saturn/Titan right). Only show bodies that have mining sites or are route endpoints, plus Earth always. Style with existing CSS design tokens. The map should be a reusable render function that takes game state and returns/populates an SVG element. See requirements.md section 7 "Schematic Body Map".
- **Verification**: `npx tsc --noEmit src/ui/logistics.ts` and manually verify the map renders in the Logistics Center routes tab via dev server.

### TASK-013: Add proven leg dashed lines and route solid lines to map
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: On the SVG schematic map, render proven legs as dashed lines (`stroke-dasharray`) between origin and destination bodies. Render active routes as solid colored lines (paused routes dimmer, broken routes red). Add hover tooltips on proven leg lines showing craft design name, cargo capacity, and cost per run. Add click handling on route lines that highlights the corresponding row in the route table. See requirements.md section 7 "Proven Leg Visualization" and "Active Route Visualization".
- **Verification**: `npx tsc --noEmit src/ui/logistics.ts` and manually verify legs and routes render on the map via dev server.

### TASK-014a: Implement route builder mode — UI scaffold and resource picker
- **Status**: pending
- **Dependencies**: TASK-013
- **Description**: Add a "Create Route" button below the map. When clicked, enter route builder mode: show a builder panel with a resource type dropdown (filtered to resources that have at least one proven leg touching a body that produces them), a route name text input, a "legs chain" display area (initially empty), and Cancel/Confirm buttons. Cancel exits builder mode. The builder state (selected resource, chain of legs, current body position) should be managed as local UI state. See requirements.md section 7 "Route Creation Workflow" steps 1–2.
- **Verification**: `npx tsc --noEmit src/ui/logistics.ts` and manually verify the builder panel appears/disappears via dev server.

### TASK-014b: Implement route builder mode — click-to-chain interaction
- **Status**: pending
- **Dependencies**: TASK-014a
- **Description**: In route builder mode, clicking a body on the map sets it as the route origin and highlights all outbound proven legs from that body (change dashed to solid, fade non-outbound legs). Clicking a highlighted leg adds it to the chain display, updates the "current position" to that leg's destination body, and highlights the new body's outbound legs. The chain display shows each added leg with origin → destination labels. Confirm button calls `createRoute()` from `src/core/routes.ts` with the selected name, resource type, and proven leg IDs. Show error text if creation fails (e.g., empty chain). On success, exit builder mode and re-render the routes tab. See requirements.md section 7 "Route Creation Workflow" steps 3–7.
- **Verification**: `npx tsc --noEmit src/ui/logistics.ts` and manually test the full route creation flow via dev server.

### TASK-015: Add inline +/- craft count controls on route legs
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: In the route table in `src/ui/logistics.ts`, make each route row expandable to show its legs. Each leg row displays the current craft count with +/− buttons. The + button calls `addCraftToLeg()` (which triggers build cost via `spend()`). The − button decrements craft count (minimum 1) and recalculates throughput/cost. Both buttons re-render the route table to show updated throughput, cost, and revenue. See requirements.md section 7 "Craft Assignment".
- **Verification**: `npx tsc --noEmit src/ui/logistics.ts` and manually test expanding a route and clicking +/− via dev server.

---

## Unit Test Gaps

### TASK-016: Unit tests for storage overflow and multi-resource extraction
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: In `src/tests/mining.test.ts`, add two tests: (1) **Storage capacity overflow** — create a site with a storage silo at near-capacity, run extraction, verify stored amount is clamped to the module's `storageCapacityKg` and no resources are created or lost. (2) **Multi-resource extraction competition** — create a site on a body with multiple extractable resources (e.g., Mars: water ice + CO₂), with appropriate extractors and storage for each, run extraction, verify both resources are extracted independently. Tag one with `@smoke`. See requirements.md section 8.
- **Verification**: `npx vitest run src/tests/mining.test.ts --testNamePattern "overflow|multi-resource"`

### TASK-017: Unit tests for regolith electrolysis and hydrazine synthesis
- **Status**: pending
- **Dependencies**: TASK-005
- **Description**: In `src/tests/refinery.test.ts`, add two tests that run the untested recipes through `processRefineries()`: (1) **Regolith electrolysis** — provide 100 kg regolith in connected storage, process, verify 15 kg oxygen produced and 100 kg regolith consumed. (2) **Hydrazine synthesis** — provide 50 kg hydrogen, process, verify 40 kg hydrazine produced and 50 kg hydrogen consumed. Tag one with `@smoke`. See requirements.md section 8.
- **Verification**: `npx vitest run src/tests/refinery.test.ts --testNamePattern "regolith|hydrazine"`

### TASK-018: Unit test for route to non-Earth body without destination site
- **Status**: pending
- **Dependencies**: TASK-001
- **Description**: In `src/tests/routes.test.ts`, add a test that creates a route targeting a non-Earth body that has no mining site. Run `processRoutes()` and verify: (1) no money is deducted (`state.funds` unchanged), (2) no resources are removed from the source orbital buffer, (3) the route status is set to `'broken'`. Tag with `@smoke`. See requirements.md section 8.
- **Verification**: `npx vitest run src/tests/routes.test.ts --testNamePattern "without destination"`

### TASK-019: Unit test for multi-period accumulation
- **Status**: pending
- **Dependencies**: TASK-010
- **Description**: In `src/tests/mining.test.ts` (or create `src/tests/resource-integration.test.ts` if mining.test.ts is already large), add a test that sets up a complete pipeline: extractor → storage → refinery → storage → launch pad → orbital buffer. Run `advancePeriod()` 3–5 times. Verify: (1) resources accumulate at each stage, (2) no negative values, (3) no double-counting, (4) orbital buffer grows as expected, (5) PeriodSummary fields report non-zero extraction/refining/transfer amounts. Tag with `@smoke`. See requirements.md section 8.
- **Verification**: `npx vitest run src/tests/mining.test.ts --testNamePattern "multi-period"` (or the integration test file)

---

## E2E Tests

### TASK-020: E2E test for mining panel interactions
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: Create `e2e/mining-interactions.spec.ts`. Inject game state with a mining site that has a refinery module with available recipes and multiple modules with pipe connections. Test: (1) Navigate to Logistics Center, verify mining tab renders the site. (2) Change the refinery recipe via dropdown, verify UI updates. (3) Verify module connection display is accurate. Each test is independent — sets up its own state. Use Playwright MCP for interactive debugging if tests fail. Tag one test with `@smoke`. See requirements.md section 8.
- **Verification**: `npx playwright test e2e/mining-interactions.spec.ts`

### TASK-021: E2E test for route management interactions
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: Create `e2e/route-interactions.spec.ts`. Inject game state with an active route (with proven legs and at least one route). Test: (1) Navigate to Logistics Center routes tab, verify route appears in table. (2) Toggle route status (active → paused), verify UI updates. (3) Expand a route, verify leg details appear with +/− craft buttons. Each test is independent. Use Playwright MCP for interactive debugging if tests fail. Tag one test with `@smoke`. See requirements.md section 8.
- **Verification**: `npx playwright test e2e/route-interactions.spec.ts`

### TASK-022: E2E test for resource contract milestones — early chain
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: Create `e2e/resource-contracts.spec.ts`. Test contracts 1 (Lunar Survey) and 2 (First Harvest) as key milestones. For each: inject game state that simulates the contract's completion conditions (e.g., a BCU + Drill landed on Moon for contract 1; 100 kg water ice delivered to Earth for contract 2), trigger the contract check, and verify the contract completes and the next contract becomes available. Each test is independent. Use Playwright MCP for interactive debugging if tests fail. Tag one test with `@smoke`. See requirements.md section 8.
- **Verification**: `npx playwright test e2e/resource-contracts.spec.ts --grep "early"`

### TASK-023: E2E test for resource contract milestones — automation chain
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: In `e2e/resource-contracts.spec.ts`, add tests for contracts 8 (Automate It — first automated route set up) and 12 (Supply Network — 3+ active routes simultaneously). Inject state with the prerequisites for each contract, trigger the contract check, verify completion. Each test is independent. Use Playwright MCP for interactive debugging if tests fail. Tag one test with `@smoke`. See requirements.md section 8.
- **Verification**: `npx playwright test e2e/resource-contracts.spec.ts --grep "automation"`

---

## Final Verification

### TASK-024: Final verification pass
- **Status**: pending
- **Dependencies**: TASK-007, TASK-010, TASK-011, TASK-014b, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023
- **Description**: Run the full unit test suite and typecheck to verify nothing is broken. Check that all new smoke tests pass. Verify no TypeScript errors in changed files. Run ESLint on changed files. This is a validation-only task — do not write new code.
- **Verification**: `npm run test:unit && npm run typecheck && npm run lint`
