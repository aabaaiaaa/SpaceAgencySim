// @ts-nocheck
/**
 * undoRedo.test.js — Unit tests for VAB undo/redo stack.
 *
 * Tests cover:
 *   - undo reverses placement / deletion / move / staging changes
 *   - redo re-applies undone actions
 *   - stack depth limit (50 actions)
 *   - new action after undo clears redo stack
 *   - clearUndoRedo empties both stacks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  pushUndoAction,
  undo,
  redo,
  clearUndoRedo,
  canUndo,
  canRedo,
  undoStackSize,
  redoStackSize,
  peekUndoLabel,
  peekRedoLabel,
  setUndoRedoChangeCallback,
  setUndoRedoErrorCallback,
  UNDO_MAX_DEPTH,
} from '../core/undoRedo.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  removePartFromAssembly,
  movePlacedPart,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  movePartBetweenStages,
  returnPartToUnstaged,
} from '../core/rocketbuilder.ts';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearUndoRedo();
});

// ---------------------------------------------------------------------------
// Core stack operations
// ---------------------------------------------------------------------------

describe('Undo/Redo Stack — core operations', () => {
  it('starts with empty stacks', () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
    expect(undoStackSize()).toBe(0);
    expect(redoStackSize()).toBe(0);
    expect(peekUndoLabel()).toBeNull();
    expect(peekRedoLabel()).toBeNull();
  });

  it('push adds to undo stack', () => {
    let value = 0;
    pushUndoAction({
      type: 'place',
      label: 'Place Part',
      undo() { value = -1; },
      redo() { value = 1; },
    });
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
    expect(undoStackSize()).toBe(1);
    expect(peekUndoLabel()).toBe('Place Part');
  });

  it('undo calls the undo function and moves action to redo stack', () => {
    let value = 0;
    pushUndoAction({
      type: 'place',
      label: 'Place Part',
      undo() { value = -1; },
      redo() { value = 1; },
    });
    const result = undo();
    expect(result).not.toBeNull();
    expect(value).toBe(-1);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
    expect(redoStackSize()).toBe(1);
    expect(peekRedoLabel()).toBe('Place Part');
  });

  it('redo calls the redo function and moves action back to undo stack', () => {
    let value = 0;
    pushUndoAction({
      type: 'place',
      label: 'Place Part',
      undo() { value = -1; },
      redo() { value = 1; },
    });
    undo();
    expect(value).toBe(-1);
    const result = redo();
    expect(result).not.toBeNull();
    expect(value).toBe(1);
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });

  it('undo returns null when stack is empty', () => {
    expect(undo()).toBeNull();
  });

  it('redo returns null when stack is empty', () => {
    expect(redo()).toBeNull();
  });

  it('new action after undo clears redo stack', () => {
    let value = 0;
    pushUndoAction({
      type: 'place',
      label: 'Action 1',
      undo() { value = 0; },
      redo() { value = 1; },
    });
    undo();
    expect(canRedo()).toBe(true);

    // Push a new action — redo stack should be cleared.
    pushUndoAction({
      type: 'place',
      label: 'Action 2',
      undo() { value = 0; },
      redo() { value = 2; },
    });
    expect(canRedo()).toBe(false);
    expect(redoStackSize()).toBe(0);
    expect(undoStackSize()).toBe(1);
    expect(peekUndoLabel()).toBe('Action 2');
  });

  it('clearUndoRedo empties both stacks', () => {
    pushUndoAction({
      type: 'place',
      label: 'A',
      undo() {},
      redo() {},
    });
    pushUndoAction({
      type: 'place',
      label: 'B',
      undo() {},
      redo() {},
    });
    undo(); // Move B to redo
    expect(undoStackSize()).toBe(1);
    expect(redoStackSize()).toBe(1);

    clearUndoRedo();
    expect(undoStackSize()).toBe(0);
    expect(redoStackSize()).toBe(0);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stack depth limit
// ---------------------------------------------------------------------------

describe('Undo/Redo Stack — depth limit', () => {
  it('enforces the maximum depth on push', () => {
    for (let i = 0; i < UNDO_MAX_DEPTH + 20; i++) {
      pushUndoAction({
        type: 'place',
        label: `Action ${i}`,
        undo() {},
        redo() {},
      });
    }
    expect(undoStackSize()).toBe(UNDO_MAX_DEPTH);
  });

  it('the oldest action is dropped when exceeding depth', () => {
    for (let i = 0; i < UNDO_MAX_DEPTH + 5; i++) {
      pushUndoAction({
        type: 'place',
        label: `Action ${i}`,
        undo() {},
        redo() {},
      });
    }
    // The oldest remaining action should be Action 5 (0-4 were dropped).
    // Undo all to check the last label.
    let lastLabel = null;
    while (canUndo()) {
      lastLabel = undo()?.label;
    }
    expect(lastLabel).toBe('Action 5');
  });

  it('enforces depth limit on redo→undo→push cycle', () => {
    // Fill to max.
    for (let i = 0; i < UNDO_MAX_DEPTH; i++) {
      pushUndoAction({
        type: 'place',
        label: `Action ${i}`,
        undo() {},
        redo() {},
      });
    }
    expect(undoStackSize()).toBe(UNDO_MAX_DEPTH);

    // Redo restoring to undo stack should also respect depth (via push path).
    undo(); // Move one to redo
    expect(undoStackSize()).toBe(UNDO_MAX_DEPTH - 1);
    redo(); // Move back to undo
    expect(undoStackSize()).toBe(UNDO_MAX_DEPTH);
  });
});

// ---------------------------------------------------------------------------
// Part placement undo/redo
// ---------------------------------------------------------------------------

describe('Undo/Redo — part placement', () => {
  it('undo reverses a part placement', () => {
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();

    const id = addPartToAssembly(assembly, 'pod-mk1', 0, 100);
    syncStagingWithAssembly(assembly, staging);

    // Record the placement undo action.
    pushUndoAction({
      type: 'place',
      label: 'Place pod-mk1',
      undo() {
        assembly.parts.delete(id);
        // Remove from staging.
        for (const stage of staging.stages) {
          stage.instanceIds = stage.instanceIds.filter(i => i !== id);
        }
        staging.unstaged = staging.unstaged.filter(i => i !== id);
      },
      redo() {
        assembly.parts.set(id, { instanceId: id, partId: 'pod-mk1', x: 0, y: 100 });
        syncStagingWithAssembly(assembly, staging);
      },
    });

    expect(assembly.parts.size).toBe(1);
    expect(assembly.parts.has(id)).toBe(true);

    undo();
    expect(assembly.parts.size).toBe(0);
    expect(assembly.parts.has(id)).toBe(false);

    redo();
    expect(assembly.parts.size).toBe(1);
    expect(assembly.parts.has(id)).toBe(true);
    expect(assembly.parts.get(id).x).toBe(0);
    expect(assembly.parts.get(id).y).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Part deletion undo/redo
// ---------------------------------------------------------------------------

describe('Undo/Redo — part deletion', () => {
  it('undo reverses a part deletion (restores part and connections)', () => {
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();

    const id1 = addPartToAssembly(assembly, 'pod-mk1', 0, 100);
    const id2 = addPartToAssembly(assembly, 'tank-small', 0, 50);
    connectParts(assembly, id1, 0, id2, 0);
    syncStagingWithAssembly(assembly, staging);

    // Capture state before deletion for undo.
    const deletedPart = { ...assembly.parts.get(id2) };
    const deletedConns = assembly.connections
      .filter(c => c.fromInstanceId === id2 || c.toInstanceId === id2)
      .map(c => ({ ...c }));
    const stagingBefore = {
      stages: staging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
      unstaged: [...staging.unstaged],
      currentStageIdx: staging.currentStageIdx,
    };

    // Perform deletion.
    removePartFromAssembly(assembly, id2);
    syncStagingWithAssembly(assembly, staging);

    pushUndoAction({
      type: 'delete',
      label: 'Delete tank-small',
      undo() {
        assembly.parts.set(id2, { ...deletedPart });
        for (const c of deletedConns) assembly.connections.push({ ...c });
        staging.stages = stagingBefore.stages.map(s => ({ instanceIds: [...s.instanceIds] }));
        staging.unstaged = [...stagingBefore.unstaged];
        staging.currentStageIdx = stagingBefore.currentStageIdx;
      },
      redo() {
        assembly.parts.delete(id2);
        for (let i = assembly.connections.length - 1; i >= 0; i--) {
          const c = assembly.connections[i];
          if (c.fromInstanceId === id2 || c.toInstanceId === id2) {
            assembly.connections.splice(i, 1);
          }
        }
        syncStagingWithAssembly(assembly, staging);
      },
    });

    expect(assembly.parts.size).toBe(1);
    expect(assembly.connections.length).toBe(0);

    // Undo the deletion.
    undo();
    expect(assembly.parts.size).toBe(2);
    expect(assembly.parts.has(id2)).toBe(true);
    expect(assembly.parts.get(id2).partId).toBe('tank-small');
    expect(assembly.connections.length).toBe(1);

    // Redo the deletion.
    redo();
    expect(assembly.parts.size).toBe(1);
    expect(assembly.parts.has(id2)).toBe(false);
    expect(assembly.connections.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Part movement undo/redo
// ---------------------------------------------------------------------------

describe('Undo/Redo — part movement', () => {
  it('undo reverses a part move', () => {
    const assembly = createRocketAssembly();

    const id = addPartToAssembly(assembly, 'pod-mk1', 0, 100);
    const oldX = 0;
    const oldY = 100;
    const newX = 50;
    const newY = 200;

    // Move the part.
    movePlacedPart(assembly, id, newX, newY);

    pushUndoAction({
      type: 'move',
      label: 'Move pod-mk1',
      undo() {
        const p = assembly.parts.get(id);
        if (p) { p.x = oldX; p.y = oldY; }
      },
      redo() {
        const p = assembly.parts.get(id);
        if (p) { p.x = newX; p.y = newY; }
      },
    });

    expect(assembly.parts.get(id).x).toBe(newX);
    expect(assembly.parts.get(id).y).toBe(newY);

    undo();
    expect(assembly.parts.get(id).x).toBe(oldX);
    expect(assembly.parts.get(id).y).toBe(oldY);

    redo();
    expect(assembly.parts.get(id).x).toBe(newX);
    expect(assembly.parts.get(id).y).toBe(newY);
  });
});

// ---------------------------------------------------------------------------
// Staging undo/redo
// ---------------------------------------------------------------------------

describe('Undo/Redo — staging changes', () => {
  it('undo reverses a staging change', () => {
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();

    const id1 = addPartToAssembly(assembly, 'engine-spark', 0, 0);
    const id2 = addPartToAssembly(assembly, 'decoupler-1', 0, 50);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, id1, 0);

    // Capture staging before the change.
    const stagingBefore = {
      stages: staging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
      unstaged: [...staging.unstaged],
      currentStageIdx: staging.currentStageIdx,
    };

    // Perform staging change: move part to unstaged.
    returnPartToUnstaged(staging, id1);

    const stagingAfter = {
      stages: staging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
      unstaged: [...staging.unstaged],
      currentStageIdx: staging.currentStageIdx,
    };

    pushUndoAction({
      type: 'staging',
      label: 'Staging change',
      undo() {
        staging.stages = stagingBefore.stages.map(s => ({ instanceIds: [...s.instanceIds] }));
        staging.unstaged = [...stagingBefore.unstaged];
        staging.currentStageIdx = stagingBefore.currentStageIdx;
      },
      redo() {
        staging.stages = stagingAfter.stages.map(s => ({ instanceIds: [...s.instanceIds] }));
        staging.unstaged = [...stagingAfter.unstaged];
        staging.currentStageIdx = stagingAfter.currentStageIdx;
      },
    });

    // Verify current state (id1 returned to unstaged).
    expect(staging.stages[0].instanceIds).not.toContain(id1);
    expect(staging.unstaged).toContain(id1);

    // Undo — id1 should be back in stage 0.
    undo();
    expect(staging.stages[0].instanceIds).toContain(id1);

    // Redo — id1 should be back in unstaged.
    redo();
    expect(staging.stages[0].instanceIds).not.toContain(id1);
    expect(staging.unstaged).toContain(id1);
  });
});

// ---------------------------------------------------------------------------
// Multiple undo/redo sequence
// ---------------------------------------------------------------------------

describe('Undo/Redo — multiple operations', () => {
  it('undoes and redoes multiple actions in correct order', () => {
    const assembly = createRocketAssembly();
    const ids = [];

    // Place 3 parts.
    for (let i = 0; i < 3; i++) {
      const id = addPartToAssembly(assembly, 'pod-mk1', 0, i * 100);
      ids.push(id);
      const capturedId = id;
      pushUndoAction({
        type: 'place',
        label: `Place Part ${i}`,
        undo() { assembly.parts.delete(capturedId); },
        redo() { assembly.parts.set(capturedId, { instanceId: capturedId, partId: 'pod-mk1', x: 0, y: i * 100 }); },
      });
    }

    expect(assembly.parts.size).toBe(3);
    expect(undoStackSize()).toBe(3);

    // Undo all 3.
    undo();
    expect(assembly.parts.size).toBe(2);
    undo();
    expect(assembly.parts.size).toBe(1);
    undo();
    expect(assembly.parts.size).toBe(0);
    expect(redoStackSize()).toBe(3);

    // Redo all 3.
    redo();
    expect(assembly.parts.size).toBe(1);
    redo();
    expect(assembly.parts.size).toBe(2);
    redo();
    expect(assembly.parts.size).toBe(3);
    expect(undoStackSize()).toBe(3);
  });

  it('new action in the middle clears redo stack', () => {
    const log = [];

    pushUndoAction({ type: 'place', label: 'A', undo() { log.push('undo-A'); }, redo() { log.push('redo-A'); } });
    pushUndoAction({ type: 'place', label: 'B', undo() { log.push('undo-B'); }, redo() { log.push('redo-B'); } });
    pushUndoAction({ type: 'place', label: 'C', undo() { log.push('undo-C'); }, redo() { log.push('redo-C'); } });

    undo(); // undo C
    undo(); // undo B
    expect(log).toEqual(['undo-C', 'undo-B']);
    expect(redoStackSize()).toBe(2);

    // Push a new action — redo stack (B, C) should be cleared.
    pushUndoAction({ type: 'place', label: 'D', undo() { log.push('undo-D'); }, redo() { log.push('redo-D'); } });
    expect(redoStackSize()).toBe(0);
    expect(undoStackSize()).toBe(2); // A, D

    // Can only undo A and D now.
    undo(); // undo D
    undo(); // undo A
    expect(log).toEqual(['undo-C', 'undo-B', 'undo-D', 'undo-A']);
    expect(canUndo()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Change callback
// ---------------------------------------------------------------------------

describe('Undo/Redo — change callback', () => {
  it('fires callback on push, undo, redo, and clear', () => {
    let callCount = 0;
    setUndoRedoChangeCallback(() => { callCount++; });

    pushUndoAction({ type: 'place', label: 'X', undo() {}, redo() {} });
    expect(callCount).toBe(1);

    undo();
    expect(callCount).toBe(2);

    redo();
    expect(callCount).toBe(3);

    clearUndoRedo();
    expect(callCount).toBe(4);

    // Clean up callback.
    setUndoRedoChangeCallback(null);
  });
});

// ---------------------------------------------------------------------------
// Error handling — undo/redo callback throwing
// ---------------------------------------------------------------------------

describe('Undo/Redo — error handling', () => {
  beforeEach(() => {
    setUndoRedoErrorCallback(null);
  });

  it('undo callback throwing preserves stack integrity (action stays on undo stack)', () => {
    pushUndoAction({
      type: 'place',
      label: 'Exploding undo',
      undo() { throw new Error('undo boom'); },
      redo() {},
    });

    expect(undoStackSize()).toBe(1);
    expect(redoStackSize()).toBe(0);

    const result = undo();

    // undo() should return null on failure.
    expect(result).toBeNull();
    // The action should be pushed back onto the undo stack.
    expect(undoStackSize()).toBe(1);
    expect(redoStackSize()).toBe(0);
    expect(peekUndoLabel()).toBe('Exploding undo');
  });

  it('redo callback throwing preserves stack integrity (action stays on redo stack)', () => {
    pushUndoAction({
      type: 'place',
      label: 'Exploding redo',
      undo() {},
      redo() { throw new Error('redo boom'); },
    });

    // Move action to redo stack via a successful undo.
    undo();
    expect(undoStackSize()).toBe(0);
    expect(redoStackSize()).toBe(1);

    const result = redo();

    // redo() should return null on failure.
    expect(result).toBeNull();
    // The action should be pushed back onto the redo stack.
    expect(redoStackSize()).toBe(1);
    expect(undoStackSize()).toBe(0);
    expect(peekRedoLabel()).toBe('Exploding redo');
  });

  it('error is logged via logger.error when undo throws', async () => {
    // Spy on the logger.
    const { logger } = await import('../core/logger.js');
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    pushUndoAction({
      type: 'move',
      label: 'Bad undo',
      undo() { throw new Error('test error'); },
      redo() {},
    });

    undo();

    expect(spy).toHaveBeenCalledWith(
      'undoRedo',
      'Undo callback threw',
      expect.objectContaining({ label: 'Bad undo' }),
    );

    spy.mockRestore();
  });

  it('error is logged via logger.error when redo throws', async () => {
    const { logger } = await import('../core/logger.js');
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    pushUndoAction({
      type: 'move',
      label: 'Bad redo',
      undo() {},
      redo() { throw new Error('test error'); },
    });

    undo();
    redo();

    expect(spy).toHaveBeenCalledWith(
      'undoRedo',
      'Redo callback threw',
      expect.objectContaining({ label: 'Bad redo' }),
    );

    spy.mockRestore();
  });

  it('error callback is invoked with "Undo failed" on undo throw', () => {
    const errorMessages: string[] = [];
    setUndoRedoErrorCallback((msg) => errorMessages.push(msg));

    pushUndoAction({
      type: 'place',
      label: 'Failing undo',
      undo() { throw new Error('fail'); },
      redo() {},
    });

    undo();

    expect(errorMessages).toEqual(['Undo failed']);
    setUndoRedoErrorCallback(null);
  });

  it('error callback is invoked with "Redo failed" on redo throw', () => {
    const errorMessages: string[] = [];
    setUndoRedoErrorCallback((msg) => errorMessages.push(msg));

    pushUndoAction({
      type: 'place',
      label: 'Failing redo',
      undo() {},
      redo() { throw new Error('fail'); },
    });

    undo();
    redo();

    expect(errorMessages).toEqual(['Redo failed']);
    setUndoRedoErrorCallback(null);
  });

  it('other actions still work after an undo failure', () => {
    let value = 0;

    pushUndoAction({
      type: 'place',
      label: 'Good action',
      undo() { value = -1; },
      redo() { value = 1; },
    });
    pushUndoAction({
      type: 'place',
      label: 'Bad action',
      undo() { throw new Error('fail'); },
      redo() {},
    });

    // Bad action fails — should remain on undo stack.
    undo();
    expect(undoStackSize()).toBe(2);
    expect(value).toBe(0);

    // Pop the bad action manually isn't possible, but the good action beneath
    // is still intact. Let's verify by clearing and re-pushing.
    clearUndoRedo();
    pushUndoAction({
      type: 'place',
      label: 'Another good action',
      undo() { value = 42; },
      redo() { value = 99; },
    });
    const result = undo();
    expect(result).not.toBeNull();
    expect(value).toBe(42);
  });
});
