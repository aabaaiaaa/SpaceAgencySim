/**
 * craftRecovery.ts — Recovery flow for persisted player craft.
 *
 * Any FieldCraft can be "recovered" — parts returned to inventory, salvage
 * cash credited, craft removed from tracking — but only when the craft is
 * within logistical reach of an online agency hub:
 *
 *   - Landed craft: there is an online surface hub on the same body.
 *   - Orbital craft: there is an online orbital hub around the same body.
 *
 * Elsewhere the craft stays persisted indefinitely. The player can still
 * Take Control of it and fly it back to a recovery-capable location.
 *
 * @module core/craftRecovery
 */

import type { GameState, FieldCraft, InventoryPart } from './gameState.ts';
import { designToAssembly } from './rocketbuilder.ts';
import { addToInventory } from './partInventory.ts';
import { earn } from './finance.ts';
import { getPartById } from '../data/parts.ts';
import { FieldCraftStatus } from './constants.ts';

/** Base fraction of each part's cost credited as salvage. */
const SALVAGE_VALUE_FRACTION = 0.5;

/** Wear added to parts returned to inventory via remote salvage. */
const SALVAGE_WEAR_PER_PART = 40;

export type RecoveryFailureReason =
  | 'craftNotFound'
  | 'noHubInRange'
  | 'noDesignLinked'
  | 'designNotFound';

export class RecoveryUnavailableError extends Error {
  reason: RecoveryFailureReason;
  constructor(reason: RecoveryFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'RecoveryUnavailableError';
  }
}

export interface RecoveryEligibility {
  allowed: boolean;
  /** Present when allowed=false. */
  reason?: RecoveryFailureReason;
}

export interface RecoveryResult {
  craftId: string;
  partsRecovered: number;
  entries: InventoryPart[];
  salvageValue: number;
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Determine whether a field craft can be recovered at its current location.
 *
 * Landed craft require an online surface hub on the same body.
 * Orbital craft require an online orbital hub around the same body.
 */
export function canRecoverFieldCraft(state: GameState, craft: FieldCraft): RecoveryEligibility {
  const hubs = state.hubs ?? [];
  if (craft.status === FieldCraftStatus.LANDED) {
    const hasSurfaceHub = hubs.some(
      (h) => h.bodyId === craft.bodyId && h.type === 'surface' && h.online,
    );
    return hasSurfaceHub ? { allowed: true } : { allowed: false, reason: 'noHubInRange' };
  }
  // IN_ORBIT
  const hasOrbitalHub = hubs.some(
    (h) => h.bodyId === craft.bodyId && h.type === 'orbital' && h.online,
  );
  return hasOrbitalHub ? { allowed: true } : { allowed: false, reason: 'noHubInRange' };
}

// ---------------------------------------------------------------------------
// Recovery action
// ---------------------------------------------------------------------------

/**
 * Recover a field craft: return its parts to inventory, credit salvage cash,
 * and remove the craft from state.fieldCraft.
 *
 * Throws RecoveryUnavailableError if the craft cannot be recovered (no hub in
 * range, craft not found, design not linked, or design not in state).
 */
export function recoverFieldCraft(state: GameState, craftId: string): RecoveryResult {
  const craft = (state.fieldCraft ?? []).find((c) => c.id === craftId);
  if (!craft) {
    throw new RecoveryUnavailableError('craftNotFound', `Field craft not found: ${craftId}`);
  }

  const eligibility = canRecoverFieldCraft(state, craft);
  if (!eligibility.allowed) {
    throw new RecoveryUnavailableError(
      eligibility.reason ?? 'noHubInRange',
      `Cannot recover ${craft.name}: no recovery-capable hub at ${craft.bodyId}`,
    );
  }

  if (!craft.rocketDesignId) {
    throw new RecoveryUnavailableError(
      'noDesignLinked',
      `Cannot recover ${craft.name}: no rocket design linked`,
    );
  }

  const design = (state.savedDesigns ?? []).find((d) => d.id === craft.rocketDesignId);
  if (!design) {
    throw new RecoveryUnavailableError(
      'designNotFound',
      `Cannot recover ${craft.name}: design ${craft.rocketDesignId} not in state`,
    );
  }

  const assembly = designToAssembly(design);

  // Recover parts + compute salvage value.
  const entries: InventoryPart[] = [];
  let salvageValue = 0;
  for (const [, placed] of assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    const entry = addToInventory(state, placed.partId, SALVAGE_WEAR_PER_PART, 1);
    entries.push(entry);
    salvageValue += Math.round((def.cost ?? 0) * SALVAGE_VALUE_FRACTION);
  }
  if (salvageValue > 0) earn(state, salvageValue);

  // Remove the craft.
  state.fieldCraft = (state.fieldCraft ?? []).filter((c) => c.id !== craftId);

  return {
    craftId,
    partsRecovered: entries.length,
    entries,
    salvageValue,
  };
}
