# Iteration 14 — Tasks

Full requirements: `.devloop/requirements.md`
Design spec: `docs/superpowers/specs/2026-04-15-iteration-14-design.md`
Implementation plan: `docs/superpowers/plans/2026-04-15-iteration-14.md`

---

### TASK-001: Fix lint warnings in destinations.spec.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Remove unused imports `pressStage` and `pressThrottleUp` from `e2e/destinations.spec.ts:32-33`. These are imported from `./helpers.js` but never referenced in the test file. See implementation plan Task 1 for exact code.
- **Verification**: `npx eslint e2e/destinations.spec.ts` — 0 errors, 0 warnings.

### TASK-002: Document altitude non-check in validateLegChaining
- **Status**: done
- **Dependencies**: none
- **Description**: Add a JSDoc comment above `validateLegChaining` in `src/core/routes.ts:104` explaining that altitude is intentionally not checked because route legs connect bodies and location types, not specific orbits. See implementation plan Task 2 for exact comment text.
- **Verification**: `npx tsc --noEmit src/core/routes.ts` — 0 errors.

### TASK-003: Install jsdom and un-skip loading indicator tests
- **Status**: done
- **Dependencies**: none
- **Description**: Install `jsdom` as a devDependency. Add `// @vitest-environment jsdom` at the top of `src/tests/ui-helpers.test.ts`. Replace the `describe.skip` block (lines 206-234) with working tests that use dynamic `import()` for the loading indicator module. The 4 tests verify: show adds overlay to body, show is idempotent, hide sets display to none, hide doesn't throw when nothing shown. Each test needs a `beforeEach` that cleans up leftover overlays. See implementation plan Task 3 for exact test code.
- **Verification**: `npx vitest run src/tests/ui-helpers.test.ts` — all tests pass including the 4 previously skipped ones.

### TASK-004: Extract loadScreen() helper and notification utility
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/ui/notification.ts` with an exported `showNotification(message, type)` function that creates a brief DOM toast overlay (styled div, auto-removes after 4 seconds). Then in `src/ui/index.ts`, import `showNotification` and add an async `loadScreen<T>(importFn, screenName)` helper that wraps dynamic imports in try/catch — on failure it hides the loading indicator, shows a notification, logs to console, and returns null. Replace all 9 catch blocks in `_handleNavigation` with `loadScreen()` calls. If the import returns null, abort navigation for that screen. See implementation plan Task 4 for exact code.
- **Verification**: `npx tsc --noEmit src/ui/index.ts src/ui/notification.ts && npx eslint src/ui/index.ts src/ui/notification.ts` — 0 errors.

### TASK-005: Add 15 sequential ID counter fields to GameState
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/gameState.ts`, add 15 new number fields to the `GameState` interface (after `nextHubId`): `nextContractId`, `nextChallengeId`, `nextDesignId`, `nextFlightResultId`, `nextAsteroidId`, `nextCrewId`, `nextFieldCraftId`, `nextMiningSiteId`, `nextMiningModuleId`, `nextInventoryId`, `nextRouteId`, `nextRouteLegId`, `nextProvenLegId`, `nextSatelliteId`, `nextSurfaceOpId`. All initialize to `1` in `createGameState()`. Also bump `SAVE_VERSION` from 5 to 6 in `src/core/saveload.ts:40`. See implementation plan Task 5 for exact code.
- **Verification**: `npx tsc --noEmit src/core/gameState.ts src/core/saveload.ts` — may show errors in factory files (expected, fixed in TASK-006).

### TASK-006: Update test factories for new counter fields
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: In `src/tests/_factories.ts`, add all 15 `next*Id` fields (each set to `1`) to the `makeGameState()` return object, before the `...overrides` spread. In `e2e/helpers/_saveFactory.ts`, add 15 param destructurings with `?? 1` defaults (after `nextHubId`), include them in the return state object, and update the version default from 5 to 6. See implementation plan Task 6 for exact code.
- **Verification**: `npx tsc --noEmit src/tests/_factories.ts e2e/helpers/_saveFactory.ts` — 0 errors.

