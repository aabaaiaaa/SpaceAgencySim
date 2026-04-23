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
import { loadSettings, saveSettings } from '../core/settingsStore.ts';
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
 * dedicated IDB key via settingsStore.  Called after every
 * user-initiated change so settings survive save deletion.
 */
function persistCurrentSettings(state: GameState): void {
  const persisted: PersistedSettings = {
    // Preserve fields that live only in settingsStore (e.g. overlay positions).
    ...loadSettings(),
    difficultySettings: { ...getDifficultySettings(state) },
    autoSaveEnabled:    state.autoSaveEnabled,
    debugMode:          state.debugMode,
    infiniteFuel:       state.infiniteFuel,
    showPerfDashboard:  state.showPerfDashboard,
    malfunctionMode:    state.malfunctionMode as MalfunctionModeType,
  };
  void saveSettings(persisted);
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
 * Options for opening the settings panel.
 */
export interface OpenSettingsPanelOptions {
  /** Invoked after the panel closes (via button click or Escape). */
  onClose?: () => void;
}

/**
 * Open the settings panel overlay.
 *
 * @param container  The #ui-overlay div.
 * @param state
 * @param options    Optional lifecycle hooks (e.g. `onClose`).
 */
export function openSettingsPanel(
  container: HTMLElement,
  state: GameState,
  options?: OpenSettingsPanelOptions,
): void {
  // Prevent duplicate.
  if (document.getElementById('settings-panel')) return;

  const tracker = createListenerTracker();

  /** Remove all tracked listeners, remove the panel from the DOM, and fire onClose. */
  function closePanel(): void {
    tracker.removeAll();
    panel.remove();
    options?.onClose?.();
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
      // Re-open the panel so the Infinite Fuel toggle (gated on debug
      // mode) appears immediately — no need to close/reopen Settings.
      closePanel();
      openSettingsPanel(container, state, options);
    });

    tracker.add(offBtn, 'click', () => {
      state.debugMode = false;
      // Clear any debug-only flags so they never leak into normal play —
      // if we didn't, a player who left Infinite Fuel on and then turned
      // Debug Mode off would be stuck with infinite fuel and no way to
      // disable it (its toggle disappears from this panel).
      if (state.infiniteFuel) state.infiniteFuel = false;
      persistCurrentSettings(state);
      offBtn.classList.add('active');
      onBtn.classList.remove('active');
      // Re-open the panel so the (now-hidden) Infinite Fuel group goes
      // away and the rest of the UI reflects the new state.
      closePanel();
      openSettingsPanel(container, state, options);
    });

    optionsRow.appendChild(onBtn);
    optionsRow.appendChild(offBtn);
    group.appendChild(optionsRow);

    // -- Infinite Fuel (debug-only, nested inside Debug Mode) --
    // Only surfaced when Debug Mode is on so casual players don't accidentally
    // enable it.  The flag skips fuel drain in tickFuelSystem — engines fire
    // forever — useful for manual flight-testing.  Rendered as an indented
    // sub-option so it reads as a child of Debug Mode.
    if (state.debugMode) {
      const subgroup: HTMLDivElement = document.createElement('div');
      subgroup.className = 'settings-subgroup';

      const subLabelEl: HTMLParagraphElement = document.createElement('p');
      subLabelEl.className = 'settings-group-label';
      subLabelEl.textContent = 'Infinite Fuel';
      subgroup.appendChild(subLabelEl);

      const subHintEl: HTMLParagraphElement = document.createElement('p');
      subHintEl.className = 'settings-group-hint';
      subHintEl.textContent = 'Fuel tanks never drain while this is on. Handy for manual flight testing; not for normal play.';
      subgroup.appendChild(subHintEl);

      const subOptionsRow: HTMLDivElement = document.createElement('div');
      subOptionsRow.className = 'settings-options';

      const fuelOnBtn: HTMLButtonElement = document.createElement('button');
      fuelOnBtn.className = 'settings-option-btn';
      fuelOnBtn.textContent = 'On';
      fuelOnBtn.setAttribute('data-setting', 'infiniteFuel');
      fuelOnBtn.setAttribute('data-value', 'on');

      const fuelOffBtn: HTMLButtonElement = document.createElement('button');
      fuelOffBtn.className = 'settings-option-btn';
      fuelOffBtn.textContent = 'Off';
      fuelOffBtn.setAttribute('data-setting', 'infiniteFuel');
      fuelOffBtn.setAttribute('data-value', 'off');

      if (state.infiniteFuel) {
        fuelOnBtn.classList.add('active');
      } else {
        fuelOffBtn.classList.add('active');
      }

      tracker.add(fuelOnBtn, 'click', () => {
        state.infiniteFuel = true;
        persistCurrentSettings(state);
        fuelOnBtn.classList.add('active');
        fuelOffBtn.classList.remove('active');
      });

      tracker.add(fuelOffBtn, 'click', () => {
        state.infiniteFuel = false;
        persistCurrentSettings(state);
        fuelOffBtn.classList.add('active');
        fuelOnBtn.classList.remove('active');
      });

      subOptionsRow.appendChild(fuelOnBtn);
      subOptionsRow.appendChild(fuelOffBtn);
      subgroup.appendChild(subOptionsRow);
      group.appendChild(subgroup);
    }

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
  closeBtn.textContent = '\u2190 Back';
  tracker.add(closeBtn, 'click', () => closePanel());
  content.appendChild(closeBtn);

  // Escape key closes the settings panel.
  tracker.add(document, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Escape') closePanel();
  }) as EventListener);

  container.appendChild(panel);
}
