/**
 * hubSwitcher.ts — Hub switcher dropdown for the hub screen.
 *
 * Renders a `<select id="hub-switcher">` dropdown listing all hubs with
 * name, body, and status indicators ([Building]/[Offline]). On change,
 * calls `setActiveHub()` and triggers a re-render callback.
 *
 * @module hubSwitcher
 */

import type { GameState } from '../core/gameState.ts';
import { setActiveHub } from '../core/hubs.ts';

let _selectEl: HTMLSelectElement | null = null;
let _container: HTMLElement | null = null;

/**
 * Create and mount the hub switcher dropdown inside the given container.
 *
 * @param container   The parent element to mount into (typically `#hub-overlay`).
 * @param state       The current game state — read for `hubs` and `activeHubId`.
 * @param onHubChanged  Callback invoked after the active hub is switched.
 */
export function initHubSwitcher(
  container: HTMLElement,
  state: GameState,
  onHubChanged: () => void,
): void {
  // Create wrapper div for positioning
  const wrapper = document.createElement('div');
  wrapper.id = 'hub-switcher-wrapper';
  wrapper.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:20;';

  _selectEl = document.createElement('select');
  _selectEl.id = 'hub-switcher';

  wrapper.appendChild(_selectEl);
  container.appendChild(wrapper);
  _container = wrapper;

  renderHubSwitcher(state);

  _selectEl.addEventListener('change', () => {
    if (!_selectEl) return;
    setActiveHub(state, _selectEl.value);
    renderHubSwitcher(state);
    onHubChanged();
  });
}

/**
 * Re-render the hub switcher options from the current game state.
 * Safe to call at any time — no-ops if the switcher has not been initialised.
 */
export function renderHubSwitcher(state: GameState): void {
  if (!_selectEl) return;

  _selectEl.innerHTML = '';

  for (const hub of state.hubs) {
    const opt = document.createElement('option');
    opt.value = hub.id;

    // Build label: "Name (Body)" with status indicator
    let label = `${hub.name} (${hub.bodyId})`;
    if (!hub.online && hub.constructionQueue.some(p => p.completedPeriod === undefined)) {
      label += ' [Building]';
    } else if (!hub.online) {
      label += ' [Offline]';
    }

    opt.textContent = label;
    opt.selected = hub.id === state.activeHubId;
    _selectEl.appendChild(opt);
  }

  // Hide if only one hub
  if (_container) {
    _container.style.display = state.hubs.length <= 1 ? 'none' : '';
  }
}

/**
 * Tear down the hub switcher, removing it from the DOM and clearing refs.
 */
export function destroyHubSwitcher(): void {
  if (_container) {
    _container.remove();
    _container = null;
  }
  _selectEl = null;
}
