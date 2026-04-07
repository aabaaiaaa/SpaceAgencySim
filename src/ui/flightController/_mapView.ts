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
import { FlightPhase } from '../../core/constants.ts';
import { isPlayerLocked, getPhaseLabel } from '../../core/flightPhase.ts';
import { getFCState } from './_state.ts';
import { showPhaseNotification } from './_flightPhase.ts';

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
  if (!s.ps || !s.flightState) return;

  // During TRANSFER/CAPTURE, the player cannot leave the map view.
  if (s.mapActive && isPlayerLocked(s.flightState.phase)) {
    showPhaseNotification('Cannot leave map during ' + getPhaseLabel(s.flightState.phase));
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
      s.ps.throttle = 0;
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
  if (!s.mapActive || !s.ps || !s.flightState) return;

  // Apply orbital thrust in ORBIT, MANOEUVRE, TRANSFER, or CAPTURE phases.
  const phase: string = s.flightState.phase;
  if (phase !== FlightPhase.ORBIT && phase !== FlightPhase.MANOEUVRE &&
      phase !== FlightPhase.TRANSFER && phase !== FlightPhase.CAPTURE) {
    if (s.mapThrusting) {
      s.ps.throttle = 0;
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

  const bodyId: string = s.flightState.bodyId || 'EARTH';

  if (direction) {
    s.ps.angle = computeOrbitalThrustAngle(s.ps, bodyId, direction);
    if (s.ps.throttle === 0) s.ps.throttle = 1;
    s.mapThrusting = true;
  } else if (s.mapThrusting) {
    // No keys held -- cut thrust.
    s.ps.throttle = 0;
    s.mapThrusting = false;
  }
}

/**
 * Handle the "Warp to target" action.
 */
export function handleWarpToTarget(): void {
  const s = getFCState();
  if (!s.flightState || !s.flightState.orbitalElements || !s.state) return;

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

  const warpBodyId: string = (s.flightState && s.flightState.bodyId) || 'EARTH';
  const result = warpToTarget(
    s.flightState.orbitalElements,
    targetObj.elements,
    warpBodyId,
    s.flightState.timeElapsed,
  );

  if (!result.possible) {
    showPhaseNotification('Warp impossible \u2014 orbits do not intersect');
    return;
  }

  // Advance the flight time.
  s.flightState.timeElapsed = result.time!;

  // Log the warp event.
  s.flightState.events.push({
    time: result.time!,
    type: 'TIME_WARP',
    description: `Warped ${(result.elapsed! / 60).toFixed(1)} min to target "${targetObj.name}"`,
  });

  showPhaseNotification(`Warped to ${targetObj.name}`);
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
  if (!s.mapHud || !s.flightState) return;

  const zoomEl       = s.mapHud.querySelector('[data-field="zoom"]');
  const bodyEl       = s.mapHud.querySelector('[data-field="body"]');
  const targetEl     = s.mapHud.querySelector('[data-field="target"]');
  const phaseEl      = s.mapHud.querySelector('[data-field="phase"]');
  const warpBtn      = s.mapHud.querySelector('#map-warp-btn');
  const transferEl   = s.mapHud.querySelector('[data-field="transfer-info"]') as HTMLElement | null;
  const progressEl   = s.mapHud.querySelector('[data-field="transfer-progress"]') as HTMLElement | null;

  if (zoomEl)   zoomEl.textContent = ZOOM_LABELS[getMapZoomLevel()] || getMapZoomLevel();
  if (phaseEl)  phaseEl.textContent = `${getPhaseLabel(s.flightState.phase)}${s.timeWarp > 1 ? ` (${s.timeWarp}\u00d7)` : ''}`;

  // Show current celestial body.
  const bodyId: string = s.flightState.bodyId || 'EARTH';
  const bodyNames: Record<string, string> = {
    SUN: 'Sun', MERCURY: 'Mercury', VENUS: 'Venus', EARTH: 'Earth',
    MOON: 'Moon', MARS: 'Mars', PHOBOS: 'Phobos', DEIMOS: 'Deimos',
  };
  if (bodyEl) bodyEl.textContent = bodyNames[bodyId] || bodyId;

  const targetId: string | null = getMapTarget();
  const targetObj = targetId && s.state
    ? (s.state.orbitalObjects || []).find(o => o.id === targetId)
    : null;
  if (targetEl)  targetEl.textContent = targetObj ? targetObj.name : 'None';
  if (warpBtn) {
    warpBtn.classList.toggle('hidden',
      !targetObj || !s.flightState.orbitalElements || s.flightState.phase !== FlightPhase.ORBIT);
  }

  // Transfer target route info.
  if (transferEl) {
    const transferTarget: string | null = getSelectedTransferTarget();
    if (transferTarget && s.ps) {
      const alt: number = Math.max(0, s.ps.posY);
      const targets = getMapTransferTargets(bodyId, alt, s.flightState.phase);
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
    const info = getTransferProgressInfo(s.flightState.transferState, s.flightState.timeElapsed);
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
