# Iteration 12 Tasks

## Phase A: Review Fixes & Save Migration Removal

### TASK-001: Fix TypeScript errors in mapView.test.ts
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/tests/mapView.test.ts`, three incomplete Hub mock objects at lines ~233, ~239, and ~577 cause `tsc --noEmit` to fail. Replace each inline `{ id: 'earth', facilities }` mock with a call to `makeEarthHub()` from `src/tests/_factories.ts`, passing any necessary overrides (e.g. specific facilities). Ensure the test assertions that reference hub fields still pass. Import `makeEarthHub` at the top of the file if not already imported.
- **Verification**: `npx tsc --noEmit src/tests/mapView.test.ts && npx vitest run src/tests/mapView.test.ts`

### TASK-002: Fix hub money cost environment scaling
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/hubs.ts`, find `createHub()` where the initial Crew Hab construction project is created. The `moneyCost` field is set to `crewHabCost.moneyCost` without multiplying by `envMultiplier`. Change to `crewHabCost.moneyCost * envMultiplier`. Similarly, find `startFacilityUpgrade()` where `moneyCost` is `costDef.moneyCost * nextTier` — change to `costDef.moneyCost * nextTier * envMultiplier`. Then add/update unit tests in `src/tests/hubs-construction.test.ts`: (a) verify creating a hub on Mars (envMultiplier 1.3) has moneyCost = base * 1.3, (b) verify Moon (1.0) has moneyCost = base * 1.0, (c) verify facility upgrade money scales by both tier and environment.
- **Verification**: `npx vitest run src/tests/hubs-construction.test.ts`

### TASK-003: Fix magic string and add tourist departure comment
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/hubTourists.ts`: (1) Add `import { FacilityId } from './constants.ts';` if not already imported. (2) Replace `hub.facilities['crew-hab']` (around line 24) with `hub.facilities[FacilityId.CREW_HAB]`. (3) At the tourist departure filter (around line 70, the `hub.tourists.filter(t => t.departurePeriod > state.currentPeriod)` line), add a comment above it: `// departurePeriod is the last period the tourist is present. Revenue is credited during this period, then the tourist departs at the start of the next period.`
- **Verification**: `npx vitest run src/tests/hubs-tourists.test.ts && npx tsc --noEmit src/core/hubTourists.ts`

