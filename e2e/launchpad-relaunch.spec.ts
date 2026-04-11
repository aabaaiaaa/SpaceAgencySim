import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, dismissWelcomeModal,
  pressStage,
} from './helpers.js';

/**
 * E2E — Launch Pad Relaunch Engine Bug
 *
 * Each test is independent — seeds its own save with a pre-built rocket design.
 */

/* ------------------------------------------------------------------ */
/*  Seeded design types                                               */
/* ------------------------------------------------------------------ */

interface DesignPart {
  partId: string;
  position: { x: number; y: number };
}

interface RocketDesign {
  id: string;
  name: string;
  parts: DesignPart[];
  staging: { stages: string[][]; unstaged: string[] };
  totalMass: number;
  totalThrust: number;
  createdDate: string;
  updatedDate: string;
}

/* ------------------------------------------------------------------ */
/*  Test fixtures                                                     */
/* ------------------------------------------------------------------ */

const UNLOCKED_PARTS: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];

const SEEDED_DESIGN: RocketDesign = {
  id:          'design-relaunch-test',
  name:        'Relaunch Rocket',
  parts: [
    { partId: 'cmd-mk1',      position: { x: 0, y: 0 } },
    { partId: 'tank-small',   position: { x: 0, y: -40 } },
    { partId: 'engine-spark', position: { x: 0, y: -75 } },
  ],
  staging: {
    stages:   [['inst-3']],
    unstaged: ['inst-1'],
  },
  totalMass:   1010,
  totalThrust: 60,
  createdDate: new Date().toISOString(),
  updatedDate: new Date().toISOString(),
};

function makeEnvelope(): ReturnType<typeof buildSaveEnvelope> {
  return buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
    // @ts-expect-error — RocketDesign is structurally compatible with Record<string, unknown>
    rockets: [SEEDED_DESIGN],
  });
}

/* ------------------------------------------------------------------ */
/*  Helper functions                                                  */
/* ------------------------------------------------------------------ */

async function seedAndGoToHub(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, makeEnvelope());
  await dismissWelcomeModal(page);
}

async function launchFromPad(page: Page): Promise<void> {
  await page.click('[data-building-id="launch-pad"]');
  await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 10_000 });
  await page.click('.lp-launch-btn');
  await page.waitForSelector('#lp-crew-overlay', { state: 'visible', timeout: 10_000 });
  await page.click('.lp-crew-confirm-btn');
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    (): boolean =>
      typeof window.__flightPs !== 'undefined' &&
      window.__flightPs !== null,
    { timeout: 10_000 },
  );
}

async function fireStageAndVerifyLiftoff(page: Page): Promise<void> {
  const groundedBefore: boolean = await page.evaluate(
    (): boolean => window.__flightPs?.grounded ?? true,
  );
  expect(groundedBefore).toBe(true);

  // Wait for the staging system to be ready before pressing stage.
  await page.waitForFunction(
    () => window.__flightPs?.activeParts?.size > 0,
    { timeout: 10_000 },
  );

  // Dispatch stage and poll — retry dispatch if the first one is swallowed
  // (launch pad UI startup can delay keyboard handler registration).
  for (let attempt = 0; attempt < 5; attempt++) {
    await pressStage(page);
    const fired = await page.waitForFunction(
      (): boolean => (window.__flightPs?.firingEngines?.size ?? 0) > 0,
      { timeout: 3_000 },
    ).then(() => true).catch(() => false);
    if (fired) break;
  }

  const firingCount: number = await page.evaluate(
    (): number => window.__flightPs?.firingEngines?.size ?? 0,
  );
  expect(firingCount).toBeGreaterThan(0);

  await page.waitForFunction(
    (): boolean => (window.__flightPs?.posY ?? 0) > 5,
    { timeout: 10_000 },
  );
}

async function returnToHub(page: Page): Promise<void> {
  const dropdown = page.locator('#topbar-dropdown');
  if (!(await dropdown.isVisible())) {
    await page.click('#topbar-menu-btn');
    await expect(dropdown).toBeVisible({ timeout: 2_000 });
  }
  await dropdown.getByText('Return to Space Agency').click();

  const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
  const didAbort: boolean = await abortBtn.isVisible({ timeout: 2_000 }).catch((): boolean => false);
  if (didAbort) {
    await abortBtn.click();
  } else {
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn');
  }

  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await dismissBtn.click();
  } catch { /* no overlay */ }

  await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

test.describe('Launch Pad — Relaunch Engine Bug', () => {

  test('(1) first flight — engine fires and rocket lifts off', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndGoToHub(page);
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);
  });

  test('(2) return to hub after first flight', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndGoToHub(page);
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);
    await returnToHub(page);
    await expect(page.locator('#hub-overlay')).toBeVisible();
  });

  test('(3) second flight — engine fires on relaunch (regression)', async ({ page }) => {
    test.setTimeout(120_000);
    await seedAndGoToHub(page);

    // First flight + return.
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);
    await returnToHub(page);

    // Second flight (the regression test).
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);

    const grounded: boolean = await page.evaluate(
      (): boolean => window.__flightPs?.grounded ?? true,
    );
    expect(grounded).toBe(false);
  });
});
