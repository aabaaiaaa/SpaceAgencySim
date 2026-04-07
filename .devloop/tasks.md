# Iteration 5 — Tasks

## Quick Wins (Review Fixes)

### TASK-001: Add timeout to Web Worker ready Promise
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/ui/flightController/_workerBridge.ts`, the `initPhysicsWorker()` ready Promise (lines 71-122) can hang indefinitely if the worker never sends `'ready'`. Add a 10-second `setTimeout` that rejects the Promise with `"Physics worker did not respond within 10s"`. Clear the timeout on successful `'ready'` or `onerror`. The flight controller's existing fallback logic catches the rejection and falls back to main-thread physics. Log a warning via `logger.warn()` on timeout. See requirements Section 1.1.
- **Verification**: `npx vitest run src/tests/workerBridge.test.ts`

### TASK-002: Extract _escapeHtml to shared utility
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/ui/escapeHtml.ts` exporting `escapeHtml(str: string): string` using the regex approach from `mainmenu.ts:827-833` (escapes `&`, `<`, `>`, `"`). Update `mainmenu.ts` to import from the shared utility and remove its local `_escapeHtml()`. Update `library.ts` to import from the shared utility and remove its local `_esc()`. Add a comment at the top of `escapeHtml.ts` documenting the innerHTML audit results. See requirements Section 1.2.
- **Verification**: `npx vitest run src/tests/escapeHtml.test.ts && npx vitest run src/tests/mainmenu.test.ts && npx vitest run src/tests/library.test.ts`

### TASK-003: Fix remaining inline styles in crewAdmin and contractsTab
- **Status**: done
- **Dependencies**: none
- **Description**: In `crewAdmin.ts:701,709`, replace `.style.padding` assignments with CSS classes in `crewAdmin.css` (e.g., `.crew-slot-msg { padding: 6px 0 12px }`, `.crew-empty-msg { padding: 12px 0 }`), using `classList.add()`. In `missionControl/_contractsTab.ts:90`, extract hardcoded inline styles from the `repBar.innerHTML` template into CSS classes in the module's CSS file, using design token custom properties where applicable. See requirements Section 1.3.
- **Verification**: `npx vitest run src/tests/crewAdmin.test.ts && npm run typecheck -- --noEmit src/ui/crewAdmin.ts src/ui/missionControl/_contractsTab.ts`

### TASK-004: Add Vite client type reference to logger.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/core/logger.ts`, add `/// <reference types="vite/client" />` at the top of the file. Replace the `as unknown as { env?: { PROD?: boolean } }` cast at line 17 with direct `import.meta.env.PROD` access. Remove the `_meta` intermediate variable if it was only used for this purpose. See requirements Section 1.4.
- **Verification**: `npm run typecheck -- --noEmit src/core/logger.ts && npx vitest run src/tests/logger.test.ts`

### TASK-005: Document empty catalog pattern and log IDB mirror failures
- **Status**: pending
- **Dependencies**: none
- **Description**: Two small fixes. (1) In `_workerBridge.ts:113-114`, add a code comment explaining that catalogs are sent as empty placeholders because the worker imports them directly via ES module imports. Make `partsCatalog` and `bodiesCatalog` optional (`?`) in the init command type in `physicsWorkerProtocol.ts`. (2) In `saveload.ts`, replace silent `.catch(() => {})` on IndexedDB mirror writes with `.catch(err => logger.debug('saveload', 'IDB mirror write failed', err))`. See requirements Sections 1.5 and 1.6.
- **Verification**: `npm run typecheck -- --noEmit src/ui/flightController/_workerBridge.ts src/core/physicsWorkerProtocol.ts src/core/saveload.ts && npx vitest run src/tests/physicsWorker.test.ts`

## Coverage Expansion

