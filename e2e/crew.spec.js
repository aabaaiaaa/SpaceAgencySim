import { test, expect } from '@playwright/test';
import {
  SAVE_KEY, STARTING_MONEY,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope, seedAndLoadSave,
} from './helpers.js';

/**
 * E2E — Crew Administration Flow
 *
 * Tests the full Crew Administration building UI: empty state, hiring
 * astronauts, verifying astronaut properties, firing astronauts, the
 * history tab, and the insufficient-funds guard.
 *
 * Tests (1)–(6) share a page instance seeded with a fresh save (no crew,
 * full starting funds).  Each test is isolated: `beforeEach` resets state
 * in-place via SPA navigation (no full page reload), so state changes in
 * one test do not bleed into the next.
 *
 * Test (7) uses its own isolated browser context seeded with a save whose
 * cash balance is below the $50,000 hire cost.
 *
 * Tests:
 *   (1) The Active Crew tab shows an empty state message when no crew are hired.
 *   (2) The Hire tab shows the hire cost ($50,000) and a name field.
 *   (3) Clicking "Hire Astronaut" with a name entered deducts $50,000 from
 *       cash (reflected in the top bar) and adds the astronaut to the Active
 *       Crew tab.
 *   (4) The newly hired astronaut appears with 0 missions flown and status
 *       "active".
 *   (5) Clicking "Fire" on an active astronaut moves them out of the Active
 *       Crew list.
 *   (6) Fired astronauts appear in the History tab with status "fired".
 *   (7) Attempting to hire when cash is below $50,000 shows the hire button
 *       as disabled and the cash display styled as insufficient.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const HIRE_COST = 50_000;

/** Standard fresh-game envelope: no crew, full starting funds. */
const FRESH_ENVELOPE = buildSaveEnvelope({
  saveName: 'Crew E2E Test',
  missions: { available: [{ ...FIRST_FLIGHT_MISSION, status: 'available' }], accepted: [], completed: [] },
});

/** The state portion used to reset gameState between tests. */
const FRESH_STATE = FRESH_ENVELOPE.state;

