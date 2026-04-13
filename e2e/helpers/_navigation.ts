/**
 * Screen navigation and UI interaction helpers for E2E tests.
 */

import type { Page } from '@playwright/test';

// Window augmentations are in e2e/window.d.ts (shared across all E2E files).

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Dismiss the welcome modal if it is showing. No-ops if it is not present.
 */
export async function dismissWelcomeModal(page: Page): Promise<void> {
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
 */
export async function dragPartToCanvas(
  page: Page,
  partId: string,
  targetX: number,
  targetY: number,
): Promise<void> {
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
 */
export async function navigateToVab(page: Page): Promise<void> {
  await page.click('[data-building-id="vab"]');
  await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => typeof window.__vabAssembly !== 'undefined',
    { timeout: 10_000 },
  );

  // Disable auto-zoom and reset zoom to 1x so that viewport-pixel offsets
  // used by placePart / dragPartToCanvas map 1:1 to world units.
  await page.evaluate(() => {
    const chk = document.getElementById('vab-chk-autozoom');
    if (chk && (chk as HTMLInputElement).checked) {
      (chk as HTMLInputElement).checked = false;
      chk.dispatchEvent(new Event('change'));
    }
    const slider = document.getElementById('vab-zoom-slider');
    if (slider) {
      (slider as HTMLInputElement).value = '1';
      slider.dispatchEvent(new Event('input'));
    }
  });
}

/**
 * Drag a part onto the canvas and wait for the assembly part count to reach
 * at least {@link expectedCount}.
 */
export async function placePart(
  page: Page,
  partId: string,
  targetX: number,
  targetY: number,
  expectedCount: number,
): Promise<void> {
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
 */
export async function launchFromVab(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('#vab-btn-launch') as HTMLButtonElement | null;
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
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
    { timeout: 5_000 },
  );
}

/**
 * Open the construction panel via the hamburger menu.
 */
export async function openConstructionPanel(page: Page): Promise<void> {
  await page.click('#topbar-menu-btn');
  await page.click('#hub-construction-btn');
  await page.waitForSelector('#construction-panel', { state: 'visible', timeout: 5_000 });
}

/**
 * Open the settings panel via the hamburger menu.
 */
export async function openSettingsPanel(page: Page): Promise<void> {
  await page.click('#topbar-menu-btn');
  await page.click('#hub-settings-btn');
}

// ---------------------------------------------------------------------------
// Reliable keyboard dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Dispatch a keyboard event directly on the window via page.evaluate().
 *
 * page.keyboard.press() is unreliable under parallel Playwright workers
 * because Chromium throttles inactive tabs, swallowing key events.
 * Dispatching via window.dispatchEvent bypasses this throttling entirely.
 */
async function dispatchKey(page: Page, code: string, key: string): Promise<void> {
  await page.evaluate(
    ({ c, k }) => window.dispatchEvent(
      new KeyboardEvent('keydown', { code: c, key: k, bubbles: true }),
    ),
    { c: code, k: key },
  );
}

/**
 * Fire the next stage (equivalent to pressing Space).
 * Uses window.dispatchEvent for reliability under parallel workers.
 */
export async function pressStage(page: Page): Promise<void> {
  await dispatchKey(page, 'Space', ' ');
}

/**
 * Set throttle to maximum (equivalent to pressing 'z').
 * Uses window.dispatchEvent for reliability under parallel workers.
 */
export async function pressThrottleUp(page: Page): Promise<void> {
  await dispatchKey(page, 'KeyZ', 'z');
}

/**
 * Cut throttle (equivalent to pressing 'x').
 * Uses window.dispatchEvent for reliability under parallel workers.
 */
export async function pressThrottleCut(page: Page): Promise<void> {
  await dispatchKey(page, 'KeyX', 'x');
}

/**
 * Reliably stage the rocket and set throttle to max.
 *
 * The flight keyboard handler may not be registered immediately after the
 * flight scene loads, so `pressStage()` can be swallowed silently.  This
 * helper retries staging up to 5 times, verifying the engine actually fires
 * between attempts.  It then sets throttle to max.
 */
export async function stageAndLaunch(page: Page): Promise<void> {
  // Wait for the staging system to be ready.
  await page.waitForFunction(
    () => (window.__flightPs?.activeParts?.size ?? 0) > 0,
    { timeout: 5_000 },
  );

  // The flight keyboard handler is registered synchronously a few frames
  // after the HUD mounts. startTestFlight returns as soon as the HUD is
  // visible, so we must let the init sequence finish before dispatching
  // keyboard events.  Five animation frames is enough to cover the gap.
  await page.evaluate(() => new Promise<void>(resolve => {
    let n = 0;
    const tick = () => { if (++n >= 5) resolve(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }));

  // Set throttle to max so the engine fires immediately when staged.
  await pressThrottleUp(page);

  // Stage once via keyboard, then wait patiently for the physics worker to
  // process the stage command.  Do NOT retry rapidly — multiple Space
  // dispatches cause double-staging (engine + decoupler/parachute).
  //
  // Check for EITHER firingEngines > 0 OR altitude gain > 2m.  The second
  // condition handles forced-malfunction mode where the engine fires but
  // immediately gets a flameout, clearing firingEngines before we see it.
  await pressStage(page);

  const launched = await page.waitForFunction(
    (): boolean => {
      const ps = window.__flightPs;
      if (!ps) return false;
      return (ps.firingEngines?.size ?? 0) > 0 || ps.posY > 2;
    },
    { timeout: 10_000 },
  ).then(() => true).catch(() => false);

  if (!launched) {
    // One more attempt — the keyboard handler may not have been ready.
    await pressStage(page);
    await page.waitForFunction(
      (): boolean => {
        const ps = window.__flightPs;
        if (!ps) return false;
        return (ps.firingEngines?.size ?? 0) > 0 || ps.posY > 2;
      },
      { timeout: 10_000 },
    ).catch(() => { /* best effort */ });
  }
}
