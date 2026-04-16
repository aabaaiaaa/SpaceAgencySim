# Iteration 19 — Broad Sweep: Bugs, Test Infrastructure & Deep Structural Refactors

**Date:** 2026-04-16
**Scope:** Bug fixes, E2E cleanup, test infrastructure, core refactors (staging/saveload), full physics.ts barrel split with integration-loop refactor, constants.ts topical split, UI reducer extraction, listener management unification, render scene teardown audit.
**Builds on:** Iteration 18 (quota handling, listener tracker, body-aware docking, drag extraction, dispatchKey helper, modal focus, setThrottleInstant).
**Driven by:** Iteration 18 review at `.devloop/archive/iteration-18/review.md` (dated 2026-04-16).

---

## Motivation

The iteration-18 review found the codebase in **"mature and healthy"** shape — no critical issues, no architecture drift, no secrets, no eval/dynamic-code, no tracked build artifacts. The `no-explicit-any` and `no-floating-promises` rules are respected; the three-layer core/render/ui boundary is upheld by both code and types.

Remaining work falls into three buckets:

1. **Two verified, reproducible UI bugs** — Surface Ops panel overlaps the Flight Left Panel when landed; post-flight auto-save toast is silent on hub-return.
2. **Loose threads from iter-18** — two E2E specs still use `page.keyboard.*` despite the project-wide `dispatchKey` convention; several UI modules still hand-pair add/removeEventListener instead of using the `ListenerTracker`; several render scenes don't call `.destroy({ children: true })` on teardown; there is no `vitest.config.ts` so per-file logger suppression is duplicated.
3. **Structural cleanup** — `physics.ts` (2824 LOC), `constants.ts` (2220 LOC), `staging.ts` (1006 LOC), `saveload.ts` (958 LOC) are all large enough that review and change-impact reasoning suffer. The barrel-re-export pattern is used successfully elsewhere (`flightController`, `vab`, `missionControl`, `flight`) and is the project's idiomatic solution.

The user has opted into a large iteration (100+ tasks) covering all of the above plus stretch items: full `physics.ts` extraction with integration-loop refactor, `constants.ts` topical split, and UI reducer extraction for five DOM-heavy files.

---

## 1. Bug Fixes

### 1.1 Surface Ops Panel Overlap (flight HUD, landed state)

**Symptom:** When the rocket is landed, `#flight-hud-surface` (Plant Flag / Collect Sample / Deploy Instrument / Deploy Beacon) renders on top of and occludes the lower portion of `#flight-left-panel` (throttle / staging / fuel column), also stealing clicks via `pointer-events: auto`.

**Root cause:** Both panels are siblings inside `#flight-hud` with overlapping geometry and no z-index:

- `#flight-hud-surface` — `flightHud.css:645–655`: `position: absolute; bottom: 10px; left: 70px; max-width: 200px`
- `#flight-left-panel` — `flightHud.css:17–31`: `position: absolute; left: 58px; bottom: 60px; width: 230px`

Horizontal spans (70–270 and 58–288) fully overlap; vertical extents collide once the surface panel grows past ~50 px upward (always the case when any action button is rendered). Surface panel is appended after left panel in DOM (`flightHud.ts:183–188`) so it paints on top.

**Chosen fix (Option 1 per review):** **Reposition** `#flight-hud-surface` to the right-hand side of the HUD, mirroring the objectives panel. The surface-ops buttons are conceptually a context-action panel and belong beside objectives, not wedged under the telemetry column.

Implementation approach:
- Change `#flight-hud-surface` CSS from `left: 70px` to a right-anchored position (e.g. `right: 260px; bottom: 10px` — tune to sit just left of the objectives panel and clear of the time-warp panel).
- Remove the `max-width: 200px` if the right-anchored zone can accommodate the button set; otherwise keep it.
- Preserve `display: none` collapse when `!landed`.

**Regression guard:** Add an E2E test (`e2e/flight-hud-surface.spec.ts`) that lands the rocket, waits for the surface panel to be visible, and asserts via `getBoundingClientRect()` that the surface panel's bounding box does not intersect the left panel's bounding box. Tag `@smoke`.

