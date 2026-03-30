# SpaceAgencySim Development Requirements

Generated from DEVELOPMENT_ROADMAP.md. Phases build on each other per the dependency graph:
Phase 1 → Phase 2 → Phase 3 (needs biomes), Phase 5 (needs science); Phase 1 → Phase 4 (parallel) → Phase 6 → Phase 7.

---

## Phase 0: Core Game Mechanics

### TASK-001: Implement period (flight) system
- **Status**: done
- **Priority**: high
- **Dependencies**: none
- **Description**: Implement the period system where a period = one flight. Periods advance only when a flight is completed and the player returns to the space agency. Contract expiry, crew salaries, operating costs, and other time-based mechanics reference periods. Use "flight" in player-facing UI. Time warping does not advance the period counter. Returning to the agency from any flight (including orbit) completes one period, charges operating costs, and cashes in completed missions.

### TASK-002: Implement orbit slot system
- **Status**: done
- **Priority**: high
- **Dependencies**: none
- **Description**: Replace full Newtonian orbital mechanics with simplified orbit slots. Altitude bands are fixed ranges per celestial body (e.g., LEO 80-200km, MEO 200-2,000km for Earth). Angular position divided into 36 segments. Objects follow simplified Newtonian orbits and move along orbital paths in real-time (warpable). Non-circular (elliptical) orbits cause objects to move between altitude bands — at apoapsis they are in a higher band, at periapsis a lower band. This is important for gameplay: a craft in an elliptical orbit passes through multiple biomes, enabling multiple science results per orbit. Proximity detection: object is "in the player's slot" when angular distance < 5 degrees AND within the same altitude band. Implement "warp to target" that simulates forward until a target meets proximity conditions or determines impossibility.

### TASK-003: Implement flight phase state machine
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-002
- **Description**: Implement distinct flight phases: LAUNCH → FLIGHT → ORBIT → MANOEUVRE / REENTRY / TRANSFER → CAPTURE → FLIGHT (landing). Seamless transition from FLIGHT to ORBIT with notification label. Player cannot leave craft mid-transfer. Brief warning on ORBIT to FLIGHT transition. From ORBIT, player can return to agency (completing a period). Note: docking mode is a control mode within ORBIT (see TASK-005), not a flight phase. Ensure all phase transitions are clean and well-defined.

### TASK-004: Implement map view
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-002, TASK-003
- **Description**: Create a top-down map view as a completely separate PixiJS scene from the flight view. Toggle swaps active scene. Show control tip on toggle. During FLIGHT: static view, no time warp. During ORBIT: time warp enabled, objects move. Zoom levels: orbit slot detail, local body, craft-to-target, solar system. Player craft shown as point. Thrust/RCS controls work from map view with orbital-relative mapping (W=prograde, S=retrograde, A/D=radial). Orbit predictions cover a few orbits. "Warp to target" option. Day/night shadow overlay option. Requires Tracking Station facility.

### TASK-005: Implement control modes
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-003
- **Description**: Implement three control modes for orbital flight with control tip on every mode switch. Normal Orbit Mode (default): engines affect orbit, A/D rotates craft, W/S throttle, spacebar stages. Docking Mode (toggled): engines affect local position within orbit slot, orbit frozen as reference, A/D along track, W/S radial, band limit warnings, thrust cuts to zero on toggle. RCS Mode (within docking): WASD directional translation, no rotation, RCS plumes shown. RCS outside docking mode: WASD = prograde/retrograde/radial-in/radial-out.

### TASK-006: Configure starter parts availability
- **Status**: pending
- **Priority**: medium
- **Dependencies**: none
- **Description**: Configure part availability based on game mode. Non-tutorial mode: all starters available from game start (probe-core-mk1, tank-small, engine-spark, parachute-mk1, science-module-mk1, thermometer-mk1, cmd-mk1). Tutorial mode: gated starters — probe-core-mk1/tank-small/engine-spark/parachute-mk1 at game start; cmd-mk1 after Crew Admin tutorial (mission 4); science-module-mk1 and thermometer-mk1 after Science tutorial (missions 5-7 area). All other parts unlocked via tech tree or tutorial rewards.

---

## Phase 1: "The Business of Space" — Agency Depth

### TASK-007: Basic construction menu
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001
- **Description**: Add a construction menu to the hub screen for building new facilities. Simple list of available buildings with costs and a "Build" button. In tutorial mode, building is locked — facilities are awarded via tutorial missions; only upgrades available once a building exists. In non-tutorial mode, fully available from the start. Phase 5 extends this with the upgrade system.

### TASK-008: Contract system — generation and board
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001, TASK-007
- **Description**: Implement contract generation: 2-3 new contracts appear after each flight return, filling board slots. Accepting frees a slot. Generated contracts match player's current progression. Board pool and active caps by Mission Control tier: Tier 1 = 4 pool / 2 active, Tier 2 = 8/5, Tier 3 = 12/8. Board expiry after N flights. Completion deadlines on accepted contracts (some open-ended). Multi-part chains with per-part deadlines. Cancellation with penalty fee and reputation hit.

### TASK-009: Contract system — structure and objectives
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-008
- **Description**: Implement contract structure: objectives using existing ObjectiveType enum plus new types, rewards scaled to difficulty, optional over-performance bonus targets clearly marked. Categories with icons. Multi-part contracts creating chains. Landing not always required (orbital deployment contracts). Multiple simultaneous contracts that can conflict. Difficulty scaling based on constraints (cost limits, part restrictions, complexity) not just altitude. All new objective types must have automated tests. UI in Mission Control with category icons.

