# Iteration 6 — Type Safety Hardening, Settings/Save Improvements, and Asteroid Belt

This iteration addresses all actionable findings from the iteration 5 code review, adds independent settings persistence and save export integrity, converts dynamic inline styles to CSS custom properties, and introduces the asteroid belt as a major new gameplay feature.

The codebase is ~60,400 lines of TypeScript across 154 source modules, with ~2,815 unit tests and 39 E2E specs. All work builds on the existing codebase.

---

## 1. Review Fix-ups

### 1.1 Log IDB Mirror Failures in autoSave.ts

**Files:** `src/core/autoSave.ts:139,158`

Two silent `.catch(() => {})` handlers on IDB operations swallow failures. `saveload.ts` already logs these via `logger.debug()`.

**Fix:**
- Replace `idbSet(saveKey, compressed).catch(() => {})` at line 139 with `.catch(err => logger.debug('autoSave', 'IDB mirror write failed', err))`
- Replace `idbDelete(AUTO_SAVE_KEY).catch(() => {})` at line 158 with `.catch(err => logger.debug('autoSave', 'IDB mirror delete failed', err))`

### 1.2 Remove Unnecessary Type Casts in flightHud.ts

**File:** `src/ui/flightHud.ts`

Nine `as unknown as Record<string, unknown>` casts access `throttleMode`, `targetTWR`, and `controlMode` on `_ps` — but `PhysicsState` already declares all three properties (`physics.ts:352,354,400`). The casts bypass type checking unnecessarily.

**Fix:**
- Remove all 9 casts (lines 195, 198, 204, 433, 531, 547, 565, 827, 1148) and access properties directly on `_ps`
- Replace `(psAny.targetTWR as number)` downcasts with direct access since the property is already typed as `number`
- Use optional chaining for the `_ps` null check where needed (e.g., `_ps?.throttleMode`)

### 1.3 Remove Unused Listener Tracker in perfDashboard.ts

**File:** `src/ui/perfDashboard.ts`

`createListenerTracker()` is imported (line 17), instantiated (line 50), and cleaned up (line 242), but `_tracker.add()` is never called. No listeners are routed through it.

**Fix:**
- Remove the `createListenerTracker` import
- Remove the `_tracker` variable declaration, instantiation in `_createDOM()`, and cleanup in `destroyPerfDashboard()`

### 1.4 Unify Mission / MissionDef Types

**Files:** `src/core/gameState.ts`, `src/data/missions.ts`, `src/core/missions.ts`, `src/ui/missionControl/_missionsTab.ts`

`Mission` (gameState.ts:209-232) and `MissionDef` (data/missions.ts:207-234) are incompatible types. `missions.ts` has 11 `as unknown as` casts bridging between them. The code treats stored missions as a hybrid containing both runtime state (`deadline`, `acceptedDate`) and template properties (`objectives`, `unlockedParts`).

**Fix:**
- Create a `MissionInstance` type that combines template fields from `MissionDef` with runtime fields from `Mission` using a discriminated union or intersection type
- Replace `Mission` in `GameState` with `MissionInstance`
- Update `missions.ts` to work with the unified type, eliminating all 11 casts
- Update `_missionsTab.ts` to use the unified type, eliminating its 3 casts
- Ensure save/load serialization handles the new type (backward compatible with existing saves)

### 1.5 Reduce Remaining `as unknown as` Casts

**Current state:** 51 casts across 18 source files. After fixing flightHud (9) and missions (11+3), ~28 remain across 15 files.

**Target:** Reduce remaining casts to <10 by addressing the concentrated files:
- `period.ts` (3 casts) — crew/mission type narrowing
- `_designLibrary.ts` (3 casts) — staging data serialization
- `_postFlight.ts` (2 casts) — mission result types
- `_init.ts` in vab (2 casts) — part type narrowing
- `index.ts` in ui (2 casts) — module type coercion
- `debugSaves.ts` (2 casts) — debug utility types
- `contracts.ts` (2 casts) — contract type narrowing
- Remaining single-cast files where the fix is straightforward

