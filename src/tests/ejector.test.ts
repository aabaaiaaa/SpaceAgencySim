/**
 * ejector.test.js — Unit tests for the ejector seat system (TASK-026).
 *
 * Tests cover:
 *   initEjectorStates()               — initialises ARMED state for crewed command modules
 *   activateEjectorSeat()             — transitions to ACTIVATED, emits CREW_EJECTED event,
 *                                       records ejected crew, idempotent
 *   getEjectorSeatStatus()            — returns correct state
 *   getEjectorSeatContextMenuItems()  — returns items only for crewed modules
 *   resolveCrewCasualties()           — KIA on crash without ejection
 *                                       KIA on heat-destroyed module without ejection
 *                                       no KIA when ejected before crash
 *                                       applies $500k fine per KIA astronaut
 */

import { describe, it, expect } from 'vitest';
import {
  EjectorState,
  initEjectorStates,
  activateEjectorSeat,
  getEjectorSeatStatus,
  getEjectorSeatContextMenuItems,
  resolveCrewCasualties,
} from '../core/ejector.ts';
import {
  createPhysicsState,
} from '../core/physics.ts';
import type { PhysicsState } from '../core/physics.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
} from '../core/rocketbuilder.ts';
import type { RocketAssembly, StagingConfig } from '../core/rocketbuilder.ts';
import { activateCurrentStage } from '../core/staging.ts';
import { createFlightState, createGameState } from '../core/gameState.ts';
import type { FlightState, FlightEvent, CrewMember } from '../core/gameState.ts';
import { hireCrew } from '../core/crew.ts';
import { AstronautStatus } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Shared fixture helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal crewed rocket: Mk1 Command Module + Small Tank + Spark Engine.
 */
