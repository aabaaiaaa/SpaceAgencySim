# Iteration 9 — Tasks

### TASK-001: Add ResourceType, ResourceState, MiningModuleType enums to constants.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Add three new frozen-object enums to `src/core/constants.ts` following the existing pattern (`Object.freeze({} as const)` + companion type): `ResourceType` (10 values: WATER_ICE, REGOLITH, IRON_ORE, RARE_METALS, CO2, HYDROGEN, OXYGEN, HELIUM_3, LIQUID_METHANE, HYDRAZINE), `ResourceState` (SOLID, LIQUID, GAS), `MiningModuleType` (BASE_CONTROL_UNIT, MINING_DRILL, GAS_COLLECTOR, FLUID_EXTRACTOR, REFINERY, STORAGE_SILO, PRESSURE_VESSEL, FLUID_TANK, SURFACE_LAUNCH_PAD, POWER_GENERATOR). Create `src/tests/resources.test.ts` with tests verifying all values exist, all enums are frozen, and value counts are correct. See requirements.md §1 for details.
- **Verification**: `npx vitest run src/tests/resources.test.ts && npx tsc --noEmit src/core/constants.ts`

### TASK-002: Create resource data catalog
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Create `src/data/resources.ts` exporting `ResourceDef` interface, `RESOURCES` (frozen array of 10 entries), and `RESOURCES_BY_ID` (frozen record). Each entry has: `id` (ResourceType), `name`, `description`, `state` (ResourceState), `massDensity` (kg/m³), `baseValuePerKg` ($/kg), `sources` (body IDs — UPPERCASE like `'MOON'`, `'MARS'`, `'CERES'`, `'TITAN'`, `'JUPITER'`, `'SATURN'`), `extractionModule` (MiningModuleType). Append tests to `src/tests/resources.test.ts` verifying: 10 resources, required fields, state-to-extraction-module mappings (solids→MINING_DRILL, gases→GAS_COLLECTOR, liquids→FLUID_EXTRACTOR). See requirements.md §1 resource catalog table for values.
- **Verification**: `npx vitest run src/tests/resources.test.ts`

### TASK-003: Add resource profiles to celestial body definitions
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Extend the `CelestialBodyDef` interface in `src/data/bodies.ts` with optional `resourceProfile?: readonly BodyResourceEntry[]` field. Define a `BodyResourceEntry` interface with `{ resourceType: ResourceType, extractionRateKgPerPeriod: number, abundance: number }`. Add frozen resource profiles to body definitions: MOON (water ice, regolith, iron ore, helium-3), MARS (water ice, regolith, CO₂, oxygen), CERES (iron ore, rare metals, water ice), TITAN (liquid methane), JUPITER (hydrogen), SATURN (hydrogen). Earth and Sun get no profile. Access bodies via `CELESTIAL_BODIES['MOON']` not via array `.find()`. Append tests to `src/tests/resources.test.ts` verifying Moon has water ice and helium-3, Mars has CO₂ and water ice, all profile entries have positive extraction rates, Earth has no profile.
- **Verification**: `npx vitest run src/tests/resources.test.ts && npx tsc --noEmit src/data/bodies.ts`

### TASK-004: Add cargo module parts (Cargo Bay, Pressurized Tank, Cryo Tank)
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Add `CARGO_BAY`, `PRESSURIZED_TANK`, `CRYO_TANK` to the `PartType` enum in `src/core/constants.ts`. Add these three types to `STACK_TYPES` in `src/data/parts.ts`. Add three part definitions to the `PARTS` array: cargo-bay-mk1 (500kg, SOLID), pressurized-tank-mk1 (300kg, GAS), cryo-tank-mk1 (400kg, LIQUID). Each has `properties.cargoCapacityKg` and `properties.cargoState`. Follow existing part definition patterns (makeSnapPoint, RELIABILITY_TIERS.MID, ActivationBehaviour.NONE, etc.). Append tests to `src/tests/resources.test.ts` verifying part types exist and catalog contains parts with correct cargo state/capacity.
- **Verification**: `npx vitest run src/tests/resources.test.ts`

