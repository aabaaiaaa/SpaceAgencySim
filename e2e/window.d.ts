/**
 * Window augmentations for E2E testing.
 *
 * These mirror the source declarations in:
 *   - src/main.ts
 *   - src/ui/flightController/_init.ts
 *   - src/ui/vab/_init.ts
 *
 * The E2E tsconfig includes this file. The root tsconfig does NOT
 * (its include is src/**), so there is no merge conflict.
 *
 * Uses import() type syntax to reference source types without pulling
 * in the entire application — only lightweight core/data modules.
 */

type _GameState = import('../src/core/gameState').GameState;
type _FlightState = import('../src/core/gameState').FlightState;
type _PhysicsState = import('../src/core/physics').PhysicsState;
type _RocketAssembly = import('../src/core/rocketbuilder').RocketAssembly;
type _StagingConfig = import('../src/core/rocketbuilder').StagingConfig;
type _TransferObject = import('../src/core/transferObjects').TransferObject;
type _CelestialBodyDef = import('../src/data/bodies').CelestialBodyDef;

interface _E2eFlightOpts {
  instruments?: Record<string, string[]>;
  staging?: Array<{ partIds: string[] }>;
  missionId?: string;
  crewIds?: string[];
  bodyId?: string;
  malfunctionMode?: string;
}

declare global {
  interface Window {
    // -- From src/main.ts --
    __gameState: _GameState;
    __e2eStartFlight: (partIds: string[], opts?: _E2eFlightOpts) => void;
    __plantFlag: () => unknown;
    __collectSample: () => unknown;
    __deployInstrument: () => unknown;
    __deployBeacon: (name: string) => unknown;
    __processSurfaceOps: () => { scienceEarned: number };
    __processSampleReturns: (bodyId: string) => unknown;
    __areSurfaceItemsVisible: (bodyId: string) => boolean;
    __checkAchievements: (ctx: unknown) => unknown;
    __computeTransferDeltaV: (from: string, to: string, alt: number) => unknown;
    __celestialBodies: Readonly<Record<string, Readonly<_CelestialBodyDef>>>;
    __isLandable: (bodyId: string) => boolean;
    __getPartById: (id: string) => unknown;
    __autoSaveImmediate: () => Promise<{ success: boolean; error?: string }>;
    __isAutoSaveEnabled: () => boolean;
    __autoSaveKey: string;
    __enableDebugMode: () => void;

    // -- From src/ui/flightController/_init.ts --
    __flightPs: _PhysicsState | null;
    __flightAssembly: _RocketAssembly | null;
    __flightState: _FlightState | null;
    __setMalfunctionMode: ((mode: string) => void) | undefined;
    __getMalfunctionMode: (() => string) | undefined;
    __testSetTimeWarp: ((speedMultiplier: number) => void) | undefined;
    __testGetTimeWarp: (() => number) | undefined;
    __resyncPhysicsWorker: (() => Promise<void>) | undefined;
    __addTransferObject: ((obj: _TransferObject) => void) | undefined;
    __getProximityObjects: ((px: number, py: number, vx: number, vy: number) => unknown[]) | undefined;

    // -- From src/ui/vab/_init.ts --
    __vabAssembly?: _RocketAssembly;
    __vabStagingConfig?: _StagingConfig;

    // -- From src/render/index.ts --
    __pixiApp?: unknown;

    // -- From src/render/vab.ts --
    __vabPartsContainer?: unknown;
    __vabWorldToScreen?: (x: number, y: number) => { screenX: number; screenY: number };

    // -- From src/ui/fpsMonitor.ts --
    __perfStats: { fps: number; frameTime: number; minFrameTime: number; maxFrameTime: number } | null;

    // -- Additional E2E test hooks (used by spec files) --
    __surfaceAction?: (action: string) => unknown;
    __mapViewActive?: boolean;

    // -- Spec-only properties (referenced in evaluate callbacks but not in source) --
    __partCatalog?: Array<{ id: string; [key: string]: unknown }>;
    __constants?: Record<string, unknown>;
    __crewAPI?: Record<string, unknown>;
    __consoleErrors?: string[];
  }
}

export {};
