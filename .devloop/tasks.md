# Iteration 11 — Tasks

## Phase A: Hardening & Tech Debt

### TASK-001a: Split logistics.ts — extract miningSites.ts and routeTable.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/ui/logistics/` directory. Extract the mining sites tab rendering code into `logistics/miningSites.ts` and the route table (route list, status toggle, leg expansion, +/- craft buttons, revenue column) into `logistics/routeTable.ts`. Move the relevant private functions and local state. Update internal imports between the new modules. Do NOT create the barrel re-export yet — that comes in TASK-001c.
- **Verification**: `npx tsc --noEmit` passes. `npx vitest run src/tests/logistics.test.ts` passes (if exists). The original `src/ui/logistics.ts` still exists with reduced content.

### TASK-001b: Split logistics.ts — extract routeMap.ts and routeBuilder.ts
- **Status**: done
- **Dependencies**: TASK-001a
- **Description**: Extract the SVG schematic map component (`_renderRouteMap`, `_getBodyColor`, body positioning, proven leg / active route line drawing) into `logistics/routeMap.ts`. Extract the route builder mode interaction (route creation workflow, click-to-chain, confirm/cancel) into `logistics/routeBuilder.ts`. `_getBodyColor` should be exported from `routeMap.ts` for use by `routeBuilder.ts`. Update internal imports.
- **Verification**: `npx tsc --noEmit` passes. The original `src/ui/logistics.ts` should now only contain the barrel re-export setup or shared initialisation code.

### TASK-001c: Split logistics.ts — barrel re-export and verify
- **Status**: done
- **Dependencies**: TASK-001b
- **Description**: Convert the remaining `src/ui/logistics.ts` into `src/ui/logistics/index.ts` (barrel re-export). It should re-export all public functions from the four sub-modules. Delete the old `src/ui/logistics.ts` file. Verify that all external imports (other UI modules, E2E tests) continue to resolve correctly. Run the full unit test suite and targeted E2E tests.
- **Verification**: `npx tsc --noEmit` passes. `npm run test:unit` passes. `npx playwright test e2e/route-interactions.spec.ts e2e/mining-interactions.spec.ts` passes.

### TASK-002: E2E test for craft +/- button functionality
- **Status**: done
- **Dependencies**: TASK-001c
- **Description**: In `e2e/route-interactions.spec.ts`, add a test that seeds a save with an active route containing at least one leg. Locate the + button for that leg. Record current craft count and player money. Click +, verify craft count incremented, money decreased, and throughput display updated. Click -, verify craft count decrements (minimum 1). Use stable `data-testid` or `data-route-id` selectors.
- **Verification**: `npx playwright test e2e/route-interactions.spec.ts` passes.

### TASK-003: E2E test for route builder confirm flow
- **Status**: done
- **Dependencies**: TASK-001c
- **Description**: In `e2e/route-interactions.spec.ts` (or a new spec), add a test that seeds a save with at least one proven leg between two bodies. Open the Logistics Center routes tab, click "Create Route", select a resource type, click the origin body on the SVG map, click a highlighted proven leg, click "Confirm". Verify a new route appears in the route table with the correct resource type. Use Playwright MCP if debugging is needed.
- **Verification**: `npx playwright test e2e/route-interactions.spec.ts` passes.

### TASK-004: Unit test for orbital buffer overflow behaviour
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/tests/mining.test.ts`, add a test that creates a site with a launch pad and storage modules filled with a large amount of resources. Run `processSurfaceLaunchPads()` multiple times. Verify that `site.orbitalBuffer` grows without bound — documenting the current intentional behaviour. Add a brief code comment in `src/core/mining.ts` at the launch pad processing section confirming orbital buffers are intentionally unbounded.
- **Verification**: `npx vitest run src/tests/mining.test.ts --testNamePattern "orbital buffer"` passes.

### TASK-005: Extract SVG body colors to CSS custom properties
- **Status**: done
- **Dependencies**: TASK-001b
- **Description**: Define CSS custom properties for celestial body colours in the existing game stylesheet (e.g. `--body-color-earth: #4488CC;`). Update the `_getBodyColor()` function (now in `src/ui/logistics/routeMap.ts` after the split) to read from a shared constant map that mirrors the CSS values. Ensure the SVG map still renders body circles with the correct colours.
- **Verification**: `npx tsc --noEmit` passes. `npx playwright test e2e/route-interactions.spec.ts` passes (routes tab still renders correctly).

