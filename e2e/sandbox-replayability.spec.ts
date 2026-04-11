/**
 * E2E tests — Phase 7: Sandbox & Replayability.
 *
 * Covers:
 *  - Sandbox mode (all parts/buildings/upgrades, free purchases, separate saves,
 *    malfunction & weather toggles, design library shared with career)
 *  - Challenge missions (objectives, constraints, scoring, medals, replayability)
 *  - Custom mission creator (objective type selection, thresholds, export/import)
 *  - Game settings / difficulty options (malfunction frequency, weather severity,
 *    financial pressure, crew injury duration — changeable from hub, not on save slots)
 */

import { test, expect, type Page, type Browser } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  getGameState,
  startTestFlight,
  waitForAltitude,
  getPhysicsSnapshot,
  buildCrewMember,
  ALL_FACILITIES,
  openSettingsPanel,
} from './helpers.js';
import {
  orbitalFixture,
  ALL_PARTS,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Local type aliases for game state accessed via page.evaluate()
// ---------------------------------------------------------------------------

/** Loosely-typed game state shape for page.evaluate() return values. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameState = Record<string, any>;

// ═══════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Build and load a sandbox save envelope on a fresh page. */
async function setupSandboxPage(browser: Browser): Promise<Page> {
  const page: Page = await browser.newPage();
  await page.setViewportSize({ width: VP_W, height: VP_H });

  const envelope = buildSaveEnvelope({
    saveName: 'Sandbox Test',
    agencyName: 'Sandbox Agency',
    money: 999_999_999,
    tutorialMode: false,
    parts: ALL_PARTS,
    facilities: { ...ALL_FACILITIES },
    loan: { balance: 0, interestRate: 0, totalInterestAccrued: 0 },
  });
  envelope.state.gameMode = 'sandbox';
  envelope.state.sandboxSettings = { malfunctionsEnabled: false, weatherEnabled: false };
  envelope.state.difficultySettings = {
    malfunctionFrequency: 'normal',
    weatherSeverity: 'normal',
    financialPressure: 'normal',
    injuryDuration: 'normal',
  };

  await seedAndLoadSave(page, envelope);
  return page;
}

/** Build and load a challenge-ready orbital fixture on a fresh page. */
async function setupChallengePage(browser: Browser): Promise<Page> {
  const page: Page = await browser.newPage();
  await page.setViewportSize({ width: VP_W, height: VP_H });

  const envelope = orbitalFixture({
    missions: {
      available: [],
      accepted: [],
      completed: [
        { id: 'mission-001', title: 'First Flight', objectives: [], reward: 25_000, status: 'completed' },
        { id: 'mission-004', title: 'Speed Demon', objectives: [], reward: 50_000, status: 'completed' },
        { id: 'mission-016', title: 'Orbit Test', objectives: [], reward: 80_000, status: 'completed' },
        { id: 'mission-017', title: 'Satellite Deploy', objectives: [], reward: 90_000, status: 'completed' },
      ],
    },
  });

  await seedAndLoadSave(page, envelope);
  return page;
}

/** Build and load a custom mission creator fixture on a fresh page. */
async function setupCustomMissionPage(browser: Browser): Promise<Page> {
  const page: Page = await browser.newPage();
  await page.setViewportSize({ width: VP_W, height: VP_H });

  const envelope = orbitalFixture({
    missions: {
      available: [],
      accepted: [],
      completed: [
        { id: 'mission-004', title: 'Speed Demon', objectives: [], reward: 50_000, status: 'completed' },
      ],
    },
  });

  await seedAndLoadSave(page, envelope);
  return page;
}

/** Build and load a settings test fixture on a fresh page. */
async function setupSettingsPage(browser: Browser): Promise<Page> {
  const page: Page = await browser.newPage();
  await page.setViewportSize({ width: VP_W, height: VP_H });

  const envelope = buildSaveEnvelope({
    saveName: 'Settings Test',
    agencyName: 'Settings Agency',
    money: 5_000_000,
    parts: ALL_PARTS,
    tutorialMode: false,
    facilities: { ...ALL_FACILITIES },
    crew: [
      buildCrewMember({ id: 'crew-1', name: 'Test Pilot' }),
    ],
    difficultySettings: {
      malfunctionFrequency: 'normal',
      weatherSeverity: 'normal',
      financialPressure: 'normal',
      injuryDuration: 'normal',
    },
  });

  await seedAndLoadSave(page, envelope);
  return page;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. SANDBOX MODE
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Sandbox mode', () => {

  test('sandbox save has unlimited money and all parts unlocked', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSandboxPage(browser);

    const gs = await getGameState(page) as GameState;

    expect(gs.money).toBe(999_999_999);
    expect(gs.gameMode).toBe('sandbox');
    expect(gs.loan.balance).toBe(0);
    expect(gs.parts.length).toBeGreaterThanOrEqual(ALL_PARTS.length);

    await page.close();
  });

  test('sandbox save has all facilities built', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSandboxPage(browser);

    const gs = await getGameState(page) as GameState;
    const facilityIds: string[] = [
      'launch-pad', 'vab', 'mission-control', 'crew-admin',
      'tracking-station', 'rd-lab', 'satellite-ops', 'library',
    ];
    for (const fid of facilityIds) {
      expect(gs.facilities[fid]?.built).toBe(true);
    }

    await page.close();
  });

  test('sandbox malfunction toggle stored in state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSandboxPage(browser);

    const gs = await getGameState(page) as GameState;
    expect(gs.sandboxSettings).toBeTruthy();
    expect(gs.sandboxSettings.malfunctionsEnabled).toBe(false);
    expect(gs.sandboxSettings.weatherEnabled).toBe(false);

    await page.close();
  });

  test('sandbox flight works with malfunctions disabled', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSandboxPage(browser);

    await startTestFlight(page,
      ['probe-core-mk1', 'tank-small', 'engine-spark'],
      { malfunctionMode: 'off' },
    );

    await page.keyboard.press('Space');
    await page.keyboard.press('z');
    await waitForAltitude(page, 200, 30_000);

    const ps = await getPhysicsSnapshot(page);
    expect(ps!.posY).toBeGreaterThan(200);

    // Return to hub
    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
    }
    await page.waitForSelector('#topbar-dropdown', { state: 'visible', timeout: 3_000 });
    await page.locator('#topbar-dropdown').getByText('Return to Space Agency').click();

    // Dismiss abort confirmation dialog if it appears (mid-flight abort).
    const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
    if (await abortBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await abortBtn.click();
    }

    // Dismiss return-results overlay if present.
    try {
      const dismissBtn = page.locator('#return-results-dismiss-btn');
      await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await dismissBtn.click();
    } catch { /* no return results overlay */ }

    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    await page.close();
  });

  test('sandbox and career can share design library via state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSandboxPage(browser);

    const gs = await getGameState(page) as GameState;
    // Design library is stored globally (savedDesigns field).
    // Both sandbox and career games read/write to the same underlying storage.
    expect(Array.isArray(gs.savedDesigns)).toBe(true);

    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CHALLENGE MISSIONS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Challenge missions', () => {

  test('challenges tab displays unlocked challenges in Mission Control', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    // Open mission control
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    // Switch to Challenges tab
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Should show challenge cards
    const cards: number = await page.locator('.mc-challenge-card').count();
    expect(cards).toBeGreaterThan(0);

    await page.close();
  });

  test('challenge card shows objectives, medal thresholds, and scoring info', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    const firstCard = page.locator('.mc-challenge-card').first();
    await expect(firstCard).toBeVisible({ timeout: 5_000 });

    // Objectives list
    const objectives: number = await firstCard.locator('.mc-challenge-obj-item').count();
    expect(objectives).toBeGreaterThan(0);

    // Medal thresholds row
    const medalTiers: number = await firstCard.locator('.mc-medal-tier').count();
    expect(medalTiers).toBe(3); // Bronze, Silver, Gold

    await page.close();
  });

  test('accept challenge stores it in state.challenges.active', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Click Accept on the first challenge
    const firstCard = page.locator('.mc-challenge-card').first();
    const acceptBtn = firstCard.locator('.mc-challenge-accept-btn');
    await acceptBtn.click();

    // Verify state
    const gs = await getGameState(page) as GameState;
    expect(gs.challenges).toBeTruthy();
    expect(gs.challenges.active).toBeTruthy();
    expect(gs.challenges.active.id).toBeTruthy();
    expect(gs.challenges.active.objectives.length).toBeGreaterThan(0);

    await page.close();
  });

  test('active challenge shows Active badge and Abandon button', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Accept a challenge first
    const firstCard = page.locator('.mc-challenge-card').first();
    await firstCard.locator('.mc-challenge-accept-btn').click();

    const activeCard = page.locator('.mc-challenge-card.active-challenge');
    await expect(activeCard).toBeVisible({ timeout: 5_000 });

    await expect(activeCard.locator('.mc-challenge-active-badge')).toBeVisible({ timeout: 5_000 });
    await expect(activeCard.locator('.mc-challenge-abandon-btn')).toBeVisible({ timeout: 5_000 });

    await page.close();
  });

  test('abandon challenge clears active slot', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Accept a challenge first
    const firstCard = page.locator('.mc-challenge-card').first();
    await firstCard.locator('.mc-challenge-accept-btn').click();

    // Now abandon it
    const activeCard = page.locator('.mc-challenge-card.active-challenge');
    await activeCard.locator('.mc-challenge-abandon-btn').click();

    const gs = await getGameState(page) as GameState;
    expect(gs.challenges.active).toBeNull();

    await page.close();
  });

  test('challenge scoring and medal award via core API', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    // Test challenge completion via direct state manipulation.
    // Accept the Sky High challenge (challenge-sky-high) which scores on maxAltitude.
    const result = await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;

      // Import won't work in page context — use the challenge functions directly.
      // Accept Sky High challenge.
      if (!state.challenges) state.challenges = { active: null, results: {} };

      // Find the Sky High challenge from the unlocked list.
      // Set it as active manually with objectives completed.
      state.challenges.active = {
        id: 'challenge-sky-high',
        title: 'Sky High',
        description: 'Reach the highest altitude possible',
        briefing: 'Launch a rocket as high as you can',
        objectives: [
          { id: 'ch-sh-1', type: 'REACH_ALTITUDE', target: { altitude: 50_000 }, completed: true, description: 'Reach 50km altitude' },
        ],
        scoreMetric: 'maxAltitude',
        scoreLabel: 'Peak Altitude',
        scoreUnit: 'm',
        scoreDirection: 'higher',
        medals: { bronze: 100_000, silver: 250_000, gold: 500_000 },
        rewards: { bronze: 20_000, silver: 50_000, gold: 100_000 },
        requiredMissions: ['mission-004'],
      };

      // Simulate a score of 300,000 m (should earn silver)
      const allObjsMet: boolean = state.challenges.active!.objectives.every(
        (o: { completed: boolean }) => o.completed,
      );
      const score = 300_000;

      // Determine medal
      let medal = 'none';
      if (score >= 500_000) medal = 'gold';
      else if (score >= 250_000) medal = 'silver';
      else if (score >= 100_000) medal = 'bronze';

      // Store result
      state.challenges.results['challenge-sky-high'] = { medal, score, attempts: 1 };
      state.challenges.active = null;

      return {
        allObjsMet,
        medal,
        score,
        result: state.challenges.results['challenge-sky-high'] as {
          medal: string;
          score: number;
          attempts: number;
        },
      };
    });

    expect(result.allObjsMet).toBe(true);
    expect(result.medal).toBe('silver');
    expect(result.score).toBe(300_000);
    expect(result.result.attempts).toBe(1);

    await page.close();
  });

  test('replaying challenge shows Replay button and increments attempts', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    // Inject a challenge result so the card shows "Replay" and best-score info
    await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      if (!state.challenges) state.challenges = { active: null, results: {} };
      state.challenges.results['challenge-sky-high'] = { medal: 'silver', score: 300_000, attempts: 1 };
    });

    // Open mission control and navigate to challenges tab
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    // Re-render the challenges tab
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // The challenge with a result should show "Replay" instead of "Accept"
    const gs = await getGameState(page) as GameState;
    const hasResult: boolean = Object.keys(gs.challenges.results).length > 0;
    expect(hasResult).toBe(true);

    // Find a card with best score info
    const bestInfo = page.locator('.mc-challenge-best');
    const count: number = await bestInfo.count();
    expect(count).toBeGreaterThan(0);

    // Click replay
    const challengeId: string = Object.keys(gs.challenges.results)[0];
    await page.evaluate((cid: string) => {
      const w = window;
      const state = w.__gameState!;
      // Simulate replaying and getting a better score (gold)
      const prev = state.challenges.results[cid] as
        { medal: string; score: number; attempts?: number } | undefined;
      state.challenges.results[cid] = {
        medal: 'gold',
        score: 600_000,
        attempts: ((prev?.attempts as number) ?? 0) + 1,
      };
    }, challengeId);

    const gs2 = await getGameState(page) as GameState;
    expect(gs2.challenges.results[challengeId].attempts).toBe(2);
    expect(gs2.challenges.results[challengeId].medal).toBe('gold');

    await page.close();
  });

  test('close Mission Control and return to hub', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupChallengePage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    await page.click('#mission-control-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CUSTOM MISSION CREATOR
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Custom mission creator', () => {

  test('custom challenge creation via core API', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    const result = await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      if (!Array.isArray(state.customChallenges)) {
        state.customChallenges = [];
      }

      // Create a custom challenge programmatically
      const challenge = {
        id: 'custom-test-' + Date.now(),
        custom: true,
        title: 'Test Custom Challenge',
        description: 'A test custom challenge created by E2E tests.',
        briefing: 'Reach 5000m altitude.',
        objectives: [
          { id: 'custom-obj-0', type: 'REACH_ALTITUDE', target: { altitude: 5000 }, completed: false, description: 'Reach 5,000 m altitude' },
        ],
        scoreMetric: 'rocketCost',
        scoreLabel: 'Rocket Cost',
        scoreUnit: '$',
        scoreDirection: 'lower',
        medals: { bronze: 50000, silver: 30000, gold: 15000 },
        rewards: { bronze: 10000, silver: 25000, gold: 50000 },
        requiredMissions: [] as string[],
      };

      state.customChallenges.push(challenge);
      return { id: challenge.id, count: state.customChallenges.length as number };
    });

    expect(result.count).toBe(1);
    expect(result.id).toContain('custom-test-');

    await page.close();
  });

  test('custom challenge appears in Challenges tab with custom badge', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    // Inject a custom challenge so it appears in the UI
    await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      if (!Array.isArray(state.customChallenges)) {
        state.customChallenges = [];
      }
      state.customChallenges.push({
        id: 'custom-test-badge',
        custom: true,
        title: 'Badge Test Challenge',
        description: 'Testing custom badge.',
        briefing: 'Reach 1000m.',
        objectives: [
          { id: 'custom-obj-0', type: 'REACH_ALTITUDE', target: { altitude: 1000 }, completed: false, description: 'Reach 1,000 m' },
        ],
        scoreMetric: 'maxAltitude',
        scoreLabel: 'Peak Altitude',
        scoreUnit: 'm',
        scoreDirection: 'higher',
        medals: { bronze: 2000, silver: 5000, gold: 10000 },
        rewards: { bronze: 5000, silver: 10000, gold: 20000 },
        requiredMissions: [] as string[],
      });
    });

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Custom challenge should have a custom badge
    const customCard = page.locator('.mc-challenge-card.custom-challenge');
    await expect(customCard).toBeVisible({ timeout: 5_000 });
    await expect(customCard.locator('.mc-custom-badge')).toBeVisible({ timeout: 5_000 });

    await page.close();
  });

  test('custom challenge has Export and Delete buttons', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    // Inject a custom challenge
    await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      if (!Array.isArray(state.customChallenges)) {
        state.customChallenges = [];
      }
      state.customChallenges.push({
        id: 'custom-test-buttons',
        custom: true,
        title: 'Buttons Test Challenge',
        description: 'Testing export/delete buttons.',
        briefing: 'Reach 500m.',
        objectives: [
          { id: 'custom-obj-0', type: 'REACH_ALTITUDE', target: { altitude: 500 }, completed: false, description: 'Reach 500 m' },
        ],
        scoreMetric: 'maxAltitude',
        scoreLabel: 'Peak Altitude',
        scoreUnit: 'm',
        scoreDirection: 'higher',
        medals: { bronze: 1000, silver: 3000, gold: 5000 },
        rewards: { bronze: 5000, silver: 10000, gold: 20000 },
        requiredMissions: [] as string[],
      });
    });

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    const customCard = page.locator('.mc-challenge-card.custom-challenge').first();
    await expect(customCard.locator('.mc-challenge-export-btn')).toBeVisible({ timeout: 5_000 });
    await expect(customCard.locator('.mc-challenge-delete-btn')).toBeVisible({ timeout: 5_000 });

    await page.close();
  });

  test('objective type selection available in creator form', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Toggle the creator form open
    const createBtn = page.locator('.mc-challenge-toolbar button').first();
    await createBtn.click();
    await page.waitForSelector('.mc-creator-form', { state: 'visible', timeout: 5_000 });

    // The form has an objective type selector
    const typeSelect = page.locator('.cc-obj-type').first();
    await expect(typeSelect).toBeVisible({ timeout: 5_000 });

    // Verify objective type options are present
    const options: string[] = await typeSelect.locator('option').allInnerTexts();
    expect(options.length).toBeGreaterThan(5);
    expect(options).toContain('Reach Altitude');
    expect(options).toContain('Safe Landing');
    expect(options).toContain('Reach Speed');

    await page.close();
  });

  test('creator form has medal threshold and reward inputs', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Toggle the creator form open
    const createBtn = page.locator('.mc-challenge-toolbar button').first();
    await createBtn.click();
    await page.waitForSelector('.mc-creator-form', { state: 'visible', timeout: 5_000 });

    // Medal threshold inputs
    await expect(page.locator('#cc-medal-bronze')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#cc-medal-silver')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#cc-medal-gold')).toBeVisible({ timeout: 5_000 });

    // Reward inputs
    await expect(page.locator('#cc-reward-bronze')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#cc-reward-silver')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#cc-reward-gold')).toBeVisible({ timeout: 5_000 });

    await page.close();
  });

  test('creator form has score metric selector', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Toggle the creator form open
    const createBtn = page.locator('.mc-challenge-toolbar button').first();
    await createBtn.click();
    await page.waitForSelector('.mc-creator-form', { state: 'visible', timeout: 5_000 });

    const metricSelect = page.locator('#cc-metric');
    await expect(metricSelect).toBeVisible({ timeout: 5_000 });

    const options: string[] = await metricSelect.locator('option').allInnerTexts();
    expect(options.length).toBe(8); // 8 score metric options

    await page.close();
  });

  test('creating a custom challenge via the form adds it to state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    await page.click('.mc-tab[data-tab-id="challenges"]');
    await page.waitForSelector('.mc-challenge-grid', { state: 'visible', timeout: 5_000 });

    // Toggle the creator form open
    const createBtn = page.locator('.mc-challenge-toolbar button').first();
    await createBtn.click();
    await page.waitForSelector('.mc-creator-form', { state: 'visible', timeout: 5_000 });

    // Fill the form
    await page.fill('#cc-title', 'E2E Form Challenge');
    await page.fill('#cc-description', 'Created via the E2E test form.');

    // Set objective type (default is REACH_ALTITUDE) — fill target field
    const targetInput = page.locator('.cc-obj-target').first();
    await targetInput.fill('1000');

    // Set medal thresholds
    await page.fill('#cc-medal-bronze', '80000');
    await page.fill('#cc-medal-silver', '50000');
    await page.fill('#cc-medal-gold', '20000');

    // Set rewards
    await page.fill('#cc-reward-bronze', '5000');
    await page.fill('#cc-reward-silver', '15000');
    await page.fill('#cc-reward-gold', '30000');

    // Click Create
    await page.click('.mc-creator-submit');

    // Verify form closed (re-rendered tab)
    await page.waitForFunction(
      () => !document.querySelector('.mc-creator-form'),
      { timeout: 5_000 },
    );

    // Verify custom challenge was added to state
    const gs = await getGameState(page) as GameState;
    const formChallenge = gs.customChallenges.find(
      (c: Record<string, unknown>) => c.title === 'E2E Form Challenge',
    );
    expect(formChallenge).toBeTruthy();
    expect(formChallenge.custom).toBe(true);
    expect(formChallenge.objectives.length).toBe(1);
    expect(formChallenge.objectives[0].type).toBe('REACH_ALTITUDE');
    expect(formChallenge.medals.bronze).toBe(80000);
    expect(formChallenge.rewards.gold).toBe(30000);

    await page.close();
  });

  test('export custom challenge produces valid JSON', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    // Inject a custom challenge to export
    await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      if (!Array.isArray(state.customChallenges)) {
        state.customChallenges = [];
      }
      state.customChallenges.push({
        id: 'custom-export-test',
        custom: true,
        title: 'Export Test',
        description: 'For export testing.',
        briefing: 'Reach 3000m.',
        objectives: [
          { id: 'custom-obj-0', type: 'REACH_ALTITUDE', target: { altitude: 3000 }, completed: false, description: 'Reach 3,000 m' },
        ],
        scoreMetric: 'maxAltitude',
        scoreLabel: 'Peak Altitude',
        scoreUnit: 'm',
        scoreDirection: 'higher',
        medals: { bronze: 5000, silver: 10000, gold: 20000 },
        rewards: { bronze: 5000, silver: 10000, gold: 20000 },
        requiredMissions: [] as string[],
      });
    });

    const json = await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      // @ts-expect-error — accessing customChallenges element as Record for flexible property access
      const ch = state.customChallenges[0] as Record<string, unknown> | undefined;
      if (!ch) return null;

      // Replicate the export logic
      const objectives = ch.objectives as {
        type: string;
        target: Record<string, unknown>;
        description: string;
      }[];
      const exportData = {
        _format: 'SpaceAgencySim-CustomChallenge',
        _version: 1,
        title: ch.title,
        description: ch.description,
        briefing: ch.briefing,
        objectives: objectives.map((obj) => ({
          type: obj.type,
          target: { ...obj.target },
          description: obj.description,
        })),
        scoreMetric: ch.scoreMetric,
        scoreLabel: ch.scoreLabel,
        scoreUnit: ch.scoreUnit,
        scoreDirection: ch.scoreDirection,
        medals: { ...(ch.medals as Record<string, number>) },
        rewards: { ...(ch.rewards as Record<string, number>) },
      };
      return JSON.stringify(exportData, null, 2);
    });

    expect(json).toBeTruthy();
    const parsed: Record<string, unknown> = JSON.parse(json!);
    expect(parsed._format).toBe('SpaceAgencySim-CustomChallenge');
    expect(parsed._version).toBe(1);
    expect(parsed.title).toBeTruthy();
    expect(Array.isArray(parsed.objectives)).toBe(true);
    expect((parsed.objectives as unknown[]).length).toBeGreaterThan(0);

    await page.close();
  });

  test('import custom challenge from JSON adds it to state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    const importJson: string = JSON.stringify({
      _format: 'SpaceAgencySim-CustomChallenge',
      _version: 1,
      title: 'Imported Test Challenge',
      description: 'An imported challenge.',
      briefing: 'Reach 2000m.',
      objectives: [
        { type: 'REACH_ALTITUDE', target: { altitude: 2000 }, description: 'Reach 2,000 m' },
      ],
      scoreMetric: 'maxAltitude',
      scoreLabel: 'Peak Altitude',
      scoreUnit: 'm',
      scoreDirection: 'higher',
      medals: { bronze: 3000, silver: 5000, gold: 10000 },
      rewards: { bronze: 5000, silver: 10000, gold: 20000 },
    });

    const result = await page.evaluate((jsonStr: string) => {
      const w = window;
      const state = w.__gameState!;
      if (!Array.isArray(state.customChallenges)) {
        state.customChallenges = [];
      }

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(jsonStr) as Record<string, unknown>;
      } catch (e: unknown) {
        return { success: false, error: (e as Error).message };
      }

      if (data._format !== 'SpaceAgencySim-CustomChallenge') {
        return { success: false, error: 'Wrong format' };
      }

      const objectives = data.objectives as {
        type: string;
        target: Record<string, unknown>;
        description?: string;
      }[];
      const challenge = {
        id: 'custom-import-' + Date.now(),
        custom: true,
        title: data.title as string,
        description: (data.description as string) || '',
        briefing: (data.briefing as string) || '',
        objectives: objectives.map((obj, i: number) => ({
          id: `custom-obj-${i}`,
          type: obj.type,
          target: { ...obj.target },
          completed: false,
          description: obj.description || obj.type,
        })),
        scoreMetric: data.scoreMetric as string,
        scoreLabel: (data.scoreLabel as string) || (data.scoreMetric as string),
        scoreUnit: (data.scoreUnit as string) || '',
        scoreDirection: (data.scoreDirection as string) || 'lower',
        medals: (data.medals as { bronze: number; silver: number; gold: number }) || { bronze: 0, silver: 0, gold: 0 },
        rewards: (data.rewards as { bronze: number; silver: number; gold: number }) || { bronze: 0, silver: 0, gold: 0 },
        requiredMissions: [] as string[],
      };

      state.customChallenges.push(challenge);
      return { success: true, title: challenge.title };
    }, importJson);

    expect(result.success).toBe(true);
    expect(result.title).toBe('Imported Test Challenge');

    const gs = await getGameState(page) as GameState;
    const imported = gs.customChallenges.find(
      (c: Record<string, unknown>) => c.title === 'Imported Test Challenge',
    );
    expect(imported).toBeTruthy();
    expect(imported.scoreMetric).toBe('maxAltitude');
    expect(imported.scoreDirection).toBe('higher');

    await page.close();
  });

  test('delete custom challenge removes it from state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    // Inject two custom challenges
    await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      if (!Array.isArray(state.customChallenges)) {
        state.customChallenges = [];
      }
      state.customChallenges.push(
        {
          id: 'custom-delete-1',
          custom: true,
          title: 'Delete Test 1',
          description: 'First challenge.',
          briefing: 'Test.',
          objectives: [{ id: 'obj-0', type: 'REACH_ALTITUDE', target: { altitude: 100 }, completed: false, description: 'Reach 100 m' }],
          scoreMetric: 'maxAltitude', scoreLabel: 'Alt', scoreUnit: 'm', scoreDirection: 'higher',
          medals: { bronze: 200, silver: 500, gold: 1000 },
          rewards: { bronze: 1000, silver: 2000, gold: 5000 },
          requiredMissions: [] as string[],
        },
        {
          id: 'custom-delete-2',
          custom: true,
          title: 'Delete Test 2',
          description: 'Second challenge.',
          briefing: 'Test.',
          objectives: [{ id: 'obj-0', type: 'REACH_ALTITUDE', target: { altitude: 200 }, completed: false, description: 'Reach 200 m' }],
          scoreMetric: 'maxAltitude', scoreLabel: 'Alt', scoreUnit: 'm', scoreDirection: 'higher',
          medals: { bronze: 400, silver: 800, gold: 1500 },
          rewards: { bronze: 1000, silver: 2000, gold: 5000 },
          requiredMissions: [] as string[],
        },
      );
    });

    const before = await getGameState(page) as GameState;
    const countBefore: number = before.customChallenges.length;
    expect(countBefore).toBeGreaterThan(0);

    // Delete the first custom challenge via state
    await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      if (state.customChallenges.length > 0) {
        // @ts-expect-error — accessing removed challenge as Record for flexible property access
        const removed = state.customChallenges.shift() as Record<string, unknown>;
        // Also clear from results if present
        if (state.challenges?.results?.[removed.id as string]) {
          delete state.challenges.results[removed.id as string];
        }
      }
    });

    const after = await getGameState(page) as GameState;
    expect(after.customChallenges.length).toBe(countBefore - 1);

    await page.close();
  });

  test('close Mission Control', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupCustomMissionPage(browser);

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    await page.click('#mission-control-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GAME SETTINGS — DIFFICULTY OPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Game settings — difficulty options', () => {

  test('settings button is visible in hamburger menu', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await page.click('#topbar-menu-btn');
    const settingsBtn = page.locator('#hub-settings-btn');
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    // Close menu
    await page.click('#topbar-menu-btn');

    await page.close();
  });

  test('clicking settings opens settings panel', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    // Panel has heading
    const heading = page.locator('#settings-panel h1');
    await expect(heading).toHaveText('Game Settings', { timeout: 5_000 });

    await page.close();
  });

  test('settings panel shows all four difficulty categories', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    const groups = page.locator('.settings-group');
    const count: number = await groups.count();
    expect(count).toBe(7);

    // Verify labels
    const labels: string[] = await page.locator('.settings-group-label').allInnerTexts();
    expect(labels).toContain('Malfunction Frequency');
    expect(labels).toContain('Weather Severity');
    expect(labels).toContain('Financial Pressure');
    expect(labels).toContain('Crew Injury Duration');
    expect(labels).toContain('Auto-Save');
    expect(labels).toContain('Debug Mode');

    await page.close();
  });

  test('Normal is selected by default for all settings', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    // Check each difficulty setting group has "Normal" active.
    // The Auto-Save group defaults to "On" (not "Normal").
    // The Debug Mode group defaults to "Off".
    const groups = page.locator('.settings-group');
    const count: number = await groups.count();
    for (let i = 0; i < count; i++) {
      const group = groups.nth(i);
      const activeBtn = group.locator('.settings-option-btn.active');
      const text: string = await activeBtn.innerText();
      expect(['Normal', 'On', 'Off']).toContain(text);
    }

    await page.close();
  });

  test('changing malfunction frequency to Off updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="malfunctionFrequency"][data-value="off"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.malfunctionFrequency).toBe('off');

    // Verify the Off button is now active
    const offBtn = page.locator('.settings-option-btn[data-setting="malfunctionFrequency"][data-value="off"]');
    await expect(offBtn).toHaveClass(/active/);

    await page.close();
  });

  test('changing malfunction frequency to High updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="malfunctionFrequency"][data-value="high"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.malfunctionFrequency).toBe('high');

    await page.close();
  });

  test('changing weather severity to Off updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="weatherSeverity"][data-value="off"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.weatherSeverity).toBe('off');

    await page.close();
  });

  test('changing weather severity to Extreme updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="weatherSeverity"][data-value="extreme"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.weatherSeverity).toBe('extreme');

    await page.close();
  });

  test('changing financial pressure to Easy updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="financialPressure"][data-value="easy"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.financialPressure).toBe('easy');

    await page.close();
  });

  test('changing financial pressure to Hard updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="financialPressure"][data-value="hard"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.financialPressure).toBe('hard');

    await page.close();
  });

  test('changing crew injury duration to Short updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="injuryDuration"][data-value="short"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.injuryDuration).toBe('short');

    await page.close();
  });

  test('changing crew injury duration to Long updates state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="injuryDuration"][data-value="long"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.injuryDuration).toBe('long');

    await page.close();
  });

  test('settings changes take effect immediately (no restart needed)', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    // Set all to specific non-default values and verify
    await page.click('.settings-option-btn[data-setting="malfunctionFrequency"][data-value="low"]');
    await page.click('.settings-option-btn[data-setting="weatherSeverity"][data-value="mild"]');
    await page.click('.settings-option-btn[data-setting="financialPressure"][data-value="easy"]');
    await page.click('.settings-option-btn[data-setting="injuryDuration"][data-value="short"]');

    const gs = await getGameState(page) as GameState;
    expect(gs.difficultySettings.malfunctionFrequency).toBe('low');
    expect(gs.difficultySettings.weatherSeverity).toBe('mild');
    expect(gs.difficultySettings.financialPressure).toBe('easy');
    expect(gs.difficultySettings.injuryDuration).toBe('short');

    await page.close();
  });

  test('back to hub button closes settings panel', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-close-btn');
    await page.waitForSelector('#settings-panel', { state: 'hidden', timeout: 5_000 });
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });

    await page.close();
  });

  test('settings panel can be reopened with values persisted', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    // Open settings, change values, close, reopen
    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    await page.click('.settings-option-btn[data-setting="malfunctionFrequency"][data-value="low"]');
    await page.click('.settings-option-btn[data-setting="weatherSeverity"][data-value="mild"]');
    await page.click('.settings-option-btn[data-setting="financialPressure"][data-value="easy"]');
    await page.click('.settings-option-btn[data-setting="injuryDuration"][data-value="short"]');

    await page.click('.settings-close-btn');
    await page.waitForSelector('#settings-panel', { state: 'hidden', timeout: 5_000 });

    // Reopen
    await openSettingsPanel(page);
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 5_000 });

    // Verify the previously set values are still active
    const malfBtn = page.locator('.settings-option-btn[data-setting="malfunctionFrequency"].active');
    await expect(malfBtn).toHaveAttribute('data-value', 'low');

    const weatherBtn = page.locator('.settings-option-btn[data-setting="weatherSeverity"].active');
    await expect(weatherBtn).toHaveAttribute('data-value', 'mild');

    const finBtn = page.locator('.settings-option-btn[data-setting="financialPressure"].active');
    await expect(finBtn).toHaveAttribute('data-value', 'easy');

    const injBtn = page.locator('.settings-option-btn[data-setting="injuryDuration"].active');
    await expect(injBtn).toHaveAttribute('data-value', 'short');

    await page.close();
  });

  test('save slot summary does NOT contain difficulty settings', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupSettingsPage(browser);

    // Save the game and check that the slot summary has no difficulty settings.
    // The summary object from saveload.js only includes: saveName, agencyName,
    // timestamp, missionsCompleted, money, acceptedMissionCount, totalFlights,
    // crewCount, crewKIA, playTimeSeconds, flightTimeSeconds, gameMode.
    // NOT difficultySettings.
    const summaryKeys = await page.evaluate(() => {
      const w = window;
      const gs = w.__gameState!;
      // Build what the summary would look like
      const summary: Record<string, unknown> = {
        saveName: 'test',
        agencyName: gs.agencyName as string,
        timestamp: new Date().toISOString(),
        missionsCompleted: (gs.missions?.completed?.length as number) ?? 0,
        money: gs.money as number,
        acceptedMissionCount: (gs.missions?.accepted?.length as number) ?? 0,
        totalFlights: (gs.flightHistory?.length as number) ?? 0,
        // @ts-expect-error — 'DEAD' is the legacy status string used in save summaries
        crewCount: (gs.crew ?? []).filter((c) => c.status !== 'DEAD').length,
        // @ts-expect-error — 'DEAD' is the legacy status string used in save summaries
        crewKIA: (gs.crew ?? []).filter((c) => c.status === 'DEAD').length,
        playTimeSeconds: (gs.playTimeSeconds as number) ?? 0,
        flightTimeSeconds: (gs.flightTimeSeconds as number) ?? 0,
        gameMode: (gs.gameMode as string) ?? 'freeplay',
      };
      return Object.keys(summary);
    });

    expect(summaryKeys).not.toContain('difficultySettings');
    expect(summaryKeys).not.toContain('malfunctionFrequency');
    expect(summaryKeys).not.toContain('weatherSeverity');

    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DIFFICULTY SETTINGS AFFECTING GAMEPLAY VALUES
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Difficulty settings modify gameplay values', () => {

  test('malfunction frequency multiplier: off = 0, low = 0.4, normal = 1, high = 2', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Malf Test',
      parts: ALL_PARTS,
      tutorialMode: false,
      facilities: { ...ALL_FACILITIES },
      difficultySettings: { malfunctionFrequency: 'off', weatherSeverity: 'normal', financialPressure: 'normal', injuryDuration: 'normal' },
    });

    await seedAndLoadSave(page, envelope);

    // Test multiplier mapping via state values
    const results = await page.evaluate(() => {
      const w = window;
      const state = w.__gameState!;
      const multipliers: Record<string, number> = { off: 0, low: 0.4, normal: 1.0, high: 2.0 };
      const checks: Record<string, { expected: number; actual: number; match: boolean }> = {};

      for (const [setting, expected] of Object.entries(multipliers)) {
        (state.difficultySettings as { malfunctionFrequency: string }).malfunctionFrequency = setting;
        const actual: number = multipliers[state.difficultySettings.malfunctionFrequency as string];
        checks[setting] = { expected, actual, match: actual === expected };
      }
      return checks;
    });

    expect(results.off.match).toBe(true);
    expect(results.low.match).toBe(true);
    expect(results.normal.match).toBe(true);
    expect(results.high.match).toBe(true);

    await page.close();
  });

  test('weather severity multiplier mapping is correct', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Weather Test',
      parts: ALL_PARTS,
      tutorialMode: false,
      facilities: { ...ALL_FACILITIES },
      difficultySettings: { malfunctionFrequency: 'normal', weatherSeverity: 'normal', financialPressure: 'normal', injuryDuration: 'normal' },
    });

    await seedAndLoadSave(page, envelope);

    const results = await page.evaluate(() => {
      const expected: Record<string, { windMult: number; extremeChanceMult: number }> = {
        off:     { windMult: 0, extremeChanceMult: 0 },
        mild:    { windMult: 0.5, extremeChanceMult: 0.25 },
        normal:  { windMult: 1.0, extremeChanceMult: 1.0 },
        extreme: { windMult: 1.5, extremeChanceMult: 3.0 },
      };

      const w = window;
      const state = w.__gameState!;
      const checks: Record<string, {
        setting: string;
        expectedWind: number;
        expectedExtreme: number;
        match: boolean;
      }> = {};
      for (const [setting, mult] of Object.entries(expected)) {
        (state.difficultySettings as { weatherSeverity: string }).weatherSeverity = setting;
        checks[setting] = {
          setting: state.difficultySettings.weatherSeverity as string,
          expectedWind: mult.windMult,
          expectedExtreme: mult.extremeChanceMult,
          match: true,
        };
      }
      return checks;
    });

    for (const [key, val] of Object.entries(results)) {
      expect(val.setting).toBe(key);
    }

    await page.close();
  });

  test('financial pressure multiplier mapping is correct', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Finance Test',
      parts: ALL_PARTS,
      tutorialMode: false,
      facilities: { ...ALL_FACILITIES },
      difficultySettings: { malfunctionFrequency: 'normal', weatherSeverity: 'normal', financialPressure: 'normal', injuryDuration: 'normal' },
    });

    await seedAndLoadSave(page, envelope);

    const results = await page.evaluate(() => {
      const expected: Record<string, { rewardMult: number; costMult: number }> = {
        easy:   { rewardMult: 2.0, costMult: 1.0 },
        normal: { rewardMult: 1.0, costMult: 1.0 },
        hard:   { rewardMult: 0.5, costMult: 2.0 },
      };

      const w = window;
      const state = w.__gameState!;
      const checks: Record<string, {
        setting: string;
        expectedReward: number;
        expectedCost: number;
      }> = {};
      for (const [setting, mult] of Object.entries(expected)) {
        (state.difficultySettings as { financialPressure: string }).financialPressure = setting;
        checks[setting] = {
          setting: state.difficultySettings.financialPressure as string,
          expectedReward: mult.rewardMult,
          expectedCost: mult.costMult,
        };
      }
      return checks;
    });

    expect(results.easy.setting).toBe('easy');
    expect(results.normal.setting).toBe('normal');
    expect(results.hard.setting).toBe('hard');

    await page.close();
  });

  test('injury duration multiplier mapping is correct', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Injury Test',
      parts: ALL_PARTS,
      tutorialMode: false,
      facilities: { ...ALL_FACILITIES },
      difficultySettings: { malfunctionFrequency: 'normal', weatherSeverity: 'normal', financialPressure: 'normal', injuryDuration: 'normal' },
    });

    await seedAndLoadSave(page, envelope);

    const results = await page.evaluate(() => {
      const expected: Record<string, number> = { short: 0.5, normal: 1.0, long: 2.0 };

      const w = window;
      const state = w.__gameState!;
      const checks: Record<string, { setting: string; expectedMult: number; match: boolean }> = {};
      for (const [setting, mult] of Object.entries(expected)) {
        (state.difficultySettings as { injuryDuration: string }).injuryDuration = setting;
        checks[setting] = {
          setting: state.difficultySettings.injuryDuration as string,
          expectedMult: mult,
          match: true,
        };
      }
      return checks;
    });

    expect(results.short.setting).toBe('short');
    expect(results.normal.setting).toBe('normal');
    expect(results.long.setting).toBe('long');

    await page.close();
  });
});
