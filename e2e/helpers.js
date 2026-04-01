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
// Facility IDs (mirrors src/core/constants.js FacilityId)
// ---------------------------------------------------------------------------

export const FacilityId = Object.freeze({
  LAUNCH_PAD:      'launch-pad',
  VAB:             'vab',
  MISSION_CONTROL: 'mission-control',
  CREW_ADMIN:      'crew-admin',
  TRACKING_STATION:'tracking-station',
  RD_LAB:          'rd-lab',
  SATELLITE_OPS:   'satellite-ops',
  LIBRARY:         'library',
});

/** Default starter facilities (pre-built at tier 1 in every new game). */
export const STARTER_FACILITIES = Object.freeze({
  [FacilityId.LAUNCH_PAD]:      { built: true, tier: 1 },
  [FacilityId.VAB]:             { built: true, tier: 1 },
  [FacilityId.MISSION_CONTROL]: { built: true, tier: 1 },
});

/** All facilities built at tier 1 (for advanced test scenarios). */
export const ALL_FACILITIES = Object.freeze({
  [FacilityId.LAUNCH_PAD]:      { built: true, tier: 1 },
  [FacilityId.VAB]:             { built: true, tier: 1 },
  [FacilityId.MISSION_CONTROL]: { built: true, tier: 1 },
  [FacilityId.CREW_ADMIN]:      { built: true, tier: 1 },
  [FacilityId.TRACKING_STATION]:{ built: true, tier: 1 },
  [FacilityId.RD_LAB]:          { built: true, tier: 1 },
  [FacilityId.SATELLITE_OPS]:   { built: true, tier: 1 },
  [FacilityId.LIBRARY]:         { built: true, tier: 1 },
});

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
 * Supports the FULL game state shape — any progression point can be expressed
 * by overriding the relevant fields.
 */
export function buildSaveEnvelope({
  saveName        = 'E2E Test',
  money           = STARTING_MONEY,
  missions        = { available: [], accepted: [], completed: [] },
  crew            = [],
  rockets         = [],
  savedDesigns    = [],
  parts           = [],
  agencyName      = 'Test Agency',
  loan            = { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
  flightHistory   = [],
  currentPeriod   = 0,
  playTimeSeconds = 0,
  flightTimeSeconds = 0,
  currentFlight   = null,
  orbitalObjects  = [],
  vabAssembly     = null,
  vabStagingConfig= null,
  tutorialMode    = true,
  gameMode        = null,
  sandboxSettings = null,
  difficultySettings = { malfunctionFrequency: 'normal', weatherSeverity: 'normal', financialPressure: 'normal', injuryDuration: 'normal' },
  facilities      = STARTER_FACILITIES,
  contracts       = { board: [], active: [], completed: [], failed: [] },
  reputation      = 50,
  sciencePoints   = 0,
  scienceLog      = [],
  techTree        = { researched: [], unlockedInstruments: [] },
  satelliteNetwork= { satellites: [] },
  partInventory   = [],
  weather         = null,
  surfaceItems    = [],
  achievements    = [],
  challenges      = { active: null, results: {} },
  customChallenges= [],
  fieldCraft      = [],
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
      savedDesigns,
      parts,
      flightHistory,
      currentPeriod,
      playTimeSeconds,
      flightTimeSeconds,
      currentFlight,
      orbitalObjects,
      vabAssembly,
      vabStagingConfig,
      tutorialMode,
      gameMode,
      sandboxSettings,
      difficultySettings,
      facilities: { ...facilities },
      contracts,
      reputation,
      sciencePoints,
      scienceLog,
      techTree,
      satelliteNetwork,
      partInventory,
      weather,
      surfaceItems,
      achievements,
      challenges,
      customChallenges,
      fieldCraft,
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

// ---------------------------------------------------------------------------
// Crew factory
// ---------------------------------------------------------------------------

/**
 * Create a crew member object for use in save envelopes.
 *
 * @param {object} overrides  Fields to override on the default crew member.
 * @returns {object}
 */
export function buildCrewMember({
  id          = 'crew-test-1',
  name        = 'Test Astronaut',
  status      = 'IDLE',
  salary      = 5_000,
  hiredDate   = new Date().toISOString(),
  skills      = { piloting: 50, engineering: 50, science: 50 },
  missionsFlown = 0,
} = {}) {
  return { id, name, status, salary, hiredDate, skills, missionsFlown };
}

// ---------------------------------------------------------------------------
// Contract factory
// ---------------------------------------------------------------------------

/**
 * Create a contract object for use in save envelopes.
 *
 * @param {object} overrides
 * @returns {object}
 */
export function buildContract({
  id               = 'contract-test-1',
  title            = 'Test Contract',
  description      = 'A test contract.',
  category         = 'ALTITUDE_RECORD',
  objectives       = [],
  bonusObjectives  = [],
  bonusReward      = 0,
  reward           = 50_000,
  penaltyFee       = 12_500,
  reputationReward = 5,
  reputationPenalty= 5,
  deadlinePeriod   = null,
  boardExpiryPeriod= 10,
  generatedPeriod  = 0,
  acceptedPeriod   = null,
  chainId          = null,
  chainPart        = null,
  chainTotal       = null,
  conflictTags     = [],
} = {}) {
  return {
    id, title, description, category, objectives, bonusObjectives,
    bonusReward, reward, penaltyFee, reputationReward, reputationPenalty,
    deadlinePeriod, boardExpiryPeriod, generatedPeriod, acceptedPeriod,
    chainId, chainPart, chainTotal, conflictTags,
  };
}

// ---------------------------------------------------------------------------
// Objective factory
// ---------------------------------------------------------------------------

/**
 * Create a single objective definition.
 *
 * @param {object} overrides
 * @returns {object}
 */
export function buildObjective({
  id          = 'obj-test-1',
  type        = 'REACH_ALTITUDE',
  target      = { altitude: 100 },
  completed   = false,
  description = '',
} = {}) {
  return { id, type, target, completed, description };
}
