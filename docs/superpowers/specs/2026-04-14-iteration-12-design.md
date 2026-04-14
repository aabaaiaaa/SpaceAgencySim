# Iteration 12 — Earth Hub Migration, Route Refactor, Map Scalability & Polish

**Date:** 2026-04-14
**Scope:** Review fixes, Earth hub full migration, hub UX polish, Mk2 storage, SVG map dynamic layout with hub nodes, hub-to-hub routing, code-splitting, save migration removal, comprehensive test gaps.

---

## Overview

This iteration has four themes:

1. **Clean up** — fix all review findings from iteration 11 and remove save migration code.
2. **Hub maturity** — fully migrate Earth to the hub system (removing the legacy `state.facilities` dual-reference), add hub management UX, and add Mk2 storage modules.
3. **Route evolution** — routes connect to specific hubs (not just bodies), and the logistics SVG map gains dynamic layout with hub nodes.
4. **Infrastructure** — code-splitting for faster load times, plus comprehensive test coverage for all gaps.

---

## Phase A: Review Fixes & Cleanup

Small targeted fixes from the iteration 11 review.

### 1. TypeScript Errors in mapView.test.ts

**Problem:** Three TypeScript compilation errors at lines 233, 239, and 577 where Hub mock objects are missing required fields. The double-cast `as Partial<GameState> as GameState` bypasses runtime but fails `tsc --noEmit`.

**Fix:** Replace incomplete Hub mock objects with `makeEarthHub()` factory calls from `src/tests/_factories.ts`. The factory produces complete Hub objects with all required fields.

**Validation:** `npx tsc --noEmit` passes clean.

### 2. Hub Money Cost Environment Scaling

**Problem:** In `hubs.ts`, `createHub()` (line 106) and `startFacilityUpgrade()` (line 370) apply `envMultiplier` to resource costs but not to money costs. This is a bug — environment difficulty should scale all costs.

**Fix:** Multiply `moneyCost` by `envMultiplier` in both functions:
- `createHub()`: `moneyCost: crewHabCost.moneyCost * envMultiplier`
- `startFacilityUpgrade()`: `moneyCost: costDef.moneyCost * nextTier * envMultiplier`

**Validation:** Unit tests verify that creating a hub on Mars costs 1.3x the base money cost, and upgrading a facility on the Moon costs 1.0x.

### 3. Magic String in hubTourists.ts

**Problem:** `hub.facilities['crew-hab']` at line 24 uses a hardcoded string instead of the `FacilityId.CREW_HAB` constant.

**Fix:** Import `FacilityId` from `constants.ts` and replace with `hub.facilities[FacilityId.CREW_HAB]`.

### 4. Tourist Departure Semantics Comment

**Problem:** At `hubTourists.ts:70`, the filter `t.departurePeriod > state.currentPeriod` is correct but the semantics of `departurePeriod` are ambiguous.

**Fix:** Add comment: `// departurePeriod is the last period the tourist is present. Revenue is credited during this period, then the tourist departs at the start of the next period.`

### 5. CSS/JS Body Color Deduplication

**Problem:** Body colors are defined in both `src/ui/logistics.css` (CSS custom properties `--body-color-*`) and `src/ui/logistics/_routeMap.ts` (JS `BODY_COLORS` constant). Manual sync required.

**Fix:** Remove the `BODY_COLORS` JS constant. Replace with a helper function that reads body colors from CSS custom properties via `getComputedStyle(document.documentElement).getPropertyValue('--body-color-earth')`. The CSS file becomes the single source of truth.

**Consideration:** The SVG map renders before DOM attachment in some flows. The helper must handle the case where computed styles aren't available yet (fall back to a default color).

---

## Phase B: Save Migration Removal

### 6. Remove All Migration Functions

**Rationale:** The game is in active development and the save format changes frequently. Migration code is wasted effort. Saves will be marked incompatible; migration can be added when the format stabilizes.

