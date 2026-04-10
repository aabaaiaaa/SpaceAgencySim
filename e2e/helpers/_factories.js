/**
 * Data factories for E2E tests — crew members, contracts, and objectives.
 */

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
  status      = 'active',
  salary      = 5_000,
  hireDate    = new Date().toISOString(),
  skills      = { piloting: 50, engineering: 50, science: 50 },
  missionsFlown = 0,
} = {}) {
  return { id, name, status, salary, hireDate, skills, missionsFlown };
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
