/**
 * constants/economy.ts — Finance, facilities, contracts, reputation, training,
 * and crew-cost constants.
 *
 * Extracted from the omnibus `constants.ts` per iteration-19 §9. Self-contained:
 * no cross-references into other constants sub-modules.
 */

// ---------------------------------------------------------------------------
// Starting / Default Values
// ---------------------------------------------------------------------------

/** Player's starting cash balance at a new game (equal to the initial loan proceeds). */
export const STARTING_MONEY: number = 2_000_000;

/** Sandbox mode starting cash -- effectively unlimited. */
export const SANDBOX_STARTING_MONEY: number = 999_999_999;

/** Starting loan balance -- players begin the game $2 million in debt. */
export const STARTING_LOAN_BALANCE: number = 2_000_000;

/** Per-mission interest rate applied to the outstanding loan (3 %). */
export const DEFAULT_LOAN_INTEREST_RATE: number = 0.03;

/** Fine per astronaut killed in action (deducted from cash). */
export const DEATH_FINE_PER_ASTRONAUT: number = 500_000;

/** Cost to hire a new astronaut. */
export const HIRE_COST: number = 50_000;

/** Maximum cumulative loan balance the player may carry. */
export const MAX_LOAN_BALANCE: number = 10_000_000;

/** Maximum number of crew members the player can hire. */
export const MAX_CREW_SIZE: number = 20;

/** Number of missions generated on the board at one time. */
export const AVAILABLE_MISSION_SLOTS: number = 5;

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

/**
 * Unique identifiers for each facility the player can build on the hub.
 */
export const FacilityId = Object.freeze({
  LAUNCH_PAD:       'launch-pad',
  VAB:              'vab',
  MISSION_CONTROL:  'mission-control',
  CREW_ADMIN:       'crew-admin',
  TRACKING_STATION: 'tracking-station',
  RD_LAB:           'rd-lab',
  SATELLITE_OPS:    'satellite-ops',
  LIBRARY:          'library',
  LOGISTICS_CENTER: 'logistics-center',
  CREW_HAB:         'crew-hab',
} as const);

export type FacilityId = (typeof FacilityId)[keyof typeof FacilityId];

/**
 * Static definition for a buildable facility.
 * `cost` is the base build cost in dollars.  `starter` facilities are
 * pre-built at tier 1 in every new game (both tutorial and non-tutorial).
 * `scienceCost` is the science-point cost to build (default 0; only the
 * R&D Lab costs science).
 */
export interface FacilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cost: number;
  readonly scienceCost: number;
  readonly starter: boolean;
}

export const FACILITY_DEFINITIONS: readonly FacilityDefinition[] = Object.freeze([
  Object.freeze({
    id:          FacilityId.LAUNCH_PAD,
    name:        'Launch Pad',
    description: 'Launch rockets into space.',
    cost:        0,
    scienceCost: 0,
    starter:     true,
  }),
  Object.freeze({
    id:          FacilityId.VAB,
    name:        'Vehicle Assembly Building',
    description: 'Design and assemble rockets.',
    cost:        0,
    scienceCost: 0,
    starter:     true,
  }),
  Object.freeze({
    id:          FacilityId.MISSION_CONTROL,
    name:        'Mission Control Centre',
    description: 'Accept contracts and monitor missions.',
    cost:        0,
    scienceCost: 0,
    starter:     true,
  }),
  Object.freeze({
    id:          FacilityId.CREW_ADMIN,
    name:        'Crew Administration',
    description: 'Hire, manage, and train astronauts.',
    cost:        100_000,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.TRACKING_STATION,
    name:        'Tracking Station',
    description: 'Track orbital objects and plan transfers.',
    cost:        200_000,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.RD_LAB,
    name:        'R&D Lab',
    description: 'Research new technologies and unlock advanced parts.',
    cost:        300_000,
    scienceCost: 20,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.SATELLITE_OPS,
    name:        'Satellite Network Operations Centre',
    description: 'Manage satellite networks and orbital infrastructure.',
    cost:        400_000,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.LIBRARY,
    name:        'Library',
    description: 'View agency statistics, records, and knowledge.',
    cost:        0,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.LOGISTICS_CENTER,
    name:        'Logistics Center',
    description: 'Manage mining sites and automated transport routes.',
    cost:        350_000,
    scienceCost: 15,
    starter:     false,
  }),
]);

// ---------------------------------------------------------------------------
// Contract System
// ---------------------------------------------------------------------------

