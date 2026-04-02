# SpaceAgencySim — Final Code Review

**Date:** 2 April 2026
**Scope:** Full codebase review — 66,000 lines of source code, 52,000 lines of tests
**Branch:** master (commit 1007175)

---

## Executive Summary

SpaceAgencySim is a well-architected browser-based space agency management game built with Vite, PixiJS, and vanilla ES modules. The codebase spans ~66,000 lines of source across three cleanly separated layers (core/render/UI) with comprehensive test coverage (2,271 unit tests across 52 files, 31 E2E spec files). All 2,271 unit tests pass.

The most recent iteration (24 tasks) focused on UX polish — fixing navigation bugs, standardising CSS, adding welcome flows, and eliminating visual bleed-through during flight. All tasks are marked done.

**Overall Assessment:** The project is in solid shape for a simulation game of this complexity. The main areas requiring attention before production readiness are: (1) localStorage quota handling, (2) event listener lifecycle management in UI modules, (3) PixiJS object pooling for long flight sessions, and (4) coverage gaps in a handful of critical core modules.

---

## 1. Requirements vs Implementation

### 1.1 Requirements Coverage — UX Polish Iteration

The current requirements document (`.devloop/requirements.md`) describes 10 categories of UX issues found during a Playwright audit. All 24 tasks in `tasks.md` are marked **done**.

| Requirement Section | Status | Notes |
|---|---|---|
| 1.1 Back button destroys hub (TS/SatOps/Library) | Done (TASK-001) | |
| 1.2 R&D Lab inaccessible | Done (TASK-002) | `rdLab.js` created, navigation handler added |
| 1.3 All buildings visible in tutorial mode | Done (TASK-003) | Hub now filters by `hasFacility()` |
| 1.4/1.5 Load Game exits to menu / no load UI | Done (TASK-004) | Modal overlay + main menu load section |
| 1.6 Debug saves don't populate missions | Done (TASK-017) | Mission unlock logic now runs post-load |
| 2.1 No welcome message | Done (TASK-005) | Mode-specific welcome modal |
| 2.2 No facility unlock notifications | Done (TASK-006) | Notification modal on facility-awarding missions |
| 2.3 Multiple missions unlock without guidance | Partial | Welcome message added but no priority indicators on simultaneous unlocks |
| 2.4-2.6 Weather/reputation overlap, debug button, floating buttons | Done (TASK-007) | Hub layout reorganised |
| 2.7-2.8 No game mode indicator, sandbox weather shown | Done (TASK-018) | |
| 3.1-3.3 Hub elements visible during flight | Done (TASK-008) | Hub overlay hidden in flight |
| 3.5 PART_DESTROYED raw enum | Done (TASK-009) | |
| 3.6 Flight/Map labels look like buttons | Done (TASK-020) | Restyled as status indicators |
| 3.7 Raw altitude in biome transitions | Done (TASK-010) | Formatted to km above 1000m |
| 3.8 R&D Lab highlight persists into flight | Done (TASK-022) | Selection cleared on hub exit |
| 4.1-4.3 Post-flight/crash UX | Done (TASK-019) | Return overlay, crash rewards, crew death warning |
| 5.1-5.4 Navigation consistency | Done (TASK-011, TASK-012, TASK-021) | Back buttons standardised to "← Hub", consistent header format |
| 6.1-6.8 CSS/styling inconsistencies | Done (TASK-013, TASK-014) | Design tokens created, overlay bleed-through fixed |
| 7.1 Money color misleading | Done (TASK-015) | Health-based coloring |
| 8.1 COMPUTER_MODULE raw enum in VAB | Done (TASK-016) | |
| 9.1-9.2 Achievement count / library records | Done (TASK-023) | |
| 10 Verification pass | Done (TASK-024) | Playwright playthrough completed |

**Gaps identified:**
- **Requirement 2.3** (mission priority hints in tutorial mode when multiple missions unlock) is not fully addressed. The welcome message helps orient new players, but no per-mission priority indicators were added.
- **Requirement 5.4** (weather display format differs between hub and Launch Pad) is not called out as a separate task. This may have been addressed as part of TASK-007's hub layout work but is not explicitly verified.

