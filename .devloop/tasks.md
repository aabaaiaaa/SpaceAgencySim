# Iteration 4 — Tasks

See `.devloop/requirements.md` for full context on each item.

---

## Critical Physics Integration

### TASK-001: Define CapturedBody interface and refactor PhysicsState
- **Status**: done
- **Dependencies**: none
- **Description**: Replace the scalar `capturedAsteroidMass: number` field in PhysicsState (`physics.ts`) with `capturedBody: CapturedBody | null`. Define the `CapturedBody` interface with `mass`, `radius`, `offset: { x, y }` (craft-local frame), and `name`. Rename `setCapturedAsteroidMass()` → `setCapturedBody(ps, body)` and `clearCapturedAsteroidMass()` → `clearCapturedBody(ps)`. Update `_computeTotalMass()` to read `ps.capturedBody?.mass ?? 0`. Update `_computeAsteroidTorque()` to check `capturedBody !== null` instead of `capturedAsteroidMass > 0`. Update `alignThrustWithAsteroid()` in `grabbing.ts` to check `ps.capturedBody !== null`. Fix all compilation errors across the codebase caused by the field rename (including test files). No backward compatibility needed for old saves.
- **Verification**: `npm run typecheck && npx vitest run src/tests/grabbing.test.ts src/tests/physics.test.ts`

### TASK-002: Wire setCapturedBody into captureAsteroid and clearCapturedBody into release
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: In `captureAsteroid()` (`grabbing.ts:278-280`), after successful capture, construct a `CapturedBody` from the asteroid's mass, radius, and name, compute the craft-local attachment offset from the relative position at capture time, and call `setCapturedBody(ps, body)`. In `releaseGrabbedAsteroid()` (`grabbing.ts:288-298`), add a `ps: PhysicsState` parameter and call `clearCapturedBody(ps)` on release. Update all callers of `releaseGrabbedAsteroid()` to pass `ps`. See requirements section 1.1.
- **Verification**: `npm run typecheck && npx vitest run src/tests/grabbing.test.ts`

### TASK-003: Update CoM and MoI calculations to use CapturedBody offset
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Update `_computeCoMLocal()` (`physics.ts:1431-1452`) to include `capturedBody.mass` at `capturedBody.offset` position in the weighted CoM average. Update `_computeMomentOfInertia()` to include the asteroid's rotational contribution: approximate as solid sphere `(2/5) * mass * radius^2` plus parallel-axis term `mass * dist_from_CoM^2`. The offset is in craft-local coordinates and rotates with the ship. See requirements section 1.2.
- **Verification**: `npm run typecheck && npx vitest run src/tests/physics.test.ts`

### TASK-004: Use per-arm armReach and maxGrabSpeed from part definitions
- **Status**: done
- **Dependencies**: none
- **Description**: In `captureAsteroid()` (`grabbing.ts:266`), look up the equipped arm's part definition and use its `armReach` property instead of the global `GRAB_ARM_RANGE` (25m). Use `maxGrabSpeed` instead of `GRAB_MAX_RELATIVE_SPEED` (1.0). In `getAsteroidGrabTargetsInRange()`, update the broad filter from `GRAB_ARM_RANGE * 20` to `armReach * 20`. Standard arm: 25m/1.0, Heavy: 35m/0.8, Industrial: 50m/0.5. Consider deprecating or removing the global constants if no longer referenced. See requirements section 1.3.
- **Verification**: `npm run typecheck && npx vitest run src/tests/grabbing.test.ts`

---

## Bug Fixes

### TASK-005: Fix double-scale in streak asteroid rendering
- **Status**: done
- **Dependencies**: none
- **Description**: In `_asteroids.ts`, the streak LOD `_renderStreakAsteroid` function double-scales the trail. Line 248: `trailLength = Math.min(200, speed * scale * 0.05)` already includes `scale`. Lines 257-258: `tailX = headX - dx * trailLength * scale` applies `scale` again. Remove the second `* scale` from lines 257-258 so tail positions use just `trailLength`. See requirements section 2.1.
- **Verification**: `npm run typecheck`

