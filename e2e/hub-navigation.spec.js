import { test, expect } from '@playwright/test';

/**
 * E2E — Hub Navigation
 *
 * Verifies that each building button on the hub navigates to the correct
 * screen, that every building screen has a back/return button which returns
 * the player to the hub, and that the persistent top bar (cash display) is
 * visible on every building screen.
 *
 * All tests run in serial order on a shared page instance.  A new game is
 * started in `beforeAll` so that the hub is showing before any test runs.
 * Each test navigates to a building, asserts what it needs to, then returns
 * to the hub via the back button — leaving the page in the hub state for
 * the next test.
 *
 * Tests:
 *   (1) Clicking "Vehicle Assembly Building" loads the VAB screen
 *       (parts panel is visible).
 *   (2) Clicking "Mission Control Centre" loads the mission control screen
 *       (at least one mission is listed as available).
 *   (3) Clicking "Crew Administration" loads the crew admin screen
 *       (tabs for Active Crew, Hire, History are present).
 *   (4) Clicking "Launch Pad" loads the launch pad screen.
 *   (5) Each building screen has a back/return button that returns to the hub.
 *   (6) The top bar showing cash is visible on each building screen.
 */

test.describe.configure({ mode: 'serial' });

test.describe('Hub Navigation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Setup ─────────────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');

    // A fresh context has no saves, so the New Game screen appears.
    await page.waitForSelector('#mm-agency-name-input', {
      state:   'visible',
      timeout: 15_000,
    });

    // Start a Sandbox game so all buildings are visible and navigable.
    await page.fill('#mm-agency-name-input', 'Orbit Inc');
    await page.click('.mm-mode-option[data-mode="sandbox"]');
    await page.click('#mm-start-btn');

    // Wait for the hub overlay to appear.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Helper: wait until the hub overlay is visible ─────────────────────────

  async function waitForHub() {
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
  }

  // ── (1) VAB — parts panel is visible ──────────────────────────────────────

  test('(1) clicking "Vehicle Assembly Building" loads the VAB screen with a visible parts panel', async () => {
    await expect(page.locator('#hub-overlay')).toBeVisible();

    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-root', { state: 'visible', timeout: 10_000 });

    // The parts panel must be present and visible.
    await expect(page.locator('#vab-parts-list')).toBeVisible();

    // Navigate back to hub for subsequent tests.
    await page.click('#vab-back-btn');
    await waitForHub();
  });

  // ── (2) Mission Control — available missions listed ────────────────────────

  test('(2) clicking "Mission Control Centre" loads the mission control screen with at least one available mission', async () => {
    await expect(page.locator('#hub-overlay')).toBeVisible();

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    // At least one mission card must be visible on the Available tab.
    await expect(page.locator('.mc-mission-card').first()).toBeVisible();

    // Navigate back.
    await page.click('#mission-control-back-btn');
    await waitForHub();
  });

  // ── (3) Crew Administration — three tabs present ───────────────────────────

  test('(3) clicking "Crew Administration" loads the crew admin screen with Active Crew, Hire, and History tabs', async () => {
    await expect(page.locator('#hub-overlay')).toBeVisible();

    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });

    // All three tabs must be present.
    await expect(page.locator('[data-tab-id="active"]')).toBeVisible();
    await expect(page.locator('[data-tab-id="hire"]')).toBeVisible();
    await expect(page.locator('[data-tab-id="history"]')).toBeVisible();

    // Navigate back.
    await page.click('#crew-admin-back-btn');
    await waitForHub();
  });

  // ── (4) Launch Pad — screen loads ─────────────────────────────────────────

  test('(4) clicking "Launch Pad" loads the launch pad screen', async () => {
    await expect(page.locator('#hub-overlay')).toBeVisible();

    await page.click('[data-building-id="launch-pad"]');
    await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 10_000 });

    await expect(page.locator('#launch-pad-overlay')).toBeVisible();

    // Navigate back.
    await page.click('#launch-pad-back-btn');
    await waitForHub();
  });

  // ── (5) Each building has a back/return button that returns to the hub ─────

  test('(5) each building screen has a back/return button that navigates back to the hub', async () => {
    const buildings = [
      { id: 'vab',             overlay: '#vab-root',               backBtn: '#vab-back-btn'             },
      { id: 'mission-control', overlay: '#mission-control-overlay', backBtn: '#mission-control-back-btn' },
      { id: 'crew-admin',      overlay: '#crew-admin-overlay',      backBtn: '#crew-admin-back-btn'      },
      { id: 'launch-pad',      overlay: '#launch-pad-overlay',      backBtn: '#launch-pad-back-btn'      },
    ];

    for (const { id, overlay, backBtn } of buildings) {
      // Must start from the hub.
      await expect(page.locator('#hub-overlay')).toBeVisible();

      await page.click(`[data-building-id="${id}"]`);
      await page.waitForSelector(overlay, { state: 'visible', timeout: 10_000 });

      // The back button must be present and visible.
      await expect(page.locator(backBtn)).toBeVisible();

      // Clicking it must return to the hub.
      await page.click(backBtn);
      await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
      await expect(page.locator('#hub-overlay')).toBeVisible();
    }
  });

  // ── (6) Top bar with cash is visible on every building screen ─────────────

  test('(6) the top bar showing cash is visible on every building screen', async () => {
    const buildings = [
      { id: 'vab',             overlay: '#vab-root',               backBtn: '#vab-back-btn'             },
      { id: 'mission-control', overlay: '#mission-control-overlay', backBtn: '#mission-control-back-btn' },
      { id: 'crew-admin',      overlay: '#crew-admin-overlay',      backBtn: '#crew-admin-back-btn'      },
      { id: 'launch-pad',      overlay: '#launch-pad-overlay',      backBtn: '#launch-pad-back-btn'      },
    ];

    for (const { id, overlay, backBtn } of buildings) {
      // Must start from the hub.
      await expect(page.locator('#hub-overlay')).toBeVisible();

      await page.click(`[data-building-id="${id}"]`);
      await page.waitForSelector(overlay, { state: 'visible', timeout: 10_000 });

      // The persistent top bar and its cash readout must be visible.
      await expect(page.locator('#game-topbar')).toBeVisible();
      await expect(page.locator('#topbar-cash')).toBeVisible();

      // Navigate back to hub for next iteration.
      await page.click(backBtn);
      await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    }
  });
});
