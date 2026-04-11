# Iteration 9 — Resource Generation & Transportation System

This iteration adds a complete resource extraction, processing, and automated transportation layer to SpaceAgencySim. Players mine resources from celestial bodies, refine them through processing chains, and automate transport via manually-proven routes. A new Logistics Center facility provides monitoring and route management.

This is the largest feature addition to date — it introduces new data types, core game logic, game loop integration, save/load support, and a full UI facility. Off-world bases, crew transport, life support supply chains, and NPC interactions are explicitly out of scope — they are future features that consume from this infrastructure.

---

## 1. Resource Data Model

### Resource Catalog (10 resources, 3 physical states)

| Resource | State | Sources | Primary Use |
|----------|-------|---------|-------------|
| Water Ice | Solid | MOON, MARS, CERES | Refine into H₂ + O₂; life support feedstock |
| Regolith | Solid | MOON, MARS | Refine into oxygen (low yield); future: construction |
| Iron Ore | Solid | CERES, MOON | Earth export (medium value) |
| Rare Metals | Solid | CERES | High-value Earth export |
| CO₂ | Gas | MARS atmosphere | Refine into methane + O₂ |
| Hydrogen | Gas | Refined from water; JUPITER, SATURN | Rocket fuel |
| Oxygen | Gas | Refined from water/CO₂/regolith; MARS | Oxidizer, life support |
| Helium-3 | Gas | MOON surface | Very high-value Earth export (fusion fuel) |
| Liquid Methane | Liquid | Refined from CO₂ + H₂; TITAN | Fuel alternative |
| Hydrazine | Liquid | Manufactured from H₂ (simplified) | Monopropellant / RCS fuel |

New enums in `src/core/constants.ts`: `ResourceType` (10 values), `ResourceState` (`SOLID`, `LIQUID`, `GAS`), `MiningModuleType` (10 values). All follow the existing `Object.freeze({} as const)` pattern.

New file `src/data/resources.ts`: immutable `ResourceDef` catalog with state, mass density, base value per kg, source body IDs, and extraction module type. Exports `RESOURCES` (array) and `RESOURCES_BY_ID` (record).

**Important codebase convention:** Body IDs are UPPERCASE strings matching the `CelestialBody` enum in constants.ts (e.g., `'MOON'`, `'MARS'`, `'CERES'`, `'TITAN'`). The resource catalog's `sources` arrays must use these uppercase IDs. Ceres (asteroid belt dwarf planet) is the primary asteroid mining body, but the system should be designed so that any landable body with a resource profile can be mined — including small asteroids if more asteroid bodies are added later.

### Body Resource Profiles

Each body in `src/data/bodies.ts` gains an optional `resourceProfile` field — an array of `{ resourceType, extractionRateKgPerPeriod, abundance }` entries. The `CelestialBodyDef` interface is extended with this optional field.

Bodies with resource profiles: MOON (water ice, regolith, iron ore, helium-3), MARS (water ice, regolith, CO₂, oxygen), CERES (iron ore, rare metals, water ice), TITAN (liquid methane), JUPITER (hydrogen), SATURN (hydrogen). Earth and Sun get no profiles.

**Codebase note:** The body catalog exports `CELESTIAL_BODIES` as a `Readonly<Record<string, CelestialBodyDef>>` — NOT an array. Access bodies via `CELESTIAL_BODIES['MOON']` or `getBodyDef('MOON')`, not via `.find()`.

### Cargo Module Parts (3 new parts)

| Part | Type | Carries | Capacity |
|------|------|---------|----------|
| Cargo Bay Mk1 | `CARGO_BAY` | Solids | 500 kg |
| Pressurized Tank Mk1 | `PRESSURIZED_TANK` | Gases | 300 kg |
| Cryo Tank Mk1 | `CRYO_TANK` | Liquids | 400 kg |

Three new `PartType` values added to constants.ts. Parts added to `PARTS` array and `STACK_TYPES` in `src/data/parts.ts`. Each has `properties.cargoCapacityKg` and `properties.cargoState` matching the `ResourceState` value.

### Mining Module Parts (9 new parts)

One new `PartType`: `MINING_MODULE`. All 9 mining parts use this type, differentiated by `properties.miningModuleType` matching the `MiningModuleType` enum.

