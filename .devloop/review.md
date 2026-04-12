# Iteration 11 Code Review Report

**Date:** 2026-04-12
**Scope:** Hardening, In-Flight Map, Off-World Hubs & E2E Stability (40 tasks across 3 phases)

---

## Requirements vs Implementation

### All Requirements Met

All 40 tasks are marked `done`. Every requirement section from the iteration 11 spec has a corresponding implementation.

| Requirement Section | Status | Notes |
|---|---|---|
| **Phase A: Hardening** | | |
| 1. Split logistics.ts into sub-modules | Complete | Five sub-modules in `src/ui/logistics/` with barrel re-export at `index.ts` |
| 2. E2E: Craft +/- buttons | Complete | Test in `route-interactions.spec.ts` |
| 3. E2E: Route builder confirm flow | Complete | Test in `route-interactions.spec.ts` |
| 4. Unit: Orbital buffer overflow | Complete | Test in `mining.test.ts`, intentional unbounded design documented |
| 5. CSS custom properties for body colors | Complete | `logistics.css` defines `--body-color-*` vars, mirrored in `_routeMap.ts` |
| 6. Route revenue integration test | Complete | Test in `routes.test.ts` |
| 7. Non-null assertion cleanup | Complete | Local variable after guard in `routes.ts` |
| 8a. In-flight map Bezier curves | Complete | Quadratic Bezier arcs with animated flow dots in `map.ts` |
| 8b. Hub markers on map | Complete | Surface house icons, orbital diamond icons with opacity |
| 8c. Map tooltips & interactivity | Complete | Hover tooltips, tracking station click-to-select |
| **Phase B: Off-World Hubs** | | |
| 9. Hub type definitions | Complete | `hubTypes.ts` with Hub, ConstructionProject, Tourist, ResourceRequirement |
| 10. Hub constants & facility data | Complete | `hubFacilities.ts`, constants.ts additions (OUTPOST_CORE, CREW_HAB, etc.) |
| 11. Hub test factories | Complete | `_factories.ts`: makeHub, makeEarthHub, makeOrbitalHub, makeConstructionProject |
| 12. GameState hub fields | Complete | `hubs[]`, `activeHubId`, crew `stationedHubId`/`transitUntil` |
| 13. Core hub module | Complete | `hubs.ts` with CRUD, environment/tax helpers |
| 14. Save/load migration | Complete | `migrateToHubs()` — idempotent, SAVE_VERSION bumped |
| 15. Hub-aware construction | Complete | `resolveHubFacilities()` pattern in `construction.ts` |
| 16. Hub switcher UI | Complete | `hubSwitcher.ts` with dropdown, status badges |
| 17. Hub-aware hub rendering | Complete | Body-specific sky/ground colors, orbital starfield |
| 18. Outpost Core part | Complete | In `parts.ts`: 2000kg, $500k, DEPLOY behaviour, stack snap points |
| 19. Outpost Core deployment | Complete | `deployOutpostCore()` in `hubs.ts` |
| 20. Construction resource delivery | Complete | `deliverResources()`, `processConstructionProjects()`, `getAvailableFacilitiesToBuild()` |
| 21. Hub maintenance & offline | Complete | `calculateHubMaintenance()`, `processHubMaintenance()`, `reactivateHub()` |
| 22. Hub-scoped crew | Complete | `hubCrew.ts` with hiring tax, transit delays, transfers |
| 23. Off-world VAB import tax tests | Complete | `hubs-vab.test.ts` |
| 24. Tourist system | Complete | `hubTourists.ts` with capacity, revenue, eviction |
| 25. Facility tier upgrades | Complete | `startFacilityUpgrade()` with tier-scaled costs |
| 26. Orbital hub undocking launch | Complete | `physics.ts` orbital velocity spawn, skip PRELAUNCH |
| 27. Orbital hub docking | Complete | `findNearbyOrbitalHub()`, dock prompt in flight controller |
| 28. Surface hub recovery | Complete | `getSurfaceHubsForRecovery()`, multi-hub selection dialog |
| 29. Hub markers on in-flight map | Complete | `renderHubMarkers()` in `map.ts` |
| 30. E2E save factory updates | Complete | `buildSaveEnvelope()` supports hubs, E2E factories added |
| 31. Comprehensive hub E2E tests | Complete | 5 E2E spec files covering switcher, establishment, migration, VAB, map |
| 32. Period loop integration | Complete | All 4 hub functions wired into `advancePeriod()` |
| 33. VAB import tax & local gravity | Complete | Parts panel shows "(Nx import)", engineer panel uses hub body gravity |
| 34. Final hub verification | Complete | Verification-only task |
| **Phase C: E2E Stability** | | |
| 35-40. E2E baseline, fixes, optimization | Complete | Full suite passes 3 consecutive runs per TASK-040 |