---

### 1.2 Silent Hub-Return Auto-Save Toast

**Symptom:** After a flight, when the player clicks "Return to Space Agency" on the post-flight summary and returns to the hub, the subsequent auto-save happens silently — no toast appears even though auto-save is enabled.

**Root cause:** Two call sites trigger auto-save within ~4.8 s of each other:

1. `src/ui/flightController/_postFlight.ts:647` — `triggerAutoSave(state, 'post-flight')` when the summary opens.
2. `src/ui/index.ts:185` — `triggerAutoSave(state, 'hub-return')` at the end of `returnToHubFromFlight()`.

`triggerAutoSave()` in `src/ui/autoSaveToast.ts:38–45` early-returns silently (via `void performAutoSave(state)`) when a toast is already visible. A player reading the summary and clicking Return within the toast lifecycle (~4.8 s) always hits this branch, causing the hub-return call to save silently. The post-flight save also runs against state that `processFlightReturn()` has since mutated — the "post-flight" label is misleading.

**Chosen fix (Option 3 per review):** **Drop the post-flight trigger entirely**; only auto-save on hub-return. Rationale:
- The post-flight summary is a read-only view, not a commit point.
- Saving before `processFlightReturn()` applies rewards/penalties persists pre-reward state — arguably wrong behaviour.
- Eliminates the silent path; one trigger means one toast.
- Removes one redundant IndexedDB write per flight.

Implementation:
- Remove the `triggerAutoSave(state, 'post-flight')` call at `_postFlight.ts:647`.
- Keep the hub-return call at `src/ui/index.ts:185`.
- Re-verify `src/ui/flightController/_loop.ts` and `src/ui/flightController/_menuActions.ts` for any other close-proximity triggers that could hit the silent branch; if found, revisit scope.

**Regression guard:** Add an E2E test (`e2e/auto-save-hub-return.spec.ts` or extend `e2e/auto-save.spec.ts`) that completes a flight, clicks Return to Hub within 1 s, and asserts the auto-save toast is visible on the hub scene. Tag `@smoke`.

---

## 2. E2E Keyboard Migration (Iter-18 Holdouts)

Per user-stated convention, E2E tests must use `window.dispatchEvent(new KeyboardEvent(...))` via `e2e/helpers/_keyboard.ts` (`dispatchKey`) — `page.keyboard.press` is unreliable under parallel Playwright workers. Two spec files still use the old pattern:

### 2.1 `e2e/keyboard-nav.spec.ts` Migration

Uses `page.keyboard.press` at lines 29, 40, 43, 47, 54, 64, 88, 114, 147, 152, 156, 186, 206, 228, 245, 287, 310, 324. Migrate all call sites to `dispatchKey()`.

### 2.2 `e2e/tipping.spec.ts` Migration + Hold/Release Helper

Uses `page.keyboard.down('d')` / `page.keyboard.up('d')` at lines 35, 40. The existing `dispatchKey` helper only issues a single keydown → no hold/release analogue. Extend the helper:

- Add `dispatchKeyDown(page, key)` and `dispatchKeyUp(page, key)` utilities in `e2e/helpers/_keyboard.ts` that dispatch `keydown`/`keyup` events respectively.
- Migrate the two call sites in `tipping.spec.ts`.

Verification: rerun the two migrated specs via `npx playwright test e2e/keyboard-nav.spec.ts e2e/tipping.spec.ts` only (per standing preference — never the full E2E suite).

---

## 3. Test Infrastructure

### 3.1 Add `vitest.config.ts` with Global Setup

Currently the project runs Vitest on defaults — no config file exists. This forces per-file logger-level suppression (iter-17 added `logger.setLevel('warn')` in `beforeEach` across `saveload.test.ts`, `autoSave.test.ts`, `storageErrors.test.ts`, `debugMode.test.ts`) and leaves worker count, timeouts, and coverage unconfigured.

