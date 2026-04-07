# Iteration 5 — Final Code Review

**Date:** 2026-04-07
**Scope:** All requirements in `.devloop/requirements.md` (Sections 1–6) and all 19 tasks in `.devloop/tasks.md`
**Codebase:** ~60,400 lines TypeScript, 154 source modules, 90 unit test files, 39 E2E specs

---

## Requirements vs Implementation

### Fully Implemented (No Gaps)

| Requirement | Status | Notes |
|---|---|---|
| 1.1 Worker ready timeout | **Complete** | 10-second timeout in `_workerBridge.ts:113`. Rejects with descriptive error. Timeout cleared on ready or error. Fallback to main-thread physics works correctly. |
| 1.2 Extract `_escapeHtml()` to shared utility | **Complete** | `src/ui/escapeHtml.ts` exports `escapeHtml()`. `mainmenu.ts` and `library.ts` both import from it. Audit documented in code comment (82 innerHTML assignments, 29 files). |
| 1.3 Fix remaining inline styles | **Mostly Complete** | See gap below. |
| 1.4 Vite client type reference in logger | **Complete** | `/// <reference types="vite/client" />` at line 1 of `logger.ts`. Cast removed. Direct `import.meta.env.PROD` access. |
| 1.5 Document empty catalog pattern | **Complete** | Comment added at `_workerBridge.ts:113-114`. `partsCatalog` and `bodiesCatalog` made optional in protocol types. |
| 1.6 Log IDB mirror write failures | **Mostly Complete** | See gap below. |
| 2.1 Coverage thresholds for render/UI | **Complete** | `vite.config.js` sets render at 50%/40%, UI at 50%/40%. Core unchanged at 89%/80%/91%. Includes detailed documentation of testable modules per layer. |
| 3.1–3.2 Readonly snapshot architecture | **Complete** | `MainThreadSnapshot` type defined in `physicsWorkerProtocol.ts`. `createSnapshotFromState()` in `snapshotFactory.ts`. Worker bridge stores snapshot directly — no field-by-field copy. |
| 3.3 Render/UI migration to readonly snapshots | **Complete** | All render functions in `src/render/flight/` accept `ReadonlyPhysicsState`, `ReadonlyAssembly`, etc. Map renderer updated. Comprehensive readonly type definitions in `src/render/types.ts`. |
| 3.4 Main-thread fallback | **Complete** | `createSnapshotFromState()` produces identical snapshot format. Single code path for render/UI regardless of worker vs main-thread physics. |
| 3.5 Remove dual state | **Complete** | `applyPhysicsSnapshot()` and `applyFlightSnapshot()` removed. `FCState` no longer holds mutable `ps`/`flightState`. Control inputs stored separately. |
| 4.1 Performance monitor module | **Complete** | `src/core/perfMonitor.ts` (223 lines). Fixed-size `Float64Array` circular buffer. Zero-allocation hot path. FPS, frame time histogram (4 buckets), worker latency, Chrome memory API with graceful fallback. |
| 4.2 Performance dashboard UI | **Complete** | `src/ui/perfDashboard.ts` + CSS. Semi-transparent overlay, lazy DOM creation, 500ms update interval. Toggle via F3 and settings. |
| 4.3 Integration points | **Complete** | `beginFrame()`/`endFrame()` in flight loop. Worker send/receive latency recorded. F3 keyboard shortcut. `showPerfDashboard` in `GameState.settings`. |
| 5.1 Tests for new code | **Complete** | 78 new tests across 4 files (1,117 LOC): `workerBridgeTimeout.test.ts`, `escapeHtml.test.ts`, `perfMonitor.test.ts`, `snapshotFactory.test.ts`. |
| 5.2 Render/UI layer tests | **Complete** | Tests written for render camera, pool, state, trails, input, constants; UI escape, fpsMonitor, state containers. |

### Gaps and Partial Implementations

**1. Silent `.catch(() => {})` in `autoSave.ts` (Requirement 1.6)**

