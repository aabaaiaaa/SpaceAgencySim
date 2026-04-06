# Iteration 4 — Bug Fixes, Save Architecture, Web Worker Physics & Polish

This iteration addresses all findings from the Iteration 3 code review, plus two new features (save compression, Web Worker physics) and architectural cleanup (async save API, PixiJS v8 audit, import path migration, `as any` elimination). The focus is fixing bugs, hardening the save system, improving render performance, and completing the TypeScript migration to full type safety.

The codebase is ~60,400 lines of TypeScript across 154 source modules, with 2,815 unit tests and 37 E2E specs. All work builds on the existing codebase.

---

## 1. Bug Fixes & Resilience

### 1.1 Fix Deprecated PixiJS v7 API in `_debris.ts`

**File:** `src/render/flight/_debris.ts:117-141`

The docking target renderer uses PixiJS v7 methods (`beginFill`, `endFill`, `drawCircle`, `lineStyle`) that were removed in PixiJS v8. These are hidden behind unsafe type casts:

```typescript
(g as PIXI.Graphics & { beginFill: Function }).beginFill(0x00ccff, 0.7);
(g as PIXI.Graphics & { drawCircle: Function }).drawCircle(clampedX, clampedY, 8);
```

The project uses `pixi.js ^8.0.0`. These methods don't exist at runtime — the casts suppress the compiler but the calls will throw when a player attempts docking.

**Fix:** Replace with PixiJS v8 equivalents:
- `beginFill(color, alpha)` + `drawCircle(x, y, r)` + `endFill()` → `g.circle(x, y, r)` then `g.fill({ color, alpha })`
- `lineStyle(width, color, alpha)` → `g.stroke({ width, color, alpha })`

Verify by running the docking E2E tests after the fix. If no docking E2E test exercises this HUD code path, add one.

### 1.2 Full PixiJS v8 API Audit

The deprecated API in `_debris.ts` suggests other v7 patterns may exist elsewhere. Audit all PixiJS usage across the entire render layer (`src/render/`) against the v8 API documentation.

**Scope:**
- Search for all PixiJS v7 method names that were removed or renamed in v8: `beginFill`, `endFill`, `drawCircle`, `drawRect`, `drawRoundedRect`, `drawEllipse`, `drawPolygon`, `lineStyle`, `moveTo`, `lineTo`, `arcTo`, `bezierCurveTo`, `quadraticCurveTo`, `clear` (if used with old semantics), `addChild` (signature changes), `removeChild`, `destroy` (parameter changes)
- Check for any v7-style type casts like `as PIXI.Graphics & { methodName: Function }`
- Check for deprecated constructor patterns or property access
- Fix all deprecated patterns found
- If no other issues are found beyond `_debris.ts`, document the audit was performed with clean results

### 1.3 Try-Catch in Undo/Redo Callbacks

**File:** `src/core/undoRedo.ts:59, 70`

`action.undo()` and `action.redo()` have no try-catch. If a callback throws (stale state references, removed parts), the action is popped from one stack but never pushed to the other, silently corrupting the undo/redo system.

**Fix:** Wrap both calls in try-catch:
- On failure, push the action back to the stack it was popped from (restore previous state)
- Log the error via the structured logger (`logger.error('undoRedo', ...)`)
- Surface a brief toast/notification to the player: "Undo failed" / "Redo failed"

Unit tests should verify:
- Undo callback throwing doesn't corrupt the stacks (action remains on undo stack)
- Redo callback throwing doesn't corrupt the stacks (action remains on redo stack)
- The error is logged

### 1.4 Circular Reference Protection in Logger

**File:** `src/core/logger.ts:27`

`JSON.stringify(data)` will throw on circular references, crashing the logger itself.

**Fix:** Wrap the `JSON.stringify(data)` call in a try-catch. On failure, substitute `"[Unserializable data]"` (or similar). The logger must never throw — it's the last line of defence for error reporting.

Unit test: pass an object with a circular reference to `logger.error()` and verify it doesn't throw and produces output containing the fallback string.

---

## 2. Save System

### 2.1 Fully Async Save API