/**
 * Categories of procedurally generated contracts.
 */
export const ContractCategory = Object.freeze({
  ALTITUDE_RECORD: 'ALTITUDE_RECORD',
  SPEED_RECORD: 'SPEED_RECORD',
  SCIENCE_SURVEY: 'SCIENCE_SURVEY',
  SATELLITE_DEPLOY: 'SATELLITE_DEPLOY',
  SAFE_RECOVERY: 'SAFE_RECOVERY',
  ORBITAL: 'ORBITAL',
  CRASH_TEST: 'CRASH_TEST',
  RESOURCE: 'RESOURCE',
} as const);

export type ContractCategory = (typeof ContractCategory)[keyof typeof ContractCategory];

/**
 * Contract board pool and active contract caps by Mission Control tier.
 *
 * pool  = max contracts visible on the board at once.
 * active = max contracts the player may have accepted simultaneously.
 */
export interface ContractTierCap {
  readonly pool: number;
  readonly active: number;
}

export const CONTRACT_TIER_CAPS: Readonly<Record<number, ContractTierCap>> = Object.freeze({
  1: Object.freeze({ pool: 4,  active: 2 }),
  2: Object.freeze({ pool: 8,  active: 5 }),
  3: Object.freeze({ pool: 12, active: 8 }),
});

/**
 * Mission Control Centre tier feature descriptions.
 *
 * Each tier defines:
 *   - label:       Display name for the tier.
 *   - features:    Array of feature strings for UI display.
 *   - minMccTier:  The minimum MCC tier a contract template must declare
 *                  to be eligible for generation.  Templates with
 *                  `minMccTier <= currentMccTier` are included.
 *
 * Tier 1 (free):   Tutorial-level and basic contracts only.
 * Tier 2 ($200k):  Unlocks medium-difficulty contracts.
 * Tier 3 ($500k):  Unlocks premium contracts and multi-part chains.
 */
export interface TierFeatureSet {
  readonly label: string;
  readonly features: readonly string[];
}

export const MCC_TIER_FEATURES: Readonly<Record<number, TierFeatureSet>> = Object.freeze({
  1: Object.freeze({
    label: 'Basic',
    features: Object.freeze([
      'Tutorial missions',
      '2 active contracts',
      '4 board pool',
      'Basic contracts only',
    ]),
  }),
  2: Object.freeze({
    label: 'Standard',
    features: Object.freeze([
      '5 active contracts',
      '8 board pool',
      'Medium-difficulty contracts',
    ]),
  }),
  3: Object.freeze({
    label: 'Advanced',
    features: Object.freeze([
      '8 active contracts',
      '12 board pool',
      'Premium contracts',
      'Multi-part chain contracts',
    ]),
  }),
});

/**
 * Icons (text glyphs) for each contract category, used in the UI.
 */
export const CONTRACT_CATEGORY_ICONS: Readonly<Record<string, string>> = Object.freeze({
  ALTITUDE_RECORD: '\u2191',   // ↑
  SPEED_RECORD:    '\u2192',   // →
  SCIENCE_SURVEY:  '\u25C9',   // ◉
  SATELLITE_DEPLOY:'\u2295',   // ⊕
  SAFE_RECOVERY:   '\u2193',   // ↓
  ORBITAL:         '\u25CB',   // ○
  CRASH_TEST:      '\u2716',   // ✖
});

/**
 * Conflict tags that indicate contracts in the same tag group are harder
 * to complete simultaneously.  Used to warn the player in the UI.
 */
export const CONTRACT_CONFLICT_TAGS = Object.freeze({
  DESTRUCTIVE:  'DESTRUCTIVE',   // crash test vs safe recovery
  BUDGET:       'BUDGET',        // budget-limited flights
  CREW_HEAVY:   'CREW_HEAVY',    // crew requirement contracts
  MINIMALIST:   'MINIMALIST',    // part-count-limited flights
} as const);

export type ContractConflictTag = (typeof CONTRACT_CONFLICT_TAGS)[keyof typeof CONTRACT_CONFLICT_TAGS];

/** Bonus reward multiplier: bonus reward = base reward * this factor. */
export const CONTRACT_BONUS_REWARD_RATE: number = 0.5;

/** Number of new contracts generated after each flight return. */
export const CONTRACTS_PER_FLIGHT_MIN: number = 2;
export const CONTRACTS_PER_FLIGHT_MAX: number = 3;

