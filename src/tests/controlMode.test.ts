// @ts-nocheck
/**
 * controlMode.test.js — Unit tests for the control mode system (TASK-005).
 *
 * Tests cover:
 *   - ControlMode enum values
 *   - canEnterDockingMode() — phase gating
 *   - enterDockingMode() / exitDockingMode() — state transitions
 *   - toggleRcsMode() — RCS toggling within docking mode
 *   - hasRcsThrusters() — RCS part detection
 *   - checkBandLimitWarning() — altitude band warnings
 *   - clampDockingRadial() — band limit clamping
 *   - resetControlModeIfNeeded() — auto-reset on phase change
 *   - getControlModeLabel() — human-readable labels
 *   - Physics integration: handleKeyDown in docking/RCS modes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFlightState } from '../core/gameState.ts';
import { FlightPhase, ControlMode, PartType } from '../core/constants.ts';
import {
  canEnterDockingMode,
  enterDockingMode,
  exitDockingMode,
  toggleRcsMode,
  hasRcsThrusters,
  checkBandLimitWarning,
  clampDockingRadial,
  resetControlModeIfNeeded,
  getControlModeLabel,
  CONTROL_MODE_TIPS,
  BAND_WARNING_MARGIN,
} from '../core/controlMode.ts';
import { handleKeyDown } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshFlightState(phase = FlightPhase.ORBIT) {
  const fs = createFlightState({
    missionId: 'test-mission',
    rocketId: 'test-rocket',
    crewIds: [],
    fuelRemaining: 1000,
    deltaVRemaining: 3000,
  });
  fs.phase = phase;
  fs.inOrbit = phase === FlightPhase.ORBIT;
  return fs;
}

function stubPs(overrides = {}) {
  return {
    posX: 0,
    posY: 100_000, // 100 km altitude (LEO)
    velX: 7800,    // ~orbital velocity
    velY: 0,
    angle: 0,
    throttle: 0.5,
    throttleMode: 'absolute',
    targetTWR: 1.0,
    firingEngines: new Set(),
    fuelStore: new Map(),
    activeParts: new Set(),
    deployedParts: new Set(),
    grounded: false,
    landed: false,
    crashed: false,
    controlMode: ControlMode.NORMAL,
    baseOrbit: null,
    dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0,
    dockingOffsetRadial: 0,
    rcsActiveDirections: new Set(),
    _heldKeys: new Set(),
    ...overrides,
  };
}

/** Create a minimal assembly with one RCS-capable part. */
function assemblyWithRcs() {
  const parts = new Map();
  parts.set('cmd-1', { partId: 'cmd-mk1', x: 0, y: 0 });
  return {
    parts,
    connections: [],
    symmetryPairs: [],
    _nextId: 2,
  };
}

/** Create an assembly without RCS. */
function assemblyWithoutRcs() {
  const parts = new Map();
  parts.set('tank-1', { partId: 'tank-small', x: 0, y: 0 });
  return {
    parts,
    connections: [],
    symmetryPairs: [],
    _nextId: 2,
  };
}

// ---------------------------------------------------------------------------
// ControlMode enum
// ---------------------------------------------------------------------------

