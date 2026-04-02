# Iteration 2 Code Review Report

**Date:** 2026-04-02
**Scope:** Code quality, resilience, test coverage, and UX improvements (Iteration 2)
**Codebase:** ~66,500 lines of source across 150+ files
**Test Suite:** 2,550 unit tests, 608 E2E tests across 33 specs

---

## Requirements vs Implementation

### All 28 Tasks Completed

All tasks in `tasks.md` are marked `done`. Below is a per-requirement verification with gaps noted.

| Requirement | Task(s) | Status | Notes |
|---|---|---|---|
| 1.1 localStorage quota handling | TASK-001 | Implemented | `saveload.js` and `designLibrary.js` both wrap `setItem` in try-catch for `QuotaExceededError` |
| 1.2 Silent error swallowing | TASK-001 | Implemented | `console.warn()` added to `designLibrary.js` catch blocks |
| 1.3 Flight HUD RAF crash recovery | TASK-002 | Implemented | `flightHud.js:1621-1645` has try-catch with consecutive error tracking and abort banner |
| 1.4 Flight phase transition comment | TASK-003 | Implemented | Comment present at `flightPhase.js:222-230` |
| 1.5 Timer stacking in debugSaves | TASK-004 | Implemented | `clearTimeout` before new timeout |
| 2.1 Event listener cleanup | TASK-006 | Implemented | `listenerTracker.js` created and used in help, settings, debugSaves, topbar |
| 2.2 Style element accumulation | TASK-007 | Implemented | `injectStyleOnce()` in `injectStyle.js` with ID-based dedup |
| 3.1 Tutorial mission blocking indicators | TASK-008 | Implemented | Data-driven indicators in Tutorial mode only |
| 3.2 Weather display consistency | TASK-009 | Implemented | Standardised to compact format |
| 4.1 PixiJS object pooling | TASK-010 | Implemented | `_pool.js` with `acquireGraphics/Text`, used consistently in all 5 flight render modules |
| 4.2 Hit testing optimisation | TASK-011 | Implemented | Spatial grid with bounding-box pre-filtering in `_rocket.js:478-688` |
| 4.3 Mission/contract Map lookups | TASK-012 | Implemented | `MISSIONS_BY_ID` and `CONTRACT_TEMPLATES_BY_ID` Maps exported |
| 5.1 Unit tests for untested modules | TASK-013-017 | Implemented | flightReturn, sciencemodule, customChallenges, designLibrary, parachute-deploy all have test files |
| 5.2 E2E teleport + time warp overhaul | TASK-018-020 | Implemented | `__testSetTimeWarp` API, velocity-aware teleport, phase-transitions.spec.js |
| 5.3 Replace waitForTimeout | TASK-021 | Implemented | Zero `waitForTimeout` calls remain in E2E specs |
| 5.4 E2E failure-path tests | TASK-022 | Implemented | failure-paths.spec.js covers malfunction, crew KIA, contract expiry, bankruptcy |
| 5.5 Vitest coverage | TASK-023-024 | Implemented | v8 provider, thresholds: 91% lines, 89% functions |
| 6.1 ESLint rules | TASK-025 | Implemented | `no-console` error (allow warn/error), `no-floating-promises`, `no-misused-promises` |
| 6.2 Node.js engines field | TASK-026 | Implemented | `"node": ">=20.0.0"` in package.json |
| 7.1 TypeScript TODOs | TASK-027 | Implemented | Zero TODO/FIXME comments remain in TS files |
| 9. Verification pass | TASK-028 | Implemented | typecheck, lint, unit, E2E all passing |

### Gaps and Partial Implementations

**1. Branch coverage threshold is 78%, below the stated 80% target (Req 5.5)**

`vite.config.js:50` sets `branches: 78`. The requirements state "80% threshold for lines, branches, and functions." Lines (91%) and functions (89%) exceed the target, but branches fall 2 points short. This may have been a deliberate trade-off documented in TASK-024 ("raise thresholds to match or slightly exceed actual coverage"), but it does not meet the original spec.

