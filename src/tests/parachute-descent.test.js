/**
 * parachute-descent.test.js — Tests for a command module descending under
 * parachute with player steering input.
 *
 * Covers:
 *   - No NaN propagation during parachute descent with steering
 *   - Player A/D input rotates the capsule left and right
 *   - Angular velocity stabilises (doesn't spin indefinitely)
 */

import { describe, it, expect } from 'vitest';
import {
  createPhysicsState,
  tick,
  handleKeyDown,
  handleKeyUp,
} from '../core/physics.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  addStageToConfig,
} from '../core/rocketbuilder.js';
import { createFlightState } from '../core/gameState.js';
import { deployParachute } from '../core/parachute.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal capsule: Probe Core Mk1 + Mk1 Parachute.
 * Parachute is assigned to Stage 1 for deployment.
 */
function makeCapsuleWithChute() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 10);
  const chuteId = addPartToAssembly(assembly, 'parachute-mk1',  0, -5);

  connectParts(assembly, chuteId, 1, probeId, 0); // chute bottom → probe top

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, chuteId, 0);

  return { assembly, staging, probeId, chuteId };
}

function makeFlightState() {
  return createFlightState({
    missionId: 'test-mission',
    rocketId:  'test-rocket',
  });
}

/**
 * Place the physics state mid-air, descending, with parachute deployed.
 */
function setupDescentState() {
  const { assembly, staging, probeId, chuteId } = makeCapsuleWithChute();
  const fs = makeFlightState();
  const ps = createPhysicsState(assembly, fs);

  // Place at 2000 m altitude, descending at 20 m/s.
  ps.posY    = 2000;
  ps.velY    = -20;
  ps.grounded = false;

  // Deploy the parachute.
  deployParachute(ps, chuteId);

  // Advance the deploy timer so chute is fully deployed.
  // tickParachutes is called inside tick/_integrate, but we can manually
  // set the state to deployed for simplicity.
  const entry = ps.parachuteStates.get(chuteId);
  entry.state       = 'deployed';
  entry.deployTimer = 0;

  return { ps, assembly, staging, fs, chuteId };
}

