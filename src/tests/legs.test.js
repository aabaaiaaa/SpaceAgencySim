/**
 * legs.test.js — Unit tests for landing leg deployment events and mirror pair behavior.
 *
 * Tests cover:
 *   - deployLandingLeg transitions RETRACTED → DEPLOYING
 *   - tickLegs completes deploy and emits LEG_DEPLOYED event
 *   - PART_ACTIVATED objective completion for manual leg deploy
 *   - getMirrorPartId returns partner for symmetry pairs
 *   - deploying both legs in a mirror pair
 *   - getMirrorPartId returns null when no pair exists
 */

import { describe, it, expect } from 'vitest';
import {
  deployLandingLeg,
  getLegStatus,
  LegState,
  LEG_DEPLOY_DURATION,
  tickLegs,
  retractLandingLeg,
} from '../core/legs.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  addSymmetryPair,
  getMirrorPartId,
} from '../core/rocketbuilder.js';
import { checkObjectiveCompletion } from '../core/missions.js';
import { createGameState } from '../core/gameState.js';
import { ObjectiveType, MissionStatus } from '../data/missions.js';
import { PartType } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal PhysicsState with legStates for the given instance IDs.
 */
function makePS(...legInstanceIds) {
  const legStates = new Map();
  const activeParts = new Set(legInstanceIds);
  for (const id of legInstanceIds) {
    legStates.set(id, { state: LegState.RETRACTED, deployTimer: 0 });
  }
  return { legStates, activeParts, posY: 0 };
}

/**
 * Build a minimal assembly with landing leg parts at the given instance IDs.
 */
function makeAssembly(...legInstanceIds) {
  const assembly = createRocketAssembly();
  for (const id of legInstanceIds) {
    addPartToAssembly(assembly, 'landing-legs-mk1', 0, 0);
    // Overwrite the auto-generated ID so we can control it.
    const lastKey = [...assembly.parts.keys()].pop();
    const placed = assembly.parts.get(lastKey);
    assembly.parts.delete(lastKey);
    assembly.parts.set(id, { ...placed, instanceId: id });
  }
  return assembly;
}

// ---------------------------------------------------------------------------
// Landing leg manual deployment events
// ---------------------------------------------------------------------------

describe('landing leg manual deployment events', () => {
  it('deployLandingLeg transitions RETRACTED → DEPLOYING', () => {
    const ps = makePS('leg-1');
    deployLandingLeg(ps, 'leg-1');
    const entry = ps.legStates.get('leg-1');
    expect(entry.state).toBe(LegState.DEPLOYING);
    expect(entry.deployTimer).toBe(LEG_DEPLOY_DURATION);
  });

  it('tickLegs completes deploy and emits LEG_DEPLOYED event', () => {
    const ps = makePS('leg-1');
    const assembly = makeAssembly('leg-1');
    const flightState = { events: [], timeElapsed: 0 };

    deployLandingLeg(ps, 'leg-1');

    // Tick past the full deploy duration.
    tickLegs(ps, assembly, flightState, LEG_DEPLOY_DURATION + 0.1);

    expect(ps.legStates.get('leg-1').state).toBe(LegState.DEPLOYED);
    const deployedEvent = flightState.events.find((e) => e.type === 'LEG_DEPLOYED');
    expect(deployedEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ACTIVATE_PART objective — manual leg deploy
// ---------------------------------------------------------------------------

describe('ACTIVATE_PART objective — manual leg deploy', () => {
  it('manual deploy PART_ACTIVATED event satisfies ACTIVATE_PART objective', () => {
    const state = createGameState();
    const mission = {
      id: 'test-leg-mission',
      title: 'Deploy Landing Legs',
      description: 'Test',
      location: 'desert',
      reward: 1000,
      unlocksAfter: [],
      unlockedParts: [],
      status: MissionStatus.ACCEPTED,
      objectives: [
        {
          id: 'obj-deploy-legs',
          type: ObjectiveType.ACTIVATE_PART,
          target: { partType: PartType.LANDING_LEGS },
          completed: false,
          description: 'Deploy landing legs',
        },
      ],
    };
    state.missions.accepted.push(mission);

    const flightState = {
      missionId: 'test-leg-mission',
      events: [
        {
          type: 'PART_ACTIVATED',
          time: 5,
          instanceId: 'leg-1',
          partType: PartType.LANDING_LEGS,
          description: 'Landing Legs Mk1 manually deployed.',
        },
      ],
      timeElapsed: 10,
      altitude: 0,
      velocity: 0,
      fuelRemaining: 0,
      deltaVRemaining: 0,
    };

    checkObjectiveCompletion(state, flightState);

    const obj = state.missions.accepted[0].objectives[0];
    expect(obj.completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mirror pair leg deployment
// ---------------------------------------------------------------------------

describe('mirror pair leg deployment', () => {
  it('getMirrorPartId returns partner for a symmetry pair', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'landing-legs-mk1', -20, 0);
    addPartToAssembly(assembly, 'landing-legs-mk1', 20, 0);
    const ids = [...assembly.parts.keys()];
    addSymmetryPair(assembly, ids[0], ids[1]);

    expect(getMirrorPartId(assembly, ids[0])).toBe(ids[1]);
    expect(getMirrorPartId(assembly, ids[1])).toBe(ids[0]);
  });

  it('deploying both legs in a pair sets both to DEPLOYING', () => {
    const ps = makePS('leg-L', 'leg-R');
    deployLandingLeg(ps, 'leg-L');
    deployLandingLeg(ps, 'leg-R');

    expect(ps.legStates.get('leg-L').state).toBe(LegState.DEPLOYING);
    expect(ps.legStates.get('leg-R').state).toBe(LegState.DEPLOYING);
  });

  it('getMirrorPartId returns null when no pair exists', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'landing-legs-mk1', 0, 0);
    const id = [...assembly.parts.keys()][0];

    expect(getMirrorPartId(assembly, id)).toBeNull();
  });
});
