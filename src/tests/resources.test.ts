import { describe, it, expect } from 'vitest';
import { ResourceType, ResourceState, MiningModuleType, FacilityId, FACILITY_DEFINITIONS, PartType, MissionState, ContractCategory } from '../core/constants.ts';
import { PARTS } from '../data/parts.ts';
import { RESOURCES, RESOURCES_BY_ID } from '../data/resources.ts';
import type { ResourceDef } from '../data/resources.ts';
import { CELESTIAL_BODIES } from '../data/bodies.ts';
import { RESOURCE_CONTRACTS } from '../data/contracts.ts';
import { TechBranch, BRANCH_NAMES, TECH_NODES } from '../data/techtree.ts';
import { createGameState } from '../core/gameState.ts';
import type { Contract, Mission } from '../core/gameState.ts';

describe('ResourceType enum', () => {
  it('has all 10 resource values', () => {
    expect(ResourceType.WATER_ICE).toBe('WATER_ICE');
    expect(ResourceType.REGOLITH).toBe('REGOLITH');
    expect(ResourceType.IRON_ORE).toBe('IRON_ORE');
    expect(ResourceType.RARE_METALS).toBe('RARE_METALS');
    expect(ResourceType.CO2).toBe('CO2');
    expect(ResourceType.HYDROGEN).toBe('HYDROGEN');
    expect(ResourceType.OXYGEN).toBe('OXYGEN');
    expect(ResourceType.HELIUM_3).toBe('HELIUM_3');
    expect(ResourceType.LIQUID_METHANE).toBe('LIQUID_METHANE');
    expect(ResourceType.HYDRAZINE).toBe('HYDRAZINE');
  });

  it('has exactly 10 values', () => {
    expect(Object.keys(ResourceType)).toHaveLength(10);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ResourceType)).toBe(true);
  });
});

describe('ResourceState enum', () => {
  it('has all 3 state values', () => {
    expect(ResourceState.SOLID).toBe('SOLID');
    expect(ResourceState.LIQUID).toBe('LIQUID');
    expect(ResourceState.GAS).toBe('GAS');
  });

  it('has exactly 3 values', () => {
    expect(Object.keys(ResourceState)).toHaveLength(3);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ResourceState)).toBe(true);
  });
});

describe('MiningModuleType enum', () => {
  it('has all 10 module type values', () => {
    expect(MiningModuleType.BASE_CONTROL_UNIT).toBe('BASE_CONTROL_UNIT');
    expect(MiningModuleType.MINING_DRILL).toBe('MINING_DRILL');
    expect(MiningModuleType.GAS_COLLECTOR).toBe('GAS_COLLECTOR');
    expect(MiningModuleType.FLUID_EXTRACTOR).toBe('FLUID_EXTRACTOR');
    expect(MiningModuleType.REFINERY).toBe('REFINERY');
    expect(MiningModuleType.STORAGE_SILO).toBe('STORAGE_SILO');
    expect(MiningModuleType.PRESSURE_VESSEL).toBe('PRESSURE_VESSEL');
    expect(MiningModuleType.FLUID_TANK).toBe('FLUID_TANK');
    expect(MiningModuleType.SURFACE_LAUNCH_PAD).toBe('SURFACE_LAUNCH_PAD');
    expect(MiningModuleType.POWER_GENERATOR).toBe('POWER_GENERATOR');
  });

  it('has exactly 10 values', () => {
    expect(Object.keys(MiningModuleType)).toHaveLength(10);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(MiningModuleType)).toBe(true);
  });
});

describe('Logistics Center facility', () => {
  it('FacilityId.LOGISTICS_CENTER equals logistics-center', () => {
    expect(FacilityId.LOGISTICS_CENTER).toBe('logistics-center');
  });

  it('FACILITY_DEFINITIONS contains a Logistics Center entry', () => {
    const entry = FACILITY_DEFINITIONS.find(f => f.id === FacilityId.LOGISTICS_CENTER);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Logistics Center');
  });
});

// ---------------------------------------------------------------------------
// Resource Catalog Tests
// ---------------------------------------------------------------------------

