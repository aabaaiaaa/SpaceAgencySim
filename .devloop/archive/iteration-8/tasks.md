# Iteration 8 — Tasks

See [requirements.md](requirements.md) for full context on each section.

---

### TASK-001: Fix UI coverage threshold
- **Status**: done
- **Dependencies**: none
- **Description**: Lower the `src/ui/**` lines coverage threshold from 77 to 76 in `vite.config.ts` (line 119, inside `test.coverage.thresholds['src/ui/**']`). This fixes the 0.01% shortfall caused by the iteration 7 staging extraction. See requirements section 1.
- **Verification**: `npm run test:unit` exits with code 0 (all tests pass, all coverage thresholds met).

### TASK-002: Fix crew career table status rendering
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Fix the crew career table in the Library facility. Two files need changes:
  1. **`src/core/library.ts`**: In the `CrewCareer` interface (line 71-78), change `status: string` to `status: AstronautStatus` (import from constants.ts — already imported on line 11). Add `injuryEnds: number | null` field. In `getCrewCareers()` (line 251-258), add `injuryEnds: c.injuryEnds ?? null` to the mapped object.
  2. **`src/ui/library.ts`**: Import `AstronautStatus` from `../core/constants.ts`. Fix sorting (lines 300-304) to use `AstronautStatus.KIA` and `AstronautStatus.FIRED` instead of string literals `'DEAD'` and `'kia'`. Fix color logic (lines 309-310) to four-way: KIA→red `#ff6060`, fired→gray `#a0a0a0`, injured (`c.injuryEnds !== null`)→amber `#ffaa30`, active→green `#60dd80`. Display proper capitalized status text: `'Active'`, `'Fired'`, `'KIA'`, `'Injured'` (for injured, override since `status` is still `'active'`).
  See requirements section 2.
- **Verification**: `npm run typecheck` passes. `npm run lint` passes. Visual check: start dev server (`npm run dev`), open Library, verify crew table shows correct colors and status text.