Create `vitest.config.ts` with:
- `setupFiles: ['./src/tests/setup.ts']` — a new setup file that pins `logger.setLevel('warn')` before each test. Tests that want debug output can locally `logger.setLevel('debug')` in `beforeEach`.
- Explicit worker cap (match the pattern Playwright already uses — 2 workers on Windows).
- Default test timeout.
- Coverage config for `@vitest/coverage-v8` (target `src/`, exclude `src/tests/` and `src/main.ts`).

After `vitest.config.ts` lands, **remove the per-file `logger.setLevel('warn')` calls** from `saveload.test.ts`, `autoSave.test.ts`, `storageErrors.test.ts`, `debugMode.test.ts` — they are now redundant.

### 3.2 Add `src/tests/library.test.ts`

`src/core/library.ts` (536 LOC, craft library operations) has no dedicated test file. Review §4.6 flagged this as a real gap. Add round-trip unit tests: save craft → list → load → verify equality; delete → verify absent; rename → verify new name round-trips; duplicate-name guard.

Update `test-map.json` (or regenerate via `scripts/generate-test-map.mjs`) so `src/core/library.ts` maps to the new test file.

### 3.3 Add Mission→Finance Smoke E2E

Review §6.5 flagged a gap: no smoke test on the mission→finance feedback loop (mission completes → funds awarded → player can afford next part). Add one smoke-tagged E2E spec (`e2e/mission-finance-loop.spec.ts` or add a `@smoke` test to an existing mission spec) that:

1. Starts from `midGameFixture` or similar.
2. Completes a mission (via direct core-state manipulation in `beforeEach` or a scripted flight).
3. Verifies funds increased by the mission's reward.
4. Verifies a previously-unaffordable part is now affordable.

Tag `@smoke`. Keep runtime under 10 s.

---

## 4. High-Value Cleanups

### 4.1 Delete `any` Aliases in `testFlightBuilder.ts`

Lines 27–30 declare `type RocketAssembly = any; type StagingConfig = any;` with an `eslint-disable` comment stating the `.d.ts` is missing — but the real interfaces are exported from `src/core/rocketbuilder.ts`. Delete the local aliases and import the real types.

### 4.2 Log Swallowed Settings-Sync Error in `saveload.ts`

`src/core/saveload.ts:345–347` fires `void saveSettings(...)` with a silent catch documented as "intentionally not awaited so a settings-sync failure does not block." If settings sync starts failing systematically, nothing surfaces. Replace the naked `void` with `.catch(err => logger.warn('save', 'Settings sync failed during save', { err }))`. Keep the fire-and-forget semantics — only add observability.

### 4.3 Add Timeout to `resyncWorkerState()`

`src/ui/flightController/_workerBridge.ts:152–177` has no timeout. If the worker is hung but not yet detected as such, resync blocks indefinitely. Wrap the resync promise in `Promise.race` with a 5-second guard that throws or logs on timeout. Mirror the 10-second init pattern at `_workerBridge.ts:104`.

### 4.4 Add Low-Level Guard in `orbit.ts`

Review §4.3 flagged: `orbit.ts` orbital-radius computations assume `r > BODY_RADIUS`. The invariant is structural (all orbital states are constructed by the codebase) but a `if (r <= 0) return null;` guard in the lowest-level helper costs nothing. Add the guard and a unit test for the degenerate case.

---

## 5. Render Scene Teardown Audit

Review §5.1 flagged: `src/render/map.ts:289, :442` correctly call `_mapRoot.destroy({ children: true })` on teardown, but no equivalent `.destroy()` calls are visible in `src/render/vab.ts`, `src/render/hub.ts`, or `src/render/flight/` sub-modules. The flight scene is long-lived so typically fine, but the hub ↔ VAB ↔ flight swap pattern will accumulate textures/geometry over a long session.

### 5.1 Audit `src/render/vab.ts`

Identify the scene-root container (likely `_vabRoot` or similar). On scene destroy, call `.destroy({ children: true })` and drain the `RendererPool` if used.

### 5.2 Audit `src/render/hub.ts`

Same pattern — locate scene root, add teardown.

### 5.3 Audit `src/render/flight/` Sub-modules

The flight scene has multiple sub-modules (`rocket`, `camera`, `sky`, `trails`, `debris`, etc.). Identify which own PixiJS `Container` instances and ensure each has a destroy hook called from the flight scene's teardown path.

