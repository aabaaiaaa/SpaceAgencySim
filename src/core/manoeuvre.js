/**
 * manoeuvre.js — Orbital manoeuvre system.
 *
 * Provides orbit recalculation after burns, interplanetary transfer delta-v
 * calculations, SOI transition detection, gravitational assist computation,
 * and route planning for the map view.
 *
 * DESIGN: No manoeuvre menu — all orbital changes are done by hand.
 *   - Normal mode: engine burns directly modify the orbit.
 *     Prograde raises the opposite side, retrograde lowers it.
 *   - Docking mode: burns affect local position only (unchanged).
 *   - Transfers: player manually applies delta-v at the correct orbital point.
 *   - Map view shows target bodies with required delta-v for direct transfers.
 *   - Gravitational assists apply when passing near bodies.
 *
 * @module core/manoeuvre
 */

import {
  BODY_GM,
  BODY_RADIUS,
  CelestialBody,
  FlightPhase,
  ControlMode,
  MIN_ORBIT_ALTITUDE,
} from './constants.js';
import {
  computeOrbitalElements,
  checkOrbitStatus,
  getOrbitalPeriod,
  circularOrbitVelocity,
  getPeriapsisAltitude,
  getApoapsisAltitude,
} from './orbit.js';

// ---------------------------------------------------------------------------
// Celestial body hierarchy and SOI data
// ---------------------------------------------------------------------------

/**
 * Sphere of Influence radii (metres from body centre).
 * Beyond this distance the craft escapes the body's gravitational dominance.
 *
 * Earth SOI ≈ 924,000 km (Hill sphere approximation).
 * Moon SOI  ≈ 66,100 km.
 */
export const SOI_RADIUS = Object.freeze({
  SUN: Infinity,          // Sun's SOI encompasses the entire solar system
  MERCURY: 112_000_000,
  VENUS: 616_000_000,
  EARTH: 924_000_000,
  MOON: 66_100_000,
  MARS: 577_000_000,
  PHOBOS: 170_000,
  DEIMOS: 500_000,
});

/**
 * Mean orbital distance of each child body from its parent (metres).
 * Used for Hohmann transfer calculations.
 */
export const BODY_ORBIT_RADIUS = Object.freeze({
  /** Mercury's mean distance from the Sun. */
  MERCURY: 57_909_000_000,
  /** Venus's mean distance from the Sun. */
  VENUS: 108_208_000_000,
  /** Earth's mean distance from the Sun (1 AU). */
  EARTH: 149_598_000_000,
  /** Moon's mean distance from Earth centre. */
  MOON: 384_400_000,
  /** Mars's mean distance from the Sun. */
  MARS: 227_939_000_000,
  /** Phobos's mean distance from Mars centre. */
  PHOBOS: 9_376_000,
  /** Deimos's mean distance from Mars centre. */
  DEIMOS: 23_463_000,
});

/**
 * Parent body for each celestial body.
 * Earth is the root (no parent in our simplified system).
 */
export const BODY_PARENT = Object.freeze({
  SUN: null,            // Root body (no parent)
  MERCURY: 'SUN',
  VENUS: 'SUN',
  EARTH: 'SUN',
  MOON: 'EARTH',
  MARS: 'SUN',
  PHOBOS: 'MARS',
  DEIMOS: 'MARS',
});

/**
 * Child bodies that orbit each parent.
 */
export const BODY_CHILDREN = Object.freeze({
  SUN: Object.freeze(['MERCURY', 'VENUS', 'EARTH', 'MARS']),
  MERCURY: Object.freeze([]),
  VENUS: Object.freeze([]),
  EARTH: Object.freeze(['MOON']),
  MOON: Object.freeze([]),
  MARS: Object.freeze(['PHOBOS', 'DEIMOS']),
  PHOBOS: Object.freeze([]),
  DEIMOS: Object.freeze([]),
});

// ---------------------------------------------------------------------------
// Orbit recalculation
// ---------------------------------------------------------------------------

/**
 * Recalculate orbital elements from the current physics state vectors.
 * Called after thrust is applied in NORMAL orbit mode to update the orbit.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {string}                               bodyId
 * @param {number}                               epoch    Current flight time.
 * @returns {import('./orbit.js').OrbitalElements|null}
 *   New orbital elements, or null if the trajectory is no longer a bound orbit
 *   (i.e. the craft has reached escape velocity).
 */
export function recalculateOrbit(ps, bodyId, epoch) {
  return computeOrbitalElements(ps.posX, ps.posY, ps.velX, ps.velY, bodyId, epoch);
}

/**
 * Check if the craft is currently thrusting in a way that affects the orbit
 * (i.e. not in docking/RCS mode, and throttle > 0 with active engines).
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @returns {boolean}
 */