/** Broke envelope: cash below the hire cost so hire is blocked. */
const BROKE_ENVELOPE = buildSaveEnvelope({
  saveName: 'Crew E2E Test',
  money: 10_000,
  missions: { available: [{ ...FIRST_FLIGHT_MISSION, status: 'available' }], accepted: [], completed: [] },
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Crew Administration Flow', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Suite setup ───────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Seed save and navigate to hub.
    await seedAndLoadSave(page, FRESH_ENVELOPE);

    // Enter Crew Administration initially (so beforeEach can use back button).
    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });
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
    await page.click('#crew-admin-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // Re-enter Crew Administration (triggers fresh UI render from gameState).
    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (1) Active Crew tab shows an empty state message when no crew are hired

  test('(1) the Active Crew tab shows an empty state message when no crew are hired', async () => {
    // The Active Crew tab is active by default when Crew Admin opens.
    await expect(page.locator('[data-tab-id="active"]')).toHaveClass(/active/);

    // The empty-state message must be visible (no crew in the fresh save).
    await expect(page.locator('.crew-empty-msg')).toBeVisible();
    await expect(page.locator('.crew-empty-msg')).toContainText(/no active crew/i);

    // No crew table rows should exist.
    await expect(page.locator('.crew-table')).toHaveCount(0);
  });

  // ── (2) The Hire tab shows the hire cost ($50,000) and a name field ────────

  test('(2) the Hire tab shows the hire cost ($50,000) and a name field', async () => {
    await page.click('[data-tab-id="hire"]');

    // The name input must be present and visible.
    await expect(page.locator('#hire-name-input')).toBeVisible();

    // The hire cost note must display "$50,000".
    await expect(page.locator('.hire-cost-note')).toBeVisible();
    await expect(page.locator('.hire-cost-note')).toContainText('50,000');

    // The hire button must also be visible and enabled (funds are sufficient).
    await expect(page.locator('.hire-btn')).toBeVisible();
    await expect(page.locator('.hire-btn')).not.toBeDisabled();
  });

  // ── (3) Hiring an astronaut deducts $50,000 from cash and adds to Active Crew

  test('(3) clicking "Hire Astronaut" with a name entered deducts $50,000 from cash (visible in top bar) and adds the astronaut to the Active Crew tab', async () => {
    await page.click('[data-tab-id="hire"]');

    // Record cash before hiring.
    const cashBefore = await page.evaluate(() => window.__gameState?.money);
    expect(cashBefore).toBe(STARTING_MONEY);

    // Enter a name and click the hire button.
    await page.fill('#hire-name-input', 'Valentina Tereshkova');
    await page.click('.hire-btn');

    // Wait for the success feedback to confirm the hire completed.
    await expect(page.locator('.hire-feedback.success')).toBeVisible();
    await expect(page.locator('.hire-feedback.success')).toContainText('Valentina Tereshkova');

    // Cash in game state must have decreased by exactly HIRE_COST.
    const cashAfter = await page.evaluate(() => window.__gameState?.money);
    expect(cashAfter).toBe(STARTING_MONEY - HIRE_COST);

    // The persistent top bar must reflect the deducted balance.
    await expect(page.locator('#topbar-cash')).toContainText('1,950,000');

    // Switch to Active Crew tab and verify the astronaut appears.
    await page.click('[data-tab-id="active"]');
    await expect(page.locator('.crew-name-cell')).toContainText('Valentina Tereshkova');
  });

  // ── (4) Newly hired astronaut has 0 missions flown and status "active" ─────

  test('(4) the newly hired astronaut appears with 0 missions flown and status "active"', async () => {
    // Hire a fresh astronaut for this test (beforeEach resets state).
    await page.click('[data-tab-id="hire"]');
    await page.fill('#hire-name-input', 'Yuri Gagarin');
    await page.click('.hire-btn');
    await expect(page.locator('.hire-feedback.success')).toBeVisible();

    // Switch to Active Crew tab.
    await page.click('[data-tab-id="active"]');
    await expect(page.locator('.crew-name-cell')).toContainText('Yuri Gagarin');

    // Missions Flown column (2nd <td> in the data row) must show "0".
    const missionsCell = page.locator('.crew-table tbody tr td:nth-child(2)').first();
    await expect(missionsCell).toHaveText('0');

    // The astronaut's status in game state must be "active".
    const status = await page.evaluate(() => window.__gameState?.crew?.[0]?.status);
    expect(status).toBe('active');
  });

  // ── (5) Clicking "Fire" removes the astronaut from the Active Crew list ────

  test('(5) clicking "Fire" on an active astronaut moves them out of the Active Crew list', async () => {
    // Hire an astronaut first (fresh state from beforeEach).
    await page.click('[data-tab-id="hire"]');
    await page.fill('#hire-name-input', 'Neil Armstrong');
    await page.click('.hire-btn');
    await expect(page.locator('.hire-feedback.success')).toBeVisible();

    // Switch to Active Crew and confirm the astronaut is there.
    await page.click('[data-tab-id="active"]');
    await expect(page.locator('.crew-name-cell')).toContainText('Neil Armstrong');

    // Click the Fire button.
    await page.click('.crew-fire-btn');

    // The Active Crew list must now be empty (empty-state message visible).
    await expect(page.locator('.crew-empty-msg')).toBeVisible();

    // The crew table must have been removed.
    await expect(page.locator('.crew-table')).toHaveCount(0);
  });

  // ── (6) Fired astronauts appear in History tab with status "fired" ─────────

  test('(6) fired astronauts appear in the History tab with status "fired"', async () => {
    // Hire an astronaut (fresh state from beforeEach).
    await page.click('[data-tab-id="hire"]');
    await page.fill('#hire-name-input', 'Buzz Aldrin');
    await page.click('.hire-btn');
    await expect(page.locator('.hire-feedback.success')).toBeVisible();

    // Switch to Active Crew and fire them.
    await page.click('[data-tab-id="active"]');
    await expect(page.locator('.crew-name-cell')).toContainText('Buzz Aldrin');
    await page.click('.crew-fire-btn');

    // Confirm active crew is now empty.
    await expect(page.locator('.crew-empty-msg')).toBeVisible();

    // Switch to History tab.
    await page.click('[data-tab-id="history"]');

    // History table must be rendered.
    await expect(page.locator('.history-table')).toBeVisible();

    // The astronaut must appear in the history table.
    await expect(page.locator('.hist-name-cell')).toContainText('Buzz Aldrin');

    // Their status badge must be "Fired".
    await expect(page.locator('.hist-status-badge.fired')).toBeVisible();
    await expect(page.locator('.hist-status-badge.fired')).toContainText('Fired');
  });

  // ── (7) Hire button is disabled when cash is below $50,000 ────────────────

  test('(7) attempting to hire when cash is below $50,000 shows the hire button as disabled', async ({ browser }) => {
    // Use an isolated browser context seeded with the broke envelope so this
    // test does not affect the shared page used by tests (1)–(6).
    const ctx = await browser.newContext();
    const p   = await ctx.newPage();

    await seedAndLoadSave(p, BROKE_ENVELOPE);

    await p.click('[data-building-id="crew-admin"]');
    await p.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });

    // Navigate to Hire tab.
    await p.click('[data-tab-id="hire"]');

    // The hire button must be visible but disabled (insufficient funds).
    await expect(p.locator('.hire-btn')).toBeVisible();
    await expect(p.locator('.hire-btn')).toBeDisabled();

    // The cash amount display must carry the "insufficient" CSS class (red text).
    await expect(p.locator('.hire-cash-amount.insufficient')).toBeVisible();

    await p.close();
    await ctx.close();
  });
});
