/**
 * _postFlight.js — Post-flight summary screen rendering, flight event
 * formatting, flight log.
 *
 * @module ui/flightController/_postFlight
 */

import { getPartById } from '../../data/parts.js';
import { PartType, DEATH_FINE_PER_ASTRONAUT } from '../../core/constants.js';
import { processFlightReturn } from '../../core/flightReturn.js';
import { createFlightState } from '../../core/gameState.js';
import { refreshTopBar } from '../topbar.js';
import { getFCState } from './_state.js';
import { stopFlightScene, startFlightScene } from './_init.js';

// ---------------------------------------------------------------------------
// Flight event formatting helpers
// ---------------------------------------------------------------------------

/** Format elapsed flight seconds as `T+MM:SS`. */
export function formatFlightTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Colour for the event-type dot in the flight log. */
export function eventDotColor(type) {
  switch (type) {
    case 'PART_ACTIVATED':
    case 'LEG_DEPLOYED':
    case 'PARACHUTE_DEPLOYED':
    case 'LANDING':
      return '#40e060';
    case 'PART_DESTROYED':
    case 'CRASH':
    case 'PARACHUTE_FAILED':
      return '#ff5040';
    case 'CREW_EJECTED':
      return '#60a0ff';
    case 'SATELLITE_RELEASED':
    case 'SCIENCE_COLLECTED':
    case 'SCIENCE_DATA_RETURNED':
      return '#f0d040';
    case 'PHASE_CHANGE':
      return '#80c0ff';
    default:
      return '#8090a0';
  }
}

/**
 * Produce a human-readable label for events that lack a `description` field.
 * For PART_DESTROYED events this resolves the part name from the catalogue.
 */
function _formatEventFallback(evt) {
  if (evt.type === 'PART_DESTROYED' && evt.partId) {
    const def = getPartById(evt.partId);
    if (def) return `${def.name} destroyed`;
  }
  return evt.type;
}

/**
 * Build the flight event list DOM element from an array of events.
 * @param {Array<object>} events
 * @returns {HTMLElement}  A <ul> or <p> element.
 */
export function buildFlightEventList(events) {
  if (!events || events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'fl-empty';
    empty.textContent = 'No events recorded.';
    return empty;
  }

  const list = document.createElement('ul');
  list.className = 'fl-list';

  for (const evt of events) {
    const li = document.createElement('li');
    li.className = 'fl-event';

    const dot = document.createElement('span');
    dot.className = 'fl-event-dot';
    dot.style.background = eventDotColor(evt.type);

    const time = document.createElement('span');
    time.className = 'fl-event-time';
    time.textContent = formatFlightTime(evt.time ?? 0);

    const desc = document.createElement('span');
    desc.className = 'fl-event-desc';
    desc.textContent = evt.description ?? _formatEventFallback(evt);

    li.appendChild(dot);
    li.appendChild(time);
    li.appendChild(desc);
    list.appendChild(li);
  }

  return list;
}

// ---------------------------------------------------------------------------
// Pure helpers (no module state)
// ---------------------------------------------------------------------------

/**
 * Returns true when all COMMAND_MODULE parts in the given assembly are absent
 * from `ps.activeParts`.
 *
 * @param {import('../../core/physics.js').PhysicsState|null} ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly|null} assembly
 * @returns {boolean}
 */
export function allCommandModulesDestroyedFor(ps, assembly) {
  if (!assembly || !ps) return false;

  let hadCommandModule = false;
  for (const [instanceId, placed] of assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    hadCommandModule = true;
    if (ps.activeParts.has(instanceId)) return false;
  }
  return hadCommandModule;
}

// ---------------------------------------------------------------------------
// Post-flight summary screen
// ---------------------------------------------------------------------------

/**
 * Build and display the post-flight summary overlay.
 *
 * @param {import('../../core/physics.js').PhysicsState|null}           ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly|null}   assembly
 * @param {import('../../core/gameState.js').FlightState|null}          flightState
 * @param {import('../../core/gameState.js').GameState|null}            state
 * @param {((state: any) => void)|null}                                 onFlightEnd
 */
