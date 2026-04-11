/**
 * _hubDocking.ts — Orbital hub docking prompt during flight.
 *
 * When the craft enters the proximity zone of an online orbital hub,
 * a dock prompt is shown. Accepting ends the flight and recovers the
 * craft at that hub. Dismissing hides the prompt until the player
 * leaves the zone.
 *
 * @module ui/flightController/_hubDocking
 */

import { findNearbyOrbitalHub } from '../../core/hubs.ts';
import { FlightPhase } from '../../core/constants.ts';
import type { GameState, FlightState } from '../../core/gameState.ts';
import type { PhysicsState } from '../../core/physics.ts';
import type { Hub } from '../../core/hubTypes.ts';

let _dockPromptEl: HTMLElement | null = null;
let _dismissed = false;
let _lastNearbyHubId: string | null = null;

export function checkHubDocking(state: GameState, ps: PhysicsState, flightState: FlightState): void {
  // Only check during orbital flight
  if (flightState.phase !== FlightPhase.ORBIT) {
    _hideDockPrompt();
    return;
  }

  const nearbyHubs = findNearbyOrbitalHub(state, flightState.bodyId, ps.posY);

  if (nearbyHubs.length === 0) {
    _hideDockPrompt();
    // Reset dismiss flag when leaving proximity
    if (_lastNearbyHubId) {
      _dismissed = false;
      _lastNearbyHubId = null;
    }
    return;
  }

  const hub = nearbyHubs[0];

  // If we entered a new hub's range, reset dismiss
  if (hub.id !== _lastNearbyHubId) {
    _dismissed = false;
    _lastNearbyHubId = hub.id;
  }

  if (_dismissed) return;

  _showDockPrompt(hub);
}

function _showDockPrompt(hub: Hub): void {
  if (_dockPromptEl) return; // Already showing

  _dockPromptEl = document.createElement('div');
  _dockPromptEl.id = 'hub-dock-prompt';
  _dockPromptEl.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);background:rgba(20,30,50,0.95);border:1px solid #4080c0;border-radius:8px;padding:16px 24px;z-index:600;text-align:center;color:#e0e8f0;font-size:14px;';

  const title = document.createElement('div');
  title.textContent = `Orbital Station Detected: ${hub.name}`;
  title.style.cssText = 'font-size:16px;font-weight:bold;margin-bottom:8px;color:#88ccff;';
  _dockPromptEl.appendChild(title);

  const msg = document.createElement('div');
  msg.textContent = 'Within docking range. Dock to recover craft at this station?';
  msg.style.marginBottom = '12px';
  _dockPromptEl.appendChild(msg);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;';

  const dockBtn = document.createElement('button');
  dockBtn.textContent = 'Dock';
  dockBtn.id = 'hub-dock-accept';
  dockBtn.style.cssText = 'padding:6px 16px;background:#2060a0;color:#fff;border:1px solid #4080c0;border-radius:4px;cursor:pointer;';
  dockBtn.addEventListener('click', () => {
    // Docking acceptance — end flight and recover at hub
    // Dispatch a custom event that the flight controller can handle
    window.dispatchEvent(new CustomEvent('hub-dock-accept', { detail: { hubId: hub.id } }));
    _hideDockPrompt();
  });
  btnRow.appendChild(dockBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.id = 'hub-dock-dismiss';
  dismissBtn.style.cssText = 'padding:6px 16px;background:#404050;color:#ccc;border:1px solid #606070;border-radius:4px;cursor:pointer;';
  dismissBtn.addEventListener('click', () => {
    _dismissed = true;
    _hideDockPrompt();
  });
  btnRow.appendChild(dismissBtn);

  _dockPromptEl.appendChild(btnRow);
  document.body.appendChild(_dockPromptEl);
}

function _hideDockPrompt(): void {
  if (_dockPromptEl) {
    _dockPromptEl.remove();
    _dockPromptEl = null;
  }
}

export function destroyHubDocking(): void {
  _hideDockPrompt();
  _dismissed = false;
  _lastNearbyHubId = null;
}
