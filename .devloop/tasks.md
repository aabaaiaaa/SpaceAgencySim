# Iteration 2 — Tasks

### TASK-001: Handle localStorage quota errors and improve error logging in saveload.js and designLibrary.js
- **Status**: done
- **Dependencies**: none
- **Description**: Wrap all `localStorage.setItem()` calls in `src/core/saveload.js` and `src/core/designLibrary.js` with try-catch for `QuotaExceededError`. Surface a user-friendly "Storage full" message on quota failure. Also add `console.warn()` to the silent JSON.parse catch blocks in `designLibrary.js` (around lines 125-132) so corrupt data is logged rather than silently swallowed. See requirements Section 1.1 and 1.2.
- **Verification**: Write a unit test that mocks `localStorage.setItem` to throw `QuotaExceededError` and verify the error is caught gracefully (no unhandled exception). Verify `console.warn` is called on corrupt JSON parse. Run `npm run test:unit` — all tests pass. No E2E needed — pure core logic.

### TASK-002: Add try-catch to flight HUD requestAnimationFrame loop
- **Status**: done
- **Dependencies**: none
- **Description**: Add error handling around the flight HUD's `requestAnimationFrame` callback so that invalid physics state (NaN, missing references) doesn't crash the entire HUD. Log errors, attempt to continue on transient failures, and if errors repeat (e.g., 5+ consecutive frames), offer the player a way to abort to the hub. See requirements Section 1.3.
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/flight.spec.js` to verify flight still works normally.

### TASK-003: Add ordering dependency comment to flightPhase.js transition logic
- **Status**: done
- **Dependencies**: none
- **Description**: Add a clear comment in `src/core/flightPhase.js` (around lines 222-255) explaining why the MANOEUVRE exit handler checks escape trajectory first with an early return, and that removing the early return would cause double-mutation. See requirements Section 1.4.
- **Verification**: Read the comment in the code and confirm it explains the ordering dependency and the early-return requirement. No tests needed — comment-only change.

### TASK-004: Fix timer stacking in debugSaves.js
- **Status**: done
- **Dependencies**: none
- **Description**: In `src/ui/debugSaves.js` (around line 343), clear the previous timeout stored on `feedbackEl._timer` before setting a new one. Use `clearTimeout(feedbackEl._timer)` before the new `setTimeout` assignment. See requirements Section 1.5.
- **Verification**: Run `npm run test:unit` — all tests pass. No E2E needed — trivial one-line fix in debug tooling.

### TASK-005: Move _malfunctionMode from module variable to gameState
- **Status**: done
- **Dependencies**: none
- **Description**: `src/core/malfunction.js` stores `_malfunctionMode` as a module-level variable rather than in `gameState`. Move it into the game state object so it follows the same state mutation pattern as everything else and can be persisted/restored with save/load. Update all read/write sites and any E2E test hooks that toggle malfunction mode. See requirements (review item, not in a numbered section — architectural consistency).
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/reliability-risk.spec.js` to verify malfunction E2E tests still work with the new state location. Verify malfunction mode survives save/load cycle via unit test.

### TASK-006: Implement event listener cleanup in UI modules
- **Status**: done
- **Dependencies**: none
- **Description**: Fix event listener accumulation in `src/ui/help.js`, `src/ui/settings.js`, `src/ui/debugSaves.js`, and `src/ui/topbar.js`. Create a lightweight listener tracking helper that modules can use to register listeners and clean them up on panel close/teardown. Apply it to the four affected modules. See requirements Section 2.1.
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/help.spec.js e2e/hub-navigation.spec.js` to verify help and hub panel interactions still work.

### TASK-007: Fix style element accumulation across game sessions
- **Status**: done
- **Dependencies**: none
- **Description**: Multiple UI modules inject `<style>` elements into `document.head` on initialization but never remove them. Implement idempotent style injection — check for an existing style element (by ID or data attribute) before injecting, and reuse it if present. Apply across all UI modules that inject styles. See requirements Section 2.2.
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/smoke.spec.js` as a basic sanity check that the game still starts and renders.

### TASK-008: Add tutorial mission blocking indicators
- **Status**: done
- **Dependencies**: none
- **Description**: In Tutorial mode, missions that are prerequisites for other uncompleted tutorial missions should display a visual indicator (e.g., "Unlocks next step" label or chain icon). This should be data-driven: check whether the mission's completion is in the dependency chain of any other uncompleted tutorial mission. Non-blocking tutorial missions should NOT get the indicator. Only applies in Tutorial mode — Freeplay and Sandbox are unaffected. See requirements Section 3.1.
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/missions.spec.js e2e/mission-progression.spec.js` to verify mission UI still works and blocking indicators appear correctly in tutorial mode.

### TASK-009: Standardise weather display format between hub and Launch Pad
- **Status**: done
- **Dependencies**: none
- **Description**: The hub shows weather in a full panel with header/title; the Launch Pad shows a compact inline bar. Standardise both to use the compact format since weather is supplementary information. See requirements Section 3.2.
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/launchpad.spec.js` to verify Launch Pad UI still works correctly.

