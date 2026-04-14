# Iteration 12 Code Review Report

**Date:** 2026-04-14
**Scope:** Earth Hub Migration, Route Refactor, Map Scalability, Mk2 Storage, Code-Splitting & Polish (74 tasks across 9 phases)

---

## Requirements vs Implementation

### All Requirements Met

All 74 tasks are marked `done`. Every requirement section from the iteration 12 spec has a corresponding implementation. The review verified each area against the source code.

| Requirement Section | Status | Notes |
|---|---|---|
| **Phase A: Review Fixes & Save Migration Removal** | | |
| 1. Fix TypeScript errors in mapView.test.ts | Complete | `makeEarthHub()` factory used, `tsc --noEmit` passes clean |
| 2. Hub money cost environment scaling | Complete | Both `createHub()` and `startFacilityUpgrade()` now scale money by `envMultiplier` |
| 3. Magic string & tourist departure comment | Complete | `FacilityId.CREW_HAB` used, departure semantics documented at line 70-71 |
| 4. CSS/JS body color deduplication | Complete | `getBodyColor()` reads CSS custom properties with `#888` fallback |
| 5. Remove all save migration functions | Complete | No `migrateTo*()` functions remain; version mismatch throws error |
| 6. Incompatible save UI | Complete | Grayed out, "(Incompatible)" label, Load button disabled |
| 7. Update test factories (ongoing) | Complete | All factories updated across unit and E2E |
| **Phase B: Earth Hub Full Migration** | | |
| 8. Remove `facilities` from GameState | Complete | Zero `state.facilities` references in `src/` (verified via grep) |
| 9. Update core module references | Complete | All use `getActiveHub()` or `getHub()` |
| 10. Update UI module references | Complete | All use hub-aware APIs |
| 11. Update render module references | Complete | All use hub-aware APIs |
| 12. Simplify `resolveHubFacilities()` | Complete | Hub-only path, no legacy fallback |
| 13. Remove legacy Earth hub special cases | Complete | No dual-reference branches remain |
| **Phase C: Hub UX Polish** | | |
| 14. Hub name catalog | Complete | 85 names, `Object.freeze()`d, 4 categories |
| 15. Hub name generation | Complete | Random unused name with suffix, fallback to "Hub-N" |
| 16. Hub name uniqueness validation | Complete | Case-insensitive on create and rename |
| 17. Hub abandonment logic | Complete | All 5 effects implemented and ordered correctly |
| 18. Hub management info helper | Complete | All fields computed, including `totalInvestment` |
| 19. Hub management panel UI | Complete | Modal with all sections, rename, reactivate, abandon |
| 20. Wire management panel to switcher | Complete | Gear icon, refreshes on rename/abandon |
| **Phase D: Mk2 Storage Modules** | | |
| 21. Mk2 part definitions | Complete | All 3 parts with correct specs and snap points |
| 22. Mk2 storage unit tests | Complete | Capacity, proportional distribution, mixed Mk1/Mk2 |
| **Phase E: SVG Map Dynamic Layout** | | |
| 23-25. Dynamic layout, hub nodes, viewBox | Complete | Hierarchy-based positioning, hub icons, scroll |
| 26-27. Bezier curves & flow dots | Complete | Quadratic Bezier with offset, CSS `offset-path` animation |
| **Phase F: Hub-to-Hub Routing** | | |
| 28. `hubId` on RouteLocation | Complete | `hubId: string | null` on all route locations |
| 29-31. Proven legs, route creation, processing | Complete | Hub targeting, validation, Earth vs off-world delivery |
| 32. Route builder hub interaction | Complete | Click handling, multi-hub popover |
| 33. Route table hub name display | Complete | Hub name prepended to body name |
| **Phase G: Code-Splitting** | | |
| 34. Screen entry point audit | Complete | No circular imports or side effects blocking lazy load |
| 35. Loading indicator | Complete | `showLoadingIndicator()` / `hideLoadingIndicator()` |
| 36. Dynamic imports for screens | Complete | 9 screens use `await import()` with loading indicator |
| 37. Vite manual chunks | Complete | Function-form `manualChunks` in vite.config.ts |
| 38. Idle preloading | Complete | `requestIdleCallback` preloads VAB and Mission Control |
| **Phase H: Test Coverage** | | |
| 39-58. All identified gaps | Complete | See Testing section |
| **Phase I: Final Verification** | | |
| 59-62. test-map, smoke tags, typecheck, smoke run | Complete | All pass |

### No Scope Creep

No features beyond the requirements were implemented. The iteration stays focused on its stated objectives.

---

## Code Quality

### Bugs

#### BUG-1: `deployOutpostCore()` Money Cost Not Environment-Scaled (Medium Severity)

**File:** `src/core/hubs.ts:268`

