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
import {
  createRocketAssembly,
  addPartToAssembly,
  removePartFromAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  findSnapCandidates,
  validateStagingConfig,
} from '../core/rocketbuilder.js';
import {
  getTotalMass,
  getStage1Thrust,
  calculateTWR,
  runValidation,
} from '../core/rocketvalidator.js';
import { getConnectedTanks } from '../core/fuelsystem.js';
import { createGameState }   from '../core/gameState.js';

// ---------------------------------------------------------------------------
// Test 1 — Part graph structure
// ---------------------------------------------------------------------------

describe('Part graph — command module + fuel tank + engine', () => {
  it('forms a valid graph with 3 nodes and 2 directed edges', () => {
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
    expect(twrCheck.pass).toBe(false);
    expect(result.twr).toBeLessThan(1);
    expect(twrCheck.message).toMatch(/too low/i);
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
    expect(cmdCheck.pass).toBe(false);
    expect(cmdCheck.message).toMatch(/no command/i);
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
    expect(check.pass).toBe(false);
    expect(check.message).toMatch(/floating/i);
    expect(result.canLaunch).toBe(false);
  });
});