`saveload.ts` was correctly updated to log IDB mirror failures via `logger.debug()`, but `autoSave.ts` still has two silent swallows:
- `autoSave.ts:102` — `idbSet(AUTO_SAVE_KEY, compressed).catch(() => {})`
- `autoSave.ts:121` — `idbDelete(AUTO_SAVE_KEY).catch(() => {})`

The requirements mentioned `saveload.ts` specifically, but `autoSave.ts` uses the same fire-and-forget IDB mirror pattern and should be consistent. These should be `.catch(err => logger.debug('autoSave', 'IDB mirror write/delete failed', err))`.

**2. Inline styles partially addressed (Requirement 1.3)**

The requirements called out three locations. Current status:
- `crewAdmin.ts:701,709` — **Not verified as fully migrated.** The CSS classes may have been added but inline style usage patterns remain in the file for skill bar widths (`style="width:${p}%"` at lines 394, 400, 406), which are acceptable for dynamic computed values.
- `missionControl/_contractsTab.ts:90` — Inline styles remain for reputation bar (`repBar.style.setProperty`, `repFill.style.width`, `repFill.style.backgroundColor`). These are dynamic display values and are acceptable, but the requirements asked for CSS class extraction. A CSS custom property approach (`--rep-width`, `--rep-color`) would satisfy the requirement more fully.

**3. `perfDashboard.ts` creates unused `createListenerTracker()`**

`perfDashboard.ts:50` instantiates a listener tracker but never routes any event listeners through it. The `setInterval` for updates is cleaned up manually in `destroyPerfDashboard()`, which is correct, but the unused tracker import adds dead code.

### Scope Creep Assessment

**No scope creep detected.** All implemented features trace directly to requirements. No extraneous features were added.

---

## Code Quality

### Strengths

1. **Architecture integrity maintained.** The three-layer separation (core/render/UI) is consistently enforced. The render layer uses comprehensive readonly type definitions (`src/render/types.ts`) with `ReadonlySet`, `ReadonlyMap`, and `readonly` arrays. Zero mutations of input state detected in the render layer.

2. **Worker state ownership is clean.** The dual-state shadow pattern has been fully eliminated. The worker bridge stores incoming snapshots directly (no field-by-field copy), `FCState` no longer holds mutable `PhysicsState`/`FlightState`, and both worker and main-thread fallback produce identical snapshot formats. Control inputs remain cleanly separated as main-thread authority.

3. **PixiJS v8 compliance is complete.** Zero deprecated v7 patterns remain across the entire render layer. All graphics use modern v8 methods (`.rect()`, `.circle()`, `.fill({})`, `.stroke({})`). No unsafe `as PIXI.Graphics &` casts found.

4. **Object pooling is thorough.** `RendererPool` (shared via `src/render/pool.ts`) is used by flight, hub, and VAB renderers. Pool objects are properly reset on acquire (clear, reset position/scale/rotation/alpha), null-safe on release, and drained on renderer destroy. Map view uses a dedicated fixed-size text pool (`MAX_LABELS = 24`).

5. **Performance monitor is well-designed.** Pre-allocated `Float64Array` circular buffer, zero-allocation hot path, Chrome memory API with graceful no-op on other browsers. The justified `as unknown as { memory?: PerformanceMemory }` casts (lines 165, 205) are the only way to access this Chrome-only API.

6. **Save system is robust.** Fully async API, lz-string compression with `LZC:` prefix marker for backward compatibility, deep nested validation that filters corrupted entries instead of failing loads, and IDB mirror writes properly logged (in `saveload.ts`).

### Issues Found

#### Medium Severity

**1. Excessive `as unknown as Record<string, unknown>` casts in `flightHud.ts` (11 occurrences)**

`flightHud.ts` accesses `throttleMode`, `targetTWR`, and `controlMode` on `_ps` (typed as `PhysicsState`) via `as unknown as Record<string, unknown>` casts — even though `PhysicsState` already declares `throttleMode` and `targetTWR` as direct properties (physics.ts:352-354). These casts are unnecessary and appear to be artifacts from the mechanical `as any` elimination pass that replaced casts without checking whether the property exists on the type.

Affected lines: 194, 197, 202, 430, 527, 542, 559, 820, 1141, 1177, 1390.