### TASK-006: Measure current render/UI coverage and identify testable modules
- **Status**: pending
- **Dependencies**: none
- **Description**: Add `src/render/**` and `src/ui/**` to the coverage `include` pattern in `vite.config.js` (alongside the existing `src/core/**`). Run `npx vitest run --coverage` and record the current line/branch percentages for render and UI layers. Identify the top 10 most testable modules in each layer (pure logic, minimal DOM dependency) by reviewing uncovered files. Document findings as code comments in the vite.config.js coverage section to guide subsequent test-writing tasks. Do NOT set thresholds yet — that comes after tests are written.
- **Verification**: `npx vitest run --coverage 2>&1 | head -50`

### TASK-007: Write unit tests for render layer modules
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: Write targeted unit tests for testable modules in `src/render/` to reach 50% line coverage and 40% branch coverage. Focus on pure logic and utility functions — do NOT mock PixiJS canvas operations. Candidates include: `pool.ts` (already tested, extend if gaps), render helper/utility functions, state snapshot transformations, and any pure calculation functions. Create test files in `src/tests/` following existing naming conventions. See requirements Section 2.1.
- **Verification**: `npx vitest run --coverage 2>&1 | grep -A5 "src/render"`

### TASK-008: Write unit tests for UI layer modules
- **Status**: pending
- **Dependencies**: TASK-006
- **Description**: Write targeted unit tests for testable modules in `src/ui/` to reach 50% line coverage and 40% branch coverage. Focus on extractable logic: event handler calculations, state management, utility functions, validation logic. Do NOT attempt to mock complex DOM trees. Candidates include: `escapeHtml.ts`, flight controller logic helpers, mission control calculation functions, and any UI utility modules. Create test files in `src/tests/` following existing naming conventions. See requirements Section 2.1.
- **Verification**: `npx vitest run --coverage 2>&1 | grep -A5 "src/ui"`

### TASK-009: Set coverage thresholds for render and UI layers
- **Status**: pending
- **Dependencies**: TASK-007, TASK-008
- **Description**: In `vite.config.js`, configure separate coverage thresholds for `src/render/` and `src/ui/` at 50% lines and 40% branches. Keep the existing `src/core/` thresholds unchanged (89% lines, 80% branches, 91% functions). Use Vitest's per-directory threshold configuration. Verify all three layers pass their respective thresholds.
- **Verification**: `npx vitest run --coverage`

## Worker Sole State Ownership

