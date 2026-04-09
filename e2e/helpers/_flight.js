/**
 * Flight control helpers for E2E tests — teleport, launch, malfunctions.
 */

// ---------------------------------------------------------------------------
// Programmatic test flight (bypasses VAB UI)
// ---------------------------------------------------------------------------

/**
 * Start a flight programmatically by building a rocket from part IDs.
 * Bypasses the VAB UI entirely. Malfunctions disabled by default.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} partIds  Part catalog IDs (top → bottom).
 * @param {object} [opts]  Options: missionId, crewIds, bodyId, malfunctionMode.
 */
export async function startTestFlight(page, partIds, opts = {}) {
  await page.waitForFunction(
    () => typeof window.__e2eStartFlight === 'function',
    { timeout: 15_000 },
  );

  await page.evaluate(
    ({ parts, options }) => window.__e2eStartFlight(parts, options),
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
 *
 * @param {import('@playwright/test').Page} page
 * @param {'off'|'forced'|'normal'} mode
 */
export async function setMalfunctionMode(page, mode) {
  await page.evaluate((m) => {
    if (typeof window.__setMalfunctionMode === 'function') {
      window.__setMalfunctionMode(m);
    }
  }, mode);
}

/**
 * Get the current malfunction mode from the running game.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
export async function getMalfunctionMode(page) {
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
 * computes phase transitions (FLIGHT → ORBIT, etc.) and orbital elements
 * automatically on the next frame — callers should follow with
 * {@link waitForOrbit} or similar condition checks as needed.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {number} [opts.posX=0]         Position X (metres).
 * @param {number} opts.posY             Position Y / altitude (metres).
 * @param {number} [opts.velX=0]         Velocity X (m/s).
 * @param {number} [opts.velY=0]         Velocity Y (m/s).
 * @param {boolean} [opts.grounded=false]
 * @param {boolean} [opts.landed=false]
 * @param {boolean} [opts.crashed=false]
 * @param {number}  [opts.throttle=0]
 * @param {string}  [opts.bodyId]        Celestial body ID (e.g. 'EARTH', 'MOON').
 * @param {boolean} [opts.orbit]         Shorthand for phase='ORBIT'.
 * @param {string}  [opts.phase]         Flight phase to set directly:
 *   'FLIGHT' (default) — resets to FLIGHT, lets physics auto-detect.
 *   'ORBIT' — sets ORBIT phase, inOrbit=true, computes velocity/altitude.
 *   'MANOEUVRE' — sets MANOEUVRE phase, keeps orbit state.
 *   'REENTRY' — sets REENTRY phase, clears orbit state.
 *   'TRANSFER' — sets TRANSFER phase with transferState from opts.
 * @param {object}  [opts.transferState] Transfer state for TRANSFER phase.
 */
export async function teleportCraft(page, opts) {
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
        // Keep orbit state — manoeuvre is a burn within orbit.
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
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=10_000]
 */
export async function waitForOrbit(page, timeout = 10_000) {
  await page.waitForFunction(
    () => window.__flightState?.phase === 'ORBIT' && window.__flightState?.inOrbit === true,
    { timeout },
  );
}