### TASK-006: Route revenue integration test
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/tests/routes.test.ts`, add a test that sets up a complete pipeline: mining site with orbital buffer stocked with a resource, an active route from that body to Earth with known `throughputPerPeriod`. Run `advancePeriod()`. Verify `PeriodSummary.routeRevenue` equals `throughputPerPeriod * RESOURCES_BY_ID[resourceType].baseValuePerKg`. Also verify `routeDeliveries` has the correct amounts.
- **Verification**: `npx vitest run src/tests/routes.test.ts --testNamePattern "revenue"` passes.

### TASK-007: Non-null assertion cleanup in routes.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/routes.ts` at lines 366-367, replace the `destSite!.orbitalBuffer` non-null assertions with a local variable assigned after the guard clause. The guard at line 343 ensures `destSite` is non-null in the else branch, but a local variable makes this explicit. No behavioural change.
- **Verification**: `npx tsc --noEmit` passes. `npx vitest run src/tests/routes.test.ts` passes.

### TASK-008a: In-flight map — PixiJS route arc rendering
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/render/map.ts`, replace the `_drawRouteOverlay()` function's straight-line rendering with quadratic Bezier curves between body positions. Compute curve control points using the midpoint between bodies, offset perpendicular to the line by 15-20% of inter-body distance. Draw each route leg as a separate arc. Keep colour coding (green active, grey paused, red broken). Use dashed line style for proven legs (when overlay visible) and solid for active routes. Add animated flow dots (small circles) that travel along the Bezier path to indicate cargo direction — use a small pool of `PIXI.Graphics` circles repositioned each frame using parametric `t` interpolation.
- **Verification**: `npx tsc --noEmit` passes. `npx vitest run src/tests/map.test.ts` passes (if exists). Visual inspection via dev server shows curved route arcs with animated flow dots.

### TASK-008b: In-flight map — hub markers
- **Status**: done
- **Dependencies**: TASK-008a
- **Description**: In `src/render/map.ts`, add hub marker rendering. Surface hubs: small labelled base icon drawn at the body's surface position (visible when zoomed in). Orbital hubs: small station icon at the orbital altitude ring. Online hubs fully opaque, offline/under-construction hubs at 50% alpha. Use existing PixiJS sprite/graphics patterns from the map renderer. Add markers to the render loop so they update position with camera pan/zoom.
- **Verification**: `npx tsc --noEmit` passes. Visual inspection via dev server shows hub markers on the map.

### TASK-008c: In-flight map — route tooltips and interactivity
- **Status**: done
- **Dependencies**: TASK-008b
- **Description**: In `src/render/map.ts` and `src/ui/map.ts`, add hover tooltips for route arcs (route name, resource type, throughput, status, revenue for Earth-bound) and hub markers (hub name, body, online status, facility list). Use PixiJS `hitArea` or proximity-based mouse distance detection for route curves. In tracking station mode, clicking a hub marker opens the hub info panel. Write a targeted E2E test that verifies the route overlay toggle works and at least one route arc is drawn when routes exist.
- **Verification**: `npx tsc --noEmit` passes. `npx playwright test e2e/route-interactions.spec.ts` passes.

---

## Phase B: Off-World Hubs

### TASK-009: Hub type definitions
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/core/hubTypes.ts` with TypeScript interfaces: `Hub` (id, name, type, bodyId, altitude?, coordinates?, biomeId?, facilities, tourists, partInventory, constructionQueue, maintenanceCost, established, online), `ConstructionProject` (facilityId, resourcesRequired, resourcesDelivered, moneyCost, startedPeriod, completedPeriod?), `ResourceRequirement` (resourceId, amount), `Tourist` (id, name, arrivalPeriod, departurePeriod, revenue), and `HubType` union type. See the implementation plan for exact field types.
- **Verification**: `npx tsc --noEmit src/core/hubTypes.ts` passes with no errors.

