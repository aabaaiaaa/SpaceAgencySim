# Iteration 4 — Stabilization: Physics Integration, Bug Fixes, and Quality Improvements

This iteration addresses all actionable findings from the iteration 6 code review. No new features — the focus is fixing critical bugs in the asteroid capture physics pipeline, correcting rendering and collision issues, improving test infrastructure, and cleaning up polish items.

The codebase is ~60,400 lines of TypeScript across 154 source modules. All work builds on the existing codebase.

---

## 1. Critical Physics Integration

### 1.1 Wire Asteroid Mass into Physics on Capture/Release

**Files:** `src/core/grabbing.ts`, callers in UI layer

`captureAsteroid()` (`grabbing.ts:278-280`) sets `GrabState.GRABBED` and stores the asteroid reference, but never calls `setCapturedAsteroidMass(ps, asteroid.mass)` from `physics.ts`. The function already receives `ps: PhysicsState` but doesn't use it for mass. Similarly, `releaseGrabbedAsteroid()` (`grabbing.ts:288-298`) doesn't call `clearCapturedAsteroidMass(ps)` — its signature doesn't even accept `PhysicsState`.

**Impact:** After capture, `ps.capturedAsteroidMass` stays at 0. `_computeTotalMass` excludes asteroid mass, `_computeAsteroidTorque` returns 0 (mass <= 0 early return), and `alignThrustWithAsteroid` returns early with "No captured asteroid mass." The entire asteroid mass/thrust/torque system is silently inert.

**Fix:**
- In `captureAsteroid()`, after successful capture (line 278), call `setCapturedAsteroidMass(ps, asteroid.mass)`
- In `releaseGrabbedAsteroid()`, add `ps: PhysicsState` parameter and call `clearCapturedAsteroidMass(ps)`
- Update all callers of `releaseGrabbedAsteroid()` to pass `ps`

### 1.2 Replace Scalar Asteroid Mass with CapturedBody Struct

**Files:** `src/core/physics.ts` (PhysicsState interface, `_computeCoMLocal`, `_computeMomentOfInertia`, `_computeTotalMass`, `_computeAsteroidTorque`, `setCapturedAsteroidMass`, `clearCapturedAsteroidMass`, `alignThrustWithAsteroid`)

The current `capturedAsteroidMass` field in PhysicsState is a scalar — it doesn't encode position, orientation, or attachment geometry. `_computeCoMLocal()` (`physics.ts:1431-1452`) iterates over craft parts only and has no knowledge of the asteroid's spatial position. The CoM doesn't shift, moment of inertia is underestimated, and thrust alignment works via a boolean flag rather than actual physics.

As asteroid mechanics deepen (mining, multi-asteroid capture, surface operations), this needs to become a proper struct.

**Fix:**
- Define a `CapturedBody` interface in `physics.ts`:
  ```typescript
  interface CapturedBody {
    mass: number;           // kg
    radius: number;         // metres — used for inertia approximation
    offset: { x: number; y: number };  // attachment position in craft-local coordinates (rotates with the ship)
    name: string;           // for UI display
  }
  ```
- The `offset` is in **craft-local frame** — it rotates with the ship automatically. CoM and MoI calculations use it directly without frame conversion.
- Replace `capturedAsteroidMass: number` with `capturedBody: CapturedBody | null` in PhysicsState
- Update `setCapturedAsteroidMass()` → `setCapturedBody(ps, body: CapturedBody)` — sets the full struct and resets `thrustAligned`
- Update `clearCapturedAsteroidMass()` → `clearCapturedBody(ps)` — sets to null
- Update `_computeTotalMass()` to read `ps.capturedBody?.mass ?? 0`
- Update `_computeCoMLocal()` to include the captured body's mass at its `offset` position in the weighted average
- Update `_computeMomentOfInertia()` to include the captured body's rotational contribution (approximate as solid sphere: `(2/5) * mass * radius^2` plus parallel-axis term `mass * dist_from_CoM^2`)
- Update `_computeAsteroidTorque()` to read from `capturedBody`
- Update `alignThrustWithAsteroid()` to check `capturedBody !== null` instead of `capturedAsteroidMass > 0`
- Update all callers (grabbing.ts, flightController, etc.) to use the new API
- No backward compatibility required for the old `capturedAsteroidMass` field — just remove it. The feature was broken anyway (mass was never wired in), so no valid old saves exist with a captured asteroid.

### 1.3 Use Per-Arm Properties Instead of Global Constants