### TASK-010: Operating costs system
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001
- **Description**: Each period charges operating costs: crew salaries and facility upkeep. Activate existing crew salary field (~$5k/period per astronaut). Facility upkeep: $10k base, scaling with upgrades (Phase 5). Creates pressure to keep lean roster. Implement bankruptcy state for when player cannot afford to build any rocket.

### TASK-011: Crew skill progression
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-001
- **Description**: Activate existing skills.piloting/engineering/science fields on CrewMember (currently always 0). XP gains per flight: Piloting (+5 safe landing, +3 per flight, +2 per staging), Engineering (+3 per part recovered, +2 per staging), Science (+5 per science data return, +3 per science activation). Effects: Piloting = turn rate bonus (up to +30%), Engineering = part recovery value (60%→80%), Science = experiment duration reduction (30s→20s) and yield bonus. Skills 0-100 with diminishing returns. Crew selection UI must show effects. Crew visible during flight.

### TASK-012: Crew injury system
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-011
- **Description**: Activate CrewStatus.INJURED and injuryEnds field. Hard landing (5-10 m/s): injured 2-3 periods. Ejection: injured 1 period. Crew NOT affected by nearby part failure. Injured crew cannot be assigned to flights. Medical care option: pay fee to halve recovery time (round up). All injury events recorded in flight log with timestamp, altitude, and cause.

### TASK-013: Rocket design library
- **Status**: pending
- **Priority**: medium
- **Dependencies**: none
- **Description**: Name, save, load, and duplicate designs from the VAB. Show total launch cost breakdown (parts + fuel, not crew salaries). Grouping/filtering by characteristics (single/2/3-stage, crewed, probe, etc.) — rockets can belong to multiple groups, groups only appear when matching rockets exist. Shared across save slots by default with toggle for save-private. Cross-save compatibility: locked parts shown as red/ghosted placeholders with tech tree node label, rocket fails validation until all parts unlocked. Compatibility indicator per design (green/yellow/red).

---

## Phase 2: "Layers of Discovery" — Altitude Biomes & Science

### TASK-014: Altitude biome system
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-001
- **Description**: Define altitude bands as named biomes per celestial body with distinct visual identity and science properties. Earth biomes: Ground (0-100m, 0.5x), Low Atmosphere (100-2000m, 1.0x), Mid Atmosphere (2000-10000m, 1.2x), Upper Atmosphere (10000-40000m, 1.5x), Mesosphere (40000-70000m, 2.0x), Near Space (70000-100000m, 2.5x), Low Orbit (100000-200000m, 3.0x), High Orbit (200000m+, 4.0x). Labels fade in/out at boundaries. Background horizon curvature rendering (imperceptible at ground, visible by 40km+, clear in orbit). Orbital science interaction with biome changes in elliptical orbits.

### TASK-015: Science modules as instrument containers
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-014
- **Description**: Rework science modules as containers with limited instrument slots. Player chooses which instruments to load in VAB. Module context menu collates all loaded instrument options. Individual instruments activatable via staging. Science data types: Samples (must be physically returned, full yield) and Analysis data (transmittable from orbit at 40-60% yield, or returned for full yield). Yield formula: baseYield × biomeMultiplier × scienceSkillBonus × diminishingReturn (100% first, 25% second, 10% third, 0% after).

### TASK-016: Implement initial science instruments
- **Status**: done
- **Priority**: high
- **Dependencies**: TASK-015
- **Description**: Add science instruments that fit within science modules: thermometer-mk1 ($2k, 50kg, 10s, Ground/Low Atmo, 5pts, starter), Barometer ($4k, 80kg, 15s, Mid/Upper Atmo, 10pts, Tech T1), Radiation Detector ($8k, 120kg, 20s, Mesosphere/Near Space, 20pts, Tech T2), Gravity Gradiometer ($15k, 200kg, 30s, Low/High Orbit, 40pts, Tech T3), Magnetometer ($12k, 150kg, 25s, Upper Atmo/Mesosphere/Near Space, 15pts, Tech T3). Data definitions and in-game functionality for each.

### TASK-017: Tech tree system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-014, TASK-015
- **Description**: Science points plus funds unlock nodes in a technology tree. Visible from the start. Dual currency per node. R&D facility gates tiers. Tutorial unlocks shown as pre-unlocked nodes ("Unlocked via tutorial"). Starter parts do NOT appear in tree. Non-tutorial players can purchase tutorial-unlocked nodes through the tree normally, providing an alternative unlock path. 4 branches: Propulsion (Improved Spark → Reliant → Poodle → Ion → Nuclear), Structural (Medium tank → Radial decouplers/nose cones → Large tank/tubes → Docking ports → Station segments), Recovery (Parachute Mk2 → Drogue → Heat shield → Powered landing → Reusable booster), Science (Barometer → Radiation Detector → Gradiometer/Magnetometer → Science Lab → Deep space instruments). Uniform tier costs: T1=15sci/$50k, T2=30/$100k, T3=60/$200k, T4=120/$400k, T5=200/$750k.

### TASK-018: R&D Lab facility
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-017, TASK-007
- **Description**: Introduce R&D Lab as gateway to tech tree. Unlocked via tutorial mission after first science collection (non-tutorial: available to build immediately). Tier 1 ($300k + 20 sci): tech tree tiers 1-2, 10% science yield bonus. Tier 2 ($600k + 100 sci): tiers 3-4, 20% bonus. Tier 3 ($1M + 200 sci): tier 5, 30% bonus, experimental parts. Only facility costing both money and science. Reputation discounts apply to money portion only.

---

## Phase 3: "Things Go Wrong" — Reliability & Risk

