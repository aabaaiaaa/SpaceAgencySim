/**
 * Shared E2E test helpers — constants, save factories, and interaction utilities.
 *
 * Import from spec files to eliminate duplication across the test suite.
 */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const VP_W = 1280;
export const VP_H = 720;

export const SAVE_KEY       = 'spaceAgencySave_0';
export const STARTING_MONEY = 2_000_000;

export const TOOLBAR_H      = 52;
export const SCALE_BAR_W    = 66;
export const PARTS_PANEL_W  = 280;

export const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
export const BUILD_H = VP_H - TOOLBAR_H;                     // 668

export const CENTRE_X        = SCALE_BAR_W + BUILD_W / 2;    // 525
export const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;      // 386

// ---------------------------------------------------------------------------
// Mission template (no status field — callers spread and add their own)
// ---------------------------------------------------------------------------

export const FIRST_FLIGHT_MISSION = {
  id:           'mission-001',
  title:        'First Flight',
  description:  'Reach 100 m altitude.',
  location:     'desert',
  objectives: [{
    id:          'obj-001-1',
    type:        'REACH_ALTITUDE',
    target:      { altitude: 100 },
    completed:   false,
    description: 'Reach 100 m altitude',
  }],
  reward:        15_000,
  unlocksAfter:  [],
  unlockedParts: [],
};

// ---------------------------------------------------------------------------
// Save envelope factory
// ---------------------------------------------------------------------------

/**
 * Build a localStorage save-slot envelope.
 *
 * Every field has a sensible default so callers only override what they need.
 */
export function buildSaveEnvelope({
  saveName   = 'E2E Test',
  money      = STARTING_MONEY,
  missions   = { available: [], accepted: [], completed: [] },
  crew       = [],
  rockets    = [],
  parts      = [],
  agencyName = 'Test Agency',
  loan       = { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
} = {}) {
  return {
    saveName,
    timestamp: new Date().toISOString(),
    state: {
      agencyName,
      money,
      loan,
      missions,
      crew,
      rockets,
      parts,
      flightHistory:   [],
      playTimeSeconds: 0,
      currentFlight:   null,
    },
  };
}

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

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