describe('Resource catalog', () => {
  it('has exactly 10 resources', () => {
    expect(RESOURCES).toHaveLength(10);
  });

  it('every resource has required fields', () => {
    for (const r of RESOURCES) {
      expect(r.id).toBeTypeOf('string');
      expect(r.name).toBeTypeOf('string');
      expect(r.description).toBeTypeOf('string');
      expect(r.state).toBeTypeOf('string');
      expect(r.massDensity).toBeTypeOf('number');
      expect(r.massDensity).toBeGreaterThan(0);
      expect(r.baseValuePerKg).toBeTypeOf('number');
      expect(r.baseValuePerKg).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(r.sources)).toBe(true);
      expect(r.extractionModule).toBeTypeOf('string');
    }
  });

  it('RESOURCES_BY_ID has all 10 entries', () => {
    expect(Object.keys(RESOURCES_BY_ID)).toHaveLength(10);
    for (const r of RESOURCES) {
      expect(RESOURCES_BY_ID[r.id]).toBe(r);
    }
  });

  it('solid resources use MINING_DRILL extraction', () => {
    const solids = RESOURCES.filter(r => r.state === ResourceState.SOLID);
    expect(solids.length).toBeGreaterThan(0);
    for (const r of solids) {
      expect(r.extractionModule).toBe(MiningModuleType.MINING_DRILL);
    }
  });

  it('gas resources use GAS_COLLECTOR extraction', () => {
    const gases = RESOURCES.filter(r => r.state === ResourceState.GAS);
    expect(gases.length).toBeGreaterThan(0);
    for (const r of gases) {
      expect(r.extractionModule).toBe(MiningModuleType.GAS_COLLECTOR);
    }
  });

  it('liquid resources use FLUID_EXTRACTOR extraction', () => {
    const liquids = RESOURCES.filter(r => r.state === ResourceState.LIQUID);
    expect(liquids.length).toBeGreaterThan(0);
    for (const r of liquids) {
      expect(r.extractionModule).toBe(MiningModuleType.FLUID_EXTRACTOR);
    }
  });

  it('RESOURCES array is frozen', () => {
    expect(Object.isFrozen(RESOURCES)).toBe(true);
  });

  it('RESOURCES_BY_ID is frozen', () => {
    expect(Object.isFrozen(RESOURCES_BY_ID)).toBe(true);
  });
});

describe('Body resource profiles', () => {
  it('Moon has water ice and helium-3 in its profile', () => {
    const moon = CELESTIAL_BODIES['MOON'];
    expect(moon.resourceProfile).toBeDefined();
    const types = moon.resourceProfile!.map(r => r.resourceType);
    expect(types).toContain(ResourceType.WATER_ICE);
    expect(types).toContain(ResourceType.HELIUM_3);
  });

  it('Mars has CO2 and water ice in its profile', () => {
    const mars = CELESTIAL_BODIES['MARS'];
    expect(mars.resourceProfile).toBeDefined();
    const types = mars.resourceProfile!.map(r => r.resourceType);
    expect(types).toContain(ResourceType.CO2);
    expect(types).toContain(ResourceType.WATER_ICE);
  });

  it('all profile entries have positive extraction rates', () => {
    for (const [id, body] of Object.entries(CELESTIAL_BODIES)) {
      if (body.resourceProfile) {
        for (const entry of body.resourceProfile) {
          expect(entry.extractionRateKgPerPeriod).toBeGreaterThan(0);
          expect(entry.abundance).toBeGreaterThan(0);
        }
      }
    }
  });

  it('Earth has no resource profile', () => {
    const earth = CELESTIAL_BODIES['EARTH'];
    expect(earth.resourceProfile).toBeUndefined();
  });
});

