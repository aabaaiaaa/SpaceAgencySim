# Development Roadmap

This document captures the planned gameplay expansion for SpaceAgencySim, organised into phased development milestones. Each phase builds on the previous and can be implemented incrementally. The current 17-mission tutorial campaign serves as the foundation -- these phases extend the game beyond that tutorial into a full space agency management and exploration experience.

---

## Phase 0: Core Game Mechanics

Foundational design decisions that inform all subsequent phases.

### 0a. Periods (Flights)

- A **period** consists of a single flight. This is the unit of "time" in the game.
- Periods advance only when a flight is completed and the player returns to the space agency.
- Contract expiry, crew salaries, operating costs, and other time-based mechanics all reference periods.
- The term "flight" should be used in player-facing UI so the relationship is clear (e.g., "expires in 3 flights").
- Time warping during orbital or transfer phases does **not** advance the period counter.
- Returning to the agency from any flight (including from orbit) counts as completing one period, at which point operating costs are charged and completed missions are cashed in.

### 0b. Orbit Slots

- Instead of simulating full Newtonian orbital mechanics, the game uses **orbit slots** -- simplified regions around a celestial body defined by altitude band and angular position.
- Altitude bands are fixed ranges specific to each celestial body (e.g., LEO 80-200km, MEO 200-2,000km for Earth).
- Angular position is divided into 36 segments around the body. The player's craft is always at the midpoint of its segment.
- Segments are relative to the player's position -- they travel with the craft. Bands are fixed.
- Objects in orbit follow simplified Newtonian orbits and are **not** assigned to numbered slots. They move along their orbital paths in real-time (warpable).
- The "orbit slot" is effectively the player's local neighbourhood -- the 1/36th segment around them at their current altitude band.
- Non-circular (elliptical) orbits cause objects to move between altitude bands as they travel. At apoapsis they are in a higher band; at periapsis, a lower band.
- This allows hundreds of orbiting objects without expensive per-tick physics simulation.
- **Proximity detection:** An object is "in the player's slot" when its angular distance is less than 5 degrees (half of 1/36th) AND it is within the player's current altitude band. This simple check runs each time step or warp step.
- **Warp to target:** Simulates forward step-by-step until a target meets the proximity conditions, or determines it's impossible (orbits never intersect in the same band and angular range).

### 0c. Flight Phases

The game has distinct phases during a flight, each with its own gameplay:

```
LAUNCH (stopped on pad)
  -> FLIGHT (continuous physics: gravity, drag, thrust, steering)
    -> ORBIT (stable orbit achieved -- periapsis above minimum stable altitude)
      -> MANOEUVRE (engine burns affecting orbit shape)
      -> REENTRY (warning shown, transitions back to FLIGHT)
      -> TRANSFER (escape velocity reached, interplanetary travel)
        -> CAPTURE (entering target body's influence, burn to orbit)
        -> FLIGHT (landing on target body with body-specific physics)
```

Note: Docking mode is a **control mode** within ORBIT (see Phase 0e), not a flight phase.

- Transition from FLIGHT to ORBIT is seamless -- the player keeps full control. A label notifies the player that a stable orbit has been achieved.
- The player cannot leave a craft mid-transfer (orbit may not be stable). They must reach a stable orbit somewhere first.
- Transition from ORBIT back to FLIGHT shows a brief warning, then the craft exits the orbital model and other craft in the slot are no longer visible.
- From ORBIT, the player can return to the space agency, leaving the craft safely in orbit. This counts as completing a period.

### 0d. Map View

- A **top-down map view** rendered as a **completely separate PixiJS scene** from the flight view. Toggling between flight view and map view swaps the active scene.
- A **control tip** is shown when toggling to map view to remind the player of the change in perspective and controls.
- Available during FLIGHT phase: static view, no time warp, no object movement.
- Available during ORBIT phase: time warp enabled, objects move along their orbits.
- Requires a **Tracking Station** facility at the space agency (unlocked via tutorial mission).
- Zoom levels: orbit slot detail, local body, craft-to-target, solar system.
- Player craft shown as a point on the map (not fully rendered).
- Thrust and RCS controls work from the map view -- manoeuvres can be performed and changes seen in real-time on the map. Controls in map view are relative to the orbital direction: W = prograde (speed up along orbit), S = retrograde (slow down), A/D = radial in/out (push orbit higher/lower). RCS in map view: WASD = prograde/retrograde/radial-in/radial-out. Mouse: pan and zoom.
- Orbit predictions cover a few orbits only (not infinite).
- "Warp to target" option: warp until a selected target enters the player's orbit slot (only available if orbits intersect).
- Day/night shadow overlay option showing areas blocked from starlight by celestial bodies.

### 0e. Control Modes

Three control modes exist during orbital flight. A **control tip** is shown on every mode switch to remind the player of the control changes.

**1. Normal Orbit Mode (default in orbit):**
- Engines affect the orbit (prograde/retrograde/radial burns change orbital parameters).
- A/D rotates the craft. W/S controls throttle.
- Spacebar stages.

**2. Docking Mode (toggled):**
- Engines affect **local position** within the orbit slot, not the orbit itself.
- Current orbit is "frozen" as the reference frame.
- A/D = move along orbital track (toward/away from target). W/S = move radially (change altitude within band).
- Movement restricted to current altitude band -- approaching a band limit triggers a warning and stops movement.
- Toggling off docking mode applies any altitude offset as a small orbit adjustment.
- **Thrust cuts to zero on toggle** to prevent edge cases. Player must re-engage after switching.

**3. RCS Mode (toggled within docking mode):**
- WASD = directional translation relative to craft orientation.
- Craft rotation disabled.
- RCS plumes shown for up/down/left/right emitting from around the centre of mass.
- Small thrust -- craft can be slowed to a stop by tapping keys.

**RCS outside docking mode:** RCS is also available outside docking mode for small manoeuvres on large distances. When toggled outside docking mode, WASD becomes prograde/retrograde/radial-in/radial-out (same mapping as map view controls -- see Phase 0d).

### 0f. Starter Parts

Parts available depend on game mode:

**Non-tutorial mode -- all starters available from game start:**
- probe-core-mk1
- tank-small
- engine-spark
- parachute-mk1
- science-module-mk1
- thermometer-mk1
- cmd-mk1

**Tutorial mode -- gated starters:**

| Part | Available |
|------|-----------|
| probe-core-mk1 | Game start |
| tank-small | Game start |
| engine-spark | Game start |
| parachute-mk1 | Game start |
| cmd-mk1 | Crew Admin tutorial (after mission 4) |
| science-module-mk1 | Science tutorial (missions 5-7 area, after safe landing) |
| thermometer-mk1 | Science tutorial (same mission as science module) |

All other parts are unlocked via the tech tree or tutorial mission rewards.

---

## Phase 1: "The Business of Space" -- Agency Depth

**Goal:** Make the time between flights feel like a game with meaningful decisions.