### TASK-005: Add mining module parts (9 modules)
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Add `MINING_MODULE` to `PartType` in `src/core/constants.ts` and to `STACK_TYPES` in `src/data/parts.ts`. Add `MINE` and `LAUNCH_RESOURCES` to `ActivationBehaviour` in `src/data/parts.ts` (insert before the Object.freeze). Add 9 mining module part definitions to the `PARTS` array: base-control-unit-mk1, mining-drill-mk1, gas-collector-mk1, fluid-extractor-mk1, refinery-mk1, storage-silo-mk1, pressure-vessel-mk1, fluid-tank-mk1, surface-launch-pad-mk1, power-generator-solar-mk1. All use `type: PartType.MINING_MODULE` with `properties.miningModuleType` set to the matching `MiningModuleType` value. See requirements.md §1 mining module table for property values. Append tests to `src/tests/resources.test.ts` verifying all 9 modules exist with correct types.
- **Verification**: `npx vitest run src/tests/resources.test.ts`

### TASK-006: Add MiningSite, Route, ProvenLeg types and fields to GameState
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Add `MiningSiteModule`, `MiningSite`, `RouteLocation`, `RouteLeg`, `RouteStatus`, `Route`, and `ProvenLeg` interfaces to `src/core/gameState.ts` as specified in requirements.md §2 and §3. Import `ResourceType` and `MiningModuleType` from constants.ts. Add three new fields to the `GameState` interface: `miningSites: MiningSite[]`, `provenLegs: ProvenLeg[]`, `routes: Route[]`. Initialize all three to `[]` in the `createGameState()` function. Create `src/tests/mining.test.ts` with tests verifying the three new arrays exist and are empty on a fresh game state.
- **Verification**: `npx vitest run src/tests/mining.test.ts && npx tsc --noEmit src/core/gameState.ts`

### TASK-007: Implement mining site creation and proximity lookup
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: Create `src/core/mining.ts` with: `SITE_PROXIMITY_RADIUS` constant (500), `CreateSiteParams` interface, `createMiningSite(state, params)` function that creates a `MiningSite` and pushes it to `state.miningSites`, and `findNearestSite(state, bodyId, coordinates)` that returns the nearest site within proximity radius on the specified body (or null). Append tests to `src/tests/mining.test.ts` covering: site creation with control unit, empty storage/production/orbitalBuffer, zero power fields, proximity lookup finding/missing sites, ignoring sites on other bodies.
- **Verification**: `npx vitest run src/tests/mining.test.ts`

### TASK-008: Implement module placement and pipe connections
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: Add to `src/core/mining.ts`: `AddModuleParams` interface (partId, type, powerDraw, powerOutput?), `addModuleToSite(site, params)` function that creates a `MiningSiteModule`, pushes to `site.modules`, updates `site.powerRequired`/`site.powerGenerated`. Add `toggleConnection(site, moduleAId, moduleBId)` that toggles bidirectional connections (add on first call, remove on second). Append tests to `src/tests/mining.test.ts` covering: adding drill updates powerRequired, adding generator updates powerGenerated, connecting two modules, disconnecting on second toggle.
- **Verification**: `npx vitest run src/tests/mining.test.ts`