/** Number of flights before an unaccepted board contract expires. */
export const CONTRACT_BOARD_EXPIRY_FLIGHTS: number = 4;

/** Cancellation penalty as a fraction of the contract reward. */
export const CONTRACT_CANCEL_PENALTY_RATE: number = 0.25;

/** Reputation gained per completed contract (minimum of random 3-5 range). */
export const CONTRACT_REP_GAIN_MIN: number = 3;

/** Reputation gained per completed contract (maximum of random 3-5 range). */
export const CONTRACT_REP_GAIN_MAX: number = 5;

/** @deprecated Use CONTRACT_REP_GAIN_MIN/MAX. Kept for contract generation compat. */
export const CONTRACT_REP_GAIN_BASE: number = 5;

/** Reputation lost per cancelled contract. */
export const CONTRACT_REP_LOSS_CANCEL: number = 8;

/** Reputation lost per expired/failed contract. */
export const CONTRACT_REP_LOSS_FAIL: number = 5;

/** Starting reputation for a new agency. */
export const STARTING_REPUTATION: number = 50;

// ---------------------------------------------------------------------------
// Reputation Events
// ---------------------------------------------------------------------------

/** Reputation gained for each crew member safely returned from a crewed flight. */
export const REP_GAIN_SAFE_CREW_RETURN: number = 1;

/** Reputation gained for reaching a milestone (first orbit, first landing, etc.). */
export const REP_GAIN_MILESTONE: number = 10;

/** Reputation lost per crew member killed in action. */
export const REP_LOSS_CREW_DEATH: number = 10;

/** Reputation lost when a flight ends in failure (objectives not met). */
export const REP_LOSS_MISSION_FAILURE: number = 3;

/** Reputation lost when rocket is destroyed with no recovery. */
export const REP_LOSS_ROCKET_DESTRUCTION: number = 2;

// ---------------------------------------------------------------------------
// Reputation Tiers
// ---------------------------------------------------------------------------

/**
 * Reputation tier definitions.  Each tier covers a range of reputation values
 * and applies modifiers to crew hiring cost and facility construction cost.
 *
 * `crewCostModifier`:    multiplier applied to HIRE_COST (1.0 = normal).
 * `facilityDiscount`:    fractional discount on money cost of facilities/upgrades.
 *                        Never applied to science costs (e.g. R&D Lab).
 * `label`:               human-readable tier name.
 * `color`:               hex CSS colour for UI display.
 */
export interface ReputationTier {
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly color: string;
  readonly crewCostModifier: number;
  readonly facilityDiscount: number;
}

export const REPUTATION_TIERS: readonly ReputationTier[] = Object.freeze([
  { min: 0,  max: 20,  label: 'Basic',   color: '#cc4444', crewCostModifier: 1.50, facilityDiscount: 0.00 },
  { min: 21, max: 40,  label: 'Standard', color: '#cc8844', crewCostModifier: 1.25, facilityDiscount: 0.00 },
  { min: 41, max: 60,  label: 'Good',    color: '#cccc44', crewCostModifier: 1.00, facilityDiscount: 0.05 },
  { min: 61, max: 80,  label: 'Premium', color: '#44cc88', crewCostModifier: 0.90, facilityDiscount: 0.10 },
  { min: 81, max: 100, label: 'Elite',   color: '#4488ff', crewCostModifier: 0.75, facilityDiscount: 0.15 },
]);

/**
 * Get the reputation tier object for a given reputation value.
 *
 * @param reputation  Current agency reputation (0-100).
 */
export function getReputationTier(reputation: number): ReputationTier {
  const rep = Math.max(0, Math.min(100, reputation));
  for (const tier of REPUTATION_TIERS) {
    if (rep >= tier.min && rep <= tier.max) return tier;
  }
  return REPUTATION_TIERS[0];
}

/**
 * Get the crew hiring cost modifier for the current reputation.
 * Applied as a multiplier to HIRE_COST.
 *
 * @param reputation  Current agency reputation (0-100).
 * @returns  Multiplier (e.g. 1.5 = +50 %, 0.75 = -25 %).
 */
export function getCrewCostModifier(reputation: number): number {
  return getReputationTier(reputation).crewCostModifier;
}

// ---------------------------------------------------------------------------
// Period / Operating Costs
// ---------------------------------------------------------------------------

/** Crew salary charged per period (per astronaut). */
export const CREW_SALARY_PER_PERIOD: number = 5_000;

