/**
 * navigation.spec.ts — E2E test for code-splitting screen navigation.
 *
 * Verifies that navigating between all major hub buildings works correctly,
 * confirming that dynamic imports load each screen's modules and that the
 * back button returns to the hub every time.
 *
 * Tagged @smoke for inclusion in the fast coverage suite.
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  dismissWelcomeModal,
  ALL_FACILITIES,
} from './helpers.js';
import type { SaveEnvelope } from './helpers.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

/** Save with all facilities built so every building is accessible. */
const SAVE: SaveEnvelope = buildSaveEnvelope({
  saveName: 'Navigation E2E',
  gameMode: 'sandbox',
  tutorialMode: false,
  facilities: ALL_FACILITIES,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Screen Navigation (code-splitting)', () => {

  test.beforeEach(async ({ page }) => {
    await seedAndLoadSave(page, SAVE);
    await dismissWelcomeModal(page);
  });

  test('@smoke navigating to each building and back loads the correct screen', async ({ page }) => {
    // ── VAB ──────────────────────────────────────────────────────────────────
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });

    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-root', { state: 'visible', timeout: 10_000 });
    await expect(page.locator('#vab-parts-list')).toBeVisible({ timeout: 5_000 });

    // Return to hub.
    await page.click('#vab-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // ── Mission Control ──────────────────────────────────────────────────────
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });

    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
    // Verify tab bar rendered (always present regardless of mission data).
    await expect(page.locator('.mc-tab').first()).toBeVisible({ timeout: 5_000 });

    // Return to hub.
    await page.click('#mission-control-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // ── Crew Administration ──────────────────────────────────────────────────
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });

    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });
    // Crew Admin has tabs — verify at least the tab bar is rendered.
    await expect(page.locator('[data-tab-id="active"]')).toBeVisible({ timeout: 5_000 });

    // Return to hub.
    await page.click('#crew-admin-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // ── Logistics Center ─────────────────────────────────────────────────────
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });

    await page.click('[data-building-id="logistics-center"]');
    await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 10_000 });
    await expect(page.locator('#logistics-overlay')).toBeVisible({ timeout: 5_000 });

    // Return to hub.
    await page.click('#logistics-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // Final assertion: we are back at the hub after all round-trips.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });
  });
});