*Impact:* The HUD works correctly at runtime, but the casts bypass TypeScript's type checking. If `PhysicsState` fields were renamed, the HUD would silently read `undefined` instead of getting a compile error.

*Recommendation:* Remove the casts and access properties directly. For `controlMode` (line 820), add the property to `PhysicsState` if it exists at runtime but is missing from the interface.

**2. 48 `as unknown as` casts remain across 17 source files**

While the 130 `as any` casts were eliminated, many were mechanically replaced with `as unknown as` rather than properly typed. The most concerning concentrations:

| File | Count | Pattern |
|---|---|---|
| `flightHud.ts` | 11 | `Record<string, unknown>` on typed objects (see above) |
| `missions.ts` | 11 | `Mission` vs `MissionDef` type mismatches |
| `period.ts` | 3 | Crew/mission type narrowing |
| `_missionsTab.ts` | 3 | Mission array type coercion |
| `_designLibrary.ts` | 3 | Staging data serialization |
| Remaining 12 files | 17 | Various structural casts |

*Impact:* `as unknown as` is safer than `as any` (it forces acknowledgment of the type gap) but still bypasses the type checker. The `missions.ts` casts suggest the `Mission` and `MissionDef` types need unification or a proper discriminated union.

**3. Docking target graphics layer ordering (render)**

`flight/_debris.ts:72-75` lazy-creates a docking target graphics object at the rocket container's z-index. If `rocketContainer` is removed and re-added during scene transitions (flight → map → flight), the index lookup could place graphics at the wrong depth.

*Risk:* Low — only affects docking target visual during unlikely transition timing. No crash risk.

#### Low Severity

**4. Non-null assertions in `map.ts`**

Lines 429-462 use `!` assertions on graphics objects (`_bgGraphics!.clear()`, `_transferGraphics!`, `_orbitsGraphics!`, etc.). These are initialized in `initMapRenderer()` and only nulled in `destroyMapRenderer()`, so they're safe in practice, but a defensive `if (!_mapRoot) return` guard would be more robust.

**5. `as any` in test file**

`workerBridgeTimeout.test.ts` has 16 `as any` casts (lines 185-249) for mock state factories. While the ESLint `no-explicit-any` rule is set to `warn` (not `error`), the test file could use `Partial<PhysicsState>` or test factory types for cleaner typing.

**6. Unbounded object pools**

`RendererPool` has no maximum pool size. While unlikely to be an issue (frame-by-frame reuse patterns keep pools small), a pathological case with many unique objects could grow the pool indefinitely. An optional `maxPoolSize` would be a safety valve.

---

## Security

| Area | Assessment | Details |
|---|---|---|
| XSS (innerHTML) | **Good** | 87 innerHTML assignments across 29 files. User-controlled data (save names, agency names, crew names) is escaped via shared `escapeHtml()`. Audit documented in `escapeHtml.ts`. `.textContent` used for dynamic text where possible (592 usages). |
| Code injection | **No risk** | Zero `eval()`, `Function()`, or dynamic script loading. |
| Save data validation | **Good** | JSON.parse output validated through `_validateState()` and `_validateNestedStructures()`. Corrupted entries filtered. Import validates envelope structure. |
| Worker isolation | **No risk** | Dedicated workers, same-origin by browser design. Messages contain only simulation data. |
| Storage | **Acceptable** | Keys prefixed with `spaceAgency*`. Compression obfuscates but doesn't encrypt — appropriate for client-side game data. |

**No security vulnerabilities identified.** The `escapeHtml()` extraction and centralized audit in iteration 5 was a significant improvement over the previous per-module approach.

---

## Testing

### Coverage Architecture

| Layer | Lines Threshold | Branches Threshold | Functions Threshold | Notes |
|---|---|---|---|---|
| `src/core/` | 89% | 80% | 91% | Strict — critical game logic |
| `src/render/` | 50% | 40% | — | Realistic — PixiJS-heavy modules are inherently hard to unit test |
| `src/ui/` | 50% | 40% | — | Realistic — DOM-heavy modules tested primarily via E2E |

### Test Suite Statistics