### 1.2 Prior Iteration Requirements (69 tasks — all done)

The full game was built in a prior iteration covering Phases 0-7 plus additional systems. All 69 tasks are marked done. The scope is enormous — orbital mechanics, satellite networks, tech trees, crew management, contracts, science, facilities, celestial bodies, docking, power systems, communications, and more.

### 1.3 Scope Creep

No features were identified that fall outside the requirements. The codebase stays within the documented scope.

---

## 2. Code Quality

### 2.1 Architecture — Strengths

The three-layer separation is well-maintained:

- **Core** (`src/core/`, 42 modules): Pure game logic, no DOM/canvas. State mutations happen here.
- **Render** (`src/render/`, 13 modules): PixiJS rendering, read-only access to game state. Render-local state (camera, trails) is properly isolated in `_state.js`.
- **UI** (`src/ui/`, 33 modules): DOM overlays, event handling. Calls core functions then triggers re-renders.
- **Data** (`src/data/`, 8 modules): Immutable catalogs. Never mutated at runtime.

Barrel re-exports keep the public API clean while allowing internal module splitting (flightController, vab, missionControl).

### 2.2 Bugs and Logic Errors

**No critical bugs found.** The following are notable concerns:

1. **localStorage quota not handled** (`src/core/saveload.js:205, 502`, `src/core/designLibrary.js:140`)
   - `localStorage.setItem()` can throw `QuotaExceededError` if the player accumulates many save files or large rocket designs. Currently unhandled — would cause a silent crash with potential data loss.
   - **Severity:** Medium. Easy to hit on games with extensive design libraries.
   - **Fix:** Wrap `setItem` calls in try-catch and surface a user-friendly quota warning.

2. **Module-level mutable state for malfunction mode** (`src/core/malfunction.js:57`)
   - `_malfunctionMode` is stored as a module variable rather than in `gameState`. This is a global setting that affects all flight logic and can't be persisted/restored with save/load.
   - **Severity:** Low. Works correctly in practice since it's only toggled via settings UI or E2E tests. But architecturally, it should live in `gameState` for consistency with the state mutation pattern.

3. **Flight phase transition sequencing** (`src/core/flightPhase.js:222-255`)
   - The MANOEUVRE exit handler checks for escape trajectory first, transitions through ORBIT to TRANSFER, and returns early (line 252). The normal manoeuvre exit is checked second (line 258). The early return prevents double-mutation, so this is **correct but fragile** — a future change that removes the early return would introduce a bug. A comment explaining the ordering dependency would help.

4. **Silent JSON.parse error swallowing** (`src/core/designLibrary.js:125-132`)
   - Corrupt design library data silently returns `[]` with no logging. This hides data corruption from the developer.
   - **Severity:** Low. `saveload.js` handles this better by throwing on corrupt data.

### 2.3 XSS and Input Sanitization

**Mostly well-handled.** Key findings:

- `src/ui/mainmenu.js` uses `_escapeHtml()` for user-supplied strings (agency name, save name) before innerHTML interpolation (line 872). This is the correct approach.
- `src/ui/library.js` and `src/ui/crewAdmin.js` use `textContent` for user-generated crew/rocket names — safe against XSS.
- **38 innerHTML template literal assignments** exist across 11 UI files, but grep analysis shows all interpolated values are either escaped, numeric, or from trusted internal data (enum labels, formatted numbers, mission names from static data).
- **No unescaped user input in innerHTML** was found. The codebase handles this correctly.

**Remaining concern:** Player-input strings (agency name, crew names, design names) have no length validation. Extremely long names could cause layout issues but not security problems.

### 2.4 Error Handling

