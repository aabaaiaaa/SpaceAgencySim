# Iteration 14 — Cleanup, Auto-Save Fix, Deterministic IDs & Shared Map Geometry

**Date:** 2026-04-15
**Scope:** Review cleanup, auto-save slot visibility bug, Date.now() ID migration, shared geometry/color extraction
**Builds on:** Iteration 13 (bug fixes, coverage hardening, architectural cleanup)

---

## 1. Review Cleanup

Five small items carried forward from the iteration 13 review.

### 1a. Fix Lint Warnings

Remove unused imports `pressStage` and `pressThrottleUp` from `e2e/destinations.spec.ts:32-33`. These are imported from `./helpers.js` but never used.

### 1b. Extract `loadScreen()` Helper + User Error Feedback

The 9 identical catch blocks in `src/ui/index.ts` (lines 344-610) each do `hideLoadingIndicator(); console.error(...)`. Users see the loading indicator vanish with no explanation when a dynamic import fails.

**Changes:**

Create a helper function in `src/ui/index.ts`:

```typescript
async function loadScreen<T>(
  importFn: () => Promise<T>,
  screenName: string
): Promise<T | null> {
  try {
    return await importFn();
  } catch (err) {
    hideLoadingIndicator();
    showNotification(`Failed to load ${screenName}. Please try again.`, 'error');
    console.error(`Failed to load ${screenName}:`, err);
    return null;
  }
}
```

The `showNotification` is a small utility function (added in `src/ui/index.ts` or a shared UI helpers file) that creates a brief DOM toast overlay — a styled `<div>` appended to `document.body` that auto-removes after ~4 seconds. This follows the same visual pattern as the auto-save toast in `autoSaveToast.ts` but is a separate, generic implementation since the auto-save toast has cancel/countdown logic that isn't needed here. Each of the 9 call sites replaces its try/catch with a call to `loadScreen()`. If the import returns null, the navigation aborts — no further setup for that screen runs.

### 1c. Document Altitude Non-Check

Add a code comment above `validateLegChaining` in `src/core/routes.ts:104` explaining that altitude is intentionally not checked because route legs connect bodies and location types, not specific orbits.

### 1d. Un-Skip Loading Indicator Tests

Install `jsdom` as a devDependency. Add `// @vitest-environment jsdom` at the top of `src/tests/ui-helpers.test.ts`. Change `describe.skip` to `describe` for the 4 loading indicator tests (lines 206-234). These tests verify:

1. `showLoadingIndicator()` adds a loading overlay to `document.body`
2. Calling `show` twice is idempotent (reuses the same element)
3. `hideLoadingIndicator()` sets display to none
4. `hide` does not throw when nothing is shown

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
- The load screen slot card shows a version warning badge for incompatible saves.
- Attempting to load an incompatible save fails with a user-visible error message.
- No migration code — this is early dev stage.

---

## 3. Sequential ID Migration

### Problem

14 ID generators across 9 files use `Date.now() + Math.random()`, producing non-deterministic IDs. Hub IDs were migrated to sequential counters in iteration 13. This iteration completes the migration for all remaining entity types, plus one module-level counter in `surfaceOps.ts`.

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

Each generator becomes:

```typescript
const id = `prefix-${state.nextPrefixId++}`;
```

For files that currently use `_generateId()` helper functions with `crypto.randomUUID` fallbacks, the entire helper is replaced with the one-liner above. The `crypto.randomUUID` fallback is no longer needed since the counter is deterministic.

### Special Cases

- **`grabbing.ts` (asteroids):** Current format `AST-P-${asteroid.id}-${Date.now()}` embeds the parent asteroid ID. New format is `AST-P-${state.nextAsteroidId++}` — the parent relationship is already tracked in the object's data fields, so the ID doesn't need to encode it.
- **`surfaceOps.ts`:** Currently uses a module-level `_nextId` counter seeded with `Date.now()`. Migrate to `state.nextSurfaceOpId` so the counter persists across saves and is deterministic from game start.

### SAVE_VERSION

Bump from 5 to 6. Old saves are incompatible (no migration). The load screen shows a version warning on incompatible save slots.

### Factory Updates

Both `src/tests/_factories.ts` and `e2e/helpers/_saveFactory.ts` gain all 15 new counter fields initialized to `1`, plus `SAVE_VERSION = 6`.

---

## 4. Shared Geometry & Color Extraction

### Problem

The SVG logistics map (`src/ui/logistics/_routeMap.ts`) and the PixiJS flight map (`src/render/map.ts`) independently implement identical quadratic Bezier curve math and maintain separate, inconsistent body/route color palettes.

### New Module: `src/core/mapGeometry.ts`

A pure-logic module with no DOM or rendering dependencies. Exports geometry utilities and canonical color data.

#### Bezier Utilities

```typescript
export const BEZIER_OFFSET_FACTOR = 0.18;

/** Compute quadratic Bezier control point with perpendicular offset. */
export function bezierControlPoint(
  x1: number, y1: number,
  x2: number, y2: number,
  legIndex: number
): { cx: number; cy: number };

/** Evaluate quadratic Bezier at parameter t in [0, 1]. */
export function evalQuadBezier(
  x1: number, y1: number,
  cx: number, cy: number,
  x2: number, y2: number,
  t: number
): { x: number; y: number };
```

