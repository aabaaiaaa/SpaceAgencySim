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

import { PartType, FuelType } from '../core/constants.js';

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
 * @property {string} [description]
 *   Short description of the part shown in the detail panel.
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
 *     - crashThreshold  {number}  Impact speed (m/s) the part can survive.
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

  // =========================================================================
  // COMMAND MODULES (crewed)
  // =========================================================================

  /**
   * Mk1 Command Module — single-seat crewed capsule.
   * Top is the nose (parachute may mount here); structural stack attaches below.
   * Built-in RCS lets the player orient the capsule for re-entry.
   * Ejector seat fires the crew clear in an emergency.
   */
  {
    id: 'cmd-mk1',
    name: 'Mk1 Command Module',
    description: 'A single-seat crewed capsule. Features built-in RCS for attitude control and an ejector seat for emergency crew escape. Mount a parachute on top for safe re-entry.',
    type: PartType.COMMAND_MODULE,
    mass: 840,
    cost: 8_000,
    width: 40,   // 2 m diameter
    height: 40,  // 2 m tall
    snapPoints: [
      // Nose — only a parachute may sit here.
      makeSnapPoint('top',    0, -20, [PartType.PARACHUTE]),
      // Underside — tanks, decouplers, etc. attach below.
      makeSnapPoint('bottom', 0,  20, STACK_TYPES),
      // Side radial sockets — parachutes, service modules, etc.
      makeSnapPoint('left',  -20,  0, RADIAL_TYPES),
      makeSnapPoint('right',  20,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'ejecting'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.EJECT,
    properties: {
      seats: 1,
      hasRcs: true,
      hasEjectorSeat: true,
      dragCoefficient: 0.2,
      heatTolerance: 2000,
      crashThreshold: 15,
    },
  },

  // =========================================================================
  // COMPUTER COMMAND MODULES (uncrewed)
  // =========================================================================

  /**
   * Probe Core Mk1 — lightweight avionics pod for uncrewed flights.
   * Mounts on top of the stack; nothing sits above it (no parachute socket).
   */
  {
    id: 'probe-core-mk1',
    name: 'Probe Core Mk1',
    description: 'A lightweight uncrewed avionics pod. Perfect for scientific probes and satellite missions that do not require a crew. No ejector seat or RCS.',
    type: PartType.COMPUTER_MODULE,
    mass: 50,
    cost: 5_000,
    width: 20,  // 1 m
    height: 10, // 0.5 m
    snapPoints: [
      // Top nose — parachutes can mount here.
      makeSnapPoint('top',    0, -5, [PartType.PARACHUTE]),
      // Bottom face — stack parts attach below.
      makeSnapPoint('bottom', 0,  5, STACK_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      hasRcs: false,
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 12,
    },
  },

  // =========================================================================
  // SERVICE MODULES
  // =========================================================================

  /**
   * Science Module Mk1 — carries experiments that collect data in flight.
   * Can be stacked axially (top/bottom) or mounted radially on the side of
   * the rocket for compact designs.  Activate to begin the timed experiment.
   */
  {
    id: 'science-module-mk1',
    name: 'Science Module Mk1',
    description: 'A science experiment module. Activate in flight to begin a timed data collection experiment. Can be stacked in-line or mounted radially on the side of the rocket.',
    type: PartType.SERVICE_MODULE,
    mass: 200,
    cost: 12_000,
    width: 30,  // 1.5 m
    height: 20, // 1 m
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
      makeSnapPoint('left',  -15,  0, RADIAL_TYPES),
      makeSnapPoint('right',  15,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'collecting'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.COLLECT_SCIENCE,
    properties: {
      experimentDuration: 30, // seconds
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 10,
    },
  },

  // =========================================================================
  // FUEL TANKS
  // =========================================================================

  /**
   * Small Tank — starter liquid propellant tank.
   * Left/right radial sockets accept SRBs, landing legs, parachutes, etc.
   */
  {
    id: 'tank-small',
    name: 'Small Tank',
    description: 'A small liquid propellant tank. Holds 400 kg of fuel for powering rocket engines. Lightweight for upper stages or small first stages.',
    type: PartType.FUEL_TANK,
    mass: 50,    // empty (dry) mass
    cost: 800,
    width: 20,   // 1 m
    height: 40,  // 2 m
    snapPoints: [
      makeSnapPoint('top',    0, -20, STACK_TYPES),
      makeSnapPoint('bottom', 0,  20, STACK_TYPES),
      makeSnapPoint('left',  -10, -12, RADIAL_TYPES),
      makeSnapPoint('left',  -10,   0, RADIAL_TYPES),
      makeSnapPoint('left',  -10,  12, RADIAL_TYPES),
      makeSnapPoint('right',  10, -12, RADIAL_TYPES),
      makeSnapPoint('right',  10,   0, RADIAL_TYPES),
      makeSnapPoint('right',  10,  12, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'empty'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      fuelMass: 400,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.05,
      heatTolerance: 1500,
      crashThreshold: 8,
    },
  },

  /**
   * Medium Tank — mid-tier liquid propellant tank.
   */
  {
    id: 'tank-medium',
    name: 'Medium Tank',
    description: 'A medium liquid propellant tank. Holds 1,800 kg of fuel. A versatile workhorse for first and upper stages of mid-sized rockets.',
    type: PartType.FUEL_TANK,
    mass: 100,
    cost: 1_600,
    width: 30,   // 1.5 m
    height: 60,  // 3 m
    snapPoints: [
      makeSnapPoint('top',    0, -30, STACK_TYPES),
      makeSnapPoint('bottom', 0,  30, STACK_TYPES),
      makeSnapPoint('left',  -15, -18, RADIAL_TYPES),
      makeSnapPoint('left',  -15,   0, RADIAL_TYPES),
      makeSnapPoint('left',  -15,  18, RADIAL_TYPES),
      makeSnapPoint('right',  15, -18, RADIAL_TYPES),
      makeSnapPoint('right',  15,   0, RADIAL_TYPES),
      makeSnapPoint('right',  15,  18, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'empty'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      fuelMass: 1_800,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.05,
      heatTolerance: 1500,
      crashThreshold: 8,
    },
  },

  /**
   * Large Tank — high-capacity liquid propellant tank for heavy rockets.
   */
  {
    id: 'tank-large',
    name: 'Large Tank',
    description: 'A large liquid propellant tank. Holds 8,000 kg of fuel. Essential for heavy rockets destined for orbit or beyond.',
    type: PartType.FUEL_TANK,
    mass: 200,
    cost: 3_200,
    width: 40,   // 2 m
    height: 100, // 5 m
    snapPoints: [
      makeSnapPoint('top',    0, -50, STACK_TYPES),
      makeSnapPoint('bottom', 0,  50, STACK_TYPES),
      makeSnapPoint('left',  -20, -30, RADIAL_TYPES),
      makeSnapPoint('left',  -20,   0, RADIAL_TYPES),
      makeSnapPoint('left',  -20,  30, RADIAL_TYPES),
      makeSnapPoint('right',  20, -30, RADIAL_TYPES),
      makeSnapPoint('right',  20,   0, RADIAL_TYPES),
      makeSnapPoint('right',  20,  30, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'empty'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      fuelMass: 8_000,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.05,
      heatTolerance: 1500,
      crashThreshold: 8,
    },
  },

  // =========================================================================
  // ENGINES — atmospheric / general purpose
  // =========================================================================

  /**
   * Spark Engine — small, lightweight first-stage engine.
   * Bottom snap point accepts only a stack decoupler, enforcing that it sits
   * at the bottom of a stage (nothing structural below the nozzle).
   */
  {
    id: 'engine-spark',
    name: 'Spark Engine',
    description: 'A small, lightweight first-stage engine. Throttleable for precise thrust control. Good efficiency for its size — ideal for smaller rockets and upper stages.',
    type: PartType.ENGINE,
    mass: 120,
    cost: 6_000,
    width: 20,  // 1 m
    height: 30, // 1.5 m
    snapPoints: [
      makeSnapPoint('top',    0, -15, STACK_TYPES),
      makeSnapPoint('bottom', 0,  15, [PartType.STACK_DECOUPLER]),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 60,
      thrustVac: 72,
      isp: 290,
      ispVac: 320,
      throttleable: true,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.1,
      heatTolerance: 2000,
      crashThreshold: 12,
    },
  },

  /**
   * Reliant Engine — large atmospheric workhorse engine.
   * Higher thrust than the Spark; bottom accepts full STACK_TYPES for
   * flexibility in multi-stage designs.
   */
  {
    id: 'engine-reliant',
    name: 'Reliant Engine',
    description: 'A large atmospheric workhorse engine. High thrust makes it ideal for heavy first stages. Fully throttleable for ascent profile control.',
    type: PartType.ENGINE,
    mass: 500,
    cost: 12_000,
    width: 30,  // 1.5 m
    height: 40, // 2 m
    snapPoints: [
      makeSnapPoint('top',    0, -20, STACK_TYPES),
      makeSnapPoint('bottom', 0,  20, STACK_TYPES),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 240,
      thrustVac: 270,
      isp: 310,
      ispVac: 345,
      throttleable: true,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.1,
      heatTolerance: 2000,
      crashThreshold: 12,
    },
  },

  // =========================================================================
  // ENGINES — upper-stage / low atmosphere
  // =========================================================================

  /**
   * Poodle Engine — high-efficiency upper-stage engine.
   * Better ISP than the Reliant; trades raw thrust for fuel economy at
   * altitude where atmospheric drag is minimal.
   */
  {
    id: 'engine-poodle',
    name: 'Poodle Engine',
    description: 'A high-efficiency upper-stage engine. Better ISP trades raw thrust for fuel economy at altitude where atmospheric drag is minimal.',
    type: PartType.ENGINE,
    mass: 180,
    cost: 9_000,
    width: 30,  // 1.5 m
    height: 30, // 1.5 m
    snapPoints: [
      makeSnapPoint('top',    0, -15, STACK_TYPES),
      makeSnapPoint('bottom', 0,  15, STACK_TYPES),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 64,
      thrustVac: 90,
      isp: 350,
      ispVac: 420,
      throttleable: true,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.1,
      heatTolerance: 2000,
      crashThreshold: 12,
    },
  },

  // =========================================================================
  // ENGINES — vacuum optimised
  // =========================================================================

  /**
   * Nerv Vacuum Engine — extreme ISP for deep-space / orbital manoeuvring.
   * Sea-level and vacuum ISP are identical (nozzle is fully optimised for
   * vacuum; performance degrades at sea level but not modelled separately).
   */
  {
    id: 'engine-nerv',
    name: 'Nerv Vacuum Engine',
    description: 'An extreme-efficiency vacuum engine. Outstanding ISP makes it ideal for deep-space missions and orbital manoeuvring. Performance degrades in thick atmosphere.',
    type: PartType.ENGINE,
    mass: 250,
    cost: 15_000,
    width: 20,  // 1 m
    height: 40, // 2 m
    snapPoints: [
      makeSnapPoint('top',    0, -20, STACK_TYPES),
      makeSnapPoint('bottom', 0,  20, STACK_TYPES),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 60,
      thrustVac: 60,
      isp: 800,
      ispVac: 800,
      throttleable: true,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.1,
      heatTolerance: 2000,
      crashThreshold: 12,
    },
  },

  // =========================================================================
  // SOLID ROCKET BOOSTERS
  // =========================================================================

  /**
   * SRB Small — compact solid booster for the first stage.
   * Attaches radially to the side of the main stack via left/right snap
   * points.  Not throttleable — burns at a fixed rate until empty.
   * The top snap point allows a nose fairing or small part to be mounted
   * directly above the booster.
   */
  {
    id: 'srb-small',
    name: 'SRB Small',
    description: 'A compact solid rocket booster. Attaches radially to boost first-stage thrust. Burns at a fixed rate until empty — cannot be throttled or shut down.',
    type: PartType.SOLID_ROCKET_BOOSTER,
    mass: 180,    // empty (dry) mass
    cost: 3_000,
    width: 20,   // 1 m diameter
    height: 80,  // 4 m tall
    snapPoints: [
      // Top of the booster (nose) — accepts lightweight stack parts above.
      makeSnapPoint('top',    0, -40, STACK_TYPES),
      // Radial attachment points — one for each side of the parent stack.
      // accepts: [] because nothing is dragged TO the SRB's radial face;
      // the parent stack's snap point accepts the SRB type instead.
      makeSnapPoint('right',  10,   0, []),
      makeSnapPoint('left',  -10,   0, []),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 180,
      thrustVac: 195,
      isp: 175,
      ispVac: 190,
      throttleable: false,
      fuelMass: 900,
      fuelType: FuelType.SOLID,
      dragCoefficient: 0.15,
      heatTolerance: 2000,
      crashThreshold: 10,
    },
  },

  /**
   * SRB Large — heavy solid booster for heavier first-stage lifts.
   */
  {
    id: 'srb-large',
    name: 'SRB Large',
    description: 'A heavy solid rocket booster. Provides massive first-stage thrust for heavy payloads. Cannot be throttled or stopped once ignited — plan your staging carefully.',
    type: PartType.SOLID_ROCKET_BOOSTER,
    mass: 360,
    cost: 6_000,
    width: 30,   // 1.5 m diameter
    height: 120, // 6 m tall
    snapPoints: [
      makeSnapPoint('top',    0, -60, STACK_TYPES),
      makeSnapPoint('right',  15,   0, []),
      makeSnapPoint('left',  -15,   0, []),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 360,
      thrustVac: 390,
      isp: 175,
      ispVac: 190,
      throttleable: false,
      fuelMass: 3_600,
      fuelType: FuelType.SOLID,
      dragCoefficient: 0.15,
      heatTolerance: 2000,
      crashThreshold: 10,
    },
  },

  // =========================================================================
  // DECOUPLERS
  // =========================================================================

  /**
   * Stack Decoupler TR-18 — in-line stage separation ring.
   * Sits between two stack sections and fires a one-shot separation charge
   * when the player activates staging.  Wide profile (40 px) to match a
   * standard 2 m rocket body.
   */
  {
    id: 'decoupler-stack-tr18',
    name: 'Stack Decoupler TR-18',
    description: 'A standard in-line stage separation ring. Fires a one-shot charge to separate two stack sections. Place between stages to shed dead weight as fuel runs out.',
    type: PartType.STACK_DECOUPLER,
    mass: 50,
    cost: 400,
    width: 40,  // 2 m — matches standard tank/capsule diameter
    height: 10, // 0.5 m (thin ring)
    snapPoints: [
      makeSnapPoint('top',    0,  -5, STACK_TYPES),
      makeSnapPoint('bottom', 0,   5, STACK_TYPES),
    ],
    animationStates: ['idle', 'separated'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.SEPARATE,
    properties: {
      dragCoefficient: 0.05,
      heatTolerance: 1500,
      crashThreshold: 6,
    },
  },

  /**
   * Radial Decoupler — bracket that mounts a radial part (SRB, landing leg)
   * to the side of the main stack and separates it on command.
   *
   * Snap point layout:
   *   left  — outer face: holds the attached radial part (SRB, etc.).
   *   right — inner face: attaches to the parent stack's radial socket.
   *
   * When placed on the LEFT of the main stack:
   *   parent.LEFT ↔ decoupler.RIGHT  (inner face to stack)
   *   decoupler.LEFT ↔ radial-part.RIGHT  (outer face to SRB etc.)
   */
  {
    id: 'decoupler-radial',
    name: 'Radial Decoupler',
    description: 'A bracket that mounts a radial part (SRB, landing leg) to the main stack and separates it on command. Use to jettison spent boosters or landing gear.',
    type: PartType.RADIAL_DECOUPLER,
    mass: 30,
    cost: 600,
    width: 10,  // 0.5 m
    height: 10, // 0.5 m
    snapPoints: [
      // Inner face — connects to the parent stack's radial snap point.
      // Nothing is ever dragged onto this face (stack accepts the decoupler),
      // so accepts is empty.
      makeSnapPoint('right',   5,  0, []),
      // Outer face — the radial part (SRB, leg, etc.) attaches here.
      makeSnapPoint('left',   -5,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'separated'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.SEPARATE,
    properties: {
      dragCoefficient: 0.05,
      heatTolerance: 1500,
      crashThreshold: 6,
    },
  },

  // =========================================================================
  // LANDING LEGS
  // =========================================================================

  /**
   * Small Landing Leg — lightweight retractable landing support.
   * Attaches radially; safe for rockets up to 2,000 kg total mass at landing.
   */
  {
    id: 'landing-legs-small',
    name: 'Small Landing Leg',
    description: 'Lightweight retractable landing legs. Extend before touchdown to cushion the landing. Safe for rockets up to 2,000 kg total mass at landing speed ≤10 m/s.',
    type: PartType.LANDING_LEGS,
    mass: 80,
    cost: 1_200,
    width: 10,  // 0.5 m
    height: 20, // 1 m
    snapPoints: [
      // Inner face — connects to parent stack's radial snap point.
      makeSnapPoint('right',   5,  0, []),
      makeSnapPoint('left',   -5,  0, []),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DEPLOY,
    properties: {
      maxSafeMass: 2_000,
      maxLandingSpeed: 10,
      dragCoefficient: 0.1,
      heatTolerance: 1200,
      crashThreshold: 25,
    },
  },

  /**
   * Large Landing Leg — heavy-duty retractable landing support.
   * Safe for rockets up to 8,000 kg total mass at landing.
   */
  {
    id: 'landing-legs-large',
    name: 'Large Landing Leg',
    description: 'Heavy-duty retractable landing legs. Built for heavier rockets up to 8,000 kg. Essential for propulsive landings of first-stage boosters.',
    type: PartType.LANDING_LEGS,
    mass: 180,
    cost: 2_000,
    width: 15,  // 0.75 m
    height: 30, // 1.5 m
    snapPoints: [
      makeSnapPoint('right',   7,  0, []),
      makeSnapPoint('left',   -7,  0, []),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DEPLOY,
    properties: {
      maxSafeMass: 8_000,
      maxLandingSpeed: 10,
      dragCoefficient: 0.1,
      heatTolerance: 1200,
      crashThreshold: 25,
    },
  },

  // =========================================================================
  // PARACHUTES
  // =========================================================================

  /**
   * Mk1 Parachute — light recovery chute for small capsules.
   * Can mount on top of a stack part (bottom face → capsule's top face) or
   * radially on the side of the rocket for symmetrical deployment.
   * Safe for re-entry masses up to 1,200 kg.
   */
  {
    id: 'parachute-mk1',
    name: 'Mk1 Parachute',
    description: 'A light recovery parachute for small capsules. Deploy during re-entry to slow descent. Mount on top of a command module or radially for symmetrical deployment.',
    type: PartType.PARACHUTE,
    mass: 100,
    cost: 400,
    width: 20,  // 1 m
    height: 10, // 0.5 m (stowed profile)
    snapPoints: [
      // Top — nothing mounts above the chute.
      makeSnapPoint('top',     0,  -5, []),
      // Bottom — mounts on top of a capsule or tank.
      makeSnapPoint('bottom',  0,   5, STACK_TYPES),
      // Side radial sockets — the chute's side connects to the stack.
      makeSnapPoint('right',  10,   0, []),
      makeSnapPoint('left',  -10,   0, []),
    ],
    animationStates: ['stowed', 'deploying', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DEPLOY,
    properties: {
      maxSafeMass: 1_200,
      maxLandingSpeed: 10,
      dragCoefficient: 0.05,   // stowed drag coefficient
      deployedDiameter: 20,    // m — fully-deployed canopy diameter (~314 m² area)
      deployedCd: 0.75,        // hemispherical canopy Cd when fully deployed
      heatTolerance: 1200,
      crashThreshold: 20,
    },
  },

  /**
   * Mk2 Parachute — heavy-duty recovery chute.
   * Safe for re-entry masses up to 4,000 kg.
   */
  {
    id: 'parachute-mk2',
    name: 'Mk2 Parachute',
    description: 'A heavy-duty recovery parachute for larger capsules. Can handle payloads up to 4,000 kg. Use multiple chutes for very heavy re-entry vehicles.',
    type: PartType.PARACHUTE,
    mass: 250,
    cost: 800,
    width: 30,  // 1.5 m
    height: 15, // 0.75 m (stowed)
    snapPoints: [
      makeSnapPoint('top',     0,  -7, []),
      makeSnapPoint('bottom',  0,   7, STACK_TYPES),
      makeSnapPoint('right',  15,   0, []),
      makeSnapPoint('left',  -15,   0, []),
    ],
    animationStates: ['stowed', 'deploying', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DEPLOY,
    properties: {
      maxSafeMass: 4_000,
      maxLandingSpeed: 10,
      dragCoefficient: 0.05,   // stowed drag coefficient
      deployedDiameter: 35,    // m — fully-deployed canopy diameter (~962 m² area)
      deployedCd: 0.75,        // hemispherical canopy Cd when fully deployed
      heatTolerance: 1200,
      crashThreshold: 20,
    },
  },

  // =========================================================================
  // SATELLITE PAYLOADS
  // =========================================================================

  /**
   * Satellite Mk1 — deployable satellite payload.
   * Stack-mounted; activate RELEASE to separate it into independent flight
   * (mission objective for satellite deployment missions).
   */
  {
    id: 'satellite-mk1',
    name: 'Satellite Mk1',
    description: 'A deployable satellite payload. Carry it to orbit and activate RELEASE to separate it into independent flight. Required for satellite deployment missions.',
    type: PartType.SATELLITE,
    mass: 300,
    cost: 20_000,
    width: 30,  // 1.5 m
    height: 20, // 1 m
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.RELEASE,
    properties: {
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 8,
    },
  },

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