function makeCrewedRocket(): { assembly: RocketAssembly; staging: StagingConfig; cmdId: string; tankId: string; engineId: string } {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const cmdId    = addPartToAssembly(assembly, 'cmd-mk1',      0,   60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',   0,    0);
  const engineId = addPartToAssembly(assembly, 'engine-spark', 0,  -55);

  connectParts(assembly, cmdId,   1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, cmdId, tankId, engineId };
}

/**
 * Minimal uncrewed rocket: Probe Core only (no ejector seat).
 */
function makeUncrewedRocket(): { assembly: RocketAssembly; staging: StagingConfig; probeId: string } {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();
  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
  syncStagingWithAssembly(assembly, staging);
  return { assembly, staging, probeId };
}

/** Create a FlightState for test use. */
function makeFlightState(crewIds: string[] = []): FlightState {
  return createFlightState({ missionId: 'test', rocketId: 'test', crewIds });
}

/**
 * Build a PhysicsState for a given assembly (wraps createPhysicsState which
 * now calls initEjectorStates internally).
 */
function makePhysicsState(assembly: RocketAssembly): PhysicsState {
  return createPhysicsState(assembly, makeFlightState());
}

// ---------------------------------------------------------------------------
// initEjectorStates()
// ---------------------------------------------------------------------------

describe('initEjectorStates()', () => {
  it('initialises cmd-mk1 to ARMED', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    expect(ps.ejectorStates.get(cmdId)).toBe(EjectorState.ARMED);
  });

  it('does not add entries for COMPUTER_MODULE parts (no ejector seat)', () => {
    const { assembly, probeId } = makeUncrewedRocket();
    const ps = makePhysicsState(assembly);

    expect(ps.ejectorStates.has(probeId)).toBe(false);
  });

  it('does not add entries for ENGINE or FUEL_TANK parts', () => {
    const { assembly, tankId, engineId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    expect(ps.ejectorStates.has(tankId)).toBe(false);
    expect(ps.ejectorStates.has(engineId)).toBe(false);
  });

  it('is idempotent — calling again preserves existing entries', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    // Manually set to ACTIVATED.
    ps.ejectorStates.set(cmdId, EjectorState.ACTIVATED);

    // Call init again — should NOT reset to ARMED.
    initEjectorStates(ps, assembly);

    expect(ps.ejectorStates.get(cmdId)).toBe(EjectorState.ACTIVATED);
  });

  it('ps.ejectorStates is initialised by createPhysicsState', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    expect(ps.ejectorStates).toBeInstanceOf(Map);
  });

  it('ps.ejectedCrewIds is initialised as an empty Set by createPhysicsState', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    expect(ps.ejectedCrewIds).toBeInstanceOf(Set);
    expect(ps.ejectedCrewIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// activateEjectorSeat()
// ---------------------------------------------------------------------------

describe('activateEjectorSeat()', () => {
  it('transitions state from ARMED to ACTIVATED', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState(['crew-1']);

    activateEjectorSeat(ps, assembly, fs, cmdId);

    expect(ps.ejectorStates.get(cmdId)).toBe(EjectorState.ACTIVATED);
  });

  it('emits a CREW_EJECTED event', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState(['crew-1']);

    activateEjectorSeat(ps, assembly, fs, cmdId);

    const evt = fs.events.find((e: FlightEvent) => e.type === 'CREW_EJECTED');
    expect(evt).toBeDefined();
    expect(typeof evt!.altitude).toBe('number');
  });

  it('includes the correct altitude in the CREW_EJECTED event', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    ps.posY = 3_500;
    const fs = makeFlightState(['crew-1']);

    activateEjectorSeat(ps, assembly, fs, cmdId);

    const evt = fs.events.find((e: FlightEvent) => e.type === 'CREW_EJECTED');
    expect(evt!.altitude).toBeCloseTo(3_500, 0);
  });

  it('adds crew IDs to ps.ejectedCrewIds', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState(['crew-1', 'crew-2']);

    activateEjectorSeat(ps, assembly, fs, cmdId);

    expect(ps.ejectedCrewIds.has('crew-1')).toBe(true);
    expect(ps.ejectedCrewIds.has('crew-2')).toBe(true);
  });

  it('returns true on successful activation', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState(['crew-1']);

    const result = activateEjectorSeat(ps, assembly, fs, cmdId);

    expect(result).toBe(true);
  });

  it('is idempotent — returns false and emits no duplicate event if already ACTIVATED', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState(['crew-1']);

    activateEjectorSeat(ps, assembly, fs, cmdId); // first activation
    const initialEventCount = fs.events.length;

    const result = activateEjectorSeat(ps, assembly, fs, cmdId); // second call
    expect(result).toBe(false);
    expect(fs.events.length).toBe(initialEventCount); // no new event
  });

  it('does not modify ejectorStates when ps.ejectorStates is absent', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    // @ts-expect-error — intentionally deleting required field to simulate missing map
    delete ps.ejectorStates;
    const fs = makeFlightState(['crew-1']);

    // Should not throw.
    const result = activateEjectorSeat(ps, assembly, fs, cmdId);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getEjectorSeatStatus()
// ---------------------------------------------------------------------------

describe('getEjectorSeatStatus()', () => {
  it('returns ARMED for an uninitialised instance (no ejectorStates map)', () => {
    const ps = { activeParts: new Set<string>() } as Partial<PhysicsState> as PhysicsState; // no ejectorStates
    expect(getEjectorSeatStatus(ps, 'any-id')).toBe(EjectorState.ARMED);
  });

  it('returns ARMED for a tracked-but-unactivated command module', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    expect(getEjectorSeatStatus(ps, cmdId)).toBe(EjectorState.ARMED);
  });

  it('returns ACTIVATED after the ejector seat is fired', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState(['crew-1']);

    activateEjectorSeat(ps, assembly, fs, cmdId);

    expect(getEjectorSeatStatus(ps, cmdId)).toBe(EjectorState.ACTIVATED);
  });

  it('returns ARMED for an untracked instance ID', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    expect(getEjectorSeatStatus(ps, 'nonexistent-id')).toBe(EjectorState.ARMED);
  });
});

// ---------------------------------------------------------------------------
// getEjectorSeatContextMenuItems()
// ---------------------------------------------------------------------------

