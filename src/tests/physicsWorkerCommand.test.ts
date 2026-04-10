/**
 * physicsWorkerCommand.test.ts — Unit tests for the handleCommand() function
 * in physicsWorker.ts.
 *
 * Tests cover:
 *   - init command: rebuilds state, posts 'ready'
 *   - tick command: calls tick + evaluateAutoTransitions, posts snapshot
 *   - setThrottle: clamps to 0–1
 *   - setAngle: updates angle
 *   - stage: calls fireNextStage
 *   - abort: sets flightState.aborted
 *   - keyDown / keyUp: forwarded to physics handlers
 *   - stop: clears state, posts 'stopped'
 *   - error handling: exceptions post error message
 *   - commands before init: no crash (null state guard)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the heavy core imports before importing handleCommand.
vi.mock('../core/physics.ts', () => ({
  tick: vi.fn(),
  handleKeyDown: vi.fn(),
  handleKeyUp: vi.fn(),
  fireNextStage: vi.fn(),
}));

vi.mock('../core/flightPhase.ts', () => ({
  evaluateAutoTransitions: vi.fn(),
}));

vi.mock('../core/orbit.ts', () => ({
  checkOrbitStatus: vi.fn(() => ({ inOrbit: false, bodyId: 'EARTH' })),
}));

import { handleCommand } from '../core/physicsWorker.ts';
import { tick, handleKeyDown, handleKeyUp, fireNextStage } from '../core/physics.ts';
import { evaluateAutoTransitions } from '../core/flightPhase.ts';
import { checkOrbitStatus } from '../core/orbit.ts';
import type {
  PhysicsSnapshot,
  FlightSnapshot,
  SerialisedAssembly,
  SerialisedStagingConfig,
  WorkerMessage,
  InitCommand,
  SnapshotMessage,
  ErrorMessage,
} from '../core/physicsWorkerProtocol.ts';

// ---------------------------------------------------------------------------
// Test helpers — minimal valid state objects
// ---------------------------------------------------------------------------

function makePhysicsSnapshot(overrides: Partial<PhysicsSnapshot> = {}): PhysicsSnapshot {
  return {
    posX: 0, posY: 1000, velX: 0, velY: 100,
    angle: 0, throttle: 1.0,
    throttleMode: 'absolute', targetTWR: 1.5,
    firingEngines: ['e1'], fuelStore: { 't1': 500 },
    activeParts: ['e1', 't1', 'cmd1'], deployedParts: [],
    parachuteStates: {}, legStates: {},
    ejectorStates: {}, ejectedCrewIds: [], ejectedCrew: [],
    instrumentStates: {}, scienceModuleStates: {},
    heatMap: {}, debris: [],
    landed: false, crashed: false, grounded: false,
    angularVelocity: 0, isTipping: false,
    tippingContactX: 0, tippingContactY: 0,
    controlMode: 'NORMAL',
    baseOrbit: null, dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0, dockingOffsetRadial: 0,
    rcsActiveDirections: [], dockingPortStates: {},
    weatherIspModifier: 1.0, weatherWindSpeed: 0, weatherWindAngle: 0,
    hasLaunchClamps: false,
    powerState: null, malfunctions: null,
    capturedBody: null, thrustAligned: false,
    ...overrides,
  };
}

function makeFlightSnapshot(overrides: Partial<FlightSnapshot> = {}): FlightSnapshot {
  return {
    missionId: 'm1', rocketId: 'r1',
    crewIds: [], crewCount: 0,
    timeElapsed: 0, altitude: 1000, velocity: 100,
    horizontalVelocity: 0,
    fuelRemaining: 500, deltaVRemaining: 3000,
    events: [], aborted: false,
    phase: 'FLIGHT', phaseLog: [],
    inOrbit: false, orbitalElements: null,
    bodyId: 'EARTH', orbitBandId: null,
    currentBiome: null, biomesVisited: [],
    maxAltitude: 1000, maxVelocity: 100,
    dockingState: null, transferState: null,
    powerState: null, commsState: null,
    ...overrides,
  };
}

function makeAssembly(): SerialisedAssembly {
  return {
    parts: {
      cmd1: { instanceId: 'cmd1', partId: 'command-pod', x: 0, y: 100 },
      t1: { instanceId: 't1', partId: 'fuel-tank', x: 0, y: 50 },
      e1: { instanceId: 'e1', partId: 'engine', x: 0, y: 0 },
    },
    connections: [
      { fromInstanceId: 'cmd1', fromSnapIndex: 0, toInstanceId: 't1', toSnapIndex: 1 },
    ],
    _nextId: 4,
    symmetryPairs: [],
  };
}

function makeStagingConfig(): SerialisedStagingConfig {
  return {
    stages: [{ instanceIds: ['e1'] }],
    unstaged: [],
    currentStageIdx: 0,
  };
}

function makeInitCommand(): InitCommand {
  return {
    type: 'init',
    partsCatalog: [],
    bodiesCatalog: {},
    physicsState: makePhysicsSnapshot(),
    flightState: makeFlightSnapshot(),
    assembly: makeAssembly(),
    stagingConfig: makeStagingConfig(),
  };
}

/** Collect messages posted by handleCommand. */
function collectMessages(): { messages: WorkerMessage[]; post: (msg: WorkerMessage) => void } {
  const messages: WorkerMessage[] = [];
  return { messages, post: (msg) => messages.push(msg) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleCommand — init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Send a stop to clear any prior state.
    handleCommand({ type: 'stop' }, () => {});
  });

  it('posts a ready message after init', () => {
    const { messages, post } = collectMessages();
    handleCommand(makeInitCommand(), post);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('ready');
  });

  it('sets up internal state so tick commands work', () => {
    const { messages, post } = collectMessages();
    handleCommand(makeInitCommand(), post);
    messages.length = 0;

    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(tick).toHaveBeenCalledOnce();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('snapshot');
  });
});