**Changes:**
- Delete `migrateToHubs()` and all other `migrateTo*()` functions in `saveload.ts`.
- Remove the migration chain that runs on load.
- Bump `SAVE_VERSION` to the next integer.

### 7. Incompatible Save Handling

On load, if the save's version doesn't match `SAVE_VERSION`:
- Show a user-facing message: "This save was created with an older version and is not compatible."
- Do not attempt to load or partially parse the old data.
- Save slot UI shows the slot as "(Incompatible)" — the save's original name is visible but grayed out, and the Load button is disabled for that slot.

### 8. Update All Test Factories

All test factory functions must produce the new save format (no legacy `state.facilities`, routes with `hubId`, etc.):
- **Unit:** `src/tests/_factories.ts` — all `makeX()` functions updated.
- **E2E:** `e2e/helpers/_saveFactory.ts` and `e2e/helpers/_factories.ts` — `buildSaveEnvelope()` and all builder functions updated.
- Remove any migration compatibility shims or legacy format helpers.

---

## Phase C: Earth Hub Full Migration

### 9. Remove `state.facilities` from GameState

**Current state:** `state.facilities` is a shared object reference with `state.hubs[0].facilities` (Earth hub). Legacy code reads `state.facilities` directly.

**Changes:**
- Remove the `facilities` field from the `GameState` interface in `gameState.ts`.
- Remove `facilities` assignment from `createGameState()`. Earth hub initialization in `state.hubs[0]` is the sole facility source.
- If `partInventory` exists at top-level GameState as a legacy field, remove it too (Earth hub has `hub.partInventory`).

### 10. Update All `state.facilities` References

Find every direct reference to `state.facilities` across the codebase and update to the hub-aware equivalent:

- **Construction/facility checks** (e.g. `state.facilities[FacilityId.LAUNCH_PAD]`): Use `getActiveHub(state).facilities[...]` or `getHub(state, EARTH_HUB_ID).facilities[...]` depending on whether the code should be hub-aware or Earth-specific.
- **UI modules** that read facility state for rendering: Use `getActiveHub(state).facilities`.
- **Core modules** that check facility tiers for gating: Use the existing `hasFacility()` / `getFacilityTier()` helpers from `construction.ts` which already use `resolveHubFacilities()`.

The `resolveHubFacilities()` pattern in `construction.ts` already defaults to the active hub. Most callsites can simply drop the explicit `state.facilities` reference in favor of the existing helper functions.

### 11. Remove Legacy Earth Hub Special Cases

After migration, audit for remaining Earth-specific code paths that exist only because of the dual-reference pattern:
- The shared object reference setup in `createGameState()` — removed.
- Any `if (hubId === EARTH_HUB_ID) { use state.facilities }` branches — simplified to just use hub facilities.
- `resolveHubFacilities()` itself can be simplified if it no longer needs to handle the legacy path.

Earth-specific *gameplay* rules stay (zero maintenance, Earth-only facilities, no import tax). Only the *code path duality* is removed.

---

## Phase D: Hub UX Polish

### 12. Hub Name Uniqueness Validation

- `createHub()` checks proposed name against all existing `state.hubs[].name`. Returns an error (or throws) if duplicate.
- `renameHub()` (new function) also validates uniqueness.
- Case-insensitive comparison to prevent "Apollo" and "apollo" coexisting.

### 13. Auto-Suggested Hub Names

**Name pool:** Create `src/data/hubNames.ts` with a curated catalog of ~80-100 names drawn from:
- **Missions:** Apollo, Gemini, Vostok, Artemis, Pioneer, Voyager, Mercury, Viking, Cassini, Rosetta, Juno, Horizon, Discovery, Endeavour, Challenger, Columbia
- **Rockets:** Saturn, Falcon, Soyuz, Atlas, Titan, Delta, Ariane, Vega, Proton, Energia, Electron
- **Figures:** Gagarin, Glenn, Ride, Tereshkova, Armstrong, Aldrin, Shepard, Leonov, Yang, Chawla, Jemison, Hubble, Kepler, Tsiolkovsky, Goddard, Von Braun, Korolev, Oberth
- **Stations:** Mir, Skylab, Tiangong, Salyut, Freedom