For each cast, either: add the missing property to the type interface, use a proper type guard, or use a discriminated union. Keep `as unknown as` only where the cast is genuinely necessary (e.g., justified Chrome-only API access in `perfMonitor.ts`).

### 1.6 Promote ESLint no-explicit-any to Error

**File:** `eslint.config.js:87`

Currently `'@typescript-eslint/no-explicit-any': 'warn'`. Zero `as any` exists in source files; 8 remain in test files (`workerBridgeTimeout.test.ts`).

**Fix:**
- Set `'@typescript-eslint/no-explicit-any': 'error'` for source files
- Keep `'warn'` for test files via an override block matching `src/tests/**`
- Fix the 8 `as any` usages in `workerBridgeTimeout.test.ts` by using `Partial<T>` or test factory types

### 1.7 Defensive Guards in map.ts

**File:** `src/render/map.ts`

Non-null assertions (`!`) are used on `_bgGraphics`, `_orbitsGraphics`, `_transferGraphics`, `_bandsGraphics` throughout drawing functions. While `renderMapFrame()` has a top-level `if (!_mapRoot) return` guard, the individual drawing functions called from it don't guard independently.

**Fix:**
- Add `if (!_mapRoot) return` guards at the entry point of each drawing function that uses graphics objects: `_drawBands()`, `_drawCraft()`, `_drawTransferTargets()`, and any other functions with `!` assertions
- This protects against edge cases during destroy/init transitions where a function might be called after the root is destroyed but before the calling code checks

---

## 2. Independent Settings Persistence

### 2.1 Settings Store

**Current state:** All settings (`difficultySettings`, `autoSaveEnabled`, `debugMode`, `showPerfDashboard`, `malfunctionMode`) live inside `GameState` and are saved/loaded per save slot. Deleting a save loses settings. Starting a new game resets settings.

**Target:** Settings persist independently of save files, surviving save deletion and new game creation.

**Approach:**
- Create a `SettingsStore` module at `src/core/settingsStore.ts`
- Store settings in localStorage under a dedicated key (e.g., `spaceAgency_settings`), separate from save slot keys
- On game load: read settings from the dedicated key, apply to `GameState`
- On settings change: write to both `GameState` (for current session) and the dedicated settings key (for persistence)
- On new game: read persisted settings and apply them as defaults
- Backward compatibility: if no dedicated settings key exists (first run after update), extract settings from the loaded save and write them to the new key

**Settings to decouple:**
- `difficultySettings` (the full `DifficultySettings` object)
- `autoSaveEnabled`
- `debugMode`
- `showPerfDashboard`
- `malfunctionMode`
- `useWorkerPhysics` (if it exists as a setting)

**Settings that stay in GameState:** Any setting that is inherently per-save (e.g., tutorial completion flags, per-save progression markers).

### 2.2 Migration

On first load after this change:
1. Check if `spaceAgency_settings` exists in localStorage
2. If not, check if any save slot exists
3. If a save exists, extract settings from it and write to `spaceAgency_settings`
4. Future loads always read from `spaceAgency_settings`

---

## 3. Save Export Format

### 3.1 Binary Envelope

**Current state:** Save data is JSON stringified, compressed with lz-string (`LZC:` prefix), and stored in localStorage as a string. Export copies this string. No integrity checking — a corrupted export silently loads garbage or fails with an opaque JSON parse error.

**Target:** Exported saves have a structured envelope with magic bytes, version header, and CRC checksum for integrity verification.

**Envelope structure:**
```
Bytes 0-3:   Magic bytes "SASV" (Space Agency Save, ASCII)
Bytes 4-5:   Format version (uint16, big-endian) — starts at 1
Bytes 6-9:   CRC-32 checksum of the payload (uint32, big-endian)
Bytes 10-13: Payload length in bytes (uint32, big-endian)
Bytes 14+:   Payload (the existing LZC-compressed JSON string, UTF-8 encoded)
```

