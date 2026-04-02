# Iteration 2 — Code Quality, Resilience & Test Coverage

This iteration addresses findings from the Iteration 1 final code review. No new game features — the focus is on error handling, UI lifecycle management, performance, test coverage gaps, and a couple of lingering UX items from the previous iteration's requirements that weren't fully addressed.

The codebase is ~66,000 lines of source with 2,271 passing unit tests and 31 E2E spec files. All work builds on the existing codebase; nothing is being rewritten.

---

## 1. Error Handling & Resilience

### 1.1 localStorage Quota Handling

`localStorage.setItem()` can throw `QuotaExceededError` if the player accumulates many saves or large rocket designs. This is currently unhandled in two locations:

- `src/core/saveload.js` (around line 205 and 502) — game save persistence
- `src/core/designLibrary.js` (around line 140) — rocket design persistence

Both need try-catch wrappers that surface a user-friendly "Storage full" message rather than silently crashing. This is the most likely production failure mode for players who play extensively.

### 1.2 Silent Error Swallowing in designLibrary.js

`designLibrary.js` (around lines 125-132) catches corrupt JSON during design library loading and silently returns `[]` with no logging. This hides data corruption from developers. Add `console.warn()` to these catch blocks so corruption is at least visible in the console. This should be done alongside 1.1 since they touch the same file.

### 1.3 Flight HUD requestAnimationFrame Crash Recovery

The flight HUD's `requestAnimationFrame` loop has no try-catch. If physics state becomes invalid mid-flight (NaN propagation, missing part references, etc.), the entire HUD crashes with no recovery path. The loop should catch errors gracefully — log the error, attempt to continue, and if repeated failures occur, offer the player a way to abort to the hub rather than leaving them on a frozen screen.

### 1.4 Flight Phase Transition Ordering Fragility

`src/core/flightPhase.js` (around lines 222-255) has the MANOEUVRE exit handler check for escape trajectory first, transition through ORBIT to TRANSFER, and return early. The normal manoeuvre exit is checked second. The early return prevents double-mutation, so the logic is **correct** — but a future change that removes the early return would introduce a bug. Add a clear comment explaining the ordering dependency and why the early return is load-bearing.

### 1.5 Timer Stacking in debugSaves.js

`debugSaves.js` (around line 343) stores a timeout on a DOM element property (`feedbackEl._timer`) but never clears the previous timeout before setting a new one. Rapid debug save loads stack timers, causing visual glitches. Clear the previous timeout before setting a new one.

---

## 2. UI Lifecycle Management

### 2.1 Event Listener Cleanup

Several UI modules add event listeners that are never removed when their panels close:

- **`help.js`** — Tab click handlers created every time help opens; not removed on close. Repeated opens accumulate duplicate handlers.
- **`settings.js`** — Difficulty option click handlers not removed when the settings panel closes.
- **`debugSaves.js`** — Load button handlers not explicitly removed (relies on `panel.remove()` garbage collection, which doesn't reliably remove listeners on all elements).
- **`topbar.js`** — Click handlers on menu items stored in arrays but cleanup path not verified for all cases.

In a long-running single-page game, accumulated listeners cause memory pressure and unexpected behavior when stale handlers fire. The fix should create a pattern for tracking listeners and clearing them on panel close — ideally a small helper that other modules can reuse, since this is a cross-cutting concern.

### 2.2 Style Element Accumulation

Multiple UI modules inject `<style>` elements into `document.head` on initialization but never remove them during teardown. When the player cycles through main menu → game → exit → new game, style elements accumulate. Each cycle adds ~10KB of CSS that persists until page reload.

The fix should either: (a) check for existing style elements before injecting new ones (idempotent injection), or (b) remove style elements during module teardown. Option (a) is simpler and less error-prone.

---

## 3. UX Improvements (Iteration 1 Gaps)

### 3.1 Tutorial Mission Blocking Indicators

**Carries forward from Iteration 1 Requirement 2.3**, which was only partially addressed.

When multiple missions unlock simultaneously in tutorial mode, there's no indication of which missions are prerequisites for unlocking later content. For example, after mission 4, four missions appear at once — but "First Crew Flight" is the one that unlocks the Crew Admin facility and gates further progression.

The fix: missions that are **prerequisites for other tutorial missions** should display a clear visual indicator (e.g., a label like "Unlocks next step" or a chain icon). This should be data-driven — check whether a mission's completion is in the dependency chain of any other uncompleted tutorial mission. Non-blocking tutorial missions (ones that don't gate future content) should NOT get the indicator.

This only applies in Tutorial mode. Freeplay and Sandbox should not show these indicators.