**Files:** `src/core/grabbing.ts`, `src/core/constants.ts`

`captureAsteroid()` at `grabbing.ts:266` checks `dist > GRAB_ARM_RANGE` (global constant = 25m) and `relSpeed > GRAB_MAX_RELATIVE_SPEED` (global = 1.0 m/s). It ignores the per-arm `armReach` and `maxGrabSpeed` properties defined in `parts.ts`. This means all three arm tiers (standard, heavy, industrial) have identical 25m range and 1.0 m/s speed limit.

Per-arm values defined but unused:
| Arm | armReach | maxGrabSpeed | maxCaptureMass |
|-----|----------|-------------|----------------|
| Standard | 25 | 1.0 | 100,000 kg |
| Heavy | 35 | 0.8 | 100,000,000 kg |
| Industrial | 50 | 0.5 | 2,000,000,000,000 kg |

Only `maxCaptureMass` is currently read (lines 249-260).

**Fix:**
- In `captureAsteroid()`, look up the equipped arm's part definition and use its `armReach` instead of `GRAB_ARM_RANGE`
- Use the arm's `maxGrabSpeed` instead of `GRAB_MAX_RELATIVE_SPEED`
- Update `getAsteroidGrabTargetsInRange()` — its broad filter (`GRAB_ARM_RANGE * 20` = 500m) should use the equipped arm's `armReach * 20`
- Consider deprecating or removing the global constants if they're no longer referenced

---

## 2. Bug Fixes

### 2.1 Fix Double-Scale in Streak Asteroid Rendering

**File:** `src/render/flight/_asteroids.ts`

In the streak LOD rendering:
- Line 248: `trailLength = Math.min(200, speed * scale * 0.05)` — already includes `scale`
- Lines 257-258: `tailX = headX - dx * trailLength * scale` — `scale` applied a second time

Result: trails are `scale^2` too long.

**Fix:** Remove the second `* scale` from lines 257-258, so tail position is computed as `headX - dx * trailLength`.

### 2.2 Add Per-Asteroid Collision Cooldown

**File:** `src/core/collision.ts`

`checkAsteroidCollisions` (`collision.ts:769-815`) applies full damage every tick when an asteroid overlaps the craft across multiple frames. No per-asteroid cooldown exists. The debris collision system already uses `SEPARATION_COOLDOWN_TICKS` (10 ticks) to prevent this — asteroid collisions need the same pattern.

**Fix:**
- Add a `collisionCooldown` field to the `Asteroid` type (or use a Map/Set tracking recently-collided asteroid IDs)
- In `checkAsteroidCollisions`, skip asteroids with active cooldown (decrement each tick)
- After applying damage, set cooldown to `SEPARATION_COOLDOWN_TICKS`

### 2.3 Fix Map Coordinate Frame in Belt Asteroid Rendering

**File:** `src/render/map.ts`

`_drawBeltAsteroidObjects` (line 916-917): `craftX` uses body-relative coordinates while `craftY` is adjusted to sun-centred (`ps.posY + R`). The distance calculation between craft and asteroid positions is incorrect for non-zero craft angular positions.

**Fix:** Convert `craftX` to the same sun-centred coordinate frame as `craftY`.

### 2.4 Unify Asteroid Size Category Thresholds

**Files:** `src/render/map.ts` (line 944), `src/render/flight/_asteroids.ts` (lines 58-62)

Size thresholds are inconsistent:
- Flight view (`_asteroids.ts`): small < 10m, medium < 100m, large >= 100m
- Map view (`map.ts`): small < 50m, medium < 500m, large >= 500m

A 30m asteroid is "medium" on the map but "large" in flight. A 200m asteroid is "large" in flight but "medium" on the map.

**Fix:** Export `getSizeCategory()` from `_asteroids.ts` and import/reuse it in `map.ts` to derive the label text, eliminating the duplicate thresholds.

### 2.5 Cap _getAutoSaveKey Loop and Deduplicate SAVE_VERSION

**File:** `src/core/autoSave.ts`

Two issues:
1. `_getAutoSaveKey()` (lines 79-88) has an unbounded `for (let i = 0; ; i++)` loop that iterates indefinitely if all slots are occupied. JSDoc claims it falls back to `AUTO_SAVE_KEY` but the fallback code doesn't exist.
2. `SAVE_VERSION = 2` is defined at line 31, duplicating the same constant exported from `saveload.ts:41`. If one is bumped without the other, version skew occurs.