describe('Cargo module parts', () => {
  it('PartType has CARGO_BAY, PRESSURIZED_TANK, and CRYO_TANK', () => {
    expect(PartType.CARGO_BAY).toBe('CARGO_BAY');
    expect(PartType.PRESSURIZED_TANK).toBe('PRESSURIZED_TANK');
    expect(PartType.CRYO_TANK).toBe('CRYO_TANK');
  });

  it('PARTS catalog contains cargo-bay-mk1 with SOLID cargo state', () => {
    const part = PARTS.find(p => p.id === 'cargo-bay-mk1');
    expect(part).toBeDefined();
    expect(part!.type).toBe(PartType.CARGO_BAY);
    expect(part!.properties.cargoCapacityKg).toBe(500);
    expect(part!.properties.cargoState).toBe('SOLID');
  });

  it('PARTS catalog contains pressurized-tank-mk1 with GAS cargo state', () => {
    const part = PARTS.find(p => p.id === 'pressurized-tank-mk1');
    expect(part).toBeDefined();
    expect(part!.type).toBe(PartType.PRESSURIZED_TANK);
    expect(part!.properties.cargoCapacityKg).toBe(300);
    expect(part!.properties.cargoState).toBe('GAS');
  });

  it('PARTS catalog contains cryo-tank-mk1 with LIQUID cargo state', () => {
    const part = PARTS.find(p => p.id === 'cryo-tank-mk1');
    expect(part).toBeDefined();
    expect(part!.type).toBe(PartType.CRYO_TANK);
    expect(part!.properties.cargoCapacityKg).toBe(400);
    expect(part!.properties.cargoState).toBe('LIQUID');
  });
});

