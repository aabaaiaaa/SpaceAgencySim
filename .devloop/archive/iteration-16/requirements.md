# Iteration 16 — IndexedDB Migration, Cleanup & Dependency Upgrades

**Date:** 2026-04-15
**Scope:** Full IndexedDB migration (drop localStorage), remove backward-compat code, dependency major version jumps, bug fixes, notification queue, CLAUDE.md corrections, coverage exclusion maintenance
**Builds on:** Iteration 15 (overflow save fix, notification guard, helper extraction, import cleanup)
**Review driving this iteration:** `.devloop/archive/iteration-15/review.md`

---

## 1. Dependency Major Version Jumps (First)

These must be completed before all other tasks in this iteration so that everything is built and tested against the new versions. If breaking changes surface, they are resolved here rather than discovered mid-iteration.

### 1a. Vite 6 → 8

Upgrade Vite to the latest v8 release. Review the Vite 7 and Vite 8 migration guides for breaking changes. Key areas to check:

- `vite.config.ts` — any deprecated config options, changed defaults, or removed APIs
- `resolve.extensions` behavior — the codebase relies on this to resolve `.ts` files from `.js` import specifiers
- Dev server and build output — verify `npm run dev` and `npm run build` both work
- HMR behavior — spot-check that hot module replacement still functions

### 1b. Vitest 3 → 4

Upgrade Vitest to the latest v4 release. Key areas to check:

- `vitest/config` re-export of `defineConfig` — `vite.config.ts` line 1 imports from `vitest/config`
- Coverage provider (`@vitest/coverage-v8`) — ensure compatible version exists for Vitest 4
- Test runner behavior — all 4,325+ unit tests must pass
- Any changed CLI flags or config options used in `package.json` scripts

### 1c. Patch/Minor Updates

Update remaining dependencies to latest compatible versions:

- `@playwright/test` — latest patch
- `pixi.js` — latest patch within v8
- `eslint` and `@typescript-eslint/*` — latest compatible
- `jsdom`, `globals`, `lz-string` — latest compatible
- `typescript` — latest compatible

After all updates: `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run test:unit` must all pass.

---

## 2. Full IndexedDB Migration (Drop localStorage)

### Context

The codebase currently uses localStorage as primary storage with IndexedDB as a mirror/fallback. This iteration makes IndexedDB the sole storage backend and removes all localStorage code. No backward compatibility with localStorage-based saves is needed — existing localStorage saves will simply not be found.

Four systems use localStorage today:

| System | File | localStorage key pattern |
|--------|------|--------------------------|
| Game saves | `saveload.ts` | `spaceAgencySave_0` through `spaceAgencySave_N` |
| Auto-saves | `autoSave.ts` | `spaceAgencySave_auto`, overflow keys |
| Settings | `settingsStore.ts` | `spaceAgencySettings` |
| Design library | `designLibrary.ts` | `spaceAgencyDesignLibrary` |

### 2a. Upgrade idbStorage.ts

The existing `idbStorage.ts` provides `idbSet`, `idbGet`, `idbDelete`, and `isIdbAvailable`. These are sufficient for the migration. The module currently describes itself as a "mirror" of localStorage — update the comments to reflect that it's now the primary (and only) storage backend. Remove the fallback language and `isIdbAvailable` checks that gate IDB usage (IDB is required, not optional).

### 2b. Migrate saveload.ts

Replace all `localStorage.getItem`/`setItem`/`removeItem` calls with `idbGet`/`idbSet`/`idbDelete`. Key changes:

- `_persistCompressed()` — remove localStorage write, keep only IDB write. Remove the "localStorage full — attempt IndexedDB as fallback" code path.
- `loadGame()` — remove localStorage read. Load exclusively from IDB. Remove the "check both and pick newest" logic. Remove the "write back to localStorage if it came from IDB" sync-back code.
- `deleteSave()` — remove `localStorage.removeItem`, use only `idbDelete`.
- `exportSave()` — read from IDB instead of localStorage.
- `listSaves()` / `discoverOverflowKeys()` — these currently scan localStorage keys. Rewrite to scan IDB keys. The IDB store will need a `getAllKeys()` or equivalent operation (add to `idbStorage.ts` if not present).
- `loadGameAsync` alias (line 550) — delete entirely. This is a deprecated backward-compat shim.

All public functions that read/write storage are already async or return Promises, so the async nature of IDB should not require API changes to callers.

### 2c. Migrate autoSave.ts

Replace all localStorage calls with IDB equivalents:

- `_findAutoSaveKey()` — scans localStorage for auto-save key; rewrite to scan IDB
- `triggerAutoSave()` — writes to localStorage then mirrors to IDB; write to IDB only
- `hasAutoSave()` — checks localStorage; check IDB
- `deleteAutoSave()` — removes from localStorage; remove from IDB

`hasAutoSave()` is currently synchronous (`localStorage.getItem(...) !== null`). It will need to become async. Check callers and update them.

### 2d. Migrate settingsStore.ts

Replace localStorage with IDB for settings persistence:

- `loadSettings()` — read from IDB instead of localStorage
- `persistSettings()` — write to IDB instead of localStorage
- `_hasExistingSettings()` — check IDB instead of localStorage

**Async initialization:** Settings are currently loaded synchronously at startup. With IDB, `loadSettings()` becomes async. The settings module should load settings into an in-memory cache at app init (awaited before anything else runs), then serve reads from the cache synchronously. Only writes go to IDB. This preserves the current synchronous read pattern for consumers.

### 2e. Migrate designLibrary.ts

Replace localStorage with IDB:

- `_loadSharedLibrary()` — read from IDB
- `_saveSharedLibrary()` — write to IDB

These are likely already called in async contexts. Check callers.

### 2f. Update mainmenu.ts

`mainmenu.ts` reads localStorage for save slot discovery in the load screen. Update to use the migrated `listSaves()` / `discoverOverflowKeys()` functions from saveload.ts (which now read from IDB).

### 2g. Update E2E Test Helpers

9 E2E spec files seed saves via `localStorage.setItem()` in `page.evaluate()` calls. The E2E save seeding helper (`e2e/helpers/_saveFactory.ts` or `_state.ts`) must be updated to seed saves into IndexedDB instead.

Create or update a helper that writes save data to IndexedDB within `page.evaluate()`. IndexedDB operations in `page.evaluate()` are async, so the seeding calls will need `await`. Ensure all E2E specs that seed saves use the updated helper.

### 2h. Update Unit Tests

`saveload.test.ts` has 48 references to localStorage. The test setup likely mocks localStorage — replace with an IDB mock or use the `fake-indexeddb` package (or similar) that Vitest can use in Node.js. All existing save round-trip, corruption, version-check, and overflow tests must be updated to use IDB instead of localStorage.

Similarly update tests in `autoSave.test.ts`, `designLibrary.test.ts`, `settingsStore.test.ts`, `storageErrors.test.ts`, `idbStorage.test.ts`, and `debugMode.test.ts`.

---

## 3. Remove Backward-Compatibility Code

With localStorage gone and no need for backward compat, remove the following:

### In saveload.ts

- **`loadGameAsync` export** (line 550) — deprecated alias for `loadGame`. Delete.
- **`_importLegacyJson()` function** (line 809) — imports saves from old JSON string format. Delete the function and the fallback call to it in the import flow.
- **`decompressSaveData()` uncompressed fallback** (line 389) — the `if (!raw.startsWith(COMPRESSED_PREFIX)) return raw` path handles ancient uncompressed saves. All saves are now compressed. Remove the fallback — if the compressed prefix is missing, throw an error (treat as corrupt data).

### In saveload.test.ts

- **Line 1908** — `loadGame(0) without storageKey still works for manual slots (backward compat)` — delete.
- **Lines 1417-1470ish** — `backward compatibility with uncompressed saves` describe block — delete the entire block.
- **Line 1655** — `imports a legacy JSON envelope string (old-format backward compatibility)` — delete.

### Keep (data integrity, not backward compat)

- **Version check** in `loadGame()` (line 499) — rejects saves with incompatible version numbers. Keep.
- **Version rejection tests** (lines 918, 1032, 1045) — test that old/future versions are rejected. Keep.
- **Incompatible saves appear in UI** (test line 619) — verifies the UI shows incompatible saves as non-loadable. Keep.

---

## 4. `totalMass > 0` Guard in physics.ts

**Location:** `src/core/physics.ts:1214-1215`

```typescript
let accX: number = netFX / totalMass;
let accY: number = netFY / totalMass;
```

Add a guard: if `totalMass <= 0`, set `accX` and `accY` to `0` instead of dividing. This matches the defensive pattern used at lines 1023, 1081, 1127, and 1463 in the same file.

Add a unit test: given a physics state where `totalMass` computes to 0, verify that `tick()` produces finite position/velocity values (no NaN/Infinity propagation).

---

## 5. HTML-Escape `data-key` Attribute in mainmenu.ts

**Location:** `src/ui/mainmenu.ts:390-392`

The `data-key="${summary.storageKey}"` interpolation doesn't use the `escapeHtml` utility (which is already imported). Apply `escapeHtml()` to `summary.storageKey` in all three button template literals (Load, Export, Delete). Zero-cost defense-in-depth.

