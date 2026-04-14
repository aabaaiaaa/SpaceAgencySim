# Iteration 12 — Earth Hub Migration, Route Refactor, Map Scalability & Polish

This iteration has four themes: (A) close all remaining gaps from the iteration 11 review and remove save migration, (B) fully migrate Earth to the hub system and add hub UX polish, (C) evolve routes to connect to specific hubs and upgrade the logistics SVG map, and (D) implement code-splitting for faster load times. Comprehensive test coverage for all identified gaps is woven throughout.

---

## Phase A: Review Fixes & Save Migration Removal

These items address every recommendation from the iteration 11 review plus the removal of all save migration code.

### 1. Fix TypeScript Errors in mapView.test.ts

**Problem:** Three TypeScript compilation errors at lines 233, 239, and 577 where Hub mock objects are missing required fields. The double-cast `as Partial<GameState> as GameState` bypasses runtime but fails `tsc --noEmit`.

**Fix:** Replace the three incomplete Hub mock objects with `makeEarthHub()` factory calls from `src/tests/_factories.ts`. The factory produces complete Hub objects with all required fields. The test assertions that reference hub fields should continue to work since `makeEarthHub()` includes the same `id: 'earth'` and standard facilities.

**Files:** `src/tests/mapView.test.ts`, possibly `src/tests/_factories.ts` if the factory needs minor adjustments.

**Validation:** `npx tsc --noEmit` passes clean (0 errors).

### 2. Hub Money Cost Environment Scaling

**Problem:** In `src/core/hubs.ts`, `createHub()` at line ~106 and `startFacilityUpgrade()` at line ~370 apply `envMultiplier` to resource costs but not to money costs. Resources scale with environment difficulty but money doesn't — this is inconsistent.

**Fix:**
- In `createHub()`, change the construction project's `moneyCost` to `crewHabCost.moneyCost * envMultiplier`.
- In `startFacilityUpgrade()`, change to `costDef.moneyCost * nextTier * envMultiplier` (currently only multiplied by tier, not environment).

**Files:** `src/core/hubs.ts`

**Tests:** Update or add unit tests in `src/tests/hubs-construction.test.ts` to verify:
- Creating a hub on Mars (envMultiplier 1.3) has moneyCost 1.3x the base.
- Creating a hub on the Moon (envMultiplier 1.0) has moneyCost 1.0x.
- Facility upgrade money cost scales by both tier and environment.

### 3. Magic String and Comment Fixes

**Problem:** `hub.facilities['crew-hab']` at `hubTourists.ts:24` uses a hardcoded string. Tourist departure semantics at line 70 are undocumented.

**Fix:**
- Import `FacilityId` from `constants.ts` in `hubTourists.ts`.
- Replace `hub.facilities['crew-hab']` with `hub.facilities[FacilityId.CREW_HAB]`.
- Add comment at line 70: `// departurePeriod is the last period the tourist is present. Revenue is credited during this period, then the tourist departs at the start of the next period.`

**Files:** `src/core/hubTourists.ts`

### 4. CSS/JS Body Color Deduplication

**Problem:** Body colors are defined in both `src/ui/logistics.css` (CSS custom properties `--body-color-*`) and `src/ui/logistics/_routeMap.ts` (JS `BODY_COLORS` constant). Manual sync required.

**Fix:**
- Remove the `BODY_COLORS` constant from `_routeMap.ts`.
- Create a helper function `getBodyColor(bodyId: string): string` that reads from CSS custom properties: `getComputedStyle(document.documentElement).getPropertyValue(\`--body-color-\${bodyId.toLowerCase()}\`)`.
- Handle the edge case where computed styles aren't available (before DOM attachment) by falling back to a hardcoded default (`#888`).
- Update all callers of the old `getBodyColor()` / `BODY_COLORS` to use the new helper.

**Files:** `src/ui/logistics/_routeMap.ts`, `src/ui/logistics.css` (verify all bodies have CSS vars)

### 5. Remove All Save Migration Functions

**Rationale:** The game is in active development. Save migration code is wasted effort that needs rewriting when the format stabilizes. Old saves are marked incompatible instead.

