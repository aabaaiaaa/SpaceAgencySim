/**
 * techtree.ts — Technology tree node definitions.
 *
 * The tech tree has 4 branches, each with up to 6 tiers.  Nodes are unlocked
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
 *   T6 = 300 sci / $1,200,000
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

/** Tech tree branch identifiers. */
export const TechBranch = Object.freeze({
  PROPULSION: 'propulsion',
  STRUCTURAL: 'structural',
  RECOVERY:   'recovery',
  SCIENCE:    'science',
  LOGISTICS:  'logistics',
} as const);

export type TechBranch = (typeof TechBranch)[keyof typeof TechBranch];

/** Human-readable branch names for UI display. */
export const BRANCH_NAMES: Readonly<Record<string, string>> = Object.freeze({
  [TechBranch.PROPULSION]: 'Propulsion',
  [TechBranch.STRUCTURAL]: 'Structural',
  [TechBranch.RECOVERY]:   'Recovery',
  [TechBranch.SCIENCE]:    'Science',
  [TechBranch.LOGISTICS]:  'Logistics',
});

// ---------------------------------------------------------------------------
// Tier Cost Table
// ---------------------------------------------------------------------------

/** Uniform cost per tier — every node at the same tier costs the same. */
export const TIER_COSTS: Readonly<Record<number, Readonly<{ science: number; funds: number }>>> = Object.freeze({
  1: Object.freeze({ science: 15,  funds: 50_000 }),
  2: Object.freeze({ science: 30,  funds: 100_000 }),
  3: Object.freeze({ science: 60,  funds: 200_000 }),
  4: Object.freeze({ science: 120, funds: 400_000 }),
  5: Object.freeze({ science: 200, funds: 750_000 }),
  6: Object.freeze({ science: 300, funds: 1_200_000 }),
});

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** A single node in the technology tree. */
export interface TechNodeDef {
  /** Unique node identifier (e.g. 'prop-t1'). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** TechBranch value. */
  branch: TechBranch;
  /** Tech tier (1–6). */
  tier: number;
  /** Science points required to research. */
  scienceCost: number;
  /** Funds required to research. */
  fundsCost: number;
  /** Part IDs unlocked by researching this node. */
  unlocksParts: string[];
  /** Instrument IDs unlocked by researching this node. */
  unlocksInstruments: string[];
  /** Flavour text / tooltip. */
  description: string;
}

// ---------------------------------------------------------------------------
// Node Definitions
// ---------------------------------------------------------------------------

