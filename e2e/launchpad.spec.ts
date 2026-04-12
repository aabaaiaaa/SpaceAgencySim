import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  SAVE_KEY, STARTING_MONEY,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
} from './helpers.js';

/**
 * E2E — Launch Pad
 *
 * Tests the Launch Pad screen: verifying that previously launched rocket
 * designs appear in the list, and that a rocket can be relaunched from the
 * launch pad directly.
 *
 * A pre-built save is seeded into localStorage with one rocket design
 * already present in `gameState.rockets` (simulating a previous VAB launch).
 *
 * Each test seeds its own save and gets its own page instance.
 *
 * Tests:
 *   (1)    : Launch pad shows saved rocket designs
 *   (2)    : Launch pad shows empty state when no rockets exist
 *   (3)    : Clicking Launch starts the flight scene from the launch pad
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENCY_NAME: string = 'LP Test Agency';

// Unlocked parts needed for the seeded rocket design.
const UNLOCKED_PARTS: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Seeded design types
// ---------------------------------------------------------------------------

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

// A rocket design mirroring the format produced by VAB _doLaunch().
// Three parts: cmd-mk1, tank-small, engine-spark stacked vertically.
// Parts are ordered so reconstruction produces inst-1, inst-2, inst-3.
const SEEDED_DESIGN: RocketDesign = {
  id:          'design-lp-test',
  name:        'Test Rocket Alpha',
  parts: [
    { partId: 'cmd-mk1',      position: { x: 0, y: 0 } },
    { partId: 'tank-small',   position: { x: 0, y: 40 } },
    { partId: 'engine-spark', position: { x: 0, y: 80 } },
  ],
  staging: {
    // inst-1 = cmd-mk1 (EJECT), inst-3 = engine-spark (IGNITE)
    // Stage 1 fires the engine; cmd-mk1 is unstaged (eject = emergency only).
    stages:   [['inst-3']],
    unstaged: ['inst-1'],
  },
  totalMass:   1010,   // 840 + 50 + 120
  totalThrust: 60,     // engine-spark = 60 kN
  createdDate: new Date().toISOString(),
  updatedDate: new Date().toISOString(),
};

/** Build a save-slot envelope for launchpad tests. */
function lpSaveEnvelope(rockets: RocketDesign[] = []): ReturnType<typeof buildSaveEnvelope> {
  return buildSaveEnvelope({
    saveName: 'LP E2E Test',
    agencyName: AGENCY_NAME,
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
    // @ts-expect-error — RocketDesign is structurally compatible with Record<string, unknown>
    rockets: rockets,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Launch Pad', () => {

  // -- (1) Launch pad shows saved rocket designs -----------------------------

  test('(1) launch pad displays previously launched rocket designs', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // Seed a save with one rocket design.
    await page.addInitScript(({ key, envelope }: { key: string; envelope: ReturnType<typeof buildSaveEnvelope> }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: lpSaveEnvelope([SEEDED_DESIGN]) });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Load the save.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Navigate to the Launch Pad.
    await page.click('[data-building-id="launch-pad"]');
    await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 5_000 });

    // The rocket list should be visible (not the empty state).
    await expect(page.locator('#launch-pad-rocket-list')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#launch-pad-status')).toHaveCount(0, { timeout: 5_000 });

    // Exactly one rocket card should appear.
    const cards = page.locator('.lp-rocket-card');
    await expect(cards).toHaveCount(1, { timeout: 5_000 });

    // The card shows the rocket name.
    await expect(cards.first()).toContainText('Test Rocket Alpha', { timeout: 5_000 });

    // The card shows part count, mass, and thrust.
    await expect(cards.first()).toContainText('Parts: 3', { timeout: 5_000 });
    await expect(cards.first()).toContainText('1,010 kg', { timeout: 5_000 });
    await expect(cards.first()).toContainText('60 kN', { timeout: 5_000 });

    // The card shows the launch cost (cmd-mk1=$8,000 + tank-small=$800 + engine-spark=$6,000 = $14,800).
    await expect(page.locator('.lp-rocket-cost')).toContainText('$14,800', { timeout: 5_000 });

    // The Launch button shows the cost and is enabled (player has $2,000,000).
    const launchBtn = page.locator('.lp-launch-btn');
    await expect(launchBtn).toBeVisible({ timeout: 5_000 });
    await expect(launchBtn).toContainText('$14,800', { timeout: 5_000 });
    await expect(launchBtn).not.toBeDisabled({ timeout: 5_000 });
  });

  // -- (2) Launch pad shows empty state when no rockets exist ----------------

  test('(2) launch pad shows empty state when no rockets exist', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // Seed a save with NO rocket designs (overwrite the previous seed).
    await page.addInitScript(({ key, envelope }: { key: string; envelope: ReturnType<typeof buildSaveEnvelope> }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: lpSaveEnvelope([]) });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Load the save.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Navigate to the Launch Pad.
    await page.click('[data-building-id="launch-pad"]');
    await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 5_000 });

    // The empty-state placeholder should be visible.
    await expect(page.locator('#launch-pad-status')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#launch-pad-status')).toContainText('No rockets are ready for launch', { timeout: 5_000 });

    // No rocket cards or list.
    await expect(page.locator('#launch-pad-rocket-list')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.lp-rocket-card')).toHaveCount(0, { timeout: 5_000 });
  });

  // -- (3) Clicking Launch starts the flight scene from the launch pad -------

  test('(3) clicking Launch on a design starts the flight scene', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // Seed a save with the test rocket design.
    await page.addInitScript(({ key, envelope }: { key: string; envelope: ReturnType<typeof buildSaveEnvelope> }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: lpSaveEnvelope([SEEDED_DESIGN]) });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Load the save.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Navigate to the Launch Pad.
    await page.click('[data-building-id="launch-pad"]');
    await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 5_000 });

    // Click Launch on the rocket card.
    // cmd-mk1 has 1 seat -> a crew dialog will appear.
    await page.click('.lp-launch-btn');

    // The crew dialog should appear (cmd-mk1 has a crew seat).
    await page.waitForSelector('#lp-crew-overlay', { state: 'visible', timeout: 5_000 });
    await expect(page.locator('#lp-crew-dialog')).toBeVisible({ timeout: 5_000 });

    // Confirm launch with empty seats (no crew to assign).
    await page.click('.lp-crew-confirm-btn');

    // The launch pad overlay should be gone.
    await expect(page.locator('#launch-pad-overlay')).toHaveCount(0, { timeout: 5_000 });

    // The flight scene should be running — check for the flight HUD.
    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 5_000 });

    // Verify the physics state is exposed (flight is active).
    await page.waitForFunction(
      (): boolean =>
        typeof window.__flightPs !== 'undefined',
      { timeout: 5_000 },
    );

    // Verify currentFlight references the design we launched.
    const rocketId: string | undefined = await page.evaluate(
      (): string | undefined =>
        window.__gameState?.currentFlight?.rocketId,
    );
    expect(rocketId).toBe('design-lp-test');

    // Verify the launch cost was deducted from the player's money.
    // Cost = $14,800 (cmd-mk1 $8,000 + tank-small $800 + engine-spark $6,000).
    const money: number | undefined = await page.evaluate(
      (): number | undefined =>
        window.__gameState?.money,
    );
    expect(money).toBe(STARTING_MONEY - 14_800);
  });

  // -- (4) Launch button disabled when player can't afford the rocket --------

  test('(4) launch button is disabled when player cannot afford the rocket', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // Seed a save with very low money — not enough to cover the $14,800 cost.
    const poorEnvelope: ReturnType<typeof buildSaveEnvelope> = lpSaveEnvelope([SEEDED_DESIGN]);
    poorEnvelope.state.money = 5_000;

    await page.addInitScript(({ key, envelope }: { key: string; envelope: ReturnType<typeof buildSaveEnvelope> }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: poorEnvelope });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Load the save.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Navigate to the Launch Pad.
    await page.click('[data-building-id="launch-pad"]');
    await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 5_000 });

    // The rocket card should still be visible.
    await expect(page.locator('.lp-rocket-card')).toHaveCount(1, { timeout: 5_000 });

    // The cost should be shown and marked as insufficient.
    await expect(page.locator('.lp-rocket-cost-insufficient')).toBeVisible({ timeout: 5_000 });

    // The Launch button should be disabled.
    await expect(page.locator('.lp-launch-btn')).toBeDisabled({ timeout: 5_000 });
  });
});