**Changes:**
- Delete `migrateToHubs()` and all other `migrateTo*()` functions in `src/core/saveload.ts`.
- Remove the migration chain/dispatcher that runs on load.
- In the load function, if `save.version !== SAVE_VERSION`, return an error result rather than attempting migration.
- Bump `SAVE_VERSION` to the next integer.

**Files:** `src/core/saveload.ts`

### 6. Incompatible Save UI

When a save slot contains an incompatible version:
- The save slot shows the save's original name but grayed out, with "(Incompatible)" label.
- The Load button is disabled for that slot.
- If a user somehow triggers a load of an incompatible save, show a notification: "This save was created with an older version and is not compatible."

**Files:** `src/ui/topbar.ts` or whichever UI module renders the save/load dialog. `src/core/saveload.ts` for the version check logic.

### 7. Update All Test Factories for New Save Format

After all Phase A-C changes land, test factories must produce the new format:
- **Unit:** `src/tests/_factories.ts` — all `makeGameState()`, `makeHub()`, `makeEarthHub()`, `makeRoute()`, `makeProvenLeg()` etc. produce state without `state.facilities` top-level field, with `RouteLocation.hubId`, and with current `SAVE_VERSION`.
- **E2E:** `e2e/helpers/_saveFactory.ts` and `e2e/helpers/_factories.ts` — `buildSaveEnvelope()` and all builder functions updated likewise. Remove any migration compatibility shims.

This is split across multiple tasks since it depends on Phases B and C completing first.

---

## Phase B: Earth Hub Full Migration

The core architectural change of this iteration. Remove the legacy `state.facilities` dual-reference and make all facility access go through the hub system.

### 8. Remove `facilities` from GameState Interface

**Current state:** `GameState` has a `facilities: Record<string, FacilityState>` field that is a shared object reference with `state.hubs[0].facilities`. This was a backward-compatibility bridge from iteration 11.

**Changes:**
- Remove the `facilities` property from the `GameState` interface in `src/core/gameState.ts`.
- Remove the `facilities: starterFacilities` assignment from `createGameState()`. Earth hub initialization in `state.hubs[0]` is the sole facility source.
- If `partInventory` exists at top-level GameState as a legacy alias, remove it too.
- Update the `GameState` TypeScript interface and any associated type guards or utility types.

**Files:** `src/core/gameState.ts`

### 9. Update Core Module References

Find every direct reference to `state.facilities` in `src/core/` modules and update:

**Pattern:** Most core modules should use `hasFacility(state, facilityId)` or `getFacilityTier(state, facilityId)` from `construction.ts`, which already resolve through `resolveHubFacilities()`. For modules that need to read the raw facilities record, use `getActiveHub(state).facilities` or `getHub(state, EARTH_HUB_ID).facilities`.

**Key files to update (grep for `state.facilities` and `state\.facilities`):**
- `src/core/construction.ts` — already mostly hub-aware via `resolveHubFacilities()`, but check for any remaining direct references.
- `src/core/missions.js` — mission gating may check facility tiers directly.
- `src/core/finance.js` — period processing may reference facilities for upkeep.
- `src/core/crew.js` — crew admin checks may reference facilities.
- `src/core/saveload.ts` — save serialization must no longer write `state.facilities`.
- `src/core/satellites.js`, `src/core/comms.js`, `src/core/power.js` — may check tracking station or satellite ops facility tiers.
- Any other core module found by grep.

Each file needs context-appropriate resolution:
- Code that should work for **any hub** (off-world included): use `getActiveHub(state).facilities` or accept a `hubId` parameter.
- Code that is **Earth-specific** (e.g., mission control, tracking station): use `getHub(state, EARTH_HUB_ID).facilities`.
- Code that already uses `hasFacility()` / `getFacilityTier()`: no change needed (these already resolve through hubs).

### 10. Update UI Module References

Same as above but for `src/ui/` modules:

