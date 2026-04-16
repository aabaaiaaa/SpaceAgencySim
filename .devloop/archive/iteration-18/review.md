# Codebase Review — 2026-04-16

**Scope:** Full source review of `src/` (139k LOC, 305 TS files) and test codebase (`src/tests/` 126 unit files + `e2e/` ~55 spec files). This review was performed without reference to prior iteration review docs and focuses entirely on the current state of the code.

---

## 1. Executive Summary

The codebase is in **mature and healthy** shape. Architecture boundaries are enforced in practice as well as in documentation; type-safety discipline is strong; test coverage is broad. The TypeScript strict-mode baseline, the `no-floating-promises` / `no-misused-promises` / `no-explicit-any` ESLint rules, and the tight runtime dependency set (only `pixi.js` and `lz-string`) together give the project a solid floor.

The problems that remain fall into three broad buckets:

1. **A handful of very large modules** (`physics.ts` 2824 LOC, `constants.ts` 2220 LOC, `render/map.ts` 2111 LOC, `ui/flightHud.ts` 1573 LOC, `ui/topbar.ts` 1328 LOC) that are still monolithic even after the documented "barrel + sub-module" splits that the project clearly uses elsewhere.
2. **Inconsistent listener / resource management in the UI & render layers** — the `ListenerTracker` utility and the PixiJS `RendererPool` exist and are *partially* adopted. Long play sessions and frequent scene swaps (hub ↔ VAB ↔ flight ↔ map) are the plausible fault lines.
3. **Test-harness consistency gaps** — two E2E specs still use `page.keyboard.*` despite the `dispatchKey` helper being the documented, project-wide convention. A few weak-assertion patterns and some under-tested UI surfaces are flagged below.

No critical security issues, no architecture violations, no commits of build artifacts, no eval/dynamic-code patterns, and no commits of secrets were found.

---

## 2. Codebase Overview

| Metric | Value |
| --- | --- |
| Source TS files | 305 |
| Source LOC | ~139,000 |
| Core modules | 71 (`src/core/`) |
| Render modules | 7 + sub-dirs (`src/render/`) |
| UI modules | ~55 (`src/ui/`) |
| Unit test files | 126 (`src/tests/`) |
| E2E spec files | ~55 (`e2e/`) |
| Runtime deps | 2 (`pixi.js@^8.18.1`, `lz-string@^1.5.0`) |
| TS config | strict; `moduleResolution: bundler`; `allowJs: true`, `checkJs: false` |
| Lint | Flat ESLint config; strict TS rules; `@typescript-eslint/no-explicit-any: error` |

---

## 3. Architecture Adherence

`CLAUDE.md` declares three strict layers: **core** (pure), **render** (read-only view of state), **ui** (calls core, mutates via functions). All three were checked directly.

- **Core purity:** No `document` / canvas / Pixi references in `src/core/`. Only `src/core/saveload.ts:637–664` touches the DOM, and it is guarded with `typeof document === 'undefined'` for the save-export helper — this is correctly out-of-band UI, not a violation.
- **Render read-only:** `src/render/types.ts:74–144` defines explicit `ReadonlyPhysicsState`, `ReadonlyFlightState`, `ReadonlyGameState` with `readonly` members and `ReadonlySet/ReadonlyMap`. Render modules consume these types. No writes from render into gameState were found.
- **UI via core:** UI modules import and call core functions (e.g. `crewAdmin.ts` uses `hireCrew()`/`fireCrew()`/`assignToTraining()`). No direct `state.x = …` writes from UI were found.
- **Barrel re-export pattern** is used consistently: `flightController.ts`, `vab.ts`, `missionControl.ts`, `flight.ts`, `logistics/`, `hubManagement/`. External imports remain stable. Good.

**Verdict:** Architecture is cleanly upheld by both the code and the types.

---

## 4. Core Layer (`src/core/`)

### 4.1 Large monolithic files

The following modules are now big enough that review and change-impact reasoning suffer:

| File | LOC | Notes |
| --- | --- | --- |
| `physics.ts` | 2824 | Integration loop, staging dispatch, gravity, drag, fuel, RCS, parachutes, legs, ejectors, malfunctions, science, power — all in one file |
| `constants.ts` | 2220 | Grown large enough to warrant topical splits (flight constants, body constants, UI constants, etc.) |
| `gameState.ts` | 1320 | Central type hub; 45+ exported interfaces |
| `staging.ts` | 1006 | Stage activation mixed with debris creation (`_createDebrisFromParts`, `_renormalizeAfterSeparation` ~lines 756–813) — obvious extraction candidate → `debris.ts` |
| `saveload.ts` | 958 | Pure serialization + IDB I/O + export/import DOM helpers all in one file — a `saveEncoding.ts` (envelope, CRC, compression) could peel off cleanly |
| `manoeuvre.ts` | 988 | Transfer math |
| `sciencemodule.ts` | 904 | |
| `collision.ts` | 850 | |