**2. Main flight controller RAF loop has no error handling**

The requirement (1.3) specifies "The flight HUD's requestAnimationFrame loop." This was implemented in `flightHud.js:1621-1645` (the HUD display loop). However, the main flight controller loop in `flightController/_loop.js:58-158` — which calls physics tick, phase evaluation, rendering, and objective checks — has no try-catch at all. If physics throws (NaN propagation, invalid state), the entire game loop silently stops. The HUD loop is a secondary display loop; the primary simulation loop is unprotected.

**3. Input validation requirement (Req 8.1) has no dedicated task**

Requirement 8.1 specifies player string length validation with "reasonable max-length constraints (e.g., 40-50 characters for names) with visible character counters or truncation." Implementation exists but only via HTML `maxlength` attributes:
- Agency name: 48 chars (`mainmenu.js`)
- Crew name: 60 chars (`crewAdmin.js`)
- Design name: 60 chars (`vab/_designLibrary.js`)

No character counters or truncation feedback were added. No dedicated task was created for this requirement.

### Scope Creep

**None detected.** The implementation tightly follows the requirements without adding unrequested features.

---

## Code Quality

### Critical Issues

**1. Orbital mechanics: synodic period near-zero denominator (`orbit.ts:648`)**

```typescript
const T_syn = Math.abs(T_craft * T_target / (T_craft - T_target));
```

When `T_craft` and `T_target` are nearly equal but `periodDiff >= 0.01`, the denominator can be very small, producing an extremely large `T_syn`. The hard cap at line 652 (`Math.min(maxSearchTime, 365.25 * 24 * 3600)`) mitigates the Infinity case, but the search could still run for up to a year of simulated time with tiny step sizes, causing a long freeze. The guard at line 642 only handles `periodDiff < 0.01`, leaving a gap where `0.01 <= periodDiff < ~0.1` produces multi-month search durations.

**2. Orbital mechanics: unguarded `sqrt(1 - e*e)` (`orbit.ts:169, 186`)**

`meanAnomalyToTrue()` and `trueToEccentricAnomaly()` both compute `Math.sqrt(1 - e * e)` without verifying `e < 1`. The caller `computeOrbitalElements()` rejects unbound orbits at line 243 (`epsilon >= 0 return null`), and line 252 clamps eSquared with `Math.max(0, ...)`. However, these anomaly conversion functions are public exports — any external caller passing `e >= 1` would get NaN propagation. Defensive clamping on the sqrt argument would be safer.

**3. `designLibrary.js:204` assumes `state.savedDesigns` is always an array**

`saveDesignToLibrary()` calls `state.savedDesigns.findIndex(...)` without a null guard. While `createGameState()` in `gameState.ts:733` initialises `savedDesigns: []`, a corrupted save loaded without the migration path (or external state manipulation) could leave it undefined.

### Minor Issues

**4. `flightReturn.js:292` — unsafe `state.crew.find()` access**

No null guard on `state.crew` before calling `.find()`. A corrupted or incomplete state object would throw TypeError.

**5. No save format version field (`saveload.js`)**

Save envelopes contain `saveName`, `timestamp`, and `state` but no schema version. The migration logic at load time (lines 254-300) handles missing fields with `??=` defaults, but a version field would allow explicit migration paths and detect incompatible save formats.

**6. `dockingTargetGfx` created outside pool (`render/flight/_debris.js:85`)**

A `PIXI.Graphics` object is created directly rather than through the pool system, potentially bypassing cleanup on renderer destroy.

### Good Patterns Observed

- Three-layer architecture (core/render/UI) is consistently respected. No render-layer mutations of game state detected.
- HTML escaping (`_escapeHtml()`) applied to user-supplied strings before innerHTML insertion.
- `textContent` used instead of `innerHTML` in most user-facing text assignments.
- Immutable data catalogs (`Object.freeze()`) in the data layer.
- Idempotent style injection prevents CSS accumulation.
- Listener tracker pattern enables clean panel lifecycle management.

