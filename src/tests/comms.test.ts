import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, createFlightState } from '../core/gameState.ts';
import type { GameState, FlightState, OrbitalElements, RocketDesign, TransferState } from '../core/gameState.ts';
import {
  evaluateComms,
  createCommsState,
  getCommsCoverageInfo,
  getCommsLinkLabel,
  isCrewedCraft,
} from '../core/comms.ts';
import {
  CommsStatus,
  CommsLinkType,
  COMMS_DIRECT_RANGE,
  COMMS_TRACKING_T3_RANGE,
  FacilityId,
  FlightPhase,
  CelestialBody,
  BODY_RADIUS,
} from '../core/constants.ts';
import { deploySatellite } from '../core/satellites.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  const state = createGameState();
  state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 1 };
  return state;
}

function flightAt(bodyId: CelestialBody, phase: FlightPhase, crewIds: string[] = [], rocketId: string = 'r1'): FlightState {
  const fs = createFlightState({ missionId: 'm1', rocketId, crewIds });
  fs.bodyId = bodyId;
  fs.phase = phase;
  return fs;
}

const LEO_ELEMENTS: OrbitalElements = {
  semiMajorAxis: BODY_RADIUS.EARTH + 150_000,
  eccentricity: 0.001,
  argPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
};

const MOON_ELEMENTS: OrbitalElements = {
  semiMajorAxis: BODY_RADIUS.MOON + 50_000,
  eccentricity: 0.001,
  argPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
};

const MARS_ELEMENTS: OrbitalElements = {
  semiMajorAxis: BODY_RADIUS.MARS + 150_000,
  eccentricity: 0.001,
  argPeriapsis: 0,
  meanAnomalyAtEpoch: 0,
  epoch: 0,
};

function deployCommSats(state: GameState, bodyId: string, count: number, elements: OrbitalElements): void {
  for (let i = 0; i < count; i++) {
    const alt = elements.semiMajorAxis - BODY_RADIUS[bodyId];
    deploySatellite(state, {
      partId: 'satellite-comm',
      bodyId,
      elements: { ...elements, meanAnomalyAtEpoch: (i * 2 * Math.PI) / count },
      altitude: alt,
    });
  }
}

function deployRelaySats(state: GameState, bodyId: string, count: number): void {
  const R = BODY_RADIUS[bodyId];
  const altMap: Record<string, number> = { EARTH: 5_000_000, MARS: 5_000_000, MOON: 2_000_000, MERCURY: 2_000_000, VENUS: 5_000_000 };
  const alt = altMap[bodyId] || 5_000_000;
  const elements: OrbitalElements = {
    semiMajorAxis: R + alt,
    eccentricity: 0.001,
    argPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  };
  for (let i = 0; i < count; i++) {
    deploySatellite(state, {
      partId: 'satellite-relay',
      bodyId,
      elements: { ...elements, meanAnomalyAtEpoch: (i * 2 * Math.PI) / count },
      altitude: alt,
    });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('comms — createCommsState', () => {
  it('returns a connected state by default', () => {
    const cs = createCommsState();
    expect(cs.status).toBe(CommsStatus.CONNECTED);
    expect(cs.linkType).toBe(CommsLinkType.DIRECT);
    expect(cs.canTransmit).toBe(true);
    expect(cs.controlLocked).toBe(false);
  });
});

describe('comms — isCrewedCraft', () => {
  it('returns true when crew is aboard', () => {
    const fs = flightAt('EARTH', FlightPhase.ORBIT, ['crew-1']);
    expect(isCrewedCraft(fs)).toBe(true);
  });

  it('returns false for probe-only craft', () => {
    const fs = flightAt('EARTH', FlightPhase.ORBIT, []);
    expect(isCrewedCraft(fs)).toBe(false);
  });
});

describe('comms — evaluateComms on prelaunch/launch', () => {
  it('always returns CONNECTED during PRELAUNCH', () => {
    const state = freshState();
    const fs = flightAt('EARTH', FlightPhase.PRELAUNCH);
    const result = evaluateComms(state, fs);
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.DIRECT);
  });

  it('always returns CONNECTED during LAUNCH', () => {
    const state = freshState();
    const fs = flightAt('EARTH', FlightPhase.LAUNCH);
    const result = evaluateComms(state, fs);
    expect(result.status).toBe(CommsStatus.CONNECTED);
  });
});

describe('comms — direct link (Earth orbit)', () => {
  it('connects in LEO via direct link', () => {
    const state = freshState();
    const fs = flightAt('EARTH', FlightPhase.ORBIT);
    // LEO altitude: 150 km = 150_000 m.  distance = R + 150_000 ≈ 6.5M m < 40M m.
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.DIRECT);
    expect(result.controlLocked).toBe(false);
  });

  it('loses direct link beyond direct range', () => {
    const state = freshState();
    const fs = flightAt('EARTH', FlightPhase.ORBIT);
    // Distance = R + altitude must exceed COMMS_DIRECT_RANGE (40M m).
    // altitude = 40M - R + 1 = 33_629_001.
    const farAlt = COMMS_DIRECT_RANGE - BODY_RADIUS.EARTH + 1;
    const result = evaluateComms(state, fs, { altitude: farAlt, posX: 0, posY: 0 });
    expect(result.linkType).not.toBe(CommsLinkType.DIRECT);
  });
});