**Recommendation:** `physics.ts` and `staging.ts` are the two with the strongest seams. The others are readable today but should be watched.

### 4.2 Type safety

- `@typescript-eslint/no-explicit-any: error` is enforced and respected. All eight `eslint-disable` comments for `no-explicit-any` are localized to serialization / dynamic-bag boundaries, with justifying context:
  - `saveload.ts:142, 804, 856` — JSON envelope + post-parse validators.
  - `physics.ts:197`, `parachute.ts:150`, `sciencemodule.ts:126` — dynamic `PlacedPart` property bags.
  - `testFlightBuilder.ts:27–30` — test fixtures.
- `testFlightBuilder.ts:27–30` declares `type RocketAssembly = any; type StagingConfig = any;` locally with an `eslint-disable` comment that states the `.d.ts` is missing, but `rocketbuilder.ts` exports the real interfaces. These local aliases should be deleted and the real types imported — small, safe cleanup.
- Non-null assertions (`x!`) are used sparingly (~14 occurrences in `src/core/`) and in every case follow a preceding guard (e.g. `collision.ts:457` guards mass > 0 before `a.mass!` at line 498). This is the correct pattern.
- `as unknown as` only appears twice, both in `perfMonitor.ts:165, 205` for the Chrome-only `performance.memory` API. Justified.

### 4.3 Defensive math

Iteration 17 added `if (!a.mass || a.mass <= 0 …) return;` to `collision._resolveCollision()`. Spot-checking other division sites in core:

- `physics.ts` has guards at the documented lines (1023, 1081, 1127, 1463).
- `collision.ts:498` — now guarded. Good.
- `orbit.ts` — orbital-radius computations assume `r > BODY_RADIUS`, which is always true for orbital states constructed by the codebase itself. No direct guard, but the invariant is structural. Low risk; a `if (r <= 0) return null;` in the lowest-level helper would cost nothing.

### 4.4 Logger usage

- `logger.ts` is the only file with `console.*` calls; the `/* eslint-disable no-console */` at line 5 is correct.
- No stray `console.log` anywhere in `src/` — the ESLint rule does its job.

### 4.5 TODO / FIXME / dead code

Zero `TODO`, `FIXME`, `XXX`, or `HACK` comments in `src/core/`. This is unusual discipline for a codebase this size.

### 4.6 Core test coverage

All 71 core modules were checked against `src/tests/*.test.ts`:

- **Well-covered:** physics (3203 LOC test), missions (2120), saveload (1950), collision, staging, orbit, crew, finance, hubs, contracts, parachute (3 dedicated files: `parachute-deploy`, `parachute-descent`, `parachute-landing`), hub sub-systems (`hubs-crew`, `hubs-tourists`, `hubs-construction`, `hubs-economy`, `hubs-vab`, `hubs-outpost-core`, `hubs-integration`).
- **No dedicated test file** (may be covered implicitly by integration tests):
  - `src/core/constants.ts` — enums only; safe by construction.
  - `src/core/library.ts` (536 LOC) — no direct test; referenced only by `mainStartup.test.ts` and `e2e-infrastructure.test.ts`. This is a real gap; library operations (craft save/load at the domain level) could benefit from a dedicated unit test.
  - `src/core/physicsWorkerProtocol.ts` — protocol types; indirect coverage via `workerBridgeTimeout.test.ts`.
  - `src/core/debugSaves.ts` — debug/dev helpers.
  - `src/core/hubTypes.ts` / `src/core/index.ts` — types/barrels.

**Recommendation:** add `library.test.ts` for craft library round-trips.

---

## 5. Render & UI Layers

### 5.1 PixiJS resource management

