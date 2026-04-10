# Iteration 6 — Final Code Review

**Date:** 2026-04-10
**Scope:** All requirements in `.devloop/requirements.md` (Sections 1–7) and all 34 tasks in `.devloop/tasks.md`
**Codebase:** ~60,400 lines TypeScript, 154 source modules, 90+ unit test files, 39+ E2E specs

---

## Requirements vs Implementation

### Fully Implemented (No Gaps)

| Requirement | Status | Notes |
|---|---|---|
| 1.1 Log IDB mirror failures in autoSave.ts | **Complete** | Both `.catch()` handlers replaced with `logger.debug()` calls at lines 140 and 159. |
| 1.2 Remove unnecessary casts in flightHud.ts | **Complete** | All 9 `as unknown as Record<string, unknown>` casts removed. Properties accessed directly. |
| 1.3 Remove unused createListenerTracker in perfDashboard.ts | **Complete** | Import, variable, instantiation, and cleanup all removed. |
| 1.4 Unify Mission/MissionDef types | **Complete** | `MissionInstance` type in `gameState.ts`. `missions.ts` and `_missionsTab.ts` updated. All `as unknown as` casts eliminated from both files. |
| 1.5 Reduce `as unknown as` casts to <10 | **Complete** | 4 remain in production source files (target was <10). See Type Safety section. |
| 1.6 Promote ESLint no-explicit-any to error | **Complete** | Error for source files, warn for test files. Zero `as any` in the entire codebase. |
| 1.7 Defensive guards in map.ts | **Mostly Complete** | Most drawing functions guarded. See gaps below. |
| 2.1–2.2 Independent settings persistence | **Complete** | `settingsStore.ts` with read/write/migration. Wired into load/save flow. |
| 3.1–3.2 Save export envelope with CRC-32 | **Complete** | Binary envelope with SASV magic bytes, version, CRC-32 checksum. Backward-compatible import for old-format saves. |
| 4.1–4.2 CSS custom properties | **Complete** | flightHud.ts converted (throttle, TWR, velocity, comms colors). contractsTab.ts converted (rep bar width/color). |
| 5.1 Belt zone definitions | **Complete** | Three zones with correct AU distances in bodies.ts and constants.ts. Dense belt flagged unsafe. |
| 5.2 Map visualization | **Complete** | Scattered dots, danger zone shading, zone label. Belt asteroids shown on map when in orbit. |
| 5.3 Flight view asteroid rendering | **Complete** | LOD system, size-based detail, targeting circles. All asteroids selectable via T-key. |
| 5.4 Asteroid collision | **Complete** | Velocity-based damage model with four tiers. AABB-circle collision detection. |
| 5.5 Grabbing arm asteroid capture | **Partial** | See critical gaps below regarding mass integration and per-arm properties. |
| 5.6 Grabbing arm tiers | **Partial** | Three tiers defined with distinct mass limits. However, `armReach` and `maxGrabSpeed` per-part properties are dead data. |
| 5.7 Thrust alignment | **Complete** | Align/break/re-align state machine works. Y-key binding integrated. |
| 5.8 Persistent captured asteroids | **Complete** | Release outside belt creates persistent `OrbitalObject`. Release inside belt returns to procedural field. |
| 5.9 Landing on large asteroids | **Complete** | Gravity derived from mass/radius. Landing system integration with asteroid-specific parameters. |
| 5.10 Belt-specific flight phase | **Complete** | Transfer phase safe, orbit detection triggers asteroids, dense belt blocks hub return. |
| 6.1–6.3 Testing | **Mostly Complete** | See Testing section for gaps. |

### Gaps and Partial Implementations

**1. `grabbing.ts` — `captureAsteroid()` does not call `setCapturedAsteroidMass()` (CRITICAL)**

When an asteroid is captured (`grabbing.ts:278-280`), the function sets `GrabState.GRABBED` and records the asteroid reference, but never calls `setCapturedAsteroidMass(ps, asteroid.mass)` from `physics.ts`. This means:
- `ps.capturedAsteroidMass` stays at 0 after capture
- `_computeTotalMass` does not include the asteroid mass
- `_computeAsteroidTorque` returns 0 (mass <= 0 early return)
- `alignThrustWithAsteroid` returns early with 'No captured asteroid mass'

The entire asteroid mass/physics system (requirement 5.5) is silently inactive after capture unless the caller manually calls `setCapturedAsteroidMass`. The function lacks a `ps: PhysicsState` parameter to do this itself, and the caller contract is undocumented.