**Fix:**
- Cap the loop at a reasonable upper bound (e.g., 100) and return `AUTO_SAVE_KEY` as fallback when no empty slot is found
- Remove the local `SAVE_VERSION` and import it from `saveload.ts`

---

## 3. Map & Render Quality

### 3.1 Defensive Null Guards in map.ts

**File:** `src/render/map.ts`

`_drawBody` (line 623) and `_drawShadow` (line 1325) use `!` non-null assertions on graphics objects without preceding null guards. All other drawing functions already have `if (!_mapRoot) return` guards. Additionally, `_commsGraphics` is not nulled in `destroyMapRenderer()` (lines 335-367), leaving a stale reference to a destroyed PixiJS object.

**Fix:**
- Add `if (!_mapRoot) return` guards at the top of `_drawBody` and `_drawShadow`
- Add `_commsGraphics = null` in `destroyMapRenderer()` alongside the other graphics nulling

### 3.2 Off-Screen Culling for Belt Asteroid Objects

**File:** `src/render/map.ts`

`_drawBeltAsteroidObjects` draws all active asteroids with no viewport bounds check, unlike `_drawAsteroidBelt` (dot rendering) which already culls off-screen positions.

**Fix:** Add a viewport bounds check before drawing each asteroid object, matching the culling pattern used in `_drawAsteroidBelt`.

### 3.3 Extract LANDABLE TextStyle Constant

**File:** `src/render/flight/_asteroids.ts`

Line 210: `label.style = { ... }` replaces the entire `TextStyle` object every frame for LANDABLE labels. This triggers GPU texture re-uploads each frame — a performance concern.

**Fix:** Create a shared `const LANDABLE_STYLE` at module level and assign it once. In the per-frame render code, only assign the style if the label doesn't already have it (or assign unconditionally since PIXI may short-circuit identical styles).

---

## 4. Save System

### 4.1 Validate Binary Envelope Format Version

**File:** `src/core/saveload.ts`

Line 833: The binary envelope format version is read (`const _version = view.getUint16(4, false)`) but never validated. If a future version changes the envelope structure, old code will silently misparse the payload.

**Fix:** After reading the version, compare against the current supported version (1). If higher, return a clear error ("Save was created with a newer version of the game"). Version 1 and below proceed normally.

---

## 5. Architecture

### 5.1 Add renameOrbitalObject Core Function

**Files:** `src/ui/flightController/_mapView.ts`, new function in `src/core/` (e.g., `orbitalObjects.ts` or added to an existing module)

`_mapView.ts:248` directly mutates `obj!.name = newName`, violating the convention that state mutations happen only in `src/core/` modules.

**Fix:** Create a `renameOrbitalObject(state: GameState, objectId: string, newName: string)` function in the core layer. Call it from `_mapView.ts` instead of directly mutating the name.

---

## 6. Type Safety & Polish

### 6.1 Remove Spurious Cast in lifeSupport.ts

**File:** `src/core/lifeSupport.ts` (line 91)

An unnecessary `as unknown as` cast accesses properties that `CrewMember` already declares. Removing it reduces the project-wide cast count from 4 to 3.

### 6.2 Update Tech Tree Descriptions and Adjust Arm Tier Placement

**Files:** `src/data/techtree.js` (or `.ts`)

Two issues:
1. `struct-t4` and `struct-t5` node descriptions don't mention that they unlock grabbing arms
2. Both the standard Grabbing Arm and Heavy Grabbing Arm unlock at T4, making the standard arm immediately obsolete — there's no progression

**Fix:**
- Update tech tree node descriptions to mention grabbing arm unlocks
- Move the Heavy Grabbing Arm to T5 and the Industrial Grabbing Arm to T6. Create new tech tree tiers if T5/T6 don't exist — proper progression spacing is more important than fitting into existing tiers

---

## 7. Technical Debt Cleanup

### 7.1 Inline Styles in Rename Dialog

**File:** `src/ui/flightController/_mapView.ts` (lines 220-232)

The asteroid rename dialog uses `style.cssText` and inline `style=""` attributes, contradicting the iteration 6 CSS custom property migration goal. This is new tech debt introduced in the same iteration that migrated other inline styles.

**Fix:** Move the rename dialog styles to a CSS class in the appropriate stylesheet. Replace inline `style.cssText` and `style=""` attributes with class-based styling.

### 7.2 Document Caller Contracts in grabbing.ts

**File:** `src/core/grabbing.ts`