### TASK-009: Implement resource extraction with power budget
- **Status**: pending
- **Dependencies**: TASK-008, TASK-002, TASK-003
- **Description**: Add to `src/core/mining.ts`: `getPowerEfficiency(site)` (returns ratio clamped to 0-1, 1.0 when no power required), `getConnectedStorage(site, moduleId, storageState)` (BFS through connections finding storage modules of matching state), `processMiningSites(state)` (per-period extraction — for each extractor module, find matching resources from the body's resource profile, check connected storage capacity, extract at rate × efficiency × multiplier). Must import from `src/data/bodies.ts` (`CELESTIAL_BODIES` or `getBodyDef`), `src/data/resources.ts` (`RESOURCES_BY_ID`), and `src/data/parts.ts` (`getPartById`). Append tests to `src/tests/mining.test.ts` covering: power efficiency calculations, extraction with full power, no extraction with zero power, reduced extraction with partial power.
- **Verification**: `npx vitest run src/tests/mining.test.ts`

### TASK-010: Implement refinery recipe processing
- **Status**: pending
- **Dependencies**: TASK-009
- **Description**: Create `src/core/refinery.ts` with: `RecipeEntry` and `RefineryRecipe` interfaces, `REFINERY_RECIPES` frozen array (4 recipes: water-electrolysis, sabatier-process, regolith-electrolysis, hydrazine-synthesis — see requirements.md §2 for mass ratios), `RECIPES_BY_ID` record, `setRefineryRecipe(site, moduleId, recipeId)`, `getRefineryRecipe(site, moduleId)`, `processRefineries(state)` (per-period — check inputs available scaled by power efficiency, consume inputs, produce outputs). Create `src/tests/refinery.test.ts` with tests covering: recipe catalog contents, water electrolysis conversion, no processing when inputs insufficient, no processing when no recipe set.
- **Verification**: `npx vitest run src/tests/refinery.test.ts`

### TASK-011: Implement surface launch pad orbital buffer transfer
- **Status**: pending
- **Dependencies**: TASK-009
- **Description**: Add `processSurfaceLaunchPads(state)` to `src/core/mining.ts`. For each site, for each SURFACE_LAUNCH_PAD module: get launch capacity from part properties (scaled by power efficiency), transfer resources from `site.storage` to `site.orbitalBuffer` up to the capacity limit. Append tests to `src/tests/mining.test.ts` covering: resources transfer from storage to orbital buffer, launch capacity limit respected, no transfer without power.
- **Verification**: `npx vitest run src/tests/mining.test.ts`

### TASK-012: Implement route leg proving
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: Create `src/core/routes.ts` with: `ProveRouteLegParams` interface (origin, destination, craftDesignId, cargoCapacityKg, costPerRun, flightId), `proveRouteLeg(state, params)` that creates a `ProvenLeg` with unique ID and `dateProven: state.currentPeriod` and pushes to `state.provenLegs`, `locationsMatch(a, b)` helper comparing RouteLocations (bodyId + locationType + altitude), `getProvenLegsForOriginDestination(state, origin, destination)` that filters matching legs. Create `src/tests/routes.test.ts` with tests covering: recording proven legs, unique IDs, date assignment, multiple legs for same route with different craft, filtering by origin/destination.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-013: Implement route assembly and automation
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: Add to `src/core/routes.ts`: `CreateRouteParams` interface, `calculateRouteThroughput(legs)` (min of capacity×craftCount across legs), `createRoute(state, params)` (builds Route from proven leg IDs, starts paused, calculates throughput/cost), `addCraftToLeg(route, legId)` (increments craftCount, recalculates), `setRouteStatus(route, status)`. Add `processRoutes(state)` for per-period automation: skip non-active routes, find source orbital buffer, transport min(throughput, available), deduct cost via `spend(state, cost)` (check boolean return — if spend fails, skip the run), deliver to Earth for revenue via `earn(state, revenue)` or to destination body's orbital buffer. Import `spend`/`earn` from `src/core/finance.ts`, `RESOURCES_BY_ID` from `src/data/resources.ts`. Append tests to `src/tests/routes.test.ts` covering: route creation, throughput calculation, craft addition, route processing with revenue, paused routes not processed, operating cost deduction.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-014: Add Logistics Center facility definition
- **Status**: done
- **Dependencies**: none
- **Description**: Add `LOGISTICS_CENTER: 'logistics-center'` to the `FacilityId` enum in `src/core/constants.ts`. Add a matching entry to the `FACILITY_DEFINITIONS` array with name 'Logistics Center', cost 350_000, scienceCost 15, starter false. Follow the existing pattern for facility definitions. Append test to `src/tests/resources.test.ts` verifying FacilityId.LOGISTICS_CENTER exists and FACILITY_DEFINITIONS includes it.
- **Verification**: `npx vitest run src/tests/resources.test.ts`

### TASK-015: Integrate resource processing into period tick
- **Status**: pending
- **Dependencies**: TASK-009, TASK-010, TASK-011, TASK-013
- **Description**: In `src/core/period.ts`, import `processMiningSites` and `processSurfaceLaunchPads` from `./mining.ts`, `processRefineries` from `./refinery.ts`, `processRoutes` from `./routes.ts`. Add calls in `advancePeriod()` after step 11 (life support) and before step 12 (bankruptcy check): processMiningSites → processRefineries → processSurfaceLaunchPads → processRoutes. Append an integration test to `src/tests/mining.test.ts` verifying that a full extraction→launch chain produces resources in the orbital buffer after calling each function in sequence.
- **Verification**: `npx vitest run src/tests/mining.test.ts && npx tsc --noEmit src/core/period.ts`

### TASK-016: Add save/load support for new state fields
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: In `src/core/saveload.ts`, ensure the serialization path includes `miningSites`, `provenLegs`, and `routes` from `GameState`. In the deserialization/migration path, default missing fields to `[]` for backwards compatibility with old saves (e.g., `state.miningSites = data.miningSites ?? []`). The save/load is async and slot-based — `saveGame(state, slotIndex, name)` returns `Promise<SaveSlotSummary>`, `loadGame(slotIndex)` returns `Promise<GameState>`. Append round-trip tests to `src/tests/mining.test.ts` (or `src/tests/saveload.test.ts` if more appropriate) using `await saveGame(state, 0, 'test')` and `await loadGame(0)`, verifying that miningSites (with modules and storage), provenLegs, and routes survive the round-trip.
- **Verification**: `npx vitest run src/tests/saveload.test.ts`

### TASK-017: Add resource contract chain (12 contracts)
- **Status**: pending
- **Dependencies**: TASK-001, TASK-014
- **Description**: Add 12 resource contract templates to `src/data/contracts.ts`, integrating with the existing `CONTRACT_TEMPLATES` generator pattern. Each contract has a `canGenerate()` function that checks prerequisites (all tutorials complete, previous resource contract completed) and a `generate()` function returning the contract instance. Contracts follow the sequential chain in requirements.md §5 — contract 8 unlocks the Logistics Center facility. Export a `RESOURCE_CONTRACTS` array for direct access/testing. Append tests to `src/tests/resources.test.ts` verifying: 12 contracts exist, first contract requires tutorials, contracts are sequential (each requires previous), contract 8 unlocks 'logistics-center'.
- **Verification**: `npx vitest run src/tests/resources.test.ts`

### TASK-018: Add Logistics tech tree branch
- **Status**: pending
- **Dependencies**: TASK-005
- **Description**: Add `LOGISTICS: 'LOGISTICS'` to the `TechBranch` enum and `'Logistics'` to `BRANCH_NAMES` in `src/data/techtree.ts`. Add 5 new `TechNodeDef` entries to the `TECH_NODES` array, each with `branch: TechBranch.LOGISTICS` and tiers 1-5: (1) Surface Mining — unlocks drill, BCU, silo, power generator; (2) Gas & Fluid Extraction — unlocks gas collector, fluid extractor, pressure vessel, fluid tank; (3) Refining & Processing — unlocks refinery, cargo bay, pressurized tank, cryo tank; (4) Surface Launch Systems — unlocks surface launch pad; (5) Automated Logistics — empty unlocksParts. Append tests to `src/tests/resources.test.ts` verifying: Logistics branch exists in TECH_NODES, 5 nodes with correct tiers, tier 1 unlocks basic mining parts.
- **Verification**: `npx vitest run src/tests/resources.test.ts`

### TASK-019: Build Logistics Center UI — mining sites panel
- **Status**: pending
- **Dependencies**: TASK-009, TASK-010, TASK-014
- **Description**: Create `src/ui/logistics.ts` and `src/ui/logistics.css`. The module exports `openLogisticsPanel(state, parentEl)` and `closeLogisticsPanel()`. The panel has two tabs: "Mining Sites" (default) and "Route Management" (placeholder for TASK-020). The mining sites panel has a left sidebar listing celestial bodies with sites, and a right area showing site diagrams with module boxes, power budget, storage fill levels, refinery recipe selectors, and orbital buffer status. Follow existing UI patterns (DOM-based panels, CSS classes using design tokens where applicable, monospace font). See requirements.md §4 Panel 1 for full specification.
- **Verification**: `npx tsc --noEmit src/ui/logistics.ts && npx vitest run`

### TASK-020: Build Logistics Center UI — route management panel
- **Status**: pending
- **Dependencies**: TASK-019, TASK-013
- **Description**: Replace the route management placeholder in `src/ui/logistics.ts`. The routes panel shows: (top) a map placeholder div for future route visualization, (bottom) a table of all routes with name, resource type, legs summary, throughput, cost/period, revenue/period, and status toggle button. Below the table, show proven legs as cards with origin→destination, craft design, capacity, and cost. Add route status toggle (active↔paused) click handlers using `setRouteStatus()`. Add route panel CSS to `src/ui/logistics.css`.
- **Verification**: `npx tsc --noEmit src/ui/logistics.ts && npx vitest run`

### TASK-021: Add Logistics Center to hub screen
- **Status**: pending
- **Dependencies**: TASK-019
- **Description**: In `src/ui/hub.ts`, import `openLogisticsPanel` and `closeLogisticsPanel` from `./logistics.ts`. Add a Logistics Center building entry to the hub layout following the existing building pattern (position it in a free spot). Add a click handler case for `FacilityId.LOGISTICS_CENTER` that calls `openLogisticsPanel(state, overlayContainer)`. Import `FacilityId` from constants if not already imported.
- **Verification**: `npx tsc --noEmit src/ui/hub.ts && npx vitest run`

### TASK-022: Add in-flight map route overlay (placeholder)
- **Status**: pending
- **Dependencies**: TASK-013
- **Description**: In `src/render/map.ts`, add a `routeOverlayVisible` flag, a `toggleRouteOverlay()` export, and a `renderRouteOverlay(state)` function that iterates active routes and draws placeholder directional lines between origin/destination bodies (using PixiJS Graphics, following the existing map rendering patterns). Add a toggle button or keybind for the overlay. The rendering can be basic (solid lines with colour coding for active vs paused) — visual polish is deferred. This is read-only; editing happens in the Logistics Center.
- **Verification**: `npx tsc --noEmit src/render/map.ts && npx vitest run`

### TASK-023: Implement route safety warnings
- **Status**: pending
- **Dependencies**: TASK-013
- **Description**: Add to `src/core/routes.ts`: `getRouteDependencies(state, bodyId, orbitAltitude)` returns active routes with legs referencing that body and orbit altitude, `SafeOrbitRange` interface with `minAltitude`/`maxAltitude`, `getSafeOrbitRange(state, bodyId, currentAltitude)` returns the altitude range that keeps all dependent routes valid (or null if no dependencies). Append tests to `src/tests/routes.test.ts` covering: dependencies found for craft at route orbit, empty when no routes at location, safe range calculation.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-024: Extend body tests for new celestial bodies
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/tests/bodies.test.ts`, extend the specific property-value tests (surface gravity, atmosphere profiles, landable/non-landable, destruction zones) to cover the 4 new bodies (CERES, JUPITER, SATURN, TITAN). Add: CERES gravity 0.28, JUPITER gravity 24.79, SATURN gravity 10.44, TITAN gravity 1.352 to the gravity test map. Add TITAN to the atmosphere tests (dense N₂/CH₄, sea level density 5.3 kg/m³). Verify JUPITER and SATURN are non-landable with 'extreme_pressure' destruction zones. Verify CERES is landable with no atmosphere. Verify TITAN weather is 'methane_rain'. Verify Saturn has TITAN as child. Verify manoeuvre constants (SOI_RADIUS, BODY_PARENT, BODY_CHILDREN, BODY_ORBIT_RADIUS) include all 12 bodies.
- **Verification**: `npx vitest run src/tests/bodies.test.ts`

### TASK-025: E2E test for mining deployment flow
- **Status**: pending
- **Dependencies**: TASK-021
- **Description**: Create `e2e/mining.spec.ts` with a Playwright test that verifies the basic mining system is accessible: start a new game, verify the Logistics Center is visible in the hub (may need to be unlocked via game state injection with `page.evaluate()`), open the Logistics Center, verify the mining sites panel shows the empty state message, verify the route management tab is accessible. Use `page.evaluate()` to inject a mining site into gameState and verify it renders in the panel. Follow existing E2E patterns in `e2e/` — use helpers from `e2e/helpers.js`, dispatch keyboard events via `window.dispatchEvent` not `page.keyboard.press`.
- **Verification**: `npx playwright test e2e/mining.spec.ts`

### TASK-026: Final verification pass
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025
- **Description**: Run the full verification suite to confirm no regressions. Check: `npm run typecheck` (0 errors), `npm run lint` (0 warnings, 0 errors), `npm run test:unit` (all tests pass, coverage thresholds met), `npm run build` (production build succeeds). If any failures, fix them. Verify the new test files have at least 1-2 `@smoke`-tagged tests each and update `test-map.json` to map new source files to their test files.
- **Verification**: `npm run typecheck && npm run lint && npm run test:unit && npm run build`