- `src/render/pool.ts` (100 LOC) implements a `RendererPool` (`acquire` / `release` / `drain`) for Graphics and Text. `release` calls `.clear()` on Graphics.
- **Real `.destroy()` calls:** present in `src/render/map.ts:289` and `:442` (`_mapRoot.destroy({ children: true })`). So the map scene does clean up children on teardown.
- **Gap:** no `.destroy()` calls visible elsewhere in `src/render/` (flight sub-modules, VAB, hub). The flight scene is long-lived so this is typically fine, but the hub ↔ VAB ↔ flight swap pattern will accumulate unreleased textures/geometry if scenes repeatedly build and tear down without destroying children.
- **Recommendation:** Audit `src/render/vab.ts`, `src/render/hub.ts`, and `src/render/flight/` sub-modules for a teardown hook that destroys children on scene exit. Pool drain + `destroy({ children: true })` on scene root is the pattern already established in `map.ts`.

### 5.2 Listener management

- `src/ui/listenerTracker.ts` exists and is used by `crewAdmin.ts:118`, `topbar.ts:240`, `help.ts:467`, `settings.ts:127`, `debugSaves.ts:45`, plus a VAB-scoped tracker in `vab/_listenerTracker.ts`.
- Many other UI modules still pair raw `addEventListener` with manual `removeEventListener` calls. The paired-removal pattern *is* correct when reviewed (e.g. `flightController/_init.ts:310–311` adds, `:365/369` removes; `flightContextMenu.ts:127,131` adds, `:143,147` removes; `flightHud.ts:204` / `:223`). But:
  - `flightController/_menuActions.ts:75`, `launchPad.ts:631–640`, `library.ts:133` add listeners without a visible central cleanup hook. These are the ones most likely to leak if the panel is destroyed via an unusual path (mid-modal navigation).
- **Recommendation:** Pick one pattern (listener tracker *or* `AbortController`) and migrate remaining panels. Mixed styles are the failure mode, not any individual call site.

### 5.3 Large UI files

- `flightHud.ts` (1573), `topbar.ts` (1328), `hub.ts` (1239), `mainmenu.ts` (871). All are DOM-construction-heavy and broken up internally with section comments. They follow the barrel pattern elsewhere (`flightController`, `vab`, `missionControl`) — these four haven't been split yet and are candidates if work in any of them continues.
- `render/map.ts` (2111) is similarly large but internally well-sectioned (palette, coordinate mapping, per-feature draw functions). Not urgent.

### 5.4 XSS / escaping

- `src/ui/escapeHtml.ts` exists and is used wherever user-authored strings land in HTML (save names in `mainmenu.ts:353–393`, craft names in `library.ts:325`, asteroid renames in `flightController/_mapView.ts:305,327`).
- `innerHTML` assignments elsewhere all use static template literals with numeric values or hard-coded strings (checked in `crewAdmin.ts`, `help.ts`, `flightHud.ts`, `flightController/_docking.ts`). No injection vectors found.

### 5.5 Focus / a11y

- Modals add `aria-modal="true"` / `role="dialog"` / explicit focus on open and focus-restore on close (`hub.ts:204`, `mainmenu.ts:819`, `hubManagement/_panel.ts:79`). The iteration-17 welcome/confirmation work is visible in the code.
- No centralized focus-trap helper — each modal handles trap locally. That's fine for the current scale; only worth centralizing if focus bugs recur.
- `aria-labelledby` / `aria-describedby` are not used; role comes from native elements. Functional, not WCAG-formal.

### 5.6 UI tests

- Dedicated UI unit tests exist: `ui-escapeHtml`, `ui-listenerTracker`, `ui-modalFocus`, `ui-rocketCardUtil`, `ui-vab*` (state/staging/undo), `ui-mapView`, `ui-fpsMonitor`, `ui-timeWarp`, `ui-helpers`, `ui-fcState`, `ui-mcState`.
- **Gap:** no unit tests for `flightHud.ts`, `topbar.ts`, `crewAdmin.ts`, `mainmenu.ts`, `hub.ts`, `library.ts`, `help.ts`, `launchPad.ts`. E2E covers their happy paths but not their internal branches. Testing DOM builders is awkward; at minimum, pulling pure state reducers out of these files and unit-testing those (already done for VAB — `ui-vabState.test.ts`) is the cheapest win.

### 5.7 `window.__*` E2E globals

All test-only globals are declared on `Window` in `main.ts:40–62` and assigned inside the `showMainMenu` ready-callback (`main.ts:107–241`). Render exposes `__pixiApp` (`render/index.ts:31`); VAB exposes `__vabPartsContainer` / `__vabWorldToScreen` (`render/vab.ts:704–705`); fpsMonitor exposes `__perfStats`. All are contained and documented. Not leaking into business logic.

### 5.8 Known layout bug — Surface Ops panel overlaps Flight Left Panel