### TASK-010: Implement PixiJS object pooling for flight renderer
- **Status**: done
- **Dependencies**: none
- **Description**: Create a simple array-based object pool for `PIXI.Graphics` and `PIXI.Text` objects. Integrate it into `src/render/flight/_trails.js`, `_debris.js`, `_rocket.js`, `_sky.js`, and `_ground.js` — replace per-frame `new PIXI.Graphics()` / `new PIXI.Text()` calls with pool acquire/release. Reset graphics state on reuse. See requirements Section 4.1.
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/flight.spec.js` to verify flight rendering still works. No visual regressions.

### TASK-011: Optimize hit testing in _rocket.js
- **Status**: done
- **Dependencies**: none
- **Description**: `hitTestFlightPart()` in `src/render/flight/_rocket.js` iterates all parts on every mouse move (O(n)). Add bounding-box pre-filtering or spatial indexing to reduce the number of detailed hit tests for rockets with many parts. See requirements Section 4.2.
- **Verification**: Run `npm run test:unit` — all tests pass. Then run `npx playwright test e2e/flight.spec.js` to verify part hover/click behavior during flight still works.

### TASK-012: Convert mission/contract Array.find lookups to Map
- **Status**: done
- **Dependencies**: none
- **Description**: Mission and contract lookups in `src/data/missions.js` and `src/data/contracts.js` (and any core modules that look up by ID) use `Array.find()` O(n). Build `Map` objects keyed by ID at module load time and export them alongside the arrays. Update all lookup sites to use the maps. See requirements Section 4.3.
- **Verification**: Run `npm run test:unit` — all tests pass. Grep for `.find(` in mission/contract lookup paths and verify they've been replaced. No E2E needed — data layer only, unit tests cover mission/contract logic.

### TASK-013: Add unit tests for flightReturn.js
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/tests/flightReturn.test.js` with comprehensive tests for mission completion, objective validation, contract rewards, crew recovery, part recovery, and financial transactions. This is the highest-priority untested module. See requirements Section 5.1.
- **Verification**: Run `npx vitest run src/tests/flightReturn.test.js` — all tests pass. Coverage of `flightReturn.js` should be ≥80% lines/branches.

### TASK-014: Add unit tests for sciencemodule.js
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/tests/sciencemodule.test.js` covering science module activation, data collection, yield calculation, and edge cases. See requirements Section 5.1.
- **Verification**: Run `npx vitest run src/tests/sciencemodule.test.js` — all tests pass.

### TASK-015: Add unit tests for customChallenges.js
- **Status**: done
- **Dependencies**: none
- **Description**: Create `src/tests/customChallenges.test.js` covering challenge creation, validation, completion detection, and edge cases. See requirements Section 5.1.
- **Verification**: Run `npx vitest run src/tests/customChallenges.test.js` — all tests pass.

### TASK-016: Add unit tests for designLibrary.js
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Create `src/tests/designLibrary.test.js` covering design persistence, JSON import/export, cross-save sharing, and the improved error handling from TASK-001. Must be done after TASK-001 so tests cover the updated code. See requirements Section 5.1.
- **Verification**: Run `npx vitest run src/tests/designLibrary.test.js` — all tests pass.

### TASK-017: Add unit tests for parachute.js deployment triggers
- **Status**: done
- **Dependencies**: none
- **Description**: Add tests to an existing or new test file covering parachute deployment trigger logic — when parachutes activate, altitude/speed conditions, and edge cases. Currently only descent/landing physics are tested. See requirements Section 5.1.
- **Verification**: Run the parachute test file — all tests pass, including new deployment trigger tests.

### TASK-018: Add programmatic time warp API for E2E tests
- **Status**: done
- **Dependencies**: none
- **Description**: Expose a testing-only API (e.g., `window.__testSetTimeWarp(speedMultiplier)`) that lets E2E tests set arbitrary simulation speeds not limited to the player-facing time warp increments. This is needed by TASK-019 and TASK-020 for running physics through transitions at high speed. See requirements Section 5.2.1.
- **Verification**: Write a small E2E test (in `e2e/test-infrastructure.spec.js` or a new spec) that sets time warp to 100x, verifies simulation time advances faster than real time, then resets to 1x. Run `npx playwright test e2e/test-infrastructure.spec.js` — passes.

### TASK-019: Upgrade E2E teleport helper to set velocity
- **Status**: done
- **Dependencies**: TASK-018
- **Description**: Upgrade the teleport helpers across all 7 spec files that use them. The new helper should set position (posX, posY) AND velocity (velX, velY) plus basic flags (grounded, landed, crashed, throttle), but should NOT manually set phase or orbital elements — let the physics simulation compute those from position/velocity. Replace the current helpers that manually set `fs.phase`, `fs.orbitalElements`, and fake phase log entries. See requirements Section 5.2.2.
- **Verification**: Run the spec files that use teleport: `npx playwright test e2e/core-mechanics.spec.js e2e/orbital-operations.spec.js e2e/destinations.spec.js e2e/additional-systems.spec.js e2e/tutorial-revisions.spec.js e2e/mission-progression.spec.js e2e/relaunch.spec.js` — all pass. Grep for manual `fs.phase =` and `fs.orbitalElements =` in teleport helpers and verify they're removed.

### TASK-020: Add E2E phase transition tests
- **Status**: done
- **Dependencies**: TASK-018, TASK-019
- **Description**: Add one dedicated E2E test per unique flight phase transition that runs through real physics. Use teleport+velocity to get near the transition point, then let physics run at high time warp through the actual transition. Transitions to cover: PRELAUNCH→LAUNCH (ignition), LAUNCH→FLIGHT (liftoff), FLIGHT→ORBIT (orbital velocity + checkOrbitStatus), ORBIT→MANOEUVRE (burn initiation), MANOEUVRE→TRANSFER (escape trajectory), reentry (atmospheric interface), landing (parachute + ground contact), crash (impact detection). See requirements Section 5.2.3.
- **Verification**: Run `npx playwright test e2e/phase-transitions.spec.js` (or whatever the new spec is named) — all tests pass. Each test verifies the phase transition fires through the real physics pipeline, not via direct state mutation.

### TASK-021: Replace waitForTimeout with conditional waits in E2E tests
- **Status**: done
- **Dependencies**: none
- **Description**: Replace the 76 `waitForTimeout()` calls across 10 E2E spec files with `page.waitForFunction(() => condition)`, `page.waitForSelector()`, or other deterministic waits. The heaviest offender is `additional-systems.spec.js` (19 occurrences). Some waits for animations may remain, but most should be converted. See requirements Section 5.3.
- **Verification**: Grep for `waitForTimeout` in `e2e/` — count should be reduced to ≤10 (only genuinely necessary animation waits). Run each modified spec file individually to confirm it passes (e.g., `npx playwright test e2e/additional-systems.spec.js`, etc.).

### TASK-022: Add E2E failure-path tests
- **Status**: done
- **Dependencies**: TASK-018, TASK-019
- **Description**: Add E2E tests for failure scenarios: (1) malfunction during flight — part fails, UI appears, flight log records it; (2) crew KIA on crash — death recorded, fine applied, crew admin reflects loss; (3) contract deadline expiry — penalty applied, contract removed; (4) loan default/bankruptcy — game-over flow triggers. See requirements Section 5.4.
- **Verification**: Run `npx playwright test e2e/failure-paths.spec.js` (or whatever the new spec is named) — all tests pass.

### TASK-023: Configure Vitest coverage with 80% thresholds
- **Status**: done
- **Dependencies**: none
- **Description**: Add `v8` coverage provider to Vitest config. Set 80% thresholds for lines, branches, and functions. Add `npm run test:coverage` script to `package.json`. See requirements Section 5.5.
- **Verification**: Run `npm run test:coverage` — completes successfully, reports coverage percentages, and enforces 80% thresholds.

### TASK-024: Assess coverage and raise thresholds
- **Status**: done
- **Dependencies**: TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-023
- **Description**: After all new unit tests are written and coverage is configured, run `npm run test:coverage` to assess actual coverage. Raise thresholds in Vitest config to match or slightly exceed actual coverage, locking in the higher numbers to prevent regression. Document the final thresholds. See requirements Section 5.5.
- **Verification**: Run `npm run test:coverage` — passes with the raised thresholds. Thresholds are higher than the initial 80% where actual coverage exceeds it.

### TASK-025: Add no-console and async/await error handling ESLint rules
- **Status**: done
- **Dependencies**: none
- **Description**: Add `no-console` rule (error level, with exceptions for `console.warn` and `console.error`) and async/await error handling rules to `eslint.config.js`. Fix any existing violations in production source code (not test files — exclude test directories from `no-console`). See requirements Section 6.1.
- **Verification**: Run `npm run lint` — no errors. Grep for bare `console.log` in `src/` (excluding tests) — none found. No E2E needed — config and lint fixes only.

### TASK-026: Add engines field to package.json
- **Status**: done
- **Dependencies**: none
- **Description**: Add an `engines` field to `package.json` specifying the minimum required Node.js version based on the dependency requirements (TypeScript 6, Vite 6, ESLint 10, Vitest 3). See requirements Section 6.2.
- **Verification**: Read `package.json` and confirm `engines` field is present with a reasonable Node.js version constraint.

### TASK-027: Address all 17 TypeScript TODOs in existing TS files
- **Status**: pending
- **Dependencies**: none
- **Description**: Address the 17 TODO comments in `src/core/constants.ts`, `src/core/gameState.ts`, `src/core/physics.ts`, and `src/core/orbit.ts` that mark places where JS module imports need proper type definitions. Add proper type imports, `.d.ts` declaration files, or JSDoc annotations as appropriate to resolve each TODO. See requirements Section 7.1.
- **Verification**: Grep for `TODO` in the four TS files — count is 0 (all resolved). Run `npm run typecheck` — no errors.

### TASK-028: Verification pass — run all checks
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025, TASK-026, TASK-027
- **Description**: Run the full verification suite: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, and `npm run test:coverage`. All must pass with no errors. See requirements Section 9.
- **Verification**: All five commands pass cleanly. Coverage meets or exceeds raised thresholds from TASK-024.
