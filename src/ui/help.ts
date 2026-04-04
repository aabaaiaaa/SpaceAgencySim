/**
 * help.ts — In-game help panel.
 *
 * Full-screen overlay with a sidebar of topic sections and a scrollable
 * content area.  Accessible from the hamburger menu on every screen.
 * The panel auto-opens to the section relevant to the current screen.
 *
 * @module ui/help
 */

import { createListenerTracker } from './listenerTracker.js';
import './help.css';

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

interface HelpSection {
  id: string;
  label: string;
}

const SECTIONS: HelpSection[] = [
  { id: 'overview',    label: 'Getting Started' },
  { id: 'hub',         label: 'Space Agency Hub' },
  { id: 'vab',         label: 'Vehicle Assembly' },
  { id: 'flight',      label: 'Flight Controls' },
  { id: 'orbit',       label: 'Orbital Mechanics' },
  { id: 'missions',    label: 'Missions & Contracts' },
  { id: 'crew',        label: 'Crew Management' },
  { id: 'finance',     label: 'Finance & Economy' },
  { id: 'facilities',  label: 'Facilities & Upgrades' },
  { id: 'satellites',  label: 'Satellites & Science' },
  { id: 'advanced',    label: 'Advanced Systems' },
];

// ---------------------------------------------------------------------------
// Section content builders
// ---------------------------------------------------------------------------

function _buildOverviewSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Getting Started</h2>
    <p>Welcome to <strong>Space Agency Simulator</strong> — a rocket physics and space agency management game.
       Design rockets, launch them into space, complete missions, and grow your agency from a small
       startup into an interplanetary programme.</p>

    <h3>Game Modes</h3>
    <table class="help-table">
      <tr><td><strong>Tutorial</strong></td><td>Guided progression — missions unlock parts and facilities step by step. Best for new players.</td></tr>
      <tr><td><strong>Freeplay</strong></td><td>All starter parts available from the beginning. Missions and contracts still provide rewards.</td></tr>
      <tr><td><strong>Sandbox</strong></td><td>Everything unlocked, unlimited funds. Toggle malfunctions and weather freely. Great for experimenting.</td></tr>
    </table>

    <h3>Basic Flow</h3>
    <ol>
      <li>Accept a <strong>mission</strong> from Mission Control.</li>
      <li>Design a rocket in the <strong>Vehicle Assembly Building</strong> (VAB).</li>
      <li>Launch and fly the rocket to complete the mission objectives.</li>
      <li>Return to the agency to collect your reward and unlock new parts.</li>
      <li>Use rewards to hire crew, upgrade facilities, and take on harder missions.</li>
    </ol>

    <h3>Saving Your Game</h3>
    <p>Open the <kbd>\u2630</kbd> hamburger menu (top-right) at any time to save your game.
       There are 5 save slots available. The game does not auto-save.</p>
  `;
  return el;
}

function _buildHubSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Space Agency Hub</h2>
    <p>The hub is your agency's home base. Click on buildings to access their functions.</p>

    <h3>Buildings</h3>
    <table class="help-table">
      <tr><td><strong>Vehicle Assembly Building</strong></td><td>Design and build rockets from available parts.</td></tr>
      <tr><td><strong>Mission Control</strong></td><td>Accept missions and contracts, view objectives, track achievements.</td></tr>
      <tr><td><strong>Launch Pad</strong></td><td>Re-launch previously built rocket designs without rebuilding.</td></tr>
      <tr><td><strong>Crew Administration</strong></td><td>Hire astronauts, assign them to flights, train skills. <em>(Unlocked via tutorial mission.)</em></td></tr>
      <tr><td><strong>Tracking Station</strong></td><td>Monitor orbital objects, plan transfers. <em>(Unlocked via tutorial mission.)</em></td></tr>
      <tr><td><strong>R&D Lab</strong></td><td>Research new technologies using science points. <em>(Unlocked via tutorial mission.)</em></td></tr>
      <tr><td><strong>Satellite Ops</strong></td><td>Manage your satellite network. <em>(Unlocked via tutorial mission.)</em></td></tr>
      <tr><td><strong>Library</strong></td><td>View agency statistics, flight records, and rocket designs.</td></tr>
    </table>

    <h3>Post-Flight Results</h3>
    <p>After returning from a flight, the hub shows a summary of completed missions,
       earned rewards, crew experience, and any parts that were recovered.</p>
  `;
  return el;
}