### TASK-007: Migrate ID generators batch 1 (contracts, challenges, designs, flights, asteroids)
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Migrate 5 files to sequential counters. In each file, delete the old `_generateId()` function (or inline Date.now expression) and replace call sites with the counter pattern `\`prefix-${state.nextPrefixId++}\``. Files: (1) `src/core/contracts.ts:81-84` — delete `_generateId()`, use `\`contract-${state.nextContractId++}\``. (2) `src/core/customChallenges.ts:192-194` — delete `_generateId()`, use `\`custom-${state.nextChallengeId++}\``. (3) `src/core/designLibrary.ts:171` — replace inline ID in `duplicateDesign()` with `\`design-${state.nextDesignId++}\``; add `state: GameState` parameter to `duplicateDesign()` signature and update all callers. (4) `src/core/flightReturn.ts:314-317` — delete `_generateId()`, use `\`flight-${state.nextFlightResultId++}\``. (5) `src/core/grabbing.ts:462` — replace `AST-P-${asteroid.id}-${Date.now()}` with `\`AST-P-${state.nextAsteroidId++}\``. See implementation plan Task 7 steps 1-5 for details.
- **Verification**: `npx tsc --noEmit src/core/contracts.ts src/core/customChallenges.ts src/core/designLibrary.ts src/core/flightReturn.ts src/core/grabbing.ts` — 0 errors.

### TASK-007a: Migrate ID generators batch 2 (crew, life support, mining, inventory)
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Migrate 4 files to sequential counters. (1) `src/core/hubCrew.ts:116` — replace `'crew-' + Date.now() + ...` with `\`crew-${state.nextCrewId++}\``. (2) `src/core/lifeSupport.ts:220-225` — delete `_generateId()`, use `\`fc-${state.nextFieldCraftId++}\``. (3) `src/core/mining.ts:37-42` — delete `generateSiteId()`, use `\`mining-site-${state.nextMiningSiteId++}\``. Also delete `generateModuleId()` (lines 113-118), use `\`module-${state.nextMiningModuleId++}\``. (4) `src/core/partInventory.ts:73-78` — delete `_generateId()`, use `\`inv-${state.nextInventoryId++}\``. See implementation plan Task 7 steps 6-9 for details.
- **Verification**: `npx tsc --noEmit src/core/hubCrew.ts src/core/lifeSupport.ts src/core/mining.ts src/core/partInventory.ts` — 0 errors.

### TASK-007b: Migrate ID generators batch 3 (routes, satellites, surfaceOps)
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: Migrate 3 files to sequential counters. (1) `src/core/routes.ts` — replace proven leg ID at line 44 with `\`proven-leg-${state.nextProvenLegId++}\``. Delete `generateRouteId()` (lines 145-147), use `\`route-${state.nextRouteId++}\``. Delete `generateRouteLegId()` (lines 149-151), use `\`route-leg-${state.nextRouteLegId++}\``. (2) `src/core/satellites.ts:123` — replace with `\`sat-${state.nextSatelliteId++}\``. Note: the next line `const orbObjId = 'orb-' + satId;` is unchanged. (3) `src/core/surfaceOps.ts` — delete module-level `let _nextId = 1;` (line 54) and `_generateId()` (lines 57-59), use `\`surface-${state.nextSurfaceOpId++}\``. After all migrations, verify no `Date.now()` ID patterns remain: `grep -rn "Date.now()" src/core/ --include="*.ts"` should show no ID generation patterns. See implementation plan Task 7 steps 10-13.
- **Verification**: `npx tsc --noEmit src/core/routes.ts src/core/satellites.ts src/core/surfaceOps.ts && npx eslint src/core/` — 0 errors.

### TASK-008: Fix tests broken by ID format changes
- **Status**: done
- **Dependencies**: TASK-006, TASK-007, TASK-007a, TASK-007b
- **Description**: Search all test files for assertions that match old ID formats (regex patterns like `route-\d+-\w+`, hardcoded IDs with timestamps, references to `Date.now` or `randomUUID` in test assertions). Update them to match the new `prefix-N` format. Common changes: `expect(id).toMatch(/^route-\d+-\w+$/)` → `expect(id).toMatch(/^route-\d+$/)`. Prefix-only checks like `expect(id).toMatch(/^contract-/)` still work. Run `grep -rn "Date.now\|randomUUID\|Math.random.*toString.36" src/tests/ e2e/ --include="*.ts" --include="*.js"` to find all instances. See implementation plan Task 8.
- **Verification**: `npm run test:unit` — all unit tests pass.