### 5.4 Unit Test for RendererPool Drain

Add a test that verifies `RendererPool.drain()` releases all held Graphics/Text, if not already covered.

---

## 6. Listener Management — Unify on ListenerTracker

Review §5.2 flagged: `src/ui/listenerTracker.ts` is used by `crewAdmin`, `topbar`, `help`, `settings`, `debugSaves`, plus a VAB-scoped tracker in `vab/_listenerTracker.ts`. Many other UI modules still hand-pair `addEventListener`/`removeEventListener`. The paired-removal pattern is correct at the call sites reviewed — but the failure mode is the mixed style itself: future maintainers add listeners without remembering to pair.

**Chosen convention:** Continue with `ListenerTracker`. Migrate the remaining hand-paired sites.

### 6.1 Migrate `flightController/_menuActions.ts`

Line 75 adds a listener without a visible central cleanup hook. Route through a tracker instance tied to the flight controller's lifecycle.

### 6.2 Migrate `launchPad.ts`

Lines 631–640 add listeners without a visible central cleanup. Migrate.

### 6.3 Migrate `library.ts`

Line 133 adds a listener without a central cleanup. Migrate.

### 6.4 Audit Remaining UI Files

Grep for `addEventListener` across `src/ui/` and flag any other sites that aren't routed through a tracker or paired with an explicit removeEventListener in a visible cleanup path. Migrate or document exemptions (e.g., one-shot listeners that remove themselves).

### 6.5 Unit Test for Listener Cleanup in Migrated Modules

Extend the existing pattern from `ui-listenerTracker.test.ts` to cover the migrated modules — init → register → destroy → assert zero residual listeners via a mock.

---

## 7. Core Refactors

### 7.1 Extract `debris.ts` from `staging.ts`

`staging.ts` (1006 LOC) mixes stage activation with debris creation. Review §4.1 identified `_createDebrisFromParts` and `_renormalizeAfterSeparation` (approx. lines 756–813) as the clearest seam.

**Target structure:**
- `src/core/debris.ts` — owns debris creation from separated parts, debris ID counter (`_debrisNextId`), `resetDebrisIdCounter()` (already exists; move it), and debris-related helpers.
- `staging.ts` — keeps stage activation, calls `debris.createDebrisFromParts(...)`.

**Constraints:**
- Preserve all existing exports — `staging.ts` may need to re-export debris functions for backward compat, or update consumers directly.
- Preserve all existing test behaviour. The `staging.test.ts` suite should pass unchanged.
- Update `test-map.json` to map `src/core/debris.ts` to a new `src/tests/debris.test.ts` file OR fold into `staging.test.ts` — prefer a new dedicated file for focused coverage.

### 7.2 Split `saveload.ts` into `saveEncoding.ts` + `saveload.ts`

`saveload.ts` (958 LOC) mixes JSON envelope + CRC + compression (pure functions) with IndexedDB I/O and export/import DOM helpers (side-effectful). Review §4.1 identified the seam.

**Target structure:**
- `src/core/saveEncoding.ts` — pure functions: envelope build/parse, CRC32, LZ-string compress/decompress, payload validation.
- `src/core/saveload.ts` — IDB I/O via `idbGet`/`idbSet`, `saveGame()`, `loadGame()`, quota error handling, export/import DOM helpers.

**Constraints:**
- All public exports (`saveGame`, `loadGame`, `exportSave`, `importSave`, `StorageQuotaError`) keep their existing paths.
- Iter-18 quota handling (`StorageQuotaError`) stays in the I/O layer.
- Tests in `saveload.test.ts` should pass unchanged.
- Add `src/tests/saveEncoding.test.ts` with focused tests for envelope, CRC, compression round-trips.
- Update `test-map.json`.

---

## 8. physics.ts Full Barrel Split + Integration Loop Refactor

`physics.ts` (2824 LOC) is the largest single file in core. It owns the integration loop, throttle/TWR logic, steering, docking, RCS, gravity, and the dispatch to already-extracted subsystems (`parachute`, `legs`, `power`, `fuelsystem`, `malfunctions`, `sciencemodule`, `collision`, `staging`, `orbit`, `dragCoefficient`).

