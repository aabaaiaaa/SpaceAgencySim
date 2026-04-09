# Iteration 6 — Tasks

All tasks reference `.devloop/requirements.md` for full context.

---

### TASK-001: Log IDB mirror failures in autoSave.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Replace the two silent `.catch(() => {})` handlers in `src/core/autoSave.ts` (lines 139 and 158) with `.catch(err => logger.debug('autoSave', 'IDB mirror write/delete failed', err))`, matching the pattern already used in `saveload.ts`. See requirements §1.1.
- **Verification**: `npx vitest run src/tests/autoSave` — if no test file exists, verify with `npm run typecheck` and confirm the two catch handlers are updated by grepping for `logger.debug.*autoSave.*IDB`.

### TASK-002: Remove unnecessary type casts in flightHud.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Remove the 9 `as unknown as Record<string, unknown>` casts in `src/ui/flightHud.ts` (lines 195, 198, 204, 433, 531, 547, 565, 827, 1148) and access `throttleMode`, `targetTWR`, and `controlMode` directly on `_ps`. Use optional chaining for null checks. Also remove the `(psAny.targetTWR as number)` downcasts. See requirements §1.2.
- **Verification**: `npm run typecheck` passes. `grep -c "as unknown as Record" src/ui/flightHud.ts` returns 0.

### TASK-003: Remove unused createListenerTracker in perfDashboard.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Remove the `createListenerTracker` import, `_tracker` variable declaration, instantiation in `_createDOM()`, and cleanup in `destroyPerfDashboard()` from `src/ui/perfDashboard.ts`. See requirements §1.3.
- **Verification**: `npm run typecheck` passes. `grep -c "createListenerTracker\|_tracker" src/ui/perfDashboard.ts` returns 0.

### TASK-004a: Define unified MissionInstance type
- **Status**: pending
- **Dependencies**: none
- **Description**: Create a `MissionInstance` type in `src/core/gameState.ts` that combines template fields from `MissionDef` (src/data/missions.ts) with runtime fields from `Mission`. Use a discriminated union or intersection type. Replace `Mission` in the `GameState` interface with `MissionInstance`. See requirements §1.4.
- **Verification**: `npm run typecheck` passes.

### TASK-004b: Migrate missions.ts to unified MissionInstance type
- **Status**: pending
- **Dependencies**: TASK-004a
- **Description**: Update `src/core/missions.ts` to use the new `MissionInstance` type, removing all 11 `as unknown as` casts. Ensure `_copyMission()`, mission acceptance, completion, and objective tracking all work with the unified type. See requirements §1.4.
- **Verification**: `npm run typecheck` passes. `grep -c "as unknown as" src/core/missions.ts` returns 0 or near-0. `npx vitest run src/tests/missions` passes.

### TASK-004c: Migrate _missionsTab.ts and save/load compatibility
- **Status**: pending
- **Dependencies**: TASK-004b
- **Description**: Update `src/ui/missionControl/_missionsTab.ts` to use the unified `MissionInstance` type, removing its 3 `as unknown as` casts. Verify save/load backward compatibility — existing saves with the old `Mission` type must load correctly into the new `MissionInstance` type. See requirements §1.4.
- **Verification**: `npm run typecheck` passes. `grep -c "as unknown as" src/ui/missionControl/_missionsTab.ts` returns 0. `npx vitest run src/tests/missions src/tests/saveload` passes.

### TASK-005a: Reduce as-unknown-as casts in period.ts, _designLibrary.ts, _postFlight.ts
- **Status**: pending
- **Dependencies**: TASK-004c
- **Description**: Eliminate `as unknown as` casts in `src/core/period.ts` (3), `src/ui/vab/_designLibrary.ts` (3), and `src/ui/flightController/_postFlight.ts` (2). For each, add missing properties to type interfaces, use type guards, or use discriminated unions. See requirements §1.5.
- **Verification**: `npm run typecheck` passes. Combined `as unknown as` count in these 3 files is 0.

