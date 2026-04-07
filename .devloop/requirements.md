# Iteration 5 — Worker State Ownership, Performance Dashboard, Coverage & Polish

This iteration addresses all findings from the Iteration 4 code review, refactors the Web Worker physics to sole state ownership (eliminating the dual-state shadow pattern), adds a local-only performance monitoring dashboard, expands test coverage enforcement to the render and UI layers, and closes several small polish gaps.

The codebase is ~60,400 lines of TypeScript across 154 source modules, with ~2,815 unit tests and 38 E2E specs. All work builds on the existing codebase.

---

## 1. Quick Wins (Review Fixes)

### 1.1 Add Timeout to Web Worker Ready Promise

**File:** `src/ui/flightController/_workerBridge.ts:71-122`

`initPhysicsWorker()` creates a Promise that resolves when the worker sends a `'ready'` message. The `onerror` handler rejects on crash, but if the worker hangs without crashing or sending `'ready'` (e.g., an import deadlock or infinite loop during init), the Promise never settles and the flight controller initialization hangs indefinitely.

**Fix:**
- Add a timeout (10 seconds) to the ready Promise
- On timeout, reject the Promise with a descriptive error (e.g., `"Physics worker did not respond within 10s"`)
- The existing fallback logic in the flight controller should catch this rejection and fall back to main-thread physics, logging a warning via the structured logger
- The timeout should be cleared on successful ready or on error (whichever comes first)

**Testing:**
- Unit test: mock a worker that never sends `'ready'` — verify the Promise rejects after the timeout
- Unit test: mock a worker that sends `'ready'` before the timeout — verify the timeout is cleared and doesn't fire

### 1.2 Extract `_escapeHtml()` to Shared Utility

**Current state:** Two independent HTML escaping implementations exist:
- `mainmenu.ts:827-833` — `_escapeHtml()` using regex replacement (escapes `&`, `<`, `>`, `"`)
- `library.ts:587-591` — `_esc()` using a DOM-based approach

There are ~82 `.innerHTML` assignments across 29 UI files. Most inject static templates or numeric values. Files with user-controlled data (`mainmenu.ts`, `library.ts`) already escape, but the escaping function is private to each module.

**Fix:**
- Create `src/ui/escapeHtml.ts` exporting an `escapeHtml()` function (use the regex approach from `mainmenu.ts` — it's simpler and doesn't depend on DOM availability for testing)
- Update `mainmenu.ts` to import from the shared utility, removing the local `_escapeHtml()`
- Update `library.ts` to import from the shared utility, removing the local `_esc()`
- Audit all 82 innerHTML assignments and confirm no unescaped user-controlled data is injected. The audit results should be recorded in a code comment at the top of `escapeHtml.ts` (e.g., "Audited 2026-04-07: all user-controlled innerHTML data is escaped")

**Files with user-controlled innerHTML data (must use escapeHtml):**
- `mainmenu.ts` — save names, agency names (already escaping)
- `library.ts` — crew names (already escaping)
- `crewAdmin.ts` — crew names are set via `.textContent` (safe), no innerHTML risk currently

### 1.3 Fix Remaining Inline Styles

Three locations still use inline style assignments instead of CSS classes:

1. **`crewAdmin.ts:701`** — `slotMsg.style.padding = '6px 0 12px'`
2. **`crewAdmin.ts:709`** — `msg.style.padding = '12px 0'`
3. **`missionControl/_contractsTab.ts:90`** — `repBar.innerHTML` contains hardcoded inline styles for reputation tier display

**Fix:**
- For `crewAdmin.ts`: add CSS classes (e.g., `.crew-slot-msg`, `.crew-empty-msg`) in `crewAdmin.css` and use `classList.add()` instead of `.style.padding`
- For `_contractsTab.ts`: extract inline styles from the `repBar.innerHTML` template into CSS classes in the module's CSS file, using design token custom properties where applicable
- The `flightHud.ts` dynamic inline styles (~20 instances for throttle bar height, TWR color, etc.) are **acceptable** — they set per-frame computed values where CSS classes would add unnecessary complexity

### 1.4 Add Vite Client Type Reference to Logger

**File:** `src/core/logger.ts:17`

Currently: `const _meta = import.meta as unknown as { env?: { PROD?: boolean } };`

This `as unknown as` cast exists because TypeScript doesn't know about Vite's `import.meta.env`. Adding a Vite client type reference eliminates the need for the cast entirely.

**Fix:**
- Add `/// <reference types="vite/client" />` at the top of `logger.ts`
- Replace the cast with direct `import.meta.env.PROD` access
- Remove the `_meta` intermediate variable if it's only used for this purpose

### 1.5 Document Empty Catalog Pattern in Worker Init

**File:** `src/ui/flightController/_workerBridge.ts:113-114`

The init command sends `partsCatalog: []` and `bodiesCatalog: {}` despite the protocol types suggesting catalogs are transmitted. The worker imports catalogs directly via ES module imports (Vite bundles them into the worker).

