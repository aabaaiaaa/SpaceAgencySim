import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, startTestFlight,
} from './helpers.js';

/**
 * E2E — Flight Landing
 *
 * Tests the complete landing sequence using a two-stage rocket.
 * Each test is independent and builds/launches its own rocket.
 */

// ---------------------------------------------------------------------------
// (window.d.ts augments the global Window interface with game properties)
// ---------------------------------------------------------------------------

/** Shape of a flight event in the flight log. */
interface FlightEvent {
  time: number;
  type: string;
  description: string;
  partsDestroyed?: boolean;
  speed?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope(): ReturnType<typeof buildSaveEnvelope> {
  return buildSaveEnvelope({
    saveName: 'Landing E2E Test',
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: ['cmd-mk1', 'parachute-mk2', 'decoupler-stack-tr18', 'tank-small', 'engine-spark'],
  });
}

async function buildAndLaunch(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, makeEnvelope());
  await startTestFlight(page,
    ['parachute-mk2', 'cmd-mk1', 'decoupler-stack-tr18', 'tank-small', 'engine-spark'],
    { staging: [
      { partIds: ['engine-spark'] },
      { partIds: ['decoupler-stack-tr18', 'parachute-mk2'] },
    ]}
  );
}

async function waitForWarpUnlocked(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !(document.querySelector('.hud-warp-btn') as HTMLButtonElement | null)?.disabled,
    { timeout: 5_000 },
  );
}

async function fireStage1(page: Page): Promise<void> {
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window.__flightPs?.posY ?? 0) > 0,
    { timeout: 3_000 },
  );
}

async function fireStage2(page: Page): Promise<void> {
  await waitForWarpUnlocked(page);
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window.__flightPs?.debris?.length ?? 0) > 0,
    { timeout: 5_000 },
  );
}

async function waitForLanding(page: Page): Promise<void> {
  await waitForWarpUnlocked(page);
  await page.click('[data-warp="50"]');
  await page.waitForFunction(
    () => {
      const ps = window.__flightPs;
      return ps?.landed === true || ps?.crashed === true;
    },
    { timeout: 15_000 },
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Landing', () => {

  test('(1) launching from the VAB loads the flight scene', async ({ page }) => {
    test.setTimeout(60_000);
    await buildAndLaunch(page);
    await expect(page.locator('#flight-hud')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#vab-btn-launch')).not.toBeVisible({ timeout: 5_000 });
  });

  test('(2) pressing Space fires Stage 1 and the rocket lifts off', async ({ page }) => {
    test.setTimeout(60_000);
    await buildAndLaunch(page);

    await page.waitForFunction(
      () => window.__flightPs?.grounded === true,
      { timeout: 5_000 },
    );
    await fireStage1(page);
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 0,
      { timeout: 5_000 },
    );
  });

  test('(3) pressing Space again separates the lower stage and deploys the parachute', async ({ page }) => {
    test.setTimeout(60_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);

    // Parachute should be deploying or deployed.
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return false;
      for (const [, entry] of ps.parachuteStates) {
        if (entry.state === 'deploying' || entry.state === 'deployed') return true;
      }
      return false;
    }, { timeout: 5_000 });

    const chuteState: string = await page.evaluate((): string => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return 'none';
      for (const [, entry] of ps.parachuteStates) return entry.state;
      return 'none';
    });
    expect(['deploying', 'deployed']).toContain(chuteState);

    const activeParts: number = await page.evaluate(
      (): number => window.__flightPs?.activeParts?.size ?? -1,
    );
    expect(activeParts).toBeLessThanOrEqual(3);
  });

  test('(4) parachute slows the command module to a safe landing speed', async ({ page }) => {
    test.setTimeout(60_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const { landed, crashed }: { landed: boolean; crashed: boolean } = await page.evaluate((): { landed: boolean; crashed: boolean } => ({
      landed:  window.__flightPs?.landed  ?? false,
      crashed: window.__flightPs?.crashed ?? false,
    }));

    expect(landed).toBe(true);
    expect(crashed).toBe(false);
  });

  test('(5) a LANDING event is recorded with impact speed below crash threshold', async ({ page }) => {
    test.setTimeout(60_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    await page.waitForFunction(
      () => (window.__gameState?.currentFlight?.events ?? []).some((e: { type: string }) => e.type === 'LANDING'),
      { timeout: 5_000 },
    );

    const events: FlightEvent[] = await page.evaluate(
      (): FlightEvent[] => window.__gameState?.currentFlight?.events ?? [],
    );

    const landingEvent: FlightEvent | undefined = events.find((e) => e.type === 'LANDING');
    expect(landingEvent).toBeTruthy();
    expect(landingEvent!.partsDestroyed).toBe(false);
    // Parachute-assisted landing — speed varies with E2E simulation timing.
    // Without a parachute impact would be 50+ m/s; threshold is generous to
    // account for timing variability while still verifying the chute works.
    expect(landingEvent!.speed).toBeLessThan(30);
  });

  test('(6) clicking "Return to Space Agency" shows the post-flight summary', async ({ page }) => {
    test.setTimeout(60_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const summaryAlreadyVisible: boolean = await page.locator('#post-flight-summary').isVisible();
    if (!summaryAlreadyVisible) {
      await page.click('#topbar-menu-btn', { force: true });
      const dropdown = page.locator('#topbar-dropdown');
      await expect(dropdown).toBeVisible({ timeout: 5_000 });
      await dropdown.getByText('Return to Space Agency').click();
    }

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#post-flight-return-btn')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#flight-hud')).not.toBeVisible({ timeout: 5_000 });
  });
});
