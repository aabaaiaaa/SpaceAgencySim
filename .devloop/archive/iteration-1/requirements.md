# Iteration 3 — Architecture, TypeScript Migration, Auto-Save & Polish

This iteration addresses all findings from the Iteration 2 code review, plus new features (auto-save, VAB undo/redo, debug mode toggle) and two major architectural overhauls (full TypeScript migration, CSS extraction). No new game mechanics — the focus is resilience, developer experience, code quality, and architectural modernisation.

The codebase is ~60,400 lines of production code across 154 JS files and 4 TS files, with 2,550 unit tests and 608 E2E tests across 33 specs. All work builds on the existing codebase.

---

## 1. Error Handling & Resilience

### 1.1 Flight Controller Loop Error Handling

The main simulation loop in `src/ui/flightController/_loop.js:58-158` has no try-catch. If `tick()`, `evaluateFlightPhase()`, or any physics call throws (NaN propagation, missing part references, invalid orbital state), the entire game loop silently stops with no recovery path. The flight HUD loop (`flightHud.js:1621-1645`) was protected in Iteration 2 with a consecutive error counter and abort banner — but that's a secondary display loop. The primary simulation loop is unprotected.

Wrap the loop body (physics tick through render call) in try-catch with:
- A consecutive error counter (reset on successful frames)
- `console.error()` logging with the error and stack trace
- After N consecutive errors (e.g., 5), display an abort-to-hub banner matching the pattern in `flightHud.js`
- On non-consecutive errors, log and attempt to continue the next frame

Unit tests should verify the error handling behaviour: that `tick()` throwing is caught, that consecutive errors trigger the abort path, and that intermittent errors allow recovery.

### 1.2 Defensive Guards in Core Modules

Several core modules have unguarded property accesses that would throw on corrupted or incomplete state:

**designLibrary.js:204** — `state.savedDesigns.findIndex(...)` assumes `savedDesigns` is always an array. A corrupted save could leave it undefined or null. Add `if (!Array.isArray(state.savedDesigns)) state.savedDesigns = [];` before any `.findIndex()`, `.filter()`, or `.push()` calls on `savedDesigns`. Check all functions in the file that access this property.

**flightReturn.js:292** — `state.crew.find(...)` has no null guard. Use `(state.crew ?? []).find(...)` to prevent TypeError on corrupted state. Audit the rest of `flightReturn.js` for similar unguarded state access patterns and fix any found.

A unit test should cover calling `saveDesignToLibrary()` when `state.savedDesigns` is undefined, and calling flight return functions when `state.crew` is null/undefined.

### 1.3 Orbital Mechanics Safety

Two issues in `src/core/orbit.ts`:

**Unguarded sqrt(1 - e*e) at lines 169 and 186** — `meanAnomalyToTrue()` and `trueToEccentricAnomaly()` compute `Math.sqrt(1 - e * e)` without verifying `e < 1`. These are public exports; an external caller passing `e >= 1` (or floating-point eccentricity slightly exceeding 1.0) would get NaN propagation through all downstream calculations. Add `Math.max(0, 1 - e * e)` before the square root in both functions.

**Synodic period near-zero denominator at line 648** — The transfer window search computes `T_syn = |T_craft * T_target / (T_craft - T_target)|`. When `T_craft` and `T_target` are nearly equal but `periodDiff >= 0.01`, the denominator can be very small, producing an extremely large `T_syn`. The existing cap at line 652 handles Infinity, but doesn't catch cases where `0.01 <= periodDiff < ~0.1` produces multi-month search durations that freeze the game. Add a `Number.isFinite(T_syn)` check and a reasonable upper bound (e.g., `10 * Math.max(T_craft, T_target)`). If `T_syn` exceeds this bound, fall back to `Math.max(T_craft, T_target)` as the search duration.

Unit tests should cover:
- `meanAnomalyToTrue()` and `trueToEccentricAnomaly()` with `e` values at 0.9999, 1.0, and 1.001 — verify no NaN
- Synodic period calculation when `T_craft ≈ T_target` (periodDiff in the 0.01–0.1 range) — verify it doesn't produce unreasonable search durations

### 1.4 PixiJS Pool Fix