function _buildVabSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Vehicle Assembly Building</h2>
    <p>The VAB is where you design rockets by placing and connecting parts on a grid.</p>

    <h3>Building a Rocket</h3>
    <ol>
      <li><strong>Drag parts</strong> from the parts panel (right side) onto the build canvas.</li>
      <li>Parts <strong>snap together</strong> automatically when placed near compatible connection points.</li>
      <li>Every rocket needs a <strong>command module</strong> (crewed) or <strong>computer module</strong> (probe) as its root.</li>
      <li>All parts must be <strong>connected</strong> — floating parts will fail validation.</li>
    </ol>

    <h3>Part Types</h3>
    <p>Parts are grouped into categories: Engines, Fuel Tanks, Command Modules, Parachutes,
       Decouplers, Landing Legs, and more. Each part has mass, cost, and special properties.
       Click a part in the panel to see its stats.</p>

    <h3>Staging</h3>
    <p>Open the <strong>Staging</strong> panel to control the order parts activate during flight.
       Stage 1 fires first (usually engines). Decouplers and parachutes go in later stages.
       Engines and SRBs are auto-staged when placed.</p>

    <h3>Rocket Engineer</h3>
    <p>The Rocket Engineer panel shows validation checks:</p>
    <ul>
      <li>Command/computer module present</li>
      <li>All parts connected (no floating parts)</li>
      <li>Stage 1 has at least one engine</li>
      <li>Thrust-to-weight ratio (TWR) is above 1.0</li>
    </ul>
    <p>The Launch button is disabled until all checks pass.</p>

    <h3>Design Library</h3>
    <p>Save your rocket designs via the toolbar to reuse them later from the Launch Pad.</p>
  `;
  return el;
}

function _buildFlightSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Flight Controls</h2>
    <p>Once launched, you control your rocket with keyboard inputs. The flight HUD
       shows telemetry on the left and mission objectives on the right.</p>

    <h3>Throttle</h3>
    <table class="help-table">
      <tr><td><kbd>W</kbd> / <kbd>\u2191</kbd></td><td>Increase throttle (+5%)</td></tr>
      <tr><td><kbd>S</kbd> / <kbd>\u2193</kbd></td><td>Decrease throttle (-5%)</td></tr>
      <tr><td><kbd>Z</kbd></td><td>Full throttle (100%)</td></tr>
      <tr><td><kbd>X</kbd></td><td>Cut throttle (0%)</td></tr>
    </table>

    <h3>Steering</h3>
    <table class="help-table">
      <tr><td><kbd>A</kbd> / <kbd>\u2190</kbd></td><td>Rotate counter-clockwise</td></tr>
      <tr><td><kbd>D</kbd> / <kbd>\u2192</kbd></td><td>Rotate clockwise</td></tr>
    </table>

    <h3>Staging & Other</h3>
    <table class="help-table">
      <tr><td><kbd>Space</kbd></td><td>Fire next stage (engines, decouplers, parachutes)</td></tr>
      <tr><td><kbd>M</kbd></td><td>Toggle map view (when in orbit)</td></tr>
      <tr><td><kbd>V</kbd></td><td>Toggle docking mode (when in orbit)</td></tr>
      <tr><td><kbd>R</kbd></td><td>Toggle RCS mode (inside docking mode)</td></tr>
    </table>

    <h3>Time Warp</h3>
    <p>Use the time warp buttons in the HUD to speed up the simulation. Time warp is
       disabled briefly after staging (lockout period). Higher warp speeds are available
       at higher altitudes.</p>

    <h3>Flight HUD</h3>
    <ul>
      <li><strong>Altitude</strong> — height above the surface in metres</li>
      <li><strong>Vertical speed</strong> — rate of climb or descent (m/s)</li>
      <li><strong>Horizontal speed</strong> — lateral velocity (m/s)</li>
      <li><strong>Throttle bar</strong> — current engine power (0-100%)</li>
      <li><strong>Fuel gauges</strong> — remaining fuel per active tank</li>
      <li><strong>Stage counter</strong> — current stage / total stages</li>
    </ul>

    <h3>Landing</h3>
    <p>To land safely, reduce your speed below <strong>10 m/s</strong> before touching the ground.
       Deploy parachutes or use engine braking. Landing legs provide stability.
       Hard landings can injure crew or destroy parts.</p>
  `;
  return el;
}

