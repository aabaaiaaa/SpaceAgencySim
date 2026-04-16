# Iteration 18 — Correctness, Robustness & Listener Hygiene

**Date:** 2026-04-16
**Scope:** Persistence robustness, UI layering violations, listener leaks, physics correctness bugs, drag-math extraction, E2E keyboard migration, small hygiene items
**Builds on:** Iteration 17 (flaky test fix, IDB-unavailable startup, collision guards, preview layout extraction)
**Driven by:** Fresh code review conducted 2026-04-16 (no prior review doc referenced)

---

## Motivation

A fresh review of the codebase surfaced six verified bug-class or robustness issues, plus several hygiene items that have been outstanding across iterations. The suite is healthy overall — build, typecheck, lint, and all 4,561 unit tests pass — but the following items are user-visible risks or architectural violations that are cheap to fix now and get more expensive the longer they linger.

This iteration is intentionally broad (~17 tasks) because the items are independent and each is small. The user has explicitly opted in to a large iteration.

---

## 1. Persistence Robustness

### 1.1 QuotaExceededError Handling

**Locations:**
- `src/core/saveload.ts:349` — `await idbSet(key, compressed)` in `saveGame()`
- `src/core/settingsStore.ts:202` — `await idbSet(...)` in `saveSettings()`
- `src/core/autoSave.ts:150` — already wrapped in try/catch (correct pattern, but does not distinguish quota)

**Problem:** When IndexedDB storage quota is exceeded (mobile browsers with aggressive eviction, users with many large saves, enterprise-restricted storage), the `idbSet` call throws `QuotaExceededError`. In `saveload.ts` and `settingsStore.ts`, the error is unhandled — it propagates to the caller and typically ends in an unhandled promise rejection or, for the save path invoked from the UI, an uncaught exception that leaves the player with no indication that their save failed.

**Fix:** Wrap both `idbSet` calls in try/catch. Detect `QuotaExceededError` by name (`err.name === 'QuotaExceededError'`) and re-throw as a typed error (e.g. `StorageQuotaError`) that the UI caller can catch and surface via the existing notification or fatal-error mechanism. For other errors (connection lost, permission denied), log and re-throw so the startup-registered `showFatalError` handler can take over.

The autoSave path already catches errors and logs them — it's the correct template, but the distinction between "quota exceeded" (user-actionable: delete saves) and "unknown failure" (fatal) is not currently made. Upgrade the autoSave handler to also surface a user-visible "Save storage full — consider deleting old saves" message rather than only logging.

### 1.2 Fire-and-Forget saveSettings During Save

**Location:** `src/core/saveload.ts:320–328`

**Problem:** `saveGame()` currently fires off `void saveSettings(...)` without awaiting or handling errors. The comment at line 320 admits this is intentional ("Best-effort fire-and-forget"). However, if the settings write fails (quota, connection lost), the user sees the main save succeed while their settings silently fail to persist — on next load, their difficulty/debug/autosave settings revert.

**Fix:** Replace `void saveSettings(...)` with a variant that doesn't block the main save's success, but DOES propagate/surface write failures through a dedicated error path (e.g. `.catch(err => logger.warn('save', 'Settings sync failed during save', err))` or better, a user-visible toast via the existing notification system). The main save should still succeed if the settings sync fails — those are conceptually separate writes — but the failure must not be invisible.

### 1.3 Tests

Add unit tests that simulate `QuotaExceededError` from `idbSet` and verify:
- `saveGame()` surfaces the error in a way the UI can act on
- `saveSettings()` called standalone surfaces the error
- `saveSettings()` called from within `saveGame()` does not kill the main save but logs/surfaces the settings failure

---

## 2. UI Layering & Listener Hygiene

### 2.1 Throttle Key Routing Through Core

**Location:** `src/ui/flightHud.ts:192–208` (X/Z key handler)