### TASK-006: Add per-asteroid collision cooldown
- **Status**: done
- **Dependencies**: none
- **Description**: `checkAsteroidCollisions` in `collision.ts` applies damage every tick during multi-frame overlaps. Add collision cooldown tracking for asteroids, mirroring the existing `SEPARATION_COOLDOWN_TICKS` (10 ticks) pattern used for debris. Use a Map or Set tracking recently-collided asteroid IDs with a tick counter. In `checkAsteroidCollisions`, skip asteroids with active cooldown, decrement cooldowns each tick, and set cooldown after applying damage. See requirements section 2.2.
- **Verification**: `npm run typecheck && npx vitest run src/tests/collision.test.ts`

### TASK-007: Fix map coordinate frame in _drawBeltAsteroidObjects
- **Status**: done
- **Dependencies**: none
- **Description**: In `_drawBeltAsteroidObjects` (`map.ts:916-917`), `craftX` uses body-relative coordinates while `craftY` is adjusted to sun-centred (`ps.posY + R`). Convert `craftX` to the same sun-centred coordinate frame as `craftY` so distance calculations between craft and asteroid positions are correct. See requirements section 2.3.
- **Verification**: `npm run typecheck`

### TASK-008: Unify asteroid size category thresholds between map and flight view
- **Status**: done
- **Dependencies**: none
- **Description**: Map view (`map.ts:944`) uses size thresholds 500/50m while flight view (`_asteroids.ts:58-62`) uses 100/10m. Export `getSizeCategory()` from `_asteroids.ts` and import it in `map.ts` to derive the size label, eliminating the duplicate thresholds. See requirements section 2.4.
- **Verification**: `npm run typecheck`

### TASK-009: Cap _getAutoSaveKey loop and deduplicate SAVE_VERSION
- **Status**: done
- **Dependencies**: none
- **Description**: Two fixes in `autoSave.ts`: (1) `_getAutoSaveKey()` (lines 79-88) has an unbounded `for (let i = 0; ; i++)` loop. Cap it at a reasonable upper bound (e.g., 100) and return `AUTO_SAVE_KEY` as fallback. (2) `SAVE_VERSION = 2` at line 31 duplicates the constant from `saveload.ts:41`. Remove the local definition and import from `saveload.ts`. See requirements section 2.5.
- **Verification**: `npm run typecheck && npx vitest run src/tests/autoSave.test.ts`

---

## Map & Render Quality

### TASK-010: Add defensive null guards in map.ts and null _commsGraphics
- **Status**: done
- **Dependencies**: none
- **Description**: Add `if (!_mapRoot) return` guards at the top of `_drawBody` (line 623) and `_drawShadow` (line 1325) in `map.ts`, matching the pattern used by all other drawing functions. Add `_commsGraphics = null` in `destroyMapRenderer()` (lines 335-367) alongside the other graphics nulling — it's currently missing, leaving a stale reference to a destroyed PixiJS object. See requirements section 3.1.
- **Verification**: `npm run typecheck`

### TASK-011: Add off-screen culling to _drawBeltAsteroidObjects
- **Status**: done
- **Dependencies**: none
- **Description**: `_drawBeltAsteroidObjects` in `map.ts` draws all active asteroids with no viewport bounds check, unlike `_drawAsteroidBelt` (dot rendering) which already culls off-screen positions. Add a viewport bounds check before drawing each asteroid object, matching the culling pattern used in `_drawAsteroidBelt`. See requirements section 3.2.
- **Verification**: `npm run typecheck`

### TASK-012: Extract LANDABLE TextStyle to module-level constant
- **Status**: done
- **Dependencies**: none
- **Description**: In `_asteroids.ts` (line 210), `label.style = { ... }` replaces the entire TextStyle object every frame for LANDABLE labels, triggering GPU texture re-uploads. Create a shared `const LANDABLE_STYLE` at module level and assign it once. In the per-frame render, only set the style if it hasn't been assigned yet. See requirements section 3.3.
- **Verification**: `npm run typecheck`

---

## Save System

