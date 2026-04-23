/**
 * fieldCraftResume.ts — Take-Control flow for crewed vessels deployed in the field.
 *
 * Given a `FieldCraft` entry, rebuild the rocket assembly from its recorded
 * design and return a fully-populated FlightState + initial physics state so
 * the flight scene can resume in orbit (or landed) where the craft was left.
 *
 * Removing the field craft from `state.fieldCraft` is the caller's
 * responsibility (after a successful flight start).
 *
 * @module core/fieldCraftResume
 */

import type { GameState, FieldCraft, FlightState, OrbitalElements, OrbitalObject, RocketDesign, PersistedCraftState } from './gameState.ts';
import type { RocketAssembly, StagingConfig } from './rocketbuilder.ts';
import { createFlightState } from './gameState.ts';
import { designToAssembly, designToStagingConfig } from './rocketbuilder.ts';
import { orbitalStateToCartesian, circularOrbitVelocity } from './orbit.ts';
import { FlightPhase, FieldCraftStatus, OrbitalObjectType } from './constants.ts';
import type { CelestialBody } from './constants.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discriminator for which list a resumable craft lives in. */
export type ResumeSource = 'fieldCraft' | 'orbitalObject';

export interface ResumePreparedFlight {
  assembly: RocketAssembly;
  stagingConfig: StagingConfig;
  flightState: FlightState;
  /** Optional physics-state overrides applied after createPhysicsState(). */
  initialState: {
    posX: number;
    posY: number;
    velX: number;
    velY: number;
  };
  /** Which collection the craft came from. */
  source: ResumeSource;
  /** Original entry id in its collection (caller removes it on success). */
  sourceId: string;
  /** The design used to rebuild the assembly. */
  design: RocketDesign;
  /** Persisted runtime state captured at the end of the prior flight. */
  craftState?: PersistedCraftState;
}

export type ResumeFailureReason =
  | 'craftNotFound'
  | 'notResumable'
  | 'noDesignLinked'
  | 'designNotFound';

