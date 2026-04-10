/**
 * _mapView.ts — Map view toggle, map HUD building/updating/destroying,
 * map thrust application, warp to target.
 *
 * @module ui/flightController/_mapView
 */

import {
  hideFlightScene,
  showFlightScene,
  setFlightInputEnabled,
} from '../../render/flight.ts';
import {
  showMapScene,
  hideMapScene,
  getMapZoomLevel,
  setMapZoomLevel,
  getMapTarget,
  setMapTarget,
  getSelectedTransferTarget,
  getSelectedAsteroid,
} from '../../render/map.ts';
import {
  MapZoom,
  MapThrustDir,
  computeOrbitalThrustAngle,
  isMapViewAvailable,
  getMapTransferTargets,
  getTransferProgressInfo,
  getAllowedMapZooms,
} from '../../core/mapView.ts';
import { warpToTarget } from '../../core/orbit.ts';
import { FlightPhase, BODY_RADIUS } from '../../core/constants.ts';
import { isPlayerLocked, getPhaseLabel } from '../../core/flightPhase.ts';
import { renameOrbitalObject } from '../../core/satellites.ts';
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';
import { showPhaseNotification } from './_flightPhase.ts';
import { resyncWorkerState } from './_workerBridge.ts';
import { escapeHtml } from '../escapeHtml.ts';

// Re-export setMapTarget for use by _docking.js.
export { setMapTarget };

/** Human-readable zoom level names. */
const ZOOM_LABELS: Record<string, string> = {
  [MapZoom.ORBIT_DETAIL]:    'Orbit Detail',
  [MapZoom.LOCAL_BODY]:      'Local Body',
  [MapZoom.CRAFT_TO_TARGET]: 'Craft \u2192 Target',
  [MapZoom.SOLAR_SYSTEM]:    'Solar System',
};

/**
 * Toggle between the flight view and the top-down orbital map view.
 * Shows a control-tip notification each time the view is swapped.
 */
export function toggleMapView(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !flightState) return;

  // During TRANSFER/CAPTURE, the player cannot leave the map view.
  if (s.mapActive && isPlayerLocked(flightState.phase)) {
    showPhaseNotification('Cannot leave map during ' + getPhaseLabel(flightState.phase));
    return;
  }

  // Check availability (Tracking Station facility).
  if (!s.mapActive && !isMapViewAvailable(s.state!)) {
    showPhaseNotification('Tracking Station required');
    return;
  }

  s.mapActive = !s.mapActive;

  if (s.mapActive) {
    // Switch to map view.
    hideFlightScene();
    setFlightInputEnabled(false);
    showMapScene();
    buildMapHud();
    showPhaseNotification('\u{1F4E1} Map View', 'status');
  } else {
    // Switch back to flight view.
    hideMapScene();
    showFlightScene();
    setFlightInputEnabled(true);
    destroyMapHud();

    // Cut any map thrust that was in progress.
    if (s.mapThrusting) {
      ps.throttle = 0;
      s.mapThrusting = false;
    }
    s.mapHeldKeys.clear();

    showPhaseNotification('\u{1F680} Flight View', 'status');
  }
}

/**
 * Apply orbital-relative thrust based on map-held keys.
 * Only effective during ORBIT phase when the map view is active.
 */
export function applyMapThrust(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!s.mapActive || !ps || !flightState) return;

  // Apply orbital thrust in ORBIT, MANOEUVRE, TRANSFER, or CAPTURE phases.
  const phase: string = flightState.phase;
  if (phase !== FlightPhase.ORBIT && phase !== FlightPhase.MANOEUVRE &&
      phase !== FlightPhase.TRANSFER && phase !== FlightPhase.CAPTURE) {
    if (s.mapThrusting) {
      ps.throttle = 0;
      s.mapThrusting = false;
    }
    return;
  }

  // Determine thrust direction from held keys (priority order).
  let direction: string | null = null;
  if (s.mapHeldKeys.has('w'))      direction = MapThrustDir.PROGRADE;
  else if (s.mapHeldKeys.has('s')) direction = MapThrustDir.RETROGRADE;
  else if (s.mapHeldKeys.has('a')) direction = MapThrustDir.RADIAL_IN;
  else if (s.mapHeldKeys.has('d')) direction = MapThrustDir.RADIAL_OUT;

  const bodyId: string = flightState.bodyId || 'EARTH';

  if (direction) {
    ps.angle = computeOrbitalThrustAngle(ps, bodyId, direction);
    if (ps.throttle === 0) ps.throttle = 1;
    s.mapThrusting = true;
  } else if (s.mapThrusting) {
    // No keys held -- cut thrust.
    ps.throttle = 0;
    s.mapThrusting = false;
  }
}

