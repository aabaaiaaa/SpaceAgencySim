import { test, expect } from '@playwright/test';

/**
 * E2E — Mission Control Flow
 *
 * Tests the full Mission Control Centre UI: available missions list, accepting
 * a mission, viewing objectives, cash invariant on accept, tutorial lock rules,
 * and completed missions display.
 *
 * A fresh game save (slot 0) is injected into localStorage via addInitScript
 * before each test so every test begins from a known, consistent state.
 * Test (7) builds its own isolated browser context with a seeded completed state.
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

const STARTING_MONEY = 2_000_000;
const SAVE_KEY       = 'spaceAgencySave_0';

/**
 * Mirror of the mission-001 "First Flight" template from src/data/missions.js.
 * Objective description and reward are hard-coded to match the live data so that
 * assertions stay in sync with the actual game content.
 */
const FIRST_FLIGHT = {
  id:           'mission-001',
  title:        'First Flight',
  description:
    'Our engineers have assembled a basic sounding rocket. Your task is simple: ' +
    'get it off the pad and reach 100 metres altitude. This is the first step ' +
    'in what will become a legendary space programme.',
  location:     'desert',
  objectives: [
    {
      id:          'obj-001-1',
      type:        'REACH_ALTITUDE',
      target:      { altitude: 100 },
      completed:   false,
      description: 'Reach 100 m altitude',
    },
  ],
  reward:        15_000,
  unlocksAfter:  [],
  unlockedParts: [],
  status:        'available',
};

/**
 * Build a save-slot envelope to inject into localStorage.
 *
 * @param {{ available: object[], accepted: object[], completed: object[] }} missionsState
 * @returns {object}
 */
function buildSaveEnvelope(missionsState) {
  return {
    saveName:  'Mission E2E Test',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:      'Test Agency',
      money:           STARTING_MONEY,
      loan:            { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
      missions:        missionsState,
      crew:            [],
      rockets:         [],
      parts:           [],
      flightHistory:   [],
      playTimeSeconds: 0,
      currentFlight:   null,
    },
  };
}

/**
 * The standard fresh-game envelope used for tests (1)–(6):
 * only First Flight in the available bucket, nothing accepted or completed.
 */
const FRESH_ENVELOPE = buildSaveEnvelope({
  available: [{ ...FIRST_FLIGHT }],
  accepted:  [],
  completed: [],
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Mission Control Flow', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Suite setup ───────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Register an init script that writes the fresh save into localStorage
    // on every subsequent navigation to '/'.  This is the seed mechanism for
    // tests (1)–(6); test (7) uses its own isolated context.
    await page.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: FRESH_ENVELOPE });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Per-test setup: navigate to Mission Control with fresh state ───────────

  test.beforeEach(async () => {
    // goto('/') triggers the registered addInitScript, which writes the fresh
    // save envelope into localStorage before the page's JS runs.
    await page.goto('/');

    // A save exists in slot 0, so the load screen is shown (not new-game).
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // Load slot 0.
    await page.click('[data-action="load"][data-slot="0"]');

    // Hub overlay confirms the game has loaded and window.__gameState is set.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate to Mission Control.
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
      ...FIRST_FLIGHT,
      status:        'completed',
      completedDate: '2026-02-27T00:00:00.000Z',
    };

    const completedEnvelope = buildSaveEnvelope({
      available: [],
      accepted:  [],
      completed: [completedFlight],
    });

    // Use an isolated browser context so this test does not share localStorage
    // with the shared page used by tests (1)–(6).
    const ctx = await browser.newContext();
    const p   = await ctx.newPage();

    await p.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: completedEnvelope });

    await p.goto('/');
    await p.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await p.click('[data-action="load"][data-slot="0"]');
    await p.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await p.click('[data-building-id="mission-control"]');
    await p.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    // Switch to the Completed tab.
    await p.click('[data-tab-id="completed"]');

    // The completed-missions table must be rendered (not the empty-state message).
    await expect(p.locator('.mc-completed-table')).toBeVisible();

    // Exactly one completed mission row must exist.
    await expect(p.locator('.mc-completed-table tbody tr')).toHaveCount(1);

    // The title cell must name "First Flight".
    await expect(p.locator('.mc-completed-title-cell')).toContainText('First Flight');

    // The reward cell must display the correct reward amount ($15,000).
    await expect(p.locator('.mc-completed-reward-cell')).toContainText('15,000');

    await p.close();
    await ctx.close();
  });
});