**Name generation:**
- `generateHubName(state, hubType)`: picks a random unused name from the pool, appends " Outpost" for surface hubs or " Station" for orbital hubs.
- Names already in use by existing hubs are excluded.
- If the pool is exhausted (unlikely with 100 names), fall back to "Hub-{number}".

**Usage:** When `deployOutpostCore()` creates a hub, it calls `generateHubName()` for the default name. The player can override via the deployment dialog or rename later.

### 14. Hub Rename

New function `renameHub(state: GameState, hubId: string, newName: string)` in `hubs.ts`:
- Validates uniqueness (case-insensitive).
- Updates `hub.name`.
- Earth hub can also be renamed.

UI: The hub management panel (Section 16) has an editable name field.

### 15. Hub Abandonment

New function `abandonHub(state: GameState, hubId: string)` in `hubs.ts`:
- **Preconditions:** Hub must be offline. Cannot abandon Earth hub.
- **Effects:**
  - All crew stationed at the hub are transferred to Earth (with transit delay based on distance).
  - All tourists are evicted (no revenue for remaining stay).
  - Any routes with legs referencing this hub are marked `broken` (status = 'broken').
  - Hub is removed from `state.hubs[]`.
  - If the abandoned hub was the active hub, switch to Earth.

UI: "Abandon Hub" button on the management panel, visible only for offline non-Earth hubs. Confirmation dialog warns about crew evacuation and route breakage.

### 16. Hub Management Panel

New UI component `src/ui/hubManagement.ts` (or as part of the hub UI module):

**Trigger:** Accessible from the hub switcher — an info/gear icon next to the hub dropdown, or clicking the hub name directly.

**Content:**
- **Name** — editable text field with save/cancel. Shows auto-suggested name on new hubs.
- **Body** — celestial body name (read-only).
- **Type** — Surface / Orbital (read-only).
- **Status** — Online / Offline / Under Construction. Color-coded badge.
- **Established** — Period number when the hub was created.
- **Facilities** — List of built facilities with their tiers. Under-construction facilities shown with progress indicator.
- **Crew** — Count of stationed crew. Lists names if < 10.
- **Tourists** — Count of current tourists.
- **Maintenance** — Per-period cost (Earth shows "$0 — Earth HQ").
- **Total Investment** — Sum of all construction project money costs at this hub.

**Actions:**
- **Rename** — inline edit of the name field.
- **Reactivate** — button visible when hub is offline. Costs one period's maintenance. Confirmation dialog.
- **Abandon** — button visible when hub is offline and not Earth. Confirmation dialog with warning text.

---

## Phase E: Mk2 Storage Modules

### 17. New Part Definitions

Add three Mk2 storage modules to `src/data/parts.ts`:

| Part ID | Name | Type | Capacity | State | Cost | Mass | Power | Width | Height |
|---------|------|------|----------|-------|------|------|-------|-------|--------|
| `storage-silo-mk2` | Storage Silo Mk2 | MINING_MODULE | 5,000 kg | SOLID | $30,000 | 800 kg | 3 W | 40 | 40 |
| `pressure-vessel-mk2` | Pressure Vessel Mk2 | MINING_MODULE | 2,500 kg | GAS | $45,000 | 600 kg | 8 W | 40 | 50 |
| `fluid-tank-mk2` | Fluid Tank Mk2 | MINING_MODULE | 3,750 kg | LIQUID | $55,000 | 700 kg | 12 W | 40 | 50 |

