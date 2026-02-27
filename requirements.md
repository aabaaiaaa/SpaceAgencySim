# Requirements: Space Agency Simulation Game

A browser-based 2D space agency simulation game with pixel art visuals (placeholder rectangles during initial build), realistic physics, rocket building, mission progression, crew management, and financial management.

---

### TASK-001: Project Setup & Architecture
- **Status**: done
- **Priority**: high
- **Dependencies**: none
- **Description**: Set up the browser project structure. Use Vite as the build tool for ES module support and fast dev iteration. Separate core game logic (plain JavaScript modules, no DOM/canvas dependency) from the rendering layer so that logic can be unit tested headlessly. Use PixiJS for 2D canvas rendering. Structure directories as: `/src/core/` for game logic, `/src/render/` for PixiJS rendering, `/src/ui/` for HTML overlay UI, `/src/data/` for part and mission definitions, `/src/tests/` for all test files. Entry point is `index.html`. Include a `package.json` with dev and build scripts.

---

### TASK-002: Core Game State & Data Models
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001
- **Description**: Define the central in-memory game state object and all data model types (via JSDoc or TypeScript). State includes: `money` (number), `loan` (object: balance, interestRate), `crew` (array of astronaut records), `missions` (object: available, accepted, completed arrays), `rockets` (array of saved rocket designs), `parts` (array of unlocked part IDs), `flightHistory` (array of flight result records), `playTimeSeconds` (number), `currentFlight` (nullable flight state object). All game systems read from and write to this single state object. Define enums/constants for part types, mission states, and crew statuses.

---

### TASK-003: Part Definitions System
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001
- **Description**: Build the extensible parts data structure in `/src/data/parts.js`. Each part definition is a plain object with fields: `id` (string), `name` (string), `type` (enum: COMMAND_MODULE, COMPUTER_MODULE, SERVICE_MODULE, FUEL_TANK, ENGINE, SOLID_ROCKET_BOOSTER, STACK_DECOUPLER, RADIAL_DECOUPLER, LANDING_LEGS, PARACHUTE, SATELLITE), `mass` (kg, dry), `cost` (dollars), `width` (px at base scale), `height` (px at base scale), `snapPoints` (array of objects: `{ side: 'top'|'bottom'|'left'|'right', offsetX, offsetY, accepts: [type array] }`), `animationStates` (array of state name strings, e.g. `['idle', 'firing', 'deployed']`), `activatable` (boolean), `activationBehaviour` (string enum), `properties` (object for type-specific values like thrust, fuelCapacity, dragCoefficient, heatTolerance, etc.). The system must make it straightforward to add new parts later by adding entries to this file only.

---

### TASK-004: Initial Parts Library
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-003
- **Description**: Define all starting parts in `/src/data/parts.js` using the schema from TASK-003. All parts render as labelled rectangles until artwork is provided. Part list and properties:

  **Command Modules (crewed):**
  - Mk1 Command Module: mass 840kg, cost $8,000, seats 1, has RCS, has ejector seat, snap: top (accepts nothing), bottom (accepts stack parts)

  **Computer Command Modules (uncrewed):**
  - Probe Core Mk1: mass 50kg, cost $5,000, no crew, snap: top/bottom

  **Service Modules:**
  - Science Module Mk1: mass 200kg, cost $12,000, experiment duration 30s, snap: top/bottom/left/right radially

  **Fuel Tanks:**
  - Small Tank: mass empty 50kg, fuel mass 400kg, cost $800, snap: top/bottom
  - Medium Tank: mass empty 100kg, fuel mass 1,800kg, cost $1,600, snap: top/bottom
  - Large Tank: mass empty 200kg, fuel mass 8,000kg, cost $3,200, snap: top/bottom

  **Engines (atmospheric):**
  - Spark Engine (small): mass 120kg, cost $6,000, thrust 60kN, Isp 290s, throttleable, snap: top (stack), bottom (accepts decoupler)
  - Reliant Engine (large): mass 500kg, cost $12,000, thrust 240kN, Isp 310s, throttleable, snap: top, bottom

  **Engines (upper-stage / low atmosphere):**
  - Poodle Engine: mass 180kg, cost $9,000, thrust 64kN, Isp 350s, throttleable, snap: top, bottom

  **Engines (vacuum):**
  - Nerv Vacuum Engine: mass 250kg, cost $15,000, thrust 60kN, Isp 800s, throttleable, snap: top, bottom

  **Solid Rocket Boosters:**
  - SRB Small: mass empty 180kg, fuel mass 900kg, cost $3,000, thrust 180kN, fixed burn rate, snap: top (accepts parts above), radial attach point on side
  - SRB Large: mass empty 360kg, fuel mass 3,600kg, cost $6,000, thrust 360kN, fixed burn rate, snap: top, radial attach

  **Decouplers:**
  - Stack Decoupler TR-18: mass 50kg, cost $400, snap: top/bottom
  - Radial Decoupler: mass 30kg, cost $600, snap: radial side of parent, holds attached part

  **Landing Legs:**
  - Small Landing Leg: mass 80kg, cost $1,200, max landing mass 2,000kg, snap: radial sides
  - Large Landing Leg: mass 180kg, cost $2,000, max landing mass 8,000kg, snap: radial sides

  **Parachutes:**
  - Mk1 Parachute: mass 100kg, cost $400, max safe mass 1,200kg, snap: top or radial
  - Mk2 Parachute: mass 250kg, cost $800, max safe mass 4,000kg, snap: top or radial

  **Satellite Payloads:**
  - Satellite Mk1: mass 300kg, cost $20,000, snap: top/bottom

---

