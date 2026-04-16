/**
 * rocketbuilder.test.js — Unit tests for rocket builder and validator logic (TASK-041).
 *
 * Tests cover:
 *  1. Command module + fuel tank + engine forms a valid part graph.
 *  2. TWR calculation: known mass and Stage 1 thrust match the expected formula.
 *  3. A rocket with TWR < 1 fails validation.
 *  4. A rocket with no command module fails validation.
 *  5. An engine in Stage 1 with no connected fuel tank has no fuel sources
 *     (warns at runtime — empty getConnectedTanks result → 0 effective thrust → TWR < 1).
 *  6. A valid snap connection stores the correct edge in the part graph.
 *  7. Snapping an incompatible part type to a snap point returns no candidates.
 *  8. Removing a part from the graph removes all its edges.
 *  9. A part isolated after a simulated decoupler fire is identified as disconnected.
 *
 * All tests run headlessly with `vitest run` — no DOM or canvas dependencies.
 */

import { describe, it, expect } from 'vitest';
import type { RocketAssembly, SnapCandidate } from '../core/rocketbuilder.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  removePartFromAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  findSnapCandidates,
  findMirrorCandidate,
  validateStagingConfig,
  addSymmetryPair,
  getMirrorPartId,
} from '../core/rocketbuilder.ts';
import {
  getTotalMass,
  getStage1Thrust,
  calculateTWR,
  runValidation,
} from '../core/rocketvalidator.ts';
import { getConnectedTanks } from '../core/fuelsystem.ts';
import { createGameState }   from '../core/gameState.ts';
import { getPartById }       from '../data/parts.ts';

// ---------------------------------------------------------------------------
// Test 1 — Part graph structure
// ---------------------------------------------------------------------------

