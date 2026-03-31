/**
 * settings.js — Game Settings (Difficulty) panel UI.
 *
 * Renders a full-screen overlay accessible from the hub that lets the player
 * adjust difficulty options mid-game:
 *   - Malfunction frequency: Off / Low / Normal / High
 *   - Weather severity:      Off / Mild / Normal / Extreme
 *   - Financial pressure:    Easy / Normal / Hard
 *   - Crew injury duration:  Short / Normal / Long
 *
 * Settings are stored on `gameState.difficultySettings` and take effect
 * immediately.  They are not shown on save slot summaries.
 *
 * @module ui/settings
 */

import {
  MalfunctionFrequency,
  WeatherSeverity,
  FinancialPressure,
  InjuryDuration,
} from '../core/constants.js';
import { getDifficultySettings, updateDifficultySettings } from '../core/settings.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const SETTINGS_STYLES = `
/* ── Settings panel overlay ──────────────────────────────────────────────── */
#settings-panel {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 20, 0.94);
  z-index: 400;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: system-ui, sans-serif;
  color: #d0e0f0;
  pointer-events: auto;
  overflow: hidden;
}

.settings-content {
  width: 100%;
  max-width: 560px;
  padding: 36px 24px 44px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

#settings-panel h1 {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 6px;
  letter-spacing: 0.04em;
  color: #80c8ff;
}

.settings-subtitle {
  font-size: 0.82rem;
  color: #5080a0;
  margin: 0 0 28px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ── Setting row ─────────────────────────────────────────────────────────── */
.settings-group {
  width: 100%;
  margin-bottom: 22px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 16px 18px;
}

.settings-group-label {
  font-size: 0.92rem;
  font-weight: 600;
  color: #c0d8f0;
  margin: 0 0 4px;
}

.settings-group-hint {
  font-size: 0.75rem;
  color: #6090b0;
  margin: 0 0 12px;
}

.settings-options {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.settings-option-btn {
  padding: 7px 16px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  color: #90b0c8;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.settings-option-btn:hover {
  background: rgba(255, 255, 255, 0.10);
  border-color: rgba(255, 255, 255, 0.20);
  color: #c0d8f0;
}

.settings-option-btn.active {
  background: #1a4070;
  border-color: #4080b0;
  color: #c8e8ff;
  font-weight: 600;
}

/* ── Close button ────────────────────────────────────────────────────────── */
.settings-close-btn {
  margin-top: 20px;
  padding: 10px 32px;
  background: #1a3050;
  border: 1px solid #4080b0;
  border-radius: 6px;
  color: #c8e8ff;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
  letter-spacing: 0.03em;
}

.settings-close-btn:hover {
  background: #235a90;
}
`;

// ---------------------------------------------------------------------------
// Setting definitions
// ---------------------------------------------------------------------------

const SETTING_DEFS = [
  {
    key: 'malfunctionFrequency',
    label: 'Malfunction Frequency',
    hint: 'How likely parts are to malfunction during flight.',
    options: [
      { value: MalfunctionFrequency.OFF,    label: 'Off' },
      { value: MalfunctionFrequency.LOW,    label: 'Low' },
      { value: MalfunctionFrequency.NORMAL, label: 'Normal' },
      { value: MalfunctionFrequency.HIGH,   label: 'High' },
    ],
  },
  {
    key: 'weatherSeverity',
    label: 'Weather Severity',
    hint: 'How severe weather conditions are at launch sites.',
    options: [
      { value: WeatherSeverity.OFF,     label: 'Off' },
      { value: WeatherSeverity.MILD,    label: 'Mild' },
      { value: WeatherSeverity.NORMAL,  label: 'Normal' },
      { value: WeatherSeverity.EXTREME, label: 'Extreme' },
    ],
  },
  {
    key: 'financialPressure',
    label: 'Financial Pressure',
    hint: 'Easy: 2\u00D7 rewards. Normal: standard. Hard: 0.5\u00D7 rewards, 2\u00D7 costs.',
    options: [
      { value: FinancialPressure.EASY,   label: 'Easy' },
      { value: FinancialPressure.NORMAL, label: 'Normal' },
      { value: FinancialPressure.HARD,   label: 'Hard' },
    ],
  },
  {
    key: 'injuryDuration',
    label: 'Crew Injury Duration',
    hint: 'How long crew members are unavailable after being injured.',
    options: [
      { value: InjuryDuration.SHORT,  label: 'Short' },
      { value: InjuryDuration.NORMAL, label: 'Normal' },
      { value: InjuryDuration.LONG,   label: 'Long' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the settings panel overlay.
 *
 * @param {HTMLElement} container  The #ui-overlay div.
 * @param {import('../core/gameState.js').GameState} state
 */
export function openSettingsPanel(container, state) {
  // Prevent duplicate.
  if (document.getElementById('settings-panel')) return;

  // Inject styles once.
  if (!document.getElementById('settings-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'settings-styles';
    styleEl.textContent = SETTINGS_STYLES;
    document.head.appendChild(styleEl);
  }

  const panel = document.createElement('div');
  panel.id = 'settings-panel';

  const content = document.createElement('div');
  content.className = 'settings-content';
  panel.appendChild(content);

  // ── Heading ────────────────────────────────────────────────────────────
  const heading = document.createElement('h1');
  heading.textContent = 'Game Settings';
  content.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'settings-subtitle';
  subtitle.textContent = 'Difficulty options — changes take effect immediately';
  content.appendChild(subtitle);

  // ── Setting groups ─────────────────────────────────────────────────────
  const current = getDifficultySettings(state);

  for (const def of SETTING_DEFS) {
    const group = document.createElement('div');
    group.className = 'settings-group';

    const labelEl = document.createElement('p');
    labelEl.className = 'settings-group-label';
    labelEl.textContent = def.label;
    group.appendChild(labelEl);

    const hintEl = document.createElement('p');
    hintEl.className = 'settings-group-hint';
    hintEl.textContent = def.hint;
    group.appendChild(hintEl);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'settings-options';

    for (const opt of def.options) {
      const btn = document.createElement('button');
      btn.className = 'settings-option-btn';
      btn.textContent = opt.label;
      btn.setAttribute('data-setting', def.key);
      btn.setAttribute('data-value', opt.value);

      if (current[def.key] === opt.value) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => {
        // Update state.
        updateDifficultySettings(state, { [def.key]: opt.value });

        // Update UI — deactivate siblings, activate clicked.
        for (const sibling of optionsRow.querySelectorAll('.settings-option-btn')) {
          sibling.classList.remove('active');
        }
        btn.classList.add('active');
      });

      optionsRow.appendChild(btn);
    }

    group.appendChild(optionsRow);
    content.appendChild(group);
  }

  // ── Close button ───────────────────────────────────────────────────────
  const closeBtn = document.createElement('button');
  closeBtn.className = 'settings-close-btn';
  closeBtn.textContent = '\u2190 Back to Hub';
  closeBtn.addEventListener('click', () => {
    panel.remove();
  });
  content.appendChild(closeBtn);

  container.appendChild(panel);
  console.log('[Settings UI] Settings panel opened');
}