**On export:**
1. Serialize save data as usual (JSON → LZC compress)
2. Compute CRC-32 of the compressed payload
3. Write the envelope header + payload
4. Encode as base64 for clipboard/file download

**On import:**
1. Decode base64
2. Verify magic bytes ("SASV")
3. Read version, checksum, payload length
4. Verify CRC-32 matches payload
5. If valid: decompress and load as usual
6. If invalid: show clear error ("Save file is corrupted" / "Unrecognized save format")

**Backward compatibility:** If import data doesn't start with "SASV" magic bytes, fall back to the current import path (raw LZC string). This allows importing old-format saves.

### 3.2 CRC-32 Implementation

Use a lookup-table-based CRC-32 implementation (standard polynomial 0xEDB88320). Small, fast, no dependencies. Implement in `src/core/crc32.ts` as a pure function.

---

## 4. CSS Custom Properties for Dynamic Styles

### 4.1 Flight HUD Dynamic Styles

**File:** `src/ui/flightHud.ts`

14+ inline style assignments set dynamic values (heights, colors, display). Convert to CSS custom properties where the value changes at runtime but the CSS rule is static.

**Pattern:**
```javascript
// Before:
_elThrottleFill.style.height = `${pct}%`;

// After:
_elThrottleFill.style.setProperty('--throttle-pct', `${pct}%`);
// CSS: .throttle-fill { height: var(--throttle-pct, 0%); }
```

**Candidates for conversion:**
- Throttle bar height (`style.height` — percentage)
- TWR bar height (`style.height` — percentage)
- Velocity color (`style.color` — dynamic color selection)
- Comms color (`style.color`)
- TWR color (`style.color`)

**Not converted (leave as inline):**
- `style.display` toggles (show/hide) — these are binary state changes, CSS custom properties add no value

### 4.2 Contracts Tab Dynamic Styles

**File:** `src/ui/missionControl/_contractsTab.ts`

Reputation bar uses `repBar.style.setProperty('--rep-color', ...)` for color (already a CSS custom property) but width and background-color are set directly.

**Fix:**
- Convert `repFill.style.width` to `--rep-width` custom property
- Convert remaining direct style assignments to CSS custom properties
- Define corresponding CSS rules in the module's CSS file

---

## 5. Asteroid Belt

### 5.1 Belt Zone Definitions

Three concentric orbital zones around the Sun, beyond Mars (~1.52 AU):

| Zone | Inner Edge | Outer Edge | AU Range | Type | Flight View Asteroids |
|------|-----------|-----------|----------|------|----------------------|
| Outer Belt A | 329,000,000 km | 374,000,000 km | 2.2–2.5 AU | Safe orbit | ~10 |
| Dense Belt | 374,000,000 km | 419,000,000 km | 2.5–2.8 AU | Unsafe orbit | ~30 |
| Outer Belt B | 419,000,000 km | 479,000,000 km | 2.8–3.2 AU | Safe orbit | ~10 |

**Data definition:** Add belt zones to the Sun's altitude bands in `src/data/bodies.ts`. Each zone is a new `AltitudeBand` entry with a `beltZone` property identifying it as `'outer_a'`, `'dense'`, or `'outer_b'`.

**Unsafe orbit mechanic:** The dense belt zone is flagged as unsafe. The existing "return to hub" check (which already prevents returning during transfer) is extended to also prevent returning when the player's orbit falls within the dense belt altitude band. The player must manoeuvre to any safe orbit (outer belt, or outside the belt entirely) before returning to hub.

### 5.2 Map Visualization

**Rendering approach:** Add a belt rendering pass to `src/render/map.ts` that draws:

1. **Scattered dots** — Procedurally placed dots across all three zones representing the visual density of the belt. Dots are static (not orbiting) and generated from a fixed seed so they don't change between frames. Density is higher in the inner zone. Dots are small (1-2px), brownish/amber colored (#998877 for outer, #cc9966 for inner), with varying opacity.

