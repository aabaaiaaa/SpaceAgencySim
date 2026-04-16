# Iteration 18 — Tasks

### TASK-001: Detect QuotaExceededError in saveload.ts saveGame
- **Status**: done
- **Dependencies**: none
- **Description**: Wrap the `await idbSet(key, compressed)` call at `src/core/saveload.ts:349` in try/catch. Detect `err.name === 'QuotaExceededError'` and rethrow as a new named error class `StorageQuotaError` (add to `saveload.ts` or a shared module). Other errors bubble through. See requirements §1.1.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` passes with all existing tests, and typecheck/lint clean for the modified file: `npx tsc --noEmit` on the project succeeds.

### TASK-002: Detect QuotaExceededError in settingsStore.ts saveSettings
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Mirror TASK-001 at `src/core/settingsStore.ts:202`. Reuse the `StorageQuotaError` class introduced in TASK-001 (import if it's in a different module). Other errors bubble. See requirements §1.1.
- **Verification**: `npx vitest run src/tests/settingsStore.test.ts` passes.

### TASK-003: Upgrade autoSave quota handling to distinguish quota from generic failure
- **Status**: done
- **Dependencies**: TASK-001, TASK-002
- **Description**: In `src/core/autoSave.ts` (around line 150), inside the existing try/catch, detect `StorageQuotaError` (or the raw `QuotaExceededError` equivalent) and surface a distinct user-visible message via the existing notification system ("Save storage full — consider deleting old saves"). Keep the existing generic-failure logging for other errors. See requirements §1.1.
- **Verification**: `npx vitest run src/tests/autoSave.test.ts` passes, including a new test that simulates quota exhaustion and asserts the user-facing message.

### TASK-004: Add unit tests for QuotaExceededError propagation
- **Status**: done
- **Dependencies**: TASK-001, TASK-002, TASK-003
- **Description**: Add unit tests in the relevant test files that mock `idbSet` to throw a synthetic `QuotaExceededError` (create one via `Object.assign(new Error(), { name: 'QuotaExceededError' })`). Verify `saveGame()`, `saveSettings()`, and the auto-save path all surface the error appropriately. See requirements §1.3.
- **Verification**: `npx vitest run src/tests/saveload.test.ts src/tests/settingsStore.test.ts src/tests/autoSave.test.ts` passes.

### TASK-005: Fix fire-and-forget saveSettings in saveGame
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: Replace the `void saveSettings(...)` call at `src/core/saveload.ts:320–328` with a `.catch()`-attached variant that logs the failure via `logger.warn('save', 'Settings sync failed during save', err)` and surfaces it to the user (non-fatal toast). The main save must still succeed if the settings sync fails. See requirements §1.2.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` passes, including a new test that simulates a settings-write failure inside saveGame and asserts the main save still completes while the failure is logged.

