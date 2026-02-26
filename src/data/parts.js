/**
 * parts.js — Rocket part definition catalog.
 *
 * EXTENSIBILITY
 * =============
 * To add a new part, append a plain-object entry conforming to the PartDef
 * schema to the PARTS array at the bottom of this file.  No other files need
 * to change for new parts.
 *
 * Exception — if a brand-new part *category* is introduced:
 *   1. Add the type string to PartType in /src/core/constants.js.
 *   2. Add an ActivationBehaviour entry below if the category has unique
 *      interactive behaviour.
 *   3. Decide which snap-point type sets (STACK_TYPES / RADIAL_TYPES) the
 *      new category belongs to and add it there.
 *   4. Add the part definition object(s) to PARTS.
 *
 * SNAP POINTS
 * ===========
 * A snap point describes one attachment socket on a part.  Coordinates are
 * relative to the part's centre at the default (1×) zoom level:
 *   - offsetX > 0 → right of centre
 *   - offsetY > 0 → below centre  (screen / canvas coordinate space)
 *
 * The builder matches sockets when:
 *   dragged.part.type  is contained in  target.snapPoint.accepts
 *   AND
 *   the sides are complementary  (top ↔ bottom,  left ↔ right)
 *
 * PIXEL SCALE
 * ===========
 * 1 pixel = 0.05 metres at default zoom, so a 2-metre-diameter capsule is
 * 40 px wide.  Use this as a guide when sizing new parts.
 */

import { PartType } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Activation Behaviour Enum
// ---------------------------------------------------------------------------

/**
 * What happens when the player triggers the action/staging button for a part.
 * @enum {string}
 */
export const ActivationBehaviour = Object.freeze({
  /** Part has no interactive activation (structural / passive). */
  NONE: 'NONE',

  /** Engine: begin or stop producing thrust. */
  IGNITE: 'IGNITE',

  /**
   * Decoupler: fire a one-shot separation charge, severing the connection
   * between the two rocket sections joined at this part.
   */
  SEPARATE: 'SEPARATE',

  /**
   * Parachute or landing leg assembly: extend / open from the stowed position.
   * Calling this a second time on a leg assembly retracts it.
   */
  DEPLOY: 'DEPLOY',

  /** Command module: fire the ejector seat to save the crew in an emergency. */
  EJECT: 'EJECT',

  /** Payload bay: release the satellite or cargo into free flight. */
  RELEASE: 'RELEASE',

  /** Science module: begin the timed experiment and start data collection. */
  COLLECT_SCIENCE: 'COLLECT_SCIENCE',
});

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * One attachment socket on a part.
 *
 * @typedef {Object} SnapPoint
 * @property {'top'|'bottom'|'left'|'right'} side
 *   Which face of the part this socket sits on.
 * @property {number} offsetX
 *   Horizontal offset from the part's centre in pixels (at base 1× scale).
 *   Positive values are to the right.
 * @property {number} offsetY
 *   Vertical offset from the part's centre in pixels (at base 1× scale).
 *   Positive values are downward (canvas / screen space).
 * @property {string[]} accepts
 *   PartType values that may connect at this socket.
 *   An empty array means nothing can attach here.
 */

/**
 * Complete definition for a single rocket component.
 *
 * All fields are required unless noted.  Keep values deterministic and
 * serialisation-safe (plain numbers, strings, arrays — no functions).
 *
 * @typedef {Object} PartDef
 *
 * @property {string} id
 *   Stable unique identifier.  **Never rename** — saved rocket designs
 *   reference parts by ID, so changing an ID breaks existing saves.
 *
 * @property {string} name
 *   Human-readable label shown in the parts panel and on-screen tooltips.
 *
 * @property {string} type
 *   Part category.  Must be a value from the PartType enum
 *   (src/core/constants.js).
 *
 * @property {number} mass
 *   Dry mass in kilograms.  For tanks and SRBs this is the empty mass;
 *   propellant mass is stored separately in `properties.fuelMass`.
 *
 * @property {number} cost
 *   Purchase price in dollars shown in the parts panel and VAB toolbar.
 *
 * @property {number} width
 *   Rendered width in pixels at the default 1× zoom level.
 *   (1 px ≈ 0.05 m, so 40 px ≈ 2 m diameter.)
 *
 * @property {number} height
 *   Rendered height in pixels at the default 1× zoom level.
 *
 * @property {SnapPoint[]} snapPoints
 *   Attachment sockets.  The builder uses these to highlight valid drop
 *   targets and to register connections in the rocket part graph.
 *
 * @property {string[]} animationStates
 *   Named visual states for the renderer.  The first entry is always the
 *   initial (idle) state.  The renderer switches between these strings
 *   when the part is activated, deployed, exhausted, etc.
 *   Example: ['idle', 'firing', 'burnt-out'].
 *
 * @property {boolean} activatable
 *   True if the player can manually trigger this part in flight (via the
 *   staging strip or an action-group key).
 *
 * @property {string} activationBehaviour
 *   How the part responds when activated.  Must be a value from
 *   ActivationBehaviour (defined above).  Ignored when activatable is false.
 *
 * @property {Object} properties
 *   Type-specific numeric or string values consumed by game-logic modules.
 *   Keys vary by part type — see the inline comments on each part entry.
 *   Common keys:
 *     - thrust          {number}  Sea-level thrust in kN (engines / SRBs).
 *     - thrustVac       {number}  Vacuum thrust in kN (engines / SRBs).
 *     - isp             {number}  Specific impulse at sea level, seconds.
 *     - ispVac          {number}  Specific impulse in vacuum, seconds.
 *     - throttleable    {boolean} Whether thrust can be varied (false = SRB).
 *     - fuelMass        {number}  Full propellant load in kg (tanks / SRBs).
 *     - fuelType        {string}  FuelType enum value.
 *     - seats           {number}  Crew seats (command modules only).
 *     - hasRcs          {boolean} Built-in RCS thrusters.
 *     - hasEjectorSeat  {boolean} Crew escape system.
 *     - maxSafeMass     {number}  Max supported rocket mass in kg (chutes/legs).
 *     - maxLandingSpeed {number}  Speed in m/s above which landing is unsafe.
 *     - experimentDuration {number} Seconds the science experiment runs.
 *     - dragCoefficient {number}  Aerodynamic drag (dimensionless).
 *     - heatTolerance   {number}  Max temperature in K before part fails.
 */

