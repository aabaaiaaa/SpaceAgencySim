/**
 * _init.ts — Orchestrator for the Mission Control UI.
 *
 * Contains initMissionControlUI and destroyMissionControlUI, which are the
 * only public API surface.  Wires tab switching to the individual tab
 * renderer functions.
 *
 * @module missionControl/_init
 */

import type { GameState } from '../../core/gameState.ts';
import { getUnlockedMissions } from '../../core/missions.ts';
import { getMCState, setMCState } from './_state.ts';
import './missionControl.css';
import { renderShell, updateActiveTabClass, registerTabSwitchHandler, registerDestroyHandler } from './_shell.ts';
import { renderAvailableTab, renderAcceptedTab, renderCompletedTab } from './_missionsTab.ts';
import { renderContractsBoardTab, renderActiveContractsTab } from './_contractsTab.ts';
import { renderChallengesTab } from './_challengesTab.ts';
import { renderAchievementsTab } from './_achievementsTab.ts';
import {
  initMissionControlListenerTracker,
  getMissionControlListenerTracker,
  destroyMissionControlListenerTracker,
} from './_listenerTracker.ts';

// ---------------------------------------------------------------------------
// Tab dispatch
// ---------------------------------------------------------------------------

/**
 * Switch to a different tab and re-render its content.
 */
function _switchTab(tabId: string): void {
  setMCState({ activeTab: tabId });
  updateActiveTabClass(tabId);

  if (tabId === 'available')        renderAvailableTab();
  if (tabId === 'accepted')         renderAcceptedTab();
  if (tabId === 'completed')        renderCompletedTab();
  if (tabId === 'contracts')        renderContractsBoardTab();
  if (tabId === 'active-contracts') renderActiveContractsTab();
  if (tabId === 'challenges')       renderChallengesTab();
  if (tabId === 'achievements')     renderAchievementsTab();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Mission Control overlay and recalculate mission unlock state.
 */
export function initMissionControlUI(
  container: HTMLElement,
  state: GameState,
  { onBack }: { onBack: () => void },
): void {
  setMCState({
    state,
    onBack,
    activeTab: 'available',
    creatorFormOpen: false,
  });

  // Create a module-scoped tracker for all Mission Control listeners. Must be
  // done before renderShell / tab renders so sub-modules can register through it.
  initMissionControlListenerTracker();

  // Recalculate mission unlock state on every open.
  getUnlockedMissions(state);

  const overlay = document.createElement('div');
  overlay.id = 'mission-control-overlay';
  container.appendChild(overlay);
  setMCState({ overlay });

  // Register handlers so _shell.js can dispatch to us without circular imports.
  registerTabSwitchHandler(_switchTab);
  registerDestroyHandler(destroyMissionControlUI);

  renderShell();
  renderAvailableTab();

  // Escape key closes the panel.
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    const onBack = getMCState().onBack;
    destroyMissionControlUI();
    if (onBack) onBack();
  };
  getMissionControlListenerTracker()?.add(document, 'keydown', onEscape as EventListener);
}

/**
 * Remove the Mission Control overlay from the DOM.
 */
export function destroyMissionControlUI(): void {
  // All listeners (including the escape handler) are cleared via the tracker.
  destroyMissionControlListenerTracker();
  const mc = getMCState();
  if (mc.overlay) {
    mc.overlay.remove();
  }
  setMCState({
    overlay: null,
    state:   null,
    onBack:  null,
    _escapeHandler: null,
  });
}
