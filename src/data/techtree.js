/**
 * techtree.js — Technology tree node definitions.
 *
 * The tech tree has 4 branches, each with 5 tiers.  Nodes are unlocked
 * by spending science points AND funds at the R&D Lab facility.
 *
 * BRANCHES
 * ========
 *   - Propulsion:  Engines and propulsion systems
 *   - Structural:  Tanks, decouplers, and structural components
 *   - Recovery:    Landing and recovery equipment
 *   - Science:     Science instruments and lab equipment
 *
 * TIER COSTS (uniform across all branches)
 * =========================================
 *   T1 =  15 sci / $50,000
 *   T2 =  30 sci / $100,000
 *   T3 =  60 sci / $200,000
 *   T4 = 120 sci / $400,000
 *   T5 = 200 sci / $750,000
 *
 * RULES
 * =====
 *   - Starter parts (probe-core-mk1, tank-small, engine-spark, parachute-mk1,
 *     science-module-mk1, thermometer-mk1, cmd-mk1) do NOT appear in the tree.
 *   - Tutorial mission rewards are shown as pre-unlocked nodes
 *     ("Unlocked via tutorial") when the player already owns all the node's parts.
 *   - Non-tutorial players can purchase tutorial-unlocked nodes normally,
 *     providing an alternative unlock path.
 *   - R&D Lab facility must be built to research any node.
 *   - Each tier requires the previous tier in the same branch to be
 *     researched (or effectively unlocked via tutorial).
 *
 * @module data/techtree
 */

// ---------------------------------------------------------------------------
// Branch IDs
// ---------------------------------------------------------------------------

/**
 * Tech tree branch identifiers.
 * @enum {string}
 */
export const TechBranch = Object.freeze({
  PROPULSION: 'propulsion',
  STRUCTURAL: 'structural',
  RECOVERY:   'recovery',
  SCIENCE:    'science',
});

/**
 * Human-readable branch names for UI display.
 * @type {Readonly<Record<string, string>>}
 */
export const BRANCH_NAMES = Object.freeze({
  [TechBranch.PROPULSION]: 'Propulsion',
  [TechBranch.STRUCTURAL]: 'Structural',
  [TechBranch.RECOVERY]:   'Recovery',
  [TechBranch.SCIENCE]:    'Science',
});

// ---------------------------------------------------------------------------
// Tier Cost Table
// ---------------------------------------------------------------------------

/**
 * Uniform cost per tier — every node at the same tier costs the same.
 * @type {Readonly<Record<number, Readonly<{science: number, funds: number}>>>}
 */
export const TIER_COSTS = Object.freeze({
  1: Object.freeze({ science: 15,  funds: 50_000 }),
  2: Object.freeze({ science: 30,  funds: 100_000 }),
  3: Object.freeze({ science: 60,  funds: 200_000 }),
  4: Object.freeze({ science: 120, funds: 400_000 }),
  5: Object.freeze({ science: 200, funds: 750_000 }),
});

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * A single node in the technology tree.
 *
 * @typedef {Object} TechNodeDef
 * @property {string}   id                  Unique node identifier (e.g. 'prop-t1').
 * @property {string}   name                Human-readable display name.
 * @property {string}   branch              TechBranch value.
 * @property {number}   tier                Tech tier (1–5).
 * @property {number}   scienceCost         Science points required to research.
 * @property {number}   fundsCost           Funds required to research.
 * @property {string[]} unlocksParts        Part IDs unlocked by researching this node.
 * @property {string[]} unlocksInstruments  Instrument IDs unlocked by researching this node.
 * @property {string}   description         Flavour text / tooltip.
 */

// ---------------------------------------------------------------------------
// Node Definitions
// ---------------------------------------------------------------------------

/**
 * Complete tech tree: 4 branches × 5 tiers = 20 nodes.
 * @type {ReadonlyArray<Readonly<TechNodeDef>>}
 */
