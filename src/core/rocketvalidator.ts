/**
 * rocketvalidator.ts — Rocket Engineer validation checks.
 *
 * Pure core module: no DOM or canvas dependencies.
 * Call `runValidation()` after every assembly or staging change to get an
 * up-to-date ValidationResult that drives the Launch button and the Rocket
 * Engineer panel UI.
 *
 * VALIDATION CHECKS (in order)
 * =============================
 *  1. Command/Computer module present          (blocking)
 *  2. All parts connected to root              (blocking)
 *  3. Stage 1 has at least one engine or SRB   (blocking)
 *  4. Stage 1 TWR > 1.0                        (blocking, shows TWR value)
 *  5. Crewed mission with only computer module (warning — non-blocking)
 *  6. All parts unlocked via tech tree         (blocking)
 */

import { getPartById } from '../data/parts.ts';
import { ActivationBehaviour } from '../data/parts.ts';
import { PartType, FacilityId, LAUNCH_PAD_MAX_MASS, VAB_MAX_PARTS, VAB_MAX_HEIGHT, VAB_MAX_WIDTH } from './constants.ts';
import { TECH_NODES } from '../data/techtree.ts';
import { getFacilityTier } from './construction.ts';

import type { GameState } from './gameState.ts';
import type { RocketAssembly, StagingConfig } from './rocketbuilder.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Standard gravity (m/s²) used for TWR calculation. */
const G = 9.81;

/**
 * Format a mass value for human display.
 */
function _fmtMass(kg: number): string {
  if (!isFinite(kg)) return 'unlimited';
  return kg.toLocaleString('en-US', { maximumFractionDigits: 0 }) + ' kg';
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * One check's result within a ValidationResult.
 */
export interface ValidationCheck {
  /** Unique check identifier (stable string key). */
  id: string;
  /** Short heading shown in the Rocket Engineer panel. */
  label: string;
  /** Whether this check passed. */
  pass: boolean;
  /** If true, a failure is a warning and does NOT block launch. */
  warn: boolean;
  /** Human-readable result message (1–2 sentences). */
  message: string;
}

/**
 * Complete result returned by runValidation.
 */
export interface ValidationResult {
  /** All performed checks in display order. */
  checks: ValidationCheck[];
  /** True when every blocking check passes. */
  canLaunch: boolean;
  /** Wet mass of the rocket in kg (dry + fuel). */
  totalMassKg: number;
  /** Sea-level thrust of Stage-1 engines (kN). */
  stage1Thrust: number;
  /** Stage-1 thrust-to-weight ratio. */
  twr: number;
  /** Whether the assembly contains launch clamp parts. */
  hasLaunchClamp: boolean;
}

// ---------------------------------------------------------------------------
// Mass / thrust helpers (exported for display in the UI and for tests)
// ---------------------------------------------------------------------------

/**
 * Calculate the total wet mass of all parts in a rocket assembly.
 *
 * For every placed part the wet mass is: `def.mass + (def.properties.fuelMass ?? 0)`.
 * Fuel tanks and SRBs carry `fuelMass` in their `properties` object; engines and
 * structural parts do not, so they contribute only their dry `mass`.
 */
export function getTotalMass(assembly: RocketAssembly): number {
  let total = 0;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    total += def.mass + ((def.properties?.fuelMass as number) ?? 0);
  }
  return total;
}

/**
 * Calculate the combined sea-level thrust of all Stage-1 IGNITE parts.
 *
 * Only parts assigned to `stagingConfig.stages[0]` with
 * `activationBehaviour === ActivationBehaviour.IGNITE` contribute.
 */
export function getStage1Thrust(assembly: RocketAssembly, stagingConfig: StagingConfig): number {
  const stage1 = stagingConfig.stages[0];
  if (!stage1) return 0;

  let total = 0;
  for (const id of stage1.instanceIds) {
    const placed = assembly.parts.get(id);
    const def = placed ? getPartById(placed.partId) : null;
    if (!def || def.activationBehaviour !== ActivationBehaviour.IGNITE) continue;
    total += (def.properties?.thrust as number) ?? 0;
  }
  return total;
}

/**
 * Compute the Stage-1 thrust-to-weight ratio.
 *
 * TWR = (stage1Thrust_kN × 1000) / (totalMass_kg × G)
 *
 * Returns 0 when totalMass is 0 (empty assembly).
 */
export function calculateTWR(assembly: RocketAssembly, stagingConfig: StagingConfig): number {
  const totalMass = getTotalMass(assembly);
  if (totalMass === 0) return 0;
  const thrust = getStage1Thrust(assembly, stagingConfig);
  return (thrust * 1000) / (totalMass * G);
}

