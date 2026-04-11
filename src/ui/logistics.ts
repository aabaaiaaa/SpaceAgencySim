/**
 * logistics.ts — Logistics Center UI panel.
 *
 * Displays mining site information with power budgets, module lists,
 * refinery recipe management, and resource storage levels.
 *
 * Tab rendering is delegated to sub-modules:
 * - `logistics/_miningSites.ts` — Mining Sites tab
 * - `logistics/_routeTable.ts`  — Route Management tab
 *
 * @module ui/logistics
 */

import type { GameState } from '../core/gameState.ts';
import {
  getLogisticsState,
  setLogisticsState,
  resetBuilderState,
  setRenderFn,
} from './logistics/_state.ts';
import { renderMiningTab } from './logistics/_miningSites.ts';
import { renderRoutesTab } from './logistics/_routeTable.ts';
import './logistics.css';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the Logistics Center panel.
 */
export function openLogisticsPanel(state: GameState, parentEl: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.id = 'logistics-overlay';
  overlay.className = 'facility-overlay';
  parentEl.appendChild(overlay);

  setLogisticsState({
    overlay,
    state,
    activeTab: 'mining',
    selectedBodyId: null,
  });

  // Register the render callback so sub-modules can trigger re-renders
  setRenderFn(_render);

  _render();
}

/**
 * Close and remove the Logistics Center panel.
 */
export function closeLogisticsPanel(): void {
  const ls = getLogisticsState();
  if (ls.overlay) {
    ls.overlay.remove();
  }
  setLogisticsState({
    overlay: null,
    state: null,
    selectedBodyId: null,
    expandedRouteIds: new Set<string>(),
  });
  resetBuilderState();
}

// ---------------------------------------------------------------------------
// Rendering — Main
// ---------------------------------------------------------------------------

function _render(): void {
  const ls = getLogisticsState();
  if (!ls.overlay || !ls.state) return;
  ls.overlay.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'facility-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'logistics-back-btn';
  backBtn.className = 'btn-ghost';
  backBtn.textContent = '\u2190 Hub';
  backBtn.addEventListener('click', () => {
    closeLogisticsPanel();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.className = 'facility-title';
  title.textContent = 'Logistics Center';
  header.appendChild(title);

  ls.overlay.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'facility-tabs';

  const tabDefs: Array<{ id: 'mining' | 'routes'; label: string }> = [
    { id: 'mining', label: 'Mining Sites' },
    { id: 'routes', label: 'Route Management' },
  ];

  for (const def of tabDefs) {
    const tab = document.createElement('button');
    tab.className = 'facility-tab' + (def.id === ls.activeTab ? ' active' : '');
    tab.textContent = def.label;
    tab.addEventListener('click', () => {
      setLogisticsState({ activeTab: def.id });
      _render();
    });
    tabs.appendChild(tab);
  }

  ls.overlay.appendChild(tabs);

  // Body content
  if (ls.activeTab === 'mining') {
    renderMiningTab();
  } else {
    renderRoutesTab();
  }
}
