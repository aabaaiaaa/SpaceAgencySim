# Iteration 19 — Code Review

**Date:** 2026-04-17
**Scope reviewed:** 104 tasks across bug fixes, E2E migration, test infrastructure, high-value cleanups, render teardown, listener unification, core refactors (debris, saveEncoding), full `physics.ts` barrel split + integration-loop refactor, `constants.ts` topical split, UI reducer extraction for five panels, final verification.
**Status before review:** All 104 tasks marked `done`. `VERIFICATION` commit (`664d215`) was run after `TASK-104`.

---

## Executive Summary

Iteration 19 lands cleanly. Every in-scope item in `requirements.md` has a corresponding implementation in the tree. The structural refactors (physics, constants, saveload, staging) preserve public API surface via barrel re-exports — consumer import paths are unchanged. New tests are in place for every newly-seamable module. Final typecheck/lint/build/unit/smoke gates are green per the `TASK-100`–`TASK-104` commit history.

One notable correctness event during verification: the `VERIFICATION` commit partially **reverted** the `keyboard-nav.spec.ts` migration planned by TASK-009/TASK-010. This was the correct call and is discussed below — it is a planning defect, not an implementation defect.

---

## Requirements vs Implementation

### Fully Delivered

| Req § | Deliverable | Evidence |
|------|------------|----------|
| §1.1 | Surface Ops panel reposition | `src/ui/flightHud.css` — `#flight-hud-surface` now uses `right: 260px`. `e2e/flight-hud-surface.spec.ts` asserts non-overlap via `getBoundingClientRect()`. |
| §1.2 | Drop post-flight auto-save trigger | `src/ui/flightController/_postFlight.ts` — no `triggerAutoSave('post-flight')` remains. Hub-return trigger intact at `src/ui/index.ts:201`. Regression test added to `e2e/auto-save.spec.ts`. |
| §2.2 | `dispatchKeyDown`/`dispatchKeyUp` helpers | `e2e/helpers/_keyboard.ts:68–118` exports both; re-exported from the barrel. `e2e/tipping.spec.ts` fully migrated. |
| §3.1 | Vitest config + global setup | `vitest.config.ts` with `setupFiles`, `maxWorkers: 2`, `testTimeout: 10_000`, v8 coverage. `src/tests/setup.ts` pins logger level; per-file `logger.setLevel('warn')` removed from all four target test files. |
| §3.2 | `library.test.ts` | Round-trip coverage present; one `@smoke`-tagged case. |
| §3.3 | Mission→finance smoke E2E | `e2e/mission-finance-loop.spec.ts` added. |
| §4.1 | `any` aliases removed | `src/core/testFlightBuilder.ts` imports real `RocketAssembly`/`StagingConfig` from `rocketbuilder.ts`. |
| §4.2 | Settings-sync observability | `src/core/saveload.ts:285–291` uses `.catch(err => logger.warn(...))`. |
| §4.3 | `resyncWorkerState` timeout | `src/ui/flightController/_workerBridge.ts:169–173` wraps in 5s `Promise.race`. |
| §4.4 | `orbit.ts` `r <= 0` guard | `src/core/orbit.ts:233`. |
| §5.1–§5.3 | Render scene teardown | `src/render/vab.ts:755`, `src/render/hub.ts:178`, and seven `src/render/flight/*.ts` sub-modules all call `.destroy({ children: true })` on teardown. |
| §5.4 | RendererPool drain test | Present. |
| §6.1–§6.3 | Listener tracker migration for `_menuActions`, `launchPad`, `library` | Verified in each file. |
| §6.4–§6.5 | UI listener sweep + test | Migrated in batches; unit test covers lifecycle cleanup. |
| §7.1 | `debris.ts` extraction | `src/core/debris.ts` (141 LOC) owns ID counter + `createDebrisFromParts`. `staging.ts` reduced from 1006 → 903 LOC. `debris.test.ts` added. |
| §7.2 | `saveEncoding.ts` split | `src/core/saveEncoding.ts` (328 LOC) owns CRC32, envelope build/parse, compression wrappers, payload validators. `saveEncoding.test.ts` added. |
| §8 | Full `physics.ts` barrel split + integration-loop refactor | `src/core/physics.ts` is a 25-LOC barrel. Sub-modules: `init`, `integrate` (39 LOC orchestrator), `tick`, `gravity`, `thrust`, `steering`, `docking`, `rcs`, `keyboard`, `capturedBody`, `debrisGround`. Phase modules: `orbitPhase`, `transferPhase`, `capturePhase`, `flightPhase`. `descentPhase` was explicitly optional per task description and correctly folded into `flightPhase`. Focused tests added for `gravity`, `docking`, `thrust`. |
| §9 | `constants.ts` topical split | `src/core/constants.ts` is a 14-LOC barrel. Five topical files (`flight`, `bodies`, `economy`, `gameplay`, `satellites`) total ~2247 LOC. |
| §10.1–§10.5 | UI reducer extraction | All five `_state.ts` files exist with paired unit tests. |
| §11 | `test-map.json` + generator updates | `BARREL_MAP`, `subDirPatterns`, `E2E_SPEC_AREAS` updated. |
| §12 | Final verification | `TASK-100`–`TASK-104` green per commit history (typecheck, lint, build, unit, smoke, affected). |

