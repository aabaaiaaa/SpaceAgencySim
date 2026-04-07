/**
 * _shell.ts — Shell layout, tab switching, and shared formatting helpers
 * for the Mission Control UI.
 *
 * @module missionControl/_shell
 */

import type { GameState } from '../../core/gameState.ts';
import { getMissionControlTier } from '../../core/contracts.ts';
import { MCC_TIER_FEATURES } from '../../core/constants.ts';
import { getPartById } from '../../data/parts.ts';
import { getMCState } from './_state.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The last mission in the linear tutorial chain.  Once this mission appears
 * in state.missions.completed, the single-accept restriction is lifted and
 * the player may accept multiple missions simultaneously.
 */
export const TUTORIAL_GATE_MISSION_ID: string = 'mission-004';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO 8601 date string to a readable short date.
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '\u2014';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Format a cash amount as a dollar string.
 */
export function fmtCash(amount: number): string {
  return '$' + amount.toLocaleString();
}

/**
 * Build a rewards paragraph element listing unlocked part names.
 * Returns null if the mission has no unlockedParts.
 */
export function buildRewardsEl(mission: { unlockedParts?: string[] }): HTMLElement | null {
  if (!Array.isArray(mission.unlockedParts) || mission.unlockedParts.length === 0) {
    return null;
  }
  const el = document.createElement('p');
  el.className = 'mc-mission-rewards';

  const label = document.createElement('span');
  label.className = 'mc-rewards-label';
  label.textContent = 'Rewards:';
  el.appendChild(label);

  const partNames = mission.unlockedParts
    .map((id: string) => getPartById(id)?.name ?? id)
    .join(', ');
  el.appendChild(document.createTextNode(' ' + partNames));
  return el;
}

// ---------------------------------------------------------------------------
// Tutorial phase helper
// ---------------------------------------------------------------------------

/**
 * Return true while the player is still in the early tutorial phase.
 *
 * The tutorial phase ends once `mission-004` appears in
 * `state.missions.completed`.  During the tutorial, at most one mission may
 * be accepted at a time.
 */
export function isTutorialPhase(state: GameState): boolean {
  return !state.missions.completed.some((m) => m.id === TUTORIAL_GATE_MISSION_ID);
}

// ---------------------------------------------------------------------------
// Shell layout
// ---------------------------------------------------------------------------

let _tabSwitchHandler: ((tabId: string) => void) | null = null;

let _destroyHandler: (() => void) | null = null;

/**
 * Register the function that handles switching tabs.
 * Called once by _init.ts during initialization to wire the dispatch.
 */
export function registerTabSwitchHandler(handler: (tabId: string) => void): void {
  _tabSwitchHandler = handler;
}

/**
 * Register the destroy function so the back button can tear down the overlay
 * without a circular static import from _init.ts.
 */
export function registerDestroyHandler(handler: () => void): void {
  _destroyHandler = handler;
}

/**
 * Build the static shell: header + tab bar + empty content area.
 */
export function renderShell(): void {
  const mc = getMCState();
  if (!mc.overlay) return;

  // Header
  const header = document.createElement('div');
  header.id = 'mission-control-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'mission-control-back-btn';
  backBtn.textContent = '\u2190 Hub';
  backBtn.addEventListener('click', () => {
    const onBack = mc.onBack; // capture before destroy nulls it
    if (_destroyHandler) _destroyHandler();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'mission-control-title';
  const mccTierLevel = mc.state ? getMissionControlTier(mc.state) : 1;
  const mccTierInfo = MCC_TIER_FEATURES[mccTierLevel];
  title.textContent = `Mission Control Centre \u2014 Tier ${mccTierLevel}` + (mccTierInfo ? ` (${mccTierInfo.label})` : '');
  header.appendChild(title);

  mc.overlay.appendChild(header);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.id = 'mission-control-tabs';

  const tabs: Array<{ id: string; label: string }> = [
    { id: 'available', label: 'Missions' },
    { id: 'accepted',  label: 'Accepted'  },
    { id: 'completed', label: 'Completed' },
    { id: '_divider',  label: '' },
    { id: 'contracts', label: 'Contracts' },
    { id: 'active-contracts', label: 'Active' },
    { id: '_divider2', label: '' },
    { id: 'challenges', label: 'Challenges' },
    { id: 'achievements', label: 'Achievements' },
  ];

  for (const tab of tabs) {
    if (tab.id.startsWith('_divider')) {
      const divider = document.createElement('div');
      divider.className = 'mc-tab-divider';
      tabBar.appendChild(divider);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'mc-tab' + (tab.id === mc.activeTab ? ' active' : '');
    btn.dataset.tabId = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      if (_tabSwitchHandler) _tabSwitchHandler(tab.id);
    });
    tabBar.appendChild(btn);
  }

  mc.overlay.appendChild(tabBar);

  // Content area
  const content = document.createElement('div');
  content.id = 'mission-control-content';
  mc.overlay.appendChild(content);
}

/**
 * Update tab button active class when switching tabs.
 */
export function updateActiveTabClass(tabId: string): void {
  const mc = getMCState();
  if (mc.overlay) {
    mc.overlay.querySelectorAll('.mc-tab').forEach((btn) => {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.tabId === tabId);
    });
  }
}

/**
 * Get the #mission-control-content element and clear it.
 */
export function getContent(): HTMLElement | null {
  const mc = getMCState();
  const el = mc.overlay ? mc.overlay.querySelector('#mission-control-content') : null;
  if (el) el.innerHTML = '';
  return el as HTMLElement | null;
}