export class ResumeUnavailableError extends Error {
  reason: ResumeFailureReason;
  constructor(reason: ResumeFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'ResumeUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Locate a resumable craft by id in either `fieldCraft` or `orbitalObjects`. */
function _lookupCraft(
  state: GameState,
  craftId: string,
): { source: ResumeSource; fieldCraft?: FieldCraft; orbitalObject?: OrbitalObject } | null {
  const fc = (state.fieldCraft ?? []).find((c) => c.id === craftId);
  if (fc) return { source: 'fieldCraft', fieldCraft: fc };
  const oo = (state.orbitalObjects ?? []).find((o) => o.id === craftId);
  if (oo) return { source: 'orbitalObject', orbitalObject: oo };
  return null;
}

/**
 * Predicate: is the given id a craft the player can take control of?
 *
 * A craft is resumable when it's either a field craft or an orbital object of
 * type CRAFT/STATION, AND it has a linked `rocketDesignId` that still exists
 * in `state.savedDesigns`.
 */
/** Orbital-object types that can be controlled when a design is linked. */
const RESUMABLE_ORBITAL_TYPES = new Set<string>([
  OrbitalObjectType.CRAFT,
  OrbitalObjectType.STATION,
  OrbitalObjectType.SATELLITE,
]);

/**
 * Look up a rocket design by id across both state.savedDesigns (user-saved
 * templates) and state.rockets (ad-hoc launch designs). VAB quick-launches
 * push to state.rockets only, so falling back keeps those craft resumable.
 */
function _findDesign(state: GameState, designId: string): RocketDesign | undefined {
  return (
    (state.savedDesigns ?? []).find((d) => d.id === designId)
    ?? (state.rockets ?? []).find((d) => d.id === designId)
  );
}

export function canResumeCraft(state: GameState, craftId: string): boolean {
  const hit = _lookupCraft(state, craftId);
  if (!hit) return false;
  let designId: string | undefined;
  if (hit.source === 'fieldCraft') {
    designId = hit.fieldCraft!.rocketDesignId;
  } else {
    const t = hit.orbitalObject!.type;
    if (!RESUMABLE_ORBITAL_TYPES.has(t)) return false;
    designId = hit.orbitalObject!.rocketDesignId;
  }
  if (!designId) return false;
  return !!_findDesign(state, designId);
}

/** Back-compat alias used by the crewed-vessels sidebar card. */
export function canResumeFieldCraft(state: GameState, fieldCraftId: string): boolean {
  return canResumeCraft(state, fieldCraftId);
}

/**
 * Prepare the inputs needed to start a flight that resumes control of the
 * given craft.  Does NOT mutate the game state — the caller is responsible
 * for removing the source entry on successful flight start.
 *
 * Throws {@link ResumeUnavailableError} if the craft cannot be resumed.
 */
export function prepareCraftResume(state: GameState, craftId: string): ResumePreparedFlight {
  const hit = _lookupCraft(state, craftId);
  if (!hit) {
    throw new ResumeUnavailableError('craftNotFound', `Craft ${craftId} not found`);
  }

  let designId: string | undefined;
  let bodyId: string;
  let inOrbit: boolean;
  let orbitalElements: OrbitalElements | null;
  let crewIds: string[];
  let orbitBandId: string | null;
  let displayName: string;
  let craftState: PersistedCraftState | undefined;

  if (hit.source === 'fieldCraft') {
    const fc = hit.fieldCraft!;
    designId = fc.rocketDesignId;
    bodyId = fc.bodyId;
    inOrbit = fc.status === FieldCraftStatus.IN_ORBIT;
    orbitalElements = inOrbit ? fc.orbitalElements : null;
    crewIds = fc.crewIds ?? [];
    orbitBandId = fc.orbitBandId ?? null;
    displayName = fc.name;
    craftState = fc.craftState;
  } else {
    const oo = hit.orbitalObject!;
    if (!RESUMABLE_ORBITAL_TYPES.has(oo.type)) {
      throw new ResumeUnavailableError('notResumable', `${oo.name} is a ${oo.type.toLowerCase()} and cannot be controlled`);
    }
    designId = oo.rocketDesignId;
    bodyId = oo.bodyId;
    inOrbit = true;
    orbitalElements = oo.elements;
    crewIds = [];
    orbitBandId = null;
    displayName = oo.name;
    craftState = oo.craftState;
  }

  if (!designId) {
    throw new ResumeUnavailableError('noDesignLinked', `${displayName} has no linked rocket design`);
  }
  const design = _findDesign(state, designId);
  if (!design) {
    throw new ResumeUnavailableError('designNotFound', `Rocket design ${designId} (for ${displayName}) is no longer available`);
  }

  const assembly = designToAssembly(design);
  const stagingConfig = designToStagingConfig(design, assembly);

  let initialState = { posX: 0, posY: 0, velX: 0, velY: 0 };
  if (inOrbit && orbitalElements) {
    initialState = orbitalStateToCartesian(orbitalElements, 0, bodyId);
    if (!Number.isFinite(initialState.velX) || initialState.velX === 0) {
      initialState.velX = circularOrbitVelocity(initialState.posY, bodyId);
      initialState.velY = 0;
    }
  }

  const flightState = createFlightState({
    missionId: '',
    rocketId: design.id,
    crewIds,
    bodyId: bodyId as CelestialBody,
  });
  flightState.phase = inOrbit ? FlightPhase.ORBIT : FlightPhase.REENTRY;
  flightState.inOrbit = inOrbit;
  flightState.orbitalElements = orbitalElements ? { ...orbitalElements } : null;
  flightState.orbitBandId = orbitBandId;
  flightState.altitude = initialState.posY;

  return {
    assembly,
    stagingConfig,
    flightState,
    initialState,
    source: hit.source,
    sourceId: craftId,
    design,
    craftState,
  };
}

/** Back-compat alias used by the crewed-vessels sidebar card. */
export function prepareFieldCraftResume(state: GameState, fieldCraftId: string): ResumePreparedFlight {
  return prepareCraftResume(state, fieldCraftId);
}
