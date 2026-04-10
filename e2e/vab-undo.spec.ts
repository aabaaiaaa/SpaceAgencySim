import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  dragPartToCanvas,
  dismissWelcomeModal,
  navigateToVab,
} from './helpers.js';

/**
 * E2E — VAB Undo/Redo
 *
 * Verifies that Ctrl+Z undoes a part placement in the Vehicle Assembly Building.
 */

test.describe('VAB — Undo/Redo', () => {
  test('Ctrl+Z undoes a part placement', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');

    // Start a new freeplay game.
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 15_000,
    });
    await page.fill('#mm-agency-name-input', 'Undo Test');
    await page.click('.mm-mode-option[data-mode="freeplay"]');
    await page.click('#mm-start-btn');

    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await dismissWelcomeModal(page);

    // Navigate to the VAB.
    await navigateToVab(page);

    // Verify assembly is initially empty.
    const partsBefore: number = await page.evaluate(
      () => window.__vabAssembly?.parts?.size ?? 0,
    );
    expect(partsBefore).toBe(0);

    // Place a command module on the canvas.
    await dragPartToCanvas(page, 'cmd-mk1', CENTRE_X, CANVAS_CENTRE_Y);

    // Verify part was placed.
    const partsAfterPlace: number = await page.evaluate(
      () => window.__vabAssembly?.parts?.size ?? 0,
    );
    expect(partsAfterPlace).toBe(1);

    // Press Ctrl+Z to undo.
    await page.keyboard.press('Control+z');

    // Wait for the undo to take effect.
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) === 0,
      { timeout: 5_000 },
    );

    const partsAfterUndo: number = await page.evaluate(
      () => window.__vabAssembly?.parts?.size ?? 0,
    );
    expect(partsAfterUndo).toBe(0);

    // Verify the undo button is now disabled (stack empty).
    const undoBtnDisabled: boolean = await page.evaluate(
      () => (document.getElementById('vab-btn-undo') as HTMLButtonElement | null)?.disabled ?? true,
    );
    expect(undoBtnDisabled).toBe(true);
  });
});
