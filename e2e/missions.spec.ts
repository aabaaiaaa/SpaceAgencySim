import { test, expect } from '@playwright/test';
import {
  STARTING_MONEY,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope, seedAndLoadSave,
} from './helpers.js';
import type { SaveEnvelope, MissionsState } from './helpers.js';

/**
 * E2E — Mission Control Flow
 *
 * Tests the full Mission Control Centre UI: available missions list, accepting
 * a mission, viewing objectives, cash invariant on accept, tutorial lock rules,
 * and completed missions display.
 *
 * Each test receives its own Playwright page fixture. `beforeEach` seeds a
 * fresh save and navigates to the Mission Control building. Tests (7) and (8)
 * re-seed with custom envelopes for their specific scenarios.
 *
 * Tests:
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
 *   (8) Mission reward parts are displayed on available, accepted, and completed
 *       mission cards.
 */

// ---------------------------------------------------------------------------
// Browser-context window shape for page.evaluate() callbacks.
//
// Defined as a local interface (not `declare global`) to avoid conflicting
// with the narrower Window augmentations in the helper modules.  Inside
// evaluate callbacks we cast: `(window as unknown as GW)`
// ---------------------------------------------------------------------------

interface GW {
  __gameState?: {
    money?: number;
    missions?: MissionsState;
  };
}

// ---------------------------------------------------------------------------
// Local mission data interface (mission template spread with status + optional completedDate)
// ---------------------------------------------------------------------------