### TASK-005b: Reduce as-unknown-as casts in remaining files
- **Status**: pending
- **Dependencies**: TASK-005a
- **Description**: Eliminate `as unknown as` casts in `src/ui/vab/_init.ts` (2), `src/ui/index.ts` (2), `src/ui/debugSaves.ts` (2), `src/data/contracts.ts` (2), and remaining single-cast files. Keep only genuinely necessary casts (e.g., Chrome memory API in perfMonitor.ts). Target: <10 total `as unknown as` casts across all source files. See requirements §1.5.
- **Verification**: `npm run typecheck` passes. `grep -rc "as unknown as" src/ --include="*.ts" | grep -v "test" | awk -F: '{s+=$2}END{print s}'` returns <10.

### TASK-006: Promote ESLint no-explicit-any to error
- **Status**: pending
- **Dependencies**: TASK-005b
- **Description**: In `eslint.config.js`, change `'@typescript-eslint/no-explicit-any'` from `'warn'` to `'error'` for source files. Add an override for `src/tests/**` keeping it at `'warn'`. Fix the 8 `as any` usages in `src/tests/workerBridgeTimeout.test.ts` using `Partial<T>` or test factory types. See requirements §1.6.
- **Verification**: `npm run lint` passes with no errors. `grep -c "as any" src/tests/workerBridgeTimeout.test.ts` returns 0.

### TASK-007: Add defensive guards in map.ts
- **Status**: pending
- **Dependencies**: none
- **Description**: Add `if (!_mapRoot) return` guards at the entry point of each drawing function in `src/render/map.ts` that uses `!` non-null assertions on graphics objects: `_drawBands()`, `_drawCraft()`, `_drawTransferTargets()`, `_drawCommsOverlay()`, and any other functions with `!` assertions on `_bgGraphics`, `_orbitsGraphics`, `_transferGraphics`, or `_bandsGraphics`. See requirements §1.7.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/map` passes (if test exists). No `!` assertions on graphics objects without a preceding guard in the same function.

### TASK-008: Create independent settings store
- **Status**: pending
- **Dependencies**: none
- **Description**: Create `src/core/settingsStore.ts` with functions to read/write settings independently of save files. Store in localStorage under `spaceAgency_settings`. On game load, read from the dedicated key and apply to GameState. On settings change, write to both GameState and the dedicated key. Settings to decouple: `difficultySettings`, `autoSaveEnabled`, `debugMode`, `showPerfDashboard`, `malfunctionMode`. See requirements §2.1.
- **Verification**: `npm run typecheck` passes. New module exports `loadSettings()`, `saveSettings()`, and `migrateSettings()` functions.

### TASK-009: Integrate settings store with game load/save and add migration
- **Status**: pending
- **Dependencies**: TASK-008
- **Description**: Wire `settingsStore.ts` into the game's load flow (`saveload.ts`), new game flow, and settings UI. Implement backward-compatible migration: on first load, extract settings from an existing save and write to the dedicated key. Settings changes in the UI write to both GameState and the settings store. See requirements §2.2.
- **Verification**: `npx vitest run src/tests/saveload src/tests/settingsStore` passes. Manual: change a setting, delete save, start new game — setting persists.

### TASK-010: Write unit tests for settings store
- **Status**: pending
- **Dependencies**: TASK-009
- **Description**: Write unit tests for `settingsStore.ts` covering: read/write round-trip, migration from old save format, independent persistence (change setting, verify it survives without a save), default values when no settings exist. Mock localStorage.
- **Verification**: `npx vitest run src/tests/settingsStore` passes with all new tests green.

### TASK-011: Implement CRC-32 utility
- **Status**: pending
- **Dependencies**: none
- **Description**: Create `src/core/crc32.ts` implementing CRC-32 using lookup-table approach (polynomial 0xEDB88320). Export a `crc32(data: Uint8Array): number` pure function. No dependencies. See requirements §3.2.
- **Verification**: `npx vitest run src/tests/crc32` passes with known test vectors (empty input, "123456789" → 0xCBF43926).

### TASK-012: Implement save export envelope format
- **Status**: pending
- **Dependencies**: TASK-011
- **Description**: Update save export/import in `src/core/saveload.ts` to use the binary envelope: magic bytes "SASV", format version uint16, CRC-32 checksum, payload length, then the existing LZC-compressed payload. Export encodes as base64. Import validates magic bytes, checksum, and payload length. Fall back to raw LZC import for old-format saves. See requirements §3.1.
- **Verification**: `npx vitest run src/tests/saveload src/tests/crc32` passes. Round-trip test: export → import produces identical save data.

### TASK-013: Write unit tests for save export format
- **Status**: pending
- **Dependencies**: TASK-012
- **Description**: Write unit tests covering: export round-trip integrity, corrupted checksum detection (flip a byte, verify import fails with clear error), corrupted magic bytes detection, truncated payload detection, old-format backward compatibility (raw LZC string imports successfully).
- **Verification**: `npx vitest run src/tests/saveload` passes with all new tests green.

### TASK-014: Convert flightHud and contractsTab to CSS custom properties
- **Status**: pending
- **Dependencies**: none
- **Description**: In `src/ui/flightHud.ts`, replace `style.height` and `style.color` assignments for throttle bar, TWR bar, velocity color, comms color, and TWR color with `style.setProperty('--prop-name', value)`. Add corresponding CSS rules using `var()`. In `src/ui/missionControl/_contractsTab.ts`, convert remaining direct style assignments to CSS custom properties. Leave `style.display` toggles as-is. See requirements §4.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds. `grep -c "\.style\.height\|\.style\.color" src/ui/flightHud.ts` returns 0 (excluding display toggles).

### TASK-015: Define asteroid belt zone data
- **Status**: pending
- **Dependencies**: none
- **Description**: Add asteroid belt zone definitions to `src/data/bodies.ts` as new Sun altitude bands. Three zones: Outer Belt A (2.2–2.5 AU), Dense Belt (2.5–2.8 AU, flagged unsafe), Outer Belt B (2.8–3.2 AU). Add a `beltZone` property to the altitude band type identifying each zone. Add any new constants needed in `src/core/constants.ts` (e.g., `BeltZone` enum). See requirements §5.1.
- **Verification**: `npm run typecheck` passes. The Sun body in `bodies.ts` has 3 new altitude bands with correct AU distances and belt zone identifiers.

### TASK-016: Implement asteroid belt map visualization
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: Add a belt rendering pass to `src/render/map.ts` that draws: (1) scattered dots across all 3 zones from a fixed seed, denser in the inner zone, brownish/amber colored; (2) semi-transparent amber danger zone shading (#884422, ~12% opacity) on the dense belt only, with faint dashed boundary lines; (3) "⚠ Dense Belt" label visible at appropriate zoom. No shading on outer zones. See requirements §5.2.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds. Manual: open solar system map in dev, verify belt dots and danger zone are visible beyond Mars orbit.

### TASK-017: Implement procedural asteroid generation
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: Create `src/core/asteroidBelt.ts` with asteroid generation logic. When the player enters ORBIT phase within a belt zone, generate N asteroids (10 for outer, 30 for dense) with random position, co-orbital velocity, size (1m–1km, weighted small, dense zone weighted larger), shape seed, and auto-generated `AST-XXXX` name. Asteroids persist for the orbit session and regenerate on next visit. Define the asteroid data model extending or compatible with the existing `TransferObject` interface. See requirements §5.3.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/asteroidBelt` passes — tests verify correct count per zone, size distribution, position within render distance.

