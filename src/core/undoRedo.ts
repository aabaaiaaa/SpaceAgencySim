/**
 * undoRedo.ts — Delta-based undo/redo stack for the VAB.
 *
 * Each action records a forward operation and its inverse. Undo applies the
 * inverse; redo re-applies the forward operation.
 *
 * Stack depth is capped at MAX_DEPTH to bound memory usage.
 */

export type ActionType = 'place' | 'delete' | 'move' | 'staging' | 'clearAll';

export interface UndoAction {
  type: ActionType;
  /** Human-readable description (e.g. "Place Fuel Tank"). */
  label: string;
  /** Applies the inverse operation. */
  undo: () => void;
  /** Re-applies the forward operation. */
  redo: () => void;
}

const MAX_DEPTH = 50;

let _undoStack: UndoAction[] = [];

let _redoStack: UndoAction[] = [];

let _onChangeCallback: (() => void) | null = null;

/**
 * Register a callback invoked whenever the stack changes (push/undo/redo/clear).
 */
export function setUndoRedoChangeCallback(cb: () => void): void {
  _onChangeCallback = cb;
}

function _notifyChange(): void {
  if (_onChangeCallback) _onChangeCallback();
}

/**
 * Push a new action onto the undo stack. Clears the redo stack.
 */
export function pushUndoAction(action: UndoAction): void {
  _undoStack.push(action);
  if (_undoStack.length > MAX_DEPTH) {
    _undoStack.shift();
  }
  _redoStack.length = 0;
  _notifyChange();
}

/**
 * Undo the last action. Returns the action that was undone, or null.
 */
export function undo(): UndoAction | null {
  const action = _undoStack.pop();
  if (!action) return null;
  action.undo();
  _redoStack.push(action);
  _notifyChange();
  return action;
}

/**
 * Redo the last undone action. Returns the action that was redone, or null.
 */
export function redo(): UndoAction | null {
  const action = _redoStack.pop();
  if (!action) return null;
  action.redo();
  _undoStack.push(action);
  if (_undoStack.length > MAX_DEPTH) {
    _undoStack.shift();
  }
  _notifyChange();
  return action;
}

/**
 * Clear both undo and redo stacks.
 */
export function clearUndoRedo(): void {
  _undoStack.length = 0;
  _redoStack.length = 0;
  _notifyChange();
}

export function canUndo(): boolean {
  return _undoStack.length > 0;
}

export function canRedo(): boolean {
  return _redoStack.length > 0;
}

export function undoStackSize(): number {
  return _undoStack.length;
}

export function redoStackSize(): number {
  return _redoStack.length;
}

/**
 * Return the label of the next undo action, or null.
 */
export function peekUndoLabel(): string | null {
  return _undoStack.length > 0 ? _undoStack[_undoStack.length - 1].label : null;
}

/**
 * Return the label of the next redo action, or null.
 */
export function peekRedoLabel(): string | null {
  return _redoStack.length > 0 ? _redoStack[_redoStack.length - 1].label : null;
}

/** Max depth constant exposed for testing. */
export const UNDO_MAX_DEPTH = MAX_DEPTH;