describe('Mining module parts', () => {
  it('PartType has MINING_MODULE', () => {
    expect(PartType.MINING_MODULE).toBe('MINING_MODULE');
  });

  it('PARTS catalog contains all 10 mining modules', () => {
    const miningParts = PARTS.filter(p => p.type === PartType.MINING_MODULE);
    expect(miningParts).toHaveLength(10);
  });

  it('each mining module has a valid miningModuleType property', () => {
    const miningParts = PARTS.filter(p => p.type === PartType.MINING_MODULE);
    const validTypes = Object.values(MiningModuleType);
    for (const part of miningParts) {
      expect(validTypes).toContain(part.properties.miningModuleType);
    }
  });

  it('base-control-unit-mk1 exists with correct type', () => {
    const bcu = PARTS.find(p => p.id === 'base-control-unit-mk1');
    expect(bcu).toBeDefined();
    expect(bcu!.properties.miningModuleType).toBe(MiningModuleType.BASE_CONTROL_UNIT);
  });

  it('power-generator-solar-mk1 has powerOutput and zero powerDraw', () => {
    const gen = PARTS.find(p => p.id === 'power-generator-solar-mk1');
    expect(gen).toBeDefined();
    expect(gen!.properties.powerDraw).toBe(0);
    expect(gen!.properties.powerOutput).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Resource Contract Chain Tests
// ---------------------------------------------------------------------------

describe('Resource contract chain', () => {
  /** Create a stub completed mission for padding the completed list. */
  function stubMission(index: number): Mission {
    return {
      id: `mission-${index}`, title: `M${index}`, description: '', reward: 0,
      deadline: '', state: MissionState.COMPLETED, requirements: {},
      acceptedDate: null, completedDate: null,
    };
  }

  /** Create a stub completed contract with the resource chain fields. */
  function stubChainContract(part: number): Contract {
    return {
      id: `resource-contract-${part}`, title: '', description: '',
      category: ContractCategory.RESOURCE, objectives: [], reward: 0,
      penaltyFee: 0, reputationReward: 0, reputationPenalty: 0,
      deadlinePeriod: null, boardExpiryPeriod: 0, generatedPeriod: 0,
      acceptedPeriod: null, chainId: 'resource-chain', chainPart: part,
      chainTotal: 12,
    };
  }

  /** Create a game state with tutorials completed. */
  function stateWithTutorials() {
    const state = createGameState();
    state.missions.completed = Array.from({ length: 15 }, (_, i) => stubMission(i));
    state.contracts = { board: [], active: [], completed: [], failed: [] };
    return state;
  }

  it('RESOURCE_CONTRACTS has 12 templates', () => {
    expect(RESOURCE_CONTRACTS).toHaveLength(12);
  });

  it('first contract requires tutorials complete', () => {
    const state = createGameState();
    expect(RESOURCE_CONTRACTS[0].canGenerate(state)).toBe(false);
  });

  it('first contract is available when tutorials are done', () => {
    const state = stateWithTutorials();
    expect(RESOURCE_CONTRACTS[0].canGenerate(state)).toBe(true);
  });

  it('contracts are sequential — each requires previous completion', () => {
    const state = stateWithTutorials();

    // Contract 1 should be available (tutorials done, no previous required)
    expect(RESOURCE_CONTRACTS[0].canGenerate(state)).toBe(true);
    // Contract 2 should not (contract 1 not completed yet)
    expect(RESOURCE_CONTRACTS[1].canGenerate(state)).toBe(false);
  });

  it('contract 2 becomes available after contract 1 is completed', () => {
    const state = stateWithTutorials();
    state.contracts.completed.push(stubChainContract(1));
    expect(RESOURCE_CONTRACTS[1].canGenerate(state)).toBe(true);
  });

  it('contract 8 unlocks logistics-center', () => {
    const state = stateWithTutorials();
    // Simulate previous 7 contracts completed
    for (let i = 1; i <= 7; i++) {
      state.contracts.completed.push(stubChainContract(i));
    }

    const generated = RESOURCE_CONTRACTS[7].generate(state, 0.5);
    expect(generated.title).toContain('Automate');
    expect(generated.description).toContain('Logistics Center');
  });

  it('all 12 contracts have unique IDs', () => {
    const ids = RESOURCE_CONTRACTS.map(c => c.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('all contracts use RESOURCE category', () => {
    for (const template of RESOURCE_CONTRACTS) {
      expect(template.category).toBe('RESOURCE');
    }
  });

  it('rewards increase through the chain', () => {
    const state = stateWithTutorials();

    let prevReward = 0;
    for (let i = 0; i < 12; i++) {
      // Add previous chain completion for contracts after the first
      if (i > 0) {
        state.contracts.completed.push(stubChainContract(i));
      }
      const generated = RESOURCE_CONTRACTS[i].generate(state, 0.5);
      expect(generated.reward).toBeGreaterThan(prevReward);
      prevReward = generated.reward;
    }
  });

  it('each generated contract has correct chainId and chainPart', () => {
    const state = stateWithTutorials();

    for (let i = 0; i < 12; i++) {
      if (i > 0) {
        state.contracts.completed.push(stubChainContract(i));
      }
      const generated = RESOURCE_CONTRACTS[i].generate(state, 0.5);
      expect(generated.chainId).toBe('resource-chain');
      expect(generated.chainPart).toBe(i + 1);
      expect(generated.chainTotal).toBe(12);
    }
  });
});

describe('Logistics tech tree branch', () => {
  it('TechBranch has LOGISTICS value', () => {
    expect(TechBranch.LOGISTICS).toBe('logistics');
  });

  it('BRANCH_NAMES includes Logistics', () => {
    expect(BRANCH_NAMES[TechBranch.LOGISTICS]).toBe('Logistics');
  });

  it('TECH_NODES has 5 Logistics-branch nodes', () => {
    const logNodes = TECH_NODES.filter(n => n.branch === TechBranch.LOGISTICS);
    expect(logNodes).toHaveLength(5);
  });

  it('Logistics nodes have tiers 1-5', () => {
    const logNodes = TECH_NODES.filter(n => n.branch === TechBranch.LOGISTICS);
    const tiers = logNodes.map(n => n.tier).sort();
    expect(tiers).toEqual([1, 2, 3, 4, 5]);
  });

  it('tier 1 unlocks basic mining parts', () => {
    const t1 = TECH_NODES.find(n => n.branch === TechBranch.LOGISTICS && n.tier === 1);
    expect(t1).toBeDefined();
    expect(t1!.unlocksParts).toContain('mining-drill-mk1');
    expect(t1!.unlocksParts).toContain('base-control-unit-mk1');
    expect(t1!.unlocksParts).toContain('storage-silo-mk1');
    expect(t1!.unlocksParts).toContain('power-generator-solar-mk1');
  });
});