### TASK-010: Hub constants and facility definitions
- **Status**: done
- **Dependencies**: TASK-009
- **Description**: Add `OUTPOST_CORE` to PartType and `CREW_HAB` to FacilityId in `src/core/constants.ts`. Add `HUB_PROXIMITY_DOCK_RADIUS` (1000m) and `EARTH_HUB_ID` ('earth') constants. Create `src/data/hubFacilities.ts` with: `EnvironmentCategory` enum, `ENVIRONMENT_COST_MULTIPLIER`, `BODY_ENVIRONMENT` map, `IMPORT_TAX_MULTIPLIER`, `DEFAULT_IMPORT_TAX`, `CREW_HAB_CAPACITY` per tier, `SURFACE_HUB_FACILITIES`, `ORBITAL_HUB_FACILITIES`, `EARTH_ONLY_FACILITIES`, `FacilityResourceCost` interface, `OFFWORLD_FACILITY_COSTS`, and `OFFWORLD_FACILITY_UPKEEP`. All data frozen with `Object.freeze()`. See implementation plan for exact values.
- **Verification**: `npx tsc --noEmit` passes.

### TASK-011: Hub test factories
- **Status**: done
- **Dependencies**: TASK-010
- **Description**: Add hub factory functions to `src/tests/_factories.ts`: `makeHub(overrides)`, `makeEarthHub(overrides)`, `makeOrbitalHub(overrides)`, `makeConstructionProject(overrides)`. Import `Hub`, `ConstructionProject` types from hubTypes and `EARTH_HUB_ID` from constants. Factories use sensible defaults (makeHub defaults to MOON surface hub, makeEarthHub creates Earth HQ with starter facilities, makeOrbitalHub defaults to Earth orbit at 200km). See implementation plan for exact signatures.
- **Verification**: `npx tsc --noEmit` passes.

### TASK-012: GameState hub fields and Earth hub initialization
- **Status**: done
- **Dependencies**: TASK-011
- **Description**: Add `hubs: Hub[]` and `activeHubId: string` to the `GameState` interface in `src/core/gameState.ts`. Add `stationedHubId: string` and `transitUntil: number | null` to the `CrewMember` interface. Update `createGameState()` to create an Earth hub from the existing facilities and add it to `hubs[]`, set `activeHubId` to `EARTH_HUB_ID`. Write unit tests in `src/tests/hubs.test.ts` verifying: hubs array exists with Earth hub, activeHubId is 'earth', Earth hub facilities match starter facilities. Fix any existing test failures caused by the new required fields on CrewMember.
- **Verification**: `npx vitest run src/tests/hubs.test.ts` passes. `npm run test:unit` passes (no regressions).

### TASK-013: Core hub module — CRUD and helpers
- **Status**: done
- **Dependencies**: TASK-012
- **Description**: Create `src/core/hubs.ts` with: `getActiveHub()`, `getHub()`, `setActiveHub()`, `getHubsOnBody()`, `createHub()`, `getEnvironmentCategory()`, `getEnvironmentCostMultiplier()`, `getImportTaxMultiplier()`. `createHub()` generates a unique hub ID, computes environment-scaled Crew Hab construction project, and pushes the new hub (offline) onto `state.hubs`. Write unit tests in `src/tests/hubs.test.ts` for all CRUD operations and environment/tax helpers. See implementation plan for exact function signatures and test cases.
- **Verification**: `npx vitest run src/tests/hubs.test.ts` passes.

### TASK-014: Save/load migration for hubs
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Add `migrateToHubs()` to `src/core/saveload.ts`. It creates an Earth hub from legacy saves' top-level `facilities` and `partInventory`, sets `activeHubId`, and defaults `stationedHubId`/`transitUntil` on crew. Idempotent — skips if `hubs` already exists. Call it inside `loadGame()` after existing migrations. Bump `SAVE_VERSION`. Write tests in `src/tests/hubs-save-migration.test.ts`: legacy save creates Earth hub, crew get stationedHubId, no double-migration, round-trip serialisation preserves hubs.
- **Verification**: `npx vitest run src/tests/hubs-save-migration.test.ts` passes. `npm run test:unit` passes.