describe('Part graph — command module + fuel tank + engine', () => {
  it('@smoke forms a valid graph with 3 nodes and 2 directed edges', () => {
    const assembly = createRocketAssembly();

    const cmdId    = addPartToAssembly(assembly, 'cmd-mk1',      0,  60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',   0,   0);
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, -55);

    // cmd bottom-snap (index 1) → tank top-snap (index 0)
    connectParts(assembly, cmdId,  1, tankId,   0);
    // tank bottom-snap (index 1) → engine top-snap (index 0)
    connectParts(assembly, tankId, 1, engineId, 0);

    // Three distinct nodes in the graph
    expect(assembly.parts.size).toBe(3);
    expect(assembly.parts.has(cmdId)).toBe(true);
    expect(assembly.parts.has(tankId)).toBe(true);
    expect(assembly.parts.has(engineId)).toBe(true);

    // Two directed edges stored in the connections array
    expect(assembly.connections).toHaveLength(2);

    const [e1, e2] = assembly.connections;

    // Edge 1: command module → tank
    expect(e1.fromInstanceId).toBe(cmdId);
    expect(e1.fromSnapIndex).toBe(1);
    expect(e1.toInstanceId).toBe(tankId);
    expect(e1.toSnapIndex).toBe(0);

    // Edge 2: tank → engine
    expect(e2.fromInstanceId).toBe(tankId);
    expect(e2.fromSnapIndex).toBe(1);
    expect(e2.toInstanceId).toBe(engineId);
    expect(e2.toSnapIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — TWR calculation with known values
// ---------------------------------------------------------------------------

describe('TWR calculation with known mass and thrust', () => {
  it('matches the formula (thrustKN × 1000) / (massKg × 9.81)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // probe-core-mk1: 50 kg dry, no fuel
    // tank-small:     50 kg dry + 400 kg fuel = 450 kg wet
    // engine-spark:   120 kg dry, 60 kN sea-level thrust
    // Total wet mass  = 50 + 450 + 120 = 620 kg
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

    connectParts(assembly, probeId, 1, tankId,   0);
    connectParts(assembly, tankId,  1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const totalMass    = getTotalMass(assembly);
    const stage1Thrust = getStage1Thrust(assembly, staging); // kN
    const twr          = calculateTWR(assembly, staging);

    expect(totalMass).toBe(620);
    expect(stage1Thrust).toBe(60);

    // TWR = (thrust_kN × 1 000) / (mass_kg × 9.81)
    const expectedTWR = (60 * 1000) / (620 * 9.81);
    expect(twr).toBeCloseTo(expectedTWR, 5);
    expect(twr).toBeGreaterThan(1); // rocket can lift off
  });
});

// ---------------------------------------------------------------------------
// Test 3 — TWR < 1 fails validation
// ---------------------------------------------------------------------------

describe('Validation — TWR < 1', () => {
  it('fails the TWR check when Stage 1 thrust is insufficient for the rocket mass', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = createGameState();

    // probe (50 kg) + 4 × large tanks (200 + 8 000 = 8 200 kg wet each) + Spark engine (120 kg, 60 kN)
    // Total ≈ 32 970 kg; TWR = 60 000 / (32 970 × 9.81) ≈ 0.186 — well below 1.0
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  500);
    const t1Id     = addPartToAssembly(assembly, 'tank-large',     0,  300);
    const t2Id     = addPartToAssembly(assembly, 'tank-large',     0,  150);
    const t3Id     = addPartToAssembly(assembly, 'tank-large',     0,    0);
    const t4Id     = addPartToAssembly(assembly, 'tank-large',     0, -150);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -280);

    connectParts(assembly, probeId, 1, t1Id,     0);
    connectParts(assembly, t1Id,    1, t2Id,     0);
    connectParts(assembly, t2Id,    1, t3Id,     0);
    connectParts(assembly, t3Id,    1, t4Id,     0);
    connectParts(assembly, t4Id,    1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const result   = runValidation(assembly, staging, state);
    const twrCheck = result.checks.find((c) => c.id === 'twr');

    expect(twrCheck).toBeDefined();
    expect(twrCheck!.pass).toBe(false);
    expect(result.twr).toBeLessThan(1);
    expect(twrCheck!.message).toMatch(/too low/i);
    expect(result.canLaunch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — No command module fails validation
// ---------------------------------------------------------------------------

describe('Validation — no command module', () => {
  it('fails the command-module check when neither a command nor a computer module is present', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = createGameState();

    // Fuel tank + engine only — no command or computer module
    const tankId   = addPartToAssembly(assembly, 'tank-small',   0,   0);
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, -55);

    connectParts(assembly, tankId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const result   = runValidation(assembly, staging, state);
    const cmdCheck = result.checks.find((c) => c.id === 'command-module');

    expect(cmdCheck).toBeDefined();
    expect(cmdCheck!.pass).toBe(false);
    expect(cmdCheck!.message).toMatch(/no command/i);
    expect(result.canLaunch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Engine in Stage 1 with no connected fuel tank
// ---------------------------------------------------------------------------

describe('Engine in Stage 1 with no connected fuel tank', () => {
  it('getConnectedTanks returns empty — engine has no fuel source (0 effective thrust at runtime)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Probe and liquid engine only — no fuel tank anywhere in the assembly.
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 30);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0,  0);
    connectParts(assembly, probeId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    // Engine is correctly staged.
    expect(staging.stages[0].instanceIds).toContain(engineId);

    // Fuel system: BFS from engine finds no FUEL_TANK nodes in its segment.
    // An empty result signals 0 effective thrust at runtime → TWR < 1 at launch.
    const activeParts = new Set(assembly.parts.keys());
    const tanks = getConnectedTanks(engineId, assembly, activeParts);
    expect(tanks).toHaveLength(0);
  });

  it('validateStagingConfig warns when Stage 1 has no ignition source staged', () => {
    // Complementary check: staging validator fires the "no engine or SRB" warning
    // when an engine exists in the assembly but is not yet assigned to Stage 1.
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 30);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0,  0);
    connectParts(assembly, probeId, 1, engineId, 0);

    // Sync without staging the engine — engine stays in the unstaged pool.
    syncStagingWithAssembly(assembly, staging);

    // Stage 1 is empty → staging validator must warn.
    const warnings = validateStagingConfig(assembly, staging);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/no engine/i);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Valid snap connection stores correct edge
// ---------------------------------------------------------------------------

describe('Snap system — valid connection', () => {
  it('stores the correct fromInstanceId, fromSnapIndex, toInstanceId, toSnapIndex', () => {
    const assembly = createRocketAssembly();
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 30);

    // probe-core bottom snap (index 1): side=bottom, offsetX=0, offsetY=5
    //   world snap Y = partY - offsetY = 30 - 5 = 25
    //
    // tank-small top snap (index 0): side=top, offsetX=0, offsetY=-20
    //   dSnapRelY = -offsetY = -(-20) = +20  (screen-Y → world-Y)
    //   For dragWorldY = 5: dSnapWY = 5 + 20 = 25 → exact match (screenDist = 0)
    const candidates = findSnapCandidates(assembly, 'tank-small', 0, 5, 1.0);

    expect(candidates).toHaveLength(1);

    const snap = candidates[0];
    expect(snap.targetInstanceId).toBe(probeId);
    expect(snap.targetSnapIndex).toBe(1);    // probe bottom snap
    expect(snap.dragSnapIndex).toBe(0);      // tank top snap
    expect(snap.screenDist).toBeCloseTo(0, 5);

    // Add the tank at the computed snap position and register the connection.
    const tankId = addPartToAssembly(assembly, 'tank-small', snap.snapWorldX, snap.snapWorldY);
    connectParts(assembly, snap.targetInstanceId, snap.targetSnapIndex,
                 tankId,   snap.dragSnapIndex);

    expect(assembly.connections).toHaveLength(1);
    const conn = assembly.connections[0];
    expect(conn.fromInstanceId).toBe(probeId);
    expect(conn.fromSnapIndex).toBe(1);
    expect(conn.toInstanceId).toBe(tankId);
    expect(conn.toSnapIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Incompatible snap type is rejected
// ---------------------------------------------------------------------------

describe('Snap system — incompatible part type', () => {
  it('returns no candidates when the dragged part type is not accepted by any target snap point', () => {
    const assembly = createRocketAssembly();

    // probe-core-mk1 snap points:
    //   index 0 (top)    accepts: [PARACHUTE]
    //   index 1 (bottom) accepts: STACK_TYPES = [COMMAND_MODULE, COMPUTER_MODULE,
    //                              SERVICE_MODULE, FUEL_TANK, ENGINE, STACK_DECOUPLER,
    //                              PARACHUTE, SATELLITE]
    // SOLID_ROCKET_BOOSTER is NOT in STACK_TYPES — no probe snap accepts an SRB.
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 30);

    // Position srb-small so its top snap would perfectly align with probe's bottom snap
    // (screen distance = 0) — the snap is still rejected because of the type mismatch.
    // srb top snap: offsetY = -40 → dSnapRelY = +40.
    // dragWorldY + 40 = 25  →  dragWorldY = -15.
    const candidates = findSnapCandidates(assembly, 'srb-small', 0, -15, 1.0);

    expect(candidates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Removing a part removes all its edges
// ---------------------------------------------------------------------------

describe('Part graph — remove part', () => {
  it('severs every connection involving the removed part', () => {
    const assembly = createRocketAssembly();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

    connectParts(assembly, probeId, 1, tankId,   0); // probe → tank
    connectParts(assembly, tankId,  1, engineId, 0); // tank  → engine

    expect(assembly.connections).toHaveLength(2);

    // Remove the middle part (tank) — should sever both edges it participated in.
    removePartFromAssembly(assembly, tankId);

    expect(assembly.parts.has(tankId)).toBe(false);
    expect(assembly.connections).toHaveLength(0);

    // Probe and engine remain in the assembly but are no longer connected.
    expect(assembly.parts.has(probeId)).toBe(true);
    expect(assembly.parts.has(engineId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — Part isolation after simulated decoupler fire
// ---------------------------------------------------------------------------

describe('Connectivity — part isolation after decoupler separation', () => {
  it('identifies floating parts when a decoupler is removed (simulating staging separation)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const state    = createGameState();

    // Full stack connected in order: probe → decoupler → tank → engine
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',       0,  100);
    const decId    = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',           0,    0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',         0,  -55);

    connectParts(assembly, probeId, 1, decId,    0);
    connectParts(assembly, decId,   1, tankId,   0);
    connectParts(assembly, tankId,  1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    // Before fire: all four parts are connected in a single chain.
    expect(assembly.connections).toHaveLength(3);

    // Simulate decoupler separation: remove the decoupler from the part graph.
    // _pruneConnections severs both edges that passed through the decoupler.
    removePartFromAssembly(assembly, decId);

    // After separation: probe is isolated from tank and engine.
    // Only the tank→engine edge survives.
    expect(assembly.connections).toHaveLength(1);

    // The connectivity BFS in runValidation starts at the command/computer root (probe).
    // Tank and engine are no longer reachable → they are flagged as floating.
    const result = runValidation(assembly, staging, state);
    const check  = result.checks.find((c) => c.id === 'connectivity');

    expect(check).toBeDefined();
    expect(check!.pass).toBe(false);
    expect(check!.message).toMatch(/floating/i);
    expect(result.canLaunch).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 10 — Multiple radial snap points on fuel tanks
// ---------------------------------------------------------------------------

describe('Snap system — multiple radial snap points on fuel tanks', () => {
  // Small Tank snap layout (after adding top/middle/bottom radial snaps):
  //   0: top    (0, -20)       4: left-bottom  (-10, 12)
  //   1: bottom (0,  20)       5: right-top    ( 10, -12)
  //   2: left-top (-10, -12)   6: right-mid    ( 10, 0)
  //   3: left-mid (-10,  0)    7: right-bottom ( 10, 12)

  it('finds snap candidates at top, middle, and bottom of the left side', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'tank-small', 0, 0);

    // Drag a landing leg near each of the three left-side snap points.
    // Landing leg 'right' snap: offsetX=5, offsetY=0 → dSnapRelX=5, dSnapRelY=0.
    // For target snap at worldX = tankX + offsetX = 0 + (-10) = -10,
    //   dragWorldX + dSnapRelX = targetWorldX → dragWorldX = -10 - 5 = -15.
    // For target snap offsetY:
    //   worldY = tankY - offsetY

    // Left-top snap (index 2): offsetY = -12 → target world Y = 0 - (-12) = 12
    const topCandidates = findSnapCandidates(assembly, 'landing-legs-small', -15, 12, 1.0);
    expect(topCandidates.length).toBeGreaterThanOrEqual(1);
    expect(topCandidates[0].targetSnapIndex).toBe(2);

    // Left-mid snap (index 3): offsetY = 0 → target world Y = 0
    const midCandidates = findSnapCandidates(assembly, 'landing-legs-small', -15, 0, 1.0);
    expect(midCandidates.length).toBeGreaterThanOrEqual(1);
    expect(midCandidates[0].targetSnapIndex).toBe(3);

    // Left-bottom snap (index 4): offsetY = 12 → target world Y = -12
    const botCandidates = findSnapCandidates(assembly, 'landing-legs-small', -15, -12, 1.0);
    expect(botCandidates.length).toBeGreaterThanOrEqual(1);
    expect(botCandidates[0].targetSnapIndex).toBe(4);
  });

  it('finds snap candidates at top, middle, and bottom of the right side', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'tank-small', 0, 0);

    // Landing leg 'left' snap: offsetX=-5, offsetY=0 → dSnapRelX=-5, dSnapRelY=0.
    // dragWorldX + (-5) = 10 → dragWorldX = 15.

    // Right-top snap (index 5): offsetY = -12 → target world Y = 12
    const topCandidates = findSnapCandidates(assembly, 'landing-legs-small', 15, 12, 1.0);
    expect(topCandidates.length).toBeGreaterThanOrEqual(1);
    expect(topCandidates[0].targetSnapIndex).toBe(5);

    // Right-mid snap (index 6): offsetY = 0 → target world Y = 0
    const midCandidates = findSnapCandidates(assembly, 'landing-legs-small', 15, 0, 1.0);
    expect(midCandidates.length).toBeGreaterThanOrEqual(1);
    expect(midCandidates[0].targetSnapIndex).toBe(6);

    // Right-bottom snap (index 7): offsetY = 12 → target world Y = -12
    const botCandidates = findSnapCandidates(assembly, 'landing-legs-small', 15, -12, 1.0);
    expect(botCandidates.length).toBeGreaterThanOrEqual(1);
    expect(botCandidates[0].targetSnapIndex).toBe(7);
  });

  it('all three left and right radial snap points accept radial types (SRBs, legs, etc.)', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'tank-small', 0, 0);

    // SRBs should also snap to all six radial points.
    // SRB 'left' snap: offsetX=-10, offsetY=0 → dSnapRelX=-10.
    // dragWorldX + (-10) = 10 → dragWorldX = 20.
    // Right-mid (index 6): target world Y = 0
    const srbRight = findSnapCandidates(assembly, 'srb-small', 20, 0, 1.0);
    expect(srbRight.length).toBeGreaterThanOrEqual(1);
    expect(srbRight[0].targetSnapIndex).toBe(6);

    // SRB 'right' snap: offsetX=10.
    // dragWorldX + 10 = -10 → dragWorldX = -20.
    // Left-mid (index 3): target world Y = 0
    const srbLeft = findSnapCandidates(assembly, 'srb-small', -20, 0, 1.0);
    expect(srbLeft.length).toBeGreaterThanOrEqual(1);
    expect(srbLeft[0].targetSnapIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 11 — Mirror candidate picks matching vertical position
// ---------------------------------------------------------------------------

describe('Mirror candidate — picks corresponding vertical position', () => {
  // Verifies that when a part snaps to a specific left-side radial point
  // (e.g. bottom), the mirror candidate picks the matching right-side point
  // at the same offsetY (e.g. right-bottom), not just the first right snap.

  function buildTankAssemblyWithLegCandidate(targetSnapIndex: number): { assembly: RocketAssembly; candidate: SnapCandidate } {
    const assembly = createRocketAssembly();
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);

    const tankDef = getPartById('tank-small')!;
    const tSnap = tankDef.snapPoints[targetSnapIndex];

    const candidate: SnapCandidate = {
      targetInstanceId: tankId,
      targetSnapIndex,
      dragSnapIndex: 0,
      snapWorldX: 0,
      snapWorldY: 0,
      targetSnapWorldX: tSnap.offsetX,
      targetSnapWorldY: -tSnap.offsetY,
      screenDist: 0,
    };
    return { assembly, candidate };
  }

  it('left-top (index 2) mirrors to right-top (index 5)', () => {
    const { assembly, candidate } = buildTankAssemblyWithLegCandidate(2);
    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).not.toBeNull();
    expect(mirror!.mirrorTargetSnapIndex).toBe(5);
  });

  it('left-mid (index 3) mirrors to right-mid (index 6)', () => {
    const { assembly, candidate } = buildTankAssemblyWithLegCandidate(3);
    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).not.toBeNull();
    expect(mirror!.mirrorTargetSnapIndex).toBe(6);
  });

  it('left-bottom (index 4) mirrors to right-bottom (index 7)', () => {
    const { assembly, candidate } = buildTankAssemblyWithLegCandidate(4);
    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).not.toBeNull();
    expect(mirror!.mirrorTargetSnapIndex).toBe(7);
  });

  it('right-top (index 5) mirrors to left-top (index 2)', () => {
    const { assembly, candidate } = buildTankAssemblyWithLegCandidate(5);
    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).not.toBeNull();
    expect(mirror!.mirrorTargetSnapIndex).toBe(2);
  });

  it('right-mid (index 6) mirrors to left-mid (index 3)', () => {
    const { assembly, candidate } = buildTankAssemblyWithLegCandidate(6);
    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).not.toBeNull();
    expect(mirror!.mirrorTargetSnapIndex).toBe(3);
  });

  it('right-bottom (index 7) mirrors to left-bottom (index 4)', () => {
    const { assembly, candidate } = buildTankAssemblyWithLegCandidate(7);
    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).not.toBeNull();
    expect(mirror!.mirrorTargetSnapIndex).toBe(4);
  });

  it('mirror returns null when the opposite snap is already occupied', () => {
    const assembly = createRocketAssembly();
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);

    // Place a leg on the right-mid snap (index 6) to occupy it.
    const legId = addPartToAssembly(assembly, 'landing-legs-small', 15, 0);
    connectParts(assembly, tankId, 6, legId, 0);

    // Now try to mirror from left-mid (index 3) → should fail because
    // right-mid (index 6) is occupied.
    const candidate: SnapCandidate = {
      targetInstanceId: tankId,
      targetSnapIndex:  3,
      dragSnapIndex:    0,
      snapWorldX:       0,
      snapWorldY:       0,
      targetSnapWorldX: -10,
      targetSnapWorldY: 0,
      screenDist:       0,
    };

    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).toBeNull();
  });

  it('mirror works across all three tank sizes', () => {
    for (const partId of ['tank-small', 'tank-medium', 'tank-large']) {
      const assembly = createRocketAssembly();
      const tid = addPartToAssembly(assembly, partId, 0, 0);

      const tankDef = getPartById(partId)!;

      // Find all left snaps and their matching right snaps.
      const leftSnaps: Array<{ index: number; offsetY: number }>  = [];
      const rightSnaps: Array<{ index: number; offsetY: number }> = [];
      tankDef.snapPoints.forEach((sp, i) => {
        if (sp.side === 'left')  leftSnaps.push({ index: i, offsetY: sp.offsetY });
        if (sp.side === 'right') rightSnaps.push({ index: i, offsetY: sp.offsetY });
      });

      // Each tank should have 3 left and 3 right radial snaps.
      expect(leftSnaps).toHaveLength(3);
      expect(rightSnaps).toHaveLength(3);

      // For each left snap, the mirror should find the right snap with matching offsetY.
      for (const ls of leftSnaps) {
        const candidate: SnapCandidate = {
          targetInstanceId: tid,
          targetSnapIndex:  ls.index,
          dragSnapIndex:    0,
          snapWorldX:       0,
          snapWorldY:       0,
          targetSnapWorldX: 0,
          targetSnapWorldY: 0,
          screenDist:       0,
        };
        const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
        expect(mirror).not.toBeNull();
        const expectedRight = rightSnaps.find(rs => rs.offsetY === ls.offsetY);
        expect(expectedRight).toBeDefined();
        expect(mirror!.mirrorTargetSnapIndex).toBe(expectedRight!.index);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Test 12 — findSnapCandidates: empty assembly returns []
// ---------------------------------------------------------------------------

describe('findSnapCandidates — edge cases', () => {
  it('returns empty array when the assembly has no placed parts', () => {
    const assembly = createRocketAssembly();
    const candidates = findSnapCandidates(assembly, 'tank-small', 0, 0, 1.0);
    expect(candidates).toHaveLength(0);
  });

  it('returns empty array when no target socket accepts the dragged part type', () => {
    const assembly = createRocketAssembly();
    // probe-core-mk1 has: top accepts [PARACHUTE], bottom accepts STACK_TYPES.
    // SOLID_ROCKET_BOOSTER is not in STACK_TYPES or [PARACHUTE].
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 30);

    // Place the SRB at the exact snap position — distance = 0.
    // SRB top snap: offsetY = -40. dSnapRelY = +40. dSnapWY = dragY + 40.
    // Probe bottom snap world Y = 30 - 5 = 25. Need dSnapWY = 25, so dragY = -15.
    const candidates = findSnapCandidates(assembly, 'srb-small', 0, -15, 1.0);
    expect(candidates).toHaveLength(0);
  });

  it('filters out occupied sockets', () => {
    const assembly = createRocketAssembly();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 30);

    // Occupy the probe's bottom snap (index 1) with a tank.
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 5);
    connectParts(assembly, probeId, 1, tankId, 0);

    // Now try to snap another tank-small to the probe. The probe has:
    //   index 0 (top) — accepts PARACHUTE only → FUEL_TANK rejected
    //   index 1 (bottom) — accepts STACK_TYPES but occupied
    // So no candidates should be returned.
    const candidates = findSnapCandidates(assembly, 'tank-small', 0, 5, 1.0);

    // Filter to only probe-targeted candidates (the tank itself has open snaps
    // that might match, so we check the probe specifically).
    const probeCandidates = candidates.filter(c => c.targetInstanceId === probeId);
    expect(probeCandidates).toHaveLength(0);
  });

  it('returns candidates sorted nearest-first when multiple snaps are in range', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'tank-small', 0, 0);

    // tank-small has 3 left-side snap points at offsetY = -12, 0, 12.
    // World Y positions: 12, 0, -12.
    // Drag a landing leg near the middle (worldY = 1) — it should be closest to
    // left-mid (index 3, worldY = 0), then left-top (index 2, worldY = 12),
    // then left-bottom (index 4, worldY = -12) — but only within SNAP_DISTANCE_PX.
    // At zoom=1, SNAP_DISTANCE_PX=30 means world-distance ≤ 30.

    // Landing leg 'right' snap: offsetX=5, offsetY=0.
    // Target snap offsetX=-10. dragWorldX + 5 = -10 → dragWorldX = -15.
    const candidates = findSnapCandidates(assembly, 'landing-legs-small', -15, 1, 1.0);

    // All three left-side snaps should be within 30 px distance.
    expect(candidates.length).toBeGreaterThanOrEqual(2);

    // Verify sorted nearest-first.
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].screenDist).toBeGreaterThanOrEqual(candidates[i - 1].screenDist);
    }
  });

  it('respects the zoom factor in screen distance calculation', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 30);

    // Probe bottom snap world Y = 30 - 5 = 25.
    // Tank top snap: offsetY=-20, dSnapRelY=+20.
    // At dragWorldY = 0: dSnapWY = 0 + 20 = 20.
    // World distance = |25 - 20| = 5. Screen distance = 5 * zoom.
    // At zoom=1: screenDist = 5 → within SNAP_DISTANCE_PX (30) → candidate found.
    const candidatesNear = findSnapCandidates(assembly, 'tank-small', 0, 0, 1.0);
    expect(candidatesNear.length).toBeGreaterThanOrEqual(1);

    // At zoom=7: screenDist = 5*7 = 35 → exceeds SNAP_DISTANCE_PX (30) → no candidate.
    const candidatesFar = findSnapCandidates(assembly, 'tank-small', 0, 0, 7.0);
    expect(candidatesFar).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 13 — findMirrorCandidate: top/bottom snaps return null
// ---------------------------------------------------------------------------

describe('findMirrorCandidate — non-radial and edge cases', () => {
  it('returns null for a top snap (only left/right get symmetry)', () => {
    const assembly = createRocketAssembly();
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);

    // tank-small index 0 is the top snap.
    const candidate: SnapCandidate = {
      targetInstanceId: tankId,
      targetSnapIndex:  0,
      dragSnapIndex:    0,
      snapWorldX:       0,
      snapWorldY:       0,
      targetSnapWorldX: 0,
      targetSnapWorldY: 20,
      screenDist:       0,
    };

    const mirror = findMirrorCandidate(assembly, candidate, 'tank-small');
    expect(mirror).toBeNull();
  });

  it('returns null for a bottom snap (only left/right get symmetry)', () => {
    const assembly = createRocketAssembly();
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);

    // tank-small index 1 is the bottom snap.
    const candidate: SnapCandidate = {
      targetInstanceId: tankId,
      targetSnapIndex:  1,
      dragSnapIndex:    0,
      snapWorldX:       0,
      snapWorldY:       0,
      targetSnapWorldX: 0,
      targetSnapWorldY: -20,
      screenDist:       0,
    };

    const mirror = findMirrorCandidate(assembly, candidate, 'tank-small');
    expect(mirror).toBeNull();
  });

  it('returns null when the parent part is not found in the assembly', () => {
    const assembly = createRocketAssembly();

    // Reference a non-existent instance ID.
    const candidate: SnapCandidate = {
      targetInstanceId: 'nonexistent',
      targetSnapIndex:  3,
      dragSnapIndex:    0,
      snapWorldX:       0,
      snapWorldY:       0,
      targetSnapWorldX: -10,
      targetSnapWorldY: 0,
      screenDist:       0,
    };

    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).toBeNull();
  });

  it('returns a valid mirror candidate for a left-side radial snap', () => {
    const assembly = createRocketAssembly();
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);

    // tank-small index 3 is left-mid (-10, 0). Mirror is right-mid (index 6, +10, 0).
    const candidate: SnapCandidate = {
      targetInstanceId: tankId,
      targetSnapIndex:  3,
      dragSnapIndex:    0,
      snapWorldX:       -15,
      snapWorldY:       0,
      targetSnapWorldX: -10,
      targetSnapWorldY: 0,
      screenDist:       0,
    };

    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).not.toBeNull();
    expect(mirror!.mirrorTargetSnapIndex).toBe(6);

    // Verify mirror world position is mirrored across the rocket centreline.
    // The parent is at x=0. Left snap at -10, right snap at +10.
    // mirrorWorldX should be on the right side.
    expect(mirror!.mirrorWorldX).toBeGreaterThan(0);
  });

  it('returns null when the occupied mirror socket blocks the mirror placement', () => {
    const assembly = createRocketAssembly();
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);

    // Occupy right-mid (index 6) with a landing leg.
    const legId = addPartToAssembly(assembly, 'landing-legs-small', 15, 0);
    connectParts(assembly, tankId, 6, legId, 0);

    // Try mirror from left-mid (index 3). Right-mid (6) is occupied → null.
    const candidate: SnapCandidate = {
      targetInstanceId: tankId,
      targetSnapIndex:  3,
      dragSnapIndex:    0,
      snapWorldX:       -15,
      snapWorldY:       0,
      targetSnapWorldX: -10,
      targetSnapWorldY: 0,
      screenDist:       0,
    };

    const mirror = findMirrorCandidate(assembly, candidate, 'landing-legs-small');
    expect(mirror).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 14 — Symmetry pair management
// ---------------------------------------------------------------------------

describe('Symmetry pair management — addSymmetryPair / getMirrorPartId', () => {
  it('addSymmetryPair records the relationship', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'landing-legs-small', -15, 0);
    const id2 = addPartToAssembly(assembly, 'landing-legs-small',  15, 0);

    addSymmetryPair(assembly, id1, id2);
    expect(assembly.symmetryPairs).toHaveLength(1);
    expect(assembly.symmetryPairs[0]).toEqual([id1, id2]);
  });

  it('getMirrorPartId returns the partner from either direction', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'landing-legs-small', -15, 0);
    const id2 = addPartToAssembly(assembly, 'landing-legs-small',  15, 0);

    addSymmetryPair(assembly, id1, id2);

    expect(getMirrorPartId(assembly, id1)).toBe(id2);
    expect(getMirrorPartId(assembly, id2)).toBe(id1);
  });

  it('getMirrorPartId returns null for a part with no mirror', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'landing-legs-small', -15, 0);

    expect(getMirrorPartId(assembly, id1)).toBeNull();
  });

  it('getMirrorPartId returns null when symmetryPairs is missing', () => {
    const assembly = createRocketAssembly();
    // Force symmetryPairs to be undefined to test the guard clause.
    (assembly as unknown as Record<string, unknown>).symmetryPairs = undefined;

    expect(getMirrorPartId(assembly, 'nonexistent')).toBeNull();
  });

  it('removePartFromAssembly prunes associated symmetry pairs', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'landing-legs-small', -15, 0);
    const id2 = addPartToAssembly(assembly, 'landing-legs-small',  15, 0);
    const id3 = addPartToAssembly(assembly, 'landing-legs-small', -15, -12);
    const id4 = addPartToAssembly(assembly, 'landing-legs-small',  15, -12);

    addSymmetryPair(assembly, id1, id2);
    addSymmetryPair(assembly, id3, id4);
    expect(assembly.symmetryPairs).toHaveLength(2);

    // Remove id1 — should prune the [id1, id2] pair but keep [id3, id4].
    removePartFromAssembly(assembly, id1);

    expect(assembly.symmetryPairs).toHaveLength(1);
    expect(assembly.symmetryPairs[0]).toEqual([id3, id4]);
    expect(getMirrorPartId(assembly, id2)).toBeNull();
    expect(getMirrorPartId(assembly, id3)).toBe(id4);
  });
});

// ---------------------------------------------------------------------------
// Test 15 — syncStagingWithAssembly: part removal prunes staging
// ---------------------------------------------------------------------------

describe('syncStagingWithAssembly — pruning and registration', () => {
  it('prunes a removed part from staging stages', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  30);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0,   0);
    connectParts(assembly, probeId, 1, engineId, 0);

    // Sync to register activatable parts, then stage the engine.
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);
    expect(staging.stages[0].instanceIds).toContain(engineId);

    // Remove the engine from the assembly.
    removePartFromAssembly(assembly, engineId);

    // Sync again — the removed engine should be pruned from staging.
    syncStagingWithAssembly(assembly, staging);
    expect(staging.stages[0].instanceIds).not.toContain(engineId);
    expect(staging.unstaged).not.toContain(engineId);
  });

  it('prunes a removed part from the unstaged pool', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  30);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0,   0);
    connectParts(assembly, probeId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    // Engine should be in unstaged (not yet assigned to any stage).
    expect(staging.unstaged).toContain(engineId);

    removePartFromAssembly(assembly, engineId);
    syncStagingWithAssembly(assembly, staging);
    expect(staging.unstaged).not.toContain(engineId);
  });

  it('registers science module instrument keys as separate stageable entities', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Add a science module with instruments loaded.
    const sciId = addPartToAssembly(assembly, 'science-module-mk1', 0, 0);
    const placed = assembly.parts.get(sciId)!;
    placed.instruments = ['thermo-1', 'baro-1'];

    syncStagingWithAssembly(assembly, staging);

    // The science module itself should NOT be in unstaged (it uses instrument keys).
    // Instead, two instrument keys should appear.
    const instrKey0 = `${sciId}:instr:0`;
    const instrKey1 = `${sciId}:instr:1`;

    expect(staging.unstaged).toContain(instrKey0);
    expect(staging.unstaged).toContain(instrKey1);
  });

  it('prunes stale instrument keys when the science module is removed', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const sciId = addPartToAssembly(assembly, 'science-module-mk1', 0, 0);
    const placed = assembly.parts.get(sciId)!;
    placed.instruments = ['thermo-1'];

    syncStagingWithAssembly(assembly, staging);
    const instrKey = `${sciId}:instr:0`;
    expect(staging.unstaged).toContain(instrKey);

    // Remove the science module and sync — instrument key should be pruned.
    removePartFromAssembly(assembly, sciId);
    syncStagingWithAssembly(assembly, staging);
    expect(staging.unstaged).not.toContain(instrKey);
  });

  it('newly added activatable parts appear in unstaged after sync', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Start with empty assembly + empty staging.
    syncStagingWithAssembly(assembly, staging);
    expect(staging.unstaged).toHaveLength(0);

    // Add an engine — it is activatable.
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    expect(staging.unstaged).toContain(engineId);
  });

  it('non-activatable parts do not appear in unstaged', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Fuel tank is not activatable — should not appear in staging at all.
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    expect(staging.unstaged).not.toContain(tankId);

    // Also not in any stage.
    const allStaged = staging.stages.flatMap(s => s.instanceIds);
    expect(allStaged).not.toContain(tankId);
  });
});

