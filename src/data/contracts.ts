/**
 * contracts.ts — Contract generation templates and scaling rules.
 *
 * Procedurally generated contracts are built from templates that define the
 * objective types, parameter ranges, and reward formulas.  Each template
 * specifies a minimum player progression requirement (e.g. "player must have
 * completed mission X" or "player must have reached altitude Y") so that
 * generated contracts match current capabilities.
 *
 * ARCHITECTURE
 * ============
 * Templates are static data consumed by `src/core/contracts.js` at generation
 * time.  They are never mutated.  Live contract instances (with mutable
 * objective completion flags, deadlines, etc.) live in `state.contracts`.
 *
 * @module data/contracts
 */

import { ContractCategory, CONTRACT_CONFLICT_TAGS, CONTRACT_BONUS_REWARD_RATE, PartType } from '../core/constants.ts';
import { ObjectiveType } from './missions.ts';
import type { GameState, ObjectiveDef } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GeneratedContract {
  title: string;
  description: string;
  category: string;
  objectives: ObjectiveDef[];
  bonusObjectives?: (ObjectiveDef & { bonus?: boolean })[];
  bonusReward?: number;
  reward: number;
  deadlineFlights: number | null;
  chainId: string | null;
  chainPart: number | null;
  chainTotal: number | null;
  conflictTags?: string[];
}

export interface ContractTemplate {
  id: string;
  category: string;
  minTier: number;
  maxTier?: number;
  minMccTier: number;
  canGenerate: (state: GameState, rand?: number) => boolean;
  generate: (state: GameState, rand: number) => GeneratedContract;
}

// ---------------------------------------------------------------------------
// Progression Thresholds
// ---------------------------------------------------------------------------

/**
 * Determine the player's progression tier based on completed missions.
 *
 * Tier 0: brand new (0 missions)
 * Tier 1: early game (1-3 missions)
 * Tier 2: mid game (4-7 missions)
 * Tier 3: advanced (8-11 missions)
 * Tier 4: late game (12-14 missions)
 * Tier 5: endgame (15+ missions, orbital capable)
 */
export function getProgressionTier(state: GameState): number {
  const completed = state.missions.completed.length;
  if (completed >= 15) return 5;
  if (completed >= 12) return 4;
  if (completed >= 8) return 3;
  if (completed >= 4) return 2;
  if (completed >= 1) return 1;
  return 0;
}

/**
 * Get the player's highest achieved altitude from flight history and
 * completed mission objectives.
 */
export function getHighestAltitude(state: GameState): number {
  let max = 100; // baseline
  for (const mission of state.missions.completed) {
    // Completed missions carry objectives at runtime, but the Mission
    // interface doesn't declare them (they originate from mission templates).
    const objectives = mission.objectives;
    if (!objectives) continue;
    for (const obj of objectives) {
      if (obj.type === ObjectiveType.REACH_ALTITUDE && obj.target?.altitude) {
        max = Math.max(max, obj.target.altitude as number);
      }
      if (obj.type === ObjectiveType.REACH_ORBIT && obj.target?.orbitAltitude) {
        max = Math.max(max, obj.target.orbitAltitude as number);
      }
      if (obj.type === ObjectiveType.HOLD_ALTITUDE && obj.target?.maxAltitude) {
        max = Math.max(max, obj.target.maxAltitude as number);
      }
    }
  }
  return max;
}

/**
 * Check if the player has orbital capability (completed an orbit mission).
 */
export function hasOrbitalCapability(state: GameState): boolean {
  return state.missions.completed.some(
    (m) => {
      const objectives = m.objectives;
      return objectives?.some((o) => o.type === ObjectiveType.REACH_ORBIT && o.completed);
    },
  );
}

/**
 * Check if the player has satellite deployment capability.
 */
export function hasSatelliteCapability(state: GameState): boolean {
  return state.parts.includes('satellite-mk1');
}

/**
 * Check if the player has science module capability.
 */
export function hasScienceCapability(state: GameState): boolean {
  return state.parts.includes('science-module-mk1');
}

// ---------------------------------------------------------------------------
// Resource Contract Chain (12-part)
// ---------------------------------------------------------------------------

const RESOURCE_CHAIN_ID = 'resource-chain';

/**
 * Check whether the previous resource contract in the chain has been completed.
 * For contract 1 (index 0), checks that tutorial missions are done (>= 15).
 * For contracts 2-12, checks that a contract with the matching chainId and
 * chainPart exists in state.contracts.completed.
 */