### TASK-006: Add setThrottleInstant core helper
- **Status**: done
- **Dependencies**: none
- **Description**: Add a new function `setThrottleInstant(ps, value)` (in `src/core/physics.ts` or a new `src/core/throttleControl.ts`). When called, set `ps.throttle = value` and if `ps.throttleMode === 'twr'`, also set `ps.targetTWR` to `Infinity` for value=1 or `0` for value=0. Export it. No call sites updated yet. See requirements §2.1.
- **Verification**: `npx vitest run src/tests/` (targeted at the new helper's test file) passes with a new test covering both throttle modes.

### TASK-007: Route flightHud X/Z keys through setThrottleInstant
- **Status**: done
- **Dependencies**: TASK-006
- **Description**: Update the keydown handler in `src/ui/flightHud.ts:192–208` to call `setThrottleInstant(_ps, 0)` for X and `setThrottleInstant(_ps, 1)` for Z instead of mutating `_ps.throttle` and `_ps.targetTWR` directly. Keep the `markThrottleDirty()` call. See requirements §2.1.
- **Verification**: `npx vitest run src/tests/flightHud.test.ts` (or the nearest existing test covering this handler) passes, and a manual grep confirms no direct `_ps.throttle =` or `_ps.targetTWR =` assignments remain in `src/ui/flightHud.ts`.

### TASK-008: Introduce listenerTracker instance in VAB init/destroy
- **Status**: done
- **Dependencies**: none
- **Description**: In the VAB lifecycle module (likely `src/ui/vab.ts` or `src/ui/vab/index.ts`), create a module-scoped `listenerTracker` instance on init and call `tracker.removeAll()` on destroy. Plumb the tracker into `_panels.ts` and `_canvasInteraction.ts` via function parameters or a shared module-scoped getter (match the pattern in `crewAdmin.ts`). Does not update individual listener call sites yet. See requirements §2.2.
- **Verification**: `npx vitest run src/tests/` targeted at existing VAB tests passes with no regression; `npx tsc --noEmit` passes.

### TASK-009: Route vab/_panels.ts window keydown listeners through tracker
- **Status**: done
- **Dependencies**: TASK-008
- **Description**: Replace the three bare `window.addEventListener('keydown', ...)` calls at `src/ui/vab/_panels.ts:354, 373, 396` with tracker-registered listeners so they are removed on VAB destroy. See requirements §2.2.
- **Verification**: `npx vitest run src/tests/` existing VAB tests pass; grep confirms no `window.addEventListener` remains directly in `_panels.ts`.

### TASK-010: Route vab/_canvasInteraction.ts window/document listeners through tracker
- **Status**: done
- **Dependencies**: TASK-008
- **Description**: Replace the `document.addEventListener('pointerdown', ...)` at line 300 and the drag-flow `window.addEventListener('pointermove/pointerup/pointercancel', ...)` at lines 381–383 with tracker-registered listeners. Keep the existing `removeEventListener` calls in `onDragEnd` for early cleanup during normal drag lifecycle; the tracker guards the teardown-during-drag edge case. See requirements §2.3.
- **Verification**: `npx vitest run src/tests/` existing VAB tests pass; manual grep confirms only canvas-element-scoped listeners (not window/document) remain outside the tracker.

### TASK-011: Add VAB listener-cleanup unit test
- **Status**: done
- **Dependencies**: TASK-009, TASK-010
- **Description**: Add a unit test in `src/tests/vab.test.ts` (or a new `vabLifecycle.test.ts`) that spies on `window.addEventListener` and `window.removeEventListener` (or uses a listener-introspection approach), initializes VAB, verifies listeners are added, then destroys VAB and verifies all are removed. See requirements §2.4.
- **Verification**: `npx vitest run src/tests/vab*.test.ts` passes with the new test included.

### TASK-012: Replace hardcoded Earth radius in physics.ts docking radial check
- **Status**: done
- **Dependencies**: none
- **Description**: At `src/core/physics.ts:1827`, replace `6_371_000` with a body-aware lookup. Use the current body id from the physics state or flight context to look up the radius from `BODY_RADIUS` (check `src/core/constants.ts`, `src/data/bodies.ts`, or `src/core/orbit.ts` for the canonical source). If the body id is genuinely unavailable in this scope, thread it through via the function signature. Fall back to `6_371_000` only if the id is undefined and log a warning. See requirements §3.1.
- **Verification**: `npx vitest run src/tests/physics.test.ts` passes with a new test that exercises the radial check with a non-Earth body and asserts the correct `radOutX`/`radOutY` sign.

### TASK-013: Replace ?? fallback with Number.isFinite guard in staging.ts debris angularVelocity
- **Status**: done
- **Dependencies**: none
- **Description**: At `src/core/staging.ts:870`, replace `(ps.angularVelocity ?? 0)` with `(Number.isFinite(ps.angularVelocity) ? ps.angularVelocity : 0)`. Grep `src/core/` for other numeric `?? 0` patterns where the source could plausibly be NaN (velocities, angles, forces) and convert to `Number.isFinite` guards where appropriate — limit scope to obvious NaN-risk sites, do not churn the whole codebase. See requirements §3.2.
- **Verification**: `npx vitest run src/tests/staging.test.ts` passes with a new test that passes `{ angularVelocity: NaN }` through the debris creation path and asserts the resulting debris has a finite `angularVelocity`.

### TASK-014: Add resetDebrisIdCounter and consolidate flight-state resets
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/core/staging.ts`, add and export `resetDebrisIdCounter()` which sets `_debrisNextId = 1`. Either (a) consolidate with `resetAsteroidCollisionCooldowns` (from `collision.ts`) into a single exported `resetFlightState()` in a new or existing core module, OR (b) ensure both are called together at every flight-start and flight-abort site. Identify flight-lifecycle sites in `src/ui/flightController/` and `src/ui/launchPad.ts`. See requirements §3.3.
- **Verification**: `npx vitest run src/tests/staging.test.ts src/tests/collision.test.ts` passes, including a new test that simulates two sequential flights and asserts both counters/cooldowns are reset between them.

### TASK-015: Extract computePartCdA helper from physics.ts and staging.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/core/dragCoefficient.ts` exporting `computePartCdA(def, deployProgress, atmosphereDensity)`. Move the duplicated parachute-interpolation + drag-coefficient logic from `src/core/physics.ts:1660–1702` (`_computeDragForce`) and `src/core/staging.ts:946–974` (`_debrisDrag`) into this helper. Have both call sites use it. Preserve behaviour exactly — run the existing physics and staging tests to confirm no regression. See requirements §3.4.
- **Verification**: `npx vitest run src/tests/physics.test.ts src/tests/staging.test.ts` passes; new `src/tests/dragCoefficient.test.ts` covers non-parachute parts, undeployed/partial/full parachute, and zero-density atmosphere.

### TASK-016: Add dragCoefficient.ts to test-map.json and SOURCE_GROUPS
- **Status**: done
- **Dependencies**: TASK-015
- **Description**: Add `src/core/dragCoefficient.ts` to `scripts/generate-test-map.mjs` SOURCE_GROUPS so `src/tests/dragCoefficient.test.ts` is discovered, then regenerate `test-map.json`. If a `throttleControl.ts` was introduced in TASK-006, do the same for it.
- **Verification**: `node scripts/generate-test-map.mjs --dry-run` shows the new entries; running `node scripts/generate-test-map.mjs` updates `test-map.json`; `git diff test-map.json` shows the expected additions.

### TASK-017: Inventory E2E keyboard.press sites and add dispatchEvent helper
- **Status**: done
- **Dependencies**: none
- **Description**: Enumerate the 12 Playwright specs that use `page.keyboard.press` (grep `e2e/**/*.spec.ts` for the call). Check `e2e/helpers/` for an existing keyboard-dispatch helper — if present, document it; if absent, add one (e.g. `e2e/helpers/_keyboard.ts` exporting `dispatchKey(page, key, opts?)` that calls `page.evaluate` with `window.dispatchEvent(new KeyboardEvent('keydown', ...))`). Do not migrate call sites yet. See requirements §4.
- **Verification**: The helper compiles (`npx tsc --noEmit`) and a sanity-check E2E spec that uses it passes: `npx playwright test e2e/<chosen-spec>.spec.ts`.

### TASK-018: Migrate first batch of E2E specs to dispatchEvent helper
- **Status**: done
- **Dependencies**: TASK-017
- **Description**: Pick ~6 of the 12 specs (prioritize the ones most frequently failing or with the most `keyboard.press` call sites). Replace every `page.keyboard.press` with the helper from TASK-017. Preserve behaviour — no test logic changes. See requirements §4.
- **Verification**: `npx playwright test <the six migrated specs>` passes. Do NOT run the full E2E suite.

### TASK-019: Migrate remaining E2E specs to dispatchEvent helper
- **Status**: done
- **Dependencies**: TASK-018
- **Description**: Migrate the remaining ~6 specs from the TASK-017 inventory. Same rules as TASK-018. See requirements §4.
- **Verification**: `npx playwright test <the remaining migrated specs>` passes.

### TASK-020: Add focus management to welcome and confirmation modals
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/ui/hub.ts` (welcome modal) and `src/ui/mainmenu.ts` (save/load confirmation modals), on modal open: save the currently-focused element via `document.activeElement`, then `.focus()` the primary action button. On modal close: restore focus to the saved element if it is still in the DOM. See requirements §5.1.
- **Verification**: `npx vitest run src/tests/hub.test.ts src/tests/mainmenu.test.ts` (or the nearest existing unit tests) passes with a new test that opens the modal, verifies focus moved to the primary button, closes, and verifies focus restored.

### TASK-021: Replace console.warn with logger.warn in settingsStore.ts
- **Status**: done
- **Dependencies**: none
- **Description**: At `src/core/settingsStore.ts:273`, replace the `console.warn(...)` call with `logger.warn('settings', ...)` using the existing `logger` import (add the import if not present). Preserve the message content. See requirements §5.2.
- **Verification**: `grep -n "console.warn" src/core/settingsStore.ts` returns nothing; `npx vitest run src/tests/settingsStore.test.ts` passes.

### TASK-022: Final typecheck, lint, build, smoke, and affected E2E verification
- **Status**: done
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021
- **Description**: Run `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:unit`, and `npm run test:smoke:unit` and confirm all pass with zero errors. Do NOT run the full E2E suite. See requirements §6.
- **Verification**: All five commands exit 0.