export function isOrbitalBurnActive(ps) {
  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    return false;
  }
  return ps.throttle > 0 && ps.firingEngines.size > 0;
}

// ---------------------------------------------------------------------------
// Transfer delta-v calculations
// ---------------------------------------------------------------------------

/**
 * Compute the delta-v required for a basic Hohmann-like direct transfer
 * from the craft's current orbit around `fromBodyId` to reach `toBodyId`.
 *
 * For Earth → Moon:
 *   1. Escape Earth's gravity from current orbit altitude.
 *   2. Hohmann transfer in the Sun-centred (or parent-centred) frame.
 *   3. Capture burn at destination (not included — that's the player's problem).
 *
 * Returns the departure delta-v only (the burn the player needs at their
 * current orbit to begin the transfer).
 *
 * @param {string} fromBodyId  Body the craft currently orbits.
 * @param {string} toBodyId    Target body to transfer to.
 * @param {number} altitude    Craft's current orbital altitude (m above surface).
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }|null}
 *   Delta-v values in m/s, transfer time in seconds. Null if transfer is not
 *   possible (e.g. same body, or unknown body pair).
 */
export function computeTransferDeltaV(fromBodyId, toBodyId, altitude) {
  if (fromBodyId === toBodyId) return null;

  const fromParent = BODY_PARENT[fromBodyId];
  const toParent = BODY_PARENT[toBodyId];

  // Case 1: Transferring to a child body (e.g. Earth → Moon, Mars → Phobos).
  if (toParent === fromBodyId) {
    return _parentToChildTransfer(fromBodyId, toBodyId, altitude);
  }

  // Case 2: Transferring to parent body (e.g. Moon → Earth, Phobos → Mars).
  if (fromParent === toBodyId) {
    return _childToParentTransfer(fromBodyId, toBodyId, altitude);
  }

  // Case 3: Sibling transfer — same parent (e.g. Earth → Mars, Phobos → Deimos).
  if (fromParent && fromParent === toParent) {
    return _siblingTransfer(fromBodyId, toBodyId, altitude);
  }

  // Case 4: Cross-hierarchy — e.g. Moon → Mars (child of one → child of another).
  // Decompose: escape from current body, then sibling transfer in parent frame,
  // then capture at destination.
  if (fromParent && toParent && BODY_PARENT[fromParent] === BODY_PARENT[toParent]) {
    return _crossHierarchyTransfer(fromBodyId, toBodyId, altitude);
  }

  // Case 5: One level up then across — e.g. Moon → Mars (Moon orbits Earth, Mars orbits Sun).
  if (fromParent && BODY_PARENT[fromParent] === toParent) {
    return _deepToShallowTransfer(fromBodyId, toBodyId, altitude);
  }
  if (toParent && BODY_PARENT[toParent] === fromParent) {
    // e.g. Earth → Phobos: go to Mars first, then to Phobos.
    return _shallowToDeepTransfer(fromBodyId, toBodyId, altitude);
  }

  return null;
}

/**
 * Transfer from a parent body to one of its child bodies (e.g. Earth → Moon).
 * Uses Hohmann transfer in the parent-centred frame.
 *
 * @param {string} parentId  Parent body (departure).
 * @param {string} childId   Child body (destination).
 * @param {number} altitude  Departure orbit altitude above parent (m).
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }}
 */
