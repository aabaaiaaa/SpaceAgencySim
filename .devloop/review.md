# Iteration 3 — Final Code Review

**Date:** 2026-04-04
**Scope:** Full codebase review against Iteration 3 requirements
**Codebase:** ~60,400 lines of TypeScript across 154 source modules, 64 unit test files (2,815 tests), 37 E2E spec files

---

## 1. Requirements vs Implementation

### 1.1 Requirement Completion Matrix

All 32 tasks have status `done`. Below is the requirement-by-requirement assessment.

| Req | Section | Description | Status | Notes |
|-----|---------|-------------|--------|-------|
| 1.1 | Error Handling | Flight controller loop try-catch | **Complete** | `_loop.ts` has consecutive error counter + abort banner |
| 1.2 | Error Handling | Defensive guards in designLibrary/flightReturn | **Complete** | Null coalescing guards present |
| 1.3 | Error Handling | Orbital mechanics safety (sqrt clamp, synodic cap) | **Complete** | `orbit.ts` uses `Math.max(0, 1 - e*e)` and caps T_syn |
| 1.4 | Error Handling | PixiJS pool fix for dockingTargetGfx | **Complete** | Routed through pool, but see issue 2.2.1 below |
| 2.1 | Save System | Save format version field | **Complete** | SAVE_VERSION constant, migration gating |
| 2.2 | Save System | Auto-save with IndexedDB backup | **Complete** | Full implementation with toast UI, settings toggle |
| 2.3 | Save System | Save migration edge case tests | **Complete** | 6+ edge case tests covering null, undefined, corrupt saves |
| 3.1 | UX | Character counters on name inputs | **Complete** | mainmenu, crewAdmin, designLibrary all have counters |
| 3.2 | UX | Keyboard navigation | **Complete** | Focus ring, Tab/Enter/Space/Escape across all panels |
| 3.3 | UX | VAB undo/redo | **Complete** | Delta-based stack, Ctrl+Z/Y, 50-action depth limit |
| 3.4 | UX | Debug FPS/frame-time monitor | **Complete** | Overlay with graph, gated by debug mode |
| 3.5 | UX | Debug mode toggle | **Complete** | Settings toggle, `window.__enableDebugMode()` for E2E |
| 4.1 | Architecture | Full TypeScript migration | **Complete** | Zero `.js` files in `src/`, `npm run typecheck` passes |
| 4.2 | Architecture | CSS extraction from JS | **Complete** | Zero `injectStyleOnce` calls, 21 `.css` files, zero `style.cssText` |
| 4.3 | Architecture | Structured logger | **Complete** | `logger.ts` with levels, categories, timestamps |
| 4.4 | Architecture | Inline style cleanup | **Complete** | No `style.cssText` remaining |
| 4.5 | Architecture | Readonly render snapshot interfaces | **Complete** | `types.ts` with ReadonlyPhysicsState etc. |
| 5.1 | Testing | Coverage thresholds >= 80% | **Complete** | Lines 89%, Branches 80.09%, Functions 91% |
| 5.2 | Testing | Unit tests for code fixes | **Complete** | All defensive guard and error handling paths tested |
| 5.3 | Testing | E2E helper splitting | **Complete** | 8 focused sub-modules, `_interactions.js` removed |
| 5.4 | Testing | E2E tests for debug mode | **Complete** | debug-mode.spec.js with 5+ tests |

### 1.2 Gaps & Partial Implementations

**No requirements are unmet.** All 32 tasks are marked done and verified. However, the following areas have implementation nuances worth noting:

1. **Save version warning (Req 2.1)** — When a save from a future version is loaded, the code logs a `logger.warn()` but does **not** surface a user-visible warning dialog. The requirement says "warn the user," which could be interpreted as needing a UI toast. Current implementation only logs to console.