---

## Testing

### Unit Tests — Excellent

- **2,550 tests** across 58 test files covering all core modules.
- Test quality is high: factory functions for fixtures, proper state isolation with `beforeEach`/`afterEach`, edge case coverage (null inputs, validation errors, round-trip serialization).
- `storageErrors.test.js` specifically tests `QuotaExceededError` with mocked localStorage.
- `flightReturn.test.js` covers mission completion, objective validation, part recovery, crew recovery, and financial transactions.

### E2E Tests — Excellent

- **608 tests** across 33 spec files including dedicated `phase-transitions.spec.js` and `failure-paths.spec.js`.
- Zero `waitForTimeout` calls — all waits are condition-based (`waitForFunction`, `waitForSelector`).
- Teleport helper properly upgraded to set position + velocity without manually setting phase or orbital elements.
- Programmatic time warp API enables fast physics-based testing.

### Coverage Configuration

- v8 provider configured correctly.
- Thresholds: **91% lines, 78% branches, 89% functions**.
- `debugSaves.js` and `library.js` reasonably excluded from coverage.

### Untested Areas and Edge Cases

1. **Main flight controller loop failure modes** — No tests verify what happens when `tick()` throws mid-frame in the controller loop (as opposed to the HUD loop which is protected).

2. **Save migration edge cases** — The `loadGame()` migration logic (lines 254-300) handles many edge cases, but there are no unit tests for:
   - Loading a save with `savedDesigns: null` (vs missing/undefined)
   - Loading a save where `saveSharedLibrary()` throws during migration (line 283)
   - Loading a save with invalid `malfunctionMode` values

3. **Orbital edge cases** — No unit tests for the synodic period calculation when `T_craft ≈ T_target` (the near-zero denominator case).

4. **Design library with uninitialised `state.savedDesigns`** — No test covers calling `saveDesignToLibrary()` when `state.savedDesigns` is undefined.

---

## Security

**No significant security concerns.** This is a single-player browser game with no server-side component, no authentication, and no network communication beyond loading static assets.

- User input (agency names, crew names, design names) is HTML-escaped before DOM insertion via `_escapeHtml()`.
- No `eval()`, `Function()`, or `new Function()` usage detected.
- `textContent` used for safe text rendering in most cases.
- `innerHTML` usage reviewed — all instances use either static templates or escaped/numeric values.
- `maxlength` attributes on input fields prevent extreme-length inputs.

---

## Recommendations

### Must Fix Before Production

1. **Add try-catch to the main flight controller loop** (`flightController/_loop.js:58-158`). The HUD loop has error recovery, but the primary simulation loop does not. A physics exception silently kills the game with no recovery path. Wrap the loop body (physics tick through render) in try-catch with a consecutive error counter and abort-to-hub fallback, matching the pattern in `flightHud.js`.

2. **Raise branch coverage threshold to 80%** or document the rationale for accepting 78%. The requirements specify 80% for all three metrics.

### Should Fix

3. **Add defensive guards to `designLibrary.js:204`** — `if (!Array.isArray(state.savedDesigns)) state.savedDesigns = [];` before accessing `.findIndex()` and `.filter()`.

4. **Clamp `sqrt(1 - e*e)` arguments in orbital functions** — Add `Math.max(0, 1 - e * e)` before the square root in `meanAnomalyToTrue()` and `trueToEccentricAnomaly()` to prevent NaN from floating-point eccentricity values slightly exceeding 1.0.

5. **Cap effective synodic search duration** — In the warp-to-target search (`orbit.ts:648`), add a `Number.isFinite(T_syn)` check and fall back to `Math.max(T_craft, T_target)` if the synodic period is unreasonably large (not just infinite).

6. **Add null guard to `flightReturn.js:292`** — Use `(state.crew ?? []).find(...)` to prevent TypeError on corrupted state.

### Nice to Have

7. **Add a save format version field** to the save envelope in `saveload.js`. Current migration works via `??=` defaults, but a version number would enable explicit migration logic for breaking changes.