**Symptom:** When the rocket is landed, the Surface Operations panel (Plant Flag / Collect Sample / Deploy Instrument / Deploy Beacon buttons) renders on top of and occludes the lower portion of the Flight HUD left panel (throttle / staging / fuel column).

**Root cause (geometry + stacking, verified):**

The two panels are siblings inside the same `#flight-hud` container and are positioned into overlapping screen rectangles with no z-index or layout separation between them:

| Element | File:Line | Position | Horizontal span | Vertical |
| --- | --- | --- | --- | --- |
| `#flight-hud-surface` | `flightHud.css:645–655` | `position: absolute; bottom: 10px; left: 70px; max-width: 200px` | 70 → 270 px from left | grows upward from 10 px |
| `#flight-left-panel` | `flightHud.css:17–31` | `position: absolute; left: 58px; bottom: 60px; width: 230px` | 58 → 288 px from left | grows upward from 60 px |

- Horizontal extents fully overlap: surface panel (70–270) sits inside the left-panel range (58–288).
- Vertical extents overlap: the left panel's bottom edge is at 60 px from the bottom of `#flight-hud`; the surface panel grows upward from 10 px, so once the surface panel is taller than ~50 px (always the case when any action button is rendered — a title plus up to four buttons is ~110–170 px), its upper region sits directly on top of the left panel's lower region.
- Neither element sets `z-index`, so CSS stacking falls back to DOM order. In `flightHud.ts:183–188`, `_buildLeftPanel()` is called before `_buildSurfacePanel()`, both appending to `_hud` (lines 316 / 852 / 863). Surface panel is later in the DOM → paints on top of left panel.
- Both panels set `pointer-events: auto` (CSS lines 27, 653), so the overlap also steals clicks from the left-panel controls beneath it.

**Why this only appears when landed:** `_updateSurfacePanel()` in `flightHud.ts:870–916` adds the `hidden` class when `!_ps.landed` (line 875) and removes it when landed (line 879). In flight, the surface panel collapses via `display: none` (CSS line 657), so the overlap is not visible. On touchdown it becomes visible and the collision appears.

**Contributing factor:** The flight left panel's height adapts to content (`max-height: calc(100% - 120px)`). The "120 px" bottom margin was sized around the time-warp panel (centered at `bottom: 10px`) and the altitude tape (`bottom: 60px`, `left: 6px`, `width: 48px` — no horizontal overlap). The surface-ops panel was added later into the same bottom-left zone without carving out space for it.

**Fix candidates (for the next iteration, not this review):**

1. **Reposition** the surface panel out of the left panel's column. Candidates: anchor to the right side (mirror the objectives panel) or place it above the time-warp panel in the bottom center.
2. **Reserve vertical space.** Raise the left panel's bottom anchor (e.g. `bottom: 200px`) while landed, or set `max-height` dynamically to stop above the surface panel's top.
3. **Give the surface panel a different horizontal anchor** (e.g. `right: 10px; bottom: 10px`) so it no longer shares the column with throttle/staging/fuel.

Option 1 (reposition) is the cleanest — the surface-ops button set is naturally a "context-action" panel and belongs beside the objectives panel, not wedged under the telemetry column. Option 2 is the smallest diff but couples two panels' layouts.

**Test gap (also contributing):** `flightHud.ts` has no unit tests and `e2e/` has no spec that asserts the surface panel is visible *and does not visually overlap the left panel when landed*. The geometry regression would have been caught by either (a) a basic bounding-box assertion in an E2E spec that lands the rocket and compares panel rects, or (b) a Playwright visual-regression snapshot of the landed HUD. Recommend adding the bounding-box assertion once the layout fix lands, so this class of regression is guarded going forward.

### 5.9 Known bug — Hub-return auto-save runs without a toast

**Symptom:** After a flight, when the player clicks "Return to Space Agency" on the post-flight summary and is returned to the hub, the subsequent auto-save happens silently — no toast notification appears, even though auto-save is enabled.

**Root cause (dual-trigger + single-toast debounce, verified):**

Two separate call sites trigger an auto-save around the end of a flight:

1. **Post-flight summary is displayed** — `src/ui/flightController/_postFlight.ts:647`:
   ```ts
   if (state) {
     triggerAutoSave(state, 'post-flight');
   }
   ```
   Called at the end of `showPostFlightSummary()`, before the player has clicked anything.
