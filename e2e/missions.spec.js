import { test, expect } from '@playwright/test';
import {
  SAVE_KEY, STARTING_MONEY,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope, seedAndLoadSave,
} from './helpers.js';

/**
 * E2E — Mission Control Flow
 *
 * Tests the full Mission Control Centre UI: available missions list, accepting
 * a mission, viewing objectives, cash invariant on accept, tutorial lock rules,
 * and completed missions display.
 *
 * A fresh game state is restored in-place before each test via SPA navigation
 * (no full page reload). Test (7) builds its own isolated browser context with
 * a seeded completed state.
 *
 * Tests (run in serial order):
 *   (1) The Available tab lists "First Flight" as the only available mission
 *       at game start.
 *   (2) Clicking "Accept" on "First Flight" moves it to the Accepted tab.
 *   (3) The Accepted tab shows the mission's objectives.
 *   (4) Accepting a mission deducts nothing from cash (missions are free to accept).
 *   (5) When "First Flight" is accepted, no other missions are shown as available
 *       (early tutorial one-at-a-time rule).
 *   (6) The Completed tab is empty at game start.
 *   (7) Simulating mission completion (via seeded completed state) shows the
 *       mission in the Completed tab with its reward amount.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/**
 * The standard fresh-game envelope used for tests (1)–(6):
 * only First Flight in the available bucket, nothing accepted or completed.
 */
const FRESH_ENVELOPE = buildSaveEnvelope({
  saveName: 'Mission E2E Test',
  missions: { available: [{ ...FIRST_FLIGHT_MISSION, status: 'available' }], accepted: [], completed: [] },
});

