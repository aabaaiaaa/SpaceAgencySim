/**
 * Data factories for E2E tests — crew members, contracts, objectives, and hubs.
 */

import type { ObjectiveTemplate } from './_constants.js';

// ---------------------------------------------------------------------------
// Crew factory
// ---------------------------------------------------------------------------

export interface CrewSkills {
  piloting: number;
  engineering: number;
  science: number;
}

export interface CrewMember {
  id: string;
  name: string;
  status: string;
  salary: number;
  hireDate: string;
  skills: CrewSkills;
  missionsFlown: number;
  stationedHubId: string;
  transitUntil: number | null;
}

/**
 * Create a crew member object for use in save envelopes.
 *
 * @param {object} overrides  Fields to override on the default crew member.
 * @returns {object}
 */
export function buildCrewMember({
  id          = 'crew-test-1',
  name        = 'Test Astronaut',
  status      = 'active',
  salary      = 5_000,
  hireDate    = new Date().toISOString(),
  skills      = { piloting: 50, engineering: 50, science: 50 },
  missionsFlown = 0,
  stationedHubId = 'earth',
  transitUntil = null,
}: Partial<CrewMember> = {}): CrewMember {
  return { id, name, status, salary, hireDate, skills, missionsFlown, stationedHubId, transitUntil };
}

// ---------------------------------------------------------------------------
// Contract factory
// ---------------------------------------------------------------------------

export interface Contract {
  id: string;
  title: string;
  description: string;
  category: string;
  objectives: ObjectiveTemplate[];
  bonusObjectives: ObjectiveTemplate[];
  bonusReward: number;
  reward: number;
  penaltyFee: number;
  reputationReward: number;
  reputationPenalty: number;
  deadlinePeriod: number | null;
  boardExpiryPeriod: number;
  generatedPeriod: number;
  acceptedPeriod: number | null;
  chainId: string | null;
  chainPart: number | null;
  chainTotal: number | null;
  conflictTags: string[];
  [key: string]: unknown;
}

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
}: Partial<Contract> = {}): Contract {
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
}: Partial<ObjectiveTemplate> = {}): ObjectiveTemplate {
  return { id, type, target, completed, description };
}

// ---------------------------------------------------------------------------
// Hub factories
// ---------------------------------------------------------------------------

export interface HubSave {
  id: string;
  name: string;
  type: 'surface' | 'orbital';
  bodyId: string;
  altitude?: number;
  coordinates?: { x: number; y: number };
  biomeId?: string;
  facilities: Record<string, { built: boolean; tier: number }>;
  tourists: Record<string, unknown>[];
  partInventory: Record<string, unknown>[];
  constructionQueue: Record<string, unknown>[];
  maintenanceCost: number;
  established: number;
  online: boolean;
}

/**
 * Create a surface hub save object (defaults to Moon outpost).
 */
export function buildHub({
  id = 'hub-test-1',
  name = 'Test Outpost',
  type = 'surface' as const,
  bodyId = 'MOON',
  coordinates = { x: 0, y: 0 },
  facilities = {},
  tourists = [],
  partInventory = [],
  constructionQueue = [],
  maintenanceCost = 0,
  established = 0,
  online = true,
}: Partial<HubSave> = {}): HubSave {
  return { id, name, type, bodyId, coordinates, facilities, tourists, partInventory, constructionQueue, maintenanceCost, established, online };
}

/**
 * Create an orbital hub save object (defaults to Earth orbit at 200km).
 */
export function buildOrbitalHub({
  id = 'hub-orbital-test-1',
  name = 'Test Station',
  type = 'orbital' as const,
  bodyId = 'EARTH',
  altitude = 200_000,
  facilities = {},
  tourists = [],
  partInventory = [],
  constructionQueue = [],
  maintenanceCost = 0,
  established = 0,
  online = true,
}: Partial<HubSave> = {}): HubSave {
  return { id, name, type, bodyId, altitude, facilities, tourists, partInventory, constructionQueue, maintenanceCost, established, online };
}
