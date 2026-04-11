/**
 * _factories.ts -- Typed factory functions for common test mock objects.
 *
 * Each factory returns a fully-typed object with sensible defaults.
 * Pass a `Partial<T>` overrides argument to customise individual fields.
 *
 * Usage:
 *   import { makePhysicsState, makeGameState } from './_factories.ts';
 *   const ps = makePhysicsState({ posX: 100, velY: -50 });
 *
 * ---------------------------------------------------------------------------
 * Factory index — which types each factory covers:
 * ---------------------------------------------------------------------------
 *   makePhysicsState()      → PhysicsState          (from physics.ts)
 *   makeGameState()         → GameState             (from gameState.ts)
 *   makeMissionInstance()   → MissionInstance        (from gameState.ts)
 *   makeFlightState()       → FlightState           (from gameState.ts)
 *   makeGraphics()          → MockGraphicsShape      (PixiJS Graphics mock)
 *   makeRecoveryPS()        → RecoveryPSShape        (malfunction recovery subset)
 *   makeCrewMember()        → CrewMember             (from gameState.ts)
 *   makeMockElement()       → MockElementShape       (HTMLElement mock)
 *   makeDebrisState()       → DebrisState            (from staging.ts)
 *   makePartDef()           → PartDef                (from data/parts.ts)
 *   makeOrbitalElements()   → OrbitalElements        (from gameState.ts)
 *   makeObjectiveDef()      → ObjectiveDef           (from gameState.ts)
 *   makeRocketDesign()      → RocketDesign           (from gameState.ts)
 *   makeRocketAssembly()    → RocketAssembly         (from physics.ts)
 *   makeMockContainer()     → MockContainerShape     (PixiJS Container mock)
 *   makeMalfunctionPS()     → MalfunctionPSShape     (PhysicsState + malfunction fields)
 *   makeOrbitalObject()     → OrbitalObject           (from gameState.ts)
 *   makeSepDebris()         → SepDebrisShape          (DebrisLike param for applySeparationImpulse)
 *   makeFlightResult()      → FlightResult            (from gameState.ts)
 *   makeStagingConfig()     → StagingConfig           (from rocketbuilder.ts)
 *   makeContract()          → Contract                (from gameState.ts)
 * ---------------------------------------------------------------------------
 */

import type {
  FlightState,
  GameState,
  CrewMember,
  MissionInstance,
  OrbitalElements,
  OrbitalObject,
  ObjectiveDef,
  RocketDesign,
  FlightResult,
  Contract,
} from '../core/gameState.ts';

import type { PhysicsState, RocketAssembly } from '../core/physics.ts';

import type { DebrisState } from '../core/staging.ts';

import type { PartDef } from '../data/parts.ts';

import type { StagingConfig } from '../core/rocketbuilder.ts';

