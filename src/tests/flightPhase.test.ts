/**
 * flightPhase.test.js — Unit tests for the flight phase state machine.
 *
 * Tests cover:
 *   - FlightPhase enum values exist
 *   - isValidTransition() — allowed and disallowed transitions
 *   - transitionPhase()   — successful transitions, rejections, logging
 *   - evaluateAutoTransitions() — automatic phase detection
 *   - canReturnToAgency() — phase-based return gating
 *   - isPlayerLocked()    — transfer / capture lock
 *   - getPhaseLabel()     — human-readable labels
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFlightState } from '../core/gameState.ts';
import type { FlightState, OrbitalElements } from '../core/gameState.ts';
import { FlightPhase } from '../core/constants.ts';
import type { PhysicsState } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Mock manoeuvre.ts — defaults return falsy values so existing tests are
// unaffected.  Individual tests override via vi.mocked(fn).mockReturnValue().
// ---------------------------------------------------------------------------
vi.mock('../core/manoeuvre.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/manoeuvre.ts')>();
  return {
    ...original,
    shouldEnterManoeuvre: vi.fn().mockReturnValue(false),
    shouldExitManoeuvre: vi.fn().mockReturnValue(false),
    shouldEnterTransfer: vi.fn().mockReturnValue(false),
    isEscapeTrajectory: vi.fn().mockReturnValue(false),
    checkSOITransition: vi.fn().mockReturnValue({ transition: false, newBodyId: null, reason: '' }),
    getTransferTargets: vi.fn().mockReturnValue([]),
    computeTransferDeltaV: vi.fn().mockReturnValue(null),
  };
});

// ---------------------------------------------------------------------------
// Mock orbit.ts — only getAltitudeBand and computeOrbitalElements need stubs.
// ---------------------------------------------------------------------------
vi.mock('../core/orbit.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../core/orbit.ts')>();
  return {
    ...original,
    getAltitudeBand: vi.fn().mockReturnValue(null),
    computeOrbitalElements: vi.fn().mockReturnValue(null),
  };
});

import {
  isValidTransition,
  transitionPhase,
  evaluateAutoTransitions,
  canReturnToAgency,
  isPlayerLocked,
  getPhaseLabel,
  getDeorbitWarningMessage,
  isInUnsafeBeltOrbit,
} from '../core/flightPhase.ts';

import {
  shouldExitManoeuvre,
  shouldEnterTransfer,
  isEscapeTrajectory,
  checkSOITransition,
  getTransferTargets,
  computeTransferDeltaV,
} from '../core/manoeuvre.ts';

import {
  getAltitudeBand,
  computeOrbitalElements,
} from '../core/orbit.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshFlightState(): FlightState {
  return createFlightState({
    missionId: 'test-mission',
    rocketId: 'test-rocket',
    crewIds: [],
    fuelRemaining: 1000,
    deltaVRemaining: 3000,
  });
}

/** Minimal PhysicsState stub for auto-transition tests. */
function stubPs(overrides: Partial<PhysicsState> = {}): PhysicsState {
  return {
    posX: 0,
    posY: 0,
    velX: 0,
    velY: 0,
    throttle: 0,
    firingEngines: new Set<string>(),
    grounded: true,
    landed: false,
    crashed: false,
    ...overrides,
  } as PhysicsState;
}