Properties follow the same pattern as Mk1. Snap points match Mk1 modules. `miningModuleType` values are the same (`STORAGE_SILO`, `PRESSURE_VESSEL`, `FLUID_TANK`).

**No code changes needed in mining.ts.** The `addModuleToSite()` function auto-detects storage modules via the `STORAGE_TYPES` array check and initializes `stored`, `storageCapacityKg`, and `storageState` from part properties.

### 18. Mk2 Storage Unit Tests

Tests in a new or existing mining test file:
- Verify each Mk2 part definition has correct properties.
- Verify `addModuleToSite()` correctly initializes Mk2 modules with higher capacity.
- Verify extraction distributes resources proportionally across mixed Mk1/Mk2 connected storage.
- Verify capacity limits are respected per-module (Mk2 holds more before full).

---

## Phase F: SVG Map Dynamic Layout & Hub Nodes

### 19. Dynamic Layout Algorithm

Replace the hardcoded `bodyPositions` in `_routeMap.ts` with a layout function.

**Input:** `src/data/bodies.js` parent-child hierarchy + `state.hubs[]` + `state.miningSites[]` + `state.routes[]`.

**Layout strategy — horizontal tree:**
1. **Root:** Sun at the leftmost position.
2. **Planets:** Spaced horizontally in orbit order (Mercury, Venus, Earth, Mars, Ceres, Jupiter, Saturn, Uranus, Neptune). Only planets with activity (mining sites, hubs, or route endpoints) are shown, plus Earth (always shown).
3. **Moons:** Branch vertically from their parent planet. Positioned above or below the planet node with connecting lines. Moon radius proportional to body size (smaller than parent).
4. **Hubs:** See Section 20.
5. **Spacing:** Fixed horizontal gap between planets (~120px). Vertical gap between moons (~50px). Total viewBox width computed dynamically based on visible body count.

**ViewBox:** Width is `leftPadding + (visiblePlanetCount * horizontalGap) + rightPadding`. Height stays ~200-250px. If content exceeds container width, the SVG container becomes horizontally scrollable.

**Output:** A `Map<string, {x, y, radius}>` for all visible bodies, used by route rendering and interaction code.

### 20. Hub Nodes on SVG Map

Hubs appear as child nodes of their associated body:

- **Surface hubs:** Small square icon (6x6px) positioned directly below or adjacent to the body circle. Connected by a thin line to the body. Label shows hub name.
- **Orbital hubs:** Small diamond icon (8x8px) positioned to the upper-right of the body (offset like a moon but visually distinct). Connected by a thin dashed line to the body.
- **Colors:** Online hubs use the body's color at full opacity. Offline hubs at 40% opacity. Under-construction hubs at 60% opacity with a dashed border.
- **Labels:** Hub name in small text (8-9px) below the icon. Truncated with ellipsis if too long.

**Layout integration:** Hub positions are computed after body positions. Multiple hubs on the same body fan out vertically to avoid overlap.

### 21. SVG Visual Polish

Reduce visual divergence between the SVG logistics map and the PixiJS in-flight map:

**Route curves:**
- Replace straight `<line>` elements with `<path>` elements using quadratic Bezier curves (`Q` command).
- Control point computed as perpendicular offset from the midpoint between origin and destination (same 0.18 factor as the PixiJS map).
- For multi-leg routes, each leg is a separate curve.

**Animated flow dots:**
- Active routes display 3 small circles (`<circle>`) that animate along the Bezier path.
- Animation uses SVG `<animateMotion>` with the route's `<path>` as the motion path, or CSS `offset-path` + `offset-distance` animation.
- Flow direction indicates cargo movement (origin → destination).
- Dots are colored to match the route status color (green for active).

**Line styles:**
- Proven legs: dashed stroke (`stroke-dasharray="6,4"`), grey color — unchanged.
- Active routes: solid stroke, green — now curved instead of straight.
- Paused routes: solid stroke, translucent grey — now curved.
- Broken routes: solid stroke, red — now curved.