export function showPostFlightSummary(ps, assembly, flightState, state, onFlightEnd) {
  const s = getFCState();
  // Use the #ui-overlay container; fall back to document.body.
  const host = document.getElementById('ui-overlay') ?? document.body;

  // Remove any stale summary overlay.
  const existing = document.getElementById('post-flight-summary');
  if (existing) existing.remove();

  // Hide the flight HUD while the summary is displayed.
  const hudEl = document.getElementById('flight-hud');
  if (hudEl) hudEl.style.display = 'none';

  // ── Determine outcome ────────────────────────────────────────────────────
  const isLanded    = !!(ps && ps.landed && !ps.crashed);
  const isCrashed   = !!(ps && ps.crashed);

  // ── Root overlay ─────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'post-flight-summary';

  // Scrollable content wrapper.
  const content = document.createElement('div');
  content.className = 'pf-content';
  overlay.appendChild(content);

  // ── 1. Flight outcome heading ─────────────────────────────────────────────
  const heading = document.createElement('h1');
  if (isCrashed) {
    heading.textContent  = 'Rocket Destroyed';
    heading.style.color  = '#ff6040';
  } else if (isLanded) {
    heading.textContent  = 'Landed Safely';
    heading.style.color  = '#40e060';
  } else {
    heading.textContent  = 'Mission In Progress';
    heading.style.color  = '#80c8ff';
  }
  content.appendChild(heading);

  // ── 2. Mission objectives ────────────────────────────────────────────────
  if (state) {
    const allMissions = [...(state.missions?.accepted ?? [])];
    const missionsWithObjectives = allMissions.filter(
      (m) => Array.isArray(m.objectives) && m.objectives.length > 0,
    );

    for (const mission of missionsWithObjectives) {
      const section = document.createElement('div');
      section.className = 'pf-section';

      const sectionTitle = document.createElement('h2');
      sectionTitle.textContent = `Mission: ${mission.title}`;
      section.appendChild(sectionTitle);

      const objList = document.createElement('ul');
      objList.className = 'pf-obj-list';

      for (const obj of mission.objectives) {
        const li = document.createElement('li');
        li.className = obj.completed ? 'pf-obj-complete' : 'pf-obj-incomplete';

        const check = document.createElement('span');
        check.className = 'pf-obj-check';
        check.textContent = obj.completed ? '\u2713' : '\u2717';

        const desc = document.createElement('span');
        desc.textContent = obj.description ?? String(obj.type);

        li.appendChild(check);
        li.appendChild(desc);
        objList.appendChild(li);
      }

      section.appendChild(objList);
      content.appendChild(section);
    }
  }

  // ── 3. Part recovery table (landed safely only) ───────────────────────────
  if (isLanded && assembly && ps) {
    const section = document.createElement('div');
    section.className = 'pf-section';

    const sectionTitle = document.createElement('h2');
    sectionTitle.textContent = 'Part Recovery (60 % of cost)';
    section.appendChild(sectionTitle);

    const table = document.createElement('table');
    table.className = 'pf-recovery-table';

    // Header row.
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Part', 'Recovery Value'].forEach((text) => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body rows.
    const tbody = document.createElement('tbody');
    let totalRecovery = 0;

    for (const [instanceId, placed] of assembly.parts) {
      if (!ps.activeParts.has(instanceId)) continue;
      const def = getPartById(placed.partId);
      if (!def) continue;

      const recoveryValue = Math.round((def.cost ?? 0) * 0.6);
      totalRecovery += recoveryValue;

      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = def.name;

      const valueTd = document.createElement('td');
      valueTd.textContent = `$${recoveryValue.toLocaleString('en-US')}`;

      row.appendChild(nameTd);
      row.appendChild(valueTd);
      tbody.appendChild(row);
    }

    // Total row.
    const totalRow = document.createElement('tr');
    totalRow.className = 'pf-recovery-total';

    const totalLabelTd = document.createElement('td');
    totalLabelTd.textContent = 'Total Recovery';

    const totalValueTd = document.createElement('td');
    totalValueTd.textContent = `$${totalRecovery.toLocaleString('en-US')}`;

    totalRow.appendChild(totalLabelTd);
    totalRow.appendChild(totalValueTd);
    tbody.appendChild(totalRow);

    table.appendChild(tbody);
    section.appendChild(table);
    content.appendChild(section);
  }

  // ── 4. Crew KIA with fines ────────────────────────────────────────────────
  if (flightState && Array.isArray(flightState.crewIds) && flightState.crewIds.length > 0 && state) {
    const ejectedIds = ps?.ejectedCrewIds ?? new Set();
    const kiaMembers = [];

    if (isCrashed || allCommandModulesDestroyedFor(ps, assembly)) {
      for (const crewId of flightState.crewIds) {
        if (ejectedIds.has(crewId)) continue;
        const member = (state.crew ?? []).find((c) => c.id === crewId);
        if (member) kiaMembers.push(member);
      }
    }

    if (kiaMembers.length > 0) {
      const section = document.createElement('div');
      section.className = 'pf-section pf-section-danger';

      const sectionTitle = document.createElement('h2');
      sectionTitle.textContent = 'Crew KIA';
      section.appendChild(sectionTitle);

      const kiaList = document.createElement('ul');
      kiaList.className = 'pf-kia-list';

      for (const member of kiaMembers) {
        const li = document.createElement('li');

        const nameSp = document.createElement('span');
        nameSp.textContent = member.name;

        const fineSp = document.createElement('span');
        fineSp.className = 'pf-kia-fine';
        fineSp.textContent = `\u2212$${DEATH_FINE_PER_ASTRONAUT.toLocaleString('en-US')} fine`;

        li.appendChild(nameSp);
        li.appendChild(fineSp);
        kiaList.appendChild(li);
      }

      section.appendChild(kiaList);

      const totalFine = kiaMembers.length * DEATH_FINE_PER_ASTRONAUT;
      const totalEl = document.createElement('div');
      totalEl.className = 'pf-kia-total';
      totalEl.textContent = `Total fines: \u2212$${totalFine.toLocaleString('en-US')}`;
      section.appendChild(totalEl);

      content.appendChild(section);
    }
  }

  // ── 4b. Flight log ────────────────────────────────────────────────────────
  if (flightState?.events?.length > 0) {
    const logSection = document.createElement('div');
    logSection.className = 'pf-section';
    const logTitle = document.createElement('h2');
    logTitle.textContent = 'Flight Log';
    logSection.appendChild(logTitle);
    logSection.appendChild(buildFlightEventList(flightState.events));
    content.appendChild(logSection);
  }

  // ── 5. Action buttons ─────────────────────────────────────────────────────

  let totalRocketCost = 0;
  let recoveryValue = 0;
  if (assembly) {
    for (const [instanceId, placed] of assembly.parts) {
      const def = getPartById(placed.partId);
      if (!def) continue;
      totalRocketCost += def.cost ?? 0;
      if (isLanded && ps && ps.activeParts.has(instanceId)) {
        recoveryValue += Math.round((def.cost ?? 0) * 0.6);
      }
    }
  }

  const buttonsEl = document.createElement('div');
  buttonsEl.className = 'pf-buttons';

  // Helper: create a button with an optional cost subtitle line.
  function _pfBtn(label, costText, cls) {
    const btn = document.createElement('button');
    btn.className = `pf-btn ${cls}`;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);
    if (costText) {
      const costSpan = document.createElement('span');
      costSpan.className = 'pf-btn-cost';
      costSpan.textContent = costText;
      btn.appendChild(costSpan);
    }
    return btn;
  }

  const costStr = totalRocketCost > 0
    ? `\u2212$${totalRocketCost.toLocaleString('en-US')}`
    : null;

  // ── Row of secondary actions (side by side) ────────────────────────────────
  const secondaryRow = document.createElement('div');
  secondaryRow.className = 'pf-btn-row';

  if (isCrashed) {
    // ── "Restart from Launch" ──────────────────────────────────────────────
    const restartBtn = _pfBtn('Restart from Launch', costStr, 'pf-btn-secondary');
    restartBtn.id    = 'post-flight-restart-btn';
    restartBtn.title = 'Rebuild the rocket and restart this flight from the launch pad.';

    restartBtn.addEventListener('click', () => {
      if (totalRocketCost > 0 && state) {
        state.money = (state.money ?? 0) - totalRocketCost;
      }

      const origAssembly = s.originalAssembly;
      const origStaging  = s.originalStagingConfig;
      const ctr          = s.container;
      const gs           = s.state;
      const endCb        = s.onFlightEnd;
      const missionId    = flightState?.missionId ?? '';
      const rocketId     = flightState?.rocketId  ?? '';
      const crewIds      = flightState?.crewIds   ?? [];

      overlay.remove();
      stopFlightScene();

      if (!origAssembly || !origStaging || !ctr || !gs) {
        if (endCb) endCb(gs);
        return;
      }

      let totalFuel = 0;
      for (const placed of origAssembly.parts.values()) {
        const def = getPartById(placed.partId);
        if (def) totalFuel += def.properties?.fuelMass ?? 0;
      }

      // Reset ALL accepted mission objectives.
      if (gs.missions?.accepted) {
        for (const mission of gs.missions.accepted) {
          if (!mission.objectives) continue;
          for (const obj of mission.objectives) {
            obj.completed = false;
            delete obj._holdEnteredAt;
          }
        }
      }

      gs.currentFlight = createFlightState({
        missionId, rocketId, crewIds,
        fuelRemaining: totalFuel, deltaVRemaining: 0,
        bodyId: flightState?.bodyId ?? 'EARTH',
      });

      const freshAssembly = {
        parts:         new Map([...origAssembly.parts].map(([id, p]) => [id, { ...p, ...(p.instruments ? { instruments: [...p.instruments] } : {}) }])),
        connections:   origAssembly.connections.map(c => ({ ...c })),
        symmetryPairs: origAssembly.symmetryPairs.map(sp => [...sp]),
        _nextId:       origAssembly._nextId,
      };
      const freshStaging = {
        stages:          origStaging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
        unstaged:        [...origStaging.unstaged],
        currentStageIdx: 0,
      };

      startFlightScene(ctr, gs, freshAssembly, freshStaging, gs.currentFlight, endCb);
    });
    secondaryRow.appendChild(restartBtn);
  }

  if (!isCrashed) {
    // ── "Continue Flying" ─────────────────────────────────────────────────
    const continueBtn = _pfBtn('Continue Flying', null, 'pf-btn-secondary');
    continueBtn.id    = 'post-flight-continue-btn';
    continueBtn.title = 'Close this summary and continue controlling the landed rocket.';
    continueBtn.addEventListener('click', () => {
      s.summaryShown = false;
      overlay.remove();
      const hud = document.getElementById('flight-hud');
      if (hud) hud.style.display = '';
    });
    secondaryRow.appendChild(continueBtn);
  }

  // ── "Adjust Build" ────────────────────────────────────────────────────────
  {
    const adjustBtn = _pfBtn('Adjust Build', costStr, 'pf-btn-secondary');
    adjustBtn.id    = 'post-flight-adjust-btn';
    adjustBtn.title = 'Return to the Vehicle Assembly Building with this rocket loaded so you can tweak and re-launch.';
    adjustBtn.addEventListener('click', () => {
      if (totalRocketCost > 0 && state) {
        state.money = (state.money ?? 0) - totalRocketCost;
      }

      const origAssembly = s.originalAssembly;
      const origStaging  = s.originalStagingConfig;
      if (origAssembly && state) {
        state.vabAssembly = {
          parts:         [...origAssembly.parts.values()],
          connections:   origAssembly.connections,
          symmetryPairs: origAssembly.symmetryPairs,
          _nextId:       origAssembly._nextId,
        };
        state.vabStagingConfig = origStaging ? {
          stages:          origStaging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
          unstaged:        [...origStaging.unstaged],
          currentStageIdx: 0,
        } : null;
      }

      overlay.remove();
      stopFlightScene();
      if (onFlightEnd) onFlightEnd(state, null, 'vab');
    });
    secondaryRow.appendChild(adjustBtn);
  }

  buttonsEl.appendChild(secondaryRow);

  // ── "Return to Space Agency" button (full width, primary) ─────────────────
  const recoveryCostStr = recoveryValue > 0
    ? `+$${recoveryValue.toLocaleString('en-US')} part recovery`
    : null;
  const returnBtn = _pfBtn('Return to Space Agency', recoveryCostStr, 'pf-btn-primary');
  returnBtn.id    = 'post-flight-return-btn';
  returnBtn.title = 'End this flight, process mission results and part recovery, and return to your Space Agency hub.';
  returnBtn.addEventListener('click', () => {
    let returnResults = null;
    if (state && flightState) {
      returnResults = processFlightReturn(state, flightState, ps, assembly);
    }

    refreshTopBar();
    overlay.remove();
    stopFlightScene();
    if (onFlightEnd) onFlightEnd(state, returnResults);
  });
  buttonsEl.appendChild(returnBtn);

  content.appendChild(buttonsEl);

  // Backdrop-click handling.
  content.addEventListener('click', (e) => e.stopPropagation());
  if (!isCrashed) {
    overlay.addEventListener('click', () => {
      s.summaryShown = false;
      overlay.remove();
      const hud = document.getElementById('flight-hud');
      if (hud) hud.style.display = '';
    });
  }

  host.appendChild(overlay);
}
