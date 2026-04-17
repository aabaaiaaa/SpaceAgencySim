/**
 * physics.ts — Barrel re-export for the flight physics module.
 *
 * All implementation lives under `./physics/`. This file exists only to
 * preserve the historical public API surface at `src/core/physics.ts` for
 * callers throughout the codebase and test suite.
 */

export * from './physics/types.ts';
export * from './physics/constants.ts';
export * from './physics/atmosphereLookup.ts';
export * from './physics/crewSkill.ts';
export * from './physics/mass.ts';
export * from './physics/drag.ts';
export * from './physics/asteroidTorque.ts';
export * from './physics/groundedSteering.ts';
export * from './physics/topple.ts';
export * from './physics/groundContact.ts';
export * from './physics/flightSync.ts';
export * from './physics/capturedBody.ts';
export * from './physics/debrisGround.ts';
export * from './physics/docking.ts';
export * from './physics/init.ts';
export * from './physics/keyboard.ts';
export * from './physics/tick.ts';