---

## 6. Notification Queue

Replace the current single-toast notification system with a stacking queue.

### Current Behavior (notification.ts)

`showNotification()` removes any existing toast before creating a new one. Only one toast is ever visible.

### New Behavior

- Multiple toasts can be visible simultaneously, stacked vertically from the bottom of the screen.
- Each toast auto-dismisses after 4 seconds (same as current).
- New toasts appear at the bottom of the stack; existing toasts shift up.
- When a toast dismisses, remaining toasts shift down to fill the gap.
- Cap at a reasonable maximum (e.g., 5 visible toasts). If the cap is reached, the oldest toast is removed when a new one arrives.
- The fade-out animation (0.3s opacity transition) remains.

### Unit Tests

Add unit tests for `notification.ts`:

- Single notification creates one toast element
- Two notifications in sequence create two toast elements
- Toasts are stacked (different bottom positions)
- After 4+ seconds, toasts are removed from DOM
- Maximum cap is enforced — adding beyond the cap removes the oldest

---

## 7. Fix CLAUDE.md Inaccuracies

The root `CLAUDE.md` has several statements that no longer reflect reality:

1. **Line 98** — References a `jsToTsResolve` Vite plugin that doesn't exist. The actual mechanism is `resolve.extensions: ['.ts', '.js', ...]` in `vite.config.ts` line 5. Fix the description.

2. **Multiple references to JS modules** — The Architecture section says modules "remain JS" and references `.js` file extensions. The entire codebase is now TypeScript. Update all affected sections:
   - Core section: remove "the rest remain JS with JSDoc types"
   - File references: update `.js` extensions to `.ts` where they appear in the module listing
   - TypeScript & Linting section: remove "Four core modules are TypeScript. The rest of the codebase remains JavaScript."
   - Remove any references to `checkJs`, `allowJs` being relevant for source files

3. **Testing section** — E2E test references may say `.spec.js`; update to `.spec.ts`.

4. After dependency upgrades, update any version-specific references if applicable.

---

## 8. Coverage Exclusion List Maintenance

**Location:** `vite.config.ts:34-94`

The explicit exclusion list requires manual updates as modules are added or split. Review the current list against the actual file tree:

- Check for files in the exclusion list that no longer exist (stale entries)
- Check for new DOM-heavy or PixiJS-heavy files that should be excluded but aren't
- Verify that no testable pure-logic modules are incorrectly excluded

If there are many stale entries or the list is hard to maintain, consider switching to a pattern-based exclusion (e.g., exclude barrel re-export files matching `**/index.ts`) where feasible, while keeping explicit entries for files that don't fit a pattern.

---

## Testing Strategy

### Unit Tests

| Area | What changes |
|------|-------------|
| `saveload.test.ts` | Rewrite all 48 localStorage references to use IDB mock; remove backward-compat tests; keep version-check tests |
| `autoSave.test.ts` | Update storage mocking from localStorage to IDB |
| `settingsStore.test.ts` | Update storage mocking from localStorage to IDB |
| `designLibrary.test.ts` | Update storage mocking from localStorage to IDB |
| `storageErrors.test.ts` | Update error scenarios for IDB instead of localStorage |
| `idbStorage.test.ts` | May need updates if `idbStorage.ts` API changes (e.g., `getAllKeys`) |
| `debugMode.test.ts` | Update if it references localStorage |
| `physics.test.ts` | Add test for totalMass=0 guard |
| `notification.test.ts` (new) | Stacking queue behavior tests |

### E2E Tests

All 9 E2E spec files that seed saves via localStorage must be updated to seed via IDB. The seeding helper should abstract this so individual specs don't need IDB boilerplate.

### Verification

After all changes: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, and `npm run test:smoke:e2e` must all pass.

---

## Technical Decisions

- **IDB is required, not optional.** No feature detection or localStorage fallback. All modern browsers support IndexedDB. If IDB is unavailable, the game cannot save (fail loudly).
- **Settings use in-memory cache.** Loaded async from IDB at init, served synchronously from cache thereafter. Only writes touch IDB.
- **No backward compat.** Old localStorage saves are not migrated. Old save formats (uncompressed, legacy JSON) are not supported. Version-incompatible saves are rejected (data integrity, not compat).
- **Dependency upgrades first.** Vite and Vitest major jumps happen before any functional changes so the entire iteration is built and tested on the new toolchain.
- **Notification stacking, not replacing.** Multiple toasts stack from bottom with auto-dismiss. Capped at a reasonable maximum.