2. **Player returns to the hub** — `src/ui/index.ts:185`:
   ```ts
   if (state) {
     triggerAutoSave(state, 'hub-return');
   }
   ```
   Called at the end of `returnToHubFromFlight()`, after `processFlightReturn()` has applied rewards/penalties.

`triggerAutoSave()` in `src/ui/autoSaveToast.ts:38–45` takes this early-return branch when a toast is already visible:

```ts
export function triggerAutoSave(state: GameState, _trigger?: string): void {
  if (!isAutoSaveEnabled(state)) return;

  // If a toast is already showing, still perform the save — only skip the UI.
  if (_activeToast) {
    void performAutoSave(state);
    return;
  }
  …
}
```

**Timing makes the silent path near-certain.** The post-flight toast's total on-screen lifetime is:
- `AUTO_SAVE_DELAY_MS` = 3000 ms cancel window (`autoSaveToast.ts:19`)
- plus ~1500 ms "✓ Saved" display (`autoSaveToast.ts:114`)
- plus ~300 ms fade-out (`autoSaveToast.css:18`, `autoSaveToast.ts:136`)
- **≈ 4800 ms before `_activeToast` is cleared** (`autoSaveToast.ts:135`).

Any player who reads the summary and clicks "Return to Space Agency" in under ~4.8 s — which is the common case for crashes, short hops, and repeat flights — will cause the hub-return `triggerAutoSave` call to hit the `_activeToast !== null` branch and take the silent `void performAutoSave(state); return;` path. The toast the player is seeing is the *post-flight* one, which fades out on its own schedule; there is no visible indication that a second, separate save happened on hub-return.

**Nothing cancels the pending post-flight save on Return.** The returnBtn click handler (`_postFlight.ts:606–627`) removes the summary overlay and stops the flight scene, but does not call `_cancelPendingAutoSave()` (`autoSaveToast.ts:142–151`). So the original 3 s timer is still alive when the hub-return `triggerAutoSave` fires. The two calls land back-to-back against the same IndexedDB slot.

**Secondary consequences:**

- **Save slot collision.** Both calls route through `performAutoSave()` → `_getAutoSaveKey()` (`autoSave.ts:79–119`). The first call may not have cached `_autoSaveSlotKey` yet when the second call starts scanning, which can briefly race (both scans seeing "no existing auto-save"). The memoization at `autoSave.ts:80` eventually stabilizes and both writes land in the same slot, with the later write winning — harmless, but two full IndexedDB writes for what the player experiences as a single event.
- **State the toast refers to is misleading.** The post-flight toast's "Auto-saving…" spinner appears before Return is clicked, but the save it eventually performs uses the *live* state reference — which `processFlightReturn()` has mutated in between. The toast labeled "post-flight" is actually saving post-return state. Silent hub-return call is redundant.

**Scope of the silent-toast path:** This same "debounce" branch affects any situation where `triggerAutoSave` is called twice within ~4.8 s. Other real call sites: `src/ui/flightController/_loop.ts` and `src/ui/flightController/_menuActions.ts` both import `triggerAutoSave`. If any of those can fire close to either the post-flight or hub-return trigger, they'll hit the same silent path.

**Fix candidates (for the next iteration, not this review):**

1. **Cancel + replace.** On a second `triggerAutoSave()` call while a toast is active, cancel the pending save (`_cancelPendingAutoSave()`-equivalent) and start a fresh toast for the new trigger. Trade-off: player sees two toasts in quick succession.
2. **Queue / reuse.** Keep the same toast DOM, but reset its label to "Auto-saving…" and restart the 3 s timer on a second call. Trade-off: single toast covers both triggers; the player sees the save actually land.
3. **Collapse the two triggers.** Drop the post-flight `triggerAutoSave` entirely and only auto-save on `returnToHubFromFlight`. The post-flight summary is a read-only view; saving its state before the player confirms return is arguably wrong anyway (saves pre-reward state). Simplest fix, but changes observable behaviour for players who expect a save as soon as they land.
4. **Move the hub-return toast into the toast module.** Have the hub-return path call a dedicated `triggerAutoSaveReplace()` that force-cancels any active toast.

Option 3 (remove the post-flight trigger) is the cleanest long-term — the post-flight summary is not a commit point and triggering a save before the player has even seen the outcome is a waste. Option 2 (reset-in-place) is the smallest behavioural change if the product wants to keep both triggers.

**Test gap:** `e2e/auto-save.spec.ts` exists (tagged `@smoke` per iteration 17 work) and covers auto-save round-trip, but nothing asserts that the toast is visible on the hub-return transition specifically. A spec that lands → clicks Return within 1 s → asserts the toast DOM appears would have caught this. Recommend adding it alongside the fix.

