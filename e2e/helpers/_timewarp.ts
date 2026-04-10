/**
 * Time warp helpers for E2E tests — programmatic warp control.
 */

import type { Page } from '@playwright/test';

// Window augmentations are in e2e/window.d.ts (shared across all E2E files).

/**
 * Set the simulation time warp multiplier to an arbitrary value.
 * Unlike the player-facing warp buttons (which are limited to preset levels),
 * this allows any positive number (e.g. 100, 500, 1000).
 *
 * Must be called AFTER the flight scene is loaded.
 */
export async function setTestTimeWarp(page: Page, speedMultiplier: number): Promise<void> {
  await page.evaluate((speed: number) => {
    if (typeof window.__testSetTimeWarp === 'function') {
      window.__testSetTimeWarp(speed);
    }
  }, speedMultiplier);
}

/**
 * Get the current simulation time warp multiplier.
 */
export async function getTestTimeWarp(page: Page): Promise<number> {
  return page.evaluate(() => {
    if (typeof window.__testGetTimeWarp === 'function') {
      return window.__testGetTimeWarp();
    }
    return 1;
  });
}