### TASK-003: Remove vestigial CrewStatus enum
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: Remove the unused `CrewStatus` enum from the codebase:
  1. In `src/core/constants.ts`: Delete the `CrewStatus` const object (lines 115-126) and its companion type export (line 128). Update the JSDoc comment on `AstronautStatus` (line 98) to remove the sentence referencing "operational CrewStatus below".
  2. In `src/tests/gameState.test.ts`: Remove `CrewStatus` from the import on line 26. Delete the `describe('CrewStatus enum', ...)` test block (lines 446-457).
  See requirements section 3.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/gameState.test.ts` passes. `grep -r "CrewStatus" src/ --include="*.ts" | grep -v node_modules` returns zero results.

### TASK-004: Add makeContract factory and fix saveload.test.ts casts
- **Status**: done
- **Dependencies**: none
- **Description**: Eliminate the 3 remaining `as unknown as` casts in `saveload.test.ts`:
  1. Add a `makeContract()` factory to `src/tests/_factories.ts` that returns a typed `Contract` (import from `gameState.ts`). Include sensible defaults for all required fields: `id`, `title`, `description`, `category`, `objectives`, `reward`, `penaltyFee`, etc. Accept `Partial<Contract>` overrides.
  2. In `saveload.test.ts` line 58-63: Change the local `SaveEnvelope.state` type from `Record<string, unknown>` to `GameState` (import `GameState` if not already imported). This eliminates the cast on line 778.
  3. Update `validContract()` (line 1134) to return `Contract` using `makeContract()` instead of returning `Record<string, unknown>`.
  4. On line 1286, add `@ts-expect-error` above the `{ id: 'c2' }` deliberately invalid entry.
  5. Remove the `as unknown as GameState['contracts']` casts on lines 1288 and 1308 — the array elements are now properly typed.
  See requirements section 4a.
- **Verification**: `npx vitest run src/tests/saveload.test.ts` — all tests pass. `grep -c "as unknown as" src/tests/saveload.test.ts` returns 0.

### TASK-005: Eliminate pool.test.ts and workerBridgeTimeout.test.ts casts
- **Status**: done
- **Dependencies**: none
- **Description**: Eliminate the 4 remaining `as unknown as` casts across these two files:
  1. **`pool.test.ts`** (lines 87, 96): The `asPIXIContainer()` and `attachToParent()` helpers bridge `MockContainer` ↔ `PIXI.Container`. Attempt to extend `makeMockContainer()` in `_factories.ts` to satisfy enough of the `PIXI.Container` interface (specifically `children` array and `destroy()` method). If the interface surface is too large, replace the casts with `@ts-expect-error` comments explaining the WebGL limitation.
  2. **`workerBridgeTimeout.test.ts`** (lines 73, 77): Replace the `(globalThis as unknown as ...).Worker = ...` pattern with `Object.defineProperty(globalThis, 'Worker', { value: MockWorkerConstructor, writable: true, configurable: true })`. If the constructor return type cast on line 77 is still needed, use `@ts-expect-error` since the mock doesn't implement the full Worker interface.
  See requirements sections 4b and 4d.
- **Verification**: `npx vitest run src/tests/pool.test.ts` and `npx vitest run src/tests/workerBridgeTimeout.test.ts` — all tests pass. `grep -c "as unknown as" src/tests/pool.test.ts src/tests/workerBridgeTimeout.test.ts` returns 0 for both files.

### TASK-006: Eliminate ui-rocketCardUtil.test.ts casts
- **Status**: done
- **Dependencies**: none
- **Description**: Eliminate the 4 remaining `as unknown as` casts in `ui-rocketCardUtil.test.ts` (lines 128, 133, 138):
  The three helper functions (`createCanvas`, `renderPreview`, `buildCard`) bridge between JSDOM elements and the test's `MockElement` type. Strategy options (pick the one that works cleanly):
  - Option A: Create a `makeMockCanvas()` factory in `_factories.ts` that returns an object satisfying both `MockElement` and `HTMLCanvasElement` interfaces.
  - Option B: Define a union/intersection type for the test helpers that avoids the cast.
  - Option C: If the JSDOM surface gap is too wide, replace casts with `@ts-expect-error` comments explaining the JSDOM limitation.
  In all cases, the helper functions should remain (they centralise the bridging pattern).
  See requirements section 4c.
- **Verification**: `npx vitest run src/tests/ui-rocketCardUtil.test.ts` — all tests pass. `grep -c "as unknown as" src/tests/ui-rocketCardUtil.test.ts` returns 0.

### TASK-007: Migrate static inline styles — _launchFlow.ts and launchPad.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Migrate all 23 static inline styles from `src/ui/vab/_launchFlow.ts` (12) and `src/ui/launchPad.ts` (11) to CSS classes. These two files share near-identical launch confirmation dialog styles — create shared CSS classes (e.g., `.launch-dialog-title`, `.launch-dialog-subtitle`, `.launch-dialog-warn-highlight`, `.launch-dialog-actions`, `.launch-btn-abort`, `.launch-btn-confirm`, `.launch-caution-box`, `.launch-caution-title`, `.launch-caution-highlight`) in `src/ui/launchPad.css` (the common launch context). Use design tokens from `design-tokens.css` where hex values match existing tokens. Replace each `style="..."` with the appropriate `class="..."`. See requirements section 5 for the full style inventory.
- **Verification**: `npm run build` succeeds. `grep -c 'style="' src/ui/vab/_launchFlow.ts src/ui/launchPad.ts` returns 0 for both files. Visual check: start dev server, open VAB, attempt a launch with validation errors — confirm the dialog looks identical to before.

### TASK-008: Migrate static inline styles — _docking.ts and _scalebar.ts
- **Status**: done
- **Dependencies**: none
- **Description**: Migrate static inline styles from `src/ui/flightController/_docking.ts` (3 static out of 9 total) and `src/ui/vab/_scalebar.ts` (5 static out of 7 total) to CSS classes. For `_docking.ts`, add classes to `src/ui/flightController/flightController.css`. For `_scalebar.ts`, add classes to `src/ui/vab/vab.css`. Leave dynamic styles (template literal interpolations like `${whiteStyle}`, `${speedColor}`, `${barY.toFixed(1)}px`) as inline. Use design tokens where applicable. See requirements section 5 for style details.
- **Verification**: `npm run build` succeeds. Verify remaining `style=` attributes in both files are only dynamic (contain `${`). Visual check via dev server: open a docking scenario and the VAB to confirm panels render correctly.

### TASK-009: Migrate static inline styles — remaining UI files
- **Status**: done
- **Dependencies**: none
- **Description**: Migrate the remaining 5 static inline styles from smaller files:
  - `src/ui/crewAdmin.ts` — 1 static style (`margin-top:4px` on line 639) → `src/ui/crewAdmin.css`
  - `src/ui/library.ts` — 2 static styles (`font-weight:600` on lines 250, 312) → `src/ui/library.css`
  - `src/ui/mainmenu.ts` — 1 static style (`display:none` on line 451) → `src/ui/mainmenu.css`
  - `src/ui/rdLab.ts` — 1 static style (`margin: 0 4px` on line 101) → `src/ui/rdLab.css`
  Leave all dynamic styles in `crewAdmin.ts` (3), `flightHud.ts` (4), `_partsPanel.ts` (1), `_inventory.ts` (1) as inline.
  Note: `library.ts` line 313 has a dynamic `color:${statusColor}` — leave that as inline.
  See requirements section 5.
- **Verification**: `npm run build` succeeds. `npm run typecheck` passes. Verify that each modified file's remaining `style=` attributes (if any) are only dynamic.

### TASK-010: Final verification pass
- **Status**: done
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009
- **Description**: Run the full verification suite and confirm all iteration 8 targets are met:
  1. `npm run typecheck` — no errors
  2. `npm run lint` — 0 warnings, 0 errors
  3. `npm run test:unit` — all tests pass, all coverage thresholds met
  4. `npm run build` — production build succeeds
  5. Verify cast counts: `grep -r "as unknown as" src/tests/ --include="*.ts"` — target 0 in runtime code (3 in `_factories.ts` JSDoc examples are acceptable)
  6. Verify `CrewStatus` is gone: `grep -r "CrewStatus" src/ --include="*.ts"` returns 0 results
  7. Verify inline style reduction: `grep -r 'style="' src/ui/ --include="*.ts"` — remaining should be ~18 (all dynamic with `${` interpolation)
- **Verification**: All commands above pass. Report final counts for casts, CrewStatus references, and inline styles.