### TASK-018: Write unit tests for asteroid generation
- **Status**: pending
- **Dependencies**: TASK-017
- **Description**: Write unit tests for `asteroidBelt.ts` covering: correct asteroid count per zone type (10/30), size distribution (weighted toward smaller), all asteroids within render distance, co-orbital velocity range, unique names generated, regeneration produces different set.
- **Verification**: `npx vitest run src/tests/asteroidBelt` passes with all new tests green.

### TASK-019: Render asteroids in flight view
- **Status**: pending
- **Dependencies**: TASK-017
- **Description**: Extend `src/render/flight/_transferObjects.ts` (or create a new `_asteroids.ts` sub-module) to render belt asteroids in the flight view. Use the existing LOD system: full LOD shows irregular polygon with craters (brownish/amber), basic LOD shows ellipse, streak LOD shows trail. Size-based detail: small (1–10m) rough dots, medium (10–100m) irregular polygon, large (100m–1km) polygon with crater marks and "LANDABLE" label. All asteroids get a dashed targeting circle when selected. See requirements §5.3.
- **Verification**: `npm run typecheck` passes. `npm run build` succeeds. Manual: teleport to belt orbit in dev, verify asteroids render with correct LOD and selection indicators.

### TASK-020: Integrate asteroid selection with map targeting system
- **Status**: pending
- **Dependencies**: TASK-017, TASK-016
- **Description**: When the player is in ORBIT phase within a belt zone, the generated asteroids should appear on the map as selectable objects near the player's position. Integrate with the existing T-key cycling (`cycleMapTarget`) and targeting system in `src/render/map.ts` and `src/ui/flightController/_keyboard.ts`. All flight-view asteroids are targetable regardless of size. Show name, size, and distance info for the selected asteroid. See requirements §5.2, §5.3.
- **Verification**: `npm run typecheck` passes. Manual: in belt orbit, press T to cycle through asteroids, verify name/size/distance displayed in map HUD.