**Problem:** The keydown handler for X (throttle zero) and Z (throttle max) directly mutates `_ps.throttle` and `_ps.targetTWR` from the UI layer. This violates the project's stated layering (CLAUDE.md: "UI layer calls core functions, then triggers re-renders — it does not manipulate state directly"). The rest of the flight loop correctly routes input through `physics.handleKeyDown()`; X/Z are the outliers.

**Fix:** Add a small core helper (e.g. `setThrottleInstant(ps, value)` in `src/core/physics.ts` or a new `src/core/throttleControl.ts`) that encapsulates "set throttle to value; in TWR mode also set targetTWR to the matching extreme". Call this helper from the flightHud key handler. No behaviour change — purely a layering correction.

Add a unit test for the helper. Leave the existing `markThrottleDirty()` call in the UI — that's UI state, correctly placed.

### 2.2 VAB Keyboard Listener Cleanup

**Location:** `src/ui/vab/_panels.ts:354, 373, 396`

**Problem:** Three bare `window.addEventListener('keydown', ...)` calls (delete/backspace handler, undo/redo handler, spacebar handler) are registered on VAB open but never removed. Each time the player opens VAB, three new listeners accumulate. Over a session this can cause duplicate handler invocation and memory pressure.

**Fix:** Route these registrations through the existing `listenerTracker` (`src/ui/listenerTracker.ts`) which is already used consistently by `topbar.ts` and `crewAdmin.ts`. The tracker has `add(target, type, handler)` and `removeAll()` semantics — on VAB destroy, the tracker clears everything.

If the VAB's init/destroy lifecycle doesn't currently create a tracker instance, do so and plumb it through `_panels.ts`. Mirror the pattern in `crewAdmin.ts` for consistency.

### 2.3 VAB Canvas Listener Cleanup

**Location:** `src/ui/vab/_canvasInteraction.ts:300, 381–383, 716–793`

**Problem:** Canvas pointerdown/pointermove/pointercancel/contextmenu/wheel listeners are registered directly via `addEventListener` with no cleanup on VAB destroy. Additionally line 300 adds a `document.addEventListener('pointerdown', ...)` and lines 381–383 add `window.addEventListener('pointermove/pointerup/pointercancel', ...)` inside a drag-start flow; these window listeners ARE removed on `onDragEnd`, but if drag-end never fires (app crash, modal appears mid-drag, user closes VAB mid-drag), they leak.

**Fix:** Use the same `listenerTracker` introduced in 2.2 for all `_canvasInteraction.ts` window/document listeners. For the drag-flow listeners, keep the current removal-on-drag-end behaviour BUT also register them with the tracker so that a VAB destroy mid-drag cleans them up.

### 2.4 Tests

Add a unit test that simulates VAB init → add listeners → destroy → verify all window/document listeners are removed. The test can track listener registration via a small mock of `window.addEventListener`/`removeEventListener` or by using JSDOM's listener introspection.

---

## 3. Physics Correctness

### 3.1 Body-Aware Docking Radius

**Location:** `src/core/physics.ts:1827`