function _buildOrbitSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Orbital Mechanics</h2>
    <p>Once your rocket reaches sufficient altitude and speed, it enters orbit.
       Orbital flight follows Keplerian physics — your trajectory is determined by
       velocity and altitude.</p>

    <h3>Reaching Orbit</h3>
    <p>To enter orbit around Earth, you need:</p>
    <ul>
      <li>Altitude above <strong>80 km</strong> (above the atmosphere)</li>
      <li>Horizontal velocity of approximately <strong>7,800 m/s</strong></li>
    </ul>
    <p>Tip: After clearing the atmosphere, tilt your rocket sideways and burn horizontally.</p>

    <h3>Map View</h3>
    <p>Press <kbd>M</kbd> to open the orbital map. This shows your orbit path,
       periapsis (lowest point), apoapsis (highest point), and any tracked objects.</p>

    <h3>Orbital Manoeuvres</h3>
    <table class="help-table">
      <tr><td><strong>Prograde burn</strong></td><td>Thrust in your direction of travel — raises the opposite side of your orbit.</td></tr>
      <tr><td><strong>Retrograde burn</strong></td><td>Thrust against your travel — lowers the opposite side. Used for de-orbiting.</td></tr>
    </table>

    <h3>Docking</h3>
    <p>Press <kbd>V</kbd> in orbit to enter docking mode. Docking lets you connect to
       other vessels for fuel transfer, crew transfer, or satellite servicing.
       Use <kbd>R</kbd> for fine RCS control during approach.</p>

    <h3>Interplanetary Transfers</h3>
    <p>Burn to escape Earth's sphere of influence to travel to the Moon, Mars, and beyond.
       Transfer orbits require careful planning and significant delta-v.</p>
  `;
  return el;
}

function _buildMissionsSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Missions & Contracts</h2>

    <h3>Tutorial Missions</h3>
    <p>In Tutorial mode, missions unlock in sequence. Complete each mission to unlock new parts
       and facilities. The early missions teach core skills: reaching altitude, landing safely,
       staging, and eventually reaching orbit.</p>

    <h3>Contracts</h3>
    <p>Contracts are procedurally generated objectives with cash rewards. They appear on the
       Contracts Board in Mission Control and cover categories like:</p>
    <ul>
      <li>Altitude records</li>
      <li>Speed achievements</li>
      <li>Science data collection</li>
      <li>Satellite deployment</li>
      <li>Safe recovery missions</li>
    </ul>
    <p>You can have multiple active contracts at once (limit depends on Mission Control tier).
       Cancelling a contract incurs a 25% penalty fee.</p>

    <h3>Objectives</h3>
    <p>Each mission or contract has one or more objectives that are checked automatically
       during flight. Objective types include reaching an altitude, achieving a speed,
       landing safely, deploying a satellite, and more.</p>

    <h3>Rewards</h3>
    <p>Completing missions awards cash, unlocks new parts, and sometimes unlocks
       new facilities. Your agency's reputation also increases with successful missions.</p>
  `;
  return el;
}

function _buildCrewSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Crew Management</h2>
    <p>Crew Administration lets you hire and manage astronauts for crewed flights.
       <em>This facility is unlocked via a tutorial mission.</em></p>

    <h3>Hiring</h3>
    <p>Hire astronauts for <strong>$50,000</strong> each (adjusted by reputation).
       Each astronaut has three skills: Piloting, Engineering, and Science.
       New hires start with base-level skills.</p>

    <h3>Skills</h3>
    <table class="help-table">
      <tr><td><strong>Piloting</strong></td><td>Affects landing precision and control.</td></tr>
      <tr><td><strong>Engineering</strong></td><td>Reduces malfunction chance, improves repairs.</td></tr>
      <tr><td><strong>Science</strong></td><td>Increases science experiment yields.</td></tr>
    </table>
    <p>Skills improve through flights and training courses (available at Crew Admin Tier 2).</p>

    <h3>Assignment</h3>
    <p>Assign crew to a rocket before launch. The rocket must have a crewed command module
       with enough seats. Uncrewed flights use a computer/probe module instead.</p>

    <h3>Injuries & Death</h3>
    <p>Hard landings (above 10 m/s) or emergency ejections can injure crew, making them
       unavailable for several periods. Crashes can be fatal — each death costs a
       <strong>$500,000</strong> fine.</p>
  `;
  return el;
}

function _buildFinanceSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Finance & Economy</h2>

    <h3>Starting Conditions</h3>
    <p>You begin with <strong>$2,000,000</strong> in cash and a <strong>$2,000,000</strong> loan
       at 3% interest per period. Sandbox mode starts with near-unlimited funds.</p>

    <h3>Income</h3>
    <ul>
      <li><strong>Mission rewards</strong> — cash for completing missions and contracts</li>
      <li><strong>Part recovery</strong> — 60% refund when parts land safely</li>
      <li><strong>Satellite leasing</strong> — passive income from deployed satellites</li>
    </ul>

    <h3>Expenses</h3>
    <ul>
      <li><strong>Part costs</strong> — each part purchased in the VAB costs money</li>
      <li><strong>Crew salaries</strong> — per-period cost for each active astronaut</li>
      <li><strong>Facility upkeep</strong> — $10,000 per facility per period</li>
      <li><strong>Loan interest</strong> — 3% compounded each period</li>
      <li><strong>Training costs</strong> — crew skill training courses</li>
      <li><strong>Death fines</strong> — $500,000 per astronaut killed</li>
    </ul>

    <h3>Loan Management</h3>
    <p>Click the cash display in the top bar to manage your loan. You can pay down
       the balance to reduce interest, or borrow more (up to $10,000,000 maximum).
       Keeping your loan low saves money in the long run.</p>

    <h3>Bankruptcy</h3>
    <p>If your total purchasing power (cash + available borrowing) falls below the cost
       of the cheapest buildable rocket, your agency goes bankrupt.</p>
  `;
  return el;
}