**2. `physics.ts` — `_computeCoMLocal()` ignores captured asteroid mass (CRITICAL)**

The asteroid mass is included in `_computeTotalMass()` (line 1419) but not in `_computeCoMLocal()` (lines 1431-1452). The CoM calculation has no knowledge of the asteroid's spatial position relative to the craft. The asteroid's attachment offset is not stored in `PhysicsState` alongside `capturedAsteroidMass`. This means:
- Moment of inertia is underestimated (asteroid mass excluded)
- Tipping physics uses incorrect CoM
- The "thrust alignment" mechanic works via a flag rather than actual CoM physics

**3. `parts.ts` / `grabbing.ts` — Per-arm `armReach` and `maxGrabSpeed` are dead data (HIGH)**

`captureAsteroid()` in `grabbing.ts:266` checks `dist > GRAB_ARM_RANGE` using the global constant `GRAB_ARM_RANGE = 25`. It does not read `armReach` from the part definition. Similarly, `maxGrabSpeed` per-part is unused — the global `GRAB_MAX_RELATIVE_SPEED: 1.0` is used instead. This means:
- Heavy arm's `armReach: 35` and Industrial arm's `armReach: 50` have no gameplay effect
- Heavy arm's `maxGrabSpeed: 0.8` and Industrial's `0.5` have no effect
- All three arms have identical 25m range and 1.0 m/s speed limit

**4. `collision.ts` — `checkAsteroidCollisions` applies damage every tick (MEDIUM)**

When an asteroid overlaps the craft for multiple frames, full damage is applied at 60 Hz with no per-asteroid collision cooldown. The existing debris collision system uses `SEPARATION_COOLDOWN_TICKS` to prevent re-collision, but asteroid collisions lack an equivalent. A slow-speed overlap lasting several frames could deal catastrophic cumulative damage despite the velocity-based model intending otherwise.

**5. `map.ts` — Incomplete defensive guards (LOW)**

`_drawBody` (line 623) and `_drawShadow` (line 1325) use `!` assertions on graphics objects with no preceding null guard. All other drawing functions have `if (!_mapRoot) return` guards. Additionally, `_commsGraphics` is not nulled in `destroyMapRenderer()` (lines 335-367), creating a stale reference to a destroyed PixiJS object.

**6. `_mapView.ts` — Direct state mutation in UI layer (LOW)**

The asteroid rename feature at `_mapView.ts:248` does `obj!.name = newName`, directly mutating `GameState.orbitalObjects` from the UI layer. This violates the architectural convention that "game state mutations happen only in `src/core/` modules." A `renameOrbitalObject()` core function should mediate this.

### Scope Creep Assessment

**No scope creep detected.** All implemented features trace directly to requirements. No extraneous features were added.

---

## Code Quality

### Strengths

1. **Architecture integrity.** The three-layer separation (core/render/UI) is consistently enforced across the new asteroid belt feature. Render functions receive state via readonly-typed parameters. Core modules have no DOM/canvas access.

2. **Type safety dramatically improved.** `as unknown as` casts reduced from 48 to 4 in production source files. Zero `as any` anywhere in the codebase. ESLint `no-explicit-any` promoted to error for source files.

3. **CRC-32 implementation is correct.** Standard IEEE 802.3 polynomial (0xEDB88320), proper initialization/finalization, lookup table approach. Matches all known test vectors.

4. **Save export envelope is well-designed.** Magic bytes, version, CRC, payload length — proper binary format with backward-compatible import for old-format saves.

5. **Settings decoupling is clean.** Merge-with-defaults pattern in `settingsStore.ts` handles partial data, corrupt data, and version mismatches gracefully.

6. **Asteroid generation uses good procedural techniques.** Fixed-seed PRNG for reproducibility within a session, power-law size distribution, co-orbital velocity generation.

### Bugs