`src/render/flight/_debris.js:85` creates a `PIXI.Graphics` object for `dockingTargetGfx` directly via `new PIXI.Graphics()` rather than through the object pool system (`_pool.js`). This bypasses pool cleanup on renderer destroy. Route it through `acquireGraphics()` from the pool, and release it during cleanup.

---

## 2. Save System Improvements

### 2.1 Save Format Version Field

Save envelopes in `src/core/saveload.js` contain `saveName`, `timestamp`, and `state` but no schema version. The current migration logic (lines 254-300) handles missing fields with `??=` defaults, which works but makes it impossible to detect truly incompatible save formats or apply version-specific migration logic.

Add a `version` field (integer, starting at 1) to the save envelope written by `saveGame()`. On load:
- If `version` is missing (pre-versioning saves), treat as version 0 and apply all migrations
- If `version` matches current, load directly
- If `version` is higher than current (downgrade scenario), warn the user that the save was created by a newer version and may not load correctly
- Bump the version number whenever save format changes are made in future iterations

The existing `??=` migration logic should continue to work for backward compatibility with version-0 saves. New migrations added in this or future iterations should be gated by version checks.

### 2.2 Auto-Save with IndexedDB Backup

Currently localStorage is the only persistence layer, with a ~5-10MB quota. Implement an auto-save system that:

**Triggers:**
- Automatically saves at the end of every flight (when the post-flight summary appears, before the player returns to hub)
- Automatically saves on return to hub from any screen (VAB, Mission Control, etc.)
- Uses a dedicated auto-save slot separate from manual saves (so it never overwrites a manual save)

**Storage:**
- Primary storage remains localStorage for compatibility
- Mirror all saves (manual and auto) to IndexedDB as a backup layer
- If localStorage write fails (QuotaExceededError), attempt IndexedDB as fallback
- On load, check both storage layers and use the most recent valid save

**UI:**
- When an auto-save is about to happen, display a brief notification (e.g., a small toast/banner) with a cancel button
- The notification should appear for 3-5 seconds before the save executes
- If the player clicks cancel, skip the auto-save for that trigger only
- The notification should be unobtrusive — small, positioned to not block gameplay

**Settings:**
- Add an "Auto-save" toggle to the game settings panel (`src/ui/settings.js`)
- Enabled by default
- Persists across sessions via the game state save system
- When disabled, no auto-save triggers fire and no notifications appear

**IndexedDB details:**
- Use a simple key-value store (one database, one object store)
- Keys match localStorage keys for consistency
- No external library — use the raw IndexedDB API
- Handle IndexedDB being unavailable (private browsing in some browsers) gracefully — fall back to localStorage-only

### 2.3 Save Migration Edge Case Tests

The `loadGame()` migration logic in `saveload.js` (lines 254-300) has several untested paths. Add unit tests covering:

- Loading a save with `savedDesigns: null` (while `??=` does handle null, this is still worth testing explicitly as a distinct code path from undefined)
- Loading a save with `savedDesigns: undefined` (verify `??=` default works)
- Loading a save where `saveSharedLibrary()` throws during migration (line 283) — verify the load doesn't crash and the save still loads with degraded data
- Loading a save with invalid `malfunctionMode` values (values not in the enum) — verify it falls back to default
- Loading a pre-version save (no `version` field) after the version field is added — verify all migrations run
- Loading a save from a "future" version (higher than current) — verify the warning path

---

## 3. UX Improvements

### 3.1 Character Counter on Name Inputs

Player-input string fields have `maxlength` attributes but no visual feedback about remaining characters. Add character counters to:

- Agency name input in `src/ui/mainmenu.js` (maxlength: 48)
- Crew name inputs in `src/ui/crewAdmin.js` (maxlength: 60)
- Design name input in `src/ui/vab/_designLibrary.js` (maxlength: 60)

The counter should show "X / Y" (e.g., "23 / 48") below or beside the input field. It should update on every keystroke. Use a muted text style from the design token system. When within 5 characters of the limit, the counter should change to a warning color (use the existing `--color-warning` token).

### 3.2 Keyboard Navigation

Add keyboard navigation support to all interactive UI panels. This is a partial accessibility pass — not full ARIA/screen reader support, but enough that a keyboard-only player can navigate the game.