**Current state:** `saveGame()` and `loadGame()` are synchronous. IndexedDB is inherently async. The current hybrid architecture uses fire-and-forget `idbSet()` calls, creating race conditions and data loss risks (especially the fallback path in `saveload.ts:220` where IndexedDB is the only copy but isn't awaited).

**Change:** Make the save/load API fully async:

- `saveGame()` → `async saveGame()` returning `Promise<void>`
- `loadGame()` → `async loadGame()` returning `Promise<GameState>` (or similar)
- Update all callers throughout the codebase to `await` the save/load calls
- The IndexedDB write on the fallback path (localStorage full) must now be awaited — if it fails, the error propagates to the caller
- The IndexedDB mirror write (when localStorage succeeds) can remain fire-and-forget since localStorage already has the data

**Callers to update:**
- Auto-save system (`autoSave.ts`)
- Manual save UI (`topbar.ts` or wherever the save button lives)
- Design library save/load
- Debug saves
- Any E2E test helpers that call save/load

**Backward compatibility:** The synchronous `loadGame()` currently returns the state directly. The async version returns a Promise. All call sites must be updated. There's no need to keep a sync version — cut over fully.

### 2.2 Save Version Indicator on Save Slots

**Current state:** When a save from a newer game version is loaded, `logger.warn()` is called — but players never see the console.

**Change:** Instead of warning on load, show the version mismatch on the save slot itself in the save/load UI:

- Each save entry in the load screen should display the version it was created with
- If the save version doesn't match the current `SAVE_VERSION`, show a visual indicator — a warning badge, different text colour, or a small label like "v2 (current: v1)"
- The indicator should be informational, not blocking — the player can still choose to load it
- No dialog or toast on load needed; the information is already visible before the player clicks

### 2.3 Deeper Save Validation

**Current state:** `_validateState()` checks top-level field types but not nested structures. A corrupted array entry could crash deep in game logic.

**Change:** Extend `_validateState()` (or add sub-validators) to check critical nested structures:

- `missions.accepted` — each entry must have `id`, `destination`, `type`, `reward` (at minimum)
- `missions.completed` — same shape validation
- `crew` — each entry must have `name`, `status`, `skills`
- `orbitalObjects` — each entry must have `id`, `bodyId`, `elements`
- `savedDesigns` — each entry must have `name`, `parts`, `connections`
- `contracts.active` — each entry must have `id`, `type`, `reward`

For invalid entries:
- Filter them out (remove corrupted entries) rather than failing the entire load
- Log a warning via the structured logger for each removed entry
- This approach preserves as much save data as possible

Unit tests should cover:
- Loading a save with a corrupted mission entry (missing required fields) — verify it's filtered out
- Loading a save with a corrupted crew member — verify it's filtered out
- Loading a save where all entries are valid — verify nothing is removed

### 2.4 Save Compression

Large saves (many rocket designs, long mission histories) can approach localStorage's 5-10MB limit.

**Implementation:**
- Add compression to the save pipeline: after JSON serialization, compress with a lightweight algorithm before writing to storage
- Add decompression to the load pipeline: decompress before JSON parsing
- Use a pure-JS compression library suitable for browser use (e.g., `lz-string`, `fflate`, or `pako`) — evaluate options during implementation for bundle size and performance
- Handle backward compatibility: `loadGame()` must detect whether a save is compressed or uncompressed (pre-compression saves) and handle both. A simple approach: compressed saves get a prefix marker or the save envelope gets a `compressed: true` flag

**Storage impact:**
- Compression applies to both localStorage and IndexedDB writes
- The save version should be bumped when compression is added
- The version migration logic should handle loading uncompressed saves from older versions

**Testing:**
- Unit test: round-trip a save through compress → store → load → decompress and verify data integrity
- Unit test: loading an uncompressed save (pre-compression format) still works
- Measure and log compression ratios for typical saves to validate the approach is worthwhile

---

## 3. Performance

### 3.1 Extend Object Pooling to Hub and VAB Renderers

**Current state:** The flight renderer uses an object pool (`_pool.ts`) to reuse `PIXI.Graphics` objects. The hub renderer (`hub.ts:183-222`) creates 5+ new Graphics objects every frame. The VAB renderer (`vab.ts:304, 335, 370`) does the same during part dragging at 60fps. This generates GC pressure.

**Change:** Generalize the object pool to cover all renderers:

- **Option A:** Extend `_pool.ts` to be a shared pool used by flight, hub, and VAB
- **Option B:** Create a generic pool utility and have each renderer maintain its own pool instance

Either approach works. The key requirements:
- Hub's `_drawScene()` must reuse Graphics objects instead of creating new ones each frame
- VAB's part rendering, ghost layer, and mirror mode must reuse Graphics objects
- Pool cleanup must happen when each renderer is destroyed/unmounted
- The existing flight pool behaviour must not change

### 3.2 Web Worker Physics

Move the physics simulation (`tick()` and orbital calculations) off the main thread into a Web Worker. This prevents physics from blocking the render thread during complex time-warp scenarios.

**Architecture:**

The readonly render snapshot interfaces from Iteration 3 (`ReadonlyPhysicsState`, `ReadonlyFlightState`, etc.) provide the boundary. The worker owns the mutable state; the main thread receives readonly snapshots for rendering.

**Worker responsibilities:**
- Run `tick()` (gravity, drag, fuel consumption, staging)
- Run orbital mechanics calculations (Kepler solver, orbit propagation)
- Run flight phase evaluation
- Own the mutable physics state

**Main thread responsibilities:**
- Render using readonly state snapshots received from the worker
- Handle user input (throttle, staging, abort) and send commands to the worker
- Handle UI updates (HUD, map view)

**Communication protocol:**
- Main → Worker: commands (set throttle, stage, abort, set time warp, start/stop)
- Worker → Main: state snapshots at the render frame rate (or at a fixed rate the main thread interpolates from)
- Use `postMessage` with transferable objects where possible to minimize copy overhead
- State snapshots should be structured to match the readonly interfaces

**Considerations:**
- The worker needs access to data catalogs (parts, bodies, missions) — these are immutable and can be sent once at worker initialization
- Time warp is the critical scenario: at high warp, the worker runs many physics ticks per frame and sends a snapshot when done
- If the worker falls behind (very high warp), the main thread should render the latest available snapshot rather than queuing
- Error handling: if the worker crashes, detect it on the main thread and fall back to main-thread physics (or show an error)
- The flight controller loop needs refactoring: currently it calls `tick()` directly — it needs to instead send a command to the worker and receive snapshots

**Fallback:**
- Keep the ability to run physics on the main thread (for browsers that don't support Web Workers, or as a debugging mode)
- A flag in settings or a runtime check can control which mode is used

**Testing:**
- Unit tests for the worker message protocol (command → snapshot round trip)
- The existing physics unit tests should still pass (they test the core functions directly, which don't change)
- E2E tests should work unchanged since they interact through the UI, not directly with physics

---

## 4. Type Safety

### 4.1 Eliminate All `as any` Casts

**Current state:** 130 `as any` casts across 26 source files. These bypass TypeScript's type checking and can mask runtime errors.

**Full file list with cast counts:**

| File | Count |
|------|-------|
| `staging.ts` | 28 |
| `challenges.ts` | 15 |
| `contracts.ts` | 11 |
| `crew.ts` | 8 |
| `debugSaves.ts` | 8 |
| `docking.ts` | 8 |
| `flightReturn.ts` | 7 |
| `grabbing.ts` | 7 |
| `physics.ts` | 5 |
| Remaining 17 files | ~33 |

**Approach for each cast:**
1. Identify what type the value actually is
2. If an interface is missing or incomplete, extend it (in `gameState.ts` or a local types file)
3. If the property genuinely doesn't exist on the type, add it to the interface
4. If it's a type narrowing issue, use type guards or assertion functions
5. For test files (`debugSaves.ts`), `Partial<T>` and test-specific factory types are acceptable

**Rules:**
- Do not change runtime behaviour — this is a types-only pass
- Do not add runtime type checks to replace casts (unless the cast was masking a genuine bug)
- `as unknown as T` is acceptable in rare cases where the type system can't express the relationship, but prefer proper typing
- After the sweep, add an ESLint rule or `tsconfig` setting to prevent new `as any` usage (e.g., `@typescript-eslint/no-explicit-any` as a warning)

### 4.2 Remove `jsToTsResolve` Vite Plugin

**Current state:** The `jsToTsResolve` plugin in `vite.config.js` resolves `.js` import specifiers to `.ts` files. It was needed during the incremental TS migration. Now that all source files are TypeScript, it's unnecessary overhead.

**Change:**
- Update all import specifiers across the codebase from `.js` extensions to `.ts` extensions
- Remove the `jsToTsResolve` plugin from `vite.config.js`
- Verify the build still works: `npm run build`, `npm run dev`, `npm run typecheck`

**Scope:** This touches every file that imports another source file with a `.js` extension. It's mechanical (find-and-replace `.js'` → `.ts'` in import statements) but needs verification that no edge cases break (e.g., imports of actual `.js` files from `node_modules`, dynamic imports, test files).

**Note:** E2E test files and Playwright config are not part of the Vite pipeline — they may keep `.js` extensions if they're not TypeScript.

---

## 5. Code Cleanup

### 5.1 Standardize Event Listener Cleanup in `crewAdmin.ts`

**Current state:** `crewAdmin.ts` uses direct `addEventListener` calls. All other UI modules use `createListenerTracker()` for automatic cleanup on panel close.

**Change:** Migrate `crewAdmin.ts` to use `createListenerTracker()`:
- Create a tracker instance when the panel opens
- Route all `addEventListener` calls through the tracker
- Call the tracker's cleanup method when the panel closes
- This prevents listener leaks on repeated panel open/close

### 5.2 Remaining Inline Styles

A few inline style assignments remain after the CSS extraction in Iteration 3:

- `crewAdmin.ts` (lines 348, 567-569)
- `autoSaveToast.ts` (line 100)
- `flightHud.ts` (lines 392, 406, 423)

These use individual property assignments (`el.style.display = 'none'`, `el.style.opacity = '0'`) rather than CSS classes.

**Change:** For each inline style:
- Define a CSS class in the module's `.css` file
- Replace the inline style assignment with `classList.add()` / `classList.remove()` / `classList.toggle()`
- Use design token custom properties for colours, spacing, etc. where applicable

---

## 6. Testing

### 6.1 Raise Branch Coverage for Low Modules

Five modules are significantly below the 80% branch coverage target:

| Module | Branch Coverage | Key Gaps |
|--------|----------------|----------|
| `fuelsystem.ts` | 67% | SRB edge cases |
| `staging.ts` | 67% | Debris physics, landing legs |
| `mapView.ts` | 67% | Transfer state, shadow calculations |
| `atmosphere.ts` | 66% (lines) | High-altitude calculations (>100km) |
| `grabbing.ts` | 53% (lines) | Grab mechanics edge cases |

**Approach:**
- Run coverage with `--reporter=lcov` or similar to identify the specific uncovered branches in each module
- Write targeted unit tests that exercise those branches
- Goal: bring all five modules to >= 80% branch coverage
- After tests are written, update the global coverage thresholds if actual coverage has increased

### 6.2 Tests for New Code

All new code introduced in this iteration needs tests:

- **Web Worker physics** — message protocol, command handling, snapshot generation, error/fallback behaviour
- **Save compression** — round-trip integrity, backward compatibility with uncompressed saves
- **Async save API** — await behaviour, error propagation, IndexedDB fallback now properly awaited
- **Deeper save validation** — corrupted nested entries filtered, valid entries preserved
- **Undo/redo error handling** — stack integrity on callback failure
- **Logger circular reference** — no crash on circular data
- **Object pool in hub/VAB** — pool reuse verified, cleanup on destroy

These are specified inline in each section above but collected here for clarity.

---

## 7. Verification

After all changes are complete, run:

1. `npm run typecheck` — no errors, no `as any` casts (or only justified exceptions)
2. `npm run lint` — no errors
3. `npm run test:unit` — all tests pass
4. `npm run test:e2e` — all E2E specs pass
5. `npm run test:coverage` — meets or exceeds thresholds, low modules now above 80%
6. `npm run build` — production build succeeds without the `jsToTsResolve` plugin
7. Manual verification: open the game, attempt a docking mission (verifies PixiJS fix), perform a save/load cycle (verifies async save + compression), check save slot version indicators, open VAB and test undo/redo error recovery, run a long hub session and monitor GC pauses (verifies pool), run high time-warp flight (verifies Web Worker physics)
