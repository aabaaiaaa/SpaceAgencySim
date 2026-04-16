# Iteration 18 — Review Gaps, Resilience & Tooling

**Date:** 2026-04-16
**Scope:** test-map.json gaps, smoke tag additions, collision MoI guard, showFatalError extraction, test-map auto-generation fix, IDB mid-session resilience
**Builds on:** Iteration 17 (flaky test fix, collision guards, IDB startup error, log suppression, smoke tags, preview extraction)
**Review driving this iteration:** `.devloop/archive/iteration-17/review.md`

---

## 1. Move showFatalError to a Dedicated UI Module

**Problem:** `showFatalError()` is defined in `src/main.ts` (lines 68-78) and exported from there. If other modules need to show fatal errors (e.g., IDB connection drop during gameplay — see section 5), they'd need to import from `main.ts`, creating circular dependency risk. The function is a UI utility, not app bootstrapping logic.

**Fix:** Extract `showFatalError` into a new file `src/ui/fatalError.ts`. The function body and its export move unchanged. Then:

- `src/main.ts` imports `showFatalError` from `./ui/fatalError.ts` instead of defining it locally. Remove the local function definition and the `export` keyword from main.ts.
- `src/tests/mainStartup.test.ts` needs updated mocks:
  - Add a `vi.mock('../ui/fatalError.ts', ...)` that exposes a hoisted mock for `showFatalError`.
  - The two startup tests (IDB unavailable, IDB available) should assert against the mocked `showFatalError` directly rather than inspecting `document.body.appendChild`. This is cleaner and more robust.
  - The third test (`showFatalError` direct testing) should import from `../ui/fatalError.ts` instead of `../main.ts`.
- Verify: `npm run typecheck` passes, `npx vitest run src/tests/mainStartup.test.ts` passes.

**The new file `src/ui/fatalError.ts` should contain only:**
```typescript
export function showFatalError(message: string): void {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
    'justify-content:center', 'background:#000', 'color:#b0d0f0',
    'font-family:system-ui,sans-serif', 'font-size:1.2rem',
    'padding:2rem', 'text-align:center', 'z-index:9999',
  ].join(';');
  el.textContent = message;
  document.body.appendChild(el);
}
```

---

## 2. Add Ia/Ib Defensive Guard in collision.ts

**Location:** `src/core/collision.ts`, lines 531-538 (inside `_resolveCollision`)

**Problem:** The function divides by `Ia` (moment of inertia of body A) and `Ib` (body B) at lines 533 and 537. These are protected upstream by `_bodyMoI()` returning `Math.max(1, I)` (line 238), but the division code relies entirely on this upstream guarantee. The mass guard at line 457 was added in iteration 17 but only covers mass divisions — the MoI divisions remain unguarded.

