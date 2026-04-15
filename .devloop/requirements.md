# Iteration 14 — Cleanup, Auto-Save Fix, Deterministic IDs & Shared Map Geometry

**Date:** 2026-04-15
**Scope:** Review cleanup, auto-save slot visibility bug, Date.now() ID migration, shared geometry/color extraction
**Builds on:** Iteration 13 (bug fixes, coverage hardening, architectural cleanup)
**Full design spec:** `docs/superpowers/specs/2026-04-15-iteration-14-design.md`
**Implementation plan:** `docs/superpowers/plans/2026-04-15-iteration-14.md`

---

## 1. Review Cleanup

Five small items carried forward from the iteration 13 review.

### 1a. Fix Lint Warnings

Remove unused imports `pressStage` and `pressThrottleUp` from `e2e/destinations.spec.ts:32-33`. These are imported from `./helpers.js` but never used.

### 1b. Extract `loadScreen()` Helper + User Error Feedback

The 9 identical catch blocks in `src/ui/index.ts` (lines 344-610) each do `hideLoadingIndicator(); console.error(...)`. Users see the loading indicator vanish with no explanation when a dynamic import fails.

Create a shared `src/ui/notification.ts` with a `showNotification()` toast utility (styled `<div>` appended to `document.body`, auto-removes after ~4 seconds). Then create a `loadScreen()` async helper in `src/ui/index.ts` that wraps the dynamic import in try/catch, calls `showNotification` on failure, and returns null so the caller can abort. Replace all 9 catch blocks with `loadScreen()` calls.

### 1c. Document Altitude Non-Check

Add a JSDoc comment above `validateLegChaining` in `src/core/routes.ts:104` explaining that altitude is intentionally not checked because route legs connect bodies and location types, not specific orbits.

### 1d. Un-Skip Loading Indicator Tests

Install `jsdom` as a devDependency. Add `// @vitest-environment jsdom` at the top of `src/tests/ui-helpers.test.ts`. Change `describe.skip` to `describe` for the 4 loading indicator tests (lines 206-234), implementing the actual test bodies with dynamic imports.

---

## 2. Auto-Save & Dynamic Save Slots

### The Bug

Auto-save fires correctly after post-flight. It finds the first empty localStorage slot (searching 0-99). But the load screen in `src/ui/mainmenu.ts` only renders slots 0-4 (`SAVE_SLOT_COUNT = 5`). Saves written to slots 5+ are invisible and unloadable from the UI.

### Fix: Dynamic Load Screen

**In `src/ui/mainmenu.ts`:** Instead of iterating `0..SAVE_SLOT_COUNT-1`, scan localStorage for all keys matching `spaceAgencySave_*` (including the `spaceAgencySave_auto` fallback key). Build the slot list from what actually exists in storage.

**Display rules:**
- Slots 0-4 always render (as "Empty Slot" placeholders if empty), so the user always sees at least 5 save-to targets.
- Any additional saves beyond slot 4 (slots 5+, auto key) appear as extra cards below the base 5.
- All save cards — manual or auto — have identical actions: Load, Export, Delete.
- Auto-saves display their save name (e.g. "Auto-Save") in the card header.
- If many saves exist, the slot container gets `max-height` with `overflow-y: auto` for scrolling.

### Auto-Save Slot Reuse

Refine `_getAutoSaveKey()` in `src/core/autoSave.ts` to prevent auto-save slot accumulation:

1. Scan existing slots for a save named "Auto-Save" matching the current agency name. If found, reuse that slot (overwrite).
2. Otherwise, find the first empty slot (0-99).
3. Fallback to dedicated `spaceAgencySave_auto` key.

This means each game only ever has one auto-save slot at a time, which gets overwritten on each auto-save.

### Save Version Incompatibility

`SAVE_VERSION` bumps from 5 to 6 (for the new GameState counter fields — see Section 3). Old saves remain incompatible:
- The load screen slot card already shows a version warning badge for incompatible saves (this exists).
- Attempting to load an incompatible save must fail with a user-visible error message (new behavior).
- No migration code — this is early dev stage.

### Changes to saveload.ts

`SaveSlotSummary` gets a new `storageKey: string` field so the UI knows which localStorage key to use for load/export/delete on overflow slots. `summaryFromEnvelope()` accepts and passes through the storage key. `listSaves()` is rewritten to scan slots 0-4 (always, with null for empty), then 5-99 and `spaceAgencySave_auto` (only if populated). `deleteSave` is updated to accept a storage key for overflow slots.

---

## 3. Sequential ID Migration

### Problem