**Problem:** The docking radial-out check uses a hardcoded `6_371_000` (Earth's radius in metres) to orient the radial vector away from the body:

```typescript
const radCheck: number = radOutX * ps.posX + radOutY * (ps.posY + 6_371_000);
```

On any non-Earth body (Mun, Duna, etc.), this computes a check against a wrong origin, flipping the radial direction incorrectly. The bug manifests as W/S keys producing reversed radial thrust near other bodies.

**Fix:** Look up the body's radius from `BODY_RADIUS` (in `src/core/constants.ts` or `src/data/bodies.ts`) using the current body id. If the current body id isn't available in this scope, thread it through — it must be knowable since physics is always relative to a current reference body. Fall back to `6_371_000` only if the body id is genuinely unknown, and log a warning.

Add a unit test that exercises the radial-check code with a non-Earth body and asserts the correct sign.

### 3.2 NaN Guard on Debris Angular Velocity

**Location:** `src/core/staging.ts:870`

**Problem:**

```typescript
angularVelocity: (ps.angularVelocity ?? 0) + (Math.random() - 0.5) * 0.3,
```

The `??` operator only catches `null` and `undefined` — NOT `NaN`. If `ps.angularVelocity` has become `NaN` upstream (e.g. from a numerical instability elsewhere), the debris inherits `NaN` rotation, which silently corrupts all subsequent physics involving that debris.

**Fix:** Replace `(ps.angularVelocity ?? 0)` with `(Number.isFinite(ps.angularVelocity) ? ps.angularVelocity : 0)`. Also grep the codebase for other `?? 0` patterns on numeric fields that could be NaN (e.g. `??` on velocities, angles, forces) and convert to `Number.isFinite` guards where the source could plausibly be NaN.

Add a unit test: pass a `ps` with `angularVelocity: NaN` into the staging path and assert the resulting debris has a finite `angularVelocity`.

### 3.3 Flight Lifecycle Global State Reset

**Locations:**
- `src/core/collision.ts:170` — `_asteroidCollisionCooldowns` (a module-level `Map`)
- `src/core/staging.ts:73` — `_debrisNextId` (a module-level counter)

**Problem:** These module-scoped variables persist across flights. The existing `resetAsteroidCollisionCooldowns()` function (collision.ts:~848) is correctly exported but there's no guarantee every flight-start/flight-abort code path calls it. `_debrisNextId` has no reset function at all.

The symptom for `_asteroidCollisionCooldowns`: if the player collides with an asteroid, aborts the flight, and starts a new one, the cooldown from the old flight can carry over, granting temporary asteroid immunity. The symptom for `_debrisNextId`: debris IDs grow monotonically over the session — a long-lived session has surprisingly large IDs, and any consumer assuming bounded ID ranges could misbehave.

**Fix:**
- Add `resetDebrisIdCounter()` in `staging.ts` and export it
- Identify every flight-start and flight-abort path (likely in `src/ui/flightController/` and `src/ui/launchPad.ts`) and ensure both reset functions are called
- Consider consolidating into a single `resetFlightState()` in a new or existing module that callers can invoke; this avoids the "forgot to reset X" class of bug going forward

Unit test: simulate two sequential flights, verify cooldowns and debris IDs are reset between them.

### 3.4 Drag-Coefficient Math Extraction

**Locations:**
- `src/core/physics.ts:1660–1702` — `_computeDragForce` (part-level drag computation)
- `src/core/staging.ts:946–974` — `_debrisDrag` (debris drag computation)

**Problem:** Both functions do essentially the same math: look up the part's drag coefficient, scale by parachute deploy progress if applicable, multiply by atmospheric density, square speed. The code has diverged slightly over time and will continue to diverge without shared infrastructure.

**Fix:** Extract the pure per-part CdA (drag coefficient × area) computation to a new core module (e.g. `src/core/dragCoefficient.ts`) exporting a function like:

```typescript
export function computePartCdA(
  def: PartDef,
  deployProgress: number | null,
  atmosphereDensity: number,
): number
```

Have both `physics.ts` and `staging.ts` call this helper. Keep the parachute interpolation logic inside the helper — it's the bulk of the duplication. The per-frame force application (summing forces, applying to body) stays in its respective caller.

Add comprehensive unit tests for the extracted function: non-parachute parts, undeployed parachute, partially-deployed parachute, fully-deployed parachute, zero-density atmosphere.

---

## 4. E2E Keyboard Migration

**Location:** 12 Playwright specs use `page.keyboard.press` (58 call sites). The project owner has a standing preference (stored in agent memory) for `window.dispatchEvent` in E2E keyboard interactions because `page.keyboard.press` is unreliable under parallel Playwright workers.

**Problem:** Specs using `page.keyboard.press` are at elevated flakiness risk. The workaround is to dispatch the event directly into the page via `page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'X' })))`. Existing helpers in `e2e/helpers/` may already have a utility for this — if so, migrate call sites to use the helper; if not, add one.

**Fix:** Split across 2–3 tasks (the migration is mechanical but spread across many files). First task: inventory the 12 specs, add or confirm a helper in `e2e/helpers/` for dispatching keyboard events. Second and third tasks: perform the migration in batches of specs, keeping behaviour identical.

Verification: rerun the migrated specs only (not the full E2E suite, per standing preference) and confirm they still pass.

---

## 5. Small Hygiene Items

### 5.1 Modal Focus Management

**Locations:**
- `src/ui/hub.ts` — welcome modal (approx line 198)
- `src/ui/mainmenu.ts` — save-confirm modals (approx line 198)

**Problem:** When these modals open, no element is programmatically focused. Keyboard-only users must tab into the modal; screen-reader users may not notice the modal appeared. Additionally, there's no focus restoration when the modal closes.

**Fix:** On modal open, call `.focus()` on the primary action button (confirm/dismiss). On close, restore focus to the element that had focus when the modal opened (save a reference in the modal's open handler). This is a small, low-risk UX improvement.

### 5.2 Logger Consistency

**Location:** `src/core/settingsStore.ts:273`

**Problem:** One `console.warn()` call slipped through; the rest of the codebase uses the structured `logger.warn()` helper. Consistency matters because log aggregation and level-based suppression (used in tests) only apply to `logger.*` calls.

**Fix:** Replace with `logger.warn('settings', '...', {...})`.

---

## 6. Final Verification

After all tasks: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, and `npm run test:smoke:unit` must all pass with zero errors. Additionally, a targeted run of the migrated E2E specs (not the full suite — per standing preference) to confirm keyboard migration didn't break anything.

---

## Testing Strategy

| Area | What Changes |
|------|-------------|
| `saveload.test.ts` | New tests for QuotaExceededError propagation and saveSettings-during-save failure handling |
| `settingsStore.test.ts` | New test for quota error path |
| `autoSave.test.ts` | New test for quota-specific user message vs generic failure |
| `physics.test.ts` (or new `throttleControl.test.ts`) | Unit test for the new throttle helper |
| `vab*.test.ts` (new or existing) | Listener-cleanup test on VAB destroy |
| `physics.test.ts` | Body-aware docking radius test |
| `staging.test.ts` or `collision.test.ts` | NaN guard test; flight-lifecycle reset test |
| `dragCoefficient.test.ts` (new) | Parachute interpolation + density tests for the extracted helper |
| Migrated E2E specs | Rerun to confirm migration is behaviour-preserving |

---

## Technical Decisions

- **Error typing over error codes.** QuotaExceededError is detected by `err.name` rather than a custom code, matching the Web IDL spec and keeping the detection portable.
- **Extract over annotate.** The drag-coefficient duplication is fixed by extraction (new module) rather than by adding TODOs — the review history shows extraction candidates compound over iterations.
- **Listener tracker over ad-hoc cleanup.** Rather than remembering listener references in each panel, use the existing `listenerTracker` consistently. This continues the pattern already present in `topbar.ts` and `crewAdmin.ts`.
- **No save migration framework this iteration.** Per standing preference (user memory: "no save migration during dev"), the save-version-mismatch fatality is left as-is. Saves remain conceptually disposable during the development phase.
- **No toast accessibility this iteration.** Explicitly deferred by the user for this iteration; may appear in a later iteration.
- **Drop previously flagged "no tests" items.** The review's initial sweep identified `designLibrary`, `controlMode`, `undoRedo`, `grabbing`, `previewLayout` as untested — verification showed tests for all five already exist. No work needed.

---

## Scope Boundary

**Out of scope:**
- Save-version migration framework
- Toast aria-live / role=alert
- Full physics.ts or flightHud.ts refactor (3000-line files noted; too large for this iteration)
- IDB reconnect logic (`registerIdbErrorHandler` already surfaces the failure)
- Any new gameplay features