### TASK-005: Financial System
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-002
- **Description**: Implement the financial system in `/src/core/finance.js`. Starting values: loan balance $2,000,000, starting cash $2,000,000 (the loan proceeds), interest rate 3% per completed mission. After each mission is completed and the player returns to the space agency, apply interest: `loanBalance *= 1.03`. Functions: `applyInterest()`, `payDownLoan(amount)` (reduces balance, deducts from cash, cannot exceed balance or available cash), `borrowMore(amount)` (increases balance and cash, max borrow limit $10,000,000 total), `spend(amount)` (returns false if insufficient funds), `earn(amount)`, `applyDeathFine()` ($500,000 per astronaut KIA, deducted from cash). Enforce that cash cannot go below $0 for spend operations. The loan does not have a due date — the game does not end if you owe money — but interest accumulates every mission indefinitely.

---

### TASK-006: Save/Load System
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-002
- **Description**: Implement save/load in `/src/core/saveload.js`. Support up to 5 named save slots in localStorage (keys: `spaceAgencySave_0` through `spaceAgencySave_4`). Each slot stores full serialised game state as JSON. Functions: `saveGame(slotIndex, saveName)`, `loadGame(slotIndex)` returns full state object, `deleteSave(slotIndex)`, `listSaves()` returns array of slot summaries. Each slot summary includes: saveName, timestamp, missionsCompleted, money, acceptedMissionCount, totalFlights, crewCount, crewKIA, playTimeSeconds. Also implement `exportSave(slotIndex)` (download JSON file) and `importSave(jsonString, slotIndex)` (parse and validate before writing). Track `playTimeSeconds` by recording session start time and accumulating on each save.

---

### TASK-007: Main Menu & Load Screen
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-006
- **Description**: The game entry screen. If any save slots contain data, show the load screen by default. Display each save slot as a card showing: save name, date saved, missions completed, money (formatted), accepted missions, total flights, crew count, crew KIA, time played (formatted as h:mm:ss). Actions per slot: Load, Delete, Export. A separate "Import Save" button accepts a JSON file upload. A "New Game" button starts a fresh state (prompts for agency name). If no saves exist, show the New Game screen directly. New Game sets starting state: cash $2,000,000, loan $2,000,000, no crew, no accepted missions, only initial tutorial missions available, only starter parts unlocked.

---

### TASK-008: Space Agency Hub View
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-001, TASK-002
- **Description**: Render the space agency hub as a 2D side-on scene using PixiJS. The scene is a fixed-width landscape: a horizontal ground line with a flat desert-coloured ground below and a blue sky above. Four placeholder rectangle buildings sit on the ground, spaced apart, each with a descriptive label: "Launch Pad", "Vehicle Assembly Building", "Mission Control Centre", "Crew Administration". Each building is clickable and navigates to its corresponding game screen. The top bar (TASK-009) is rendered as an HTML overlay at the top of the viewport. No scrolling needed for the hub view — all buildings fit in one screen. Desert ground colour: sandy tan (`#C2A165`). Sky colour: light blue (`#87CEEB`).

---

### TASK-009: Top Bar & Loan Modal
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-005, TASK-008
- **Description**: HTML overlay top bar visible on all screens (hub, VAB, mission control, crew admin, flight). Left side: agency name. Centre: current cash displayed as `$X,XXX,XXX`. Right side: hamburger menu button. Clicking the cash amount opens the loan modal. The loan modal shows: outstanding loan balance, current interest rate (3% per mission), estimated interest on next mission completion, total interest paid to date. Two action buttons: "Pay Down Loan" (input field for amount, validates against available cash) and "Borrow More" (input field, validates against max borrow limit). The menu button opens a dropdown: Save Game (opens save slot picker), Load Game (goes to load screen), Exit to Menu (returns to load/menu screen after confirming unsaved progress warning).

---

### TASK-010: Crew Data Model & History
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-002
- **Description**: Define the astronaut data model in `/src/core/crew.js`. Each astronaut record: `id` (UUID), `name` (string), `hireDate` (ISO string), `status` ('active' | 'fired' | 'kia'), `missionsFlown` (number), `flightsFlown` (number), `deathDate` (nullable ISO string), `deathCause` (nullable string). Functions: `hireCrew(name)` (costs $50,000, deducted via finance system, adds to state.crew), `fireCrew(id)` (sets status to 'fired', no cost), `recordKIA(id, cause)` (sets status to 'kia', records date/cause, triggers $500,000 fine via finance system), `assignToCrew(astronautId, rocketId)`, `unassignCrew(astronautId)`, `getActiveCrew()`, `getFullHistory()`. All records are persisted in game state — KIA and fired crew remain in history permanently.

---

### TASK-011: Crew Administration Building
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-010, TASK-008
- **Description**: UI screen for the Crew Administration building. Three tabs: Active Crew, Hire, History. Active Crew tab lists all astronauts with status 'active', showing name, missions flown, flights flown, and a "Fire" button per astronaut. Hire tab shows a "Hire Astronaut" form with a name field (auto-generates a random name if left blank) and the hire cost ($50,000). Displays current cash so player can see affordability. History tab lists all crew ever hired (active, fired, and KIA), sorted by hire date descending. KIA entries are visually distinguished (red text or a skull marker). Each row shows: name, hire date, missions flown, status, and for KIA: date and cause.

---

### TASK-012: Mission Data Model & Unlock Tree
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-002
- **Description**: Define the mission data structure in `/src/data/missions.js`. Each mission: `id` (string), `title` (string), `description` (string), `location` ('desert'), `objectives` (array of objective objects), `reward` (dollars), `unlocksAfter` (array of mission IDs that must be completed before this appears as available), `unlockedParts` (array of part IDs unlocked upon completion), `status` ('locked' | 'available' | 'accepted' | 'completed'). Each objective: `id` (string), `type` (enum: REACH_ALTITUDE, REACH_SPEED, SAFE_LANDING, ACTIVATE_PART, HOLD_ALTITUDE, RETURN_SCIENCE_DATA, CONTROLLED_CRASH, EJECT_CREW, RELEASE_SATELLITE, REACH_ORBIT), `target` (type-specific value object), `completed` (boolean), `description` (string). Implement in `/src/core/missions.js`: `getAvailableMissions()`, `acceptMission(id)`, `checkObjectiveCompletion(flightState)` called each physics tick, `completeMission(id)`, `getUnlockedMissions()`, `getUnlockedParts()`.

