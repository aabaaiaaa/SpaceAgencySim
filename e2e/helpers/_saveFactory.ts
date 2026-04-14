/**
 * Save envelope factory for E2E tests.
 */

import { STARTING_MONEY, STARTER_FACILITIES } from './_constants.js';
import type { CrewMember, HubSave } from './_factories.js';

// ---------------------------------------------------------------------------
// Sub-interfaces for complex nested state shapes
// ---------------------------------------------------------------------------

export interface MissionsState {
  available: Record<string, unknown>[];
  accepted: Record<string, unknown>[];
  completed: Record<string, unknown>[];
}

export interface LoanState {
  balance: number;
  interestRate: number;
  totalInterestAccrued: number;
}

export interface DifficultySettings {
  malfunctionFrequency: string;
  weatherSeverity: string;
  financialPressure: string;
  injuryDuration: string;
}

export interface ContractsState {
  board: Record<string, unknown>[];
  active: Record<string, unknown>[];
  completed: Record<string, unknown>[];
  failed: Record<string, unknown>[];
}

export interface TechTreeState {
  researched: string[];
  unlockedInstruments: string[];
}

export interface SatelliteNetworkState {
  satellites: Record<string, unknown>[];
}

export interface ChallengesState {
  active: Record<string, unknown> | null;
  results: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parameter interface (all fields optional — they all have defaults)
// ---------------------------------------------------------------------------

export interface SaveEnvelopeParams {
  version?: number;
  saveName?: string;
  money?: number;
  missions?: MissionsState;
  crew?: (Record<string, unknown> | CrewMember)[];
  rockets?: Record<string, unknown>[];
  savedDesigns?: Record<string, unknown>[];
  parts?: string[];
  agencyName?: string;
  loan?: LoanState;
  flightHistory?: Record<string, unknown>[];
  currentPeriod?: number;
  playTimeSeconds?: number;
  flightTimeSeconds?: number;
  currentFlight?: Record<string, unknown> | null;
  orbitalObjects?: Record<string, unknown>[];
  vabAssembly?: Record<string, unknown> | null;
  vabStagingConfig?: Record<string, unknown> | null;
  tutorialMode?: boolean;
  gameMode?: string | null;
  sandboxSettings?: Record<string, unknown> | null;
  difficultySettings?: DifficultySettings;
  contracts?: ContractsState;
  reputation?: number;
  sciencePoints?: number;
  scienceLog?: Record<string, unknown>[];
  techTree?: TechTreeState;
  satelliteNetwork?: SatelliteNetworkState;
  partInventory?: Record<string, unknown>[];
  weather?: Record<string, unknown> | null;
  surfaceItems?: Record<string, unknown>[];
  achievements?: Record<string, unknown>[];
  challenges?: ChallengesState;
  customChallenges?: Record<string, unknown>[];
  fieldCraft?: Record<string, unknown>[];
  miningSites?: Record<string, unknown>[];
  provenLegs?: Record<string, unknown>[];
  routes?: Record<string, unknown>[];
  /** Convenience shorthand: sets the Earth hub's facilities without building a full `hubs` array. Ignored when `hubs` is provided. */
  facilities?: Record<string, { built: boolean; tier: number }>;
  hubs?: HubSave[];
  activeHubId?: string;
  autoSaveEnabled?: boolean;
  debugMode?: boolean;
  welcomeShown?: boolean;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface SaveEnvelopeState {
  agencyName: string;
  money: number;
  loan: LoanState;
  missions: MissionsState;
  crew: (Record<string, unknown> | CrewMember)[];
  rockets: Record<string, unknown>[];
  savedDesigns: Record<string, unknown>[];
  parts: string[];
  flightHistory: Record<string, unknown>[];
  currentPeriod: number;
  playTimeSeconds: number;
  flightTimeSeconds: number;
  currentFlight: Record<string, unknown> | null;
  orbitalObjects: Record<string, unknown>[];
  vabAssembly: Record<string, unknown> | null;
  vabStagingConfig: Record<string, unknown> | null;
  tutorialMode: boolean;
  gameMode: string | null;
  sandboxSettings: Record<string, unknown> | null;
  difficultySettings: DifficultySettings;
  contracts: ContractsState;
  reputation: number;
  sciencePoints: number;
  scienceLog: Record<string, unknown>[];
  techTree: TechTreeState;
  satelliteNetwork: SatelliteNetworkState;
  partInventory: Record<string, unknown>[];
  weather: Record<string, unknown> | null;
  surfaceItems: Record<string, unknown>[];
  achievements: Record<string, unknown>[];
  challenges: ChallengesState;
  customChallenges: Record<string, unknown>[];
  fieldCraft: Record<string, unknown>[];
  miningSites: Record<string, unknown>[];
  provenLegs: Record<string, unknown>[];
  routes: Record<string, unknown>[];
  hubs: HubSave[];
  activeHubId: string;
  autoSaveEnabled: boolean;
  debugMode: boolean;
  welcomeShown: boolean;
}

export interface SaveEnvelope {
  saveName: string;
  timestamp: string;
  version: number;
  state: SaveEnvelopeState;
}

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
export function buildSaveEnvelope(params: SaveEnvelopeParams = {}): SaveEnvelope {
  const {
    version         = 4,
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
    miningSites     = [],
    provenLegs      = [],
    routes          = [],
    autoSaveEnabled    = true,
    debugMode          = false,
    welcomeShown       = true,
  } = params;

  // Default hubs — Earth HQ with starter facilities.
  // When `facilities` is provided at the top level, it overrides the Earth hub's
  // facilities (convenience shorthand so callers don't need to build a full `hubs` array).
  // When `hubs` is provided explicitly, it takes precedence and `facilities` is ignored.
  const earthFacilities = params.facilities ?? STARTER_FACILITIES;
  const hubs = params.hubs ?? [{
    id: 'earth',
    name: 'Earth HQ',
    type: 'surface' as const,
    bodyId: 'EARTH',
    coordinates: { x: 0, y: 0 },
    facilities: { ...earthFacilities },
    tourists: [],
    partInventory: [],
    constructionQueue: [],
    maintenanceCost: 0,
    established: 0,
    online: true,
  }];
  const activeHubId = params.activeHubId ?? 'earth';

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
      miningSites,
      provenLegs,
      routes,
      hubs,
      activeHubId,
      autoSaveEnabled,
      debugMode,
      welcomeShown,
    },
  };
}