2. **IndexedDB fallback on load (Req 2.2)** — The `loadGame()` function reads from localStorage only. The async `loadGameAsync()` checks both layers, but the primary synchronous load path doesn't fall back to IndexedDB. This is architecturally reasonable (sync vs async), but means players using the synchronous load path won't benefit from IndexedDB backup.

3. **Synodic period cap (Req 1.3)** — Implemented correctly, but the cap may cause legitimate long-period transfers to be truncated. The requirement acknowledges this trade-off; a log message when capping occurs would aid debugging.

### 1.3 Scope Creep Assessment

No significant scope creep detected. All code changes map to documented requirements. Minor additions that weren't explicitly required but are reasonable:
- `_resetDbForTesting()` export in `idbStorage.ts` (needed for test isolation)
- `UNDO_MAX_DEPTH` export in `undoRedo.ts` (needed for test assertions)

These are test infrastructure additions, not feature creep.

---

## 2. Code Quality

### 2.1 Bugs & Logic Errors

#### 2.1.1 CRITICAL: Deprecated PixiJS API Usage in `_debris.ts`

**File:** `src/render/flight/_debris.ts:117-141`

The docking target renderer uses PixiJS v7 API methods (`beginFill`, `endFill`, `drawCircle`, `lineStyle`) that were removed in PixiJS v8. These are accessed via unsafe type casts:

```typescript
(g as PIXI.Graphics & { beginFill: Function }).beginFill(0x00ccff, 0.7);
(g as PIXI.Graphics & { drawCircle: Function }).drawCircle(clampedX, clampedY, 8);
```

The project uses `pixi.js ^8.0.0`. These methods don't exist on the v8 Graphics class — the casts suppress the compiler error but the calls will throw at runtime. The modern v8 equivalent would use `g.circle()` / `g.fill()` / `g.stroke()`.

**Impact:** Docking target HUD will crash when a player attempts docking operations.

#### 2.1.2 HIGH: Fire-and-Forget IndexedDB Writes in `saveload.ts`

**File:** `src/core/saveload.ts:220, 229`

When localStorage throws `QuotaExceededError`, the fallback to IndexedDB is fire-and-forget:

```typescript
idbSet(key, json).catch(() => {});
```

The function then throws an error to the caller, but the IndexedDB write may still be in flight. If the page closes before the write completes, the save is lost entirely. The mirror write on line 229 is also fire-and-forget, which is acceptable for the mirror (localStorage succeeded), but not for the fallback path.

**Impact:** Potential data loss when localStorage is full and the player closes the browser quickly after saving.

#### 2.1.3 MEDIUM: `flightReturn.ts` Uses `as any` for Physics State Access

**File:** `src/core/flightReturn.ts` (7 `as any` casts)

Multiple `as any` casts access properties on the physics state that aren't part of the declared type. For example, `(ps as any)._usedInventoryParts` accesses a property that may not exist, silently returning `undefined`. This bypasses the TypeScript type system and could mask missing data.

#### 2.1.4 LOW: Logger `JSON.stringify` Without Circular Reference Protection

**File:** `src/core/logger.ts:27`

```typescript
if (data !== undefined) return `${base} ${JSON.stringify(data)}`;
```

If `data` contains circular references (e.g., a caught Error with circular cause chain), `JSON.stringify` will throw, crashing the logger itself. A try-catch around the stringify or a safe replacer function would prevent this.

#### 2.1.5 LOW: Undo/Redo Callbacks Not Error-Guarded

**File:** `src/core/undoRedo.ts:59, 70`

The `action.undo()` and `action.redo()` calls have no try-catch. If a callback throws (e.g., due to stale state references), the undo/redo stack becomes inconsistent — the action is popped from one stack but never pushed to the other.

### 2.2 Performance Concerns

#### 2.2.1 Per-Frame Graphics Allocation in Hub Renderer

**File:** `src/render/hub.ts:183-222`

The hub renderer creates 5+ new `PIXI.Graphics()` objects every frame in `_drawScene()`. Unlike the flight renderer which uses an object pool, the hub creates and discards objects on every render tick. While the hub scene is simpler than flight, this still generates GC pressure during long hub sessions.

