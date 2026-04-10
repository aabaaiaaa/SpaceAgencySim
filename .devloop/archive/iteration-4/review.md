# Iteration 4 — Final Code Review

**Date:** 2026-04-10
**Scope:** Stabilization iteration — all 26 tasks in `.devloop/tasks.md` addressing findings from the iteration 6 code review
**Codebase:** ~41,700 lines of production source (TypeScript/JS) across 154 modules, ~49,900 lines of unit tests (95 files), 40 E2E specs

---

## Requirements vs Implementation

### Fully Implemented (No Gaps)

| Req | Section | Status | Notes |
|-----|---------|--------|-------|
| 1.1 | Wire asteroid mass into physics | **Complete** | `captureAsteroid()` constructs `CapturedBody` with mass, radius, offset, and name, then calls `setCapturedBody(ps, body)`. `releaseGrabbedAsteroid()` accepts `ps: PhysicsState` and calls `clearCapturedBody(ps)`. All callers updated. |
| 1.2 | CapturedBody struct replacing scalar | **Complete** | `CapturedBody` interface defined at `physics.ts:316` with mass, radius, offset, name. `PhysicsState.capturedBody: CapturedBody | null` replaces `capturedAsteroidMass`. `_computeCoMLocal()` includes body mass at offset. `_computeMomentOfInertia()` includes solid sphere + parallel axis terms. Zero references to old field remain. |
| 1.3 | Per-arm properties | **Complete** | `captureAsteroid()` reads `armReach` and `maxGrabSpeed` from part definitions with fallbacks. `getAsteroidGrabTargetsInRange()` uses `armReach * 20` for broad filter. Global constants retained only for satellite targeting (separate system). |
| 2.1 | Double-scale streak fix | **Complete** | `scale` applied once in `trailLength` calculation. No second `* scale` on tail position. |
| 2.2 | Per-asteroid collision cooldown | **Complete** | Module-level `Map<string, number>` at `collision.ts:170`. 10-tick cooldown matching `SEPARATION_COOLDOWN_TICKS`. Decrements per tick, skips during cooldown, removes expired entries. |
| 2.3 | Map coordinate frame fix | **Complete** | Both `craftX`/`craftY` and asteroid positions offset by body radius `R` for sun-centred frame. Comment explains the conversion. |
| 2.4 | Unified size thresholds | **Complete** | `getSizeCategory()` exported from `_asteroids.ts:63-69`, imported and used in `map.ts:56,956`. Single source of truth for small/medium/large boundaries. |
| 2.5 | Cap autoSave loop + deduplicate SAVE_VERSION | **Complete** | Loop capped at 100 with fallback to `AUTO_SAVE_KEY`. `SAVE_VERSION` imported from `saveload.ts`, no local duplicate. |
| 3.1 | Defensive null guards in map.ts | **Complete** | `_drawBody` (line 626) and `_drawShadow` (line 1339) have `if (!_mapRoot) return` guards. `_commsGraphics = null` added to `destroyMapRenderer()` at line 360. |
| 3.2 | Off-screen culling for belt asteroids | **Complete** | Viewport bounds check at `map.ts:934` with 10px margin, matching the culling pattern in `_drawAsteroidBelt`. |
| 3.3 | LANDABLE TextStyle constant | **Complete** | `LANDABLE_STYLE` extracted to module-level constant at `_asteroids.ts:36-41`. Assigned once per asteroid, not rebuilt per frame. |
| 4.1 | Validate envelope format version | **Complete** | Version compared against `ENVELOPE_FORMAT_VERSION` at `saveload.ts:834`. Clear error message for newer versions includes both version numbers. |
| 5.1 | renameOrbitalObject core function | **Complete** | `renameOrbitalObject()` defined in `src/core/satellites.ts:604-609`. Called from `_mapView.ts:248` via import. No direct mutation. |
| 6.1 | Remove spurious cast in lifeSupport.ts | **Complete** | The `as unknown as` cast is gone. Only a legitimate `as string` remains at line 94 for enum comparison — this is appropriate. |
| 6.2 | Tech tree arm tier placement | **Complete** | Standard arm at T4 (`struct-t4`), Heavy at T5 (`struct-t5`), Industrial at T6 (`struct-t6`). Descriptions updated to mention grabbing arms. Proper progression spacing. |
| 7.1 | Rename dialog inline styles to CSS | **Complete** | All styling via CSS classes (`rename-asteroid-overlay`, `rename-asteroid-dialog`, etc.). No inline `style.cssText` or `style=""` attributes. |
| 7.2 | Document caller contracts | **Complete** | JSDoc `@remarks` annotations on `captureAsteroid()`, `releaseGrabbedAsteroid()`, `alignThrustWithAsteroid()`, `breakThrustAlignment()`, and `persistReleasedAsteroid()`. Contracts are internal — callers do not need to separately manage physics state. |
| 8.1 | Coverage escalation | **Complete** | Render: 55% lines / 45% branches. UI: 50% lines / 45% branches. Core: 89% lines / 80% branches / 91% functions. Thresholds configured in `vite.config.js:48-62`. |
| 9.1 | test-map.json entries | **Complete** | Entries for `asteroidBelt`, `settingsStore`, `crc32`. `e2e/asteroid-belt.spec.js` linked from collision and docking entries. |
| 9.2 | @smoke tags | **Complete** | Tags added to `autoSave.test.ts` (3), `crc32.test.ts` (2), `settingsStore.test.ts` (2), `asteroidBelt.test.ts` (2). |
| 9.3 | E2E test independence | **Complete** | All test groups in `asteroid-belt.spec.js` use `beforeEach`/`afterEach` for fresh page instances. No shared state via `beforeAll`/`afterAll`. |
| 9.4 | Unit tests for fixed code | **Complete** | See Testing section for details. |
| 9.5 | E2E tests for changed behaviour | **Complete** | Arm tier differences, collision cooldown, thrust alignment, and tech tree progression covered. |