/**
 * Handle the "Warp to target" action.
 */
export function handleWarpToTarget(): void {
  const s = getFCState();
  const flightState = getFlightState();
  if (!flightState || !flightState.orbitalElements || !s.state) return;

  const targetId: string | null = getMapTarget();
  if (!targetId) {
    showPhaseNotification('No target selected \u2014 press T to select');
    return;
  }

  const targetObj = (s.state.orbitalObjects || []).find(o => o.id === targetId);
  if (!targetObj) {
    showPhaseNotification('Target not found');
    return;
  }

  const warpBodyId: string = (flightState && flightState.bodyId) || 'EARTH';
  const result = warpToTarget(
    flightState.orbitalElements,
    targetObj.elements,
    warpBodyId,
    flightState.timeElapsed,
  );

  if (!result.possible) {
    showPhaseNotification('Warp impossible \u2014 orbits do not intersect');
    return;
  }

  // Advance the flight time.
  flightState.timeElapsed = result.time!;

  // Log the warp event.
  flightState.events.push({
    time: result.time!,
    type: 'TIME_WARP',
    description: `Warped ${(result.elapsed! / 60).toFixed(1)} min to target "${targetObj.name}"`,
  });

  // Push the time advancement to the worker so it doesn't overwrite it.
  const ps = getPhysicsState();
  const fcState = getFCState();
  if (ps && fcState.assembly && fcState.stagingConfig) {
    resyncWorkerState(ps, fcState.assembly, fcState.stagingConfig, flightState).catch(() => {});
  }

  showPhaseNotification(`Warped to ${targetObj.name}`);
}

/**
 * Handle renaming a persistent (captured) asteroid.
 * Shows a modal dialog prompting for a new name.
 */
