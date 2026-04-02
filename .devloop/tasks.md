# UX Polish Tasks

### TASK-001: Fix "Back" button destroying hub for Tracking Station, Satellite Ops, Library
- **Status**: done
- **Dependencies**: none
- **Description**: Clicking "Back" from Tracking Station, Satellite Ops, or Library leaves a blank screen with only the topbar. The onBack callbacks in `src/ui/index.js` call `showHubScene()` and `initHubUI()` but the facility UI modules aren't cleaning up properly. Compare the working cleanup pattern used by Crew Admin and Mission Control (which use `← Hub` and work correctly) with the broken pattern in these three facilities. Fix the teardown/cleanup in each module so the hub re-renders correctly. See requirements section 1.1.
- **Verification**: Start game, load "All Facilities Unlocked" debug save, click Tracking Station then "Back" — hub must render fully. Repeat for Satellite Ops and Library. All three must return to a fully functional hub.

### TASK-002: Add R&D Lab navigation handler and tech tree panel
- **Status**: done
- **Dependencies**: none
- **Description**: `_handleNavigation()` in `src/ui/index.js` has no `if (destination === 'rd-lab')` case — the tech tree is completely inaccessible from the hub. Add a handler following the same pattern as other facilities. Check if an `initRdLabUI` function already exists; if not, create a tech tree panel that displays the tech tree data from `src/data/techtree.js` and allows purchasing nodes with science points + funds. See requirements section 1.2.
- **Verification**: Click R&D Lab on the hub — a tech tree panel must open showing available and researched nodes. Click "Back"/"← Hub" to return to hub without breaking it.

### TASK-003: Hide unbuilt facilities on hub in tutorial mode
- **Status**: done
- **Dependencies**: none
- **Description**: `_renderBuildings()` in `src/ui/hub.js` (lines 1532-1572) renders all 8 buildings unconditionally. It must check `hasFacility(state, buildingId)` and only render built facilities. Unbuilt facilities should be hidden entirely (not greyed out — just absent). The navigation handler in `src/ui/index.js` should also check facility lock state and show a tooltip/message if the player somehow clicks a locked facility. In non-tutorial mode (Freeplay), facilities that haven't been built yet via the Construction menu should also not appear. In Sandbox mode, all facilities are always built so all should show. See requirements section 1.3.
- **Verification**: Start a fresh Tutorial game — only Launch Pad, VAB, and MCC should be visible on the hub. Accept mission-018 (First Crew Flight) — Crew Admin should appear on the hub after accepting.

### TASK-004: Fix Load Game functionality
- **Status**: done
- **Dependencies**: none
- **Description**: The "Load Game" option in the hamburger menu currently exits to the main menu (which has no load UI), destroying unsaved progress without warning. Fix in two parts: (a) Add a Load Game dialog as a modal overlay within the hub, matching the Save Game dialog style — show 5 slots with saved game info and "Load" buttons. (b) Add a "Load Game" section to the main menu below the New Game form. If any save slots contain data, show them with a "Load" button. See requirements sections 1.4 and 1.5.
- **Verification**: From the hub, click hamburger menu > Load Game — a modal should appear showing save slots (not navigate away). From the main menu, saved games should be visible and loadable.

### TASK-005: Add welcome/introduction message for new games
- **Status**: done
- **Dependencies**: TASK-003
- **Description**: When starting a new game, show a dismissable welcome modal/overlay on first entering the hub. Content varies by mode: Tutorial — "Welcome to [Agency Name]! You've secured $2M in funding (matched by a $2M loan) to build a space programme from scratch. Head to Mission Control to accept your first mission, then build a rocket in the Vehicle Assembly Building and launch it from the Launch Pad. Good luck!" Freeplay — brief intro about all starter parts being available. Sandbox — note that funds are unlimited and all parts/facilities are unlocked. The modal should have a "Let's Go!" button and not appear again for that save. See requirements section 2.1.
- **Verification**: Start a new Tutorial game — a welcome modal must appear explaining the game. Dismiss it and it should not reappear.

### TASK-006: Add facility and part unlock notifications
- **Status**: done
- **Dependencies**: none
- **Description**: When a mission is accepted that has `awardsFacilityOnAccept`, show a prominent notification modal: "[Facility Name] Unlocked!" with a description of what it does and what parts were unlocked. The four facility-awarding missions are: mission-018 (crew-admin + cmd-mk1), mission-019 (rd-lab + science-module-mk1), mission-020 (tracking-station + docking-port-std), mission-022 (satellite-ops). Also show notifications when `unlockedParts` are awarded on mission completion. See requirements section 2.2.
- **Verification**: Accept mission-018 in MCC — a notification modal should appear saying "Crew Administration Unlocked!" and mentioning the Command Module. Dismiss to continue.

