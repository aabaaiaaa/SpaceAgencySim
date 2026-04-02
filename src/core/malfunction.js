/**
 * malfunction.js — Part reliability and malfunction system.
 *
 * Each part has a reliability rating (0.0–1.0).  On biome transitions (with a
 * small random offset for unpredictability), every active part is checked.  If
 * a random roll exceeds the part's reliability, a malfunction occurs.
 *
 * Malfunctions are NOT catastrophic — the player can always attempt recovery
 * via the context menu.  Visual cues and recovery tips are shown for every
 * malfunction type.
 *
 * The system is toggleable for E2E testing:
 *   MalfunctionMode.OFF    → no malfunctions ever trigger
 *   MalfunctionMode.FORCED → every part malfunctions (100 %) on check
 *   MalfunctionMode.NORMAL → standard reliability rolls
 *
 * Crew engineering skill reduces malfunction chance by up to 30 %.
 *
 * PUBLIC API
 * ==========
 *   initMalfunctionState(ps, assembly)
 *   checkMalfunctions(ps, assembly, flightState, gameState)
 *   tickMalfunctions(ps, assembly, dt)
 *   hasMalfunction(ps, instanceId)
 *   getMalfunction(ps, instanceId)
 *   attemptRecovery(ps, instanceId)
 *   setMalfunctionMode(gameState, mode)
 *   getMalfunctionMode(gameState)
 *   getPartReliability(def)
 *   MALFUNCTION_RECOVERY_TIPS
 *
 * @module malfunction
 */

import { getPartById } from '../data/parts.js';
import {
  PartType,
  GameMode,
  MalfunctionType,
  MalfunctionMode,
  MALFUNCTION_TYPE_MAP,
  FUEL_LEAK_RATE,
  REDUCED_THRUST_FACTOR,
  PARTIAL_CHUTE_FACTOR,
  MAX_ENGINEERING_MALFUNCTION_REDUCTION,
} from './constants.js';
import { getMalfunctionMultiplier } from './settings.js';

// ---------------------------------------------------------------------------
// Recovery tips (shown in context menu)
// ---------------------------------------------------------------------------

/**
 * Human-readable recovery tips for each malfunction type.
 * Shown in the context menu when a malfunction is active.
 * @type {Readonly<Record<string, string>>}
 */
export const MALFUNCTION_RECOVERY_TIPS = Object.freeze({
  [MalfunctionType.ENGINE_FLAMEOUT]:
    'Engine has flamed out. Try reignition via the context menu.',
  [MalfunctionType.ENGINE_REDUCED_THRUST]:
    'Engine running at reduced thrust (60%). No recovery possible — compensate with throttle.',
  [MalfunctionType.FUEL_TANK_LEAK]:
    'Fuel tank is leaking (~2%/s). Attempt to seal the leak via the context menu.',
  [MalfunctionType.DECOUPLER_STUCK]:
    'Decoupler failed to fire via staging. Use the context menu to manually decouple.',
  [MalfunctionType.PARACHUTE_PARTIAL]:
    'Parachute deployed at 50% effectiveness. Deploy additional chutes if available.',
  [MalfunctionType.SRB_EARLY_BURNOUT]:
    'SRB experienced early burnout. No recovery — jettison when possible.',
  [MalfunctionType.SCIENCE_INSTRUMENT_FAILURE]:
    'Science instruments have failed. Attempt to reboot via the context menu.',
  [MalfunctionType.LANDING_LEGS_STUCK]:
    'Landing legs stuck in stowed position. Try manual deployment via the context menu.',
});

/**
 * Human-readable short labels for malfunction types.
 * @type {Readonly<Record<string, string>>}
 */
export const MALFUNCTION_LABELS = Object.freeze({
  [MalfunctionType.ENGINE_FLAMEOUT]:           'FLAMEOUT',
  [MalfunctionType.ENGINE_REDUCED_THRUST]:     'REDUCED THRUST',
  [MalfunctionType.FUEL_TANK_LEAK]:            'FUEL LEAK',
  [MalfunctionType.DECOUPLER_STUCK]:           'STUCK',
  [MalfunctionType.PARACHUTE_PARTIAL]:         'PARTIAL DEPLOY',
  [MalfunctionType.SRB_EARLY_BURNOUT]:         'EARLY BURNOUT',
  [MalfunctionType.SCIENCE_INSTRUMENT_FAILURE]:'INSTR. FAILURE',
  [MalfunctionType.LANDING_LEGS_STUCK]:        'STUCK',
});