// ---------------------------------------------------------------------------
// Test 16 — validateStagingConfig edge cases
// ---------------------------------------------------------------------------

describe('validateStagingConfig — edge cases', () => {
  it('returns no warnings when the assembly has no activatable parts', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Only non-activatable parts: probe-core-mk1 (activatable=false) and tank.
    addPartToAssembly(assembly, 'tank-small', 0, 0);

    const warnings = validateStagingConfig(assembly, staging);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings when the assembly is completely empty', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const warnings = validateStagingConfig(assembly, staging);
    expect(warnings).toHaveLength(0);
  });

  it('warns when Stage 1 has activatable parts but no IGNITE part', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Add an engine (activatable with IGNITE behaviour) to the assembly,
    // but assign a parachute (DEPLOY behaviour) to Stage 1 instead.
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  30);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0,   0);
    connectParts(assembly, probeId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    // Engine stays in unstaged — Stage 1 is empty.

    const warnings = validateStagingConfig(assembly, staging);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/no engine/i);
  });

  it('returns no warnings when Stage 1 contains an engine with IGNITE behaviour', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  30);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0,   0);
    connectParts(assembly, probeId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const warnings = validateStagingConfig(assembly, staging);
    expect(warnings).toHaveLength(0);
  });

  it('returns no warnings when Stage 1 contains an SRB (IGNITE behaviour)', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);
    const srbId  = addPartToAssembly(assembly, 'srb-small', -20, 0);
    connectParts(assembly, tankId, 3, srbId, 1); // left-mid → srb right snap

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, srbId, 0);

    const warnings = validateStagingConfig(assembly, staging);
    expect(warnings).toHaveLength(0);
  });

  it('warns correctly when Stage 1 has a DEPLOY part but no IGNITE part', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // cmd-mk1 is activatable with EJECT behaviour — present in the assembly
    // to ensure hasActivatable is true.
    const cmdId    = addPartToAssembly(assembly, 'cmd-mk1',            0,  60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',         0,   0);
    const legsId   = addPartToAssembly(assembly, 'landing-legs-small', -15, 0);

    connectParts(assembly, cmdId, 1, tankId, 0);
    connectParts(assembly, tankId, 3, legsId, 0); // left-mid → legs right snap

    syncStagingWithAssembly(assembly, staging);
    // Assign only the landing legs (DEPLOY) to Stage 1 — no ignition source.
    assignPartToStage(staging, legsId, 0);

    const warnings = validateStagingConfig(assembly, staging);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/no engine/i);
  });
});