---

### TASK-013: Tutorial Mission Set (Desert R&D)
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-012, TASK-004
- **Description**: Define all tutorial missions in `/src/data/missions.js`. Missions are gated so only the first is available at game start. Each subsequent mission or group unlocks after its prerequisites. Mission list with rewards and unlocks:

  1. **First Flight** ($15,000) — Reach 100m altitude. Unlocks: Mission 2, Small Tank (already available), Spark Engine (already available). Available from start. One mission at a time enforced for missions 1–4.
  2. **Higher Ambitions** ($20,000) — Reach 500m altitude. Unlocks: Mission 3.
  3. **Breaking the Kilometre** ($25,000) — Reach 1,000m altitude. Unlocks: Mission 4.
  4. **Speed Test Alpha** ($30,000) — Reach 150 m/s horizontal speed. Unlocks: Missions 5, 6, 7 simultaneously (multiple missions now available).
  5. **Safe Return I** ($35,000) — Perform a safe parachute landing (rocket or capsule lands at <10 m/s). Unlocks: Mk2 Parachute part, Mission 8.
  6. **Controlled Descent** ($40,000) — Land using only engine thrust, no parachutes (landing speed <5 m/s with engines firing). Unlocks: Small Landing Leg part.
  7. **Leg Day** ($40,000) — Deploy landing legs and land safely. Unlocks: Large Landing Leg part, Mission 9.
  8. **Black Box Test** ($50,000) — Perform a controlled crash (impact >50 m/s) with a Science Module attached; module must survive. Unlocks: Mission 10.
  9. **Ejector Seat Test** ($45,000) — Activate ejector seat with a crewed command module at altitude >200m. Unlocks: Mission 11.
  10. **Science Experiment Alpha** ($60,000) — Activate Science Module, hold altitude between 800m–1,200m for 30 seconds, land safely with module intact (data returned). Unlocks: Mission 12, Poodle Engine part.
  11. **Emergency Systems Verified** ($55,000) — Complete both Mission 8 and Mission 9 before this unlocks: test ejector seat during a controlled crash scenario. Unlocks: Mission 13.
  12. **Stage Separation Test** ($80,000) — Build and fly a two-stage rocket, fire a stack decoupler mid-flight above 2,000m. Unlocks: Mission 14, Reliant Engine part, SRB Small part.
  13. **High Altitude Record** ($100,000) — Reach 20,000m altitude. Unlocks: Mission 15.
  14. **Karman Line Approach** ($200,000) — Reach 60,000m altitude. Unlocks: Mission 16, Vacuum Engine (Nerv) part, SRB Large part.
  15. **Satellite Deployment Test** ($150,000) — Release a Satellite Mk1 payload above 30,000m altitude. Unlocks: Mission 17.
  16. **Low Earth Orbit** ($500,000) — Reach orbital altitude (>80,000m) and achieve horizontal speed >7,800 m/s (approximate LEO). Unlocks: end of current scope — show a congratulations screen. Unlocks Large Tank part, Reliant Engine.
  17. **Orbital Satellite Deployment** ($300,000) — Reach orbit and release a Satellite Mk1. Requires Mission 15 and Mission 16 completed.

---

### TASK-014: Mission Control UI
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-012, TASK-008
- **Description**: UI screen for the Mission Control Centre building. Three tabs: Available, Accepted, Completed. Available tab lists all missions with status 'available': shows title, description, reward, and an "Accept" button. During the early tutorial (missions 1–4), only one mission can be accepted at a time — the Accept button is disabled for other missions if one is already active. After mission 4 is completed, multiple missions can be accepted simultaneously. Accepted tab lists currently accepted missions with their objectives, showing each objective description and a checkmark or pending indicator. Completed tab lists all completed missions with date completed and reward received. Mission unlock state is recalculated each time this screen is opened.

---

### TASK-015: Rocket Builder — Layout & Parts Panel
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001, TASK-004
- **Description**: Implement the VAB (Vehicle Assembly Building) screen. Layout: a scrollable main build canvas occupying most of the screen, a parts panel on the right side, and a toolbar at the top. The parts panel lists all unlocked parts grouped by type, each shown as a small labelled rectangle with part name, mass, and cost. The toolbar shows: current cash, a "View Accepted Missions" button (opens a side panel listing active mission objectives), a "Rocket Engineer" button (opens the validation panel from TASK-019), and a "Launch" button (disabled until validation passes). A vertical scale bar is rendered on the left side of the build canvas showing metres, calculated from the actual part dimensions at the current zoom level (1 pixel = 0.05 metres at default zoom). The canvas background is a grid with subtle lines.

---

### TASK-016: Rocket Builder — Drag & Drop & Snap System
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-015, TASK-003
- **Description**: Implement part placement in `/src/core/rocketbuilder.js` and `/src/render/vab.js`. Clicking a part in the parts panel starts a drag. While dragging, the part follows the cursor as a labelled rectangle. Valid snap targets on already-placed parts are highlighted when the dragged part is within snapping distance (30px). Snap points are defined per part in TASK-003 — a top snap point accepts connections from a bottom snap point of a compatible part, and vice versa. Radial snap points on the sides accept radially-attachable parts. On drop near a valid snap point, the part snaps into position and a connection is registered in the rocket's part graph. Parts already placed can be picked up and moved. Right-clicking a placed part while in builder offers "Remove Part" (refunds cost). The rocket is stored as a directed graph of connected parts with each edge storing the snap point pairing.

---

