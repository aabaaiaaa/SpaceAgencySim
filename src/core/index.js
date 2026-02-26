// Core game logic — pure JavaScript, no DOM or canvas dependencies.
//
// All game systems live here:
//   gameState.js   — central in-memory state object
//   physics.js     — rocket physics simulation
//   missions.js    — mission generation, acceptance, completion
//   finance.js     — money, loans, and financial events
//   crew.js        — astronaut management and training
//   rocketBuilder.js — rocket assembly and validation
//   flightRunner.js  — turn-by-turn flight simulation
//
// Because this layer has no browser dependencies it can be unit-tested
// headlessly via Vitest (see src/tests/).