describe('comms — Tracking Station T3 extends range', () => {
  it('extends range to lunar distance when T3 is built', () => {
    const state = freshState();
    state.hubs[0].facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 3 };
    const fs = flightAt('EARTH', FlightPhase.ORBIT);
    // Altitude that exceeds direct range but within T3 range.
    const midAlt = COMMS_DIRECT_RANGE; // distance = R + COMMS_DIRECT_RANGE > direct but < T3
    const result = evaluateComms(state, fs, { altitude: midAlt, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.TRACKING_STATION);
  });

  it('does not extend range if only Tier 2', () => {
    const state = freshState();
    state.hubs[0].facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 2 };
    const fs = flightAt('EARTH', FlightPhase.ORBIT);
    const midAlt = COMMS_DIRECT_RANGE; // beyond direct range
    const result = evaluateComms(state, fs, { altitude: midAlt, posX: 0, posY: 0 });
    expect(result.linkType).not.toBe(CommsLinkType.TRACKING_STATION);
  });
});

describe('comms — local comm-sat network', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
  });

  it('provides coverage at Moon with comm-sats deployed', () => {
    deployCommSats(state, 'MOON', 3, MOON_ELEMENTS);
    const fs = flightAt('MOON', FlightPhase.ORBIT);
    // Moon comm-sats + Tracking Station T3 for Earth link.
    state.hubs[0].facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 3 };
    const result = evaluateComms(state, fs, { altitude: 50_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.LOCAL_NETWORK);
  });

  it('has NO_SIGNAL at Moon without comm-sats or relay', () => {
    const fs = flightAt('MOON', FlightPhase.ORBIT);
    const result = evaluateComms(state, fs, { altitude: 50_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.NO_SIGNAL);
    expect(result.linkType).toBe(CommsLinkType.NONE);
  });
});

describe('comms — relay chain', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
  });

  it('connects via relay chain from Mars through Earth relay sats', () => {
    // Increase sat ops capacity to accommodate all deployments.
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    // Deploy relay sats at both Earth and Mars.
    deployRelaySats(state, 'EARTH', 1);
    deployRelaySats(state, 'MARS', 1);
    // Deploy comm-sats at Mars for local coverage.
    deployCommSats(state, 'MARS', 3, MARS_ELEMENTS);
    const fs = flightAt('MARS', FlightPhase.ORBIT);
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    // Should be LOCAL_NETWORK (local comm-sats) or RELAY depending on resolution order.
    expect([CommsLinkType.LOCAL_NETWORK, CommsLinkType.RELAY]).toContain(result.linkType);
  });

  it('has NO_SIGNAL at Mars without relay chain', () => {
    const fs = flightAt('MARS', FlightPhase.ORBIT);
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.NO_SIGNAL);
  });
});

describe('comms — onboard relay antenna', () => {
  it('provides connection anywhere with relay antenna on craft', () => {
    const state = freshState();
    // Add a rocket design with a relay antenna.
    const relayRocket: RocketDesign = {
      id: 'r1',
      name: 'Relay Probe',
      parts: [
        { partId: 'relay-antenna', position: { x: 0, y: 0 } },
        { partId: 'probe-core-mk1', position: { x: 0, y: 1 } },
      ],
      staging: { stages: [[]], unstaged: [] },
      totalMass: 100,
      totalThrust: 0,
      createdDate: '2026-01-01',
      updatedDate: '2026-01-01',
    };
    state.rockets = [relayRocket];
    const fs = flightAt('MARS', FlightPhase.ORBIT, [], 'r1');
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.ONBOARD_RELAY);
  });
});