describe('handleCommand — tick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});
  });

  it('calls tick with correct arguments', () => {
    const { post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 4 }, post);

    expect(tick).toHaveBeenCalledOnce();
    const args = vi.mocked(tick).mock.calls[0];
    expect(args[4]).toBe(0.016); // realDeltaTime
    expect(args[5]).toBe(4);     // timeWarp
  });

  it('calls evaluateAutoTransitions after tick', () => {
    const { post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(evaluateAutoTransitions).toHaveBeenCalledOnce();
  });

  it('calls checkOrbitStatus with physics position and velocity', () => {
    const { post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(checkOrbitStatus).toHaveBeenCalledOnce();
  });

  it('posts a snapshot message with incrementing frame counter', () => {
    const { messages, post } = collectMessages();

    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('snapshot');
    expect((messages[0] as SnapshotMessage).frame).toBe(1);
    expect((messages[1] as SnapshotMessage).frame).toBe(2);
  });

  it('snapshot contains physics and flight data', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    const snap = messages[0] as SnapshotMessage;
    expect(snap.type).toBe('snapshot');
    expect(snap.physics).toBeDefined();
    expect(snap.flight).toBeDefined();
    expect(typeof snap.physics.posX).toBe('number');
    expect(typeof snap.flight.timeElapsed).toBe('number');
  });
});

describe('handleCommand — setThrottle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});
  });

  it('clamps throttle to [0, 1] — value within range', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'setThrottle', throttle: 0.5 }, post);
    // Verify by ticking and checking the snapshot.
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);
    expect((messages[0] as SnapshotMessage).physics.throttle).toBe(0.5);
  });

  it('clamps throttle below 0 to 0', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'setThrottle', throttle: -0.5 }, post);
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);
    expect((messages[0] as SnapshotMessage).physics.throttle).toBe(0);
  });

  it('clamps throttle above 1 to 1', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'setThrottle', throttle: 1.5 }, post);
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);
    expect((messages[0] as SnapshotMessage).physics.throttle).toBe(1);
  });
});

describe('handleCommand — setAngle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});
  });

  it('updates the physics angle', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'setAngle', angle: 1.57 }, post);
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);
    expect((messages[0] as SnapshotMessage).physics.angle).toBe(1.57);
  });
});

