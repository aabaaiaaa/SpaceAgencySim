/**
 * _challengesTab.ts — Challenges tab with custom challenge creator form,
 * objective row building, import/export dialogs.
 *
 * @module missionControl/_challengesTab
 */

import { getUnlockedChallenges, getChallengeResult, getActiveChallenge, acceptChallenge, abandonChallenge } from '../../core/challenges.ts';
import { MedalTier, ScoreDirection } from '../../data/challenges.ts';
import {
  createCustomChallenge, deleteCustomChallenge,
  exportChallengeJSON, importChallengeJSON,
  OBJECTIVE_TYPE_META, SCORE_METRIC_OPTIONS,
} from '../../core/customChallenges.ts';
import { getMCState } from './_state.ts';
import { fmtCash, getContent } from './_shell.ts';

// ---------------------------------------------------------------------------
// Medal helpers
// ---------------------------------------------------------------------------

/** Medal display icons. */
const _MEDAL_ICONS: Record<string, string> = {
  [MedalTier.GOLD]:   '\u{1F947}',
  [MedalTier.SILVER]: '\u{1F948}',
  [MedalTier.BRONZE]: '\u{1F949}',
  [MedalTier.NONE]:   '\u{2014}',
};

/**
 * Format a score value for display with appropriate unit.
 */
function _fmtScore(score: number, unit: string, _metric: string): string {
  if (unit === '$') return fmtCash(score);
  if (unit === '%') return `${score}%`;
  if (unit === 'm' && score >= 1000) return `${(score / 1000).toFixed(1)} km`;
  if (unit === 'm/s') return `${score.toFixed(1)} m/s`;
  return `${score.toLocaleString()} ${unit}`;
}

/**
 * Convert medal tier string to a numeric rank for comparison.
 */
function _medalRank(medal: string): number {
  const ranks: Record<string, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };
  return ranks[medal] ?? 0;
}

// ---------------------------------------------------------------------------
// Challenges tab
// ---------------------------------------------------------------------------

