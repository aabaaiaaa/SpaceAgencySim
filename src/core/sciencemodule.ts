/**
 * sciencemodule.ts — Per-instrument science experiment state machine.
 *
 * Science modules are containers with limited instrument slots.  The player
 * loads instruments into modules in the VAB.  During flight, each instrument
 * can be individually activated (via staging or the context menu).
 *
 * INSTRUMENT LIFECYCLE
 * ====================
 *   idle ──[activate]──► running ──[timer expires]──► complete
 *                                                       │
 *                                         ┌─────────────┼─────────────┐
 *                                         │             │             │
 *                                   [safe landing] [transmit from   [destroyed]
 *                                         │        orbit, ANALYSIS    │
 *                                         ▼        only]              ▼
 *                                   data_returned    │            (data lost)
 *                                                    ▼
 *                                              transmitted
 *
 * DATA TYPES
 * ==========
 *   SAMPLE   — Must be physically returned for full yield.  Cannot transmit.
 *   ANALYSIS — Can transmit from orbit at 40–60 % yield, or return for full.
 *
 * YIELD FORMULA
 * =============
 *   finalYield = baseYield × biomeMultiplier × scienceSkillBonus × diminishingReturn
 *
 *   diminishingReturn (per instrument+biome pair, persistent across flights):
 *     1st → 100 %, 2nd → 25 %, 3rd → 10 %, 4th+ → 0 %
 *
 * @module sciencemodule
 */

import { getPartById, ActivationBehaviour } from '../data/parts.js';
import { getInstrumentById, isInstrumentValidForBiome } from '../data/instruments.js';
import { PartType, ScienceDataType, DIMINISHING_RETURNS,
         ANALYSIS_TRANSMIT_YIELD_MIN, ANALYSIS_TRANSMIT_YIELD_MAX,
         FacilityId, RD_LAB_SCIENCE_BONUS } from './constants.js';
import { getBiome, getBiomeId, getScienceMultiplier } from './biomes.js';
// hasMalfunction not used directly — inline check avoids PhysicsStateWithMalfunctions type mismatch
import { MalfunctionType } from './constants.js';

import type { GameState, ScienceLogEntry, FlightEvent } from './gameState.js';
import type { ScienceModuleStateEntry } from './physics.js';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Instrument / experiment lifecycle states.
 */
export const ScienceModuleState = Object.freeze({
  /** Instrument is idle; experiment has not started. */
  IDLE:          'idle',
  /** Experiment is running; countdown timer is active. */
  RUNNING:       'running',
  /** Experiment completed; data is on board waiting to be returned or transmitted. */
  COMPLETE:      'complete',
  /** Data was successfully recovered via a safe landing (full yield). */
  DATA_RETURNED: 'data_returned',
  /** Data was transmitted from orbit (ANALYSIS only, reduced yield). */
  TRANSMITTED:   'transmitted',
});

export type ScienceModuleStateValue = (typeof ScienceModuleState)[keyof typeof ScienceModuleState];

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** State tracking for a single instrument loaded into a science module. */
export interface InstrumentStateEntry {
  /** ID of the instrument definition. */
  instrumentId: string;
  /** Instance ID of the parent science module. */
  moduleInstanceId: string;
  /** 0-based slot position within the module. */
  slotIndex: number;
  /** One of ScienceModuleState values. */
  state: string;
  /** Countdown in seconds; positive while `running`. */
  timer: number;
  /** 'SAMPLE' or 'ANALYSIS'. */
  dataType: string;
  /** Base science points from the instrument def. */
  baseYield: number;
  /** Biome ID where experiment was started. */
  startBiome: string | null;
  /** Biome ID where experiment completed. */
  completeBiome: string | null;
  /** Biome science multiplier at completion. */
  scienceMultiplier: number;
}

/** Malfunction entry shape used by science module checks. */
interface MalfunctionEntryLike {
  recovered?: boolean;
  type?: string;
}