### TASK-007: Fix weather/reputation overlap and hub HUD layout
- **Status**: done
- **Dependencies**: none
- **Description**: The Launch Conditions panel completely covers the Reputation widget. Reposition these widgets so they don't overlap — weather top-left, reputation below it or in a different location. Also move the Construction/Settings buttons into the hamburger menu or a more integrated position instead of floating disconnected in the top-right. Hide the Debug Saves button entirely (or put it behind Ctrl+Shift+D). See requirements sections 2.4, 2.5, 2.6.
- **Verification**: On the hub, both the weather panel and reputation indicator should be fully visible without overlapping. Debug Saves button should not be visible. Settings and Construction should be accessible but not floating disconnected.

### TASK-008: Hide hub elements during flight
- **Status**: done
- **Dependencies**: none
- **Description**: During flight, the hub building labels (Launch Pad, VAB, MCC, etc.), weather panel, reputation widget, and hub action buttons (Debug Saves, Settings, Construction) are all visible behind the flight view. When entering flight mode, fully hide the hub overlay DOM elements. When returning to the hub, re-show them. Also hide the weather panel during ORBIT phase (weather is irrelevant in space). See requirements sections 3.1, 3.2, 3.3.
- **Verification**: Launch a flight — no hub building labels, weather panel, or hub buttons should be visible at any altitude (ground, atmosphere, orbit, map view).

### TASK-009: Fix PART_DESTROYED raw enum in flight log
- **Status**: done
- **Dependencies**: none
- **Description**: When parts are destroyed on crash, the flight log shows "PART_DESTROYED" instead of human-readable messages. Find where crash events are logged and replace the raw enum with the part name: "Probe Core Mk1 destroyed", "Small Tank destroyed", etc. See requirements section 3.5.
- **Verification**: Crash a rocket — the flight log and Rocket Destroyed screen should show specific part names, not "PART_DESTROYED".

### TASK-010: Format altitude in flight log entries
- **Status**: done
- **Dependencies**: none
- **Description**: Flight log entries show raw meters for high altitudes: "Entered low orbit biome at 150000 m." Format altitudes >= 1000m as km: "Entered low orbit biome at 150 km." See requirements section 3.7.
- **Verification**: Fly to orbit — biome transition log entries should show "km" for altitudes above 1000m.

### TASK-011: Standardise back button text across all screens
- **Status**: done
- **Dependencies**: TASK-001
- **Description**: Normalise all back-navigation buttons to use "← Hub" for facility screens. Currently Tracking Station, Satellite Ops, and Library use "Back"; Settings and Construction use "← Back to Hub". Change all to "← Hub" for consistency. Help can keep "← Close Help". See requirements section 5.1.
- **Verification**: Visit every facility screen — all should show "← Hub" as the back button.

### TASK-012: Standardise facility header format
- **Status**: done
- **Dependencies**: none
- **Description**: Each facility displays its tier differently. MCC uses inline "— Tier 1 (Basic)"; Tracking Station uses a separate badge; Satellite Ops uses a badge; Crew Admin sometimes shows no tier; Launch Pad puts it on the right. Standardise to: `[Facility Name] — Tier X (Tier Label)` inline in the H1, matching the MCC pattern. See requirements section 5.2.
- **Verification**: Visit each facility — all should show tier in the same format.

### TASK-013: Create CSS design tokens and standardise styles
- **Status**: done
- **Dependencies**: none
- **Description**: Create a `src/ui/design-tokens.js` (or CSS custom properties file) defining the shared design system: color palette, spacing scale, typography scale, border-radius values (4px/6px/8px), z-index layers, and button variants. Then progressively migrate the most visible inconsistencies — button backgrounds, panel backgrounds, border-radius, font sizes, and modal padding — to use the shared tokens. Focus on the hub, MCC, Crew Admin, VAB toolbar, and flight HUD first. See requirements section 6.
- **Verification**: Visual inspection of hub, MCC, Crew Admin, VAB, and flight HUD — buttons should use consistent colors, panels should have consistent backgrounds, border-radius should be uniform for same-type elements.

### TASK-014: Fix overlay bleed-through on Settings, Construction, Help, Design Library
- **Status**: done
- **Dependencies**: none
- **Description**: The Settings, Construction, Debug Saves, Help, and Design Library panels all allow hub elements to show through behind them. Each overlay needs either a fully opaque background covering the viewport or the underlying hub elements need to be hidden while the overlay is active. See requirements section 6.8.
- **Verification**: Open Settings from hub — no hub buildings or weather panel should be visible behind it. Repeat for Construction, Help, and VAB Design Library.

