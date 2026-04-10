/**
 * Flight control helpers for E2E tests -- teleport, launch, malfunctions.
 */

import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MalfunctionMode = 'off' | 'forced' | 'normal';

interface StartFlightOptions {
  missionId?: string;
  crewIds?: string[];
  bodyId?: string;
  malfunctionMode?: string;
  instruments?: Record<string, string[]>;
}

interface TeleportOptions {
  posX?: number;
  posY: number;
  velX?: number;
  velY?: number;
  grounded?: boolean;
  landed?: boolean;
  crashed?: boolean;
  throttle?: number;
  bodyId?: string;
  orbit?: boolean;
  phase?: 'FLIGHT' | 'ORBIT' | 'MANOEUVRE' | 'REENTRY' | 'TRANSFER';
  transferState?: Record<string, unknown>;
}

interface TransferObject {
  id: string;
  type: string;
  name: string;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  radius: number;
  mass: number;
}

interface VisibleTransferObject {
  id: string;
  distance: number;
  lod: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Browser-context window augmentation (these globals are injected at runtime)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/consistent-type-definitions */
declare global {
  interface Window {
    __e2eStartFlight?: (parts: string[], options: StartFlightOptions) => void;
    __setMalfunctionMode?: (mode: MalfunctionMode) => void;
    __getMalfunctionMode?: () => MalfunctionMode;
    __flightState?: {
      bodyId: string;
      phase: string;
      inOrbit: boolean;
      orbitalElements: unknown;
      altitude: number;
      velocity: number;
      horizontalVelocity: number;
      transferState?: Record<string, unknown>;
      phaseLog?: unknown[];
      events?: unknown[];
    };
    __resyncPhysicsWorker?: () => Promise<void>;
    __addTransferObject?: (obj: TransferObject) => void;
    __getProximityObjects?: (
      posX: number,
      posY: number,
      velX: number,
      velY: number,
    ) => { id: string; distance: number; lod: string; type: string }[];
  }
}
/* eslint-enable @typescript-eslint/consistent-type-definitions */

// ---------------------------------------------------------------------------
// Programmatic test flight (bypasses VAB UI)
// ---------------------------------------------------------------------------

/**
 * Start a flight programmatically by building a rocket from part IDs.
 * Bypasses the VAB UI entirely. Malfunctions disabled by default.
 */
export async function startTestFlight(
  page: Page,
  partIds: string[],
  opts: StartFlightOptions = {},
): Promise<void> {
  await page.waitForFunction(
    () => typeof window.__e2eStartFlight === 'function',
    { timeout: 15_000 },
  );

  await page.evaluate(
    ({ parts, options }) => window.__e2eStartFlight!(parts, options),
    { parts: partIds, options: opts },
  );

  // Wait for flight scene to be ready.
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Malfunction mode control
// ---------------------------------------------------------------------------

/**
 * Set the malfunction mode for deterministic testing.
 *
 * Must be called AFTER the flight scene is loaded (window.__setMalfunctionMode
 * is only available during flight).
 */
export async function setMalfunctionMode(
  page: Page,
  mode: MalfunctionMode,
): Promise<void> {
  await page.evaluate((m) => {
    if (typeof window.__setMalfunctionMode === 'function') {
      window.__setMalfunctionMode(m);
    }
  }, mode);
}

/**
 * Get the current malfunction mode from the running game.
 */
export async function getMalfunctionMode(page: Page): Promise<string> {
  return page.evaluate(() => {
    if (typeof window.__getMalfunctionMode === 'function') {
      return window.__getMalfunctionMode();
    }
    return 'unknown';
  });
}

// ---------------------------------------------------------------------------
// Teleport helpers
// ---------------------------------------------------------------------------

/**
 * Teleport the craft to a specific position with velocity.
 *
 * Sets position, velocity, and basic flags.  The physics simulation
 * computes phase transitions (FLIGHT -> ORBIT, etc.) and orbital elements
 * automatically on the next frame -- callers should follow with
 * {@link waitForOrbit} or similar condition checks as needed.
 */
export async function teleportCraft(
  page: Page,
  opts: TeleportOptions,
): Promise<void> {
  await page.evaluate(async (o) => {
    const ps = window.__flightPs;
    const fs = window.__flightState;
    if (!ps || !fs) return;

    // Position and velocity.
    ps.posX = o.posX ?? 0;
    ps.posY = o.posY;
    ps.velX = o.velX ?? 0;
    ps.velY = o.velY ?? 0;

    // Basic flags.
    ps.grounded = o.grounded ?? false;
    ps.landed   = o.landed ?? false;
    ps.crashed  = o.crashed ?? false;
    ps.throttle = o.throttle ?? 0;
    ps.firingEngines.clear();

    // Body.
    if (o.bodyId) fs.bodyId = o.bodyId;

    // Compute common derived values.
    const vel = Math.sqrt((o.velX ?? 0) ** 2 + (o.velY ?? 0) ** 2);
    const hVel = Math.abs(o.velX ?? 0);

    // Resolve phase (orbit: true is shorthand for phase: 'ORBIT').
    const phase = o.phase ?? (o.orbit ? 'ORBIT' : 'FLIGHT');

    switch (phase) {
      case 'ORBIT':
        fs.phase = 'ORBIT';
        fs.inOrbit = true;
        fs.altitude = o.posY;
        fs.velocity = vel;
        fs.horizontalVelocity = hVel;
        break;

      case 'MANOEUVRE':
        fs.phase = 'MANOEUVRE';
        // Keep orbit state -- manoeuvre is a burn within orbit.
        fs.altitude = o.posY;
        fs.velocity = vel;
        fs.horizontalVelocity = hVel;
        break;

      case 'REENTRY':
        fs.phase = 'REENTRY';
        fs.inOrbit = false;
        fs.orbitalElements = null;
        fs.altitude = o.posY;
        fs.velocity = vel;
        fs.horizontalVelocity = hVel;
        break;

      case 'TRANSFER':
        fs.phase = 'TRANSFER';
        fs.inOrbit = false;
        fs.orbitalElements = null;
        if (o.transferState) {
          fs.transferState = o.transferState;
        }
        fs.altitude = o.posY;
        fs.velocity = vel;
        fs.horizontalVelocity = hVel;
        break;

      default: // 'FLIGHT' or unspecified
        fs.phase = 'FLIGHT';
        fs.inOrbit = false;
        fs.orbitalElements = null;
        break;
    }

    // Defensive initialisation.
    if (!fs.phaseLog) fs.phaseLog = [];
    if (!fs.events) fs.events = [];

    // Re-sync the physics worker with the teleported state so the worker
    // doesn't overwrite the position/velocity on the next snapshot.
    if (typeof window.__resyncPhysicsWorker === 'function') {
      await window.__resyncPhysicsWorker();
    }
  }, opts);
}

/**
 * Wait for the physics simulation to detect a valid orbit and transition
 * the flight phase to ORBIT.
 */
export async function waitForOrbit(
  page: Page,
  timeout: number = 10_000,
): Promise<void> {
  await page.waitForFunction(
    () => window.__flightState?.phase === 'ORBIT' && window.__flightState?.inOrbit === true,
    { timeout },
  );
}

/**
 * Spawn a transfer object near the player craft for testing proximity
 * rendering and collision during TRANSFER phase.
 */
export async function spawnTransferObject(
  page: Page,
  obj: TransferObject,
): Promise<void> {
  await page.evaluate((o) => {
    // Import addTransferObject from the module via the global test API.
    // The function is exposed on window for E2E testing.
    if (typeof window.__addTransferObject === 'function') {
      window.__addTransferObject(o);
    }
  }, obj);
}

/**
 * Query which transfer objects are currently within render distance.
 */
export async function getVisibleTransferObjects(
  page: Page,
): Promise<VisibleTransferObject[]> {
  return page.evaluate(() => {
    if (typeof window.__getProximityObjects !== 'function') return [];
    const ps = window.__flightPs;
    if (!ps) return [];
    return window.__getProximityObjects(ps.posX, ps.posY, ps.velX, ps.velY)
      .map(o => ({ id: o.id, distance: o.distance, lod: o.lod, type: o.type }));
  });
}