---

## 6. Test Codebase

### 6.1 E2E keyboard input discipline

Per user-stated convention, E2E tests must use `window.dispatchEvent(new KeyboardEvent(...))` via `e2e/helpers/_keyboard.ts` (`dispatchKey`) because `page.keyboard.press` is unreliable under parallel workers.

- **`e2e/helpers/_keyboard.ts`** — the helper itself (correct to contain `page.keyboard` references internally).
- **`e2e/keyboard-nav.spec.ts`** — uses `page.keyboard.press` pervasively (lines 29, 40, 43, 47, 54, 64, 88, 114, 147, 152, 156, 186, 206, 228, 245, 287, 310, 324).
- **`e2e/tipping.spec.ts`** — uses `page.keyboard.down('d')` / `up('d')` (lines 35, 40).

**Recommendation:** Migrate these two spec files to `dispatchKey` (or add a hold/release analogue to the helper for `tipping.spec.ts`). Iteration 17's dispatchEvent migration was close to complete but didn't reach these files.

### 6.2 Timing / flakiness

- No `page.waitForTimeout(ms)` calls found in E2E specs. All waits are condition-based (`page.waitForFunction(...)`, `expect.poll(...)`, `expect(...).toBeVisible({ timeout })`). This is the right pattern.
- Iteration 17's `vi.resetModules()` fix to `workerBridgeTimeout.test.ts` is present; the rest of the worker-bridge code path looks clean.

### 6.3 Test independence

- `e2e/fixtures.ts:86–246` provides `freshStartFixture`, `earlyGameFixture`, `midGameFixture`, `orbitalFixture` — each produces a standalone save state via `_saveFactory.ts` and `_state.ts`.
- Spot checks (`asteroid-belt.spec.ts:17–24`, `flight.spec.ts:47–50`) show per-test setup that seeds IDB fresh. No cross-test state leaks observed.
- Playwright config is `fullyParallel: true` with 2 workers (Windows handle cap, per config comment) and 2 CI retries. Sensible.

### 6.4 Vitest config

**`vitest.config.ts` does not exist.** Tests run on Vitest defaults. `src/tests/` files import `describe`, `it`, `expect`, `vi` directly rather than relying on `globals: true`. This works but:
- No central place to set worker count, default timeout, coverage output, or a global setup for things like default logger level.
- Iteration 17 added per-file `logger.setLevel('warn')` in `beforeEach` for `saveload.test.ts`, `autoSave.test.ts`, `storageErrors.test.ts`, `debugMode.test.ts`. A one-line `setupFiles: ['./src/tests/setup.ts']` in a `vitest.config.ts` could set this once for the whole suite.

**Recommendation:** Add `vitest.config.ts` with (a) a setup file that pins `logger.setLevel('warn')` unless a test opts in to debug, (b) explicit worker and timeout caps, (c) coverage configuration (today `test:coverage` uses `@vitest/coverage-v8` but with no config).

### 6.5 Smoke tags & affected tests

- `@smoke` coverage is broad: core-mechanics, flight launch/staging, asteroid belt (11 smoke tests alone), hubs, autoSave, settings, idbStorage, saveload compressed round-trip.
- **Gap:** No smoke test on the mission→finance feedback loop (mission completes → funds awarded) or on the core mission-progression path. These are central game loops and would benefit from at least one smoke.
- `test-map.json` + `scripts/run-affected.mjs` are present and look well-organized. `generate-test-map.mjs` regenerates from imports. No shell-injection risks; cross-platform path handling is via `node:path`.

### 6.6 Weak assertions

`toBeTruthy()` / `toBeFalsy()` / `toBeDefined()` appear 132+ times across 30+ files. Spot-checking, most are intentional "this enum has values" or "this definition exists" style checks on static catalogs (`biomes.test.ts`, `achievements.test.ts`, `bodies.test.ts`). They are not load-bearing assertions on business logic — they're catalog-sanity checks. Acceptable.

### 6.7 Large unit test files

- `physics.test.ts` (3203 LOC) is well-organized with per-subsystem `describe` blocks. Good.
- `missions.test.ts` (2120) and `saveload.test.ts` (1950) are large but sectioned. Not urgent to split.

### 6.8 Setup / teardown