- **90 unit test files** in `src/tests/`
- **39 E2E spec files** in `e2e/`
- **~46,568 total lines of test code**
- **Zero skipped tests** — all tests active

### Iteration 5 Test Quality

| Test File | Tests | LOC | Quality | Coverage |
|---|---|---|---|---|
| `workerBridgeTimeout.test.ts` | 4 | 260 | Excellent | Timeout fire/clear, error handling, bridge state consistency |
| `escapeHtml.test.ts` | 20 | 120 | Exceptional | All special chars, combined escaping, edge cases (empty, unicode, non-string), pre-escaped input, long strings |
| `perfMonitor.test.ts` | 18 | 305 | Excellent | FPS calculation, histogram bucketing (boundary values at 8/16/33ms), circular buffer overflow, worker latency, memory fallback, reset, zero-frame-time edge case |
| `snapshotFactory.test.ts` | 36 | 432 | Exceptional | Structure validation, control input exclusion (4 tests), Set→Array serialization (5 tests), Map→Object serialization (5 tests), scalar mapping, flight state mapping, debris serialization, schema contract validation (4 tests), round-trip fidelity |

**Snapshot migration validation is thorough.** The 36-test `snapshotFactory.test.ts` explicitly verifies:
- All `ReadonlyPhysicsSnapshot` required fields are present
- All `ReadonlyFlightSnapshot` required fields are present
- Control inputs (`throttle`, `throttleMode`, `targetTWR`, `angle`) are excluded
- Sets become arrays (not Map instances), Maps become plain objects
- Values survive serialization round-trip unchanged

### E2E Integration

The `fps-monitor.spec.js` E2E test validates the full performance dashboard stack:
- Dashboard hidden when debug mode off
- Dashboard visible when debug mode on, with correct FPS/frame-time content format
- `window.__perfStats` API exposes metrics with valid values

### Gaps and Untested Areas

1. **`autoSave.ts` IDB mirror failure path** — The silent `.catch(() => {})` means failures go undetected. No test exercises this path.

2. **Worker + snapshot factory integration test** — Unit tests mock each in isolation. No integration test verifies the complete worker → snapshot → bridge → render pipeline with real messages.

3. **Real IndexedDB integration** — All storage tests mock `localStorage` and IDB. No test exercises real IndexedDB operations (quota limits, corruption scenarios).

4. **Performance dashboard destroy/recreate cycle** — E2E tests verify show/hide but don't test repeated create/destroy cycles for listener or interval leaks.

5. **Docking under worker physics** — Docking flow involves tight coordination between control inputs and physics state. No E2E test specifically exercises docking with worker physics active.

---

## Recommendations

### Before Production (High Priority)

1. **Fix silent `.catch(() => {})` in `autoSave.ts:102,121`.** Replace with `logger.debug()` calls matching the pattern already used in `saveload.ts`. This is a one-line fix per occurrence and ensures IDB mirror failures are visible during development.

2. **Remove unnecessary `as unknown as Record<string, unknown>` casts in `flightHud.ts`.** The 11 casts at lines 194, 197, 202, 430, 527, 542, 559, 820, 1141, 1177, 1390 bypass type checking on properties that already exist on `PhysicsState`. Remove them and add any missing properties (e.g., `controlMode`) to the type interface.

3. **Remove unused `createListenerTracker()` in `perfDashboard.ts:50`.** Dead code that suggests listeners are managed but aren't.

### Post-Launch Improvements (Medium Priority)

4. **Unify `Mission` / `MissionDef` types.** The 11 `as unknown as` casts in `missions.ts` indicate a structural mismatch between mission definition templates and live mission instances. A proper discriminated union (`type Mission = MissionDef & { status: MissionStatus; acceptedDate: string }`) would eliminate the casts and prevent runtime property-access bugs.

5. **Reduce `as unknown as` cast count from 48 to <10.** Many casts were mechanical replacements from the `as any` sweep. A targeted pass through `flightHud.ts` (11), `missions.ts` (11), `period.ts` (3), and `_missionsTab.ts` (3) — covering 28 of 48 — would bring the codebase to proper type safety.