### 3.2 Weather Display Format Consistency

**Carries forward from Iteration 1 Requirement 5.4**, which was not explicitly verified.

The hub shows weather in a full panel with header/title. The Launch Pad shows weather in a compact inline bar. These should use a consistent visual treatment — either both use the compact format or both use the full panel. The compact format is probably better since weather is supplementary information, not a primary display.

---

## 4. Performance Optimization

### 4.1 PixiJS Object Pooling

The flight renderer creates new `PIXI.Graphics()` objects every frame in multiple sub-modules:

- `src/render/flight/_trails.js` — plumes, trails, RCS plumes, Mach effects
- `src/render/flight/_debris.js` — containers and graphics per debris fragment
- `src/render/flight/_rocket.js` — rocket part graphics
- `src/render/flight/_sky.js` — star graphics
- `src/render/flight/_ground.js` — biome label text objects

Container children are properly cleared each frame before re-adding, so there are no memory leaks. But the constant create-destroy cycle pressures the garbage collector. For short flights this is fine; for long orbital sessions with time warp, it causes periodic frame drops during GC pauses.

Implement a simple object pool for `PIXI.Graphics` and `PIXI.Text` objects. The pool should: acquire an object (create if pool empty, reuse if available), release it back to the pool on frame clear, and reset graphics state on reuse. The pool doesn't need to be complex — a simple array-based free list per object type is sufficient.

### 4.2 Hit Testing Optimization

`src/render/flight/_rocket.js` `hitTestFlightPart()` iterates all parts on every mouse move (O(n)). For rockets with 30+ parts, this can cause perceptible input lag. Consider spatial indexing or bounding-box pre-filtering to reduce the number of detailed hit tests needed.

### 4.3 Mission/Contract Data Lookup Optimization

Mission and contract lookups use `Array.find()` (O(n)) in code paths that run during flight. Building a `Map` keyed by ID at module load time would eliminate these repeated linear scans. The maps should be built once when the data modules load and exported alongside the arrays.

---

## 5. Testing Improvements

### 5.1 Unit Tests for Untested Core Modules

The following core modules have no direct unit test coverage. They are listed in priority order based on risk and complexity:

1. **`flightReturn.js`** (HIGH) — Processes mission completion, objective validation, contract rewards, crew recovery, part recovery, and financial transactions. This is the most complex untested module and handles the critical path of "what happens when a flight ends."

2. **`sciencemodule.js`** (MEDIUM) — Science module activation, data collection, yield calculation. Moderate complexity with numerical logic that benefits from unit testing.

3. **`customChallenges.js`** (MEDIUM) — Custom challenge creation and validation logic.

4. **`designLibrary.js`** (MEDIUM) — Rocket design persistence, cross-save sharing, JSON import/export. Tests should be written AFTER the error handling improvements in Section 1.1/1.2 are complete, so tests cover the improved code.

5. **`parachute.js` deployment triggers** (MEDIUM) — Only descent/landing physics are tested. The deployment trigger logic (when parachutes activate, conditions for deployment) is not tested.

### 5.2 Overhaul E2E Teleport Pattern and Flight Testing

Currently 7 E2E spec files use direct state mutation via `page.evaluate()` to teleport craft by setting `window.__flightPs` and `window.__flightState`, with 80+ individual mutations across the suite. This bypasses the entire flight physics pipeline — phase transitions, orbit validation, atmospheric reentry, parachute deployment, and landing detection are never E2E tested under realistic conditions.

The overhaul has three parts:

#### 5.2.1 Programmatic Time Warp API

Expose a testing-only API (via `window.__testTimeWarp` or similar) that lets E2E tests set arbitrary simulation speeds not limited to the player-facing time warp increments (which use `,` and `.` keys). This allows tests to fast-forward through predictable flight segments (atmospheric climb, orbital coasting, descent) without waiting in real-time, and without teleporting past the physics simulation entirely.

#### 5.2.2 Upgraded Teleport Helper

The existing teleport helpers only set position. Upgrade them to also set **velocity** (direction and magnitude), so tests can place a craft at a specific position moving at a specific speed. This allows much faster E2E tests overall — a test can teleport to 65km altitude with upward velocity of 2000 m/s, then let the physics run (with time warp) through the FLIGHT→ORBIT transition naturally. The teleport skips the boring part; the physics handles the transition.

The upgraded teleport should:
- Set position (posX, posY)
- Set velocity (velX, velY)
- Set basic flags (grounded, landed, crashed, throttle)
- NOT set phase or orbital elements — let the physics simulation compute these from the position/velocity state

