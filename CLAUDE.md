# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A browser-based 2D space agency management and rocket physics simulation game. Built with Vite, PixiJS (WebGL rendering), and vanilla ES modules — no UI framework.

## Commands

```bash
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build
npm run test         # Run all tests (unit then E2E, sequential)
npm run test:unit    # Vitest unit tests only
npm run test:watch   # Vitest in watch mode
npm run test:e2e     # Playwright E2E tests only (auto-starts dev server)
npm run typecheck    # TypeScript type checking (tsc --noEmit)
npm run lint         # ESLint (correctness rules, no formatting)
npm run lint:fix     # ESLint with auto-fix
```

To run a single unit test file:
```bash
npx vitest run src/tests/physics.test.js
```

To run a single E2E spec:
```bash
npx playwright test e2e/flight.spec.js
```

## Architecture

The codebase has a strict three-layer separation:

### Core (`src/core/`)
Pure game logic — no DOM, no canvas. Each module exports functions that read/mutate the central `gameState` object. Four key modules have been converted to TypeScript; the rest remain JS with JSDoc types.

- **gameState.ts** — Central in-memory state with TypeScript interfaces for all game types. All persistent data lives here.
- **physics.ts** — Flight physics: gravity, drag, fuel consumption, staging
- **orbit.ts** — Keplerian orbital mechanics, Kepler solver, transfers
- **constants.ts** — Enums (`PartType`, `MissionState`, `CrewStatus`, etc.) as `as const` objects with companion types
- **missions.js** / **finance.js** / **crew.js** — Agency management systems
- **rocketbuilder.js** + **rocketvalidator.js** — Rocket assembly and validation
- **saveload.js** — Serialization to/from `localStorage`

### Render (`src/render/`)
PixiJS WebGL rendering — **read-only access to state, never mutates it**. Receives state snapshots and draws them.

- **flight.js** — Barrel re-export; implementation split into `flight/` sub-modules (rocket, camera, sky, trails, debris, etc.)
- **vab.js** — Vehicle Assembly Building editor grid
- **hub.js** — Space agency hub buildings
- **map.js** — Orbital map view renderer

### UI (`src/ui/`)
DOM overlay panels layered on top of the canvas. Each panel module handles its own event listeners and calls core functions to mutate state, then re-renders. Large modules have been split into sub-module directories with barrel re-exports.

- **flightController.js** — Barrel; implementation in `flightController/` (loop, keyboard, map, docking, post-flight, etc.)
- **vab.js** — Barrel; implementation in `vab/` (parts panel, canvas interaction, staging, design library, etc.)
- **missionControl.js** — Barrel; implementation in `missionControl/` (missions, contracts, challenges, achievements tabs)
- **crewAdmin.js** — Crew management screen
- **topbar.js** — Persistent top bar with hamburger menu (save, load, help, exit)
- **help.js** — In-game help panel with 11 content sections, accessible from the hamburger menu

### Data (`src/data/`)
Immutable static catalogs: `parts.js` (part definitions), `missions.js` (mission templates), `bodies.js` (celestial bodies), `contracts.js`, `techtree.js`.

## Testing

- **Unit tests** (`src/tests/`) use Vitest + Chai. Environment is Node.js (no browser). Tests import core modules directly.
- **E2E tests** (`e2e/`) use Playwright targeting Chromium only. They run against the live Vite dev server which Playwright starts automatically. E2E helpers are split into sub-modules in `e2e/helpers/` with a barrel re-export at `e2e/helpers.js`.
- Playwright config retries 2× on CI (`process.env.CI`), no retries in dev.

## TypeScript & Linting

- Four core modules (`constants.ts`, `gameState.ts`, `physics.ts`, `orbit.ts`) are TypeScript. The rest of the codebase remains JavaScript.
- A Vite plugin (`jsToTsResolve` in `vite.config.js`) resolves `.js` import specifiers to `.ts` files, so no consuming files need import path changes.
- `tsconfig.json` uses `moduleResolution: "bundler"` with `allowJs: true` and `checkJs: false`.
- ESLint is configured for correctness rules only (no formatting). Config is in `eslint.config.js` (flat config format). TypeScript files use `@typescript-eslint` parser/plugin.

## Key Conventions

- Game state mutations happen **only in `src/core/`** modules.
- Render layer reads state but never writes it.
- UI layer calls core functions, then triggers re-renders — it does not manipulate state directly.
- Part and mission templates in `src/data/` are never mutated at runtime; the core clones them when instantiating.
- Constants/enums are defined in `src/core/constants.ts` — import from there, don't use magic strings.
- Large UI/render modules are split into sub-module directories with barrel re-exports at the original path, so external imports remain unchanged.