### TASK-010: Define composite readonly snapshot type for main-thread consumption
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/core/physicsWorkerProtocol.ts`, define a `MainThreadSnapshot` type (or similar) that composites the physics and flight snapshot data into the structure that render/UI code will consume. This type should include all fields currently read by render/UI code from `PhysicsState` and `FlightState`. Control inputs (`throttle`, `angle`) must NOT be part of this snapshot — they remain main-thread authority. Also create a `createSnapshotFromState()` function (in a new file `src/core/snapshotFactory.ts` or in the protocol file) that converts mutable `PhysicsState` + `FlightState` into a `MainThreadSnapshot` — this is needed for the main-thread fallback path. See requirements Sections 3.1-3.2.
- **Verification**: `npm run typecheck -- --noEmit src/core/physicsWorkerProtocol.ts src/core/snapshotFactory.ts`

### TASK-011: Refactor _workerBridge.ts to store readonly snapshot directly
- **Status**: pending
- **Dependencies**: TASK-010
- **Description**: In `_workerBridge.ts`, replace the field-by-field `applyPhysicsSnapshot()` and `applyFlightSnapshot()` functions with direct snapshot storage. When a snapshot arrives from the worker, store the `MainThreadSnapshot` object directly (no copy). Update `consumeSnapshot()` to return the `MainThreadSnapshot` (or null). Keep the existing snapshot sequencing logic (frame counter). Do NOT remove the old apply functions yet — they'll be removed after all consumers are migrated. See requirements Section 3.2.
- **Verification**: `npm run typecheck -- --noEmit src/ui/flightController/_workerBridge.ts && npx vitest run src/tests/workerBridge.test.ts`

### TASK-012: Refactor _loop.ts to pass readonly snapshot to render/UI
- **Status**: pending
- **Dependencies**: TASK-011
- **Description**: In `_loop.ts`, change the frame processing to use the readonly snapshot from `consumeSnapshot()` instead of reading from mutable `ps` and `flightState` in FCState. Pass the snapshot (or its sub-objects) to render functions (`renderFlightFrame`, `renderMapFrame`) and UI update functions. Control inputs (throttle, angle) should still be read from their separate storage in FCState. For the main-thread fallback (no worker), call `createSnapshotFromState()` after `tick()` to produce a snapshot in the same format. Phase transition detection should compare old vs. new snapshot phase values. See requirements Sections 3.3-3.4.
- **Verification**: `npm run typecheck -- --noEmit src/ui/flightController/_loop.ts && npx playwright test e2e/flight.spec.js e2e/phase-transitions.spec.js`

### TASK-013a: Update flight render functions to accept readonly snapshots
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: Update all flight render functions in `src/render/flight/` to accept readonly snapshot types instead of mutable `PhysicsState`/`FlightState`. This includes the barrel export at `src/render/flight.ts` and sub-modules: rocket, camera, sky, trails, debris, etc. Update `renderFlightFrame()` and `renderMapFrame()` signatures and all internal reads. Since these functions already receive state as parameters, the change is primarily parameter type updates. See requirements Section 3.3.
- **Verification**: `npm run typecheck -- --noEmit src/render/flight.ts && npx playwright test e2e/flight.spec.js e2e/landing.spec.js`

### TASK-013b: Update map render to accept readonly snapshots
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: Update `src/render/map.ts` (and any sub-modules) to accept readonly snapshot types instead of mutable state. Update all parameter types and internal reads. The map view reads orbital data and body positions — ensure the snapshot type provides these fields. See requirements Section 3.3.
- **Verification**: `npm run typecheck -- --noEmit src/render/map.ts && npx playwright test e2e/orbital-operations.spec.js`

### TASK-014a: Update flightHud and flightController UI to read from readonly snapshot
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: Update `src/ui/flightHud.ts` and flightController sub-modules (`_keyboard.ts`, `_docking.ts`, `_postFlight.ts`, `_mapView.ts`) to read from the readonly snapshot instead of mutable state objects. The HUD displays altitude, velocity, fuel, TWR, phase, etc. — all must come from the snapshot. Control inputs (throttle, angle) continue to be read/written from FCState's separate control storage. See requirements Section 3.3.
- **Verification**: `npm run typecheck -- --noEmit src/ui/flightHud.ts src/ui/flightController/_keyboard.ts src/ui/flightController/_docking.ts && npx playwright test e2e/flight.spec.js e2e/collision.spec.js`

### TASK-014b: Remove dual state — clean up FCState and delete apply functions
- **Status**: pending
- **Dependencies**: TASK-013a, TASK-013b, TASK-014a
- **Description**: Now that all consumers read from the readonly snapshot: (1) Remove `applyPhysicsSnapshot()` and `applyFlightSnapshot()` from `_workerBridge.ts`. (2) Remove mutable `ps: PhysicsState` and `flightState: FlightState` from `FCState` in `_state.ts`. (3) Remove imports of `PhysicsState`/`FlightState` from any UI/render modules that no longer need them. (4) Verify no code path still attempts to read from the old mutable state. See requirements Section 3.5.
- **Verification**: `npm run typecheck && npx vitest run src/tests/workerBridge.test.ts && npx playwright test e2e/flight.spec.js e2e/phase-transitions.spec.js e2e/orbital-operations.spec.js`

## Performance Monitoring Dashboard

### TASK-015: Create performance monitor module
- **Status**: pending
- **Dependencies**: none
- **Description**: Create `src/core/perfMonitor.ts` with: (1) A fixed-size circular buffer (60 entries) for frame time history. (2) `beginFrame()` / `endFrame()` lifecycle hooks that record timestamps. (3) FPS calculation: current (1/frameTime), rolling average, and minimum over the buffer window. (4) Frame time histogram with 4 buckets: 0-8ms, 8-16ms, 16-33ms, 33ms+. (5) Worker round-trip latency tracking: `recordWorkerSend()` / `recordWorkerReceive()` methods. (6) Memory tracking via `performance.memory` (Chrome only, graceful no-op). (7) `getMetrics()` returning a snapshot of all current values. (8) `reset()` to clear all buffers. The module must be lightweight — no DOM, no allocations in the hot path. See requirements Section 4.1.
- **Verification**: `npx vitest run src/tests/perfMonitor.test.ts`

### TASK-016: Create performance dashboard UI overlay
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: Create `src/ui/perfDashboard.ts` and `src/ui/perfDashboard.css` with: (1) A semi-transparent overlay in the top-right corner. (2) Display: FPS (large, current/avg/min), frame time (ms), worker latency (ms), memory (MB). (3) Frame time histogram as 4 CSS bar elements. (4) Updates every 500ms via `setInterval` (not every frame). (5) `showPerfDashboard()` / `hidePerfDashboard()` / `togglePerfDashboard()` exports. (6) Lazy DOM creation — elements only created on first show. (7) Cleanup: `destroyPerfDashboard()` removes elements and clears interval. Use `createListenerTracker()` for event cleanup. See requirements Section 4.2.
- **Verification**: `npx vitest run src/tests/perfDashboard.test.ts`

### TASK-017: Integrate perf monitor into game loops and worker bridge
- **Status**: pending
- **Dependencies**: TASK-015, TASK-016
- **Description**: (1) In `_loop.ts`: call `beginFrame()` at the start of the flight loop and `endFrame()` at the end. (2) In `_workerBridge.ts`: call `recordWorkerSend()` when posting a tick command and `recordWorkerReceive()` when a snapshot arrives. (3) In hub and VAB render loops (if they exist): add `beginFrame()`/`endFrame()` calls. (4) Add `showPerfDashboard: boolean` to `GameState.settings` (default `false`). (5) Wire the dashboard toggle to a keyboard shortcut (F3 — verify no conflict) and to the settings/debug menu. (6) On settings load, show/hide the dashboard accordingly. See requirements Sections 4.3-4.4.
- **Verification**: `npm run typecheck -- --noEmit src/ui/flightController/_loop.ts src/ui/flightController/_workerBridge.ts src/core/gameState.ts && npx playwright test e2e/flight.spec.js e2e/fps-monitor.spec.js`

## Testing

### TASK-018: Write tests for all new iteration 5 code
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-010, TASK-015
- **Description**: Write unit tests for: (1) Worker ready timeout — mock worker that never sends ready, verify rejection after timeout; mock worker that sends ready in time, verify timeout cleared. (2) `escapeHtml()` — all special characters escaped, empty string, non-string coercion, already-escaped input not double-escaped. (3) `perfMonitor` — FPS calculation accuracy, histogram bucket distribution, circular buffer overflow, worker latency tracking, memory graceful fallback, `reset()` clears state. (4) `createSnapshotFromState()` — correct field mapping, control inputs excluded, round-trip consistency with worker snapshots. (5) Main-thread fallback snapshot format matches worker snapshot format. Place tests in `src/tests/` following existing naming conventions. See requirements Section 5.1.
- **Verification**: `npx vitest run src/tests/workerBridgeTimeout.test.ts src/tests/escapeHtml.test.ts src/tests/perfMonitor.test.ts src/tests/snapshotFactory.test.ts`

### TASK-019: Verification pass — run all checks
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-009, TASK-014b, TASK-017, TASK-018
- **Description**: Run the full verification suite: (1) `npm run typecheck` — no errors. (2) `npm run lint` — no errors. (3) `npm run test:unit` — all tests pass. (4) Targeted E2E specs covering all changed areas. (5) `npm run build` — production build succeeds. (6) Coverage meets thresholds for core (89%/80%/91%), render (50%/40%), and UI (50%/40%). Fix any failures found. See requirements Section 6.
- **Verification**: `npm run typecheck && npm run lint && npm run test:unit && npx playwright test e2e/flight.spec.js e2e/phase-transitions.spec.js e2e/orbital-operations.spec.js e2e/collision.spec.js e2e/landing.spec.js e2e/fps-monitor.spec.js e2e/saveload.spec.js e2e/crew.spec.js && npm run build`