/** Minimal shape of the physics state needed by science module functions. */
interface SciencePhysicsState {
  instrumentStates?: Map<string, InstrumentStateEntry>;
  scienceModuleStates?: Map<string, ScienceModuleStateEntry>;
  activeParts: Set<string>;
  posY: number;
  malfunctions?: Map<string, MalfunctionEntryLike>;
  _gameState?: GameState;
}

/** Minimal shape of flight state needed by science module functions. */
interface ScienceFlightState {
  events: FlightEvent[];
  timeElapsed: number;
  scienceModuleRunning?: boolean;
  inOrbit?: boolean;
  crewIds?: string[];
}

/** Assembly shape needed by science module functions. */
interface ScienceAssembly {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PlacedPart has dynamic properties per part type
  parts: Map<string, { partId: string; instruments?: string[]; [key: string]: any }>;
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Build a unique key for an instrument slot within a module.
 * Format: `{moduleInstanceId}:instr:{slotIndex}`
 */
export function getInstrumentKey(moduleInstanceId: string, slotIndex: number): string {
  return `${moduleInstanceId}:instr:${slotIndex}`;
}

/**
 * Parse an instrument key back into its components.
 */
export function parseInstrumentKey(key: string): { moduleInstanceId: string; slotIndex: number } | null {
  const match = key.match(/^(.+):instr:(\d+)$/);
  if (!match) return null;
  return { moduleInstanceId: match[1], slotIndex: parseInt(match[2], 10) };
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Populate `ps.instrumentStates` with an IDLE entry for every instrument
 * loaded into a SERVICE_MODULE part that uses `COLLECT_SCIENCE` activation.
 *
 * Also populates the legacy `ps.scienceModuleStates` map for backward
 * compatibility with mission objective checks.
 */
export function initInstrumentStates(ps: SciencePhysicsState, assembly: ScienceAssembly): void {
  if (!ps.instrumentStates) return;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;

    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.SERVICE_MODULE) continue;
    if (def.activationBehaviour !== ActivationBehaviour.COLLECT_SCIENCE) continue;

    const instruments: string[] = placed.instruments ?? [];

    // Register each loaded instrument.
    for (let i = 0; i < instruments.length; i++) {
      const instrId = instruments[i];
      const instrDef = getInstrumentById(instrId);
      if (!instrDef) continue;

      const key = getInstrumentKey(instanceId, i);
      if (ps.instrumentStates.has(key)) continue; // already initialised

      ps.instrumentStates.set(key, {
        instrumentId:      instrId,
        moduleInstanceId:  instanceId,
        slotIndex:         i,
        state:             ScienceModuleState.IDLE,
        timer:             0,
        dataType:          instrDef.dataType,
        baseYield:         instrDef.baseYield,
        startBiome:        null,
        completeBiome:     null,
        scienceMultiplier: 1.0,
      });
    }

    // Always populate scienceModuleStates for backward compatibility with
    // mission objectives and legacy tests. This entry tracks the module's
    // overall status regardless of whether instruments are loaded.
    if (!ps.scienceModuleStates!.has(instanceId)) {
      ps.scienceModuleStates!.set(instanceId, {
        state:             ScienceModuleState.IDLE,
        timer:             0,
        startBiome:        null,
        completeBiome:     null,
        scienceMultiplier: 1.0,
      });
    }
  }
}