- IDB is mocked or cleared per-test in files that touch it (`saveload.test.ts:67–82`, `autoSave.test.ts:19–39`, `idbStorage.test.ts:33–177`). Patterns match.
- Logger suppression is per-file (iteration-17 work); centralizing into a Vitest setup file is the obvious next step (see 6.4).

---

## 7. Cross-cutting Concerns

### 7.1 Error handling

- **`src/ui/fatalError.ts`** is a single, visible DOM error surface. Wired to IDB-unavailable startup and IDB connection-loss via `registerIdbErrorHandler(showFatalError)` in `main.ts:81`. The generic `main().catch` at `main.ts:246–249` also routes to it. Good.
- `src/core/saveload.ts:35` throws `StorageQuotaError` on quota exceeded; UI can distinguish it from generic failures. Good.
- Only intentional no-op catch found: `src/ui/flightController/_workerBridge.ts:234` during graceful worker shutdown, with an explanatory comment. Not a swallow.
- **Soft gap:** `saveload.ts:345–347` fires a settings sync without awaiting and with a silent catch. Documented ("intentionally not awaited so a settings-sync failure does not block"), but no `logger.warn` on the caught error. If settings sync starts failing systematically, nothing surfaces. Recommend at least `.catch(err => logger.warn('save', 'Settings sync failed', { err }))`.

### 7.2 IndexedDB

- `isIdbAvailable()` is called at the top of `main()` before any other init (`main.ts:70`). Connection-loss errors register a single handler (`main.ts:81` → `registerIdbErrorHandler(showFatalError)`).
- Transactions are correctly scoped (`readonly` vs. `readwrite`) in `idbStorage.ts:110–151`.
- `DB_VERSION = 1`; if a future schema change is needed, there is no upgrade-path code yet — deliberate per the "no save migration during dev" preference in memory.
- **Gap:** no cross-tab coordination (e.g. via `BroadcastChannel`). Two concurrent tabs writing to the same store can stomp on each other. Low priority for a single-player local game, but worth a note.

### 7.3 Worker bridge