### No Scope Creep

No features beyond the requirements were implemented. The iteration stays focused on its three stated objectives: hardening, off-world hubs, and E2E stability.

---

## Code Quality

### Bugs

#### BUG-1: Hub Construction Money Cost Not Environment-Scaled (Medium Severity)

**File:** `src/core/hubs.ts:106`

In `createHub()`, the initial Crew Hab construction project's money cost is **not** multiplied by the environment cost multiplier, while resource requirements ARE correctly scaled:

```typescript
// Resources correctly scaled:
amount: r.amount * envMultiplier,

// Money NOT scaled:
moneyCost: crewHabCost.moneyCost,  // Should be: crewHabCost.moneyCost * envMultiplier
```

This means establishing a hub on Mars (envMultiplier 1.3) costs 1.3x more in resources but the same money as a hub on the Moon (envMultiplier 1.0). The inconsistency affects gameplay balance — players pay the same monetary price regardless of how hostile the environment is.

**Related:** `startFacilityUpgrade()` at line 370 has the same pattern — money is scaled by tier (`costDef.moneyCost * nextTier`) but not by environment multiplier, while resources are scaled by both (`r.amount * nextTier * envMultiplier`).

**Impact:** Gameplay balance issue. Not a crash or data corruption bug. Players may not notice since resource costs still scale correctly. Whether this is intentional (money represents Earth-side costs that don't vary by destination) or an oversight should be clarified.

#### BUG-2: TypeScript Compilation Errors in mapView.test.ts (Low Severity)

**File:** `src/tests/mapView.test.ts` — lines 233, 239, 577

Three TypeScript errors from incomplete Hub mock objects in test code:

```typescript
hubs: [{ id: 'earth', facilities }],  // Missing: name, type, bodyId, tourists, etc.
```

The Hub interface requires many more fields than just `id` and `facilities`. The double-cast `as Partial<GameState> as GameState` bypasses this at runtime but fails TypeScript's intermediate type check.

**Impact:** `npx tsc --noEmit` fails. Tests still pass at runtime (Vitest doesn't enforce TypeScript strictness by default). Should use `makeEarthHub()` factory from `_factories.ts` to fix.

### Minor Code Quality Issues

#### MINOR-1: Magic String in hubTourists.ts (Line 24)

```typescript
const crewHab = hub.facilities['crew-hab'];
```

Should use `FacilityId.CREW_HAB` constant instead of the hardcoded string `'crew-hab'`. The constant exists in `constants.ts:285` but isn't imported here. Functionally correct since the values match, but violates the project convention of no magic strings.

#### MINOR-2: Tourist Departure Semantics (hubTourists.ts:70)

```typescript
hub.tourists = hub.tourists.filter(t => t.departurePeriod > state.currentPeriod);
```

Uses `>` (strict greater than), meaning a tourist with `departurePeriod = 5` is kept during period 5 and removed at period 6. This is internally consistent — revenue is credited during the departure period before removal — but the semantics of `departurePeriod` are ambiguous. A code comment clarifying "departurePeriod is the last period the tourist is present" would prevent future confusion.

#### MINOR-3: CSS/JS Body Color Dual Maintenance

Body colors are defined in both `src/ui/logistics.css` (CSS custom properties) and `src/ui/logistics/_routeMap.ts` (JS constant). The comment in the CSS file notes they must stay in sync. Currently they match, but this is a manual coordination point. A more robust approach would have the JS read from `getComputedStyle()`, but the current approach works and is documented.

### Architecture & Conventions

All architectural conventions are well-maintained:

- **Three-layer separation preserved.** State mutations happen only in `src/core/`. Render layer reads state. UI calls core functions then re-renders.
- **Hub-aware construction** uses the clean `resolveHubFacilities()` helper pattern — all construction functions accept an optional `hubId` and fall back to the active hub.
- **Period processing order is correct.** Hub maintenance runs before construction (so bankrupt hubs go offline before new projects complete), construction runs before crew transits, tourist revenue runs last.
- **Logistics module split** follows the established sub-module pattern (matching `flightController/`, `vab/`, `missionControl/`).
- **Frozen data catalogs.** All hub facility data uses `Object.freeze()` including nested objects.
- **Save/load migration** is idempotent and uses `??=` for safe defaulting without overwriting.

### Security

- **No XSS vulnerabilities.** All UI modules use `.setAttribute()`, `.textContent`, or safe template string interpolation. No `innerHTML` with dynamic user data.
- **No injection vectors.** All data flows from typed game state through DOM/SVG APIs.
- **Save/load migration is safe.** Only adds default values, never overwrites existing data.
- **Orbital mechanics are physically correct.** `v = sqrt(GM/r)` with `GM = g*R^2` is the standard conversion.

---

## Testing

### Test Suite Health

| Metric | Value |
|---|---|
| Total unit test files | 108 |
| Total unit tests | 4,120 |
| All unit tests passing | Yes |
| TypeScript (`tsc --noEmit`) | **3 errors** (mapView.test.ts) |
| ESLint | Clean (0 errors, 3 warnings in coverage/) |
| E2E suite | Passes (3 consecutive runs per TASK-040) |

### Iteration 11 Test Coverage — Unit Tests

| Test File | Tests | Coverage |
|---|---|---|
| `hubs.test.ts` | 45 | Core CRUD, environment, orbital ops, proximity, recovery |
| `hubs-crew.test.ts` | 27 | Crew at hubs, hiring, transfers, transit delays |
| `hubs-construction.test.ts` | 23 | Facility building, upgrades, resource delivery |
| `hubs-tourists.test.ts` | 17 | Capacity, revenue, departure, eviction |
| `hubs-economy.test.ts` | 14 | Maintenance, online/offline, reactivation |
| `hubs-outpost-core.test.ts` | 7 | Outpost Core part, surface/orbital deployment |
| `hubs-save-migration.test.ts` | 6 | Legacy migration, idempotency, round-trip |
| `hubs-vab.test.ts` | 6 | Import tax multipliers per body |
| **Total new hub unit tests** | **145** | |

### Iteration 11 Test Coverage — E2E Tests

| Test File | Tests | Coverage |
|---|---|---|
| `hubs-switcher.spec.ts` | 4 | Switcher visibility, hub listing, status badges, facility filtering |
| `hubs-establishment.spec.ts` | 2 | New hub in switcher, under-construction status |
| `hubs-save-migration.spec.ts` | 1 | Legacy save creates Earth hub |
| `hubs-vab-offworld.spec.ts` | 2 | Import tax label, no tax at Earth |
| `hubs-map.spec.ts` | 2 | Hub markers on map, tracking station access |
| **Total new hub E2E tests** | **11** | |

Plus 2 new tests in `route-interactions.spec.ts` (craft +/- buttons, route builder confirm).

### Strengths

1. **Test independence is excellent.** Every `describe` block resets state via `beforeEach()`. E2E tests each seed their own save. No serial dependencies.
2. **Factory functions are well-designed.** Both unit (`makeHub`, `makeEarthHub`, etc.) and E2E (`buildHub`, `buildOrbitalHub`) factories provide sensible defaults with override support.
3. **Edge case coverage is good.** Offline hubs excluded from recovery, bankrupt hubs trigger crew evacuation, capacity boundary checks, transit delay boundaries, and range detection boundaries are all tested.
4. **Smoke tags appropriately used.** Representative tests tagged `@smoke` in both unit and E2E suites.

### Gaps & Untested Edge Cases

**Unit tests:**
- Construction project cancellation (no API exists, but the workflow is irreversible — should be documented)
- Hub with zero facilities (degenerate state)
- Concurrent refineries competing for the same storage modules across hubs
- Tourist revenue with `revenue = 0` (edge case)
- `createHub()` with duplicate hub names (not prevented)
- Money cost not matching environment multiplier (tests pass because moneyCost is hardcoded to match the unscaled value — see BUG-1)

**E2E tests:**
- Route builder with multi-leg routes (only single-leg tested)
- Hub maintenance causing offline status (economy E2E)
- Tourist revenue in period summary display
- Outpost Core deployment via actual flight (full gameplay flow)
- Hub reactivation from offline state

**Integration tests:**
- Full off-world pipeline: establish hub → deploy outpost → construct facilities → hire crew → operate
- Hub offline cascade: maintenance failure → crew evacuation → tourist eviction in a single period

---

## Recommendations

### Must Fix Before Production

1. **Fix TypeScript compilation errors in `mapView.test.ts`.** Three errors at lines 233, 239, and 577 where Hub mock objects are missing required fields. Use the `makeEarthHub()` factory from `_factories.ts` or add the missing fields. This blocks `npx tsc --noEmit` from passing clean — a TASK-034 (final verification) requirement that was missed.

### Should Fix

2. **Clarify environment scaling of money costs.** In `hubs.ts`, `createHub()` at line 106 and `startFacilityUpgrade()` at line 370 don't apply the environment cost multiplier to money, while resources are scaled. Either:
   - Scale money by `envMultiplier` to match resources (if this is a bug), or
   - Add a code comment documenting that money costs intentionally don't scale (if this is a design decision)

3. **Replace magic string in `hubTourists.ts:24`.** Change `hub.facilities['crew-hab']` to `hub.facilities[FacilityId.CREW_HAB]` and add the import. Matches project conventions.

4. **Add code comment for tourist departure semantics.** At `hubTourists.ts:70`, document that `departurePeriod` is the last period the tourist is present (revenue is credited, then tourist departs at the *next* period).

### Nice to Have

5. **Reduce CSS/JS body color duplication.** The `BODY_COLORS` constant in `_routeMap.ts` duplicates values from CSS custom properties in `logistics.css`. Consider reading from `getComputedStyle()` or extracting to a shared data file that both CSS and JS consume.

6. **Parameterize transit delay tests.** In `hubs-crew.test.ts`, transit delays are tested with hardcoded values. Using `describe.each()` with a data table would make tests more maintainable if delay values change.

---

## Future Considerations

### Next Features (from requirements "Does NOT Include" section)

- **Life support and oxygen/water consumption.** Natural next step building on hubs + resources. Crew at off-world hubs would consume oxygen/water from connected mining storage, creating supply chain pressure.

- **Crew transport as a route type.** The route system supports arbitrary origin/destination pairs. A passenger route variant would formalize the abstracted crew transfer system.

- **Mk2 storage modules.** The per-module storage architecture from iteration 10 was explicitly designed for this. Different capacity modules will work without architectural changes.

- **Hub-to-hub resource sharing.** Hubs on the same body could share orbital buffers or establish local supply chains without needing transport routes.

### Architectural Decisions to Revisit

1. **Bundle code-splitting.** Deferred for three iterations now. The logistics module alone (5 sub-modules + CSS) and the hubs feature (3 core modules + UI + data) represent significant chunks that could be lazy-loaded. As the codebase grows, initial load time will become a player-facing concern.

2. **Hub facility system generalization.** Currently, Earth uses the legacy `state.facilities` while off-world hubs use `hub.facilities`. The `resolveHubFacilities()` pattern bridges this cleanly, but long-term, migrating Earth to be fully hub-driven (eliminating the legacy path) would simplify the code.

3. **Orbital buffer capacity.** Still intentionally unbounded (documented in mining.ts). As the hub economy matures, adding orbital storage capacity tied to deployed modules would create meaningful gameplay decisions about logistics infrastructure.

4. **SVG map scalability.** The schematic map uses a fixed 800x200 viewBox with hardcoded body positions. Adding moons of Jupiter/Saturn or asteroid belt objects will require dynamic layout or a scrollable/zoomable canvas.

5. **Hub naming uniqueness.** `createHub()` doesn't prevent duplicate hub names. While hubs have unique IDs, duplicate names could confuse players in the switcher dropdown and route builder.

### Technical Debt Introduced

1. **TypeScript errors in mapView.test.ts** — Incomplete Hub mocks that should use factories. (3 compilation errors)

2. **Money cost scaling inconsistency** — `createHub()` and `startFacilityUpgrade()` don't environment-scale money costs while they do scale resource costs. Whether intentional or not, this is undocumented.

3. **Magic string in hubTourists.ts** — `'crew-hab'` instead of `FacilityId.CREW_HAB`.

4. **Dual maintenance of body colors** — CSS custom properties and JS constant must be kept in sync manually.

5. **In-flight route rendering vs. logistics map divergence** — The PixiJS map uses Bezier curves for route visualization while the SVG logistics map uses straight dashed lines. Visual consistency between the two representations would improve the player experience.

---

## Summary

Iteration 11 is a substantial and well-executed release delivering three distinct goals:

**Phase A (Hardening)** successfully closes every gap from the iteration 10 review. The logistics module split into 5 sub-modules follows the established project pattern. The in-flight map upgrade from straight lines to Bezier curves with animated flow dots and hub markers is a significant visual improvement. CSS custom properties for body colors establish a single source of truth.

**Phase B (Off-World Hubs)** is the largest feature addition to date, introducing 3 new core modules (`hubs.ts`, `hubCrew.ts`, `hubTourists.ts`), a type definitions file, a data catalog, and comprehensive UI/render integration. The Hub-First architecture — making Earth the first entry in `hubs[]` — is a clean design that avoids dual-path code. Save/load migration is idempotent and backwards-compatible. 145 unit tests and 11 E2E tests provide strong coverage.

**Phase C (E2E Stability)** achieved its target of 3 consecutive green runs across the full E2E suite.

**Overall assessment:** The iteration delivers on its promises with good code quality and comprehensive testing. The one **must-fix** issue is the TypeScript compilation errors in `mapView.test.ts` (3 errors from incomplete Hub mocks). The money-cost-not-environment-scaled pattern and the magic string in `hubTourists.ts` are minor issues that should be addressed. The codebase is in strong shape with **4,120 unit tests passing**, the full E2E suite stable, and ESLint clean.

| Health Check | Status |
|---|---|
| Unit tests (4,120) | **All passing** |
| TypeScript | **3 errors** (mapView.test.ts) |
| ESLint | **Clean** (0 errors) |
| E2E suite | **Stable** (3 consecutive green runs) |
| Architecture | **Sound** — three-layer separation maintained |
| Security | **No vulnerabilities** |
| Test coverage | **Comprehensive** — 145 new unit + 11 new E2E tests |