**Fix:**
- Add a clear code comment at the init command site explaining: "Catalogs sent as empty placeholders — the worker imports them directly via ES module imports. Vite's worker bundling includes the catalog modules in the worker bundle. The protocol types include these fields for potential future use with non-Vite bundlers."
- Update the protocol types to make `partsCatalog` and `bodiesCatalog` optional fields on the init command (with `?`), so the empty values are explicitly optional rather than misleadingly populated

### 1.6 Log IndexedDB Mirror Write Failures

**Current state:** IndexedDB mirror writes (when localStorage is primary) use `.catch(() => {})` which silently swallows failures. This means persistent IDB write failures go undetected.

**Fix:**
- Replace the silent `.catch(() => {})` on IDB mirror writes with `.catch(err => logger.debug('saveload', 'IDB mirror write failed', err))`
- This ensures failures are visible during development (when log level includes debug) without alarming players in production

---

## 2. Coverage Expansion

### 2.1 Extend Coverage Thresholds to Render and UI Layers

**Current state:** Coverage is only enforced on `src/core/**` with thresholds: lines 89%, branches 80%, functions 91%. The render layer (`src/render/`, ~5,900 lines) and UI layer (`src/ui/`, ~28,000 lines) — comprising ~55% of the codebase — have no coverage enforcement.

**Target thresholds for new layers:**
- `src/render/`: 50% lines, 40% branches
- `src/ui/`: 50% lines, 40% branches

**Approach:**
1. First, measure current coverage for render and UI layers by adding them to the coverage `include` pattern
2. Identify which render/UI modules are most testable in a Node.js/Vitest environment (pure logic, state transforms, utility functions) vs. those that are DOM/canvas-dependent
3. Write targeted unit tests for the testable modules to reach the thresholds
4. Set the thresholds in `vite.config.js`

**Testable render modules (pure logic or minimal DOM):**
- `pool.ts` — already tested (289 lines of tests)
- Render utility/helper functions
- State snapshot transformations
- Any pure calculation functions in render modules

**Testable UI modules (logic extractable from DOM):**
- Event handler logic
- State management functions
- Utility functions in UI sub-modules
- Validation logic

**Note:** Some render/UI code is inherently DOM/canvas-dependent and can only be tested via E2E. The 50%/40% floor is set to be achievable without requiring DOM mocking gymnastics. Focus tests on logic, not on canvas drawing calls.

---

## 3. Worker Sole State Ownership

### 3.1 Architecture Overview

**Current state (dual-state shadow pattern):**
- The worker owns mutable `PhysicsState`, `FlightState`, `RocketAssembly`, and `StagingConfig`
- The main thread maintains **full mutable copies** of these in `FCState`
- Each frame, `applyPhysicsSnapshot()` copies ~40+ fields from the worker's snapshot into the main-thread's mutable copies
- Render and UI code reads from the main-thread copies
- Control inputs (throttle, angle) are main-thread authority — updated locally and sent to the worker

**Target state (sole ownership):**
- The worker remains the sole owner of mutable physics state
- The main thread stores **only** the latest readonly snapshot — no mutable `PhysicsState` or `FlightState` objects
- Render and UI code reads directly from the readonly snapshot
- Control inputs remain main-thread authority, stored separately from the snapshot
- The `applyPhysicsSnapshot()` and `applyFlightSnapshot()` functions are removed entirely

### 3.2 Readonly Snapshot as Single Source of Truth

**Main-thread state model:**
- `FCState` replaces its mutable `ps: PhysicsState` and `flightState: FlightState` with a single `snapshot: ReadonlyFlightSnapshot` (or similar composite type)
- The snapshot type should be defined to include all fields that render and UI code needs
- Control inputs (`throttle`, `angle`) are stored separately in FCState since they're main-thread authority and must not be overwritten by incoming snapshots

**Snapshot reception:**
- `_workerBridge.ts` stores the incoming snapshot object directly — no field-by-field copy
- `consumeSnapshot()` returns the snapshot object (or null if none available)
- The flight loop reads the snapshot and passes it to render/UI functions

### 3.3 Render and UI Migration

All render and UI code that currently reads `ps.x`, `ps.altitude`, `flightState.phase`, etc. from the mutable FCState objects must be updated to read from the readonly snapshot.

**Key areas to update:**
- `_loop.ts` — pass snapshot to render functions instead of mutable state objects
- Flight render functions (`src/render/flight/`) — accept snapshot parameters
- `flightHud.ts` — read HUD values from snapshot
- `_mapView.ts` — read orbital data from snapshot
- `_keyboard.ts` — read phase/state for input handling
- `_docking.ts` — read docking state from snapshot
- `_postFlight.ts` — read mission results from snapshot

**Approach:** Since render functions already receive state as parameters (not via global import), the migration is primarily a parameter type change at each call site. The snapshot type should be structured so that property access patterns remain similar (e.g., `snapshot.physics.altitude` instead of `ps.altitude`), minimizing the diff.

### 3.4 Main-Thread Fallback