**Target structure: `src/core/physics/` sub-modules + `src/core/physics.ts` barrel.**

Following the established barrel pattern used by `flightController`, `vab`, `missionControl`, `flight`:

```
src/core/physics.ts                  (barrel re-export)
src/core/physics/
  init.ts                            (createPhysicsState + initial state helpers)
  integrate.ts                       (_integrate main loop; orchestrates sub-ticks)
  gravity.ts                         (_gravityForBody; handles flat/radial modes)
  thrust.ts                          (thrust computation, TWR lookups)
  steering.ts                        (_applySteering, incl. parachute-torque & damping)
  docking.ts                         (_applyDockingMovement; RCS-mode translation; docking-mode progress tracking)
  rcs.ts                             (RCS damping and RCS-mode thrust helpers; shares state with docking)
  keyboard.ts                        (handleKeyDown, handleKeyUp)
  staging.ts (already exists)        (unchanged; imported by integrate.ts)
  debrisGround.ts                    (tickDebrisGround — currently ~500 LOC in physics.ts line 2303+)
  capturedBody.ts                    (setCapturedBody, clearCapturedBody, setThrustAligned)
  phases/
    orbitPhase.ts                    (ORBIT-phase branch of integration)
    transferPhase.ts                 (TRANSFER-phase branch)
    capturePhase.ts                  (CAPTURE-phase branch)
    flightPhase.ts                   (FLIGHT-phase branch — the largest)
    descentPhase.ts                  (descent/re-entry-specific handling, if distinct)
```

**Constraints:**
- All existing public exports (`createPhysicsState`, `tick`, `handleKeyDown`, `handleKeyUp`, `fireNextStage`, `computeDockingRadialOut`, `tickDebrisGround`, `setCapturedBody`, `clearCapturedBody`, `setThrustAligned`) stay available from `import { X } from 'src/core/physics'` — no consumer import changes.
- The existing `physics.test.ts` (3203 LOC) must pass at every step. Do each extraction as a small, testable increment.
- After extraction, add per-sub-module unit tests only where new seams make previously-private internals usefully testable. Don't over-test helpers whose behaviour is already covered by the integration tests.
- Update `test-map.json` to map each new sub-module to the `physics.test.ts` (and any new sub-module-specific tests).

**Recommended extraction order (minimize breakage risk):**
1. Easy helpers first — gravity, keyboard, capturedBody, init (stateless or near-stateless).
2. Docking + RCS together (they share control-mode state).
3. Steering (depends on parachute integration; careful).
4. Thrust.
5. debrisGround (big but self-contained).
6. Phase branches (pull one phase at a time out of `_integrate` into a dedicated function; call from `integrate.ts`).
7. Final: the integration-loop body in `integrate.ts` should be a short orchestrator that calls the phase function.

**Integration loop refactor specifics:**
- Current `_integrate` (lines ~1040–1405) dispatches by FlightPhase via a switch or if-chain. Each phase has its own gravity/atmosphere/thrust assumptions.
- After refactor: `_integrate(ps, dt)` reads the phase, calls the corresponding `phases/<phase>.ts` function, handles cross-phase transitions (e.g. atmospheric entry promoting FLIGHT → DESCENT).
- No behaviour change. Test the refactor by running `physics.test.ts` + all smoke + the flight E2E specs.

**Known tight couplings flagged during exploration:**
- **Power ↔ Science:** `tickPower()` receives science running state. Thread this via the phase function's context, not via `_integrate` globals.
- **Legs ↔ Grounded Physics:** tipping physics reads leg deploy state. Keep in `steering.ts` or `flightPhase.ts`; consider a `groundedTick()` helper if the coupling is clean.
- **Thrust ↔ Fuel ↔ Mass:** ordered tightly in the frame. Preserve order when lifting out of `_integrate`.
- **Steering ↔ Parachutes:** parachute torque lives inside `_applySteering`. Keep together in `steering.ts`; don't fragment further.
- **RCS ↔ Control Mode:** RCS is only live in DOCKING/RCS modes. Thread control mode explicitly; don't rely on implicit state.