#### 2.2.2 Per-Frame Graphics Allocation in VAB Renderer

**File:** `src/render/vab.ts:304, 335, 370`

The VAB renderer similarly creates new Graphics objects per frame for parts, ghost layer, and mirror mode. The VAB renders at 60fps during part dragging, making this a noticeable source of GC pauses.

#### 2.2.3 Object Pool Not Used Outside Flight

The object pool (`_pool.ts`) is only used in the flight render sub-modules. The hub and VAB renderers create objects directly with `new PIXI.Graphics()`. The pool system could be generalized to cover all renderers.

### 2.3 Type Safety

**130 `as any` casts** remain across 26 source files. The heaviest offenders:

| File | Count | Notes |
|------|-------|-------|
| `staging.ts` | 28 | Accessing untyped part properties |
| `challenges.ts` | 15 | Untyped mission/contract data |
| `contracts.ts` | 11 | Untyped reward calculations |
| `crew.ts` | 8 | Untyped crew skill data |
| `debugSaves.ts` | 8 | Test data factories |
| `docking.ts` | 8 | Untyped physics state |
| `flightReturn.ts` | 7 | Untyped physics state |
| `grabbing.ts` | 7 | Untyped collision data |
| `physics.ts` | 5 | Cross-module type gaps |

While `as any` was acceptable during the TS migration to unblock compilation, these represent type safety gaps that should be narrowed over time.

### 2.4 Security Considerations

1. **XSS via name inputs** — Character counter implementation in `vab/_designLibrary.ts` uses `.replace(/"/g, '&quot;')` for HTML attribute escaping. The mainmenu and crewAdmin inputs also sanitize. No XSS vectors detected.

2. **localStorage injection** — `loadGame()` parses arbitrary JSON from localStorage. While localStorage is same-origin, a malicious browser extension could inject crafted JSON. The `_validateState()` function checks surface-level field types but not deeply nested shapes. Consider adding validation for critical nested objects (missions, crew arrays).

3. **No eval or innerHTML with unsanitized user input** detected in the codebase.

---

## 3. Testing

### 3.1 Coverage

Coverage thresholds are properly configured in `vite.config.js`:
- **Lines: 89%** (threshold: 89) -- Exceeds 80% minimum
- **Branches: 80.09%** (threshold: 80) -- Meets minimum
- **Functions: 91%** (threshold: 91) -- Exceeds 80% minimum

All iteration 3 features have dedicated unit tests:

| Feature | Test File | Line Coverage | Branch Coverage |
|---------|-----------|---------------|-----------------|
| Auto-save | `autoSave.test.ts` | 100% | 82% |
| Undo/Redo | `undoRedo.test.ts` | 97% | 96% |
| Debug Mode | `debugMode.test.ts` | 100% | 100% |
| Save Versioning | `saveload.test.ts` | 89% | 81% |
| IndexedDB | `idbStorage.test.ts` | 92% | 92% |
| Logger | `branchCoverage.test.ts` | 100% | 88% |

### 3.2 E2E Test Quality

**Structure:** Excellent. The monolithic `_interactions.js` has been properly split into 8 focused sub-modules (`_flight.js`, `_timewarp.js`, `_state.js`, `_navigation.js`, `_assertions.js`, `_factories.js`, `_saveFactory.js`, `_constants.js`) with a barrel re-export at `helpers.js`.

**Flaky patterns:** Only 5 `waitForTimeout` calls remain across 37 spec files, all justified (waiting for confirmation that something does NOT appear). 242 instances of conditional `waitForFunction` waits. No blind sleep anti-patterns.

**Serial test isolation:** Stateful E2E specs correctly use `test.describe.configure({ mode: 'serial' })`.

### 3.3 Untested Edge Cases