2. **Danger zone shading** — A semi-transparent amber fill (#884422 at ~12% opacity) covering only the dense inner belt zone. Bounded by faint dashed lines at the inner and outer edges with AU distance labels visible when zoomed in.

3. **Zone label** — "⚠ Dense Belt" text centered on the inner zone, visible at appropriate zoom levels.

**No shading on outer zones** — safe zones are the default state and don't need visual highlighting.

**Zoom behavior:** At solar system zoom, the belt appears as a ring of dots with the amber danger zone visible. When zoomed into the belt region, individual zone boundaries become clearer and the dots are larger/more distinct. When zoomed to orbit-level within the belt, the map shows the player's orbit and any nearby trackable asteroids as selectable objects.

**Selectable asteroids on map:** When the player is in ORBIT phase within a belt zone, the procedurally generated asteroids (from the flight view) are also shown on the map as selectable orbital objects. They appear near the player's position and can be targeted with the existing T-key cycling and targeting system.

### 5.3 Flight View Asteroid Rendering

**When asteroids appear:** Only when the player is in ORBIT phase and their orbit falls within a belt zone altitude band. Transfer phase passes through safely with no asteroids rendered. The player must circularise their orbit within a belt zone for asteroids to spawn.

**Procedural generation:** On entering orbit within a belt zone:
- Generate N asteroids (10 for outer zones, 30 for dense zone) within the flight view render distance
- Each asteroid gets:
  - Random position within render distance of the player
  - Random velocity — co-orbital with small relative speed (these are objects in similar solar orbits)
  - Random size: 1m–1km, weighted toward smaller sizes. Dense zone has a higher weight toward larger asteroids.
  - Random shape seed for rendering (irregular polygons)
  - Auto-generated name: `AST-XXXX` (4-digit random ID)
- Asteroids persist for the duration of that orbit session
- Regenerated fresh on next visit (procedural each visit)

**Rendering LOD:** Reuse the existing transfer object LOD system from `src/render/flight/_transferObjects.ts`:
- **Full LOD** (low relative speed): Irregular polygon shape with crater details, brownish/amber color palette
- **Basic LOD** (medium relative speed): Simple filled ellipse
- **Streak LOD** (high relative speed): Shooting star effect — should be rare since co-orbital objects have low relative speeds

**All asteroids are trackable/selectable** regardless of size. The player can cycle through them (T key) and see name, size, and distance info. Selected asteroids get a dashed targeting circle.

**Size-based visual detail:**
- Small (1–10m): Rendered as small rough circles/dots
- Medium (10–100m): Irregular polygon, a few surface details
- Large (100m–1km): Larger irregular polygon with multiple crater marks, labeled as "LANDABLE" if above the landing threshold

### 5.4 Asteroid Collision

**Damage model:** Velocity-based only. Damage scales with relative velocity at impact, regardless of asteroid size.

- Very low relative speed (< 1 m/s): No damage — this is the docking/capture speed range
- Low relative speed (1–5 m/s): Minor bump, possible part damage to outermost parts
- Medium relative speed (5–20 m/s): Significant damage, outer parts destroyed
- High relative speed (> 20 m/s): Catastrophic — likely total craft destruction

**Collision detection:** Extend the existing collision system (`src/core/collision.ts`) to check player craft AABB against asteroid circular boundaries. Asteroids use their `radius` field for collision bounds.

**Asteroid-asteroid collision:** Not simulated — asteroids only collide with the player craft.

### 5.5 Grabbing Arm Extension for Asteroid Capture

**Existing system:** `src/core/grabbing.ts` has a full grab state machine (IDLE → APPROACHING → EXTENDING → GRABBED → RELEASING) that targets SATELLITE-type orbital objects. The Grabbing Arm part (`src/data/parts.ts:2375`) has 25m range and 1.0 m/s max grab speed.

**Extension for asteroids:**
1. **Target expansion:** `getGrabTargetsInRange()` accepts asteroid objects in addition to SATELLITE-type objects
2. **Capture action:** When grabbed object is an asteroid, offer "Capture" action (instead of "Repair" for satellites). Capture attaches the asteroid to the craft.
3. **Combined mass physics:** Once captured, the asteroid's mass is added to the craft's total mass. This dramatically changes thrust-to-weight ratio and delta-v budget.
4. **Centre of mass shift:** The combined CoM shifts toward the asteroid based on relative masses and grapple attachment point.

### 5.6 Grabbing Arm Tiers

Three tiers of grabbing arm, each with different mass limits for asteroid capture:

| Tier | Part Name | Max Capture Mass | Tech Tree Level | Cost |
|------|-----------|-----------------|-----------------|------|
| Light | Grabbing Arm (existing) | Small asteroids (TBD kg threshold) | Current level | 35,000 (existing) |
| Medium | Heavy Grabbing Arm | Medium asteroids | Mid-tier unlock | TBD |
| Heavy | Industrial Grabbing Arm | Large asteroids (up to 1km) | High-tier unlock | TBD |

The existing Grabbing Arm becomes the light tier with no changes to its current satellite-grabbing functionality. Medium and heavy tiers are new parts with higher mass, cost, and power draw.

Attempting to capture an asteroid that exceeds the arm's mass limit fails with a message (e.g., "Asteroid too massive for this grabbing arm").

### 5.7 Thrust Alignment After Capture

**Problem:** After capturing an asteroid, the combined centre of mass shifts. If engines thrust through the old CoM (craft-only), the craft spins.

**Mechanic:**
- After capture, the craft is controllable but misaligned — thrust doesn't pass through the combined CoM, causing rotation
- The player can **manually rotate** the craft+asteroid assembly to orient it as desired (e.g., spin the asteroid around to a preferred orientation before pushing)
- When ready, the player activates **"Align Thrust"** action — the grabbing arm articulates to position the asteroid so that the craft's engine thrust vector passes through the combined CoM
- After alignment, thrust is stable and the player can manoeuvre normally (accounting for the increased mass)
- If the player wants to reorient, they can manually rotate and re-align

**Physics impact of captured asteroid:**
- Total mass increases (craft mass + asteroid mass)
- Delta-v budget recalculated based on new total mass
- TWR drops proportionally
- Very large asteroids may make the craft nearly immovable with small engines

### 5.8 Persistent Captured Asteroids

**Capture → persistence flow:**
1. Player grabs asteroid with grabbing arm → asteroid attached to craft
2. Player manoeuvres craft (with attached asteroid) to an orbit outside the belt zones
3. Player releases the asteroid → it becomes a persistent `OrbitalObject` in `gameState.orbitalObjects`
4. The asteroid's orbital elements are computed from the craft's current orbit at release time
5. The asteroid appears on the solar system map as a permanent tracked object orbiting the Sun

**Persistent asteroid data:**
- Added to `gameState.orbitalObjects` with `type: 'asteroid'`
- `bodyId: 'SUN'`
- `name`: Initially the auto-generated `AST-XXXX` name
- Player can rename captured asteroids (new UI action on the map view when targeting a captured asteroid)
- `radius` and `mass` preserved from the original procedural asteroid
- Standard `OrbitalElements` for its Sun orbit

**Revisiting:** The player can target and travel to captured asteroids like any other orbital object — transfer, capture orbit, dock/land.

### 5.9 Landing on Large Asteroids

Asteroids above a size threshold (TBD, likely ~100m+ radius) are landable with very low surface gravity.

**Gravity model:** Derive surface gravity from asteroid mass and radius. For a 1km asteroid with rock density (~2,500 kg/m³), surface gravity is ~0.001 m/s² — essentially microgravity. Landing is more like a very slow docking with the surface.

**Landing behavior:**
- Reuse existing landing system with asteroid-specific parameters
- Very low touchdown speed tolerance (surface gravity is negligible)
- No atmosphere, no drag
- Player can deploy instruments, collect science data (future mission hook)

### 5.10 Belt-Specific Flight Phase Considerations

**Transfer phase through belt region:** When the player is on a transfer trajectory that passes through the belt region (e.g., Mars → outer solar system), no asteroids spawn. The player is safe during transfer. Asteroids only appear when the player circularises into orbit within a belt zone.

**Orbit detection in belt zones:** The existing orbit detection system (`evaluateAutoTransitions` in `flightPhase.ts`) determines when the player achieves a stable orbit. When this orbit falls within a belt zone altitude band (checked against the Sun's altitude bands), asteroid generation is triggered.

**Returning to hub from belt:** The "return to hub" action checks whether the player's current orbit is in a safe zone. If the orbit is within the dense belt zone, the action is blocked with a message (e.g., "Cannot return to hub — orbit is within the dense asteroid belt. Manoeuvre to a safe orbit first."). This reuses the existing pattern where return-to-hub is blocked during certain flight phases.

---

## 6. Testing

### 6.1 Unit Tests for New Code

- **autoSave IDB logging** — verify `.catch()` handlers call `logger.debug()` (mock IDB failure)
- **MissionInstance type** — verify type unification handles existing save data, backward compatibility
- **settingsStore** — read/write settings independently of saves, migration from old format
- **crc32** — known test vectors (empty string, "123456789", etc.)
- **Save export envelope** — round-trip: export → import produces identical save data; corrupted checksum detected; old-format import still works
- **Asteroid generation** — correct count per zone (10/30), size distribution, position within render distance
- **Asteroid collision** — velocity-based damage thresholds, no damage at <1 m/s
- **Grabbing arm asteroid capture** — mass limit enforcement per tier, target type expansion
- **Thrust alignment** — CoM calculation with attached asteroid, alignment action effect
- **Belt zone safety** — orbit in dense belt flagged as unsafe, outer belt flagged as safe

### 6.2 E2E Tests for Asteroid Belt

New E2E specs in `e2e/asteroid-belt.spec.js`:

- **Belt visible on map** — open solar system map, verify belt dots and danger zone shading are rendered at the correct orbital distances
- **Belt zone orbit detection** — teleport craft to belt region, circularise orbit, verify asteroids spawn in flight view with correct count (10 for outer, 30 for dense)
- **Asteroid selection** — in orbit within belt, verify all asteroids are targetable via T-key cycling, verify name/size/distance displayed
- **Asteroid collision** — fly craft into asteroid at speed, verify damage/destruction occurs
- **Asteroid capture** — equip grabbing arm, approach asteroid, match velocity, capture, verify asteroid attached and mass changes
- **Thrust alignment** — after capture, verify misalignment effect, activate align thrust, verify stable thrust
- **Captured asteroid persistence** — capture asteroid, manoeuvre outside belt, release, verify asteroid appears as persistent orbital object on map
- **Unsafe orbit hub block** — orbit in dense belt, attempt return to hub, verify blocked with appropriate message
- **Transfer safety** — transfer trajectory through belt region, verify no asteroids spawn during transfer phase
- **Grabbing arm tier limits** — attempt to capture asteroid exceeding arm mass limit, verify failure message

### 6.3 Existing Test Impact

The following changes may affect existing tests:
- `Mission`/`MissionDef` type unification — any tests that construct `Mission` objects will need type updates
- ESLint `error` promotion — test files need their `as any` usages fixed
- Settings decoupling — save/load tests that check for settings in save data
- Map renderer changes — existing map E2E tests should still pass (belt is additive)

---

## 7. Verification

After all changes are complete, run:

1. `npm run typecheck` — no errors
2. `npm run lint` — no errors (with `no-explicit-any: error` for source files)
3. `npm run test:unit` — all tests pass
4. `npm run test:e2e` — all E2E specs pass (including new belt specs)
5. `npm run build` — production build succeeds
6. `as unknown as` cast count is <10 in source files
7. Manual verification: open solar system map — belt visible with danger zone shading. Transfer to belt region. Circularise in outer belt — 10 asteroids appear. Circularise in dense belt — 30 asteroids, hub return blocked. Capture asteroid with grabbing arm, align thrust, manoeuvre outside belt, release — asteroid persists on map.