---

## 9. constants.ts Topical Split

`constants.ts` (2220 LOC, 123 importers) is an omnibus file. Splitting it into topical modules with a barrel re-export at `constants.ts` keeps all 123 import sites working while making the constants landscape navigable.

**Target structure:**
```
src/core/constants.ts                (barrel re-export; public path)
src/core/constants/
  flight.ts                          (~350 LOC: PartType, FlightPhase, ControlMode, FlightOutcome, FuelType, MissionState, AstronautStatus, GameMode, Orbit, OrbitalObjectType, Docking, Grab, Power, Malfunctions)
  bodies.ts                          (~350 LOC: CelestialBody, BeltZone, body physics, altitude bands, biomes, surface operations, life support)
  economy.ts                         (~450 LOC: Finance, Facilities, Contracts, Reputation, Training, Crew costs, Facility upkeep)
  gameplay.ts                        (~300 LOC: Weather, Hard landing, Injury, Medical, Part wear/refurbish, Difficulty, Comms, Resources, Mining)
  satellites.ts                      (~200 LOC: SatelliteType, Constellation mechanics, Lease income, Reposition, Degradation)
```

**Constraints:**
- Barrel re-export: `src/core/constants.ts` becomes `export * from './constants/flight'; export * from './constants/bodies'; ...` — no existing import changes required.
- Cross-dependencies between topical files (e.g. `SATELLITE_VALID_BANDS` uses altitude band keys from bodies) become explicit imports between sub-files.
- `FACILITY_DEFINITIONS` cross-references in economy and `PartType` references in `MALFUNCTION_TYPE_MAP` (flight) must be preserved.
- Update `test-map.json`.

**Recommended extraction order:**
1. `bodies.ts` — self-contained; no inward deps.
2. `gameplay.ts` — self-contained.
3. `satellites.ts` — depends on bodies (altitude bands).
4. `economy.ts` — depends on flight (PartType).
5. `flight.ts` — the remaining flight/orbit/malfunction constants.
6. Rewrite `constants.ts` as barrel.

Each step: extract the constants, add barrel line, run `npm run typecheck` to confirm nothing broke.

---

## 10. UI Reducer Extraction

Review §5.6 flagged: no unit tests for `flightHud.ts`, `topbar.ts`, `crewAdmin.ts`, `mainmenu.ts`, `hub.ts`. The cheapest win is to extract pure state reducers from each (following the VAB pattern — see `src/ui/vab/_state.ts` and `src/tests/ui-vabState.test.ts`) and unit-test those.

**Pattern (per VAB):**
- `src/ui/<panel>/_state.ts` — defines `<Panel>State` interface, `get<Panel>State()`, `set<Panel>State(patch)`, `reset<Panel>State()`.
- `src/ui/<panel>.ts` or its barrel delegates pure state computation to the reducer; keeps DOM/PixiJS/listener code in place.
- `src/tests/ui-<panel>State.test.ts` — tests defaults, patching, reset.

**Candidates and scope (from exploration):**

### 10.1 `flightHud.ts` (M)
Extract:
- Throttle display formatter (given throttle + TWR mode, produce display class and label).
- Altitude/velocity formatter.
- Apoapsis estimator.
- Warp level display.
- Fuel tank list builder (given active parts, return formatted rows).
- Crew roster list (given crew + assignments, return display rows).

Test: `src/tests/ui-flightHudState.test.ts`.

### 10.2 `topbar.ts` (S)
Extract:
- Cash color / health-based formatting.
- Mission count badge visibility.
- Dropdown open state, modal visibility logic.

Test: `src/tests/ui-topbarState.test.ts`.

### 10.3 `hub.ts` (M)
Extract:
- `formatReturnResults()` — aggregates missions/rewards/costs into display rows.
- Facility upgrade eligibility check (given funds + facility tier, return enabled/disabled).
- Financial summary calculations.

Test: `src/tests/ui-hubState.test.ts`.

### 10.4 `mainmenu.ts` (S)
Extract:
- Save slot card formatting (date, duration, crew count, money).
- Save list sort/filter order.
- Skip the shooting-stars animation state — not load-bearing.