6. **Strengthen ESLint `no-explicit-any` from `warn` to `error`.** The codebase has zero `as any` in source files. Promoting to `error` prevents regression. Keep `warn` for test files where `Partial<T>` and test factories may need flexibility.

7. **Add pool max-size limits.** `RendererPool` grows unbounded. An optional `maxPoolSize` parameter with a sensible default (e.g., 200) would prevent pathological memory growth.

8. **Add defensive guard to `map.ts` graphics usage.** Replace `!` assertions with early `if (!_mapRoot) return` guard to handle edge cases during destroy/init transitions.

---

## Future Considerations

### Features for Next Iterations

1. **Accessibility (ARIA).** Keyboard navigation exists (focus rings, tab order). Full ARIA support (roles, labels, screen reader announcements) is the natural next step for inclusive gameplay.

2. **Settings persistence refactor.** Settings like `showPerfDashboard`, `debugMode`, `useWorkerPhysics` live in `GameState` and are saved/loaded with game saves. A dedicated settings store (independent of save files) would let preferences persist even without a save.

3. **Save export format.** The current export is raw compressed JSON. A proper format with magic bytes, version header, and checksum would prevent corruption and enable save sharing.

4. **CSS custom properties for dynamic values.** The ~20 inline styles in `flightHud.ts` and reputation bar in `_contractsTab.ts` could use CSS custom properties set from JS (e.g., `--throttle-pct: 75%`) with CSS handling the visual mapping. This reduces JS/CSS coupling.

### Architectural Considerations

5. **Mission type system.** The `Mission` / `MissionDef` / `MissionInstance` type hierarchy is the largest remaining source of type unsafety (14 casts across `missions.ts` and `_missionsTab.ts`). Redesigning this as a proper discriminated union or state machine would significantly improve type safety and prevent runtime errors when accessing optional fields.

6. **Render geometry deduplication.** Rocket part drawing and pivot calculation are duplicated between `_rocket.ts` (rendering), `_rocket.ts` (hit testing), and `_debris.ts` (debris rendering). Extracting shared geometry utilities would reduce maintenance burden and bug surface.

7. **Coverage escalation path.** The 50%/40% floor for render and UI layers is realistic for the current state. As the codebase grows, gradually increasing to 60%/50% with targeted tests on newly added modules would maintain quality without requiring DOM mocking gymnastics.

### Technical Debt Introduced

8. **48 `as unknown as` casts across 17 source files.** While these are safer than the previous 130 `as any` casts and each is individually justifiable, the aggregate represents a type safety gap. The most impactful targets for elimination are `flightHud.ts` (11 — mostly unnecessary) and `missions.ts` (11 — needs type redesign).

9. **`as any` in test file.** `workerBridgeTimeout.test.ts` has 16 `as any` casts for mock state factories. These should use `Partial<T>` or dedicated test factory types for consistency with the codebase's type safety standards.

10. **Unused listener tracker.** `perfDashboard.ts` imports and creates a `createListenerTracker()` instance that is never used. Minor dead code.

---

## Summary

The iteration 5 implementation successfully addresses all major findings from the iteration 4 review:

- **Worker state ownership** is clean — the dual-state shadow pattern is fully eliminated, with render/UI reading from a single readonly snapshot
- **Performance monitoring** is well-designed with zero-allocation hot path and proper Chrome memory API fallback
- **Coverage enforcement** now spans all three layers (core, render, UI) with realistic thresholds
- **Quick wins** (worker timeout, shared escapeHtml, Vite type reference, IDB logging, catalog documentation) are complete

The most significant remaining issues are:

1. **`autoSave.ts` silent IDB failure swallowing** (2 occurrences, trivial fix)
2. **Unnecessary `as unknown as` casts in `flightHud.ts`** (11 occurrences, properties exist on type)
3. **48 `as unknown as` casts total** across the codebase (down from 130 `as any`, but still a type safety gap)

None of these are blocking issues. The codebase is production-ready with the caveats noted above. The readonly snapshot migration is the standout achievement — it cleanly separates physics state ownership and eliminates an entire category of potential state synchronization bugs.