export function renderChallengesTab(): void {
  const content = getContent();
  const mc = getMCState();
  if (!content || !mc.state) return;

  const unlocked = getUnlockedChallenges(mc.state);
  const activeChallenge = getActiveChallenge(mc.state);

  // Count medals earned.
  let goldCount = 0;
  let silverCount = 0;
  let bronzeCount = 0;
  for (const ch of unlocked) {
    const result = getChallengeResult(mc.state, ch.id);
    if (result) {
      if (result.medal === MedalTier.GOLD) goldCount++;
      else if (result.medal === MedalTier.SILVER) silverCount++;
      else if (result.medal === MedalTier.BRONZE) bronzeCount++;
    }
  }

  // Summary bar
  const summary = document.createElement('div');
  summary.className = 'mc-challenge-summary';
  const totalMedals = goldCount + silverCount + bronzeCount;
  summary.innerHTML =
    `<strong>${totalMedals}</strong> of ${unlocked.length} challenges completed` +
    (goldCount > 0 ? ` \u2014 ${_MEDAL_ICONS[MedalTier.GOLD]} ${goldCount} Gold` : '') +
    (silverCount > 0 ? ` ${_MEDAL_ICONS[MedalTier.SILVER]} ${silverCount} Silver` : '') +
    (bronzeCount > 0 ? ` ${_MEDAL_ICONS[MedalTier.BRONZE]} ${bronzeCount} Bronze` : '');
  content.appendChild(summary);

  // Toolbar: Create + Import buttons
  const toolbar = document.createElement('div');
  toolbar.className = 'mc-challenge-toolbar';

  const createBtn = document.createElement('button');
  createBtn.textContent = '+ Create Challenge';
  createBtn.addEventListener('click', () => {
    mc.creatorFormOpen = !mc.creatorFormOpen;
    renderChallengesTab();
  });
  toolbar.appendChild(createBtn);

  const importBtn = document.createElement('button');
  importBtn.textContent = 'Import JSON';
  importBtn.addEventListener('click', () => _showImportDialog());
  toolbar.appendChild(importBtn);

  content.appendChild(toolbar);

  // Creator form (inline, toggled)
  if (mc.creatorFormOpen) {
    content.appendChild(_buildCreatorForm());
  }

  if (unlocked.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mc-empty-msg';
    empty.textContent = 'Complete more tutorial missions to unlock challenges.';
    content.appendChild(empty);
    return;
  }

  // Grid of challenge cards
  const grid = document.createElement('div');
  grid.className = 'mc-challenge-grid';

  for (const ch of unlocked) {
    const result = getChallengeResult(mc.state, ch.id);
    const isActive = activeChallenge && activeChallenge.id === ch.id;
    const isCustom = !!ch.custom;

    const card = document.createElement('div');
    card.className = 'mc-challenge-card'
      + (isActive ? ' active-challenge' : '')
      + (isCustom ? ' custom-challenge' : '');

    // Header: title + custom badge + best medal
    const header = document.createElement('div');
    header.className = 'mc-challenge-header';

    const title = document.createElement('h3');
    title.className = 'mc-challenge-title';
    title.textContent = ch.title;
    header.appendChild(title);

    if (isCustom) {
      const badge = document.createElement('span');
      badge.className = 'mc-custom-badge';
      badge.textContent = 'Custom';
      header.appendChild(badge);
    }

    if (result && result.medal !== MedalTier.NONE) {
      const medalEl = document.createElement('span');
      medalEl.className = 'mc-challenge-medal';
      medalEl.textContent = _MEDAL_ICONS[result.medal];
      medalEl.title = `Best: ${result.medal}`;
      header.appendChild(medalEl);
    }

    card.appendChild(header);

    // Description
    const desc = document.createElement('p');
    desc.className = 'mc-challenge-desc';
    desc.textContent = ch.description;
    card.appendChild(desc);

    // Objectives list
    const objList = document.createElement('ul');
    objList.className = 'mc-challenge-objectives';
    for (const obj of ch.objectives) {
      const li = document.createElement('li');
      li.className = 'mc-challenge-obj-item';
      const bullet = document.createElement('span');
      bullet.className = 'mc-obj-bullet';
      bullet.textContent = '\u25C7';
      li.appendChild(bullet);
      li.appendChild(document.createTextNode(obj.description));
      objList.appendChild(li);
    }
    card.appendChild(objList);

    // Medal thresholds row
    const medalsRow = document.createElement('div');
    medalsRow.className = 'mc-challenge-medals-row';

    const tiers: Array<{ key: 'bronze' | 'silver' | 'gold'; label: string; icon: string }> = [
      { key: 'bronze', label: 'Bronze', icon: _MEDAL_ICONS[MedalTier.BRONZE] },
      { key: 'silver', label: 'Silver', icon: _MEDAL_ICONS[MedalTier.SILVER] },
      { key: 'gold',   label: 'Gold',   icon: _MEDAL_ICONS[MedalTier.GOLD] },
    ];

    for (const tier of tiers) {
      const tierEl = document.createElement('div');
      const isEarned = result && _medalRank(result.medal) >= _medalRank(tier.key);
      tierEl.className = `mc-medal-tier tier-${tier.key}` + (isEarned ? ' earned' : '');

      const iconSpan = document.createElement('span');
      iconSpan.className = 'mc-medal-icon';
      iconSpan.textContent = tier.icon;
      tierEl.appendChild(iconSpan);

      const valueSpan = document.createElement('span');
      valueSpan.className = 'mc-medal-value';
      const dir = ch.scoreDirection === ScoreDirection.LOWER_IS_BETTER ? '\u2264' : '\u2265';
      valueSpan.textContent = `${dir} ${_fmtScore(ch.medals[tier.key], ch.scoreUnit, ch.scoreMetric)}`;
      tierEl.appendChild(valueSpan);

      const rewardSpan = document.createElement('span');
      rewardSpan.className = 'mc-medal-reward';
      rewardSpan.textContent = fmtCash(ch.rewards[tier.key]);
      tierEl.appendChild(rewardSpan);

      medalsRow.appendChild(tierEl);
    }
    card.appendChild(medalsRow);

    // Best score info
    if (result) {
      const best = document.createElement('p');
      best.className = 'mc-challenge-best';
      best.innerHTML =
        `Best: <strong>${_fmtScore(result.score, ch.scoreUnit, ch.scoreMetric)}</strong>` +
        ` \u2014 ${result.attempts} attempt${result.attempts !== 1 ? 's' : ''}`;
      card.appendChild(best);
    }

    // Action buttons
    const actions = document.createElement('div');
    actions.className = 'mc-challenge-actions';

    if (isActive) {
      const badge = document.createElement('span');
      badge.className = 'mc-challenge-active-badge';
      badge.textContent = 'Active';
      actions.appendChild(badge);

      const abandonBtn = document.createElement('button');
      abandonBtn.className = 'mc-challenge-abandon-btn';
      abandonBtn.textContent = 'Abandon';
      abandonBtn.addEventListener('click', () => {
        abandonChallenge(mc.state!);
        renderChallengesTab();
      });
      actions.appendChild(abandonBtn);
    } else {
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'mc-challenge-accept-btn';
      acceptBtn.textContent = result ? 'Replay' : 'Accept';
      acceptBtn.addEventListener('click', () => {
        const res = acceptChallenge(mc.state!, ch.id);
        if (res.success) {
          renderChallengesTab();
        }
      });
      actions.appendChild(acceptBtn);
    }

    // Export + Delete buttons for custom challenges
    if (isCustom) {
      const exportBtn = document.createElement('button');
      exportBtn.className = 'mc-challenge-export-btn';
      exportBtn.textContent = 'Export';
      exportBtn.addEventListener('click', () => {
        const json = exportChallengeJSON(ch);
        _showExportDialog(json);
      });
      actions.appendChild(exportBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'mc-challenge-delete-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', () => {
        deleteCustomChallenge(mc.state!, ch.id);
        renderChallengesTab();
      });
      actions.appendChild(delBtn);
    }

    card.appendChild(actions);
    grid.appendChild(card);
  }

  content.appendChild(grid);
}