Test: `src/tests/ui-mainMenuState.test.ts`.

### 10.5 `crewAdmin.ts` (M)
Extract:
- `formatCrewRow()` (name, status badge, injury remaining).
- `skillBarHTML()` (if the pure string-building can be separated from the DOM mount).
- Hire tab: capacity check, cost calculation.
- Training period calculations.

Test: `src/tests/ui-crewAdminState.test.ts`.

**Constraints:**
- Follow the VAB pattern exactly. Don't invent a new convention.
- Keep DOM wiring, event listeners, and PixiJS calls in the original files.
- Each reducer gets its own test file.
- Update `test-map.json` for each new source/test pair.

---

## 11. Test-Map Updates

The structural changes in sections 5–10 add or move source files. `test-map.json` is produced by `scripts/generate-test-map.mjs` (run via `npm run test-map:generate`). **The generator is NOT fully automatic** — it has several hardcoded configuration knobs that must be updated whenever new barrels, source groupings, sub-module directories, or E2E specs are introduced:

| Knob | Purpose | When to update |
|------|---------|----------------|
| `BARREL_MAP` | Maps a barrel file to its sub-module directory | When introducing a new barrel (physics.ts, constants.ts in this iteration) |
| `SOURCE_GROUPS` | Explicit file → area grouping (e.g., `core/saveload` groups saveload + autoSave + idbStorage) | When a new file should share an existing area (e.g., saveEncoding → `core/saveload`) or when splitting an existing group (constants.ts currently in `core/gameState`) |
| `SKIP_SOURCES` | Files the generator ignores | When a previously-skipped file gets test coverage (this iteration: `src/core/library.ts`) |
| `subDirPatterns` | Regexes classifying sub-module files to areas | When a new barrel directory is introduced (`src/core/physics/`, `src/core/constants/`) |
| `E2E_SPEC_AREAS` | Curated E2E spec → areas mapping | For every new E2E spec file (this iteration: `flight-hud-surface`, `auto-save-hub-return`, `mission-finance-loop`) |

**Workflow per structural change:**
1. Edit `scripts/generate-test-map.mjs` (one or more of the knobs above).
2. Run `npm run test-map:generate`.
3. Spot-check the diff for correctness. If the generator missed a file or mis-grouped something, iterate on the script edits rather than hand-editing `test-map.json` — the script is the source of truth.
4. Commit both the updated generator and the regenerated `test-map.json`.

**Relevant hardcoded state at iteration start:**
- `SKIP_SOURCES` contains `src/core/library.ts` — must be removed before `library.test.ts` can be mapped.
- `SOURCE_GROUPS['core/gameState']` includes `src/core/constants.ts` — must be split out (or the constants barrel stays in `core/gameState` while sub-files go to a new `core/constants` area, at the cost of split ownership).
- `BARREL_MAP` covers only `vab`, `flightController`, `missionControl`, `render/flight` today.
- `subDirPatterns` covers only those same four today.

---

## 12. Final Verification

After all tasks land:

- `npm run build` — production build succeeds.
- `npm run typecheck` — zero TS errors.
- `npm run lint` — zero ESLint errors.
- `npm run test:unit` — all unit tests pass.
- `npm run test:smoke:unit` — smoke unit subset passes.
- `npm run test:smoke:e2e` — smoke E2E subset passes (per-project preference: NEVER the full E2E suite).
- Targeted E2E reruns for:
  - The two migrated specs (`keyboard-nav.spec.ts`, `tipping.spec.ts`).
  - Any flight-hud specs affected by §1.1.
  - Any auto-save specs affected by §1.2.
  - Any test added in §3.

---

## Testing Strategy

