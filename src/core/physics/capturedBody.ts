// ---------------------------------------------------------------------------
// Captured body helpers (public API)
// ---------------------------------------------------------------------------

import type { CapturedBody, PhysicsState } from '../physics.ts';

/**
 * Attach a captured body (asteroid) to the physics state.
 * Called by the grabbing system when an asteroid is captured.
 * This adds the body's mass to all physics calculations (thrust, gravity,
 * drag, TWR) and enables rotational torque from off-CoM thrust.
 */
export function setCapturedBody(ps: PhysicsState, body: CapturedBody): void {
  ps.capturedBody = body;
  ps.thrustAligned = false; // new capture always starts unaligned
}

/**
 * Clear the captured body (release).
 * Called by the grabbing system when the asteroid is released.
 */
export function clearCapturedBody(ps: PhysicsState): void {
  ps.capturedBody = null;
  ps.thrustAligned = false;
}

/**
 * Set whether thrust is aligned through the combined CoM.
 * When true, captured asteroid torque is suppressed (no spin from engines).
 * Called by the "Align Thrust" UI action (TASK-027).
 */
export function setThrustAligned(ps: PhysicsState, aligned: boolean): void {
  ps.thrustAligned = aligned;
}
