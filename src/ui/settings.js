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
import { createListenerTracker } from './listenerTracker.js';
import { injectStyleOnce } from './injectStyle.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const SETTINGS_STYLES = `
/* ── Settings panel overlay ──────────────────────────────────────────────── */
#settings-panel {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-bg);
  z-index: var(--z-overlay);
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: var(--font-family);
  color: var(--color-text-light);
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
  font-size: var(--font-size-h1);
  font-weight: 700;
  margin: 0 0 6px;
  letter-spacing: 0.04em;
  color: var(--color-text-accent);
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
  background: var(--color-card-bg);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--card-padding);
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
  padding: var(--btn-padding-lg);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
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
  background: var(--color-primary-solid);
  border-color: var(--color-primary-solid-border);
  color: #c8e8ff;
  font-weight: 600;
}

/* ── Close button ────────────────────────────────────────────────────────── */
.settings-close-btn {
  margin-top: var(--space-xl);
  padding: var(--btn-padding-xl);
  background: var(--color-primary-solid);
  border: 1px solid var(--color-primary-solid-border);
  border-radius: var(--radius-md);
  color: #c8e8ff;
  font-size: var(--font-size-body-sm);
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-default);
  letter-spacing: 0.03em;
}

.settings-close-btn:hover {
  background: var(--color-primary-solid-hover);
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
  injectStyleOnce('settings-styles', SETTINGS_STYLES);

  const tracker = createListenerTracker();

  /** Remove all tracked listeners, then remove the panel from the DOM. */
  function closePanel() {
    tracker.removeAll();
    panel.remove();
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

      tracker.add(btn, 'click', () => {
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

  // ── Auto-save toggle ────────────────────────────────────────────────────
  {
    const group = document.createElement('div');
    group.className = 'settings-group';

    const labelEl = document.createElement('p');
    labelEl.className = 'settings-group-label';
    labelEl.textContent = 'Auto-Save';
    group.appendChild(labelEl);

    const hintEl = document.createElement('p');
    hintEl.className = 'settings-group-hint';
    hintEl.textContent = 'Automatically save at end of flight and on return to hub.';
    group.appendChild(hintEl);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'settings-options';

    const onBtn = document.createElement('button');
    onBtn.className = 'settings-option-btn';
    onBtn.textContent = 'On';
    onBtn.setAttribute('data-setting', 'autoSave');
    onBtn.setAttribute('data-value', 'on');

    const offBtn = document.createElement('button');
    offBtn.className = 'settings-option-btn';
    offBtn.textContent = 'Off';
    offBtn.setAttribute('data-setting', 'autoSave');
    offBtn.setAttribute('data-value', 'off');

    if (state.autoSaveEnabled !== false) {
      onBtn.classList.add('active');
    } else {
      offBtn.classList.add('active');
    }

    tracker.add(onBtn, 'click', () => {
      state.autoSaveEnabled = true;
      onBtn.classList.add('active');
      offBtn.classList.remove('active');
    });

    tracker.add(offBtn, 'click', () => {
      state.autoSaveEnabled = false;
      offBtn.classList.add('active');
      onBtn.classList.remove('active');
    });

    optionsRow.appendChild(onBtn);
    optionsRow.appendChild(offBtn);
    group.appendChild(optionsRow);
    content.appendChild(group);
  }

  // ── Debug Mode toggle ────────────────────────────────────────────────────
  {
    const group = document.createElement('div');
    group.className = 'settings-group';

    const labelEl = document.createElement('p');
    labelEl.className = 'settings-group-label';
    labelEl.textContent = 'Debug Mode';
    group.appendChild(labelEl);

    const hintEl = document.createElement('p');
    hintEl.className = 'settings-group-hint';
    hintEl.textContent = 'Enable debug features: debug saves (Ctrl+Shift+D), FPS monitor.';
    group.appendChild(hintEl);

    const optionsRow = document.createElement('div');
    optionsRow.className = 'settings-options';

    const onBtn = document.createElement('button');
    onBtn.className = 'settings-option-btn';
    onBtn.textContent = 'On';
    onBtn.setAttribute('data-setting', 'debugMode');
    onBtn.setAttribute('data-value', 'on');

    const offBtn = document.createElement('button');
    offBtn.className = 'settings-option-btn';
    offBtn.textContent = 'Off';
    offBtn.setAttribute('data-setting', 'debugMode');
    offBtn.setAttribute('data-value', 'off');

    if (state.debugMode) {
      onBtn.classList.add('active');
    } else {
      offBtn.classList.add('active');
    }

    tracker.add(onBtn, 'click', () => {
      state.debugMode = true;
      onBtn.classList.add('active');
      offBtn.classList.remove('active');
    });

    tracker.add(offBtn, 'click', () => {
      state.debugMode = false;
      offBtn.classList.add('active');
      onBtn.classList.remove('active');
    });

    optionsRow.appendChild(onBtn);
    optionsRow.appendChild(offBtn);
    group.appendChild(optionsRow);
    content.appendChild(group);
  }

  // ── Close button ───────────────────────────────────────────────────────
  const closeBtn = document.createElement('button');
  closeBtn.className = 'settings-close-btn';
  closeBtn.textContent = '\u2190 Hub';
  tracker.add(closeBtn, 'click', () => closePanel());
  content.appendChild(closeBtn);

  container.appendChild(panel);
}