### Scope Creep
None observed. Every changed source area maps cleanly back to a §1–§11 deliverable.

---

## Code Quality

### Bugs / Logic Errors

**None found in the work delivered.** The verification fixes commit (`664d215`) shows an ongoing discipline to re-run the suite after the large refactors and correct issues — specifically, it reverted TASK-009/TASK-010's migration of `keyboard-nav.spec.ts` back to `page.keyboard.press`.

**Why the revert was correct:** `keyboard-nav.spec.ts` verifies browser-native keyboard **focus traversal** (Tab/Enter/Escape cycling focus through real DOM elements with visible outline rings). Synthetic `window.dispatchEvent(new KeyboardEvent(...))` does **not** trigger browser-native focus traversal; only real driver input via `page.keyboard.press` does. Migrating those 18 call sites broke the tests. The verification fix reverted them.

**Planning defect to note:** Requirements §2.1 blanket-applied the `dispatchKey` rule to all `page.keyboard.press` sites without distinguishing sites that test browser-native focus behavior from sites that test in-app handlers. Future keyboard-migration work should carve out focus-traversal tests as a legitimate exception.

### Error Handling

- **Storage path** — `StorageQuotaError` (from iter-18) is preserved through the `saveload.ts` / `saveEncoding.ts` split. Fire-and-forget settings sync is now observable via `logger.warn`.
- **Worker path** — `resyncWorkerState` now has a 5s timeout, matching the existing 10s init guard. Callers handle the rejection cleanly.
- **Physics path** — `_integrate` dispatcher is small enough to reason about. Phase functions preserve the original thrust→fuel→mass ordering. No new unchecked NaN entry points introduced.
- **Orbit path** — Degenerate `r <= 0` input now returns `null` instead of producing `Infinity`/`NaN`.

### Security
- No new network, eval, or dynamic-code paths introduced. No secrets or credentials in diffs.
- Save encoding is split but remains purely local (IndexedDB); no new data exfiltration surface.

### Minor Observations

1. **Generator stale entry (`scripts/generate-test-map.mjs:244`).** `'src/ui/library.ts'` is still listed in the `SKIP_SOURCES` comment-array ("internal helper"). This is the *UI* `library.ts`, not the *core* `library.ts`. TASK-019 only removed `src/core/library.ts` from the skip list — which is correct. **No gap.** The agent's initial sweep misidentified this; worth documenting for future reviewers.

2. **`physics/integrate.ts` (39 LOC) vs `physics/tick.ts` (144 LOC).** Requirements §8 called for a ≤100-LOC orchestrator. That's split between `integrate.ts` (the dispatcher) and `tick.ts` (pre/post-dispatch work). Combined, they're still far smaller than the original `_integrate` body. The seam is reasonable.

3. **`constants.ts` total line growth.** 2220 → 2247 LOC across 5 files is ~1.2% growth from module boilerplate. Acceptable.

---

## Testing

### Coverage Adequacy

- **New seams have focused tests.** `debris.ts`, `saveEncoding.ts`, every extracted physics sub-module worth testing (`gravity`, `docking`, `thrust`), and all five UI reducers each have a dedicated test file.
- **Regression guards for both bugs.** Surface-ops non-overlap (bounding-box assertion) and hub-return toast visibility (within-1s click timing).
- **Mission→finance smoke E2E** closes the loop between two systems that were previously only unit-tested in isolation.

### Gaps in Test Coverage

- **Keyboard nav spec still uses real driver input.** This is intentional (see above) but means the spec is not protected by the same "unreliable under parallel workers" convention applied elsewhere. Expected flakiness risk: low-to-moderate under `workers > 1`. Consider adding a project-level note in the spec header about why `dispatchKey` is NOT used here.
- **`physics/integrate.ts` dispatcher itself has no direct unit test.** Its behavior is exercised transitively by `physics.test.ts`. For a ~40-LOC orchestrator, this is acceptable; worth revisiting if the dispatcher grows.
- **No end-to-end test for the `debris.ts` / `staging.ts` seam.** The boundary is covered by `staging.test.ts` + new `debris.test.ts` in isolation; a single integration test that drives a full stage activation and asserts debris-ID continuity would close the loop cheaply.
- **No integration test exercises the `physics.ts` barrel surface directly.** `physics.test.ts` still imports from the barrel, which is correct; but adding a minimal "every public export is callable" smoke test would catch future barrel regressions instantly.