Multiple functions have implicit caller contracts (e.g., the caller must manage `setCapturedBody` / `clearCapturedBody` separately). After fixing the mass wiring (section 1.1), verify that the contracts are now internal to the module — callers should not need to separately manage physics state. If any implicit contracts remain, document them with JSDoc `@remarks` annotations.

---

## 8. Coverage Escalation

### 8.1 Increase Render and UI Coverage Floors

The 50%/40% coverage floor for render and UI layers was set in iteration 5. With the asteroid belt adding significant render/UI logic (belt rendering, asteroid flight view, map visualization, capture UI), these floors should increase to maintain quality.

**New targets:**
- Render layer (`src/render/`): 50% → 55%
- UI layer (`src/ui/`): 40% → 45%

**Enforcement:** Configure Vitest's `coverage.thresholds` in `vitest.config` to fail tests if render/UI layers drop below the new floors. This enforces the floors locally and in CI.

**Approach:**
1. Set the new thresholds in vitest config
2. Run `npx vitest run --coverage` to check current state
3. If below the floors, add targeted unit tests for the lowest-coverage files in the asteroid belt feature area until the thresholds pass. Priority files:
   - `src/render/flight/_asteroids.ts` — asteroid rendering logic has testable helper functions (size categories, LOD selection)
   - `src/render/map.ts` — belt rendering helpers
   - `src/ui/flightController/_mapView.ts` — asteroid rename, map interaction
4. Re-run coverage to confirm floors are met

---

## 9. Testing Improvements

### 9.1 Add Missing test-map.json Entries

**File:** `test-map.json`

`asteroidBelt`, `settingsStore`, and `crc32` source modules have no entries. `e2e/asteroid-belt.spec.js` is not linked from the collision or grabbing entries. Running `npm run test:affected` after changes to these modules won't trigger relevant tests.

### 9.2 Add @smoke Tags

**Files:** `src/tests/autoSave.test.ts`, `src/tests/crc32.test.ts`, `src/tests/settingsStore.test.ts`, `src/tests/asteroidBelt.test.ts`

None of these files have `@smoke`-tagged tests. Pick 1-2 representative tests per file that exercise the broadest code paths and add `@smoke` to their descriptions.

### 9.3 Fix E2E Test Independence

**File:** `e2e/asteroid-belt.spec.js`

Tests within `describe` blocks share page instances via `beforeAll`/`afterAll` (lines 45-56, 163-175). If an earlier test fails, later tests are unreliable. Each test should set up its own page state.

**Fix:** Convert `beforeAll`/`afterAll` page setup to `beforeEach`/`afterEach` so each test gets a fresh page instance.

### 9.4 Unit Tests for Fixed Code

New or updated tests to cover the fixes in this iteration:

- **Physics integration:** Verify `capturedBody` is set on capture and cleared on release. Verify CoM shifts proportionally to asteroid mass and offset. Verify moment of inertia includes asteroid contribution.
- **Per-arm properties:** Verify different arm tiers have different effective range and speed limits. Verify industrial arm's 50m reach and 0.5 m/s speed. Boundary tests at exact mass limit thresholds.
- **Collision cooldown:** Verify no re-damage during cooldown period. Verify cooldown decrements and eventually allows re-collision.
- **autoSave:** Verify `_getAutoSaveKey()` returns fallback when all slots are occupied.

### 9.5 E2E Tests for Changed Behaviour

Any fix that changes user-visible behaviour needs E2E coverage. Update or add specs in `e2e/asteroid-belt.spec.js`:

- **Arm tier differences:** Verify that the Heavy arm can grab at longer range than the Standard arm. Verify the Industrial arm's slower grab speed limit.
- **Collision cooldown:** Verify a slow-speed overlap doesn't destroy the craft (damage applied once, not per-frame).
- **Thrust alignment with real physics:** After capture, verify the craft actually rotates when thrusting unaligned, and stabilises after aligning.
- **Arm tech tree progression:** Verify Heavy arm is not available until its new tier is researched (not same tier as Standard).

---

## 10. Verification

After all changes are complete, run:

1. `npm run typecheck` — no errors
2. `npm run lint` — no errors
3. `npm run test:unit` — all tests pass
4. `npm run test:e2e` — all E2E specs pass
5. `npm run build` — production build succeeds
6. `as unknown as` cast count is <= 3 in source files (was 4, minus lifeSupport fix)
7. `npx vitest run --coverage` — render layer >= 55%, UI layer >= 45%
