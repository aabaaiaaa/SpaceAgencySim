import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  buildSaveEnvelope, seedAndLoadSave, navigateToVab,
  placePart, launchFromVab, dismissWelcomeModal,
} from './helpers.js';

/**
 * E2E — Part Disconnection & Reconnection
 *
 * Each test is independent — seeds its own state and builds its own rocket.
 */

const CMD_DROP_Y: number    = CANVAS_CENTRE_Y;
const TANK_DROP_Y: number   = CMD_DROP_Y + 40;
const ENGINE_DROP_Y: number = TANK_DROP_Y + 35;

const ALL_VAB_PARTS: string[] = [
  'cmd-mk1', 'probe-core-mk1', 'tank-small', 'tank-medium', 'engine-spark',
  'engine-reliant', 'parachute-mk1', 'decoupler-stack-tr18',
];

async function seedAndOpenVab(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({ gameMode: 'freeplay', parts: ALL_VAB_PARTS });
  await seedAndLoadSave(page, envelope);
  await dismissWelcomeModal(page);
  await navigateToVab(page);
}

async function buildThreePartRocket(page: Page): Promise<void> {
  await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
  await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 2);
  await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);
}

async function getPartScreenPos(page: Page, instanceId: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((id: string) => {
    const a = window.__vabAssembly;
    const placed = a?.parts?.get(id);
    if (!placed) return null;
    const toScreen = window.__vabWorldToScreen;
    if (!toScreen) return null;
    const { screenX, screenY } = toScreen(placed.x, placed.y);
    return { x: screenX, y: screenY };
  }, instanceId);
}

async function dragPlacedPart(page: Page, instanceId: string, targetX: number, targetY: number): Promise<void> {
  const pos: { x: number; y: number } | null = await getPartScreenPos(page, instanceId);
  if (!pos) throw new Error(`Part ${instanceId} not found in assembly`);
  await page.mouse.move(pos.x, pos.y);
  await page.mouse.down();
  await page.mouse.move(pos.x, pos.y + 12, { steps: 3 });
  await page.mouse.move(targetX, targetY, { steps: 30 });
  await page.mouse.up();
}

async function findTankInstanceId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const a = window.__vabAssembly;
    if (!a) return null;
    for (const [id, p] of a.parts) {
      if (p.partId === 'tank-small') return id;
    }
    return null;
  });
}

async function disconnectTank(page: Page): Promise<string> {
  const tankId: string | null = await findTankInstanceId(page);
  expect(tankId).not.toBeNull();
  await dragPlacedPart(page, tankId!, CENTRE_X + 200, CANVAS_CENTRE_Y + 100);
  await page.waitForFunction(
    () => (window.__vabAssembly?.connections?.length ?? 99) === 0,
    { timeout: 5_000 },
  );
  return tankId!;
}

async function reconnectTank(page: Page, tankId: string): Promise<void> {
  await dragPlacedPart(page, tankId, CENTRE_X, TANK_DROP_Y);
  await page.waitForFunction(
    () => (window.__vabAssembly?.connections?.length ?? 0) >= 2,
    { timeout: 5_000 },
  );
}

test.describe('VAB — Part Disconnection & Reconnection', () => {

  test('(1) build a 3-part connected rocket', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    const connCount: number = await page.evaluate(
      () => window.__vabAssembly?.connections?.length ?? 0,
    );
    expect(connCount).toBe(2);
  });

  test('(2) stage engine and verify rocket is launchable', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine')).toBeVisible({ timeout: 5_000 });
    await page.locator('#vab-staging-close').click();

    await page.waitForFunction(
      () => !(document.querySelector('#vab-btn-launch') as HTMLButtonElement | null)?.disabled,
      { timeout: 5_000 },
    );
  });

  test('(3) dragging fuel tank away causes floating-parts validation failure', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);
    await disconnectTank(page);

    await page.click('#vab-btn-engineer');
    await expect(page.locator('#vab-engineer-panel')).toBeVisible();

    const checkTexts: string[] = await page.locator('#vab-engineer-panel .vab-val-msg').allTextContents();
    expect(checkTexts.some((t: string) => /floating/i.test(t))).toBe(true);
    await expect(page.locator('#vab-btn-launch')).toBeDisabled();
    await page.locator('#vab-engineer-close').click();
  });

  test('(4) dragging fuel tank back reconnects to both neighbors', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);
    const tankId: string = await disconnectTank(page);
    await reconnectTank(page, tankId);

    const connCount: number = await page.evaluate(
      () => window.__vabAssembly?.connections?.length ?? 0,
    );
    expect(connCount).toBe(2);
  });

  test('(5) Rocket Engineer shows all parts connected and launch is enabled', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);
    const tankId: string = await disconnectTank(page);
    await reconnectTank(page, tankId);

    await page.click('#vab-btn-engineer');
    await expect(page.locator('#vab-engineer-panel')).toBeVisible();

    const checkTexts: string[] = await page.locator('#vab-engineer-panel .vab-val-msg').allTextContents();
    expect(checkTexts.some((t: string) => /floating/i.test(t))).toBe(false);

    await page.waitForFunction(
      () => !(document.querySelector('#vab-btn-launch') as HTMLButtonElement | null)?.disabled,
      { timeout: 5_000 },
    );
    await page.locator('#vab-engineer-close').click();
  });

  test('(6) reconnected rocket can launch successfully', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);
    const tankId: string = await disconnectTank(page);
    await reconnectTank(page, tankId);

    await launchFromVab(page);

    const altitude: number = await page.evaluate(
      () => window.__flightPs?.posY ?? 0,
    );
    expect(altitude).toBeGreaterThanOrEqual(0);
  });
});
