/**
 * State seeding and query helpers for E2E tests.
 */

import { SAVE_KEY } from './_constants.js';

/**
 * Seed localStorage with a save envelope, navigate to '/', load slot 0,
 * and wait for the hub overlay to confirm the game is loaded.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} envelope  Value returned by {@link buildSaveEnvelope}
 */
export async function seedAndLoadSave(page, envelope) {
  await page.addInitScript(({ key, envelope }) => {
    localStorage.setItem(key, JSON.stringify(envelope));
  }, { key: SAVE_KEY, envelope });

  await page.goto('/');
  await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
  await page.click('[data-action="load"][data-slot="0"]');
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
}

/**
 * Read the current game state from the running game.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<object|null>}
 */
export async function getGameState(page) {
  return page.evaluate(() => {
    const gs = window.__gameState;
    if (!gs) return null;
    return JSON.parse(JSON.stringify(gs));
  });
}

/**
 * Read the live flight state (from the flightState object synced by physics).
 * Returns null when no flight is active.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<object|null>}
 */
export async function getFlightState(page) {
  return page.evaluate(() => {
    const gs = window.__gameState;
    if (!gs?.currentFlight) return null;
    return JSON.parse(JSON.stringify(gs.currentFlight));
  });
}

/**
 * Read the current physics state (posY, velX, velY, etc.).
 * Returns null when no flight is active.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{posX:number,posY:number,velX:number,velY:number,grounded:boolean,landed:boolean,crashed:boolean}|null>}
 */
export async function getPhysicsSnapshot(page) {
  return page.evaluate(() => {
    const ps = window.__flightPs;
    if (!ps) return null;
    return {
      posX: ps.posX,
      posY: ps.posY,
      velX: ps.velX,
      velY: ps.velY,
      grounded: ps.grounded,
      landed: ps.landed,
      crashed: ps.crashed,
    };
  });
}