**Fix:** Add inline guards around each MoI division, without early-returning from the function (since the positional correction below doesn't depend on MoI):

```typescript
// Before (line 533):
a.ref.angularVelocity += torqueA * dt / Ia;

// After:
if (Ia > 0) a.ref.angularVelocity += torqueA * dt / Ia;

// Before (line 537):
b.ref.angularVelocity += torqueB * dt / Ib;

// After:
if (Ib > 0) b.ref.angularVelocity += torqueB * dt / Ib;
```

This uses inline guards (not early return) because only the angular impulse depends on MoI — the positional correction at lines 541-548 should still execute.

**Tests:** The existing test at `collision.test.ts:453` ("does not produce NaN or Infinity with minimal-mass colliding bodies") already exercises this code path through `tickCollisions`. The `_bodyMoI` function guarantees `>= 1`, so the guard is defense-in-depth. No new test is required — the existing test verifies finite angular velocity.

---

## 3. Add @smoke Tags to mainStartup.test.ts and previewLayout.test.ts

**Problem:** Two critical-path test files created in iteration 17 have no `@smoke` tags:
- `mainStartup.test.ts` — tests the IDB startup check. If this breaks, the game won't load.
- `previewLayout.test.ts` — tests the extracted preview scaling math used by rocket card rendering.

**Fix:** Add `@smoke` to the test description string of one representative test in each file:

- **`mainStartup.test.ts`:** Tag `'shows fatal error and does not call initSettings when IDB is unavailable @smoke'` — this is the most critical path (startup failure handling).
- **`previewLayout.test.ts`:** Tag `'computes scale that fits multiple parts within preview bounds @smoke'` — this exercises the most common code path (multiple parts).

**Verify:** `npm run test:smoke:unit` discovers and passes the new smoke tests.

---

## 4. Update generate-test-map.mjs for src/main.ts

**Problem:** `src/main.ts` is not classified by the test-map generator because `classifySource()` only handles files matching `src/{layer}/{module}.ts` (two path segments). Root-level files like `src/main.ts` return `null` and are silently ignored. This means `mainStartup.test.ts` (which imports `main.ts`) won't be mapped to any area.

**Fix:** Add `src/main.ts` to the `SOURCE_GROUPS` object in `scripts/generate-test-map.mjs`:

```javascript
'app/main': ['src/main.ts'],
```

This creates an `app/main` area that the import analysis will associate with `mainStartup.test.ts`. After the `showFatalError` extraction (section 1), `mainStartup.test.ts` will also import `src/ui/fatalError.ts`, which auto-classifies as `ui/fatalError`.

Additionally, after section 1 creates `src/ui/fatalError.ts`, the generator will auto-discover:
- `src/ui/fatalError.ts` → area `ui/fatalError` (standard `src/{layer}/{module}.ts` pattern)
- `src/core/previewLayout.ts` → area `core/previewLayout` (already auto-discovered)
- `src/ui/notification.ts` → area `ui/notification` (already auto-discovered)

**After modifying the script, regenerate `test-map.json`:**
```bash
node scripts/generate-test-map.mjs
```

**Verify:** The output JSON contains:
- An `app/main` area with `src/main.ts` in sources and `src/tests/mainStartup.test.ts` in unit
- A `core/previewLayout` area with `src/core/previewLayout.ts` in sources and `src/tests/previewLayout.test.ts` in unit
- A `ui/notification` area with `src/ui/notification.ts` in sources and `src/tests/notification.test.ts` in unit
- A `ui/fatalError` area with `src/ui/fatalError.ts` in sources and `src/tests/mainStartup.test.ts` in unit

---

## 5. IDB Mid-Session Resilience

**Problem:** The iteration 17 startup check handles "IDB unavailable at page load", but if IndexedDB becomes unavailable *during* gameplay (e.g., storage pressure eviction on mobile, user clearing site data in another tab), IDB operations will silently fail. The `openDB()` function caches a single `IDBDatabase` connection; if that connection dies, all subsequent operations reject with opaque errors, and the player gets no visible feedback.

**Fix:** Add connection-level error handling to `idbStorage.ts`:

1. **Add a callback registration function:**
   ```typescript
   let _onConnectionLost: ((msg: string) => void) | null = null;

   export function registerIdbErrorHandler(handler: (msg: string) => void): void {
     _onConnectionLost = handler;
   }
   ```

2. **In `openDB()`, after `_db = request.result`, attach an `onclose` handler:**
   ```typescript
   _db.onclose = () => {
     _db = null;
     _dbPromise = null;
     if (_onConnectionLost) {
       _onConnectionLost(
         'The storage connection was unexpectedly closed. ' +
         'Your recent progress may not be saved. Try refreshing the page.',
       );
     }
   };
   ```

   The `onclose` event fires when the browser forcibly closes the IDB connection (storage eviction, private browsing cleanup, etc.). Resetting `_db` and `_dbPromise` allows a reconnection attempt on the next operation.

3. **In `main.ts`, register the handler after startup:**
   ```typescript
   import { registerIdbErrorHandler } from './core/idbStorage.ts';
   import { showFatalError } from './ui/fatalError.ts';

   // Inside main(), after the IDB availability check passes:
   registerIdbErrorHandler(showFatalError);
   ```

4. **Also reset the handler in `_resetDbForTesting()`** so tests don't leak callbacks:
   ```typescript
   export function _resetDbForTesting(): void {
     if (_db) _db.close();
     _db = null;
     _dbPromise = null;
     _onConnectionLost = null;
   }
   ```

**Tests:** Add a test in `src/tests/idbStorage.test.ts` (or a new `src/tests/idbResilience.test.ts` if the existing file is too large) that:
1. Registers a mock error handler via `registerIdbErrorHandler`
2. Opens the DB (triggers `openDB` internally via `idbSet` or `idbGet`)
3. Simulates the `onclose` event firing on the cached connection
4. Verifies the handler was called with the expected message
5. Verifies that `_db` was reset (subsequent operations attempt a fresh connection)

Because `_db` is private, the test should verify behavior through the public API: after `onclose` fires, the next `idbSet`/`idbGet` call should attempt to reopen (or reject if IDB is truly gone).

---

## Testing Strategy

| Area | What Changes | Verification |
|------|-------------|-------------|
| `src/ui/fatalError.ts` (new) | Extract showFatalError from main.ts | `npx vitest run src/tests/mainStartup.test.ts` |
| `src/main.ts` | Import showFatalError, register IDB handler | `npx vitest run src/tests/mainStartup.test.ts` |
| `src/core/collision.ts` | Add Ia/Ib inline guards | `npx vitest run src/tests/collision.test.ts` |
| `src/tests/mainStartup.test.ts` | Update mocks, add @smoke tag | `npx vitest run --testNamePattern "@smoke" src/tests/mainStartup.test.ts` |
| `src/tests/previewLayout.test.ts` | Add @smoke tag | `npx vitest run --testNamePattern "@smoke" src/tests/previewLayout.test.ts` |
| `src/core/idbStorage.ts` | Add onclose handler, registerIdbErrorHandler | `npx vitest run src/tests/idbStorage.test.ts` |
| `scripts/generate-test-map.mjs` | Add src/main.ts to SOURCE_GROUPS | `node scripts/generate-test-map.mjs --dry-run` |
| `test-map.json` | Regenerated from script | Inspect output for new areas |

### Final Verification

After all changes: `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run test:unit` must all pass. `npm run test:smoke:unit` must include the newly tagged smoke tests.

---

## Technical Decisions

- **Inline MoI guards, not early return.** The Ia/Ib guards use `if (Ia > 0)` around the single division line rather than early-returning from `_resolveCollision`, because the positional correction below doesn't depend on MoI and should still execute.
- **Callback pattern for IDB resilience.** `idbStorage.ts` (core) cannot import from `src/ui/` (architecture rule). Instead, it exports a `registerIdbErrorHandler` callback that `main.ts` wires to `showFatalError`. This preserves the three-layer separation.
- **Auto-generate over manual edits.** `test-map.json` is regenerated by running the script rather than hand-editing, ensuring consistency and catching any other unmapped files.
- **Item 7 already complete.** The review suggested extracting pure delta-V computation from `ui/vab/_staging.ts`, but `computeStageDeltaV` was already extracted to `core/stagingCalc.ts` in a prior iteration. The remaining `_staging.ts` code is DOM rendering — no extractable pure logic remains.
