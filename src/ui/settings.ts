/**
 * settings.ts — Game Settings (Difficulty) panel UI.
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
} from '../core/constants.ts';
import { getDifficultySettings, updateDifficultySettings } from '../core/settings.ts';
import { saveSettings } from '../core/settingsStore.ts';
import type { PersistedSettings } from '../core/settingsStore.ts';
import { createListenerTracker } from './listenerTracker.ts';
import { showPerfDashboard, hidePerfDashboard } from './perfDashboard.ts';
import './settings.css';
import type { GameState } from '../core/gameState.ts';
import type { DifficultySettings, MalfunctionMode as MalfunctionModeType } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Persistence helper
// ---------------------------------------------------------------------------

/**
 * Gathers the settings fields from GameState and writes them to the
 * dedicated localStorage key via settingsStore.  Called after every
 * user-initiated change so settings survive save deletion.
 */
function persistCurrentSettings(state: GameState): void {
  const persisted: PersistedSettings = {
    difficultySettings: { ...getDifficultySettings(state) },
    autoSaveEnabled:    state.autoSaveEnabled,
    debugMode:          state.debugMode,
    showPerfDashboard:  state.showPerfDashboard,
    malfunctionMode:    state.malfunctionMode as MalfunctionModeType,
  };
  saveSettings(persisted);
}

// ---------------------------------------------------------------------------
// Setting definitions
// ---------------------------------------------------------------------------

interface SettingOption {
  value: string;
  label: string;
}

interface SettingDef {
  key: keyof DifficultySettings;
  label: string;
  hint: string;
  options: SettingOption[];
}

