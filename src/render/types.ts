/**
 * types.ts — Read-only snapshot interfaces for the render layer.
 *
 * The render layer receives game state by reference but must never mutate it.
 * These Readonly wrappers enforce that contract at compile time.  Callers in
 * the UI layer pass mutable state — TypeScript allows mutable → readonly.
 */

import type { PhysicsState } from '../core/physics.ts';
import type { FlightState, GameState, SurfaceItem } from '../core/gameState.ts';
import type { RocketAssembly } from '../core/rocketbuilder.ts';

/** Read-only view of PhysicsState for render functions. */
export type ReadonlyPhysicsState = Readonly<PhysicsState>;

/** Read-only view of FlightState for render functions. */
export type ReadonlyFlightState = Readonly<FlightState>;

/** Read-only view of the top-level GameState for map/overlay rendering. */
export type ReadonlyGameState = Readonly<GameState>;

/** Read-only view of RocketAssembly for render functions. */
export type ReadonlyAssembly = Readonly<RocketAssembly>;

/** Read-only view of a SurfaceItem. */
export type ReadonlySurfaceItem = Readonly<SurfaceItem>;
