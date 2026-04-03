/**
 * _missionsTab.ts — Available, Accepted, and Completed mission tabs.
 *
 * @module missionControl/_missionsTab
 */

import type { GameState, ObjectiveDef } from '../../core/gameState.js';
import { acceptMission } from '../../core/missions.js';
import { getFacilityDef } from '../../core/construction.js';
import { getPartById } from '../../data/parts.js';
import { MISSIONS } from '../../data/missions.js';
import { GameMode } from '../../core/constants.js';
import { refreshTopBarMissions } from '../topbar.js';
import { getMCState } from './_state.js';
import { fmtCash, fmtDate, buildRewardsEl, isTutorialPhase, getContent } from './_shell.js';
import { logger } from '../../core/logger.js';

/**
 * Shape of a mission instance stored in game state.
 * At runtime these are deep copies of MissionDef with additional live fields.
 */
interface MissionInstance {
  id: string;
  title: string;
  description: string;
  reward: number;
  objectives: ObjectiveDef[];
  unlockedParts?: string[];
  completedDate?: string;
}

// ---------------------------------------------------------------------------
// Tutorial blocking indicator helpers
// ---------------------------------------------------------------------------

/**
 * Return true if completing `missionId` is required (directly or transitively)
 * to unlock any other tutorial mission that has not yet been completed.
 *
 * Only meaningful in Tutorial mode -- always returns false otherwise.
 */
