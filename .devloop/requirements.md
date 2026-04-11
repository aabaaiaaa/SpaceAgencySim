# Iteration 11 — Hardening, In-Flight Map, Off-World Hubs & E2E Stability

This iteration has three phases: (A) close all remaining gaps and tech debt from the iteration 10 review, (B) implement the Off-World Hubs feature, and (C) stabilise and optimise the full E2E test suite.

---

## Phase A: Hardening & Tech Debt

These items address every recommendation from the iteration 10 review plus two carried-forward tech debt items.

### 1. Split `src/ui/logistics.ts` into Sub-Modules

**Problem:** At 1108 lines, `logistics.ts` is the largest monolithic UI module. The project convention (established with `flightController/`, `vab/`, `missionControl/`) is to split large UI modules into sub-directories with barrel re-exports.

**Approach:** Create `src/ui/logistics/` with:
- `miningSites.ts` — mining tab rendering (site list, module connections, recipe dropdowns)
- `routeMap.ts` — SVG schematic map component (`_renderRouteMap`, `_getBodyColor`, body positioning, proven leg / active route line drawing)
- `routeBuilder.ts` — builder mode interaction (route creation workflow, click-to-chain, confirm/cancel)
- `routeTable.ts` — route table and craft controls (route list, status toggle, leg expansion, +/- craft buttons, revenue column)
- `index.ts` — barrel re-export of all public functions; external imports remain unchanged

Each sub-module receives the relevant private functions and local state from the monolith. Shared helpers (e.g. `_getBodyColor`) move to `routeMap.ts` and are re-exported for use by `routeBuilder.ts`.

**Validation:** All existing unit and E2E tests pass unchanged. No new tests needed — the refactor is purely structural.

### 2. E2E Test: Craft +/- Button Functionality

**Problem:** The route table's inline +/- craft count buttons render correctly, but no E2E test verifies that clicking them changes the craft count, triggers a build cost deduction, or recalculates throughput.

**Test:** In `e2e/route-interactions.spec.ts`, add a test that:
1. Seeds a save with an active route containing at least one leg.
2. Locates the + button for that leg.
3. Records the current craft count and player money.
4. Clicks the + button.
5. Verifies the craft count incremented, money decreased, and throughput display updated.
6. Clicks the - button, verifies the craft count decrements (minimum 1).

### 3. E2E Test: Route Builder Confirm Flow

**Problem:** The route builder's most complex interaction — creating a route via the SVG map — has no end-to-end test coverage.

**Test:** In a new or existing route E2E spec, add a test that:
1. Seeds a save with at least one proven leg between two bodies.
2. Opens the Logistics Center, navigates to the Routes tab.
3. Clicks "Create Route" to enter builder mode.
4. Selects a resource type from the dropdown.
5. Clicks the origin body on the SVG map.
6. Clicks a highlighted proven leg.
7. Clicks "Confirm".
8. Verifies a new route appears in the route table with the selected resource type.

### 4. Unit Test: Orbital Buffer Overflow

**Problem:** `processSurfaceLaunchPads()` transfers resources to `site.orbitalBuffer` without checking for any capacity limit. It's unclear whether orbital buffers are intentionally unlimited or if this is an oversight.

**Approach:** Write a unit test in `mining.test.ts` that:
1. Creates a site with a launch pad and storage modules filled with a large amount of resources.
2. Runs `processSurfaceLaunchPads()` multiple times.
3. Verifies that `site.orbitalBuffer` grows without bound (documenting the current behaviour).
4. Add a code comment in `mining.ts` at the launch pad processing confirming orbital buffers are intentionally unbounded. This documents the design decision for future iterations.

### 5. Extract SVG Body Colors to CSS Custom Properties

**Problem:** `_getBodyColor()` in logistics.ts (line 416) hardcodes colour values for celestial bodies. These should use CSS custom properties for consistency with the design token system.