**Key files:**
- `src/ui/hub.ts` — hub screen reads facilities for building rendering.
- `src/ui/vab/` — VAB checks launch pad, engineer facility tiers.
- `src/ui/flightController/` — checks tracking station for map access.
- `src/ui/missionControl/` — reads mission control, R&D lab tiers.
- `src/ui/crewAdmin.ts` — reads crew admin facility tier.
- `src/ui/topbar.ts` — may reference facilities in save/load.
- `src/ui/logistics/` — may reference facilities for logistics center availability.
- Any other UI module found by grep.

### 11. Update Render Module References

Same for `src/render/` modules:

**Key files:**
- `src/render/hub.ts` — reads facilities for building placement/rendering.
- `src/render/map.ts` — may check tracking station tier for feature availability.
- Any other render module found by grep.

### 12. Simplify resolveHubFacilities()

After migration, `resolveHubFacilities()` in `construction.ts` no longer needs to handle the legacy path. Simplify it:
- Remove any fallback to `state.facilities`.
- It should purely resolve through `getActiveHub(state)` or `getHub(state, hubId)`.
- If it has become trivial (just a hub lookup), consider inlining it or keeping it as a convenience helper.

### 13. Remove Legacy Earth Hub Special Cases

Audit for remaining code paths that exist only because of the dual-reference pattern:
- Search for `EARTH_HUB_ID` usages that gate between "use state.facilities" vs "use hub.facilities" — these branches can be simplified.
- Earth-specific *gameplay* rules stay unchanged (zero maintenance, Earth-only facilities, no import tax). Only *code path duality* is removed.

---

## Phase C: Hub UX Polish

### 14. Hub Name Auto-Suggestion Catalog

Create `src/data/hubNames.ts` with a curated catalog of ~80-100 names from space history:

**Categories:**
- **Missions:** Apollo, Gemini, Vostok, Artemis, Pioneer, Voyager, Mercury, Viking, Cassini, Rosetta, Juno, Horizon, Discovery, Endeavour, Challenger, Columbia, Surveyor, Mariner, Ranger, Luna, Venera, Hayabusa, Dawn, Messenger, Magellan, Galileo, Ulysses, Stardust, Genesis
- **Rockets:** Saturn, Falcon, Soyuz, Atlas, Titan, Delta, Ariane, Vega, Proton, Energia, Electron, Antares, Vulcan, Starship, Angara, Long March, Epsilon, Diamant, Europa, Scout, Minotaur
- **Figures:** Gagarin, Glenn, Ride, Tereshkova, Armstrong, Aldrin, Shepard, Leonov, Yang, Chawla, Jemison, Hubble, Kepler, Tsiolkovsky, Goddard, Von Braun, Korolev, Oberth, Copernicus, Tycho, Collins, Lovell, Cernan, Bean, Conrad, Schmitt
- **Stations:** Mir, Skylab, Tiangong, Salyut, Freedom, Unity, Harmony, Destiny, Zarya, Zvezda, Kibo, Columbus

**Export:** `export const HUB_NAME_POOL: readonly string[]` — flat array, `Object.freeze()`'d.

**Files:** New file `src/data/hubNames.ts`

### 15. Hub Name Generation Function

Add to `src/core/hubs.ts`:

```typescript
function generateHubName(state: GameState, hubType: HubType): string
```

- Picks a random unused name from `HUB_NAME_POOL`.
- Names already used by existing `state.hubs[].name` are excluded (comparison extracts the base name before " Outpost"/" Station" suffix).
- Appends " Outpost" for surface hubs, " Station" for orbital hubs.
- If pool is exhausted, falls back to `"Hub-{state.hubs.length}"`.

Update `deployOutpostCore()` to call `generateHubName()` for the default name instead of requiring a name parameter (or using it as the default when no name is provided).

### 16. Hub Name Uniqueness Validation

- `createHub()` validates proposed name against all existing `state.hubs[].name`. Case-insensitive comparison. Throws or returns error if duplicate.
- New function `renameHub(state, hubId, newName)`:
  - Validates uniqueness (case-insensitive).
  - Validates non-empty, reasonable length (1-40 chars).
  - Updates `hub.name`.
  - Earth hub can be renamed.

**Files:** `src/core/hubs.ts`