### TASK-019: Part reliability and malfunction system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-014
- **Description**: Each part has reliability rating (0.0-1.0). Malfunction chance checked on biome transitions (offset from exact point for unpredictability). Must be toggleable for E2E testing (off or forced 100%). Malfunction types: Engine flameout (thrust→0, reignition attempts), Engine reduced thrust (60%), Fuel tank leak (~2%/s), Decoupler stuck (context menu manual decouple), Parachute partial deploy (50% drag), SRB early burnout, Science module instrument failure, Landing legs stuck stowed. Malfunctions are not catastrophic — player can always attempt recovery. Recovery via context menu, not staging. Visual cues and recovery tips for all malfunctions. Reliability visible in VAB. Example values: Starter 0.92, Mid-tier 0.96, High-tier 0.98, upgraded +0.02. Crew engineering skill reduces chance by up to 30%.

### TASK-020: Part wear and reusability system
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-019
- **Description**: Recovered parts go into state.partInventory with wear tracking. Each flight adds wear based on stress (engine firing = more, passive tank = less). Wear 0-100% affects reliability: effectiveReliability = baseReliability × (1 - wear × 0.5). VAB integration: parts menu shows inventory count, new inventory tab to LEFT of existing parts menu. Part descriptions show altered price when inventory exists. Inventory tab allows refurbish (30% cost, wear→10%) or scrap (sell for small amount). When building: buy new (full price, 0% wear) or use recovered (free, has wear). Recovered parts visually distinguished.

### TASK-021: Weather and launch conditions
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-014
- **Description**: Random weather per "day" visible from hub before launching. Wind (horizontal force, 0-15 m/s), Temperature (ISP modifier, -5% to +5%), Visibility (cosmetic fog/haze). Visible from hub with visual indication and status text. Day skipping: pay fee to reroll (does NOT advance period), escalating fees for consecutive skips. Extreme weather exists (highly advised not to fly). Weather satellites (Phase 4) reduce skip cost and show forecasts. No seasons. Different bodies have different weather (Moon=none, Mars=dust storms). Weather only affects atmospheric flight.

### TASK-022: Agency reputation system
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-009
- **Description**: Reputation score 0-100, visible from hub as colour-coded scale. Starting reputation: 50. Gains: successful mission +3-5, safe crew return +1, milestones +10. Losses: crew death -10, mission failure -3, rocket destruction without recovery -2. Effects by tier: 0-20 (basic contracts, +50% crew cost), 21-40 (standard, +25%), 41-60 (good/occasional premium, normal $50k, 5% facility discount), 61-80 (premium, -10% crew, 10% discount), 81-100 (elite/exclusive, -25% crew, 15% discount). Facility discounts apply to money only (never science on R&D).

---

## Phase 4: "The Final Frontier" — Orbital Operations

### TASK-023: Orbit entry and exit mechanics
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-002, TASK-003
- **Description**: Implement orbit entry when craft's periapsis rises above minimum stable orbit altitude for that body — seamless transition with notification label. Player retains full engine control. Orbit exit (deorbit) shows brief warning, craft leaves orbital model, other craft no longer visible. Different celestial bodies have different named altitude bands. Integrate with flight phase state machine.

### TASK-024: Orbital manoeuvres
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-023, TASK-005
- **Description**: No manoeuvre menu — all orbital changes done by hand. Normal mode: engine burns affect orbit (prograde raises opposite side, retrograde lowers). Docking mode: burns and RCS affect local position only within orbit slot band limits. Transfers: manually apply delta-v at correct orbital point. Map view shows target bodies with required delta-v for basic direct transfer. Route planning available in map view during orbit and transfer phases. Gravitational assists apply.

### TASK-025: Satellite network system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-023
- **Description**: Satellite types: Communication (any orbit, enables science transmission), Weather (LEO/MEO, reduces weather skip cost + forecast), Science (any orbit, passive science/period), GPS/Navigation (MEO, needs 3+, widens landing threshold + recovery profitability + new mission types), Relay (HEO/GEO, extends deep space comms). Constellation bonus: 3+ same type = 2× benefit (simple count). Built-in satellite parts include batteries/solar (no power micromanagement). Custom satellites require power management. Satellite degradation over time with manual maintenance missions or auto-pay option.

### TASK-026: Satellite Network Operations Centre facility
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-025, TASK-007
- **Description**: New facility managing satellite networks and health, separate from Tracking Station. Tier 1 ($400k): view satellite health, auto-maintenance payments. Tier 2 ($800k): lease satellites to third parties for income, constellation management. Tier 3 ($1.5M): advanced network planning, satellite repositioning commands, shadow overlay. Ability to lease satellite use for funds.

### TASK-027: Docking system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-005, TASK-023
- **Description**: Docking ports attachable radially, extendable away from craft for easier alignment. Targetable in orbit view within visual range. Docking guidance screen: orientation, distance, speed differences — each turns green when acceptable. Automatic final docking in last moments. New combined centre of mass with smooth camera transition. Undocking: ports disengage, command module/probe determines player control and camera. No limit on docked craft count. Enables: orbital assembly, crew transfer, fuel transfer, refuelling from depots.

### TASK-028: Power system
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-023
- **Description**: Solar panels generate power when sunlit (position-based day/night relative to nearest star). Batteries store power for eclipse. Power consumers: science instruments, communication/transmission, rotation (small). Built-in batteries on command/probe modules and pre-made satellite parts. Separate battery parts for custom satellites. Satellite ops centre shadow overlay. Map view optional shadow overlay. Orbital manoeuvres don't require power unless engine specifically uses electrical power.

### TASK-029: Satellite repair — grabbing arm
- **Status**: pending
- **Priority**: low
- **Dependencies**: TASK-027
- **Description**: New grabbing arm part ($35k, 150kg) that extends out and attaches player craft to a satellite. Once attached, repair or other actions can be performed. Arm small enough to grab satellites. Part data definition (cost, mass, thermal rating, etc.) is included in this task — the grabbing arm is self-contained here rather than in TASK-045.