function _buildFacilitiesSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Facilities & Upgrades</h2>
    <p>Facilities provide the core capabilities of your agency. Each can be upgraded
       to higher tiers for expanded functionality.</p>

    <h3>Starter Facilities</h3>
    <p>Launch Pad, VAB, and Mission Control are available from the start.</p>

    <h3>Upgradeable Facilities</h3>
    <table class="help-table">
      <tr><td><strong>Launch Pad</strong></td><td>Higher tiers allow heavier rockets.</td></tr>
      <tr><td><strong>VAB</strong></td><td>Higher tiers allow more parts and larger rockets.</td></tr>
      <tr><td><strong>Mission Control</strong></td><td>More active contracts and larger contract pool.</td></tr>
      <tr><td><strong>Crew Admin</strong></td><td>Training slots, experienced crew recruitment.</td></tr>
      <tr><td><strong>Tracking Station</strong></td><td>Extended map view scope and tracking range.</td></tr>
      <tr><td><strong>R&D Lab</strong></td><td>Advanced research capabilities (costs science points).</td></tr>
      <tr><td><strong>Satellite Ops</strong></td><td>Larger satellite network capacity.</td></tr>
    </table>

    <h3>Building & Upgrading</h3>
    <p>In Tutorial mode, facilities are awarded by missions. In Freeplay mode,
       build facilities from the Construction menu on the hub. Each upgrade costs
       money (and sometimes science points for the R&D Lab). High reputation
       provides a discount on facility costs.</p>
  `;
  return el;
}

function _buildSatellitesSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Satellites & Science</h2>

    <h3>Deploying Satellites</h3>
    <p>Include a satellite part in your rocket, reach orbit, then stage it to release.
       Deployed satellites are tracked as orbital objects and provide passive benefits.</p>

    <h3>Satellite Types</h3>
    <p>Different satellite types serve different purposes: communications, weather observation,
       GPS navigation, and science. Building a <strong>constellation</strong> of 3+ satellites
       of the same type provides bonus effects.</p>

    <h3>Satellite Maintenance</h3>
    <p>Satellites degrade over time and lose effectiveness. They can be repaired via
       service missions using a grabbing arm. The Satellite Ops facility manages
       your network.</p>

    <h3>Science System</h3>
    <p>Science modules collect data from different biomes and altitudes. Each unique
       combination of instrument and biome yields science points, with diminishing
       returns for repeated collections. Science points are used at the R&D Lab
       to research new technologies.</p>

    <h3>Surface Operations</h3>
    <p>When landed on a celestial body, crewed missions can plant flags, collect samples,
       and deploy instruments. Samples returned to Earth award bonus science points.</p>
  `;
  return el;
}

function _buildAdvancedSection(): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = `
    <h2>Advanced Systems</h2>

    <h3>Weather</h3>
    <p>Weather conditions at the launch site affect visibility and engine performance.
       Extreme weather may make launching dangerous. You can skip a weather day for a fee
       (cost escalates with consecutive skips).</p>

    <h3>Malfunctions</h3>
    <p>Parts can malfunction during flight based on their reliability rating. Malfunction types
       include engine flameout, fuel leaks, stuck decouplers, and more. Some malfunctions
       can be recovered via the right-click context menu. Crew engineering skill reduces
       malfunction chance.</p>

    <h3>Part Inventory & Wear</h3>
    <p>Parts that survive a flight are recovered to your inventory with accumulated wear.
       Worn parts have reduced reliability. You can refurbish parts (reset wear for a fee)
       or scrap them (recover some cash).</p>

    <h3>Difficulty Settings</h3>
    <p>In Sandbox mode, open Game Settings from the hamburger menu to adjust:</p>
    <ul>
      <li>Malfunction frequency (Off / Low / Normal / High)</li>
      <li>Weather severity (Off / Mild / Normal / Extreme)</li>
      <li>Financial pressure (Easy / Normal / Hard)</li>
      <li>Crew injury duration (Short / Normal / Long)</li>
    </ul>

    <h3>Challenges & Achievements</h3>
    <p>The Challenges tab in Mission Control offers replayable challenge missions with
       scoring. You can also create custom challenges. Achievements are one-time prestige
       milestones awarded for major accomplishments (first orbit, first lunar landing, etc.).</p>

    <h3>Celestial Bodies</h3>
    <p>The game includes Earth, Moon, Mars, Venus, Mercury, and the Sun. Each body has
       unique gravity, atmosphere, biomes, and landing conditions. Interplanetary travel
       requires escape trajectories and transfer orbits.</p>
  `;
  return el;
}

