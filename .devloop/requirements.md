# Iteration 15 — Bug Fixes, Stabilization & Test Coverage

**Date:** 2026-04-15
**Scope:** Overflow save bug fix, E2E stabilization, notification guard, helper extraction, import cleanup
**Builds on:** Iteration 14 (deterministic IDs, dynamic save slots, shared map geometry)
**Review driving this iteration:** `.devloop/archive/iteration-14/review.md`

---

## 1. Fix Overflow Save Load/Export (BUG-1)

### The Bug

The dynamic save slot UI (iteration 14) correctly discovers and renders overflow saves (slots 5-99 and `spaceAgencySave_auto`), but the Load and Export actions fail for these saves. `loadGame()` and `exportSave()` in `saveload.ts` call `assertValidSlot(slotIndex)` which rejects any slot outside 0-4. Overflow save cards use `slotIndex = -1` with a separate `storageKey` field, but the storage key is never passed through to the core functions.

Delete already works — `deleteSave()` accepts an optional `storageKey` parameter and bypasses slot validation when it's provided. Load and Export were not updated to match.

### The Flow (Current — Broken)

1. **Load button:** `_handleLoad(-1, 'spaceAgencySave_7')` does the version check using the storage key correctly, then calls `loadGame(-1)`. `loadGame()` calls `assertValidSlot(-1)` → throws `RangeError`. User sees "Failed to load save: Save slot -1 is out of bounds..."
2. **Export button:** `_handleExport(-1, _storageKey)` calls `exportSave(-1)`. Same `assertValidSlot` failure. Note: `_storageKey` is prefixed with underscore — it's explicitly unused.
3. **Delete button:** Works — `deleteSave(-1, 'spaceAgencySave_7')` accepts and uses the `storageKey` parameter.

### Fix: saveload.ts

Add an optional `storageKey?: string` parameter to both `loadGame()` and `exportSave()`, following the exact same pattern as `deleteSave()`:

```typescript
// deleteSave already does this:
export function deleteSave(slotIndex: number, storageKey?: string): void {
  const key = storageKey ?? (assertValidSlot(slotIndex), slotKey(slotIndex));
  // ...
}

// Apply the same pattern to loadGame and exportSave:
export async function loadGame(slotIndex: number, storageKey?: string): Promise<GameState> {
  const key = storageKey ?? (assertValidSlot(slotIndex), slotKey(slotIndex));
  // ... use `key` instead of `slotKey(slotIndex)` throughout
}

export function exportSave(slotIndex: number, storageKey?: string): void {
  const key = storageKey ?? (assertValidSlot(slotIndex), slotKey(slotIndex));
  // ... use `key` instead of `slotKey(slotIndex)` throughout
}
```

When `storageKey` is provided, use it directly (skip `assertValidSlot` + `slotKey` derivation). When not provided, validate slot index and derive key as before. Fully backward compatible.

### Fix: mainmenu.ts

**`_handleLoad()`** (around line 599): Pass `storageKey` through to `loadGame()`:
```typescript
const state = await loadGame(slotIndex, storageKey);
```

**`_handleExport()`** (around line 634): Rename `_storageKey` to `storageKey` and pass it through:
```typescript
function _handleExport(slotIndex: number, storageKey?: string): void {
  exportSave(slotIndex, storageKey);
}
```

### Tests

**Unit tests in `saveload.test.ts`:**
- Round-trip: write a save to slot 7, then `loadGame(-1, 'spaceAgencySave_7')` — returns valid GameState
- Round-trip: write to `spaceAgencySave_auto` key, load via storage key — returns valid GameState
- Export from overflow slot: `exportSave(-1, 'spaceAgencySave_7')` produces a downloadable blob (mock `URL.createObjectURL`)
- Backward compatibility: `loadGame(0)` (no storage key) still works for manual slots

**E2E test in `auto-save.spec.ts`:**
- Seed 5 full manual slots + trigger auto-save after a flight
- Verify the auto-save card appears in the load screen (existing test)
- Click Load on the auto-save card
- Verify the game starts: hub overlay visible, agency name matches the seeded save

---

## 2. Stabilize Flaky Asteroid Belt E2E Test

### The Problem