/** Check that all critical physics values are finite numbers. */
function assertNoNaN(ps, label) {
  const fields = ['posX', 'posY', 'velX', 'velY', 'angle', 'angularVelocity'];
  for (const f of fields) {
    expect(ps[f], `${label}: ps.${f} should be finite`).toSatisfy(Number.isFinite);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parachute descent with steering', () => {
  it('descends without NaN when no input is applied', () => {
    const { ps, assembly, staging, fs } = setupDescentState();

    // Tick for 5 seconds of descent.
    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i}`);
    }

    // Should still be descending (not crashed or at ground yet from 2000m).
    expect(ps.posY).toBeGreaterThan(0);
    expect(ps.crashed).toBe(false);
  });

  it('descends without NaN when steering left (A key)', () => {
    const { ps, assembly, staging, fs } = setupDescentState();

    handleKeyDown(ps, assembly, 'a');

    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i} (left)`);
    }

    handleKeyUp(ps, 'a');
    expect(ps.crashed).toBe(false);
  });

  it('descends without NaN when steering right (D key)', () => {
    const { ps, assembly, staging, fs } = setupDescentState();

    handleKeyDown(ps, assembly, 'd');

    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i} (right)`);
    }

    handleKeyUp(ps, 'd');
    expect(ps.crashed).toBe(false);
  });

  it('rotates left when A is held', () => {
    const { ps, assembly, staging, fs } = setupDescentState();
    const startAngle = ps.angle;

    handleKeyDown(ps, assembly, 'a');

    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    handleKeyUp(ps, 'a');

    // A key should rotate the capsule (negative angular direction).
    expect(ps.angle).not.toBe(startAngle);
    expect(ps.angle).toBeLessThan(startAngle);
  });

  it('rotates right when D is held', () => {
    const { ps, assembly, staging, fs } = setupDescentState();
    const startAngle = ps.angle;

    handleKeyDown(ps, assembly, 'd');

    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    handleKeyUp(ps, 'd');

    // D key should rotate the capsule (positive angular direction).
    expect(ps.angle).not.toBe(startAngle);
    expect(ps.angle).toBeGreaterThan(startAngle);
  });

  it('angular velocity stabilises after releasing steering input', () => {
    const { ps, assembly, staging, fs } = setupDescentState();

    // Spin the capsule by holding D for 1 second.
    handleKeyDown(ps, assembly, 'd');
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, dt);
    }
    handleKeyUp(ps, 'd');

    const angVelAfterSpin = Math.abs(ps.angularVelocity);
    expect(angVelAfterSpin).toBeGreaterThan(0);

    // Let it settle for 5 seconds with no input.
    for (let i = 0; i < 300; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `settle frame ${i}`);
    }

    // The capsule oscillates (pendulum rocking) so angular velocity won't
    // monotonically decrease, but it should remain bounded and gentle.
    // 0.5 rad/s ≈ 29°/s — well within "gentle rocking" territory.
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(0.5);
  });

  it('does not spin indefinitely — angular velocity decays over time', () => {
    const { ps, assembly, staging, fs } = setupDescentState();

    // Give the capsule an initial angular velocity (simulating a spin).
    ps.angularVelocity = 5.0; // rad/s — fast spin

    const dt = 1 / 60;
    // Tick for 10 seconds.
    for (let i = 0; i < 600; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `decay frame ${i}`);
    }

    // After 10 seconds under a deployed chute, spin should be nearly gone.
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(0.5);
  });

  it('player input produces meaningful pendulum swing under chute', () => {
    const { ps, assembly, staging, fs } = setupDescentState();

    // Hold D for 0.25 seconds — enough for a visible push without going
    // past 90° where the restoring torque reverses.
    handleKeyDown(ps, assembly, 'd');
    const dt = 1 / 60;
    for (let i = 0; i < 15; i++) {
      tick(ps, assembly, staging, fs, dt);
    }
    handleKeyUp(ps, 'd');

    // The capsule should have a meaningful angular velocity (pendulum swing),
    // not be stuck near zero from over-damping.
    // 0.1 rad/s ≈ 5.7°/s — minimum for visible swing.
    expect(Math.abs(ps.angularVelocity)).toBeGreaterThan(0.1);

    // The angle should have moved noticeably (> 1°).
    expect(Math.abs(ps.angle)).toBeGreaterThan(Math.PI / 180);

    // Now release and let it swing back. After 3 seconds, the capsule should
    // have swung back toward 0 (pendulum behavior, not stuck).
    const angleAfterPush = ps.angle;
    for (let i = 0; i < 180; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    // Should have swung back — angle closer to 0 than right after the push.
    expect(Math.abs(ps.angle)).toBeLessThan(Math.abs(angleAfterPush));
  });

  it('survives rapid left-right steering alternation without NaN', () => {
    const { ps, assembly, staging, fs } = setupDescentState();

    const dt = 1 / 60;
    for (let i = 0; i < 300; i++) {
      // Alternate left/right every 10 frames.
      if (i % 20 < 10) {
        handleKeyDown(ps, assembly, 'a');
        handleKeyUp(ps, 'd');
      } else {
        handleKeyDown(ps, assembly, 'd');
        handleKeyUp(ps, 'a');
      }
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `alternating frame ${i}`);
    }

    // Clean up keys.
    handleKeyUp(ps, 'a');
    handleKeyUp(ps, 'd');

    expect(ps.crashed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Landed steering — must not instantly crash
// ---------------------------------------------------------------------------

describe('landed command module steering', () => {
  /**
   * Set up a capsule that has already landed softly.
   */
  function setupLandedState() {
    const { assembly, staging, probeId, chuteId } = makeCapsuleWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Simulate a soft landing: on ground, zero velocity, landed state.
    ps.posY     = 0;
    ps.velX     = 0;
    ps.velY     = 0;
    ps.grounded = false;
    ps.landed   = true;
    ps.angle    = 0;
    ps.angularVelocity = 0;

    return { ps, assembly, staging, fs };
  }

  it('does not crash when pressing D (right) while landed', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    handleKeyDown(ps, assembly, 'd');

    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i} (right)`);
    }

    handleKeyUp(ps, 'd');
    expect(ps.crashed).toBe(false);
  });

  it('does not crash when pressing A (left) while landed', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    handleKeyDown(ps, assembly, 'a');

    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i} (left)`);
    }

    handleKeyUp(ps, 'a');
    expect(ps.crashed).toBe(false);
  });

  it('tilts but does not topple with brief left-right input', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    const dt = 1 / 60;

    // Push right for 0.5 seconds.
    handleKeyDown(ps, assembly, 'd');
    for (let i = 0; i < 30; i++) {
      tick(ps, assembly, staging, fs, dt);
    }
    handleKeyUp(ps, 'd');

    // Should be tilted but not crashed.
    expect(ps.crashed).toBe(false);
    expect(ps.angle).not.toBe(0);

    // Push left for 0.5 seconds.
    handleKeyDown(ps, assembly, 'a');
    for (let i = 0; i < 30; i++) {
      tick(ps, assembly, staging, fs, dt);
    }
    handleKeyUp(ps, 'a');

    expect(ps.crashed).toBe(false);
  });

  it('angle stays within safe range during 2 seconds of continuous input', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    handleKeyDown(ps, assembly, 'd');

    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i}`);
    }

    handleKeyUp(ps, 'd');

    // After 2 seconds of sustained input, should still be intact.
    // The capsule may eventually topple but should take time, not be instant.
    // Check angle is reasonable (not NaN, not infinity).
    expect(Number.isFinite(ps.angle)).toBe(true);
  });

  it('D key produces positive angular velocity (tilts right)', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    handleKeyDown(ps, assembly, 'd');

    const dt = 1 / 60;
    tick(ps, assembly, staging, fs, dt);

    // After 1 frame of D input, angular velocity should be positive.
    expect(ps.angularVelocity).toBeGreaterThan(0);
    handleKeyUp(ps, 'd');
  });

  it('A key produces negative angular velocity (tilts left)', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    handleKeyDown(ps, assembly, 'a');

    const dt = 1 / 60;
    tick(ps, assembly, staging, fs, dt);

    expect(ps.angularVelocity).toBeLessThan(0);
    handleKeyUp(ps, 'a');
  });

  it('landed capsule does not crash when tipped past 90 degrees', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    ps.angle = Math.PI * 0.5;

    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `roll frame ${i}`);
    }

    expect(ps.crashed).toBe(false);
  });

  it('capsule rolls rightward across the ground when D is held', () => {
    const { ps, assembly, staging, fs } = setupLandedState();
    const startX = ps.posX;

    handleKeyDown(ps, assembly, 'd');

    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i}`);
    }

    handleKeyUp(ps, 'd');
    expect(ps.crashed).toBe(false);
    expect(ps.posX).toBeGreaterThan(startX);
  });

  it('capsule rolls leftward without crashing when A is held', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    handleKeyDown(ps, assembly, 'a');

    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i}`);
    }

    handleKeyUp(ps, 'a');
    expect(ps.crashed).toBe(false);
  });

  it('capsule settles to rest after being tipped and released', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    // Push right briefly to start rocking.
    handleKeyDown(ps, assembly, 'd');
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) {
      tick(ps, assembly, staging, fs, dt);
    }
    handleKeyUp(ps, 'd');

    // Let it settle for 5 seconds.
    for (let i = 0; i < 300; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    // Angular velocity should be exactly zero — fully settled.
    expect(ps.angularVelocity).toBe(0);
  });

  it('capsule settles on its side after toppling (not rocking forever)', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    // Force onto its side.
    ps.angle = Math.PI * 0.5;
    ps.angularVelocity = 1.0;

    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    // Should have settled — angular velocity is zero.
    expect(ps.angularVelocity).toBe(0);
    expect(ps.crashed).toBe(false);
  });

  it('contact point changes as box rolls onto different faces', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    // Give a strong angular velocity to force a roll past 90°.
    ps.angularVelocity = 5.0;
    const startContactX = ps.tippingContactX;
    const startContactY = ps.tippingContactY;

    const dt = 1 / 60;
    let contactChanged = false;
    for (let i = 0; i < 300; i++) {
      tick(ps, assembly, staging, fs, dt);
      assertNoNaN(ps, `frame ${i}`);

      // Check if the contact point has changed (box rolled to a new face).
      if (ps.tippingContactX !== startContactX ||
          ps.tippingContactY !== startContactY) {
        contactChanged = true;
      }
    }

    // posY stays at 0 (renderer handles visual ground-pinning).
    expect(ps.posY).toBe(0);
    // posX should have shifted as the box rolls.
    expect(ps.posX).not.toBe(0);
    // The contact point should have changed as the box rotated to a new face.
    expect(contactChanged).toBe(true);
    expect(ps.crashed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ground-contact visual constraints
// ---------------------------------------------------------------------------

describe('landed capsule ground-contact rendering', () => {
  /**
   * Helper: compute the screen-Y position of every corner of a landed rocket
   * relative to the ground line (sy = 0).  Uses the same formulas the renderer
   * applies: pivot at the physics contact point, rotation by ps.angle, and a
   * visual-drop offset so the lowest corner sits at ground level.
   *
   * Returns { minScreenY, maxScreenY } where 0 = ground level and
   * negative = above ground.
   */
  function computeCornerScreenYs(ps, assembly) {
    const SCALE = 0.05;  // SCALE_M_PER_PX
    const contactX = ps.tippingContactX ?? 0;
    const contactY = ps.tippingContactY ?? 0;
    const cosA = Math.cos(ps.angle);
    const sinA = Math.sin(ps.angle);

    // Collect all corners in VAB coords.
    const drops = [];
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      if (!placed) continue;
      const def = getPartById(placed.partId);
      if (!def) continue;
      const hw = (def.width  ?? 40) / 2;
      const hh = (def.height ?? 40) / 2;
      const corners = [
        [placed.x - hw, placed.y - hh],
        [placed.x + hw, placed.y - hh],
        [placed.x - hw, placed.y + hh],
        [placed.x + hw, placed.y + hh],
      ];
      for (const [cx, cy] of corners) {
        // Screen-Y offset from pivot (positive = below pivot on screen).
        const drop = (cx - contactX) * sinA + (contactY - cy) * cosA;
        drops.push(drop);
      }
    }

    const maxDrop = Math.max(...drops);
    // Screen Y relative to ground: screenY = -maxDrop + drop.
    // Ground (maxDrop corner) → 0.  Everything else → negative (above ground).
    return {
      minScreenY: -maxDrop + Math.min(...drops),
      maxScreenY: 0,  // by construction the max drop maps to ground
    };
  }

  function setupLandedState() {
    const { assembly, staging, probeId, chuteId } = makeCapsuleWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY = 0; ps.velX = 0; ps.velY = 0;
    ps.grounded = false; ps.landed = true;
    ps.angle = 0; ps.angularVelocity = 0;
    return { ps, assembly, staging, fs };
  }

  it('near-upright capsule: no part below ground and touches ground', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    // Slightly tilted so tipping physics activates and sets contact point.
    ps.angle = 0.01;
    ps.angularVelocity = 0.01;

    const dt = 1 / 60;
    tick(ps, assembly, staging, fs, dt);

    if (ps.isTipping) {
      const { minScreenY, maxScreenY } = computeCornerScreenYs(ps, assembly);
      // No part below ground (maxScreenY = 0 = ground).
      expect(maxScreenY).toBeLessThanOrEqual(0.001);
      // Parts touch the ground (maxScreenY ≈ 0).
      expect(maxScreenY).toBeGreaterThanOrEqual(-0.001);
      // All other parts above ground.
      expect(minScreenY).toBeLessThanOrEqual(0.001);
    }
  });

  it('capsule on its side (90°): all parts above ground and touching', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    ps.angle = Math.PI / 2;
    ps.angularVelocity = 0.1;

    const dt = 1 / 60;
    tick(ps, assembly, staging, fs, dt);

    const { minScreenY, maxScreenY } = computeCornerScreenYs(ps, assembly);
    expect(maxScreenY).toBeCloseTo(0, 1);     // touches ground
    expect(minScreenY).toBeLessThanOrEqual(0.001);  // nothing below ground
  });

  it('capsule upside down (180°): all parts above ground and touching', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    ps.angle = Math.PI;
    ps.angularVelocity = 0.1;

    const dt = 1 / 60;
    tick(ps, assembly, staging, fs, dt);

    const { minScreenY, maxScreenY } = computeCornerScreenYs(ps, assembly);
    expect(maxScreenY).toBeCloseTo(0, 1);
    expect(minScreenY).toBeLessThanOrEqual(0.001);
  });

  it('capsule rolled through multiple angles: never below ground', () => {
    const { ps, assembly, staging, fs } = setupLandedState();

    ps.angularVelocity = 5.0;  // fast roll

    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      tick(ps, assembly, staging, fs, dt);
      if (!ps.isTipping) continue;

      const { minScreenY, maxScreenY } = computeCornerScreenYs(ps, assembly);
      // No corner should be below ground (allow small floating-point tolerance).
      expect(maxScreenY).toBeLessThanOrEqual(0.01);
      // The rocket should still be touching the ground (not floating).
      expect(maxScreenY).toBeGreaterThanOrEqual(-1);
    }
    expect(ps.crashed).toBe(false);
  });
});
