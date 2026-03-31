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

import { PartType, FuelType, RELIABILITY_TIERS, SatelliteType } from '../core/constants.js';

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

  /** Docking port: engage or disengage the docking mechanism. */
  DOCK: 'DOCK',

  /** Landing guidance computer: engage automated landing sequence. */
  AUTO_LAND: 'AUTO_LAND',

  /** Science lab: begin processing collected science data for bonus yield. */
  PROCESS_SCIENCE: 'PROCESS_SCIENCE',
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
 *
 * @property {number} [reliability]
 *   Base reliability rating (0.0 – 1.0).  Determines the probability that the
 *   part will NOT malfunction when checked (higher = more reliable).  Defaults
 *   to 1.0 (no malfunctions) if not specified.
 *   Starter parts: 0.92, Mid-tier: 0.96, High-tier: 0.98.
 *   Tech-tree upgrades add +0.02.
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
  PartType.DOCKING_PORT,
  PartType.HEAT_SHIELD,
  PartType.NOSE_CONE,
  PartType.BATTERY,
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
  PartType.DOCKING_PORT,
  PartType.SOLAR_PANEL,
  PartType.BATTERY,
  PartType.LAUNCH_CLAMP,
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
    reliability: RELIABILITY_TIERS.STARTER,
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
      batteryCapacity: 50,   // 50 Wh built-in battery
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
    reliability: RELIABILITY_TIERS.STARTER,
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
      batteryCapacity: 20,   // 20 Wh built-in battery
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 12,
    },
  },

  // =========================================================================
  // SERVICE MODULES
  // =========================================================================

  /**
   * Science Module Mk1 — instrument container for science experiments.
   * Has 2 instrument slots; the player chooses which instruments to load
   * in the VAB.  Each loaded instrument can be individually activated
   * during flight (via staging or the part context menu).
   * Can be stacked axially (top/bottom) or mounted radially on the side of
   * the rocket for compact designs.
   */
  {
    id: 'science-module-mk1',
    name: 'Science Module Mk1',
    description: 'A science instrument container with 2 slots. Load instruments in the VAB, then activate them individually in flight to collect data. Can be stacked in-line or mounted radially.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.STARTER,
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
      instrumentSlots: 2,
      powerDraw: 25,           // 25 W per active instrument
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
    reliability: RELIABILITY_TIERS.STARTER,
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
    reliability: RELIABILITY_TIERS.MID,
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
    reliability: RELIABILITY_TIERS.HIGH,
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
    reliability: RELIABILITY_TIERS.STARTER,
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
    reliability: RELIABILITY_TIERS.MID,
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
    reliability: RELIABILITY_TIERS.MID,
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
    reliability: RELIABILITY_TIERS.HIGH,
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
    reliability: RELIABILITY_TIERS.STARTER,
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
    reliability: RELIABILITY_TIERS.MID,
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
    reliability: RELIABILITY_TIERS.STARTER,
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
    reliability: RELIABILITY_TIERS.STARTER,
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
    reliability: RELIABILITY_TIERS.STARTER,
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
    reliability: RELIABILITY_TIERS.MID,
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
    reliability: RELIABILITY_TIERS.STARTER,
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
    reliability: RELIABILITY_TIERS.MID,
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
   * Satellite Mk1 — generic deployable satellite payload.
   * Stack-mounted; activate RELEASE to separate it into independent flight.
   * Has no satellite type — satisfies basic deployment contracts only.
   */
  {
    id: 'satellite-mk1',
    name: 'Satellite Mk1',
    description: 'A generic deployable satellite. Carry it to orbit and activate RELEASE to deploy. Includes built-in batteries and solar panels. Satisfies basic satellite deployment missions.',
    type: PartType.SATELLITE,
    reliability: RELIABILITY_TIERS.MID,
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
      batteryCapacity: 100,    // 100 Wh built-in battery
      solarPanelArea: 2.0,     // 2 m² built-in solar panels
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 8,
      builtInPower: true,
    },
  },

  /**
   * Communication Satellite — enables science data transmission from orbit.
   * Can operate in any orbit band. Built-in power (batteries + solar).
   */
  {
    id: 'satellite-comm',
    name: 'CommSat',
    description: 'A communication satellite. Enables science data transmission from orbit when deployed. Built-in batteries and solar panels — no power management needed. Valid in any orbit.',
    type: PartType.SATELLITE,
    reliability: RELIABILITY_TIERS.MID,
    mass: 350,
    cost: 30_000,
    width: 30,
    height: 20,
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.RELEASE,
    properties: {
      satelliteType: SatelliteType.COMMUNICATION,
      batteryCapacity: 120,
      solarPanelArea: 2.5,
      powerDraw: 15,           // comms power draw
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 8,
      builtInPower: true,
    },
  },

  /**
   * Weather Satellite — reduces weather-skip cost and improves forecast.
   * Must be deployed in LEO or MEO (Earth) / LLO or MLO (Moon).
   */
  {
    id: 'satellite-weather',
    name: 'WeatherSat',
    description: 'A weather observation satellite. Reduces weather-related launch skip cost and improves forecasts. Must operate in LEO or MEO. Built-in power.',
    type: PartType.SATELLITE,
    reliability: RELIABILITY_TIERS.MID,
    mass: 400,
    cost: 35_000,
    width: 30,
    height: 20,
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.RELEASE,
    properties: {
      satelliteType: SatelliteType.WEATHER,
      batteryCapacity: 130,
      solarPanelArea: 2.5,
      powerDraw: 20,           // weather instruments power draw
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 8,
      builtInPower: true,
    },
  },

  /**
   * Science Satellite — generates passive science points per period.
   * Can operate in any orbit band.
   */
  {
    id: 'satellite-science',
    name: 'SciSat',
    description: 'A science research satellite. Generates passive science points each period while operational. Valid in any orbit. Built-in power.',
    type: PartType.SATELLITE,
    reliability: RELIABILITY_TIERS.MID,
    mass: 450,
    cost: 40_000,
    width: 30,
    height: 20,
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.RELEASE,
    properties: {
      satelliteType: SatelliteType.SCIENCE,
      batteryCapacity: 150,
      solarPanelArea: 3.0,
      powerDraw: 25,           // science instruments power draw
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 8,
      builtInPower: true,
    },
  },

  /**
   * GPS/Navigation Satellite — widens landing threshold, improves recovery.
   * Must be deployed in MEO (Earth) / MLO (Moon). Needs 3+ for full benefit.
   */
  {
    id: 'satellite-gps',
    name: 'NavSat',
    description: 'A GPS/navigation satellite. Widens safe landing thresholds and improves recovery profitability. Must operate in MEO. Needs 3+ for constellation bonus. Built-in power.',
    type: PartType.SATELLITE,
    reliability: RELIABILITY_TIERS.MID,
    mass: 500,
    cost: 45_000,
    width: 30,
    height: 20,
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.RELEASE,
    properties: {
      satelliteType: SatelliteType.GPS,
      batteryCapacity: 140,
      solarPanelArea: 2.5,
      powerDraw: 18,           // GPS transponder power draw
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 8,
      builtInPower: true,
    },
  },

  /**
   * Relay Satellite — extends deep-space communications range.
   * Must be deployed in HEO (Earth) / HLO (Moon).
   */
  {
    id: 'satellite-relay',
    name: 'RelaySat',
    description: 'A deep-space relay satellite. Extends communication range for interplanetary missions. Must operate in HEO or HLO. Built-in power.',
    type: PartType.SATELLITE,
    reliability: RELIABILITY_TIERS.MID,
    mass: 550,
    cost: 50_000,
    width: 30,
    height: 20,
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.RELEASE,
    properties: {
      satelliteType: SatelliteType.RELAY,
      batteryCapacity: 160,
      solarPanelArea: 3.0,
      powerDraw: 30,           // high-power relay transponder
      dragCoefficient: 0.1,
      heatTolerance: 1500,
      crashThreshold: 8,
      builtInPower: true,
    },
  },

  // =========================================================================
  // DOCKING PORTS
  // =========================================================================

  /**
   * Standard Docking Port — connects two vessels in orbit.
   * Attachable both axially (top/bottom) and radially (left/right).
   * The extended probe extends away from the craft for easier alignment.
   * When docked, the two vessels share a single physics body with combined
   * centre of mass.
   */
  {
    id: 'docking-port-std',
    name: 'Docking Port',
    description: 'Standard docking port for connecting two vessels in orbit. Attachable radially or in-line. Features an extendable probe for easier alignment and a guidance system. Enables orbital assembly, crew transfer, and fuel transfer.',
    type: PartType.DOCKING_PORT,
    reliability: RELIABILITY_TIERS.MID,
    mass: 80,
    cost: 15_000,
    width: 24,   // 1.2 m
    height: 16,  // 0.8 m
    snapPoints: [
      // Dock face — only another docking port can connect here (in flight).
      // In the VAB this acts as a structural top connector.
      makeSnapPoint('top',    0, -8,  STACK_TYPES),
      // Attach to rocket body — stack or radial.
      makeSnapPoint('bottom', 0,  8,  STACK_TYPES),
      // Radial mount sockets on the sides.
      makeSnapPoint('left',  -12, 0,  RADIAL_TYPES),
      makeSnapPoint('right',  12, 0,  RADIAL_TYPES),
    ],
    animationStates: ['retracted', 'extended', 'docked'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DOCK,
    properties: {
      /** Docking port size class — must match for two ports to dock. */
      portSize: 'STANDARD',
      /** Whether the port extends a probe outward for alignment. */
      hasProbe: true,
      /** Extension distance in metres when probe is extended. */
      probeExtension: 1.0,
      dragCoefficient: 0.05,
      heatTolerance: 1800,
      crashThreshold: 10,
    },
  },

  /**
   * Small Docking Port — compact variant for lightweight craft.
   * Lighter and cheaper, but only docks with other small ports.
   */
  {
    id: 'docking-port-small',
    name: 'Docking Port Jr.',
    description: 'A compact docking port for small probes and lightweight craft. Only connects to other small docking ports. Lighter and cheaper than the standard port.',
    type: PartType.DOCKING_PORT,
    reliability: RELIABILITY_TIERS.MID,
    mass: 30,
    cost: 8_000,
    width: 16,   // 0.8 m
    height: 10,  // 0.5 m
    snapPoints: [
      makeSnapPoint('top',    0, -5, STACK_TYPES),
      makeSnapPoint('bottom', 0,  5, STACK_TYPES),
      makeSnapPoint('left',  -8,  0, RADIAL_TYPES),
      makeSnapPoint('right',  8,  0, RADIAL_TYPES),
    ],
    animationStates: ['retracted', 'extended', 'docked'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DOCK,
    properties: {
      portSize: 'SMALL',
      hasProbe: true,
      probeExtension: 0.6,
      dragCoefficient: 0.03,
      heatTolerance: 1800,
      crashThreshold: 8,
    },
  },

  // =========================================================================
  // HEAT SHIELDS
  // =========================================================================

  /**
   * Heat Shield Mk1 — small ablative heat shield for lightweight probes.
   * Placed at the bottom of the stack (below decoupler), nose-down during
   * reentry. Protects all parts above it in the stack from atmospheric heating.
   * Single-use: stage it off after reentry via the decoupler above.
   */
  {
    id: 'heat-shield-mk1',
    name: 'Heat Shield Mk1',
    description: 'Small ablative heat shield for probes and lightweight craft. Rated for Low Earth Orbit reentry only. Protects parts above it from atmospheric heating. Mount below a decoupler and stage off after reentry.',
    type: PartType.HEAT_SHIELD,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 80,
    cost: 4_000,
    width: 24,   // 1.2 m — matches small probe/tank width
    height: 8,   // 0.4 m thin disc
    snapPoints: [
      makeSnapPoint('top',    0, -4, STACK_TYPES),
      makeSnapPoint('bottom', 0,  4, STACK_TYPES),
    ],
    animationStates: ['intact', 'charred'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      heatTolerance: 3000,
      dragCoefficient: 0.35,
      crashThreshold: 12,
    },
  },

  /**
   * Heat Shield Mk2 — standard ablative heat shield for crewed capsules.
   * Wider coverage for command modules and larger stacks. High thermal
   * tolerance allows survival of aggressive reentry profiles.
   */
  {
    id: 'heat-shield-mk2',
    name: 'Heat Shield Mk2',
    description: 'Standard ablative heat shield for crewed capsules and medium craft. Rated for Earth orbital and Lunar return reentry speeds. Wide coverage protects the full stack above from extreme atmospheric heating.',
    type: PartType.HEAT_SHIELD,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 150,
    cost: 8_000,
    width: 40,   // 2 m — matches command module width
    height: 10,  // 0.5 m thin disc
    snapPoints: [
      makeSnapPoint('top',    0, -5, STACK_TYPES),
      makeSnapPoint('bottom', 0,  5, STACK_TYPES),
    ],
    animationStates: ['intact', 'charred'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      heatTolerance: 3500,
      dragCoefficient: 0.40,
      crashThreshold: 15,
    },
  },

  /**
   * Solar Heat Shield — advanced ablative shield for close solar approach.
   * Uses exotic refractory composites to withstand the extreme radiant heat
   * near the Sun.  The `solarHeatResistance` property reduces solar proximity
   * heat by 80 %, enabling inner-corona science missions.  Very heavy and
   * expensive — a late-game item.  Tech tree: Recovery T5.
   */
  {
    id: 'heat-shield-solar',
    name: 'Solar Heat Shield',
    description: 'Exotic refractory heat shield designed for close solar approach. Rated for solar corona proximity. Blocks 80% of solar radiation heat, enabling science missions into the inner corona. Extremely heavy — plan your delta-v budget carefully.',
    type: PartType.HEAT_SHIELD,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 300,
    cost: 50_000,
    width: 40,   // 2 m — matches command module width
    height: 12,  // 0.6 m thick disc
    snapPoints: [
      makeSnapPoint('top',    0, -6, STACK_TYPES),
      makeSnapPoint('bottom', 0,  6, STACK_TYPES),
    ],
    animationStates: ['intact', 'charred'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      heatTolerance: 6000,
      solarHeatResistance: 0.8,
      dragCoefficient: 0.45,
      crashThreshold: 15,
    },
  },

  /**
   * Heat Shield Heavy — heavy-duty heat shield for interplanetary reentry.
   * Required for Mars and Venus atmospheric entries, which involve much
   * higher velocities than Earth orbital returns.  Heavier than the Mk2
   * but still lighter than the Solar shield.  Tech tree: Recovery T5.
   */
  {
    id: 'heat-shield-heavy',
    name: 'Heat Shield Heavy',
    description: 'Heavy-duty ablative heat shield rated for interplanetary reentry. Required for Mars and Venus atmospheric entries where velocities far exceed Earth orbital returns. Heavier than the Mk2 but essential for safe planetary return.',
    type: PartType.HEAT_SHIELD,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 220,
    cost: 18_000,
    width: 44,   // 2.2 m — wider than Mk2 for heavier craft
    height: 12,  // 0.6 m thick disc
    snapPoints: [
      makeSnapPoint('top',    0, -6, STACK_TYPES),
      makeSnapPoint('bottom', 0,  6, STACK_TYPES),
    ],
    animationStates: ['intact', 'charred'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      heatTolerance: 4500,
      dragCoefficient: 0.42,
      crashThreshold: 15,
    },
  },

  // =========================================================================
  // PROPULSION — Tech Tree Upgrades
  // =========================================================================

  /**
   * Spark II Engine — improved version of the starter Spark.
   * Better specific impulse and slightly more thrust.
   * Tech tree: Propulsion T1.
   */
  {
    id: 'engine-spark-improved',
    name: 'Spark II Engine',
    description: 'An upgraded Spark engine with improved combustion efficiency. Better ISP and slightly more thrust than the original — a solid step up for upper stages.',
    type: PartType.ENGINE,
    reliability: RELIABILITY_TIERS.MID,
    mass: 135,
    cost: 9_000,
    width: 20,
    height: 30,
    snapPoints: [
      makeSnapPoint('top',    0, -15, STACK_TYPES),
      makeSnapPoint('bottom', 0,  15, [PartType.STACK_DECOUPLER]),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 75,
      thrustVac: 90,
      isp: 320,
      ispVac: 360,
      throttleable: true,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.1,
      heatTolerance: 2200,
      crashThreshold: 12,
    },
  },

  /**
   * IX-6 Ion Engine — extremely high ISP, very low thrust.
   * Uses integrated xenon propellant supply (electric fuel type).
   * Ideal for long-duration probes and deep-space transfers.
   * Nearly useless in atmosphere; designed for vacuum operation.
   * Tech tree: Propulsion T4.
   */
  {
    id: 'engine-ion',
    name: 'IX-6 Ion Engine',
    description: 'An ion propulsion system with extreme fuel efficiency. Very low thrust but outstanding ISP makes it ideal for deep-space probes. Includes integrated xenon supply. Nearly useless in atmosphere.',
    type: PartType.ENGINE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 60,
    cost: 25_000,
    width: 16,
    height: 20,
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, [PartType.STACK_DECOUPLER]),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 0.5,
      thrustVac: 4,
      isp: 100,
      ispVac: 4200,
      throttleable: true,
      fuelType: FuelType.ELECTRIC,
      fuelMass: 30,
      dragCoefficient: 0.05,
      heatTolerance: 1200,
      crashThreshold: 8,
    },
  },

  /**
   * Deep Space Engine — high-ISP engine for interplanetary transfers.
   * Bridges the gap between the Nerv (high thrust, moderate ISP) and the
   * Ion engine (extreme ISP, near-zero thrust).  Designed for crewed
   * deep-space missions where the Ion engine is too slow but the Nerv
   * is too fuel-hungry.  Tech tree: Propulsion T5.
   */
  {
    id: 'engine-deep-space',
    name: 'Deep Space Engine',
    description: 'A high-efficiency deep space engine optimised for interplanetary transfers. 1200s ISP bridges the gap between conventional and ion propulsion, with enough thrust for crewed missions. Performance degrades significantly in atmosphere.',
    type: PartType.ENGINE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 300,
    cost: 50_000,
    width: 24,  // 1.2 m
    height: 44, // 2.2 m
    snapPoints: [
      makeSnapPoint('top',    0, -22, STACK_TYPES),
      makeSnapPoint('bottom', 0,  22, [PartType.STACK_DECOUPLER]),
    ],
    animationStates: ['idle', 'firing', 'burnt-out'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.IGNITE,
    properties: {
      thrust: 5,
      thrustVac: 15,
      isp: 400,
      ispVac: 1200,
      throttleable: true,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.1,
      heatTolerance: 2200,
      crashThreshold: 10,
    },
  },

  // =========================================================================
  // NOSE CONES
  // =========================================================================

  /**
   * AE-FF1 Nose Cone — aerodynamic fairing that reduces drag.
   * Mounts on top of SRBs, fuel tanks, or any stack part.
   * Purely passive — no activation.
   * Tech tree: Structural T2.
   */
  {
    id: 'nose-cone',
    name: 'AE-FF1 Nose Cone',
    description: 'An aerodynamic nose fairing that reduces drag during atmospheric ascent. Mount on top of boosters or exposed stack parts for a cleaner profile.',
    type: PartType.NOSE_CONE,
    reliability: RELIABILITY_TIERS.STARTER,
    mass: 15,
    cost: 150,
    width: 20,
    height: 20,
    snapPoints: [
      // Nose tip — nothing mounts above.
      makeSnapPoint('top',    0, -10, []),
      // Base — attaches on top of a stack part.
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      dragCoefficient: 0.01,
      dragReduction: 0.3,
      heatTolerance: 1500,
      crashThreshold: 6,
    },
  },

  // =========================================================================
  // STRUCTURAL — Tech Tree Additions
  // =========================================================================

  /**
   * Structural Tube — empty structural connector with no fuel.
   * Provides separation between stages or adapts diameters.
   * Tech tree: Structural T3.
   */
  {
    id: 'tube-connector',
    name: 'Structural Tube',
    description: 'A hollow structural connector that separates stages or bridges different diameters. No fuel capacity — purely structural. Lightweight and cheap.',
    type: PartType.FUEL_TANK,
    reliability: RELIABILITY_TIERS.MID,
    mass: 30,
    cost: 300,
    width: 30,
    height: 30,
    snapPoints: [
      makeSnapPoint('top',    0, -15, STACK_TYPES),
      makeSnapPoint('bottom', 0,  15, STACK_TYPES),
      makeSnapPoint('left',  -15,  0, RADIAL_TYPES),
      makeSnapPoint('right',  15,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      fuelMass: 0,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.03,
      heatTolerance: 1500,
      crashThreshold: 10,
    },
  },

  // =========================================================================
  // STATION MODULES — Tech Tree Structural T5
  // =========================================================================

  /**
   * Station Habitat Module — pressurised living quarters for orbital stations.
   * Houses up to 4 crew members and includes built-in RCS for attitude control.
   * Large and heavy — designed for assembly in orbit via docking ports.
   * Tech tree: Structural T5.
   */
  {
    id: 'station-habitat',
    name: 'Station Habitat Module',
    description: 'A pressurised habitation module for orbital stations. Houses up to 4 crew with life support. Includes built-in RCS. Designed for orbital assembly via docking.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 3_000,
    cost: 60_000,
    width: 40,
    height: 80,
    snapPoints: [
      makeSnapPoint('top',    0, -40, STACK_TYPES),
      makeSnapPoint('bottom', 0,  40, STACK_TYPES),
      makeSnapPoint('left',  -20, -24, RADIAL_TYPES),
      makeSnapPoint('left',  -20,   0, RADIAL_TYPES),
      makeSnapPoint('left',  -20,  24, RADIAL_TYPES),
      makeSnapPoint('right',  20, -24, RADIAL_TYPES),
      makeSnapPoint('right',  20,   0, RADIAL_TYPES),
      makeSnapPoint('right',  20,  24, RADIAL_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      seats: 4,
      hasRcs: true,
      batteryCapacity: 200,    // 200 Wh built-in battery
      dragCoefficient: 0.15,
      heatTolerance: 2000,
      crashThreshold: 8,
    },
  },

  /**
   * Station Truss Segment — structural backbone for orbital stations.
   * Provides multiple attachment points for modules, solar panels, etc.
   * No fuel capacity — purely structural framework.
   * Tech tree: Structural T5.
   */
  {
    id: 'station-truss',
    name: 'Station Truss Segment',
    description: 'A structural truss for orbital station assembly. Provides the backbone framework with multiple attachment points for modules and equipment. No fuel capacity.',
    type: PartType.FUEL_TANK,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 500,
    cost: 25_000,
    width: 40,
    height: 40,
    snapPoints: [
      makeSnapPoint('top',    0, -20, STACK_TYPES),
      makeSnapPoint('bottom', 0,  20, STACK_TYPES),
      makeSnapPoint('left',  -20, -12, RADIAL_TYPES),
      makeSnapPoint('left',  -20,  12, RADIAL_TYPES),
      makeSnapPoint('right',  20, -12, RADIAL_TYPES),
      makeSnapPoint('right',  20,  12, RADIAL_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      fuelMass: 0,
      fuelType: FuelType.LIQUID,
      dragCoefficient: 0.08,
      heatTolerance: 1500,
      crashThreshold: 10,
    },
  },

  // =========================================================================
  // PARACHUTES — Tech Tree Additions
  // =========================================================================

  /**
   * Drogue Chute — high-altitude pre-deployment parachute.
   * Deploys at supersonic speeds to stabilise descent before main
   * chute deployment. Use alongside a main parachute for safe recovery.
   * Tech tree: Recovery T2.
   */
  {
    id: 'parachute-drogue',
    name: 'Drogue Chute',
    description: 'A high-speed drogue parachute that deploys at supersonic speeds and high altitudes. Stabilises and pre-slows the craft before main chute deployment. Best used alongside a main parachute.',
    type: PartType.PARACHUTE,
    reliability: RELIABILITY_TIERS.MID,
    mass: 60,
    cost: 500,
    width: 15,
    height: 8,
    snapPoints: [
      makeSnapPoint('top',     0, -4, []),
      makeSnapPoint('bottom',  0,  4, STACK_TYPES),
      makeSnapPoint('right',   7,  0, []),
      makeSnapPoint('left',   -7,  0, []),
    ],
    animationStates: ['stowed', 'deploying', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DEPLOY,
    properties: {
      maxSafeMass: 2_000,
      maxLandingSpeed: 25,
      highAltitudeDeploy: true,
      maxDeploySpeed: 400,
      dragCoefficient: 0.03,
      deployedDiameter: 8,
      deployedCd: 0.45,
      heatTolerance: 1500,
      crashThreshold: 15,
    },
  },

  // =========================================================================
  // RECOVERY MODULES — Tech Tree Additions
  // =========================================================================

  /**
   * Landing Guidance Computer — automated landing system.
   * Activatable during the FLIGHT phase while descending toward any body.
   * Automates the landing sequence, consuming fuel normally.
   * Works on all bodies with and without atmospheres.
   * No malfunctions — always reliable. Bypasses piloting skill bonuses.
   * Tech tree: Recovery T4.
   */
  {
    id: 'landing-legs-powered',
    name: 'Landing Guidance Computer',
    description: 'An automated landing guidance system. Activate during descent to let the computer handle the landing sequence. Consumes fuel normally. Works on all bodies — atmosphere or vacuum. Bypasses piloting skill bonuses.',
    type: PartType.SERVICE_MODULE,
    reliability: 1.0,
    mass: 150,
    cost: 30_000,
    width: 20,
    height: 15,
    snapPoints: [
      makeSnapPoint('top',    0,  -7, STACK_TYPES),
      makeSnapPoint('bottom', 0,   7, STACK_TYPES),
      makeSnapPoint('left',  -10,  0, RADIAL_TYPES),
      makeSnapPoint('right',  10,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'active'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.AUTO_LAND,
    properties: {
      autoLand: true,
      bypassesPilotingBonus: true,
      noMalfunctions: true,
      dragCoefficient: 0.05,
      heatTolerance: 1800,
      crashThreshold: 10,
    },
  },

  /**
   * Booster Recovery Module — enables autonomous booster recovery.
   * Attach to a booster stage; when decoupled, the booster automatically
   * lands safely off-screen and the recovered parts enter inventory.
   * Tech tree: Recovery T5.
   */
  {
    id: 'booster-reusable',
    name: 'Booster Recovery Module',
    description: 'Autonomous recovery system for booster stages. When a booster with this module is decoupled, it automatically lands safely off-screen. Recovered parts return to your inventory.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 250,
    cost: 25_000,
    width: 15,
    height: 20,
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
      makeSnapPoint('left',  -7,   0, RADIAL_TYPES),
      makeSnapPoint('right',  7,   0, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'recovering'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      autoRecover: true,
      dragCoefficient: 0.1,
      heatTolerance: 2000,
      crashThreshold: 15,
    },
  },

  // =========================================================================
  // SCIENCE LAB — Tech Tree Science T4
  // =========================================================================

  // =========================================================================
  // SOLAR PANELS
  // =========================================================================

  /**
   * OX-STAT Solar Panel — small fixed solar panel for probes and satellites.
   * Generates power when sunlit. Mount radially on the side of the craft.
   * Lightweight and inexpensive — good for small probes.
   */
  {
    id: 'solar-panel-small',
    name: 'OX-STAT Solar Panel',
    description: 'A compact fixed solar panel that generates electricity when sunlit. Mount radially on your craft. Ideal for small probes and satellites that need modest power.',
    type: PartType.SOLAR_PANEL,
    reliability: RELIABILITY_TIERS.MID,
    mass: 10,
    cost: 2_000,
    width: 20,   // 1 m
    height: 8,   // 0.4 m
    snapPoints: [
      makeSnapPoint('left',  -10,  0, []),
      makeSnapPoint('right',  10,  0, RADIAL_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      solarPanelArea: 1.0,     // 1 m² panel area
      dragCoefficient: 0.02,
      heatTolerance: 1200,
      crashThreshold: 5,
    },
  },

  /**
   * Gigantor XL Solar Array — large deployable solar array.
   * High power output for stations and large satellites.
   * Mount radially for best coverage.
   * Tech tree: Electrical T3.
   */
  {
    id: 'solar-panel-large',
    name: 'Gigantor XL Solar Array',
    description: 'A large deployable solar array with high power output. Essential for orbital stations and power-hungry satellites. Mount radially for best sun exposure.',
    type: PartType.SOLAR_PANEL,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 60,
    cost: 8_000,
    width: 40,   // 2 m
    height: 10,  // 0.5 m
    snapPoints: [
      makeSnapPoint('left',  -20,  0, []),
      makeSnapPoint('right',  20,  0, RADIAL_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      solarPanelArea: 4.0,     // 4 m² panel area
      dragCoefficient: 0.04,
      heatTolerance: 1000,
      crashThreshold: 3,
    },
  },

  // =========================================================================
  // BATTERIES
  // =========================================================================

  /**
   * Z-100 Battery Pack — small rechargeable battery.
   * Stores power for eclipse periods. Lightweight, suitable for probes.
   */
  {
    id: 'battery-small',
    name: 'Z-100 Battery Pack',
    description: 'A small rechargeable battery that stores electrical energy for use during eclipse. Essential for custom satellites and probes without built-in power.',
    type: PartType.BATTERY,
    reliability: RELIABILITY_TIERS.MID,
    mass: 5,
    cost: 1_000,
    width: 10,
    height: 10,
    snapPoints: [
      makeSnapPoint('top',    0, -5, STACK_TYPES),
      makeSnapPoint('bottom', 0,  5, STACK_TYPES),
      makeSnapPoint('left',  -5,  0, []),
      makeSnapPoint('right',  5,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      batteryCapacity: 100,    // 100 Wh
      dragCoefficient: 0.02,
      heatTolerance: 1200,
      crashThreshold: 8,
    },
  },

  /**
   * Z-400 Battery Bank — large rechargeable battery.
   * High capacity for stations and power-intensive missions.
   * Tech tree: Electrical T2.
   */
  {
    id: 'battery-large',
    name: 'Z-400 Battery Bank',
    description: 'A high-capacity rechargeable battery bank. Stores ample electrical energy for orbital stations and long eclipse periods. Heavier but essential for power-hungry craft.',
    type: PartType.BATTERY,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 20,
    cost: 3_500,
    width: 16,
    height: 16,
    snapPoints: [
      makeSnapPoint('top',    0, -8, STACK_TYPES),
      makeSnapPoint('bottom', 0,  8, STACK_TYPES),
      makeSnapPoint('left',  -8,  0, []),
      makeSnapPoint('right',  8,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      batteryCapacity: 400,    // 400 Wh
      dragCoefficient: 0.03,
      heatTolerance: 1200,
      crashThreshold: 8,
    },
  },

  // =========================================================================
  // SCIENCE LAB — Tech Tree Science T4
  // =========================================================================

  /**
   * Science Lab Module — orbital laboratory for processing science data.
   * Takes collected science data and processes it over time to generate
   * additional science points. Must be in orbit to function.
   * Tech tree: Science T4.
   */
  {
    id: 'science-lab',
    name: 'Science Lab Module',
    description: 'An orbital research laboratory. Processes collected science data over time to generate additional science points. Must be in a stable orbit to function. Larger and heavier than standard science modules.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 2_500,
    cost: 45_000,
    width: 40,
    height: 60,
    snapPoints: [
      makeSnapPoint('top',    0, -30, STACK_TYPES),
      makeSnapPoint('bottom', 0,  30, STACK_TYPES),
      makeSnapPoint('left',  -20, -15, RADIAL_TYPES),
      makeSnapPoint('left',  -20,  15, RADIAL_TYPES),
      makeSnapPoint('right',  20, -15, RADIAL_TYPES),
      makeSnapPoint('right',  20,  15, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'processing'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.PROCESS_SCIENCE,
    properties: {
      instrumentSlots: 4,
      scienceProcessingRate: 2,
      scienceMultiplier: 1.5,
      requiresOrbit: true,
      powerDraw: 40,           // 40 W when processing
      dragCoefficient: 0.12,
      heatTolerance: 1800,
      crashThreshold: 8,
    },
  },

  // =========================================================================
  // PHASE 6 — Deep Space & Surface Operations
  // =========================================================================

  /**
   * Extended Mission Module — life support extension for long-duration missions.
   * When present on a crewed craft, crew life support becomes infinite —
   * no supply countdown.  Binary check: one module = infinite support,
   * does not stack.  Passive — no activation needed.
   * Tech tree: Recovery T4.
   */
  {
    id: 'mission-module-extended',
    name: 'Extended Mission Module',
    description: 'A self-sustaining life support module for long-duration crewed missions. When attached, crew supplies become unlimited — no more supply countdown. One module is sufficient; additional modules have no extra effect.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 500,
    cost: 30_000,
    width: 30,   // 1.5 m
    height: 40,  // 2 m
    snapPoints: [
      makeSnapPoint('top',    0, -20, STACK_TYPES),
      makeSnapPoint('bottom', 0,  20, STACK_TYPES),
      makeSnapPoint('left',  -15,  0, RADIAL_TYPES),
      makeSnapPoint('right',  15,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      extendedLifeSupport: true,
      powerDraw: 15,           // 15 W continuous
      dragCoefficient: 0.1,
      heatTolerance: 1800,
      crashThreshold: 10,
    },
  },

  /**
   * Sample Return Container — sealed container for surface samples.
   * Fits in a science module slot.  Stores collected surface samples for
   * return to Earth where they provide bonus science yield.
   * Tech tree: Science T3.
   */
  {
    id: 'sample-return-container',
    name: 'Sample Return Container',
    description: 'A sealed container for storing surface samples collected during landed operations. Return samples to Earth for bonus science yield. Lightweight and compact — fits alongside other science instruments.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 100,
    cost: 15_000,
    width: 20,   // 1 m
    height: 16,  // 0.8 m
    snapPoints: [
      makeSnapPoint('top',    0, -8, STACK_TYPES),
      makeSnapPoint('bottom', 0,  8, STACK_TYPES),
      makeSnapPoint('left',  -10,  0, RADIAL_TYPES),
      makeSnapPoint('right',  10,  0, RADIAL_TYPES),
    ],
    animationStates: ['idle', 'collecting', 'sealed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.COLLECT_SCIENCE,
    properties: {
      sampleContainer: true,
      sampleCapacity: 3,
      instrumentSlots: 0,
      powerDraw: 0,
      dragCoefficient: 0.05,
      heatTolerance: 2000,
      crashThreshold: 12,
    },
  },

  /**
   * Surface Instrument Package — deployable surface science station.
   * Deployed on the surface of a celestial body to collect long-term
   * science data.  Once deployed, it cannot be recovered but continues
   * generating science points passively each period.
   * Tech tree: Science T3.
   */
  {
    id: 'surface-instrument-package',
    name: 'Surface Instrument Package',
    description: 'A deployable surface science station. Land on any body and deploy to establish a permanent science outpost. Generates passive science data each period. Cannot be recovered once deployed.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 200,
    cost: 25_000,
    width: 24,   // 1.2 m
    height: 20,  // 1 m
    snapPoints: [
      makeSnapPoint('top',    0, -10, STACK_TYPES),
      makeSnapPoint('bottom', 0,  10, STACK_TYPES),
      makeSnapPoint('left',  -12,  0, RADIAL_TYPES),
      makeSnapPoint('right',  12,  0, RADIAL_TYPES),
    ],
    animationStates: ['stowed', 'deploying', 'deployed'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.DEPLOY,
    properties: {
      surfaceStation: true,
      sciencePerPeriod: 3,
      requiresLanded: true,
      powerDraw: 10,           // 10 W when deployed
      dragCoefficient: 0.08,
      heatTolerance: 1500,
      crashThreshold: 8,
    },
  },

  /**
   * Relay Antenna — extends deep-space communication range.
   * Provides interplanetary communication links, bridging distances
   * between planetary systems.  A craft carrying a relay antenna
   * maintains its own connection back to the agency.
   * Tech tree: Structural T4.
   */
  {
    id: 'relay-antenna',
    name: 'Relay Antenna',
    description: 'A high-gain relay antenna for deep space communications. Bridges interplanetary distances, extending mission range far beyond Earth orbit. A craft carrying this antenna maintains its own connection back to the agency.',
    type: PartType.SERVICE_MODULE,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 80,
    cost: 20_000,
    width: 24,   // 1.2 m
    height: 30,  // 1.5 m
    snapPoints: [
      makeSnapPoint('top',    0, -15, STACK_TYPES),
      makeSnapPoint('bottom', 0,  15, STACK_TYPES),
      makeSnapPoint('left',  -12,  0, RADIAL_TYPES),
      makeSnapPoint('right',  12,  0, RADIAL_TYPES),
    ],
    animationStates: ['stowed', 'deployed'],
    activatable: false,
    activationBehaviour: ActivationBehaviour.NONE,
    properties: {
      relayAntenna: true,
      deepSpaceComms: true,
      powerDraw: 20,           // 20 W when active
      dragCoefficient: 0.06,
      heatTolerance: 1200,
      crashThreshold: 6,
    },
  },

  // =========================================================================
  // LAUNCH CLAMPS
  // =========================================================================

  /**
   * Launch Clamp — ground-mounted support that holds the rocket on the pad
   * until explicitly released via staging.
   *
   * Attaches radially to the lower portion of the rocket.  When staged
   * (SEPARATE behaviour), the clamp swings away from the rocket and is
   * removed from the active assembly — it is NOT carried into flight.
   *
   * Requires Launch Pad Tier 3 to use.  The clamp prevents launch until the
   * stage containing it is fired — the player must position the clamp in
   * the correct stage to release the rocket.
   *
   * Zero fuel mass, zero drag — clamps are ground-only infrastructure.
   */
  {
    id: 'launch-clamp-1',
    name: 'TT18-A Launch Stability Clamp',
    description: 'A ground-mounted stabilizer that holds the rocket firmly on the pad until staged. Swings away on release. Requires Launch Pad Tier 3.',
    type: PartType.LAUNCH_CLAMP,
    reliability: RELIABILITY_TIERS.HIGH,
    mass: 0,
    cost: 500,
    width: 20,
    height: 60,
    snapPoints: [
      // Attaches to the right side of a rocket stack (the clamp "grabs" the rocket).
      makeSnapPoint('right', 10, 0, STACK_TYPES),
    ],
    animationStates: ['clamped', 'releasing', 'released'],
    activatable: true,
    activationBehaviour: ActivationBehaviour.SEPARATE,
    properties: {
      dragCoefficient: 0,
      heatTolerance: 3000,
      crashThreshold: 50,
      isLaunchClamp: true,
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