`e2e/asteroid-belt.spec.ts:386` — test "belt zones are defined on the Sun body with correct boundaries" failed once and passed on retry during the iteration 14 smoke run. Pre-existing intermittent failure, not a regression.

### Root Cause Analysis

The test calls `page.evaluate()` to read `window.__celestialBodies?.SUN` immediately after `seedAndLoadSave()` returns. `seedAndLoadSave()` waits for the hub overlay to appear, but `__celestialBodies` may not be fully populated at that point — it's a race condition between the hub UI rendering and the celestial body data initialization.

### Fix

Add `page.waitForFunction(() => window.__celestialBodies?.SUN?.altitudeBands?.length > 0)` before the `page.evaluate()` call that reads belt zone data. This ensures the Sun body's altitude bands are loaded before asserting on their contents.

The wait should use a reasonable timeout (10 seconds) to avoid masking real failures with infinite waits.

---

## 3. Notification Stacking Guard

### The Problem

`showNotification()` in `src/ui/notification.ts` creates toasts at a fixed position (`bottom: 24px`, `left: 50%`). If multiple notifications fire in rapid succession, they overlap at the same position. Only the topmost toast is readable.

### Fix

Before creating a new toast, remove any existing toast. This ensures only one notification is visible at a time.

**Implementation in `notification.ts`:**
1. Add a `data-notification-toast` attribute to the toast `<div>` when creating it
2. At the top of `showNotification()`, query for any existing toast: `document.querySelector('[data-notification-toast]')?.remove()`
3. This removes the previous toast (including cancelling its visual presence) before showing the new one

The fade-out timeout from the removed toast will fire on a detached element — `toast.remove()` on an already-removed element is a no-op, so no cleanup is needed.

---

## 4. Extract & Test Pure Helpers for Coverage

The iteration 14 review noted render coverage at 34% and UI coverage at 43%. `vite.config.ts:110-121` identifies 10 extractable helpers. `computeStageDeltaV` was already extracted in a prior iteration. This iteration extracts 2 more.

### 4a. Export cloneStaging / restoreStaging

**File:** `src/ui/vab/_undoActions.ts`

These two functions are already pure (no DOM access, no global state reads). They operate on `StagingConfig` objects:

- `cloneStaging(config)` — deep-copies a staging config (maps stages, spreads arrays, copies scalar)
- `restoreStaging(target, source)` — overwrites target in-place from source (preserves object reference for VAB state)