### TASK-015: Make construction module hub-aware
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Update `hasFacility()`, `getFacilityTier()`, `buildFacility()`, `upgradeFacility()` in `src/core/construction.ts` to read/write from the active hub's facilities (or a specified hub via optional `hubId` parameter) instead of `state.facilities` directly. Import `getActiveHub`/`getHub` from hubs.ts. Write tests in `src/tests/hubs.test.ts` verifying: hasFacility checks active hub, getFacilityTier returns active hub's tier, explicit hubId overrides active hub. Fix any existing construction tests that break.
- **Verification**: `npx vitest run src/tests/hubs.test.ts` passes. `npm run test:unit` passes.

### TASK-016: Hub switcher UI component
- **Status**: done
- **Dependencies**: TASK-015
- **Description**: Create `src/ui/hubSwitcher.ts` with `initHubSwitcher()`, `renderHubSwitcher()`, `destroyHubSwitcher()`. Renders a `<select id="hub-switcher">` dropdown listing all hubs with name, body, and status indicators ([Building]/[Offline]). On change, calls `setActiveHub()` and triggers a re-render callback. Mount it in `src/ui/hub.ts` inside `initHubUI()` and clean up in `destroyHubUI()`. Write E2E test in `e2e/hubs-switcher.spec.ts`: switcher visible, lists all hubs, Earth first. See implementation plan for exact HTML/CSS structure.
- **Verification**: `npx playwright test e2e/hubs-switcher.spec.ts` passes.

### TASK-017: Hub-aware hub rendering
- **Status**: done
- **Dependencies**: TASK-016
- **Description**: Update `src/render/hub.ts` to read the active hub's body and set sky/ground colours accordingly (surface hubs use body visuals, orbital hubs get starfield). Update `src/ui/hub.ts` to show only the active hub's available and built facilities — under-construction facilities at 50% opacity, Earth-only facilities hidden for non-Earth hubs. Add E2E test: switching to a non-Earth hub via the switcher changes the displayed facilities.
- **Verification**: `npx playwright test e2e/hubs-switcher.spec.ts` passes.

### TASK-018: Outpost Core part definition
- **Status**: done
- **Dependencies**: TASK-010
- **Description**: Add the Outpost Core part to `src/data/parts.ts`: id `outpost_core`, type `OUTPOST_CORE`, 2000 kg, $500k, 40x60 size, top and bottom snap points, activatable with DEPLOY behaviour. Write unit tests in `src/tests/hubs-outpost-core.test.ts` verifying: part exists in catalog, has correct type/mass/cost, has top and bottom snap points.
- **Verification**: `npx vitest run src/tests/hubs-outpost-core.test.ts` passes. `npx tsc --noEmit` passes.

### TASK-019: Outpost Core deployment logic
- **Status**: done
- **Dependencies**: TASK-018, TASK-013
- **Description**: Add `deployOutpostCore(state, flight, name)` to `src/core/hubs.ts`. Creates a surface hub if landed, orbital hub if in orbit. Deducts Crew Hab monetary cost via `spend()`. Fails if insufficient money. Write tests in `src/tests/hubs-outpost-core.test.ts`: surface deployment creates surface hub, orbital deployment creates orbital hub with altitude, cost deducted, insufficient money fails.
- **Verification**: `npx vitest run src/tests/hubs-outpost-core.test.ts` passes.

### TASK-020: Construction project resource delivery and completion
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Add `deliverResources()`, `isConstructionComplete()`, `processConstructionProjects()`, and `getAvailableFacilitiesToBuild()` to `src/core/hubs.ts`. `deliverResources` records partial deliveries capped at required. `processConstructionProjects` marks completed projects, adds facilities at tier 1, brings hub online when Crew Hab completes. `getAvailableFacilitiesToBuild` returns buildable facilities (excludes built, in-progress, Earth-only, and Crew Hab). Write tests in `src/tests/hubs-construction.test.ts`. See plan for exact test cases.
- **Verification**: `npx vitest run src/tests/hubs-construction.test.ts` passes.