### TASK-013: Validate binary envelope format version during import
- **Status**: done
- **Dependencies**: none
- **Description**: In `saveload.ts` (line 833), the binary envelope format version is read (`const _version = view.getUint16(4, false)`) but never validated. After reading the version, compare it against the current supported version (1). If higher, return a clear error message ("Save was created with a newer version of the game"). Version 1 and below proceed normally. See requirements section 4.1.
- **Verification**: `npx vitest run src/tests/saveload.test.ts`

---

## Architecture

### TASK-014: Add renameOrbitalObject core function
- **Status**: done
- **Dependencies**: none
- **Description**: `_mapView.ts:248` directly mutates `obj!.name = newName`, violating the convention that state mutations happen only in `src/core/`. Create a `renameOrbitalObject(state: GameState, objectId: string, newName: string)` function in an appropriate core module. Call it from `_mapView.ts` instead of the direct mutation. See requirements section 5.1.
- **Verification**: `npm run typecheck`

---

## Type Safety & Polish

### TASK-015: Remove spurious cast in lifeSupport.ts
- **Status**: done
- **Dependencies**: none
- **Description**: `lifeSupport.ts:91` has an unnecessary `as unknown as` cast — `CrewMember` already declares all needed fields. Remove the cast and access properties directly. This reduces the project-wide cast count from 4 to 3. See requirements section 6.1.
- **Verification**: `npm run typecheck`

### TASK-016: Update tech tree descriptions and adjust arm tier placement
- **Status**: done
- **Dependencies**: none
- **Description**: Two changes in `src/data/techtree.js` (or `.ts`) and `src/data/parts.ts`: (1) Update `struct-t4` and `struct-t5` node descriptions to mention grabbing arm unlocks. (2) Currently both Standard and Heavy arms unlock at T4, making Standard immediately obsolete. Move Heavy Grabbing Arm to T5 and Industrial Grabbing Arm to T6. Create new tech tree tiers if T5/T6 don't exist. Update the `techLevel` property on the arm part definitions in `parts.ts` accordingly. See requirements section 6.2.
- **Verification**: `npm run typecheck && npx vitest run src/tests/techtree.test.ts`

---

## Technical Debt

### TASK-017: Move rename dialog inline styles to CSS
- **Status**: done
- **Dependencies**: none
- **Description**: The asteroid rename dialog in `_mapView.ts:220-232` uses `style.cssText` and inline `style=""` attributes, contradicting the CSS custom property migration from iteration 3. Move these styles to a CSS class in the appropriate stylesheet and replace the inline styles with class-based styling. See requirements section 7.1.
- **Verification**: `npm run typecheck`

### TASK-018: Document caller contracts in grabbing.ts
- **Status**: done
- **Dependencies**: TASK-002
- **Description**: After TASK-002 wires `setCapturedBody`/`clearCapturedBody` into `captureAsteroid()`/`releaseGrabbedAsteroid()`, verify that caller contracts are now internal to the module — callers should not need to separately manage physics state. If any implicit contracts remain, document them with JSDoc `@remarks` annotations. See requirements section 7.2.
- **Verification**: `npm run typecheck`

---

## Testing Improvements

### TASK-019: Add missing test-map.json entries and @smoke tags
- **Status**: done
- **Dependencies**: none
- **Description**: Two changes: (1) Add `test-map.json` entries for `asteroidBelt`, `settingsStore`, and `crc32` source modules mapping to their unit test and E2E files. Link `e2e/asteroid-belt.spec.js` from the collision and grabbing entries. (2) Add `@smoke` tags to 1-2 representative tests in each of: `autoSave.test.ts`, `crc32.test.ts`, `settingsStore.test.ts`, `asteroidBelt.test.ts`. Pick tests that exercise the broadest code paths. See requirements sections 9.1 and 9.2.
- **Verification**: `node scripts/run-affected.mjs --base HEAD~1 --dry-run`