/** The state portion used to reset gameState between tests. */
const FRESH_STATE = FRESH_ENVELOPE.state;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Mission Control Flow', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Suite setup ───────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Seed save and navigate to hub.
    await seedAndLoadSave(page, FRESH_ENVELOPE);

    // Enter Mission Control initially (so beforeEach can use back button).
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Per-test setup: SPA reset + re-enter building ─────────────────────────

  test.beforeEach(async () => {
    // Reset game state in-place (no page reload).
    await page.evaluate((freshState) => {
      const copy = JSON.parse(JSON.stringify(freshState));
      Object.assign(window.__gameState, copy);
    }, FRESH_STATE);

    // Navigate back to hub.
    await page.click('#mission-control-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // Re-enter Mission Control (triggers fresh UI render from gameState).
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (1) Available tab lists "First Flight" as the only mission at game start

  test('(1) the Available tab lists "First Flight" as the only available mission at game start', async () => {
    // The Available tab is active by default when Mission Control is opened.
    await expect(page.locator('[data-tab-id="available"]')).toHaveClass(/active/);

    // Exactly one mission card must be visible.
    const cards = page.locator('.mc-mission-card');
    await expect(cards).toHaveCount(1);

    // That single card must be titled "First Flight".
    await expect(cards.first()).toContainText('First Flight');
  });

  // ── (2) Clicking "Accept" moves First Flight to the Accepted tab ───────────

  test('(2) clicking "Accept" on "First Flight" moves it to the Accepted tab', async () => {
    // Click the Accept Mission button on the only available card.
    await page.click('.mc-accept-btn');

    // After accepting, the Available tab re-renders as empty — no mission cards.
    await expect(page.locator('.mc-mission-card')).toHaveCount(0);

    // Switch to the Accepted tab.
    await page.click('[data-tab-id="accepted"]');

    // First Flight must appear as an accepted mission card.
    const acceptedCards = page.locator('.mc-mission-card');
    await expect(acceptedCards).toBeVisible();
    await expect(acceptedCards.first()).toContainText('First Flight');
  });

  // ── (3) Accepted tab shows the mission's objectives ────────────────────────

  test("(3) the Accepted tab shows the mission's objectives", async () => {
    // Accept the mission.
    await page.click('.mc-accept-btn');

    // Switch to Accepted tab.
    await page.click('[data-tab-id="accepted"]');

    // The "Objectives" section label must be present.
    await expect(page.locator('.mc-objectives-label')).toBeVisible();

    // At least one objective item must be rendered.
    const items = page.locator('.mc-objective-item');
    await expect(items.first()).toBeVisible();

    // The first objective text matches the First Flight definition.
    await expect(page.locator('.mc-objective-text').first()).toContainText('Reach 100 m altitude');
  });

  // ── (4) Accepting a mission does not deduct cash ───────────────────────────

  test('(4) accepting a mission deducts nothing from cash (missions are free to accept)', async () => {
    // Read cash before accepting.
    const cashBefore = await page.evaluate(() => window.__gameState?.money);
    expect(cashBefore).toBe(STARTING_MONEY);

    // Accept First Flight.
    await page.click('.mc-accept-btn');

    // Cash must be exactly the same after accepting.
    const cashAfter = await page.evaluate(() => window.__gameState?.money);
    expect(cashAfter).toBe(STARTING_MONEY);
  });

  // ── (5) After accepting, Available tab shows no missions ───────────────────

  test('(5) when "First Flight" is accepted, no other missions are shown as available (early tutorial one-at-a-time rule)', async () => {
    // Accept the only available mission (First Flight).
    await page.click('.mc-accept-btn');

    // The Available tab should now be completely empty — no mission cards.
    await expect(page.locator('.mc-mission-card')).toHaveCount(0);

    // The empty-state message must be visible.
    await expect(page.locator('.mc-empty-msg')).toBeVisible();
  });

  // ── (6) Completed tab is empty at game start ───────────────────────────────

  test('(6) the Completed tab is empty at game start', async () => {
    // Switch to the Completed tab.
    await page.click('[data-tab-id="completed"]');

    // No completed-missions table should exist (only the empty-state message).
    await expect(page.locator('.mc-completed-table')).toHaveCount(0);

    // The empty-state message must be visible.
    await expect(page.locator('.mc-empty-msg')).toBeVisible();
  });

  // ── (7) Seeded completed state shows mission in Completed tab with reward ──

  test('(7) simulating mission completion via seeded state shows the mission in the Completed tab with its reward amount', async ({ browser }) => {
    test.setTimeout(60_000);
    // Build an envelope where "First Flight" has already been completed.
    const completedFlight = {
      ...FIRST_FLIGHT_MISSION,
      status:        'completed',
      completedDate: '2026-02-27T00:00:00.000Z',
    };

    const completedEnvelope = buildSaveEnvelope({
      saveName: 'Mission E2E Test',
      missions: { available: [], accepted: [], completed: [completedFlight] },
    });

    // Use an isolated browser context so this test does not share localStorage
    // with the shared page used by tests (1)–(6).
    const ctx = await browser.newContext();
    const p   = await ctx.newPage();

    await seedAndLoadSave(p, completedEnvelope);

    await p.click('[data-building-id="mission-control"]');
    await p.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    // Switch to the Completed tab.
    await p.click('[data-tab-id="completed"]');

    // Exactly one completed mission card must exist.
    const completedCards = p.locator('.mc-mission-card-completed');
    await expect(completedCards).toHaveCount(1);

    // The card must contain the mission title.
    await expect(completedCards.first()).toContainText('First Flight');

    // The card must display the reward amount ($15,000).
    await expect(p.locator('.mc-mission-reward')).toContainText('15,000');

    await p.close();
    await ctx.close();
  });

  // ── (8) Mission reward parts are shown on available, accepted, and completed tabs

  test('(8) mission reward parts are displayed on available, accepted, and completed mission cards', async ({ browser }) => {
    test.setTimeout(60_000);

    // Use mission-005 (Safe Return I) which rewards parachute-mk2.
    const safeReturnAvailable = {
      id:           'mission-005',
      title:        'Safe Return I',
      description:  'Land at less than 10 m/s.',
      location:     'desert',
      objectives: [{
        id:          'obj-005-1',
        type:        'SAFE_LANDING',
        target:      { maxLandingSpeed: 10 },
        completed:   false,
        description: 'Land at 10 m/s or less using a parachute',
      }],
      reward:        35_000,
      unlocksAfter:  ['mission-004'],
      unlockedParts: ['parachute-mk2'],
      requiredParts: ['parachute-mk1'],
      status:        'available',
    };

    const safeReturnAccepted = { ...safeReturnAvailable, status: 'accepted' };
    const safeReturnCompleted = {
      ...safeReturnAvailable,
      status: 'completed',
      completedDate: '2026-02-27T00:00:00.000Z',
    };

    // ── Available tab: rewards shown before accepting ──
    const ctx = await browser.newContext();
    const p   = await ctx.newPage();

    const availEnv = buildSaveEnvelope({
      saveName: 'Rewards Available Test',
      missions: { available: [safeReturnAvailable], accepted: [], completed: [] },
    });
    await seedAndLoadSave(p, availEnv);
    await p.click('[data-building-id="mission-control"]');
    await p.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    await expect(p.locator('.mc-mission-rewards')).toContainText('Mk2 Parachute');

    // ── Accepted tab: rewards shown ──
    await p.evaluate((state) => {
      Object.assign(window.__gameState.missions, {
        available: [],
        accepted: [state],
        completed: [],
      });
    }, safeReturnAccepted);
    await p.click('#mission-control-back-btn');
    await p.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });
    await p.click('[data-building-id="mission-control"]');
    await p.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await p.click('[data-tab-id="accepted"]');

    await expect(p.locator('.mc-mission-rewards')).toContainText('Mk2 Parachute');

    // ── Completed tab: parts unlocked column shown ──
    await p.evaluate((state) => {
      Object.assign(window.__gameState.missions, {
        available: [],
        accepted: [],
        completed: [state],
      });
    }, safeReturnCompleted);
    await p.click('#mission-control-back-btn');
    await p.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });
    await p.click('[data-building-id="mission-control"]');
    await p.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await p.click('[data-tab-id="completed"]');

    await expect(p.locator('.mc-mission-rewards')).toContainText('Mk2 Parachute');

    await p.close();
    await ctx.close();
  });
});