1. **Branch coverage below 80% in 3 core modules:**
   - `fuelsystem.ts` — 66.66% branches (SRB edge cases untested)
   - `staging.ts` — 67.16% branches (debris physics, landing legs)
   - `mapView.ts` — 67.30% branches (transfer state, shadow calculations)

   These are excluded from the global threshold because coverage measures `src/core/**` as a whole, but they represent pockets of under-tested logic.

2. **`atmosphere.ts`** — 66.39% line coverage. High-altitude atmospheric calculations (above 100km) not fully tested.

3. **`grabbing.ts`** — 53.17% line coverage. Grab mechanics edge cases sparse.

4. **Concurrent save operations** — No test verifies behavior when auto-save and manual save trigger simultaneously. The shared library migration in `loadGame()` (lines 289-310) modifies arrays in place without concurrency protection.

5. **IndexedDB quota exhaustion** — `idbStorage.ts` has no quota management or tests for quota-exceeded scenarios in IndexedDB itself (only localStorage quota is tested).

6. **Deprecated PixiJS API in _debris.ts** — No unit or E2E test exercises the docking target rendering code path with the deprecated v7 methods. This bug would be caught by an E2E docking test that validates the HUD renders without errors.

---

## 4. Recommendations

### 4.1 Must Fix (Before Production)

1. **Fix deprecated PixiJS v7 API calls in `_debris.ts:117-141`** — Replace `beginFill`/`endFill`/`drawCircle`/`lineStyle` casts with PixiJS v8 equivalents (`circle()`, `fill()`, `stroke()`). This will crash at runtime during docking.

2. **Await IndexedDB fallback on quota error in `saveload.ts:220`** — Either make the fallback awaitable (return a Promise) or re-throw only after confirming the IndexedDB write succeeded. Current fire-and-forget can lose saves.

### 4.2 Should Fix (High Priority)

3. **Add try-catch in `undoRedo.ts:59,70`** around `action.undo()` / `action.redo()` to prevent stack corruption on callback errors.

4. **Add circular reference protection to `logger.ts:27`** — Wrap `JSON.stringify(data)` in try-catch with a fallback like `"[Unserializable data]"`.

5. **Surface future-version save warning to UI** — The `loadGame()` path logs a warning when loading a save from a newer version, but players will never see the console. Add a toast or dialog.

6. **Extend object pooling to hub and VAB renderers** — `hub.ts:183-222` and `vab.ts:304-370` create Graphics objects per frame. Generalizing the flight pool or implementing simple reuse patterns would reduce GC pressure.

### 4.3 Should Improve (Medium Priority)

7. **Narrow `as any` casts** — 130 `as any` casts across 26 files undermine the TypeScript migration. Prioritize `staging.ts` (28), `challenges.ts` (15), and `contracts.ts` (11) where type safety gaps are largest.

8. **Add deeper save validation** — `_validateState()` checks top-level field types but not nested shapes. A corrupted `missions.accepted` array with missing fields could cause runtime crashes deep in game logic.

9. **Raise branch coverage for low modules** — `fuelsystem.ts` (67%), `staging.ts` (67%), and `mapView.ts` (67%) are below the 80% target. Write targeted branch coverage tests.

10. **Standardize event listener cleanup in `crewAdmin.ts`** — Uses direct `addEventListener` calls without `createListenerTracker()`. Other UI modules (settings, help, topbar) use the tracker pattern consistently.

11. **Remaining inline styles** — A handful of inline style assignments remain in `crewAdmin.ts` (lines 348, 567-569), `autoSaveToast.ts` (line 100), and `flightHud.ts` (lines 392, 406, 423) that should use CSS classes. Not flagged by `style.cssText` search since they use individual property assignments.

---

## 5. Future Considerations

### 5.1 Next Iteration Candidates

1. **Full ARIA/Screen Reader Support** — Iteration 3 added keyboard navigation (Tab, Enter, Escape) but explicitly deferred ARIA roles, labels, and live regions. This is the natural next step for accessibility.