14 ID generators across 9 files use `Date.now() + Math.random()`, producing non-deterministic IDs. Hub IDs were already migrated to sequential counters in iteration 13. This iteration completes the migration for all remaining entity types, plus one module-level counter in `surfaceOps.ts`.

### New GameState Counter Fields

All 15 fields initialize to `1` in `createGameState()`:

| Counter field | ID prefix | Source file | Current generator |
|---|---|---|---|
| `nextContractId` | `contract-N` | `contracts.ts:83` | `_generateId()` with crypto.randomUUID fallback |
| `nextChallengeId` | `custom-N` | `customChallenges.ts:193` | `_generateId()` |
| `nextDesignId` | `design-N` | `designLibrary.ts:171` | inline in `duplicateDesign()` |
| `nextFlightResultId` | `flight-N` | `flightReturn.ts:316` | `_generateId()` with crypto.randomUUID fallback |
| `nextAsteroidId` | `AST-P-N` | `grabbing.ts:462` | inline, `AST-P-${asteroid.id}-${Date.now()}` |
| `nextCrewId` | `crew-N` | `hubCrew.ts:116` | inline in `hireCrewAtHub()` |
| `nextFieldCraftId` | `fc-N` | `lifeSupport.ts:224` | `_generateId()` with crypto.randomUUID fallback |
| `nextMiningSiteId` | `mining-site-N` | `mining.ts:41` | `generateSiteId()` with crypto.randomUUID fallback |
| `nextMiningModuleId` | `module-N` | `mining.ts:117` | `generateModuleId()` with crypto.randomUUID fallback |
| `nextInventoryId` | `inv-N` | `partInventory.ts:77` | `_generateId()` with crypto.randomUUID fallback |
| `nextRouteId` | `route-N` | `routes.ts:146` | `generateRouteId()` |
| `nextRouteLegId` | `route-leg-N` | `routes.ts:150` | `generateRouteLegId()` |
| `nextProvenLegId` | `proven-leg-N` | `routes.ts:44` | inline in `proveRouteLeg()` |
| `nextSatelliteId` | `sat-N` | `satellites.ts:123` | inline in `deploySatellite()` |
| `nextSurfaceOpId` | `surface-N` | `surfaceOps.ts:58` | module-level `_nextId` counter with `Date.now()` |

### Migration Pattern

Each generator becomes `const id = \`prefix-${state.nextPrefixId++}\`;`. For files with `_generateId()` helpers that had `crypto.randomUUID` fallbacks, the entire helper is deleted. The caller inlines the counter expression.

### Special Cases

- **`grabbing.ts` (asteroids):** Current format `AST-P-${asteroid.id}-${Date.now()}` embeds the parent asteroid ID. New format is `AST-P-${state.nextAsteroidId++}` — the parent relationship is already tracked in the object's data fields.
- **`surfaceOps.ts`:** Currently uses a module-level `_nextId` counter seeded with `Date.now()`. Migrate to `state.nextSurfaceOpId` so the counter persists across saves.
- **`designLibrary.ts`:** `duplicateDesign()` needs a `state: GameState` parameter added to its signature. All callers must be updated.

### SAVE_VERSION

Bump from 5 to 6. Old saves are incompatible (no migration).

### Factory Updates

Both `src/tests/_factories.ts` and `e2e/helpers/_saveFactory.ts` gain all 15 new counter fields initialized to `1`, plus `SAVE_VERSION = 6`.

---

## 4. Shared Geometry & Color Extraction

### Problem

The SVG logistics map (`src/ui/logistics/_routeMap.ts`) and the PixiJS flight map (`src/render/map.ts`) independently implement identical quadratic Bézier curve math and maintain separate, inconsistent body/route color palettes.

### New Module: `src/core/mapGeometry.ts`

A pure-logic TypeScript module with no DOM or rendering dependencies. Exports:

**Bézier utilities:**
- `BEZIER_OFFSET_FACTOR = 0.18`
- `bezierControlPoint(x1, y1, x2, y2, legIndex)` → `{ cx, cy }` — perpendicular offset, alternating direction
- `evalQuadBezier(x1, y1, cx, cy, x2, y2, t)` → `{ x, y }` — evaluate curve at parameter t

**Body colors (single source of truth):**
- `BODY_COLORS: Record<string, string>` — hex map: `{ sun: '#FFD700', earth: '#4488CC', ... }`
- `DEFAULT_BODY_COLOR = '#888888'`
- `getBodyColorHex(bodyId)` → CSS hex string, case-insensitive
- `getBodyColorNum(bodyId)` → numeric value for PixiJS