describe('getEjectorSeatContextMenuItems()', () => {
  it('returns one item for a rocket with one command module', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    const items = getEjectorSeatContextMenuItems(ps, assembly);

    expect(items.length).toBe(1);
  });

  it('returns no items for an uncrewed rocket (no ejector seat parts)', () => {
    const { assembly } = makeUncrewedRocket();
    const ps = makePhysicsState(assembly);

    const items = getEjectorSeatContextMenuItems(ps, assembly);

    expect(items.length).toBe(0);
  });

  it('item has canActivate=true when ejector is ARMED', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    const [item] = getEjectorSeatContextMenuItems(ps, assembly);

    expect(item.canActivate).toBe(true);
    expect(item.state).toBe(EjectorState.ARMED);
  });

  it('item has canActivate=false after ejector is ACTIVATED', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState(['crew-1']);

    activateEjectorSeat(ps, assembly, fs, cmdId);

    const [item] = getEjectorSeatContextMenuItems(ps, assembly);
    expect(item.canActivate).toBe(false);
    expect(item.state).toBe(EjectorState.ACTIVATED);
  });

  it('item has instanceId, name, state, statusLabel fields', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    const [item] = getEjectorSeatContextMenuItems(ps, assembly);

    expect(typeof item.instanceId).toBe('string');
    expect(item.instanceId).toBe(cmdId);
    expect(typeof item.name).toBe('string');
    expect(typeof item.state).toBe('string');
    expect(typeof item.statusLabel).toBe('string');
  });

  it('does not return items for command modules not in ps.activeParts', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    // Simulate destruction of the command module.
    ps.activeParts.delete(cmdId);

    const items = getEjectorSeatContextMenuItems(ps, assembly);

    expect(items.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveCrewCasualties()
// ---------------------------------------------------------------------------

describe('resolveCrewCasualties() — crash without ejection', () => {
  it('marks crew as KIA when rocket crashes and ejector was not activated', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    ps.crashed = true;

    const state = createGameState();
    // Hire an astronaut and add to crew
    const result = hireCrew(state, 'Valentina Test');
    const astronaut = result.astronaut!;

    const fs = makeFlightState([astronaut.id]);

    const newKia = resolveCrewCasualties(state, ps, assembly, fs);

    expect(newKia).toContain(astronaut.id);
    const updated = state.crew.find((c: CrewMember) => c.id === astronaut.id);
    expect(updated!.status).toBe(AstronautStatus.KIA);
  });

  it('applies the $500,000 fine per KIA astronaut', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    ps.crashed = true;

    const state = createGameState();
    const { astronaut } = hireCrew(state, 'Yuri Test');
    const moneyBefore = state.money;

    const fs = makeFlightState([astronaut!.id]);
    resolveCrewCasualties(state, ps, assembly, fs);

    expect(state.money).toBe(moneyBefore - 500_000);
  });

  it('does NOT mark crew as KIA when ejector was activated before crash', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    const state = createGameState();
    const { astronaut } = hireCrew(state, 'Buzz Test');

    const fs = makeFlightState([astronaut!.id]);

    // Eject crew first.
    activateEjectorSeat(ps, assembly, fs, cmdId);

    // Then simulate crash.
    ps.crashed = true;

    const newKia = resolveCrewCasualties(state, ps, assembly, fs);

    expect(newKia).toHaveLength(0);
    const updated = state.crew.find((c: CrewMember) => c.id === astronaut!.id);
    expect(updated!.status).toBe(AstronautStatus.ACTIVE);
  });

  it('returns empty array for an uncrewed flight', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    ps.crashed = true;

    const state = createGameState();
    const fs = makeFlightState([]); // no crew

    const newKia = resolveCrewCasualties(state, ps, assembly, fs);

    expect(newKia).toHaveLength(0);
  });

  it('returns empty array when rocket lands safely (not crashed)', () => {
    const { assembly } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    ps.landed = true; // safe landing, not crashed

    const state = createGameState();
    const { astronaut } = hireCrew(state, 'Neil Test');
    const fs = makeFlightState([astronaut!.id]);

    const newKia = resolveCrewCasualties(state, ps, assembly, fs);

    expect(newKia).toHaveLength(0);
    const updated = state.crew.find((c: CrewMember) => c.id === astronaut!.id);
    expect(updated!.status).toBe(AstronautStatus.ACTIVE);
  });
});