### TASK-020: Fix E2E test independence in asteroid-belt.spec.js
- **Status**: done
- **Dependencies**: none
- **Description**: Tests within `describe` blocks in `e2e/asteroid-belt.spec.js` share page instances via `beforeAll`/`afterAll` (lines 45-56, 163-175). Convert to `beforeEach`/`afterEach` so each test gets a fresh page instance and can't be affected by prior test failures. See requirements section 9.3. **Note:** Use the Playwright MCP tool to interactively debug any failing E2E tests rather than rerunning blindly.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.js`

### TASK-021: Unit tests for CapturedBody physics integration
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003
- **Description**: Add or update unit tests to cover: (1) `capturedBody` is set on capture with correct mass, radius, offset, and name. (2) `capturedBody` is cleared on release. (3) CoM shifts proportionally to asteroid mass and offset — test with known values. (4) Moment of inertia includes asteroid contribution (sphere inertia + parallel-axis). (5) Asteroid torque uses `capturedBody` fields correctly. See requirements section 9.4.
- **Verification**: `npx vitest run src/tests/grabbing.test.ts src/tests/physics.test.ts`

### TASK-022: Unit tests for per-arm properties, collision cooldown, and autoSave
- **Status**: pending
- **Dependencies**: TASK-004, TASK-006, TASK-009
- **Description**: Add or update unit tests: (1) Verify different arm tiers have different effective range and speed limits — Standard 25m/1.0, Heavy 35m/0.8, Industrial 50m/0.5. Boundary tests at exact mass limit thresholds. (2) Verify collision cooldown prevents re-damage during cooldown period; verify cooldown decrements and eventually allows re-collision. (3) Verify `_getAutoSaveKey()` returns fallback when all slots are occupied. See requirements section 9.4.
- **Verification**: `npx vitest run src/tests/grabbing.test.ts src/tests/collision.test.ts src/tests/autoSave.test.ts`

### TASK-023: E2E tests for changed behaviour
- **Status**: pending
- **Dependencies**: TASK-002, TASK-003, TASK-004, TASK-006
- **Description**: Add E2E specs to `e2e/asteroid-belt.spec.js` covering user-visible behaviour changes: (1) Heavy arm grabs at longer range than Standard arm. (2) A slow-speed overlap doesn't destroy the craft (cooldown prevents per-frame damage). (3) After capture, craft rotates when thrusting unaligned and stabilises after alignment. (4) Heavy arm is not available until its new tier is researched. Each test must set up its own state (no shared page). See requirements section 9.5. **Note:** Use the Playwright MCP tool to interactively debug any failing E2E tests rather than rerunning blindly.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.js`

---

## Coverage Escalation

### TASK-024: Configure Vitest coverage thresholds for render and UI layers
- **Status**: pending
- **Dependencies**: TASK-021, TASK-022
- **Description**: Configure Vitest's `coverage.thresholds` in `vitest.config` to enforce new coverage floors: render layer (`src/render/`) >= 55%, UI layer (`src/ui/`) >= 45%. Run `npx vitest run --coverage` to check current state against the new thresholds. See requirements section 8.1.
- **Verification**: `npx vitest run --coverage`

### TASK-025: Add tests to meet coverage floors
- **Status**: pending
- **Dependencies**: TASK-024
- **Description**: If TASK-024's coverage run shows render or UI below the new floors, add targeted unit tests for the lowest-coverage files until thresholds pass. Priority files: `src/render/flight/_asteroids.ts` (size categories, LOD selection helpers), `src/render/map.ts` (belt rendering helpers), `src/ui/flightController/_mapView.ts` (asteroid rename, map interaction). Re-run coverage to confirm floors are met. If floors are already met after prior tasks, mark this task as complete with no changes. See requirements section 8.1.
- **Verification**: `npx vitest run --coverage`

---

## Verification

### TASK-026: Verification pass — run all checks
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025
- **Description**: Run the full verification suite and fix any issues. Check: (1) `npm run typecheck` passes. (2) `npm run lint` passes. (3) `npm run test:unit` all pass. (4) `npm run test:e2e` all pass. (5) `npm run build` succeeds. (6) `as unknown as` cast count is <= 3 in source files. (7) Coverage floors met. See requirements section 10.
- **Verification**: `npm run typecheck && npm run lint && npm run test:unit && npm run test:e2e && npm run build`