While TASK-002 correctly fixed the environment scaling in `createHub()` (line 116) and `startFacilityUpgrade()` (line 457), the fix was not applied to `deployOutpostCore()`:

```typescript
const moneyCost = crewHabCost?.moneyCost ?? 200_000;

// Check and deduct monetary cost
if (!spend(state, moneyCost)) {   // <-- NOT multiplied by envMultiplier
  return null;
}
```

The function deducts the base Crew Hab money cost without applying the environment cost multiplier. When deploying on Mars (1.3x), the player pays the Earth-rate monetary cost upfront, but the construction project queued by `createHub()` (called on line 282/290) records the environment-scaled cost. This creates an inconsistency: the player pays less than the construction project's recorded `moneyCost`.

**Impact:** Gameplay balance. Players deploying outposts in hostile environments get a monetary discount on the initial deployment cost. Not a crash or data corruption bug.

**Fix:** Change line 268 to:
```typescript
const envMultiplier = getEnvironmentCostMultiplier(flight.bodyId);
const moneyCost = (crewHabCost?.moneyCost ?? 200_000) * envMultiplier;
```

### Coverage Threshold Failures (Medium Severity)

**Finding:** `npm run test:unit` reports 5 coverage threshold violations:

| Metric | Area | Actual | Threshold |
|---|---|---|---|
| Lines | `src/render/**` | 35.15% | 39% |
| Functions | `src/render/**` | 50.87% | 56% |
| Branches | `src/render/**` | 90.55% | 91% |
| Lines | `src/ui/**` | 44.54% | 64% |
| Functions | `src/ui/**` | 78.57% | 87% |

The iteration added substantial new UI code (hub management panel, loading indicator, schematic layout, route builder hub interaction) and render code without proportional unit test coverage of the rendering/UI layers. Since UI and render modules are inherently harder to unit test (DOM/canvas dependencies), this is expected — but the thresholds need to be adjusted or tests added.

**Impact:** CI pipelines that enforce coverage thresholds would fail. The thresholds predate the new code and need updating.

### Build Warning: Chunk Size (Low Severity)