**Body rendering:**
- Body colors read from CSS custom properties (after Phase A dedup).
- Atmosphere glow effect on larger bodies (subtle radial gradient or filter).

---

## Phase G: Hub-to-Hub Routing

### 22. RouteLocation Data Model Change

Update the `RouteLocation` interface in `gameState.ts`:

```typescript
interface RouteLocation {
  bodyId: string;
  locationType: 'surface' | 'orbit';
  altitude?: number;
  hubId: string | null;  // NEW — specific hub at this location, or null if no hub
}
```

All existing code that creates `RouteLocation` objects must include the `hubId` field.

### 23. Proven Leg Hub Association

Update `proveRouteLeg()` in `routes.ts`:
- When proving a leg, record the hub at the origin and destination locations (if one exists).
- `hubId` is set to the hub's ID if a hub exists at that body + location type + altitude. If no hub exists, `hubId` is `null`.
- Legs proven with `hubId: null` are valid for any hub established at that location later (the route builder can assign them).

### 24. Route Creation with Hub Targets

Update `createRoute()` in `routes.ts`:
- Route legs include `hubId` from the proven legs or as overridden by the route builder.
- Route builder UI on the SVG map allows clicking specific hubs as endpoints.
- When a body has multiple hubs, clicking the body shows a popover to select which hub.

### 25. Route Processing with Hub Delivery