### TASK-021: Implement asteroid collision with player craft
- **Status**: pending
- **Dependencies**: TASK-017
- **Description**: Extend `src/core/collision.ts` to detect collisions between the player craft AABB and asteroid circular boundaries. Implement velocity-based damage: <1 m/s no damage, 1–5 m/s minor part damage, 5–20 m/s outer parts destroyed, >20 m/s catastrophic. Asteroids only collide with the player craft (no asteroid-asteroid collision). See requirements §5.4.
- **Verification**: `npx vitest run src/tests/collision src/tests/asteroidBelt` passes — tests verify damage thresholds at each velocity band.

### TASK-022: Write unit tests for asteroid collision
- **Status**: pending
- **Dependencies**: TASK-021
- **Description**: Write unit tests for asteroid collision covering: no damage below 1 m/s, minor damage at 1–5 m/s, significant damage at 5–20 m/s, catastrophic damage above 20 m/s, collision detection with varying asteroid radii, no false positives when out of range.
- **Verification**: `npx vitest run src/tests/collision` passes with all new tests green.

### TASK-023: Implement unsafe belt orbit hub-return block
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: Extend the "return to hub" check to block returning when the player's orbit is within the dense belt zone. Reuse the existing pattern where return-to-hub is blocked during transfer phase. Show message: "Cannot return to hub — orbit is within the dense asteroid belt. Manoeuvre to a safe orbit first." Outer belt zones and all other Sun orbits are safe. See requirements §5.1, §5.10.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/flightPhase src/tests/asteroidBelt` passes — test verifies hub return blocked in dense belt, allowed in outer belt.

### TASK-024: Add heavy and industrial grabbing arm parts
- **Status**: pending
- **Dependencies**: TASK-015
- **Description**: Add two new grabbing arm variants to `src/data/parts.ts`: Heavy Grabbing Arm (medium mass limit, mid-tier tech unlock) and Industrial Grabbing Arm (large mass limit for up to 1km asteroids, high-tier tech unlock). Add corresponding `PartType` constants if needed. Add tech tree nodes in `src/data/techtree.ts` (or equivalent). The existing Grabbing Arm becomes the light tier. Define mass thresholds for each tier. See requirements §5.6.
- **Verification**: `npm run typecheck` passes. The parts catalog contains 3 grabbing arm variants with distinct mass limits, costs, and tech requirements.

### TASK-025: Extend grabbing system to target asteroids
- **Status**: pending
- **Dependencies**: TASK-017, TASK-024
- **Description**: Update `src/core/grabbing.ts` to allow `getGrabTargetsInRange()` to return asteroid objects (not just SATELLITE type). When the grabbed object is an asteroid, offer "Capture" action instead of "Repair". Enforce mass limits per arm tier — if the asteroid exceeds the arm's max capture mass, fail with a message. See requirements §5.5, §5.6.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/grabbing` passes — tests verify asteroid targeting, capture action, and mass limit enforcement.

### TASK-026: Implement captured asteroid physics (mass + CoM shift)
- **Status**: pending
- **Dependencies**: TASK-025
- **Description**: When an asteroid is captured, add its mass to the craft's total mass in the physics calculations (`src/core/physics.ts`). Compute the combined centre of mass based on craft mass, asteroid mass, and grapple attachment point. If thrust does not pass through the combined CoM, apply rotational torque (craft spins). See requirements §5.5, §5.7.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/physics src/tests/grabbing` passes — tests verify mass increase, CoM shift, and rotational effect.