describe('handleCommand — stage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});
  });

  it('calls fireNextStage', () => {
    handleCommand({ type: 'stage' }, () => {});
    expect(fireNextStage).toHaveBeenCalledOnce();
  });
});

describe('handleCommand — abort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});
  });

  it('sets flightState.aborted to true', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'abort' }, post);
    // Verify through a tick snapshot.
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);
    expect((messages[0] as SnapshotMessage).flight.aborted).toBe(true);
  });
});

describe('handleCommand — keyDown / keyUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});
  });

  it('keyDown forwards to handleKeyDown', () => {
    handleCommand({ type: 'keyDown', key: 'w' }, () => {});
    expect(handleKeyDown).toHaveBeenCalledOnce();
    expect(vi.mocked(handleKeyDown).mock.calls[0][2]).toBe('w');
  });

  it('keyUp forwards to handleKeyUp', () => {
    handleCommand({ type: 'keyUp', key: 'w' }, () => {});
    expect(handleKeyUp).toHaveBeenCalledOnce();
    expect(vi.mocked(handleKeyUp).mock.calls[0][1]).toBe('w');
  });
});

describe('handleCommand — stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Init first so there is state to clear.
    handleCommand(makeInitCommand(), () => {});
  });

  it('posts a stopped message', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'stop' }, post);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('stopped');
  });

  it('clears state so tick is a no-op after stop', () => {
    handleCommand({ type: 'stop' }, () => {});
    vi.clearAllMocks();

    const { messages, post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(tick).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it('resets frame counter (re-init starts at frame 1)', () => {
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});

    const { messages, post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);
    expect((messages[0] as SnapshotMessage).frame).toBe(1);
  });
});

describe('handleCommand — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
    handleCommand(makeInitCommand(), () => {});
  });

  it('posts an error message when tick throws', () => {
    vi.mocked(tick).mockImplementationOnce(() => { throw new Error('physics exploded'); });

    const { messages, post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
    expect((messages[0] as ErrorMessage).message).toBe('physics exploded');
    expect((messages[0] as ErrorMessage).stack).toBeDefined();
  });

  it('posts an error message when fireNextStage throws', () => {
    vi.mocked(fireNextStage).mockImplementationOnce(() => { throw new Error('staging failed'); });

    const { messages, post } = collectMessages();
    handleCommand({ type: 'stage' }, post);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
    expect((messages[0] as ErrorMessage).message).toBe('staging failed');
  });

  it('handles non-Error thrown values', () => {
    vi.mocked(tick).mockImplementationOnce(() => { throw Object.assign(Object.create(null), { toString: () => 'custom thrown' }); });

    const { messages, post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(messages[0].type).toBe('error');
    // Non-Error value is stringified; stack is undefined.
    expect((messages[0] as ErrorMessage).stack).toBeUndefined();
  });
});

describe('handleCommand — commands before init (null state)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleCommand({ type: 'stop' }, () => {});
  });

  it('tick is a no-op when state is null', () => {
    const { messages, post } = collectMessages();
    handleCommand({ type: 'tick', realDeltaTime: 0.016, timeWarp: 1 }, post);

    expect(tick).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });

  it('setThrottle does not crash when ps is null', () => {
    expect(() => {
      handleCommand({ type: 'setThrottle', throttle: 0.5 }, () => {});
    }).not.toThrow();
  });

  it('stage does not crash when state is null', () => {
    expect(() => {
      handleCommand({ type: 'stage' }, () => {});
    }).not.toThrow();
  });

  it('abort does not crash when flightState is null', () => {
    expect(() => {
      handleCommand({ type: 'abort' }, () => {});
    }).not.toThrow();
  });

  it('keyDown does not crash when ps is null', () => {
    expect(() => {
      handleCommand({ type: 'keyDown', key: 'w' }, () => {});
    }).not.toThrow();
  });

  it('keyUp does not crash when ps is null', () => {
    expect(() => {
      handleCommand({ type: 'keyUp', key: 'w' }, () => {});
    }).not.toThrow();
  });

  it('setAngle does not crash when ps is null', () => {
    expect(() => {
      handleCommand({ type: 'setAngle', angle: 1.0 }, () => {});
    }).not.toThrow();
  });
});