/** Complete tech tree: 5 branches × up to 6 tiers = 26 nodes. */
export const TECH_NODES: ReadonlyArray<Readonly<TechNodeDef>> = Object.freeze([

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
    unlocksParts:       ['decoupler-radial', 'nose-cone', 'antenna-standard', 'solar-panel-medium', 'battery-medium'],
    unlocksInstruments: [],
    description:        'Radial decouplers, nose cones, and basic satellite components for custom satellite construction.',
  }),

  Object.freeze({
    id:                 'struct-t3',
    name:               'Heavy Structures',
    branch:             TechBranch.STRUCTURAL,
    tier:               3,
    scienceCost:        TIER_COSTS[3].science,
    fundsCost:          TIER_COSTS[3].funds,
    unlocksParts:       ['tank-large', 'tube-connector', 'antenna-high-power'],
    unlocksInstruments: [],
    description:        'Large fuel tanks, structural tubes, and high-power satellite antennas.',
  }),

  Object.freeze({
    id:                 'struct-t4',
    name:               'Docking Ports',
    branch:             TechBranch.STRUCTURAL,
    tier:               4,
    scienceCost:        TIER_COSTS[4].science,
    fundsCost:          TIER_COSTS[4].funds,
    unlocksParts:       ['docking-port-std', 'docking-port-small', 'relay-antenna', 'antenna-relay', 'grabbing-arm'],
    unlocksInstruments: [],
    description:        'Docking mechanisms, a standard grabbing arm for satellite servicing, orbital assembly, and interplanetary relay dishes.',
  }),

  Object.freeze({
    id:                 'struct-t5',
    name:               'Station Segments',
    branch:             TechBranch.STRUCTURAL,
    tier:               5,
    scienceCost:        TIER_COSTS[5].science,
    fundsCost:          TIER_COSTS[5].funds,
    unlocksParts:       ['station-habitat', 'station-truss', 'grabbing-arm-heavy'],
    unlocksInstruments: [],
    description:        'Pressurised habitation modules, structural trusses for orbital stations, and a heavy grabbing arm for medium asteroid capture.',
  }),

  Object.freeze({
    id:                 'struct-t6',
    name:               'Industrial Grapple',
    branch:             TechBranch.STRUCTURAL,
    tier:               6,
    scienceCost:        TIER_COSTS[6].science,
    fundsCost:          TIER_COSTS[6].funds,
    unlocksParts:       ['grabbing-arm-industrial'],
    unlocksInstruments: [],
    description:        'An industrial-grade grapple system capable of capturing large asteroids approaching 1 km in diameter.',
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
    unlocksParts:       ['sensor-weather', 'sensor-science'],
    unlocksInstruments: ['radiation-detector'],
    description:        'Radiation detectors and satellite sensor packages for weather and science observation.',
  }),

  Object.freeze({
    id:                 'sci-t3',
    name:               'Field Instruments',
    branch:             TechBranch.SCIENCE,
    tier:               3,
    scienceCost:        TIER_COSTS[3].science,
    fundsCost:          TIER_COSTS[3].funds,
    unlocksParts:       ['sample-return-container', 'surface-instrument-package', 'sensor-gps'],
    unlocksInstruments: ['gravity-gradiometer', 'magnetometer'],
    description:        'Field instruments, GPS transponders, and precision mapping from orbit.',
  }),

  Object.freeze({
    id:                 'sci-t4',
    name:               'Science Lab',
    branch:             TechBranch.SCIENCE,
    tier:               4,
    scienceCost:        TIER_COSTS[4].science,
    fundsCost:          TIER_COSTS[4].funds,
    unlocksParts:       ['science-lab', 'instrument-telescope'],
    unlocksInstruments: [],
    description:        'Orbital laboratory module and science telescope for high-yield research.',
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

  // ── Logistics Branch ────────────────────────────────────────────────────

  Object.freeze({
    id:                 'log-t1',
    name:               'Surface Mining',
    branch:             TechBranch.LOGISTICS,
    tier:               1,
    scienceCost:        TIER_COSTS[1].science,
    fundsCost:          TIER_COSTS[1].funds,
    unlocksParts:       ['mining-drill-mk1', 'base-control-unit-mk1', 'storage-silo-mk1', 'power-generator-solar-mk1'],
    unlocksInstruments: [],
    description:        'Basic surface mining equipment: drills, control units, storage silos, and solar power.',
  }),

  Object.freeze({
    id:                 'log-t2',
    name:               'Gas & Fluid Extraction',
    branch:             TechBranch.LOGISTICS,
    tier:               2,
    scienceCost:        TIER_COSTS[2].science,
    fundsCost:          TIER_COSTS[2].funds,
    unlocksParts:       ['gas-collector-mk1', 'fluid-extractor-mk1', 'pressure-vessel-mk1', 'fluid-tank-mk1'],
    unlocksInstruments: [],
    description:        'Atmospheric gas collection and subsurface fluid extraction systems.',
  }),

  Object.freeze({
    id:                 'log-t3',
    name:               'Refining & Processing',
    branch:             TechBranch.LOGISTICS,
    tier:               3,
    scienceCost:        TIER_COSTS[3].science,
    fundsCost:          TIER_COSTS[3].funds,
    unlocksParts:       ['refinery-mk1', 'cargo-bay-mk1', 'pressurized-tank-mk1', 'cryo-tank-mk1'],
    unlocksInstruments: [],
    description:        'On-site refining capability and specialised cargo transport modules.',
  }),

  Object.freeze({
    id:                 'log-t4',
    name:               'Surface Launch Systems',
    branch:             TechBranch.LOGISTICS,
    tier:               4,
    scienceCost:        TIER_COSTS[4].science,
    fundsCost:          TIER_COSTS[4].funds,
    unlocksParts:       ['surface-launch-pad-mk1'],
    unlocksInstruments: [],
    description:        'Electromagnetic catapult systems for launching resources from low-gravity surfaces to orbit.',
  }),

  Object.freeze({
    id:                 'log-t5',
    name:               'Automated Logistics',
    branch:             TechBranch.LOGISTICS,
    tier:               5,
    scienceCost:        TIER_COSTS[5].science,
    fundsCost:          TIER_COSTS[5].funds,
    unlocksParts:       [],
    unlocksInstruments: [],
    description:        'Autonomous route management and fleet coordination for automated resource transport.',
  }),

]);

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

const _byId = new Map<string, TechNodeDef>(TECH_NODES.map((n) => [n.id, n]));

/** Look up a tech node definition by ID. */
export function getTechNodeById(id: string): TechNodeDef | undefined {
  return _byId.get(id);
}

/** Return all nodes in a given branch, sorted by tier ascending. */
export function getNodesByBranch(branch: string): TechNodeDef[] {
  return TECH_NODES.filter((n) => n.branch === branch)
    .sort((a, b) => a.tier - b.tier);
}

/** Return the node in a given branch at a specific tier, or undefined. */
export function getNodeByBranchAndTier(branch: string, tier: number): TechNodeDef | undefined {
  return TECH_NODES.find((n) => n.branch === branch && n.tier === tier);
}

/** Return all tech node definitions. */
export function getAllTechNodes(): ReadonlyArray<Readonly<TechNodeDef>> {
  return TECH_NODES;
}