When the Web Worker is disabled (setting or browser doesn't support it), physics runs on the main thread via `tick()`. The fallback path must produce readonly snapshots in the same format as the worker.

**Fix:**
- Create a `createSnapshotFromState()` function that takes the mutable state (used only in the fallback path) and produces a readonly snapshot
- The main-thread fallback calls `tick()`, then `createSnapshotFromState()`, and the rest of the pipeline is identical
- This means render/UI code has a single code path regardless of worker vs. main-thread physics

### 3.5 Removing Dual State

After all consumers read from the snapshot:
- Remove `applyPhysicsSnapshot()` and `applyFlightSnapshot()` from `_workerBridge.ts`
- Remove mutable `ps`, `flightState` from `FCState` (keep `assembly` and `stagingConfig` if they're not part of the physics snapshot)
- Remove any imports of `PhysicsState` / `FlightState` types from UI/render modules that no longer need them

**Testing:**
- Existing physics unit tests are unaffected (they test core functions, not the bridge)
- Existing E2E flight tests verify the full pipeline end-to-end
- New unit tests should verify:
  - `createSnapshotFromState()` produces correct snapshot from mutable state
  - Snapshot storage/consumption in the bridge (direct storage, no copy)
  - Main-thread fallback produces snapshots identical to worker snapshots
  - Control inputs (throttle/angle) are not overwritten by snapshot consumption

---

## 4. Performance Monitoring Dashboard

### 4.1 Performance Monitor Module

Create a core performance monitoring module that collects metrics during gameplay.

**Metrics to collect:**
- **FPS:** current, rolling average (last 60 frames), minimum (last 60 frames)
- **Frame time:** current frame duration in ms, histogram buckets (0-8ms, 8-16ms, 16-33ms, 33ms+)
- **Worker round-trip latency:** time from snapshot request to snapshot received (only when worker physics is active)
- **Memory:** JS heap size (via `performance.memory` where available — Chrome only, graceful no-op on other browsers)

**Design:**
- Module at `src/core/perfMonitor.ts`
- Lightweight — metrics collection must not measurably impact frame times
- Uses a fixed-size circular buffer for history (no growing arrays)
- Exposes `beginFrame()` / `endFrame()` lifecycle hooks and a `getMetrics()` function returning a snapshot of current values
- The monitor is always running when enabled but does no DOM work — it only collects numbers

### 4.2 Performance Dashboard UI

Create an overlay panel that visualizes the performance metrics.

**Layout:**
- Semi-transparent overlay in the top-right corner of the game view (similar to debug overlays in game engines)
- Small footprint — should not obscure gameplay
- Displays: FPS counter (large), frame time (ms), worker latency (ms), memory (MB)
- Frame time histogram as a simple bar chart (4 bars for the 4 buckets)
- Updates every 500ms (not every frame) to avoid the overlay itself being a performance cost

**Toggle:**
- Accessible via the settings/debug menu
- Bound to a keyboard shortcut (e.g., F3 or similar, check for conflicts)
- State stored in `GameState.settings` (persists across sessions)

### 4.3 Integration Points

- **Flight loop** (`_loop.ts`): call `beginFrame()` at loop start, `endFrame()` at loop end
- **Worker bridge** (`_workerBridge.ts`): record snapshot send/receive timestamps for latency calculation
- **Hub loop** and **VAB loop**: also instrument with `beginFrame()`/`endFrame()` if they have render loops

### 4.4 Settings Integration

- Add `showPerfDashboard: boolean` to the settings in `GameState`
- Default to `false`
- Save/load with the game (it's a setting, follows existing settings persistence)
- The dashboard CSS/HTML is only injected when enabled (lazy creation)

---

## 5. Testing

### 5.1 Tests for New Code

All new code introduced in this iteration needs tests:

- **Worker ready timeout** — timeout fires and rejects, timeout cleared on success
- **escapeHtml utility** — escapes all special characters, handles edge cases (empty string, already-escaped input, non-string input)
- **Performance monitor** — FPS calculation, frame time histogram bucketing, circular buffer overflow, getMetrics() snapshot accuracy
- **Readonly snapshot consumption** — direct storage, no mutation, control inputs preserved
- **createSnapshotFromState()** — correct field mapping from mutable state to readonly snapshot
- **Main-thread fallback snapshot generation** — produces same format as worker snapshots

### 5.2 Render/UI Layer Tests for Coverage

Write targeted unit tests to bring the render and UI layers to the 50%/40% threshold. Focus on:
- Pure logic functions in render/UI modules
- State transformation helpers
- Event handler logic (extracted from DOM)
- Validation and calculation functions

---

## 6. Verification

After all changes are complete, run:

1. `npm run typecheck` — no errors
2. `npm run lint` — no errors
3. `npm run test:unit` — all tests pass
4. `npm run test:e2e` — all E2E specs pass
5. `npm run build` — production build succeeds
6. Coverage meets or exceeds thresholds for all three layers (core, render, UI)
7. Manual verification: start a flight with worker physics — verify the performance dashboard toggles on/off, HUD displays correct values from readonly snapshots, time-warp performance is smooth. Verify the worker timeout by temporarily breaking the worker init (should fall back to main-thread physics within 10s). Open the save/load screen and verify the flow still works with the async save pipeline.