// Map section ID to builder function
const SECTION_BUILDERS: Record<string, () => HTMLDivElement> = {
  overview:   _buildOverviewSection,
  hub:        _buildHubSection,
  vab:        _buildVabSection,
  flight:     _buildFlightSection,
  orbit:      _buildOrbitSection,
  missions:   _buildMissionsSection,
  crew:       _buildCrewSection,
  finance:    _buildFinanceSection,
  facilities: _buildFacilitiesSection,
  satellites: _buildSatellitesSection,
  advanced:   _buildAdvancedSection,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the help panel overlay.
 *
 * @param container       The #ui-overlay div (or document.body).
 * @param _state          Game state (unused for now, reserved).
 * @param defaultSection  Section ID to show initially.
 */
export function openHelpPanel(container: HTMLElement, _state: unknown, defaultSection: string = 'overview'): void {
  // Prevent duplicate.
  if (document.getElementById('help-panel')) return;

  const tracker = createListenerTracker();

  /** Remove all tracked listeners, then remove the panel from the DOM. */
  function closePanel(): void {
    tracker.removeAll();
    panel.remove();
  }

  const panel = document.createElement('div');
  panel.id = 'help-panel';

  // ── Sidebar ─────────────────────────────────────────────────────────────
  const sidebar = document.createElement('nav');
  sidebar.className = 'help-sidebar';

  const sidebarTitle = document.createElement('h2');
  sidebarTitle.className = 'help-sidebar-title';
  sidebarTitle.textContent = 'Help';
  sidebar.appendChild(sidebarTitle);

  // ── Content wrapper ─────────────────────────────────────────────────────
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'help-content-wrapper';

  // Close x button
  const topbar = document.createElement('div');
  topbar.className = 'help-topbar';
  const closeX = document.createElement('button');
  closeX.className = 'help-close-x';
  closeX.textContent = '\u00D7';
  closeX.title = 'Close help';
  tracker.add(closeX, 'click', () => closePanel());
  topbar.appendChild(closeX);
  contentWrapper.appendChild(topbar);

  // Scrollable content area
  const content = document.createElement('div');
  content.className = 'help-content';
  contentWrapper.appendChild(content);

  // ── Section switching ───────────────────────────────────────────────────
  let activeId: string = SECTIONS.some((s) => s.id === defaultSection)
    ? defaultSection
    : 'overview';

  function showSection(sectionId: string): void {
    activeId = sectionId;

    // Update sidebar active state.
    for (const btn of sidebar.querySelectorAll('.help-sidebar-item')) {
      (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.section === sectionId);
    }

    // Render content.
    content.innerHTML = '';
    const builder = SECTION_BUILDERS[sectionId];
    if (builder) {
      content.appendChild(builder());
    }

    // Close button at bottom of content.
    const closeBtn = document.createElement('button');
    closeBtn.className = 'help-close-btn';
    closeBtn.textContent = '\u2190 Close Help';
    tracker.add(closeBtn, 'click', () => closePanel());
    content.appendChild(closeBtn);

    // Scroll to top.
    content.scrollTop = 0;
  }

  // Build sidebar buttons.
  for (const section of SECTIONS) {
    const btn = document.createElement('button');
    btn.className = 'help-sidebar-item';
    btn.dataset.section = section.id;
    btn.textContent = section.label;
    tracker.add(btn, 'click', () => showSection(section.id));
    sidebar.appendChild(btn);
  }

  panel.appendChild(sidebar);
  panel.appendChild(contentWrapper);
  container.appendChild(panel);

  // Escape key closes the help panel.
  tracker.add(document, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Escape') closePanel();
  }) as EventListener);

  // Show the initial section.
  showSection(activeId);
}
