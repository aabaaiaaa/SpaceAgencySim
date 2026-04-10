/**
 * Wait/assertion helpers for E2E tests — objective completion, altitude, flight events.
 */

import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Browser-context window augmentation (these globals are injected at runtime)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/consistent-type-definitions */
declare global {
  interface Window {
    __gameState?: {
      missions?: {
        accepted?: { id: string; objectives?: { id: string; completed?: boolean }[] }[];
        completed?: { id: string; objectives?: { id: string; completed?: boolean }[] }[];
      };
      contracts?: {
        active?: { id: string; objectives?: { id: string; completed?: boolean }[] }[];
        completed?: { id: string; objectives?: { id: string; completed?: boolean }[] }[];
      };
      currentFlight?: {
        events?: { type: string }[];
      };
    };
    __flightPs?: {
      posX: number;
      posY: number;
      velX: number;
      velY: number;
      grounded: boolean;
      landed: boolean;
      crashed: boolean;
      throttle: number;
      firingEngines: Set<string>;
    };
  }
}
/* eslint-enable @typescript-eslint/consistent-type-definitions */

// ---------------------------------------------------------------------------
// Objective helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a specific mission objective to be marked complete.
 */
export async function waitForObjectiveComplete(
  page: Page,
  missionId: string,
  objectiveId: string,
  timeout: number = 30_000,
): Promise<void> {
  await page.waitForFunction(
    ({ mid, oid }) => {
      const gs = window.__gameState;
      if (!gs) return false;
      const all = [
        ...(gs.missions?.accepted ?? []),
        ...(gs.missions?.completed ?? []),
      ];
      const mission = all.find((m) => m.id === mid);
      if (!mission) return false;
      const obj = mission.objectives?.find((o) => o.id === oid);
      return obj?.completed === true;
    },
    { mid: missionId, oid: objectiveId },
    { timeout },
  );
}

/**
 * Wait for a specific contract objective to be marked complete.
 */
export async function waitForContractObjectiveComplete(
  page: Page,
  contractId: string,
  objectiveId: string,
  timeout: number = 30_000,
): Promise<void> {
  await page.waitForFunction(
    ({ cid, oid }) => {
      const gs = window.__gameState;
      if (!gs) return false;
      const all = [
        ...(gs.contracts?.active ?? []),
        ...(gs.contracts?.completed ?? []),
      ];
      const contract = all.find((c) => c.id === cid);
      if (!contract) return false;
      const obj = contract.objectives?.find((o) => o.id === oid);
      return obj?.completed === true;
    },
    { cid: contractId, oid: objectiveId },
    { timeout },
  );
}

/**
 * Check whether ALL objectives on a mission are complete (snapshot, no wait).
 */
export async function areAllObjectivesComplete(
  page: Page,
  missionId: string,
): Promise<boolean> {
  return page.evaluate((mid) => {
    const gs = window.__gameState;
    if (!gs) return false;
    const all = [
      ...(gs.missions?.accepted ?? []),
      ...(gs.missions?.completed ?? []),
    ];
    const mission = all.find((m) => m.id === mid);
    if (!mission?.objectives?.length) return false;
    return mission.objectives.every((o) => o.completed === true);
  }, missionId);
}

/**
 * Wait for the rocket to reach a minimum altitude during flight.
 */
export async function waitForAltitude(
  page: Page,
  altitude: number,
  timeout: number = 30_000,
): Promise<void> {
  await page.waitForFunction(
    (alt) => (window.__flightPs?.posY ?? 0) >= alt,
    altitude,
    { timeout },
  );
}

/**
 * Wait for a specific flight event type to appear in the event log.
 */
export async function waitForFlightEvent(
  page: Page,
  eventType: string,
  timeout: number = 30_000,
): Promise<void> {
  await page.waitForFunction(
    (evtType) => {
      const gs = window.__gameState;
      return gs?.currentFlight?.events?.some((e) => e.type === evtType) ?? false;
    },
    eventType,
    { timeout },
  );
}
