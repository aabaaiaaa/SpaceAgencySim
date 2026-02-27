/**
 * rocketbuilder.js — Core rocket assembly logic for the VAB.
 *
 * The rocket being built is represented as a directed graph:
 *   Nodes  — PlacedPart instances: unique instanceId + catalog partId + world position.
 *   Edges  — PartConnection records that pair two snap-point sockets.
 *
 * COORDINATE CONVENTIONS
 * ======================
 * World space: X = 0 is the rocket centreline, Y increases upward.
 * Snap-point offsets (from parts.js) use screen-style Y (positive = downward),
 * so the world Y of a snap socket is:  worldSnapY = partCentreY − offsetY
 *
 * This module has no DOM or canvas dependencies and can be unit-tested headlessly.
 */

import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Screen pixels within which a dragged socket "snaps" to a target socket. */
export const SNAP_DISTANCE_PX = 30;

/** @type {Readonly<Record<string, string>>} */
const OPPOSITE_SIDE = Object.freeze({
  top:    'bottom',
  bottom: 'top',
  left:   'right',
  right:  'left',
});

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PlacedPart
 * @property {string} instanceId  Unique ID for this instance in the build session.
 * @property {string} partId      Part catalog ID referencing a PartDef.
 * @property {number} x           World X of part centre.
 * @property {number} y           World Y of part centre (Y-up world space).
 */

/**
 * One edge in the rocket part graph.
 * @typedef {Object} PartConnection
 * @property {string} fromInstanceId
 * @property {number} fromSnapIndex   Index into the source part's snapPoints array.
 * @property {string} toInstanceId
 * @property {number} toSnapIndex     Index into the target part's snapPoints array.
 */

/**
 * @typedef {Object} RocketAssembly
 * @property {Map<string, PlacedPart>} parts
 * @property {PartConnection[]}        connections
 * @property {number}                  _nextId  Internal ID counter.
 */

/**
 * @typedef {Object} SnapCandidate
 * @property {string} targetInstanceId   Placed part the dragged part would attach to.
 * @property {number} targetSnapIndex    Socket index on the target part.
 * @property {number} dragSnapIndex      Socket index on the dragged part (complementary side).
 * @property {number} snapWorldX         World X the dragged part's centre would land at.
 * @property {number} snapWorldY         World Y the dragged part's centre would land at.
 * @property {number} targetSnapWorldX   World X of the target socket (for highlight rendering).
 * @property {number} targetSnapWorldY   World Y of the target socket (for highlight rendering).
 * @property {number} screenDist         Screen-pixel distance between the two sockets.
 */

// ---------------------------------------------------------------------------
// Assembly factory
// ---------------------------------------------------------------------------

/**
 * Create an empty rocket assembly for a new build session.
 * @returns {RocketAssembly}
 */
export function createRocketAssembly() {
  return {
    parts:       new Map(),
    connections: [],
    _nextId:     1,
  };
}

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

/**
 * Add a new part to the assembly at the given world position.
 * @param {RocketAssembly} assembly
 * @param {string} partId
 * @param {number} worldX
 * @param {number} worldY
 * @returns {string}  The new instanceId.
 */
export function addPartToAssembly(assembly, partId, worldX, worldY) {
  const instanceId = `inst-${assembly._nextId++}`;
  assembly.parts.set(instanceId, { instanceId, partId, x: worldX, y: worldY });
  return instanceId;
}

/**
 * Remove a part from the assembly, severing all its connections.
 * @param {RocketAssembly} assembly
 * @param {string} instanceId
 */
export function removePartFromAssembly(assembly, instanceId) {
  assembly.parts.delete(instanceId);
  _pruneConnections(assembly, instanceId);
}

/**
 * Update the world position of a placed part (called after re-dropping a
 * picked-up part at a new location).
 * @param {RocketAssembly} assembly
 * @param {string} instanceId
 * @param {number} worldX
 * @param {number} worldY
 */
export function movePlacedPart(assembly, instanceId, worldX, worldY) {
  const p = assembly.parts.get(instanceId);
  if (p) { p.x = worldX; p.y = worldY; }
}

/**
 * Sever all connections for a part instance (called when picking it up for
 * repositioning).
 * @param {RocketAssembly} assembly
 * @param {string} instanceId
 */
export function disconnectPart(assembly, instanceId) {
  _pruneConnections(assembly, instanceId);
}

/**
 * Register a snap connection between two parts.
 * @param {RocketAssembly} assembly
 * @param {string} fromInstanceId
 * @param {number} fromSnapIndex
 * @param {string} toInstanceId
 * @param {number} toSnapIndex
 */