---

## Phase 5: "Building Your Empire" — Facilities & Infrastructure

### TASK-030: Facility upgrade system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-007
- **Description**: Extend the basic construction menu from Phase 1 with an upgrade system. Each facility gains upgrade tiers improving capabilities. All upgrades purchased from construction menu on hub. Upgrades are instant (no build time). No limitation on what player can upgrade. All costs money only, except R&D Lab (money + science). Facility placement: fixed locations on hub with placeholder rectangles and descriptive text.

### TASK-031: Launch Pad upgrade tiers
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-030
- **Description**: Launch Pad tiers: Tier 1 (free, basic launches, limited max mass), Tier 2 ($200k, higher max mass, fuel top-off), Tier 3 ($500k, highest max mass, launch clamp support). Launch clamps: attached "behind" rocket, visual swing-away on staging, player positions clamp release in correct stage, clamp prevents launch until staged.

### TASK-032: VAB upgrade tiers
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-030
- **Description**: VAB tiers: Tier 1 (free, part placement, save/load, symmetry, basic part count/size limit), Tier 2 ($150k, higher part count, greater height/width), Tier 3 ($400k, highest count, largest height/width). Save/load and symmetry always available at all tiers. Upgrades only affect part count, height, and width limits.

### TASK-033: Mission Control Centre upgrade tiers
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-030, TASK-008
- **Description**: MCC tiers: Tier 1 (free, tutorial missions, 2 active contracts, 4 board pool), Tier 2 ($200k, 5 active, 8 pool, medium-difficulty contracts), Tier 3 ($500k, 8 active, 12 pool, premium contracts, multi-part chains).

### TASK-034: Crew Administration facility and upgrade tiers
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-030, TASK-011
- **Description**: Crew Admin must be built ($100k, not free). Tier 1: hire/fire crew, basic skill tracking. Tier 2 ($250k): training facility (assign crew to skill training between flights). Tier 3 ($600k): recruit experienced crew (starting skills > 0), advanced medical (faster recovery). Tutorial mission unlocking command module also introduces this building.

### TASK-035: Tracking Station facility and upgrade tiers
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-030, TASK-004
- **Description**: Unlocked via tutorial mission introducing orbital gameplay (also awards basic docking port). Tier 1 ($200k): map view (local body only), see objects in orbit. Tier 2 ($500k): map view (solar system), track debris, predict weather windows. Tier 3 ($1M): deep space communication, transfer route planning, track distant bodies.

### TASK-036: Crew training system
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-034
- **Description**: Requires Crew Admin Tier 2. Assign idle crew to training: pick skill (piloting/engineering/science). Cost: $20k per course. Duration: 3 periods. Gain: +15 in chosen skill. Crew status set to TRAINING (exists in enum), unavailable for flights. Training slots: 1 at tier 2, 3 at tier 3. Creates opportunity cost: best pilot unavailable while cross-training.

### TASK-037: Library facility
- **Status**: pending
- **Priority**: low
- **Dependencies**: TASK-030
- **Description**: Free building, no upgrades. Statistics and records dashboard (total flights, records per body, max speed, heaviest rocket, crew careers, financial history, exploration progress). Celestial body knowledge for discovered bodies, usable for mission planning. Tab for frequently flown rocket configurations with statistics (top 5).

### TASK-038: Tutorial missions for new facilities
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-007, TASK-018, TASK-034, TASK-035, TASK-026
- **Description**: Each new facility gets 1-2 introductory tutorial missions that teach the player what it does, award the building when accepting (tutorial mode), include narrative congratulating progression, and explain the construction menu. Crew Admin tutorial: after command module introduction. R&D Lab tutorial: after first science collection. Tracking Station tutorial: after first orbit, opens orbital tutorial chain. Satellite Network Ops: after deploying satellites.

---

## Phase 6: "New Horizons" — Extended Destinations

### TASK-039: Celestial body data system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-014, TASK-002
- **Description**: Define bodies as data objects parameterising physics and rendering: name, surface gravity, radius, atmosphere (density profile, scale height, top altitude or none), orbital distance, orbital period, biomes, ground visual, sky visual, weather, landable flag, and sphere of influence (SOI) radius. Each body has an SOI — the region where its gravity dominates. The Sun's SOI encompasses the entire solar system. When a craft crosses an SOI boundary it transitions from one body's gravitational dominance to another's (e.g., leaving Earth SOI enters Sun's, entering Moon's SOI leaves Earth's). SOI detection is critical for transfers (TASK-041) and the CAPTURE flight phase (TASK-003). Initial bodies: Sun (274 m/s², destruction altitude, extreme heat, high-value science), Mercury (3.7 m/s², no atmo), Venus (8.87 m/s², very dense atmo), Earth (9.81 m/s²), Moon (1.62 m/s², no atmo), Mars (3.72 m/s², thin atmo, dust storms), Phobos (0.0057 m/s²), Deimos (0.003 m/s²). Each body has unique biomes.

### TASK-040: Sun mechanics
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-039
- **Description**: Sun as gravitational centre of solar system. No solid surface but "surface" altitude where heat destroys everything. Destruction altitude (point of no return). Escalating heat damage on approach — only advanced heat shields allow close approach. Unique biomes (solar orbit, outer/inner corona) with very high science multipliers. Extreme solar power near Sun. Late-game challenge. Players in solar orbit from failed transfers can burn toward planetary bodies to escape. Light source for day/night power cycle and shadow calculations.