Update `processRoutes()` in `routes.ts`:
- **Source resolution:** Find the mining site associated with the source hub (via hub's bodyId). Read from that site's orbital buffer.
- **Destination resolution:**
  - If destination hub is Earth hub → sell at market (unchanged behaviour).
  - If destination hub is an off-world hub → deposit into the mining site associated with that hub's body orbital buffer. Construction projects consume resources from the orbital buffer via `processConstructionProjects()` in the existing period loop — no special prioritization needed here.
- **Broken route detection:** If a route references a hub that no longer exists (abandoned), mark the route as `broken`.

### 26. Route Builder Hub Interaction

Update the SVG map route builder in `_routeBuilder.ts`:
- When entering builder mode, hub nodes on the SVG map become clickable.
- Clicking a hub sets it as the route origin (first click) or extends the route (subsequent clicks via proven legs).
- If a body has multiple hubs and the player clicks the body circle (not a specific hub), show a small selection popover listing the hubs at that body.
- The resource type dropdown filters to resources available at the source hub's mining site orbital buffer.
- Proven legs between bodies are shown. When both endpoints have hubs, the leg connects the specific hubs. When one endpoint has no hub, the leg connects to the body (assignable to any future hub there).

---

## Phase H: Code-Splitting

### 27. Screen-Based Dynamic Imports

Convert static imports of screen modules to dynamic `import()` calls:

**Screens to lazy-load:**
- `src/ui/vab/` — Vehicle Assembly Building
- `src/ui/flightController/` — Flight screen + map view
- `src/ui/logistics/` — Logistics center
- `src/ui/missionControl/` — Mission control tabs
- `src/ui/crewAdmin.ts` — Crew administration
- `src/render/flight.js` — Flight renderer (PixiJS)
- `src/render/vab.js` — VAB renderer
- `src/render/map.ts` — Orbital map renderer

**Always loaded (main bundle):**
- `src/core/gameState.ts` — needed everywhere
- `src/core/constants.ts` — needed everywhere
- `src/ui/hub.ts` + `src/render/hub.ts` — the default screen
- `src/ui/topbar.ts` — persistent navigation
- `src/ui/hubSwitcher.ts` — persistent hub dropdown

**Implementation pattern:**
```typescript
// Before (static):
import { showVAB } from './ui/vab/index.ts';

// After (dynamic):
async function navigateToVAB() {
  showLoadingIndicator();
  const { showVAB } = await import('./ui/vab/index.ts');
  hideLoadingIndicator();
  showVAB();
}
```

**Loading indicator:** A minimal centered spinner or "Loading..." text that appears during the first load of a screen. Subsequent visits hit the module cache and load instantly.

### 28. Manual Chunks Configuration

Add `build.rollupOptions.output.manualChunks` to `vite.config.ts`:

```typescript
manualChunks: {
  'vendor-pixi': ['pixi.js'],
  'core-hubs': [
    'src/core/hubs.ts',
    'src/core/hubCrew.ts',
    'src/core/hubTourists.ts',
    'src/core/hubTypes.ts',
  ],
  'core-mining': ['src/core/mining.ts', 'src/core/refinery.ts'],
  'core-routes': ['src/core/routes.ts'],
  'core-physics': ['src/core/physics.ts', 'src/core/orbit.ts'],
  'data-catalogs': [
    'src/data/parts.ts',
    'src/data/bodies.js',
    'src/data/resources.js',
    'src/data/missions.js',
    'src/data/contracts.js',
    'src/data/hubFacilities.ts',
    'src/data/hubNames.ts',
  ],
}
```

This ensures that changing code in one system doesn't invalidate the browser cache for unrelated systems.

### 29. Preloading Strategy

After the initial hub screen loads, use idle time to preload screens the player is likely to visit next:

```typescript
requestIdleCallback(() => {
  // Preload most common next screens
  import('./ui/vab/index.ts');
  import('./ui/missionControl/index.ts');
});
```

This eliminates the loading delay for the most common navigation paths while still getting the initial load time benefit.

---

## Phase I: Test Coverage — All Gaps

### Review Gap: Unit Tests

**Hub edge cases:**
- Hub with zero facilities — verify `getActiveHub()`, `calculateHubMaintenance()`, facility queries handle gracefully.
- Duplicate hub name prevention — verify `createHub()` and `renameHub()` reject duplicates (case-insensitive).
- Tourist revenue with `revenue = 0` — verify `processTouristRevenue()` handles zero-revenue tourists without errors.
- Construction project completeness checks — verify `isConstructionComplete()` handles edge cases (no resources required, all delivered, partial delivery).

**Route hub-to-hub:**
- `proveRouteLeg()` with hubId — verify hub association is recorded.
- `createRoute()` with hub targets — verify route legs include correct hubIds.
- `processRoutes()` delivers to correct hub — verify resources arrive at the destination hub's site, not just any site on the body.
- Route broken on hub abandonment — verify route status changes when referenced hub is abandoned.

**Mk2 storage:**
- Each Mk2 part definition has correct properties.
- `addModuleToSite()` initializes Mk2 modules with correct higher capacity.
- Extraction distributes proportionally across mixed Mk1/Mk2 storage.
- Per-module capacity limits respected.

**Earth hub migration:**
- `createGameState()` produces state without `state.facilities` field.
- All facility queries work through hub system.
- Earth hub has all expected facilities at correct tiers.

**Hub UX:**
- `generateHubName()` produces unique names.
- `generateHubName()` excludes names already in use.
- `renameHub()` validates uniqueness.
- `abandonHub()` preconditions (offline, not Earth).
- `abandonHub()` effects (crew evacuation, tourist eviction, route breakage, hub removal).

### Review Gap: E2E Tests

**Multi-leg route builder:**
- Seed save with 2+ proven legs forming a chain (A→B→C).
- Build a route through the chain in the logistics route builder.
- Verify route appears in the table with correct leg count.

**Hub maintenance causing offline:**
- Seed save with an off-world hub and zero money.
- Advance period.
- Verify hub goes offline, crew evacuated.

**Tourist revenue in period summary:**
- Seed save with hub + tourists generating revenue.
- Advance period.
- Verify period summary shows tourist revenue.

**Outpost Core deployment via flight:**
- Seed save with an Outpost Core on a rocket, landed on the Moon.
- Activate the Outpost Core part.
- Verify a new hub appears in the hub switcher.

**Hub reactivation:**
- Seed save with an offline hub and sufficient money.
- Click Reactivate on the hub management panel.
- Verify hub goes online, money deducted.

### Review Gap: Integration Tests

**Full off-world pipeline:**
- Establish hub → construct Crew Hab (deliver resources) → facility comes online → hire crew → advance periods → verify crew receives salary, hub charges maintenance.

**Hub offline cascade:**
- Hub with crew + tourists, money set to zero.
- Advance period.
- Verify in order: maintenance fails → hub goes offline → crew evacuated to Earth → tourists evicted → all in a single period call.

### New Feature Tests

**Incompatible save rejection:**
- Create a save with an old version number.
- Attempt to load.
- Verify error message and save slot shows "(Incompatible)".

**Hub management panel E2E:**
- Open hub management panel.
- Verify all fields display correctly for Earth hub.
- Rename a hub, verify the switcher updates.

**Hub abandonment E2E:**
- Seed save with an offline off-world hub.
- Open management panel, click Abandon, confirm.
- Verify hub removed from switcher.

**SVG dynamic layout:**
- Seed save with mining sites on multiple bodies.
- Open logistics center.
- Verify SVG map shows all relevant bodies in correct hierarchy.
- Verify hub nodes appear for established hubs.

**Hub-to-hub route E2E:**
- Seed save with hubs on two bodies and a proven leg between them.
- Build a route targeting specific hubs.
- Verify route table shows hub names as endpoints.

**Code-splitting verification:**
- Navigate between screens.
- Verify each screen loads correctly after lazy import.
- Verify loading indicator appears on first visit (if measurable).

**Mk2 storage E2E:**
- Seed save with a mining site.
- Add Mk2 storage module.
- Verify capacity is higher than Mk1 in the site info display.

---

## Technical Decisions

- **Full Earth migration over gradual deprecation.** The dual-reference pattern (`state.facilities` aliasing `hubs[0].facilities`) was a bridge. With 11 iterations of hub code, the bridge is no longer needed. One code path is simpler to reason about and test.

- **No save migration.** The game is in active development. Save format changes frequently. Migration code is wasted effort that will need rewriting when the format stabilizes. Old saves are marked incompatible.

- **Hub-to-hub routing.** Routes connecting to specific hubs (not just bodies) is the natural next step after iteration 11's hub system. It makes resource delivery precise and prepares for future features like hub-to-hub resource sharing and local supply chains.

- **Dynamic SVG layout.** A layout algorithm that reads from the body hierarchy is more maintainable than hardcoded positions and automatically adapts as new bodies or hubs are added. The schematic (non-orbital) spatial layout is intentionally preserved — it's better for route planning than a realistic orbital map.

- **Screen-based code-splitting.** The game already has clear screen boundaries. Dynamic imports at screen transitions are the 80/20 — biggest load time improvement for minimal refactoring. Manual chunks for core modules improve cache efficiency.

- **Bezier curves on SVG map.** Matching the PixiJS map's route rendering style (curved arcs, animated flow dots) creates visual consistency across the two map types even though they use different spatial layouts.

- **Auto-suggested hub names.** Adds character without complexity. A static catalog of ~100 names from space history provides enough variety for any playthrough. Names are suggestions, not forced.

## What This Iteration Does NOT Include

- **Crew transport routes** — keeping the abstracted crew transfer system (cost + transit delay). Passenger routes deferred.
- **Life support / oxygen-water consumption** — future feature building on hubs + resources.
- **Orbital buffer capacity limits** — still intentionally unbounded.
- **Hub-to-hub resource sharing** — hubs on the same body don't share buffers. Future feature.
- **New resource types or recipes** — resource system unchanged.
- **SVG map zoom/pan** — the schematic stays flat with horizontal scroll if needed. No interactive zoom.
