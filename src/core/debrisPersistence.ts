/**
 * debrisPersistence.ts — Persist controllable debris as FieldCraft at flight end.
 *
 * When a multi-stage rocket decouples, parts of it may continue under
 * independent physics as DebrisState fragments. If a fragment carries an
 * intact command module or probe core, and the flight ends with that
 * fragment either in a stable orbit or safely landed on a non-home body,
 * it becomes its own persisted controllable craft. A synthetic RocketDesign
 * is generated so the Take Control flow can rebuild the assembly later.
 *
 * Fragments without command capability, crashed, on suborbital trajectories,
 * or landed back on Earth (which auto-recovers) are ignored.
 *
 * @module core/debrisPersistence
 */

import type {
  GameState,
  FieldCraft,
  RocketDesign,
  RocketPart,
  OrbitalElements,
} from './gameState.ts';
import type { RocketAssembly, PlacedPart } from './physics.ts';
import type { DebrisState } from './staging.ts';
import { getPartById } from '../data/parts.ts';
import { PartType, FieldCraftStatus } from './constants.ts';
import { createFieldCraft } from './lifeSupport.ts';
import { checkOrbitStatus } from './orbit.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspect each debris fragment and persist the ones that end the flight as
 * controllable craft. Returns the FieldCrafts created (also pushed to
 * `state.fieldCraft`).
 */
export function persistControllableDebris(
  state: GameState,
  debris: DebrisState[],
  assembly: RocketAssembly,
  flightState: { bodyId?: string; rocketId?: string },
): FieldCraft[] {
  const created: FieldCraft[] = [];
  const bodyId: string = flightState.bodyId ?? 'EARTH';

  if (!Array.isArray(state.fieldCraft)) state.fieldCraft = [];
  if (!Array.isArray(state.rockets)) state.rockets = [];

  for (const frag of debris) {
    if (frag.crashed) continue;
    if (!_hasIntactCommandCapability(frag, assembly)) continue;

    const status = _classifyTrajectory(frag, bodyId);
    if (!status) continue; // Suborbital or landed-on-Earth — skip.

    const design = _createSyntheticDesign(state, frag, assembly, flightState.rocketId);
    state.rockets.push(design);

    const fragFuel: Record<string, number> = {};
    for (const [id, kg] of frag.fuelStore) {
      if (kg > 0 && frag.activeParts.has(id)) fragFuel[id] = kg;
    }
    const fragActive = Array.from(frag.activeParts);
    const fragFiring = Array.from(frag.firingEngines).filter((id) => frag.activeParts.has(id));
    // Synthetic design has one stage containing all debris parts — preserve
    // it as the "next" stage so the player can still stage/activate things.
    const fragRemainingStages: string[][] = [fragActive];

    const fc = createFieldCraft(state, {
      name: design.name,
      bodyId,
      status: status.status,
      crewIds: [],
      hasExtendedLifeSupport: false,
      hasCommandCapability: true,
      deployedPeriod: state.currentPeriod,
      orbitalElements: status.orbitalElements,
      orbitBandId: null,
      rocketDesignId: design.id,
      craftState: {
        activePartIds: fragActive,
        firingEngineIds: fragFiring,
        fuelStore: fragFuel,
        remainingStages: fragRemainingStages,
        unstagedParts: [],
      },
    });
    state.fieldCraft.push(fc);
    created.push(fc);
  }

  return created;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** True if the fragment has at least one intact command module or probe core. */
function _hasIntactCommandCapability(frag: DebrisState, assembly: RocketAssembly): boolean {
  for (const instanceId of frag.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    if (def.type === PartType.COMMAND_MODULE || def.type === PartType.COMPUTER_MODULE) {
      return true;
    }
  }
  return false;
}

interface ClassifiedTrajectory {
  status: FieldCraftStatus;
  orbitalElements: OrbitalElements | null;
}

/**
 * Determine whether the fragment is in a persistable state. Landed on Earth
 * returns null (no persistence — parts auto-recover). Unstable suborbital
 * trajectories return null. Stable orbit or landed non-Earth → persistable.
 */
function _classifyTrajectory(frag: DebrisState, bodyId: string): ClassifiedTrajectory | null {
  if (frag.landed) {
    if (bodyId === 'EARTH') return null;
    return { status: FieldCraftStatus.LANDED, orbitalElements: null };
  }

  const status = checkOrbitStatus(frag.posX, frag.posY, frag.velX, frag.velY, bodyId);
  if (!status.valid || !status.elements) return null;
  return { status: FieldCraftStatus.IN_ORBIT, orbitalElements: status.elements };
}

/**
 * Build a synthetic RocketDesign representing just the fragment's active parts
 * so the Take Control flow can rebuild the assembly from design alone.
 * Positions are preserved from the parent assembly so the rebuild looks the
 * same as the parts did when attached. All activatable parts are folded into
 * a single stage — multi-stage logic within the fragment is not attempted.
 */
function _createSyntheticDesign(
  state: GameState,
  frag: DebrisState,
  parentAssembly: RocketAssembly,
  parentRocketId: string | undefined,
): RocketDesign {
  const parts: RocketPart[] = [];
  const instanceIds: string[] = [];
  for (const instanceId of frag.activeParts) {
    const placed = parentAssembly.parts.get(instanceId) as (PlacedPart & { x?: number; y?: number }) | undefined;
    if (!placed) continue;
    parts.push({
      partId: placed.partId,
      position: { x: (placed.x ?? 0), y: (placed.y ?? 0) },
    });
    instanceIds.push(instanceId);
  }

  const designId = `detached-${parentRocketId ?? 'unknown'}-${frag.id}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  return {
    id: designId,
    name: `Detached Stage (${frag.id})`,
    parts,
    staging: { stages: [instanceIds], unstaged: [] },
    totalMass: 0,
    totalThrust: 0,
    createdDate: now,
    updatedDate: now,
  };
}
