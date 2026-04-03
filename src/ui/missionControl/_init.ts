/**
 * _init.ts — Orchestrator for the Mission Control UI.
 *
 * Contains initMissionControlUI and destroyMissionControlUI, which are the
 * only public API surface.  Wires tab switching to the individual tab
 * renderer functions.
 *
 * @module missionControl/_init
 */

import type { GameState } from '../../core/gameState.js';
import { getUnlockedMissions } from '../../core/missions.js';
import { getMCState, setMCState } from './_state.js';
import { MISSION_CONTROL_STYLES } from './_css.js';
import { renderShell, updateActiveTabClass, registerTabSwitchHandler, registerDestroyHandler } from './_shell.js';
import { renderAvailableTab, renderAcceptedTab, renderCompletedTab } from './_missionsTab.js';
import { renderContractsBoardTab, renderActiveContractsTab } from './_contractsTab.js';
import { renderChallengesTab } from './_challengesTab.js';
import { renderAchievementsTab } from './_achievementsTab.js';
import { injectStyleOnce } from '../injectStyle.js';

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

  // Recalculate mission unlock state on every open.
  getUnlockedMissions(state);

  // Inject CSS once.
  injectStyleOnce('mission-control-styles', MISSION_CONTROL_STYLES);

  const overlay = document.createElement('div');
  overlay.id = 'mission-control-overlay';
  container.appendChild(overlay);
  setMCState({ overlay });

  // Register handlers so _shell.js can dispatch to us without circular imports.
  registerTabSwitchHandler(_switchTab);
  registerDestroyHandler(destroyMissionControlUI);

  renderShell();
  renderAvailableTab();
}

/**
 * Remove the Mission Control overlay from the DOM.
 */
export function destroyMissionControlUI(): void {
  const mc = getMCState();
  if (mc.overlay) {
    mc.overlay.remove();
  }
  setMCState({
    overlay: null,
    state:   null,
    onBack:  null,
  });
}
