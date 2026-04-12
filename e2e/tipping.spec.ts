import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, startTestFlight,
} from './helpers.js';

/**
 * E2E — Ground-Contact Rotation & Gravity Tipping
 *
 * Each test is independent — starts its own grounded flight.
 */

const UNLOCKED_PARTS: string[] = ['probe-core-mk1', 'tank-small', 'engine-spark'];

async function setupGroundedFlight(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
  });
  await seedAndLoadSave(page, envelope);
  await startTestFlight(page, UNLOCKED_PARTS);
}

test.describe('Tipping physics — ground-contact rotation', () => {

  test('(1) rocket tips clockwise when D is held on the pad', async ({ page }) => {
    await setupGroundedFlight(page);

    const initAngle: number = await page.evaluate(() => window.__flightPs!.angle);
    expect(initAngle).toBeCloseTo(0, 1);

    await page.keyboard.down('d');
    await page.waitForFunction(
      () => Math.abs(window.__flightPs?.angle ?? 0) > 0.4,
      { timeout: 5_000 },
    );
    await page.keyboard.up('d');

    const angle: number = await page.evaluate(() => window.__flightPs!.angle);
    expect(angle).toBeGreaterThan(0);
  });

  test('(2) tilted rocket continues toppling from gravity torque', async ({ page }) => {
    await setupGroundedFlight(page);

    // Pre-tilt the rocket programmatically.
    await page.evaluate(async () => {
      window.__flightPs!.angle = 0.45;
      window.__flightPs!.angularVelocity = 0.05;
      if (typeof window.__resyncPhysicsWorker === 'function') {
        await window.__resyncPhysicsWorker();
      }
    });

    const angleBefore: number = await page.evaluate(() => window.__flightPs!.angle);

    await page.waitForFunction(
      (prev: number) => {
        const a: number = Math.abs(window.__flightPs?.angle ?? 0);
        return a > Math.abs(prev) + 0.01 || window.__flightPs?.crashed === true;
      },
      angleBefore,
      { timeout: 5_000 },
    );

    const angleAfter: number = await page.evaluate(() => window.__flightPs!.angle);
    const crashed: boolean = await page.evaluate(() => window.__flightPs!.crashed);
    if (!crashed) {
      expect(angleAfter).toBeGreaterThan(angleBefore);
    }
  });

  test('(3) toppling past threshold triggers crash', async ({ page }) => {
    test.setTimeout(30_000);
    await setupGroundedFlight(page);

    // Pre-tilt the rocket aggressively so gravity torque topples it quickly.
    // Using page.evaluate is faster than holding the 'd' key and waiting.
    await page.evaluate(async () => {
      window.__flightPs!.angle = 0.8;
      window.__flightPs!.angularVelocity = 0.3;
      if (typeof window.__resyncPhysicsWorker === 'function') {
        await window.__resyncPhysicsWorker();
      }
    });

    // Wait for gravity torque to topple it past crash threshold.
    await page.waitForFunction(
      () => window.__flightPs?.crashed === true,
      { timeout: 15_000 },
    );

    const crashed: boolean = await page.evaluate(() => window.__flightPs!.crashed);
    expect(crashed).toBe(true);
  });
});