### TASK-021: Hub maintenance and offline logic
- **Status**: done
- **Dependencies**: TASK-020
- **Description**: Add `calculateHubMaintenance()`, `processHubMaintenance()`, and `reactivateHub()` to `src/core/hubs.ts`. Maintenance sums per-facility upkeep scaled by tier (Earth returns 0, offline returns 0). Processing deducts costs; insufficient money triggers offline state with crew evacuation and tourist eviction. Reactivation costs one period's maintenance. Write tests in `src/tests/hubs-economy.test.ts`. See plan for exact test cases.
- **Verification**: `npx vitest run src/tests/hubs-economy.test.ts` passes.

### TASK-022: Hub-scoped crew
- **Status**: done
- **Dependencies**: TASK-021
- **Description**: Create `src/core/hubCrew.ts` with: `getCrewAtHub()`, `hireCrewAtHub()`, `requestCrewTransfer()`, `getTransferCost()`, `processCrewTransits()`. Hiring at off-world hubs applies import tax and transit delay. Transfers are free when a route connects the bodies, otherwise distance-based cost. Write tests in `src/tests/hubs-crew.test.ts` covering: crew filtering by hub, Earth hiring (no tax/delay), off-world hiring (tax + delay), transfer with/without route, transit processing. See plan for exact test cases and transit delay values.
- **Verification**: `npx vitest run src/tests/hubs-crew.test.ts` passes.

### TASK-023: Off-world VAB import tax tests
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Write unit tests in `src/tests/hubs-vab.test.ts` verifying import tax multipliers: Earth 1.0x, Moon 1.2x, Mars 1.5x, Saturn 3.0x, unknown body gets default 2.0x. Also verify that a part's cost at an off-world hub is base cost times the multiplier (use an actual part from the catalog).
- **Verification**: `npx vitest run src/tests/hubs-vab.test.ts` passes.

### TASK-024: Tourist system
- **Status**: done
- **Dependencies**: TASK-022
- **Description**: Create `src/core/hubTourists.ts` with: `getHubCapacity()`, `getHubCapacityRemaining()`, `addTourist()`, `processTouristRevenue()`, `evictTourists()`. Capacity from Crew Hab tier (4/8/16). Remaining capacity = tier capacity - crew - tourists. Revenue credited per period per tourist. Departed tourists removed. Wire `evictTourists` into hub offline flow in `processHubMaintenance()`. Write tests in `src/tests/hubs-tourists.test.ts`. See plan for exact test cases.
- **Verification**: `npx vitest run src/tests/hubs-tourists.test.ts` passes.

### TASK-025: Facility tier upgrades at outposts
- **Status**: done
- **Dependencies**: TASK-020
- **Description**: Add `startFacilityUpgrade()` to `src/core/hubs.ts`. Queues a construction project with tier-scaled resource costs (tier N+1 costs (N+1)x base) and environment-multiplied resources. Fails if facility not built, already at max tier (3), or upgrade already in progress. Update `processConstructionProjects()` to increment tier on completion of an upgrade (vs creating at tier 1 for new builds). Write tests in `src/tests/hubs-construction.test.ts`. See plan for exact test cases.
- **Verification**: `npx vitest run src/tests/hubs-construction.test.ts` passes.

### TASK-026: Orbital hub undocking launch
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Add `launchType?: 'surface' | 'orbital'` and `launchHubId?: string` to `FlightState` in `src/core/gameState.ts`. In `src/core/physics.ts`, update `createPhysicsState()` to handle orbital launches: spawn at station altitude with orbital velocity, skip PRELAUNCH phase. In `src/ui/vab/_launchFlow.ts`, detect orbital hub and set launch type accordingly (skip weather check and launch pad requirement). Write unit test verifying craft spawns at correct altitude with orbital velocity.
- **Verification**: `npx vitest run src/tests/hubs.test.ts --testNamePattern "orbital"` passes. `npx tsc --noEmit` passes.

### TASK-027: Orbital hub docking (1km proximity)
- **Status**: done
- **Dependencies**: TASK-026
- **Description**: Add `findNearbyOrbitalHub()` to `src/core/hubs.ts`: finds orbital hubs within `HUB_PROXIMITY_DOCK_RADIUS` (1km) on the same body. In `src/ui/flightController.ts`, show a dock prompt when in range of an orbital hub. Accepting ends the flight and recovers craft to that hub. Dismissing hides the prompt until the player leaves the zone. Write unit tests for proximity detection (within range, beyond range, different bodies). See plan for test cases.
- **Verification**: `npx vitest run src/tests/hubs.test.ts --testNamePattern "proximity"` passes.