### TASK-041: Transfer gameplay
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-024, TASK-039
- **Description**: Transfer time warping from map view (does NOT advance period counter). Player cannot leave craft mid-transfer — must reach stable orbit first. Returning to agency from any stable orbit = one period. Map view during transfer: zoomed out, player trajectory shown, thrust/RCS controls work, orbit predictions, target body delta-v requirements, route planning with gravitational assists, zoom levels (craft, craft-to-target, solar system).

### TASK-042: Landing on other bodies
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-039, TASK-041, TASK-064
- **Description**: Reuse existing flight physics with body-specific constants: gravity, atmosphere profile, ground visual, sky gradient (Moon=black, Mars=butterscotch), weather, biomes. No-atmosphere landings (Moon, Mercury, Phobos, Deimos): no parachutes/aerobraking, fully propulsive, significant skill challenge. Thin-atmosphere landings (Mars): partial aerobraking generates heat (TASK-064 thermal system applies), parachutes help but insufficient alone, combination approach. Return missions require enough delta-v for round trip or pre-positioned fuel in orbit. Reentry to any body with an atmosphere involves heating — craft need appropriate thermal protection or heat shields for the body's atmospheric density and approach speed.

### TASK-043: Surface operations
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-042
- **Description**: Plant a flag (one per body, ceremonial milestone bonus, crewed only). Collect surface samples (crewed module required, must physically return to lab). Deploy surface instruments (science module with surface instrument, batteries/solar included). Deploy base marker beacon (shows on map, allows returning to landing site). Deployed items visible on map if GPS satellites in orbit around body, otherwise only with direct line of sight to agency hub. All deployed parts rendered on ground surface.

### TASK-044: Prestige milestones and achievements
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-039
- **Description**: One-time achievements for major firsts, visible in MCC under "Achievements" tab. Milestones: First Orbit ($200k+20rep), First Satellite ($150k+15rep), First Constellation ($300k+25rep), First Lunar Flyby ($500k+30rep), First Lunar Orbit ($750k+35rep), First Lunar Landing ($1M+40rep), First Lunar Return ($2M+50rep), First Mars Orbit ($3M+50rep), First Mars Landing ($5M+60rep), First Solar Science ($4M+50rep).

### TASK-045: Phase 6 new parts
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-039
- **Description**: Add new parts: Deep Space Engine ($50k, 300kg, ISP 1200s, 15kN thrust), Extended Mission Module ($30k, 500kg, life support for crew left in orbit or landed beyond the default 5-period supply — see TASK-067), Sample Return Container ($15k, 100kg, fits in science module for surface samples), Surface Instrument Package ($25k, 200kg, deployable surface science station in science module), Relay Antenna ($20k, 80kg, extends deep space comms). Multiple heat shield tiers with clear protection guidance, heavy variant for interplanetary re-entry, advanced for solar approach. Note: Grabbing Arm part data is defined in TASK-029.

---

## Phase 7: "Your Space Program" — Sandbox & Replayability

### TASK-046: Sandbox mode
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-017, TASK-009, TASK-022
- **Description**: New game option: everything free, all buildings/upgrades present, all parts unlocked. Contracts and reputation enabled. Malfunctions toggleable off. Weather toggleable off. Separate save slots from career mode. Completely separate progression. No creative mode (physics overrides) yet. Rocket design library shared between sandbox and career (per Phase 1f).

### TASK-047: Challenge missions
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-009
- **Description**: Hand-crafted missions with constraints and scoring in MCC "Challenges" tab. Structure: objective, constraints, scoring metric, Bronze/Silver/Gold medals. Replayable. Examples: Penny Pincher (reach 10km, $50k budget), Bullseye (land within 2 m/s), Minimalist (orbit with max 5 parts), Heavy Lifter (deploy 3 satellites one flight), Lunar Express (Moon landing + return, time limit), Rescue Mission (dock with stranded craft, fuel remaining). Need playtesting to verify possible and challenging.

### TASK-048: Custom mission creator
- **Status**: pending
- **Priority**: low
- **Dependencies**: TASK-047
- **Description**: Players create personal challenges in MCC Challenges tab. Pick objective types, set thresholds, add constraints, set rewards. Personal challenges clearly marked as distinct from official. Assumes player understands what they're doing (broken missions accepted). Export/import as JSON for sharing.

### TASK-049: Game settings — difficulty options
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-019, TASK-021
- **Description**: Difficulty/game speed options changeable in-game from settings menu at hub. Malfunction frequency: Off/Low/Normal/High. Weather severity: Off/Mild/Normal/Extreme. Financial pressure: Easy (2× rewards)/Normal/Hard (0.5× rewards, 2× costs). Crew injury duration: Short/Normal/Long. Settings not shown on save slots.

---

## Tutorial Mission Revisions

### TASK-050: Restructure tutorial mission chain
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-006, TASK-038
- **Description**: Restructure existing 17-mission tutorial to integrate new facilities and systems. Missions 1-4 (probe only): linear chain with starter parts. After mission 4: Crew Admin tutorial unlocks (awards building + cmd-mk1, crewed mission). Missions 5-7 open. Science tutorial (5-7 area, after safe landing): awards science-module-mk1 + thermometer-mk1. After first science: R&D Lab tutorial. Missions 8-13 continue (updated for instrument-in-module). After first orbit: Tracking Station tutorial (awards building + basic docking port, opens orbital chain: map view, manoeuvres, docking, satellite deployment). Missions 14-17 updated for orbital gameplay. After first satellite: Satellite Network Ops tutorial.