// ---------------------------------------------------------------------------
// Custom challenge creator form
// ---------------------------------------------------------------------------

/**
 * Build the inline creator form for defining a custom challenge.
 */
function _buildCreatorForm(): HTMLElement {
  const form = document.createElement('div');
  form.className = 'mc-creator-form';

  const heading = document.createElement('h3');
  heading.textContent = 'Create Custom Challenge';
  form.appendChild(heading);

  // Title
  const titleField = _makeField('Title', 'text', 'cc-title', 'My Challenge');
  form.appendChild(titleField);

  // Description
  const descField = document.createElement('div');
  descField.className = 'mc-creator-field';
  const descLabel = document.createElement('label');
  descLabel.textContent = 'Description';
  descLabel.htmlFor = 'cc-description';
  descField.appendChild(descLabel);
  const descInput = document.createElement('textarea');
  descInput.id = 'cc-description';
  descInput.placeholder = 'Optional flavour text for your challenge';
  descInput.rows = 2;
  descField.appendChild(descInput);
  form.appendChild(descField);

  // Objectives section
  const objSection = document.createElement('div');
  objSection.className = 'mc-creator-objectives';
  objSection.id = 'cc-objectives-section';

  const objHeading = document.createElement('h4');
  objHeading.textContent = 'Objectives';
  objSection.appendChild(objHeading);

  // Start with one objective row
  const objContainer = document.createElement('div');
  objContainer.id = 'cc-obj-container';
  objContainer.appendChild(_buildObjectiveRow(0));
  objSection.appendChild(objContainer);

  const addObjBtn = document.createElement('button');
  addObjBtn.className = 'mc-creator-add-obj';
  addObjBtn.textContent = '+ Add Objective';
  addObjBtn.type = 'button';
  addObjBtn.addEventListener('click', () => {
    const container = document.getElementById('cc-obj-container');
    if (container) {
      const idx = container.children.length;
      container.appendChild(_buildObjectiveRow(idx));
    }
  });
  objSection.appendChild(addObjBtn);
  form.appendChild(objSection);

  // Score metric
  const metricField = document.createElement('div');
  metricField.className = 'mc-creator-field';
  const metricLabel = document.createElement('label');
  metricLabel.textContent = 'Score Metric';
  metricLabel.htmlFor = 'cc-metric';
  metricField.appendChild(metricLabel);
  const metricSelect = document.createElement('select');
  metricSelect.id = 'cc-metric';
  for (const opt of SCORE_METRIC_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = `${opt.label} (${opt.unit}, ${opt.direction === ScoreDirection.LOWER_IS_BETTER ? 'lower is better' : 'higher is better'})`;
    metricSelect.appendChild(option);
  }
  metricField.appendChild(metricSelect);
  form.appendChild(metricField);

  // Medal thresholds
  const medalHeading = document.createElement('h4');
  medalHeading.textContent = 'Medal Thresholds';
  medalHeading.className = 'mc-form-sub-heading';
  form.appendChild(medalHeading);

  const medalRow = document.createElement('div');
  medalRow.className = 'mc-creator-row';
  medalRow.appendChild(_makeField('Bronze', 'number', 'cc-medal-bronze', '100'));
  medalRow.appendChild(_makeField('Silver', 'number', 'cc-medal-silver', '50'));
  medalRow.appendChild(_makeField('Gold', 'number', 'cc-medal-gold', '25'));
  form.appendChild(medalRow);

  // Rewards
  const rewardHeading = document.createElement('h4');
  rewardHeading.textContent = 'Rewards ($)';
  rewardHeading.className = 'mc-form-sub-heading';
  form.appendChild(rewardHeading);

  const rewardRow = document.createElement('div');
  rewardRow.className = 'mc-creator-row';
  rewardRow.appendChild(_makeField('Bronze', 'number', 'cc-reward-bronze', '10000'));
  rewardRow.appendChild(_makeField('Silver', 'number', 'cc-reward-silver', '25000'));
  rewardRow.appendChild(_makeField('Gold', 'number', 'cc-reward-gold', '50000'));
  form.appendChild(rewardRow);

  // Error message area
  const errorEl = document.createElement('div');
  errorEl.id = 'cc-error';
  errorEl.className = 'mc-creator-error';
  form.appendChild(errorEl);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'mc-creator-actions';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'mc-creator-submit';
  submitBtn.textContent = 'Create';
  submitBtn.type = 'button';
  submitBtn.addEventListener('click', () => _handleCreateSubmit());
  actions.appendChild(submitBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mc-creator-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.type = 'button';
  cancelBtn.addEventListener('click', () => {
    const mc = getMCState();
    mc.creatorFormOpen = false;
    renderChallengesTab();
  });
  actions.appendChild(cancelBtn);

  form.appendChild(actions);
  return form;
}

/**
 * Build a single objective row for the creator form.
 */
function _buildObjectiveRow(idx: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mc-creator-obj-entry';
  row.dataset.objIdx = String(idx);

  // Type selector
  const typeSelect = document.createElement('select');
  typeSelect.className = 'cc-obj-type';
  for (const [type, meta] of Object.entries(OBJECTIVE_TYPE_META)) {
    const opt = document.createElement('option');
    opt.value = type;
    opt.textContent = meta.label;
    typeSelect.appendChild(opt);
  }
  typeSelect.addEventListener('change', () => {
    // Rebuild target fields when type changes
    _rebuildObjTargetFields(row, typeSelect.value);
  });
  row.appendChild(typeSelect);

  // Target fields container
  const fieldsContainer = document.createElement('span');
  fieldsContainer.className = 'cc-obj-fields';
  row.appendChild(fieldsContainer);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'mc-creator-obj-remove';
  removeBtn.textContent = 'X';
  removeBtn.type = 'button';
  removeBtn.addEventListener('click', () => row.remove());
  row.appendChild(removeBtn);

  // Initialize target fields for the default type
  _rebuildObjTargetFields(row, typeSelect.value);

  return row;
}

/**
 * Rebuild the target input fields for an objective row when the type changes.
 */
function _rebuildObjTargetFields(row: HTMLElement, type: string): void {
  const container = row.querySelector('.cc-obj-fields');
  if (!container) return;
  container.innerHTML = '';

  const meta = OBJECTIVE_TYPE_META[type];
  if (!meta) return;

  for (const field of meta.fields) {
    const input = document.createElement('input');
    input.type = 'number';
    input.placeholder = field.label;
    input.title = field.label;
    input.className = 'cc-obj-target';
    input.dataset.targetKey = field.key;
    input.min = String(field.min ?? '');
    input.style.width = '110px';
    container.appendChild(input);
  }
}

/**
 * Create a simple labelled input field.
 */
function _makeField(labelText: string, inputType: string, id: string, placeholder: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'mc-creator-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = id;
  wrapper.appendChild(label);
  const input = document.createElement('input');
  input.type = inputType;
  input.id = id;
  input.placeholder = placeholder || '';
  wrapper.appendChild(input);
  return wrapper;
}

/**
 * Handle the Create button click -- gather form data and create the challenge.
 */
function _handleCreateSubmit(): void {
  const mc = getMCState();
  if (!mc.state) return;

  const errorEl = document.getElementById('cc-error');
  const setError = (msg: string): void => { if (errorEl) errorEl.textContent = msg; };

  const title = (document.getElementById('cc-title') as HTMLInputElement | null)?.value ?? '';
  const description = (document.getElementById('cc-description') as HTMLTextAreaElement | null)?.value ?? '';

  // Gather objectives
  const objRows = document.querySelectorAll('#cc-obj-container .mc-creator-obj-entry');
  const objectives: Array<{ type: string; target: Record<string, number> }> = [];
  for (const row of objRows) {
    const typeSelect = row.querySelector('.cc-obj-type');
    if (!typeSelect) continue;
    const type = (typeSelect as HTMLSelectElement).value;
    const target: Record<string, number> = {};
    const targetInputs = row.querySelectorAll('.cc-obj-target');
    for (const inp of targetInputs) {
      const key = (inp as HTMLInputElement).dataset.targetKey;
      const val = (inp as HTMLInputElement).value;
      if (key && val !== '') {
        target[key] = Number(val);
      }
    }
    objectives.push({ type, target });
  }

  // Gather metric
  const scoreMetric = (document.getElementById('cc-metric') as HTMLSelectElement | null)?.value ?? '';

  // Gather medals
  const medals = {
    bronze: Number((document.getElementById('cc-medal-bronze') as HTMLInputElement | null)?.value) || 0,
    silver: Number((document.getElementById('cc-medal-silver') as HTMLInputElement | null)?.value) || 0,
    gold:   Number((document.getElementById('cc-medal-gold') as HTMLInputElement | null)?.value) || 0,
  };

  // Gather rewards
  const rewards = {
    bronze: Number((document.getElementById('cc-reward-bronze') as HTMLInputElement | null)?.value) || 0,
    silver: Number((document.getElementById('cc-reward-silver') as HTMLInputElement | null)?.value) || 0,
    gold:   Number((document.getElementById('cc-reward-gold') as HTMLInputElement | null)?.value) || 0,
  };

  const result = createCustomChallenge(mc.state, {
    title,
    description,
    objectives,
    scoreMetric,
    medals,
    rewards,
  });

  if (!result.success) {
    setError(result.error || 'Failed to create challenge.');
    return;
  }

  mc.creatorFormOpen = false;
  renderChallengesTab();
}

// ---------------------------------------------------------------------------
// Import / Export dialogs
// ---------------------------------------------------------------------------

/**
 * Show a modal dialog for importing a challenge from JSON.
 */
function _showImportDialog(): void {
  const overlay = document.createElement('div');
  overlay.className = 'mc-import-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'mc-import-dialog';

  const heading = document.createElement('h3');
  heading.textContent = 'Import Custom Challenge';
  dialog.appendChild(heading);

  const desc = document.createElement('p');
  desc.className = 'mc-import-desc';
  desc.textContent = 'Paste a challenge JSON export below:';
  dialog.appendChild(desc);

  const textarea = document.createElement('textarea');
  textarea.placeholder = '{ "title": "...", ... }';
  dialog.appendChild(textarea);

  const errorEl = document.createElement('div');
  errorEl.className = 'mc-creator-error';
  dialog.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.className = 'mc-import-actions';

  const importBtn = document.createElement('button');
  importBtn.className = 'mc-creator-submit';
  importBtn.textContent = 'Import';
  importBtn.addEventListener('click', () => {
    const mc = getMCState();
    if (!mc.state) return;
    const result = importChallengeJSON(mc.state, textarea.value);
    if (!result.success) {
      errorEl.textContent = result.error || 'Import failed.';
      return;
    }
    overlay.remove();
    renderChallengesTab();
  });
  actions.appendChild(importBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mc-creator-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());
  actions.appendChild(cancelBtn);

  dialog.appendChild(actions);
  overlay.appendChild(dialog);

  // Close on backdrop click
  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

/**
 * Show a modal dialog with exported JSON (for copying).
 */
function _showExportDialog(json: string): void {
  const overlay = document.createElement('div');
  overlay.className = 'mc-import-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'mc-import-dialog';

  const heading = document.createElement('h3');
  heading.textContent = 'Export Custom Challenge';
  dialog.appendChild(heading);

  const desc = document.createElement('p');
  desc.className = 'mc-import-desc';
  desc.textContent = 'Copy the JSON below to share this challenge:';
  dialog.appendChild(desc);

  const textarea = document.createElement('textarea');
  textarea.value = json;
  textarea.readOnly = true;
  dialog.appendChild(textarea);

  const actions = document.createElement('div');
  actions.className = 'mc-import-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'mc-creator-submit';
  copyBtn.textContent = 'Copy to Clipboard';
  copyBtn.addEventListener('click', () => {
    textarea.select();
    void navigator.clipboard.writeText(json).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 1500);
    });
  });
  actions.appendChild(copyBtn);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'mc-creator-cancel';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => overlay.remove());
  actions.appendChild(closeBtn);

  dialog.appendChild(actions);
  overlay.appendChild(dialog);

  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}
