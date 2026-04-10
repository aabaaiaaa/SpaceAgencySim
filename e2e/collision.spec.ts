/**
 * collision.spec.ts — E2E — Collision System (Stage Separation)
 *
 * Each test is independent — builds, launches, stages, and asserts on its own.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, startTestFlight,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Browser-context type aliases (used with type assertions inside page.evaluate)
//
// These describe the runtime shapes of globals injected by the game.
// Inside page.evaluate / waitForFunction callbacks we cast `window` to access
// the custom __flightPs global.  The cast is erased at compile time.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Retry once — occasionally hits Chromium WebGL crash.
test.describe.configure({ retries: 1 });

const UNLOCKED_PARTS: string[] = [
  'cmd-mk1', 'tank-small', 'engine-spark', 'decoupler-stack-tr18',
];

// ---------------------------------------------------------------------------
// Shared result interfaces for page.evaluate() return types
// ---------------------------------------------------------------------------

interface PositionResult {
  rocketY: number;
  debrisY: number;
}

interface VelocityResult {
  rocketVelY: number;
  debrisVelY: number;
}

interface DistanceResult {
  distance: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed a save, then start a two-stage rocket flight programmatically. */
async function buildAndLaunch(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
  });
  await seedAndLoadSave(page, envelope);

  // Parts top -> bottom: cmd, decoupler, tank, engine.
  // Stage 0 fires the engine; Stage 1 fires the decoupler to separate.
  // Note: staging is accepted by the runtime __e2eStartFlight handler but
  // not yet declared in the E2E helper's StartFlightOptions interface.
  await startTestFlight(page,
    ['cmd-mk1', 'decoupler-stack-tr18', 'tank-small', 'engine-spark'],
    { staging: [{ partIds: ['engine-spark'] }, { partIds: ['decoupler-stack-tr18'] }] } as Parameters<typeof startTestFlight>[2],
  );
}

/** Fire engine, gain altitude, fire decoupler, wait for debris. */
async function gainAltitudeAndSeparate(page: Page): Promise<void> {
  await page.keyboard.press('Space'); // Stage 1: engine
  await page.waitForFunction(() => {
    const ps = (window as unknown as Record<string, unknown>).__flightPs as
      { posY: number } | undefined;
    return (ps?.posY ?? 0) > 300;
  }, { timeout: 30_000 });

  await page.keyboard.press('Space'); // Stage 2: decoupler
  await page.waitForFunction(() => {
    const ps = (window as unknown as Record<string, unknown>).__flightPs as
      { debris: unknown[] } | undefined;
    return (ps?.debris?.length ?? 0) > 0;
  }, { timeout: 10_000 });

  // Wait for visible separation.
  await page.waitForFunction(() => {
    const ps = (window as unknown as Record<string, unknown>).__flightPs as
      { posY: number; debris: { posY: number }[] } | undefined;
    if (!ps?.debris?.length) return false;
    return Math.abs(ps.posY - ps.debris[0].posY) > 0.1;
  }, { timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Collision — Stage Separation', () => {

  test('(1) debris separates from rocket after decoupling', async ({ page }: { page: Page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await gainAltitudeAndSeparate(page);

    const positions: PositionResult = await page.evaluate((): PositionResult => {
      const ps = (window as unknown as Record<string, unknown>).__flightPs as
        { posY: number; debris: { posY: number }[] };
      return { rocketY: ps.posY, debrisY: ps.debris[0].posY };
    });
    expect(positions.rocketY).not.toBe(positions.debrisY);
    expect(Math.abs(positions.rocketY - positions.debrisY)).toBeGreaterThan(0.1);
  });

  test('(2) separation impulse gives bodies different velocities', async ({ page }: { page: Page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await gainAltitudeAndSeparate(page);

    const velocities: VelocityResult = await page.evaluate((): VelocityResult => {
      const ps = (window as unknown as Record<string, unknown>).__flightPs as
        { velY: number; debris: { velY: number }[] };
      return { rocketVelY: ps.velY, debrisVelY: ps.debris[0].velY };
    });
    expect(velocities.rocketVelY).not.toBe(velocities.debrisVelY);
    expect(Math.abs(velocities.rocketVelY - velocities.debrisVelY)).toBeGreaterThan(1);
  });

  test('(3) no indefinite overlap after separation', async ({ page }: { page: Page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await gainAltitudeAndSeparate(page);

    await page.waitForFunction(() => {
      const ps = (window as unknown as Record<string, unknown>).__flightPs as
        { posY: number; debris: { posY: number }[] } | undefined;
      if (!ps?.debris?.length) return false;
      return Math.abs(ps.posY - ps.debris[0].posY) > 1;
    }, { timeout: 10_000 });

    const result: DistanceResult = await page.evaluate((): DistanceResult => {
      const ps = (window as unknown as Record<string, unknown>).__flightPs as
        { posY: number; debris: { posY: number }[] } | undefined;
      if (!ps || !ps.debris || ps.debris.length === 0) return { distance: 0 };
      return { distance: Math.abs(ps.posY - ps.debris[0].posY) };
    });
    expect(result.distance).toBeGreaterThan(1);
  });
});