/** Base facility upkeep charged per period. */
export const FACILITY_UPKEEP_PER_PERIOD: number = 10_000;

// ---------------------------------------------------------------------------
// Crew Admin Tier Features
// ---------------------------------------------------------------------------

/**
 * Crew Administration facility tier feature descriptions.
 *
 * Tier 1 ($100k):  Basic hire/fire, skill tracking.
 * Tier 2 ($250k):  Training facility -- assign crew to skill training between flights.
 * Tier 3 ($600k):  Recruit experienced crew (starting skills > 0), advanced medical.
 */
export const CREW_ADMIN_TIER_FEATURES: Readonly<Record<number, TierFeatureSet>> = Object.freeze({
  1: Object.freeze({
    label: 'Basic',
    features: Object.freeze([
      'Hire and fire astronauts',
      'Basic skill tracking',
      'Medical care (halves recovery)',
    ]),
  }),
  2: Object.freeze({
    label: 'Training Centre',
    features: Object.freeze([
      'Assign crew to training courses (1 slot)',
      'Course: $20k, 3 periods, +15 skill',
      'All Tier 1 features',
    ]),
  }),
  3: Object.freeze({
    label: 'Advanced Operations',
    features: Object.freeze([
      'Recruit experienced crew (starting skills > 0)',
      'Advanced medical (recovery time reduced to 1/3)',
      'Training slots increased to 3',
      'All Tier 2 features',
    ]),
  }),
});

/**
 * Tracking Station facility tier feature descriptions.
 *
 * Tier 1 ($200k):  Map view (local body only), see objects in orbit.
 * Tier 2 ($500k):  Map view (solar system), track debris, predict weather windows.
 * Tier 3 ($1M):    Deep space communication, transfer route planning, track distant bodies.
 */
export const TRACKING_STATION_TIER_FEATURES: Readonly<Record<number, TierFeatureSet>> = Object.freeze({
  1: Object.freeze({
    label: 'Basic',
    features: Object.freeze([
      'Map view (local body only)',
      'See objects in orbit',
      'Basic orbital tracking',
    ]),
  }),
  2: Object.freeze({
    label: 'Advanced',
    features: Object.freeze([
      'Map view (solar system)',
      'Track debris',
      'Predict weather windows',
      'All Tier 1 features',
    ]),
  }),
  3: Object.freeze({
    label: 'Deep Space',
    features: Object.freeze([
      'Deep space communication',
      'Transfer route planning',
      'Track distant bodies',
      'All Tier 2 features',
    ]),
  }),
});

/**
 * Cost to enrol one astronaut in a training course.
 * Charged upfront when training is assigned.
 */
export const TRAINING_COURSE_COST: number = 20_000;

/**
 * Duration of a single training course in periods.
 * The astronaut is unavailable for flights for this many periods.
 */
export const TRAINING_COURSE_DURATION: number = 3;

/**
 * Flat skill points awarded when a training course completes.
 * Applied directly (not subject to diminishing returns) to the chosen skill,
 * but still capped at 100.
 */
export const TRAINING_SKILL_GAIN: number = 15;

/**
 * Maximum number of simultaneous training slots by Crew Admin tier.
 * Tier 2 provides 1 slot, Tier 3 provides 3.
 */
export const TRAINING_SLOTS_BY_TIER: Readonly<Record<number, number>> = Object.freeze({ 2: 1, 3: 3 });

/**
 * Starting skill range for experienced crew (Tier 3 recruitment).
 * Each skill starts at a random value in [min, max].
 */
export interface SkillRange {
  readonly min: number;
  readonly max: number;
}

export const EXPERIENCED_CREW_SKILL_RANGE: SkillRange = Object.freeze({ min: 10, max: 30 });

/**
 * Hire cost multiplier for experienced crew (Tier 3).
 * Applied on top of the reputation-adjusted hire cost.
 */
export const EXPERIENCED_HIRE_COST_MULTIPLIER: number = 2.5;

// ---------------------------------------------------------------------------
// Tech Tree (R&D Lab tier gating)
// ---------------------------------------------------------------------------

/**
 * Maximum tech tier accessible per R&D Lab facility tier.
 *
 *   R&D Lab Tier 1 -> tech tiers 1-2
 *   R&D Lab Tier 2 -> tech tiers 3-4
 *   R&D Lab Tier 3 -> tech tiers 5-6
 */