Both maps currently duplicate this math. After extraction:
- The SVG map builds its SVG path string (`M x1,y1 Q cx,cy x2,y2`) from the shared control point.
- The PixiJS map calls `graphics.quadraticCurveTo()` using the shared control point.
- Neither map contains Bezier math — only rendering calls.

#### Body Color Palette

Single canonical color map. Both hex string and numeric formats derived from the same data:

```typescript
export const BODY_COLORS: Record<string, string> = {
  sun:     '#FFD700',
  earth:   '#4488CC',
  moon:    '#999999',
  mars:    '#CC5533',
  ceres:   '#887766',
  jupiter: '#CC9955',
  saturn:  '#CCBB77',
  titan:   '#AA8844',
};
export const DEFAULT_BODY_COLOR = '#888888';

export function getBodyColorHex(bodyId: string): string;  // Returns '#4488CC'
export function getBodyColorNum(bodyId: string): number;   // Returns 0x4488CC
```

The CSS custom properties (`--body-color-*`) in `logistics.css` are removed. The SVG map calls `getBodyColorHex()` to set SVG fill attributes. The PixiJS map calls `getBodyColorNum()`. Both come from the same `BODY_COLORS` table.

The current `getBodyColor()` in `_routeMap.ts` (which reads CSS computed styles at runtime) is removed.

#### Route Status Colors (Consolidated)

The two maps currently use different route colors. Consolidated to one palette:

| Status | Hex | Numeric | Was (SVG / PixiJS) |
|---|---|---|---|
| Active | `#64B4FF` | `0x64B4FF` | `#64B4FF` / `0x44FF88` |
| Paused | `#666666` | `0x666666` | `rgba(100,180,255,0.4)` / `0x666666` |
| Broken | `#CC3333` | `0xCC3333` | `#CC3333` / `0xFF4444` |

```typescript
export const ROUTE_STATUS_COLORS = {
  active: { hex: '#64B4FF', num: 0x64B4FF },
  paused: { hex: '#666666', num: 0x666666 },
  broken: { hex: '#CC3333', num: 0xCC3333 },
};
```

Both maps import from this table. The PixiJS map's green active route color is replaced with cyan.

#### What Changes in Each Consumer

**`src/ui/logistics/_routeMap.ts`:**
- Imports `bezierControlPoint`, `getBodyColorHex`, `ROUTE_STATUS_COLORS` from `mapGeometry.ts`
- Removes local `bezierPath()` function (builds SVG path string inline from shared control point)
- Removes `getBodyColor()` (CSS computed style reader)
- CSS custom properties `--body-color-*` removed from `logistics.css`

**`src/render/map.ts`:**
- Imports `bezierControlPoint`, `evalQuadBezier`, `getBodyColorNum`, `ROUTE_STATUS_COLORS` from `mapGeometry.ts`
- Removes local `_bezierControlPoint()` and `_evalQuadBezier()`
- Removes local `ROUTE_ACTIVE_COLOR`, `ROUTE_PAUSED_COLOR`, `ROUTE_BROKEN_COLOR` constants
- Hub marker colors (`HUB_SURFACE_COLOR`, `HUB_ORBITAL_COLOR`) and all non-route colors stay local — they're render-specific and don't appear in the SVG map

---

## 5. Testing Strategy

### New Unit Tests

| Test file | What it covers |
|---|---|
| `mapGeometry.test.ts` (new) | Bezier control point math, eval at t=0/0.5/1, color hex/num consistency, all body colors present, route status colors |
| `autoSave.test.ts` (additions) | Slot reuse for same agency, empty slot discovery beyond slot 4, dynamic slot scanning |
| `saveload.test.ts` (additions) | Incompatible SAVE_VERSION rejection, dynamic slot enumeration from storage |
| `ui-helpers.test.ts` (un-skip) | 4 loading indicator DOM tests with jsdom environment |

### Updated Unit Tests

- All tests asserting on old ID formats (regex like `route-\d+-\w+`) updated for `prefix-N` format
- Factory files (`_factories.ts`, `_saveFactory.ts`) gain 15 new `next*Id` counters at `1` and `SAVE_VERSION = 6`

### New E2E Tests

| Spec | What it covers |
|---|---|
| `auto-save.spec.ts` (additions) | Auto-save after flight creates a visible, loadable save on the load screen. With 5 manual slots full, auto-save still appears. |
| `saveload.spec.ts` (additions) | Slot with old SAVE_VERSION shows warning badge and cannot be loaded. |

### Existing Test Updates

- E2E save factory bumped to SAVE_VERSION 6 with all counter fields
- Any E2E tests that rely on specific ID formats updated

---

## Technical Decisions

- **Dynamic load screen over fixed slots.** Shows all saves that exist, not an arbitrary cap. Scrolls if needed.
- **Auto-save slot reuse by agency name.** Prevents slot accumulation — one auto-save per game at a time.
- **One counter per entity prefix.** 15 fields is more than grouping would require, but each entity type gets self-documenting IDs (`contract-1`, `crew-3`, `route-5`).
- **No save migration.** Early dev stage. Old saves show a warning badge and fail to load.
- **Shared geometry in `src/core/`.** Pure math module with no rendering dependencies, consistent with the three-layer architecture (core = logic, render = drawing, UI = DOM).
- **Consolidated route colors (cyan).** Chosen over green because cyan is distinct from craft markers and hub markers in the PixiJS map.
- **CSS custom properties removed.** Body colors move from CSS runtime lookups to a static TypeScript map. Simpler, testable, and works in non-DOM contexts (unit tests).