---

## Recommendations

Pre-production:

1. **Document the `keyboard-nav.spec.ts` exception.** Add a short header comment explaining why the project-wide `dispatchKey` convention does not apply here, pointing to the verification commit. Prevents future contributors from "fixing" it back.
2. **Amend the project keyboard-migration rule.** Update the convention (memory + any docs) to explicitly carve out browser-native focus-traversal tests. Today's rule is "always migrate," which this iteration proved is wrong.
3. **Smoke-run under parallel workers.** `vitest.config.ts` pins `maxWorkers: 2`; confirm the new test files are robust under that setting (flakes tend to surface at worker count ≥ 2).
4. **Double-check `descentPhase` fold decision.** Requirements §8 listed `descentPhase.ts` as "if distinct." The current tree folds descent into `flightPhase`. If re-entry physics grows (heat shields, deployable drogue chutes, etc.), revisit the split before `flightPhase.ts` bloats.
5. **Add a dispatcher smoke test.** One test per physics phase that asserts `_integrate` calls the expected phase function for each `FlightPhase` enum value. Cheap insurance against future phase additions silently dispatching to the wrong branch.

---

## Future Considerations

### Next-iteration candidates

- **`flightHud.ts` and `topbar.ts` full barrel split.** Iteration 19 extracted reducers only (DOM code stayed monolithic). Both files remain large; the reducer seam makes a follow-up barrel split easier now.
- **UI listener audit tooling.** The listener-tracker migration is complete, but a lint rule (custom ESLint plugin) that flags raw `addEventListener` in `src/ui/` would prevent regressions without relying on grep sweeps each iteration.
- **Save-version migration framework.** Still deferred ("no save migration during dev"). Will need to land before any public beta.
- **Toast accessibility (aria-live).** Deferred again; worth bundling with a broader modal-accessibility pass (focus restoration from iter-18 plus `aria-labelledby`/`aria-describedby`).
- **`AbortController` listener pattern.** Not needed today — `ListenerTracker` works. Worth revisiting only if a future iteration has a compelling reason (e.g., cross-module listener groups that naturally share an abort signal).

### Architectural decisions to revisit

- **Barrel re-exports as the only split pattern.** It has worked cleanly through five large splits (`flightController`, `vab`, `missionControl`, `flight`, now `physics` + `constants`). Keep. The one risk is that barrels can hide cyclic dependency growth between sub-modules — consider a madge/depcruise check in CI before the project grows 2× more.
- **Topical constants split.** Five files is a sensible size today; `economy.ts` at 755 LOC is the largest and the most likely to need its own sub-split (facilities vs finance vs contracts) in the next year.
- **Phase-per-module physics.** Correct choice — each phase has distinct gravity/atmosphere/thrust assumptions. Re-evaluate if phases start sharing >50% of their body with helper calls; at that point, flatten back into shared helpers + a thin dispatcher.
- **UI reducer pattern.** The VAB-style `_state.ts` is lightweight and testable but does not enforce one-way data flow — callers can still drift back to direct mutation. A stricter pattern (Zustand-style store, Redux-style actions) is overkill today but worth revisiting if UI state bugs become a recurring theme.

### Technical debt introduced

Minimal. Items worth tracking:

- **`physics/tick.ts` (144 LOC).** Not itself a phase — contains pre/post-dispatch work. Candidate for further decomposition if it grows.
- **`physics/integrate.ts` dispatcher has no dedicated test.** Transitively covered; formalize if the dispatcher becomes non-trivial.
- **Generator vs `test-map.json` drift.** The knob-driven generator requires coordinated edits to `BARREL_MAP`, `SOURCE_GROUPS`, `SKIP_SOURCES`, `subDirPatterns`, `E2E_SPEC_AREAS`. Each new structural split needs all five considered. Consider a CI check that runs `test-map:generate` and fails if the committed `test-map.json` differs.
- **Large iteration size (104 tasks).** Landed cleanly, but the verification step caught a real regression (keyboard-nav). Smaller iterations reduce the verification surface and make per-commit bisection cheaper.

---

## Verdict

**Ship it.** All requirements met, regressions caught and corrected during verification, no latent bugs identified in the delivered work. The planning defect (keyboard migration overreach) is worth capturing as a lesson but does not block integration. Recommended follow-ups are nice-to-have, not gating.