8. **Add character counter feedback** to name input fields (agency, crew, design) per Requirement 8.1. The `maxlength` attributes are set but users get no visual feedback about remaining characters.

9. **Add unit tests for save migration edge cases** — corrupted `savedDesigns`, failed `saveSharedLibrary()` during migration, invalid `malfunctionMode` enum values.

---

## Future Considerations

### Features and Improvements

1. **Accessibility** — No ARIA attributes, keyboard navigation, or screen reader support detected in the UI layer. As the game matures, adding basic accessibility (focus management, ARIA labels on interactive elements, keyboard-navigable menus) would broaden the player base.

2. **Undo/redo in VAB** — The Vehicle Assembly Building has no undo capability. For complex rocket designs, this is a significant UX gap.

3. **Performance monitoring** — The object pooling and spatial grid optimisations are well-implemented, but there's no runtime performance monitoring. A lightweight FPS counter or frame-time tracker (debug-mode only) would help identify regressions.

4. **Automated save backups** — With localStorage as the only persistence layer, a single corruption event loses all progress. Consider periodic backup to IndexedDB or offering a file-based export on every save.

### Architectural Decisions to Revisit

1. **localStorage as sole persistence** — localStorage has a ~5-10MB quota depending on browser. With extensive saves, design libraries, and potentially large state objects, this will eventually hit limits. IndexedDB offers much higher quotas and structured storage. The `QuotaExceededError` handling added in this iteration is a good stopgap, but migration to IndexedDB should be planned.

2. **Gradual TypeScript migration** — Only 4 of ~50 core/data modules are TypeScript. The `jsToTsResolve` Vite plugin enables incremental migration, and the TypeScript config is well-set-up. Prioritise converting `flightPhase.js`, `flightReturn.js`, and `missions.js` next — these are the most complex modules with the most cross-module interaction.

3. **Render layer coupling** — The render layer reads game state directly (by reference) rather than receiving serialised snapshots. This works for a single-threaded game but would block future optimisations like Web Worker-based physics. Consider introducing a state snapshot interface between core and render.

4. **CSS-in-JS vs stylesheet** — All CSS is injected via JavaScript template literals in UI modules. The `design-tokens.js` system provides consistency, but the approach means CSS isn't cacheable, isn't inspectable in devtools source maps, and adds ~10KB of JS per module. As the project grows, migrating to actual `.css` files with CSS custom properties (matching the token values) would improve debuggability and load performance.

### Technical Debt

1. **Mixed JS/TS codebase** — The 4 TypeScript files are clean, but the remaining ~46 core/data modules rely on JSDoc for type safety. JSDoc types are less rigorous than TypeScript interfaces and harder to refactor. Each module converted to TypeScript reduces the risk of type-related bugs.

2. **Inline styles in error/modal UI** — `flightHud.js:1656-1658`, `_showErrorBanner()`, and similar runtime UI elements use inline `style.cssText` strings rather than the design token system. These should use the established CSS class patterns.

3. **No structured logging** — Error handling uses `console.warn()` and `console.error()` with ad-hoc message formats. A lightweight structured logger (even just a wrapper that adds timestamps and categories) would make debugging production issues easier.

4. **E2E test helpers have grown complex** — `_interactions.js` is 415 lines with teleport, time warp, flight control, and state seeding functions. Consider splitting into focused helper modules (e.g., `_flight.js`, `_state.js`, `_timewarp.js`).

---

## Summary

The Iteration 2 work is **well-executed**. All 28 tasks are complete, the error handling and resilience improvements are solid, the object pooling and performance optimisations are consistently applied, and the test suite is comprehensive with excellent practices (no brittle timeouts, condition-based waits, proper fixtures).

The two items that should be addressed before considering this production-ready are:
1. Adding error handling to the main flight controller RAF loop (the primary simulation loop is unprotected)
2. Resolving the branch coverage threshold gap (78% vs 80% requirement)

Everything else is either a defensive hardening measure or a future improvement.
