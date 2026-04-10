/**
 * _factories.ts -- Typed factory functions for common test mock objects.
 *
 * Each factory returns a fully-typed object with sensible defaults.
 * Pass a `Partial<T>` overrides argument to customise individual fields.
 *
 * Usage:
 *   import { makePhysicsState, makeGameState } from './_factories.ts';
 *   const ps = makePhysicsState({ posX: 100, velY: -50 });
 */

import type {
  FlightState,
  GameState,
  CrewMember,
  MissionInstance,
} from '../core/gameState.ts';

import type { PhysicsState } from '../core/physics.ts';

import {
  AstronautStatus,
  ControlMode,
  FlightPhase,
  GameMode,
  MalfunctionMode,
  MissionState,
  STARTING_MONEY,
  STARTING_LOAN_BALANCE,
  DEFAULT_LOAN_INTEREST_RATE,
  STARTING_REPUTATION,
  DEFAULT_DIFFICULTY_SETTINGS,
  FACILITY_DEFINITIONS,
} from '../core/constants.ts';

import type {
  CelestialBody,
  DifficultySettings,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// PhysicsState factory (77 casts in tests)
// ---------------------------------------------------------------------------

/**
 * Create a PhysicsState with sensible launch-pad defaults.
 * All Set/Map fields are initialised to empty collections.
 */
export function makePhysicsState(overrides: Partial<PhysicsState> = {}): PhysicsState {
  return {
    posX: 0,
    posY: 0,
    velX: 0,
    velY: 0,
    angle: 0,
    throttle: 1.0,
    throttleMode: 'twr',
    targetTWR: 1.1,
    firingEngines: new Set<string>(),
    fuelStore: new Map<string, number>(),
    activeParts: new Set<string>(),
    deployedParts: new Set<string>(),
    parachuteStates: new Map(),
    legStates: new Map(),
    ejectorStates: new Map(),
    ejectedCrewIds: new Set<string>(),
    ejectedCrew: [],
    instrumentStates: new Map(),
    scienceModuleStates: new Map(),
    heatMap: new Map(),
    debris: [],
    landed: false,
    crashed: false,
    grounded: true,
    angularVelocity: 0,
    isTipping: false,
    tippingContactX: 0,
    tippingContactY: 0,
    _heldKeys: new Set<string>(),
    _accumulator: 0,
    controlMode: ControlMode.NORMAL,
    baseOrbit: null,
    dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0,
    dockingOffsetRadial: 0,
    rcsActiveDirections: new Set<string>(),
    dockingPortStates: new Map(),
    _dockedCombinedMass: 0,
    capturedBody: null,
    thrustAligned: false,
    weatherIspModifier: 1.0,
    weatherWindSpeed: 0,
    weatherWindAngle: 0,
    hasLaunchClamps: false,
    powerState: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GameState factory (22 casts in tests)
// ---------------------------------------------------------------------------

/**
 * Create a full GameState with new-game defaults.
 * Mirrors `createGameState()` from gameState.ts but is a plain object suitable
 * for spreading with overrides.
 */
export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  return {
    agencyName: '',
    money: STARTING_MONEY,
    loan: {
      balance: STARTING_LOAN_BALANCE,
      interestRate: DEFAULT_LOAN_INTEREST_RATE,
      totalInterestAccrued: 0,
    },
    crew: [],
    missions: {
      available: [],
      accepted: [],
      completed: [],
    },
    rockets: [],
    savedDesigns: [],
    parts: [],
    flightHistory: [],
    currentPeriod: 0,
    playTimeSeconds: 0,
    flightTimeSeconds: 0,
    currentFlight: null,
    orbitalObjects: [],
    vabAssembly: null,
    vabStagingConfig: null,
    tutorialMode: true,
    gameMode: GameMode.TUTORIAL,
    sandboxSettings: null,
    difficultySettings: { ...DEFAULT_DIFFICULTY_SETTINGS } as DifficultySettings,
    facilities: Object.fromEntries(
      FACILITY_DEFINITIONS
        .filter((f) => f.starter)
        .map((f) => [f.id, { built: true, tier: 1 }]),
    ),
    contracts: {
      board: [],
      active: [],
      completed: [],
      failed: [],
    },
    reputation: STARTING_REPUTATION,
    sciencePoints: 0,
    scienceLog: [],
    techTree: {
      researched: [],
      unlockedInstruments: [],
    },
    satelliteNetwork: {
      satellites: [],
    },
    partInventory: [],
    weather: null,
    surfaceItems: [],
    achievements: [],
    challenges: {
      active: null,
      results: {},
    },
    customChallenges: [],
    fieldCraft: [],
    welcomeShown: false,
    malfunctionMode: MalfunctionMode.NORMAL,
    autoSaveEnabled: true,
    debugMode: false,
    showPerfDashboard: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// MissionInstance factory (20 casts in tests)
// ---------------------------------------------------------------------------

/**
 * Create a MissionInstance with AVAILABLE defaults.
 */
export function makeMissionInstance(overrides: Partial<MissionInstance> = {}): MissionInstance {
  return {
    id: 'mission-test-1',
    title: 'Test Mission',
    description: 'A test mission.',
    reward: 100_000,
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
    state: MissionState.AVAILABLE,
    requirements: {},
    acceptedDate: null,
    completedDate: null,
    objectives: [],
    unlockedParts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FlightState factory (20 casts in tests)
// ---------------------------------------------------------------------------

/**
 * Create a FlightState with pre-launch defaults.
 */
export function makeFlightState(overrides: Partial<FlightState> = {}): FlightState {
  return {
    missionId: 'mission-test-1',
    rocketId: 'rocket-test-1',
    crewIds: [],
    crewCount: 0,
    timeElapsed: 0,
    altitude: 0,
    velocity: 0,
    horizontalVelocity: 0,
    fuelRemaining: 0,
    deltaVRemaining: 0,
    events: [],
    aborted: false,
    phase: FlightPhase.PRELAUNCH,
    phaseLog: [],
    inOrbit: false,
    orbitalElements: null,
    bodyId: 'EARTH' as CelestialBody,
    orbitBandId: null,
    currentBiome: null,
    biomesVisited: [],
    maxAltitude: 0,
    maxVelocity: 0,
    dockingState: null,
    transferState: null,
    powerState: null,
    commsState: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PixiJS Graphics (18 casts in tests)
// ---------------------------------------------------------------------------

/** Minimal shape matching the PixiJS Graphics API surface used in tests. */
export interface MockGraphicsShape {
  visible: boolean;
  alpha: number;
  position: { set: (...args: number[]) => void };
  scale: { set: (...args: number[]) => void };
  rotation: number;
  label: string;
  parent: unknown;
  clear: () => MockGraphicsShape;
  rect: (...args: number[]) => MockGraphicsShape;
  fill: (color?: unknown) => MockGraphicsShape;
  stroke: (style?: unknown) => MockGraphicsShape;
  circle: (...args: number[]) => MockGraphicsShape;
  moveTo: (x: number, y: number) => MockGraphicsShape;
  lineTo: (x: number, y: number) => MockGraphicsShape;
  closePath: () => MockGraphicsShape;
  ellipse: (...args: number[]) => MockGraphicsShape;
}

/**
 * Create a mock PixiJS Graphics object.
 * Every drawing method is a no-op that returns `this` for chaining.
 * Pass as `makeGraphics() as unknown as Graphics` where the PixiJS type is needed.
 */
export function makeGraphics(overrides: Partial<MockGraphicsShape> = {}): MockGraphicsShape {
  const gfx: MockGraphicsShape = {
    visible: true,
    alpha: 1,
    position: { set: () => {} },
    scale: { set: () => {} },
    rotation: 0,
    label: '',
    parent: null,
    clear: () => gfx,
    rect: () => gfx,
    fill: () => gfx,
    stroke: () => gfx,
    circle: () => gfx,
    moveTo: () => gfx,
    lineTo: () => gfx,
    closePath: () => gfx,
    ellipse: () => gfx,
    ...overrides,
  };
  return gfx;
}

// ---------------------------------------------------------------------------
// RecoveryPS factory (16 casts in tests)
// ---------------------------------------------------------------------------

/**
 * The subset of PhysicsState fields used by `attemptRecovery()` in malfunction.ts.
 * Using `Pick` from PhysicsState plus the optional `_gameState` field.
 */
export interface RecoveryPSShape {
  malfunctions: Map<string, { type: string; recovered: boolean }>;
  firingEngines: Set<string>;
  _gameState?: { malfunctionMode: string } | null;
}

/**
 * Create a mock recovery-compatible physics state for malfunction tests.
 */
export function makeRecoveryPS(overrides: Partial<RecoveryPSShape> = {}): RecoveryPSShape {
  return {
    malfunctions: new Map(),
    firingEngines: new Set<string>(),
    _gameState: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CrewMember factory (16 casts in tests)
// ---------------------------------------------------------------------------

/**
 * Create a CrewMember with active-astronaut defaults.
 */
export function makeCrewMember(overrides: Partial<CrewMember> = {}): CrewMember {
  return {
    id: 'crew-test-1',
    name: 'Test Astronaut',
    status: AstronautStatus.ACTIVE,
    skills: { piloting: 50, engineering: 50, science: 50 },
    salary: 5_000,
    hireDate: new Date().toISOString(),
    missionsFlown: 0,
    flightsFlown: 0,
    deathDate: null,
    deathCause: null,
    assignedRocketId: null,
    injuryEnds: null,
    trainingSkill: null,
    trainingEnds: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock DOM element (13 casts in tests)
// ---------------------------------------------------------------------------

/** Minimal shape matching the HTMLElement API surface used in tests. */
export interface MockElementShape {
  style: { cssText: string; [prop: string]: string };
  textContent: string;
  innerHTML: string;
  dataset: Record<string, string>;
  children: MockElementShape[];
  className: string;
  classList: {
    add: (...classes: string[]) => void;
    remove: (...classes: string[]) => void;
    contains: (cls: string) => boolean;
    toggle: (cls: string) => void;
  };
  appendChild: (child: MockElementShape) => MockElementShape;
  removeChild: (child: MockElementShape) => MockElementShape;
  remove: () => void;
  addEventListener: (type: string, listener: unknown) => void;
  removeEventListener: (type: string, listener: unknown) => void;
  querySelector: (selector: string) => MockElementShape | null;
  querySelectorAll: (selector: string) => MockElementShape[];
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  id: string;
  tagName: string;
}

/**
 * Create a mock DOM element.
 * Pass as `makeMockElement() as unknown as HTMLElement` where the real type is needed.
 */
export function makeMockElement(overrides: Partial<MockElementShape> = {}): MockElementShape {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const el: MockElementShape = {
    style: { cssText: '' },
    textContent: '',
    innerHTML: '',
    dataset: {},
    children: [],
    className: '',
    classList: {
      add: (...cls: string[]) => { for (const c of cls) classes.add(c); },
      remove: (...cls: string[]) => { for (const c of cls) classes.delete(c); },
      contains: (cls: string) => classes.has(cls),
      toggle: (cls: string) => { if (classes.has(cls)) classes.delete(cls); else classes.add(cls); },
    },
    appendChild: (child: MockElementShape) => { el.children.push(child); return child; },
    removeChild: (child: MockElementShape) => {
      const idx = el.children.indexOf(child);
      if (idx >= 0) el.children.splice(idx, 1);
      return child;
    },
    remove: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attrs.set(name, value); },
    removeAttribute: (name: string) => { attrs.delete(name); },
    id: '',
    tagName: 'DIV',
    ...overrides,
  };
  return el;
}