| Severity | File | Line(s) | Description |
|---|---|---|---|
| Critical | `grabbing.ts` | 278-280 | `captureAsteroid()` does not call `setCapturedAsteroidMass()` — asteroid mass never enters physics calculations |
| Critical | `physics.ts` | 1431-1452 | `_computeCoMLocal()` ignores captured asteroid mass — no attachment offset stored in PhysicsState |
| High | `grabbing.ts` | 266 | Global `GRAB_ARM_RANGE` used instead of per-arm `armReach` — all arm tiers have identical 25m range |
| High | `flight/_asteroids.ts` | 257-258 | `trailLength` double-scaled by `scale` factor — streak LOD produces trails that are `scale^2` too long |
| Medium | `collision.ts` | ~806 | No per-asteroid collision cooldown — multi-frame overlaps apply damage every tick |
| Medium | `map.ts` | 916-917 | `craftX` not converted to sun-centred coordinate frame — asteroid distance labels incorrect for non-zero craft X |
| Medium | `autoSave.ts` | 79-88 | `_getAutoSaveKey()` loop has no upper bound — JSDoc claims fallback to AUTO_SAVE_KEY but the fallback never triggers |
| Low | `map.ts` | 944 | Asteroid size label thresholds (500/50m) mismatch flight renderer thresholds (100/10m) |
| Low | `autoSave.ts` | 31 | `SAVE_VERSION = 2` duplicated independently from `saveload.ts` — version skew risk on future bumps |
| Low | `saveload.ts` | 833 | Binary envelope format version read but never validated during import |
| Low | `grabbing.ts` | 296 | `releaseGrabbedAsteroid` sets RELEASING state but does not zero `ps.capturedAsteroidMass` — relies on undocumented caller contract |

### Performance Concerns

| File | Line(s) | Description |
|---|---|---|
| `flight/_asteroids.ts` | 210 | `label.style = { ... }` replaces entire TextStyle object every frame for LANDABLE labels, triggering GPU texture re-uploads. Should use a shared `const LANDABLE_STYLE` at module level. |
| `map.ts` | 919+ | `_drawBeltAsteroidObjects` draws all active asteroids with no off-screen culling, unlike the dot rendering in `_drawAsteroidBelt` which culls off-screen positions. |

### Security

| Area | Assessment |
|---|---|
| XSS (innerHTML) | **Good.** Asteroid rename dialog correctly uses `escapeHtml()` on user input (`_mapView.ts:226,249`). All other new innerHTML assignments use static templates or numeric values. |
| Save data validation | **Good.** Binary envelope validates magic bytes, CRC integrity, and payload length before attempting decompression. Old-format fallback is clean. |
| Settings store | **Good.** Schema version validation rejects unknown formats. Merge-with-defaults prevents partial injection. |

---

## Testing

### Test Coverage Summary

| Test File | Tests | Quality | Key Gap |
|---|---|---|---|
| `autoSave.test.ts` | ~20 | Good | IDB failure logging path not tested; no `@smoke` tag |
| `crc32.test.ts` | ~8 | Good | All-zero test has no concrete expected value; no `@smoke` tag |
| `settingsStore.test.ts` | ~25 | Excellent | No `@smoke` tag |
| `saveload.test.ts` | ~60 | Excellent | `@smoke` present. Export format structure not explicitly asserted. |
| `asteroidBelt.test.ts` | ~30 | Very Good | `canReturnToAgency` with belt zone not tested at unit level; no `@smoke` tag |
| `collision.test.ts` | ~40 | Excellent | `@smoke` present. All velocity boundaries tested. |
| `grabbing.test.ts` | ~50 | Good | CoM physics not verified. Mass limit boundaries not tested at exact edges. `grabbing-arm-industrial` has zero coverage. `@smoke` present. |
| `e2e/asteroid-belt.spec.js` | ~15 | Good | `@smoke` present. See gaps below. |

### Test Gaps

1. **`autoSave.test.ts` — IDB failure logging.** No test mocks `idbSet` to reject and verifies `logger.debug` is called. This was a specific iteration 6 requirement (1.1).

2. **`flightPhase.test.ts` — Belt zone safety.** `isInUnsafeBeltOrbit()` and the `canReturnToAgency()` branch that checks the dense belt are not exercised in unit tests. The `canReturnToAgency` tests at line 348 don't pass a `bodyId` argument.

3. **`grabbing.test.ts` — Industrial arm.** `grabbing-arm-industrial` has zero test coverage. No test exercises the 50m `armReach` or 0.5 `maxGrabSpeed` (both of which are dead data — see bugs above). No boundary tests for mass limits at exact thresholds.

4. **`grabbing.test.ts` — CoM physics.** Tests verify the `thrustAligned` flag toggles correctly, but no test verifies the actual physics: that CoM shifts proportionally to asteroid mass, that torque is applied when misaligned, or that thrust alignment eliminates torque.

5. **`e2e/asteroid-belt.spec.js` — Shared page state.** Tests within `describe` blocks share page instances via `beforeAll`/`afterAll`. This violates the project's E2E independence rule — if an earlier test fails, later tests may be unreliable.