### TASK-017: Rocket Builder — Symmetry Snapping
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-016
- **Description**: When placing a part onto a radial (left or right side) snap point, show a "Mirror?" prompt or toggle button. If symmetry is on (default for radial placements), automatically place a mirrored copy of the part on the opposite side radial snap point of the same parent part, if that snap point is free. Both parts are added to the rocket graph simultaneously. Removing one mirrored part asks if the user wants to remove both. Symmetry applies to: landing legs, SRBs attached radially, radial decouplers, parachutes placed radially. Symmetry only applies to pairs (2-way). No 3- or 4-way symmetry needed for this scope.

---

### TASK-018: Rocket Builder — Staging Configuration
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-016
- **Description**: A staging panel in the VAB showing numbered stages (Stage 1 is fired first, higher numbers later). Activatable parts placed on the rocket (engines, SRBs, decouplers, parachutes) appear in an "Unstaged Parts" pool. The player drags parts from the pool into stage slots to assign them. Parts can be moved between stages. A "+" button adds a new stage. An empty stage can be deleted. The staging order visually shows Stage 1 at the bottom (first to fire) and higher stages above. In flight, pressing spacebar fires the current stage and advances to the next. Stage configuration is saved with the rocket design. Validate that at least one engine or SRB is in Stage 1 (warn if not — it won't lift off).

---

### TASK-019: Rocket Builder — Validation & Launch
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-018, TASK-005
- **Description**: Implement the Rocket Engineer validation panel in `/src/core/rocketvalidator.js`. Checks performed: (1) At least one command module (crewed or computer) is connected. (2) All parts are connected to the root command module via the part graph (no floating parts). (3) At least one engine or SRB is in Stage 1. (4) Stage 1 TWR > 1.0: calculate total mass of all parts (dry mass + fuel mass) and total Stage 1 thrust, divide to get TWR. Display the TWR value numerically. (5) Warn (not block) if a crewed mission is accepted but only a computer module is present. Display each check as pass/fail with a short message. The Launch button is enabled only when checks 1–4 pass. On launch, if the rocket has any crewed command modules with empty seats, show a crew selection dialog listing available active crew. Each seat can be assigned an astronaut or left empty. Confirm launches the flight scene.

---

### TASK-020: Flight Physics Engine
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-002, TASK-004
- **Description**: Implement the physics simulation in `/src/core/physics.js`. Use a fixed timestep integration loop (dt = 1/60s, scaled by time warp). Each tick: (1) Calculate total rocket mass (sum of all connected part masses including remaining fuel). (2) Calculate net thrust: sum of thrust from all currently firing engines/SRBs, multiplied by current throttle (SRBs ignore throttle). Simplified symmetric thrust — all thrust treated as acting along the rocket's current orientation axis regardless of engine placement. (3) Apply gravity: 9.81 m/s² downward, constant (simplified — no orbital gravity model needed until LEO objective detection). (4) Apply atmospheric drag: `dragForce = 0.5 * airDensity(altitude) * velocity² * dragCoefficient * crossSectionalArea`. Drag opposes velocity direction. (5) Integrate: `acceleration = (thrustVector + dragVector + gravityVector) / totalMass`. Update velocity and position. (6) For steering: A/D keys apply a rotation rate to the rocket's orientation (slow turn, always available without RCS). In vacuum (altitude > 70,000m), if the rocket has RCS-capable command modules, turn rate is increased by a fixed multiplier (×2.5). RCS is simplified — no directionality or placement needed. (7) Throttle controlled by W/S keys (or Up/Down arrows), range 0–100%, adjusts in 5% increments per keypress. Spacebar fires next stage.

---

### TASK-021: Atmosphere & Reentry Heat Model
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-020
- **Description**: Implement in `/src/core/atmosphere.js`. Air density curve (approximate): sea level = 1.225 kg/m³, decreasing exponentially. Use: `density(alt) = 1.225 * exp(-alt / 8500)`. Effective vacuum above 70,000m (density < 0.0001 kg/m³). Terminal velocity at any altitude: `vTerminal = sqrt(2 * mass * g / (density * Cd * area))` — used as a soft speed cap when descending (drag automatically enforces this; no hard clamp needed). Reentry heat: when altitude < 70,000m and speed > 1,500 m/s, apply heat to parts. Heat rate per tick: `heatRate = (speed - 1500) * density * 0.01`. Each part has a `currentHeat` value that accumulates. Parts have a `heatTolerance` property (default 1200 units for structural parts, 3000 for heat shields if added later). When `currentHeat` exceeds `heatTolerance`, the part is destroyed (removed from the rocket graph). Heat is applied primarily to the part at the leading face of travel. Heat dissipates slowly when conditions ease: `currentHeat -= 5 per tick` when not in reentry conditions.

---

### TASK-022: Fuel System & Engine Thrust
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-020, TASK-004
- **Description**: Implement in `/src/core/fuelsystem.js`. Each tank part in the rocket graph tracks `remainingFuel` (kg). Engines draw from tanks connected to them in the same segment (same side of all decouplers as the engine). Implement `getConnectedTanks(enginePartId, rocketGraph)` which traverses the part graph upward from the engine, stopping at any decoupler — only tanks in this traversal are fuel sources. Fuel consumption rate per engine: `fuelFlowRate = (thrust * throttle) / (Isp * 9.81)` kg/s. Each tick, deduct `fuelFlowRate * dt` from connected tanks (drain evenly across multiple connected tanks). When a tank reaches 0, it stops contributing. When all connected tanks are empty, the engine produces 0 thrust. Part mass is updated live as fuel drains: `partMass = dryMass + remainingFuel`. SRBs have a fixed `burnRate` (kg/s) regardless of throttle — they fire at full thrust until empty. When an SRB empties, it stops firing. Detached parts (after decoupler fires) retain their fuel state but are no longer simulated for thrust.

---

### TASK-023: Flight Staging & Decoupler Logic
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-022, TASK-018
- **Description**: Implement in `/src/core/staging.js`. The rocket maintains a `currentStage` index. Pressing spacebar calls `activateCurrentStage()`: iterate through all parts assigned to the current stage and activate each. Activation behaviour by type: ENGINE — set to firing state (begins consuming fuel). DECOUPLER (stack) — remove the edge in the rocket graph between the two parts it connects; all parts on the disconnected side become a new "debris" object in the physics simulation (they continue to fall under gravity and drag, but the player has no control). DECOUPLER (radial) — same but severs a radial attachment. PARACHUTE — set to deploying state. SRB — set to firing (same as engine). After activation, `currentStage` increments to the next stage. The active rocket graph is recomputed after each decoupler fires to determine which parts are still connected to a command module. Parts disconnected from all command modules are moved to a separate debris list and continue to be simulated physically (rendered, fall, possibly crash) but accept no player input.

---

### TASK-024: Parachute Mechanics
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-020, TASK-004
- **Description**: Implement parachute behaviour in `/src/core/parachute.js`. A parachute can be in states: `packed`, `deploying`, `deployed`. Deployment triggered via stage activation or context menu. `deploying` state lasts 2 seconds (visual animation transition), then becomes `deployed`. A deployed parachute applies additional drag force: `chuteDrag = chuteDragCoefficient * airDensity(altitude) * velocity²`. The chuteDragCoefficient scales with atmospheric density — parachutes are less effective at high altitude (density < 0.1 kg/m³). A parachute has a `maxSafeMass` property. If the mass of the rocket segment connected to the parachute exceeds `maxSafeMass` when the chute is fully deployed, the parachute is marked as failed (destroyed) and no longer applies drag. Display parachute status in context menu.

---

### TASK-025: Landing Legs
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-020, TASK-004
- **Description**: Landing legs can be in states: `retracted`, `deploying`, `deployed`. Triggered via context menu (or stage). `deploying` takes 1.5 seconds, then `deployed`. Deployed legs change the effective landing collision radius of the rocket — they extend outward and downward, widening the base. On ground contact: if at least 2 landing legs are deployed AND vertical descent speed is < 10 m/s, the landing is classified as a controlled landing (safe). If legs are deployed but speed > 10 m/s at contact, the legs and the parts they are attached to are destroyed but the rest of the rocket may survive if the impact is not too severe (speed < 30 m/s destroys only the legs; speed > 30 m/s destroys the whole rocket). If no legs are deployed, any ground contact above 5 m/s destroys the part that contacts the ground and propagates destruction upward.

---

### TASK-026: Ejector Seat
- **Status**: done
- **Priority**: medium
- **Dependencies**: TASK-010, TASK-020
- **Description**: Crewed command modules (Mk1 Command Module) have an ejector seat system. Activated via context menu ("Activate Ejector Seat"). On activation: all astronauts assigned to this command module are marked as safely ejected (status remains 'active', mission count does not increment for this flight, but they survive). The command module continues to exist physically — ejection does not destroy it. A mission objective of type `EJECT_CREW` is completed when ejector seat is activated above the required altitude (200m for the tutorial mission). If a crewed command module is destroyed (heat, crash) and the ejector seat was NOT activated before destruction, all astronauts in that module are marked KIA and the $500,000 fine per astronaut is applied via the finance system.

---

### TASK-027: Flight Renderer & Camera
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-020, TASK-004
- **Description**: Implement the flight scene renderer in `/src/render/flight.js` using PixiJS. The rocket is rendered as a vertical stack of labelled rectangles, each rectangle representing a part. Part dimensions come from the part definition (width × height in pixels, scaled). Each part rectangle displays its name label. The rocket's position and rotation are applied as a PixiJS container transform. The ground is a horizontal coloured band at y=0 (world coordinates): desert sandy tan below, sky above. Sky colour transitions from light blue (`#87CEEB`) at sea level to dark blue (`#1a1a4e`) at 30,000m to near-black (`#000005`) above 70,000m — interpolated by altitude. The camera follows the rocket's centre of mass, keeping it near the centre of the viewport. When the rocket separates, the camera continues following the piece that contains the primary command module. Debris objects are rendered but not followed. Stars become visible above 50,000m altitude (simple white dots on the dark sky).

---

### TASK-028: Flight HUD
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-027, TASK-022
- **Description**: HTML overlay HUD rendered on top of the flight canvas. Displays: Altitude (m, formatted with thousands separator), Vertical Speed (m/s, positive = ascending), Horizontal Speed (m/s), Current Throttle (0–100% shown as a vertical bar on the left edge), Current Stage number and name, Apoapsis estimate (highest point of current trajectory, calculated from current velocity and altitude), a list of accepted mission objectives with completion indicators (checkmark when met, pending indicator otherwise), and per-tank-group fuel remaining (mass in kg). The throttle bar is keyboard-controlled: W or Up Arrow increases throttle by 5%, S or Down Arrow decreases by 5%, X sets throttle to 0%, Z sets to 100%. Throttle changes are shown immediately on the bar.

---

### TASK-029: Engine Trails
- **Status**: pending
- **Priority**: low
- **Dependencies**: TASK-027, TASK-021
- **Description**: Visual exhaust trail rendered behind each firing engine while atmospheric density > 0.01 kg/m³ (below ~50,000m). Implement as a PixiJS particle emitter or a manually managed trail of fading rectangles/ellipses. Each trail segment is a small elongated shape positioned at the engine nozzle, emitted each tick the engine is firing. Segments fade in opacity over 0.5 seconds and shrink slightly. Trail colour: bright yellow-white at origin fading to orange then transparent. SRBs produce wider, brighter trails than regular engines. No trails in vacuum. Trail rendering is purely visual and has no physics effect.

---

### TASK-030: Zoom & Time Warp
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-027
- **Description**: Mouse wheel zooms the PixiJS camera in and out. Zoom range: 0.1× (very zoomed out, see large portion of trajectory) to 5× (very close up). Zoom is centred on the cursor position. Time warp control: a set of buttons in the HUD showing warp levels: 1×, 2×, 5×, 10×, 50×. Selecting a warp level multiplies `dt` in the physics loop by that factor. All physics systems (fuel consumption, drag, gravity, heat) are scaled by the same `dt` — the simulation is physically correct at any warp level. The HUD stats (altitude, speed) display real physics values and update at the warp-adjusted rate, so they will appear to change faster at higher warp. Time warp resets to 1× if: the rocket enters atmosphere from above at high speed (reentry), staging is activated, or the rocket lands. Cannot time-warp during active staging sequences.

---

### TASK-031: Part Context Menus
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-027
- **Description**: Right-clicking any part in the flight view (when the part is on the active rocket, not debris) shows a context menu. Menu items shown by part type: ALL activatable parts → "Activate [Part Name]" (fires the same activation logic as staging). FUEL TANKS → "Fuel: X kg remaining" (read-only, no action). SERVICE MODULE → "Activate Experiment" (if not yet activated), "Experiment Status: [state]" (if active or complete). LANDING LEGS → "Deploy Legs" (if retracted), "Retract Legs" (if deployed, for repositioning). PARACHUTE → "Deploy Parachute". COMMAND MODULE (crewed) → "Activate Ejector Seat". The context menu closes on any click outside it. Parts that have already been activated (and activation is one-time, like decouplers) show "Already Activated" greyed out.

---

### TASK-032: Science Module Mechanics
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-022, TASK-031
- **Description**: Implement in `/src/core/sciencemodule.js`. Service module experiment states: `idle`, `running`, `complete`, `data_returned`. Activation (via context menu or stage) sets state to `running` and starts a countdown timer (30 seconds for Science Module Mk1). Each physics tick decrements the timer by dt. When timer reaches 0, state becomes `complete` — the module has collected data. Data is only "returned" when the module is still attached to the rocket AND the rocket lands safely (ground contact speed < landing threshold). On safe landing, if the module is in `complete` state, it transitions to `data_returned`. Mission objectives of type `RETURN_SCIENCE_DATA` check for `data_returned` state on landing. If the module is destroyed (heat, crash) while in `complete` state, the data is lost. The `HOLD_ALTITUDE` objective type tracks whether the rocket stayed within the target altitude band for the required duration while the experiment was running.

---

### TASK-033: Satellite Deployment
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-023, TASK-031
- **Description**: The Satellite Mk1 part is a passive payload. It can be connected to the rocket via stack or radial snap points. A decoupler below (or adjacent to) the satellite is used to release it. When the decoupler fires, the satellite becomes a detached physics object (same debris simulation as any other detached part). Mission objectives of type `RELEASE_SATELLITE` are completed when: (1) a satellite part has been detached from the rocket, AND (2) the satellite's altitude at time of release meets the mission target altitude, AND (3) the satellite's velocity meets the mission target velocity (if specified). The satellite's position and velocity are tracked in the debris simulation list. Once the mission objective is met, it is marked complete.

---

### TASK-034: Post-Flight Summary Screen
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-027, TASK-010, TASK-005
- **Description**: Shown when: (a) the active rocket's only command module is destroyed, or (b) the player opens the game menu and selects "Return to Space Agency" during flight, or (c) the rocket lands safely and the player confirms they are done. The summary screen shows: (1) Flight outcome (destroyed / landed safely / mission in progress). (2) Mission objectives completed this flight (listed by mission name and objective). (3) If landed safely: a table of parts that landed safely with their individual recovery value (60% of part cost each), and total recovery value. (4) Any crew KIA this flight with fines. (5) Three action buttons: "Restart from Launch" (return to pre-launch crew selection; costs the total part cost of any parts not recovered — deducted from cash immediately), "Continue Flying" (only available if rocket is intact and landed; returns to flight view — player can re-ignite if fuel remains or use menu to exit later), "Return to Space Agency" (triggers TASK-035 to apply all rewards and penalties, then shows the hub).

---

### TASK-035: Mission Completion & Rewards
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-034, TASK-005, TASK-012
- **Description**: Triggered when the player returns to the space agency from post-flight. Process in order: (1) For each completed mission, call `finance.earn(mission.reward)` and mark mission status as 'completed'. (2) Unlock new missions per each completed mission's `unlocksAfter` field — set their status to 'available'. (3) Unlock new parts per each completed mission's `unlockedParts` field — add to `state.parts`. (4) Add recovered part value to cash. (5) Apply interest on loan for each newly completed mission: one interest application per mission completed this flight. (6) Apply any death fines (if not already applied mid-flight). (7) Increment total flights counter. (8) Show a "Return Results" summary overlay on the hub screen listing: missions completed and their rewards, parts unlocked, interest charged, net change in cash. Dismiss to return to normal hub.

---

### TASK-036: Test Infrastructure Setup
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001
- **Description**: Configure two test runners. (1) **Vitest** for unit tests: install as a dev dependency, configure to run in a Node environment (not jsdom) so all `/src/core/` and `/src/data/` modules are importable without PixiJS or DOM dependencies. Add `test:unit` script to `package.json`: `vitest run`. (2) **Playwright** for e2e tests: install `@playwright/test` as a dev dependency, run `playwright install` to download Chromium. Configure `playwright.config.js` with: `baseURL` pointing to the Vite dev server (`http://localhost:5173`), a `webServer` block that starts `vite` before tests run and waits for it to be ready, a single `chromium` project for the desktop browser. Add `test:e2e` script: `playwright test`. Add a `test` script that runs both in sequence: `vitest run && playwright test`. Create `/src/tests/` for unit tests and `/e2e/` for Playwright test files. Create a `setup.js` placeholder for Vitest global helpers. All subsequent test tasks depend on this task completing first.

---

### TASK-037: Physics Engine Tests
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-020, TASK-036
- **Description**: Write unit tests in `/src/tests/physics.test.js` covering: (1) Net force calculation with known mass, thrust, and drag inputs — verify correct acceleration. (2) Velocity and position integration over multiple ticks — verify expected trajectory for a simple ballistic case. (3) Gravity-only freefall — verify position matches `0.5 * g * t²` formula. (4) Atmospheric drag at sea level vs vacuum — verify drag force is non-zero at sea level and zero in vacuum. (5) TWR > 1 produces upward acceleration from rest. (6) TWR < 1 does not lift off (net force downward). (7) Steering: applying a left/right input changes rocket orientation. (8) Time warp scaling: running 10 ticks at 5× warp produces same final state as 50 ticks at 1× warp. All tests must pass with `vitest run`.

---

### TASK-038: Fuel & Staging System Tests
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-022, TASK-023, TASK-036
- **Description**: Write unit tests in `/src/tests/fuelsystem.test.js` and `/src/tests/staging.test.js` covering: (1) Engine fuel consumption depletes connected tank at expected rate given thrust and Isp. (2) Engine stops producing thrust when connected tank is empty. (3) Cross-feed isolation: engine below a decoupler cannot draw fuel from a tank above the decoupler. (4) SRB burns at fixed rate regardless of throttle setting. (5) Part mass decreases as fuel drains (affects total rocket mass correctly). (6) Multiple connected tanks drain evenly. (7) Staging activation fires correct parts for the current stage. (8) Decoupler fires correctly: part graph is split, disconnected parts become debris. (9) Parts below a fired decoupler are no longer in the active rocket graph. (10) Stage index increments after each spacebar press. All tests must pass with `vitest run`.

---

### TASK-039: Financial System Tests
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-005, TASK-036
- **Description**: Write unit tests in `/src/tests/finance.test.js` covering: (1) Starting state: cash = $2,000,000, loan balance = $2,000,000. (2) `earn(amount)` increases cash correctly. (3) `spend(amount)` decreases cash; returns false and makes no change if amount > cash. (4) `applyInterest()` increases loan balance by 3% of current balance (rounded to nearest cent). (5) Interest compounds correctly over multiple calls (not simple interest). (6) `payDownLoan(amount)` reduces both cash and loan balance, capped at available cash and outstanding balance. (7) `borrowMore(amount)` increases both cash and loan balance, capped at max borrow limit. (8) `applyDeathFine()` deducts $500,000 per call from cash. (9) Cash cannot go below $0 via spend (returns false before deducting). All tests must pass with `vitest run`.

---

### TASK-040: Mission System Tests
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-012, TASK-013, TASK-036
- **Description**: Write unit tests in `/src/tests/missions.test.js` covering: (1) At game start, only Mission 1 (First Flight) is available. (2) Completing Mission 1 makes Mission 2 available. (3) Completing Mission 4 makes Missions 5, 6, and 7 simultaneously available. (4) A mission with two prerequisites only becomes available after both prerequisites are completed. (5) `acceptMission` sets mission status to 'accepted'. (6) During early tutorial phase (missions 1–4 not all complete), accepting one mission prevents accepting a second (returns false). (7) After early tutorial, multiple missions can be accepted simultaneously. (8) `checkObjectiveCompletion` with a flight state at 100m altitude marks the REACH_ALTITUDE 100m objective as complete. (9) Completing all objectives of a mission marks the mission as completed. (10) `getUnlockedParts` returns correct part IDs after specific missions are completed. All tests must pass with `vitest run`.

---

### TASK-041: Rocket Builder Logic Tests
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-016, TASK-019, TASK-036
- **Description**: Write unit tests in `/src/tests/rocketbuilder.test.js` covering: (1) A command module connected to a fuel tank and engine forms a valid rocket graph. (2) TWR calculation: given known total mass and Stage 1 thrust, verify calculated TWR matches expected value. (3) A rocket with TWR < 1 fails validation. (4) A rocket with no command module fails validation. (5) A rocket where an engine is in Stage 1 but has no connected fuel tank warns appropriately (no fuel = 0 thrust = TWR < 1). (6) Adding a valid snap connection stores the correct edge in the part graph. (7) Attempting to snap an incompatible part type to a snap point is rejected (returns false). (8) Removing a part from the graph also removes all its edges. (9) A part isolated from all command modules after a simulated decoupler fire is correctly identified as disconnected. All tests must pass with `vitest run`.

---

### TASK-042: Save/Load System Tests
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-006, TASK-036
- **Description**: Write unit tests in `/src/tests/saveload.test.js`. Mock localStorage for the Node test environment. Tests cover: (1) `saveGame` writes serialised state to the correct localStorage key. (2) `loadGame` deserialises and returns a state object that deep-equals the original saved state. (3) Round-trip: save a complex state (multiple crew, missions, rockets), load it, verify all nested fields match. (4) `listSaves` returns correct slot summaries including all stat fields. (5) Saving to slot 2 does not overwrite slot 0. (6) `deleteSave` removes the correct slot and leaves others intact. (7) `exportSave` returns a valid JSON string containing the full state. (8) `importSave` with valid JSON writes to the specified slot. (9) `importSave` with malformed JSON throws an error and does not write to the slot. All tests must pass with `vitest run`.

---

### TASK-043: E2E — App Load & New Game Flow
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-007, TASK-008, TASK-036
- **Description**: Write Playwright tests in `/e2e/newgame.spec.js`. Tests: (1) Navigating to the app root loads the page without console errors. (2) With no saves present, the New Game screen is shown (not the load screen). (3) Entering an agency name and clicking "New Game" navigates to the space agency hub. (4) The hub shows the correct starting cash (`$2,000,000`) in the top bar. (5) The hub shows all four clickable buildings (text labels: "Launch Pad", "Vehicle Assembly Building", "Mission Control Centre", "Crew Administration"). (6) With a save present in localStorage, the app shows the load screen by default and lists the save's stats. All tests must pass with `playwright test`.

---

### TASK-044: E2E — Hub Navigation
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-008, TASK-011, TASK-014, TASK-015, TASK-036
- **Description**: Write Playwright tests in `/e2e/hub-navigation.spec.js`. Each test starts from the hub (seed a new game state in localStorage before navigating). Tests: (1) Clicking "Vehicle Assembly Building" loads the VAB screen (parts panel is visible). (2) Clicking "Mission Control Centre" loads the mission control screen (at least one mission is listed as available). (3) Clicking "Crew Administration" loads the crew admin screen (tabs for Active Crew, Hire, History are present). (4) Clicking "Launch Pad" loads the launch pad screen. (5) Each building screen has a back/return button that returns to the hub. (6) The top bar showing cash is visible on each building screen. All tests must pass with `playwright test`.

---

### TASK-045: E2E — Mission Control Flow
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-014, TASK-036
- **Description**: Write Playwright tests in `/e2e/missions.spec.js`. Seed a fresh game state before each test. Tests: (1) The Available tab lists "First Flight" as the only available mission at game start. (2) Clicking "Accept" on "First Flight" moves it to the Accepted tab. (3) The Accepted tab shows the mission's objectives. (4) Accepting a mission deducts nothing from cash (missions are free to accept). (5) When "First Flight" is accepted, no other missions are shown as available (early tutorial one-at-a-time rule). (6) The Completed tab is empty at game start. (7) Simulating mission completion (via seeded completed state) shows the mission in the Completed tab with its reward amount. All tests must pass with `playwright test`.

---

### TASK-046: E2E — Rocket Builder Flow
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-015, TASK-016, TASK-018, TASK-019, TASK-036
- **Description**: Write Playwright tests in `/e2e/rocketbuilder.spec.js`. Seed a fresh game state with starter parts unlocked. Tests: (1) Opening the VAB shows the parts panel with at least one part listed per category (command modules, engines, fuel tanks). (2) The scale bar is visible on the build canvas. (3) Dragging a command module part to the canvas places it (the part label is visible on the canvas). (4) Placing a fuel tank below the command module and an engine below the tank produces a connected rocket. (5) The staging panel shows the placed engine in the unstaged parts pool. (6) Moving the engine into Stage 1 shows it in the Stage 1 slot. (7) The Rocket Engineer panel shows a failing TWR when no engine is staged. (8) After a valid rocket is built (command module + tank + engine in Stage 1, TWR > 1), the Launch button becomes enabled. (9) The current cash display in the VAB updates when parts are placed (cost deducted). All tests must pass with `playwright test`.

---

### TASK-047: E2E — Flight Launch & Basic Flight
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-019, TASK-027, TASK-028, TASK-036
- **Description**: Write Playwright tests in `/e2e/flight.spec.js`. Seed a game state with a pre-built valid rocket (command module + medium tank + Spark engine, engine in Stage 1). Tests: (1) Clicking Launch from the VAB loads the flight scene. (2) The flight HUD is visible with altitude, vertical speed, and throttle elements present. (3) At launch (before any input), the rocket sits on the launch pad with altitude near 0m. (4) Pressing spacebar activates Stage 1 — the altitude reading in the HUD begins increasing within 2 seconds. (5) The throttle display reflects keyboard throttle changes (W key increases, S key decreases). (6) The HUD mission objectives panel is visible and shows the "First Flight" objective (if it was accepted). (7) Opening the in-flight menu (hamburger button) shows Save Game, Load Game, and Return to Space Agency options. (8) Clicking "Return to Space Agency" from the menu brings up the post-flight summary screen. All tests must pass with `playwright test`.

---

### TASK-048: E2E — Crew Administration Flow
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-011, TASK-036
- **Description**: Write Playwright tests in `/e2e/crew.spec.js`. Seed a fresh game state (no crew). Tests: (1) The Active Crew tab shows an empty state message when no crew are hired. (2) The Hire tab shows the hire cost ($50,000) and a name field. (3) Clicking "Hire Astronaut" with a name entered deducts $50,000 from cash (visible in top bar) and adds the astronaut to the Active Crew tab. (4) The newly hired astronaut appears with 0 missions flown and status "active". (5) Clicking "Fire" on an active astronaut moves them out of the Active Crew list. (6) Fired astronauts appear in the History tab with status "fired". (7) Attempting to hire when cash is below $50,000 (seeded state) shows an error or the hire button is disabled. All tests must pass with `playwright test`.

---

### TASK-049: E2E — Save & Load Flow
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-006, TASK-007, TASK-036
- **Description**: Write Playwright tests in `/e2e/saveload.spec.js`. Tests: (1) From the hub, opening the menu and clicking "Save Game" shows a slot picker with 5 slots. (2) Saving to slot 0 with a name succeeds and shows a confirmation. (3) Navigating to the app root after saving shows the load screen with the save listed, including the correct agency name and stats (cash, missions completed). (4) Clicking "Load" on the saved slot returns to the hub with the correct game state (cash matches, agency name matches). (5) Deleting a save slot removes it from the load screen list. (6) After deleting the only save, navigating to the app root shows the New Game screen instead of the load screen. (7) Exporting a save produces a file download (Playwright intercepts the download and verifies it is valid JSON containing a `money` field). All tests must pass with `playwright test`.

---

### TASK-050: All Tests Pass Gate
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-037, TASK-038, TASK-039, TASK-040, TASK-041, TASK-042, TASK-043, TASK-044, TASK-045, TASK-046, TASK-047, TASK-048, TASK-049
- **Description**: This task represents the final quality gate. Run the combined test command (`npm test`) which executes `vitest run` followed by `playwright test`. All 6 unit test suites (TASK-037 through TASK-042) and all 7 e2e test suites (TASK-043 through TASK-049) must exit with 0 failures. If any test fails, the project is not considered complete — the failing test must be diagnosed and the underlying implementation fixed (not the test skipped or deleted). Only when `npm test` exits with code 0 and all test suites report 100% pass rate is the project considered complete.
