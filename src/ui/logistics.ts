/**
 * logistics.ts — Logistics Center UI panel.
 *
 * Displays mining site information with power budgets, module lists,
 * refinery recipe management, and resource storage levels.
 *
 * @module ui/logistics
 */

import type { GameState, MiningSite } from '../core/gameState.ts';
import { MiningModuleType } from '../core/constants.ts';
import type { ResourceType } from '../core/constants.ts';
import { REFINERY_RECIPES, setRefineryRecipe } from '../core/refinery.ts';
import './logistics.css';

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let _overlay: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _selectedBodyId: string | null = null;
let _activeTab: 'mining' | 'routes' = 'mining';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a module type name for display.
 * Replaces underscores with spaces and title-cases each word.
 * E.g. `MINING_DRILL` -> `Mining Drill`.
 */
function _formatModuleType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a resource type name for display.
 * E.g. `WATER_ICE` -> `Water Ice`, `CO2` -> `Co2`.
 */
function _formatResourceType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the Logistics Center panel.
 */
export function openLogisticsPanel(state: GameState, parentEl: HTMLElement): void {
  _state = state;
  _activeTab = 'mining';
  _selectedBodyId = null;

  _overlay = document.createElement('div');
  _overlay.id = 'logistics-overlay';
  _overlay.className = 'facility-overlay';
  parentEl.appendChild(_overlay);

  _render();
}

/**
 * Close and remove the Logistics Center panel.
 */
export function closeLogisticsPanel(): void {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  _selectedBodyId = null;
}

// ---------------------------------------------------------------------------
// Rendering — Main
// ---------------------------------------------------------------------------

function _render(): void {
  if (!_overlay || !_state) return;
  _overlay.innerHTML = '';

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

  _overlay.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'facility-tabs';

  const tabDefs: Array<{ id: 'mining' | 'routes'; label: string }> = [
    { id: 'mining', label: 'Mining Sites' },
    { id: 'routes', label: 'Route Management' },
  ];

  for (const def of tabDefs) {
    const tab = document.createElement('button');
    tab.className = 'facility-tab' + (def.id === _activeTab ? ' active' : '');
    tab.textContent = def.label;
    tab.addEventListener('click', () => {
      _activeTab = def.id;
      _render();
    });
    tabs.appendChild(tab);
  }

  _overlay.appendChild(tabs);

  // Body content
  if (_activeTab === 'mining') {
    _renderMiningTab();
  } else {
    _renderRoutesTab();
  }
}

// ---------------------------------------------------------------------------
// Mining Sites Tab
// ---------------------------------------------------------------------------

function _renderMiningTab(): void {
  if (!_overlay || !_state) return;

  const sites = _state.miningSites;

  if (sites.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'facility-content empty-msg';
    msg.textContent = 'No mining sites established. Land a Base Control Unit on a celestial body to create one.';
    _overlay.appendChild(msg);
    return;
  }

  // Group sites by bodyId
  const bodySites = new Map<string, MiningSite[]>();
  for (const site of sites) {
    const list = bodySites.get(site.bodyId);
    if (list) {
      list.push(site);
    } else {
      bodySites.set(site.bodyId, [site]);
    }
  }

  const bodyIds = [...bodySites.keys()];

  // Auto-select first body if none selected or selection is invalid
  if (!_selectedBodyId || !bodySites.has(_selectedBodyId)) {
    _selectedBodyId = bodyIds[0];
  }

  // Two-column layout
  const body = document.createElement('div');
  body.className = 'logistics-body';

  // Left sidebar — body list
  const sidebar = document.createElement('div');
  sidebar.className = 'logistics-sidebar';

  for (const bodyId of bodyIds) {
    const item = document.createElement('div');
    item.className = 'logistics-sidebar-item' + (bodyId === _selectedBodyId ? ' active' : '');
    item.textContent = bodyId;
    item.addEventListener('click', () => {
      _selectedBodyId = bodyId;
      _render();
    });
    sidebar.appendChild(item);
  }

  body.appendChild(sidebar);

  // Right content area — sites for selected body
  const content = document.createElement('div');
  content.className = 'logistics-content';

  const selectedSites = bodySites.get(_selectedBodyId!) ?? [];
  for (const site of selectedSites) {
    content.appendChild(_renderSiteCard(site));
  }

  body.appendChild(content);
  _overlay.appendChild(body);
}

// ---------------------------------------------------------------------------
// Site Card
// ---------------------------------------------------------------------------