function _canGenerateResourceContract(index: number, state: GameState): boolean {
  if (index === 0) {
    return state.missions.completed.length >= 15;
  }
  return state.contracts.completed.some(
    (c) => c.chainId === RESOURCE_CHAIN_ID && c.chainPart === index,
  );
}

/**
 * 12-part resource contract chain, exported separately for direct testing.
 */
export const RESOURCE_CONTRACTS: ContractTemplate[] = [
  // 1. Lunar Survey
  {
    id: 'resource-lunar-survey',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(0, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Lunar Survey',
        description: 'Land a Base Control Unit and Mining Drill on the Moon to survey for harvestable resources. This is the first step toward off-world resource extraction.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-1-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach Earth orbit',
          },
          {
            id: 'obj-res-1-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy BCU + Drill package on the Moon' },
            completed: false,
            description: 'Deploy BCU and Mining Drill on the lunar surface',
          },
        ],
        reward: 50_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 1,
        chainTotal: 12,
      };
    },
  },

  // 2. First Harvest
  {
    id: 'resource-first-harvest',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(1, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'First Harvest',
        description: 'Return 100 kg of water ice from the Moon to Earth. Prove that off-world resource extraction is viable.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-2-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach Earth orbit with cargo',
          },
          {
            id: 'obj-res-2-2',
            type: ObjectiveType.SAFE_LANDING,
            target: { maxLandingSpeed: 10, description: 'Return 100 kg water ice to Earth' },
            completed: false,
            description: 'Land safely with 100 kg water ice payload',
          },
        ],
        reward: 75_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 2,
        chainTotal: 12,
      };
    },
  },

  // 3. Expand Operations
  {
    id: 'resource-expand-ops',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(2, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Expand Operations',
        description: 'Add a storage silo and a second mining drill to your lunar mining site. Increase extraction throughput.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-3-1',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy Storage Silo to lunar site' },
            completed: false,
            description: 'Deploy Storage Silo to the lunar mining site',
          },
          {
            id: 'obj-res-3-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy second Mining Drill to lunar site' },
            completed: false,
            description: 'Deploy a second Mining Drill to the lunar mining site',
          },
        ],
        reward: 100_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 3,
        chainTotal: 12,
      };
    },
  },

  // 4. Power Up
  {
    id: 'resource-power-up',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(3, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Power Up',
        description: 'Deploy a solar power generator to your lunar mining site. Reliable power is essential for continuous operations.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-4-1',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy Power Generator to lunar site' },
            completed: false,
            description: 'Deploy Power Generator to the lunar mining site',
          },
        ],
        reward: 120_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 4,
        chainTotal: 12,
      };
    },
  },

  // 5. Refining Basics
  {
    id: 'resource-refining',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(4, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Refining Basics',
        description: 'Deploy a refinery module and produce hydrogen from water ice. In-situ resource utilisation turns raw materials into rocket fuel.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-5-1',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy Refinery to lunar site' },
            completed: false,
            description: 'Deploy Refinery to the lunar mining site',
          },
          {
            id: 'obj-res-5-2',
            type: ObjectiveType.SAFE_LANDING,
            target: { maxLandingSpeed: 10, description: 'Return hydrogen sample to Earth' },
            completed: false,
            description: 'Return a hydrogen sample to Earth',
          },
        ],
        reward: 150_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 5,
        chainTotal: 12,
      };
    },
  },

  // 6. Launch Capability
  {
    id: 'resource-launch-cap',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(5, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Launch Capability',
        description: 'Build a surface launch pad at your lunar mining site. Enable direct launches from the Moon to orbit.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-6-1',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy Surface Launch Pad to lunar site' },
            completed: false,
            description: 'Deploy Surface Launch Pad to the lunar mining site',
          },
        ],
        reward: 180_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 6,
        chainTotal: 12,
      };
    },
  },

  // 7. Orbital Storage
  {
    id: 'resource-orbital-storage',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(6, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Orbital Storage',
        description: 'Place a fuel depot in lunar orbit. Orbital fuel storage enables efficient transfer operations without returning to the surface.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-7-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach lunar orbit',
          },
          {
            id: 'obj-res-7-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy fuel depot in lunar orbit' },
            completed: false,
            description: 'Deploy fuel depot in lunar orbit',
          },
        ],
        reward: 220_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 7,
        chainTotal: 12,
      };
    },
  },

  // 8. Automate It — unlocks 'logistics-center'
  {
    id: 'resource-automate',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(7, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Automate It',
        description: 'Set up the first automated transport route between your lunar site and orbital depot. Completing this contract unlocks the Logistics Center facility.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-8-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Demonstrate automated launch-to-orbit route',
          },
          {
            id: 'obj-res-8-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deliver cargo to orbital depot via automated route' },
            completed: false,
            description: 'Deliver cargo to orbital depot via automated route',
          },
        ],
        reward: 280_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 8,
        chainTotal: 12,
      };
    },
  },

  // 9. Gas Mining
  {
    id: 'resource-gas-mining',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(8, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Gas Mining',
        description: 'Deploy a gas collector on Mars. The Martian atmosphere is rich in CO\u2082 — a key feedstock for methane fuel production.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-9-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit for Mars transfer',
          },
          {
            id: 'obj-res-9-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy Gas Collector on Mars' },
            completed: false,
            description: 'Deploy Gas Collector on the Martian surface',
          },
        ],
        reward: 350_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 9,
        chainTotal: 12,
      };
    },
  },

  // 10. Methane Production
  {
    id: 'resource-methane',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(9, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Methane Production',
        description: 'Produce methane from CO\u2082 and hydrogen via the Sabatier reaction. Deploy a refinery on Mars and return a methane sample.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-10-1',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy Mars Refinery' },
            completed: false,
            description: 'Deploy Refinery to the Martian site',
          },
          {
            id: 'obj-res-10-2',
            type: ObjectiveType.SAFE_LANDING,
            target: { maxLandingSpeed: 10, description: 'Return methane sample to Earth' },
            completed: false,
            description: 'Return a methane sample to Earth',
          },
        ],
        reward: 400_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 10,
        chainTotal: 12,
      };
    },
  },

  // 11. Asteroid Prospecting
  {
    id: 'resource-asteroid',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(10, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Asteroid Prospecting',
        description: 'Extract rare metals from Ceres. Asteroid mining opens access to materials unavailable on planetary surfaces.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-11-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit for Ceres transfer',
          },
          {
            id: 'obj-res-11-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Deploy mining rig on Ceres' },
            completed: false,
            description: 'Deploy mining rig on Ceres and extract rare metals',
          },
        ],
        reward: 480_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 11,
        chainTotal: 12,
      };
    },
  },

  // 12. Supply Network
  {
    id: 'resource-supply-network',
    category: ContractCategory.RESOURCE,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => _canGenerateResourceContract(11, state),
    generate(_state: GameState, _rand: number): GeneratedContract {
      return {
        title: 'Supply Network',
        description: 'Establish a supply network with 3 or more active automated transport routes running simultaneously. Full logistics mastery.',
        category: ContractCategory.RESOURCE,
        objectives: [
          {
            id: 'obj-res-12-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Demonstrate network with 3+ active routes',
          },
          {
            id: 'obj-res-12-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000, description: 'Verify 3+ simultaneous automated routes' },
            completed: false,
            description: 'Verify 3 or more simultaneous automated transport routes',
          },
        ],
        reward: 550_000,
        deadlineFlights: null,
        chainId: RESOURCE_CHAIN_ID,
        chainPart: 12,
        chainTotal: 12,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Contract Templates
// ---------------------------------------------------------------------------

/**
 * All contract generation templates.
 */
export const CONTRACT_TEMPLATES: ContractTemplate[] = [

  // ── Altitude Records ─────────────────────────────────────────────────────
  {
    id: 'altitude-push',
    category: ContractCategory.ALTITUDE_RECORD,
    minTier: 1,
    minMccTier: 1,
    canGenerate: () => true,
    generate(state: GameState, rand: number): GeneratedContract {
      const highest = getHighestAltitude(state);
      // Push 20-80% beyond current record
      const factor = 1.2 + rand * 0.6;
      const target = Math.round(highest * factor / 100) * 100; // round to nearest 100
      const reward = Math.round(target * 0.8 + 5_000);

      const bonusTarget = Math.round(target * 1.5 / 100) * 100;
      const bonusReward = Math.round(reward * CONTRACT_BONUS_REWARD_RATE);

      return {
        title: `Altitude Record: ${_fmtAlt(target)}`,
        description: `Push beyond current altitude records. Reach ${_fmtAlt(target)} to claim the bonus.`,
        category: ContractCategory.ALTITUDE_RECORD,
        objectives: [{
          id: 'obj-alt-1',
          type: ObjectiveType.REACH_ALTITUDE,
          target: { altitude: target },
          completed: false,
          description: `Reach ${_fmtAlt(target)} altitude`,
        }],
        bonusObjectives: [{
          id: 'obj-alt-bonus',
          type: ObjectiveType.REACH_ALTITUDE,
          target: { altitude: bonusTarget },
          completed: false,
          description: `Over-perform: reach ${_fmtAlt(bonusTarget)} (+${_fmtCash(bonusReward)} bonus)`,
          bonus: true,
        }],
        bonusReward,
        reward,
        deadlineFlights: null, // open-ended
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Speed Records ────────────────────────────────────────────────────────
  {
    id: 'speed-push',
    category: ContractCategory.SPEED_RECORD,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state: GameState, rand: number): GeneratedContract {
      const tier = getProgressionTier(state);
      const baseSpeed = [100, 200, 500, 1000, 3000, 7000][Math.min(tier, 5)];
      const target = Math.round(baseSpeed * (1.0 + rand * 0.5));
      const reward = Math.round(target * 15 + 10_000);

      const bonusSpeed = Math.round(target * 1.3);
      const bonusReward = Math.round(reward * CONTRACT_BONUS_REWARD_RATE);

      return {
        title: `Speed Trial: ${target} m/s`,
        description: `Demonstrate high-velocity flight. Achieve a speed of ${target} m/s during any phase of flight.`,
        category: ContractCategory.SPEED_RECORD,
        objectives: [{
          id: 'obj-spd-1',
          type: ObjectiveType.REACH_SPEED,
          target: { speed: target },
          completed: false,
          description: `Reach ${target} m/s`,
        }],
        bonusObjectives: [{
          id: 'obj-spd-bonus',
          type: ObjectiveType.REACH_SPEED,
          target: { speed: bonusSpeed },
          completed: false,
          description: `Over-perform: reach ${bonusSpeed} m/s (+${_fmtCash(bonusReward)} bonus)`,
          bonus: true,
        }],
        bonusReward,
        reward,
        deadlineFlights: 6 + Math.floor(rand * 4),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Safe Recovery ────────────────────────────────────────────────────────
  {
    id: 'safe-recovery',
    category: ContractCategory.SAFE_RECOVERY,
    minTier: 1,
    minMccTier: 1,
    canGenerate: () => true,
    generate(state: GameState, rand: number): GeneratedContract {
      const tier = getProgressionTier(state);
      const maxSpeeds = [10, 8, 6, 5, 4, 3];
      const maxSpeed = maxSpeeds[Math.min(tier, 5)];
      const reward = Math.round(20_000 + (10 - maxSpeed) * 5_000 + rand * 10_000);

      const bonusMaxSpeed = Math.max(1, maxSpeed - 2);
      const bonusReward = Math.round(reward * CONTRACT_BONUS_REWARD_RATE);

      return {
        title: `Safe Recovery: ${maxSpeed} m/s`,
        description: `Demonstrate precision landing capability. Land at ${maxSpeed} m/s or less to recover the vehicle intact.`,
        category: ContractCategory.SAFE_RECOVERY,
        objectives: [{
          id: 'obj-safe-1',
          type: ObjectiveType.SAFE_LANDING,
          target: { maxLandingSpeed: maxSpeed },
          completed: false,
          description: `Land at ${maxSpeed} m/s or less`,
        }],
        bonusObjectives: [{
          id: 'obj-safe-bonus',
          type: ObjectiveType.SAFE_LANDING,
          target: { maxLandingSpeed: bonusMaxSpeed },
          completed: false,
          description: `Over-perform: land at ${bonusMaxSpeed} m/s or less (+${_fmtCash(bonusReward)} bonus)`,
          bonus: true,
        }],
        bonusReward,
        reward,
        deadlineFlights: null, // open-ended
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
      };
    },
  },

  // ── Science Survey ───────────────────────────────────────────────────────
  {
    id: 'science-survey',
    category: ContractCategory.SCIENCE_SURVEY,
    minTier: 2,
    minMccTier: 2,
    canGenerate: (state: GameState) => hasScienceCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const highest = getHighestAltitude(state);
      const minAlt = Math.round((200 + rand * highest * 0.6) / 100) * 100;
      const maxAlt = minAlt + Math.round((200 + rand * 400) / 100) * 100;
      const duration = 20 + Math.floor(rand * 30);
      const reward = Math.round(40_000 + minAlt * 0.5 + duration * 500);

      return {
        title: `Science Survey: ${_fmtAlt(minAlt)}-${_fmtAlt(maxAlt)}`,
        description: `Conduct a science experiment between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for ${duration} seconds, then return the data safely.`,
        category: ContractCategory.SCIENCE_SURVEY,
        objectives: [
          {
            id: 'obj-sci-1',
            type: ObjectiveType.HOLD_ALTITUDE,
            target: { minAltitude: minAlt, maxAltitude: maxAlt, duration },
            completed: false,
            description: `Hold altitude between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for ${duration}s`,
          },
          {
            id: 'obj-sci-2',
            type: ObjectiveType.RETURN_SCIENCE_DATA,
            target: {},
            completed: false,
            description: 'Activate Science Module and return data via safe landing',
          },
        ],
        reward,
        deadlineFlights: 5 + Math.floor(rand * 5),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Science Survey Chain (3-part) ────────────────────────────────────────
  {
    id: 'science-chain',
    category: ContractCategory.SCIENCE_SURVEY,
    minTier: 3,
    minMccTier: 3,
    canGenerate: (state: GameState) => hasScienceCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const chainId = `chain-sci-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Part 1 of 3 — low altitude survey
      const minAlt = 400 + Math.floor(rand * 600);
      const maxAlt = minAlt + 400;
      const reward = Math.round(30_000 + rand * 15_000);

      return {
        title: `Atmospheric Survey I: ${_fmtAlt(minAlt)}`,
        description: `Part 1 of 3: Conduct a low-altitude science survey between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for 20 seconds. Completing this unlocks the next part of the survey chain.`,
        category: ContractCategory.SCIENCE_SURVEY,
        objectives: [
          {
            id: 'obj-chain-1',
            type: ObjectiveType.HOLD_ALTITUDE,
            target: { minAltitude: minAlt, maxAltitude: maxAlt, duration: 20 },
            completed: false,
            description: `Hold between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for 20s`,
          },
          {
            id: 'obj-chain-2',
            type: ObjectiveType.RETURN_SCIENCE_DATA,
            target: {},
            completed: false,
            description: 'Return science data safely',
          },
        ],
        reward,
        deadlineFlights: 6,
        chainId,
        chainPart: 1,
        chainTotal: 3,
      };
    },
  },

  // ── Satellite Deployment ─────────────────────────────────────────────────
  {
    id: 'satellite-deploy',
    category: ContractCategory.SATELLITE_DEPLOY,
    minTier: 3,
    minMccTier: 3,
    canGenerate: (state: GameState) => hasSatelliteCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const highest = getHighestAltitude(state);
      const minAlt = Math.round(Math.max(5_000, highest * (0.3 + rand * 0.5)) / 1000) * 1000;
      const reward = Math.round(80_000 + minAlt * 1.5);

      return {
        title: `Satellite Delivery: ${_fmtAlt(minAlt)}`,
        description: `Deploy a satellite payload above ${_fmtAlt(minAlt)}. Landing is not required — this is a one-way delivery mission.`,
        category: ContractCategory.SATELLITE_DEPLOY,
        objectives: [{
          id: 'obj-sat-1',
          type: ObjectiveType.RELEASE_SATELLITE,
          target: { minAltitude: minAlt },
          completed: false,
          description: `Release satellite above ${_fmtAlt(minAlt)}`,
        }],
        reward,
        deadlineFlights: 8 + Math.floor(rand * 4),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Crash Test ───────────────────────────────────────────────────────────
  {
    id: 'crash-test',
    category: ContractCategory.CRASH_TEST,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state: GameState, rand: number): GeneratedContract {
      const tier = getProgressionTier(state);
      const minSpeed = 30 + Math.floor(tier * 20 + rand * 30);
      const reward = Math.round(25_000 + minSpeed * 300);

      return {
        title: `Impact Test: ${minSpeed} m/s`,
        description: `Structural engineering needs crash data. Impact the ground at ${minSpeed} m/s or faster. No recovery expected.`,
        category: ContractCategory.CRASH_TEST,
        objectives: [{
          id: 'obj-crash-1',
          type: ObjectiveType.CONTROLLED_CRASH,
          target: { minCrashSpeed: minSpeed },
          completed: false,
          description: `Impact at ${minSpeed} m/s or faster`,
        }],
        reward,
        deadlineFlights: null, // open-ended
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
      };
    },
  },

  // ── Orbital Mission ──────────────────────────────────────────────────────
  {
    id: 'orbital-mission',
    category: ContractCategory.ORBITAL,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => hasOrbitalCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const reward = Math.round(200_000 + rand * 300_000);

      return {
        title: 'Orbital Insertion',
        description: 'Reach Low Earth Orbit and maintain orbital velocity. A routine contract for an established space agency.',
        category: ContractCategory.ORBITAL,
        objectives: [{
          id: 'obj-orb-1',
          type: ObjectiveType.REACH_ORBIT,
          target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
          completed: false,
          description: 'Reach orbit (>80 km at >=7,800 m/s)',
        }],
        reward,
        deadlineFlights: 10 + Math.floor(rand * 5),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Orbital Satellite Deployment ─────────────────────────────────────────
  {
    id: 'orbital-satellite',
    category: ContractCategory.SATELLITE_DEPLOY,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => hasOrbitalCapability(state) && hasSatelliteCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const reward = Math.round(350_000 + rand * 200_000);

      return {
        title: 'Orbital Satellite Deployment',
        description: 'Reach orbit and deploy a satellite payload. The backbone of commercial space operations.',
        category: ContractCategory.SATELLITE_DEPLOY,
        objectives: [
          {
            id: 'obj-osat-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit (>80 km at >=7,800 m/s)',
          },
          {
            id: 'obj-osat-2',
            type: ObjectiveType.RELEASE_SATELLITE,
            target: { minAltitude: 80_000 },
            completed: false,
            description: 'Release satellite above 80 km while in orbit',
          },
        ],
        reward,
        deadlineFlights: 12,
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Budget Challenge ───────────────────────────────────────────────────
  {
    id: 'budget-challenge',
    category: ContractCategory.ALTITUDE_RECORD,
    minTier: 1,
    minMccTier: 1,
    canGenerate: () => true,
    generate(state: GameState, rand: number): GeneratedContract {
      const highest = getHighestAltitude(state);
      const target = Math.round(highest * (0.6 + rand * 0.4) / 100) * 100;
      const maxCost = Math.round((30_000 + target * 3) * (0.7 + rand * 0.3));
      const reward = Math.round(target * 1.2 + 15_000);

      return {
        title: `Budget Launch: ${_fmtAlt(target)}`,
        description: `Reach ${_fmtAlt(target)} with a rocket costing no more than ${_fmtCash(maxCost)}. Prove that frugal engineering can reach the sky.`,
        category: ContractCategory.ALTITUDE_RECORD,
        objectives: [
          {
            id: 'obj-budg-1',
            type: ObjectiveType.REACH_ALTITUDE,
            target: { altitude: target },
            completed: false,
            description: `Reach ${_fmtAlt(target)} altitude`,
          },
          {
            id: 'obj-budg-2',
            type: ObjectiveType.BUDGET_LIMIT,
            target: { maxCost },
            completed: false,
            description: `Rocket cost must not exceed ${_fmtCash(maxCost)}`,
          },
        ],
        reward,
        deadlineFlights: null,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.BUDGET],
      };
    },
  },

  // ── Minimalist Challenge ───────────────────────────────────────────────
  {
    id: 'minimalist',
    category: ContractCategory.ALTITUDE_RECORD,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state: GameState, rand: number): GeneratedContract {
      const tier = getProgressionTier(state);
      const maxParts = 3 + Math.floor(rand * 2); // 3-4 parts
      const altTarget = Math.round((300 + tier * 200 + rand * 500) / 100) * 100;
      const reward = Math.round(25_000 + altTarget * 0.8 + (6 - maxParts) * 10_000);

      return {
        title: `Minimalist: ${maxParts} Parts`,
        description: `Reach ${_fmtAlt(altTarget)} using no more than ${maxParts} parts. Sometimes less is more.`,
        category: ContractCategory.ALTITUDE_RECORD,
        objectives: [
          {
            id: 'obj-min-1',
            type: ObjectiveType.REACH_ALTITUDE,
            target: { altitude: altTarget },
            completed: false,
            description: `Reach ${_fmtAlt(altTarget)} altitude`,
          },
          {
            id: 'obj-min-2',
            type: ObjectiveType.MAX_PARTS,
            target: { maxParts },
            completed: false,
            description: `Use ${maxParts} or fewer parts`,
          },
        ],
        reward,
        deadlineFlights: null,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.MINIMALIST],
      };
    },
  },

  // ── No-Parachute Recovery ──────────────────────────────────────────────
  {
    id: 'no-chute-recovery',
    category: ContractCategory.SAFE_RECOVERY,
    minTier: 2,
    minMccTier: 2,
    canGenerate: () => true,
    generate(state: GameState, rand: number): GeneratedContract {
      const tier = getProgressionTier(state);
      const maxSpeed = 8 + Math.floor((5 - Math.min(tier, 4)) * 1.5);
      const altTarget = Math.round((200 + tier * 150 + rand * 300) / 100) * 100;
      const reward = Math.round(40_000 + altTarget * 0.5 + rand * 15_000);

      return {
        title: `Unpowered Recovery: ${_fmtAlt(altTarget)}`,
        description: `Reach ${_fmtAlt(altTarget)} and land safely at ${maxSpeed} m/s — without using any parachutes. Engine braking or creative solutions only.`,
        category: ContractCategory.SAFE_RECOVERY,
        objectives: [
          {
            id: 'obj-nochute-1',
            type: ObjectiveType.REACH_ALTITUDE,
            target: { altitude: altTarget },
            completed: false,
            description: `Reach ${_fmtAlt(altTarget)} altitude`,
          },
          {
            id: 'obj-nochute-2',
            type: ObjectiveType.SAFE_LANDING,
            target: { maxLandingSpeed: maxSpeed },
            completed: false,
            description: `Land at ${maxSpeed} m/s or less`,
          },
          {
            id: 'obj-nochute-3',
            type: ObjectiveType.RESTRICT_PART,
            target: { forbiddenType: PartType.PARACHUTE },
            completed: false,
            description: 'No parachutes allowed',
          },
        ],
        reward,
        deadlineFlights: null,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.DESTRUCTIVE],
      };
    },
  },

  // ── Multi-Satellite Deployment ─────────────────────────────────────────
  {
    id: 'multi-satellite',
    category: ContractCategory.SATELLITE_DEPLOY,
    minTier: 4,
    minMccTier: 3,
    canGenerate: (state: GameState) => hasSatelliteCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const count = 2 + Math.floor(rand * 2); // 2-3 satellites
      const highest = getHighestAltitude(state);
      const minAlt = Math.round(Math.max(3_000, highest * (0.2 + rand * 0.3)) / 1000) * 1000;
      const reward = Math.round(100_000 * count + minAlt * 0.8);

      return {
        title: `Constellation: ${count} Satellites`,
        description: `Deploy ${count} satellites above ${_fmtAlt(minAlt)} in a single flight. Landing is not required — this is a deployment mission.`,
        category: ContractCategory.SATELLITE_DEPLOY,
        objectives: [{
          id: 'obj-msat-1',
          type: ObjectiveType.MULTI_SATELLITE,
          target: { count, minAltitude: minAlt },
          completed: false,
          description: `Deploy ${count} satellites above ${_fmtAlt(minAlt)}`,
        }],
        reward,
        deadlineFlights: 10 + Math.floor(rand * 5),
        chainId: null,
        chainPart: null,
        chainTotal: null,
      };
    },
  },

  // ── Crewed Orbital Mission ─────────────────────────────────────────────
  {
    id: 'crewed-orbital',
    category: ContractCategory.ORBITAL,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => hasOrbitalCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const minCrew = 1 + Math.floor(rand * 2); // 1-2 crew
      const reward = Math.round(250_000 + minCrew * 100_000 + rand * 150_000);

      return {
        title: `Crewed Orbit: ${minCrew} Astronaut${minCrew > 1 ? 's' : ''}`,
        description: `Send ${minCrew} crew member${minCrew > 1 ? 's' : ''} to orbit. Human spaceflight is the ultimate achievement.`,
        category: ContractCategory.ORBITAL,
        objectives: [
          {
            id: 'obj-crew-orb-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit (>80 km at >=7,800 m/s)',
          },
          {
            id: 'obj-crew-orb-2',
            type: ObjectiveType.MINIMUM_CREW,
            target: { minCrew },
            completed: false,
            description: `Fly with ${minCrew} or more crew member${minCrew > 1 ? 's' : ''}`,
          },
        ],
        reward,
        deadlineFlights: 12 + Math.floor(rand * 4),
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.CREW_HEAVY],
      };
    },
  },

  // ── Budget Orbital ─────────────────────────────────────────────────────
  {
    id: 'budget-orbital',
    category: ContractCategory.ORBITAL,
    minTier: 5,
    minMccTier: 3,
    canGenerate: (state: GameState) => hasOrbitalCapability(state),
    generate(state: GameState, rand: number): GeneratedContract {
      const maxCost = Math.round(300_000 + rand * 200_000);
      const reward = Math.round(350_000 + rand * 200_000);

      return {
        title: `Budget Orbit: ${_fmtCash(maxCost)}`,
        description: `Achieve orbit with a rocket costing no more than ${_fmtCash(maxCost)}. Cost-efficient access to space is the future.`,
        category: ContractCategory.ORBITAL,
        objectives: [
          {
            id: 'obj-borb-1',
            type: ObjectiveType.REACH_ORBIT,
            target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
            completed: false,
            description: 'Reach orbit (>80 km at >=7,800 m/s)',
          },
          {
            id: 'obj-borb-2',
            type: ObjectiveType.BUDGET_LIMIT,
            target: { maxCost },
            completed: false,
            description: `Rocket cost must not exceed ${_fmtCash(maxCost)}`,
          },
        ],
        reward,
        deadlineFlights: 15,
        chainId: null,
        chainPart: null,
        chainTotal: null,
        conflictTags: [CONTRACT_CONFLICT_TAGS.BUDGET],
      };
    },
  },
];

// Add resource contracts to the main templates array.
CONTRACT_TEMPLATES.push(...RESOURCE_CONTRACTS);

/**
 * Contract templates indexed by ID for O(1) lookups.
 * Built once at module load time from the CONTRACT_TEMPLATES array.
 */
export const CONTRACT_TEMPLATES_BY_ID: Map<string, ContractTemplate> = new Map(CONTRACT_TEMPLATES.map((t) => [t.id, t]));

// ---------------------------------------------------------------------------
// Chain continuation templates
// ---------------------------------------------------------------------------

/**
 * Generates the next part of a science survey chain contract.
 */
export function generateChainContinuation(chainId: string, partNumber: number, rand: number): GeneratedContract {
  const altMultiplier = partNumber === 2 ? 3 : 8;
  const minAlt = Math.round((500 * altMultiplier + rand * 2000) / 100) * 100;
  const maxAlt = minAlt + 600;
  const duration = 20 + (partNumber - 1) * 10;
  const reward = Math.round(40_000 * partNumber + rand * 20_000);

  const isLast = partNumber === 3;
  const desc = isLast
    ? `Part 3 of 3 (Final): High-altitude survey between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)}. Complete all three surveys for maximum payout.`
    : `Part ${partNumber} of 3: Mid-altitude survey between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)}.`;

  return {
    title: `Atmospheric Survey ${partNumber === 2 ? 'II' : 'III'}: ${_fmtAlt(minAlt)}`,
    description: desc,
    category: ContractCategory.SCIENCE_SURVEY,
    objectives: [
      {
        id: `obj-chain-${partNumber}-1`,
        type: ObjectiveType.HOLD_ALTITUDE,
        target: { minAltitude: minAlt, maxAltitude: maxAlt, duration },
        completed: false,
        description: `Hold between ${_fmtAlt(minAlt)} and ${_fmtAlt(maxAlt)} for ${duration}s`,
      },
      {
        id: `obj-chain-${partNumber}-2`,
        type: ObjectiveType.RETURN_SCIENCE_DATA,
        target: {},
        completed: false,
        description: 'Return science data safely',
      },
    ],
    reward,
    deadlineFlights: 6,
    chainId,
    chainPart: partNumber,
    chainTotal: 3,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format altitude for display.
 */
function _fmtAlt(alt: number): string {
  if (alt >= 1000) {
    return `${(alt / 1000).toFixed(alt % 1000 === 0 ? 0 : 1)} km`;
  }
  return `${alt} m`;
}

/**
 * Format a cash amount as a dollar string.
 */
function _fmtCash(amount: number): string {
  return '$' + amount.toLocaleString();
}