function isTutorialBlockingMission(state: GameState, missionId: string): boolean {
  if (state.gameMode !== GameMode.TUTORIAL) return false;

  const completedIds = new Set(state.missions.completed.map((m) => m.id));

  // Check whether any not-yet-completed mission lists missionId in unlocksAfter.
  for (const def of MISSIONS) {
    if (completedIds.has(def.id)) continue;
    if (def.id === missionId) continue;
    if (def.unlocksAfter && def.unlocksAfter.includes(missionId)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Available tab
// ---------------------------------------------------------------------------

export function renderAvailableTab(): void {
  const content = getContent();
  const mc = getMCState();
  if (!content || !mc.state) return;

  const missions = mc.state.missions.available as unknown as MissionInstance[];

  if (missions.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No missions currently available. Complete your active missions to unlock more.';
    content.appendChild(msg);
    return;
  }

  // Determine whether the Accept button should be globally blocked.
  const tutorialPhase    = isTutorialPhase(mc.state);
  const hasAcceptedMission = mc.state.missions.accepted.length > 0;
  const blockAccept      = tutorialPhase && hasAcceptedMission;

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const mission of missions) {
    const isBlocking = isTutorialBlockingMission(mc.state, mission.id);
    const card = _buildAvailableMissionCard(mission, blockAccept, tutorialPhase, isBlocking);
    list.appendChild(card);
  }

  content.appendChild(list);
}

/**
 * Build a mission card for the Available tab.
 */
function _buildAvailableMissionCard(
  mission: MissionInstance,
  blockAccept: boolean,
  tutorialPhase: boolean,
  isBlocking: boolean,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.missionId = mission.id;

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = mission.title;
  cardHeader.appendChild(titleEl);

  if (isBlocking) {
    const badge = document.createElement('span');
    badge.className = 'mc-blocking-badge';
    badge.textContent = 'Unlocks next step';
    badge.setAttribute('aria-label', 'Completing this mission unlocks the next tutorial step');
    cardHeader.appendChild(badge);
  }

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = fmtCash(mission.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = mission.description;
  card.appendChild(desc);

  // Reward parts (shown before accept so the player knows what they'll earn).
  const availRewards = buildRewardsEl(mission);
  if (availRewards) card.appendChild(availRewards);

  // Accept row
  const acceptRow = document.createElement('div');
  acceptRow.className = 'mc-accept-row';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'mc-accept-btn';
  acceptBtn.textContent = 'Accept Mission';
  acceptBtn.disabled = blockAccept;
  acceptBtn.dataset.missionId = mission.id;

  if (blockAccept) {
    acceptBtn.title = 'Complete your current mission before accepting a new one.';
  }

  acceptBtn.addEventListener('click', () => _handleAccept(mission.id));
  acceptRow.appendChild(acceptBtn);

  // Show a contextual notice during the tutorial when blocked.
  if (blockAccept && tutorialPhase) {
    const notice = document.createElement('span');
    notice.className = 'mc-tutorial-notice';
    notice.textContent = 'Complete your active mission first.';
    acceptRow.appendChild(notice);
  }

  card.appendChild(acceptRow);

  return card;
}

/**
 * Handle clicking the Accept button for a mission.
 */
function _handleAccept(missionId: string): void {
  const mc = getMCState();
  if (!mc.state) return;

  const result = acceptMission(mc.state, missionId);

  if (result.success) {
    // Re-render the Available tab to reflect the updated state.
    renderAvailableTab();
    refreshTopBarMissions();

    // Show notification modal for facility and/or part unlocks.
    if (result.awardedFacility || (result.unlockedParts && result.unlockedParts.length > 0)) {
      _showUnlockNotification(result.awardedFacility ?? null, result.unlockedParts ?? []);
    }
  } else {
    logger.warn('missionControl', 'acceptMission failed', { error: result.error });
  }
}

// ---------------------------------------------------------------------------
// Unlock notification modal
// ---------------------------------------------------------------------------

/**
 * Show a prominent modal notifying the player of facility and/or part unlocks.
 */
function _showUnlockNotification(facilityId: string | null, partIds: string[]): void {
  // Remove any existing unlock notification.
  const existing = document.getElementById('unlock-notification-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'unlock-notification-backdrop';
  backdrop.className = 'topbar-modal-backdrop';
  backdrop.style.zIndex = '300';

  const modal = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.style.maxWidth = '460px';
  modal.style.textAlign = 'center';

  const dismiss = (): void => backdrop.remove();

  // -- Facility section -----------------------------------------------------
  if (facilityId) {
    const def = getFacilityDef(facilityId);
    const facilityName = def?.name ?? facilityId;

    const title = document.createElement('h2');
    title.className = 'mc-unlock-title';
    title.textContent = `${facilityName} Unlocked!`;
    modal.appendChild(title);

    if (def?.description) {
      const desc = document.createElement('p');
      desc.className = 'mc-unlock-desc';
      desc.textContent = def.description;
      modal.appendChild(desc);
    }
  }

  // -- Unlocked parts section -----------------------------------------------
  if (partIds && partIds.length > 0) {
    const partsTitle = document.createElement('p');
    partsTitle.className = 'mc-parts-heading';
    partsTitle.textContent = partIds.length === 1 ? 'New Part Available' : 'New Parts Available';
    modal.appendChild(partsTitle);

    const partsList = document.createElement('ul');
    partsList.className = 'mc-parts-list';
    for (const id of partIds) {
      const li = document.createElement('li');
      li.className = 'mc-part-item';
      const partDef = getPartById(id);
      li.textContent = partDef?.name ?? id;
      partsList.appendChild(li);
    }
    modal.appendChild(partsList);
  }

  // -- Dismiss button -------------------------------------------------------
  const btnRow = document.createElement('div');
  btnRow.className = 'mc-button-row';

  const btn = document.createElement('button');
  btn.className = 'confirm-btn confirm-btn-primary';
  btn.textContent = 'Continue';
  btn.addEventListener('click', dismiss);
  btnRow.appendChild(btn);

  modal.appendChild(btnRow);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Focus the button for keyboard accessibility.
  btn.focus();
}

// ---------------------------------------------------------------------------
// Accepted tab
// ---------------------------------------------------------------------------

export function renderAcceptedTab(): void {
  const content = getContent();
  const mc = getMCState();
  if (!content || !mc.state) return;

  const missions = mc.state.missions.accepted as unknown as MissionInstance[];

  if (missions.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No missions currently accepted. Visit the Available tab to take on a mission.';
    content.appendChild(msg);
    return;
  }

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const mission of missions) {
    const card = _buildAcceptedMissionCard(mission);
    list.appendChild(card);
  }

  content.appendChild(list);
}

/**
 * Build a mission card for the Accepted tab, including objectives.
 */
function _buildAcceptedMissionCard(mission: MissionInstance): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.missionId = mission.id;

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = mission.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = fmtCash(mission.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = mission.description;
  card.appendChild(desc);

  // Objectives section
  if (mission.objectives && mission.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of mission.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = `mc-objective-indicator ${obj.completed ? 'completed' : 'pending'}`;
      // Checkmark for completed, hollow circle for pending.
      indicator.textContent = obj.completed ? '\u2713' : '\u25CB';
      indicator.setAttribute('aria-label', obj.completed ? 'Completed' : 'Pending');
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = `mc-objective-text ${obj.completed ? 'completed' : 'pending'}`;
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }

    card.appendChild(objList);
  }

  // Reward parts.
  const accRewards = buildRewardsEl(mission);
  if (accRewards) card.appendChild(accRewards);

  return card;
}

// ---------------------------------------------------------------------------
// Completed tab
// ---------------------------------------------------------------------------

export function renderCompletedTab(): void {
  const content = getContent();
  const mc = getMCState();
  if (!content || !mc.state) return;

  const missions = mc.state.missions.completed as unknown as MissionInstance[];

  if (missions.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No missions completed yet. Accept a mission and launch to get started!';
    content.appendChild(msg);
    return;
  }

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  // Show most recently completed first.
  const sorted = missions.slice().reverse();

  for (const mission of sorted) {
    list.appendChild(_buildCompletedMissionCard(mission));
  }

  content.appendChild(list);
}

/**
 * Build a mission card for the Completed tab.
 * Matches the layout of accepted cards but with all objectives checked
 * and a completion date shown.
 */
function _buildCompletedMissionCard(mission: MissionInstance): HTMLElement {
  const card = document.createElement('div');
  card.className = 'mc-mission-card mc-mission-card-completed';
  card.dataset.missionId = mission.id;

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = mission.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = fmtCash(mission.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Completed date
  if (mission.completedDate) {
    const dateEl = document.createElement('p');
    dateEl.className = 'mc-completed-date';
    dateEl.textContent = 'Completed ' + fmtDate(mission.completedDate);
    card.appendChild(dateEl);
  }

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = mission.description;
  card.appendChild(desc);

  // Objectives section (all completed)
  if (mission.objectives && mission.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of mission.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = 'mc-objective-indicator completed';
      indicator.textContent = '\u2713';
      indicator.setAttribute('aria-label', 'Completed');
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = 'mc-objective-text completed';
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }

    card.appendChild(objList);
  }

  // Reward parts
  const rewards = buildRewardsEl(mission);
  if (rewards) card.appendChild(rewards);

  return card;
}
