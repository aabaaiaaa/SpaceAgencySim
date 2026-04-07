/**
 * Save envelope factory for E2E tests.
 */

import { STARTING_MONEY, STARTER_FACILITIES } from './_constants.js';

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
  version         = 1,
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
  autoSaveEnabled    = true,
  debugMode          = false,
  useWorkerPhysics   = false,
} = {}) {
  return {
    saveName,
    timestamp: new Date().toISOString(),
    version,
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
      autoSaveEnabled,
      debugMode,
      useWorkerPhysics,
    },
  };
}