- **Save/load:** Properly validates JSON and envelope structure. Throws descriptive errors on corrupt data. Corrupt slots in `listSaves()` are silently treated as empty (acceptable UX choice).
- **Missing:** No try-catch around `localStorage.setItem` for quota errors (see 2.2.1).
- **Missing:** No try-catch in the flight HUD's `requestAnimationFrame` loop. If physics state becomes invalid mid-flight, the HUD could crash without recovery.
- **Crypto fallback:** `crypto.randomUUID()` has a `Math.random()` fallback for environments without crypto. This is fine for a single-player game (IDs don't need to be cryptographically secure).

### 2.5 TypeScript Migration Status

Four core modules are TypeScript: `constants.ts`, `gameState.ts`, `physics.ts`, `orbit.ts`. Strict mode is enabled. The rest of the codebase is JavaScript.

17 TODO comments in the TypeScript files mark future typing work for JS module imports. The Vite plugin `jsToTsResolve` bridges the migration gap cleanly.

---

## 3. Testing

### 3.1 Unit Tests — Strong Foundation

- **52 test files, 2,271 tests, all passing** (34.95s runtime)
- Test setup (`src/tests/setup.js`) provides a clean in-memory `localStorage` mock.
- **High-quality test suites:**
  - `physics.test.js` (197 tests) — comprehensive fixture builders, launch/staging/fuel/drag/landing
  - `orbit.test.js` (98 tests) — Kepler solver convergence, orbital element computation, anomaly wrapping
  - `atmosphere.test.js` (92 tests) — heat model, shield protection, leading part selection
  - `contracts.test.js` — generation, completion, deadlines, cancellation
  - `crew.test.js` (112 tests) — status transitions, skills, hiring/firing

### 3.2 Unit Test Coverage Gaps

**Modules with no unit test file:**

| Module | Risk | Notes |
|---|---|---|
| `flightReturn.js` | **High** | Processes mission completion, objective validation, contract rewards, crew recovery — core gameplay logic |
| `sciencemodule.js` | Medium | Science module activation, data collection, yield calculation |
| `customChallenges.js` | Medium | Custom challenge creation and validation |
| `designLibrary.js` | Medium | Rocket design persistence, cross-save sharing |
| `parachute.js` (deployment) | Medium | Only descent/landing tests exist, not deployment trigger logic |
| `debugSaves.js` | Low | Test infrastructure; not player-facing |
| `settings.js` | Low | Simple settings management |
| `library.js` | Low | Statistics tracking |
| `testFlightBuilder.js` | Low | Test helper |

**`flightReturn.js` is the most significant gap** — it's the module that processes everything that happens when a flight ends (mission rewards, contract completion, part recovery, crew status updates, financial transactions). This complex logic path is only covered indirectly by E2E tests.

### 3.3 E2E Tests — Good Coverage with Reliability Concerns

- **31 spec files** covering all game phases plus UX scenarios
- Well-structured helper infrastructure: fixtures at multiple progression points, save factory, assertion helpers, interaction helpers
- Progression snapshots (`fixtures.js`) allow E2E tests to start at any game stage without replaying earlier content

**Reliability concerns:**

1. **76 `waitForTimeout()` calls** across 10 E2E spec files — these are arbitrary delays rather than condition-based waits. The heaviest offender is `additional-systems.spec.js` (19 occurrences). This pattern makes tests flaky under load.
   - **Fix:** Replace with `page.waitForFunction(() => condition)` where possible.

2. **Teleport pattern in `core-mechanics.spec.js`** — directly mutates `window.__flightPs` and `window.__flightState` to teleport to orbit, bypassing actual flight physics. This means the orbit entry transition code path is never E2E tested in realistic conditions.

3. **Happy-path bias** — E2E specs focus on successful missions, correct docking, proper satellite deployment. Missing: malfunction during flight, crew KIA recovery flow, contract deadline expiry, loan default/bankruptcy.

### 3.4 Test Infrastructure Quality

- Vitest configured in `vite.config.js` with `node` environment (appropriate for non-graphics unit tests)
- **Missing:** No code coverage configuration, no coverage thresholds, no `test:coverage` npm script
- Playwright targets only Chromium — no Firefox or WebKit

---

## 4. Performance and Resource Management

### 4.1 PixiJS Object Allocation

The flight renderer creates new `PIXI.Graphics()` objects every frame in multiple sub-modules:
- `_trails.js`: plumes (line 216), trails (line 373), RCS plumes (line 436), Mach effects (line 552)
- `_debris.js`: containers and graphics per debris fragment (lines 40, 47)
- `_rocket.js`: rocket part graphics (line 450)
- `_sky.js`: star graphics (line 160)
- `_ground.js`: biome label text objects (lines 162, 180)

Container children are properly cleared each frame before re-adding, so there are no memory leaks. However, the constant create-destroy cycle puts pressure on the garbage collector. For short flights this is fine; for long orbital sessions with time warp, it could cause periodic frame drops during GC pauses.

**Recommendation:** Implement graphics object pooling for frequently created rendering elements.

### 4.2 Hit Testing

`_rocket.js` `hitTestFlightPart()` iterates all parts on every mouse move (O(n)). For rockets with 30+ parts, this could cause perceptible lag.

### 4.3 Data Lookups

Mission and contract lookups use `Array.find()` (O(n)) in code paths that run per-flight. Building a `Map` by ID at module load would eliminate these repeated scans.

---

## 5. UI Module Lifecycle

### 5.1 Event Listener Management

Several UI modules add event listeners without corresponding cleanup:

- **`topbar.js`**: Click handlers on menu items, cash button — stored in arrays but cleanup path not verified for all cases
- **`help.js`**: Tab click handlers created every time help opens; not removed on close
- **`settings.js`**: Difficulty option click handlers not removed when panel closes
- **`debugSaves.js`**: Load button handlers not explicitly removed (relies on `panel.remove()` garbage collection)

In a long-running single-page app (which a game is), accumulated listeners can cause memory pressure and unexpected behavior when stale handlers fire.

### 5.2 Style Element Accumulation

Multiple UI modules inject `<style>` elements into `document.head` on initialization but never remove them during teardown. On repeated game sessions (main menu → game → exit → new game), style elements accumulate. Each cycle adds ~10KB of CSS that persists until page reload.

### 5.3 Timer Management

`debugSaves.js:343` stores a timeout on a DOM element property (`feedbackEl._timer`) but never clears the previous timeout before setting a new one. Rapid debug save loads stack timers.

---

## 6. Build and Configuration

### 6.1 Dependencies

- **Production:** Only `pixi.js@^8.0.0` — appropriate and minimal
- **Dev dependencies:** All correctly categorised. Using very recent major versions (TypeScript 6, Vite 6, ESLint 10, Vitest 3)
- **Risk:** These recent major versions may have undiscovered issues. Pin or test thoroughly.
- **Missing:** No `engines` field in `package.json` to specify required Node.js version

### 6.2 Build Configuration

- No explicit Vite `build` section — relies on defaults
- No sourcemap configuration for production
- No code-splitting strategy
- Custom `jsToTsResolve` plugin works well for migration but adds filesystem lookups at bundle time

### 6.3 ESLint

- Comprehensive correctness rules with separate configs for JS, TS, E2E, and unit tests
- **Missing:** No `no-console` rule — debug logs won't be caught in production code
- **Missing:** No async/await error handling rules

### 6.4 Playwright

- Only Chromium tested — missing Firefox and WebKit for a game that uses Canvas/WebGL
- HTML reporter only — should include console/list reporter for CI visibility
- Per-test timeout not explicitly set

---

## 7. Recommendations

### 7.1 Pre-Production (High Priority)

1. **Handle localStorage quota errors.** Wrap `localStorage.setItem()` in try-catch in `saveload.js` and `designLibrary.js`. Surface a user-friendly "Storage full" message. This is the most likely production failure mode.

2. **Add unit tests for `flightReturn.js`.** This module processes mission completion, contract rewards, and crew recovery — core gameplay with complex branching logic that currently has no direct test coverage.

3. **Replace `waitForTimeout` with conditional waits in E2E tests.** The 76 arbitrary delays make the test suite flaky. Replace with `page.waitForFunction(() => condition)` for deterministic behavior.

4. **Add coverage configuration to Vitest.** Configure `v8` coverage provider with thresholds (suggest 80% line/branch/function) and add `npm run test:coverage` script.

### 7.2 Quality Improvements (Medium Priority)

5. **Implement event listener cleanup** in `help.js`, `settings.js`, `debugSaves.js`. Create a helper that tracks listeners and clears them on panel close.

6. **Add Firefox and WebKit** to Playwright projects. Canvas rendering and WebGL behavior can differ across browsers.

7. **Add explicit Vite build configuration** — sourcemaps, minification strategy, code-splitting.

8. **Add `no-console` ESLint rule** (or a project-specific logger) to prevent debug output in production.

9. **Add input length validation** for player-supplied strings (agency name, crew names, design names) to prevent layout issues.

### 7.3 Polish (Low Priority)

10. **Move `_malfunctionMode` from module variable to `gameState`** for consistency with the state management pattern and save/load compatibility.

11. **Add `console.warn()` to silent error catches** in `designLibrary.js` JSON parsing.

12. **Add `engines` field to `package.json`** to document Node.js version requirement.

13. **Address the 17 TypeScript TODOs** as the JS→TS migration continues.

---

## 8. Future Considerations

### 8.1 Features and Improvements

- **Multiplayer/sharing:** The design library's cross-save JSON export/import is a natural foundation for sharing rocket designs online. A community sharing feature could be a compelling addition.
- **Accessibility:** No keyboard navigation or screen reader support exists. The Canvas+DOM architecture makes this achievable but would require significant work in the UI layer.
- **Mobile/touch support:** The game uses mouse/keyboard exclusively. Touch support would open up tablet play but would require rethinking the flight controls and VAB interaction model.
- **Modding support:** The data-driven architecture (parts, bodies, missions, instruments all defined in `src/data/`) is well-suited for modding. An external data loading system could enable community content.
- **Performance monitoring:** No runtime performance metrics are collected. Adding a simple FPS counter and memory tracking would help identify performance regressions.

### 8.2 Architectural Considerations

- **TypeScript migration:** Only 4 of 42 core modules are TypeScript. The strict-mode TypeScript files (`physics.ts`, `orbit.ts`) benefit significantly from type safety in complex numerical code. Prioritise converting `flightReturn.js`, `contracts.js`, and `missions.js` next — these have complex state manipulation that would benefit most from type checking.
- **State management scale:** The central `gameState` object works well now but will become unwieldy if more systems are added. Consider an event/message bus for decoupled communication between subsystems if the game grows significantly.
- **Render layer object pooling:** The per-frame Graphics allocation pattern works but won't scale to complex scenes (space stations, large debris fields). Implementing a simple object pool for PIXI.Graphics and PIXI.Text would improve GC behavior significantly.
- **CSS-in-JS approach:** Design tokens are defined in JavaScript (`design-tokens.js`) and injected as CSS custom properties. This works but means styles are duplicated between JS and CSS. As the UI grows, consider a build-time CSS generation step or moving to CSS modules.

### 8.3 Technical Debt

| Item | Location | Impact |
|---|---|---|
| 17 TypeScript TODOs | `gameState.ts`, `physics.ts` | Blocks full type safety across module boundaries |
| 76 `waitForTimeout` calls in E2E | 10 spec files | Flaky CI, non-deterministic test results |
| No coverage configuration | `vite.config.js` | Coverage regressions go undetected |
| Style element accumulation | Multiple UI modules | Memory growth across game sessions |
| Per-frame PixiJS allocations | `_trails.js`, `_debris.js`, `_rocket.js` | GC pressure on long flights |
| Module-level malfunction mode | `malfunction.js:57` | Inconsistent with gameState pattern |
| Single-browser E2E | `playwright.config.js` | Missing cross-browser validation |
| Missing `flightReturn.js` tests | `src/tests/` | Core gameplay logic untested directly |

---

## 9. Summary Statistics

| Metric | Value |
|---|---|
| Source lines (core/render/UI/data) | ~66,000 |
| Test lines (unit + E2E) | ~52,000 |
| Unit test files | 52 |
| Unit tests | 2,271 (all passing) |
| E2E spec files | 31 |
| Core modules | 42 |
| UI modules | 33 |
| Render modules | 13 |
| Data modules | 8 |
| TypeScript modules | 4 (strict mode) |
| Production dependencies | 1 (pixi.js) |
| Dev dependencies | 9 |
| Requirements tasks (iteration 1) | 69 (all done) |
| Requirements tasks (iteration 2 — UX polish) | 24 (all done) |
| Critical bugs found | 0 |
| High-priority recommendations | 4 |
| Medium-priority recommendations | 5 |
| Low-priority recommendations | 4 |
