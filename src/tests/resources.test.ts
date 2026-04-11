import { describe, it, expect } from 'vitest';
import { ResourceType, ResourceState, MiningModuleType, FacilityId, FACILITY_DEFINITIONS } from '../core/constants.ts';

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