### TASK-009: Create shared mapGeometry module with tests
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/core/mapGeometry.ts` — a pure math module with no DOM dependencies. Exports: `BEZIER_OFFSET_FACTOR` (0.18), `bezierControlPoint(x1,y1,x2,y2,legIndex)` returning `{cx,cy}`, `evalQuadBezier(x1,y1,cx,cy,x2,y2,t)` returning `{x,y}`, `BODY_COLORS` record, `DEFAULT_BODY_COLOR`, `getBodyColorHex(bodyId)`, `getBodyColorNum(bodyId)`, `ROUTE_STATUS_COLORS` with active/paused/broken each having `{hex,num}`. Create `src/tests/mapGeometry.test.ts` with tests covering: Bézier control point math (horizontal, diagonal, zero-distance, alternating direction), evalQuadBezier (t=0, t=0.5, t=1), body color lookup (known body, unknown body, case-insensitive, hex/num consistency), route status colors (all 3 present, hex/num consistent). Tag key tests with `@smoke`. See implementation plan Task 9 for exact code.
- **Verification**: `npx vitest run src/tests/mapGeometry.test.ts` — all tests pass.

### TASK-010: Wire SVG logistics map to shared mapGeometry
- **Status**: done
- **Dependencies**: TASK-009
- **Description**: In `src/ui/logistics/_routeMap.ts`: (1) Import `bezierControlPoint`, `getBodyColorHex`, `ROUTE_STATUS_COLORS` from `../../core/mapGeometry.ts`. (2) Delete the local `getBodyColor()` function (lines 32-38). Replace all calls to `getBodyColor(bodyId)` with `getBodyColorHex(bodyId)`. If `getBodyColor` is exported and imported by other files, add a re-export alias or update callers. (3) Delete the local `bezierPath()` function (lines 74-92). At each call site, use `bezierControlPoint()` to get the control point and build the SVG path string inline: `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`. (4) Replace hardcoded route status color strings (around lines 401-407) with `ROUTE_STATUS_COLORS[status].hex`. For paused routes, set SVG `opacity` attribute to `0.4` instead of using `rgba()`. (5) In `src/ui/logistics/logistics.css`, delete the `:root` block with `--body-color-*` custom properties (lines 6-16). Verify no other CSS rules reference these variables. See implementation plan Task 10 steps 1-5.
- **Verification**: `npx tsc --noEmit src/ui/logistics/_routeMap.ts && npx vitest run src/tests/logistics.test.ts src/tests/logistics-layout.test.ts` — 0 errors, all tests pass.

### TASK-010a: Wire PixiJS flight map to shared mapGeometry
- **Status**: done
- **Dependencies**: TASK-009
- **Description**: In `src/render/map.ts`: (1) Import `bezierControlPoint`, `evalQuadBezier`, `getBodyColorNum`, `ROUTE_STATUS_COLORS` from `../core/mapGeometry.ts`. (2) Delete local constants: `ROUTE_ACTIVE_COLOR` (line 1715), `ROUTE_PAUSED_COLOR` (line 1716), `ROUTE_BROKEN_COLOR` (line 1717), `BEZIER_OFFSET_FACTOR` (line 1721). Keep `PROVEN_LEG_COLOR` — it's render-specific. (3) Delete local functions `_bezierControlPoint()` (lines 1755-1777) and `_evalQuadBezier()` (lines 1782-1793). (4) Update all call sites: replace `_bezierControlPoint(ox,oy,dx,dy,i)` with `bezierControlPoint(ox,oy,dx,dy,i)` — note return property rename from `{cpx,cpy}` to `{cx,cy}`, use destructuring rename `{cx:cpx, cy:cpy}` or update all downstream references. Replace `_evalQuadBezier()` calls with `evalQuadBezier()`. (5) Replace route color references: `ROUTE_ACTIVE_COLOR` → `ROUTE_STATUS_COLORS.active.num`, `ROUTE_PAUSED_COLOR` → `ROUTE_STATUS_COLORS.paused.num`, `ROUTE_BROKEN_COLOR` → `ROUTE_STATUS_COLORS.broken.num`. See implementation plan Task 10 steps 6-8.
- **Verification**: `npx tsc --noEmit src/render/map.ts && npx eslint src/render/map.ts` — 0 errors.

### TASK-011: Update listSaves() for dynamic slot discovery
- **Status**: done
- **Dependencies**: TASK-005
- **Description**: In `src/core/saveload.ts`: (1) Add `storageKey: string` field to `SaveSlotSummary` interface. (2) Update `summaryFromEnvelope()` to accept and pass through a `storageKey` parameter. (3) Rewrite `listSaves()` to: first scan slots 0-4 (always included, null for empty), then scan slots 5-99 and the `spaceAgencySave_auto` key (only include if populated, with slotIndex=-1). All summaries include `storageKey`. (4) Update `deleteSave` to accept a storage key for overflow slots. (5) Add unit tests in `src/tests/saveload.test.ts`: empty storage returns 5 nulls; overflow slot 7 is discovered; auto-save key is discovered; storageKey is present on all summaries; incompatible version saves still appear (for warning badge display). See implementation plan Task 11 for exact test code and listSaves rewrite.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` — all tests pass.