export const RD_TIER_MAX_TECH: Readonly<Record<number, number>> = Object.freeze({
  1: 2,
  2: 4,
  3: 6,
});

// ---------------------------------------------------------------------------
// R&D Lab Upgrade Definitions
// ---------------------------------------------------------------------------

/**
 * R&D Lab science yield bonus per facility tier.
 * Applied as a multiplier: `yield *= (1 + bonus)`.
 */
export const RD_LAB_SCIENCE_BONUS: Readonly<Record<number, number>> = Object.freeze({
  0: 0,     // No lab built
  1: 0.10,  // Tier 1: +10 %
  2: 0.20,  // Tier 2: +20 %
  3: 0.30,  // Tier 3: +30 %
});

/**
 * Upgrade cost definition for an R&D Lab tier.
 */
export interface RdLabTierDef {
  readonly moneyCost: number;
  readonly scienceCost: number;
  readonly description: string;
}

/**
 * Upgrade cost definitions for each R&D Lab tier.
 *
 * Tier 1 is the initial build.  Tiers 2-3 are upgrades.
 * The R&D Lab is the only facility that costs both money AND science.
 * Reputation discounts apply to the money portion only.
 */
export const RD_LAB_TIER_DEFS: Readonly<Record<number, RdLabTierDef>> = Object.freeze({
  1: Object.freeze({ moneyCost: 300_000,   scienceCost: 20,  description: 'Tech tiers 1–2, 10% science bonus' }),
  2: Object.freeze({ moneyCost: 600_000,   scienceCost: 100, description: 'Tech tiers 3–4, 20% science bonus' }),
  3: Object.freeze({ moneyCost: 1_000_000, scienceCost: 200, description: 'Tier 5, 30% science bonus, experimental parts' }),
});

/** Maximum upgrade tier for the R&D Lab. */
export const RD_LAB_MAX_TIER: number = 3;

// ---------------------------------------------------------------------------
// Generalized Facility Upgrade Definitions
// ---------------------------------------------------------------------------

/**
 * Upgrade cost for a single facility tier.
 */
export interface FacilityTierUpgrade {
  readonly moneyCost: number;
  readonly scienceCost: number;
  readonly description: string;
}

/**
 * Upgrade definition for a facility: max tier and per-tier costs.
 */
export interface FacilityUpgradeDef {
  readonly maxTier: number;
  readonly tiers: Readonly<Record<number, FacilityTierUpgrade>>;
}

/**
 * Upgrade tier definitions for every upgradeable facility.
 *
 * Each key is a FacilityId.  The value is an object with:
 *   - `maxTier` -- the highest tier this facility can reach.
 *   - `tiers`   -- a map from tier number (2+) to upgrade cost & description.
 *     Tier 1 is always the initial build (no upgrade cost).
 *
 * All facilities cost money only, except R&D Lab which also costs science.
 * Reputation discounts apply to the money portion only.
 *
 * Facilities absent from this map (e.g. Library) have no upgrades (max tier 1).
 */
export const FACILITY_UPGRADE_DEFS: Readonly<Record<string, FacilityUpgradeDef>> = Object.freeze({
  [FacilityId.LAUNCH_PAD]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 200_000, scienceCost: 0, description: 'Higher max mass, fuel top-off' }),
      3: Object.freeze({ moneyCost: 500_000, scienceCost: 0, description: 'Highest max mass, launch clamp support' }),
    }),
  }),
  [FacilityId.VAB]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 150_000, scienceCost: 0, description: 'Higher part count, greater height/width' }),
      3: Object.freeze({ moneyCost: 400_000, scienceCost: 0, description: 'Highest part count, largest height/width' }),
    }),
  }),
  [FacilityId.MISSION_CONTROL]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 200_000, scienceCost: 0, description: '5 active contracts, 8 board pool, medium-difficulty' }),
      3: Object.freeze({ moneyCost: 500_000, scienceCost: 0, description: '8 active contracts, 12 board pool, premium contracts' }),
    }),
  }),
  [FacilityId.CREW_ADMIN]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 250_000, scienceCost: 0, description: 'Training facility for crew skill development' }),
      3: Object.freeze({ moneyCost: 600_000, scienceCost: 0, description: 'Recruit experienced crew, advanced medical' }),
    }),
  }),
  [FacilityId.TRACKING_STATION]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 500_000, scienceCost: 0, description: 'Solar system map, debris tracking, weather windows' }),
      3: Object.freeze({ moneyCost: 1_000_000, scienceCost: 0, description: 'Deep space comms, transfer route planning' }),
    }),
  }),
  [FacilityId.RD_LAB]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 600_000,   scienceCost: 100, description: 'Tech tiers 3–4, 20% science bonus' }),
      3: Object.freeze({ moneyCost: 1_000_000, scienceCost: 200, description: 'Tier 5, 30% science bonus, experimental parts' }),
    }),
  }),
  [FacilityId.SATELLITE_OPS]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 400_000, scienceCost: 0, description: 'Lease satellites to third parties, constellation management' }),
      3: Object.freeze({ moneyCost: 700_000, scienceCost: 0, description: 'Advanced network planning, satellite repositioning, shadow overlay' }),
    }),
  }),
});