### Scope Creep Assessment

**No scope creep detected.** All implemented changes trace directly to the requirements document. No extraneous features or changes were added.

### Gaps

**No gaps found.** All 26 tasks are marked done and all requirements sections (1-9) are fully addressed. This is a clean stabilization iteration.

---

## Code Quality

### Strengths

1. **Physics integration is now correct.** The `CapturedBody` struct properly encodes mass, radius, attachment offset, and name. CoM shifts proportionally, MoI uses the solid-sphere approximation with parallel-axis theorem, and torque is properly gated by alignment state. The previous iteration's critical bug (silently inert asteroid physics) is fully resolved.

2. **Per-arm differentiation works.** Standard (25m/1.0 m/s), Heavy (35m/0.8 m/s), and Industrial (50m/0.5 m/s) arms now have mechanically distinct reach and speed limits. Tech tree progression T4 → T5 → T6 prevents the standard arm from being immediately obsolete.

3. **Type safety continues to improve.** Production source `as unknown as` casts are down to 3:
   - `crew.ts:46` — `CrewMember[] → Astronaut[]` (architectural type split, documented)
   - `perfMonitor.ts:165,205` — Chrome-only `performance.memory` API (justified)
   
   Zero `as any` in the entire codebase. ESLint `no-explicit-any` is `error` for source, `warn` for tests.

4. **Collision cooldown prevents damage stacking.** The per-asteroid cooldown using a `Map<string, number>` mirrors the existing debris pattern. 10-tick grace period is consistent across both systems.

5. **Caller contracts are documented.** JSDoc `@remarks` on all grabbing functions clarify that physics state management is internal — callers don't need to separately call `setCapturedBody`/`clearCapturedBody`.

6. **Save system is robust.** Envelope format version validation rejects newer saves with a clear error message. The autoSave loop is bounded with a documented fallback. No version skew risk from duplicated constants.

### Remaining Issues

| Severity | File | Description |
|----------|------|-------------|
| Low | `map.ts:626-627` | `_drawBody` guards `_mapRoot` but uses `_bodyGraphics!` without a separate null check. If `_mapRoot` is truthy but `_bodyGraphics` is null during a destroy/init race, this would crash. Same pattern in `_drawShadow` at line 1339-1340 with `_shadowGraphics!`. The `if (!_mapRoot) return` guard is sufficient in practice (all graphics are created/destroyed alongside `_mapRoot`), but a belt-and-suspenders `if (!_mapRoot || !_bodyGraphics) return` would be more defensive. |
| Low | `crew.ts:46` | The `CrewMember → Astronaut` cast is the root cause of the last avoidable `as unknown as` in the core layer. This is a known architectural debt item from the previous review — not introduced in this iteration. |
| Info | `lifeSupport.ts:94` | `astronaut.status as string` is a safe downcast for enum comparison. Not a bug, but indicates the `CrewStatus` / `AstronautStatus` type system could be tightened. |