### 1a. Basic Construction Menu

A basic construction menu is introduced in Phase 1 as part of the hub screen. This is required for building new facilities (Crew Admin in Phase 1, R&D Lab in Phase 2, etc.).

- Simple list of available buildings with costs and a "Build" button.
- In tutorial mode, building is locked -- facilities are awarded via tutorial missions. Only upgrades are available once a building exists.
- In non-tutorial mode, the construction menu is fully available from the start.
- Phase 5 extends this with the **upgrade system** for all facilities.

### 1b. Contract System

**Unlocks:** After the player demonstrates they can safely land a rocket (tutorial progression).

**Contract generation:**
- 2-3 new contracts appear after each flight return, filling available board slots.
- Accepting a contract frees up a board slot for a new contract to generate next flight.
- Generated contracts only contain objective types matching the player's current progression -- as more tutorial missions are completed, more interesting contracts become available.

**Board pool and active contract caps (by Mission Control tier):**

| Mission Control Tier | Board pool (available) | Active (accepted) |
|---------------------|----------------------|-------------------|
| 1 | 4 | 2 |
| 2 | 8 | 5 |
| 3 | 12 | 8 |

**Contract deadlines:**
- **Board expiry:** Unaccepted contracts expire after N flights and vanish from the board.
- **Completion deadline:** Once accepted, some contracts have a separate deadline of N flights to complete. Not all contracts require a completion deadline -- some may be open-ended once accepted.
- **Multi-part chains:** Each part of a chain has its own deadline. No overall chain deadline.
- **Cancellation:** Accepted contracts can be cancelled for a **penalty fee and reputation hit**.

**Contract structure:**
- **Objectives:** Reuse existing `ObjectiveType` enum plus new types to be created.
- **Reward:** Scaled to difficulty.
- **Over-performance targets:** Optional bonus objectives that are clearly marked as optional. These pay extra if achieved.
- **Categories:** Contracts have categories with icons for visual identification. Not grouped or ordered by category in the UI.
- **Multi-part contracts:** Some contracts feed into a next contract, creating chains that require prioritisation and may require continuing a flight from an orbit slot.
- **Landing not always required:** Some contracts can be completed without the rocket landing (e.g., orbital deployment). Contracts requiring physical return (samples, recovered parts) still require landing.

**Player can hold multiple contracts simultaneously.** Contracts can conflict with each other, forcing the player to think about which to accept together.

**Difficulty scaling:** Based on constraints (rocket cost limits, available parts, objective complexity) rather than just altitude thresholds. The difficulty of a mission comes from limitations, not just targets.

**New objective types** will be needed to make contracts feel unique. All new objective types must have automated tests verifying they can be completed in-game.

**UI:** Contracts appear in Mission Control. Icons per category.

### 1c. Operating Costs

- Each flight (period) charges operating costs: crew salaries, facility upkeep.
- Crew salary field already exists on `CrewMember` but is currently unused -- activate it (~$5k/period per astronaut).
- Facility upkeep: $10k base, scaling with upgrades (Phase 5).
- Creates pressure to keep a lean roster and fly efficiently.
- **Bankruptcy state** should exist. If the player cannot afford to build any rocket, future gameplay may allow fund generation without launching (Phase 5 satellite leasing, etc.).

### 1d. Crew Skill Progression

Activate the existing `skills.piloting / engineering / science` fields on `CrewMember` (currently always 0).

**XP gains per flight:**

| Skill | XP Sources |
|-------|-----------|
| Piloting | +5 safe landing, +3 per flight, +2 per staging event |
| Engineering | +3 per part recovered, +2 per staging event |
| Science | +5 per science data return, +3 per science activation |

**Gameplay effects:**

| Skill | Effect |
|-------|--------|
| Piloting | Turn rate bonus (up to +30% at max skill) |
| Engineering | Part recovery value improvement (60% -> up to 80%) |
| Science | Experiment duration reduction (30s -> down to 20s), science yield bonus |

**Skills 0-100 with diminishing returns.** Mission objectives must support skill modifiers being applied.

**Crew selection UI** must clearly show what effects each crew member would apply to the flight.

**Crew must be visible during flight** so the player knows who is aboard and what effects are active.

### 1e. Crew Injury System

Activate `CrewStatus.INJURED` and `injuryEnds` field (both already exist in code).

- **Hard landing (5-10 m/s):** Injured for 2-3 periods.
- **Ejection:** Injured for 1 period.
- Crew should **not** be affected by nearby part failure.
- Injured crew cannot be assigned to flights.
- **Medical care option:** Pay a fee to halve recovery time (round up).
- All injury events recorded in the flight log with timestamp, altitude, and cause.

### 1f. Rocket Design Library

- Name, save, load, and duplicate designs from the VAB.
- Show total launch cost breakdown in the VAB: parts + fuel (not crew salaries -- those are charged per-period, not per-launch).
- **Grouping/filtering:** Designs can be grouped by characteristics (single stage, 2-stage, 3-stage, crewed, probe, etc.). Rockets can belong to multiple groups. Groups only appear as filter options when rockets fitting those groups exist.
- **Shared across save slots by default.** Rocket designs are shared between all save slots (including sandbox and career) unless toggled to be private to the save they were made in. This allows sandbox mode to help build complicated rockets for career use.
- **Cross-save compatibility:** When loading a shared design into a save where some parts are locked, those parts appear as **red/ghosted placeholders** with a label indicating which tech tree node is required. The rocket fails validation and cannot launch until all parts are unlocked or replaced. The design library shows a **compatibility indicator** per design: green if all parts are available in the current save, yellow/red if some are locked.

---

## Phase 2: "Layers of Discovery" -- Altitude Biomes & Science

**Goal:** Give the vertical axis meaning beyond "number goes up" and create science as a second progression currency.

### 2a. Altitude Biome System

Define altitude bands as named "biomes" with distinct visual identity and science properties. Each celestial body has its own set of biomes with unique names.

**Earth biomes:**

| Biome | Altitude | Science Multiplier |
|-------|----------|-------------------|
| Ground | 0-100m | 0.5x |
| Low Atmosphere | 100-2,000m | 1.0x |
| Mid Atmosphere | 2,000-10,000m | 1.2x |
| Upper Atmosphere | 10,000-40,000m | 1.5x |
| Mesosphere | 40,000-70,000m | 2.0x |
| Near Space | 70,000-100,000m | 2.5x |
| Low Orbit | 100,000-200,000m | 3.0x |
| High Orbit | 200,000m+ | 4.0x |

**Visual features:**
- Labels fade in/out as the player passes through biome boundaries.
- Background horizon rendering that hints at celestial body curvature -- imperceptible at ground level, visible by 40km+, clearly curved in orbit. The body being orbited determines the horizon visual (Earth blue/green, Moon grey, etc.). This is a render-layer change.

**Orbital science interaction:** Instruments activate based on current position. In an elliptical orbit, the craft passes through multiple biomes (higher biome at apoapsis, lower at periapsis), allowing multiple science results per orbit.

