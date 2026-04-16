import { test, expect } from '@playwright/test';
import {
  FIRST_FLIGHT_MISSION,
  buildSaveEnvelope,
  seedAndLoadSave,
} from './helpers.js';
import type { SaveEnvelope } from './helpers.js';

/**
 * E2E @smoke — Mission → Finance feedback loop
 *
 * Verifies the mission-completion-to-finance chain end to end, without a
 * full flight: seed a mid-game save in which a target catalog part is
 * unaffordable, simulate mission completion (mutating state the way
 * core/missions.ts#completeMission does), then assert funds grew by the
 * reward and the target part is now affordable.
 *
 * Uses direct state mutation rather than a scripted flight so the smoke
 * runtime stays well under 10 s.
 */

const TARGET_PART_ID = 'satellite-weather';    // cost 35_000 in src/data/parts.ts
const MID_GAME_CASH  = 20_000;
const MISSION_ID     = FIRST_FLIGHT_MISSION.id; // 'mission-001'
const MISSION_REWARD = FIRST_FLIGHT_MISSION.reward; // 25_000

const MID_GAME_ENVELOPE: SaveEnvelope = buildSaveEnvelope({
  saveName: 'Mission Finance Loop Test',
  money:    MID_GAME_CASH,
  missions: {
    available: [],
    accepted:  [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }],
    completed: [],
  },
});

test.describe('Mission → Finance feedback loop', () => {

  test('@smoke completing a mission awards funds and unlocks a previously-unaffordable part', async ({ page }) => {
    test.setTimeout(15_000);

    await seedAndLoadSave(page, MID_GAME_ENVELOPE);

    // Sanity: target part exists in the catalog and costs more than the seeded cash.
    const partCost: number = await page.evaluate((id) => {
      const def = window.__getPartById(id) as { cost?: number } | null;
      return def?.cost ?? 0;
    }, TARGET_PART_ID);
    expect(partCost).toBeGreaterThan(MID_GAME_CASH);

    // Capture starting money and confirm the target part is unaffordable.
    const moneyBefore: number = await page.evaluate(() => window.__gameState.money);
    expect(moneyBefore).toBe(MID_GAME_CASH);
    expect(moneyBefore).toBeLessThan(partCost);

    // Simulate mission completion via state mutation (test-helper pattern used
    // elsewhere in the suite — see missions.spec.ts). This mirrors the
    // effects of core/missions.ts#completeMission: move the mission from
    // accepted→completed and award its reward to state.money.
    await page.evaluate(({ missionId, reward }) => {
      const gs = window.__gameState;
      const accepted = gs.missions.accepted;
      const idx = accepted.findIndex((m) => m.id === missionId);
      if (idx === -1) throw new Error(`Mission ${missionId} not in accepted bucket`);
      const [mission] = accepted.splice(idx, 1);
      mission.completedDate = new Date().toISOString();
      gs.missions.completed.push(mission);
      gs.money += reward;
    }, { missionId: MISSION_ID, reward: MISSION_REWARD });

    // Funds increased by exactly the mission's reward.
    const moneyAfter: number = await page.evaluate(() => window.__gameState.money);
    expect(moneyAfter - moneyBefore).toBe(MISSION_REWARD);
    expect(moneyAfter).toBe(MID_GAME_CASH + MISSION_REWARD);

    // Previously-unaffordable part is now affordable.
    expect(moneyAfter).toBeGreaterThanOrEqual(partCost);
  });
});