describe('comms — control lockout for probe-only craft', () => {
  it('locks controls for probe in ORBIT with no signal', () => {
    const state = freshState();
    const fs = flightAt('MARS', FlightPhase.ORBIT, []);
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.NO_SIGNAL);
    expect(result.controlLocked).toBe(true);
  });

  it('does NOT lock controls during FLIGHT phase (descent)', () => {
    const state = freshState();
    const fs = flightAt('MARS', FlightPhase.FLIGHT, []);
    const result = evaluateComms(state, fs, { altitude: 50_000, posX: 0, posY: 0 });
    // No signal, but FLIGHT phase = no lockout (probe needs to land).
    expect(result.controlLocked).toBe(false);
  });

  it('locks controls during TRANSFER phase for probe beyond comms range', () => {
    const state = freshState();
    const fs = flightAt('EARTH', FlightPhase.TRANSFER, []);
    fs.transferState = { originBodyId: 'EARTH', destinationBodyId: 'MARS' } as Partial<TransferState> as TransferState;
    // Place the craft far beyond direct and T3 range — deep space.
    const deepSpaceAlt = 1_000_000_000; // 1 billion m — well beyond any direct range
    const result = evaluateComms(state, fs, { altitude: deepSpaceAlt, posX: 0, posY: 0 });
    // The craft is beyond Earth direct range during transfer with no relay.
    expect(result.controlLocked).toBe(true);
  });
});

describe('comms — crewed craft with no signal', () => {
  it('does NOT lock controls for crewed craft', () => {
    const state = freshState();
    const fs = flightAt('MARS', FlightPhase.ORBIT, ['crew-1']);
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.NO_SIGNAL);
    expect(result.controlLocked).toBe(false);
    expect(result.canTransmit).toBe(false);
  });
});

describe('comms — getCommsCoverageInfo', () => {
  it('returns direct coverage info for Earth', () => {
    const state = freshState();
    const info = getCommsCoverageInfo(state, 'EARTH');
    expect(info.hasDirectCoverage).toBe(true);
    expect(info.directRange).toBe(COMMS_DIRECT_RANGE);
  });

  it('extends direct range with Tracking Station T3', () => {
    const state = freshState();
    state.hubs[0].facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 3 };
    const info = getCommsCoverageInfo(state, 'EARTH');
    expect(info.directRange).toBe(COMMS_TRACKING_T3_RANGE);
  });

  it('shows full coverage with 3+ comm-sats', () => {
    const state = freshState();
    deployCommSats(state, 'EARTH', 3, LEO_ELEMENTS);
    const info = getCommsCoverageInfo(state, 'EARTH');
    expect(info.hasLocalNetwork).toBe(true);
    expect(info.fullCoverage).toBe(true);
    expect(info.shadowAngleDeg).toBe(0);
  });

  it('shows partial coverage with fewer than 3 comm-sats', () => {
    const state = freshState();
    deployCommSats(state, 'EARTH', 2, LEO_ELEMENTS);
    const info = getCommsCoverageInfo(state, 'EARTH');
    expect(info.hasLocalNetwork).toBe(true);
    expect(info.fullCoverage).toBe(false);
    expect(info.shadowAngleDeg).toBeGreaterThan(0);
  });

  it('shows no local network when no comm-sats', () => {
    const state = freshState();
    const info = getCommsCoverageInfo(state, 'MOON');
    expect(info.hasLocalNetwork).toBe(false);
    expect(info.hasDirectCoverage).toBe(false);
  });
});