**Route status colors (consolidated — both maps use the same colors now):**
- `ROUTE_STATUS_COLORS = { active: { hex, num }, paused: { hex, num }, broken: { hex, num } }`
- Active: `#64B4FF` (cyan — chosen over the PixiJS green for distinctness from craft markers)
- Paused: `#666666`
- Broken: `#CC3333`

### Changes to SVG logistics map (`_routeMap.ts`)

- Import `bezierControlPoint`, `getBodyColorHex`, `ROUTE_STATUS_COLORS` from `mapGeometry.ts`
- Delete local `bezierPath()` function — build SVG path string inline from shared control point
- Delete `getBodyColor()` (CSS computed style reader) — replaced by `getBodyColorHex()`
- Delete `--body-color-*` CSS custom properties from `logistics.css`
- Update route status color literals to use `ROUTE_STATUS_COLORS[status].hex`
- Paused routes: use `opacity` attribute instead of `rgba()` since hex colors don't support alpha

If `getBodyColor` is exported and imported by other files, add a re-export alias or update callers.

### Changes to PixiJS flight map (`map.ts`)

- Import `bezierControlPoint`, `evalQuadBezier`, `getBodyColorNum`, `ROUTE_STATUS_COLORS` from `mapGeometry.ts`
- Delete local `_bezierControlPoint()`, `_evalQuadBezier()`, `BEZIER_OFFSET_FACTOR`
- Delete `ROUTE_ACTIVE_COLOR`, `ROUTE_PAUSED_COLOR`, `ROUTE_BROKEN_COLOR` constants
- Keep `PROVEN_LEG_COLOR` (render-specific, not shared)
- Keep all non-route color constants (hub markers, craft, orbits, etc.)
- Update destructuring: old `{ cpx, cpy }` → rename to match `{ cx, cy }` or use `{ cx: cpx, cy: cpy }`

### Unit tests (`mapGeometry.test.ts`)

- Bézier control point: horizontal/diagonal/zero-distance cases, alternating direction
- evalQuadBezier: t=0 returns start, t=1 returns end, t=0.5 returns weighted midpoint
- Body colors: all known bodies present, hex/num consistency, case-insensitive lookup, default for unknown
- Route status colors: all 3 statuses present, hex/num consistency

---

## 5. Testing Strategy

### New Unit Tests

| Test file | What it covers |
|---|---|
| `mapGeometry.test.ts` (new) | Bézier control point math, eval at t=0/0.5/1, color hex/num consistency, route status colors |
| `autoSave.test.ts` (additions) | Slot reuse for same agency, empty slot discovery beyond slot 4 |
| `saveload.test.ts` (additions) | Dynamic slot enumeration, overflow slot discovery, storageKey on summaries, incompatible version handling |
| `ui-helpers.test.ts` (un-skip) | 4 loading indicator DOM tests with jsdom environment |

### Updated Unit Tests

- All tests asserting on old ID formats (regex like `route-\d+-\w+`) updated for `prefix-N` format
- Factory files (`_factories.ts`, `_saveFactory.ts`) gain 15 new `next*Id` counters at `1` and `SAVE_VERSION = 6`

### New E2E Tests

| Spec | What it covers |
|---|---|
| `auto-save.spec.ts` (additions) | Auto-save after flight creates a visible save on the load screen; with 5 manual slots full, auto-save still appears |
| `saveload.spec.ts` (additions) | Slot with old SAVE_VERSION shows warning badge and cannot be loaded |

---

## Technical Decisions

- **Dynamic load screen over fixed slots.** Shows all saves that exist, not an arbitrary cap. Scrolls if needed.
- **Auto-save slot reuse by agency name.** Prevents slot accumulation — one auto-save per game at a time.
- **One counter per entity prefix.** 15 fields is more than grouping would require, but each entity type gets self-documenting IDs (`contract-1`, `crew-3`, `route-5`).
- **No save migration.** Early dev stage. Old saves show a warning badge and fail to load.
- **Shared geometry in `src/core/`.** Pure math module with no rendering dependencies, consistent with the three-layer architecture (core = logic, render = drawing, UI = DOM).
- **Consolidated route colors (cyan).** Chosen over green because cyan is distinct from craft markers and hub markers in the PixiJS map.
- **CSS custom properties removed.** Body colors move from CSS runtime lookups to a static TypeScript map. Simpler, testable, and works in non-DOM contexts (unit tests).
- **`showNotification` in shared `src/ui/notification.ts`.** Used by both `index.ts` (load failures) and `mainmenu.ts` (incompatible save version). Separate from the auto-save toast which has cancel/countdown logic.
