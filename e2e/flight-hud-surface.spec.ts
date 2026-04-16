import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  seedAndLoadSave, startTestFlight, teleportCraft,
} from './helpers.js';
import { midGameFixture } from './fixtures.js';

/**
 * E2E — Flight HUD Surface Ops panel layout
 *
 * Regression guard for Iter-19 §1.1: the Surface Ops panel must not overlap
 * the Flight Left Panel when the rocket is landed.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width  <= b.x ||
    b.x + b.width  <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

test.describe('Flight HUD — Surface Ops layout', () => {
  test('@smoke surface-ops panel does not overlap flight left panel when landed', async ({ page }) => {
    test.setTimeout(60_000);

    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, midGameFixture());

    await startTestFlight(
      page,
      ['cmd-mk1', 'tank-small', 'engine-spark', 'landing-legs-small'],
      { crewIds: ['crew-1'] },
    );

    // Force a landed state — the physics & layout we exercise is independent
    // of how the craft arrived on the surface.
    await teleportCraft(page, { posX: 0, posY: 0, velX: 0, velY: 0, grounded: true, landed: true });

    // Wait for the Surface Ops panel to become visible (it only renders when landed).
    await expect(page.locator('#flight-hud-surface')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#flight-left-panel')).toBeVisible({ timeout: 5_000 });

    // Wait until the panel has at least one action button rendered — this
    // guarantees it has real geometry rather than a zero-height initial frame.
    await page.waitForFunction(
      () => (document.querySelectorAll('#flight-hud-surface .surface-btn').length ?? 0) > 0,
      { timeout: 5_000 },
    );

    const [surfaceRect, leftRect] = await page.evaluate((): [Rect, Rect] => {
      const s = document.getElementById('flight-hud-surface')!.getBoundingClientRect();
      const l = document.getElementById('flight-left-panel')!.getBoundingClientRect();
      return [
        { x: s.x, y: s.y, width: s.width, height: s.height },
        { x: l.x, y: l.y, width: l.width, height: l.height },
      ];
    });

    expect(surfaceRect.width).toBeGreaterThan(0);
    expect(surfaceRect.height).toBeGreaterThan(0);
    expect(leftRect.width).toBeGreaterThan(0);
    expect(leftRect.height).toBeGreaterThan(0);

    expect(
      rectsIntersect(surfaceRect, leftRect),
      `surface rect ${JSON.stringify(surfaceRect)} overlaps left rect ${JSON.stringify(leftRect)}`,
    ).toBe(false);
  });
});