/** Backward-compatible alias — called by physics.js init. */
export function initScienceModuleStates(ps: SciencePhysicsState, assembly: ScienceAssembly): void {
  initInstrumentStates(ps, assembly);
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Start a specific instrument's experiment — transition idle → running.
 *
 * @returns True if the experiment started successfully.
 */
export function activateInstrument(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  key: string,
): boolean {
  const entry = ps.instrumentStates?.get(key);
  if (!entry) return false;
  if (entry.state !== ScienceModuleState.IDLE) return false;
  if (!ps.activeParts.has(entry.moduleInstanceId)) return false;

  // Block activation if the parent science module has an instrument failure.
  const malf = ps.malfunctions?.get(entry.moduleInstanceId);
  if (malf && !malf.recovered && malf.type === MalfunctionType.SCIENCE_INSTRUMENT_FAILURE) {
    return false;
  }

  const instrDef = getInstrumentById(entry.instrumentId);
  if (!instrDef) return false;

  const altitude = Math.max(0, ps.posY);
  const biome = getBiome(altitude, 'EARTH');
  const biomeId: string | null = biome ? biome.id : null;
  const biomeName: string = biome ? biome.name : 'Unknown';

  // Biome validation — instrument can only collect data in its valid biomes.
  if (!isInstrumentValidForBiome(entry.instrumentId, biomeId as string)) {
    flightState.events.push({
      type:         'INSTRUMENT_INVALID_BIOME',
      time:         flightState.timeElapsed,
      instanceId:   entry.moduleInstanceId,
      instrumentId: entry.instrumentId,
      instrumentKey: key,
      biome:        biomeId,
      validBiomes:  instrDef.validBiomes ?? [],
      description:  `${instrDef.name} cannot operate in ${biomeName}. Valid biomes: ${(instrDef.validBiomes ?? []).join(', ')}.`,
    });
    return false;
  }

  entry.state = ScienceModuleState.RUNNING;
  // Science skill reduces experiment duration: 0 skill = 100%, 100 skill = 66.7% (30s→20s).
  const sciSkill = _getCrewScienceSkill(flightState, ps?._gameState ?? null);
  const durationFactor = 1 - (sciSkill / 100) * (1 / 3);
  entry.timer = instrDef.experimentDuration * durationFactor;
  entry.startBiome = biomeId;

  // Update legacy module state.
  _syncLegacyModuleState(ps, entry.moduleInstanceId);

  flightState.events.push({
    type:         'PART_ACTIVATED',
    time:         flightState.timeElapsed,
    instanceId:   entry.moduleInstanceId,
    instrumentId: entry.instrumentId,
    instrumentKey: key,
    partType:     PartType.SERVICE_MODULE,
    biome:        biomeId,
    description:  `${instrDef.name} experiment started in ${biomeName} at ${altitude.toFixed(0)} m.`,
  });

  return true;
}

/**
 * Activate all idle instruments in a science module at once.
 * Called when the module itself is staged.
 *
 * @returns Number of instruments that were activated.
 */
export function activateAllInstruments(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  moduleInstanceId: string,
): number {
  if (!ps.instrumentStates) return 0;
  let count = 0;

  for (const [key, entry] of ps.instrumentStates) {
    if (entry.moduleInstanceId !== moduleInstanceId) continue;
    if (activateInstrument(ps, assembly, flightState, key)) count++;
  }

  return count;
}

/**
 * Backward-compatible activation — activates all instruments in a module.
 * Called by staging.js COLLECT_SCIENCE handler.
 *
 * @returns True if at least one instrument was activated.
 */
export function activateScienceModule(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  instanceId: string,
): boolean {
  // If module has loaded instruments, activate them all.
  if (ps.instrumentStates && ps.instrumentStates.size > 0) {
    const count = activateAllInstruments(ps, assembly, flightState, instanceId);
    if (count > 0) return true;
  }

  // Fallback: module with no instruments loaded (legacy behaviour).
  // Treat the module itself as a simple experiment.
  const legacyEntry = ps.scienceModuleStates?.get(instanceId);
  if (legacyEntry && legacyEntry.state === ScienceModuleState.IDLE) {
    const placed = assembly.parts.get(instanceId);
    const def = placed ? getPartById(placed.partId) : null;
    if (!def) return false;

    const altitude = Math.max(0, ps.posY);
    const biome = getBiome(altitude, 'EARTH');
    const biomeId: string | null = biome ? biome.id : null;
    const biomeName: string = biome ? biome.name : 'Unknown';

    const duration: number = (def.properties.experimentDuration as number) ?? 30;
    legacyEntry.state = ScienceModuleState.RUNNING;
    legacyEntry.timer = duration;
    legacyEntry.startBiome = biomeId;

    flightState.events.push({
      type:        'PART_ACTIVATED',
      time:        flightState.timeElapsed,
      instanceId,
      partType:    def.type,
      biome:       biomeId,
      description: `${def.name} experiment started in ${biomeName} at ${altitude.toFixed(0)} m.`,
    });

    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Transmit (ANALYSIS data from orbit)
// ---------------------------------------------------------------------------

/**
 * Transmit an ANALYSIS instrument's data from orbit.
 * Returns reduced yield (40–60 %) and transitions to `transmitted`.
 *
 * @returns Science yield awarded (0 if transmission failed).
 */
export function transmitInstrument(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  key: string,
  gameState: GameState | null,
): number {
  const entry = ps.instrumentStates?.get(key);
  if (!entry) return 0;
  if (entry.state !== ScienceModuleState.COMPLETE) return 0;
  if (entry.dataType !== ScienceDataType.ANALYSIS) return 0;
  if (!ps.activeParts.has(entry.moduleInstanceId)) return 0;

  const instrDef = getInstrumentById(entry.instrumentId);
  if (!instrDef) return 0;

  // Calculate yield with transmit penalty.
  const transmitFraction = ANALYSIS_TRANSMIT_YIELD_MIN +
    Math.random() * (ANALYSIS_TRANSMIT_YIELD_MAX - ANALYSIS_TRANSMIT_YIELD_MIN);

  const fullYield = calculateYield(
    entry.instrumentId,
    entry.completeBiome,
    entry.scienceMultiplier,
    _getCrewScienceSkill(flightState, gameState),
    gameState,
  );

  const awardedYield = Math.round(fullYield * transmitFraction * 100) / 100;

  entry.state = ScienceModuleState.TRANSMITTED;

  // Record the collection for diminishing returns.
  if (gameState) {
    _recordCollection(gameState, entry.instrumentId, entry.completeBiome);
  }

  flightState.events.push({
    type:            'SCIENCE_TRANSMITTED',
    time:            flightState.timeElapsed,
    instrumentId:    entry.instrumentId,
    instrumentKey:   key,
    instanceId:      entry.moduleInstanceId,
    biome:           entry.completeBiome,
    scienceYield:    awardedYield,
    transmitFraction,
    description:     `${instrDef.name} data transmitted (${(transmitFraction * 100).toFixed(0)}% yield) — ${awardedYield.toFixed(1)} science points.`,
  });

  // Update legacy module state.
  _syncLegacyModuleState(ps, entry.moduleInstanceId);

  return awardedYield;
}

// ---------------------------------------------------------------------------
// Per-tick update
// ---------------------------------------------------------------------------

/**
 * Advance all running instrument timers by `dt` seconds.
 *
 * Updates `flightState.scienceModuleRunning` to reflect whether any
 * instrument is currently running (consumed by HOLD_ALTITUDE objective).
 */
export function tickInstruments(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  dt: number,
): void {
  if (!ps.instrumentStates) return;

  // Check running status BEFORE processing expirations.
  for (const [, entry] of ps.instrumentStates) {
    if (!ps.activeParts.has(entry.moduleInstanceId)) continue;
    if (entry.state === ScienceModuleState.RUNNING) {
      flightState.scienceModuleRunning = true;
      break;
    }
  }

  // Process timer decrements and expirations.
  for (const [key, entry] of ps.instrumentStates) {
    if (!ps.activeParts.has(entry.moduleInstanceId)) continue;
    if (entry.state !== ScienceModuleState.RUNNING) continue;

    entry.timer -= dt;

    if (entry.timer <= 0) {
      entry.timer = 0;
      entry.state = ScienceModuleState.COMPLETE;

      const instrDef = getInstrumentById(entry.instrumentId);
      const altitude = Math.max(0, ps.posY);
      const biome = getBiome(altitude, 'EARTH');
      const biomeId: string | null = biome ? biome.id : null;
      const biomeName: string = biome ? biome.name : 'Unknown';
      const multiplier = getScienceMultiplier(altitude, 'EARTH');

      entry.completeBiome = biomeId;
      entry.scienceMultiplier = multiplier;

      const dataLabel = entry.dataType === ScienceDataType.SAMPLE
        ? 'sample collected'
        : 'data ready';

      flightState.events.push({
        type:              'SCIENCE_COLLECTED',
        time:              flightState.timeElapsed,
        instanceId:        entry.moduleInstanceId,
        instrumentId:      entry.instrumentId,
        instrumentKey:     key,
        altitude,
        biome:             biomeId,
        scienceMultiplier: multiplier,
        dataType:          entry.dataType,
        description:       `${instrDef?.name ?? 'Instrument'} experiment complete in ${biomeName} (${multiplier}×) — ${dataLabel} at ${altitude.toFixed(0)} m.`,
      });

      // Update legacy module state.
      _syncLegacyModuleState(ps, entry.moduleInstanceId);
    }
  }

  // Also tick legacy module entries (for modules with no instruments loaded).
  _tickLegacyModules(ps, assembly, flightState, dt);
}

/** Backward-compatible alias — called by physics.js tick. */
export function tickScienceModules(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  dt: number,
): void {
  tickInstruments(ps, assembly, flightState, dt);
}

// ---------------------------------------------------------------------------
// Status queries
// ---------------------------------------------------------------------------

/**
 * Return the instrument state for a given key.
 */
export function getInstrumentStatus(ps: SciencePhysicsState, key: string): string {
  if (!ps.instrumentStates) return ScienceModuleState.IDLE;
  return ps.instrumentStates.get(key)?.state ?? ScienceModuleState.IDLE;
}

/**
 * Return the remaining timer for a running instrument.
 */
export function getInstrumentTimer(ps: SciencePhysicsState, key: string): number {
  if (!ps.instrumentStates) return 0;
  const entry = ps.instrumentStates.get(key);
  return entry?.state === ScienceModuleState.RUNNING ? entry.timer : 0;
}

/**
 * Return all instrument keys belonging to a specific science module.
 */
export function getModuleInstrumentKeys(ps: SciencePhysicsState, moduleInstanceId: string): string[] {
  if (!ps.instrumentStates) return [];
  const keys: string[] = [];
  for (const [key, entry] of ps.instrumentStates) {
    if (entry.moduleInstanceId === moduleInstanceId) keys.push(key);
  }
  return keys;
}

/**
 * Return the overall status of a science module (legacy API).
 * Reports the "worst" state among all instruments:
 *   data_returned > transmitted > complete > running > idle
 */
export function getScienceModuleStatus(ps: SciencePhysicsState, instanceId: string): string {
  // Check instrument states first.
  if (ps.instrumentStates && ps.instrumentStates.size > 0) {
    const keys = getModuleInstrumentKeys(ps, instanceId);
    if (keys.length > 0) {
      const states = keys.map((k) => ps.instrumentStates!.get(k)?.state ?? ScienceModuleState.IDLE);
      // Priority order for "summary" status.
      if (states.some((s) => s === ScienceModuleState.RUNNING)) return ScienceModuleState.RUNNING;
      if (states.some((s) => s === ScienceModuleState.COMPLETE)) return ScienceModuleState.COMPLETE;
      if (states.some((s) => s === ScienceModuleState.DATA_RETURNED)) return ScienceModuleState.DATA_RETURNED;
      if (states.some((s) => s === ScienceModuleState.TRANSMITTED)) return ScienceModuleState.TRANSMITTED;
      return ScienceModuleState.IDLE;
    }
  }

  // Fallback to legacy map.
  if (!ps.scienceModuleStates) return ScienceModuleState.IDLE;
  return ps.scienceModuleStates.get(instanceId)?.state ?? ScienceModuleState.IDLE;
}

/**
 * Return remaining timer for a science module (legacy API).
 * Returns the max timer across all running instruments.
 */
export function getScienceModuleTimer(ps: SciencePhysicsState, instanceId: string): number {
  if (ps.instrumentStates && ps.instrumentStates.size > 0) {
    const keys = getModuleInstrumentKeys(ps, instanceId);
    let maxTimer = 0;
    for (const k of keys) {
      const entry = ps.instrumentStates.get(k);
      if (entry?.state === ScienceModuleState.RUNNING) {
        maxTimer = Math.max(maxTimer, entry.timer);
      }
    }
    if (keys.length > 0) return maxTimer;
  }

  if (!ps.scienceModuleStates) return 0;
  const entry = ps.scienceModuleStates.get(instanceId);
  return entry?.state === ScienceModuleState.RUNNING ? entry.timer : 0;
}

// ---------------------------------------------------------------------------
// Safe-landing resolution
// ---------------------------------------------------------------------------

/**
 * Recover science data from all completed instruments via safe landing.
 * Awards full yield for both SAMPLE and ANALYSIS data.
 */
export function onSafeLanding(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  gameState?: GameState | null,
): void {
  // Process instrument-based modules.
  if (ps.instrumentStates) {
    for (const [key, entry] of ps.instrumentStates) {
      if (!ps.activeParts.has(entry.moduleInstanceId)) continue;
      if (entry.state !== ScienceModuleState.COMPLETE) continue;

      entry.state = ScienceModuleState.DATA_RETURNED;

      const instrDef = getInstrumentById(entry.instrumentId);
      const scienceYield = calculateYield(
        entry.instrumentId,
        entry.completeBiome,
        entry.scienceMultiplier,
        _getCrewScienceSkill(flightState, gameState ?? null),
        gameState ?? null,
      );

      // Record for diminishing returns.
      if (gameState) {
        _recordCollection(gameState, entry.instrumentId, entry.completeBiome);
      }

      flightState.events.push({
        type:            'SCIENCE_DATA_RETURNED',
        time:            flightState.timeElapsed,
        instanceId:      entry.moduleInstanceId,
        instrumentId:    entry.instrumentId,
        instrumentKey:   key,
        scienceYield,
        dataType:        entry.dataType,
        description:     `${instrDef?.name ?? 'Instrument'} data returned — ${scienceYield.toFixed(1)} science points.`,
      });
    }
  }

  // Process legacy module entries (modules with no instruments).
  if (ps.scienceModuleStates) {
    for (const [instanceId, entry] of ps.scienceModuleStates) {
      if (!ps.activeParts.has(instanceId)) continue;
      if (entry.state !== ScienceModuleState.COMPLETE) continue;

      // Only process if no instruments are loaded in this module.
      const instrKeys = getModuleInstrumentKeys(ps, instanceId);
      if (instrKeys.length > 0) {
        // Update legacy state from instrument states.
        _syncLegacyModuleState(ps, instanceId);
        continue;
      }

      entry.state = ScienceModuleState.DATA_RETURNED;

      const placed = assembly.parts.get(instanceId);
      const def = placed ? getPartById(placed.partId) : null;

      flightState.events.push({
        type:        'SCIENCE_DATA_RETURNED',
        time:        flightState.timeElapsed,
        instanceId,
        description: `${def?.name ?? 'Science Module'} data successfully returned to ground!`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Utility queries
// ---------------------------------------------------------------------------

/**
 * Return `true` if any instrument or legacy module is currently running.
 */
export function hasAnyRunningExperiment(ps: SciencePhysicsState): boolean {
  if (ps.instrumentStates) {
    for (const [, entry] of ps.instrumentStates) {
      if (!ps.activeParts.has(entry.moduleInstanceId)) continue;
      if (entry.state === ScienceModuleState.RUNNING) return true;
    }
  }
  if (ps.scienceModuleStates) {
    for (const [instanceId, entry] of ps.scienceModuleStates) {
      if (!ps.activeParts.has(instanceId)) continue;
      if (entry.state === ScienceModuleState.RUNNING) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Yield calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the final science yield for an instrument collection.
 *
 * Formula: baseYield × biomeMultiplier × scienceSkillBonus × diminishingReturn
 */
export function calculateYield(
  instrumentId: string,
  biomeId: string | null,
  biomeMultiplier: number,
  scienceSkill: number,
  gameState: GameState | null,
): number {
  const instrDef = getInstrumentById(instrumentId);
  if (!instrDef) return 0;

  const baseYield: number = instrDef.baseYield;

  // Science skill bonus: 0 skill = 1.0×, 100 skill = 1.5×.
  const scienceSkillBonus = 1.0 + (scienceSkill / 100) * 0.5;

  // Diminishing return based on prior collections of this (instrument, biome) pair.
  const priorCount = _getPriorCollectionCount(gameState, instrumentId, biomeId);
  const diminishingReturn = priorCount < (DIMINISHING_RETURNS as readonly number[]).length
    ? (DIMINISHING_RETURNS as readonly number[])[priorCount]
    : 0;

  // R&D Lab science yield bonus based on facility tier.
  const rdLabBonus = _getRdLabScienceBonus(gameState);

  return Math.round(baseYield * biomeMultiplier * scienceSkillBonus * diminishingReturn * (1 + rdLabBonus) * 100) / 100;
}

/**
 * Get the R&D Lab science yield bonus based on the current facility tier.
 *
 * @returns Bonus fraction (e.g. 0.10 for +10%).
 */
function _getRdLabScienceBonus(gameState: GameState | null): number {
  if (!gameState) return 0;
  const fac = gameState.facilities[FacilityId.RD_LAB];
  if (!fac?.built) return 0;
  const tier: number = fac.tier ?? 1;
  return (RD_LAB_SCIENCE_BONUS as Record<number, number>)[tier] ?? 0;
}

// ---------------------------------------------------------------------------
// Private — legacy module state sync
// ---------------------------------------------------------------------------

/**
 * Synchronise the legacy `ps.scienceModuleStates` entry for a module based
 * on the current state of its instruments.
 */
function _syncLegacyModuleState(ps: SciencePhysicsState, moduleInstanceId: string): void {
  if (!ps.scienceModuleStates || !ps.instrumentStates) return;

  const keys = getModuleInstrumentKeys(ps, moduleInstanceId);
  if (keys.length === 0) return;

  const legacyEntry = ps.scienceModuleStates.get(moduleInstanceId);
  if (!legacyEntry) return;

  // Summarise instrument states into the module-level legacy state.
  const states = keys.map((k) => ps.instrumentStates!.get(k)?.state ?? ScienceModuleState.IDLE);

  if (states.some((s) => s === ScienceModuleState.RUNNING)) {
    legacyEntry.state = ScienceModuleState.RUNNING;
    // Set timer to max across running instruments.
    let maxTimer = 0;
    for (const k of keys) {
      const e = ps.instrumentStates.get(k);
      if (e?.state === ScienceModuleState.RUNNING) maxTimer = Math.max(maxTimer, e.timer);
    }
    legacyEntry.timer = maxTimer;
  } else if (states.some((s) => s === ScienceModuleState.COMPLETE)) {
    legacyEntry.state = ScienceModuleState.COMPLETE;
    legacyEntry.timer = 0;
  } else if (states.every((s) => s === ScienceModuleState.DATA_RETURNED || s === ScienceModuleState.TRANSMITTED)) {
    legacyEntry.state = ScienceModuleState.DATA_RETURNED;
    legacyEntry.timer = 0;
  } else {
    legacyEntry.state = ScienceModuleState.IDLE;
    legacyEntry.timer = 0;
  }
}

/**
 * Tick legacy module entries that have no instruments loaded.
 * These modules behave exactly as the old single-experiment model.
 */
function _tickLegacyModules(
  ps: SciencePhysicsState,
  assembly: ScienceAssembly,
  flightState: ScienceFlightState,
  dt: number,
): void {
  if (!ps.scienceModuleStates) return;

  for (const [instanceId, entry] of ps.scienceModuleStates) {
    if (!ps.activeParts.has(instanceId)) continue;

    // Skip modules that have instruments — they're ticked via instrumentStates.
    const instrKeys = getModuleInstrumentKeys(ps, instanceId);
    if (instrKeys.length > 0) continue;

    if (entry.state === ScienceModuleState.RUNNING) {
      flightState.scienceModuleRunning = true;
      entry.timer -= dt;

      if (entry.timer <= 0) {
        entry.timer = 0;
        entry.state = ScienceModuleState.COMPLETE;

        const placed = assembly.parts.get(instanceId);
        const def = placed ? getPartById(placed.partId) : null;
        const altitude = Math.max(0, ps.posY);
        const biome = getBiome(altitude, 'EARTH');
        const biomeId: string | null = biome ? biome.id : null;
        const biomeName: string = biome ? biome.name : 'Unknown';
        const multiplier = getScienceMultiplier(altitude, 'EARTH');

        entry.completeBiome = biomeId;
        entry.scienceMultiplier = multiplier;

        flightState.events.push({
          type:              'SCIENCE_COLLECTED',
          time:              flightState.timeElapsed,
          instanceId,
          altitude,
          biome:             biomeId,
          scienceMultiplier: multiplier,
          description:       `${def?.name ?? 'Science Module'} experiment complete in ${biomeName} (${multiplier}×) — data ready for recovery at ${altitude.toFixed(0)} m.`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Private — diminishing returns tracking
// ---------------------------------------------------------------------------

/**
 * Get the number of prior collections for an (instrument, biome) pair.
 */
function _getPriorCollectionCount(
  gameState: GameState | null,
  instrumentId: string,
  biomeId: string | null,
): number {
  if (!gameState?.scienceLog) return 0;
  const entry = gameState.scienceLog.find(
    (e: ScienceLogEntry) => e.instrumentId === instrumentId && e.biomeId === (biomeId ?? ''),
  );
  return entry ? entry.count : 0;
}

/**
 * Record a successful science collection for diminishing-return tracking.
 */
function _recordCollection(
  gameState: GameState,
  instrumentId: string,
  biomeId: string | null,
): void {
  if (!gameState.scienceLog) gameState.scienceLog = [];
  const normalizedBiome = biomeId ?? '';

  const existing = gameState.scienceLog.find(
    (e: ScienceLogEntry) => e.instrumentId === instrumentId && e.biomeId === normalizedBiome,
  );

  if (existing) {
    existing.count += 1;
  } else {
    gameState.scienceLog.push({
      instrumentId,
      biomeId: normalizedBiome,
      count: 1,
    });
  }
}

// ---------------------------------------------------------------------------
// Private — crew science skill helper
// ---------------------------------------------------------------------------

/**
 * Get the best crew science skill from the flight's crew.
 *
 * @returns Science skill 0–100 (0 if no crew or no data).
 */
function _getCrewScienceSkill(flightState: ScienceFlightState, gameState: GameState | null): number {
  const gs = gameState;
  const crewIds = flightState?.crewIds;
  if (!gs || !crewIds || !crewIds.length) return 0;

  let max = 0;
  for (const id of crewIds) {
    const member = gs.crew?.find((c) => c.id === id);
    if (member?.skills?.science != null) {
      max = Math.max(max, member.skills.science);
    }
  }
  return max;
}