// ---------------------------------------------------------------------------
// Snap-point helper sets
// ---------------------------------------------------------------------------

/**
 * Part types that participate in axial (top / bottom) stacking.
 * A top or bottom socket on any part should list these as accepted types
 * unless a more specific restriction applies.
 * @type {string[]}
 */
export const STACK_TYPES = Object.freeze([
  PartType.COMMAND_MODULE,
  PartType.COMPUTER_MODULE,
  PartType.SERVICE_MODULE,
  PartType.FUEL_TANK,
  PartType.ENGINE,
  PartType.STACK_DECOUPLER,
  PartType.PARACHUTE,
  PartType.SATELLITE,
]);

/**
 * Part types that attach radially (to the left or right side of a stack part).
 * A left or right socket should list these as accepted types.
 * @type {string[]}
 */
export const RADIAL_TYPES = Object.freeze([
  PartType.SOLID_ROCKET_BOOSTER,
  PartType.RADIAL_DECOUPLER,
  PartType.LANDING_LEGS,
  PartType.PARACHUTE,
  PartType.SERVICE_MODULE,
]);

// ---------------------------------------------------------------------------
// Snap-point factory
// ---------------------------------------------------------------------------

/**
 * Constructs a SnapPoint object.  Used inside part definitions to keep the
 * array entries concise.
 *
 * @param {'top'|'bottom'|'left'|'right'} side
 * @param {number} offsetX  Pixels right of centre (negative = left).
 * @param {number} offsetY  Pixels below centre   (negative = up).
 * @param {string[]} accepts  PartType values that may connect here.
 * @returns {SnapPoint}
 */
export function makeSnapPoint(side, offsetX, offsetY, accepts) {
  return { side, offsetX, offsetY, accepts: Array.from(accepts) };
}

// ---------------------------------------------------------------------------
// Part Catalog
// ---------------------------------------------------------------------------

/**
 * Authoritative list of every rocket part in the game.
 *
 * ORDER: Grouped by type for readability.  Within each group, parts are
 * ordered from smallest / cheapest to largest / most expensive.
 *
 * ADDING PARTS: Append to this array.  The array index has no gameplay
 * meaning — the `id` field is the stable reference used everywhere.
 *
 * @type {PartDef[]}
 */
export const PARTS = [
  // Parts are populated in TASK-004.
  // This array is intentionally empty here so the schema and utilities can be
  // tested and imported before the full catalog is ready.
];

// ---------------------------------------------------------------------------
// Lookup Utilities
// ---------------------------------------------------------------------------

/**
 * Internal index built once at module load time.
 * O(1) lookup by part ID.
 * @type {Map<string, PartDef>}
 */
const _partsById = new Map(PARTS.map((p) => [p.id, p]));

/**
 * Look up a single part definition by its stable string ID.
 *
 * @param {string} id  The part's `id` field.
 * @returns {PartDef|undefined}  The definition, or undefined if not found.
 */
export function getPartById(id) {
  return _partsById.get(id);
}

/**
 * Return all part definitions whose `type` matches the given PartType value.
 *
 * @param {string} type  A PartType enum value.
 * @returns {PartDef[]}  Possibly empty array — never throws.
 */
export function getPartsByType(type) {
  return PARTS.filter((p) => p.type === type);
}

/**
 * Return a shallow copy of the full parts catalog.
 * Callers should not mutate the returned array or any definition objects.
 *
 * @returns {PartDef[]}
 */
export function getAllParts() {
  return PARTS.slice();
}

/**
 * Return the IDs of all parts whose `type` matches the given PartType value.
 * Convenience wrapper used by the unlock system, which works with ID strings.
 *
 * @param {string} type  A PartType enum value.
 * @returns {string[]}
 */
export function getPartIdsByType(type) {
  return PARTS.filter((p) => p.type === type).map((p) => p.id);
}