describe('ControlMode enum', () => {
  it('has all expected values', () => {
    expect(ControlMode.NORMAL).toBe('NORMAL');
    expect(ControlMode.DOCKING).toBe('DOCKING');
    expect(ControlMode.RCS).toBe('RCS');
  });

  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(ControlMode)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canEnterDockingMode
// ---------------------------------------------------------------------------

describe('canEnterDockingMode', () => {
  it('returns true when in ORBIT phase', () => {
    expect(canEnterDockingMode(FlightPhase.ORBIT)).toBe(true);
  });

  it('returns false when in FLIGHT phase', () => {
    expect(canEnterDockingMode(FlightPhase.FLIGHT)).toBe(false);
  });

  it('returns false when in LAUNCH phase', () => {
    expect(canEnterDockingMode(FlightPhase.LAUNCH)).toBe(false);
  });

  it('returns false when in REENTRY phase', () => {
    expect(canEnterDockingMode(FlightPhase.REENTRY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// enterDockingMode
// ---------------------------------------------------------------------------

describe('enterDockingMode', () => {
  it('@smoke succeeds when in ORBIT phase with NORMAL mode', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const result = enterDockingMode(ps, fs, 'EARTH');
    expect(result.success).toBe(true);
    expect(ps.controlMode).toBe(ControlMode.DOCKING);
  });

  it('cuts throttle to zero on entry', () => {
    const ps = stubPs({ throttle: 0.8 });
    const fs = freshFlightState();
    enterDockingMode(ps, fs, 'EARTH');
    expect(ps.throttle).toBe(0);
  });

  it('freezes the current orbit as baseOrbit', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    enterDockingMode(ps, fs, 'EARTH');
    expect(ps.baseOrbit).not.toBeNull();
    expect(ps.baseOrbit).toHaveProperty('semiMajorAxis');
  });

  it('records the altitude band', () => {
    const ps = stubPs({ posY: 100_000 }); // LEO
    const fs = freshFlightState();
    enterDockingMode(ps, fs, 'EARTH');
    expect(ps.dockingAltitudeBand).not.toBeNull();
    expect(ps.dockingAltitudeBand.id).toBe('LEO');
  });

  it('fails if not in ORBIT phase', () => {
    const ps = stubPs();
    const fs = freshFlightState(FlightPhase.FLIGHT);
    const result = enterDockingMode(ps, fs, 'EARTH');
    expect(result.success).toBe(false);
    expect(ps.controlMode).toBe(ControlMode.NORMAL);
  });

  it('fails if already in docking mode', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING });
    const fs = freshFlightState();
    const result = enterDockingMode(ps, fs, 'EARTH');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// exitDockingMode
// ---------------------------------------------------------------------------

describe('exitDockingMode', () => {
  it('returns to NORMAL mode', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING });
    ps.baseOrbit = { semiMajorAxis: 6471000 };
    ps.dockingAltitudeBand = { id: 'LEO', min: 80000, max: 200000 };
    const fs = freshFlightState();
    const result = exitDockingMode(ps, fs, 'EARTH');
    expect(result.success).toBe(true);
    expect(ps.controlMode).toBe(ControlMode.NORMAL);
  });

  it('cuts throttle to zero', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING, throttle: 0.5 });
    const fs = freshFlightState();
    exitDockingMode(ps, fs, 'EARTH');
    expect(ps.throttle).toBe(0);
  });

  it('clears docking state', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING });
    ps.baseOrbit = { semiMajorAxis: 6471000 };
    ps.dockingAltitudeBand = { id: 'LEO' };
    ps.dockingOffsetAlongTrack = 50;
    ps.dockingOffsetRadial = 10;
    const fs = freshFlightState();
    exitDockingMode(ps, fs, 'EARTH');
    expect(ps.baseOrbit).toBeNull();
    expect(ps.dockingAltitudeBand).toBeNull();
    expect(ps.dockingOffsetAlongTrack).toBe(0);
    expect(ps.dockingOffsetRadial).toBe(0);
  });

  it('exits from RCS mode back to NORMAL', () => {
    const ps = stubPs({ controlMode: ControlMode.RCS });
    const fs = freshFlightState();
    const result = exitDockingMode(ps, fs, 'EARTH');
    expect(result.success).toBe(true);
    expect(ps.controlMode).toBe(ControlMode.NORMAL);
  });

  it('fails if not in docking mode', () => {
    const ps = stubPs({ controlMode: ControlMode.NORMAL });
    const fs = freshFlightState();
    const result = exitDockingMode(ps, fs, 'EARTH');
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toggleRcsMode
// ---------------------------------------------------------------------------

describe('toggleRcsMode', () => {
  it('enters RCS from DOCKING when RCS thrusters available', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING });
    const assembly = assemblyWithRcs();
    ps.activeParts = new Set(assembly.parts.keys());
    const result = toggleRcsMode(ps, assembly);
    expect(result.success).toBe(true);
    expect(ps.controlMode).toBe(ControlMode.RCS);
  });

  it('exits RCS back to DOCKING', () => {
    const ps = stubPs({ controlMode: ControlMode.RCS });
    const assembly = assemblyWithRcs();
    const result = toggleRcsMode(ps, assembly);
    expect(result.success).toBe(true);
    expect(ps.controlMode).toBe(ControlMode.DOCKING);
  });

  it('fails if not in docking mode', () => {
    const ps = stubPs({ controlMode: ControlMode.NORMAL });
    const assembly = assemblyWithRcs();
    const result = toggleRcsMode(ps, assembly);
    expect(result.success).toBe(false);
  });

  it('fails if no RCS thrusters available', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING });
    const assembly = assemblyWithoutRcs();
    ps.activeParts = new Set(assembly.parts.keys());
    const result = toggleRcsMode(ps, assembly);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkBandLimitWarning
// ---------------------------------------------------------------------------