// ---------------------------------------------------------------------------
// Public API — Mode control
// ---------------------------------------------------------------------------

/**
 * Set the malfunction mode on the game state.
 * @param {import('./gameState.js').GameState} gameState
 * @param {string} mode  MalfunctionMode value ('normal', 'off', 'forced').
 */
export function setMalfunctionMode(gameState, mode) {
  gameState.malfunctionMode = mode;
}

/**
 * Get the current malfunction mode from the game state.
 * @param {import('./gameState.js').GameState} gameState
 * @returns {string}
 */
export function getMalfunctionMode(gameState) {
  return gameState.malfunctionMode ?? MalfunctionMode.NORMAL;
}

// ---------------------------------------------------------------------------
// Public API — Init
// ---------------------------------------------------------------------------

/**
 * Initialise malfunction tracking state on the PhysicsState.
 * Called once at launch from createPhysicsState.
 *
 * @param {import('./physics.js').PhysicsState}            ps
 * @param {import('./rocketbuilder.js').RocketAssembly}   assembly
 */
export function initMalfunctionState(ps, assembly) {
  // Map<instanceId, { type: MalfunctionType, recovered: boolean }>
  ps.malfunctions = new Map();
  // Set of instanceIds that have already been checked (no re-roll).
  ps.malfunctionChecked = new Set();
  // Track the last biome for transition detection within physics tick.
  ps._lastBiomeForMalfunction = null;
  // Offset counter: small random delay after biome boundary before checking.
  ps._malfunctionCheckPending = false;
  ps._malfunctionCheckTimer = 0;
}

// ---------------------------------------------------------------------------
// Public API — Queries
// ---------------------------------------------------------------------------

/**
 * Check if a part currently has an active (non-recovered) malfunction.
 * @param {object} ps  PhysicsState.
 * @param {string} instanceId
 * @returns {boolean}
 */
export function hasMalfunction(ps, instanceId) {
  const entry = ps.malfunctions?.get(instanceId);
  return entry != null && !entry.recovered;
}

/**
 * Get the malfunction entry for a part, or null.
 * @param {object} ps
 * @param {string} instanceId
 * @returns {{ type: string, recovered: boolean } | null}
 */
export function getMalfunction(ps, instanceId) {
  return ps.malfunctions?.get(instanceId) ?? null;
}

/**
 * Return the effective reliability for a part definition.
 * Falls back to 1.0 (never malfunctions) if no reliability field.
 * @param {import('../data/parts.js').PartDef} def
 * @returns {number}
 */
export function getPartReliability(def) {
  return def.reliability ?? 1.0;
}

// ---------------------------------------------------------------------------
// Public API — Check malfunctions (called on biome transition)
// ---------------------------------------------------------------------------

/**
 * Roll malfunction checks for all active parts.
 * Called from _syncFlightState when a biome transition is detected.
 *
 * For each active part that:
 *   1. Has applicable malfunction types (in MALFUNCTION_TYPE_MAP)
 *   2. Has not already been checked for this flight
 *   3. Does not already have a malfunction
 *
 * A random roll is compared against the part's reliability, adjusted
 * by crew engineering skill.
 *
 * @param {object} ps          PhysicsState
 * @param {object} assembly    RocketAssembly
 * @param {object} flightState FlightState
 * @param {object} [gameState] GameState (for crew skill lookup); optional.
 */