function _parentToChildTransfer(parentId, childId, altitude) {
  const muParent = BODY_GM[parentId];
  const rParent = BODY_RADIUS[parentId];
  const rChild = BODY_ORBIT_RADIUS[childId];

  const r1 = rParent + altitude;
  const a_transfer = (r1 + rChild) / 2;
  const v_circular = Math.sqrt(muParent / r1);
  const v_transfer_peri = Math.sqrt(muParent * (2 / r1 - 1 / a_transfer));
  const departureDV = Math.abs(v_transfer_peri - v_circular);

  const v_transfer_apo = Math.sqrt(muParent * (2 / rChild - 1 / a_transfer));
  const v_child_orbit = Math.sqrt(muParent / rChild);
  const captureDV = Math.abs(v_child_orbit - v_transfer_apo);

  const transferTime = Math.PI * Math.sqrt(a_transfer ** 3 / muParent);

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

/**
 * Transfer from a child body to its parent (e.g. Moon → Earth).
 * Escape child SOI, then transfer in parent frame.
 *
 * @param {string} childId   Child body (departure).
 * @param {string} parentId  Parent body (destination).
 * @param {number} altitude  Departure orbit altitude above child (m).
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }}
 */
function _childToParentTransfer(childId, parentId, altitude) {
  const muChild = BODY_GM[childId];
  const muParent = BODY_GM[parentId];
  const rChildBody = BODY_RADIUS[childId];
  const rChildOrbit = BODY_ORBIT_RADIUS[childId];
  const rParent = BODY_RADIUS[parentId];

  const r_depart = rChildBody + altitude;
  const v_circular_child = Math.sqrt(muChild / r_depart);
  const v_escape_child = Math.sqrt(2 * muChild / r_depart);
  const escapeDV = v_escape_child - v_circular_child;

  // Target a low orbit at the parent body.
  const minOrbitAlt = MIN_ORBIT_ALTITUDE[parentId] || 100_000;
  const rTarget = rParent + minOrbitAlt;
  const a_return = (rChildOrbit + rTarget) / 2;
  const v_at_child_dist = Math.sqrt(muParent * (2 / rChildOrbit - 1 / a_return));
  const v_child_circular_in_parent = Math.sqrt(muParent / rChildOrbit);
  const returnBurnDV = Math.abs(v_child_circular_in_parent - v_at_child_dist);

  const v_at_parent = Math.sqrt(muParent * (2 / rTarget - 1 / a_return));
  const v_circular_parent = Math.sqrt(muParent / rTarget);
  const captureDV = Math.abs(v_at_parent - v_circular_parent);

  const departureDV = escapeDV + returnBurnDV;
  const transferTime = Math.PI * Math.sqrt(a_return ** 3 / muParent);

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

/**
 * Sibling transfer — both bodies orbit the same parent (e.g. Earth → Mars).
 * Escape from departure body, Hohmann in parent frame, capture at destination.
 *
 * @param {string} fromBodyId  Departure body.
 * @param {string} toBodyId    Destination body.
 * @param {number} altitude    Departure orbit altitude (m above surface).
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }}
 */
function _siblingTransfer(fromBodyId, toBodyId, altitude) {
  const parentId = BODY_PARENT[fromBodyId];
  const muFrom = BODY_GM[fromBodyId];
  const muParent = BODY_GM[parentId];
  const rFrom = BODY_RADIUS[fromBodyId];
  const rTo = BODY_RADIUS[toBodyId];
  const muTo = BODY_GM[toBodyId];

  const rFromOrbit = BODY_ORBIT_RADIUS[fromBodyId];
  const rToOrbit = BODY_ORBIT_RADIUS[toBodyId];

  // 1. Escape from departure body.
  const r_depart = rFrom + altitude;
  const v_circular_from = Math.sqrt(muFrom / r_depart);
  const v_escape_from = Math.sqrt(2 * muFrom / r_depart);
  const escapeDV = v_escape_from - v_circular_from;

  // 2. Hohmann transfer in parent-centred frame.
  const a_transfer = (rFromOrbit + rToOrbit) / 2;
  const v_from_in_parent = Math.sqrt(muParent / rFromOrbit);
  const v_transfer_depart = Math.sqrt(muParent * (2 / rFromOrbit - 1 / a_transfer));
  const hohmannDepartDV = Math.abs(v_transfer_depart - v_from_in_parent);

  const v_transfer_arrive = Math.sqrt(muParent * (2 / rToOrbit - 1 / a_transfer));
  const v_to_in_parent = Math.sqrt(muParent / rToOrbit);
  const hohmannArriveDV = Math.abs(v_to_in_parent - v_transfer_arrive);

  // 3. Capture at destination body into low orbit.
  const minOrbitAlt = MIN_ORBIT_ALTITUDE[toBodyId] || 80_000;
  const rCapture = rTo + minOrbitAlt;
  const v_circular_to = Math.sqrt(muTo / rCapture);
  const v_escape_to = Math.sqrt(2 * muTo / rCapture);
  const captureFromEscape = v_escape_to - v_circular_to;

  const departureDV = escapeDV + hohmannDepartDV;
  const captureDV = hohmannArriveDV + captureFromEscape;
  const transferTime = Math.PI * Math.sqrt(a_transfer ** 3 / muParent);

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

/**
 * Cross-hierarchy transfer — bodies at the same depth but with different
 * parents that share a grandparent (e.g. Phobos → Moon: Mars→Sun→Earth→Moon).
 *
 * Simplified: escape child, do sibling transfer between parents, capture at dest child.
 *
 * @param {string} fromBodyId
 * @param {string} toBodyId
 * @param {number} altitude
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }|null}
 */
function _crossHierarchyTransfer(fromBodyId, toBodyId, altitude) {
  const fromParent = BODY_PARENT[fromBodyId];
  const toParent = BODY_PARENT[toBodyId];
  if (!fromParent || !toParent) return null;

  // Escape from starting body to parent.
  const escapeResult = _childToParentTransfer(fromBodyId, fromParent, altitude);
  if (!escapeResult) return null;

  // Sibling transfer between the two parents (use minimum orbit altitude at fromParent).
  const minAlt = MIN_ORBIT_ALTITUDE[fromParent] || 100_000;
  const siblingResult = _siblingTransfer(fromParent, toParent, minAlt);
  if (!siblingResult) return null;

  // Capture at destination child from parent orbit.
  const minAltTo = MIN_ORBIT_ALTITUDE[toParent] || 100_000;
  const captureResult = _parentToChildTransfer(toParent, toBodyId, minAltTo);
  if (!captureResult) return null;

  const departureDV = escapeResult.departureDV + siblingResult.departureDV;
  const captureDV = siblingResult.captureDV + captureResult.departureDV + captureResult.captureDV;
  const transferTime = escapeResult.transferTime + siblingResult.transferTime + captureResult.transferTime;

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

/**
 * Transfer from a deeper body to a shallower one (e.g. Moon → Mars).
 * Moon orbits Earth, Mars orbits Sun. Escape Moon → escape Earth → transfer to Mars.
 *
 * @param {string} fromBodyId  Deeper body (e.g. Moon).
 * @param {string} toBodyId    Shallower body (e.g. Mars).
 * @param {number} altitude
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }|null}
 */
function _deepToShallowTransfer(fromBodyId, toBodyId, altitude) {
  const fromParent = BODY_PARENT[fromBodyId];
  if (!fromParent) return null;

  // Escape from the child body.
  const escapeResult = _childToParentTransfer(fromBodyId, fromParent, altitude);
  if (!escapeResult) return null;

  // Then do the sibling transfer from parent to toBody.
  const minAlt = MIN_ORBIT_ALTITUDE[fromParent] || 100_000;
  const siblingResult = _siblingTransfer(fromParent, toBodyId, minAlt);
  if (!siblingResult) return null;

  const departureDV = escapeResult.departureDV + siblingResult.departureDV;
  const captureDV = siblingResult.captureDV;
  const transferTime = escapeResult.transferTime + siblingResult.transferTime;

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

/**
 * Transfer from a shallower body to a deeper one (e.g. Earth → Phobos).
 * Earth orbits Sun, Phobos orbits Mars. Transfer to Mars then descend to Phobos.
 *
 * @param {string} fromBodyId  Shallower body.
 * @param {string} toBodyId    Deeper body.
 * @param {number} altitude
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }|null}
 */
function _shallowToDeepTransfer(fromBodyId, toBodyId, altitude) {
  const toParent = BODY_PARENT[toBodyId];
  if (!toParent) return null;

  // Sibling transfer from this body to the target's parent.
  const siblingResult = _siblingTransfer(fromBodyId, toParent, altitude);
  if (!siblingResult) return null;

  // Then descend from the parent to the target child.
  const minAlt = MIN_ORBIT_ALTITUDE[toParent] || 80_000;
  const captureResult = _parentToChildTransfer(toParent, toBodyId, minAlt);
  if (!captureResult) return null;

  const departureDV = siblingResult.departureDV;
  const captureDV = siblingResult.captureDV + captureResult.departureDV + captureResult.captureDV;
  const transferTime = siblingResult.transferTime + captureResult.transferTime;

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

// ---------------------------------------------------------------------------
// Transfer target list
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TransferTarget
 * @property {string}  bodyId         Target celestial body ID.
 * @property {string}  name           Human-readable body name.
 * @property {number}  departureDV    Delta-v for departure burn (m/s).
 * @property {number}  captureDV      Delta-v for capture burn (m/s).
 * @property {number}  totalDV        Total delta-v budget (m/s).
 * @property {number}  transferTime   Transfer duration (seconds).
 */

/**
 * Get all reachable transfer targets from the current body, with delta-v costs.
 *
 * @param {string} bodyId     Current celestial body.
 * @param {number} altitude   Current orbital altitude (m above surface).
 * @returns {TransferTarget[]}
 */
export function getTransferTargets(bodyId, altitude) {
  const targets = [];
  const added = new Set();

  const _addTarget = (targetId) => {
    if (added.has(targetId) || targetId === bodyId) return;
    // Don't show the Sun as a transfer target (not landable / orbitale in gameplay).
    if (targetId === CelestialBody.SUN) return;
    const transfer = computeTransferDeltaV(bodyId, targetId, altitude);
    if (transfer) {
      added.add(targetId);
      targets.push({
        bodyId: targetId,
        name: _bodyName(targetId),
        departureDV: transfer.departureDV,
        captureDV: transfer.captureDV,
        totalDV: transfer.totalDV,
        transferTime: transfer.transferTime,
      });
    }
  };

  // Add child bodies (e.g. Earth → Moon).
  const children = BODY_CHILDREN[bodyId] || [];
  for (const childId of children) _addTarget(childId);

  // Add parent body.
  const parent = BODY_PARENT[bodyId];
  if (parent) _addTarget(parent);

  // Add sibling bodies (same parent, e.g. Earth → Mars).
  if (parent) {
    const siblings = BODY_CHILDREN[parent] || [];
    for (const sibId of siblings) _addTarget(sibId);
  }

  // Add bodies reachable via cross-hierarchy transfer (e.g. Moon → Mars).
  const grandparent = parent ? BODY_PARENT[parent] : null;
  if (grandparent) {
    // Siblings of parent (e.g. from Moon, parent=Earth, grandparent=Sun → Mars, Venus).
    const parentSiblings = BODY_CHILDREN[grandparent] || [];
    for (const psId of parentSiblings) {
      _addTarget(psId);
      // Also add their children (e.g. from Moon → Phobos via Mars).
      const psChildren = BODY_CHILDREN[psId] || [];
      for (const pcId of psChildren) _addTarget(pcId);
    }
  }

  // If this is a Sun-orbiting body, add children of siblings (e.g. Earth → Phobos).
  if (parent === CelestialBody.SUN) {
    const siblings = BODY_CHILDREN[parent] || [];
    for (const sibId of siblings) {
      const sibChildren = BODY_CHILDREN[sibId] || [];
      for (const scId of sibChildren) _addTarget(scId);
    }
  }

  // Sort by total delta-v (cheapest transfers first).
  targets.sort((a, b) => a.totalDV - b.totalDV);

  return targets;
}

// ---------------------------------------------------------------------------
// SOI transition detection
// ---------------------------------------------------------------------------

/**
 * Check whether the craft has left the current body's sphere of influence
 * or entered a child body's SOI.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {{ transition: boolean, newBodyId: string|null, reason: string }}
 */
export function checkSOITransition(ps, flightState) {
  const bodyId = flightState.bodyId || CelestialBody.EARTH;
  const R = BODY_RADIUS[bodyId];

  // Distance from body centre.
  const distFromCentre = Math.sqrt(ps.posX * ps.posX + (ps.posY + R) * (ps.posY + R));

  // Check escape from current body's SOI.
  const soiRadius = SOI_RADIUS[bodyId];
  if (soiRadius && distFromCentre > soiRadius) {
    const parent = BODY_PARENT[bodyId];
    if (parent) {
      return {
        transition: true,
        newBodyId: parent,
        reason: `Escaped ${_bodyName(bodyId)} SOI`,
      };
    }
  }

  // Check entry into a child body's SOI.
  // For this simplified model, we check if the craft's altitude places it
  // within the transfer window where the child body's SOI can be entered.
  const children = BODY_CHILDREN[bodyId] || [];
  for (const childId of children) {
    const childOrbitR = BODY_ORBIT_RADIUS[childId];
    const childSOI = SOI_RADIUS[childId];
    if (!childOrbitR || !childSOI) continue;

    // Check if craft is near the child body's orbital distance.
    const craftAlt = Math.max(0, ps.posY);
    const craftR = craftAlt + R;

    // Within the child body's SOI sphere (simplified: distance from Earth centre
    // is within childOrbitR ± childSOI).
    if (Math.abs(craftR - childOrbitR) < childSOI) {
      // Check velocity — must be on an escape/transfer trajectory.
      const v2 = ps.velX * ps.velX + ps.velY * ps.velY;
      const mu = BODY_GM[bodyId];
      const specificEnergy = v2 / 2 - mu / craftR;

      // If specific energy is positive (hyperbolic) or orbit extends to Moon's distance,
      // the craft is on a transfer trajectory.
      if (specificEnergy >= 0 || craftR >= childOrbitR - childSOI) {
        return {
          transition: true,
          newBodyId: childId,
          reason: `Entering ${_bodyName(childId)} SOI`,
        };
      }
    }
  }

  return { transition: false, newBodyId: null, reason: '' };
}

/**
 * Check if the craft is on an escape trajectory from the current body.
 * The specific orbital energy must be non-negative (hyperbolic/parabolic).
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string} bodyId
 * @returns {boolean}
 */
export function isEscapeTrajectory(ps, bodyId) {
  const R = BODY_RADIUS[bodyId];
  const mu = BODY_GM[bodyId];
  const r = Math.sqrt(ps.posX * ps.posX + (ps.posY + R) * (ps.posY + R));
  const v2 = ps.velX * ps.velX + ps.velY * ps.velY;
  const specificEnergy = v2 / 2 - mu / r;
  return specificEnergy >= 0;
}

// ---------------------------------------------------------------------------
// Gravitational assist calculations
// ---------------------------------------------------------------------------

/**
 * Compute the velocity change from a gravitational assist (gravity slingshot)
 * when passing through a body's gravitational field.
 *
 * Uses the hyperbolic flyby model:
 *   Turn angle δ = 2 × arcsin(1 / (1 + rₚ × v∞² / μ))
 *   where rₚ = periapsis distance, v∞ = excess velocity, μ = body GM.
 *
 * The assist changes the direction of the velocity vector by the turn angle,
 * which effectively adds or removes energy depending on the geometry.
 *
 * @param {string} bodyId       The body providing the assist.
 * @param {number} periapsisAlt Closest approach altitude above the body's surface (m).
 * @param {number} excessSpeed  Hyperbolic excess speed v∞ (m/s) — relative velocity
 *                              at "infinity" (SOI boundary).
 * @returns {{ turnAngle: number, deltaV: number, valid: boolean }}
 *   turnAngle: deflection in radians.
 *   deltaV: maximum possible delta-v gain (m/s) — actual gain depends on geometry.
 *   valid: false if periapsis is below the body surface.
 */
export function computeGravityAssist(bodyId, periapsisAlt, excessSpeed) {
  const mu = BODY_GM[bodyId];
  const R = BODY_RADIUS[bodyId];

  if (periapsisAlt < 0) {
    return { turnAngle: 0, deltaV: 0, valid: false };
  }

  const rPeriapsis = R + periapsisAlt;

  if (excessSpeed <= 0) {
    return { turnAngle: 0, deltaV: 0, valid: true };
  }

  // Hyperbolic parameter.
  const param = (rPeriapsis * excessSpeed * excessSpeed) / mu;

  // Eccentricity of the hyperbolic flyby.
  const eHyp = 1 + param;

  // Turn angle (deflection).
  const sinHalfDelta = 1 / eHyp;
  const halfDelta = Math.asin(Math.min(1, sinHalfDelta));
  const turnAngle = 2 * halfDelta;

  // Maximum delta-v: the change in velocity magnitude equals the chord of
  // the velocity vector rotated by turnAngle.
  // |Δv| = 2 × v∞ × sin(δ/2)
  const deltaV = 2 * excessSpeed * Math.sin(turnAngle / 2);

  return { turnAngle, deltaV, valid: true };
}

/**
 * Apply a gravitational assist to the physics state.
 * Rotates the velocity vector by the computed turn angle in the appropriate
 * direction based on the approach geometry.
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string}  bodyId         Assisting body.
 * @param {number}  periapsisAlt   Closest approach altitude (m).
 * @param {number}  approachAngle  Angle of approach relative to body (radians).
 * @returns {{ applied: boolean, deltaV: number }}
 */
export function applyGravityAssist(ps, bodyId, periapsisAlt, approachAngle) {
  const speed = Math.hypot(ps.velX, ps.velY);
  const assist = computeGravityAssist(bodyId, periapsisAlt, speed);

  if (!assist.valid || assist.deltaV < 1) {
    return { applied: false, deltaV: 0 };
  }

  // Rotate velocity vector by the turn angle.
  // Direction depends on which side of the body the craft passes.
  const velAngle = Math.atan2(ps.velX, ps.velY);
  const turnDirection = _determineTurnDirection(ps, bodyId, approachAngle);
  const newAngle = velAngle + assist.turnAngle * turnDirection;

  ps.velX = speed * Math.sin(newAngle);
  ps.velY = speed * Math.cos(newAngle);

  return { applied: true, deltaV: assist.deltaV };
}

// ---------------------------------------------------------------------------
// Route planning for map view
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TransferRoute
 * @property {string}   fromBodyId     Departure body.
 * @property {string}   toBodyId       Destination body.
 * @property {number}   departureDV    Required departure delta-v (m/s).
 * @property {number}   captureDV      Required capture delta-v (m/s).
 * @property {number}   totalDV        Total mission delta-v (m/s).
 * @property {number}   transferTime   Transfer duration (seconds).
 * @property {string}   burnDirection  Recommended burn direction ('PROGRADE' or 'RETROGRADE').
 * @property {string}   burnPoint      Where to burn ('periapsis' or 'apoapsis').
 * @property {{ x: number, y: number }[]}  transferPath  Path points for map rendering.
 */

/**
 * Compute a route plan for transfer from the current body to a target.
 * Provides delta-v costs, transfer time, and a simple transfer arc for
 * map view rendering.
 *
 * @param {string} fromBodyId   Current body.
 * @param {string} toBodyId     Destination body.
 * @param {number} altitude     Current orbit altitude (m above surface).
 * @param {import('./orbit.js').OrbitalElements|null} craftElements  Current orbit.
 * @returns {TransferRoute|null}
 */
export function computeTransferRoute(fromBodyId, toBodyId, altitude, craftElements) {
  const transfer = computeTransferDeltaV(fromBodyId, toBodyId, altitude);
  if (!transfer) return null;

  // Determine burn direction and point based on transfer type.
  let burnDirection;
  let burnPoint;

  const toParent = BODY_PARENT[toBodyId];
  const fromParent = BODY_PARENT[fromBodyId];

  if (toParent === fromBodyId) {
    // Transferring to a child body (e.g. Earth → Moon).
    burnDirection = 'PROGRADE';
    burnPoint = 'periapsis';
  } else if (fromParent === toBodyId) {
    // Transferring to parent (e.g. Moon → Earth).
    burnDirection = 'RETROGRADE';
    burnPoint = 'apoapsis';
  } else {
    // Sibling or cross-hierarchy: determine by relative orbital distance.
    const rFrom = BODY_ORBIT_RADIUS[fromBodyId] || 0;
    const rTo = BODY_ORBIT_RADIUS[toBodyId] || 0;
    if (rTo > rFrom) {
      burnDirection = 'PROGRADE';
      burnPoint = 'periapsis';
    } else {
      burnDirection = 'RETROGRADE';
      burnPoint = 'apoapsis';
    }
  }

  // Generate a simple transfer arc for map view rendering.
  const transferPath = _generateTransferArc(fromBodyId, toBodyId, altitude);

  // Also compute a gravity assist route if intermediate bodies exist.
  const assistInfo = _computeAssistRoute(fromBodyId, toBodyId);

  return {
    fromBodyId,
    toBodyId,
    departureDV: transfer.departureDV,
    captureDV: transfer.captureDV,
    totalDV: transfer.totalDV,
    transferTime: transfer.transferTime,
    burnDirection,
    burnPoint,
    transferPath,
    assistInfo,
  };
}

// ---------------------------------------------------------------------------
// Manoeuvre state tracking
// ---------------------------------------------------------------------------

/**
 * Determine if the craft should enter the MANOEUVRE phase.
 * Conditions: in ORBIT phase, in NORMAL control mode, and actively thrusting.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {boolean}
 */
export function shouldEnterManoeuvre(ps, flightState) {
  if (flightState.phase !== FlightPhase.ORBIT) return false;
  return isOrbitalBurnActive(ps);
}

/**
 * Determine if the craft should exit the MANOEUVRE phase back to ORBIT.
 * Conditions: in MANOEUVRE phase, no active orbital burn, and orbit is still valid.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @param {string} bodyId
 * @returns {boolean}
 */
export function shouldExitManoeuvre(ps, flightState, bodyId) {
  if (flightState.phase !== FlightPhase.MANOEUVRE) return false;
  if (isOrbitalBurnActive(ps)) return false;

  // Check if we still have a valid orbit after the burn.
  const status = checkOrbitStatus(ps.posX, ps.posY, ps.velX, ps.velY, bodyId);
  return status.valid;
}

/**
 * Determine if the craft should enter the TRANSFER phase.
 * Conditions: in ORBIT or MANOEUVRE phase, on an escape trajectory.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {boolean}
 */
export function shouldEnterTransfer(ps, flightState) {
  if (flightState.phase !== FlightPhase.ORBIT && flightState.phase !== FlightPhase.MANOEUVRE) {
    return false;
  }
  const bodyId = flightState.bodyId || CelestialBody.EARTH;
  return isEscapeTrajectory(ps, bodyId);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Determine the turn direction for a gravity assist based on approach geometry.
 * Returns +1 or -1.
 */
function _determineTurnDirection(ps, bodyId, approachAngle) {
  const R = BODY_RADIUS[bodyId];
  // Cross product of position vector and velocity vector determines
  // which side of the body the craft passes.
  const px = ps.posX;
  const py = ps.posY + R;
  const cross = px * ps.velY - py * ps.velX;
  return cross >= 0 ? 1 : -1;
}

/**
 * Generate a simple transfer arc path for map view rendering.
 * Returns Cartesian points (body-centred) tracing the transfer ellipse.
 * Works for parent→child, child→parent, and sibling transfers.
 */
function _generateTransferArc(fromBodyId, toBodyId, altitude) {
  const R = BODY_RADIUS[fromBodyId];
  const rDepart = R + altitude;
  const points = [];

  let rArrive;
  const toParent = BODY_PARENT[toBodyId];
  const fromParent = BODY_PARENT[fromBodyId];

  if (toParent === fromBodyId) {
    // Transferring outward to child body.
    rArrive = BODY_ORBIT_RADIUS[toBodyId];
  } else if (fromParent === toBodyId) {
    // Transferring inward to parent.
    rArrive = R * 2;
  } else if (fromParent && fromParent === toParent) {
    // Sibling transfer: show arc in parent-centred frame.
    // Use orbital radii of both bodies in the parent frame.
    const rFromOrbit = BODY_ORBIT_RADIUS[fromBodyId];
    const rToOrbit = BODY_ORBIT_RADIUS[toBodyId];
    return _generateSiblingArc(rFromOrbit, rToOrbit);
  } else {
    // Cross-hierarchy: approximate as a long arc.
    rArrive = (BODY_ORBIT_RADIUS[toBodyId] || R * 5);
  }

  if (!rArrive) return points;

  const a = (rDepart + rArrive) / 2;
  const e = Math.abs(rArrive - rDepart) / (rArrive + rDepart);

  const numPoints = 60;
  for (let i = 0; i <= numPoints; i++) {
    const theta = (Math.PI * i) / numPoints;
    const p = a * (1 - e * e);
    const r = p / (1 + e * Math.cos(theta));
    points.push({
      x: r * Math.cos(theta),
      y: r * Math.sin(theta),
    });
  }

  return points;
}

/**
 * Generate a transfer arc for sibling bodies in the parent-centred frame.
 * @param {number} rFrom  Orbital radius of departure body.
 * @param {number} rTo    Orbital radius of destination body.
 * @returns {{ x: number, y: number }[]}
 */
function _generateSiblingArc(rFrom, rTo) {
  const a = (rFrom + rTo) / 2;
  const e = Math.abs(rTo - rFrom) / (rTo + rFrom);
  const points = [];
  const numPoints = 60;

  for (let i = 0; i <= numPoints; i++) {
    const theta = (Math.PI * i) / numPoints;
    const p = a * (1 - e * e);
    const r = p / (1 + e * Math.cos(theta));
    points.push({
      x: r * Math.cos(theta),
      y: r * Math.sin(theta),
    });
  }
  return points;
}

/**
 * Compute potential gravity-assist flyby bodies along a transfer route.
 * Returns information about intermediate bodies that could provide
 * gravitational assists if the route passes near them.
 *
 * @param {string} fromBodyId
 * @param {string} toBodyId
 * @returns {{ bodies: Array<{ bodyId: string, name: string, potentialDV: number }> }|null}
 */
function _computeAssistRoute(fromBodyId, toBodyId) {
  const fromParent = BODY_PARENT[fromBodyId];
  const toParent = BODY_PARENT[toBodyId];

  // Find a common parent frame for the transfer.
  let commonParent = null;
  if (fromParent === toParent) commonParent = fromParent;
  else if (BODY_PARENT[fromParent] === toParent) commonParent = toParent;
  else if (BODY_PARENT[toParent] === fromParent) commonParent = fromParent;
  else if (fromParent && toParent && BODY_PARENT[fromParent] === BODY_PARENT[toParent]) {
    commonParent = BODY_PARENT[fromParent];
  }

  if (!commonParent) return null;

  // Check siblings in the common parent frame that lie between the two orbits.
  const children = BODY_CHILDREN[commonParent] || [];
  const rFrom = BODY_ORBIT_RADIUS[fromBodyId] || BODY_ORBIT_RADIUS[fromParent] || 0;
  const rTo = BODY_ORBIT_RADIUS[toBodyId] || BODY_ORBIT_RADIUS[toParent] || 0;
  const minR = Math.min(rFrom, rTo);
  const maxR = Math.max(rFrom, rTo);

  const assistBodies = [];
  for (const childId of children) {
    if (childId === fromBodyId || childId === toBodyId) continue;
    if (childId === fromParent || childId === toParent) continue;

    const childR = BODY_ORBIT_RADIUS[childId];
    if (!childR || childR <= minR || childR >= maxR) continue;

    // Estimate assist potential using a flyby at 2× body radius.
    const periAlt = BODY_RADIUS[childId];
    const excessSpeed = 5000; // Approximate 5 km/s excess (typical transfer speed).
    const assist = computeGravityAssist(childId, periAlt, excessSpeed);

    if (assist.valid && assist.deltaV > 50) {
      assistBodies.push({
        bodyId: childId,
        name: _bodyName(childId),
        potentialDV: Math.round(assist.deltaV),
      });
    }
  }

  return assistBodies.length > 0 ? { bodies: assistBodies } : null;
}

/**
 * Human-readable name for a celestial body.
 */
function _bodyName(bodyId) {
  const names = {
    SUN: 'Sun',
    MERCURY: 'Mercury',
    VENUS: 'Venus',
    EARTH: 'Earth',
    MOON: 'Moon',
    MARS: 'Mars',
    PHOBOS: 'Phobos',
    DEIMOS: 'Deimos',
  };
  return names[bodyId] || bodyId;
}

/**
 * Format a time duration in seconds to a human-readable string.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatTransferTime(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hr`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

/**
 * Format delta-v in m/s to a compact display string.
 *
 * @param {number} dv  Delta-v in m/s.
 * @returns {string}
 */
export function formatDeltaV(dv) {
  if (dv >= 1000) return `${(dv / 1000).toFixed(1)} km/s`;
  return `${Math.round(dv)} m/s`;
}