export function handleRenameAsteroid(): void {
  const s = getFCState();
  if (!s.state) return;

  const targetId: string | null = getMapTarget();
  if (!targetId) {
    showPhaseNotification('No target selected');
    return;
  }

  const obj = (s.state.orbitalObjects || []).find(o => o.id === targetId);
  if (!obj || obj.type !== 'asteroid') {
    showPhaseNotification('Can only rename captured asteroids');
    return;
  }

  // Prevent opening multiple rename dialogs.
  if (document.getElementById('rename-asteroid-overlay')) return;

  // Create a simple prompt overlay.
  const overlay = document.createElement('div');
  overlay.id = 'rename-asteroid-overlay';
  overlay.classList.add('rename-asteroid-overlay');

  const dialog = document.createElement('div');
  dialog.classList.add('rename-asteroid-dialog');
  dialog.innerHTML = `
    <div class="rename-asteroid-title">Rename Asteroid</div>
    <input type="text" id="rename-asteroid-input" class="rename-asteroid-input" value="${escapeHtml(obj.name)}"
           maxlength="32" />
    <div class="rename-asteroid-actions">
      <button id="rename-asteroid-cancel" class="rename-asteroid-btn rename-asteroid-btn-cancel">Cancel</button>
      <button id="rename-asteroid-confirm" class="rename-asteroid-btn rename-asteroid-btn-confirm">Rename</button>
    </div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const input = document.getElementById('rename-asteroid-input') as HTMLInputElement;
  input.select();
  input.focus();

  function close(): void {
    overlay.remove();
  }

  function confirm(): void {
    const newName = input.value.trim();
    if (newName && newName !== obj!.name) {
      renameOrbitalObject(s.state!, targetId!, newName);
      showPhaseNotification(`Renamed to "${escapeHtml(newName)}"`);
      updateMapHud();
    }
    close();
  }

  document.getElementById('rename-asteroid-cancel')!.addEventListener('click', close);
  document.getElementById('rename-asteroid-confirm')!.addEventListener('click', confirm);
  input.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') { ev.preventDefault(); confirm(); }
    if (ev.key === 'Escape') { ev.preventDefault(); close(); }
    ev.stopPropagation(); // prevent game keyboard handler from firing
  });
  overlay.addEventListener('click', (ev: MouseEvent) => {
    if (ev.target === overlay) close();
  });
}

// ---------------------------------------------------------------------------
// Map HUD overlay
// ---------------------------------------------------------------------------

/**
 * Build the map-view HUD overlay: info panel, controls hint, and warp button.
 */
export function buildMapHud(): void {
  const s = getFCState();
  if (s.mapHud) return;

  const hud: HTMLDivElement = document.createElement('div');
  hud.id = 'map-hud';

  // Info panel (top-left).
  const info: HTMLDivElement = document.createElement('div');
  info.id = 'map-hud-info';
  info.innerHTML = `
    <div class="map-label">MAP VIEW</div>
    <div>Zoom: <span class="map-zoom" data-field="zoom"></span></div>
    <div>Body: <span data-field="body">Earth</span></div>
    <div>Target: <span class="map-target" data-field="target">None</span></div>
    <div>Phase: <span data-field="phase"></span></div>
    <div data-field="transfer-info" style="color:#ffcc44;margin-top:4px;display:none"></div>
    <div data-field="transfer-progress" style="color:#ff6644;margin-top:4px;display:none"></div>
  `;
  hud.appendChild(info);

  // Controls hint (bottom-centre).
  const controls: HTMLDivElement = document.createElement('div');
  controls.id = 'map-hud-controls';
  controls.innerHTML =
    '<kbd>M</kbd> Flight view \u00b7 ' +
    '<kbd>Tab</kbd> Zoom \u00b7 ' +
    '<kbd>T</kbd> Target \u00b7 ' +
    '<kbd>R</kbd> Rename \u00b7 ' +
    '<kbd>B</kbd> Transfer target \u00b7 ' +
    '<kbd>G</kbd> Warp to target \u00b7 ' +
    '<kbd>N</kbd> Shadow \u00b7 ' +
    '<kbd>C</kbd> Comms \u00b7 ' +
    '<kbd>&lt;/&gt;</kbd> Time warp \u00b7 ' +
    '<kbd>WASD</kbd> Orbital thrust';
  hud.appendChild(controls);

  // Warp to target button (top-right).
  const warpBtn: HTMLButtonElement = document.createElement('button');
  warpBtn.id = 'map-warp-btn';
  warpBtn.className = 'hidden';
  warpBtn.textContent = 'Warp to Target';
  warpBtn.addEventListener('click', handleWarpToTarget);
  hud.appendChild(warpBtn);

  // Rename asteroid button (shown when targeting a persistent asteroid).
  const renameBtn: HTMLButtonElement = document.createElement('button');
  renameBtn.id = 'map-rename-btn';
  renameBtn.className = 'hidden';
  renameBtn.textContent = 'Rename Asteroid';
  renameBtn.addEventListener('click', handleRenameAsteroid);
  hud.appendChild(renameBtn);

  s.mapHud = hud;
  const host: HTMLElement = s.container || document.getElementById('ui-overlay') || document.body;
  host.appendChild(hud);

  updateMapHud();
}

/**
 * Update the map HUD readouts to reflect current state.
 */
export function updateMapHud(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!s.mapHud || !flightState) return;

  const zoomEl       = s.mapHud.querySelector('[data-field="zoom"]');
  const bodyEl       = s.mapHud.querySelector('[data-field="body"]');
  const targetEl     = s.mapHud.querySelector('[data-field="target"]');
  const phaseEl      = s.mapHud.querySelector('[data-field="phase"]');
  const warpBtn      = s.mapHud.querySelector('#map-warp-btn');
  const transferEl   = s.mapHud.querySelector('[data-field="transfer-info"]') as HTMLElement | null;
  const progressEl   = s.mapHud.querySelector('[data-field="transfer-progress"]') as HTMLElement | null;

  if (zoomEl)   zoomEl.textContent = ZOOM_LABELS[getMapZoomLevel()] || getMapZoomLevel();
  if (phaseEl)  phaseEl.textContent = `${getPhaseLabel(flightState.phase)}${s.timeWarp > 1 ? ` (${s.timeWarp}\u00d7)` : ''}`;

  // Show current celestial body.
  const bodyId: string = flightState.bodyId || 'EARTH';
  const bodyNames: Record<string, string> = {
    SUN: 'Sun', MERCURY: 'Mercury', VENUS: 'Venus', EARTH: 'Earth',
    MOON: 'Moon', MARS: 'Mars', PHOBOS: 'Phobos', DEIMOS: 'Deimos',
  };
  if (bodyEl) bodyEl.textContent = bodyNames[bodyId] || bodyId;

  const targetId: string | null = getMapTarget();
  const targetObj = targetId && s.state
    ? (s.state.orbitalObjects || []).find(o => o.id === targetId)
    : null;
  const targetAsteroid = !targetObj ? getSelectedAsteroid() : null;

  if (targetEl) {
    if (targetObj) {
      targetEl.textContent = targetObj.name;
    } else if (targetAsteroid && ps) {
      // Show asteroid info: name, size class, and distance from craft.
      const sizeLabel = targetAsteroid.radius >= 500 ? 'Large'
        : targetAsteroid.radius >= 50 ? 'Medium' : 'Small';
      const R = BODY_RADIUS[bodyId] || 0;
      const craftX = ps.posX;
      const craftY = ps.posY + R;
      const dx = targetAsteroid.posX - craftX;
      const dy = targetAsteroid.posY - craftY;
      const dist = Math.hypot(dx, dy);
      const distStr = dist >= 1_000_000 ? `${(dist / 1_000_000).toFixed(0)} Mm`
        : dist >= 1_000 ? `${(dist / 1_000).toFixed(0)} km`
        : `${dist.toFixed(0)} m`;
      targetEl.textContent = `${targetAsteroid.name} (${sizeLabel}, ${distStr})`;
    } else {
      targetEl.textContent = 'None';
    }
  }
  if (warpBtn) {
    // Warp button available for orbital objects; not for asteroids (they're transient).
    warpBtn.classList.toggle('hidden',
      !targetObj || !flightState.orbitalElements || flightState.phase !== FlightPhase.ORBIT);
  }
  const renameBtn = s.mapHud.querySelector('#map-rename-btn');
  if (renameBtn) {
    // Rename button shown only when targeting a persistent (captured) asteroid.
    renameBtn.classList.toggle('hidden', !targetObj || targetObj.type !== 'asteroid');
  }

  // Transfer target route info.
  if (transferEl) {
    const transferTarget: string | null = getSelectedTransferTarget();
    if (transferTarget && ps) {
      const alt: number = Math.max(0, ps.posY);
      const targets = getMapTransferTargets(bodyId, alt, flightState.phase);
      const t = targets.find(tt => tt.bodyId === transferTarget);
      if (t) {
        transferEl.textContent = `Route: ${t.name} \u2014 Depart \u0394v ${t.departureDVStr} \u2014 ${t.transferTimeStr}`;
        transferEl.style.display = '';
      } else {
        transferEl.style.display = 'none';
      }
    } else {
      transferEl.style.display = 'none';
    }
  }

  // Transfer progress during active TRANSFER/CAPTURE phase.
  if (progressEl) {
    const info = getTransferProgressInfo(flightState.transferState, flightState.timeElapsed);
    if (info) {
      const pct: number = Math.round(info.progress * 100);
      progressEl.textContent = `Transfer: ${info.originName} \u2192 ${info.destName} \u2014 ${pct}% \u2014 ETA: ${info.etaStr}`;
      progressEl.style.display = '';
    } else {
      progressEl.style.display = 'none';
    }
  }
}

/**
 * Remove the map HUD overlay.
 */
export function destroyMapHud(): void {
  const s = getFCState();
  if (s.mapHud) {
    s.mapHud.remove();
    s.mapHud = null;
  }
}