export function checkMalfunctions(ps, assembly, flightState, gameState) {
  const mode = gameState?.malfunctionMode ?? MalfunctionMode.NORMAL;
  if (mode === MalfunctionMode.OFF) return;
  // Sandbox mode with malfunctions disabled: skip all checks.
  if (gameState?.gameMode === GameMode.SANDBOX &&
      !gameState.sandboxSettings?.malfunctionsEnabled) return;
  // Difficulty setting: malfunctions off.
  const malfunctionMult = getMalfunctionMultiplier(gameState);
  if (malfunctionMult <= 0) return;
  if (!ps.malfunctions) return;

  // Calculate crew engineering bonus (reduces malfunction chance).
  const engineeringReduction = _getCrewEngineeringReduction(flightState, gameState);

  for (const instanceId of ps.activeParts) {
    // Skip parts already checked or already malfunctioning.
    if (ps.malfunctionChecked.has(instanceId)) continue;
    if (ps.malfunctions.has(instanceId)) continue;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    // Only parts with applicable malfunction types can malfunction.
    const applicableTypes = MALFUNCTION_TYPE_MAP[def.type];
    if (!applicableTypes || applicableTypes.length === 0) continue;

    // Mark as checked so it won't be re-rolled on the next biome transition.
    ps.malfunctionChecked.add(instanceId);

    // Reliability check — account for part wear from inventory reuse.
    let baseReliability = getPartReliability(def);
    const invEntry = ps._usedInventoryParts?.get(instanceId);
    if (invEntry && invEntry.wear > 0) {
      // effectiveReliability = baseReliability × (1 - wear/100 × 0.5)
      baseReliability = baseReliability * (1 - (invEntry.wear / 100) * 0.5);
    }

    // Adjusted failure chance: (1 - reliability) * (1 - engineering reduction) * difficulty mult.
    const failureChance = (1 - baseReliability) * (1 - engineeringReduction) * malfunctionMult;

    let malfunctioned = false;
    if (mode === MalfunctionMode.FORCED) {
      malfunctioned = true;
    } else {
      malfunctioned = Math.random() < failureChance;
    }

    if (malfunctioned) {
      // Pick a random malfunction type from the applicable set.
      const type = applicableTypes[Math.floor(Math.random() * applicableTypes.length)];
      _applyMalfunction(ps, assembly, flightState, instanceId, def, type);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — Tick (for continuous effects like fuel leaks)
// ---------------------------------------------------------------------------

/**
 * Advance continuous malfunction effects by one timestep.
 * Currently handles FUEL_TANK_LEAK draining.
 *
 * @param {object} ps        PhysicsState
 * @param {object} assembly  RocketAssembly
 * @param {number} dt        Timestep in seconds.
 */
export function tickMalfunctions(ps, assembly, dt) {
  if (!ps.malfunctions) return;

  for (const [instanceId, entry] of ps.malfunctions) {
    if (entry.recovered) continue;
    if (!ps.activeParts.has(instanceId)) continue;

    if (entry.type === MalfunctionType.FUEL_TANK_LEAK) {
      const fuelLeft = ps.fuelStore.get(instanceId) ?? 0;
      if (fuelLeft > 0) {
        const leaked = fuelLeft * FUEL_LEAK_RATE * dt;
        ps.fuelStore.set(instanceId, Math.max(0, fuelLeft - leaked));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — Recovery
// ---------------------------------------------------------------------------

/**
 * Attempt to recover a malfunctioning part via the context menu.
 *
 * Recovery rules:
 *   ENGINE_FLAMEOUT            → reignite (50 % success per attempt)
 *   ENGINE_REDUCED_THRUST      → no recovery possible
 *   FUEL_TANK_LEAK             → seal (60 % success)
 *   DECOUPLER_STUCK            → manual decouple (always succeeds)
 *   PARACHUTE_PARTIAL          → no recovery possible
 *   SRB_EARLY_BURNOUT          → no recovery possible
 *   SCIENCE_INSTRUMENT_FAILURE → reboot (40 % success)
 *   LANDING_LEGS_STUCK         → manual deploy (70 % success)
 *
 * @param {object} ps            PhysicsState
 * @param {string} instanceId
 * @param {import('./gameState.js').GameState} [gameState]  GameState (for mode lookup); optional.
 * @returns {{ success: boolean, message: string }}
 */
export function attemptRecovery(ps, instanceId, gameState) {
  const entry = ps.malfunctions?.get(instanceId);
  if (!entry || entry.recovered) {
    return { success: false, message: 'No active malfunction.' };
  }

  const mode = gameState?.malfunctionMode ?? ps._gameState?.malfunctionMode ?? MalfunctionMode.NORMAL;
  const roll = (mode === MalfunctionMode.FORCED) ? 1.0 : Math.random();

  switch (entry.type) {
    case MalfunctionType.ENGINE_FLAMEOUT:
      if (roll < 0.5) {
        entry.recovered = true;
        // Re-add engine to firing set.
        ps.firingEngines.add(instanceId);
        return { success: true, message: 'Engine reignited successfully!' };
      }
      return { success: false, message: 'Reignition failed — try again.' };

    case MalfunctionType.ENGINE_REDUCED_THRUST:
      return { success: false, message: 'Cannot recover — adjust throttle to compensate.' };

    case MalfunctionType.FUEL_TANK_LEAK:
      if (roll < 0.6) {
        entry.recovered = true;
        return { success: true, message: 'Leak sealed successfully!' };
      }
      return { success: false, message: 'Failed to seal leak — try again.' };

    case MalfunctionType.DECOUPLER_STUCK:
      entry.recovered = true;
      return { success: true, message: 'Manual decouple successful!' };

    case MalfunctionType.PARACHUTE_PARTIAL:
      return { success: false, message: 'Cannot recover — deploy additional chutes.' };

    case MalfunctionType.SRB_EARLY_BURNOUT:
      return { success: false, message: 'Cannot recover — jettison booster.' };

    case MalfunctionType.SCIENCE_INSTRUMENT_FAILURE:
      if (roll < 0.4) {
        entry.recovered = true;
        return { success: true, message: 'Instruments rebooted successfully!' };
      }
      return { success: false, message: 'Reboot failed — try again.' };

    case MalfunctionType.LANDING_LEGS_STUCK:
      if (roll < 0.7) {
        entry.recovered = true;
        return { success: true, message: 'Legs freed — deploying now.' };
      }
      return { success: false, message: 'Still stuck — try again.' };

    default:
      return { success: false, message: 'Unknown malfunction type.' };
  }
}

// ---------------------------------------------------------------------------
// Private — Apply malfunction effects
// ---------------------------------------------------------------------------

/**
 * Apply a specific malfunction to a part, modifying physics state and
 * emitting a flight event.
 *
 * @param {object} ps
 * @param {object} assembly
 * @param {object} flightState
 * @param {string} instanceId
 * @param {object} def          Part definition.
 * @param {string} type         MalfunctionType value.
 */
function _applyMalfunction(ps, assembly, flightState, instanceId, def, type) {
  ps.malfunctions.set(instanceId, { type, recovered: false });

  // Emit flight event.
  if (flightState?.events) {
    flightState.events.push({
      type:        'PART_MALFUNCTION',
      time:        flightState.timeElapsed,
      instanceId,
      partName:    def.name,
      malfunctionType: type,
      description: `${def.name}: ${MALFUNCTION_LABELS[type] ?? type}`,
    });
  }

  // Apply immediate effects based on malfunction type.
  switch (type) {
    case MalfunctionType.ENGINE_FLAMEOUT:
      // Remove engine from firing set — thrust drops to zero.
      ps.firingEngines.delete(instanceId);
      break;

    case MalfunctionType.ENGINE_REDUCED_THRUST:
      // Thrust reduction is applied in the thrust calculation (physics reads malfunction state).
      break;

    case MalfunctionType.FUEL_TANK_LEAK:
      // Continuous drain handled in tickMalfunctions.
      break;

    case MalfunctionType.DECOUPLER_STUCK:
      // Blocks staging activation — handled in staging.js integration.
      break;

    case MalfunctionType.PARACHUTE_PARTIAL:
      // Reduced drag — applied in drag calculation (physics reads malfunction state).
      break;

    case MalfunctionType.SRB_EARLY_BURNOUT:
      // Immediately exhaust remaining SRB fuel.
      ps.fuelStore.set(instanceId, 0);
      ps.firingEngines.delete(instanceId);
      break;

    case MalfunctionType.SCIENCE_INSTRUMENT_FAILURE:
      // Blocks instrument activation — handled in sciencemodule integration.
      break;

    case MalfunctionType.LANDING_LEGS_STUCK:
      // Blocks leg deployment — handled in legs.js integration.
      break;
  }
}

// ---------------------------------------------------------------------------
// Private — Crew engineering skill
// ---------------------------------------------------------------------------

/**
 * Calculate the malfunction chance reduction from crew engineering skill.
 *
 * Uses the highest engineering skill among crew aboard the flight.
 * Engineering skill 100 → 30 % reduction; skill 0 → 0 % reduction.
 * Uncrewed flights get no bonus.
 *
 * @param {object} flightState
 * @param {object} [gameState]
 * @returns {number}  Reduction fraction (0.0 – 0.30).
 */
function _getCrewEngineeringReduction(flightState, gameState) {
  if (!gameState || !flightState?.crewIds?.length) return 0;

  let maxEngineering = 0;
  for (const crewId of flightState.crewIds) {
    const member = gameState.crew?.find(c => c.id === crewId);
    if (member?.skills?.engineering != null) {
      maxEngineering = Math.max(maxEngineering, member.skills.engineering);
    }
  }

  // Linear scaling: skill 0 → 0 %, skill 100 → 30 %.
  return (maxEngineering / 100) * MAX_ENGINEERING_MALFUNCTION_REDUCTION;
}