### TASK-028: Surface hub recovery with hub selection
- **Status**: done
- **Dependencies**: TASK-013
- **Description**: Add `getSurfaceHubsForRecovery()` to `src/core/hubs.ts`: returns online surface hubs on the specified body. In `src/ui/flightController.ts`, on landing: if no hubs, standard recovery; if one hub, auto-recover there; if multiple, show selection dialog. Write unit tests: returns correct hubs, excludes offline, excludes orbital. See plan for test cases.
- **Verification**: `npx vitest run src/tests/hubs.test.ts --testNamePattern "recovery"` passes.

### TASK-029: Hub markers on the in-flight map
- **Status**: done
- **Dependencies**: TASK-008b, TASK-013
- **Description**: In `src/render/map.ts`, add `renderHubMarkers()` that draws hub markers: surface hubs as base icons on bodies, orbital hubs as station icons at altitude. Online hubs fully opaque, offline at 50% alpha. In `src/ui/map.ts`, add click interaction: in-flight shows tooltip only; tracking station allows first-click select, second-click switch prompt. Write E2E test in `e2e/hubs-map.spec.ts` verifying hub markers appear on the tracking station map.
- **Verification**: `npx playwright test e2e/hubs-map.spec.ts` passes.

### TASK-030: E2E save factory updates for hubs
- **Status**: done
- **Dependencies**: TASK-012
- **Description**: Update `buildSaveEnvelope()` in `e2e/helpers/_saveFactory.ts` to accept `hubs` and `activeHubId` options. Default behaviour (no hubs passed): create an Earth hub from the existing `facilities` field for backward compatibility. Add `buildHub()` and `buildOrbitalHub()` E2E factories in `e2e/helpers/_factories.ts`. Update barrel re-export in `e2e/helpers.js`. Verify all existing E2E tests still pass with the updated factory.
- **Verification**: `npx playwright test e2e/smoke.spec.ts e2e/saveload.spec.ts` passes. `npx tsc --noEmit` passes.

### TASK-031: Comprehensive hub E2E tests
- **Status**: done
- **Dependencies**: TASK-030, TASK-016, TASK-017
- **Description**: Write E2E tests across multiple spec files: `e2e/hubs-establishment.spec.ts` (new hub appears in switcher, under-construction status shown), `e2e/hubs-save-migration.spec.ts` (legacy save creates Earth hub, switcher visible), `e2e/hubs-vab-offworld.spec.ts` (parts show import tax at off-world hub). Each test seeds its own state. See implementation plan for exact test scenarios and save setups.
- **Verification**: `npx playwright test e2e/hubs-establishment.spec.ts e2e/hubs-save-migration.spec.ts e2e/hubs-vab-offworld.spec.ts` passes.

### TASK-032: Integrate hub processing into period loop
- **Status**: done
- **Dependencies**: TASK-021, TASK-022, TASK-024, TASK-025
- **Description**: In the period processing function (likely `src/core/finance.ts` or `src/core/period.ts`), add calls to `processHubMaintenance()`, `processConstructionProjects()`, `processCrewTransits()`, and `processTouristRevenue()` after existing crew salary and facility upkeep processing. Import from `hubs.ts`, `hubCrew.ts`, and `hubTourists.ts`. Run full test suite to verify no regressions.
- **Verification**: `npm run test:unit` passes. `npx playwright test e2e/smoke.spec.ts` passes.

### TASK-033: VAB UI — import tax display and local body conditions
- **Status**: done
- **Dependencies**: TASK-013, TASK-015
- **Description**: In `src/ui/vab/_partsPanel.ts`, when rendering part costs, read the active hub's body import tax multiplier and display adjusted cost with "(Nx import)" label for off-world hubs. In `src/ui/vab/_engineerPanel.ts`, use the active hub's body surface gravity for TWR and delta-v calculations instead of hardcoded Earth values. Write E2E test verifying import tax text appears when active hub is off-world.
- **Verification**: `npx playwright test e2e/hubs-vab-offworld.spec.ts` passes.

