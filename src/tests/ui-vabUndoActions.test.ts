/**
 * ui-vabUndoActions.test.ts — Unit tests for VAB undo action snapshot logic.
 *
 * Tests the staging clone/restore helpers and the recordStagingChange(),
 * recordPlacement(), recordDeletion(), recordMove(), recordClearAll() actions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PartDef } from '../data/parts.ts';
import type { PlacedPart, RocketAssembly, StagingConfig, PartConnection } from '../core/rocketbuilder.ts';
import type { GameState } from '../core/gameState.ts';
import { makeGameState } from './_factories.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../data/parts.ts', () => ({
  getPartById: vi.fn((id: string) => {
    const catalog: Record<string, Partial<PartDef>> = {
      'engine-1': { name: 'Merlin', mass: 500, cost: 1000, type: 'ENGINE', properties: { thrust: 100 } },
      'tank-1': { name: 'Fuel Tank', mass: 200, cost: 500, type: 'FUEL_TANK', properties: { fuelMass: 800 } },
      'cmd-1': { name: 'Command Pod', mass: 100, cost: 2000, type: 'COMMAND_MODULE' },
    };
    return catalog[id] || null;
  }),
}));

import { setVabState, resetVabState } from '../ui/vab/_state.ts';
import {
  snapshotStaging,
  recordPlacement,
  recordDeletion,
  recordMove,
  recordStagingChange,
  recordClearAll,
  clearUndoRedo,
} from '../ui/vab/_undoActions.ts';
import { undo, redo, canUndo } from '../core/undoRedo.ts';

function createTestAssembly(partsMap: Map<string, PlacedPart> | Record<string, PlacedPart>): RocketAssembly {
  return {
    parts: partsMap instanceof Map ? partsMap : new Map(Object.entries(partsMap)),
    connections: [],
    symmetryPairs: [],
    _nextId: 10,
  };
}

function createTestStaging(stages: string[][] = [[]], unstaged: string[] = [], currentIdx: number = 0): StagingConfig {
  return {
    stages: stages.map(ids => ({ instanceIds: [...ids] })),
    unstaged: [...unstaged],
    currentStageIdx: currentIdx,
  };
}

describe('VAB Undo Actions', () => {
  beforeEach(() => {
    resetVabState();
    clearUndoRedo();
  });

  describe('snapshotStaging()', () => {
    it('captures a deep clone of the current staging config', () => {
      const staging = createTestStaging([['p1', 'p2']], ['p3']);
      setVabState({
        assembly: createTestAssembly({}),
        stagingConfig: staging,
      });

      const snapshot = snapshotStaging();

      // Should be a deep clone, not the same reference
      expect(snapshot).not.toBe(staging);
      expect(snapshot.stages[0]).not.toBe(staging.stages[0]);
      expect(snapshot.stages[0].instanceIds).not.toBe(staging.stages[0].instanceIds);
      expect(snapshot.unstaged).not.toBe(staging.unstaged);

      // Values should match
      expect(snapshot.stages[0].instanceIds).toEqual(['p1', 'p2']);
      expect(snapshot.unstaged).toEqual(['p3']);
      expect(snapshot.currentStageIdx).toBe(0);
    });

    it('snapshot is not affected by subsequent mutations', () => {
      const staging = createTestStaging([['p1']], []);
      setVabState({
        assembly: createTestAssembly({}),
        stagingConfig: staging,
      });

      const snapshot = snapshotStaging();
      staging.stages[0].instanceIds.push('p2');
      staging.unstaged.push('p3');

      expect(snapshot.stages[0].instanceIds).toEqual(['p1']);
      expect(snapshot.unstaged).toEqual([]);
    });
  });

  describe('recordStagingChange()', () => {
    it('pushes an undo action for staging changes', () => {
      const staging = createTestStaging([['p1']], ['p2']);
      setVabState({
        assembly: createTestAssembly({}),
        stagingConfig: staging,
      });

      const before = snapshotStaging();

      // Simulate a staging change
      staging.stages[0].instanceIds.push('p2');
      staging.unstaged = [];

      recordStagingChange(before);

      expect(canUndo()).toBe(true);
    });

    it('undo restores previous staging state', () => {
      const staging = createTestStaging([['p1']], ['p2']);
      setVabState({
        assembly: createTestAssembly({}),
        stagingConfig: staging,
      });

      const before = snapshotStaging();

      // Mutate staging
      staging.stages[0].instanceIds.push('p2');
      staging.unstaged = [];

      recordStagingChange(before);
      undo();

      expect(staging.stages[0].instanceIds).toEqual(['p1']);
      expect(staging.unstaged).toEqual(['p2']);
    });

    it('redo reapplies the staging change', () => {
      const staging = createTestStaging([['p1']], ['p2']);
      setVabState({
        assembly: createTestAssembly({}),
        stagingConfig: staging,
      });

      const before = snapshotStaging();

      staging.stages[0].instanceIds.push('p2');
      staging.unstaged = [];

      recordStagingChange(before);
      undo();
      redo();

      expect(staging.stages[0].instanceIds).toEqual(['p1', 'p2']);
      expect(staging.unstaged).toEqual([]);
    });
  });

  describe('recordPlacement()', () => {
    it('records a placement that can be undone', () => {
      const parts = new Map([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly._nextId = 2;
      const staging = createTestStaging([['p1']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = createTestStaging([[]], []);
      recordPlacement(['p1'], 1000, stagingBefore);

      expect(canUndo()).toBe(true);

      // Undo should remove the part and refund cost
      undo();
      expect(assembly.parts.has('p1')).toBe(false);
      expect(gameState.money).toBe(6000); // 5000 + 1000 refund
    });

    it('redo re-adds the placed part', () => {
      const parts = new Map([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly._nextId = 2;
      const staging = createTestStaging([['p1']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = createTestStaging([[]], []);
      recordPlacement(['p1'], 1000, stagingBefore);

      undo();
      expect(assembly.parts.has('p1')).toBe(false);

      redo();
      expect(assembly.parts.has('p1')).toBe(true);
      expect(gameState.money).toBe(5000); // undo refunded to 6000, redo deducts 1000 back to 5000
    });
  });

  describe('recordPlacement() — connections and symmetry', () => {
    it('undo removes connections involving the placed part', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.connections = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 0, toSnapIndex: 0 },
      ];
      assembly._nextId = 3;
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = createTestStaging([[]], []);
      recordPlacement(['p1', 'p2'], 1500, stagingBefore);

      undo();

      expect(assembly.parts.has('p1')).toBe(false);
      expect(assembly.parts.has('p2')).toBe(false);
      expect(assembly.connections.length).toBe(0);
    });

    it('undo removes symmetry pairs involving placed parts', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: -20, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'engine-1', x: 20, y: 0 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.symmetryPairs = [['p1', 'p2']];
      assembly._nextId = 3;
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = createTestStaging([[]], []);
      recordPlacement(['p1', 'p2'], 2000, stagingBefore);

      undo();

      expect(assembly.parts.has('p1')).toBe(false);
      expect(assembly.symmetryPairs.length).toBe(0);
    });

    it('redo re-adds connections and symmetry pairs', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.connections = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 0, toSnapIndex: 0 },
      ];
      assembly.symmetryPairs = [['p1', 'p2']];
      assembly._nextId = 3;
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = createTestStaging([[]], []);
      recordPlacement(['p1', 'p2'], 1500, stagingBefore);

      undo();
      expect(assembly.connections.length).toBe(0);
      expect(assembly.symmetryPairs.length).toBe(0);

      redo();
      expect(assembly.parts.has('p1')).toBe(true);
      expect(assembly.parts.has('p2')).toBe(true);
      expect(assembly.connections.length).toBe(1);
      expect(assembly.symmetryPairs.length).toBe(1);
    });
  });

  describe('recordDeletion()', () => {
    it('records a deletion that can be undone', () => {
      const parts = new Map([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
      ]);
      const assembly = createTestAssembly(parts);
      const staging = createTestStaging([['p1']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordDeletion(['p1'], 1000, stagingBefore);

      // Now actually remove the part (recordDeletion is called BEFORE removal)
      assembly.parts.delete('p1');

      expect(canUndo()).toBe(true);

      // Undo should re-add the part and reverse the refund
      undo();
      expect(assembly.parts.has('p1')).toBe(true);
      expect(gameState.money).toBe(4000); // 5000 - 1000 (reverse refund)
    });
  });

  describe('recordMove()', () => {
    it('records a move that can be undone', () => {
      const parts = new Map([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 100, y: 200 }],
      ]);
      const assembly = createTestAssembly(parts);

      setVabState({ assembly, stagingConfig: createTestStaging() });

      const oldConns: PartConnection[] = [];
      const newConns: PartConnection[] = [];
      recordMove('p1', 0, 0, 100, 200, oldConns, newConns);

      expect(canUndo()).toBe(true);

      undo();
      const p = assembly.parts.get('p1')!;
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
    });

    it('redo restores the new position', () => {
      const parts = new Map([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 100, y: 200 }],
      ]);
      const assembly = createTestAssembly(parts);

      setVabState({ assembly, stagingConfig: createTestStaging() });

      recordMove('p1', 0, 0, 100, 200, [], []);

      undo();
      redo();

      const p = assembly.parts.get('p1')!;
      expect(p.x).toBe(100);
      expect(p.y).toBe(200);
    });
  });

  describe('recordDeletion() — connections and symmetry', () => {
    it('undo restores connections involving the deleted part', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.connections = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 0, toSnapIndex: 0 },
      ];
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordDeletion(['p1'], 500, stagingBefore);

      // Simulate actual deletion
      assembly.parts.delete('p1');
      assembly.connections = assembly.connections.filter(
        c => c.fromInstanceId !== 'p1' && c.toInstanceId !== 'p1',
      );

      undo();

      expect(assembly.parts.has('p1')).toBe(true);
      expect(assembly.connections.length).toBe(1);
      expect(assembly.connections[0].fromInstanceId).toBe('p1');
      expect(assembly.connections[0].toInstanceId).toBe('p2');
    });

    it('undo restores symmetry pairs involving the deleted part', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: -20, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'engine-1', x: 20, y: 0 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.symmetryPairs = [['p1', 'p2']];
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordDeletion(['p1', 'p2'], 2000, stagingBefore);

      // Simulate deletion
      assembly.parts.delete('p1');
      assembly.parts.delete('p2');
      assembly.symmetryPairs = [];

      undo();

      expect(assembly.parts.has('p1')).toBe(true);
      expect(assembly.parts.has('p2')).toBe(true);
      expect(assembly.symmetryPairs.length).toBe(1);
      expect(assembly.symmetryPairs[0]).toEqual(['p1', 'p2']);
    });

    it('redo re-removes deleted parts and prunes connections', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.connections = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 0, toSnapIndex: 0 },
      ];
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordDeletion(['p1'], 500, stagingBefore);

      // Simulate deletion
      assembly.parts.delete('p1');
      assembly.connections = [];

      // Undo restores
      undo();
      expect(assembly.parts.has('p1')).toBe(true);
      expect(assembly.connections.length).toBe(1);

      // Redo re-deletes
      redo();
      expect(assembly.parts.has('p1')).toBe(false);
      // Connections should be pruned by the redo
      const hasP1Conn = assembly.connections.some(
        c => c.fromInstanceId === 'p1' || c.toInstanceId === 'p1',
      );
      expect(hasP1Conn).toBe(false);
    });

    it('redo prunes staging config of deleted part IDs', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordDeletion(['p1'], 500, stagingBefore);

      assembly.parts.delete('p1');

      undo();
      // After undo, staging is restored with p1
      expect(staging.stages[0].instanceIds).toContain('p1');

      redo();
      // After redo, p1 should be pruned from staging
      expect(staging.stages[0].instanceIds).not.toContain('p1');
      expect(staging.stages[0].instanceIds).toContain('p2');
    });

    it('redo prunes symmetry pairs of deleted parts', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: -20, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'engine-1', x: 20, y: 0 }],
        ['p3', { instanceId: 'p3', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.symmetryPairs = [['p1', 'p2']];
      const staging = createTestStaging([['p1', 'p2', 'p3']], []);
      const gameState = makeGameState({ money: 5000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordDeletion(['p1', 'p2'], 2000, stagingBefore);

      assembly.parts.delete('p1');
      assembly.parts.delete('p2');
      assembly.symmetryPairs = [];

      undo();
      expect(assembly.symmetryPairs.length).toBe(1);

      redo();
      expect(assembly.symmetryPairs.length).toBe(0);
    });
  });

  describe('recordMove() — with connections', () => {
    it('undo restores old connections and removes new ones', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 100, y: 200 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      const oldConns: PartConnection[] = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 0, toSnapIndex: 1 },
      ];
      const newConns: PartConnection[] = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 1, toSnapIndex: 0 },
      ];

      // Simulate: after move, assembly has new connections
      assembly.connections = [...newConns];

      setVabState({ assembly, stagingConfig: createTestStaging() });

      recordMove('p1', 0, 0, 100, 200, oldConns, newConns);

      undo();

      const p = assembly.parts.get('p1')!;
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
      // Old connections should be restored
      expect(assembly.connections.length).toBe(1);
      expect(assembly.connections[0].fromSnapIndex).toBe(0);
      expect(assembly.connections[0].toSnapIndex).toBe(1);
    });

    it('redo restores new connections and removes old ones', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 100, y: 200 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      const oldConns: PartConnection[] = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 0, toSnapIndex: 1 },
      ];
      const newConns: PartConnection[] = [
        { fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 1, toSnapIndex: 0 },
      ];

      assembly.connections = [...newConns];

      setVabState({ assembly, stagingConfig: createTestStaging() });

      recordMove('p1', 0, 0, 100, 200, oldConns, newConns);

      undo();
      redo();

      const p = assembly.parts.get('p1')!;
      expect(p.x).toBe(100);
      expect(p.y).toBe(200);
      // New connections should be restored
      expect(assembly.connections.length).toBe(1);
      expect(assembly.connections[0].fromSnapIndex).toBe(1);
      expect(assembly.connections[0].toSnapIndex).toBe(0);
    });

    it('handles move when part is not in assembly on undo', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 100, y: 200 }],
      ]);
      const assembly = createTestAssembly(parts);

      setVabState({ assembly, stagingConfig: createTestStaging() });

      recordMove('p1', 0, 0, 100, 200, [], []);

      // Remove the part before undoing (edge case)
      assembly.parts.delete('p1');

      // Should not throw
      expect(() => undo()).not.toThrow();
    });
  });

  describe('recordClearAll()', () => {
    it('records a clear-all that can be undone', () => {
      const parts = new Map([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'tank-1', x: 0, y: 50 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.connections = [{ fromInstanceId: 'p1', toInstanceId: 'p2', fromSnapIndex: 0, toSnapIndex: 0 }];
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 3000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordClearAll(1500, stagingBefore);

      // Simulate clear
      assembly.parts.clear();
      assembly.connections.length = 0;

      expect(canUndo()).toBe(true);

      // Undo restores all parts
      undo();
      expect(assembly.parts.size).toBe(2);
      expect(assembly.parts.has('p1')).toBe(true);
      expect(assembly.parts.has('p2')).toBe(true);
      expect(assembly.connections.length).toBe(1);
      expect(gameState.money).toBe(1500); // 3000 - 1500 (reverse refund)
    });

    it('undo restores symmetry pairs after clear all', () => {
      const parts = new Map<string, PlacedPart>([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: -20, y: 0 }],
        ['p2', { instanceId: 'p2', partId: 'engine-1', x: 20, y: 0 }],
      ]);
      const assembly = createTestAssembly(parts);
      assembly.symmetryPairs = [['p1', 'p2']];
      const staging = createTestStaging([['p1', 'p2']], []);
      const gameState = makeGameState({ money: 3000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      const stagingBefore = snapshotStaging();
      recordClearAll(2000, stagingBefore);

      // Simulate clear
      assembly.parts.clear();
      assembly.connections.length = 0;
      assembly.symmetryPairs.length = 0;

      undo();

      expect(assembly.parts.size).toBe(2);
      expect(assembly.symmetryPairs.length).toBe(1);
      expect(assembly.symmetryPairs[0]).toEqual(['p1', 'p2']);
    });

    it('redo clears everything again', () => {
      const parts = new Map([
        ['p1', { instanceId: 'p1', partId: 'engine-1', x: 0, y: 0 }],
      ]);
      const assembly = createTestAssembly(parts);
      const staging = createTestStaging([['p1']], []);
      const gameState = makeGameState({ money: 3000 });

      setVabState({ assembly, stagingConfig: staging, gameState });

      recordClearAll(1000, snapshotStaging());
      assembly.parts.clear();

      undo();
      expect(assembly.parts.size).toBe(1);

      redo();
      expect(assembly.parts.size).toBe(0);
      expect(gameState.money).toBe(3000); // back to original after undo+redo
    });
  });
});