6. **`e2e/asteroid-belt.spec.js` — Asteroid count verification.** The orbit detection test uses the `unsafe` flag as a proxy for density rather than directly calling `generateBeltAsteroids` and counting results.

7. **`test-map.json` — Missing entries.** `asteroidBelt.ts`, `settingsStore.ts`, and `crc32.ts` have no entries. `e2e/asteroid-belt.spec.js` is not linked from the collision or grabbing entries. Running `npm run test:affected` after changes to these modules will not trigger relevant tests.

8. **Missing `@smoke` tags.** `autoSave.test.ts`, `crc32.test.ts`, `settingsStore.test.ts`, and `asteroidBelt.test.ts` have no `@smoke`-tagged tests.

### Type Safety in Tests

- **88 test files** use `// @ts-nocheck` — TypeScript checking is completely suppressed in the test layer
- **0 `as any`** in test files (good — the iteration 6 target was met)
- **27 `as unknown as`** in test files — mostly legitimate test infrastructure (mocking partial objects)

---

## Recommendations

### Before Release (Critical)

1. **Wire `setCapturedAsteroidMass()` into `captureAsteroid()`.** Add a `ps: PhysicsState` parameter to `captureAsteroid()` and call `setCapturedAsteroidMass(ps, asteroid.mass)` on success. Without this, the entire asteroid mass/thrust/torque system is inert after capture. Similarly, `releaseGrabbedAsteroid()` should call `clearCapturedAsteroidMass()`.

2. **Use per-arm `armReach` and `maxGrabSpeed` instead of global constants.** In `captureAsteroid()`, look up the equipped arm's `armReach` property instead of using `GRAB_ARM_RANGE = 25`. Same for `maxGrabSpeed`. Otherwise the Heavy and Industrial arms are functionally identical to the standard arm except for mass limits.

3. **Fix double-scale in streak asteroid rendering.** `_asteroids.ts:257-258`: `trailLength` already incorporates `scale`, so `tailX = headX - dx * trailLength` (remove the second `* scale`).

4. **Add per-asteroid collision cooldown.** Mirror the existing debris `SEPARATION_COOLDOWN_TICKS` pattern for asteroid collisions to prevent continuous damage during multi-frame overlaps.

### Before Release (High)

5. **Store asteroid attachment offset in PhysicsState.** Add a `capturedAsteroidOffset: { x: number, y: number }` field alongside `capturedAsteroidMass`. Update `_computeCoMLocal()` to include the asteroid mass at its spatial position for correct moment of inertia and tipping calculations.

6. **Fix coordinate frame in `_drawBeltAsteroidObjects`.** `map.ts:916-917`: `craftX` uses body-relative coordinates while `craftY` is adjusted to sun-centred — the distance calculation will be wrong for any non-zero angular position.

7. **Unify asteroid size category thresholds.** Export the `getSizeCategory()` helper from `_asteroids.ts` and reuse it in `map.ts:944` to prevent threshold drift (currently 500/50m on map vs 100/10m in flight).

8. **Cap `_getAutoSaveKey()` loop** in `autoSave.ts:79-88` to `SAVE_SLOT_COUNT` and fall back to `AUTO_SAVE_KEY` as the JSDoc claims.

### Post-Release (Medium)

9. **Add missing `test-map.json` entries** for `asteroidBelt`, `settingsStore`, `crc32`, and link `e2e/asteroid-belt.spec.js` from collision/grabbing entries.

10. **Add `@smoke` tags** to `autoSave.test.ts`, `crc32.test.ts`, `settingsStore.test.ts`, and `asteroidBelt.test.ts`.

11. **Fix E2E test independence** in `asteroid-belt.spec.js` — each test should set up its own page/state rather than sharing via `beforeAll`.

12. **Add null guards** to `_drawBody` and `_drawShadow` in map.ts, and null `_commsGraphics` in `destroyMapRenderer()`.

13. **Validate envelope format version** during import (`saveload.ts:833`). Currently the version is read but ignored.

14. **Import `SAVE_VERSION` from `saveload.ts`** in `autoSave.ts` instead of duplicating the constant.

15. **Extract LANDABLE TextStyle** to a module-level constant in `_asteroids.ts` to avoid per-frame GPU texture re-uploads.

16. **Add a `renameOrbitalObject()` core function** and use it from `_mapView.ts` instead of directly mutating `obj.name`.

### Polish (Low)

17. **Remove spurious cast** in `lifeSupport.ts:91` — `CrewMember` already has all needed fields.