### TASK-034: Final hub verification pass
- **Status**: done
- **Dependencies**: TASK-031, TASK-032, TASK-033
- **Description**: Run the complete unit test suite, TypeScript type checking, and ESLint. Grep for any TODO/FIXME/HACK comments in new hub files. Verify no regressions in existing tests. This is a verification-only task — fix any issues found.
- **Verification**: `npm run test:unit` passes. `npx tsc --noEmit` passes. `npm run lint` passes.

---

## Phase C: E2E Test Stability & Performance

### TASK-035: Full E2E baseline — catalog failures, flaky tests, and slow tests
- **Status**: pending
- **Dependencies**: TASK-034
- **Description**: Run the complete E2E test suite (`npm run test:e2e`) and record every result: pass, fail, and timing per spec file. Run the suite a second time to identify flaky tests (tests that pass once but fail once, or vice versa). Produce a categorised list: (1) true failures — tests that fail consistently, (2) flaky tests — inconsistent results across runs, (3) slow tests — specs taking >30 seconds. Save the results as comments in the test files or a temporary log. This is a diagnostic task — do not fix anything yet, just catalog.
- **Verification**: Both E2E suite runs complete (even if some tests fail). A clear list of failures, flaky tests, and slow tests is documented.

### TASK-036: Debug and fix E2E failures — pass 1
- **Status**: pending
- **Dependencies**: TASK-035
- **Description**: Using the catalog from TASK-035, investigate and fix the highest-priority E2E failures and flaky tests. Use **Playwright MCP for interactive debugging** — launch the browser, reproduce the failure, inspect DOM state. Common fixes: add missing `waitForSelector`/`waitForFunction` before assertions, replace `waitForTimeout` with event-based waits, fix selector fragility, resolve race conditions between UI render and state mutation. Focus on true failures first, then the most frequently flaky tests.
- **Verification**: `npx playwright test <files-that-were-failing>` passes. At least 80% of cataloged failures are resolved.

### TASK-037: Optimise slow E2E tests — pass 1
- **Status**: pending
- **Dependencies**: TASK-036
- **Description**: Using the catalog from TASK-035, optimise the slowest E2E tests. Common optimisations: replace `page.waitForTimeout(N)` with targeted `waitForSelector`/`waitForFunction`, reduce unnecessary full-page navigations by seeding state closer to the test scenario, combine related assertions that share setup, ensure E2E helper factories create minimal state, tighten overly generous timeout values (reduce 10_000ms to 5_000ms where safe). Target: no individual spec takes >60 seconds.
- **Verification**: Run the previously-slow specs and verify reduced timing. No spec exceeds 60 seconds.

### TASK-038: Full E2E rerun — debug remaining failures (pass 2)
- **Status**: pending
- **Dependencies**: TASK-037
- **Description**: Run the complete E2E suite again (twice). Compare results against the TASK-035 baseline. Investigate any new or recurring failures using Playwright MCP. Focus on tests that were green in pass 1 but fail now — these are the true flaky tests that need timing/race-condition fixes. Also investigate any tests that were fixed in TASK-036 but regressed.
- **Verification**: Full E2E suite passes. Any remaining failures are documented with root-cause notes.

### TASK-039: Optimise remaining slow tests (pass 2)
- **Status**: pending
- **Dependencies**: TASK-038
- **Description**: Review timing from the pass 2 runs. Apply further optimisations to any specs still exceeding 30 seconds: reduce `page.evaluate()` payload size in state injection, eliminate redundant navigations, ensure test independence allows parallel execution. Consider if any tests can be converted from full navigation tests to targeted component tests. Verify no test regressions from optimisations.
- **Verification**: Run optimised specs. No spec exceeds 45 seconds. No regressions.

### TASK-040: Final E2E stability verification
- **Status**: pending
- **Dependencies**: TASK-039
- **Description**: Run the complete E2E suite 3 times consecutively. All 3 runs must pass with zero failures. If any run has a failure, investigate with Playwright MCP and fix. Record the total suite runtime for each run. This task is not complete until 3 consecutive green runs are achieved.
- **Verification**: 3 consecutive full E2E suite runs all pass (`npm run test:e2e` x3). Total suite runtime documented.