function _renderSiteCard(site: MiningSite): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'logistics-site-card';

  // Site name and body
  const nameEl = document.createElement('h3');
  nameEl.className = 'logistics-site-name';
  nameEl.textContent = `${site.name} \u2014 ${site.bodyId}`;
  card.appendChild(nameEl);

  // Power budget
  card.appendChild(_renderPowerBar(site));

  // Module list
  card.appendChild(_renderModuleList(site));

  // Storage levels
  const storageEntries = Object.entries(site.storage) as Array<[ResourceType, number]>;
  if (storageEntries.length > 0) {
    card.appendChild(_renderResourceSection('Storage', storageEntries, 'logistics-storage-section'));
  }

  // Orbital buffer
  const bufferEntries = Object.entries(site.orbitalBuffer) as Array<[ResourceType, number]>;
  if (bufferEntries.length > 0) {
    card.appendChild(_renderResourceSection('Orbital Buffer', bufferEntries, 'logistics-buffer-section'));
  }

  return card;
}

// ---------------------------------------------------------------------------
// Power Bar
// ---------------------------------------------------------------------------

function _renderPowerBar(site: MiningSite): HTMLDivElement {
  const wrapper = document.createElement('div');

  const label = document.createElement('div');
  const ratio = site.powerRequired > 0 ? site.powerGenerated / site.powerRequired : 1;
  const pct = Math.min(ratio * 100, 100);

  let colorClass: string;
  if (ratio >= 1) {
    colorClass = 'logistics-power-ok';
  } else if (ratio >= 0.5) {
    colorClass = 'logistics-power-warn';
  } else {
    colorClass = 'logistics-power-crit';
  }

  label.textContent = `Power: ${site.powerGenerated} / ${site.powerRequired}`;
  if (ratio < 1) {
    label.style.color = 'var(--color-warning)';
  }
  wrapper.appendChild(label);

  const bar = document.createElement('div');
  bar.className = 'logistics-power-bar';

  const fill = document.createElement('div');
  fill.className = `logistics-power-fill ${colorClass}`;
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);

  wrapper.appendChild(bar);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Module List
// ---------------------------------------------------------------------------

function _renderModuleList(site: MiningSite): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'logistics-module-list';

  for (const mod of site.modules) {
    const li = document.createElement('li');
    li.className = 'logistics-module-item';

    const typeText = _formatModuleType(mod.type);
    let text = `${typeText} (${mod.partId})`;

    if (mod.type === MiningModuleType.REFINERY) {
      // Show current recipe and selector
      const span = document.createElement('span');
      span.textContent = text + ' \u2014 Recipe: ';
      li.appendChild(span);

      const select = document.createElement('select');
      select.className = 'logistics-recipe-select';

      // "None" option
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'None';
      select.appendChild(noneOpt);

      for (const recipe of REFINERY_RECIPES) {
        const opt = document.createElement('option');
        opt.value = recipe.id;
        opt.textContent = recipe.name;
        if (mod.recipeId === recipe.id) {
          opt.selected = true;
        }
        select.appendChild(opt);
      }

      // If no recipe is set, the "None" option stays selected by default
      if (!mod.recipeId) {
        noneOpt.selected = true;
      }

      select.addEventListener('change', () => {
        const value = select.value;
        if (value) {
          setRefineryRecipe(site, mod.id, value);
        } else {
          // Clear recipe — set recipeId to undefined
          mod.recipeId = undefined;
        }
        _render();
      });

      li.appendChild(select);
    } else {
      li.textContent = text;
    }

    list.appendChild(li);
  }

  return list;
}

// ---------------------------------------------------------------------------
// Resource Section (Storage / Orbital Buffer)
// ---------------------------------------------------------------------------

function _renderResourceSection(
  title: string,
  entries: Array<[ResourceType, number]>,
  cssClass: string,
): HTMLDivElement {
  const section = document.createElement('div');
  section.className = cssClass;

  const heading = document.createElement('h4');
  heading.textContent = title;
  heading.style.margin = '0 0 var(--space-xs)';
  heading.style.fontSize = 'var(--font-size-body)';
  heading.style.color = 'var(--color-text-secondary)';
  section.appendChild(heading);

  for (const [resourceType, amount] of entries) {
    const row = document.createElement('div');
    row.className = 'logistics-resource-row';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = _formatResourceType(resourceType);
    row.appendChild(nameSpan);

    const amountSpan = document.createElement('span');
    amountSpan.className = 'logistics-resource-amount';
    amountSpan.textContent = `${amount.toFixed(1)} kg`;
    row.appendChild(amountSpan);

    section.appendChild(row);
  }

  return section;
}

// ---------------------------------------------------------------------------
// Routes Tab (Placeholder)
// ---------------------------------------------------------------------------

function _renderRoutesTab(): void {
  if (!_overlay) return;

  const content = document.createElement('div');
  content.className = 'facility-content';

  const msg = document.createElement('div');
  msg.className = 'empty-msg';
  msg.textContent = 'Route management coming soon.';
  content.appendChild(msg);

  _overlay.appendChild(content);
}
