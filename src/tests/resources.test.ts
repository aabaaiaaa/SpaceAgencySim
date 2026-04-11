import { describe, it, expect } from 'vitest';
import { ResourceType, ResourceState, MiningModuleType, FacilityId, FACILITY_DEFINITIONS, PartType } from '../core/constants.ts';
import { PARTS } from '../data/parts.ts';
import { RESOURCES, RESOURCES_BY_ID } from '../data/resources.ts';
import type { ResourceDef } from '../data/resources.ts';
import { CELESTIAL_BODIES } from '../data/bodies.ts';

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
