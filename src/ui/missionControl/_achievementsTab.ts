/**
 * _achievementsTab.ts — Achievements display tab with icons.
 *
 * @module missionControl/_achievementsTab
 */

import { getAchievementStatus } from '../../core/achievements.ts';
import { getMCState } from './_state.ts';
import { fmtCash, getContent } from './_shell.ts';

// ---------------------------------------------------------------------------
// Achievement icons
// ---------------------------------------------------------------------------

/** Achievement icon map -- earned vs locked. */
const _ACHIEVEMENT_ICONS: Record<string, { earned: string; locked: string }> = {
  FIRST_ORBIT:          { earned: '\u{1F30D}', locked: '\u{1F311}' },
  FIRST_SATELLITE:      { earned: '\u{1F6F0}', locked: '\u{1F311}' },
  FIRST_CONSTELLATION:  { earned: '\u{2728}',  locked: '\u{1F311}' },
  FIRST_LUNAR_FLYBY:    { earned: '\u{1F319}', locked: '\u{1F311}' },
  FIRST_LUNAR_ORBIT:    { earned: '\u{1F31D}', locked: '\u{1F311}' },
  FIRST_LUNAR_LANDING:  { earned: '\u{1F311}', locked: '\u{1F311}' },
  FIRST_LUNAR_RETURN:   { earned: '\u{1F680}', locked: '\u{1F311}' },
  FIRST_MARS_ORBIT:     { earned: '\u{1FA90}', locked: '\u{1F311}' },
  FIRST_MARS_LANDING:   { earned: '\u{1F534}', locked: '\u{1F311}' },
  FIRST_SOLAR_SCIENCE:  { earned: '\u{2600}',  locked: '\u{1F311}' },
};

// ---------------------------------------------------------------------------
// Achievements tab
// ---------------------------------------------------------------------------

export function renderAchievementsTab(): void {
  const content = getContent();
  const mc = getMCState();
  if (!content || !mc.state) return;

  const achievements = getAchievementStatus(mc.state);
  const earnedCount = achievements.filter((a) => a.earned).length;
  const totalCount = achievements.length;

  // Summary bar
  const summary = document.createElement('div');
  summary.className = 'mc-achievement-summary';
  summary.innerHTML = `<strong>${earnedCount}</strong> of ${totalCount} achievements earned`;
  content.appendChild(summary);

  // Grid of achievement cards
  const grid = document.createElement('div');
  grid.className = 'mc-achievement-grid';

  for (const ach of achievements) {
    const card = document.createElement('div');
    card.className = 'mc-achievement-card' + (ach.earned ? ' earned' : ' locked');

    // Header with icon and title
    const header = document.createElement('div');
    header.className = 'mc-achievement-header';

    const icon = document.createElement('span');
    icon.className = 'mc-achievement-icon';
    const iconMap = _ACHIEVEMENT_ICONS[ach.id] ?? { earned: '\u{1F3C6}', locked: '\u{1F311}' };
    icon.textContent = ach.earned ? iconMap.earned : iconMap.locked;
    header.appendChild(icon);

    const title = document.createElement('h3');
    title.className = 'mc-achievement-title';
    title.textContent = ach.earned ? ach.title : ach.title;
    header.appendChild(title);

    card.appendChild(header);

    // Description
    const desc = document.createElement('p');
    desc.className = 'mc-achievement-desc';
    desc.textContent = ach.description;
    card.appendChild(desc);

    // Rewards row
    const rewards = document.createElement('div');
    rewards.className = 'mc-achievement-rewards';

    const cash = document.createElement('span');
    cash.className = 'mc-achievement-cash';
    cash.textContent = fmtCash(ach.cashReward);
    rewards.appendChild(cash);

    const rep = document.createElement('span');
    rep.className = 'mc-achievement-rep';
    rep.textContent = `+${ach.repReward} rep`;
    rewards.appendChild(rep);

    card.appendChild(rewards);

    // Earned date
    if (ach.earned && ach.earnedPeriod != null) {
      const earnedEl = document.createElement('div');
      earnedEl.className = 'mc-achievement-earned-date';
      earnedEl.textContent = `Earned on flight ${ach.earnedPeriod}`;
      card.appendChild(earnedEl);
    }

    grid.appendChild(card);
  }

  content.appendChild(grid);
}