**Approach:**
1. Define CSS custom properties for body colours in the existing stylesheet (e.g. `--body-color-earth: #4488CC;`).
2. Replace the hardcoded `Record<string, string>` in `_getBodyColor()` (which will live in `routeMap.ts` after the split) with reads from `getComputedStyle()` or a shared constant that mirrors the CSS values.
3. The SVG map and any future body-colour references use the same source of truth.

### 6. Route Revenue Integration Test

**Problem:** No test verifies that the `PeriodSummary.routeRevenue` field is correctly populated after running `advancePeriod()` with an active Earth-bound route.

**Test:** In `routes.test.ts` or an integration test file:
1. Set up a complete pipeline: mining site with orbital buffer stocked with a resource, an active route from that body to Earth.
2. Run `advancePeriod()`.
3. Verify `PeriodSummary.routeRevenue` equals the expected `throughputPerPeriod * RESOURCES_BY_ID[resourceType].baseValuePerKg`.

### 7. Non-Null Assertion Cleanup in routes.ts

**Problem:** In `routes.ts:366-367`, `destSite!.orbitalBuffer` uses a non-null assertion. While logically safe (the `if (!destSite)` guard at line 343 would have continued), it relies on the reader tracing the control flow.

**Fix:** Introduce a local variable after the guard:
```typescript
const dest = destSite; // guaranteed non-null after guard
dest.orbitalBuffer[route.resourceType] = ...
```

This is a one-line clarity improvement with no behavioural change.

### 8. Full PixiJS In-Flight Map Route Rendering

**Problem:** The in-flight map overlay (`src/render/map.ts`, `_drawRouteOverlay()` at line 1457) draws transport routes as simple straight lines between body centres. This is a placeholder — routes should show curved orbital transfer paths, use proper PixiJS rendering with dashed lines for proven legs vs solid for active routes, and include directional flow indicators.

**Current state:** `_drawRouteOverlay()` is ~70 lines using `PIXI.Graphics` with `moveTo`/`lineTo` for straight lines with small arrowheads. Colour-coded by status (green/grey/red).

**Approach:**

**8a. Route rendering foundation:**
- Replace straight lines with quadratic Bezier curves (`quadraticCurveTo`) between body positions, offset from the direct line to give a sense of orbital transfer arcs.
- Compute curve control points using the midpoint between bodies, offset perpendicular to the line by a fraction of the distance (e.g. 15-20% of inter-body distance).
- For multi-leg routes, draw each leg as a separate arc so the route path is visible segment-by-segment.
- Keep the existing colour coding: active (green), paused (grey), broken (red).
- Use line dash patterns: dashed for proven legs (overlay when route overlay is visible), solid for active routes.
- Add animated flow dots that travel along the curve at a steady rate to indicate cargo direction. Use a small pool of `PIXI.Graphics` circles repositioned each frame along the Bezier path using `t` parameter interpolation.

**8b. Hub markers on the in-flight map:**
- Draw hub markers as small labelled icons at the appropriate orbital altitude or surface position for each hub.
- Surface hubs: rendered as a small base icon at the body's surface (visible when zoomed into the body).
- Orbital hubs: rendered as a small station icon at the orbital altitude ring.
- Online hubs are fully opaque; offline/under-construction hubs are semi-transparent.
- Use existing PixiJS sprite patterns from the map renderer.

**8c. Route tooltips and interactivity:**
- When the mouse hovers over a route arc, show a tooltip with: route name, resource type, throughput, status, and revenue (for Earth-bound routes).
- When hovering over a hub marker, show: hub name, body, online status, facility list.
- Use PixiJS `hitArea` on route graphics for hover detection, or a proximity-based approach checking mouse distance to the nearest point on the Bezier curve.
- Clicking a hub marker in the tracking station mode opens the hub info panel (same as the hub map interaction from the hubs feature).

**Validation:** Visual inspection via the dev server. E2E test to verify the route overlay toggle works and at least one route line is drawn when routes exist.

---

## Phase B: Off-World Hubs