The `vendor-pixi` chunk is 504 KB (above Vite's default 500 KB warning). This is the PixiJS library itself — not actionable without switching renderers, but the warning should be suppressed via `build.chunkSizeWarningLimit`.

### Minor Code Quality Issues

All minor issues from the iteration 11 review have been fixed:
- Magic string `'crew-hab'` replaced with `FacilityId.CREW_HAB` constant
- Tourist departure semantics documented with clear comment
- Body colors now read from CSS custom properties (single source of truth)
- TypeScript compilation errors in mapView.test.ts resolved

### Architecture & Conventions

All architectural conventions continue to be well-maintained:

- **Earth hub full migration is clean.** Zero `state.facilities` references remain in `src/` (verified via grep). All facility access goes through the hub system. The `resolveHubFacilities()` helper has no legacy fallback path.
- **Three-layer separation preserved.** State mutations happen only in `src/core/`. Render layer reads state. UI calls core functions then re-renders.
- **Code-splitting is well-implemented.** 9 screens use dynamic imports with loading indicators, error handling, and module caching. Idle preloading primes VAB and Mission Control. Manual chunks split vendor (PixiJS), core modules, and data catalogs into separate bundles.
- **Hub-to-hub routing is properly integrated.** `RouteLocation.hubId` flows from proven legs through route creation to route processing. Broken route detection catches references to non-existent hubs.
- **SVG map dynamic layout** replaces hardcoded positions with hierarchy-based computation that adapts to game state (only showing bodies with activity).
- **Frozen data catalogs.** Hub names, facility costs, and Mk2 parts all use `Object.freeze()`.
- **Build output:** 16 JS chunks (code-splitting working), production build in 4.2s.

### Security

- **No XSS vulnerabilities.** The hub management panel uses `.textContent` for all user-supplied data (hub names, crew names). No `innerHTML` with dynamic content anywhere in new code.
- **No injection vectors.** All data flows from typed game state through DOM/SVG APIs.
- **Save version check is strict.** Incompatible saves are rejected with a clear error message. No migration code to exploit.

---

## Testing

### Test Suite Health

| Metric | Value |
|---|---|
| Unit test files | 110 |
| Total unit tests | 4,226 |
| All unit tests passing | Yes |
| Smoke unit tests passing | 84 |
| TypeScript (`tsc --noEmit`) | 0 errors |
| ESLint | Clean (0 errors) |
| E2E spec files | 53 |
| Production build | Passes (4.2s) |
| Coverage thresholds | **5 failures** (render + UI) |

### New Test Coverage for Iteration 12

**Unit Tests Added:**

| Area | Tests | Coverage |
|---|---|---|
| Hub name generation & uniqueness | ~10 | Pool selection, suffix, exclusion, exhaustion fallback, rename validation |
| Hub abandonment | ~7 | Preconditions, crew evacuation, tourist eviction, route breakage, activeHubId switch |
| Hub management info | ~5 | All fields computed for Earth and off-world hubs |
| Hub zero facilities edge case | ~5 | Maintenance = 0, hasFacility = false, empty facilities array |
| Environment money scaling | ~3 | Mars 1.3x, Moon 1.0x, upgrade tier + environment |
| Construction lifecycle | ~4 | Zero resources, fully delivered, partial, FIFO queue |
| Tourist edge cases | ~3 | Zero revenue, departure timing, batch departure |
| RouteLocation hubId | ~6 | Proven legs with hubs, route creation, processing, broken detection |
| Mk2 storage | ~4 | Part definitions, capacity, proportional distribution |
| Dynamic schematic layout | ~7 | Body hierarchy, visibility rules, hub node positioning |
| Incompatible save rejection | ~5 | Old version, future version, no version, current version |
| Integration: off-world pipeline | 1 | Create → build → hire → operate across periods |
| Integration: offline cascade | 1 | Maintenance fail → offline → evacuation → eviction in one call |

**E2E Tests Added:**

| Spec File | Tests | Coverage |
|---|---|---|
| `hub-management.spec.ts` | ~3 | Panel display, rename, duplicate rejection |
| `hub-economy.spec.ts` | ~3 | Maintenance offline, tourist revenue, reactivation |
| `hub-deployment.spec.ts` | ~2 | Outpost Core activation, auto-name suggestion |
| `route-interactions.spec.ts` | ~2 | Multi-leg builder, hub-to-hub route creation |
| `logistics.spec.ts` | ~2 | SVG dynamic layout, hub nodes on map |
| `save-version.spec.ts` / `saveload.spec.ts` | ~1 | Incompatible save slot display |
| `navigation.spec.ts` | ~1 | Code-splitting screen transitions |
| `mining.spec.ts` | ~1 | Mk2 storage in mining site |

### Strengths

1. **Integration tests are excellent.** The full off-world pipeline test and offline cascade test exercise multiple systems together in realistic scenarios.
2. **Edge case coverage is strong.** Zero facilities, zero revenue tourists, pool exhaustion, duplicate names, and lifecycle boundary conditions are all tested.
3. **Smoke tags are well-distributed.** 84 smoke tests provide fast coverage of critical paths across all areas.
4. **Test independence maintained.** Every test seeds its own state. No serial dependencies.

### Gaps & Untested Areas

1. **`deployOutpostCore()` environment scaling** — No test verifies that the monetary cost deducted during deployment matches the environment multiplier. This is directly related to BUG-1.
2. **Multi-leg route processing** — While creation is tested, sequential processing of 3+ leg routes is not deeply tested.
3. **Route status transitions** — No test exercises the full lifecycle of `active → paused → broken → active` on a single route.
4. **SVG rendering correctness** — The dynamic layout algorithm is unit-tested, but actual SVG element rendering (Bezier curves, flow dot animations, hub node shapes) is only verifiable via E2E or visual inspection.
5. **Coverage thresholds** — New UI/render code has pushed coverage below thresholds. The thresholds should be updated or new unit tests added for the simpler UI helpers.

---

## Recommendations

### Must Fix

1. **Fix `deployOutpostCore()` environment scaling (BUG-1).** The monetary cost deducted during deployment should be multiplied by the environment cost multiplier, matching the pattern in `createHub()` and `startFacilityUpgrade()`. Add a unit test verifying the deduction matches the construction project's `moneyCost`.

2. **Update coverage thresholds.** The 5 coverage threshold failures will block CI. Either:
   - Lower the thresholds to match the current coverage (quick fix), or
   - Add targeted unit tests for the new UI/render helpers (better long-term)

### Should Fix

3. **Suppress the 500 KB chunk size warning.** Add `build.chunkSizeWarningLimit: 600` to vite.config.ts. The `vendor-pixi` chunk is PixiJS itself and cannot be reduced without switching rendering libraries.

4. **The main entry chunk (`index-BPB170Na.js`) is 487 KB.** This is the largest non-vendor chunk and suggests more code could be lazy-loaded. Candidates: the flight controller + renderer (heavy PixiJS usage), the hub renderer, and the topbar module.

### Nice to Have

5. **Add a unit test for `deployOutpostCore()` money cost at different environments.** Test that deploying on Mars deducts 1.3x the base cost, on the Moon deducts 1.0x, etc.

6. **Consider extracting the hub management panel into sub-modules.** At 509 lines (from the agent review), it's approaching the size where the project convention calls for splitting into a sub-directory with barrel re-export.

---

## Future Considerations

### Next Features

From the requirements "Does NOT Include" section, natural next steps:

- **Life support / oxygen-water consumption.** Crew at off-world hubs consuming resources from mining storage creates supply chain pressure and makes the logistics system more compelling. The hub + resource + route infrastructure is all in place.

- **Crew transport routes.** The route system now supports hub-to-hub targeting. A passenger route variant would formalize the abstracted crew transfer system and give routes more gameplay variety.

- **Hub-to-hub resource sharing.** Hubs on the same body could share orbital buffers without needing routes. This would simplify local logistics while keeping inter-body routes meaningful.

- **Orbital buffer capacity limits.** Still intentionally unbounded. Adding capacity tied to deployed modules would create decisions about logistics infrastructure investment.

### Architectural Decisions to Revisit

1. **Main bundle size (487 KB).** Code-splitting was a major win (16 chunks), but the main bundle still includes the flight controller, PixiJS hub renderer, topbar, and all core modules. The flight system in particular could be lazy-loaded since players don't enter flight from the hub screen directly.

2. **Hub ID generation uses `Date.now()` + random.** In `createHub()`, hub IDs are `'hub-' + Date.now() + '-' + random`. This is unlikely to collide in practice but is non-deterministic, making test assertions fragile if they depend on hub order. A sequential counter or UUID v4 would be more robust.

3. **Route leg chaining validation.** `processRoutes()` only validates the first and last legs of a route. Intermediate legs are not checked for logical continuity (leg N's destination matches leg N+1's origin). This could allow invalid multi-leg routes to be created.

4. **SVG map vs PixiJS map divergence.** The logistics SVG map and the in-flight PixiJS map now both render routes with Bezier curves, but they use different spatial layouts and rendering technologies. As both evolve, keeping visual consistency will require deliberate coordination.

### Technical Debt Introduced

1. **Coverage threshold drift.** New UI/render code pushed coverage below thresholds. These need to be either adjusted or addressed with tests.

2. **`deployOutpostCore()` money scaling bug.** The only environment-scaling oversight remaining from the iteration 11 review.

3. **Hub management panel size.** At ~509 lines, it's approaching the split threshold but hasn't been split yet.

4. **Build chunk size warning.** The PixiJS vendor chunk exceeds Vite's default warning threshold. Cosmetic but noisy in CI logs.

---

## Summary

Iteration 12 is a well-executed release delivering significant architectural improvements and new features across 8 phases:

**Phase A (Review Fixes)** successfully closes every item from the iteration 11 review. All 5 tech debt items (TypeScript errors, money scaling, magic string, tourist semantics, body color duplication) are resolved. Save migration code has been cleanly removed with proper incompatible-save UX.

**Phase B (Earth Hub Migration)** is the most impactful architectural change. The legacy `state.facilities` dual-reference pattern has been completely eliminated — zero references remain in the codebase. All 3 layers (core, UI, render) now access facilities exclusively through the hub system. This removes an entire class of potential bugs.

**Phase C (Hub UX Polish)** adds name generation from a curated 85-name space history catalog, name uniqueness validation, hub abandonment with proper cascade effects, and a comprehensive management panel with rename/reactivate/abandon workflows.

**Phase D (Mk2 Storage)** adds 3 new storage modules with correct specs and seamless integration with the existing mining system.

**Phase E (SVG Map)** replaces the hardcoded schematic layout with a dynamic algorithm that adapts to game state, adds hub node icons, Bezier curve route lines, and animated flow indicators.

**Phase F (Hub-to-Hub Routing)** adds `hubId` to `RouteLocation`, enabling precise hub-targeted delivery with proper validation and broken-route detection.

**Phase G (Code-Splitting)** splits the bundle into 16 chunks via dynamic imports, with loading indicators, error handling, module caching, and idle preloading. The build produces properly separated vendor, core, data, and screen chunks.

**Phase H-I (Testing & Verification)** adds comprehensive unit tests, integration tests, and E2E tests for all new features, plus smoke tags and test-map updates.

**Overall assessment:** The iteration delivers on all promises with strong code quality. The one **must-fix** issue is the `deployOutpostCore()` environment scaling bug and the coverage threshold failures. The codebase is in excellent shape with **4,226 unit tests passing**, TypeScript clean (0 errors), ESLint clean, and a well-structured code-split build.

| Health Check | Status |
|---|---|
| Unit tests (4,226) | **All passing** |
| Smoke tests (84) | **All passing** |
| TypeScript | **0 errors** |
| ESLint | **Clean** (0 errors) |
| Production build | **Passes** (4.2s, 16 chunks) |
| Coverage thresholds | **5 failures** (render + UI) |
| `state.facilities` references | **0** (migration complete) |
| Architecture | **Sound** — three-layer separation maintained |
| Security | **No vulnerabilities** |