| Module | MiningModuleType | Key Properties |
|--------|-----------------|----------------|
| Base Control Unit | BASE_CONTROL_UNIT | powerDraw: 10 |
| Mining Drill | MINING_DRILL | powerDraw: 25, extractionMultiplier: 1.0 |
| Gas Collector | GAS_COLLECTOR | powerDraw: 20, extractionMultiplier: 1.0 |
| Fluid Extractor | FLUID_EXTRACTOR | powerDraw: 30, extractionMultiplier: 1.0 |
| Refinery | REFINERY | powerDraw: 40, processingMultiplier: 1.0 |
| Storage Silo | STORAGE_SILO | powerDraw: 2, storageCapacityKg: 2000, storageState: SOLID |
| Pressure Vessel | PRESSURE_VESSEL | powerDraw: 5, storageCapacityKg: 1000, storageState: GAS |
| Fluid Tank | FLUID_TANK | powerDraw: 8, storageCapacityKg: 1500, storageState: LIQUID |
| Surface Launch Pad | SURFACE_LAUNCH_PAD | powerDraw: 50, launchCapacityKgPerPeriod: 200 |
| Power Generator (Solar) | POWER_GENERATOR | powerDraw: 0, powerOutput: 100 |

New `ActivationBehaviour` values: `MINE`, `LAUNCH_RESOURCES`. Added to the existing frozen object in `src/data/parts.ts` before the freeze.

---

## 2. Mining Sites

### Core Logic (`src/core/mining.ts`)

A mining site is created implicitly when a Base Control Unit lands on a body. The site is tied to that body and landing coordinates.

- **Proximity grouping:** Subsequent landings within `SITE_PROXIMITY_RADIUS` (constant, ~500 game units) of an existing site's Base Control Unit join that site. Landings outside this radius with a BCU create a new site.
- **Module placement:** Modules are added to a site when they land within its radius. Each module tracks its part ID, type, power draw, and pipe connections.
- **Pipe connections:** Built-in pipework — players toggle connections between modules at a site. All modules at a site are within connection range (the site boundary IS the connection boundary). Connections form a bidirectional adjacency graph.
- **Power budget:** `powerGenerated` vs `powerRequired` per site. Efficiency ratio = min(1.0, generated/required). Zero power = zero production.
- **Extraction:** Per period, each extractor module queries the body's resource profile for resources matching its extraction type. Output flows to connected storage modules of the matching state. Extraction rate scales with power efficiency and the part's extraction multiplier.
- **No maintenance:** Modules operate indefinitely once placed.

### Refinery Processing (`src/core/refinery.ts`)

Refineries transform resources using configured recipes. Each refinery module has one active recipe (or none).

| Recipe | Inputs | Outputs |
|--------|--------|---------|
| Water Electrolysis | 100 kg Water Ice | 11 kg Hydrogen + 89 kg Oxygen |
| Sabatier Process | 100 kg CO₂ + 8 kg Hydrogen | 33 kg Liquid Methane + 75 kg Oxygen |
| Regolith Electrolysis | 100 kg Regolith | 15 kg Oxygen |
| Hydrazine Synthesis | 50 kg Hydrogen | 40 kg Hydrazine |

Recipes are defined as immutable data (`REFINERY_RECIPES` array, `RECIPES_BY_ID` record). Processing checks input availability, consumes inputs, produces outputs — all scaled by power efficiency.

### Surface Launch Pad

Pulls resources from connected storage and transfers them to the site's `orbitalBuffer` — a per-resource-type accumulator that represents resources staged in orbit for automated route pickup. Transfer rate capped by `launchCapacityKgPerPeriod`, scaled by power efficiency.

### Mining Site State (GameState additions)

```typescript
interface MiningSiteModule {
  id: string;
  partId: string;
  type: MiningModuleType;
  powerDraw: number;
  connections: string[];    // bidirectional adjacency list
  recipeId?: string;        // REFINERY modules only
}

interface MiningSite {
  id: string;
  name: string;
  bodyId: string;
  coordinates: { x: number; y: number };
  controlUnit: { partId: string };
  modules: MiningSiteModule[];
  storage: Partial<Record<ResourceType, number>>;
  production: Partial<Record<ResourceType, number>>;
  powerGenerated: number;
  powerRequired: number;
  orbitalBuffer: Partial<Record<ResourceType, number>>;
}
```

Added to `GameState`: `miningSites: MiningSite[]` (default `[]`).

---

## 3. Routes & Automation

### Proving a Route Leg