This is the primary feature addition. The goal is to generalise Earth's hub into a reusable Hub concept so players can establish and operate off-world bases and orbital stations across the solar system.

**Architecture:** Hub-First approach. Earth becomes the first entry in `gameState.hubs[]`. All screens become hub-aware via `activeHubId`. New `src/core/hubs.ts` module owns Hub CRUD, construction projects, maintenance, and offline logic. Existing modules (construction, crew, finance, VAB, flight) are updated to scope their operations to the active hub.

**Full spec:** `C:\Users\jeastaugh\source\repos\Experiments\SpaceAgencySimDocs\docs\superpowers\plans\2026-04-11-off-world-hubs.md`

### Milestone 1: Hub Data Model & State Migration

**Hub type definitions** (`src/core/hubTypes.ts`): Hub, ConstructionProject, ResourceRequirement, Tourist interfaces. Hubs have an `id`, `name`, `type` (surface/orbital), `bodyId`, optional `altitude`/`coordinates`/`biomeId`, `facilities` record, `tourists`, `partInventory`, `constructionQueue`, `maintenanceCost`, `established` period, and `online` flag.

**Constants & facility data** (`src/data/hubFacilities.ts`, `src/core/constants.ts`): Add `OUTPOST_CORE` to PartType, `CREW_HAB` to FacilityId. Define environment categories (AIRLESS_LOW_GRAVITY, ATMOSPHERIC_SURFACE, HOSTILE_ATMOSPHERIC, ORBITAL, HARSH) with cost multipliers. Map bodies to environments. Import tax multipliers per body (Earth 1.0x, Moon 1.2x, Mars 1.5x, up to Saturn 3.0x). Crew Hab capacity per tier (4/8/16). Surface vs orbital facility lists. Off-world facility resource costs and per-period maintenance.

**Test factories** (`src/tests/_factories.ts`): `makeHub()`, `makeEarthHub()`, `makeOrbitalHub()`, `makeConstructionProject()` factory functions.

**GameState changes** (`src/core/gameState.ts`): Add `hubs: Hub[]` and `activeHubId: string` to GameState. Add `stationedHubId: string` and `transitUntil: number | null` to CrewMember. `createGameState()` initialises an Earth hub mirroring the existing facilities. Unit tests verify the Earth hub is created correctly.

**Core hub module** (`src/core/hubs.ts`): `getActiveHub()`, `getHub()`, `setActiveHub()`, `getHubsOnBody()`, `createHub()`, `getEnvironmentCategory()`, `getEnvironmentCostMultiplier()`, `getImportTaxMultiplier()`. Creating a hub queues a Crew Hab construction project with environment-scaled resource requirements.

**Save/load migration** (`src/core/saveload.ts`): `migrateToHubs()` creates an Earth hub from legacy saves' top-level `facilities` and `partInventory`. Sets `stationedHubId` on crew. Bump `SAVE_VERSION`. Idempotent — skips if `hubs` already exists.

**Hub-aware construction** (`src/core/construction.ts`): `hasFacility()`, `getFacilityTier()`, `buildFacility()`, `upgradeFacility()` now look up the active hub's (or a specified hub's) facilities rather than `state.facilities` directly.

### Milestone 2: Hub Switcher UI & Rendering

**Hub switcher** (`src/ui/hubSwitcher.ts`): A `<select>` dropdown positioned top-centre of the hub screen. Lists all hubs with name, body, and status ([Building]/[Offline]). Changing selection calls `setActiveHub()` and re-renders the hub screen.

**Hub-aware rendering** (`src/render/hub.ts`, `src/ui/hub.ts`): Hub renderer reads the active hub's body to set sky/ground colours. Orbital hubs get a starfield background. Hub UI shows only the active hub's available and built facilities. Under-construction facilities are shown at 50% opacity.

### Milestone 3: Outpost Establishment

**Outpost Core part** (`src/data/parts.ts`): 2000 kg, $500k, activatable (DEPLOY behaviour), top and bottom snap points. Added to the parts catalog.

