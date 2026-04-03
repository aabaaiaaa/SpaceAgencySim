/**
 * undoRedo.js — Delta-based undo/redo stack for the VAB.
 *
 * Each action records a forward operation and its inverse. Undo applies the
 * inverse; redo re-applies the forward operation.
 *
 * Stack depth is capped at MAX_DEPTH to bound memory usage.
 */

/** @typedef {'place' | 'delete' | 'move' | 'staging' | 'clearAll'} ActionType */

/**
 * @typedef {Object} UndoAction
 * @property {ActionType} type
 * @property {string} label  — Human-readable description (e.g. "Place Fuel Tank")
 * @property {() => void} undo  — Applies the inverse operation
 * @property {() => void} redo  — Re-applies the forward operation
 */

const MAX_DEPTH = 50;

/** @type {UndoAction[]} */
let _undoStack = [];

/** @type {UndoAction[]} */
let _redoStack = [];

/** @type {(() => void) | null} */
let _onChangeCallback = null;

/**
 * Register a callback invoked whenever the stack changes (push/undo/redo/clear).
 * @param {() => void} cb
 */
export function setUndoRedoChangeCallback(cb) {
  _onChangeCallback = cb;
}

function _notifyChange() {
  if (_onChangeCallback) _onChangeCallback();
}

/**
 * Push a new action onto the undo stack. Clears the redo stack.
 * @param {UndoAction} action
 */
export function pushUndoAction(action) {
  _undoStack.push(action);
  if (_undoStack.length > MAX_DEPTH) {
    _undoStack.shift();
  }
  _redoStack.length = 0;
  _notifyChange();
}

/**
 * Undo the last action. Returns the action that was undone, or null.
 * @returns {UndoAction | null}
 */
export function undo() {
  const action = _undoStack.pop();
  if (!action) return null;
  action.undo();
  _redoStack.push(action);
  _notifyChange();
  return action;
}

/**
 * Redo the last undone action. Returns the action that was redone, or null.
 * @returns {UndoAction | null}
 */
export function redo() {
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
export function clearUndoRedo() {
  _undoStack.length = 0;
  _redoStack.length = 0;
  _notifyChange();
}

/** @returns {boolean} */
export function canUndo() {
  return _undoStack.length > 0;
}

/** @returns {boolean} */
export function canRedo() {
  return _redoStack.length > 0;
}

/** @returns {number} */
export function undoStackSize() {
  return _undoStack.length;
}

/** @returns {number} */
export function redoStackSize() {
  return _redoStack.length;
}

/**
 * Return the label of the next undo action, or null.
 * @returns {string | null}
 */
export function peekUndoLabel() {
  return _undoStack.length > 0 ? _undoStack[_undoStack.length - 1].label : null;
}

/**
 * Return the label of the next redo action, or null.
 * @returns {string | null}
 */
export function peekRedoLabel() {
  return _redoStack.length > 0 ? _redoStack[_redoStack.length - 1].label : null;
}

/** Max depth constant exposed for testing. */
export const UNDO_MAX_DEPTH = MAX_DEPTH;