#### 5.2.3 Phase Transition Tests

Add one dedicated E2E test per unique phase transition that runs through the real physics:

- **PRELAUNCH → LAUNCH** — Engine ignition, throttle up
- **LAUNCH → FLIGHT** — Liftoff, ground clearance
- **FLIGHT → ORBIT** — Reaching orbital velocity, `checkOrbitStatus()` validation, altitude band classification
- **ORBIT → MANOEUVRE** — Initiating a burn in orbit
- **MANOEUVRE → TRANSFER** — Escape trajectory detection
- **Reentry** — De-orbit, atmospheric interface, heating
- **Landing** — Parachute deployment, deceleration, ground contact
- **Crash** — Impact detection, part destruction

Each test uses teleport+velocity to get close to the transition point, then lets the physics run at high time warp through the actual transition. This covers every transition in the flight state machine without running a full 20-minute mission.

The existing 7 spec files can continue using teleport for tests that are testing non-flight systems (satellite ops, science, docking, etc.) where orbit is just a prerequisite — but they should use the upgraded teleport helper rather than manually setting phase and orbital elements.

### 5.3 Replace waitForTimeout with Conditional Waits in E2E Tests

76 `waitForTimeout()` calls across 10 E2E spec files use arbitrary delays instead of condition-based waits. The heaviest offender is `additional-systems.spec.js` (19 occurrences). This pattern makes tests flaky under load and slow in all cases.

Replace with `page.waitForFunction(() => condition)` or `page.waitForSelector()` where possible. Some waits may be genuinely necessary (animation timing), but most can be converted to deterministic condition checks.

### 5.4 E2E Failure-Path Tests

E2E specs focus almost exclusively on happy paths. Missing failure scenarios that should be covered:

- **Malfunction during flight** — A part fails mid-flight; verify the malfunction UI appears, flight log records it, and the player can still complete or abort.
- **Crew KIA recovery flow** — A crewed rocket crashes; verify crew death is recorded, the fine is applied, and the crew admin screen reflects the loss.
- **Contract deadline expiry** — A contract expires without completion; verify the penalty is applied and the contract is removed from active list.
- **Loan default / bankruptcy** — Funds go negative beyond the loan threshold; verify the bankruptcy/game-over flow triggers correctly.

### 5.5 Vitest Coverage Configuration

No coverage configuration exists. Add:

- `v8` coverage provider in Vitest config
- 80% threshold for lines, branches, and functions as a starting point
- `npm run test:coverage` script in package.json
- After all new tests from 5.1 are written, assess actual coverage numbers and raise thresholds to match (locking in the higher coverage so it can't regress).

---

## 6. Build & Configuration

### 6.1 ESLint Rules

Two categories of rules are missing:

- **`no-console`** — Debug `console.log` calls can leak into production code. Add a `no-console` rule with `warn` level (or `error` with exceptions for `console.warn` and `console.error`). This will require a one-time cleanup of existing console.log calls in production code (test files should be excluded).

- **Async/await error handling** — No rules catch unhandled promise rejections or missing try-catch around await expressions in critical paths. Add appropriate `@typescript-eslint` and/or ESLint rules for promise handling.

### 6.2 Node.js Engine Version

No `engines` field in `package.json`. The project uses very recent dependency versions (TypeScript 6, Vite 6, ESLint 10, Vitest 3) that require a modern Node.js. Add an `engines` field specifying the minimum required Node.js version.

---

## 7. TypeScript Improvements

### 7.1 Address 17 TypeScript TODOs

The four existing TypeScript files (`constants.ts`, `gameState.ts`, `physics.ts`, `orbit.ts`) contain 17 TODO comments marking places where JS module imports need proper type definitions. These TODOs block full type safety across module boundaries.

Address all 17 by adding proper type imports, declarations, or type assertion patterns for the JS modules they reference. This may involve creating `.d.ts` declaration files for frequently-imported JS modules or adding JSDoc type annotations to the JS source files.

---

## 8. Input Validation

### 8.1 Player String Length Validation

Player-input strings (agency name, crew names, design names) have no length validation. Extremely long names could cause layout issues. Add reasonable max-length constraints at the input level (e.g., 40-50 characters for names) with visible character counters or truncation.

---

## 9. Verification

After all changes are complete, run:

1. `npm run typecheck` — no errors
2. `npm run lint` — no errors (after ESLint rule updates, existing violations should be fixed)
3. `npm run test:unit` — all 2,271+ tests pass (plus new tests)
4. `npm run test:e2e` — all E2E specs pass (including updated and new specs)
5. `npm run test:coverage` — meets or exceeds 80% thresholds