**Deployment logic** (`src/core/hubs.ts`): `deployOutpostCore(state, flight, name)` creates a surface or orbital hub depending on the flight state (landed vs in-orbit). Deducts monetary cost. The new hub starts offline with a Crew Hab construction project queued.

**Construction resource delivery and completion** (`src/core/hubs.ts`): `deliverResources()` records partial resource deliveries (capped at required amount). `isConstructionComplete()` checks all resources delivered. `processConstructionProjects()` marks completed projects, adds facilities, and brings the hub online when the Crew Hab completes.

### Milestone 4: Hub Economy & Crew

**Maintenance & offline** (`src/core/hubs.ts`): `calculateHubMaintenance()` sums per-facility upkeep scaled by tier (Earth hub returns 0 — uses existing system). `processHubMaintenance()` deducts costs; if money insufficient, hub goes offline, crew evacuated to Earth, tourists evicted. `reactivateHub()` brings an offline hub back online for one period's maintenance cost.

**Hub-scoped crew** (`src/core/hubCrew.ts`): `getCrewAtHub()` filters by `stationedHubId`. `hireCrewAtHub()` applies import tax to hire cost and sets a transit delay based on distance. `requestCrewTransfer()` moves crew between hubs with cost (free if a route connects the bodies) and transit delay. `processCrewTransits()` clears `transitUntil` when the period is reached.

**Import tax** on parts: At off-world hubs, all part costs are multiplied by the body's import tax multiplier. Unit tests verify the multipliers.

**Tourist system** (`src/core/hubTourists.ts`): `getHubCapacityRemaining()` accounts for crew + tourists against Crew Hab tier capacity. `addTourist()` checks capacity. `processTouristRevenue()` credits per-period revenue and removes departed tourists. `evictTourists()` clears tourists when a hub goes offline.

**Facility tier upgrades** (`src/core/hubs.ts`): `startFacilityUpgrade()` queues a construction project with tier-scaled resource and money costs. `processConstructionProjects()` increments the facility tier on completion.

### Milestone 5: Flight Integration

**Orbital hub undocking launch** (`src/core/physics.ts`, `src/ui/vab/_launchFlow.ts`, `src/core/gameState.ts`): Add `launchType` and `launchHubId` to FlightState. When launching from an orbital hub, craft spawns at the station's altitude with orbital velocity. Skip weather check and launch pad requirement.

**Orbital hub docking** (`src/core/hubs.ts`, `src/ui/flightController.ts`): `findNearbyOrbitalHub()` detects orbital hubs within 1km on the same body. Flight controller shows a dock prompt when in range; accepting ends the flight and recovers the craft to that hub.

**Surface hub recovery** (`src/core/hubs.ts`, `src/ui/flightController.ts`): `getSurfaceHubsForRecovery()` returns online surface hubs on the landing body. If one hub exists, recover there automatically. If multiple, show a selection dialog.

### Milestone 6: Map Integration

**Hub markers on the map** (`src/render/map.ts`, `src/ui/map.ts`): Surface hubs rendered as base icons on bodies, orbital hubs as station icons at altitude. Online hubs fully opaque, offline semi-transparent. In-flight: hover shows tooltip. Tracking station: click selects, second click prompts hub switch.

### Milestone 7: E2E Test Coverage

**E2E save factory updates** (`e2e/helpers/_saveFactory.ts`, `e2e/helpers/_factories.ts`): `buildSaveEnvelope()` supports `hubs` and `activeHubId` fields. Default behaviour creates an Earth hub from facilities for backward compatibility. `buildHub()` and `buildOrbitalHub()` E2E factories added.

**Comprehensive E2E tests**: Hub switcher visibility and hub listing, under-construction hub appearance, legacy save migration creating Earth hub, hub switching changing rendering, off-world VAB import tax display.

### Milestone 8: Final Integration & Polish

