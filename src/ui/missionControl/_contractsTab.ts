/**
 * _contractsTab.ts — Contracts Board and Active Contracts tabs.
 *
 * @module missionControl/_contractsTab
 */

import type { Contract, ObjectiveDef } from '../../core/gameState.js';
import { acceptContract, cancelContract, getContractCaps, getActiveConflicts, getMissionControlTier } from '../../core/contracts.js';
import { CONTRACT_CATEGORY_ICONS, MCC_TIER_FEATURES, getReputationTier } from '../../core/constants.js';
import { getMCState } from './_state.js';
import { fmtCash, getContent } from './_shell.js';

/**
 * Extended contract shape that includes bonus objectives, bonus reward,
 * and conflict tags added by the contract generator.
 */
interface ExtendedContract extends Contract {
  bonusObjectives?: (ObjectiveDef & { bonus?: boolean })[];
  bonusReward?: number;
  conflictTags?: string[];
}

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

/**
 * Format a ContractCategory enum value as a readable label.
 */
function _categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    ALTITUDE_RECORD: 'Altitude',
    SPEED_RECORD: 'Speed',
    SCIENCE_SURVEY: 'Science',
    SATELLITE_DEPLOY: 'Satellite',
    SAFE_RECOVERY: 'Recovery',
    ORBITAL: 'Orbital',
    CRASH_TEST: 'Crash Test',
  };
  return labels[category] ?? category;
}

/**
 * Get the icon glyph for a contract category.
 */
function _categoryIcon(category: string): string {
  return CONTRACT_CATEGORY_ICONS[category] ?? '';
}

// ---------------------------------------------------------------------------
// Contracts Board tab
// ---------------------------------------------------------------------------

export function renderContractsBoardTab(): void {
  const content = getContent();
  const mc = getMCState();
  if (!content || !mc.state) return;

  const contracts = (mc.state.contracts?.board ?? []) as ExtendedContract[];
  const caps = getContractCaps(mc.state);
  const mccTier = getMissionControlTier(mc.state);
  const tierInfo = MCC_TIER_FEATURES[mccTier];

  // MCC Tier info bar
  const tierBar = document.createElement('div');
  tierBar.className = 'mc-caps-info';
  tierBar.style.marginBottom = '4px';
  tierBar.innerHTML = `Mission Control: <strong>Tier ${mccTier}</strong> (${tierInfo?.label ?? 'Unknown'})`;
  if (mccTier < 3 && MCC_TIER_FEATURES[mccTier + 1]) {
    const nextInfo = MCC_TIER_FEATURES[mccTier + 1];
    const hint = document.createElement('span');
    hint.style.cssText = 'margin-left:8px;font-size:0.72rem;opacity:0.7';
    hint.textContent = `Upgrade to unlock: ${nextInfo.features[nextInfo.features.length - 1]}`;
    tierBar.appendChild(hint);
  }
  content.appendChild(tierBar);

  // Caps info bar
  const capsInfo = document.createElement('div');
  capsInfo.className = 'mc-caps-info';
  capsInfo.textContent = `Board: ${contracts.length}/${caps.pool} slots | Active: ${(mc.state.contracts?.active ?? []).length}/${caps.active} slots`;
  content.appendChild(capsInfo);

  // Reputation bar (colour-coded by tier)
  const rep = mc.state.reputation ?? 50;
  const repTier = getReputationTier(rep);
  const repBar = document.createElement('div');
  repBar.className = 'mc-reputation-bar';
  repBar.innerHTML = `<span>Reputation: <strong style="color:${repTier.color}">${Math.round(rep)}</strong></span><span style="font-size:0.72rem;color:${repTier.color};background:${repTier.color}22;border:1px solid ${repTier.color}44;padding:1px 6px;border-radius:3px;margin-left:4px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600">${repTier.label}</span>`;
  const repTrack = document.createElement('div');
  repTrack.className = 'mc-rep-track';
  const repFill = document.createElement('div');
  repFill.className = 'mc-rep-fill';
  repFill.style.width = `${Math.max(0, Math.min(100, rep))}%`;
  repFill.style.backgroundColor = repTier.color;
  repTrack.appendChild(repFill);
  repBar.appendChild(repTrack);
  content.appendChild(repBar);

  if (contracts.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No contracts on the board. Complete a flight to generate new contracts.';
    content.appendChild(msg);
    return;
  }

  const activeCount = (mc.state.contracts?.active ?? []).length;
  const canAcceptMore = activeCount < caps.active;

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const contract of contracts) {
    list.appendChild(_buildContractBoardCard(contract, canAcceptMore));
  }

  content.appendChild(list);
}

/**
 * Build a contract card for the Board tab.
 */