18. **Update tech tree descriptions** for `struct-t4` and `struct-t5` to mention grabbing arms.

19. **Consider splitting arm tech tree placement** — both standard and heavy arms in T4 makes the standard arm immediately obsolete.

20. **Add off-screen culling** to `_drawBeltAsteroidObjects` in map.ts.

---

## Future Considerations

### Features for Next Iterations

1. **Asteroid mining/science.** The asteroid landing system is in place but there's no gameplay payoff for landing. Science data collection, resource extraction, or mining contracts would give purpose to the asteroid capture and landing mechanics.

2. **Asteroid economy.** Captured asteroid value based on size/composition. Contracts for asteroid delivery to specific orbits. This leverages the existing persistence system.

3. **Crew assignment to asteroid missions.** The crew system exists but isn't connected to belt operations. Crew skill bonuses for asteroid capture/mining would add depth.

4. **Accessibility (ARIA).** Keyboard navigation exists but full ARIA support (roles, labels, screen reader announcements) is the natural next step.

5. **Multiplayer-ready save format.** The binary envelope with CRC is a good foundation. Future iterations could add encryption, save sharing, and cloud sync.

### Architectural Decisions to Revisit

6. **Asteroid physics integration.** The current `capturedAsteroidMass` field in PhysicsState is a scalar — it doesn't encode position, orientation, or attachment geometry. As asteroid mechanics deepen (mining, multi-asteroid capture, surface operations), this will need to become a full `CapturedBody` struct with position, inertia tensor, and connection constraints.

7. **`CrewMember` / `Astronaut` type split.** This is the root cause of 2 of the 4 remaining `as unknown as` casts. Merging these types (or widening `GameState.crew` to `Astronaut[]`) would eliminate the last avoidable casts in the core layer.

8. **Settings schema migration.** `settingsStore.ts` validates `version === SCHEMA_VERSION` but has no migration path between versions. The first schema change will silently reset all user settings to defaults. A migration chain (similar to the save system's `_applySaveMigrations`) should be designed before the schema changes.

9. **Test TypeScript coverage.** All 88 test files use `// @ts-nocheck`. As the codebase becomes more type-safe, converting tests incrementally would catch type regressions that are currently invisible.

10. **Coverage escalation path.** The 50%/40% floor for render and UI layers was realistic for iteration 5. With the asteroid belt adding significant render/UI logic, gradually increasing to 55%/45% would maintain quality.

### Technical Debt Introduced

11. **Dead per-arm properties.** `armReach` and `maxGrabSpeed` are defined on all three arm parts but never consumed by gameplay logic. These should either be wired in (recommendation #2) or removed to avoid misleading the data definitions.

12. **Undocumented caller contracts in `grabbing.ts`.** Multiple functions assume the caller will separately manage `setCapturedAsteroidMass` / `clearCapturedAsteroidMass`. This implicit contract is a source of bugs (see critical bug #1).

13. **Inline styles in rename dialog.** `_mapView.ts:220-232` uses `style.cssText` and inline `style=""` attributes, contradicting the iteration's CSS custom property migration goal.

14. **`_getAutoSaveKey()` unbounded loop.** The function's JSDoc promises a fallback that never triggers. This could silently write saves to unexpected localStorage keys.

---

## Summary

Iteration 6 successfully delivers the major features: asteroid belt with three zones, procedural asteroid generation, collision, capture via tiered grabbing arms, thrust alignment, persistent captured asteroids, map visualization, and landing on large asteroids. The type safety improvements are substantial (48 casts down to 4), and the settings decoupling and save export envelope are well-designed additions.

The most significant issues are:

1. **`captureAsteroid()` never wires asteroid mass into physics** — the entire mass/torque/alignment system is silently inactive after capture
2. **Per-arm `armReach` and `maxGrabSpeed` are dead data** — all three arm tiers have identical range and speed limits
3. **Double-scale bug in streak asteroid rendering** — visual defect in flight view
4. **No per-asteroid collision cooldown** — continuous damage during multi-frame overlaps

Issues #1 and #2 are the most impactful because they affect core gameplay mechanics that players will directly experience. The asteroid capture feature works at the state-machine level (grab/release/align flags toggle correctly) but the underlying physics integration is incomplete. These should be fixed before release.

The test coverage is good overall, with thorough unit tests for CRC-32, save envelope, settings store, collision thresholds, and grabbing state machine. The main testing gaps are the physics integration paths (CoM, torque, mass) and the missing `test-map.json` entries that prevent affected-test detection.