### Security

No security concerns. The iteration doesn't introduce any new user input surfaces. The existing `escapeHtml()` usage in the rename dialog was already verified in the prior review and remains intact.

---

## Testing

### Coverage Summary

| Area | Unit Tests | Key Coverage |
|------|-----------|-------------|
| CapturedBody physics | `physics.test.ts:2934-3099` | setCapturedBody/clearCapturedBody, total mass includes asteroid, torque via tick(), MoI dampens angular acceleration |
| Capture/release wiring | `grabbing.test.ts:1268-1331` | CapturedBody set with correct fields on capture, cleared on release, offset = asteroid pos - craft pos |
| Per-arm properties | `grabbing.test.ts:1337-1447` | Standard/Heavy/Industrial reach and speed verified. Boundary tests at exact thresholds (1.0/1.01, 0.8/0.81, 0.5/0.51 m/s). Mass limit boundary (100,000/100,001 kg). |
| Collision cooldown | `collision.test.ts:654-806, 1545-1625` | No re-damage during 10-tick cooldown. Cooldown decrements and allows re-collision. Reset function clears all cooldowns. |
| AutoSave fallback | `autoSave.test.ts:203-224` | All 100 slots occupied → falls back to `AUTO_SAVE_KEY`. @smoke tagged. |
| Envelope version | `saveload.test.ts` | Format version validation covered. |
| E2E arm tiers | `asteroid-belt.spec.js` | Heavy arm longer range, Industrial slower speed, cooldown prevents destruction, thrust alignment, tech tree progression. |

### Test Infrastructure Quality

- **E2E independence:** All test groups use `beforeEach`/`afterEach` for fresh page state. No serial dependencies.
- **test-map.json:** All new modules mapped. Affected-test detection works for `asteroidBelt`, `settingsStore`, `crc32`, and links to `e2e/asteroid-belt.spec.js`.
- **@smoke tags:** Added to all four previously-untagged test files. Representative tests exercise broad code paths.
- **Coverage thresholds:** Render 55% lines / 45% branches, UI 50% lines / 45% branches, Core 89% lines / 80% branches / 91% functions. All enforced in `vite.config.js`.

### Remaining Test Gaps

| Priority | Gap | Impact |
|----------|-----|--------|
| Low | `_drawBody`/`_drawShadow` null guard edge case is untested | Low — only matters during rapid destroy/init transitions, and the guard is effectively covered by the `_mapRoot` check |
| Low | `CrewMember → Astronaut` cast in `crew.ts` has no type-level regression test | Known architectural debt — the cast is tested indirectly through crew management tests |
| Info | 88 test files use `// @ts-nocheck` | Pre-existing — not introduced in this iteration. Incremental conversion would catch type regressions. |

---

## Recommendations

### Immediate (No Action Needed)

All critical and high-priority issues from the iteration 6 review have been resolved. The codebase is in a healthy state. No blocking issues remain.

### Next Iteration Candidates

1. **Unify `CrewMember` / `Astronaut` types.** This is the root cause of the last avoidable `as unknown as` cast (`crew.ts:46`). Merging these types or widening `GameState.crew` to `Astronaut[]` would eliminate it and simplify the crew module.

2. **Settings schema migration chain.** `settingsStore.ts` validates `version === SCHEMA_VERSION` but has no migration path between versions. The first schema change will silently reset all user settings to defaults. Design a migration chain (similar to `_applySaveMigrations` in saveload.ts) before the schema changes.

3. **Tighten `_drawBody`/`_drawShadow` null guards.** Add `!_bodyGraphics` and `!_shadowGraphics` checks alongside the `!_mapRoot` guard. Low risk, trivial fix, eliminates the last `!` assertion concern in map.ts.

4. **Incremental test TypeScript adoption.** With 88 test files using `// @ts-nocheck`, type regressions in test code are invisible. Converting the most critical test files (physics, grabbing, collision) would be high-value.

---

## Future Considerations

### Features for Next Iterations