function _buildContractBoardCard(contract: ExtendedContract, canAcceptMore: boolean): HTMLElement {
  const mc = getMCState();
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.contractId = contract.id;

  // Category badge with icon
  const catBadge = document.createElement('span');
  catBadge.className = 'mc-contract-category';
  const icon = _categoryIcon(contract.category);
  catBadge.textContent = (icon ? icon + ' ' : '') + _categoryLabel(contract.category);
  card.appendChild(catBadge);

  // Chain indicator
  if (contract.chainId && contract.chainPart) {
    const chainEl = document.createElement('div');
    chainEl.className = 'mc-contract-chain';
    chainEl.textContent = `Chain: Part ${contract.chainPart} of ${contract.chainTotal}`;
    card.appendChild(chainEl);
  }

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = contract.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = fmtCash(contract.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = contract.description;
  card.appendChild(desc);

  // Objectives preview
  if (contract.objectives && contract.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of contract.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = 'mc-objective-indicator pending';
      indicator.textContent = '\u25CB';
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = 'mc-objective-text pending';
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }
    card.appendChild(objList);
  }

  // Bonus objectives preview
  if (Array.isArray(contract.bonusObjectives) && contract.bonusObjectives.length > 0) {
    const bonusLabel = document.createElement('p');
    bonusLabel.className = 'mc-bonus-label';
    bonusLabel.textContent = 'Bonus Targets (Optional)';
    card.appendChild(bonusLabel);

    const bonusList = document.createElement('ul');
    bonusList.className = 'mc-objectives-list';

    for (const obj of contract.bonusObjectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item bonus';

      const indicator = document.createElement('span');
      indicator.className = 'mc-objective-indicator pending';
      indicator.textContent = '\u2606'; // empty star
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = 'mc-objective-text pending';
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      bonusList.appendChild(item);
    }
    card.appendChild(bonusList);

    if (contract.bonusReward) {
      const bonusRewardEl = document.createElement('p');
      bonusRewardEl.className = 'mc-bonus-reward';
      bonusRewardEl.textContent = `Bonus reward: ${fmtCash(contract.bonusReward)}`;
      card.appendChild(bonusRewardEl);
    }
  }

  // Meta info
  const meta = document.createElement('p');
  meta.className = 'mc-contract-meta';
  const flightsLeft = contract.boardExpiryPeriod - (mc.state?.currentPeriod ?? 0);
  meta.innerHTML =
    `<span>Expires in ${flightsLeft} flight${flightsLeft !== 1 ? 's' : ''}</span>` +
    (contract.deadlinePeriod != null
      ? `<span>Deadline: ${contract.deadlinePeriod - (mc.state?.currentPeriod ?? 0)} flights after accept</span>`
      : '<span>No deadline</span>') +
    `<span>Penalty: ${fmtCash(contract.penaltyFee)}</span>`;
  card.appendChild(meta);

  // Accept button
  const acceptRow = document.createElement('div');
  acceptRow.className = 'mc-accept-row';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'mc-accept-btn';
  acceptBtn.textContent = 'Accept Contract';
  acceptBtn.disabled = !canAcceptMore;
  if (!canAcceptMore) {
    acceptBtn.title = 'Active contract limit reached.';
  }
  acceptBtn.addEventListener('click', () => _handleAcceptContract(contract.id));
  acceptRow.appendChild(acceptBtn);

  if (!canAcceptMore) {
    const notice = document.createElement('span');
    notice.className = 'mc-tutorial-notice';
    notice.textContent = 'Active contract limit reached.';
    acceptRow.appendChild(notice);
  }

  card.appendChild(acceptRow);

  return card;
}

/**
 * Handle clicking Accept on a board contract.
 */
function _handleAcceptContract(contractId: string): void {
  const mc = getMCState();
  if (!mc.state) return;

  const result = acceptContract(mc.state, contractId);
  if (result.success) {
    renderContractsBoardTab();
  } else {
    console.warn('[Mission Control UI] acceptContract failed:', result.error);
  }
}

// ---------------------------------------------------------------------------
// Active Contracts tab
// ---------------------------------------------------------------------------

export function renderActiveContractsTab(): void {
  const content = getContent();
  const mc = getMCState();
  if (!content || !mc.state) return;

  const contracts = (mc.state.contracts?.active ?? []) as ExtendedContract[];
  const caps = getContractCaps(mc.state);

  // Caps info bar
  const capsInfo = document.createElement('div');
  capsInfo.className = 'mc-caps-info';
  capsInfo.textContent = `Active: ${contracts.length}/${caps.active} slots`;
  content.appendChild(capsInfo);

  if (contracts.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No active contracts. Visit the Contracts tab to accept one.';
    content.appendChild(msg);
    return;
  }

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const contract of contracts) {
    list.appendChild(_buildActiveContractCard(contract));
  }

  content.appendChild(list);
}

