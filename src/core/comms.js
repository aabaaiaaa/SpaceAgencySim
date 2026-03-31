/**
 * comms.js — Communication range system.
 *
 * Determines whether a craft has a communication link back to the agency,
 * and if so, what type of link.  The comms status affects gameplay:
 *
 *   - CONNECTED: Full control (probe or crewed).
 *   - NO_SIGNAL + probe-only: Craft can reach stable orbit, then controls
 *     are locked.  Player can return to agency via game menu.  If the craft
 *     later orbits into a position where comms are restored, control returns.
 *   - NO_SIGNAL + crewed: Full control continues, but science data cannot
 *     be transmitted (must be physically returned).
 *
 * LINK TYPES (checked in priority order)
 * =======================================
 *   1. ONBOARD_RELAY — craft carries a relay antenna; self-sustaining.
 *   2. DIRECT — line-of-sight to agency hub on Earth (short range).
 *   3. TRACKING_STATION — Tracking Station T3 extends direct range significantly.
 *   4. LOCAL_NETWORK — comm-sat constellation around the current body provides
 *      coverage.  Fewer than 3 sats = dark spots on the far side.
 *   5. RELAY — interplanetary relay chain via deployed RELAY satellites.
 *   6. NONE — no link available.
 *
 * @module core/comms
 */

import {
  CommsStatus,
  CommsLinkType,
  COMMS_DIRECT_RANGE,
  COMMS_TRACKING_T3_RANGE,
  COMMS_LOCAL_NETWORK_RANGE,
  COMMS_FULL_COVERAGE_THRESHOLD,
  COMMS_RELAY_RANGE,
  COMMS_SHADOW_HALF_ANGLE_DEG,
  SatelliteType,
  CelestialBody,
  BODY_RADIUS,
  FacilityId,
  FlightPhase,
} from './constants.js';
import { hasFacility, getFacilityTier } from './construction.js';
import { getActiveSatellites, getSatellitesByType, countSatellitesByType } from './satellites.js';
import { BODY_PARENT, BODY_CHILDREN, BODY_ORBIT_RADIUS } from './manoeuvre.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Comms State
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CommsState
 * @property {string}  status        - CommsStatus value.
 * @property {string}  linkType      - CommsLinkType value.
 * @property {boolean} canTransmit   - Whether science data can be transmitted.
 * @property {boolean} controlLocked - Whether craft controls are locked (probe-only + NO_SIGNAL).
 */

/**
 * Create a default comms state (connected, full control).
 * @returns {CommsState}
 */
export function createCommsState() {
  return {
    status: CommsStatus.CONNECTED,
    linkType: CommsLinkType.DIRECT,
    canTransmit: true,
    controlLocked: false,
  };
}

// ---------------------------------------------------------------------------
// Core evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate the current communication status of the active flight.
 *
 * Called each frame (or at key events) to update the comms state.
 * Returns a new CommsState object describing the link.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {{ altitude?: number, posX?: number, posY?: number }} [craftPos]
 *   Optional craft position info from physics state.
 * @returns {CommsState}
 */
export function evaluateComms(state, flightState, craftPos) {
  // During pre-launch and launch, always connected (on the pad / near Earth).
  if (flightState.phase === FlightPhase.PRELAUNCH ||
      flightState.phase === FlightPhase.LAUNCH) {
    return {
      status: CommsStatus.CONNECTED,
      linkType: CommsLinkType.DIRECT,
      canTransmit: true,
      controlLocked: false,
    };
  }

  const bodyId = flightState.bodyId || CelestialBody.EARTH;
  const altitude = craftPos?.altitude ?? flightState.altitude ?? 0;
  const isCrewed = (flightState.crewIds?.length ?? 0) > 0;

  // Check link types in priority order.
  const linkType = _resolveLink(state, flightState, bodyId, altitude, craftPos);

  const connected = linkType !== CommsLinkType.NONE;

  return {
    status: connected ? CommsStatus.CONNECTED : CommsStatus.NO_SIGNAL,
    linkType,
    canTransmit: connected,
    // Probe-only + no signal = controls locked (unless in FLIGHT phase descending).
    controlLocked: !connected && !isCrewed && _isOrbitalPhase(flightState.phase),
  };
}

/**
 * Check if a craft is crewed (has crew aboard).
 *
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {boolean}
 */