const SETTING_DEFS: SettingDef[] = [
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
 * @param container  The #ui-overlay div.
 * @param state
 */
export function openSettingsPanel(container: HTMLElement, state: GameState): void {
  // Prevent duplicate.
  if (document.getElementById('settings-panel')) return;

  const tracker = createListenerTracker();

  /** Remove all tracked listeners, then remove the panel from the DOM. */
  function closePanel(): void {
    tracker.removeAll();
    panel.remove();
  }

  const panel: HTMLDivElement = document.createElement('div');
  panel.id = 'settings-panel';

  const content: HTMLDivElement = document.createElement('div');
  content.className = 'settings-content';
  panel.appendChild(content);

  // -- Heading --
  const heading: HTMLHeadingElement = document.createElement('h1');
  heading.textContent = 'Game Settings';
  content.appendChild(heading);

  const subtitle: HTMLParagraphElement = document.createElement('p');
  subtitle.className = 'settings-subtitle';
  subtitle.textContent = 'Difficulty options \u2014 changes take effect immediately';
  content.appendChild(subtitle);

  // -- Setting groups --
  const current = getDifficultySettings(state);

  for (const def of SETTING_DEFS) {
    const group: HTMLDivElement = document.createElement('div');
    group.className = 'settings-group';

    const labelEl: HTMLParagraphElement = document.createElement('p');
    labelEl.className = 'settings-group-label';
    labelEl.textContent = def.label;
    group.appendChild(labelEl);

    const hintEl: HTMLParagraphElement = document.createElement('p');
    hintEl.className = 'settings-group-hint';
    hintEl.textContent = def.hint;
    group.appendChild(hintEl);

    const optionsRow: HTMLDivElement = document.createElement('div');
    optionsRow.className = 'settings-options';

    for (const opt of def.options) {
      const btn: HTMLButtonElement = document.createElement('button');
      btn.className = 'settings-option-btn';
      btn.textContent = opt.label;
      btn.setAttribute('data-setting', def.key);
      btn.setAttribute('data-value', opt.value);

      if (current[def.key] === opt.value) {
        btn.classList.add('active');
      }

      tracker.add(btn, 'click', () => {
        // Update state.
        updateDifficultySettings(state, { [def.key]: opt.value } as Partial<DifficultySettings>);

        // Persist to dedicated settings key.
        persistCurrentSettings(state);

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

  // -- Auto-save toggle --
  {
    const group: HTMLDivElement = document.createElement('div');
    group.className = 'settings-group';

    const labelEl: HTMLParagraphElement = document.createElement('p');
    labelEl.className = 'settings-group-label';
    labelEl.textContent = 'Auto-Save';
    group.appendChild(labelEl);

    const hintEl: HTMLParagraphElement = document.createElement('p');
    hintEl.className = 'settings-group-hint';
    hintEl.textContent = 'Automatically save at end of flight and on return to hub.';
    group.appendChild(hintEl);

    const optionsRow: HTMLDivElement = document.createElement('div');
    optionsRow.className = 'settings-options';

    const onBtn: HTMLButtonElement = document.createElement('button');
    onBtn.className = 'settings-option-btn';
    onBtn.textContent = 'On';
    onBtn.setAttribute('data-setting', 'autoSave');
    onBtn.setAttribute('data-value', 'on');

    const offBtn: HTMLButtonElement = document.createElement('button');
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
      persistCurrentSettings(state);
      onBtn.classList.add('active');
      offBtn.classList.remove('active');
    });

    tracker.add(offBtn, 'click', () => {
      state.autoSaveEnabled = false;
      persistCurrentSettings(state);
      offBtn.classList.add('active');
      onBtn.classList.remove('active');
    });

    optionsRow.appendChild(onBtn);
    optionsRow.appendChild(offBtn);
    group.appendChild(optionsRow);
    content.appendChild(group);
  }

  // -- Debug Mode toggle --
  {
    const group: HTMLDivElement = document.createElement('div');
    group.className = 'settings-group';

    const labelEl: HTMLParagraphElement = document.createElement('p');
    labelEl.className = 'settings-group-label';
    labelEl.textContent = 'Debug Mode';
    group.appendChild(labelEl);

    const hintEl: HTMLParagraphElement = document.createElement('p');
    hintEl.className = 'settings-group-hint';
    hintEl.textContent = 'Enable debug features: debug saves (Ctrl+Shift+D), FPS monitor.';
    group.appendChild(hintEl);

    const optionsRow: HTMLDivElement = document.createElement('div');
    optionsRow.className = 'settings-options';

    const onBtn: HTMLButtonElement = document.createElement('button');
    onBtn.className = 'settings-option-btn';
    onBtn.textContent = 'On';
    onBtn.setAttribute('data-setting', 'debugMode');
    onBtn.setAttribute('data-value', 'on');

    const offBtn: HTMLButtonElement = document.createElement('button');
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
      persistCurrentSettings(state);
      onBtn.classList.add('active');
      offBtn.classList.remove('active');
    });

    tracker.add(offBtn, 'click', () => {
      state.debugMode = false;
      persistCurrentSettings(state);
      offBtn.classList.add('active');
      onBtn.classList.remove('active');
    });

    optionsRow.appendChild(onBtn);
    optionsRow.appendChild(offBtn);
    group.appendChild(optionsRow);
    content.appendChild(group);
  }

  // -- Performance Dashboard toggle --
  {
    const group: HTMLDivElement = document.createElement('div');
    group.className = 'settings-group';

    const labelEl: HTMLParagraphElement = document.createElement('p');
    labelEl.className = 'settings-group-label';
    labelEl.textContent = 'Performance Dashboard';
    group.appendChild(labelEl);

    const hintEl: HTMLParagraphElement = document.createElement('p');
    hintEl.className = 'settings-group-hint';
    hintEl.textContent = 'Show an overlay with FPS, frame time, worker latency, and memory stats. Toggle with F3.';
    group.appendChild(hintEl);

    const optionsRow: HTMLDivElement = document.createElement('div');
    optionsRow.className = 'settings-options';

    const onBtn: HTMLButtonElement = document.createElement('button');
    onBtn.className = 'settings-option-btn';
    onBtn.textContent = 'On';
    onBtn.setAttribute('data-setting', 'perfDashboard');
    onBtn.setAttribute('data-value', 'on');

    const offBtn: HTMLButtonElement = document.createElement('button');
    offBtn.className = 'settings-option-btn';
    offBtn.textContent = 'Off';
    offBtn.setAttribute('data-setting', 'perfDashboard');
    offBtn.setAttribute('data-value', 'off');

    if (state.showPerfDashboard) {
      onBtn.classList.add('active');
    } else {
      offBtn.classList.add('active');
    }

    tracker.add(onBtn, 'click', () => {
      state.showPerfDashboard = true;
      persistCurrentSettings(state);
      showPerfDashboard();
      onBtn.classList.add('active');
      offBtn.classList.remove('active');
    });

    tracker.add(offBtn, 'click', () => {
      state.showPerfDashboard = false;
      persistCurrentSettings(state);
      hidePerfDashboard();
      offBtn.classList.add('active');
      onBtn.classList.remove('active');
    });

    optionsRow.appendChild(onBtn);
    optionsRow.appendChild(offBtn);
    group.appendChild(optionsRow);
    content.appendChild(group);
  }

  // -- Close button --
  const closeBtn: HTMLButtonElement = document.createElement('button');
  closeBtn.className = 'settings-close-btn';
  closeBtn.textContent = '\u2190 Hub';
  tracker.add(closeBtn, 'click', () => closePanel());
  content.appendChild(closeBtn);

  // Escape key closes the settings panel.
  tracker.add(document, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Escape') closePanel();
  }) as EventListener);

  container.appendChild(panel);
}