### TASK-027: Implement thrust alignment action
- **Status**: pending
- **Dependencies**: TASK-026
- **Description**: Add an "Align Thrust" player action to the grabbing arm UI. When activated, the arm articulates to position the captured asteroid so the engine thrust vector passes through the combined CoM, eliminating rotational torque. The player can still manually rotate the assembly before/after alignment. Re-aligning is needed after manual rotation. See requirements §5.7.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/grabbing` passes — tests verify alignment eliminates torque, manual rotation breaks alignment, re-align restores it.

### TASK-028: Implement captured asteroid persistence
- **Status**: pending
- **Dependencies**: TASK-025
- **Description**: When the player releases a captured asteroid while orbiting outside all belt zones, convert it to a persistent `OrbitalObject` in `gameState.orbitalObjects` with `type: 'asteroid'`, `bodyId: 'SUN'`, computed orbital elements from the craft's current orbit, and preserved radius/mass. If released inside a belt zone, the asteroid simply detaches and returns to the procedural field. See requirements §5.8.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/asteroidBelt src/tests/grabbing` passes — tests verify persistence outside belt, non-persistence inside belt, correct orbital elements.

### TASK-029: Add asteroid rename UI
- **Status**: pending
- **Dependencies**: TASK-028
- **Description**: Add a rename action for captured (persistent) asteroids in the map view UI. When targeting a persistent asteroid (type 'asteroid' in orbitalObjects), show a rename option. Auto-generated `AST-XXXX` name is the default. Player enters a new name. Update the orbital object's name in gameState. See requirements §5.8.
- **Verification**: `npm run typecheck` passes. Manual: target a persistent asteroid on the map, rename it, verify the new name appears in the map and targeting HUD.

### TASK-030: Implement asteroid landing
- **Status**: pending
- **Dependencies**: TASK-017
- **Description**: Asteroids above ~100m radius are landable. Derive surface gravity from mass and radius (rock density ~2,500 kg/m³). Integrate with the existing landing system using asteroid-specific parameters: very low gravity, no atmosphere, no drag. Mark large asteroids as "LANDABLE" in the flight view targeting info. See requirements §5.9.
- **Verification**: `npm run typecheck` passes. `npx vitest run src/tests/asteroidBelt src/tests/physics` passes — tests verify gravity calculation, landing detection on large asteroid, non-landable for small asteroid.

### TASK-031: E2E — Belt map visualization and zone detection
- **Status**: pending
- **Dependencies**: TASK-016, TASK-017, TASK-023
- **Description**: Write E2E tests in `e2e/asteroid-belt.spec.js` covering: belt visible on solar system map (dots + danger zone at correct distances), orbit detection in belt zones (teleport to belt, circularise, verify asteroid count), and unsafe orbit hub-return block (dense belt blocks hub return, outer belt allows it). See requirements §6.2.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.js` passes.

### TASK-032: E2E — Asteroid selection, collision, and transfer safety
- **Status**: pending
- **Dependencies**: TASK-020, TASK-021
- **Description**: Add E2E tests to `e2e/asteroid-belt.spec.js` covering: all asteroids targetable via T-key cycling with name/size/distance, collision damage at speed, and transfer trajectory through belt with no asteroids spawning. See requirements §6.2.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.js` passes.

### TASK-033: E2E — Asteroid capture, alignment, persistence, and arm tiers
- **Status**: pending
- **Dependencies**: TASK-027, TASK-028, TASK-029
- **Description**: Add E2E tests to `e2e/asteroid-belt.spec.js` covering: capture with grabbing arm (approach, match velocity, capture, mass change), thrust alignment action, captured asteroid persistence when released outside belt, asteroid rename, and arm tier mass limit enforcement (attempt capture with too-small arm). See requirements §6.2.
- **Verification**: `npx playwright test e2e/asteroid-belt.spec.js` passes.

### TASK-034: Verification pass — run all checks
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004c, TASK-005b, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023, TASK-024, TASK-025, TASK-026, TASK-027, TASK-028, TASK-029, TASK-030, TASK-031, TASK-032, TASK-033
- **Description**: Run the full verification suite: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:e2e`, `npm run build`. Verify `as unknown as` cast count is <10 in source files. Confirm all new E2E belt specs pass. See requirements §7.
- **Verification**: All 5 commands pass with zero errors. `grep -rc "as unknown as" src/ --include="*.ts" | grep -v test | awk -F: '{s+=$2}END{print s}'` returns <10.