interface MissionData {
  id: string;
  title: string;
  description: string;
  location: string;
  objectives: {
    id: string;
    type: string;
    target: Record<string, number | string>;
    completed: boolean;
    description: string;
  }[];
  reward: number;
  unlocksAfter: string[];
  unlockedParts: string[];
  requiredParts?: string[];
  status: string;
  completedDate?: string;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/**
 * The standard fresh-game envelope:
 * only First Flight in the available bucket, nothing accepted or completed.
 */
const FRESH_ENVELOPE: SaveEnvelope = buildSaveEnvelope({
  saveName: 'Mission E2E Test',
  missions: { available: [{ ...FIRST_FLIGHT_MISSION, status: 'available' }], accepted: [], completed: [] },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Mission Control Flow', () => {

  // ── Per-test setup: seed save and enter Mission Control ───────────────────

  test.beforeEach(async ({ page }) => {
    await seedAndLoadSave(page, FRESH_ENVELOPE);
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (1) Available tab lists "First Flight" as the only mission at game start

  test('(1) the Available tab lists "First Flight" as the only available mission at game start', async ({ page }) => {
    // The Available tab is active by default when Mission Control is opened.
    await expect(page.locator('[data-tab-id="available"]')).toHaveClass(/active/);

    // Exactly one mission card must be visible.
    const cards = page.locator('.mc-mission-card');
    await expect(cards).toHaveCount(1);

    // That single card must be titled "First Flight".
    await expect(cards.first()).toContainText('First Flight');
  });

  // ── (2) Clicking "Accept" moves First Flight to the Accepted tab ───────────

  test('(2) clicking "Accept" on "First Flight" moves it to the Accepted tab', async ({ page }) => {
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

  test("(3) the Accepted tab shows the mission's objectives", async ({ page }) => {
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

  test('(4) accepting a mission deducts nothing from cash (missions are free to accept)', async ({ page }) => {
    // Read cash before accepting.
    const cashBefore: number | undefined = await page.evaluate(() =>
      (window as unknown as GW).__gameState?.money
    );
    expect(cashBefore).toBe(STARTING_MONEY);

    // Accept First Flight.
    await page.click('.mc-accept-btn');

    // Cash must be exactly the same after accepting.
    const cashAfter: number | undefined = await page.evaluate(() =>
      (window as unknown as GW).__gameState?.money
    );
    expect(cashAfter).toBe(STARTING_MONEY);
  });

  // ── (5) After accepting, Available tab shows no missions ───────────────────

  test('(5) when "First Flight" is accepted, no other missions are shown as available (early tutorial one-at-a-time rule)', async ({ page }) => {
    // Accept the only available mission (First Flight).
    await page.click('.mc-accept-btn');

    // The Available tab should now be completely empty — no mission cards.
    await expect(page.locator('.mc-mission-card')).toHaveCount(0);

    // The empty-state message must be visible.
    await expect(page.locator('.mc-empty-msg')).toBeVisible();
  });

  // ── (6) Completed tab is empty at game start ───────────────────────────────

  test('(6) the Completed tab is empty at game start', async ({ page }) => {
    // Switch to the Completed tab.
    await page.click('[data-tab-id="completed"]');

    // No completed-missions table should exist (only the empty-state message).
    await expect(page.locator('.mc-completed-table')).toHaveCount(0);

    // The empty-state message must be visible.
    await expect(page.locator('.mc-empty-msg')).toBeVisible();
  });

  // ── (7) Seeded completed state shows mission in Completed tab with reward ──

  test('(7) simulating mission completion via seeded state shows the mission in the Completed tab with its reward amount', async ({ page }) => {
    test.setTimeout(60_000);
    // Build an envelope where "First Flight" has already been completed.
    const completedFlight: MissionData = {
      ...FIRST_FLIGHT_MISSION,
      status:        'completed',
      completedDate: '2026-02-27T00:00:00.000Z',
    };

    const completedEnvelope: SaveEnvelope = buildSaveEnvelope({
      saveName: 'Mission E2E Test',
      missions: { available: [], accepted: [], completed: [completedFlight] },
    });

    // Re-seed with the completed envelope (overrides beforeEach's fresh seed).
    await seedAndLoadSave(page, completedEnvelope);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    // Switch to the Completed tab.
    await page.click('[data-tab-id="completed"]');

    // Exactly one completed mission card must exist.
    const completedCards = page.locator('.mc-mission-card-completed');
    await expect(completedCards).toHaveCount(1);

    // The card must contain the mission title.
    await expect(completedCards.first()).toContainText('First Flight');

    // The card must display the reward amount ($25,000).
    await expect(page.locator('.mc-mission-reward')).toContainText('25,000');
  });

  // ── (8) Mission reward parts are shown on available, accepted, and completed tabs

  test('(8) mission reward parts are displayed on available, accepted, and completed mission cards', async ({ page }) => {
    test.setTimeout(60_000);

    // Use mission-005 (Safe Return I) which rewards parachute-mk2.
    const safeReturnAvailable: MissionData = {
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

    const safeReturnAccepted: MissionData = { ...safeReturnAvailable, status: 'accepted' };
    const safeReturnCompleted: MissionData = {
      ...safeReturnAvailable,
      status: 'completed',
      completedDate: '2026-02-27T00:00:00.000Z',
    };

    // ── Available tab: rewards shown before accepting ──
    const availEnv: SaveEnvelope = buildSaveEnvelope({
      saveName: 'Rewards Available Test',
      missions: { available: [safeReturnAvailable], accepted: [], completed: [] },
    });
    // Re-seed with the rewards envelope (overrides beforeEach's fresh seed).
    await seedAndLoadSave(page, availEnv);
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    await expect(page.locator('.mc-mission-rewards')).toContainText('Mk2 Parachute');

    // ── Accepted tab: rewards shown ──
    await page.evaluate((state: MissionData) => {
      const gw = window as unknown as GW;
      Object.assign(gw.__gameState!.missions!, {
        available: [],
        accepted: [state],
        completed: [],
      });
    }, safeReturnAccepted);
    await page.click('#mission-control-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('[data-tab-id="accepted"]');

    await expect(page.locator('.mc-mission-rewards')).toContainText('Mk2 Parachute');

    // ── Completed tab: parts unlocked column shown ──
    await page.evaluate((state: MissionData) => {
      const gw = window as unknown as GW;
      Object.assign(gw.__gameState!.missions!, {
        available: [],
        accepted: [],
        completed: [state],
      });
    }, safeReturnCompleted);
    await page.click('#mission-control-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('[data-tab-id="completed"]');

    await expect(page.locator('.mc-mission-rewards')).toContainText('Mk2 Parachute');
  });
});
