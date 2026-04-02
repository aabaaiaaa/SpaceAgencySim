# UX Polish & Consistency Requirements

This document describes the UX issues, styling inconsistencies, and bugs found during a comprehensive audit of the game using Playwright. The previous iteration built out all game features — this iteration focuses exclusively on polishing what exists. No new features; only fixes, consistency improvements, and UX refinements.

---

## 1. Critical Bugs

### 1.1 "Back" button destroys the hub (Tracking Station, Satellite Ops, Library)

Clicking "Back" from Tracking Station, Satellite Ops, or Library returns to a completely blank screen — only the topbar remains, all hub content (buildings, weather, reputation, action buttons) is gone. 100% reproducible.

**Root cause:** The `onBack` callbacks in `src/ui/index.js` (lines 316, 339, 362) correctly call `showHubScene()` and `initHubUI()`, but the `initTrackingStationUI`, `initSatelliteOpsUI`, or `initLibraryUI` cleanup functions are likely not properly tearing down their DOM before the hub re-initialises. These three facilities were added in a later phase and use a different internal pattern than the original facilities (MCC, Crew Admin, VAB, Launch Pad) which work correctly.

**Fix:** Investigate the destroy/cleanup logic in the Tracking Station, Satellite Ops, and Library UI modules. Their back-button handlers must properly clean up before the hub re-renders. Compare with the working pattern used by Crew Admin or Mission Control.

### 1.2 R&D Lab / Tech Tree completely inaccessible

Clicking R&D Lab from the hub only highlights it with a yellow border — no panel opens. This is because `_handleNavigation()` in `src/ui/index.js` has no handler for the `rd-lab` destination. The function handles vab, crew-admin, mission-control, launch-pad, satellite-ops, tracking-station, and library — but `rd-lab` is completely missing.

**Fix:** Add an `if (destination === 'rd-lab')` handler in `_handleNavigation()` following the same pattern as other facilities. This requires either an existing `initRdLabUI` function or creating one that shows the tech tree.

### 1.3 All buildings visible on hub in tutorial mode

The hub renders all 8 facilities (Launch Pad, VAB, MCC, Crew Admin, Tracking Station, R&D Lab, Satellite Ops, Library) as clickable buildings regardless of whether they're built. The Construction menu correctly shows locked facilities, but the hub building renderer ignores lock state entirely.

**Root cause:** `_renderBuildings()` in `src/ui/hub.js` (lines 1532-1572) iterates through the `BUILDINGS` array and renders all buildings unconditionally. The navigation handler in `src/ui/index.js` also has no lock check before opening facility screens.

**Fix:** The hub building renderer must filter buildings based on `hasFacility(state, buildingId)`. Unbuilt facilities should either be hidden entirely or shown as greyed-out placeholders with a "Locked" indicator. The navigation handler should also check facility lock state and show a message instead of opening the panel if the facility isn't built.

### 1.4 "Load Game" exits to main menu, destroying unsaved progress

Clicking "Load Game" from the hamburger menu navigates to the main menu, which has NO load game functionality — only "Start Game". The player's unsaved progress is silently destroyed with no warning or confirmation dialog.

**Fix:** Either (a) show a load game dialog as a modal overlay within the current game (like the save dialog), or (b) add a load/continue section to the main menu. At minimum, add a confirmation dialog before destroying the current game: "Any unsaved progress will be lost. Continue?"

### 1.5 Main menu has no load/continue functionality

The main menu only shows "New Game" with agency name, game mode, and Start Game button. There is no way to load a previously saved game. The `#mm-load-screen` element referenced in E2E tests does not exist in the production UI.

**Fix:** Add a "Load Game" / "Continue" section to the main menu that shows saved game slots (similar to the save dialog).

### 1.6 Debug saves don't populate available missions

Every debug save has `available: []` and `accepted: []` for missions. After loading a mid-game debug save, the MCC shows "No missions currently available" even though missions should be unlockable based on the completed list. The debug save factory doesn't run the mission unlock logic after setting the completed list.

**Fix:** After loading a debug save, run the mission unlock evaluation to populate the available missions list based on completed missions and their dependency chains.

---

## 2. Hub & Navigation UX

### 2.1 No welcome/introduction message

All three game modes (Tutorial, Freeplay, Sandbox) drop the player directly into the hub with no context. Tutorial mode especially needs an introduction that explains: what the player's role is, why they have $2M + a $2M loan, what a "period"/"flight" means, and what to do first (go to Mission Control to accept the first mission). This should be a dismissable modal or overlay that appears once on first entering the hub.

### 2.2 No facility unlock notifications

When accepting a tutorial mission that awards a facility (e.g., "First Crew Flight" awards Crew Admin + cmd-mk1), the facility and parts are silently unlocked. The MCC just returns to the normal mission list. There should be a clear notification/modal: "Crew Administration building unlocked! You can now hire astronauts. Command Module Mk1 is now available in the VAB."

### 2.3 Multiple missions unlock simultaneously without guidance