### 2b. Expanded Science System

**Starter science parts:** A basic science module and thermometer-mk1 are starter parts (see Phase 0f). In non-tutorial mode, available from game start. In tutorial mode, unlocked via a science tutorial mission in the missions 5-7 area. These starter parts do **not** appear in the tech tree.

**Science modules as containers:** Science instruments are placed *inside* a science module as sub-parts. The module has a limited number of slots. The player chooses which instruments to load in the VAB.

- Science module context menu collates all loaded instrument options.
- Individual instruments can be activated via staging (defaults to activating the experiment).
- Future large instruments may be standalone parts stacked on the rocket, but initial instruments fit within modules.

**Science data types:**
- **Samples:** Must be physically returned to the agency lab. Full science yield.
- **Analysis data:** Can be transmitted from orbit (requires communication capability -- reduced yield, 40-60%) or returned physically (full yield).

**Yield formula:** `baseYield * biomeMultiplier * scienceSkillBonus * diminishingReturn`

Where diminishing return = 100% first collection, 25% second, 10% third, 0% after.

**Initial instruments (fit within science module):**

| Instrument | Cost | Mass | Time | Valid Biomes | Base Yield | Availability |
|-----------|------|------|------|-------------|------------|-------------|
| thermometer-mk1 | $2,000 | 50 kg | 10s | Ground, Low Atmo, Mid Atmo | 5 pts | Starter part |
| Barometer | $4,000 | 80 kg | 15s | Mid Atmo, Upper Atmo | 10 pts | Tech tree (Science T1) |
| Radiation Detector | $8,000 | 120 kg | 20s | Mesosphere, Near Space | 20 pts | Tech tree (Science T2) |
| Gravity Gradiometer | $15,000 | 200 kg | 30s | Low Orbit, High Orbit | 40 pts | Tech tree (Science T3) |
| Magnetometer | $12,000 | 150 kg | 25s | Upper Atmo, Mesosphere, Near Space | 15 pts | Tech tree (Science T3) |

Many more instruments to be added over time.

### 2c. Tech Tree

Science points (plus funds) unlock nodes in a technology tree. The tech tree replaces mission-gated part unlocking for post-tutorial content.

**Key design decisions:**
- **Visible from the start** -- player can see the full tree and plan ahead.
- **Dual currency:** Each node costs both science points and money.
- **R&D facility gates tiers** -- the R&D Lab upgrade level determines which tiers are accessible.
- **Tutorial unlocks shown as pre-unlocked nodes** -- parts unlocked by tutorial missions appear in the tree as pre-unlocked nodes (marked "Unlocked via tutorial"). Non-tutorial players can purchase these same nodes through the tree normally, providing an alternative unlock path. Starter parts (see Phase 0f) do **not** appear in the tech tree.
- **4 branches with relatable icons:** Propulsion, Structural, Recovery, Science.

**Uniform costs per tier across all branches:**

| Tier | Science Cost | Money Cost |
|------|-------------|-----------|
| 1 | 15 | $50,000 |
| 2 | 30 | $100,000 |
| 3 | 60 | $200,000 |
| 4 | 120 | $400,000 |
| 5 | 200 | $750,000 |

**Branch structure (4 branches, 4-5 tiers each):**

**Propulsion:**
- Tier 1: Improved Spark engine (better ISP)
- Tier 2: Reliant engine variant (higher thrust)
- Tier 3: Vacuum-optimised Poodle
- Tier 4: Ion engine (extremely high ISP, very low thrust)
- Tier 5: Nuclear thermal upgrade

**Structural:**
- Tier 1: Medium fuel tank
- Tier 2: Radial decouplers, nose cones (drag reduction)
- Tier 3: Large fuel tank, structural tubes
- Tier 4: Docking ports
- Tier 5: Modular station segments

**Recovery:**
- Tier 1: Parachute Mk2 (heavier rockets)
- Tier 2: Drogue chute (high-altitude pre-deploy)
- Tier 3: Heat shield (safe reentry from orbit)
- Tier 4: Powered landing guidance (computer module that auto-lands the craft during FLIGHT phase when descending toward any body; consumes fuel normally; works on all bodies with and without atmospheres; no malfunctions; bypasses piloting skill bonuses)
- Tier 5: Reusable booster recovery (boosters with this part that are decoupled during first stage automatically land safely off-screen and enter the part inventory as recovered parts)

**Science:**
- Tier 1: Barometer
- Tier 2: Radiation Detector
- Tier 3: Gravity Gradiometer, Magnetometer
- Tier 4: Science Lab module (on-board orbital lab that takes collected science data and processes it over time to generate additional science points)
- Tier 5: Deep space instruments (for Phase 6 destinations)

### 2d. R&D Lab

The R&D Lab is introduced in Phase 2 as the gateway to the tech tree. It is unlocked via a tutorial mission that triggers after the player's first science collection. In non-tutorial mode, it is available to build from the construction menu immediately.

| Tier | Cost | Capability |
|------|------|-----------|
| 1 | $300k + 20 sci | Unlocks tech tree tiers 1-2, 10% science yield bonus |
| 2 | $600k + 100 sci | Unlocks tech tree tiers 3-4, 20% science yield bonus |
| 3 | $1M + 200 sci | Unlocks tech tree tier 5, 30% science yield bonus, experimental parts |

R&D Lab is the **only facility** that costs both money and science. Reputation discounts (Phase 3d) apply to the money portion only, never science.

---

## Phase 3: "Things Go Wrong" -- Reliability & Risk

**Goal:** Create tension during flights and reward preparation. Flights become managed-risk scenarios rather than deterministic puzzles.

**Depends on Phase 2** -- malfunctions trigger on biome transitions, which require the biome system to exist.

### 3a. Part Reliability & Malfunctions

Each part has a `reliability` rating (0.0-1.0). Parts are **not** checked every tick -- malfunction chance is checked on **biome transitions**. The actual triggering is offset from the exact transition point so it's not predictable to the player. The rationale: biomes change due to environmental characteristics (pressure, temperature) that justify why parts might malfunction.

**Testing requirements:** Malfunctions must be toggleable for automated E2E testing (off entirely, or forced to 100% chance). This is critical for test reliability.

**Malfunction types:**

| Part Type | Malfunction | Effect | Recovery |
|-----------|------------|--------|----------|
| Engine | Flameout | Thrust drops to 0 | Player can attempt reignition (may take multiple attempts) |
| Engine | Reduced thrust | Output drops to 60% | Continue with degraded performance |
| Fuel Tank | Leak | Slow fuel loss (~2%/s, not fast) | Rush objectives or stage off the leaking tank |
| Decoupler | Stuck | Staging action fails | Use context menu to manually decouple (may take a few attempts) |
| Parachute | Partial deploy | Drag at 50% | Deploy additional chutes or attempt propulsive landing |
| SRB | Early burnout | Fuel depletes faster | Compensate with next stage |
| Science Module | Instrument failure | One instrument slot disabled | Use remaining instruments |
| Landing Legs | Stuck stowed | Won't deploy | Parachute-only landing or abort |