describe('checkBandLimitWarning', () => {
  it('returns no warning when not in docking mode', () => {
    const ps = stubPs({ controlMode: ControlMode.NORMAL });
    const result = checkBandLimitWarning(ps, 'EARTH');
    expect(result.warning).toBe(false);
  });

  it('returns warning near lower band edge', () => {
    const ps = stubPs({
      controlMode: ControlMode.DOCKING,
      posY: 80_000 + BAND_WARNING_MARGIN * 0.5, // Just above lower LEO limit
    });
    ps.dockingAltitudeBand = { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 };
    const result = checkBandLimitWarning(ps, 'EARTH');
    expect(result.warning).toBe(true);
    expect(result.message).toContain('lower');
  });

  it('returns warning near upper band edge', () => {
    const ps = stubPs({
      controlMode: ControlMode.DOCKING,
      posY: 200_000 - BAND_WARNING_MARGIN * 0.5, // Just below upper LEO limit
    });
    ps.dockingAltitudeBand = { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 };
    const result = checkBandLimitWarning(ps, 'EARTH');
    expect(result.warning).toBe(true);
    expect(result.message).toContain('upper');
  });

  it('returns no warning when well within band', () => {
    const ps = stubPs({
      controlMode: ControlMode.DOCKING,
      posY: 140_000, // Middle of LEO
    });
    ps.dockingAltitudeBand = { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 };
    const result = checkBandLimitWarning(ps, 'EARTH');
    expect(result.warning).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clampDockingRadial
// ---------------------------------------------------------------------------

describe('clampDockingRadial', () => {
  it('clamps upward velocity near upper band edge', () => {
    const ps = stubPs({
      controlMode: ControlMode.DOCKING,
      posY: 200_000 - 1000, // Very near upper LEO limit
    });
    ps.dockingAltitudeBand = { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 };
    const result = clampDockingRadial(ps, 10, 'EARTH');
    expect(result).toBe(0);
  });

  it('clamps downward velocity near lower band edge', () => {
    const ps = stubPs({
      controlMode: ControlMode.DOCKING,
      posY: 80_000 + 1000, // Very near lower LEO limit
    });
    ps.dockingAltitudeBand = { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 };
    const result = clampDockingRadial(ps, -10, 'EARTH');
    expect(result).toBe(0);
  });

  it('passes through velocity when well within band', () => {
    const ps = stubPs({
      controlMode: ControlMode.DOCKING,
      posY: 140_000,
    });
    ps.dockingAltitudeBand = { id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 };
    const result = clampDockingRadial(ps, 10, 'EARTH');
    expect(result).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// resetControlModeIfNeeded
// ---------------------------------------------------------------------------

describe('resetControlModeIfNeeded', () => {
  it('resets DOCKING to NORMAL when leaving ORBIT', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING });
    const fs = freshFlightState(FlightPhase.REENTRY);
    const wasReset = resetControlModeIfNeeded(ps, fs, 'EARTH');
    expect(wasReset).toBe(true);
    expect(ps.controlMode).toBe(ControlMode.NORMAL);
  });

  it('resets RCS to NORMAL when leaving ORBIT', () => {
    const ps = stubPs({ controlMode: ControlMode.RCS });
    const fs = freshFlightState(FlightPhase.FLIGHT);
    const wasReset = resetControlModeIfNeeded(ps, fs, 'EARTH');
    expect(wasReset).toBe(true);
    expect(ps.controlMode).toBe(ControlMode.NORMAL);
  });

  it('does nothing when in ORBIT phase', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING });
    const fs = freshFlightState(FlightPhase.ORBIT);
    const wasReset = resetControlModeIfNeeded(ps, fs, 'EARTH');
    expect(wasReset).toBe(false);
    expect(ps.controlMode).toBe(ControlMode.DOCKING);
  });

  it('does nothing when already in NORMAL mode', () => {
    const ps = stubPs({ controlMode: ControlMode.NORMAL });
    const fs = freshFlightState(FlightPhase.FLIGHT);
    const wasReset = resetControlModeIfNeeded(ps, fs, 'EARTH');
    expect(wasReset).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getControlModeLabel
// ---------------------------------------------------------------------------

describe('getControlModeLabel', () => {
  it('returns "Orbit" for NORMAL', () => {
    expect(getControlModeLabel(ControlMode.NORMAL)).toBe('Orbit');
  });
  it('returns "Docking" for DOCKING', () => {
    expect(getControlModeLabel(ControlMode.DOCKING)).toBe('Docking');
  });
  it('returns "RCS" for RCS', () => {
    expect(getControlModeLabel(ControlMode.RCS)).toBe('RCS');
  });
});

// ---------------------------------------------------------------------------
// CONTROL_MODE_TIPS
// ---------------------------------------------------------------------------

describe('CONTROL_MODE_TIPS', () => {
  it('has a tip for each mode', () => {
    expect(CONTROL_MODE_TIPS[ControlMode.NORMAL]).toBeDefined();
    expect(CONTROL_MODE_TIPS[ControlMode.DOCKING]).toBeDefined();
    expect(CONTROL_MODE_TIPS[ControlMode.RCS]).toBeDefined();
  });

  it('tips are non-empty strings', () => {
    for (const mode of Object.values(ControlMode)) {
      expect(typeof CONTROL_MODE_TIPS[mode]).toBe('string');
      expect(CONTROL_MODE_TIPS[mode].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// handleKeyDown in docking/RCS modes
// ---------------------------------------------------------------------------

describe('handleKeyDown in docking/RCS modes', () => {
  it('does not change throttle on W press in DOCKING mode', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING, throttle: 0 });
    handleKeyDown(ps, null, 'w');
    expect(ps.throttle).toBe(0);
  });

  it('does not change throttle on S press in DOCKING mode', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING, throttle: 0.5 });
    handleKeyDown(ps, null, 's');
    expect(ps.throttle).toBe(0.5);
  });

  it('X cuts throttle in DOCKING mode', () => {
    const ps = stubPs({ controlMode: ControlMode.DOCKING, throttle: 0.5 });
    handleKeyDown(ps, null, 'x');
    expect(ps.throttle).toBe(0);
  });

  it('does not change throttle on W in RCS mode', () => {
    const ps = stubPs({ controlMode: ControlMode.RCS, throttle: 0 });
    handleKeyDown(ps, null, 'w');
    expect(ps.throttle).toBe(0);
  });
});