When a player manually flies a craft from one location to another, the game records a **proven leg**: origin (body + surface/orbit + altitude), destination (body + surface/orbit + altitude), craft design ID, cargo capacity, and cost per run (derived from fuel usage).

- Cargo tanks don't need to be filled during proving — completing the trip is enough.
- Different craft designs require separate proving flights.
- Proven legs are stored in `gameState.provenLegs`.

### Route Assembly

Routes are assembled in the Logistics Center by chaining proven legs end-to-end.

- Each route carries a single resource type.
- Throughput bottleneck = minimum (leg capacity × craft count) across all legs.
- Routes start in `'paused'` status; player activates them.

### Automation Economics

- Each leg requires building at least one craft (full construction cost).
- Fixed cost per trip per craft per period (set at proving time).
- Additional craft can be assigned to a leg to multiply throughput (and cost).
- No risk — automated runs never fail.
- Revenue generated when resources are delivered to Earth (sold at base value per kg).

**Codebase note:** `spend(state, amount)` in `src/core/finance.ts` returns `boolean` (false if insufficient funds). Route processing must check this return value and handle insufficient funds (e.g., pause the route or skip the run).

### Route State (GameState additions)

```typescript
interface RouteLocation {
  bodyId: string;
  locationType: 'surface' | 'orbit';
  altitude?: number;
}

interface RouteLeg {
  id: string;
  origin: RouteLocation;
  destination: RouteLocation;
  craftDesignId: string;
  craftCount: number;
  cargoCapacityKg: number;
  costPerRun: number;
  provenFlightId: string;
}

interface Route {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'broken';
  resourceType: ResourceType;
  legs: RouteLeg[];
  throughputPerPeriod: number;
  totalCostPerPeriod: number;
}

interface ProvenLeg {
  id: string;
  origin: RouteLocation;
  destination: RouteLocation;
  craftDesignId: string;
  cargoCapacityKg: number;
  costPerRun: number;
  provenFlightId: string;
  dateProven: number;
}
```

Added to `GameState`: `provenLegs: ProvenLeg[]`, `routes: Route[]` (both default `[]`).

### Route Safety

When a player controls a craft involved in an active route:
- Warning displayed listing dependent routes.
- Safe orbit altitude range highlighted.
- Moving craft outside safe range breaks the route (status → `'broken'`).

Core logic: `getRouteDependencies(state, bodyId, altitude)` returns routes referencing that orbit. `getSafeOrbitRange(state, bodyId, altitude)` returns the min/max altitude range.

---

## 4. Logistics Center Facility

### Facility Definition

New `FacilityId.LOGISTICS_CENTER` in constants.ts. Added to `FACILITY_DEFINITIONS` with cost, science cost, and `starter: false`. Higher tiers unlock more simultaneous active routes.

### Panel 1 — Mining Sites (Systems Diagram)

Left sidebar: grouped list of celestial bodies with mining sites. Selecting a body shows all sites on that body.

Per-site diagram:
- Module boxes with type icon, status, and key metric (production rate for extractors, fill level for storage, recipe for refineries, orbital buffer for launch pads).
- Connection lines between piped modules.
- Site-level power budget display with visual warning on deficit.
- Refinery recipe selection (configurable from this view).

### Panel 2 — Route Management (Map + Table)

Top: Map showing bodies and active routes as directional lines.
Bottom: Table listing each route with name, resource type, legs summary, throughput, cost/period, revenue/period, status toggle.

- Create new routes by chaining proven legs.
- Assign additional craft to legs (triggers build cost).
- Pause/resume routes.

### Hub Integration

Add Logistics Center building to the hub layout in `src/ui/hub.ts`. Click handler opens the logistics panel.

### In-Flight Map Overlay

Toggleable overlay on the existing map view showing active routes as directional lines. Read-only — editing happens in the Logistics Center.

---

## 5. Contract Progression

12 new contracts using the existing contract system. Contracts unlock sequentially after all tutorial missions are complete.