### TASK-051: Update existing mission objectives and rewards
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-050
- **Description**: Update existing missions: command module unlock moves to Crew Admin tutorial. Science module + thermometer-mk1 from science tutorial. Basic docking port from Tracking Station chain. Science module missions (8, 10) reference instrument-in-module. Satellite missions (15, 17) use orbital slot gameplay and Tracking Station. Orbit mission (16) references orbital tutorial chain. Rebalance thresholds and rewards for new systems.

---

## Testing

**Rule: Every player-facing feature must have E2E test coverage. All tests (unit + E2E) must pass before work on that phase is considered complete.**

### TASK-052: Automated E2E test infrastructure
- **Status**: pending
- **Priority**: high
- **Dependencies**: none
- **Description**: Save game states or generated game states must allow any part of game progression to be tested in isolation. Malfunction system must support off/forced-100% for test determinism. All new objective types must have automated tests verifying completion. This infrastructure underpins all per-phase E2E test tasks below and must be built first.

### TASK-053: Debug game save menu for manual testing
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-052
- **Description**: Debug save menu (separate from normal save slots) containing pre-built game states at various progression points. States named descriptively (e.g., "post-tutorial-all-parts", "first-orbit-achieved", "lunar-orbit-with-fuel-depot"). Allows testers to quickly load any progression state for manual testing.

### TASK-054: E2E tests — Phase 0 (Core Mechanics)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006
- **Description**: E2E tests covering all Phase 0 player-facing features. Must include: period advancement on flight completion and return to agency; period NOT advancing during time warp; orbit slot proximity detection and warp-to-target; flight phase transitions (LAUNCH→FLIGHT→ORBIT→REENTRY, ORBIT→MANOEUVRE, ORBIT→TRANSFER); control mode switching within ORBIT (normal→docking mode→RCS mode); map view toggle and scene swap; map view controls (thrust/RCS in orbital-relative mapping); control mode switching with thrust-cut-to-zero on docking toggle; RCS mode directional translation; starter part availability per game mode (tutorial vs non-tutorial gating). All tests must pass.

### TASK-055: E2E tests — Phase 1 (Agency Depth)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013
- **Description**: E2E tests covering all Phase 1 player-facing features. Must include: construction menu — building a facility, tutorial-mode lock; contract generation after flight return, board slot filling, accepting/declining contracts, board expiry after N flights, completion deadlines, cancellation with penalty; contract objectives completing in-flight (including new objective types), over-performance bonuses, multi-part chains; operating costs charged per period (crew salaries, facility upkeep), bankruptcy trigger; crew skill XP gains from flight events (landing, staging, science), skill effects on gameplay (turn rate, recovery value, experiment duration); crew injury from hard landing and ejection, injury blocking flight assignment, medical care halving recovery; rocket design library save/load/duplicate, grouping/filtering, cross-save sharing, locked-part placeholder display and validation failure. All tests must pass.

### TASK-056: E2E tests — Phase 2 (Biomes & Science)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018
- **Description**: E2E tests covering all Phase 2 player-facing features. Must include: biome label transitions as player ascends/descends through altitude bands; science multiplier applied correctly per biome; horizon curvature rendering change at altitude thresholds; science module instrument loading in VAB, context menu showing loaded instruments; instrument activation via staging; science data types (sample vs analysis) with correct yield on return vs transmission; diminishing returns on repeated collection; yield formula (base × biome × skill × diminishing); each instrument type activating only in valid biomes; tech tree visibility, node purchasing with dual currency, part unlocking; R&D Lab tier gating of tech tree tiers; tutorial pre-unlocked nodes display. All tests must pass.

### TASK-057: E2E tests — Phase 3 (Reliability & Risk)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-019, TASK-020, TASK-021, TASK-022
- **Description**: E2E tests covering all Phase 3 player-facing features. Must include: malfunction triggering on biome transition (using forced-100% mode); each malfunction type (engine flameout, reduced thrust, fuel leak, stuck decoupler, partial parachute, SRB early burnout, instrument failure, stuck landing legs); malfunction recovery via context menu; malfunction toggle off for test determinism; reliability values visible in VAB; crew engineering skill reducing malfunction chance; part inventory with wear tracking after recovery; wear affecting effective reliability; VAB inventory tab — refurbish and scrap actions; building with recovered vs new parts; weather display on hub, wind force during flight, ISP temperature modifier; day skipping with escalating fees; extreme weather warning; reputation score changes from missions/crew events; reputation tier effects on contract quality, crew hiring cost, facility discounts. All tests must pass.

### TASK-058: E2E tests — Phase 4 (Orbital Operations)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-023, TASK-024, TASK-025, TASK-026, TASK-027, TASK-028, TASK-029
- **Description**: E2E tests covering all Phase 4 player-facing features. Must include: orbit entry detection (periapsis above minimum altitude) with notification; orbit exit warning and transition; orbital manoeuvres — prograde/retrograde burns changing orbit shape; docking mode local positioning within orbit slot; satellite deployment to orbit and type-specific benefits (communication enabling transmission, weather reducing skip cost, science generating passive points, GPS widening landing threshold); constellation bonus at 3+ satellites; satellite degradation and maintenance (manual and auto-pay); Satellite Network Ops Centre UI at each tier; docking approach — guidance screen indicators, automatic final docking; undocking and control assignment; crew transfer and fuel transfer between docked craft; power system — solar generation, battery storage, power consumption by instruments/comms; grabbing arm attachment and satellite repair. All tests must pass.