export const TECH_NODES = Object.freeze([

  // ── Propulsion Branch ────────────────────────────────────────────────────

  Object.freeze({
    id:                 'prop-t1',
    name:               'Improved Spark',
    branch:             TechBranch.PROPULSION,
    tier:               1,
    scienceCost:        TIER_COSTS[1].science,
    fundsCost:          TIER_COSTS[1].funds,
    unlocksParts:       ['engine-spark-improved'],
    unlocksInstruments: [],
    description:        'An upgraded Spark engine with better specific impulse and thrust vectoring.',
  }),

  Object.freeze({
    id:                 'prop-t2',
    name:               'Reliant',
    branch:             TechBranch.PROPULSION,
    tier:               2,
    scienceCost:        TIER_COSTS[2].science,
    fundsCost:          TIER_COSTS[2].funds,
    unlocksParts:       ['engine-reliant'],
    unlocksInstruments: [],
    description:        'A reliable mid-range liquid engine suitable for upper stages and orbital insertion.',
  }),

  Object.freeze({
    id:                 'prop-t3',
    name:               'Poodle',
    branch:             TechBranch.PROPULSION,
    tier:               3,
    scienceCost:        TIER_COSTS[3].science,
    fundsCost:          TIER_COSTS[3].funds,
    unlocksParts:       ['engine-poodle'],
    unlocksInstruments: [],
    description:        'A vacuum-optimised engine with high efficiency for deep-space manoeuvres.',
  }),

  Object.freeze({
    id:                 'prop-t4',
    name:               'Ion Drive',
    branch:             TechBranch.PROPULSION,
    tier:               4,
    scienceCost:        TIER_COSTS[4].science,
    fundsCost:          TIER_COSTS[4].funds,
    unlocksParts:       ['engine-ion'],
    unlocksInstruments: [],
    description:        'Low thrust but extreme efficiency — ideal for long-duration probes and station-keeping.',
  }),

  Object.freeze({
    id:                 'prop-t5',
    name:               'Nuclear Thermal',
    branch:             TechBranch.PROPULSION,
    tier:               5,
    scienceCost:        TIER_COSTS[5].science,
    fundsCost:          TIER_COSTS[5].funds,
    unlocksParts:       ['engine-nerv', 'engine-deep-space'],
    unlocksInstruments: [],
    description:        'Nuclear thermal propulsion — the highest specific impulse for crewed interplanetary missions.',
  }),

  // ── Structural Branch ────────────────────────────────────────────────────

  Object.freeze({
    id:                 'struct-t1',
    name:               'Medium Tank',
    branch:             TechBranch.STRUCTURAL,
    tier:               1,
    scienceCost:        TIER_COSTS[1].science,
    fundsCost:          TIER_COSTS[1].funds,
    unlocksParts:       ['tank-medium'],
    unlocksInstruments: [],
    description:        'A medium-capacity fuel tank for longer missions and heavier payloads.',
  }),

  Object.freeze({
    id:                 'struct-t2',
    name:               'Radial Attachments',
    branch:             TechBranch.STRUCTURAL,
    tier:               2,
    scienceCost:        TIER_COSTS[2].science,
    fundsCost:          TIER_COSTS[2].funds,
    unlocksParts:       ['decoupler-radial', 'nose-cone'],
    unlocksInstruments: [],
    description:        'Radial decouplers for booster staging and aerodynamic nose cones.',
  }),

  Object.freeze({
    id:                 'struct-t3',
    name:               'Heavy Structures',
    branch:             TechBranch.STRUCTURAL,
    tier:               3,
    scienceCost:        TIER_COSTS[3].science,
    fundsCost:          TIER_COSTS[3].funds,
    unlocksParts:       ['tank-large', 'tube-connector'],
    unlocksInstruments: [],
    description:        'Large fuel tanks and structural tubes for heavy-lift vehicle designs.',
  }),

  Object.freeze({
    id:                 'struct-t4',
    name:               'Docking Ports',
    branch:             TechBranch.STRUCTURAL,
    tier:               4,
    scienceCost:        TIER_COSTS[4].science,
    fundsCost:          TIER_COSTS[4].funds,
    unlocksParts:       ['docking-port-std', 'docking-port-small', 'relay-antenna'],
    unlocksInstruments: [],
    description:        'Standard docking mechanism for orbital assembly and crew transfer.',
  }),

  Object.freeze({
    id:                 'struct-t5',
    name:               'Station Segments',
    branch:             TechBranch.STRUCTURAL,
    tier:               5,
    scienceCost:        TIER_COSTS[5].science,
    fundsCost:          TIER_COSTS[5].funds,
    unlocksParts:       ['station-habitat', 'station-truss'],
    unlocksInstruments: [],
    description:        'Pressurised habitation modules and structural trusses for orbital stations.',
  }),

  // ── Recovery Branch ──────────────────────────────────────────────────────

  Object.freeze({
    id:                 'recov-t1',
    name:               'Parachute Mk2',
    branch:             TechBranch.RECOVERY,
    tier:               1,
    scienceCost:        TIER_COSTS[1].science,
    fundsCost:          TIER_COSTS[1].funds,
    unlocksParts:       ['parachute-mk2'],
    unlocksInstruments: [],
    description:        'A larger, more resilient parachute for heavier capsules and faster deployments.',
  }),

  Object.freeze({
    id:                 'recov-t2',
    name:               'Drogue Chute',
    branch:             TechBranch.RECOVERY,
    tier:               2,
    scienceCost:        TIER_COSTS[2].science,
    fundsCost:          TIER_COSTS[2].funds,
    unlocksParts:       ['parachute-drogue'],
    unlocksInstruments: [],
    description:        'A high-speed drogue chute that deploys at supersonic speeds to stabilise descent.',
  }),

  Object.freeze({
    id:                 'recov-t3',
    name:               'Heat Shield',
    branch:             TechBranch.RECOVERY,
    tier:               3,
    scienceCost:        TIER_COSTS[3].science,
    fundsCost:          TIER_COSTS[3].funds,
    unlocksParts:       ['heat-shield-mk1'],
    unlocksInstruments: [],
    description:        'Ablative heat shield for atmospheric re-entry from orbital velocities.',
  }),

  Object.freeze({
    id:                 'recov-t4',
    name:               'Powered Landing',
    branch:             TechBranch.RECOVERY,
    tier:               4,
    scienceCost:        TIER_COSTS[4].science,
    fundsCost:          TIER_COSTS[4].funds,
    unlocksParts:       ['landing-legs-powered', 'heat-shield-mk2', 'mission-module-extended'],
    unlocksInstruments: [],
    description:        'Retro-propulsion landing systems and heavy-duty heat shields for crewed reentry.',
  }),

  Object.freeze({
    id:                 'recov-t5',
    name:               'Solar Approach',
    branch:             TechBranch.RECOVERY,
    tier:               5,
    scienceCost:        TIER_COSTS[5].science,
    fundsCost:          TIER_COSTS[5].funds,
    unlocksParts:       ['booster-reusable', 'heat-shield-solar', 'heat-shield-heavy'],
    unlocksInstruments: [],
    description:        'Reusable boosters and exotic solar heat shields for close approach to the Sun.',
  }),

  // ── Science Branch ───────────────────────────────────────────────────────

  Object.freeze({
    id:                 'sci-t1',
    name:               'Barometer',
    branch:             TechBranch.SCIENCE,
    tier:               1,
    scienceCost:        TIER_COSTS[1].science,
    fundsCost:          TIER_COSTS[1].funds,
    unlocksParts:       [],
    unlocksInstruments: ['barometer', 'surface-sampler'],
    description:        'Atmospheric pressure instruments for characterising planetary atmospheres.',
  }),

  Object.freeze({
    id:                 'sci-t2',
    name:               'Radiation Detector',
    branch:             TechBranch.SCIENCE,
    tier:               2,
    scienceCost:        TIER_COSTS[2].science,
    fundsCost:          TIER_COSTS[2].funds,
    unlocksParts:       [],
    unlocksInstruments: ['radiation-detector'],
    description:        'Charged-particle flux sensors for studying cosmic and solar radiation.',
  }),

  Object.freeze({
    id:                 'sci-t3',
    name:               'Field Instruments',
    branch:             TechBranch.SCIENCE,
    tier:               3,
    scienceCost:        TIER_COSTS[3].science,
    fundsCost:          TIER_COSTS[3].funds,
    unlocksParts:       ['sample-return-container', 'surface-instrument-package'],
    unlocksInstruments: ['gravity-gradiometer', 'magnetometer'],
    description:        'Precision instruments for mapping gravitational and magnetic fields from orbit.',
  }),

  Object.freeze({
    id:                 'sci-t4',
    name:               'Science Lab',
    branch:             TechBranch.SCIENCE,
    tier:               4,
    scienceCost:        TIER_COSTS[4].science,
    fundsCost:          TIER_COSTS[4].funds,
    unlocksParts:       ['science-lab'],
    unlocksInstruments: [],
    description:        'An orbital laboratory module that can process samples for bonus science yield.',
  }),

  Object.freeze({
    id:                 'sci-t5',
    name:               'Deep Space Instruments',
    branch:             TechBranch.SCIENCE,
    tier:               5,
    scienceCost:        TIER_COSTS[5].science,
    fundsCost:          TIER_COSTS[5].funds,
    unlocksParts:       [],
    unlocksInstruments: ['deep-space-scanner', 'cosmic-ray-telescope'],
    description:        'Advanced deep-space observatory instruments for interplanetary science.',
  }),

]);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** @type {Map<string, TechNodeDef>} */
const _byId = new Map(TECH_NODES.map((n) => [n.id, n]));

/**
 * Look up a tech node definition by ID.
 * @param {string} id
 * @returns {TechNodeDef|undefined}
 */
export function getTechNodeById(id) {
  return _byId.get(id);
}

/**
 * Return all nodes in a given branch, sorted by tier ascending.
 * @param {string} branch  TechBranch value.
 * @returns {TechNodeDef[]}
 */
export function getNodesByBranch(branch) {
  return TECH_NODES.filter((n) => n.branch === branch)
    .sort((a, b) => a.tier - b.tier);
}

/**
 * Return the node in a given branch at a specific tier, or undefined.
 * @param {string} branch  TechBranch value.
 * @param {number} tier    Tier number (1–5).
 * @returns {TechNodeDef|undefined}
 */
export function getNodeByBranchAndTier(branch, tier) {
  return TECH_NODES.find((n) => n.branch === branch && n.tier === tier);
}

/**
 * Return all tech node definitions.
 * @returns {ReadonlyArray<Readonly<TechNodeDef>>}
 */
export function getAllTechNodes() {
  return TECH_NODES;
}