**Core behaviour:**
- All interactive elements (buttons, tabs, menu items, list items) should be focusable via Tab/Shift+Tab
- Focused elements should have a visible focus ring (use a consistent focus style via the design token system)
- Enter/Space should activate the focused element
- Escape should close the current modal/overlay/panel (many panels already support this — verify and fill gaps)

**Specific panels to address:**
- Main menu — tab through game mode options and start button
- Hub — tab between facility buttons
- VAB — tab through parts panel, staging panel, toolbar buttons
- Mission Control — tab through tabs, then through items within each tab
- Crew Admin — tab through crew cards and action buttons
- Settings — tab through difficulty options
- Topbar menu — arrow keys to navigate menu items
- Help panel — tab through help section tabs

**Do not** add ARIA roles, labels, or screen reader announcements in this iteration. Focus ring styling and tab order are the scope.

### 3.3 VAB Undo/Redo

The Vehicle Assembly Building has no undo capability. For complex rocket designs, accidentally deleting a part or misplacing a component requires manual reconstruction.

**Implement an undo/redo stack:**
- Track state changes: part placement, part deletion, part movement, staging changes, rocket rotation
- Each action pushes a snapshot or delta onto the undo stack
- Undo (Ctrl+Z) pops the last action and restores the previous state
- Redo (Ctrl+Y or Ctrl+Shift+Z) re-applies the undone action
- The stack should have a reasonable depth limit (e.g., 50 actions) to avoid memory bloat
- Clear the redo stack when a new action is performed after an undo

**Approach — delta-based, not full snapshots:**
The rocket assembly state can be large (30+ parts with positions, connections, staging). Full snapshots at every action would be wasteful. Instead, record the inverse operation for each action:
- Part placed → undo = remove that part (store part data for redo)
- Part deleted → undo = re-add that part at its previous position with previous connections
- Part moved → undo = move back to previous position (store old position for redo)
- Rotation changed → undo = restore previous rotation angle
- Staging changed → undo = restore previous staging configuration

**UI:**
- Add Undo/Redo buttons to the VAB toolbar
- Show them greyed out when the respective stack is empty
- Keyboard shortcuts: Ctrl+Z (undo), Ctrl+Y (redo)
- Optional: show a tooltip with the action name (e.g., "Undo: Delete Fuel Tank")