| Area | What Changes |
|------|--------------|
| `flightHud.css` / `e2e/flight-hud-surface.spec.ts` (new or extended) | Surface panel bounding-box assertion |
| `e2e/auto-save.spec.ts` (extend) or `e2e/auto-save-hub-return.spec.ts` (new) | Hub-return toast visibility |
| `e2e/keyboard-nav.spec.ts`, `e2e/tipping.spec.ts` | Migration-preserves-behaviour rerun |
| `e2e/helpers/_keyboard.ts` | `dispatchKeyDown` / `dispatchKeyUp` helpers added |
| `src/tests/setup.ts` (new) | Pins logger level |
| `vitest.config.ts` (new) | Setup file, workers, timeouts, coverage |
| `src/tests/library.test.ts` (new) | Craft library round-trips |
| Mission→finance smoke E2E | New or extended |
| `saveload.test.ts` | Unchanged (post-split) |
| `saveEncoding.test.ts` (new) | Envelope, CRC, compression round-trips |
| `staging.test.ts` | Unchanged (post-debris extraction) |
| `debris.test.ts` (new) | Debris creation, ID counter, reset |
| `physics.test.ts` | Must pass at every extraction increment |
| Per-sub-module physics tests | Added only where new seams are usefully testable |
| `ui-flightHudState.test.ts`, `ui-topbarState.test.ts`, `ui-hubState.test.ts`, `ui-mainMenuState.test.ts`, `ui-crewAdminState.test.ts` | New reducer tests |
| Listener-cleanup tests | Extended to cover migrated modules |

---

## Technical Decisions

- **Listener convention:** `ListenerTracker` (existing). Not migrating to `AbortController` — unnecessary blast radius for no marginal benefit.
- **Surface Ops fix:** Option 1 (reposition to right). Review called it "cleanest"; the surface panel is a context-action panel conceptually, and the right-anchor aligns with the objectives panel.
- **Auto-save fix:** Option 3 (drop post-flight trigger). Review called it "cleanest long-term." Removes redundant write, eliminates silent path, fixes the pre-reward-state save issue.
- **Physics depth:** Full barrel split + integration loop refactor. Matches project barrel pattern. Aggressive but user has explicitly scoped it in.
- **Barrel re-exports everywhere.** No consumer import changes. This is the established pattern (`flightController`, `vab`, `missionControl`, `flight`).
- **test-map.json auto-generated** via `scripts/generate-test-map.mjs`. Regenerate after each batch.
- **No save migration framework.** Per standing user preference (memory: "no save migration during dev"). Saves remain disposable.
- **No `AbortController` migration, no `BroadcastChannel`, no `aria-labelledby`/`aria-describedby`.** Explicitly out of scope this iteration.
- **Per-file `logger.setLevel('warn')` calls removed** after `vitest.config.ts` lands. The setup file replaces them.

---

## Scope Boundary

**Out of scope:**
- Save-version migration framework.
- `AbortController` listener pattern migration.
- `BroadcastChannel` cross-tab coordination.
- `aria-labelledby` / `aria-describedby` on modals.
- Toast accessibility (aria-live / role=alert).
- `flightHud.ts` / `topbar.ts` full barrel split (reducer extraction only; DOM code stays monolithic).
- New gameplay features.

**In scope (explicit confirmation):**
- Surface Ops reposition.
- Drop post-flight auto-save trigger.
- Migrate `keyboard-nav.spec.ts` and `tipping.spec.ts` to `dispatchKey`.
- Add `vitest.config.ts`, `src/tests/setup.ts`, `library.test.ts`, mission→finance smoke E2E.
- Delete `any` aliases in `testFlightBuilder.ts`.
- Log settings-sync error in `saveload.ts`.
- Timeout on `resyncWorkerState()`.
- Low-level guard in `orbit.ts`.
- Render scene teardown in `vab.ts`, `hub.ts`, `flight/` sub-modules.
- Listener-tracker migration for `_menuActions.ts`, `launchPad.ts`, `library.ts`, remaining UI sweep.
- Extract `debris.ts` from `staging.ts`.
- Split `saveload.ts` → `saveEncoding.ts` + `saveload.ts`.
- Full `physics.ts` barrel split with sub-modules + integration-loop refactor (phase-per-module).
- `constants.ts` topical split into 5 files + barrel.
- UI reducer extraction for `flightHud`, `topbar`, `hub`, `mainmenu`, `crewAdmin` + unit tests for each.
- Final verification across typecheck, lint, build, unit, smoke, affected E2E.