// ---------------------------------------------------------------------------
// Rocket bounds (for auto-zoom)
// ---------------------------------------------------------------------------

/**
 * Calculate the axis-aligned bounding box of all placed parts in the assembly.
 *
 * Returns null when the assembly has no parts.
 */
export function getRocketBounds(
  assembly: RocketAssembly,
): { minX: number; maxX: number; minY: number; maxY: number } | null {
  if (!assembly || assembly.parts.size === 0) return null;

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    const hw = def.width  / 2;
    const hh = def.height / 2;
    minX = Math.min(minX, placed.x - hw);
    maxX = Math.max(maxX, placed.x + hw);
    minY = Math.min(minY, placed.y - hh);
    maxY = Math.max(maxY, placed.y + hh);
  }

  if (minX === Infinity) return null;
  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// Private helper — undirected connectivity BFS
// ---------------------------------------------------------------------------

/**
 * Build an undirected adjacency map from the assembly's connection list.
 *
 * Every connection edge `fromInstanceId ↔ toInstanceId` is stored in both
 * directions so the BFS can traverse the graph regardless of how the edge
 * was registered.
 */
function _buildAdjacency(assembly: RocketAssembly): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();

  // Pre-populate every known node with an empty neighbour set.
  for (const id of assembly.parts.keys()) {
    adj.set(id, new Set());
  }

  for (const conn of assembly.connections) {
    adj.get(conn.fromInstanceId)?.add(conn.toInstanceId);
    adj.get(conn.toInstanceId)?.add(conn.fromInstanceId);
  }

  return adj;
}

/**
 * BFS from `startId` through `adjacency`.
 *
 * @returns IDs of all reachable nodes (including startId).
 */
function _bfsReachable(startId: string, adjacency: Map<string, Set<string>>): Set<string> {
  const visited = new Set([startId]);
  const queue   = [startId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const neighbour of (adjacency.get(current) ?? [])) {
      if (!visited.has(neighbour)) {
        visited.add(neighbour);
        queue.push(neighbour);
      }
    }
  }

  return visited;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Run all validation checks against the current rocket assembly and staging
 * configuration, returning a ValidationResult.
 *
 * This function has no side-effects and may be called as frequently as needed
 * (e.g. after every part add/remove or staging change).
 */
