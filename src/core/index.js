// Core game logic — pure JavaScript, no DOM or canvas dependencies.
//
// All game systems live here:
//   constants.js     — shared enums and magic numbers (PartType, MissionState, etc.)
//   gameState.js     — central in-memory state object and data model types
//   physics.js       — rocket physics simulation
//   missions.js      — mission generation, acceptance, completion
//   finance.js       — money, loans, and financial events
//   saveload.js      — save/load slots and play-time tracking
//   crew.js          — astronaut management and training
//   rocketBuilder.js — rocket assembly and validation
//   flightRunner.js  — turn-by-turn flight simulation
//
// Because this layer has no browser dependencies it can be unit-tested
// headlessly via Vitest (see src/tests/).

export * from './constants.js';
export * from './gameState.js';
export * from './finance.js';
export * from './saveload.js';
export * from './crew.js';
export * from './missions.js';