import {
  AstronautStatus,
  ContractCategory,
  ControlMode,
  FlightOutcome,
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
    miningSites: [],
    provenLegs: [],
    routes: [],
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

// ---------------------------------------------------------------------------
// DebrisState factory (15 casts in tests — collision.test.ts)
// Also usable for SepDebrisParam / DebrisLike (6 casts)
// ---------------------------------------------------------------------------

/**
 * Create a DebrisState (stage-separated fragment) with sensible defaults.
 * DebrisState is a superset of the DebrisLike shape used by
 * `applySeparationImpulse`, so this factory satisfies both types.
 */
export function makeDebrisState(overrides: Partial<DebrisState> = {}): DebrisState {
  return {
    id: 'debris-test-1',
    activeParts: new Set<string>(),
    firingEngines: new Set<string>(),
    fuelStore: new Map<string, number>(),
    deployedParts: new Set<string>(),
    parachuteStates: new Map(),
    legStates: new Map(),
    heatMap: new Map<string, number>(),
    posX: 0,
    posY: 0,
    velX: 0,
    velY: 0,
    angle: 0,
    throttle: 1.0,
    angularVelocity: 0,
    isTipping: false,
    tippingContactX: 0,
    tippingContactY: 0,
    landed: false,
    crashed: false,
    collisionCooldown: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PartDef factory (7 casts in tests — fuelsystem.test.ts)
// ---------------------------------------------------------------------------

/**
 * Create a PartDef (part catalog entry) with sensible defaults.
 * Defaults to a generic command-module-style part.
 */
export function makePartDef(overrides: Partial<PartDef> = {}): PartDef {
  return {
    id: 'test-part-1',
    name: 'Test Part',
    description: 'A test part.',
    type: 'COMMAND_MODULE',
    mass: 50,
    cost: 1000,
    width: 40,
    height: 40,
    snapPoints: [],
    animationStates: [],
    activatable: false,
    activationBehaviour: 'NONE',
    properties: {},
    reliability: 1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// OrbitalElements factory (4 casts in tests — ui-mapView.test.ts)
// ---------------------------------------------------------------------------

/**
 * Create OrbitalElements for a near-circular LEO orbit by default.
 */
export function makeOrbitalElements(overrides: Partial<OrbitalElements> = {}): OrbitalElements {
  return {
    semiMajorAxis: 6_771_000,
    eccentricity: 0,
    argPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ObjectiveDef factory (4 casts in tests — contracts.test.ts, mccTiers.test.ts)
// ---------------------------------------------------------------------------

/**
 * Create an ObjectiveDef (mission objective) with sensible defaults.
 */
export function makeObjectiveDef(overrides: Partial<ObjectiveDef> = {}): ObjectiveDef {
  return {
    id: 'obj-test-1',
    type: 'REACH_ALTITUDE',
    target: { altitude: 100_000 },
    completed: false,
    description: 'Reach the target altitude.',
    optional: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RocketDesign factory (4 casts in tests — saveload.test.ts)
// ---------------------------------------------------------------------------

/**
 * Create a RocketDesign (saved rocket blueprint) with sensible defaults.
 */
export function makeRocketDesign(overrides: Partial<RocketDesign> = {}): RocketDesign {
  return {
    id: 'design-test-1',
    name: 'Test Rocket',
    parts: [],
    staging: { stages: [[]], unstaged: [] },
    totalMass: 100,
    totalThrust: 50,
    createdDate: new Date().toISOString(),
    updatedDate: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// RocketAssembly factory (5 casts in tests — controlMode.test.ts,
// workerBridgeTimeout.test.ts)
// ---------------------------------------------------------------------------

/**
 * Create a RocketAssembly with empty part maps and connections.
 * For tests that need actual parts, use `createRocketAssembly()` +
 * `addPartToAssembly()` from rocketbuilder.ts instead.
 */
export function makeRocketAssembly(overrides: Partial<RocketAssembly> = {}): RocketAssembly {
  return {
    parts: new Map(),
    connections: [],
    _nextId: 1,
    symmetryPairs: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock PixiJS Container (11 casts across render-ground, render-sky, pool,
// render-flight-pool tests)
// ---------------------------------------------------------------------------

/** Minimal shape matching the PixiJS Container API surface used in tests. */
export interface MockContainerShape {
  children: Array<MockGraphicsShape | MockContainerShape>;
  addChild: (...items: Array<MockGraphicsShape | MockContainerShape>) => void;
  removeChild: (child: MockGraphicsShape | MockContainerShape) => MockGraphicsShape | MockContainerShape;
  removeChildAt: (index: number) => MockGraphicsShape | MockContainerShape;
  removeChildren: () => void;
  visible: boolean;
  alpha: number;
  position: { set: (...args: number[]) => void };
  scale: { set: (...args: number[]) => void };
  label: string;
}

/**
 * Create a mock PixiJS Container object.
 * Pass as `makeMockContainer() as unknown as Container` where the PixiJS type is needed.
 */
export function makeMockContainer(overrides: Partial<MockContainerShape> = {}): MockContainerShape {
  const container: MockContainerShape = {
    children: [],
    addChild: (...items) => {
      for (const item of items) container.children.push(item);
    },
    removeChild: (child) => {
      const idx = container.children.indexOf(child);
      if (idx >= 0) container.children.splice(idx, 1);
      return child;
    },
    removeChildAt: (index) => {
      return container.children.splice(index, 1)[0];
    },
    removeChildren: () => {
      container.children.length = 0;
    },
    visible: true,
    alpha: 1,
    position: { set: () => {} },
    scale: { set: () => {} },
    label: '',
    ...overrides,
  };
  return container;
}

// ---------------------------------------------------------------------------
// MalfunctionPS factory (3 casts in tests — branchCoverage.test.ts)
// PhysicsState extended with malfunction-specific optional fields.
// ---------------------------------------------------------------------------

/**
 * Shape for a physics state augmented with malfunction tracking fields.
 * Extends the core PhysicsState fields that `checkMalfunctions()` and
 * `attemptRecovery()` read/write. The extra `malfunctionChecked` field
 * is part of the internal `PhysicsStateWithMalfunctions` type in
 * malfunction.ts (not exported, so we mirror it here).
 */
export interface MalfunctionPSShape extends PhysicsState {
  malfunctionChecked?: Set<string>;
  _lastBiomeForMalfunction?: string | null;
}

/**
 * Create a PhysicsState augmented with malfunction-tracking fields.
 * Use this when testing `checkMalfunctions()`, `attemptRecovery()`, etc.
 */
export function makeMalfunctionPS(overrides: Partial<MalfunctionPSShape> = {}): MalfunctionPSShape {
  return {
    ...makePhysicsState(),
    malfunctions: new Map(),
    malfunctionChecked: new Set<string>(),
    _lastBiomeForMalfunction: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// OrbitalObject factory (4 casts in tests — saveload.test.ts, ui-mapView.test.ts)
// Used when constructing GameState['orbitalObjects'] arrays.
// ---------------------------------------------------------------------------

/**
 * Create an OrbitalObject (satellite, debris, asteroid in orbit) with sensible
 * defaults for a circular LEO satellite.
 */
export function makeOrbitalObject(overrides: Partial<OrbitalObject> = {}): OrbitalObject {
  return {
    id: 'orbital-test-1',
    bodyId: 'EARTH',
    type: 'SATELLITE',
    name: 'Test Satellite',
    elements: makeOrbitalElements(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SepDebris / DebrisLike factory (6 casts in tests — collision.test.ts)
// DebrisLike is the second parameter type of `applySeparationImpulse()`.
// The interface is not exported from collision.ts, so we mirror it here.
// ---------------------------------------------------------------------------

/**
 * Minimal shape matching the `DebrisLike` interface used by
 * `applySeparationImpulse()` in collision.ts. Since `DebrisLike` is not
 * exported, we define this mirror interface to keep the factory fully typed.
 */
export interface SepDebrisShape {
  activeParts: Set<string>;
  fuelStore: Map<string, number>;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  angle: number;
  angularVelocity: number;
  landed: boolean;
  crashed: boolean;
  collisionCooldown?: number;
}

/**
 * Create a DebrisLike object suitable for passing to `applySeparationImpulse()`.
 * Also includes an optional `id` field used by most test debris objects.
 *
 * Usage:
 *   const debris = makeSepDebris({ posY: 1000, activeParts: new Set(['p1']) });
 *   applySeparationImpulse(ps, debris as SepDebrisParam, assembly);
 */
export function makeSepDebris(overrides: Partial<SepDebrisShape & { id: string }> = {}): SepDebrisShape & { id: string } {
  return {
    id: 'sep-debris-test-1',
    activeParts: new Set<string>(),
    fuelStore: new Map<string, number>(),
    posX: 0,
    posY: 0,
    velX: 0,
    velY: 0,
    angle: 0,
    angularVelocity: 0,
    landed: false,
    crashed: false,
    collisionCooldown: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FlightResult factory (2 casts in tests — saveload.test.ts)
// Well-defined exported type worth factoring despite low cast count.
// ---------------------------------------------------------------------------

/**
 * Create a FlightResult with sensible defaults for a successful mission.
 */
export function makeFlightResult(overrides: Partial<FlightResult> = {}): FlightResult {
  return {
    id: 'flight-test-1',
    missionId: 'mission-test-1',
    rocketId: 'rocket-test-1',
    crewIds: [],
    launchDate: new Date().toISOString(),
    outcome: FlightOutcome.SUCCESS,
    deltaVUsed: 1500,
    revenue: 10_000,
    notes: 'Test flight completed.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// StagingConfig factory (1 cast + local helper in workerBridgeTimeout.test.ts)
// Well-defined exported type worth factoring for consistency.
// ---------------------------------------------------------------------------

/**
 * Create a StagingConfig with empty stages at index 0.
 */
export function makeStagingConfig(overrides: Partial<StagingConfig> = {}): StagingConfig {
  return {
    stages: [],
    unstaged: [],
    currentStageIdx: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Contract factory (3 casts in tests — saveload.test.ts)
// ---------------------------------------------------------------------------

/**
 * Create a Contract with sensible defaults for testing.
 */
export function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 'contract-test-1',
    title: 'Test Contract',
    description: 'A test contract.',
    category: ContractCategory.ALTITUDE_RECORD,
    objectives: [],
    reward: 10_000,
    penaltyFee: 5_000,
    reputationReward: 10,
    reputationPenalty: 5,
    deadlinePeriod: null,
    boardExpiryPeriod: 10,
    generatedPeriod: 0,
    acceptedPeriod: null,
    chainId: null,
    chainPart: null,
    chainTotal: null,
    ...overrides,
  };
}