After mission 4, four missions appear at once (Safe Return I, Controlled Descent, Leg Day, First Crew Flight) with no indication of priority or that "First Crew Flight" is the critical tutorial unlock mission. Tutorial mode should either highlight key missions or provide ordering hints.

### 2.4 Weather panel overlaps Reputation widget

The Launch Conditions panel completely covers the Reputation display on the hub. The Reputation widget exists in the DOM ("50 / Good") but is invisible. These two widgets need separate, non-overlapping positions.

### 2.5 Debug Saves button visible in normal gameplay

The bright orange "Debug Saves" button sits prominently in the top-right corner. This should be hidden in production or behind a developer key combo (e.g., Ctrl+Shift+D).

### 2.6 Construction/Settings/Debug buttons float disconnected

Three action buttons (Debug Saves, Settings, Construction) float in the top-right of the hub with inconsistent styling and no visual grouping. They should be integrated into the hub layout more cohesively — perhaps in a sidebar, the topbar, or the hamburger menu.

### 2.7 No game mode indicator on the hub

There's no visual indication of whether you're in Tutorial, Freeplay, or Sandbox mode once in the game. The hub looks identical for all three modes.

### 2.8 Sandbox shows weather despite it being disabled

Sandbox has `weatherEnabled: false` but the weather panel still displays on the hub. It should be hidden or show "Weather disabled".

---

## 3. Flight View UX

### 3.1 Hub building labels visible during flight

During all flight phases (ground, atmosphere, orbit, map view), the hub building labels (Launch Pad, VAB, MCC, Crew Admin, Tracking Station, R&D Lab, Satellite Ops, Library) are visible at the bottom of the screen. The flight view doesn't properly hide or overlay the hub.

**Fix:** The hub overlay must be fully hidden when entering flight mode. The flight controller should ensure the hub DOM elements are not visible.

### 3.2 Weather panel shown during flight and in space

The Launch Conditions panel (wind, ISP, visibility) persists throughout the entire flight, including at 150km altitude in orbit. Weather is irrelevant above the atmosphere. The panel should be hidden once the craft exits the atmosphere or at minimum during ORBIT phase.

### 3.3 Debug Saves/Settings/Construction visible during flight

These hub-only action buttons persist across all game screens including active flight and orbital views. They should be hidden when not on the hub.

### 3.4 Mission objective overlay overlaps hub buttons

The mission objective tracker in the top-right (e.g., "FIRST FLIGHT / Reach 100 m altitude") overlaps with the Construction button. Since the Construction button shouldn't be visible during flight anyway, fixing 3.3 fixes this too.

### 3.5 "PART_DESTROYED" raw enum in flight log

When parts are destroyed on crash, the flight log shows `PART_DESTROYED` as raw text instead of human-readable messages like "Probe Core Mk1 destroyed" or "Small Tank destroyed". This appears in both the flight log and the Rocket Destroyed post-crash screen.

### 3.6 "Flight View" / "Map View" labels look like buttons

Prominent centered labels toggle between "Map View" and "Flight View" but look like clickable UI elements rather than passive status indicators. They should be styled as status text, not buttons.

### 3.7 Biome transition shows raw altitude in meters

Flight log entries like "Entered low orbit biome at 150000 m." should display formatted altitude: "150 km" instead of "150000 m".

### 3.8 R&D Lab building selection highlight persists into flight

The yellow highlight border from clicking R&D Lab on the hub carries through to the flight view — a visual state leak. Building selection state should be cleared when leaving the hub.

---

## 4. Post-Flight & Return UX

### 4.1 No post-flight summary on return to agency

After completing a flight and returning to the agency, the player goes straight to the hub with no summary of what happened — no period advancement notice, no costs breakdown, no mission rewards. The return-results overlay (`#return-results-dismiss-btn`) exists in code but rarely appears.

### 4.2 Crash screen doesn't show mission rewards

The "Rocket Destroyed" screen shows restart costs but doesn't mention that mission objectives were completed or what reward the player will receive. A new player completing their first mission ever gets no celebration.

### 4.3 Crew KIA fine is very harsh with no warning

A crew death on crash immediately charges $500,000 with no prior indication of the risk. The game should warn new players about crew death consequences before their first crewed flight.

---

## 5. Navigation Consistency

### 5.1 Back button text varies across every screen

| Screen | Button Text |
|---|---|
| MCC, Crew Admin, VAB, Launch Pad | `← Hub` |
| Tracking Station, Satellite Ops, Library | `Back` |
| Settings, Construction | `← Back to Hub` |
| Help | `← Close Help` |

**Fix:** Standardise to `← Hub` for all facility screens. Help can keep `← Close Help` since it's a different context.

### 5.2 Facility header format inconsistent

Each facility shows its tier differently — some inline in the title, some as separate badges, some on the right side, some not at all. Standardise to a consistent format across all facility screens.

### 5.3 Flight counter absent on fresh game