2. **Web Worker Physics** — The readonly render interfaces (Section 4.5) were designed with this in mind. Moving `tick()` and orbital calculations to a Web Worker would prevent physics from blocking the render thread during complex time-warp scenarios.

3. **Save Compression** — Large save files (especially with many rocket designs) can approach localStorage's 5-10MB limit. LZ-string or similar compression before serialization would extend save capacity significantly.

4. **Multiplayer/Cloud Saves** — The IndexedDB layer provides a foundation for cloud save synchronization. Adding a server-side save endpoint with conflict resolution would enable cross-device play.

5. **Mod/Plugin System** — The data layer (`src/data/`) contains immutable catalogs. An extension point allowing players to add custom parts, missions, and celestial bodies would significantly extend replayability.

### 5.2 Architectural Decisions to Revisit

1. **Module-Scoped Mutable State** — Many modules store state in module-level `let` variables (e.g., `_undoStack`, `_redoStack` in undoRedo.ts; `_db` in idbStorage.ts; various `_selected*` in render modules). This works for a single-instance game but makes testing harder and prevents future multi-instance scenarios. Consider consolidating into a dependency-injected state container.

2. **Synchronous vs Async Save API** — `saveGame()` and `loadGame()` are synchronous, but IndexedDB is inherently async. The current hybrid (sync localStorage + fire-and-forget async IndexedDB mirror) creates edge cases. A future iteration should consider making the save API fully async.

3. **PixiJS Version Lock** — The deprecated API casts in `_debris.ts` suggest the codebase was originally written for PixiJS v7 and partially migrated to v8. A full audit of all PixiJS API usage against v8 documentation would catch any remaining deprecated patterns.

4. **`jsToTsResolve` Plugin** — Now that the full TypeScript migration is complete and no `.js` source files remain, this Vite plugin is only needed for import specifiers that still use `.js` extensions. Consider updating all imports to `.ts` extensions and removing the plugin to simplify the build pipeline.

5. **CSS Custom Properties vs Build-Time Constants** — Some CSS values that were originally JavaScript constants (e.g., toolbar heights, grid sizes) are now hardcoded in CSS with comments noting the source. If these values ever need to be configurable, they should be migrated to CSS custom properties set from JS at initialization.

### 5.3 Technical Debt Introduced

1. **130 `as any` casts** — The TypeScript migration prioritized compilation over full type safety. Each `as any` is a potential source of runtime type errors that the compiler can't catch. These should be systematically narrowed, starting with the files that have the most casts.

2. **Deprecated PixiJS API behind type casts** — Using `as PIXI.Graphics & { beginFill: Function }` to access removed methods is active technical debt that will cause runtime failures.

3. **Three core modules below 80% branch coverage** — While the global coverage meets thresholds, `fuelsystem.ts`, `staging.ts`, and `mapView.ts` have significant untested branches that could hide bugs.

4. **Mixed sync/async save architecture** — The dual localStorage+IndexedDB storage with fire-and-forget mirroring is pragmatic but creates subtle race conditions and data consistency risks.

5. **No quota monitoring** — Neither the localStorage nor IndexedDB layers track or report quota usage. Players have no warning when they're approaching storage limits until a save fails.

---

## Summary

The Iteration 3 implementation is thorough and well-executed. All 32 tasks are complete. The TypeScript migration, CSS extraction, auto-save system, undo/redo, debug mode toggle, and keyboard navigation are all functional and tested. Test coverage meets configured thresholds with 2,815 unit tests and 37 E2E specs.

**One critical bug** (deprecated PixiJS v7 API in `_debris.ts`) must be fixed before production — it will crash during docking operations. The fire-and-forget IndexedDB fallback on quota errors is a high-priority fix to prevent data loss. Beyond these, the codebase is solid, well-structured, and ready for the next iteration of development.

**Overall Assessment: Ready for production** after fixing the PixiJS API issue and the IndexedDB save fallback.