### 17. Hub Abandonment Logic

New function `abandonHub(state: GameState, hubId: string): { success: boolean; error?: string }` in `src/core/hubs.ts`:

**Preconditions:**
- Hub must exist.
- Hub must be offline (`hub.online === false`).
- Cannot abandon Earth hub (`hubId !== EARTH_HUB_ID`).

**Effects:**
1. All crew with `stationedHubId === hubId` get `stationedHubId` set to `EARTH_HUB_ID` and `transitUntil` set based on distance.
2. All tourists at the hub are removed (no remaining revenue).
3. Any routes with legs whose origin or destination `hubId` matches the abandoned hub are marked `status: 'broken'`.
4. Hub is removed from `state.hubs[]`.
5. If `state.activeHubId === hubId`, switch to `EARTH_HUB_ID`.

**Files:** `src/core/hubs.ts`, possibly `src/core/hubCrew.ts` for crew evacuation helper.

### 18. Hub Management Panel — Core Data

Create helper functions in `src/core/hubs.ts` that compute hub management panel data:

```typescript
interface HubManagementInfo {
  id: string;
  name: string;
  bodyId: string;
  bodyName: string;
  type: HubType;
  online: boolean;
  established: number;
  facilities: { id: string; name: string; tier: number; underConstruction: boolean }[];
  crewCount: number;
  crewNames: string[];
  touristCount: number;
  maintenanceCostPerPeriod: number;
  totalInvestment: number;
  canRename: boolean;
  canReactivate: boolean;
  canAbandon: boolean;
}

function getHubManagementInfo(state: GameState, hubId: string): HubManagementInfo
```

`totalInvestment` is computed as the sum of all completed + in-progress construction project `moneyCost` values at this hub.

**Files:** `src/core/hubs.ts`

### 19. Hub Management Panel — UI

New UI component. Could be `src/ui/hubManagement.ts` or integrated into `src/ui/hub.ts`.

**Trigger:** Accessible from the hub switcher area — info/gear icon next to the dropdown, or clicking the hub name.

