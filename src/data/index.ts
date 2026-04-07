// Static game data: part definitions, mission definitions, and celestial bodies.
// All data is plain TypeScript objects — no DOM or runtime dependency.
//
// Modules:
//   parts.ts     — catalog of rocket part definitions (engines, fuel tanks, etc.)
//   missions.ts  — mission templates with objectives, rewards, and requirements
//   bodies.ts    — celestial body definitions (physics, visuals, biomes, SOI)

export * from './parts.ts';
export * from './missions.ts';
export * from './bodies.ts';