**Period loop integration** (`src/core/finance.ts` or period processing): Wire `processHubMaintenance()`, `processConstructionProjects()`, `processCrewTransits()`, and `processTouristRevenue()` into the per-period processing after existing crew salary and facility upkeep.

**VAB UI** (`src/ui/vab/_partsPanel.ts`, `src/ui/vab/_engineerPanel.ts`): Parts panel shows import-tax-adjusted costs with "(Nx import)" label at off-world hubs. Engineer panel uses the active hub's body for delta-v/TWR calculations instead of hardcoded Earth gravity.

---

## Phase C: E2E Test Stability & Performance

After all feature work is complete, the final phase focuses on making the full E2E test suite reliable and fast.

### Approach

**Pass 1 — Baseline & triage:**
Run the complete E2E suite (43+ spec files). Record every failure, flaky test (passes sometimes, fails sometimes), and slow test (>30 seconds). Categorise issues:
- True failures (broken functionality)
- Flaky tests (timing-dependent, race conditions, selector instability)
- Slow tests (unnecessary waits, heavy setup, redundant navigation)

**Pass 1 — Fix & optimise:**
For each failure/flaky test, use **Playwright MCP for interactive debugging** — launch the browser, reproduce the failure, inspect DOM state, step through the test. Do not rerun blindly. Common flakiness patterns to look for:
- Missing `waitForSelector` or `waitForLoadState` before assertions
- Hardcoded `waitForTimeout` instead of event-based waits
- Race conditions between UI render and state mutation
- Tests that depend on animation timing or requestAnimationFrame
- Selector fragility (classes that change, elements that re-render)

For slow tests:
- Replace `page.waitForTimeout(N)` with targeted `waitForSelector`/`waitForFunction`
- Reduce unnecessary full-page navigations (seed state closer to the test scenario)
- Combine related assertions that share the same setup
- Ensure E2E helper factories create minimal state (no unnecessary data)

**Pass 2 — Re-run & catch remaining issues:**
Run the full suite again. Any new or recurring failures get the same Playwright MCP treatment. Focus on tests that were green in pass 1 but fail in pass 2 — these are the true flaky tests.

**Pass 2 — Further optimisation:**
Look at the slowest remaining specs. Consider:
- Parallelisation: ensure tests have no serial dependencies (per project convention)
- Reducing `page.evaluate()` payload size in state injection
- Tightening timeouts (reduce default 10_000ms to 5_000ms where safe)

**Final verification:**
Run the full suite 2-3 times consecutively. All runs must be green. Any failure in any run triggers investigation.

**Success criteria:** Full E2E suite passes consistently (3 consecutive green runs). No individual spec takes more than 60 seconds. Total suite runtime is reduced from current baseline.

---

## Technical Decisions

- **Hardening before features:** The logistics refactor and test gaps are addressed first. This ensures the codebase is clean before the hubs feature adds significant new code.
- **Hub-First architecture:** Earth becomes `hubs[0]`. No dual-path code — every screen reads from the active hub. This avoids maintaining separate Earth-specific logic.
- **Bezier curves for route arcs:** Quadratic curves with offset control points give a visual sense of orbital transfer without computing actual Keplerian paths (which wouldn't be readable at map scale).
- **Per-module storage (iteration 10) enables per-hub storage:** Hubs with mining sites use the same storage system. No changes needed to the resource pipeline.
- **CSS custom properties for body colours:** Single source of truth shared between the SVG logistics map and future PixiJS-rendered hub markers.
- **Playwright MCP for E2E debugging:** Interactive browser debugging is faster and more reliable than blind test reruns for diagnosing flakiness.

## What This Iteration Does NOT Include

- **No new resource types or recipes** — the resource system is unchanged.
- **No life support or oxygen/water consumption** — future feature that builds on hubs + resources.
- **No crew transport as a route type** — routes still carry resources only. Crew transfer is abstracted (cost + transit delay).
- **No bundle code-splitting** — deferred as before.
- **No Mk2 storage modules** — the architecture supports them but they're a future addition.
