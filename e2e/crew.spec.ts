import { test, expect } from '@playwright/test';
import {
  STARTING_MONEY,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope, seedAndLoadSave,
  ALL_FACILITIES,
} from './helpers.js';
import type { SaveEnvelope } from './helpers.js';

/**
 * E2E — Crew Administration Flow
 *
 * Tests the full Crew Administration building UI: empty state, hiring
 * astronauts, verifying astronaut properties, firing astronauts, the
 * history tab, and the insufficient-funds guard.
 *
 * Each test receives its own Playwright page fixture. `beforeEach` seeds a
 * fresh save and navigates to the Crew Administration building, so every
 * test starts from a clean state. Test (7) re-seeds with a low-cash
 * envelope to verify the insufficient-funds guard.
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

// ---------------------------------------------------------------------------
// (window.d.ts augments the global Window interface with game properties)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const HIRE_COST: number = 50_000;

/** Standard fresh-game envelope: no crew, full starting funds, all facilities built. */
const FRESH_ENVELOPE: SaveEnvelope = buildSaveEnvelope({
  saveName: 'Crew E2E Test',
  missions: { available: [{ ...FIRST_FLIGHT_MISSION, status: 'available' }], accepted: [], completed: [] },
  facilities: ALL_FACILITIES,
});

/** Broke envelope: cash below the hire cost so hire is blocked. */
const BROKE_ENVELOPE: SaveEnvelope = buildSaveEnvelope({
  saveName: 'Crew E2E Test',
  money: 10_000,
  missions: { available: [{ ...FIRST_FLIGHT_MISSION, status: 'available' }], accepted: [], completed: [] },
  facilities: ALL_FACILITIES,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Crew Administration Flow', () => {

  // ── Per-test setup: seed save and enter Crew Administration ───────────────

  test.beforeEach(async ({ page }) => {
    await seedAndLoadSave(page, FRESH_ENVELOPE);
    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (1) Active Crew tab shows an empty state message when no crew are hired

  test('(1) the Active Crew tab shows an empty state message when no crew are hired', async ({ page }) => {
    // The Active Crew tab is active by default when Crew Admin opens.
    await expect(page.locator('[data-tab-id="active"]')).toHaveClass(/active/);

    // The empty-state message must be visible (no crew in the fresh save).
    await expect(page.locator('.crew-empty-msg')).toBeVisible();
    await expect(page.locator('.crew-empty-msg')).toContainText(/no active crew/i);

    // No crew table rows should exist.
    await expect(page.locator('.crew-table')).toHaveCount(0);
  });

  // ── (2) The Hire tab shows the hire cost ($50,000) and a name field ────────

  test('(2) the Hire tab shows the hire cost ($50,000) and a name field', async ({ page }) => {
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

  test('(3) clicking "Hire Astronaut" with a name entered deducts $50,000 from cash (visible in top bar) and adds the astronaut to the Active Crew tab', async ({ page }) => {
    await page.click('[data-tab-id="hire"]');

    // Record cash before hiring.
    const cashBefore: number | undefined = await page.evaluate(() =>
      window.__gameState?.money,
    );
    expect(cashBefore).toBe(STARTING_MONEY);

    // Enter a name and click the hire button.
    await page.fill('#hire-name-input', 'Valentina Tereshkova');
    await page.click('.hire-btn');

    // Wait for the success feedback to confirm the hire completed.
    await expect(page.locator('.hire-feedback.success')).toBeVisible();
    await expect(page.locator('.hire-feedback.success')).toContainText('Valentina Tereshkova');

    // Cash in game state must have decreased by exactly HIRE_COST.
    const cashAfter: number | undefined = await page.evaluate(() =>
      window.__gameState?.money,
    );
    expect(cashAfter).toBe(STARTING_MONEY - HIRE_COST);

    // The persistent top bar must reflect the deducted balance.
    await expect(page.locator('#topbar-cash')).toContainText('1,950,000');

    // Switch to Active Crew tab and verify the astronaut appears.
    await page.click('[data-tab-id="active"]');
    await expect(page.locator('.crew-name-cell')).toContainText('Valentina Tereshkova');
  });

  // ── (4) Newly hired astronaut has 0 missions flown and status "active" ─────

  test('(4) the newly hired astronaut appears with 0 missions flown and status "active"', async ({ page }) => {
    // Hire a fresh astronaut for this test (beforeEach resets state).
    await page.click('[data-tab-id="hire"]');
    await page.fill('#hire-name-input', 'Yuri Gagarin');
    await page.click('.hire-btn');
    await expect(page.locator('.hire-feedback.success')).toBeVisible();

    // Switch to Active Crew tab.
    await page.click('[data-tab-id="active"]');
    await expect(page.locator('.crew-name-cell')).toContainText('Yuri Gagarin');

    // Missions Flown column (4th <td> in the data row) must show "0".
    const missionsCell = page.locator('.crew-table tbody tr td:nth-child(4)').first();
    await expect(missionsCell).toHaveText('0');

    // The astronaut's status in game state must be "active".
    const status: string | undefined = await page.evaluate(() =>
      window.__gameState?.crew?.[0]?.status,
    );
    expect(status).toBe('active');
  });

  // ── (5) Clicking "Fire" removes the astronaut from the Active Crew list ────

  test('(5) clicking "Fire" on an active astronaut moves them out of the Active Crew list', async ({ page }) => {
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

  test('(6) fired astronauts appear in the History tab with status "fired"', async ({ page }) => {
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

  test('(7) attempting to hire when cash is below $50,000 shows the hire button as disabled', async ({ page }) => {
    // Re-seed with the broke envelope (overrides beforeEach's fresh seed).
    await seedAndLoadSave(page, BROKE_ENVELOPE);

    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });

    // Navigate to Hire tab.
    await page.click('[data-tab-id="hire"]');

    // The hire button must be visible but disabled (insufficient funds).
    await expect(page.locator('.hire-btn')).toBeVisible();
    await expect(page.locator('.hire-btn')).toBeDisabled();

    // The cash amount display must carry the "insufficient" CSS class (red text).
    await expect(page.locator('.hire-cash-amount.insufficient')).toBeVisible();
  });
});
