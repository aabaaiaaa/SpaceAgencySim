/**
 * Save envelope factory for E2E tests.
 */

import { STARTING_MONEY, STARTER_FACILITIES } from './_constants.js';
import type { FacilityState } from './_constants.js';
import type { CrewMember } from './_factories.js';

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
  facilities?: Readonly<Record<string, FacilityState>>;
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
  autoSaveEnabled?: boolean;
  debugMode?: boolean;
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
  facilities: Record<string, FacilityState>;
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
  autoSaveEnabled: boolean;
  debugMode: boolean;
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
export function buildSaveEnvelope({
  version         = 2,
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
}: SaveEnvelopeParams = {}): SaveEnvelope {
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
    },
  };
}
