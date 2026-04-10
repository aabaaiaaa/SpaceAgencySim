/**
 * State seeding and query helpers for E2E tests.
 */

import type { Page } from '@playwright/test';

import { SAVE_KEY } from './_constants.js';
import type { SaveEnvelope } from './_saveFactory.js';

interface PhysicsSnapshot {
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  grounded: boolean;
  landed: boolean;
  crashed: boolean;
}

/**
 * Seed localStorage with a save envelope, navigate to '/', load slot 0,
 * and wait for the hub overlay to confirm the game is loaded.
 */
export async function seedAndLoadSave(page: Page, envelope: SaveEnvelope | Record<string, unknown>): Promise<void> {
  await page.addInitScript(({ key, envelope }: { key: string; envelope: SaveEnvelope | Record<string, unknown> }) => {
    localStorage.setItem(key, JSON.stringify(envelope));
  }, { key: SAVE_KEY, envelope });

  await page.goto('/');
  await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
  await page.click('[data-action="load"][data-slot="0"]');
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
}

/**
 * Read the current game state from the running game.
 */
export async function getGameState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const gs = (window as Record<string, unknown>).__gameState;
    if (!gs) return null;
    return JSON.parse(JSON.stringify(gs)) as Record<string, unknown>;
  });
}

/**
 * Read the live flight state (from the flightState object synced by physics).
 * Returns null when no flight is active.
 */
export async function getFlightState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const gs = (window as Record<string, unknown>).__gameState as Record<string, unknown> | undefined;
    if (!gs?.currentFlight) return null;
    return JSON.parse(JSON.stringify(gs.currentFlight)) as Record<string, unknown>;
  });
}

/**
 * Read the current physics state (posY, velX, velY, etc.).
 * Returns null when no flight is active.
 */
export async function getPhysicsSnapshot(page: Page): Promise<PhysicsSnapshot | null> {
  return page.evaluate(() => {
    const ps = (window as Record<string, unknown>).__flightPs as Record<string, unknown> | undefined;
    if (!ps) return null;
    return {
      posX: ps.posX as number,
      posY: ps.posY as number,
      velX: ps.velX as number,
      velY: ps.velY as number,
      grounded: ps.grounded as boolean,
      landed: ps.landed as boolean,
      crashed: ps.crashed as boolean,
    };
  });
}
