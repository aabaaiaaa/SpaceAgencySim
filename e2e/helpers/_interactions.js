/**
 * Page interaction helpers for E2E tests — drag-and-drop, navigation, flight control.
 */

import { SAVE_KEY } from './_constants.js';

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss the welcome modal if it is showing. No-ops if it is not present.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function dismissWelcomeModal(page) {
  const btn = page.locator('#welcome-dismiss-btn');
  try {
    await btn.waitFor({ state: 'visible', timeout: 2_000 });
    await btn.click();
  } catch {
    // Modal not present — no-op.
  }
}

/**
 * Drag a part card from the VAB parts panel and drop it at (targetX, targetY)
 * in viewport coordinates.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} partId    data-part-id of the card to drag
 * @param {number} targetX   Drop viewport X
 * @param {number} targetY   Drop viewport Y
 */
export async function dragPartToCanvas(page, partId, targetX, targetY) {
  const card    = page.locator(`.vab-part-card[data-part-id="${partId}"]`);
  await card.scrollIntoViewIfNeeded();
  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error(`Part card not visible: ${partId}`);

  const startX = cardBox.x + cardBox.width  / 2;
  const startY = cardBox.y + cardBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 30 });
  await page.mouse.up();
}

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
 * From the hub, navigate to the VAB and wait for it to fully initialise.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function navigateToVab(page) {
  await page.click('[data-building-id="vab"]');
  await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => typeof window.__vabAssembly !== 'undefined',
    { timeout: 15_000 },
  );

  // Disable auto-zoom and reset zoom to 1× so that viewport-pixel offsets
  // used by placePart / dragPartToCanvas map 1:1 to world units.
  await page.evaluate(() => {
    const chk = document.getElementById('vab-chk-autozoom');
    if (chk && chk.checked) {
      chk.checked = false;
      chk.dispatchEvent(new Event('change'));
    }
    const slider = document.getElementById('vab-zoom-slider');
    if (slider) {
      slider.value = '1';
      slider.dispatchEvent(new Event('input'));
    }
  });
}

/**
 * Drag a part onto the canvas and wait for the assembly part count to reach
 * at least {@link expectedCount}.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} partId         data-part-id of the card to drag
 * @param {number} targetX        Drop viewport X
 * @param {number} targetY        Drop viewport Y
 * @param {number} expectedCount  Minimum assembly.parts.size after placement
 */
export async function placePart(page, partId, targetX, targetY, expectedCount) {
  await dragPartToCanvas(page, partId, targetX, targetY);
  await page.waitForFunction(
    (n) => (window.__vabAssembly?.parts?.size ?? 0) >= n,
    expectedCount,
    { timeout: 5_000 },
  );
}

/**
 * Click the Launch button, handle the crew-assignment dialog (if it appears),
 * and wait for the flight scene to be ready (HUD visible + physics state exposed).
 *
 * @param {import('@playwright/test').Page} page
 */
export async function launchFromVab(page) {
  // Wait for launch button to be enabled.
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('#vab-btn-launch');
      return btn && !btn.disabled;
    },
    { timeout: 5_000 },
  );
  await page.click('#vab-btn-launch');

  // Handle crew dialog if it appears (rockets with command seats trigger it).
  try {
    await page.waitForSelector('#vab-crew-overlay', { state: 'visible', timeout: 3_000 });
    await page.click('#vab-crew-confirm');
  } catch {
    // No crew dialog — proceed directly to flight.
  }

  // Wait for flight scene.
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Programmatic test flight (bypasses VAB UI)
// ---------------------------------------------------------------------------

/**
 * Start a flight programmatically by building a rocket from part IDs.
 * Bypasses the VAB drag-and-drop UI entirely — parts are assembled and
 * connected in code, then the flight scene starts immediately.
 *
 * Requires that a game is loaded (hub overlay visible) and the
 * __e2eStartFlight API is available (exposed by main.js).
 *
 * Malfunctions are disabled by default for test determinism.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} partIds  Part catalog IDs (top → bottom), e.g.
 *   ['probe-core-mk1', 'tank-small', 'engine-spark']
 * @param {object} [opts]  Options passed to __e2eStartFlight.
 * @param {string} [opts.missionId]     Override mission ID.
 * @param {string[]} [opts.crewIds]     Crew member IDs to assign.
 * @param {string} [opts.bodyId]        Celestial body (default 'EARTH').
 * @param {string} [opts.malfunctionMode] 'off'|'forced'|'normal' (default 'off').
 */
export async function startTestFlight(page, partIds, opts = {}) {
  await page.waitForFunction(
    () => typeof window.__e2eStartFlight === 'function',
    { timeout: 15_000 },
  );

  await page.evaluate(
    ({ parts, options }) => window.__e2eStartFlight(parts, options),
    { parts: partIds, options: opts },
  );

  // Wait for flight scene to be ready.
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Malfunction mode control
// ---------------------------------------------------------------------------

/**
 * Set the malfunction mode for deterministic testing.
 *
 * Must be called AFTER the flight scene is loaded (window.__setMalfunctionMode
 * is only available during flight).
 *
 * @param {import('@playwright/test').Page} page
 * @param {'off'|'forced'|'normal'} mode
 */
export async function setMalfunctionMode(page, mode) {
  await page.evaluate((m) => {
    if (typeof window.__setMalfunctionMode === 'function') {
      window.__setMalfunctionMode(m);
    }
  }, mode);
}

/**
 * Get the current malfunction mode from the running game.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
export async function getMalfunctionMode(page) {
  return page.evaluate(() => {
    if (typeof window.__getMalfunctionMode === 'function') {
      return window.__getMalfunctionMode();
    }
    return 'unknown';
  });
}

// ---------------------------------------------------------------------------
// Programmatic time warp control
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Flight state queries
// ---------------------------------------------------------------------------

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

/**
 * Open the construction panel via the hamburger menu.
 * Construction is now a menu item, not a floating button.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openConstructionPanel(page) {
  await page.click('#topbar-menu-btn');
  await page.click('#hub-construction-btn');
  await page.waitForSelector('#construction-panel', { state: 'visible', timeout: 5_000 });
}

/**
 * Open the settings panel via the hamburger menu.
 * Settings is now a menu item, not a floating button.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openSettingsPanel(page) {
  await page.click('#topbar-menu-btn');
  await page.click('#hub-settings-btn');
}