**Key principles:**
- Malfunctions are **not catastrophic** -- the player can always attempt recovery.
- **Staging is not used to fix malfunctions** (staging is a one-shot action). Recovery uses the part's context menu (e.g., manually decouple a stuck decoupler).
- **Visual cues** must accompany all malfunctions so the player can see what happened and prepare to act.
- **Recovery tips** are shown to the player explaining what happened and what they can do.
- **Reliability ratings** are visible on parts in the VAB so the player can make informed decisions.
- No "test flight" concept -- the player should not be scared to make mistakes.

**Reliability values (examples):**
- Starter parts (Spark): 0.92
- Mid-tier (Reliant): 0.96
- High-tier (Nerv): 0.98
- Tech tree upgraded variants: +0.02

**Crew engineering skill** reduces effective malfunction chance by up to 30%.

### 3b. Part Wear & Reusability

Recovered parts go into an inventory (`state.partInventory`) with wear tracking.

**Wear mechanics:**
- Each flight adds wear based on part stress (engine firing = more, passive tank = less).
- Wear 0-100% affects reliability: `effectiveReliability = baseReliability * (1 - wear * 0.5)`.
- At 50% wear, a 0.96 reliability engine becomes 0.72.

**VAB integration:**
- Parts menu shows inventory count for each part type.
- New **inventory tab** to the **left** of the existing parts menu (so the parts menu doesn't move).
- Part descriptions show altered price when inventory stock exists.
- Inventory tab allows **refurbish** (pay 30% of part cost, reduces wear to 10%) or **scrap** (sell for small amount).
- When building, player chooses: buy new (full price, 0% wear) or use recovered (free, has wear).
- Recovered parts visually distinguished (wear badge or tint).

### 3c. Weather / Launch Conditions

Weather is random per "day" and visible from the hub before launching.

| Condition | Effect | Range |
|-----------|--------|-------|
| Wind | Horizontal force in atmosphere | 0-15 m/s (calm to strong) |
| Temperature | ISP modifier | -5% to +5% |
| Visibility | Cosmetic (fog/haze) | Clear to overcast |

**Key rules:**
- **Visible from hub** with both visual indication and status text. Current weather shown; forecast shown later with weather satellites.
- **Day skipping:** Player can pay a fee to skip to "the next day" and reroll weather. Skipping days does **not** advance the period counter. Fees escalate the more times the player skips consecutively.
- **Extreme weather** exists where it is highly advised not to fly.
- **Weather satellites** (Phase 4) reduce skip cost and show forecasts.
- **No seasons** for now.
- **Different celestial bodies** have very different weather (Moon = none, Mars = dust storms, etc.).
- Weather only affects atmospheric flight phases. Irrelevant in orbit.

### 3d. Agency Reputation

Reputation score 0-100, visible from the hub as a **colour-coded scale** that goes up and down.

**Starting reputation: 50** (neutral, middle of the scale).

**Gains:**
- Successful mission completion: +3-5 (scaled by difficulty)
- Safe crew return: +1
- Milestone achievements: +10 (one-time)

**Losses:**
- Crew death: -10
- Mission failure: -3
- Rocket destruction without recovery: -2

**Effects:**

| Reputation | Contract Quality | Crew Hiring Cost | Facility Discount |
|-----------|-----------------|-----------------|-------------------|
| 0-20 | Basic contracts only, low pay | +50% (hazard pay) | None |
| 21-40 | Standard contracts | +25% | None |
| 41-60 | Good contracts, occasional premium | Normal ($50k) | 5% |
| 61-80 | Premium contracts available | -10% | 10% |
| 81-100 | Elite contracts, exclusive missions | -25% (prestige) | 15% |

Facility discounts apply to **money costs only** (never science costs on R&D Lab).

### 3e. Crew Injury & Medical Care

- Hard landing (5-10 m/s): injured 2-3 periods.
- Ejection: injured 1 period.
- **Not** affected by nearby part failure.
- **Medical care:** Pay fee to halve recovery time (round up).
- All events recorded in flight log.

### 3f. Reentry Heating & Thermal System

Atmospheric heating applies during the FLIGHT phase whenever a craft is moving at speed through an atmosphere -- both reentry and ascent.

**Heat generation:** Per tick, based on craft speed × atmospheric density at current altitude. Each celestial body's atmosphere profile determines density:
- Airless bodies (Moon, Mercury, Phobos, Deimos): no atmospheric heating.
- Mars: low heating (thin atmosphere).
- Earth: moderate heating.
- Venus: extreme heating (very dense atmosphere).
- The Sun uses proximity-based heating rather than atmospheric density (see Phase 6a).

**Heat accumulation and tolerance:**
- Heat accumulates on parts over time. Each part has a **thermal tolerance rating** -- when accumulated heat exceeds the rating, the part is destroyed.
- Heat dissipates over time when not under thermal stress (e.g., after slowing down or exiting atmosphere), allowing brief aerobraking passes to be survivable.
- Engines have naturally high thermal ratings. Heat shields have very high ratings.
- Thermal tolerance ratings are visible on parts in the VAB so the player can make informed decisions.

**Heat shield protection:**
- Heat shields protect parts **behind them in the stack** (above, since reentry is typically nose-down). Parts not behind a shield are exposed directly.
- Rocket orientation during reentry matters -- the player must point the heat shield into the airflow.
- Heat shields are single-use, meant to be staged off after reentry. Detachment failure is covered by the stuck decoupler malfunction (Phase 3a).
- Multiple heat shield tiers (see Phase 6f): basic for orbital reentry, heavy for interplanetary velocities, advanced for solar approach.

**Objects in low orbit** of a body will be travelling close to a safe reentry speed and will experience manageable heat, but craft returning from higher orbits or interplanetary transfers will need heat shields to survive.

**Visual effects:** Heat glow effect using the sine wave approach already in the codebase, intensity scaling with heat level.

---

## Phase 4: "The Final Frontier" -- Orbital Operations

**Goal:** Make reaching orbit the beginning of a new gameplay layer. Orbit is where docking, satellite deployment, crew transfer, refuelling, and interplanetary transfers happen.

### 4a. Orbit Slot System

See Phase 0b for the foundational orbit slot design and Phase 0e for control modes.

**Orbit entry:** When the craft's periapsis rises above the minimum stable orbit altitude for that body, the craft transitions seamlessly into the orbit gameplay mode. A label notifies the player. The player retains full control of engines and can continue to adjust the orbit.

**Orbit exit:** Transitioning back to flight phase (deorbit) shows a brief warning. The craft leaves the orbital model and other craft in the slot are no longer visible.

**Docking mode:** See Phase 0e for full control mode details.

**Not in docking mode:** Engine use causes normal Newtonian effects (orbit changes, potential deorbit or altitude change).

**Different celestial bodies** have different named altitude bands.

### 4b. Map View

See Phase 0d for foundational map design.

**Additional orbit-phase details:**
- From orbit, the player can return to the space agency, leaving the craft safely in orbit.
- Map shows all objects with their orbital paths.
- Time warp allows objects to enter and exit the player's orbit slot. When warp resets to normal time, those craft can be visited.
- Warp-to-target: select a target in orbit of the same body and warp until it enters the player's slot (only if orbits intersect).
- Requires **Tracking Station** facility (not available at game start, unlocked via tutorial mission that introduces orbital gameplay).

**Tracking Station tutorial chain** also awards a **basic docking port** part, enabling the player to learn docking without needing to reach Structural T4 in the tech tree. Advanced docking ports (extendable, multiple sizes) remain in the tech tree.

### 4c. Orbital Manoeuvres

**No manoeuvre menu** -- all orbital changes are done by hand.

**Normal mode (not docking):** Engine burns affect the orbit. Prograde burns raise the opposite side of the orbit; retrograde burns lower it. The player learns orbital mechanics through experimentation.

**Docking mode:** Engine burns and RCS affect local position only, within the orbit slot band limits.

**Transfers:** Manually performed by applying delta-v at the correct orbital point. From the map view, celestial bodies can be targeted and the required delta-v for a basic direct transfer is displayed. Route planning is available in the map view during both orbit and transfer phases. Gravitational assists apply -- the player can plan efficient routes using gravity from intermediate bodies.

### 4d. Satellite Network

**Satellite types and benefits:**

| Type | Orbit Requirement | Ongoing Benefit |
|------|------------------|----------------|
| Communication | Any orbit | Enables science data transmission from orbit |
| Weather | LEO/MEO | Reduces weather skip cost, shows forecast |
| Science | Any orbit | Generates passive science points per period |
| GPS/Navigation | MEO, needs 3+ | Widens safe landing threshold, improves landing precision, increases recovery profitability, enables new mission types for that body |
| Relay | HEO/GEO | Extends communication range for deep space |

**Constellation bonus:** 3+ satellites of the same type around a body = 2x benefit. Simple count -- no positional requirements.

**Built-in satellite parts** (pre-made satellite payloads) include internal batteries and solar panels and do **not** require power micromanagement.

**Custom satellites** built by the player from individual parts (solar panels, batteries, instruments, antennas) do require power management. Custom satellites are for specialised missions (telescopes, high-power relay networks, orbital science platforms) beyond what built-in payloads cover.

**Custom satellite components** (S/M/L variants where applicable):
- **Solar panels** (S/M/L) -- power generation scaling with size.
- **Batteries** (S/M/L) -- power storage scaling with size.
- **Antennas** -- Standard (short range), High-power (longer range), Relay (interplanetary distances).
- **Sensor packages** -- Weather sensor, Science sensor, GPS transponder.
- **Specialised instruments** -- Science telescope (large, high yield orbital science).

All components need cost, mass, power generation/draw/storage stats, and thermal tolerance ratings. Antennas and structural components are in the Structural tech tree branch; sensors and instruments are in the Science branch. Built-in satellite payloads (one self-contained part per satellite type: comms, weather, science, GPS, relay) must also be defined as part data.

**Satellite maintenance:** Over time, satellites degrade. The player can either:
- Manually launch a maintenance mission.
- **Pay the cost of a launch** to auto-perform maintenance (to avoid boring overhead missions).

**New facility: Satellite Network Operations Centre**
- Manages all satellite networks and their health.
- Separate from the Tracking Station (which is about objects in orbit generally).
- Ability to lease satellite use to other businesses/governments for funds.
- Shadow overlay showing dark areas blocked by celestial bodies.
- See Phase 5 for tier details.

### 4e. Docking

**Docking ports:**
- Attachable radially to the craft.
- **Extendable** -- can be extended out away from the craft prior to docking to make alignment easier.
- Targetable in the orbit view when within visual range.
- **Docking guidance screen:** Shows orientation, distance, and speed differences. Each indicator turns green when within acceptable range. When all green, the player is in the correct position to dock.
- **Automatic final docking:** Engages in the last moments, seamless for the player.
- New centre of mass smoothly transitions the camera from the old craft CoM to the combined CoM.

**Undocking:**
- Docking ports can be disengaged.
- The command module/probe set as under player control determines which separated craft the player controls and where the camera repositions to.

**No limit** on how many craft can be docked together.

**Docking enables:**
- Orbital assembly (launch in multiple flights, dock in orbit, proceed together).
- Crew transfer between docked craft.
- Fuel transfer between docked craft.
- Refuelling from pre-positioned fuel depots.

### 4f. Power System

- **Solar panels** generate power when sunlit (position-based day/night cycle relative to nearest star).
- **Batteries** store power for eclipse periods.
- **Power consumers:** Science instruments, communication/data transmission, rotation (small amount -- makes electricity a visible resource without being punishing).
- **Built-in batteries** on command modules, probe modules, and pre-made satellite parts.
- **Separate battery parts** available for building custom satellite craft.
- **Satellite operations centre** shows shadow overlay for dark areas.
- **Map view** has optional shadow overlay.
- Orbital manoeuvres do not inherently require power unless the engine specifically uses electrical power.

**Satellite repair:**
- New **grabbing arm** part ($35,000, 150 kg) that extends out and attaches the player craft to a satellite.
- Once attached, repair or other actions can be performed.
- The arm should be small enough to grab satellites.

### 4g. Communication Range System

Distance-based communication range model governing science data transmission and probe control.

**Direct comms to agency hub:**
- Line of sight from craft to the agency hub on Earth's surface.
- Has an upper range limit -- works in Earth orbit but not much further.

**Tracking Station Tier 3** acts as a ground-based long-range antenna, significantly extending direct range (reduces but does not eliminate need for relays).

**Local comms satellites** (from Phase 4d) provide coverage around a body. Coverage has dark spots -- the far side of a body without a full constellation is unreachable. Comms range should cover a planet and potentially nearby moons if not too far away, but moons without their own network still have dark spots behind them.

**Relay antennas** bridge long distances between planetary systems (interplanetary links). A body's comms network can link to nearby bodies' comms networks. A craft carrying a relay antenna onboard maintains its own connection back to the agency through the nearest other relay -- deploying the first relay to a new planet is self-sustaining.

**Without comms -- probe-only craft:**
- Allowed to reach stable orbit, then loses control (no movement, no part activation).
- Player can return to agency via game menu.
- Craft remains visible in Tracking Station -- player can load it to watch as it orbits, and if it orbits to a position where comms are restored, control returns.

**Without comms -- crewed craft:**
- Full control continues, just cannot transmit science data.

**Map view overlay:** Comms coverage zones must be visible as a map view overlay, showing connected and dark zones -- essential for planning network deployment.

### 4h. Crew Life Support

Crew have **5 periods of life support** by default (built into the command module).

- Each time the player returns to the agency and a period ticks, any crew left in orbit or landed elsewhere lose one period of supply.
- Supply countdown only applies while crew are in a stable state (orbit or safely landed on a body), not during active flight.
- At **1 period remaining**, a warning is shown giving the player one last chance to launch a rescue mission.
- At **0 periods remaining**, crew die.
- The **Extended Mission Module** (Phase 6f) makes supplies infinite -- no more countdown. Binary check: either the module is present or it isn't. Does not stack (one module = infinite support).
- The period system must track supply countdowns on all crewed craft left in the field.
- Supply status must be visible when viewing craft in the Tracking Station.

---

## Phase 5: "Building Your Empire" -- Facilities & Infrastructure

**Goal:** The hub becomes a growing space agency where investments in facilities unlock capabilities and improve efficiency.

### 5a. Facility Upgrade System

The basic construction menu (build new facilities) is introduced in Phase 1a. Phase 5 extends this with the **upgrade system** -- each facility gains upgrade tiers that improve capabilities.

**Upgrade rules:**
- All facility upgrades are purchased from the construction menu on the hub screen.
- Upgrades are **instant** (no build time).
- **No limitation** on what the player can upgrade -- they can eventually max everything.
- All facility upgrade costs are **money only** (no science), except R&D Lab (Phase 2d) which requires both money and science.

**Facility placement:** Fixed locations on the hub. All art uses **placeholder rectangles with descriptive text** for now.

### 5b. Existing Facilities

**Launch Pad**

| Tier | Cost | Capability |
|------|------|-----------|
| 1 (starter) | Free | Basic launches, limited max rocket mass |
| 2 | $200k | Higher max mass, fuel top-off before launch |
| 3 | $500k | Highest max mass, launch clamp support |

**Launch clamps:**
- Attached "behind" the rocket (no conflict with side-mounted parts).
- Visual: clamps swing away from craft when staged.
- Player must position the clamp release in the correct stage when building.
- Clamp prevents the rocket from leaving the ground even at max thrust until staged.

**Vehicle Assembly Building**

| Tier | Cost | Capability |
|------|------|-----------|
| 1 (starter) | Free | Part placement, save/load, symmetry, basic part count/size limit |
| 2 | $150k | Higher part count limit, greater height/width allowance |
| 3 | $400k | Highest part count limit, largest height/width allowance |

Save/load and symmetry are **always available** at all tiers. Upgrades only affect part count, height, and width limits.

**Mission Control Centre**

| Tier | Cost | Capability |
|------|------|-----------|
| 1 (starter) | Free | Tutorial missions, 2 active contracts, 4 board pool |
| 2 | $200k | 5 active contracts, 8 board pool, medium-difficulty contracts |
| 3 | $500k | 8 active contracts, 12 board pool, premium contracts, multi-part chains |

**Crew Administration**

| Tier | Cost | Capability |
|------|------|-----------|
| 1 | $100k | **Must be built** (not free). Hire/fire crew, basic skill tracking |
| 2 | $250k | Training facility (assign crew to skill training between flights) |
| 3 | $600k | Recruit experienced crew (starting skills > 0), advanced medical (faster recovery) |

The tutorial mission that unlocks the command module part also introduces the Crew Administration building.

### 5c. New Facilities

**R&D Lab** -- See Phase 2d for tier details (introduced in Phase 2).

**Tracking Station** (unlocked via tutorial mission that introduces orbital gameplay; tutorial also awards basic docking port)

| Tier | Cost | Capability |
|------|------|-----------|
| 1 | $200k | Map view (local body only), see objects in orbit |
| 2 | $500k | Map view (solar system), track debris, predict weather windows |
| 3 | $1M | Deep space communication, transfer route planning, track distant bodies |

**Satellite Network Operations Centre**

| Tier | Cost | Capability |
|------|------|-----------|
| 1 | $400k | View satellite health, auto-maintenance payments |
| 2 | $800k | Lease satellites to third parties for income, constellation management |
| 3 | $1.5M | Advanced network planning, satellite repositioning commands, shadow overlay |

**Library** (free building, no upgrades)
- Statistics and records dashboard.
- Knowledge of each celestial body discovered.
- Information usable by the player to plan missions to those bodies.
- Tab for frequently flown rocket configurations with statistics (limit top 5).

### 5d. Crew Training

Requires Crew Administration Tier 2.

- Assign idle crew to training: pick a skill (piloting/engineering/science).
- Cost: $20k per training course.
- Duration: 3 periods (flights).
- Gain: +15 in chosen skill.
- Crew status set to `TRAINING` (already exists in enum), unavailable for flights.
- Training slots: 1 at tier 2, 3 at tier 3.
- Creates opportunity cost: best pilot unavailable while cross-training.

### 5e. Tutorial Missions for New Facilities

Each new facility has 1-2 introductory tutorial missions that:
- Teach the player what the facility does.
- Award the building itself when accepting the tutorial mission (in tutorial mode).
- Include narrative congratulating the player on progression and explaining they've been given funding.
- Explain that construction and upgrades can be managed from the construction menu.

**Examples:**
- Crew Administration tutorial: unlocks after command module is introduced.
- R&D Lab tutorial: unlocks after first science collection.
- Tracking Station tutorial: unlocks after first orbit, opens orbital tutorial mission chain.
- Satellite Network Ops: unlocks after deploying satellites.

---

## Phase 6: "New Horizons" -- Extended Destinations

**Goal:** Transform the game from Earth-orbit simulator to solar system exploration.

### 6a. Celestial Bodies

Bodies are defined as data objects that parameterise physics and rendering:

| Property | Controls |
|----------|---------|
| Name | Display label |
| Surface gravity | G0 in physics (currently hardcoded 9.81) |
| Radius | Ground level, visual curvature |
| Atmosphere | Density profile, scale height, top altitude (or none) |
| Orbital distance | Distance from parent body |
| Orbital period | Time to complete one orbit |
| Sphere of influence | SOI radius -- region where this body's gravity dominates |
| Biomes | Named altitude bands specific to this body |
| Ground visual | Colour, texture |
| Sky visual | Colour gradient, atmosphere tint |
| Weather | Weather parameters (or none) |
| Landable | Whether the player can attempt to land |

**Sphere of influence (SOI):** Each body has an SOI -- the region where its gravity dominates. The Sun's SOI encompasses the entire solar system. When a craft crosses an SOI boundary, it transitions from one body's gravitational dominance to another's (e.g., leaving Earth's SOI enters the Sun's; entering the Moon's SOI leaves Earth's). SOI detection is critical for transfers and the CAPTURE flight phase.

**Initial bodies:**

| Body | Gravity | Atmosphere | Key Feature |
|------|---------|-----------|-------------|
| Sun | 274 m/s² | None (traditional) | Extreme heat, high-value science, destruction altitude near surface, late-game challenge |
| Mercury | 3.7 m/s² | None | Close to Sun, extreme solar power/heat |
| Venus | 8.87 m/s² | Very dense | Extreme pressure, no landing initially |
| Earth | 9.81 m/s² | Dense | Home base, launch site |
| Moon | 1.62 m/s² | None | Low gravity, propulsive landing only |
| Mars | 3.72 m/s² | Thin | Partial aerobraking, dust storms |
| Phobos | 0.0057 m/s² | None | Tiny Mars moon |
| Deimos | 0.003 m/s² | None | Tiny Mars moon |

**The Sun:**
- Gravitational centre of the solar system. All other bodies orbit it.
- Sphere of influence encompasses the entire solar system.
- No solid surface, but a "surface" altitude where heat destroys everything.
- **Destruction altitude** near the surface -- a point of no return where craft are guaranteed destroyed.
- Escalating heat damage on approach. Only the most advanced heat shields allow survival at close range.
- Unique biomes (solar orbit, outer corona, inner corona, etc.) with very high science multipliers -- high risk, high reward.
- Extreme solar power generation near the Sun.
- A genuine late-game challenge to reach and collect science from.
- If a player ends up in solar orbit (from a failed transfer), they can still burn toward a planetary body to escape.
- Light source for the day/night power cycle and shadow calculations across the solar system.

Each body has unique biomes (see Phase 2a). Every biome on every body is a fresh science collection opportunity.

**No-atmosphere landings** (Moon, Mercury, Phobos, Deimos): No parachutes, no aerobraking. Fully propulsive landing required. Significant skill challenge.

**Thin-atmosphere landings** (Mars): Partial aerobraking. Parachutes help but aren't sufficient alone. Combination approach: parachute to slow, then propulsive final descent.

### 6b. Transfer Gameplay

See Phase 0c for flight phase definitions and Phase 4c for manual transfer mechanics.

**Transfer time warping:** Available from the map view. Does **not** advance the period counter. This keeps long-distance travel affordable and lets the player play quickly without managing timescales of real interplanetary distances.

**Player cannot leave craft mid-transfer** (orbit may not be stable). Must reach a stable orbit somewhere first (could be around the Sun before reaching the final target body).

**Returning to agency from any stable orbit** counts as a period -- operating costs charged and completed missions cashed in.

**Map view during transfer:**
- Zoomed out to show relevant bodies.
- Player trajectory shown.
- Thrust and RCS controls work from the map view.
- Orbit predictions cover a few orbits only.
- Target body delta-v requirements displayed.
- Route planning with gravitational assists.
- Zoom levels: craft level, craft-to-target, solar system.

### 6c. Landing on Other Bodies

Reuses existing flight physics with body-specific constants:
- Gravity = body's surface gravity.
- Atmosphere = body's atmosphere profile.
- Ground visual = body's ground colour/texture.
- Sky = body's sky gradient (Moon: always black, Mars: butterscotch).
- Weather = body's weather (Moon: none, Mars: dust storms).
- Biomes = body's biome definitions.

**Return missions** require enough delta-v for the entire round trip, or pre-positioned fuel in orbit (docking/refuelling from Phase 4).

### 6d. Surface Operations

- **Plant a flag:** Only one per body. Ceremonial, first-time milestone bonus. Crewed missions only.
- **Collect surface samples:** Requires crewed module. Must be physically returned to agency lab.
- **Deploy surface instruments:** Science module can contain a surface instrument that deploys on the ground. Batteries and small solar panel included for free as part of the deployed instrument.
- **Deploy base marker beacon:** Shows up on map view around the surface of that body. Allows returning to this landing site in future missions.
- **Deployed items visibility:** Continuously visible on map if GPS satellites are in orbit around that body. Otherwise, only visible with direct line of sight to any space agency hub (Earth for now).
- **Visual rendering:** All deployed parts appear as visible objects on the ground surface.

### 6e. Prestige Milestones / Achievements

One-time achievements for major firsts. **Visible in Mission Control Centre** under a new "Achievements" tab.

| Milestone | Trigger | Reward |
|-----------|---------|--------|
| First Orbit | Achieve stable orbit | $200k + 20 rep |
| First Satellite | Deploy satellite to orbit | $150k + 15 rep |
| First Constellation | 3+ satellites of same type | $300k + 25 rep |
| First Lunar Flyby | Enter Moon's sphere of influence | $500k + 30 rep |
| First Lunar Orbit | Achieve stable lunar orbit | $750k + 35 rep |
| First Lunar Landing | Touch down on Moon | $1M + 40 rep |
| First Lunar Return | Land crew safely back on Earth after Moon | $2M + 50 rep |
| First Mars Orbit | Achieve Mars orbit | $3M + 50 rep |
| First Mars Landing | Touch down on Mars | $5M + 60 rep |
| First Solar Science | Collect science data near the Sun | $4M + 50 rep |

### 6f. New Parts

| Part | Cost | Mass | Purpose |
|------|------|------|---------|
| Deep Space Engine | $50,000 | 300 kg | Very high ISP (1200s), very low thrust (15 kN) |
| Extended Mission Module | $30,000 | 500 kg | Life support for crew left in orbit or landed beyond the default 5-period supply (see Crew Life Support below) |
| Sample Return Container | $15,000 | 100 kg | Fits within science module. Stores surface samples for return |
| Surface Instrument Package | $25,000 | 200 kg | Fits within science module. Deployable surface science station |
| Grabbing Arm | $35,000 | 150 kg | Extends to grab satellites/objects for repair or retrieval |
| Relay Antenna | $20,000 | 80 kg | Extends communication range for deep space |

**Heat shields:** Multiple tiers forming a progression. Each tier provides clear guidance on how much protection it offers (re-entry speed, atmospheric density tolerance) so the player can make informed decisions. The heavy variant handles interplanetary re-entry velocities. Advanced tiers needed for solar approach missions.

---

## Phase 7: "Your Space Program" -- Sandbox & Replayability

**Goal:** Long-term engagement through creative freedom, challenge content, and completionism.

### 7a. Sandbox Mode

Available as a new game option.

- Everything is free to buy.
- All buildings and upgrades already present.
- All parts unlocked.
- Contracts enabled.
- Reputation enabled.
- Malfunctions can be toggled off.
- Weather can be toggled off.
- **Separate save slots** from career mode.
- Completely separate from career mode (no cross-save progression).
- No creative mode (physics overrides) yet.
- **Rocket design library shared** between sandbox and career save slots (see Phase 1f).

### 7b. Challenge Missions

Hand-crafted missions with constraints and scoring. Located in **Mission Control Centre under a new "Challenges" tab**.

**Structure:**
- Objective, constraints, scoring metric, Bronze/Silver/Gold medals.
- Replayable.
- Need playtesting to verify they are both possible and challenging.

**Example challenges:**

| Challenge | Objective | Constraint | Scoring |
|-----------|----------|------------|---------|
| Penny Pincher | Reach 10,000m | Budget: $50,000 | Money remaining |
| Bullseye | Land within 2 m/s | Any rocket | Landing precision |
| Minimalist | Reach orbit | Max 5 parts | Altitude achieved |
| Heavy Lifter | Deploy 3 satellites in one flight | None | Total mass deployed |
| Lunar Express | Land on Moon and return | Time limit | Time remaining |
| Rescue Mission | Dock with stranded craft | Specific starting orbit | Fuel remaining |

### 7c. Library Facility

See Phase 5c. The Library is a free building with no upgrades containing:

- **Statistics dashboard:** Total flights, records (highest altitude per body, max speed, heaviest rocket, etc.), crew careers, financial history, exploration progress.
- **Celestial body knowledge:** Information on each discovered body. Usable for mission planning.
- **Frequently flown rockets:** Top 5 rocket configurations with flight statistics (where they've been, what they've done).

### 7d. Custom Mission Creator

Players can create personal challenges in Mission Control Centre (same Challenges tab).

- Pick objective types, set thresholds, add constraints, set rewards.
- Personal challenges are **clearly marked** as distinct from official challenges.
- Assumes the player understands what they're doing (potential for broken missions is accepted).
- Export/import as JSON for sharing.

### 7e. Game Settings

**Difficulty/game speed options:**
- Malfunction frequency: Off / Low / Normal / High
- Weather severity: Off / Mild / Normal / Extreme
- Financial pressure: Easy (2x rewards) / Normal / Hard (0.5x rewards, 2x costs)
- Crew injury duration: Short / Normal / Long

**All settings changeable in-game** from a settings menu accessible at the hub. Settings not shown on save slots.

---

## Tutorial Mission Revisions

The existing 17-mission tutorial chain needs restructuring to integrate new facilities and systems introduced in later phases. New tutorial missions are interleaved with existing ones as the features they teach become available.

### Revised Tutorial Flow

```
Missions 1-4 (probe core only, no crew needed)
  Linear chain: reach altitude -> higher -> 1km -> speed test
  Starter parts: probe-core-mk1, tank-small, engine-spark, parachute-mk1
  (See Phase 0f for full starter parts list)

  -> Mission 4 complete
    -> NEW: Crew Administration tutorial mission unlocks
      Awards Crew Admin building + command module part (cmd-mk1)
      Flyable mission with crew aboard (teaches crew assignment, crew visibility in flight)

    -> Missions 5, 6, 7 branches open (some requiring crew)
      Recovery tech, landing legs, crew safety

    -> NEW: Science tutorial mission unlocks (missions 5-7 area, after safe landing)
      Awards science-module-mk1 + thermometer-mk1
      Teaches instrument loading, science collection, data return

    -> Player collects first science data
      -> NEW: R&D Lab tutorial mission unlocks
        Awards R&D Lab building
        Introduces tech tree and science-as-currency concept

    -> Existing missions 8-13 continue (science, staging, high altitude)
      Science module interactions updated to use instrument-in-module system

    -> NEW: Tracking Station tutorial mission unlocks (after first orbit)
      Awards Tracking Station building + basic docking port
      Opens orbital tutorial mission chain:
        - Map view introduction
        - Orbit manoeuvres
        - Docking basics
        - Satellite deployment

    -> Existing missions 14-17 (Kármán line, satellite, orbit, final)
      Updated to use orbital gameplay systems

    -> NEW: Satellite Network Ops tutorial unlocks (after first satellite deployment)
      Awards Satellite Network Operations Centre
      Teaches network management, leasing, maintenance
```

### Key Changes to Existing Missions
- **Command module unlock** moves from its current mission to the Crew Admin tutorial.
- **Science module + thermometer-mk1** unlocked via new science tutorial mission (missions 5-7 area).
- **Basic docking port** awarded by Tracking Station tutorial chain.
- **Science module missions** (8, 10) updated to reference instrument-in-module system.
- **Satellite missions** (15, 17) updated to use orbital slot gameplay and Tracking Station.
- **Orbit mission** (16) becomes part of the orbital tutorial chain or references it.
- Specific mission objective thresholds and rewards may need rebalancing to account for new systems.

---

## Testing Requirements

### Automated E2E Testing
- **Save game states or generated game states** must be used to allow any part of the game progression to be tested in isolation.
- Malfunction system must support being turned off or forced to 100% for test determinism.
- All new objective types must have automated tests verifying they can be completed.

### Manual E2E Testing
- A **debug game save menu** (separate from normal save slots) containing pre-built game states at various progression points.
- States are named descriptively according to the game state they represent (e.g., "post-tutorial-all-parts", "first-orbit-achieved", "lunar-orbit-with-fuel-depot").
- This allows testers to quickly load any progression state for manual testing.

---

## Dependency Graph

```
Phase 1 (Agency Depth + basic construction menu)
  └── Phase 2 (Science/Biomes + R&D Lab)
        ├── Phase 3 (Reliability) ── needs biomes for malfunction triggers
        └── Phase 5 (Facility Upgrades) ── needs science for R&D upgrades
  └── Phase 4 (Orbital) ── can parallel Phases 2/3
        └── Phase 6 (Destinations) ── needs orbital model
              └── Phase 7 (Sandbox) ── best last, can partially start anytime
```

---

## New Facilities Summary

| Facility | Phase Introduced | Initial Cost | Tiers | Tier Details | Purpose |
|----------|-----------------|-------------|-------|-------------|---------|
| Launch Pad | Existing | Free | 3 | Phase 5b | Rocket launch, mass limits, launch clamps |
| VAB | Existing | Free | 3 | Phase 5b | Rocket assembly, part/size limits |
| Mission Control | Existing | Free | 3 | Phase 5b | Missions, contracts, challenges, achievements |
| Crew Administration | 1 | $100k | 3 | Phase 5b | Crew hire/fire, training, recruitment |
| R&D Lab | 2 | $300k + 20 sci | 3 | Phase 2d | Tech tree access, science yield bonus |
| Tracking Station | 4 | $200k | 3 | Phase 5c | Map view, orbital tracking, deep space comms |
| Satellite Network Ops | 4 | $400k | 3 | Phase 5c | Satellite health, leasing, network management |
| Library | 5 | Free | 1 | Phase 5c | Statistics, body knowledge, rocket showcase |

---

## Estimated New Files Per Phase

| Phase | New Core Files | New Data Files | New UI Files |
|-------|---------------|---------------|-------------|
| 1 | contracts.js | -- | construction.js (extends missionControl, crewAdmin, vab) |
| 2 | research.js, sciencemodule.js (extend) | biomes.js, techtree.js | research.js |
| 3 | reliability.js, thermal.js | -- | -- (extends vab, flightHud) |
| 4 | orbital.js, comms.js, lifesupport.js | satellites.js | mapView.js |
| 5 | facilities.js | -- | -- (extends construction.js from Phase 1) |
| 6 | transfers.js | bodies.js | -- (extends mapView) |
| 7 | challenges.js | challenges.js | statistics.js, library.js |