describe('comms — getCommsLinkLabel', () => {
  it('returns correct labels for all link types', () => {
    expect(getCommsLinkLabel(CommsLinkType.DIRECT)).toBe('Direct Link');
    expect(getCommsLinkLabel(CommsLinkType.TRACKING_STATION)).toBe('Tracking Station');
    expect(getCommsLinkLabel(CommsLinkType.LOCAL_NETWORK)).toBe('Comm-Sat Network');
    expect(getCommsLinkLabel(CommsLinkType.RELAY)).toBe('Relay Chain');
    expect(getCommsLinkLabel(CommsLinkType.ONBOARD_RELAY)).toBe('Onboard Relay');
    expect(getCommsLinkLabel(CommsLinkType.NONE)).toBe('No Signal');
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage tests
// ---------------------------------------------------------------------------

describe('comms — Moon body link with no local satellite network', () => {
  it('has NO_SIGNAL at Moon without comm-sats, relay, or tracking station', () => {
    // Moon with no comm-sats, no relay sats, no tracking station T3.
    // _canBodyLinkToEarth(MOON) checks T3 first (false), then Earth comm-sats (none).
    // _hasLocalCoverage fails (no local comm-sats), _hasRelayChain fails (no relay sats).
    const state = freshState();
    const fs = flightAt('MOON', FlightPhase.ORBIT);
    const result = evaluateComms(state, fs, { altitude: 50_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.NO_SIGNAL);
    expect(result.linkType).toBe(CommsLinkType.NONE);
  });

  it('connects at Moon via LOCAL_NETWORK when Earth has comm-sats for backhaul', () => {
    // Moon comm-sats provide local coverage, Earth comm-sats provide the backhaul
    // via _canBodyLinkToEarth(MOON) -> Earth comm-sats check (no T3 needed).
    const state = freshState();
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    deployCommSats(state, 'MOON', 3, MOON_ELEMENTS);
    deployCommSats(state, 'EARTH', 1, LEO_ELEMENTS);
    const fs = flightAt('MOON', FlightPhase.ORBIT);
    const result = evaluateComms(state, fs, { altitude: 50_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.LOCAL_NETWORK);
  });
});

describe('comms — onboard relay antenna (crewed craft)', () => {
  it('provides ONBOARD_RELAY for crewed craft with relay antenna part', () => {
    // A crewed craft with a relay antenna should get ONBOARD_RELAY link type,
    // which is the highest priority link and checked first in _resolveLink.
    const state = freshState();
    const relayRocket: RocketDesign = {
      id: 'r-crew-relay',
      name: 'Crewed Relay Ship',
      parts: [
        { partId: 'relay-antenna', position: { x: 0, y: 0 } },
        { partId: 'command-module-mk1', position: { x: 0, y: 1 } },
      ],
      staging: { stages: [[]], unstaged: [] },
      totalMass: 200,
      totalThrust: 0,
      createdDate: '2026-01-01',
      updatedDate: '2026-01-01',
    };
    state.rockets = [relayRocket];
    const fs = flightAt('MARS', FlightPhase.ORBIT, ['crew-1'], 'r-crew-relay');
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.ONBOARD_RELAY);
    // Crewed + onboard relay = full control and transmit.
    expect(result.canTransmit).toBe(true);
    expect(result.controlLocked).toBe(false);
  });
});

describe('comms — shadow zone (craft behind body)', () => {
  it('loses local network coverage when craft is in shadow zone behind body', () => {
    // Deploy fewer than COMMS_FULL_COVERAGE_THRESHOLD comm-sats so partial coverage
    // applies and shadow zone check is triggered.
    // Shadow zone math: cy = posY + R, craftAngle = atan2(cx, cy).
    // For shadow: craftAngle near PI -> cx ≈ 0, cy < 0, dist >= R.
    // Need posY < -R so cy < 0, and posY <= -2R so dist = |cy| = |posY + R| >= R.
    const state = freshState();
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    state.hubs[0].facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 3 };
    // 2 comm-sats at Moon = partial coverage, shadow zone check applies.
    deployCommSats(state, 'MOON', 2, MOON_ELEMENTS);

    const R = BODY_RADIUS.MOON; // 1_737_400
    const fs = flightAt('MOON', FlightPhase.ORBIT);
    // posY = -2R - 50_000 -> cy = -R - 50_000, dist = R + 50_000 > R, angle = PI.
    const shadowPosY = -(2 * R + 50_000);
    const result = evaluateComms(state, fs, { altitude: 50_000, posX: 0, posY: shadowPosY });
    // Craft is in the shadow zone, so local coverage fails.
    // Falls through to relay chain check which also fails (no relay sats at Moon).
    expect(result.linkType).not.toBe(CommsLinkType.LOCAL_NETWORK);
  });

  it('retains local network coverage with full constellation even on far side', () => {
    // With >= 3 comm-sats (full coverage), shadow zone is irrelevant.
    const state = freshState();
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    state.hubs[0].facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 3 };
    deployCommSats(state, 'MOON', 3, MOON_ELEMENTS);

    const R = BODY_RADIUS.MOON;
    const fs = flightAt('MOON', FlightPhase.ORBIT);
    const shadowPosY = -(2 * R + 50_000);
    const result = evaluateComms(state, fs, { altitude: 50_000, posX: 0, posY: shadowPosY });
    // Full constellation means full coverage, no shadow zone gaps.
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.LOCAL_NETWORK);
  });
});

describe('comms — relay chain multi-hop and cycle detection', () => {
  it('connects via multi-hop relay chain (Mars -> Earth relay sats)', () => {
    // Relay sats at Mars and Earth. Mars body walks to Earth via relay chain.
    // _walkRelayChain(MARS) -> checks relay sats at MARS (yes) ->
    // gets bodies within relay range -> EARTH is reachable (sibling via SUN) ->
    // relay sats at EARTH (yes) -> _walkRelayChain(EARTH) = true (base case).
    const state = freshState();
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    deployRelaySats(state, 'EARTH', 1);
    deployRelaySats(state, 'MARS', 1);
    // No local comm-sats at Mars — rely purely on relay sat range check.
    const fs = flightAt('MARS', FlightPhase.ORBIT);
    // Altitude must be within COMMS_LOCAL_NETWORK_RANGE for _isWithinRelaySatRange.
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.RELAY);
  });

  it('does not infinite loop on relay chain cycles (visited set prevents revisit)', () => {
    // Deploy relay sats at Saturn and Titan (Saturn <-> Titan mutual cycle).
    // The visited set in _walkRelayChain prevents TITAN from re-visiting SATURN.
    // The function must terminate (not hang). The actual link result depends on
    // whether a path to Earth exists — here T3 satellite ops may enable one.
    const state = freshState();
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    deployRelaySats(state, 'SATURN', 1);
    deployRelaySats(state, 'TITAN', 1);
    const fs = flightAt('SATURN', FlightPhase.ORBIT);
    const result = evaluateComms(state, fs, { altitude: 150_000, posX: 0, posY: 0 });
    // Key assertion: the function terminates (no infinite loop).
    // The cycle detection prevents revisiting Saturn via Titan.
    expect(result).toBeDefined();
    expect(result.status).toBeDefined();
  });
});

describe('comms — transfer state relay evaluation', () => {
  it('connects via RELAY during transfer when origin body has relay coverage', () => {
    // Craft in TRANSFER phase between Earth and Mars.
    // _resolveLink falls through to transferState check:
    //   _canBodyLinkToEarth(originBodyId=EARTH) -> true (Earth is Earth)
    //   _hasRelaySatsAtBody(originBodyId=EARTH) -> true (relay sats at Earth)
    // Result: RELAY link type.
    const state = freshState();
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    deployRelaySats(state, 'EARTH', 1);
    const fs = flightAt('EARTH', FlightPhase.TRANSFER, []);
    fs.transferState = {
      originBodyId: 'EARTH',
      destinationBodyId: 'MARS',
      departureTime: 0,
      estimatedArrival: 100_000,
      departureDV: 3500,
      captureDV: 1500,
      totalDV: 5000,
      trajectoryPath: [],
    };
    // Place craft far beyond direct/T3 range — deep space during transfer.
    const deepSpaceAlt = 1_000_000_000;
    const result = evaluateComms(state, fs, { altitude: deepSpaceAlt, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.RELAY);
  });

  it('connects via RELAY during transfer when destination body has relay coverage and Earth link', () => {
    // Craft in TRANSFER arriving at Mars.
    // Transfer check: _canBodyLinkToEarth(MARS) -> _hasRelayChain(MARS) -> relay sats
    //   at Mars + Earth -> chain reaches Earth.
    // _hasRelaySatsAtBody(MARS) -> true.
    const state = freshState();
    state.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };
    deployRelaySats(state, 'EARTH', 1);
    deployRelaySats(state, 'MARS', 1);
    const fs = flightAt('EARTH', FlightPhase.TRANSFER, []);
    fs.transferState = {
      originBodyId: 'EARTH',
      destinationBodyId: 'MARS',
      departureTime: 0,
      estimatedArrival: 100_000,
      departureDV: 3500,
      captureDV: 1500,
      totalDV: 5000,
      trajectoryPath: [],
    };
    const deepSpaceAlt = 1_000_000_000;
    const result = evaluateComms(state, fs, { altitude: deepSpaceAlt, posX: 0, posY: 0 });
    expect(result.status).toBe(CommsStatus.CONNECTED);
    expect(result.linkType).toBe(CommsLinkType.RELAY);
  });
});