Fresh start shows no flight counter in the topbar. After the first flight, "Flight 1" appears. The topbar layout shifts. Either always show "Flight 0" or handle the layout so it doesn't jump.

### 5.4 Weather display format differs between hub and Launch Pad

Hub shows a full panel with header/title. Launch Pad shows a compact inline bar. Different visual treatment for the same information.

---

## 6. CSS & Styling Consistency

A code audit found systemic inconsistencies across all 15+ UI files. The root cause is that all colors, sizes, and spacing are hardcoded with no shared design tokens.

### 6.1 Create CSS variables for the design system

Define a central set of CSS custom properties for: color palette (backgrounds, text, borders, accents), spacing scale (padding, margins, gaps), typography scale (font sizes for headings, body, labels), border-radius values, and z-index layers. Place these in a shared CSS file or at the `:root` level and migrate existing hardcoded values to use the variables.

### 6.2 Standardise border-radius

Currently 8 different values (3px through 10px) used inconsistently. Standardise to 3 values: 4px (buttons/small), 6px (cards/panels), 8px (modals/large).

### 6.3 Standardise button styles

15+ different button background colors across the codebase. Define 3-4 button variants: primary (actions), secondary (navigation), danger (destructive), and ghost (subtle). Apply consistently.

### 6.4 Standardise panel/modal backgrounds

Multiple slightly different background colors and opacities for overlays and modals. Pick one and use it everywhere.

### 6.5 Standardise font sizes

Panel titles range from 1.3rem to 2rem depending on which screen. Define a typography scale and apply consistently.

### 6.6 Fix z-index layering

Flight HUD and topbar share z-index 100 (collision). Multiple components at z-index 400. Define a clear layering system: base (1-10), hub (10-20), overlays (50), topbar (100), dropdowns (150), modals (200), flight HUD (300).

### 6.7 Standardise padding and spacing

Modal padding varies from `20px` to `36px 24px 44px`. Card padding varies from `12px` to `16px`. Define a spacing scale and apply consistently.

### 6.8 Fix overlay bleed-through

Settings, Construction, Debug Saves, Help, and Design Library panels all allow hub elements to show through behind them. These overlays need proper opaque backgrounds or the underlying elements need to be hidden.

---

## 7. Money Display

### 7.1 Money color logic is misleading

$2,000,000 starting funds shown in red/orange (warning color), which signals "danger" when the player has plenty of cash. The color appears based on loan balance, not financial health.

**Fix:** Money should be green when the player has healthy funds, amber when low, red only when at risk of bankruptcy. The threshold should be based on actual financial pressure, not just loan existence.

---

## 8. Part Type Display

### 8.1 "COMPUTER_MODULE" raw enum shown in VAB

The part type display in the VAB detail panel shows programmatic names like `COMPUTER_MODULE` instead of human-readable "Computer Module". All part type enums should be formatted with proper capitalisation and spacing.

---

## 9. Data & Display Issues

### 9.1 Achievements count mismatch

Library shows "Achievements: 3 / 12" but the Achievements tab only shows 10 milestones. The denominator should match the actual number of defined achievements.

### 9.2 Library records show "None" for most stats in Late Game save

Peak Altitude, Peak Speed, Heaviest Rocket, and Longest Flight all show "None" despite 30 successful flights in the Late Game debug save. Either the debug save doesn't populate these fields or the tracking logic isn't recording them.

---

## 10. Verification Pass (Final Gate)

After all fixes are implemented, a complete tutorial playthrough must be performed using Playwright MCP against http://localhost:5173/ to verify:

1. **Fresh tutorial start** shows welcome message, only 3 buildings (Launch Pad, VAB, MCC), and first mission available
2. **Hub building visibility** matches actual built facilities at every stage — no locked facilities visible until their unlock mission is accepted
3. **Part availability** is correctly gated — only starter parts (probe-core-mk1, tank-small, engine-spark, parachute-mk1) at start; cmd-mk1 unlocks when mission-018 is accepted; science-module-mk1 and thermometer-mk1 unlock when mission-005 is completed; etc.
4. **Facility unlock notifications** appear when accepting missions that award facilities (mission-018 awards crew-admin, mission-019 awards rd-lab, mission-020 awards tracking-station, mission-022 awards satellite-ops)
5. **Mission chain** progresses naturally through all 22 missions without dead ends or empty MCC states
6. **Flight view** has no hub element bleed-through, no weather in space, no debug buttons
7. **Post-flight flow** shows proper summaries and rewards
8. **Back navigation** works from every facility screen without breaking the hub
9. **R&D Lab / tech tree** is accessible and functional from the hub
10. **Save/Load** works correctly from both the hub and main menu
11. **All 3 game modes** (Tutorial, Freeplay, Sandbox) have appropriate starting states
12. **No CSS/styling regressions** — consistent buttons, panels, typography

Any issues found during this verification pass must be fixed before the work is considered complete. This is the final gate — the UX polish is not done until a clean playthrough succeeds.