describe('resolveCrewCasualties() — heat destruction of command module', () => {
  it('marks crew KIA when command module is destroyed by heat (no ejection)', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);
    // Simulate heat destruction: remove from activeParts, add PART_DESTROYED event

    const state = createGameState();
    const { astronaut } = hireCrew(state, 'Gus Test');
    const fs = makeFlightState([astronaut!.id]);

    // Simulate PART_DESTROYED event for the command module.
    fs.events.push({
      type:        'PART_DESTROYED',
      time:        10,
      instanceId:  cmdId,
      partName:    'Mk1 Command Module',
      altitude:    50_000,
      description: 'Mk1 Command Module destroyed by reentry heat.',
    });

    const newKia = resolveCrewCasualties(state, ps, assembly, fs);

    expect(newKia).toContain(astronaut!.id);
    const updated = state.crew.find((c: CrewMember) => c.id === astronaut!.id);
    expect(updated!.status).toBe(AstronautStatus.KIA);
  });

  it('does NOT mark crew KIA when ejector was activated before heat destruction', () => {
    const { assembly, cmdId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    const state = createGameState();
    const { astronaut } = hireCrew(state, 'Mae Test');
    const fs = makeFlightState([astronaut!.id]);

    // Eject crew before the module is destroyed.
    activateEjectorSeat(ps, assembly, fs, cmdId);

    // Then simulate heat destruction of the module.
    fs.events.push({
      type:        'PART_DESTROYED',
      time:        15,
      instanceId:  cmdId,
      partName:    'Mk1 Command Module',
      altitude:    55_000,
      description: 'Mk1 Command Module destroyed by reentry heat.',
    });

    const newKia = resolveCrewCasualties(state, ps, assembly, fs);

    expect(newKia).toHaveLength(0);
    const updated = state.crew.find((c: CrewMember) => c.id === astronaut!.id);
    expect(updated!.status).toBe(AstronautStatus.ACTIVE);
  });

  it('ignores PART_DESTROYED events for non-command-module parts', () => {
    const { assembly, tankId } = makeCrewedRocket();
    const ps = makePhysicsState(assembly);

    const state = createGameState();
    const { astronaut } = hireCrew(state, 'Sally Test');
    const fs = makeFlightState([astronaut!.id]);

    // Simulate heat destruction of the fuel tank (not a command module).
    fs.events.push({
      type:        'PART_DESTROYED',
      time:        10,
      instanceId:  tankId,
      partName:    'Small Tank',
      altitude:    40_000,
      description: 'Small Tank destroyed by reentry heat.',
    });

    const newKia = resolveCrewCasualties(state, ps, assembly, fs);

    expect(newKia).toHaveLength(0);
    const updated = state.crew.find((c: CrewMember) => c.id === astronaut!.id);
    expect(updated!.status).toBe(AstronautStatus.ACTIVE);
  });
});

// ---------------------------------------------------------------------------
// Integration: staging EJECT → ejector state updates
// ---------------------------------------------------------------------------

describe('staging EJECT → ejector state via activateEjectorSeat', () => {
  it('ejector seat state is ACTIVATED after staging fires the command module', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const cmdId    = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, cmdId, 0);

    const ps = createPhysicsState(assembly, makeFlightState(['crew-1']));
    const fs = makeFlightState(['crew-1']);

    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.ejectorStates.get(cmdId)).toBe(EjectorState.ACTIVATED);
    expect(ps.ejectedCrewIds.has('crew-1')).toBe(true);
  });

  it('emits CREW_EJECTED event when staging fires the ejector', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const cmdId = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, cmdId, 0);

    const ps = createPhysicsState(assembly, makeFlightState([]));
    ps.posY = 500;
    const fs = makeFlightState([]);

    activateCurrentStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e: FlightEvent) => e.type === 'CREW_EJECTED');
    expect(evt).toBeDefined();
    expect(evt!.altitude).toBeCloseTo(500, 0);
  });
});