function stubElements(overrides: Partial<OrbitalElements> = {}): OrbitalElements {
  return {
    semiMajorAxis: 6_500_000,
    eccentricity: 0.01,
    argPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FlightPhase enum
// ---------------------------------------------------------------------------

describe('FlightPhase enum', () => {
  it('has all expected phase values', () => {
    expect(FlightPhase.PRELAUNCH).toBe('PRELAUNCH');
    expect(FlightPhase.LAUNCH).toBe('LAUNCH');
    expect(FlightPhase.FLIGHT).toBe('FLIGHT');
    expect(FlightPhase.ORBIT).toBe('ORBIT');
    expect(FlightPhase.MANOEUVRE).toBe('MANOEUVRE');
    expect(FlightPhase.REENTRY).toBe('REENTRY');
    expect(FlightPhase.TRANSFER).toBe('TRANSFER');
    expect(FlightPhase.CAPTURE).toBe('CAPTURE');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(FlightPhase)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('createFlightState', () => {
  it('starts in PRELAUNCH phase', () => {
    const fs = freshFlightState();
    expect(fs.phase).toBe(FlightPhase.PRELAUNCH);
  });

  it('starts with an empty phaseLog', () => {
    const fs = freshFlightState();
    expect(fs.phaseLog).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isValidTransition
// ---------------------------------------------------------------------------

describe('isValidTransition', () => {
  const validPairs = [
    [FlightPhase.PRELAUNCH, FlightPhase.LAUNCH],
    [FlightPhase.LAUNCH, FlightPhase.FLIGHT],
    [FlightPhase.FLIGHT, FlightPhase.ORBIT],
    [FlightPhase.ORBIT, FlightPhase.MANOEUVRE],
    [FlightPhase.ORBIT, FlightPhase.REENTRY],
    [FlightPhase.ORBIT, FlightPhase.TRANSFER],
    [FlightPhase.MANOEUVRE, FlightPhase.ORBIT],
    [FlightPhase.REENTRY, FlightPhase.FLIGHT],
    [FlightPhase.TRANSFER, FlightPhase.CAPTURE],
    [FlightPhase.CAPTURE, FlightPhase.ORBIT],
  ];

  for (const [from, to] of validPairs) {
    it(`allows ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(true);
    });
  }

  const invalidPairs = [
    [FlightPhase.PRELAUNCH, FlightPhase.ORBIT],
    [FlightPhase.PRELAUNCH, FlightPhase.FLIGHT],
    [FlightPhase.LAUNCH, FlightPhase.ORBIT],
    [FlightPhase.FLIGHT, FlightPhase.TRANSFER],
    [FlightPhase.ORBIT, FlightPhase.LAUNCH],
    [FlightPhase.ORBIT, FlightPhase.FLIGHT],
    [FlightPhase.MANOEUVRE, FlightPhase.FLIGHT],
    [FlightPhase.REENTRY, FlightPhase.ORBIT],
    [FlightPhase.TRANSFER, FlightPhase.ORBIT],
    [FlightPhase.CAPTURE, FlightPhase.FLIGHT],
  ];

  for (const [from, to] of invalidPairs) {
    it(`rejects ${from} → ${to}`, () => {
      expect(isValidTransition(from, to)).toBe(false);
    });
  }

  it('rejects self-transitions via isValidTransition', () => {
    // Self-transitions are blocked in transitionPhase, but isValidTransition
    // only checks the map — a phase won't be in its own allowed set.
    for (const phase of Object.values(FlightPhase)) {
      expect(isValidTransition(phase, phase)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// transitionPhase
// ---------------------------------------------------------------------------

describe('transitionPhase', () => {
  let fs: FlightState;

  beforeEach(() => {
    fs = freshFlightState();
  });

  it('successfully transitions PRELAUNCH → LAUNCH', () => {
    const result = transitionPhase(fs, FlightPhase.LAUNCH, 'Engine ignition');
    expect(result.success).toBe(true);
    expect(result.from).toBe(FlightPhase.PRELAUNCH);
    expect(result.to).toBe(FlightPhase.LAUNCH);
    expect(fs.phase).toBe(FlightPhase.LAUNCH);
  });

  it('logs the transition in phaseLog', () => {
    transitionPhase(fs, FlightPhase.LAUNCH, 'Engine ignition');
    expect(fs.phaseLog).toHaveLength(1);
    expect(fs.phaseLog[0].from).toBe(FlightPhase.PRELAUNCH);
    expect(fs.phaseLog[0].to).toBe(FlightPhase.LAUNCH);
    expect(fs.phaseLog[0].reason).toBe('Engine ignition');
    expect(typeof fs.phaseLog[0].time).toBe('number');
  });

  it('appends a PHASE_CHANGE flight event', () => {
    transitionPhase(fs, FlightPhase.LAUNCH, 'Engine ignition');
    const evt = fs.events.find(e => e.type === 'PHASE_CHANGE');
    expect(evt).toBeDefined();
    expect(evt!.description).toBe('Engine ignition');
  });

  it('rejects invalid transitions', () => {
    const result = transitionPhase(fs, FlightPhase.ORBIT, 'Skip to orbit');
    expect(result.success).toBe(false);
    expect(fs.phase).toBe(FlightPhase.PRELAUNCH);
    expect(fs.phaseLog).toHaveLength(0);
  });

  it('rejects self-transition', () => {
    const result = transitionPhase(fs, FlightPhase.PRELAUNCH, 'Same phase');
    expect(result.success).toBe(false);
    expect(result.reason).toBe('Already in this phase');
  });

  it('tracks multiple transitions in sequence', () => {
    transitionPhase(fs, FlightPhase.LAUNCH, 'Ignition');
    transitionPhase(fs, FlightPhase.FLIGHT, 'Liftoff');
    transitionPhase(fs, FlightPhase.ORBIT, 'Orbit achieved');

    expect(fs.phase).toBe(FlightPhase.ORBIT);
    expect(fs.phaseLog).toHaveLength(3);
    expect(fs.phaseLog[0].to).toBe(FlightPhase.LAUNCH);
    expect(fs.phaseLog[1].to).toBe(FlightPhase.FLIGHT);
    expect(fs.phaseLog[2].to).toBe(FlightPhase.ORBIT);
  });

  it('provides default reason when none given', () => {
    transitionPhase(fs, FlightPhase.LAUNCH);
    expect(fs.phaseLog[0].reason).toBe('PRELAUNCH → LAUNCH');
  });
});

// ---------------------------------------------------------------------------
// evaluateAutoTransitions
// ---------------------------------------------------------------------------

describe('evaluateAutoTransitions', () => {
  let fs: FlightState;

  beforeEach(() => {
    fs = freshFlightState();
  });

  it('PRELAUNCH → LAUNCH when engines are firing', () => {
    const ps = stubPs({ firingEngines: new Set(['eng-1']), throttle: 0.5 });
    const transition = evaluateAutoTransitions(fs, ps, null);

    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.LAUNCH);
    expect(fs.phase).toBe(FlightPhase.LAUNCH);
  });

  it('stays in PRELAUNCH when no engines firing', () => {
    const ps = stubPs();
    const transition = evaluateAutoTransitions(fs, ps, null);
    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.PRELAUNCH);
  });

  it('LAUNCH → FLIGHT when off the ground', () => {
    // First get to LAUNCH.
    fs.phase = FlightPhase.LAUNCH;

    const ps = stubPs({ grounded: false, posY: 10 });
    const transition = evaluateAutoTransitions(fs, ps, null);

    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.FLIGHT);
    expect(fs.phase).toBe(FlightPhase.FLIGHT);
  });

  it('stays in LAUNCH while still grounded', () => {
    fs.phase = FlightPhase.LAUNCH;
    const ps = stubPs({ grounded: true, posY: 0 });
    const transition = evaluateAutoTransitions(fs, ps, null);
    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.LAUNCH);
  });

  it('FLIGHT → ORBIT when orbit is valid', () => {
    fs.phase = FlightPhase.FLIGHT;

    const ps = stubPs({ posY: 100_000 });
    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 6_500_000, eccentricity: 0.01 }),
      periapsisAlt: 90_000,
      apoapsisAlt: 110_000,
    };

    const transition = evaluateAutoTransitions(fs, ps, orbitStatus);
    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.ORBIT);
    expect(fs.phase).toBe(FlightPhase.ORBIT);
    expect(fs.inOrbit).toBe(true);
    expect(fs.orbitalElements).toEqual(orbitStatus.elements);
  });

  it('stays in FLIGHT when orbit is not valid', () => {
    fs.phase = FlightPhase.FLIGHT;
    const ps = stubPs({ posY: 50_000 });
    const transition = evaluateAutoTransitions(fs, ps, null);
    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.FLIGHT);
  });

  it('REENTRY → FLIGHT when below atmosphere', () => {
    fs.phase = FlightPhase.REENTRY;

    const ps = stubPs({ posY: 60_000 }); // below 70 km
    const transition = evaluateAutoTransitions(fs, ps, null);

    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.FLIGHT);
    expect(fs.phase).toBe(FlightPhase.FLIGHT);
    expect(fs.inOrbit).toBe(false);
    expect(fs.orbitalElements).toBeNull();
  });

  it('stays in REENTRY when still above atmosphere', () => {
    fs.phase = FlightPhase.REENTRY;
    const ps = stubPs({ posY: 75_000 });
    const transition = evaluateAutoTransitions(fs, ps, null);
    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.REENTRY);
  });

  it('CAPTURE → ORBIT when orbit is valid at destination', () => {
    fs.phase = FlightPhase.CAPTURE;

    const ps = stubPs({ posY: 100_000 });
    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 6_500_000, eccentricity: 0.05 }),
      periapsisAlt: 85_000,
      apoapsisAlt: 120_000,
    };

    const transition = evaluateAutoTransitions(fs, ps, orbitStatus);
    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.ORBIT);
    expect(fs.phase).toBe(FlightPhase.ORBIT);
    expect(fs.inOrbit).toBe(true);
  });

  it('does not auto-transition from ORBIT (manual only)', () => {
    fs.phase = FlightPhase.ORBIT;
    const ps = stubPs({ posY: 100_000 });
    const orbitStatus = { valid: true, elements: stubElements(), periapsisAlt: 90_000, apoapsisAlt: 110_000 };
    const transition = evaluateAutoTransitions(fs, ps, orbitStatus);
    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.ORBIT);
  });

  it('does not auto-transition from TRANSFER (manual only)', () => {
    fs.phase = FlightPhase.TRANSFER;
    const ps = stubPs({ posY: 500_000 });
    const transition = evaluateAutoTransitions(fs, ps, null);
    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.TRANSFER);
  });
});

// ---------------------------------------------------------------------------
// canReturnToAgency
// ---------------------------------------------------------------------------

describe('canReturnToAgency', () => {
  it('allows return from ORBIT', () => {
    const ps = stubPs({ landed: false, crashed: false });
    expect(canReturnToAgency(FlightPhase.ORBIT, ps)).toBe(true);
  });

  it('allows return when landed (any phase)', () => {
    const ps = stubPs({ landed: true });
    expect(canReturnToAgency(FlightPhase.FLIGHT, ps)).toBe(true);
    expect(canReturnToAgency(FlightPhase.REENTRY, ps)).toBe(true);
  });

  it('allows return when crashed (any phase)', () => {
    const ps = stubPs({ crashed: true });
    expect(canReturnToAgency(FlightPhase.FLIGHT, ps)).toBe(true);
  });

  it('blocks return during TRANSFER', () => {
    const ps = stubPs({ landed: false, crashed: false });
    expect(canReturnToAgency(FlightPhase.TRANSFER, ps)).toBe(false);
  });

  it('blocks return during CAPTURE', () => {
    const ps = stubPs({ landed: false, crashed: false });
    expect(canReturnToAgency(FlightPhase.CAPTURE, ps)).toBe(false);
  });

  it('allows return during FLIGHT (abort)', () => {
    const ps = stubPs({ landed: false, crashed: false });
    expect(canReturnToAgency(FlightPhase.FLIGHT, ps)).toBe(true);
  });

  it('allows return during MANOEUVRE (abort)', () => {
    const ps = stubPs({ landed: false, crashed: false });
    expect(canReturnToAgency(FlightPhase.MANOEUVRE, ps)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isPlayerLocked
// ---------------------------------------------------------------------------

describe('isPlayerLocked', () => {
  it('returns true for TRANSFER', () => {
    expect(isPlayerLocked(FlightPhase.TRANSFER)).toBe(true);
  });

  it('returns true for CAPTURE', () => {
    expect(isPlayerLocked(FlightPhase.CAPTURE)).toBe(true);
  });

  it('returns false for all other phases', () => {
    const unlocked = [
      FlightPhase.PRELAUNCH, FlightPhase.LAUNCH, FlightPhase.FLIGHT,
      FlightPhase.ORBIT, FlightPhase.MANOEUVRE, FlightPhase.REENTRY,
    ];
    for (const phase of unlocked) {
      expect(isPlayerLocked(phase)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// getPhaseLabel
// ---------------------------------------------------------------------------

describe('getPhaseLabel', () => {
  it('returns human-readable labels for all phases', () => {
    expect(getPhaseLabel(FlightPhase.PRELAUNCH)).toBe('Pre-Launch');
    expect(getPhaseLabel(FlightPhase.LAUNCH)).toBe('Launch');
    expect(getPhaseLabel(FlightPhase.FLIGHT)).toBe('Flight');
    expect(getPhaseLabel(FlightPhase.ORBIT)).toBe('Orbit');
    expect(getPhaseLabel(FlightPhase.MANOEUVRE)).toBe('Manoeuvre');
    expect(getPhaseLabel(FlightPhase.REENTRY)).toBe('Re-Entry');
    expect(getPhaseLabel(FlightPhase.TRANSFER)).toBe('Transfer');
    expect(getPhaseLabel(FlightPhase.CAPTURE)).toBe('Capture');
  });

  it('returns raw value for unknown phases', () => {
    expect(getPhaseLabel('UNKNOWN')).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// Full flight lifecycle (integration-style)
// ---------------------------------------------------------------------------

describe('full flight lifecycle', () => {
  it('@smoke PRELAUNCH → LAUNCH → FLIGHT → ORBIT (ascent)', () => {
    const fs = freshFlightState();

    // PRELAUNCH → LAUNCH: engine ignition.
    const ps1 = stubPs({ firingEngines: new Set(['eng-1']), throttle: 1.0 });
    evaluateAutoTransitions(fs, ps1, null);
    expect(fs.phase).toBe(FlightPhase.LAUNCH);

    // LAUNCH → FLIGHT: liftoff.
    const ps2 = stubPs({ grounded: false, posY: 50 });
    evaluateAutoTransitions(fs, ps2, null);
    expect(fs.phase).toBe(FlightPhase.FLIGHT);

    // FLIGHT → ORBIT: stable orbit.
    const ps3 = stubPs({ posY: 100_000 });
    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 6_500_000, eccentricity: 0.01 }),
      periapsisAlt: 95_000,
      apoapsisAlt: 105_000,
    };
    evaluateAutoTransitions(fs, ps3, orbitStatus);
    expect(fs.phase).toBe(FlightPhase.ORBIT);

    // Verify phase log has 3 entries.
    expect(fs.phaseLog).toHaveLength(3);
    expect(fs.phaseLog.map(e => e.to)).toEqual([
      FlightPhase.LAUNCH,
      FlightPhase.FLIGHT,
      FlightPhase.ORBIT,
    ]);
  });

  it('ORBIT → MANOEUVRE → ORBIT (burn cycle)', () => {
    const fs = freshFlightState();
    fs.phase = FlightPhase.ORBIT;

    // Manual transition to MANOEUVRE.
    const r1 = transitionPhase(fs, FlightPhase.MANOEUVRE, 'Prograde burn');
    expect(r1.success).toBe(true);
    expect(fs.phase).toBe(FlightPhase.MANOEUVRE);

    // Manual transition back to ORBIT.
    const r2 = transitionPhase(fs, FlightPhase.ORBIT, 'Burn complete');
    expect(r2.success).toBe(true);
    expect(fs.phase).toBe(FlightPhase.ORBIT);
  });

  it('ORBIT → REENTRY → FLIGHT (de-orbit)', () => {
    const fs = freshFlightState();
    fs.phase = FlightPhase.ORBIT;

    // Manual transition to REENTRY.
    const r1 = transitionPhase(fs, FlightPhase.REENTRY, 'De-orbit burn');
    expect(r1.success).toBe(true);
    expect(fs.phase).toBe(FlightPhase.REENTRY);

    // Auto: REENTRY → FLIGHT when below atmosphere.
    const ps = stubPs({ posY: 60_000 });
    evaluateAutoTransitions(fs, ps, null);
    expect(fs.phase).toBe(FlightPhase.FLIGHT);
  });

  it('ORBIT → TRANSFER → CAPTURE → ORBIT (interplanetary)', () => {
    const fs = freshFlightState();
    fs.phase = FlightPhase.ORBIT;

    // Manual: ORBIT → TRANSFER.
    transitionPhase(fs, FlightPhase.TRANSFER, 'Trans-lunar injection');
    expect(fs.phase).toBe(FlightPhase.TRANSFER);

    // Player is locked.
    expect(isPlayerLocked(fs.phase)).toBe(true);

    // Manual: TRANSFER → CAPTURE.
    transitionPhase(fs, FlightPhase.CAPTURE, 'SOI arrival');
    expect(fs.phase).toBe(FlightPhase.CAPTURE);

    // Auto: CAPTURE → ORBIT.
    const ps = stubPs({ posY: 100_000 });
    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 2_000_000, eccentricity: 0.1 }),
      periapsisAlt: 80_000,
      apoapsisAlt: 200_000,
    };
    evaluateAutoTransitions(fs, ps, orbitStatus);
    expect(fs.phase).toBe(FlightPhase.ORBIT);
  });
});

// ---------------------------------------------------------------------------
// Orbit entry with altitude band metadata (TASK-023)
// ---------------------------------------------------------------------------

describe('orbit entry altitude band metadata', () => {
  it('FLIGHT → ORBIT transition includes altitude band in reason', () => {
    const fs = freshFlightState();
    fs.phase = FlightPhase.FLIGHT;

    const ps = stubPs({ posY: 100_000 });
    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 6_500_000, eccentricity: 0.01 }),
      periapsisAlt: 95_000,
      apoapsisAlt: 105_000,
      altitudeBand: { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 },
    };

    const transition = evaluateAutoTransitions(fs, ps, orbitStatus);
    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.ORBIT);
    expect(transition!.reason).toContain('Low Earth Orbit');
  });

  it('FLIGHT → ORBIT transition includes band meta object', () => {
    const fs = freshFlightState();
    fs.phase = FlightPhase.FLIGHT;

    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 6_500_000, eccentricity: 0.01 }),
      periapsisAlt: 95_000,
      apoapsisAlt: 105_000,
      altitudeBand: { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 },
    };
    const ps = stubPs({ posY: 100_000 });

    evaluateAutoTransitions(fs, ps, orbitStatus);
    const lastEntry = fs.phaseLog[fs.phaseLog.length - 1];
    expect(lastEntry.meta).toBeDefined();
    expect((lastEntry.meta as Record<string, Record<string, unknown>>).altitudeBand.id).toBe('LEO');
  });

  it('FLIGHT → ORBIT without altitude band uses generic reason', () => {
    const fs = freshFlightState();
    fs.phase = FlightPhase.FLIGHT;

    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 6_500_000, eccentricity: 0.01 }),
      periapsisAlt: 95_000,
      apoapsisAlt: 105_000,
      altitudeBand: null,
    };
    const ps = stubPs({ posY: 100_000 });

    const transition = evaluateAutoTransitions(fs, ps, orbitStatus);
    expect(transition!.reason).toContain('Orbit');
  });

  it('CAPTURE → ORBIT transition includes altitude band', () => {
    const fs = freshFlightState();
    fs.phase = FlightPhase.CAPTURE;

    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 2_000_000, eccentricity: 0.1 }),
      periapsisAlt: 25_000,
      apoapsisAlt: 80_000,
      altitudeBand: { id: 'LLO', name: 'Low Lunar Orbit', min: 15_000, max: 100_000 },
    };
    const ps = stubPs({ posY: 25_000 });

    const transition = evaluateAutoTransitions(fs, ps, orbitStatus);
    expect(transition).not.toBeNull();
    expect(transition!.reason).toContain('Low Lunar Orbit');
  });
});

// ---------------------------------------------------------------------------
// transitionPhase with metadata (TASK-023)
// ---------------------------------------------------------------------------

describe('transitionPhase metadata', () => {
  it('attaches meta to phase log entry when provided', () => {
    const fs = freshFlightState();
    const meta = { altitudeBand: { id: 'LEO', name: 'Low Earth Orbit' } };
    transitionPhase(fs, FlightPhase.LAUNCH, 'Engine ignition', meta);
    expect(fs.phaseLog[0].meta).toEqual(meta);
  });

  it('omits meta from phase log entry when not provided', () => {
    const fs = freshFlightState();
    transitionPhase(fs, FlightPhase.LAUNCH, 'Engine ignition');
    expect(fs.phaseLog[0].meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Deorbit warning message (TASK-023)
// ---------------------------------------------------------------------------

describe('getDeorbitWarningMessage', () => {
  it('returns Earth deorbit warning', () => {
    const msg = getDeorbitWarningMessage('EARTH');
    expect(msg).toContain('orbital model');
    expect(msg).toContain('no longer be visible');
  });

  it('returns Moon deorbit warning', () => {
    const msg = getDeorbitWarningMessage('MOON');
    expect(msg).toContain('lunar');
    expect(msg).toContain('no longer be visible');
  });
});

// ---------------------------------------------------------------------------
// FlightState bodyId (TASK-023)
// ---------------------------------------------------------------------------

describe('FlightState bodyId', () => {
  it('defaults bodyId to EARTH', () => {
    const fs = freshFlightState();
    expect(fs.bodyId).toBe('EARTH');
  });

  it('includes orbitBandId initialized to null', () => {
    const fs = freshFlightState();
    expect(fs.orbitBandId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// evaluateAutoTransitions — MANOEUVRE escape → TRANSFER (branch coverage)
// ---------------------------------------------------------------------------

describe('evaluateAutoTransitions MANOEUVRE → TRANSFER (escape trajectory)', () => {
  let fs: FlightState;

  beforeEach(() => {
    fs = freshFlightState();
    fs.phase = FlightPhase.MANOEUVRE;
    fs.bodyId = 'EARTH';
    // Reset mocks to defaults before each test.
    vi.mocked(shouldEnterTransfer).mockReturnValue(false);
    vi.mocked(shouldExitManoeuvre).mockReturnValue(false);
    vi.mocked(getTransferTargets).mockReturnValue([]);
    vi.mocked(computeTransferDeltaV).mockReturnValue(null);
    vi.mocked(computeOrbitalElements).mockReturnValue(null);
  });

  it('transitions MANOEUVRE → ORBIT → TRANSFER when escape trajectory detected', () => {
    vi.mocked(shouldEnterTransfer).mockReturnValue(true);
    vi.mocked(getTransferTargets).mockReturnValue([
      { bodyId: 'MOON', name: 'Moon', departureDV: 800, captureDV: 600, totalDV: 1400, transferTime: 259200 },
    ]);
    vi.mocked(computeTransferDeltaV).mockReturnValue({
      departureDV: 800, captureDV: 600, transferTime: 259200, totalDV: 1400,
    });

    const ps = stubPs({ posY: 200_000, velX: 500, velY: 8000 });
    const transition = evaluateAutoTransitions(fs, ps, null);

    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.TRANSFER);
    expect(fs.phase).toBe(FlightPhase.TRANSFER);
    expect(fs.inOrbit).toBe(false);
    // Should have two log entries: MANOEUVRE→ORBIT, ORBIT→TRANSFER.
    expect(fs.phaseLog).toHaveLength(2);
    expect(fs.phaseLog[0].to).toBe(FlightPhase.ORBIT);
    expect(fs.phaseLog[1].to).toBe(FlightPhase.TRANSFER);
  });

  it('populates transferState when transfer targets exist', () => {
    vi.mocked(shouldEnterTransfer).mockReturnValue(true);
    vi.mocked(getTransferTargets).mockReturnValue([
      { bodyId: 'MOON', name: 'Moon', departureDV: 800, captureDV: 600, totalDV: 1400, transferTime: 259200 },
    ]);
    vi.mocked(computeTransferDeltaV).mockReturnValue({
      departureDV: 800, captureDV: 600, transferTime: 259200, totalDV: 1400,
    });

    const ps = stubPs({ posY: 200_000, velX: 500, velY: 8000 });
    evaluateAutoTransitions(fs, ps, null);

    expect(fs.transferState).not.toBeNull();
    expect(fs.transferState!.originBodyId).toBe('EARTH');
    expect(fs.transferState!.destinationBodyId).toBe('MOON');
    expect(fs.transferState!.departureDV).toBe(800);
    expect(fs.transferState!.captureDV).toBe(600);
  });

  it('transitions to TRANSFER without transferState when no targets', () => {
    vi.mocked(shouldEnterTransfer).mockReturnValue(true);
    vi.mocked(getTransferTargets).mockReturnValue([]);

    const ps = stubPs({ posY: 200_000, velX: 500, velY: 8000 });
    evaluateAutoTransitions(fs, ps, null);

    expect(fs.phase).toBe(FlightPhase.TRANSFER);
    expect(fs.transferState).toBeNull();
  });

  it('falls through to shouldExitManoeuvre when not an escape trajectory', () => {
    vi.mocked(shouldEnterTransfer).mockReturnValue(false);
    vi.mocked(shouldExitManoeuvre).mockReturnValue(true);
    const mockElements = stubElements({ semiMajorAxis: 6_800_000, eccentricity: 0.02 });
    vi.mocked(computeOrbitalElements).mockReturnValue(mockElements);

    const ps = stubPs({ posX: 100, posY: 200_000, velX: 100, velY: 7800 });
    const transition = evaluateAutoTransitions(fs, ps, null);

    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.ORBIT);
    expect(fs.phase).toBe(FlightPhase.ORBIT);
    expect(fs.orbitalElements).toEqual(mockElements);
  });
});

// ---------------------------------------------------------------------------
// evaluateAutoTransitions — TRANSFER → CAPTURE (SOI transition)
// ---------------------------------------------------------------------------

describe('evaluateAutoTransitions TRANSFER → CAPTURE (SOI transition)', () => {
  let fs: FlightState;

  beforeEach(() => {
    fs = freshFlightState();
    fs.phase = FlightPhase.TRANSFER;
    fs.bodyId = 'EARTH';
    vi.mocked(checkSOITransition).mockReturnValue({ transition: false, newBodyId: null, reason: '' });
  });

  it('transitions TRANSFER → CAPTURE on SOI entry', () => {
    vi.mocked(checkSOITransition).mockReturnValue({
      transition: true,
      newBodyId: 'MOON',
      reason: 'Entering Moon SOI',
    });

    const ps = stubPs({ posY: 380_000_000, velX: 200, velY: 800 });
    const transition = evaluateAutoTransitions(fs, ps, null);

    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.CAPTURE);
    expect(transition!.reason).toBe('Entering Moon SOI');
    expect(fs.phase).toBe(FlightPhase.CAPTURE);
    expect(fs.bodyId).toBe('MOON');
  });

  it('stays in TRANSFER when no SOI transition', () => {
    vi.mocked(checkSOITransition).mockReturnValue({ transition: false, newBodyId: null, reason: '' });

    const ps = stubPs({ posY: 300_000_000, velX: 200, velY: 800 });
    const transition = evaluateAutoTransitions(fs, ps, null);

    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.TRANSFER);
    expect(fs.bodyId).toBe('EARTH');
  });
});

// ---------------------------------------------------------------------------
// evaluateAutoTransitions — CAPTURE → TRANSFER (fly-by)
// ---------------------------------------------------------------------------

describe('evaluateAutoTransitions CAPTURE fly-by path', () => {
  let fs: FlightState;

  beforeEach(() => {
    fs = freshFlightState();
    fs.phase = FlightPhase.CAPTURE;
    fs.bodyId = 'MOON';
    vi.mocked(isEscapeTrajectory).mockReturnValue(false);
  });

  it('enters fly-by branch when escape trajectory detected without valid orbit', () => {
    // NOTE: CAPTURE → TRANSFER is not in the VALID_TRANSITIONS map, so
    // transitionPhase rejects it.  This test verifies the branch is entered
    // (isEscapeTrajectory checked, parent looked up) even though the
    // transition ultimately fails.
    vi.mocked(isEscapeTrajectory).mockReturnValue(true);

    const ps = stubPs({ posY: 100_000, velX: 300, velY: 2000 });
    // No valid orbit, so the CAPTURE→ORBIT path is skipped.
    const transition = evaluateAutoTransitions(fs, ps, null);

    // Transition is blocked by the valid-transition map (CAPTURE→TRANSFER not allowed).
    expect(transition).toBeNull();
    expect(fs.phase).toBe(FlightPhase.CAPTURE);
    // isEscapeTrajectory was called with the correct body.
    expect(isEscapeTrajectory).toHaveBeenCalledWith(ps, 'MOON');
  });

  it('CAPTURE → ORBIT takes priority over fly-by when orbit is valid', () => {
    vi.mocked(isEscapeTrajectory).mockReturnValue(true);

    const orbitStatus = {
      valid: true,
      elements: stubElements({ semiMajorAxis: 2_000_000, eccentricity: 0.1 }),
      periapsisAlt: 50_000,
      apoapsisAlt: 150_000,
      altitudeBand: { id: 'LLO', name: 'Low Lunar Orbit' },
    };
    const ps = stubPs({ posY: 50_000 });
    const transition = evaluateAutoTransitions(fs, ps, orbitStatus);

    expect(transition).not.toBeNull();
    expect(transition!.to).toBe(FlightPhase.ORBIT);
    expect(fs.phase).toBe(FlightPhase.ORBIT);
    expect(fs.inOrbit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isInUnsafeBeltOrbit
// ---------------------------------------------------------------------------

describe('isInUnsafeBeltOrbit', () => {
  beforeEach(() => {
    vi.mocked(getAltitudeBand).mockReturnValue(null);
  });

  it('returns true when altitude band is marked unsafe', () => {
    vi.mocked(getAltitudeBand).mockReturnValue({
      id: 'DENSE_BELT',
      name: 'Dense Asteroid Belt',
      min: 300_000_000_000,
      max: 500_000_000_000,
      unsafe: true,
    });

    expect(isInUnsafeBeltOrbit(400_000_000_000, 'SUN')).toBe(true);
  });

  it('returns false when altitude band is not unsafe', () => {
    vi.mocked(getAltitudeBand).mockReturnValue({
      id: 'OUTER_BELT',
      name: 'Outer Belt',
      min: 500_000_000_000,
      max: 700_000_000_000,
    });

    expect(isInUnsafeBeltOrbit(600_000_000_000, 'SUN')).toBe(false);
  });

  it('returns false when no altitude band is found', () => {
    vi.mocked(getAltitudeBand).mockReturnValue(null);

    expect(isInUnsafeBeltOrbit(100_000, 'EARTH')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getDeorbitWarningMessage — branch coverage
// ---------------------------------------------------------------------------

describe('getDeorbitWarningMessage branch coverage', () => {
  it('returns Moon-specific warning for MOON body', () => {
    const msg = getDeorbitWarningMessage('MOON');
    expect(msg).toContain('lunar orbital model');
    expect(msg).toContain('no longer be visible');
  });

  it('returns default warning for non-MOON bodies', () => {
    const msg = getDeorbitWarningMessage('MARS');
    expect(msg).toContain('orbital model');
    expect(msg).not.toContain('lunar');
  });

  it('returns default warning for EARTH', () => {
    const msg = getDeorbitWarningMessage('EARTH');
    expect(msg).toContain('orbital model');
    expect(msg).not.toContain('lunar');
  });
});

// ---------------------------------------------------------------------------
// canReturnToAgency — branch coverage for TRANSFER, CAPTURE, and belt orbit
// ---------------------------------------------------------------------------

describe('canReturnToAgency branch coverage', () => {
  beforeEach(() => {
    vi.mocked(getAltitudeBand).mockReturnValue(null);
  });

  it('returns false during TRANSFER phase (not landed/crashed)', () => {
    const ps = stubPs({ landed: false, crashed: false });
    expect(canReturnToAgency(FlightPhase.TRANSFER, ps, 'EARTH')).toBe(false);
  });

  it('returns false during CAPTURE phase (not landed/crashed)', () => {
    const ps = stubPs({ landed: false, crashed: false });
    expect(canReturnToAgency(FlightPhase.CAPTURE, ps, 'MOON')).toBe(false);
  });

  it('returns false in ORBIT when in unsafe belt zone', () => {
    vi.mocked(getAltitudeBand).mockReturnValue({
      id: 'DENSE_BELT',
      name: 'Dense Asteroid Belt',
      min: 300_000_000_000,
      max: 500_000_000_000,
      unsafe: true,
    });

    const ps = stubPs({ landed: false, crashed: false, posY: 400_000_000_000 });
    expect(canReturnToAgency(FlightPhase.ORBIT, ps, 'SUN')).toBe(false);
  });

  it('returns true in ORBIT when in safe zone', () => {
    vi.mocked(getAltitudeBand).mockReturnValue({
      id: 'LEO',
      name: 'Low Earth Orbit',
      min: 80_000,
      max: 200_000,
    });

    const ps = stubPs({ landed: false, crashed: false, posY: 100_000 });
    expect(canReturnToAgency(FlightPhase.ORBIT, ps, 'EARTH')).toBe(true);
  });

  it('returns true in ORBIT when no bodyId provided', () => {
    const ps = stubPs({ landed: false, crashed: false, posY: 100_000 });
    expect(canReturnToAgency(FlightPhase.ORBIT, ps)).toBe(true);
  });

  it('allows return during TRANSFER if landed', () => {
    const ps = stubPs({ landed: true, crashed: false });
    expect(canReturnToAgency(FlightPhase.TRANSFER, ps, 'MOON')).toBe(true);
  });

  it('allows return during CAPTURE if crashed', () => {
    const ps = stubPs({ landed: false, crashed: true });
    expect(canReturnToAgency(FlightPhase.CAPTURE, ps, 'MOON')).toBe(true);
  });
});