/**
 * Build a card for an active contract (objectives + cancel button).
 */
function _buildActiveContractCard(contract: ExtendedContract): HTMLElement {
  const mc = getMCState();
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.contractId = contract.id;

  // Category badge with icon
  const catBadge = document.createElement('span');
  catBadge.className = 'mc-contract-category';
  const activeIcon = _categoryIcon(contract.category);
  catBadge.textContent = (activeIcon ? activeIcon + ' ' : '') + _categoryLabel(contract.category);
  card.appendChild(catBadge);

  // Chain indicator
  if (contract.chainId && contract.chainPart) {
    const chainEl = document.createElement('div');
    chainEl.className = 'mc-contract-chain';
    chainEl.textContent = `Chain: Part ${contract.chainPart} of ${contract.chainTotal}`;
    card.appendChild(chainEl);
  }

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = contract.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = fmtCash(contract.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = contract.description;
  card.appendChild(desc);

  // Objectives section
  if (contract.objectives && contract.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of contract.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = `mc-objective-indicator ${obj.completed ? 'completed' : 'pending'}`;
      indicator.textContent = obj.completed ? '\u2713' : '\u25CB';
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = `mc-objective-text ${obj.completed ? 'completed' : 'pending'}`;
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }
    card.appendChild(objList);
  }

  // Bonus objectives (active contract -- show progress)
  if (Array.isArray(contract.bonusObjectives) && contract.bonusObjectives.length > 0) {
    const bonusLabel = document.createElement('p');
    bonusLabel.className = 'mc-bonus-label';
    bonusLabel.textContent = 'Bonus Targets (Optional)';
    card.appendChild(bonusLabel);

    const bonusList = document.createElement('ul');
    bonusList.className = 'mc-objectives-list';

    for (const obj of contract.bonusObjectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item bonus';

      const indicator = document.createElement('span');
      indicator.className = `mc-objective-indicator ${obj.completed ? 'completed' : 'pending'}`;
      indicator.textContent = obj.completed ? '\u2605' : '\u2606'; // filled or empty star
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = `mc-objective-text ${obj.completed ? 'completed' : 'pending'}`;
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      bonusList.appendChild(item);
    }
    card.appendChild(bonusList);

    if (contract.bonusReward) {
      const bonusRewardEl = document.createElement('p');
      bonusRewardEl.className = 'mc-bonus-reward';
      bonusRewardEl.textContent = `Bonus reward: ${fmtCash(contract.bonusReward)}`;
      card.appendChild(bonusRewardEl);
    }
  }

  // Conflict warning
  if (mc.state && Array.isArray(contract.conflictTags) && contract.conflictTags.length > 0) {
    const conflicts = getActiveConflicts(mc.state);
    const myConflicts = conflicts.filter(
      (c) => c.contractA === contract.id || c.contractB === contract.id,
    );
    if (myConflicts.length > 0) {
      const otherIds = myConflicts.map((c) =>
        c.contractA === contract.id ? c.contractB : c.contractA,
      );
      const otherTitles = otherIds.map((id) => {
        const other = (mc.state!.contracts.active as ExtendedContract[]).find((ac) => ac.id === id);
        return other ? other.title : id;
      });
      const warning = document.createElement('div');
      warning.className = 'mc-conflict-warning';
      warning.textContent = `Conflicts with: ${otherTitles.join(', ')}`;
      card.appendChild(warning);
    }
  }

  // Meta info (deadline)
  const meta = document.createElement('p');
  meta.className = 'mc-contract-meta';
  if (contract.deadlinePeriod != null) {
    const flightsLeft = contract.deadlinePeriod - (mc.state?.currentPeriod ?? 0);
    meta.innerHTML = `<span>Deadline: ${flightsLeft} flight${flightsLeft !== 1 ? 's' : ''} remaining</span>`;
  } else {
    meta.innerHTML = '<span>No deadline (open-ended)</span>';
  }
  card.appendChild(meta);

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mc-cancel-btn';
  cancelBtn.textContent = `Cancel (${fmtCash(contract.penaltyFee)} penalty)`;
  cancelBtn.addEventListener('click', () => _handleCancelContract(contract.id));
  card.appendChild(cancelBtn);

  return card;
}

/**
 * Handle clicking Cancel on an active contract.
 */
function _handleCancelContract(contractId: string): void {
  const mc = getMCState();
  if (!mc.state) return;

  const result = cancelContract(mc.state, contractId);
  if (result.success) {
    renderActiveContractsTab();
  } else {
    console.warn('[Mission Control UI] cancelContract failed:', result.error);
  }
}