### TASK-059: E2E tests — Phase 5 (Facilities & Infrastructure)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-030, TASK-031, TASK-032, TASK-033, TASK-034, TASK-035, TASK-036, TASK-037, TASK-038
- **Description**: E2E tests covering all Phase 5 player-facing features. Must include: facility upgrade purchase from construction menu; upgrade effects per facility — Launch Pad mass limits per tier and launch clamp staging; VAB part count and size limits per tier; MCC contract pool and active caps per tier; Crew Admin hire/fire, training assignment (skill gain, TRAINING status, unavailable for flights, slot limits per tier), experienced crew recruitment at tier 3; Tracking Station map view scope per tier; crew training opportunity cost (crew unavailable during training); Library statistics dashboard, celestial body knowledge, top-5 rocket configurations; tutorial missions for each new facility (awards building in tutorial mode, narrative, construction menu explanation). All tests must pass.

### TASK-060: E2E tests — Phase 6 (Destinations)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-039, TASK-040, TASK-041, TASK-042, TASK-043, TASK-044, TASK-045
- **Description**: E2E tests covering all Phase 6 player-facing features. Must include: celestial body data driving physics (gravity, atmosphere) and rendering (sky, ground); Sun destruction altitude and escalating heat damage; transfer gameplay — time warp not advancing periods, player locked to craft mid-transfer, map view controls during transfer, delta-v display for target bodies; landing on airless bodies (fully propulsive) and thin-atmosphere bodies (combination approach); body-specific biomes producing fresh science opportunities; surface operations — flag planting (one per body, crewed only), sample collection and return, surface instrument deployment, base marker beacon on map; deployed item visibility based on GPS satellite coverage; prestige milestones triggering at correct events with correct rewards; each new part (Deep Space Engine, Extended Mission Module, Sample Return Container, Surface Instrument Package, Grabbing Arm, Relay Antenna, heat shield tiers) functioning correctly. All tests must pass.

### TASK-061: E2E tests — Phase 7 (Sandbox & Replayability)
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-046, TASK-047, TASK-048, TASK-049
- **Description**: E2E tests covering all Phase 7 player-facing features. Must include: sandbox mode — all parts/buildings/upgrades available, free purchases, separate save slots, malfunction and weather toggle off, rocket design library shared with career; challenge missions — objective/constraint/scoring display, medal award at thresholds, replayability; custom mission creator — objective type selection, threshold/constraint/reward setting, export/import JSON; game settings — each difficulty option (malfunction frequency, weather severity, financial pressure, crew injury duration) correctly modifying gameplay values, settings changeable from hub, settings not shown on save slots. All tests must pass.

### TASK-062: E2E tests — Tutorial revisions
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-050, TASK-051
- **Description**: E2E tests covering the revised tutorial chain. Must include: missions 1-4 completable with starter parts only; Crew Admin tutorial unlocking after mission 4, awarding building + cmd-mk1; science tutorial unlocking in missions 5-7 area, awarding science-module-mk1 + thermometer-mk1; R&D Lab tutorial unlocking after first science collection; Tracking Station tutorial unlocking after first orbit, awarding building + basic docking port; orbital tutorial chain (map view, manoeuvres, docking, satellite deployment) completable; Satellite Network Ops tutorial unlocking after first satellite deployment; updated missions 8-13 using instrument-in-module system; updated missions 14-17 using orbital gameplay systems. All tests must pass.

---

## Additional Systems (gaps identified during review)

### TASK-064: Reentry heating and thermal system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-014, TASK-039
- **Description**: Implement atmospheric heating during FLIGHT phase when a craft is moving at speed through an atmosphere — applies during both reentry and ascent. Heat generated per tick based on craft speed × atmospheric density at current altitude. Each celestial body's atmosphere profile determines density (airless bodies = no heating; Mars = low; Earth = moderate; Venus = extreme). The Sun uses proximity-based heating (see TASK-040) rather than atmospheric density. Heat accumulates on parts over time. Each part has a thermal tolerance rating — when accumulated heat exceeds the rating, the part is destroyed. Engines have naturally high thermal ratings. Heat shields have very high ratings and protect parts behind them in the stack (above, since reentry is typically nose-down) — rocket orientation during reentry matters. Parts not behind a shield are exposed directly. Heat dissipates over time when not under thermal stress (e.g., after slowing down or exiting atmosphere), allowing brief aerobraking passes to be survivable. Heat shields are single-use, meant to be staged off after reentry — detachment failure is covered by the existing stuck decoupler malfunction (TASK-019). Visual heat glow effect using the sine wave approach already in the codebase, intensity scaling with heat level. Thermal tolerance ratings visible on parts in the VAB so the player can make informed decisions.

### TASK-065: Tech tree part definitions
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-017, TASK-064
- **Description**: Define full part data (cost, mass, size, and type-specific stats like thrust, ISP, drag, fuel capacity, thermal rating, etc.) in src/data/parts.js for all tech tree parts across 4 branches. **Propulsion:** T1 Improved Spark (better ISP), T2 Reliant (higher thrust), T3 Vacuum-optimised Poodle, T4 Ion engine (extremely high ISP, very low thrust), T5 Nuclear thermal. **Structural:** T1 Medium fuel tank, T2 Radial decouplers + Nose cones (drag reduction), T3 Large fuel tank + Structural tubes, T4 Docking ports, T5 Modular station segments. **Recovery:** T1 Parachute Mk2 (heavier rockets), T2 Drogue chute (high-altitude pre-deploy), T3 Heat shield (safe reentry from orbit — works with TASK-064 thermal system), T4 Powered landing guidance computer module (activatable during FLIGHT phase descending toward any body, automates the landing sequence consuming fuel normally, works on all bodies with and without atmospheres, no malfunctions, bypasses piloting skill bonuses), T5 Reusable booster recovery (boosters with this part that are decoupled during first stage automatically land safely off-screen and enter the part inventory from TASK-020 as recovered parts). **Science:** T1-T3 covered by TASK-016; T4 Science Lab module (on-board orbital lab that takes collected science data and processes it over time to generate additional science points), T5 Deep space instruments (for Phase 6 destinations). All parts must have thermal tolerance ratings for the heating system (TASK-064).