export function isCrewedCraft(flightState) {
  return (flightState.crewIds?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Link resolution (internal)
// ---------------------------------------------------------------------------

/**
 * Determine the best available link type for the craft.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState
 * @param {string} bodyId
 * @param {number} altitude  Metres above surface.
 * @param {{ posX?: number, posY?: number }} [craftPos]
 * @returns {string}  CommsLinkType value.
 */
function _resolveLink(state, flightState, bodyId, altitude, craftPos) {
  // 1. Onboard relay antenna — craft carries its own relay; always connected.
  if (_hasOnboardRelay(state, flightState)) {
    return CommsLinkType.ONBOARD_RELAY;
  }

  // 2. Direct comms to agency hub on Earth.
  if (bodyId === CelestialBody.EARTH) {
    const dist = BODY_RADIUS[CelestialBody.EARTH] + altitude;
    if (dist <= COMMS_DIRECT_RANGE) {
      return CommsLinkType.DIRECT;
    }
    // 3. Tracking Station T3 extends direct range.
    if (_hasTrackingStationT3(state) && dist <= COMMS_TRACKING_T3_RANGE) {
      return CommsLinkType.TRACKING_STATION;
    }
  }

  // 4. Local comm-sat network around the current body.
  if (_hasLocalCoverage(state, bodyId, altitude, craftPos)) {
    // If this body's network can link back to Earth (directly or via relays), we're good.
    if (_canBodyLinkToEarth(state, bodyId)) {
      return CommsLinkType.LOCAL_NETWORK;
    }
  }

  // 5. Relay chain — check if deployed RELAY satellites can bridge to Earth.
  if (_hasRelayChain(state, bodyId)) {
    // Even without local coverage, if the craft is within range of a relay sat
    // at this body, it can link through.
    if (_hasLocalCoverage(state, bodyId, altitude, craftPos) ||
        _isWithinRelaySatRange(state, bodyId, altitude)) {
      return CommsLinkType.RELAY;
    }
  }

  // 6. During transfer — check if origin or destination has relay coverage.
  if (flightState.transferState) {
    const { originBodyId, destinationBodyId } = flightState.transferState;
    if (_canBodyLinkToEarth(state, originBodyId) || _canBodyLinkToEarth(state, destinationBodyId)) {
      // If there are relay sats at either end, the interplanetary link works.
      if (_hasRelaySatsAtBody(state, originBodyId) || _hasRelaySatsAtBody(state, destinationBodyId)) {
        return CommsLinkType.RELAY;
      }
    }
  }

  // 6. No link.
  return CommsLinkType.NONE;
}

// ---------------------------------------------------------------------------
// Link helpers
// ---------------------------------------------------------------------------

/**
 * Check if the craft carries an onboard relay antenna.
 * A craft with a relay-antenna part maintains its own connection.
 */
function _hasOnboardRelay(state, flightState) {
  if (!flightState.rocketId) return false;
  // Look up the rocket design.
  const rocket = state.rockets?.find(r => r.id === flightState.rocketId);
  if (!rocket?.parts) return false;

  for (const rocketPart of rocket.parts) {
    const partDef = getPartById(rocketPart.partId);
    if (!partDef) continue;
    if (partDef.properties?.relayAntenna || partDef.properties?.deepSpaceComms) {
      return true;
    }
  }
  return false;
}

/**
 * Check if the Tracking Station is built and at Tier 3.
 */
function _hasTrackingStationT3(state) {
  return hasFacility(state, FacilityId.TRACKING_STATION) &&
         getFacilityTier(state, FacilityId.TRACKING_STATION) >= 3;
}

/**
 * Check if a body has local comm-sat coverage for the craft's position.
 *
 * If the body has 3+ COMMUNICATION satellites (full constellation),
 * coverage is complete — no dark spots.
 *
 * If fewer than 3, the far side of the body (relative to the signal source
 * direction) is a dead zone. We approximate this by checking if the craft
 * is on the far hemisphere.
 */
function _hasLocalCoverage(state, bodyId, altitude, craftPos) {
  const commSatCount = countSatellitesByType(state, SatelliteType.COMMUNICATION);

  // Filter to satellites at this specific body.
  const localCommSats = getSatellitesByType(state, SatelliteType.COMMUNICATION)
    .filter(s => s.bodyId === bodyId);

  if (localCommSats.length === 0) return false;

  const dist = BODY_RADIUS[bodyId] + altitude;
  if (dist > COMMS_LOCAL_NETWORK_RANGE) return false;

  // Full constellation — complete coverage.
  if (localCommSats.length >= COMMS_FULL_COVERAGE_THRESHOLD) {
    return true;
  }

  // Partial coverage — check for dark spots.
  // Without full constellation, the far side of the body is unreachable.
  // Use the craft's angular position relative to the signal source.
  if (craftPos && (craftPos.posX !== undefined) && (craftPos.posY !== undefined)) {
    return !_isInShadowZone(craftPos, bodyId);
  }

  // If no position info, assume coverage if in orbit (generous assumption).
  return true;
}

/**
 * Check if the craft is in the communication shadow zone behind a body.
 * The shadow zone is the hemisphere opposite the signal source direction.
 *
 * For simplicity, the signal direction is modelled as coming from the
 * "Earth side" — positive Y axis in the body-centred frame for Earth,
 * or the direction toward the parent body/Sun for other bodies.
 */
function _isInShadowZone(craftPos, bodyId) {
  const R = BODY_RADIUS[bodyId];
  if (!R) return false;

  // Craft position relative to body centre.
  const cx = craftPos.posX || 0;
  const cy = (craftPos.posY || 0) + R; // posY is surface-relative; body centre is at (0, -R).

  const dist = Math.sqrt(cx * cx + cy * cy);
  if (dist < R) return false; // Inside the body — not relevant.

  // The shadow cone is behind the body, opposite the signal source.
  // For any body: signal comes roughly from the direction of the parent body.
  // We use a simple angular test: if the craft is within the shadow half-angle
  // on the far side, it's blocked.
  const shadowRad = (COMMS_SHADOW_HALF_ANGLE_DEG * Math.PI) / 180;

  // Angle of craft from body centre (0 = +Y direction = "signal source side").
  const craftAngle = Math.atan2(cx, cy);

  // Shadow is centred at angle π (opposite side).
  const angDiff = Math.abs(_normalizeAngle(craftAngle - Math.PI));

  return angDiff < shadowRad;
}

/**
 * Normalize an angle to [-π, π].
 */
function _normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Check if a body's communication network can link back to Earth.
 * A body links to Earth if:
 *   - It IS Earth.
 *   - It's in the Earth system (Moon).
 *   - It has relay satellites that can reach Earth's network.
 */
function _canBodyLinkToEarth(state, bodyId) {
  if (bodyId === CelestialBody.EARTH) return true;

  // Moon is within Earth's SOI — direct link if Earth has infrastructure.
  if (bodyId === CelestialBody.MOON) {
    // Moon links to Earth if: Tracking Station T3 (covers lunar distance)
    // or Earth has comm-sats.
    if (_hasTrackingStationT3(state)) return true;
    const earthCommSats = getSatellitesByType(state, SatelliteType.COMMUNICATION)
      .filter(s => s.bodyId === CelestialBody.EARTH);
    return earthCommSats.length > 0;
  }

  // Other bodies — need a relay chain.
  return _hasRelayChain(state, bodyId);
}

/**
 * Check if there's a relay satellite chain from a body back to Earth.
 *
 * Relay chain logic:
 *   - If the body has RELAY satellites, check if those relay sats can reach
 *     a body that is itself connected to Earth.
 *   - Walk the chain: bodyId → parent → ... → Earth.
 */
function _hasRelayChain(state, bodyId) {
  if (bodyId === CelestialBody.EARTH) return true;

  const visited = new Set();
  return _walkRelayChain(state, bodyId, visited);
}

function _walkRelayChain(state, bodyId, visited) {
  if (bodyId === CelestialBody.EARTH) return true;
  if (visited.has(bodyId)) return false;
  visited.add(bodyId);

  // Check if this body has relay satellites.
  if (!_hasRelaySatsAtBody(state, bodyId)) return false;

  // Check connected bodies within relay range.
  const connectedBodies = _getBodiesWithinRelayRange(bodyId);
  for (const nextBody of connectedBodies) {
    // The next body must also have relay sats or be Earth.
    if (nextBody === CelestialBody.EARTH) return true;
    if (_hasRelaySatsAtBody(state, nextBody)) {
      if (_walkRelayChain(state, nextBody, visited)) return true;
    }
    // Also check if the next body has tracking station coverage (Earth's network).
    if (nextBody === CelestialBody.EARTH) return true;
  }

  return false;
}

/**
 * Check if a body has deployed RELAY satellites.
 */
function _hasRelaySatsAtBody(state, bodyId) {
  return getSatellitesByType(state, SatelliteType.RELAY)
    .filter(s => s.bodyId === bodyId).length > 0;
}

/**
 * Check if a craft is within range of relay satellites at its body.
 */
function _isWithinRelaySatRange(state, bodyId, altitude) {
  const relaySats = getSatellitesByType(state, SatelliteType.RELAY)
    .filter(s => s.bodyId === bodyId);
  if (relaySats.length === 0) return false;

  // Relay sats at this body cover the entire local space.
  const dist = BODY_RADIUS[bodyId] + altitude;
  return dist <= COMMS_LOCAL_NETWORK_RANGE;
}

/**
 * Get celestial bodies within relay range of a given body.
 * Uses orbital distances to determine proximity.
 */
function _getBodiesWithinRelayRange(bodyId) {
  const result = [];
  const parent = BODY_PARENT[bodyId];

  // Children are always within range.
  const children = BODY_CHILDREN[bodyId] || [];
  for (const child of children) {
    result.push(child);
  }

  // Parent is within range if orbital distance < relay range.
  if (parent) {
    result.push(parent);
    // Siblings (other children of the same parent) within relay range.
    const siblings = BODY_CHILDREN[parent] || [];
    for (const sibling of siblings) {
      if (sibling === bodyId) continue;
      const myOrbit = BODY_ORBIT_RADIUS[bodyId] || 0;
      const sibOrbit = BODY_ORBIT_RADIUS[sibling] || 0;
      // Use minimum orbital distance (when bodies are closest) for relay feasibility.
      // Relay links represent the capability to connect, not continuous real-time comms.
      const minDist = Math.abs(myOrbit - sibOrbit);
      if (minDist <= COMMS_RELAY_RANGE) {
        result.push(sibling);
      }
    }
  }

  return result;
}

/**
 * Check whether a flight phase is an "orbital" phase where comms lockout applies.
 * During FLIGHT phase (descent), controls remain even for probes — they need
 * to land safely.
 */
function _isOrbitalPhase(phase) {
  return phase === FlightPhase.ORBIT ||
         phase === FlightPhase.MANOEUVRE ||
         phase === FlightPhase.TRANSFER ||
         phase === FlightPhase.CAPTURE;
}

// ---------------------------------------------------------------------------
// Map overlay helpers
// ---------------------------------------------------------------------------

/**
 * Compute comms coverage zones for the map view overlay.
 *
 * Returns coverage arcs/zones for rendering on the map.
 * Each zone is a region around the body where comms are available.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} bodyId  Body being viewed on the map.
 * @returns {{
 *   hasDirectCoverage: boolean,
 *   directRange: number,
 *   hasLocalNetwork: boolean,
 *   localNetworkRange: number,
 *   fullCoverage: boolean,
 *   shadowAngleDeg: number,
 *   hasRelayCoverage: boolean,
 *   relayRange: number,
 *   connectedToEarth: boolean,
 * }}
 */
export function getCommsCoverageInfo(state, bodyId) {
  const isEarth = bodyId === CelestialBody.EARTH;

  // Direct coverage (Earth only).
  let hasDirectCoverage = false;
  let directRange = 0;
  if (isEarth) {
    hasDirectCoverage = true;
    directRange = COMMS_DIRECT_RANGE;
    if (_hasTrackingStationT3(state)) {
      directRange = COMMS_TRACKING_T3_RANGE;
    }
  }

  // Local comm-sat network.
  const localCommSats = getSatellitesByType(state, SatelliteType.COMMUNICATION)
    .filter(s => s.bodyId === bodyId);
  const hasLocalNetwork = localCommSats.length > 0;
  const fullCoverage = localCommSats.length >= COMMS_FULL_COVERAGE_THRESHOLD;
  const localNetworkRange = hasLocalNetwork ? COMMS_LOCAL_NETWORK_RANGE : 0;

  // Relay coverage.
  const hasRelayCoverage = _hasRelaySatsAtBody(state, bodyId);
  const relayRange = hasRelayCoverage ? COMMS_RELAY_RANGE : 0;

  // Whether this body is ultimately connected to Earth.
  const connectedToEarth = _canBodyLinkToEarth(state, bodyId);

  return {
    hasDirectCoverage,
    directRange,
    hasLocalNetwork,
    localNetworkRange,
    fullCoverage,
    shadowAngleDeg: fullCoverage ? 0 : COMMS_SHADOW_HALF_ANGLE_DEG,
    hasRelayCoverage,
    relayRange,
    connectedToEarth,
  };
}

/**
 * Get a human-readable label for the current comms link type.
 *
 * @param {string} linkType  CommsLinkType value.
 * @returns {string}
 */
export function getCommsLinkLabel(linkType) {
  switch (linkType) {
    case CommsLinkType.DIRECT:            return 'Direct Link';
    case CommsLinkType.TRACKING_STATION:  return 'Tracking Station';
    case CommsLinkType.LOCAL_NETWORK:     return 'Comm-Sat Network';
    case CommsLinkType.RELAY:             return 'Relay Chain';
    case CommsLinkType.ONBOARD_RELAY:     return 'Onboard Relay';
    case CommsLinkType.NONE:              return 'No Signal';
    default:                              return 'Unknown';
  }
}
