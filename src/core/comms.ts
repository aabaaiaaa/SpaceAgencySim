/**
 * comms.ts — Communication range system.
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
 */

import {
  CommsStatus, CommsLinkType, COMMS_DIRECT_RANGE, COMMS_TRACKING_T3_RANGE,
  COMMS_LOCAL_NETWORK_RANGE, COMMS_FULL_COVERAGE_THRESHOLD, COMMS_RELAY_RANGE,
  COMMS_SHADOW_HALF_ANGLE_DEG, SatelliteType, CelestialBody, BODY_RADIUS,
  FacilityId, FlightPhase,
} from './constants.js';
import { hasFacility, getFacilityTier } from './construction.js';
import { getSatellitesByType } from './satellites.js';
import { BODY_PARENT, BODY_CHILDREN, BODY_ORBIT_RADIUS } from './manoeuvre.js';
import { getPartById } from '../data/parts.js';
import type { GameState, FlightState, CommsState } from './gameState.js';

interface CraftPos { altitude?: number; posX?: number; posY?: number; }

export interface CommsCoverageInfo {
  hasDirectCoverage: boolean; directRange: number; hasLocalNetwork: boolean;
  localNetworkRange: number; fullCoverage: boolean; shadowAngleDeg: number;
  hasRelayCoverage: boolean; relayRange: number; connectedToEarth: boolean;
}

export function createCommsState(): CommsState {
  return { status: CommsStatus.CONNECTED, linkType: CommsLinkType.DIRECT, canTransmit: true, controlLocked: false };
}

export function evaluateComms(state: GameState, flightState: FlightState, craftPos?: CraftPos): CommsState {
  if (flightState.phase === FlightPhase.PRELAUNCH || flightState.phase === FlightPhase.LAUNCH) {
    return { status: CommsStatus.CONNECTED, linkType: CommsLinkType.DIRECT, canTransmit: true, controlLocked: false };
  }
  const bodyId = flightState.bodyId || CelestialBody.EARTH;
  const altitude = craftPos?.altitude ?? flightState.altitude ?? 0;
  const isCrewed = (flightState.crewIds?.length ?? 0) > 0;
  const linkType = _resolveLink(state, flightState, bodyId, altitude, craftPos);
  const connected = linkType !== CommsLinkType.NONE;
  return {
    status: connected ? CommsStatus.CONNECTED : CommsStatus.NO_SIGNAL, linkType,
    canTransmit: connected, controlLocked: !connected && !isCrewed && _isOrbitalPhase(flightState.phase),
  };
}

export function isCrewedCraft(flightState: FlightState): boolean {
  return (flightState.crewIds?.length ?? 0) > 0;
}

function _resolveLink(state: GameState, flightState: FlightState, bodyId: string, altitude: number, craftPos?: CraftPos): string {
  if (_hasOnboardRelay(state, flightState)) return CommsLinkType.ONBOARD_RELAY;
  if (bodyId === CelestialBody.EARTH) {
    const dist = BODY_RADIUS[CelestialBody.EARTH] + altitude;
    if (dist <= COMMS_DIRECT_RANGE) return CommsLinkType.DIRECT;
    if (_hasTrackingStationT3(state) && dist <= COMMS_TRACKING_T3_RANGE) return CommsLinkType.TRACKING_STATION;
  }
  if (_hasLocalCoverage(state, bodyId, altitude, craftPos) && _canBodyLinkToEarth(state, bodyId)) return CommsLinkType.LOCAL_NETWORK;
  if (_hasRelayChain(state, bodyId) && (_hasLocalCoverage(state, bodyId, altitude, craftPos) || _isWithinRelaySatRange(state, bodyId, altitude))) return CommsLinkType.RELAY;
  if (flightState.transferState) {
    const { originBodyId, destinationBodyId } = flightState.transferState;
    if ((_canBodyLinkToEarth(state, originBodyId) || _canBodyLinkToEarth(state, destinationBodyId)) &&
        (_hasRelaySatsAtBody(state, originBodyId) || _hasRelaySatsAtBody(state, destinationBodyId))) return CommsLinkType.RELAY;
  }
  return CommsLinkType.NONE;
}

function _hasOnboardRelay(state: GameState, flightState: FlightState): boolean {
  if (!flightState.rocketId) return false;
  const rocket = state.rockets?.find(r => r.id === flightState.rocketId);
  if (!rocket?.parts) return false;
  for (const rocketPart of rocket.parts) {
    const partDef = getPartById(rocketPart.partId);
    if (!partDef) continue;
    if ((partDef.properties as any)?.relayAntenna || (partDef.properties as any)?.deepSpaceComms) return true;
  }
  return false;
}

function _hasTrackingStationT3(state: GameState): boolean {
  return hasFacility(state, FacilityId.TRACKING_STATION) && getFacilityTier(state, FacilityId.TRACKING_STATION) >= 3;
}

function _hasLocalCoverage(state: GameState, bodyId: string, altitude: number, craftPos?: CraftPos): boolean {
  const localCommSats = getSatellitesByType(state, SatelliteType.COMMUNICATION).filter((s: any) => s.bodyId === bodyId);
  if (localCommSats.length === 0) return false;
  if (BODY_RADIUS[bodyId] + altitude > COMMS_LOCAL_NETWORK_RANGE) return false;
  if (localCommSats.length >= COMMS_FULL_COVERAGE_THRESHOLD) return true;
  if (craftPos && craftPos.posX !== undefined && craftPos.posY !== undefined)
    return !_isInShadowZone(craftPos as { posX: number; posY: number }, bodyId);
  return true;
}