### TASK-004: Deduplicate body colors — CSS as single source of truth
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/ui/logistics/_routeMap.ts`, find the `BODY_COLORS` constant (or `getBodyColor()` function with hardcoded colors). Replace it with a function that reads CSS custom properties: `getComputedStyle(document.documentElement).getPropertyValue(\`--body-color-\${bodyId.toLowerCase()}\`).trim()`. If the value is empty (DOM not attached), fall back to `'#888'`. Verify that `src/ui/logistics.css` has `--body-color-*` custom properties for all bodies used in the game (sun, earth, moon, mars, ceres, jupiter, saturn, titan — and any others). Update all callers of the old function/constant within `_routeMap.ts` and `_routeBuilder.ts` to use the new helper. Export the helper so other modules can use it if needed.
- **Verification**: `npx vitest run src/tests/logistics.test.ts 2>/dev/null; npx tsc --noEmit src/ui/logistics/_routeMap.ts`

### TASK-005: Remove all save migration functions
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/saveload.ts`: (1) Delete `migrateToHubs()` and every other `migrateTo*()` function. (2) Remove the migration chain/dispatcher that calls them during load (look for a function that checks save version and applies migrations sequentially). (3) In the load function, add a version check: if `save.version !== SAVE_VERSION`, return an error result (e.g. `{ success: false, error: 'incompatible' }`) instead of attempting migration. (4) Bump `SAVE_VERSION` by 1. Do NOT change the save/load function signatures — just change the internal logic to reject incompatible saves.
- **Verification**: `npx vitest run src/tests/saveload.test.ts 2>/dev/null; npx tsc --noEmit src/core/saveload.ts`

### TASK-006: Incompatible save UI handling
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Find the save/load UI (likely in `src/ui/topbar.ts` or a sub-module). When rendering save slot list, if a slot's save version doesn't match `SAVE_VERSION`: (1) Show the slot's name but grayed out (add a CSS class like `save-slot-incompatible`). (2) Append "(Incompatible)" text. (3) Disable the Load button for that slot. (4) If the user somehow triggers a load of an incompatible save, show a notification: "This save was created with an older version and is not compatible." Add the CSS for the grayed-out state.
- **Verification**: `npx vitest run src/tests/saveload.test.ts 2>/dev/null; npx tsc --noEmit src/ui/topbar.ts`

---

## Phase B: Earth Hub Full Migration

### TASK-007: Remove `facilities` field from GameState interface
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: In `src/core/gameState.ts`: (1) Remove the `facilities` property from the `GameState` interface/type. (2) In `createGameState()`, remove the line that assigns `facilities: starterFacilities` (or however it's assigned). The Earth hub in `state.hubs[0]` already has facilities — that is now the sole source. (3) If `partInventory` exists as a top-level GameState field that aliases the Earth hub's inventory, remove it too. (4) This will cause TypeScript errors across the codebase — that's expected. Subsequent tasks fix them.
- **Verification**: `npx tsc --noEmit src/core/gameState.ts`

### TASK-008: Update core module references — construction.ts
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: In `src/core/construction.ts`, find any remaining direct references to `state.facilities`. The module already has `resolveHubFacilities()` which defaults to the active hub. Ensure all public functions (`hasFacility`, `getFacilityTier`, `buildFacility`, `upgradeFacility`, etc.) use `resolveHubFacilities()` and not `state.facilities`. Remove the legacy fallback path in `resolveHubFacilities()` if it exists (e.g. `return state.facilities` as a fallback). The function should now purely resolve through `getActiveHub(state)` or `getHub(state, hubId)`.
- **Verification**: `npx tsc --noEmit src/core/construction.ts && npx vitest run src/tests/construction.test.ts 2>/dev/null`

### TASK-009: Update core module references — missions, finance, crew
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Grep `src/core/` for `state\.facilities` (excluding `gameState.ts` and `construction.ts` which are handled separately). For each match: replace with the appropriate hub-aware alternative. Use `hasFacility(state, id)` / `getFacilityTier(state, id)` from construction.ts for facility checks. Use `getActiveHub(state).facilities` for reading the raw facilities record. Use `getHub(state, EARTH_HUB_ID).facilities` for Earth-specific checks. Key files likely include: `missions.js`, `finance.js`, `crew.js`, `satellites.js`, `comms.js`, `power.js`, `saveload.ts`. Fix each file to compile cleanly.
- **Verification**: `npx tsc --noEmit && npx vitest run src/tests/missions.test.ts src/tests/finance.test.ts src/tests/crew.test.ts 2>/dev/null`

### TASK-010: Update UI module references — hub, vab, flight
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Grep `src/ui/` for `state\.facilities`. For each match: replace with the hub-aware alternative. UI modules should typically use `getActiveHub(state).facilities` since they render the current hub's state. Key files: `src/ui/hub.ts`, `src/ui/vab/` (parts panel, engineer panel, launch flow), `src/ui/flightController/` (map view, flight controls). Import `getActiveHub` from `src/core/hubs.ts` where needed. Earth-specific UI (mission control gating) should use `getHub(state, EARTH_HUB_ID)`.
- **Verification**: `npx tsc --noEmit src/ui/hub.ts src/ui/vab/index.ts src/ui/flightController/index.ts 2>/dev/null`

### TASK-011: Update UI module references — missionControl, crewAdmin, logistics, topbar
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Continue the `state.facilities` grep for remaining UI modules: `src/ui/missionControl/`, `src/ui/crewAdmin.ts`, `src/ui/logistics/`, `src/ui/topbar.ts`, and any other UI files. Replace all references with hub-aware alternatives. Mission control and crew admin are Earth-specific screens — use `getHub(state, EARTH_HUB_ID).facilities` for their facility checks.
- **Verification**: `npx tsc --noEmit src/ui/missionControl/index.ts src/ui/crewAdmin.ts src/ui/logistics/index.ts src/ui/topbar.ts 2>/dev/null`

### TASK-012: Update render module references
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: Grep `src/render/` for `state\.facilities`. For each match: replace with the hub-aware alternative. Render modules should use `getActiveHub(state).facilities`. Key files: `src/render/hub.ts` (building placement), `src/render/map.ts` (tracking station tier checks). Import `getActiveHub` from `src/core/hubs.ts` where needed.
- **Verification**: `npx tsc --noEmit src/render/hub.ts src/render/map.ts 2>/dev/null`

### TASK-013: Update unit test references to state.facilities
- **Status**: done
- **Dependencies**: TASK-007, TASK-008, TASK-009
- **Description**: Grep `src/tests/` for `state\.facilities`. Many tests create game state and set `state.facilities` directly. Update all test files to set facilities through the hub system instead: either use `makeEarthHub()` with facility overrides, or set `state.hubs[0].facilities[...]` directly. Update `makeGameState()` or equivalent factory in `_factories.ts` to no longer set a top-level `facilities` field.
- **Verification**: `npx vitest run src/tests/ --reporter=verbose 2>&1 | tail -20`

### TASK-014: Update E2E test factories for hub migration
- **Status**: done
- **Dependencies**: TASK-007
- **Description**: In `e2e/helpers/_saveFactory.ts` and `e2e/helpers/_factories.ts`: (1) Update `buildSaveEnvelope()` to not include a top-level `facilities` field. Facilities must be set through the hubs array. (2) Update any E2E factory helpers that set `state.facilities` to use hubs instead. (3) Ensure `buildSaveEnvelope()` includes the correct `SAVE_VERSION`. (4) Remove any migration compatibility shims or legacy format helpers.
- **Verification**: `npx playwright test e2e/hub.spec.ts --reporter=line 2>/dev/null`

### TASK-015: Remove legacy Earth hub special cases
- **Status**: pending
- **Dependencies**: TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014
- **Description**: Final audit pass. Grep the entire `src/` and `e2e/` directories for: (1) `state\.facilities` — should have zero matches. (2) Any code paths that branch on `EARTH_HUB_ID` to choose between `state.facilities` and `hub.facilities` — these branches should be simplified to just use hub facilities. Earth-specific *gameplay* rules (zero maintenance, Earth-only facilities, no import tax) must remain. Only remove *code path duality*.
- **Verification**: `grep -r "state\.facilities" src/ e2e/ --include="*.ts" --include="*.js" | grep -v node_modules | grep -v ".test." | wc -l` should output 0 (excluding test files which were handled in TASK-013). Then: `npx tsc --noEmit && npx vitest run src/tests/ --reporter=verbose 2>&1 | tail -5`

---

## Phase C: Hub UX Polish

### TASK-016: Create hub name catalog
- **Status**: done
- **Dependencies**: none
- **Description**: Create new file `src/data/hubNames.ts`. Export a `HUB_NAME_POOL` constant — a frozen array of ~80-100 string names from space history. Categories to include: mission names (Apollo, Gemini, Vostok, Artemis, Pioneer, Voyager, Mercury, Viking, Cassini, Rosetta, Juno, Horizon, Discovery, Endeavour, Challenger, Columbia, Surveyor, Mariner, Ranger, Luna, Venera, Hayabusa, Dawn, Messenger, Magellan, Galileo, Ulysses, Stardust, Genesis), rocket names (Saturn, Falcon, Soyuz, Atlas, Titan, Delta, Ariane, Vega, Proton, Energia, Electron, Antares, Vulcan, Starship, Angara, Diamant, Europa, Scout, Minotaur), figure names (Gagarin, Glenn, Ride, Tereshkova, Armstrong, Aldrin, Shepard, Leonov, Yang, Chawla, Jemison, Hubble, Kepler, Tsiolkovsky, Goddard, Korolev, Oberth, Copernicus, Tycho, Collins, Lovell, Cernan, Bean, Conrad, Schmitt), station names (Mir, Skylab, Tiangong, Salyut, Freedom, Unity, Harmony, Destiny, Zarya, Zvezda, Kibo, Columbus). Use `Object.freeze()` on the array. Export type `HubNamePool`.
- **Verification**: `npx tsc --noEmit src/data/hubNames.ts`

### TASK-017: Hub name generation function
- **Status**: done
- **Dependencies**: TASK-016
- **Description**: In `src/core/hubs.ts`, add `generateHubName(state: GameState, hubType: HubType): string`. Import `HUB_NAME_POOL` from `src/data/hubNames.ts`. Logic: (1) Get existing hub names — extract base names by stripping " Outpost" and " Station" suffixes. (2) Filter `HUB_NAME_POOL` to names not in the used set. (3) Pick a random name from the filtered pool. (4) Append " Outpost" for surface hubs or " Station" for orbital hubs. (5) If pool is exhausted, return `"Hub-${state.hubs.length}"` with the appropriate suffix. Update `deployOutpostCore()` to call `generateHubName()` for the default name. Write unit tests in `src/tests/hubs.test.ts`: verify name generated, verify used names excluded, verify suffix matches hub type, verify fallback when pool exhausted (mock a state with all names used).
- **Verification**: `npx vitest run src/tests/hubs.test.ts`

### TASK-018: Hub name uniqueness validation
- **Status**: pending
- **Dependencies**: TASK-017
- **Description**: In `src/core/hubs.ts`: (1) In `createHub()`, add validation that the proposed name doesn't match any existing `state.hubs[].name` (case-insensitive comparison using `.toLowerCase()`). If duplicate, throw an error or return a result indicating failure. (2) Add new function `renameHub(state: GameState, hubId: string, newName: string): { success: boolean; error?: string }`. Validates: non-empty, max 40 chars, case-insensitive uniqueness. Updates `hub.name` on success. Earth hub can be renamed. Write unit tests: duplicate name rejected on create, duplicate name rejected on rename, case-insensitive check works, valid rename succeeds, Earth rename works.
- **Verification**: `npx vitest run src/tests/hubs.test.ts`

### TASK-019: Hub abandonment logic
- **Status**: pending
- **Dependencies**: TASK-018
- **Description**: In `src/core/hubs.ts`, add `abandonHub(state: GameState, hubId: string): { success: boolean; error?: string }`. Preconditions: hub exists, hub.online === false, hubId !== EARTH_HUB_ID. Return error string if precondition fails. On success: (1) Set all crew with `stationedHubId === hubId` to `stationedHubId = EARTH_HUB_ID` with appropriate `transitUntil` (use existing transit delay calculation from hubCrew.ts). (2) Clear `hub.tourists` array. (3) For all routes in `state.routes`, check each leg — if any leg's origin or destination `hubId` matches the abandoned hub, set `route.status = 'broken'`. (4) Remove the hub from `state.hubs` array. (5) If `state.activeHubId === hubId`, set to EARTH_HUB_ID. Write unit tests: precondition failures, crew evacuation with transit, tourist eviction, route breakage, hub removal, activeHubId switch.
- **Verification**: `npx vitest run src/tests/hubs.test.ts`

### TASK-020: Hub management info helper
- **Status**: pending
- **Dependencies**: TASK-019
- **Description**: In `src/core/hubs.ts`, add a `getHubManagementInfo(state: GameState, hubId: string): HubManagementInfo` function (define the `HubManagementInfo` interface in `hubTypes.ts`). Fields: id, name, bodyId, bodyName (from bodies data), type, online, established, facilities (array of {id, name, tier, underConstruction}), crewCount, crewNames (array), touristCount, maintenanceCostPerPeriod (from calculateHubMaintenance), totalInvestment (sum of all construction project moneyCost values at this hub — both completed and in-progress), canRename (always true), canReactivate (!online && id !== EARTH_HUB_ID), canAbandon (!online && id !== EARTH_HUB_ID). Write unit tests verifying each field is computed correctly for Earth hub and an off-world hub.
- **Verification**: `npx vitest run src/tests/hubs.test.ts`

### TASK-021: Hub management panel UI — layout and display
- **Status**: pending
- **Dependencies**: TASK-020
- **Description**: Create `src/ui/hubManagement.ts`. Export functions `showHubManagementPanel(state, hubId)` and `hideHubManagementPanel()`. The panel is a modal overlay (dark semi-transparent backdrop + centered panel). Layout: (1) Header with hub name as an editable text input (blur or Enter to save, Escape to cancel). (2) Info grid: Body name, Type (Surface/Orbital), Status badge (green "Online", red "Offline", yellow "Building"), Established period. (3) Facilities section: list each facility with name and tier badge, under-construction ones marked "(Building)". (4) Population: crew count + names if <10, tourist count. (5) Economy: maintenance cost, total investment. (6) Actions row at bottom. Style with the game's existing dark theme patterns. Close button (X) in top-right corner. Click backdrop to close.
- **Verification**: `npx tsc --noEmit src/ui/hubManagement.ts`

### TASK-022: Hub management panel — actions (rename, reactivate, abandon)
- **Status**: pending
- **Dependencies**: TASK-021
- **Description**: In `src/ui/hubManagement.ts`, wire up the action buttons: (1) Name field: on blur/Enter, call `renameHub()`. Show error notification if validation fails. Update hub switcher dropdown text. (2) Reactivate button: visible when `canReactivate`. On click, show confirmation dialog "Reactivate {name} for ${cost}?" with Confirm/Cancel. On confirm, call `reactivateHub()` from hubs.ts, re-render panel. (3) Abandon button: visible when `canAbandon`. On click, show confirmation dialog with warning text about crew evacuation and route breakage. On confirm, call `abandonHub()`, close panel, re-render hub switcher. Use the game's existing dialog/notification patterns.
- **Verification**: `npx tsc --noEmit src/ui/hubManagement.ts`

### TASK-023: Wire hub management panel to hub switcher
- **Status**: pending
- **Dependencies**: TASK-022
- **Description**: In `src/ui/hubSwitcher.ts`, add an info/gear icon button next to the hub dropdown. On click, call `showHubManagementPanel(state, state.activeHubId)`. The icon should be a small gear or (i) icon styled to match the hub switcher's existing visual style. When the management panel closes, the hub switcher should refresh its dropdown options (in case a hub was renamed or abandoned).
- **Verification**: `npx tsc --noEmit src/ui/hubSwitcher.ts`

---

## Phase D: Mk2 Storage Modules

### TASK-024: Add Mk2 storage part definitions
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/data/parts.ts`, add three new entries to the `PARTS` array. Storage Silo Mk2: id `storage-silo-mk2`, name `Storage Silo Mk2`, type MINING_MODULE, mass 800, cost 30000, width 40, height 40, properties { miningModuleType: STORAGE_SILO, powerDraw: 3, storageCapacityKg: 5000, storageState: 'SOLID', dragCoefficient: 0.28, heatTolerance: 1800, crashThreshold: 10 }, snap points matching storage-silo-mk1. Pressure Vessel Mk2: id `pressure-vessel-mk2`, mass 600, cost 45000, width 40, height 50, properties { miningModuleType: PRESSURE_VESSEL, powerDraw: 8, storageCapacityKg: 2500, storageState: 'GAS', dragCoefficient: 0.20, heatTolerance: 1500, crashThreshold: 8 }. Fluid Tank Mk2: id `fluid-tank-mk2`, mass 700, cost 55000, width 40, height 50, properties { miningModuleType: FLUID_TANK, powerDraw: 12, storageCapacityKg: 3750, storageState: 'LIQUID', dragCoefficient: 0.20, heatTolerance: 1200, crashThreshold: 6 }. Copy snap points and animation states from the corresponding Mk1 parts.
- **Verification**: `npx tsc --noEmit src/data/parts.ts`

### TASK-025: Mk2 storage unit tests
- **Status**: done
- **Dependencies**: TASK-024
- **Description**: Add tests in `src/tests/mining.test.ts` (or a new `src/tests/mk2-storage.test.ts`): (1) Verify each Mk2 part definition exists in the parts catalog with correct id, name, and properties. (2) Verify `addModuleToSite()` correctly initializes a Mk2 storage module with the higher capacity (5000 for silo, 2500 for pressure vessel, 3750 for fluid tank). (3) Verify extraction distributes resources proportionally across mixed Mk1 + Mk2 connected storage (e.g. a drill connected to both a 2000kg Mk1 silo and a 5000kg Mk2 silo distributes ~29% / ~71%). (4) Verify per-module capacity limits are respected — filling a Mk2 silo stops at 5000kg.
- **Verification**: `npx vitest run src/tests/mining.test.ts`

---

## Phase E: SVG Map Dynamic Layout & Hub Nodes

### TASK-026: Extract schematic layout into separate module
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/ui/logistics/_schematicLayout.ts`. Move the body positioning logic out of `_routeMap.ts` into this new module. Export a function `computeSchematicLayout(state: GameState): SchematicLayout` where `SchematicLayout` is a Map or Record mapping node IDs to `{ x: number; y: number; radius: number; type: 'body' | 'surfaceHub' | 'orbitalHub'; parentId?: string; hubId?: string; label: string }`. For now, this can just reproduce the existing hardcoded positions as a starting point — the dynamic algorithm comes in TASK-027. Also export the `SchematicLayout` type. Update `_routeMap.ts` to import and use this layout instead of its hardcoded positions.
- **Verification**: `npx tsc --noEmit src/ui/logistics/_schematicLayout.ts && npx tsc --noEmit src/ui/logistics/_routeMap.ts`

### TASK-027: Implement dynamic body layout algorithm
- **Status**: done
- **Dependencies**: TASK-026
- **Description**: In `src/ui/logistics/_schematicLayout.ts`, replace the hardcoded positions with a dynamic algorithm. (1) Import body data from `src/data/bodies.js` to get parent-child hierarchy and orbit order. (2) Determine visible bodies: Earth (always), plus any body with a mining site in `state.miningSites`, a hub in `state.hubs`, or an endpoint in `state.routes` or `state.provenLegs`. (3) Sort visible top-level bodies (parent = Sun) by orbit order. (4) Assign horizontal positions: Sun at x=60, each visible planet at `60 + (index+1) * 120`. (5) For each planet, find visible moons. Position moons vertically above the parent at y=parent.y - 50, staggered horizontally if multiple moons. (6) Body radius proportional to actual body size — Sun=20, gas giants=16-18, rocky planets=10-14, moons=6-8. (7) Compute total layout width as `rightmostX + 80`. Write unit tests: verify Sun always present, Earth always present, Moon positioned as child of Earth, Mars appears when it has a mining site, invisible bodies excluded.
- **Verification**: `npx vitest run src/tests/logistics-layout.test.ts 2>/dev/null || npx vitest run src/tests/logistics.test.ts 2>/dev/null`

### TASK-028: Add hub nodes to schematic layout
- **Status**: pending
- **Dependencies**: TASK-027, TASK-015
- **Description**: Extend `computeSchematicLayout()` in `_schematicLayout.ts` to include hubs as nodes. For each hub in `state.hubs`: (1) Skip Earth hub (it's represented by the Earth body node). (2) Find the hub's parent body node in the layout. (3) Surface hubs: position as small square (radius 4) below the parent body, y = parent.y + parent.radius + 20. If multiple surface hubs on one body, fan horizontally with 25px spacing. Type = 'surfaceHub'. (4) Orbital hubs: position as small diamond (radius 5) to the upper-right of parent body, x = parent.x + parent.radius + 15, y = parent.y - 15. If multiple orbital hubs, fan vertically with 20px spacing. Type = 'orbitalHub'. (5) Set `hubId` field on hub nodes. (6) Set `parentId` to the body's ID. (7) Set `label` to hub name (truncated to 12 chars + "..."). Write unit tests verifying hub node positions relative to their parent body.
- **Verification**: `npx vitest run src/tests/logistics-layout.test.ts 2>/dev/null || npx vitest run src/tests/logistics.test.ts 2>/dev/null`

### TASK-029: Render hub nodes on SVG map
- **Status**: pending
- **Dependencies**: TASK-028
- **Description**: In `src/ui/logistics/_routeMap.ts`, update the SVG rendering to draw hub nodes from the layout. For each node with type 'surfaceHub': draw a small filled `<rect>` (6x6) at the node position, with a thin line connecting to the parent body. For each 'orbitalHub': draw a rotated `<rect>` (diamond shape, 8x8, transform rotate 45deg) with a dashed connecting line. Colors: use the parent body's CSS color. Online hubs: full opacity, solid border. Offline: 40% opacity, dashed border. Under construction: 60% opacity, dashed border. Draw hub name label in 8px text below/beside the icon. Hub nodes should have `cursor: pointer` and `data-hub-id` attributes for click handling.
- **Verification**: `npx tsc --noEmit src/ui/logistics/_routeMap.ts`

### TASK-030: Dynamic SVG viewBox and scrolling
- **Status**: pending
- **Dependencies**: TASK-027
- **Description**: In `_routeMap.ts`, update the SVG element creation to use a dynamic viewBox. The width comes from the layout's computed total width (from `computeSchematicLayout()`). Height stays ~220. Set the SVG viewBox attribute to `"0 0 {width} 220"`. In `src/ui/logistics.css` (or inline), ensure the SVG container has `overflow-x: auto` if the SVG width exceeds the panel width, and `overflow-y: hidden`. The SVG element itself should have `width: {computedWidth}px` (not 100%) and `height: 220px` so scrolling works correctly.
- **Verification**: `npx tsc --noEmit src/ui/logistics/_routeMap.ts`

### TASK-031: SVG route curves — replace straight lines with Bezier
- **Status**: pending
- **Dependencies**: TASK-027
- **Description**: In `_routeMap.ts`, update the route and proven leg rendering. Replace `<line>` elements with `<path>` elements using quadratic Bezier curves. For each route leg or proven leg: (1) Get origin and destination positions from the layout. (2) Compute midpoint. (3) Compute perpendicular offset direction (rotate line direction 90 degrees). (4) Control point = midpoint + perpendicular * 0.18 * distance. (5) Alternate offset direction per leg index (even legs curve in one direction, odd in the other) to prevent overlapping arcs. (6) Create `<path d="M x1,y1 Q cx,cy x2,y2">` with the same stroke styles as before (dashed for proven legs, solid for active routes, color by status). Give each path a unique ID (e.g. `route-leg-{index}`) for flow dot animation reference.
- **Verification**: `npx tsc --noEmit src/ui/logistics/_routeMap.ts`

### TASK-032: SVG animated flow dots on active routes
- **Status**: pending
- **Dependencies**: TASK-031
- **Description**: In `_routeMap.ts` and `logistics.css`, add animated flow indicators on active route legs. For each active route leg: (1) Create 3 `<circle>` elements (r=2.5, fill matching route color) inside the SVG. (2) Use CSS `offset-path` with `path()` matching the Bezier curve, or use `<animateMotion>` SVG element referencing the route path by ID. (3) Animate `offset-distance` from 0% to 100% over ~3 seconds, infinite loop. (4) Stagger the 3 dots at 0s, 1s, 2s delay. (5) Flow direction: origin to destination. Add the CSS keyframes in `logistics.css`: `@keyframes flowDot { from { offset-distance: 0% } to { offset-distance: 100% } }`. If using `<animateMotion>`, define it inline on each circle. Only show dots on active routes (not paused/broken/proven legs).
- **Verification**: `npx tsc --noEmit src/ui/logistics/_routeMap.ts`

---

## Phase F: Hub-to-Hub Routing

### TASK-033: Add hubId to RouteLocation interface
- **Status**: pending
- **Dependencies**: TASK-007
- **Description**: In `src/core/gameState.ts`, add `hubId: string | null` to the `RouteLocation` interface. This field identifies the specific hub at the route location, or null if no hub is associated. Update the `ProvenLeg` and `RouteLeg` types if they have their own location fields (they use `RouteLocation`). This will cause TypeScript errors where RouteLocation objects are created without `hubId` — subsequent tasks fix those.
- **Verification**: `npx tsc --noEmit src/core/gameState.ts`

### TASK-034: Update proven leg creation with hubId
- **Status**: pending
- **Dependencies**: TASK-033
- **Description**: In `src/core/routes.ts`, update `proveRouteLeg()`: (1) Accept hub IDs for origin and destination (either as new parameters or derived from the flight state + hub lookup using `getHubsOnBody()` and altitude/surface matching). (2) Set `hubId` on the origin and destination `RouteLocation` objects. If no hub exists at the location, set `hubId: null`. (3) Update the `ProveRouteLegParams` type to include optional hub IDs. (4) Update all callers of `proveRouteLeg()` to pass hub information (search for calls in flight controller or post-flight processing). Write unit tests: prove leg with hubs, prove leg without hubs (null), verify hubId is stored correctly.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-035: Update route creation with hub targets
- **Status**: pending
- **Dependencies**: TASK-034
- **Description**: In `src/core/routes.ts`, update `createRoute()`: (1) Route legs inherit `hubId` from their proven legs. (2) Add optional `hubId` overrides in `CreateRouteParams` so the route builder can assign specific hubs. (3) Validation: if a leg references a `hubId` that doesn't exist in `state.hubs`, reject route creation with an error. (4) Update `calculateRouteThroughput()` if it needs hub context (likely unchanged). Write unit tests: create route with hub targets, hub override on leg, invalid hubId rejected.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-036: Update route processing for hub-targeted delivery
- **Status**: pending
- **Dependencies**: TASK-035
- **Description**: In `src/core/routes.ts`, update `processRoutes()`: (1) Source resolution: find mining site on the source hub's body (use `route.legs[0].origin.bodyId`). Read from orbital buffer as before. (2) Destination: if destination hubId refers to Earth hub, sell at market (unchanged). If off-world hub, deposit into the orbital buffer of the mining site on the destination body. (3) Add safety check: if any leg references a hubId not found in `state.hubs`, mark route as `broken` and skip. (4) The existing `routeConnectsBodies()` helper in hubCrew.ts should continue to work since it checks bodyId on legs, not hubId. Write unit tests: delivery to off-world hub, delivery to Earth hub, broken route on missing hub.
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-037: Fix all remaining RouteLocation creation sites
- **Status**: pending
- **Dependencies**: TASK-033
- **Description**: Grep the entire codebase for places where `RouteLocation` objects are created (object literals with `bodyId` and `locationType` fields). Add `hubId: null` (or the appropriate hub ID) to each. Key files: `src/core/routes.ts` (already handled in TASK-034/035), `src/ui/logistics/_routeBuilder.ts`, any E2E or unit test factories that create proven legs or routes. This is a mechanical task — find every creation site and add the missing field.
- **Verification**: `npx tsc --noEmit`

### TASK-038: Route builder hub interaction on SVG map
- **Status**: pending
- **Dependencies**: TASK-029, TASK-037
- **Description**: In `src/ui/logistics/_routeBuilder.ts`, update builder mode to handle hub clicks: (1) Hub nodes on the SVG map (from TASK-029) are clickable in builder mode. Clicking a hub sets it as the route origin or extends the route. (2) When a body with exactly one hub is clicked, auto-select that hub. (3) When a body with multiple hubs is clicked, show a small popover/tooltip listing the hub names. Player clicks one to select. Implement the popover as an absolutely positioned div near the click location, with hub names as buttons. (4) When a body with no hubs is clicked, set `hubId: null` on the route endpoint. (5) Resource type dropdown: after selecting a source, filter to resources available in the orbital buffer of the source body's mining sites.
- **Verification**: `npx tsc --noEmit src/ui/logistics/_routeBuilder.ts`

### TASK-039: Route table hub name display
- **Status**: pending
- **Dependencies**: TASK-035
- **Description**: In `src/ui/logistics/_routeTable.ts`, update the route table rendering. When displaying route leg origins and destinations: if the leg's `hubId` is non-null, look up the hub name from `state.hubs` and display as "{hubName} ({bodyName}, {locationType})" — e.g. "Apollo Outpost (Moon, surface)". If `hubId` is null, display as before: "{bodyName} ({locationType})". Also update the route summary row if it shows origin/destination.
- **Verification**: `npx tsc --noEmit src/ui/logistics/_routeTable.ts`

---

## Phase G: Code-Splitting

### TASK-040: Audit screen entry points for code-splitting readiness
- **Status**: pending
- **Dependencies**: none
- **Description**: Audit each screen module's imports for circular dependencies or side effects that would prevent lazy loading. Check: `src/ui/vab/index.ts`, `src/ui/flightController/index.ts`, `src/ui/logistics/index.ts`, `src/ui/missionControl/index.ts`, `src/ui/crewAdmin.ts`, `src/render/vab.js`, `src/render/flight.js`, `src/render/map.ts`. For each, verify: (a) the module doesn't have import side effects (top-level DOM manipulation or event listener registration that runs on import), (b) no circular imports between the screen and the main entry point. Document any issues found. Fix any side effects by moving them inside the screen's `show*()` function (lazy initialization). This task is research + minor fixes only.
- **Verification**: `npx tsc --noEmit`

### TASK-041: Create loading indicator component
- **Status**: pending
- **Dependencies**: none
- **Description**: Create `src/ui/loadingIndicator.ts`. Export `showLoadingIndicator()` and `hideLoadingIndicator()`. The indicator is a full-screen overlay (position: fixed, z-index above game canvas but below dialogs) with a centered "Loading..." text. Dark semi-transparent background matching the game's theme. The text should use the game's standard font. Keep it minimal — no spinner animation needed, just text. Add corresponding CSS in the main stylesheet or inline.
- **Verification**: `npx tsc --noEmit src/ui/loadingIndicator.ts`

### TASK-042: Convert screen navigation to dynamic imports
- **Status**: pending
- **Dependencies**: TASK-040, TASK-041
- **Description**: Find the screen switching/navigation function (grep for how screens are shown — likely a central router or switch statement that calls `showVAB()`, `showFlight()`, etc.). Convert each screen's static import to a dynamic import pattern: `async function navigateToX() { showLoadingIndicator(); const { showX } = await import('./path'); hideLoadingIndicator(); showX(); }`. Screens to convert: VAB, flight controller, logistics, mission control, crew admin. The hub screen stays statically imported (it's the default screen). Ensure error handling: if dynamic import fails, hide loading indicator and show error notification. Associated render modules (render/vab, render/flight, render/map) should be imported by their UI screen module, not separately by the router.
- **Verification**: `npm run build && ls -la dist/assets/*.js | wc -l` (should show multiple JS chunks, not just one)

### TASK-043: Configure Vite manual chunks
- **Status**: pending
- **Dependencies**: TASK-042
- **Description**: In `vite.config.ts`, add `build.rollupOptions.output.manualChunks` configuration. Define chunks: `'vendor-pixi'` for pixi.js, `'core-hubs'` for hubs/hubCrew/hubTourists/hubTypes, `'core-mining'` for mining/refinery, `'core-routes'` for routes, `'core-physics'` for physics/orbit, `'data-catalogs'` for all src/data/ modules. Use the function form of `manualChunks` if the array form doesn't resolve paths correctly: `manualChunks(id) { if (id.includes('pixi.js')) return 'vendor-pixi'; ... }`. Run `npm run build` and verify the output contains the expected chunk files.
- **Verification**: `npm run build 2>&1 | tail -20`

### TASK-044: Add idle preloading of adjacent screens
- **Status**: pending
- **Dependencies**: TASK-042
- **Description**: In the hub screen initialization code (after the hub screen is displayed), add idle-time preloading of the most common next screens. Use `requestIdleCallback` (or `setTimeout` as fallback) to trigger `import('./ui/vab/index.ts')` and `import('./ui/missionControl/index.ts')`. These dynamic imports run in the background — the returned promise is intentionally not awaited. This primes the module cache so the first navigation to these screens is instant. Don't preload ALL screens — just the 2-3 most common next transitions from the hub.
- **Verification**: `npm run build`

---

## Phase H: Test Coverage — All Identified Gaps

### Unit Test Gaps

### TASK-045: Unit test — hub with zero facilities
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: In `src/tests/hubs.test.ts` (or `hubs-edge-cases.test.ts`), add tests for a hub with zero facilities: (1) `getActiveHub()` returns the hub correctly. (2) `calculateHubMaintenance()` returns 0 (no facilities = no maintenance). (3) `hasFacility(state, anyFacilityId)` returns false. (4) `getFacilityTier(state, anyFacilityId)` returns 0. (5) `getHubManagementInfo()` returns empty facilities array. Create the hub using `makeHub()` factory with `facilities: {}`.
- **Verification**: `npx vitest run src/tests/hubs.test.ts`

### TASK-046: Unit test — tourist revenue edge cases
- **Status**: pending
- **Dependencies**: TASK-003
- **Description**: In `src/tests/hubs-tourists.test.ts`, add tests: (1) Tourist with `revenue = 0` — verify `processTouristRevenue()` doesn't error and credits $0. (2) Tourist where `departurePeriod === currentPeriod` — verify revenue IS credited this period, tourist IS kept this period, and removed next period. (3) Multiple tourists departing same period — verify all get revenue credited before removal.
- **Verification**: `npx vitest run src/tests/hubs-tourists.test.ts`

### TASK-047: Unit test — construction project lifecycle edge cases
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: In `src/tests/hubs-construction.test.ts`, add tests: (1) Construction project with zero resources required — verify it completes immediately on next `processConstructionProjects()` call. (2) Project with all resources already delivered — verify it completes. (3) Project with partial delivery — verify it doesn't complete, resources are tracked correctly. (4) Multiple projects in queue — verify they process in order (FIFO).
- **Verification**: `npx vitest run src/tests/hubs-construction.test.ts`

### TASK-048: Unit test — hub name generation
- **Status**: pending
- **Dependencies**: TASK-017
- **Description**: In `src/tests/hubs.test.ts`, add dedicated tests for `generateHubName()`: (1) Returns a name from the pool. (2) Surface hub gets " Outpost" suffix. (3) Orbital hub gets " Station" suffix. (4) Name not already used by existing hubs. (5) When 3 names are used, those 3 are excluded from selection. (6) Fallback to "Hub-N" when pool is exhausted (create a state with hubs using every name in the pool).
- **Verification**: `npx vitest run src/tests/hubs.test.ts`

### TASK-049: Unit test — hub rename and abandonment
- **Status**: pending
- **Dependencies**: TASK-019
- **Description**: In `src/tests/hubs.test.ts`, add tests for: **Rename:** (1) Valid rename succeeds, name updated. (2) Duplicate name (case-insensitive) rejected. (3) Empty name rejected. (4) Name > 40 chars rejected. (5) Earth hub can be renamed. **Abandon:** (1) Cannot abandon online hub. (2) Cannot abandon Earth hub. (3) Offline hub abandonment: crew evacuated with transit delay. (4) Tourists evicted. (5) Routes with matching hubId marked broken. (6) Hub removed from state.hubs. (7) activeHubId switches to Earth if abandoned hub was active.
- **Verification**: `npx vitest run src/tests/hubs.test.ts`

### TASK-050: Unit test — RouteLocation hubId integration
- **Status**: pending
- **Dependencies**: TASK-036
- **Description**: In `src/tests/routes.test.ts`, add tests for hub-to-hub routing: (1) `proveRouteLeg()` with hub IDs — verify hubId stored on origin and destination. (2) `proveRouteLeg()` without hubs — verify hubId is null. (3) `createRoute()` with hub targets — verify leg hubIds match. (4) `createRoute()` with invalid hubId — verify rejection. (5) `processRoutes()` delivers to correct destination — off-world hub deposits to orbital buffer, Earth hub sells at market. (6) Route broken when referencing abandoned hub (hubId not in state.hubs).
- **Verification**: `npx vitest run src/tests/routes.test.ts`

### TASK-051: Unit test — Mk2 storage integration
- **Status**: pending
- **Dependencies**: TASK-025
- **Description**: This is a follow-up to TASK-025 if additional tests are needed. Verify: (1) A mining site with only Mk2 storage modules works correctly end-to-end (extraction + storage + launch pad). (2) Mixed Mk1 + Mk2 site: extraction fills Mk1 first (or proportionally — verify actual behaviour). (3) Refinery with Mk2 input/output storage — correct throughput. (4) `recomputeSiteStorage()` aggregates correctly across Mk1 and Mk2 modules.
- **Verification**: `npx vitest run src/tests/mining.test.ts`

### TASK-052: Unit test — dynamic schematic layout
- **Status**: pending
- **Dependencies**: TASK-028
- **Description**: In a new `src/tests/logistics-layout.test.ts`, test `computeSchematicLayout()`: (1) Minimal state (just Earth) — Sun and Earth present, correct positions. (2) State with Moon mining site — Moon appears as child of Earth. (3) State with Mars hub — Mars appears, hub node positioned relative to Mars. (4) Multiple moons (e.g. Moon + Titan) — each positioned relative to their parent. (5) Multiple hubs on one body — fanned out correctly. (6) Body with no activity not shown (except Earth). (7) ViewBox width computed correctly for varying numbers of bodies.
- **Verification**: `npx vitest run src/tests/logistics-layout.test.ts`

### TASK-053: Unit test — incompatible save rejection
- **Status**: pending
- **Dependencies**: TASK-005
- **Description**: In `src/tests/saveload.test.ts`, add tests: (1) Save with current `SAVE_VERSION` loads successfully. (2) Save with `SAVE_VERSION - 1` is rejected with an incompatible error. (3) Save with `SAVE_VERSION + 1` (future version) is also rejected. (4) Save with no version field is rejected. (5) Verify the error result contains a clear message.
- **Verification**: `npx vitest run src/tests/saveload.test.ts`

### TASK-054: Unit test — body color CSS helper
- **Status**: pending
- **Dependencies**: TASK-004
- **Description**: In `src/tests/logistics.test.ts` (or a new file), test the body color helper function. Since unit tests run in Node.js (no DOM), the helper should fall back to the default color. Test: (1) Calling with 'earth' returns the fallback (no DOM in test env). (2) Verify the function signature accepts any bodyId string. If the helper can be tested with a mock DOM (jsdom), test that it reads CSS custom properties correctly. Otherwise, document that the fallback path is the one tested.
- **Verification**: `npx vitest run src/tests/logistics.test.ts 2>/dev/null`

### E2E Test Gaps

### TASK-055: E2E — multi-leg route builder flow
- **Status**: pending
- **Dependencies**: TASK-038
- **Description**: In `e2e/route-interactions.spec.ts` (or new file), add a test: (1) Seed a save with 2+ proven legs forming a chain, e.g. Earth→Moon and Moon→Mars. (2) Open the Logistics Center, navigate to the Routes tab. (3) Click "Create Route" to enter builder mode. (4) Select a resource type. (5) Click the Earth hub on the SVG map as origin. (6) Click the proven leg to Moon. (7) Click the proven leg to Mars. (8) Click "Confirm". (9) Verify a new route appears in the route table with 2 legs. (10) Verify the route shows the correct origin (Earth) and destination (Mars) hub names.
- **Verification**: `npx playwright test e2e/route-interactions.spec.ts --reporter=line`

### TASK-056: E2E — hub maintenance causing offline
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: In a new `e2e/hub-economy.spec.ts`, add a test: (1) Seed a save with an off-world hub (online, with maintenance cost > 0), crew stationed there, and player money set to $0. (2) Navigate to trigger period advance (or use a helper to advance period). (3) Verify the hub status in the hub switcher shows "Offline". (4) Verify crew were evacuated (check crew admin or hub management panel). Tag one test `@smoke`.
- **Verification**: `npx playwright test e2e/hub-economy.spec.ts --reporter=line`

### TASK-057: E2E — tourist revenue in period summary
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: In `e2e/hub-economy.spec.ts`, add a test: (1) Seed a save with a hub that has tourists generating revenue (e.g. 2 tourists at $5000/period each). (2) Record player money. (3) Advance one period. (4) Check the period summary display for tourist revenue line. (5) Verify player money increased by the expected tourist revenue amount (minus any costs).
- **Verification**: `npx playwright test e2e/hub-economy.spec.ts --reporter=line`

### TASK-058: E2E — outpost core deployment via flight
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: In a new `e2e/hub-deployment.spec.ts`, add a test: (1) Seed a save with a rocket containing an Outpost Core part, positioned as landed on the Moon (flight state with landed=true, bodyId='MOON'). (2) Activate the Outpost Core part (click the activation button or use keyboard shortcut). (3) Verify a deployment dialog/prompt appears. (4) Accept the deployment. (5) Verify the hub switcher now shows a new hub with a Moon location. (6) Verify the new hub name follows the auto-suggestion pattern (ends with " Outpost"). Tag `@smoke`.
- **Verification**: `npx playwright test e2e/hub-deployment.spec.ts --reporter=line`

### TASK-059: E2E — hub reactivation
- **Status**: pending
- **Dependencies**: TASK-022
- **Description**: In `e2e/hub-economy.spec.ts`, add a test: (1) Seed a save with an offline off-world hub and sufficient player money (> 1 period's maintenance cost). (2) Open the hub management panel for the offline hub. (3) Click the "Reactivate" button. (4) Confirm the dialog. (5) Verify the hub status changes to "Online". (6) Verify player money decreased by the maintenance cost.
- **Verification**: `npx playwright test e2e/hub-economy.spec.ts --reporter=line`

### TASK-060: E2E — hub management panel display and rename
- **Status**: pending
- **Dependencies**: TASK-023
- **Description**: In a new `e2e/hub-management.spec.ts`, add tests: (1) Open the hub management panel from the hub switcher. (2) Verify all fields display for Earth hub: name, body "Earth", type "Surface", status "Online", facilities list, crew count, maintenance "$0". (3) Edit the hub name to "Mission HQ". (4) Verify the hub switcher dropdown updates to show "Mission HQ". (5) Try renaming to a duplicate name (create another hub with that name in the seed) — verify error. Tag one test `@smoke`.
- **Verification**: `npx playwright test e2e/hub-management.spec.ts --reporter=line`

### TASK-061: E2E — hub abandonment
- **Status**: pending
- **Dependencies**: TASK-023
- **Description**: In `e2e/hub-management.spec.ts`, add a test: (1) Seed a save with an offline off-world hub. (2) Open the hub management panel for that hub. (3) Click "Abandon Hub". (4) Confirm the warning dialog. (5) Verify the hub is removed from the hub switcher dropdown. (6) Verify active hub switched back to Earth.
- **Verification**: `npx playwright test e2e/hub-management.spec.ts --reporter=line`

### TASK-062: E2E — hub name auto-suggestion
- **Status**: pending
- **Dependencies**: TASK-058
- **Description**: In `e2e/hub-deployment.spec.ts`, add a test that verifies the auto-suggested name: (1) Seed a save with no off-world hubs (only Earth). (2) Deploy an outpost (reuse setup from TASK-058). (3) Verify the new hub's name matches the pattern: a name from the space history catalog followed by " Outpost" (surface) or " Station" (orbital). (4) Verify the name is not "Hub-1" (pool shouldn't be exhausted with only Earth hub).
- **Verification**: `npx playwright test e2e/hub-deployment.spec.ts --reporter=line`

### TASK-063: E2E — Mk2 storage in mining site
- **Status**: pending
- **Dependencies**: TASK-024
- **Description**: In `e2e/mining.spec.ts` (or new file), add a test: (1) Seed a save with a mining site. (2) Navigate to the mining site management screen. (3) Add a Storage Silo Mk2 module. (4) Verify the module appears in the site's module list with capacity "5,000 kg" (or however capacity is displayed). (5) Verify it's distinguishable from the Mk1 version.
- **Verification**: `npx playwright test e2e/mining.spec.ts --reporter=line`

### TASK-064: E2E — SVG dynamic layout with multiple bodies
- **Status**: pending
- **Dependencies**: TASK-030
- **Description**: In `e2e/logistics.spec.ts` (or new file), add a test: (1) Seed a save with mining sites on Earth, Moon, and Mars. (2) Open the Logistics Center. (3) Verify the SVG map contains circle elements for Sun, Earth, Moon, and Mars. (4) Verify Moon is positioned near Earth (as a child node). (5) Verify bodies without activity (e.g. Jupiter) are NOT shown. Tag `@smoke`.
- **Verification**: `npx playwright test e2e/logistics.spec.ts --reporter=line`

### TASK-065: E2E — hub nodes on SVG map
- **Status**: pending
- **Dependencies**: TASK-029
- **Description**: In `e2e/logistics.spec.ts`, add a test: (1) Seed a save with an off-world hub on the Moon (surface). (2) Open the Logistics Center. (3) Verify the SVG map shows a hub node near the Moon body. (4) Verify the hub node has the hub's name as a label. (5) Verify an online hub appears at full opacity and an offline hub at reduced opacity (seed a second offline hub).
- **Verification**: `npx playwright test e2e/logistics.spec.ts --reporter=line`

### TASK-066: E2E — hub-to-hub route creation
- **Status**: pending
- **Dependencies**: TASK-038
- **Description**: In `e2e/route-interactions.spec.ts`, add a test: (1) Seed a save with hubs on Earth and Moon, plus a proven leg between them (with hubId fields set). (2) Open the Logistics Center, Routes tab. (3) Click "Create Route". (4) Select a resource type. (5) Click the Earth hub node on the SVG map. (6) Click the proven leg to Moon. (7) Confirm the route. (8) Verify the route table shows the Earth hub name and Moon hub name as endpoints (not just "Earth" and "Moon"). Tag `@smoke`.
- **Verification**: `npx playwright test e2e/route-interactions.spec.ts --reporter=line`

### TASK-067: E2E — incompatible save slot display
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: In `e2e/save-load.spec.ts` (or new file), add a test: (1) Seed localStorage with a save in an old format (version = current SAVE_VERSION - 1). (2) Open the save/load dialog. (3) Verify the save slot shows the save name but is visually grayed out. (4) Verify "(Incompatible)" text is displayed. (5) Verify the Load button is disabled for that slot.
- **Verification**: `npx playwright test e2e/save-load.spec.ts --reporter=line`

### TASK-068: E2E — code-splitting screen navigation
- **Status**: pending
- **Dependencies**: TASK-042
- **Description**: In `e2e/navigation.spec.ts` (or new file), add a test that navigates between all screens and verifies each loads correctly: (1) Start at hub screen. (2) Navigate to VAB — verify VAB elements visible. (3) Return to hub. (4) Navigate to Mission Control — verify MC elements visible. (5) Return to hub. (6) Navigate to Crew Admin — verify crew list visible. (7) Return to hub. (8) Navigate to Logistics — verify logistics panel visible. This tests that dynamic imports work correctly in the built game. Tag `@smoke`.
- **Verification**: `npx playwright test e2e/navigation.spec.ts --reporter=line`

### Integration Tests

### TASK-069: Integration test — full off-world pipeline
- **Status**: pending
- **Dependencies**: TASK-036, TASK-019
- **Description**: In `src/tests/hubs-integration.test.ts` (new file), write a comprehensive integration test: (1) Create game state with Earth hub. (2) Create an off-world surface hub on the Moon (via `createHub()`). (3) Deliver construction resources to complete the Crew Hab (call `deliverResources()` then `processConstructionProjects()`). (4) Verify hub comes online. (5) Hire crew at the hub (via `hireCrewAtHub()`), verify import tax applied. (6) Advance multiple periods. (7) Verify crew salary deducted, hub maintenance deducted, hub stays online. (8) Verify crew transit delay clears after correct number of periods.
- **Verification**: `npx vitest run src/tests/hubs-integration.test.ts`

### TASK-070: Integration test — hub offline cascade
- **Status**: pending
- **Dependencies**: TASK-036, TASK-019
- **Description**: In `src/tests/hubs-integration.test.ts`, add a test: (1) Create state with an online off-world hub, 2 crew stationed there, 3 tourists, money set to $0. (2) Call `advancePeriod()` (or the individual processing functions in order). (3) Verify in a single period: maintenance fails (money < cost), hub goes offline, crew `stationedHubId` changed to Earth with transit delay, tourists array emptied. (4) Verify the order: maintenance → offline → evacuation → tourist eviction all happen in one period call.
- **Verification**: `npx vitest run src/tests/hubs-integration.test.ts`

---

## Phase I: Final Verification & Cleanup

### TASK-071: Update test-map.json for new files
- **Status**: pending
- **Dependencies**: TASK-052, TASK-069, TASK-070
- **Description**: Update `test-map.json` to map new source files to their relevant test files. Add entries for: `src/data/hubNames.ts` → `hubs.test.ts`, `src/ui/hubManagement.ts` → `hub-management.spec.ts`, `src/ui/logistics/_schematicLayout.ts` → `logistics-layout.test.ts`, `src/ui/loadingIndicator.ts` → `navigation.spec.ts`. Also add entries for any new E2E spec files. Review existing entries and update any that changed due to the Earth hub migration.
- **Verification**: `node scripts/run-affected.mjs --dry-run 2>&1 | head -20`

### TASK-072: Tag smoke tests in new test files
- **Status**: pending
- **Dependencies**: TASK-055, TASK-056, TASK-057, TASK-058, TASK-059, TASK-060, TASK-061, TASK-062, TASK-063, TASK-064, TASK-065, TASK-066, TASK-067, TASK-068, TASK-069, TASK-070
- **Description**: Review all new test files created in this iteration. Ensure 1-2 representative tests per file are tagged with `@smoke` in their description. Priority for smoke tags: hub management panel display, hub abandonment, multi-leg route builder, SVG dynamic layout, code-splitting navigation, off-world pipeline integration. Check that existing smoke tests in modified files still make sense.
- **Verification**: `npx vitest run --testNamePattern "@smoke" 2>&1 | tail -5`

### TASK-073: Full typecheck and lint pass
- **Status**: pending
- **Dependencies**: TASK-015, TASK-037, TASK-043
- **Description**: Run `npx tsc --noEmit` across the full project. Fix any remaining TypeScript errors. Run `npx eslint src/` and fix any errors (warnings in coverage/ are OK to ignore). This is the final quality gate before the E2E test verification.
- **Verification**: `npx tsc --noEmit && npx eslint src/ --max-warnings=10`

### TASK-074: Smoke test verification
- **Status**: pending
- **Dependencies**: TASK-072, TASK-073
- **Description**: Run the full smoke test suite (unit + E2E) to verify all critical paths work. Fix any failures. This is the final verification step.
- **Verification**: `npm run test:smoke:unit && npm run test:smoke:e2e`