1. **Asteroid mining/science.** The asteroid landing system is in place but has no gameplay payoff. Science data collection, resource extraction, or mining contracts would give purpose to capture and landing mechanics. The `CapturedBody` struct already carries the data needed (mass, radius, name).

2. **Asteroid economy.** Captured asteroid value based on size/composition. Delivery contracts to specific orbits. The persistent orbital object system is ready for this.

3. **Multi-asteroid capture.** The current `capturedBody: CapturedBody | null` limits capture to one asteroid at a time. Expanding to `capturedBodies: CapturedBody[]` would enable towing multiple small asteroids, with aggregate mass/CoM/MoI calculations.

4. **Crew assignment to asteroid missions.** The crew system exists but isn't connected to belt operations. Crew skill bonuses for capture efficiency or mining yield would add depth.

### Architectural Decisions to Revisit

5. **`CapturedBody` → `AttachedBody` generalization.** As the game adds more things that can be attached to craft (fuel depots, station modules, captured satellites), the `CapturedBody` concept could generalize to a more flexible attachment system.

6. **Settings schema versioning.** The current `version === SCHEMA_VERSION` check needs a migration chain before the first schema change. This is the most time-sensitive architectural gap.

7. **Test type safety.** The `// @ts-nocheck` in 88 test files means type regressions in tests are invisible until runtime. This is the largest source of hidden risk in the codebase.

### Technical Debt Status

| Item | Status | Notes |
|------|--------|-------|
| `captureAsteroid()` not wiring mass | **Resolved** | CapturedBody struct and full physics integration |
| Per-arm dead data | **Resolved** | `armReach` and `maxGrabSpeed` now consumed |
| Double-scale streak rendering | **Resolved** | Single `scale` application |
| Per-asteroid collision cooldown | **Resolved** | 10-tick cooldown with Map tracking |
| Map coordinate frame | **Resolved** | Sun-centred frame for both axes |
| Size threshold mismatch | **Resolved** | Single `getSizeCategory()` function shared |
| AutoSave unbounded loop | **Resolved** | Capped at 100 with fallback |
| SAVE_VERSION duplication | **Resolved** | Imported from saveload.ts |
| Envelope version unvalidated | **Resolved** | Version check with clear error message |
| `_commsGraphics` stale reference | **Resolved** | Nulled in destroyMapRenderer() |
| LANDABLE style per-frame rebuild | **Resolved** | Module-level constant |
| Rename dialog inline styles | **Resolved** | CSS class-based styling |
| Direct state mutation in UI | **Resolved** | Core `renameOrbitalObject()` function |
| Spurious lifeSupport cast | **Resolved** | Only legitimate `as string` remains |
| Tech tree arm tier overlap | **Resolved** | T4/T5/T6 progression |
| Undocumented caller contracts | **Resolved** | JSDoc @remarks annotations |
| `CrewMember`/`Astronaut` type split | **Outstanding** | Root of last avoidable cast — not in scope for this iteration |
| Settings schema migration | **Outstanding** | No migration chain — first schema change will reset settings |
| Test `// @ts-nocheck` | **Outstanding** | 88 files — pre-existing, not introduced here |

---

## Summary

Iteration 4 is a successful stabilization pass. All 26 tasks are complete. Every critical and high-priority issue from the iteration 6 review has been resolved:

- **Physics integration is wired end-to-end** — asteroid mass, CoM, MoI, and torque all work correctly through the `CapturedBody` struct
- **Per-arm mechanical differentiation** — three grabbing arm tiers have distinct range, speed, and mass limits with proper tech tree progression
- **Collision robustness** — per-asteroid cooldown prevents damage stacking during multi-frame overlaps
- **Rendering correctness** — streak double-scale fixed, coordinate frame unified, size categories shared, off-screen culling added
- **Save system hardened** — envelope version validated, autoSave loop bounded, SAVE_VERSION deduplicated
- **Architecture clean** — UI mutation moved to core, inline styles converted to CSS, caller contracts documented
- **Type safety at 3 casts** (target was ≤3) — only justified casts remain (Chrome API access, known type split)
- **Test coverage enforced** — render 55%, UI 50%, core 89% with thresholds in CI

No blocking issues remain. The outstanding debt items (CrewMember/Astronaut split, settings migration, test TypeScript) are pre-existing and appropriate candidates for a future iteration.