**Changes:**
- Export both functions from `_undoActions.ts`
- Re-export from the `src/ui/vab.ts` barrel (or from `_undoActions.ts` directly if the barrel doesn't re-export internals)
- Add unit tests in a new `src/tests/undoActions.test.ts`:
  - `cloneStaging`: produces independent copy; mutating original doesn't affect clone; handles empty stages array; handles empty unstaged array
  - `restoreStaging`: overwrites target properties; preserves target object reference; handles empty config

### 4b. Extract computeFrameStats from fpsMonitor.ts

**File:** `src/ui/fpsMonitor.ts`

The stats computation in `recordFrame()` (lines 138-149) is a pure loop over a `Float64Array`:

```typescript
let sum = 0, min = Infinity, max = 0;
for (let i = 0; i < count; i++) {
  const t = _frameTimes[i];
  sum += t; if (t < min) min = t; if (t > max) max = t;
}
const avgFrameTime = sum / count;
const fps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
```

**Changes:**
- Extract into a named export: `export function computeFrameStats(frameTimes: Float64Array, count: number): { fps: number; avgFrameTime: number; minFrameTime: number; maxFrameTime: number }`
- `recordFrame()` calls `computeFrameStats(_frameTimes, _frameCount)` instead of inlining the loop
- Add unit tests in a new `src/tests/fpsMonitor.test.ts`:
  - Empty buffer (count = 0): returns zeros
  - Single frame: fps = 1000/frameTime
  - Full buffer with varying times: correct min/max/avg
  - Constant frame times: min === max === avg

---

## 5. Fix Mixed Dynamic/Static Import Warnings

### The Problem

Vite produces chunk-splitting warnings for `src/render/vab.ts` and `src/ui/vab.ts` because both are imported statically by some modules and dynamically by others. This creates ambiguous code-splitting boundaries.

### Analysis

**`src/ui/vab.ts`** has two static importers that can be deferred:

| File | Function | Called when | Can defer? |
|------|----------|------------|-----------|
| `src/ui/topbar.ts:33` | `syncVabToGameState()` | Explicit save action | Yes — save is a user action, not app init |
| `src/ui/flightController/_init.ts:20` | `getVabInventoryUsedParts()` | Flight start | Yes — VAB module is already loaded by then |

**`src/render/vab.ts`** has one static importer and one redundant dynamic importer:

| File | Function | Import type | Issue |
|------|----------|-------------|-------|
| `src/main.ts:7` | `initVabRenderer()` | Static | Necessary — creates hidden PixiJS scene at startup |
| `src/ui/index.ts:341` | (all exports) | Dynamic | Redundant — module is already loaded via static import |

### Fix for src/ui/vab.ts — Convert Static Imports to Dynamic

**In `src/ui/topbar.ts`:**
- Remove the static import of `syncVabToGameState` at the top of the file
- At the call site (around line 979), use a dynamic import:
  ```typescript
  const { syncVabToGameState } = await import('./vab.ts');
  syncVabToGameState();
  ```
- The containing function is likely already async (it calls `saveGame()` which returns a Promise). If not, make the save handler async.

**In `src/ui/flightController/_init.ts`:**
- Remove the static import of `getVabInventoryUsedParts` at the top
- At the call site (around line 180), use a dynamic import:
  ```typescript
  const { getVabInventoryUsedParts } = await import('../vab.ts');
  ps._usedInventoryParts = getVabInventoryUsedParts();
  ```
- The containing function (`startFlightScene`) is likely already async. If not, make it async.

### Fix for src/render/vab.ts — Remove Redundant Dynamic Import

**In `src/ui/index.ts`:**
- Remove `render/vab.ts` from the dynamic `Promise.all` import on line 341
- Import the needed render/vab exports directly (the module is already in the bundle via `main.ts`)
- Update `_cachedVabRender` usage — it's no longer needed since the module is always available
- The `_cachedVab` pattern for `ui/vab.ts` stays as-is (it's correctly lazy-loaded)

### Result

After these changes:
- `src/render/vab.ts` — static import only (in `main.ts` + its VAB submodule consumers). No dynamic import.
- `src/ui/vab.ts` — dynamic import only (in `index.ts`, `hub.ts` preload, `topbar.ts` on save, `_init.ts` on flight start). No static import.
- Vite chunk-splitting warnings eliminated.

---

## Testing Strategy

### New Unit Tests

| Test file | What it covers |
|---|---|
| `saveload.test.ts` (additions) | Overflow slot load round-trip, overflow export, backward compat |
| `undoActions.test.ts` (new) | cloneStaging independence, restoreStaging in-place mutation, edge cases |
| `fpsMonitor.test.ts` (new) | computeFrameStats with empty/single/full/varied buffers |

### Updated E2E Tests

| Spec | What it covers |
|---|---|
| `auto-save.spec.ts` (addition) | Click Load on overflow save card, verify game starts |
| `asteroid-belt.spec.ts` (fix) | Add waitForFunction before reading celestial body data |

### No New E2E Specs

All E2E changes are additions to existing specs or fixes to existing tests. No new spec files needed.

---

## Technical Decisions

- **Same pattern as deleteSave.** Applying the identical `storageKey ?? (assertValidSlot, slotKey)` pattern to loadGame and exportSave. Consistent, minimal diff, backward compatible.
- **Replace existing toast, not stack.** Simpler, prevents visual clutter. Multiple simultaneous notifications are unlikely in normal gameplay.
- **Export existing pure functions, don't rewrite.** `cloneStaging`/`restoreStaging` are already pure — just need export and tests. No refactoring.
- **Extract computeFrameStats in-place.** The function stays in `fpsMonitor.ts` as a named export. No need for a separate utility file for one function.
- **Dynamic imports for VAB UI consumers.** Both `topbar.ts` and `_init.ts` call VAB functions in async contexts (save action, flight start). Dynamic import adds negligible latency since the module is preloaded.
- **Remove redundant render/vab.ts dynamic import.** Since `main.ts` already loads it statically, the dynamic import in `index.ts` is a no-op that generates warnings.