/**
 * Look up the upgrade definition for a facility.
 */
export function getFacilityUpgradeDef(facilityId: string): FacilityUpgradeDef | null {
  return FACILITY_UPGRADE_DEFS[facilityId] ?? null;
}

/**
 * Calculate the reputation discount fraction for facility construction.
 *
 * Uses tier-based discounts:
 *   0-20:  0 %    (Basic)
 *   21-40: 0 %    (Standard)
 *   41-60: 5 %    (Good)
 *   61-80: 10 %   (Premium)
 *   81-100: 15 %  (Elite)
 *
 * Facility discounts apply to money only -- never to science costs (R&D Lab).
 *
 * @param reputation  Current agency reputation (0-100).
 * @returns  Discount fraction (0.0-0.15).
 */
export function getReputationDiscount(reputation: number): number {
  return getReputationTier(reputation).facilityDiscount;
}

// ---------------------------------------------------------------------------
// Facility Tier Labels (for facilities without full TierFeatureSet definitions)
// ---------------------------------------------------------------------------

/**
 * Launch Pad tier display labels for the facility header.
 */
export const LAUNCH_PAD_TIER_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Basic',
  2: 'Enhanced',
  3: 'Heavy Lift',
});

/**
 * R&D Lab tier display labels for the facility header.
 */
export const RD_LAB_TIER_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Foundation',
  2: 'Advanced',
  3: 'Cutting Edge',
});

/**
 * Satellite Network Operations Centre tier display labels for the facility header.
 */
export const SATELLITE_OPS_TIER_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Monitoring',
  2: 'Commercial',
  3: 'Command',
});

// ---------------------------------------------------------------------------
// Launch Pad Tier Limits
// ---------------------------------------------------------------------------

/**
 * Maximum total rocket mass (wet mass, kg) allowed per Launch Pad tier.
 *
 *   Tier 1: 18,000 kg  -- small sounding rockets
 *   Tier 2: 80,000 kg  -- medium orbital launch vehicles
 *   Tier 3: Infinity   -- no mass limit (heavy-lift allowed)
 */
export const LAUNCH_PAD_MAX_MASS: Readonly<Record<number, number>> = Object.freeze({
  1: 18_000,
  2: 80_000,
  3: Infinity,
});

// ---------------------------------------------------------------------------
// VAB Tier Limits
// ---------------------------------------------------------------------------

/**
 * Maximum number of parts allowed in a rocket assembly per VAB tier.
 *
 *   Tier 1: 20 parts  -- basic sounding rockets and simple multi-stage
 *   Tier 2: 40 parts  -- larger multi-stage vehicles with radial mounts
 *   Tier 3: Infinity  -- no part limit
 */
export const VAB_MAX_PARTS: Readonly<Record<number, number>> = Object.freeze({
  1: 20,
  2: 40,
  3: Infinity,
});

/**
 * Maximum rocket height (pixels, from getRocketBounds) per VAB tier.
 * 1 px = 0.05 m, so 400 px ~ 20 m, 800 px ~ 40 m.
 *
 *   Tier 1: 400 px (20 m)
 *   Tier 2: 800 px (40 m)
 *   Tier 3: Infinity
 */
export const VAB_MAX_HEIGHT: Readonly<Record<number, number>> = Object.freeze({
  1: 400,
  2: 800,
  3: Infinity,
});

/**
 * Maximum rocket width (pixels, from getRocketBounds) per VAB tier.
 *
 *   Tier 1: 120 px (6 m)
 *   Tier 2: 200 px (10 m)
 *   Tier 3: Infinity
 */
export const VAB_MAX_WIDTH: Readonly<Record<number, number>> = Object.freeze({
  1: 120,
  2: 200,
  3: Infinity,
});