export function connectParts(
  assembly,
  fromInstanceId, fromSnapIndex,
  toInstanceId,   toSnapIndex,
) {
  assembly.connections.push({
    fromInstanceId, fromSnapIndex,
    toInstanceId,   toSnapIndex,
  });
}

// ---------------------------------------------------------------------------
// Snap candidate finder
// ---------------------------------------------------------------------------

/**
 * Return all valid snap candidates for a part being dragged at the given world
 * position.
 *
 * A candidate is valid when ALL of:
 *   1. A target socket's `accepts` list includes the dragged part's type.
 *   2. The dragged part has a socket on the complementary side.
 *   3. The target socket is not already occupied by an existing connection.
 *   4. Screen-space distance between the two sockets ≤ SNAP_DISTANCE_PX.
 *
 * @param {RocketAssembly} assembly
 * @param {string}  dragPartId    Part catalog ID of the piece being dragged.
 * @param {number}  dragWorldX    Current world X of the dragged part's centre.
 * @param {number}  dragWorldY    Current world Y of the dragged part's centre.
 * @param {number}  zoom          Current camera zoom (world-unit → screen-pixel scale).
 * @returns {SnapCandidate[]}  Sorted nearest-first.
 */
export function findSnapCandidates(
  assembly, dragPartId, dragWorldX, dragWorldY, zoom,
) {
  const dragDef = getPartById(dragPartId);
  if (!dragDef || assembly.parts.size === 0) return [];

  const results = [];

  for (const placed of assembly.parts.values()) {
    const placedDef = getPartById(placed.partId);
    if (!placedDef) continue;

    for (let tsi = 0; tsi < placedDef.snapPoints.length; tsi++) {
      const tSnap = placedDef.snapPoints[tsi];

      // Rule 1: target socket must accept the dragged part type.
      if (!tSnap.accepts.includes(dragDef.type)) continue;

      // Rule 2: dragged part needs a socket on the complementary side.
      const neededSide = OPPOSITE_SIDE[tSnap.side];
      const dsi = dragDef.snapPoints.findIndex((sp) => sp.side === neededSide);
      if (dsi === -1) continue;

      // Rule 3: target socket must not be occupied.
      if (_snapOccupied(assembly, placed.instanceId, tsi)) continue;

      // World position of the target socket.
      // (snapPoint.offsetY: positive = below centre in screen → subtract from world Y)
      const tSnapWX = placed.x + tSnap.offsetX;
      const tSnapWY = placed.y - tSnap.offsetY;

      // World-space offset of the dragged part's complementary socket from its centre.
      const dSnap     = dragDef.snapPoints[dsi];
      const dSnapRelX =  dSnap.offsetX;
      const dSnapRelY = -dSnap.offsetY;   // convert screen-Y direction to world-Y direction

      // Current world position of the dragged socket.
      const dSnapWX = dragWorldX + dSnapRelX;
      const dSnapWY = dragWorldY + dSnapRelY;

      // Screen-pixel distance between the two sockets.
      const screenDist = Math.hypot(
        (dSnapWX - tSnapWX) * zoom,
        (dSnapWY - tSnapWY) * zoom,
      );

      if (screenDist > SNAP_DISTANCE_PX) continue;

      // Snap position: drag socket coincides with target socket.
      //   drag.x + dSnapRelX = tSnapWX  →  drag.x = tSnapWX − dSnapRelX
      //   drag.y + dSnapRelY = tSnapWY  →  drag.y = tSnapWY − dSnapRelY
      results.push({
        targetInstanceId: placed.instanceId,
        targetSnapIndex:  tsi,
        dragSnapIndex:    dsi,
        snapWorldX:       tSnapWX - dSnapRelX,
        snapWorldY:       tSnapWY - dSnapRelY,
        targetSnapWorldX: tSnapWX,
        targetSnapWorldY: tSnapWY,
        screenDist,
      });
    }
  }

  results.sort((a, b) => a.screenDist - b.screenDist);
  return results;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _pruneConnections(assembly, instanceId) {
  assembly.connections = assembly.connections.filter(
    (c) => c.fromInstanceId !== instanceId && c.toInstanceId !== instanceId,
  );
}

function _snapOccupied(assembly, instanceId, snapIndex) {
  return assembly.connections.some(
    (c) =>
      (c.fromInstanceId === instanceId && c.fromSnapIndex === snapIndex) ||
      (c.toInstanceId   === instanceId && c.toSnapIndex   === snapIndex),
  );
}