| # | Contract | Objective | Unlocks |
|---|----------|-----------|---------|
| 1 | Lunar Survey | Land BCU + Drill on Moon | Mining site creation |
| 2 | First Harvest | Return 100kg water ice to Earth | Cargo modules |
| 3 | Expand Operations | Add silo + 2nd drill to lunar site | Pipe connections |
| 4 | Power Up | Deploy power generator | Power budget mechanic |
| 5 | Refining Basics | Deploy refinery, produce hydrogen | Refinery module |
| 6 | Launch Capability | Build surface launch pad | Orbital buffer |
| 7 | Orbital Storage | Place fuel depot in lunar orbit | Fuel depots |
| 8 | Automate It | Set up first automated route | Logistics Center facility |
| 9 | Gas Mining | Deploy gas collector on Mars | Gas collector, pressurized tank |
| 10 | Methane Production | Produce methane from CO₂ + H₂ | Multi-input recipes, cryo tank |
| 11 | Asteroid Prospecting | Extract rare metals from Ceres | Asteroid mining |
| 12 | Supply Network | 3+ active routes simultaneously | Multi-route management |

**Codebase note:** The existing contract system uses `CONTRACT_TEMPLATES` in `src/data/contracts.ts` with a `canGenerate()` / `generate()` pattern, not a static array. The resource contracts need to integrate with this generator pattern. After contract 8 is completed, the procedural generator should also produce resource delivery contracts.

---

## 6. Tech Tree

New "Logistics" branch added to the tech tree. The existing tech tree uses flat `TechNodeDef` entries in the `TECH_NODES` array (in `src/data/techtree.ts`), each with a `branch`, `tier`, `name`, `scienceCost`, `fundsCost`, and `unlocksParts` array. A new `TechBranch.LOGISTICS` value is needed in the `TechBranch` enum, plus a `BRANCH_NAMES` entry.

5 nodes across tiers 1-5:
1. Surface Mining (drill, BCU, silo, power generator)
2. Gas & Fluid Extraction (gas collector, fluid extractor, pressure vessel, fluid tank)
3. Refining & Processing (refinery, cargo bay, pressurized tank, cryo tank)
4. Surface Launch Systems (surface launch pad)
5. Automated Logistics (unlocks route automation feature)

---

## 7. Game Loop Integration

### Period Tick (`src/core/period.ts`)

Add resource processing to `advancePeriod()`, after existing steps (crew salaries, facility upkeep, contracts, satellites, training, surface ops, life support) but before the bankruptcy check:

1. `processMiningSites(state)` — extraction
2. `processRefineries(state)` — refinery processing
3. `processSurfaceLaunchPads(state)` — orbital buffer transfers
4. `processRoutes(state)` — automated transport and revenue

The `PeriodSummary` return type should be extended with resource system fields (mining revenue, route costs, etc.).

### Save/Load (`src/core/saveload.ts`)

The save/load system is async and slot-based: `saveGame(state, slotIndex, saveName)` → `Promise<SaveSlotSummary>`, `loadGame(slotIndex)` → `Promise<GameState>`. State is serialized to JSON, compressed, and stored in localStorage + IndexedDB.

The new `miningSites`, `provenLegs`, and `routes` arrays need to be included in serialization. Deserialization must default missing fields to `[]` for backwards compatibility with old saves. The `_validateState()` function does NOT need changes since it doesn't reject unknown fields, but `_validateNestedStructures()` could optionally validate mining site entries.

---

## 8. New Body Test Coverage

Four celestial bodies were added in a pre-iteration change (Ceres, Jupiter, Saturn, Titan). The general iteration tests in `bodies.test.ts` (field presence, hierarchy, weather) already cover them via `ALL_BODY_IDS` iteration. However, the specific property-value tests (surface gravity, atmosphere profiles, radius, GM) only cover the original 8 bodies. These should be extended to cover all 12 bodies for completeness.

---

## 9. Testing Strategy

- **TDD approach:** Write failing tests first, then implement, then verify.
- **Unit tests** for all core modules: `resources.test.ts`, `mining.test.ts`, `refinery.test.ts`, `routes.test.ts`.
- **Existing test extension:** `bodies.test.ts` extended for new body property coverage.
- **Save/load round-trip tests** added to verify persistence of new state fields. Must use the async `saveGame(state, slot)` / `loadGame(slot)` pattern with `await`.
- **E2E test** for basic mining deployment flow.
- **Verification per task:** Targeted test commands (single file), not full suite. Type-check changed files only where possible.

---

## 10. What This Iteration Does NOT Include

- **No off-world bases or habitats** — future feature consuming from this infrastructure
- **No crew transport or taxi service** — future feature
- **No life support supply chains** — future feature
- **No NPC craft interactions** — future feature
- **No bundle splitting** — the main chunk size warning is acknowledged but deferred
- **No route map rendering** in the in-flight overlay — placeholder only; full PixiJS route rendering is a visual polish task
