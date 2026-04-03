/**
 * Time warp helpers for E2E tests — programmatic warp control.
 */

/**
 * Set the simulation time warp multiplier to an arbitrary value.
 * Unlike the player-facing warp buttons (which are limited to preset levels),
 * this allows any positive number (e.g. 100, 500, 1000).
 *
 * Must be called AFTER the flight scene is loaded.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} speedMultiplier  Desired warp multiplier (1 = real-time).
 */
export async function setTestTimeWarp(page, speedMultiplier) {
  await page.evaluate((speed) => {
    if (typeof window.__testSetTimeWarp === 'function') {
      window.__testSetTimeWarp(speed);
    }
  }, speedMultiplier);
}

/**
 * Get the current simulation time warp multiplier.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function getTestTimeWarp(page) {
  return page.evaluate(() => {
    if (typeof window.__testGetTimeWarp === 'function') {
      return window.__testGetTimeWarp();
    }
    return 1;
  });
}