### TASK-066: Satellite component part definitions
- **Status**: pending
- **Priority**: medium
- **Dependencies**: TASK-025, TASK-028, TASK-065
- **Description**: Define part data for individual satellite components that players use to build custom satellites. Custom satellites are for specialised missions (telescopes, high-power relay networks, orbital science platforms) beyond what built-in satellite payloads cover. Custom satellites require power management (unlike built-in payloads). Components in S/M/L variants where applicable: **Solar panels** (S/M/L — power generation scaling with size), **Batteries** (S/M/L — power storage scaling with size), **Antennas** (Standard for short range, High-power for longer range, Relay for interplanetary distances), **Sensor packages** (Weather sensor, Science sensor, GPS transponder), **Specialised instruments** (Science telescope — large, high yield orbital science). All components need cost, mass, power generation/draw/storage stats, and thermal tolerance ratings. Place in the tech tree: antennas and structural components in the Structural branch, sensors and instruments in the Science branch. Built-in satellite payloads (one self-contained part per satellite type: comms, weather, science, GPS, relay — with internal batteries and solar, no power micromanagement) must also be defined as part data.

### TASK-067: Crew life support system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-001, TASK-045
- **Description**: Crew have 5 periods of life support by default (built into the command module). Each time the player returns to the agency and a period ticks, any crew left in orbit or landed elsewhere lose one period of supply. Supply countdown only applies while crew are in a stable state (orbit or safely landed on a body), not during active flight. At 1 period remaining, a warning is shown giving the player one last chance to launch a rescue mission. At 0 periods remaining, crew die. The Extended Mission Module (TASK-045) makes supplies infinite — no more countdown. Binary check: either the module is present or it isn't, no resource consumption. Does not stack (one module = infinite support). The period system (TASK-001) must track supply countdowns on all crewed craft left in the field. Supply status must be visible when viewing craft in the Tracking Station.

### TASK-068: Communication range system
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-025, TASK-035, TASK-039, TASK-066
- **Description**: Implement distance-based communication range model. **Direct comms to agency hub:** Line of sight from craft to the agency hub on Earth's surface with an upper range limit — works in Earth orbit but not much further. **Tracking Station T3** acts as a ground-based long-range antenna, significantly extending direct range (reduces but does not eliminate need for relays). **Local comms satellites** (TASK-025) provide coverage around a body. Coverage has dark spots — the far side of a body without a full constellation is unreachable. Comms range should cover a planet and potentially nearby moons if not too far away, but moons without their own network still have dark spots behind them. **Relay antennas** bridge long distances between planetary systems (interplanetary links). A body's comms network can link to nearby bodies' comms networks. A craft carrying a relay antenna onboard maintains its own connection back to the agency through the nearest other relay — deploying the first relay to a new planet is self-sustaining. **Without comms — probe-only craft:** Allowed to reach stable orbit, then loses control (no movement, no part activation). Player can return to agency via game menu. Craft remains visible in Tracking Station — player can load it to watch as it orbits, and if it orbits to a position where comms are restored, control returns. **Without comms — crewed craft:** Full control continues, just cannot transmit science data. **Map view overlay:** Comms coverage zones must be visible as a map view overlay, showing connected and dark zones — essential for planning network deployment.

### TASK-069: E2E tests — Additional systems
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-052, TASK-064, TASK-065, TASK-066, TASK-067, TASK-068
- **Description**: E2E tests covering all additional system features. Must include: **Thermal system:** heat accumulation during high-speed atmospheric flight; heat dissipation when slowing/exiting atmosphere; part destruction when thermal tolerance exceeded; heat shields protecting parts behind them in stack; orientation mattering (unshielded side taking damage); body-specific heating differences (Mars low, Earth moderate, Venus extreme); airless bodies producing no atmospheric heating; thermal ratings visible in VAB; heat glow visual effect. **Tech tree parts:** each new part placeable in VAB and functioning correctly (engines with correct thrust/ISP, fuel tanks with capacity, parachutes deploying, drogue chutes at high altitude, heat shields protecting, powered landing guidance auto-landing on various bodies consuming fuel, reusable booster recovery creating inventory parts on stage separation, Science Lab generating additional science from collected data, deep space instruments working at distant bodies). **Satellite components:** custom satellite buildable from individual parts, power management (solar generation, battery storage, power draw), each antenna type at correct range, each sensor type providing correct benefit, science telescope generating orbital science. **Life support:** supply countdown decrementing per period for crew in orbit/landed, warning at 1 period remaining, crew death at 0, Extended Mission Module preventing countdown, countdown not applying during active flight, supply status visible in Tracking Station. **Comms range:** direct comms working within Earth orbit range, comms failing beyond range limit, Tracking Station T3 extending direct range, local comms network providing coverage with dark spots on far side, relay antennas bridging interplanetary distances, craft with relay maintaining own connection, probe losing control without comms (reaching stable orbit first), probe regaining control when comms restored, crewed craft retaining control without comms but unable to transmit, comms coverage overlay visible on map view. All tests must pass.

### TASK-063: Final test gate — all tests passing
- **Status**: pending
- **Priority**: high
- **Dependencies**: TASK-054, TASK-055, TASK-056, TASK-057, TASK-058, TASK-059, TASK-060, TASK-061, TASK-062, TASK-069
- **Description**: Run the full test suite (`npm run test` — unit tests then E2E tests). Every unit test and every E2E test must pass. No skipped tests, no known failures. This task is the final gate — the roadmap work is not considered complete until this task is marked done. If any test fails, the corresponding feature task and test task must be revisited and fixed before this can be closed.
