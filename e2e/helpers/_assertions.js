/**
 * Wait/assertion helpers for E2E tests — objective completion, altitude, flight events.
 */

// ---------------------------------------------------------------------------
// Objective helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a specific mission objective to be marked complete.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} missionId   ID of the mission (e.g. 'mission-001')
 * @param {string} objectiveId ID of the objective (e.g. 'obj-001-1')
 * @param {number} [timeout=30000] Max time to wait in ms
 */
export async function waitForObjectiveComplete(page, missionId, objectiveId, timeout = 30_000) {
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
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} contractId  ID of the contract
 * @param {string} objectiveId ID of the objective
 * @param {number} [timeout=30000]
 */
export async function waitForContractObjectiveComplete(page, contractId, objectiveId, timeout = 30_000) {
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
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} missionId
 * @returns {Promise<boolean>}
 */
export async function areAllObjectivesComplete(page, missionId) {
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
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} altitude   Minimum altitude in metres
 * @param {number} [timeout=30000]
 */
export async function waitForAltitude(page, altitude, timeout = 30_000) {
  await page.waitForFunction(
    (alt) => (window.__flightPs?.posY ?? 0) >= alt,
    altitude,
    { timeout },
  );
}

/**
 * Wait for a specific flight event type to appear in the event log.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} eventType  Event type string (e.g. 'LANDING', 'SCIENCE_COLLECTED')
 * @param {number} [timeout=30000]
 */
export async function waitForFlightEvent(page, eventType, timeout = 30_000) {
  await page.waitForFunction(
    (evtType) => {
      const gs = window.__gameState;
      return gs?.currentFlight?.events?.some((e) => e.type === evtType) ?? false;
    },
    eventType,
    { timeout },
  );
}
