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
Pure JavaScript game logic — no DOM, no canvas. Each module exports functions that read/mutate the central `gameState` object. Key modules:

- **gameState.js** — Central in-memory state (with JSDoc type definitions). All persistent data lives here.
- **physics.js** — Flight physics: gravity, drag, fuel consumption, staging
- **missions.js** / **finance.js** / **crew.js** — Agency management systems
- **rocketbuilder.js** + **rocketvalidator.js** — Rocket assembly and validation
- **constants.js** — Enums: `PartType`, `MissionState`, `CrewStatus`, etc.
- **saveload.js** — Serialization to/from `localStorage`

### Render (`src/render/`)
PixiJS WebGL rendering — **read-only access to state, never mutates it**. Receives state snapshots and draws them.

- **flight.js** — Rocket, camera, sky gradient, stars, particle trails, debris
- **vab.js** — Vehicle Assembly Building editor grid
- **hub.js** — Space agency hub buildings

### UI (`src/ui/`)
DOM overlay panels layered on top of the canvas. Each panel module handles its own event listeners and calls core functions to mutate state, then re-renders.

- **flightController.js** — In-flight keyboard/button input
- **vab.js** — Rocket designer (largest UI module at ~2,600 LOC)
- **crewAdmin.js** / **missionControl.js** — Management screens

### Data (`src/data/`)
Immutable static catalogs: `parts.js` (part definitions) and `missions.js` (mission templates).

## Testing

- **Unit tests** (`src/tests/`) use Vitest + Chai. Environment is Node.js (no browser). Tests import core modules directly.
- **E2E tests** (`e2e/`) use Playwright targeting Chromium only. They run against the live Vite dev server which Playwright starts automatically.
- Playwright config retries 2× on CI (`process.env.CI`), no retries in dev.

## Key Conventions

- Game state mutations happen **only in `src/core/`** modules.
- Render layer reads state but never writes it.
- UI layer calls core functions, then triggers re-renders — it does not manipulate state directly.
- Part and mission templates in `src/data/` are never mutated at runtime; the core clones them when instantiating.
- Constants/enums are defined in `src/core/constants.js` — import from there, don't use magic strings.