**Layout:**
- Modal or side panel overlay.
- **Header:** Hub name (editable text field with inline save/cancel or blur-to-save).
- **Info grid:** Body, Type, Status (color-coded badge), Established period.
- **Facilities section:** List of built facilities with tier badges. Under-construction facilities shown with "(Building)" label.
- **Population section:** Crew count (+ names if < 10), Tourist count.
- **Economy section:** Maintenance cost per period, Total investment.
- **Actions row:** Reactivate button (visible when offline, costs one period's maintenance), Abandon button (visible when offline + not Earth, with confirmation dialog).

**Confirmation dialogs:**
- Reactivate: "Reactivate {hubName} for ${cost}? The hub will come back online."
- Abandon: "Abandon {hubName}? All crew will be evacuated to Earth. Any routes connected to this hub will break. This cannot be undone."

**Files:** New `src/ui/hubManagement.ts` (or `src/ui/hubManagement/` if complex enough to split).

---

## Phase D: Mk2 Storage Modules

### 20. Mk2 Part Definitions

Add three new part definitions to the `PARTS` array in `src/data/parts.ts`:

**Storage Silo Mk2:**
- `id: 'storage-silo-mk2'`
- `name: 'Storage Silo Mk2'`
- `type: PartType.MINING_MODULE`
- `mass: 800`, `cost: 30000`
- `width: 40`, `height: 40`
- `properties: { miningModuleType: MiningModuleType.STORAGE_SILO, powerDraw: 3, storageCapacityKg: 5000, storageState: 'SOLID', dragCoefficient: 0.28, heatTolerance: 1800, crashThreshold: 10 }`
- Snap points: match `storage-silo-mk1`

**Pressure Vessel Mk2:**
- `id: 'pressure-vessel-mk2'`
- `name: 'Pressure Vessel Mk2'`
- `type: PartType.MINING_MODULE`
- `mass: 600`, `cost: 45000`
- `width: 40`, `height: 50`
- `properties: { miningModuleType: MiningModuleType.PRESSURE_VESSEL, powerDraw: 8, storageCapacityKg: 2500, storageState: 'GAS', dragCoefficient: 0.20, heatTolerance: 1500, crashThreshold: 8 }`
- Snap points: match `pressure-vessel-mk1`

**Fluid Tank Mk2:**
- `id: 'fluid-tank-mk2'`
- `name: 'Fluid Tank Mk2'`
- `type: PartType.MINING_MODULE`
- `mass: 700`, `cost: 55000`
- `width: 40`, `height: 50`
- `properties: { miningModuleType: MiningModuleType.FLUID_TANK, powerDraw: 12, storageCapacityKg: 3750, storageState: 'LIQUID', dragCoefficient: 0.20, heatTolerance: 1200, crashThreshold: 6 }`
- Snap points: match `fluid-tank-mk1`

No code changes needed in `mining.ts` — `addModuleToSite()` auto-detects storage modules.

**Files:** `src/data/parts.ts`

---

## Phase E: SVG Map Dynamic Layout & Hub Nodes

### 21. Dynamic Body Layout Algorithm

Replace the hardcoded `bodyPositions` record in `src/ui/logistics/_routeMap.ts` with a layout function.

**Function signature:**
```typescript
function computeSchematicLayout(
  state: GameState,
  bodies: BodyData[]
): Map<string, { x: number; y: number; radius: number; type: 'body' | 'surfaceHub' | 'orbitalHub'; parentId?: string; hubId?: string }>
```

**Algorithm:**
1. Read parent-child hierarchy from `src/data/bodies.js`.
2. Determine which bodies are "visible": Earth (always), plus any body with a mining site, a hub, or a route endpoint.
3. Sort visible top-level bodies (those orbiting the Sun) by orbit order.
4. Assign horizontal positions: Sun at x=60, then each visible planet at `60 + index * horizontalGap` (horizontalGap ~120px).
5. For each planet, find visible moons. Position moons vertically above/below the planet at ~50px vertical offset, staggered if multiple.
6. Body radius: Sun=20, gas giants=16-18, rocky planets=10-14, moons=6-8 (proportional to actual body radius from `bodies.js`).
7. Compute total viewBox width as `rightmostX + 80`. Height remains ~220px.

**Output:** The layout map is consumed by the SVG rendering function and the route line drawing.

**Files:** `src/ui/logistics/_routeMap.ts` (or extract to a new `_schematicLayout.ts` sub-module if it grows large).

### 22. Hub Nodes on SVG Map

Extend the layout algorithm to include hubs as nodes:

**Surface hubs:** Small square icon (6x6px) positioned below their parent body circle, connected by a thin solid line (1px, body color at 60% opacity). If multiple surface hubs on one body, fan out horizontally with ~20px spacing.

**Orbital hubs:** Small diamond icon (8x8px, rotated square) positioned to the upper-right of their parent body, connected by a thin dashed line (1px). If multiple orbital hubs, fan out vertically.

**Visual states:**
- Online: body color at full opacity, solid border.
- Offline: body color at 40% opacity, dashed border.
- Under construction: body color at 60% opacity, dashed border.

**Labels:** Hub name in 8px Courier text below/beside the icon. Truncated with "..." if > 12 characters.

**Interactivity:** Hubs are clickable in both normal mode (highlight associated routes) and builder mode (set as route endpoint). See Phase F for builder interaction details.

**Files:** `src/ui/logistics/_routeMap.ts`

### 23. SVG Route Visual Polish — Bezier Curves

Replace straight `<line>` route elements with curved `<path>` elements:

**Curve computation:** For each route leg, compute a quadratic Bezier curve between origin and destination positions:
- Midpoint: `((x1+x2)/2, (y1+y2)/2)`
- Perpendicular direction: rotate the line direction by 90 degrees.
- Control point: offset from midpoint along perpendicular by `0.18 * distance(origin, dest)`.
- Alternate offset direction per leg index (odd legs curve up, even curve down) to prevent overlapping arcs on the same body pair.

**SVG path:** `<path d="M x1,y1 Q cx,cy x2,y2" />`

**Line styles (unchanged logic, new geometry):**
- Proven legs: dashed stroke (`stroke-dasharray="6,4"`), `#888`.
- Active routes: solid stroke, green (`#44CC88`).
- Paused routes: solid stroke, grey at 50% opacity.
- Broken routes: solid stroke, red (`#CC4444`).

**Files:** `src/ui/logistics/_routeMap.ts`

### 24. SVG Animated Flow Dots

Add animated flow indicators on active route legs:

**Implementation:** For each active route leg, create 3 `<circle>` elements (r=2.5px, route color) that animate along the Bezier path.

**Animation approach — CSS `offset-path`:**
1. Define the route leg as an invisible `<path>` element with a unique ID.
2. Each dot references the path via `offset-path: url(#path-id)`.
3. Animate `offset-distance` from 0% to 100% using CSS `@keyframes`.
4. Stagger the 3 dots at 0%, 33%, 66% delay.
5. Animation duration: ~3 seconds per cycle, `infinite` repeat.

**Fallback:** If `offset-path` isn't supported (unlikely in modern browsers), skip flow dots gracefully.

**Flow direction:** Dots move from origin to destination (indicating cargo direction).

**Files:** `src/ui/logistics/_routeMap.ts`, `src/ui/logistics.css` (for keyframe definitions)

### 25. Dynamic ViewBox and Scrolling

The SVG viewBox width is now computed dynamically:
- Width = `rightmostNodeX + rightPadding` (from layout algorithm).
- If the computed width exceeds the logistics panel's available width, the SVG container gets `overflow-x: auto` for horizontal scrolling.
- Height stays fixed at ~220px.

**Files:** `src/ui/logistics/_routeMap.ts`, `src/ui/logistics.css`

---

## Phase F: Hub-to-Hub Routing

### 26. RouteLocation Data Model Change

Update the `RouteLocation` interface in `src/core/gameState.ts`:

```typescript
interface RouteLocation {
  bodyId: string;
  locationType: 'surface' | 'orbit';
  altitude?: number;
  hubId: string | null;  // specific hub at this location, or null
}
```

All code that creates `RouteLocation` objects must include `hubId`. All code that reads `RouteLocation` must handle the `hubId` field.

**Files:** `src/core/gameState.ts`

### 27. Update Proven Leg System

Update `proveRouteLeg()` in `src/core/routes.ts`:
- Accept `originHubId` and `destinationHubId` parameters (or derive from flight state + hub lookup).
- Set `hubId` on the origin and destination `RouteLocation` objects.
- If no hub exists at the proven location, set `hubId: null`. These legs are valid for any hub established there later.

Update `ProvenLeg` to match the updated `RouteLocation` interface.

**Files:** `src/core/routes.ts`, `src/core/gameState.ts`

### 28. Update Route Creation

Update `createRoute()` in `src/core/routes.ts`:
- Route legs inherit `hubId` from their proven legs.
- The route builder can override `hubId` when the player selects a specific hub on the SVG map.
- Validation: if a leg references a hub that doesn't exist, reject route creation.

**Files:** `src/core/routes.ts`

### 29. Update Route Processing for Hub Delivery

Update `processRoutes()` in `src/core/routes.ts`:

**Source resolution:**
- Find the mining site on the source hub's body.
- Read from that site's `orbitalBuffer[route.resourceType]`.
- (This is largely the same as before since mining sites are per-body, not per-hub. The hubId is used for display/routing but the orbital buffer is still body-level.)

**Destination resolution:**
- If destination hub is Earth hub → sell at market (unchanged).
- If destination hub is an off-world hub → deposit into the mining site's orbital buffer on the destination body. Construction projects consume from orbital buffers via `processConstructionProjects()`.

**Broken route detection:**
- After hub abandonment, any route referencing that hub should already be marked `broken` by `abandonHub()`. Add a safety check in `processRoutes()`: if a leg's `hubId` references a non-existent hub, mark the route `broken` and skip processing.

**Files:** `src/core/routes.ts`

### 30. Route Builder Hub Interaction

Update the SVG map route builder in `src/ui/logistics/_routeBuilder.ts`:

**Builder mode changes:**
- Hub nodes on the SVG map are clickable as route endpoints.
- When the player clicks a body that has exactly one hub, that hub is auto-selected.
- When the player clicks a body with multiple hubs, show a small popover/tooltip listing the hubs. Player clicks one to select.
- When the player clicks a body with no hubs, the route endpoint is body-level (`hubId: null`).
- Proven legs between bodies show which hubs they connect (if any). When the player clicks a proven leg in builder mode, the origin/destination hub associations carry over.

**Resource dropdown:** After selecting a source hub, the resource type dropdown filters to resources available in that hub's body's orbital buffer.

**Files:** `src/ui/logistics/_routeBuilder.ts`, `src/ui/logistics/_routeMap.ts` (for hub node click handling)

### 31. Route Table Hub Display

Update the route table in `src/ui/logistics/_routeTable.ts`:
- Route leg origin/destination now shows hub name (if `hubId` is set) instead of just body name.
- Format: "Apollo Outpost (Moon, surface)" instead of "Moon (surface)".
- If `hubId` is null, show body name as before.

**Files:** `src/ui/logistics/_routeTable.ts`

---

## Phase G: Code-Splitting

### 32. Identify and Prepare Screen Entry Points

Before adding dynamic imports, ensure each screen has a clean entry point that can be lazily loaded:

**Screens to lazy-load:**
- `src/ui/vab/index.ts` — VAB
- `src/ui/flightController/index.ts` — Flight + map
- `src/ui/logistics/index.ts` — Logistics center
- `src/ui/missionControl/index.ts` — Mission control
- `src/ui/crewAdmin.ts` — Crew admin

**Associated render modules (loaded with their screen):**
- `src/render/vab.js` — loaded with VAB screen
- `src/render/flight.js` + `src/render/map.ts` — loaded with flight screen

**Always in main bundle:**
- `src/core/gameState.ts`, `src/core/constants.ts` — needed everywhere
- `src/ui/hub.ts` + `src/render/hub.ts` — default screen
- `src/ui/topbar.ts` — persistent navigation
- `src/ui/hubSwitcher.ts` — persistent hub dropdown
- `src/ui/hubManagement.ts` — accessible from hub screen

Verify each screen module's exports are self-contained (no circular dependencies that would prevent code-splitting).

**Files:** Various — audit only, may need minor refactoring of imports.

### 33. Screen Navigation with Dynamic Imports

Find the screen-switching function (likely in `src/ui/` or `src/main.ts`) and convert static imports to dynamic:

**Pattern:**
```typescript
// Before:
import { showVAB } from './ui/vab/index.ts';
// After:
async function navigateToVAB() {
  showLoadingIndicator();
  const { showVAB } = await import('./ui/vab/index.ts');
  hideLoadingIndicator();
  showVAB();
}
```

Each screen transition uses this pattern. The module cache ensures subsequent visits load instantly.

**Loading indicator:** A minimal full-screen overlay with centered "Loading..." text or spinner. Styled consistently with the game's dark theme. Appears only on first load of each screen.

**Files:** Screen router/switcher module (find by grepping for screen transition calls), new `src/ui/loadingIndicator.ts`.

### 34. Vite Manual Chunks Configuration

Add `build.rollupOptions.output.manualChunks` to `vite.config.ts`:

```typescript
build: {
  rollupOptions: {
    output: {
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
      },
    },
  },
},
```

**Files:** `vite.config.ts`

### 35. Preloading Adjacent Screens

After the initial hub screen loads, preload screens the player is likely to visit:

```typescript
requestIdleCallback(() => {
  import('./ui/vab/index.ts');
  import('./ui/missionControl/index.ts');
});
```

This runs during idle time, so the preload doesn't compete with the active screen's rendering. The dynamic `import()` caches the module for instant navigation later.

**Files:** Hub screen initialization code or main entry point.

---

## Phase H: Test Coverage — All Identified Gaps

### Unit Test Gaps (from iteration 11 review)

**Hub edge cases:**
- Hub with zero facilities — `getActiveHub()`, `calculateHubMaintenance()`, facility queries handle gracefully.
- Duplicate hub name prevention — `createHub()` and `renameHub()` reject duplicates (case-insensitive).
- Tourist revenue with `revenue = 0` — `processTouristRevenue()` handles zero-revenue tourists.
- Construction project lifecycle edge cases — `isConstructionComplete()` with no resources required, all delivered, partial delivery.

**New feature unit tests:**
- Hub name generation — produces unique names, excludes used names, handles pool exhaustion.
- Hub rename — validates uniqueness, updates name, allows Earth rename.
- Hub abandonment — preconditions enforced, crew evacuated, tourists evicted, routes broken, hub removed.
- Hub management info — all fields computed correctly.
- Mk2 storage — correct properties, capacity, extraction distribution across mixed Mk1/Mk2.
- RouteLocation with hubId — proven legs record hubs, route creation includes hubs, route processing delivers to correct hub.
- Route broken on hub abandonment — abandoned hub's routes are marked broken.
- Body color helper — reads from CSS vars, falls back on missing styles.
- Dynamic layout — computes positions from body hierarchy, includes hubs.
- Incompatible save rejection — old version saves are rejected with error.

### E2E Test Gaps (from iteration 11 review)

- Multi-leg route builder flow (A→B→C chain).
- Hub maintenance causing offline status.
- Tourist revenue in period summary display.
- Outpost Core deployment via flight (land on Moon, activate, verify hub created).
- Hub reactivation from offline state.

### New Feature E2E Tests

- Hub management panel — open, verify fields, rename, confirm switcher updates.
- Hub abandonment — seed offline hub, abandon, verify removed from switcher.
- Hub name auto-suggestion — deploy outpost, verify auto-generated name appears.
- Mk2 storage in mining site — add Mk2 module, verify higher capacity displayed.
- SVG dynamic layout — seed with multiple bodies with activity, verify SVG shows all.
- Hub nodes on SVG map — seed with hubs, verify hub icons appear on map.
- Hub-to-hub route — seed with hubs on two bodies + proven leg, build route targeting hubs, verify table shows hub names.
- Incompatible save slot — seed save with old version, verify grayed out + disabled.
- Code-splitting screen navigation — navigate between all screens, verify each loads.

### Integration Test Gaps (from iteration 11 review)

- Full off-world pipeline: establish hub → deliver construction resources → facility completes → hire crew → advance periods → verify salaries + maintenance.
- Hub offline cascade: hub with crew + tourists, zero money → advance period → maintenance fails → offline → crew evacuated → tourists evicted (all in one period call).

---

## Technical Decisions

- **Full Earth migration over gradual deprecation.** The dual-reference pattern was a bridge from iteration 11. One code path is simpler to reason about, test, and maintain.
- **No save migration during development.** Save format changes frequently. Migration code is wasted effort. Old saves marked incompatible. Migration can be added when the format stabilizes.
- **Hub-to-hub routing.** Routes connecting to specific hubs makes resource delivery precise and enables future features (hub-to-hub sharing, local supply chains).
- **Dynamic SVG layout from body hierarchy.** More maintainable than hardcoded positions. Adapts automatically as new bodies or hubs are added.
- **Schematic SVG stays separate from orbital PixiJS map.** Different use cases (route planning vs flight). Schematic is better for logistics — everything visible, no zoom/pan needed.
- **Screen-based code-splitting.** Natural split points at screen boundaries. Biggest load time improvement for minimal refactoring.
- **Bezier curves on SVG map.** Visual consistency with the PixiJS map's route rendering, even with different spatial layouts.
- **Auto-suggested hub names from space history.** Adds character. Static catalog, random selection with exclusion of used names.

## What This Iteration Does NOT Include

- **Crew transport routes** — keeping the abstracted transfer system.
- **Life support / oxygen-water consumption** — future feature.
- **Orbital buffer capacity limits** — still intentionally unbounded.
- **Hub-to-hub resource sharing** — future feature.
- **New resource types or recipes** — unchanged.
- **SVG map zoom/pan** — flat schematic with horizontal scroll.
- **Save migration** — removed, not replaced. Adds back in a future iteration.