### TASK-015: Fix money color logic
- **Status**: done
- **Dependencies**: none
- **Description**: Money displayed in red/orange even with $2M starting funds (healthy amount). The color should reflect actual financial health: green when funds > reasonable threshold (e.g., > $500k or > next rocket cost), amber when tight (< $100k), red when near bankruptcy (< $20k or can't afford any rocket). See requirements section 7.1.
- **Verification**: Fresh game with $2M — money should be green. Near Bankruptcy save with $15k — money should be red. Mid-game with healthy funds — money should be green.

### TASK-016: Fix part type enum display in VAB
- **Status**: done
- **Dependencies**: none
- **Description**: Part detail panel in VAB shows raw enum names like "COMPUTER_MODULE". Add a display name formatter that converts enums to readable text: COMPUTER_MODULE → "Computer Module", FUEL_TANK → "Fuel Tank", etc. See requirements section 8.1.
- **Verification**: Click any part in the VAB — the type should show in readable format, not SCREAMING_SNAKE_CASE.

### TASK-017: Fix debug saves to populate available missions
- **Status**: done
- **Dependencies**: none
- **Description**: All debug saves have empty `available` and `accepted` mission arrays. After loading a debug save, the mission unlock evaluation must run to populate available missions based on completed missions and their `unlocksAfter` dependency chains. Check the debug save generation code in `src/ui/debugSaves.js` and the mission unlock logic. See requirements section 1.6.
- **Verification**: Load "Post-Tutorial Basics (Mission 4 Done)" debug save, go to MCC — missions 5, 6, 7, and 18 should be available to accept.

### TASK-018: Add game mode indicator and sandbox weather fix
- **Status**: pending
- **Dependencies**: none
- **Description**: Add a subtle game mode indicator on the hub (e.g., small badge near the agency name showing "Tutorial" / "Freeplay" / "Sandbox"). Also fix sandbox mode to hide the weather panel when `sandboxSettings.weatherEnabled` is false. See requirements sections 2.7 and 2.8.
- **Verification**: Start each game mode — the mode should be visible on the hub. Sandbox should not show weather panel.

### TASK-019: Improve post-flight and crash screen UX
- **Status**: pending
- **Dependencies**: none
- **Description**: (a) Ensure the return-results overlay appears after every flight return, showing: period advanced, operating costs deducted, mission rewards earned, parts recovered, crew status. (b) On the crash screen, if mission objectives were completed, show the reward the player will receive alongside the crash costs. (c) Add a warning about crew death risk before the first crewed flight (either in the mission description or a pre-launch dialog). See requirements section 4.
- **Verification**: Complete a mission and return — a summary overlay should appear showing rewards and costs. Crash with completed objectives — the crash screen should mention the mission reward.

### TASK-020: Style "Flight View"/"Map View" labels as status indicators
- **Status**: pending
- **Dependencies**: none
- **Description**: The "Flight View" and "Map View" labels shown during flight look like clickable buttons but are just status indicators. Restyle them as passive text — smaller, no border, no hover effect, perhaps with a subtle icon. See requirements section 3.6.
- **Verification**: Toggle between flight and map view — the label should look like status text, not a button.

### TASK-021: Fix flight counter and topbar layout consistency
- **Status**: pending
- **Dependencies**: none
- **Description**: Fresh games show no flight counter in the topbar; it only appears after the first flight as "Flight 1", causing the topbar layout to shift. Either always show "Flight 0" on fresh games or ensure the topbar layout doesn't jump when the counter appears. See requirements section 5.3.
- **Verification**: Start a fresh game — the topbar layout should be stable. Complete a flight — the counter should update without layout shift.

### TASK-022: Clear building selection highlight when leaving hub
- **Status**: pending
- **Dependencies**: none
- **Description**: Clicking R&D Lab on the hub adds a yellow highlight border that persists into flight mode (visible behind the flight view). Building selection state must be cleared when navigating away from the hub to any other screen. See requirements section 3.8.
- **Verification**: Click R&D Lab on hub, then launch a flight — no yellow highlight should be visible.

### TASK-023: Fix achievements count and library records data
- **Status**: pending
- **Dependencies**: none
- **Description**: Library shows "Achievements: 3/12" but the Achievements tab shows only 10 milestones — the denominator should match actual defined achievements. Also investigate why Library records (Peak Altitude, Peak Speed, Heaviest Rocket, Longest Flight) show "None" in the Late Game debug save despite 30 successful flights. See requirements section 9.
- **Verification**: Check Library stats — achievement denominator should match actual achievement count. Late Game save should show non-"None" records.

### TASK-024: Verification pass — complete tutorial playthrough via Playwright MCP
- **Status**: pending
- **Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007, TASK-008, TASK-009, TASK-010, TASK-011, TASK-012, TASK-013, TASK-014, TASK-015, TASK-016, TASK-017, TASK-018, TASK-019, TASK-020, TASK-021, TASK-022, TASK-023
- **Description**: Using Playwright MCP against http://localhost:5173/, perform a complete tutorial playthrough from fresh start verifying all fixes. Check: (1) welcome message appears, (2) only 3 buildings visible initially, (3) only starter parts in VAB, (4) mission-001 completable, (5) missions unlock correctly through the chain, (6) facility unlock notifications appear when accepting mission-018/019/020/022, (7) new buildings appear on hub after unlock, (8) new parts appear in VAB after unlock, (9) flight view has no hub bleed-through or weather in space, (10) back navigation works from all facilities, (11) R&D Lab/tech tree accessible, (12) save/load works, (13) post-flight summaries appear, (14) consistent styling throughout. Fix any issues found. See requirements section 10.
- **Verification**: A complete clean tutorial playthrough succeeds with no UX issues — all 12 verification criteria from requirements section 10 pass.