**Integration with design library:**
- Loading a design from the library should clear the undo/redo stack (it's a new starting point)
- Saving a design should NOT affect the undo/redo stack

### 3.4 Debug FPS/Frame-Time Monitor

Add a lightweight performance monitor visible only in debug mode (see Section 3.5 for the debug toggle).

**Display:**
- Small overlay in the top-right corner of the canvas during flight
- Shows: FPS (frames per second), frame time (ms), and optionally a mini graph of the last ~60 frame times
- Update the display every ~500ms (not every frame — the display itself shouldn't impact performance)
- Use a semi-transparent background so it doesn't fully obscure the game

**Data collection:**
- Track `performance.now()` delta between frames
- Compute rolling average FPS over the last 60 frames
- Track min/max frame time over the last second
- Optionally expose the data on `window.__perfStats` for E2E tests to verify performance

**Visibility:**
- Only visible when debug mode is enabled (Section 3.5)
- Only active during flight (not hub, VAB, etc.)
- The monitor should not allocate or create objects per-frame — use the same DOM elements and update their text content

### 3.5 Debug Mode Toggle

Currently debug features (debug saves via Ctrl+Shift+D, and any other debug tools) are always available. They should be hidden by default and controlled by a setting.

**Settings integration:**
- Add a "Debug Mode" toggle to the game settings panel (`src/ui/settings.js`)
- Default: off (hidden)
- Persists across sessions via the game state save system
- When off: Ctrl+Shift+D does nothing, debug saves panel is inaccessible, FPS monitor is hidden, any other debug UI is hidden
- When on: all debug features are accessible as they are today

**E2E test support:**
- Tests that rely on debug features must enable debug mode programmatically before interacting with them
- Expose a mechanism (e.g., `window.__enableDebugMode()` or setting `window.__gameState.settings.debugMode = true`) that tests can call via `page.evaluate()`
- Ensure all existing E2E tests that use debug features are updated to enable debug mode first

**What counts as "debug":**
- Debug saves panel (Ctrl+Shift+D)
- FPS/frame-time monitor (Section 3.4)
- Any `window.__` state exposure that is only needed for debugging (note: `window.__gameState` is also used by E2E tests, so it should remain available regardless — but it could be gated behind debug mode if tests enable it before use)

---

## 4. Architecture

### 4.1 Full TypeScript Migration

Convert all remaining JavaScript files to TypeScript. The project currently has 4 TypeScript files (`constants.ts`, `gameState.ts`, `physics.ts`, `orbit.ts`) and 154 JavaScript source files (~60,400 lines) plus 60 test files.

**Existing infrastructure:**
- `tsconfig.json` with `moduleResolution: "bundler"`, `allowJs: true`, `checkJs: false`
- Vite plugin `jsToTsResolve` in `vite.config.js` that resolves `.js` import specifiers to `.ts` files — no consuming files need import path changes
- ESLint configured with `@typescript-eslint` parser for `.ts` files

**Migration order (by layer, bottom-up):**

1. **Data layer** (`src/data/`) — 8 files, ~3,800 lines. Pure static catalogs. These define the types that everything else consumes. Convert these first so that type definitions flow upward.

2. **Core layer** (`src/core/`) — 44 files, ~19,000 lines. Pure game logic. These import from data and from each other. The 4 already-converted TS files are here. Convert remaining 44 files.

3. **Render layer** (`src/render/`) — 17 files, ~5,900 lines. Reads state, renders via PixiJS. Convert after core so render modules get typed state interfaces.

4. **UI layer** (`src/ui/`) — 85 files, ~28,000 lines. DOM manipulation, event handling, calls core functions. This is the largest layer. Convert after core and render.

5. **Entry point** — `src/main.js` (173 lines). Convert last.

6. **Test files** (`src/tests/`) — 60 files. Convert after the modules they test. Test files may use looser typing (`any` for fixture factories, partial state objects, etc.) — that's acceptable.

**Conversion guidelines:**
- Add proper type annotations to function parameters, return types, and module-level variables
- Replace JSDoc `@typedef` and `@param` annotations with TypeScript interfaces/types
- Use the existing types in `gameState.ts` and `constants.ts` wherever applicable — don't create duplicate type definitions
- For PixiJS objects in the render layer, use the types from the `pixi.js` package
- For DOM elements in the UI layer, use proper DOM types (`HTMLElement`, `HTMLInputElement`, etc.)
- Avoid `any` where a specific type is known. Use `unknown` for genuinely unknown types that need runtime checking
- Module-internal types can be defined in the same file. Types shared across modules should go in a shared types file or in `gameState.ts` if they describe state shapes
- The `jsToTsResolve` Vite plugin means import specifiers can keep their `.js` extensions during migration — the plugin handles resolution. However, once the full migration is complete, consider updating imports to use `.ts` extensions and removing the plugin

**What NOT to do:**
- Don't refactor logic during migration — this is a mechanical type-addition pass, not a rewrite
- Don't change public APIs or function signatures (unless required for type correctness)
- Don't add runtime type checking or validation — this is compile-time only
- Don't convert E2E test files or Playwright config (these run in Node.js outside the Vite pipeline)

### 4.2 CSS Migration

Extract all CSS from JavaScript template literals into proper `.css` files. Currently 18 UI modules inject styles via `injectStyleOnce()` from `src/ui/injectStyle.js`, with CSS defined as template literal strings in JavaScript.

**Approach:**

For each UI module that injects CSS:
1. Extract the CSS string into a co-located `.css` file (e.g., `hub.js` → `hub.css`, `vab/_css.js` → `vab/vab.css`)
2. Import the CSS file in the module using Vite's CSS import (`import './hub.css'`) — Vite handles injection automatically
3. Remove the `injectStyleOnce()` call and the CSS template literal from the JS module
4. Delete `src/ui/injectStyle.js` once all consumers are migrated (or keep it if any edge case still needs runtime injection)

**Design tokens migration:**
- `src/ui/design-tokens.js` currently injects CSS custom properties into `:root` via a `<style>` tag, plus exports button/layout utility classes
- Extract the `:root` custom properties and utility classes into `src/ui/design-tokens.css`
- Import `design-tokens.css` at the app entry point (`main.js`) so tokens are available globally
- The JS file can be removed if it only contained CSS. If it also exports JS constants used by other modules, keep the JS exports and only extract the CSS portion

**Dynamic values:**
Some CSS template literals interpolate JavaScript constants (e.g., `${VAB_TOOLBAR_HEIGHT}px`). For these cases:
- If the value is a fixed constant, hardcode it in the CSS (with a comment noting the source)
- If the value truly needs to be dynamic, define it as a CSS custom property set from JS at initialisation time
- Audit `src/ui/vab/_css.js` and `src/ui/flightController/_css.js` specifically — these are the largest CSS modules and most likely to have dynamic interpolations

**Files to migrate** (18 modules, 23 injection calls):
`crewAdmin.js`, `debugSaves.js`, `flightContextMenu.js`, `flightHud.js`, `help.js`, `hub.js`, `launchPad.js`, `library.js`, `mainmenu.js`, `rdLab.js`, `rocketCardUtil.js`, `satelliteOps.js`, `settings.js`, `topbar.js`, `trackingStation.js`, `flightController/_init.js`, `missionControl/_init.js`, `vab/_init.js`, `vab/_designLibrary.js`

Plus the dedicated CSS modules: `vab/_css.js`, `flightController/_css.js`, `missionControl/_css.js` — these files exist solely to hold CSS strings and can be replaced entirely by `.css` files.

### 4.3 Structured Logging

Replace ad-hoc `console.warn()` and `console.error()` calls with a lightweight structured logger.

**Logger API:**
```typescript
logger.info('flight', 'Phase transition', { from: 'LAUNCH', to: 'FLIGHT' });
logger.warn('save', 'Corrupt design data, resetting', { raw: jsonString });
logger.error('physics', 'NaN detected in position', { posX, posY, frame });
```

**Implementation:**
- A single module (`src/core/logger.ts`) exporting the logger
- Log levels: `debug`, `info`, `warn`, `error`
- Each log entry includes: timestamp (ISO 8601), category (string), message, optional data object
- Output to `console.log/warn/error` (don't replace the console — wrap it)
- A configurable minimum level (default: `warn` in production, `debug` in dev/test)
- The logger should be a simple object, not a class — no instantiation ceremony

**Migration:**
- Replace existing `console.warn()` calls added in Iteration 2 (error handling in saveload.js, designLibrary.js, flightHud.js) with `logger.warn()`
- Replace `console.error()` calls in error handling paths with `logger.error()`
- Do NOT migrate every `console.log` in the codebase — only migrate the structured error/warning paths. The `no-console` ESLint rule (added in Iteration 2) already prevents new `console.log` calls in production code
- Add a `logger.debug()` call at key lifecycle points: game start, flight start, flight end, save, load

### 4.4 Inline Style Cleanup

Several runtime UI elements use inline `style.cssText` strings rather than the design token system:
- `flightHud.js:1656-1658` — error banner
- `_showErrorBanner()` and similar error/modal overlay functions
- Any other runtime-created UI elements that set `style.cssText` or `style.*` properties directly

Migrate these to use CSS classes defined in the module's stylesheet (which will be a `.css` file after Section 4.2). The error banner, abort overlay, and similar runtime elements should use classes that reference design token custom properties for colours, spacing, font sizes, and z-index values.

This work depends on Section 4.2 (CSS migration) being done first, since the inline styles need CSS classes to move to.

### 4.5 Render Layer State Snapshot Interface

The render layer currently receives game state objects by reference via function parameters. While it correctly never mutates state (verified — no writes detected), the contract is enforced by convention, not by the type system. Formalising this with TypeScript `Readonly` interfaces would:
- Prevent accidental mutations via compile-time checking
- Document exactly which state properties the render layer needs
- Enable future optimisations (Web Worker physics, state diffing) by making the interface explicit

**Current call signatures:**
```typescript
renderFlightFrame(ps, assembly, flightState, surfaceItems)
renderMapFrame(ps, flightState, state, bodyId, options)
setHubWeather(visibility, extreme)
setBuiltFacilities(builtIds)
vabSetAssembly(assembly)
```

**Approach:**

Define read-only snapshot interfaces in a new `src/render/types.ts` (or in `gameState.ts` alongside the mutable versions):

- `ReadonlyPhysicsState` — `Readonly<>` wrapper over the physics state properties that the render layer reads (position, velocity, angle, active parts, debris, heat map, parachute states, etc.)
- `ReadonlyFlightState` — phase, orbital elements, body ID, transfer state, time elapsed
- `ReadonlyGameState` — only the subset the map renderer needs (orbital objects, surface items)
- `ReadonlyAssembly` — parts map, connections

Update the render function signatures to accept these readonly types instead of the mutable originals. The callers (in `flightController/_loop.js` and `hub.js`) can pass the mutable state — TypeScript allows assigning mutable to readonly. The render layer just can't write back.

This work depends on Section 4.1 (TypeScript migration) being complete for the render layer, since the interfaces need TypeScript to enforce.

---

## 5. Testing

### 5.1 Coverage Threshold Enforcement

Iteration 2 left branch coverage at 78%, below the 80% target. After all new code and tests in this iteration are written:

1. Run coverage analysis with the v8 provider
2. Identify the modules with the lowest branch coverage and write targeted tests to bring branches above 80%
3. Set all three thresholds (lines, branches, functions) to match actual coverage or slightly below — with 80% as the absolute floor
4. If coverage significantly exceeds 80% (e.g., 85%+), set thresholds at that higher level to lock in the gains and prevent regression

The `npm run test:coverage` script already exists from Iteration 2.

### 5.2 Unit Tests for Code Fixes

Each code fix in Sections 1.1–1.4 needs accompanying unit tests. These are specified inline in each section above but collected here for clarity:

- **Flight controller loop error handling** — test that `tick()` throwing is caught, consecutive errors trigger abort, intermittent errors allow recovery
- **designLibrary.js null guard** — test `saveDesignToLibrary()` with `state.savedDesigns` as undefined and null
- **flightReturn.js null guard** — test flight return functions with `state.crew` as null/undefined
- **orbit.ts sqrt clamping** — test `meanAnomalyToTrue()` and `trueToEccentricAnomaly()` with `e` values at 0.9999, 1.0, 1.001
- **orbit.ts synodic period** — test the transfer window search with nearly-equal orbital periods (periodDiff 0.01–0.1)
- **Save migration edge cases** — as detailed in Section 2.3

### 5.3 E2E Helper Splitting

The E2E test helper file `e2e/helpers/_interactions.js` has grown to 415 lines with teleport, time warp, flight control, and state seeding functions mixed together. Split it into focused sub-modules:

- `e2e/helpers/_flight.js` — teleport helper, flight control (throttle, staging, abort)
- `e2e/helpers/_timewarp.js` — time warp API, wait-for-time helpers
- `e2e/helpers/_state.js` — state seeding, save factory integration, game state queries
- `e2e/helpers/_navigation.js` — screen navigation (open settings, go to hub, go to VAB, etc.)

Maintain the barrel re-export at `e2e/helpers.js` so existing test imports don't break. Each sub-module should be independently importable for tests that only need a subset.

### 5.4 E2E Tests for Debug Mode Toggle

After the debug mode toggle (Section 3.5) is implemented, add E2E tests verifying:
- Debug saves shortcut (Ctrl+Shift+D) does nothing when debug mode is off
- Enabling debug mode in settings makes the debug saves shortcut work
- The setting persists across a save/load cycle
- FPS monitor is only visible when debug mode is on during flight
- E2E test helper correctly enables debug mode programmatically

---

## 6. Verification

After all changes are complete, run:

1. `npm run typecheck` — no errors (entire codebase is now TypeScript)
2. `npm run lint` — no errors
3. `npm run test:unit` — all tests pass (existing 2,550+ plus all new tests)
4. `npm run test:e2e` — all E2E specs pass (including updated and new specs)
5. `npm run test:coverage` — meets or exceeds 80% on lines, branches, and functions (thresholds set to actual coverage)
6. Manual verification: open the game, check that debug features are hidden by default, enable debug mode in settings, verify debug saves and FPS monitor appear, perform a flight and verify auto-save notification appears at flight end