### TASK-012: Refine auto-save slot reuse by agency name
- **Status**: done
- **Dependencies**: TASK-011
- **Description**: In `src/core/autoSave.ts`: (1) Modify `_getAutoSaveKey()` to accept `agencyName: string` parameter. (2) First pass: scan slots 0-99 looking for an existing save with `saveName === 'Auto-Save'` and matching `agencyName`. Must decompress saves using `decompressSaveData` (import from saveload.ts). If found, reuse that slot. (3) Second pass: find first empty slot (0-99). (4) Fallback: `spaceAgencySave_auto`. (5) Update `performAutoSave()` to call `_getAutoSaveKey(state.agencyName)`. (6) Add unit tests verifying: slot reuse for same agency, empty slot discovery when no prior auto-save exists. See implementation plan Task 12.
- **Verification**: `npx vitest run src/tests/autoSave.test.ts` — all tests pass (create the test file if it doesn't exist).

### TASK-013: Dynamic load screen rendering
- **Status**: done
- **Dependencies**: TASK-011, TASK-004
- **Description**: In `src/ui/mainmenu.ts`: (1) Import `showNotification` from `./notification.ts`. (2) In `_renderLoadScreen`, after the existing loop for slots 0-4, add a second loop for indices 5+ from the `saves` array — only append a card if the entry is non-null. (3) Add `max-height: 70vh` and `overflow-y: auto` to the grid container for scroll support. (4) Update `_buildSaveCard` to include `data-key="${summary.storageKey}"` on action buttons. (5) Update card click handler to read `data-key` and pass it to `_handleLoad`, `_handleExport`, `_handleDeleteConfirm`. (6) In `_handleLoad`, add a version check: read the save envelope, check `envelope.version !== SAVE_VERSION`, and if incompatible show a notification via `showNotification()` and return early without loading. See implementation plan Task 13.
- **Verification**: `npx tsc --noEmit src/ui/mainmenu.ts` — 0 errors.

### TASK-014: E2E tests for auto-save visibility and save compatibility
- **Status**: done
- **Dependencies**: TASK-013, TASK-012
- **Description**: (1) In `e2e/auto-save.spec.ts`, add a test tagged `@smoke`: fill all 5 manual slots with saves via localStorage injection, load one save, trigger a flight + post-flight to auto-save, return to main menu, verify the load screen shows more than 5 save cards. (2) In `e2e/saveload.spec.ts`, add a test tagged `@smoke`: inject a save with `version: 1` into slot 0, open the load screen, verify the version warning badge `[data-testid="version-warning"]` is visible, click Load, verify the game does NOT start (error notification appears or the load screen remains visible). See implementation plan Task 14.
- **Verification**: `npx playwright test e2e/auto-save.spec.ts e2e/saveload.spec.ts` — all tests pass.

### TASK-015: Final typecheck, lint, and smoke test verification
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-008, TASK-009, TASK-010, TASK-010a, TASK-011, TASK-012, TASK-013, TASK-014
- **Description**: Full verification pass. (1) `npx tsc --noEmit` — 0 errors. (2) `npm run lint` — 0 errors, 0 warnings. (3) `npm run test:smoke:unit` — all smoke tests pass. (4) `npm run test:smoke:e2e` — all smoke E2E tests pass. (5) `npm run build` — production build succeeds with no warnings. (6) Verify no Date.now() ID generation patterns remain: `grep -rn "Date.now()" src/core/ --include="*.ts"` should show only timestamp usage (save dates), not entity IDs. Fix any issues found and commit.
- **Verification**: `npm run test:smoke` — all smoke tests (unit + E2E) pass.