export function runValidation(
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  gameState: GameState,
): ValidationResult {
  const checks: ValidationCheck[] = [];

  // ── Pre-scan assembly for part types ──────────────────────────────────────
  let hasCrewedModule   = false; // COMMAND_MODULE with seats > 0
  let hasComputerModule = false; // COMPUTER_MODULE
  let commandModuleId: string | null   = null;  // First COMMAND_MODULE instance ID (root for connectivity)
  let computerModuleId: string | null  = null;  // First COMPUTER_MODULE instance ID (fallback root)

  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;

    if (def.type === PartType.COMMAND_MODULE) {
      hasCrewedModule = true;
      if (commandModuleId === null) commandModuleId = placed.instanceId;
    }
    if (def.type === PartType.COMPUTER_MODULE) {
      hasComputerModule = true;
      if (computerModuleId === null) computerModuleId = placed.instanceId;
    }
  }

  const hasCommandModule = hasCrewedModule || hasComputerModule;
  // True when the assembly has a computer module but NO crewed command module.
  const onlyComputer = hasComputerModule && !hasCrewedModule;

  // ── CHECK 1: Command / Computer module present ────────────────────────────
  checks.push({
    id:      'command-module',
    label:   'Command Module',
    pass:    hasCommandModule,
    warn:    false,
    message: hasCommandModule
      ? (hasCrewedModule
          ? 'Crewed command module present.'
          : 'Computer (probe) module present.')
      : 'No command or computer module in assembly.',
  });

  // ── CHECK 2: All parts connected to root (no floating parts) ─────────────
  const allIds     = new Set(assembly.parts.keys());
  const totalParts = allIds.size;
  let check2Pass: boolean;
  let check2Msg: string;

  if (totalParts === 0) {
    check2Pass = false;
    check2Msg  = 'Assembly is empty — add parts to build a rocket.';
  } else if (totalParts === 1) {
    // A single part is trivially connected to itself.
    check2Pass = true;
    check2Msg  = '1 part in assembly — no connections required.';
  } else {
    // Pick root: prefer COMMAND_MODULE, fallback COMPUTER_MODULE, then first part.
    const rootId = commandModuleId ?? computerModuleId ?? [...allIds][0];

    const adj      = _buildAdjacency(assembly);
    const reachable = _bfsReachable(rootId, adj);

    const floatingCount = totalParts - reachable.size;
    if (floatingCount === 0) {
      check2Pass = true;
      check2Msg  = `All ${totalParts} parts connected to root.`;
    } else {
      check2Pass = false;
      check2Msg  = `${floatingCount} floating part${floatingCount > 1 ? 's' : ''} not connected to root.`;
    }
  }

  checks.push({
    id:      'connectivity',
    label:   'Part Connectivity',
    pass:    check2Pass,
    warn:    false,
    message: check2Msg,
  });

  // ── CHECK 3: Stage 1 has at least one engine or SRB ──────────────────────
  const stage1 = stagingConfig.stages[0];
  const hasIgniteInStage1 = stage1
    ? stage1.instanceIds.some((id) => {
        const placed = assembly.parts.get(id);
        const def    = placed ? getPartById(placed.partId) : null;
        return def?.activationBehaviour === ActivationBehaviour.IGNITE;
      })
    : false;

  checks.push({
    id:      'stage1-engine',
    label:   'Stage 1 Engine',
    pass:    hasIgniteInStage1,
    warn:    false,
    message: hasIgniteInStage1
      ? 'Stage 1 has at least one engine or SRB.'
      : 'Stage 1 has no engine or SRB — assign one in the Staging panel.',
  });

  // ── CHECK 4: Stage 1 TWR > 1.0 ────────────────────────────────────────────
  const totalMassKg  = getTotalMass(assembly);
  const stage1Thrust = getStage1Thrust(assembly, stagingConfig); // kN
  const twr          = calculateTWR(assembly, stagingConfig);
  const twrPass      = twr > 1.0;

  let twrMsg: string;
  if (totalMassKg === 0) {
    twrMsg = 'Assembly is empty.';
  } else if (stage1Thrust === 0) {
    twrMsg = 'TWR: 0.00 — no Stage 1 thrust.';
  } else {
    const twrLabel = twr.toFixed(2);
    twrMsg = twrPass
      ? `TWR: ${twrLabel} — sufficient to lift off.`
      : `TWR: ${twrLabel} — too low (need > 1.0 to lift off).`;
  }

  checks.push({
    id:      'twr',
    label:   'Thrust-to-Weight (Stage 1)',
    pass:    twrPass,
    warn:    false,
    message: twrMsg,
  });

  // ── WARNING 5: Crewed mission accepted but only computer module present ────
  // This is informational only and does not block launch.
  if (hasCommandModule) {
    const hasAcceptedCrewedMission = gameState.missions.accepted.some(
      (m) => ((m as unknown as { requirements?: { minCrewCount?: number } }).requirements?.minCrewCount ?? 0) > 0,
    );

    if (hasAcceptedCrewedMission && onlyComputer) {
      checks.push({
        id:      'crew-module-warn',
        label:   'Crew Warning',
        pass:    false,
        warn:    true, // non-blocking
        message: 'An accepted mission requires crew, but this rocket has no crewed command module.',
      });
    }
  }

  // ── CHECK 5b: Launch Pad max mass limit ──────────────────────────────────
  const padTier = getFacilityTier(gameState, FacilityId.LAUNCH_PAD);
  const maxMass = LAUNCH_PAD_MAX_MASS[padTier] ?? LAUNCH_PAD_MAX_MASS[1];
  const massPass = totalMassKg <= maxMass;

  if (!massPass) {
    checks.push({
      id:      'pad-mass-limit',
      label:   'Launch Pad Mass Limit',
      pass:    false,
      warn:    false,
      message: `Rocket mass ${_fmtMass(totalMassKg)} exceeds Tier ${padTier} pad limit of ${_fmtMass(maxMass)}. Upgrade the Launch Pad.`,
    });
  }

  // ── CHECK 5c: Launch clamps require Tier 3 launch pad ──────────────────
  let hasLaunchClamp = false;
  const clampInstanceIds: string[] = [];
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.LAUNCH_CLAMP) {
      hasLaunchClamp = true;
      clampInstanceIds.push(placed.instanceId);
    }
  }

  if (hasLaunchClamp && padTier < 3) {
    checks.push({
      id:      'clamp-tier-required',
      label:   'Launch Clamp',
      pass:    false,
      warn:    false,
      message: 'Launch clamps require Launch Pad Tier 3. Upgrade the Launch Pad or remove clamps.',
    });
  }

  // ── CHECK 5d: Launch clamps must be staged ──────────────────────────────
  // If clamps are present, at least one must be assigned to a stage so
  // the rocket can be released.
  if (hasLaunchClamp) {
    const allStagedIds = new Set<string>();
    for (const stage of stagingConfig.stages) {
      for (const id of stage.instanceIds) {
        allStagedIds.add(id);
      }
    }
    const clampStaged = clampInstanceIds.some(id => allStagedIds.has(id));

    if (!clampStaged) {
      checks.push({
        id:      'clamp-not-staged',
        label:   'Launch Clamp Staging',
        pass:    false,
        warn:    false,
        message: 'Launch clamps must be assigned to a stage. The rocket cannot launch until clamps are released via staging.',
      });
    }
  }

  // ── CHECK 5e: VAB part count limit ──────────────────────────────────────
  const vabTier = getFacilityTier(gameState, FacilityId.VAB);
  const maxParts = VAB_MAX_PARTS[vabTier] ?? VAB_MAX_PARTS[1];
  if (totalParts > maxParts) {
    checks.push({
      id:      'vab-part-limit',
      label:   'VAB Part Limit',
      pass:    false,
      warn:    false,
      message: `Rocket has ${totalParts} parts, exceeding Tier ${vabTier} VAB limit of ${isFinite(maxParts) ? maxParts : 'unlimited'}. Upgrade the VAB.`,
    });
  }

  // ── CHECK 5f: VAB height limit ──────────────────────────────────────────
  const bounds = getRocketBounds(assembly);
  if (bounds) {
    const rocketHeight = bounds.maxY - bounds.minY;
    const maxHeight = VAB_MAX_HEIGHT[vabTier] ?? VAB_MAX_HEIGHT[1];
    if (rocketHeight > maxHeight) {
      checks.push({
        id:      'vab-height-limit',
        label:   'VAB Height Limit',
        pass:    false,
        warn:    false,
        message: `Rocket height ${Math.round(rocketHeight)} px exceeds Tier ${vabTier} VAB limit of ${isFinite(maxHeight) ? maxHeight + ' px' : 'unlimited'}. Upgrade the VAB.`,
      });
    }

    // ── CHECK 5g: VAB width limit ───────────────────────────────────────
    const rocketWidth = bounds.maxX - bounds.minX;
    const maxWidth = VAB_MAX_WIDTH[vabTier] ?? VAB_MAX_WIDTH[1];
    if (rocketWidth > maxWidth) {
      checks.push({
        id:      'vab-width-limit',
        label:   'VAB Width Limit',
        pass:    false,
        warn:    false,
        message: `Rocket width ${Math.round(rocketWidth)} px exceeds Tier ${vabTier} VAB limit of ${isFinite(maxWidth) ? maxWidth + ' px' : 'unlimited'}. Upgrade the VAB.`,
      });
    }
  }

  // ── CHECK 6: All parts unlocked via tech tree ────────────────────────────
  // Build a quick lookup: partId → tech node name.
  const unlockedParts = new Set(gameState.parts ?? []);
  const lockedParts: Array<{ name: string; nodeName: string }> = [];
  for (const placed of assembly.parts.values()) {
    const partId = placed.partId;
    if (unlockedParts.has(partId)) continue;
    // Check if part is a tech-tree part (starters won't be in any node)
    const node = TECH_NODES.find(n => n.unlocksParts.includes(partId));
    if (!node) continue; // Starter part — always available
    const def = getPartById(partId);
    lockedParts.push({ name: def?.name ?? partId, nodeName: node.name });
  }

  if (lockedParts.length > 0) {
    const uniqueNames = [...new Set(lockedParts.map(lp => lp.name))];
    checks.push({
      id:      'locked-parts',
      label:   'Locked Parts',
      pass:    false,
      warn:    false,
      message: `${uniqueNames.length} locked part${uniqueNames.length > 1 ? 's' : ''}: ${uniqueNames.join(', ')}. Research required.`,
    });
  }

  // A launch is possible when all blocking checks pass.
  const canLaunch = checks.every((c) => c.pass || c.warn);

  return {
    checks,
    canLaunch,
    totalMassKg,
    stage1Thrust,
    twr,
    hasLaunchClamp,
  };
}

/**
 * Check whether a rocket assembly contains any launch clamp parts.
 */
export function hasLaunchClamps(assembly: RocketAssembly): boolean {
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.LAUNCH_CLAMP) return true;
  }
  return false;
}
