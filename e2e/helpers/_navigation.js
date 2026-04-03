/**
 * Screen navigation and UI interaction helpers for E2E tests.
 */

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

/**
 * Open the construction panel via the hamburger menu.
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
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openSettingsPanel(page) {
  await page.click('#topbar-menu-btn');
  await page.click('#hub-settings-btn');
}