function _isInShadowZone(craftPos: { posX: number; posY: number }, bodyId: string): boolean {
  const R = BODY_RADIUS[bodyId];
  if (!R) return false;
  const cx = craftPos.posX || 0;
  const cy = (craftPos.posY || 0) + R;
  const dist = Math.sqrt(cx * cx + cy * cy);
  if (dist < R) return false;
  const shadowRad = (COMMS_SHADOW_HALF_ANGLE_DEG * Math.PI) / 180;
  const craftAngle = Math.atan2(cx, cy);
  return Math.abs(_normalizeAngle(craftAngle - Math.PI)) < shadowRad;
}

function _normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function _canBodyLinkToEarth(state: GameState, bodyId: string): boolean {
  if (bodyId === CelestialBody.EARTH) return true;
  if (bodyId === CelestialBody.MOON) {
    if (_hasTrackingStationT3(state)) return true;
    return getSatellitesByType(state, SatelliteType.COMMUNICATION).filter((s: any) => s.bodyId === CelestialBody.EARTH).length > 0;
  }
  return _hasRelayChain(state, bodyId);
}

function _hasRelayChain(state: GameState, bodyId: string): boolean {
  if (bodyId === CelestialBody.EARTH) return true;
  return _walkRelayChain(state, bodyId, new Set<string>());
}

function _walkRelayChain(state: GameState, bodyId: string, visited: Set<string>): boolean {
  if (bodyId === CelestialBody.EARTH) return true;
  if (visited.has(bodyId)) return false;
  visited.add(bodyId);
  if (!_hasRelaySatsAtBody(state, bodyId)) return false;
  for (const nextBody of _getBodiesWithinRelayRange(bodyId)) {
    if (nextBody === CelestialBody.EARTH) return true;
    if (_hasRelaySatsAtBody(state, nextBody) && _walkRelayChain(state, nextBody, visited)) return true;
  }
  return false;
}

function _hasRelaySatsAtBody(state: GameState, bodyId: string): boolean {
  return getSatellitesByType(state, SatelliteType.RELAY).filter((s: any) => s.bodyId === bodyId).length > 0;
}

function _isWithinRelaySatRange(state: GameState, bodyId: string, altitude: number): boolean {
  if (getSatellitesByType(state, SatelliteType.RELAY).filter((s: any) => s.bodyId === bodyId).length === 0) return false;
  return BODY_RADIUS[bodyId] + altitude <= COMMS_LOCAL_NETWORK_RANGE;
}

function _getBodiesWithinRelayRange(bodyId: string): string[] {
  const result: string[] = [];
  const parent = (BODY_PARENT as Record<string, string | null>)[bodyId];
  const children: readonly string[] = (BODY_CHILDREN as Record<string, readonly string[]>)[bodyId] || [];
  for (const child of children) result.push(child);
  if (parent) {
    result.push(parent);
    const siblings: readonly string[] = (BODY_CHILDREN as Record<string, readonly string[]>)[parent] || [];
    for (const sibling of siblings) {
      if (sibling === bodyId) continue;
      const myOrbit = (BODY_ORBIT_RADIUS as Record<string, number>)[bodyId] || 0;
      const sibOrbit = (BODY_ORBIT_RADIUS as Record<string, number>)[sibling] || 0;
      if (Math.abs(myOrbit - sibOrbit) <= COMMS_RELAY_RANGE) result.push(sibling);
    }
  }
  return result;
}

function _isOrbitalPhase(phase: FlightPhase): boolean {
  return phase === FlightPhase.ORBIT || phase === FlightPhase.MANOEUVRE || phase === FlightPhase.TRANSFER || phase === FlightPhase.CAPTURE;
}

export function getCommsCoverageInfo(state: GameState, bodyId: string): CommsCoverageInfo {
  const isEarth = bodyId === CelestialBody.EARTH;
  let hasDirectCoverage = false, directRange = 0;
  if (isEarth) { hasDirectCoverage = true; directRange = _hasTrackingStationT3(state) ? COMMS_TRACKING_T3_RANGE : COMMS_DIRECT_RANGE; }
  const localCommSats = getSatellitesByType(state, SatelliteType.COMMUNICATION).filter((s: any) => s.bodyId === bodyId);
  const hasLocalNetwork = localCommSats.length > 0;
  const fullCoverage = localCommSats.length >= COMMS_FULL_COVERAGE_THRESHOLD;
  const hasRelayCoverage = _hasRelaySatsAtBody(state, bodyId);
  return {
    hasDirectCoverage, directRange, hasLocalNetwork,
    localNetworkRange: hasLocalNetwork ? COMMS_LOCAL_NETWORK_RANGE : 0,
    fullCoverage, shadowAngleDeg: fullCoverage ? 0 : COMMS_SHADOW_HALF_ANGLE_DEG,
    hasRelayCoverage, relayRange: hasRelayCoverage ? COMMS_RELAY_RANGE : 0,
    connectedToEarth: _canBodyLinkToEarth(state, bodyId),
  };
}

export function getCommsLinkLabel(linkType: string): string {
  switch (linkType) {
    case CommsLinkType.DIRECT: return 'Direct Link';
    case CommsLinkType.TRACKING_STATION: return 'Tracking Station';
    case CommsLinkType.LOCAL_NETWORK: return 'Comm-Sat Network';
    case CommsLinkType.RELAY: return 'Relay Chain';
    case CommsLinkType.ONBOARD_RELAY: return 'Onboard Relay';
    case CommsLinkType.NONE: return 'No Signal';
    default: return 'Unknown';
  }
}