- 10-second init timeout in `_workerBridge.ts:104` (and iteration-17's `workerBridgeTimeout.test.ts` is now module-isolated via `vi.resetModules()`).
- Graceful shutdown pattern at `:232–245` (attempts `stop` first, then `terminate`).
- **Gap:** `resyncWorkerState()` at `_workerBridge.ts:152–177` has no timeout. If the worker is hung but not yet detected as such, resync blocks. Adding a `Promise.race` with a short timeout would harden this.

### 7.4 Performance monitoring

- `perfMonitor.ts` uses pre-allocated `Float64Array` circular buffers; aggregation on demand. Zero per-frame allocation when enabled.
- `performance.memory` is Chrome-only and correctly guarded.
- `ui/perfDashboard.ts` and `ui/fpsMonitor.ts` render on demand; they don't poll when hidden.

### 7.5 Settings & save versioning

- `settingsStore.ts:36–37` — schema versioned; `MIGRATIONS` array exists; `mergeWithDefaults()` is forgiving of missing fields and drops unknown ones.
- `saveload.ts:468–472` — strict save-version check; rejects incompatible saves. No migration code. Matches the user preference recorded in auto-memory.

### 7.6 CRC32 / binary envelope

- Standard `0xEDB88320` polynomial; pre-computed lookup table.
- Big-endian writes consistently (`saveload.ts:193–197`, reads at `:704, :711`).
- Header layout documented at `:156–161`: magic(4) + version(2) + crc(4) + length(4) + payload. No off-by-one.

### 7.7 Dependencies

- Runtime: `pixi.js@^8.18.1`, `lz-string@^1.5.0`. Tight, minimal, modern.
- Dev: Vite 8, Vitest 4, Playwright 1.59, TypeScript 6, ESLint 10, typescript-eslint 8. All current-major. No odd pins.

### 7.8 Security

- No `eval`, `new Function(...)`, or dynamic `import(...)` of untrusted strings.
- No `dangerouslySetInnerHTML`; `innerHTML` assignments are all static templates (verified).
- No outbound `fetch`; the game runs entirely against local IndexedDB.
- No secrets / API keys / `.env` files committed.
- `escapeHtml` used at every user-string-into-HTML site checked.

### 7.9 Repo hygiene

- `dist/` is **not tracked** by git (verified: `git ls-files dist/` returns empty; `.gitignore` includes `dist/`). A local build dir exists but is correctly ignored.
- `node_modules/`, `coverage/`, `test-results/` all ignored.
- No `.DS_Store` / `Thumbs.db` in tracked files.

### 7.10 Scripts

- `scripts/run-affected.mjs` uses `execSync` with direct program+args (no shell string concatenation). Reads `test-map.json`, runs only affected specs. Windows-safe via `node:path`.
- `scripts/generate-test-map.mjs` parses imports to regenerate the map; no subprocess calls.

---

## 8. Recommendations (Prioritized)

### High value, low cost

1. **Migrate `e2e/keyboard-nav.spec.ts` and `e2e/tipping.spec.ts` to `dispatchKey`.** The two remaining holdouts after iteration 19's migration work. Unblocks "E2E keyboard must use dispatchEvent" being a hard, codebase-wide invariant.
2. **Add `vitest.config.ts` with a global setup file** that pins `logger.setLevel('warn')` in non-debug tests, sets worker/timeout caps, and configures coverage. Replaces the repeated per-file `beforeEach(logger.setLevel('warn'))` pattern from iteration 17.
3. **Delete `type RocketAssembly = any` / `type StagingConfig = any` in `testFlightBuilder.ts:27–30`**; import the real types from `rocketbuilder.ts`.
4. **Log the swallowed error in `saveload.ts:345–347`** (fire-and-forget settings sync). One-line `.catch(err => logger.warn(...))`.
5. **Add a timeout to `resyncWorkerState()`** in `_workerBridge.ts:152–177`. One `Promise.race` with 5s guard.

### Medium value

6. **Audit `src/render/vab.ts`, `src/render/hub.ts`, `src/render/flight/`** for `.destroy({ children: true })` on scene teardown. `map.ts` already does this at `:289, :442`; align the others.
7. **Pick one listener-management pattern** (the existing `ListenerTracker` or `AbortController`) and migrate the remaining hand-paired add/removeEventListener call sites (notably `flightController/_menuActions.ts:75`, `launchPad.ts:631–640`, `library.ts:133`).
8. **Extract debris handling from `staging.ts`** (approx. lines 756–813) into `src/core/debris.ts`. Clean seam; lifts one concern out of a 1000-line file.
9. **Split `src/core/saveload.ts`** into `saveEncoding.ts` (envelope + CRC + compression + validation) and `saveload.ts` (IDB I/O + export/import DOM helpers). Reduces the blast radius of changes to either side.
10. **Add `library.test.ts`** for craft-library round-trips (currently untested directly).
11. **Add a smoke-tagged E2E test** for the mission→finance feedback loop.

### Lower priority / watch list

12. **`physics.ts` at 2824 LOC.** Extract subsystem ticking (parachutes, legs, power, ejectors) into per-subsystem `tickX(ps, dt)` modules, keeping only the integration loop and dispatcher in `physics.ts`. Large change; only worth doing if active work lands there in the next iteration.
13. **`constants.ts` at 2220 LOC.** Could split topically (flight/body/UI constants), but low yield today.
14. **Unit tests for pure reducer-style state in `flightHud.ts`, `topbar.ts`, `crewAdmin.ts`, `mainmenu.ts`, `hub.ts`.** Extract reducers first (as was done for VAB — see `ui-vabState.test.ts`), then test them. Not required; E2E covers happy paths.
15. **Cross-tab IDB coordination** via `BroadcastChannel` — only if multi-tab becomes a real user scenario.
16. **Add `aria-labelledby` / `aria-describedby`** to modal dialogs if formal a11y becomes a goal.

---

## 9. Things explicitly not found (confirms negative space)

- No `console.log` anywhere in `src/`.
- No `TODO` / `FIXME` / `HACK` comments in `src/core/`.
- No `toMatchSnapshot` / `toMatchInlineSnapshot` in the test suite. (Positive: zero snapshot-rot risk.)
- No silent empty-catch blocks.
- No `eval` / `new Function`.
- No external `fetch` calls.
- No tracked build artifacts, no tracked secrets, no tracked OS cruft.
- No `.js` source files in `src/` despite `allowJs: true` — safe.

---

## 10. Bottom line

This is a well-maintained codebase with the kinds of rough edges that accrete naturally in any project this size: a few modules that should be split, a listener-management convention that isn't fully adopted, a couple of E2E specs that didn't get the latest helper, and the absence of a Vitest config that would let several small duplications collapse into one place. None of these are urgent; all are small; all have an obvious shape. The dominant quality signal is the absence of the usual failure modes — no snapshots, no `any` creep, no stray `console.log`, no silent catches, no architecture drift, no tracked build artifacts. The codebase's invariants are enforced, not just aspired to.
