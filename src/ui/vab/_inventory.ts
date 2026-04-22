/**
 * _inventory.ts — Inventory panel rendering, part refund/return logic.
 */

import { getPartById } from '../../data/parts.ts';
import {
  addToInventory,
  getEffectiveReliability,
} from '../../core/partInventory.ts';
import { refreshTopBar } from '../topbar.ts';
import { getVabState } from './_state.ts';
import { fmt$ } from './_partsPanel.ts';
import { getVabListenerTracker } from './_listenerTracker.ts';

import type { GameState, InventoryPart } from '../../core/gameState.ts';

/**
 * Refund cash or return inventory part when removing a placed part.
 * If the part came from inventory, return it instead of refunding cash.
 */
export function refundOrReturnPart(
  instanceId: string,
  partId: string,
  vabRefreshParts: (state: GameState) => void,
): void {
  const S = getVabState();
  if (!S.gameState) return;
  const invEntry = S.inventoryUsedParts.get(instanceId);
  if (invEntry) {
    // Return to inventory (no cash change).
    addToInventory(S.gameState, invEntry.partId, invEntry.wear, invEntry.flights);
    S.inventoryUsedParts.delete(instanceId);
  } else {
    // Bought new — refund cash.
    const def = getPartById(partId);
    if (def) S.gameState.money += def.cost;
  }
  refreshTopBar();
  // Refresh the parts list to update inventory counts.
  if (S.gameState) vabRefreshParts(S.gameState);
}

function _wearColor(wear: number): string {
  return wear < 30 ? '#50c860' : wear < 60 ? '#c0a030' : '#c04040';
}

function _buildEntryRow(entry: InventoryPart, def: NonNullable<ReturnType<typeof getPartById>>, options: { showPartName: boolean }): string {
  const wearPct = Math.round(entry.wear);
  const refurbCost = Math.round(def.cost * 0.3);
  const scrapValue = Math.round(def.cost * 0.15);
  const effRel = def.reliability !== undefined
    ? (getEffectiveReliability(def.reliability, entry.wear) * 100).toFixed(0) + '%'
    : '—';
  const nameLine = options.showPartName
    ? `<span class="vab-inv-row-name">${def.name}</span>`
    : '';
  return (
    `<div class="vab-inv-item" data-inv-id="${entry.id}">` +
      `<div class="vab-inv-row-drag" data-inv-id="${entry.id}" data-part-id="${def.id}" ` +
          `title="Drag onto the rocket to place (uses this copy)">` +
        nameLine +
        `<div class="vab-inv-item-info">` +
          `<span class="vab-inv-wear" style="color:${_wearColor(wearPct)}">${wearPct}% wear</span>` +
          `<span class="vab-inv-flights">${entry.flights} flight${entry.flights !== 1 ? 's' : ''}</span>` +
          `<span class="vab-inv-rel">Rel: ${effRel}</span>` +
        `</div>` +
      `</div>` +
      `<div class="vab-inv-item-actions">` +
        `<button class="vab-inv-btn vab-inv-btn-refurb" data-inv-id="${entry.id}" ` +
            `title="Refurbish: pay ${fmt$(refurbCost)} to reset wear to 10%">` +
          `Refurb ${fmt$(refurbCost)}` +
        `</button>` +
        `<button class="vab-inv-btn vab-inv-btn-scrap" data-inv-id="${entry.id}" ` +
            `title="Scrap: sell for ${fmt$(scrapValue)}">` +
          `Scrap ${fmt$(scrapValue)}` +
        `</button>` +
      `</div>` +
    `</div>`
  );
}

/**
 * Build the inventory panel HTML listing all recovered parts with
 * wear levels and refurbish/scrap actions.
 *
 * Grouping: single-copy parts render as one flat row with the part name.
 * Multi-copy parts render as a collapsible group header; entries are shown
 * when the group is expanded (state tracked in S.expandedInventoryGroups).
 */
export function buildInventoryHTML(): string {
  const S = getVabState();
  if (!S.gameState || !Array.isArray(S.gameState.partInventory) || S.gameState.partInventory.length === 0) {
    return `<p class="vab-inv-empty">No recovered parts.<br>Land safely to recover<br>parts from flights.</p>`;
  }

  // Group by partId.
  const groups = new Map<string, InventoryPart[]>();
  for (const entry of S.gameState.partInventory) {
    if (!groups.has(entry.partId)) groups.set(entry.partId, []);
    groups.get(entry.partId)!.push(entry);
  }

  const rows: string[] = [];
  for (const [partId, entries] of groups) {
    const def = getPartById(partId);
    if (!def) continue;
    // Sort best condition first.
    entries.sort((a, b) => a.wear - b.wear);

    if (entries.length === 1) {
      rows.push(_buildEntryRow(entries[0], def, { showPartName: true }));
      continue;
    }

    const expanded = S.expandedInventoryGroups.has(partId);
    const arrow = expanded ? '▾' : '▸'; // ▾ or ▸
    rows.push(
      `<div class="vab-inv-group-hdr vab-inv-group-toggle" data-part-id="${partId}" ` +
          `role="button" tabindex="0" aria-expanded="${expanded}" ` +
          `title="Click to ${expanded ? 'collapse' : 'expand'}">` +
        `<span class="vab-inv-group-arrow">${arrow}</span>` +
        `<span class="vab-inv-group-label">${def.name}</span>` +
        `<span class="vab-inv-group-count">(${entries.length})</span>` +
      `</div>`,
    );
    if (expanded) {
      for (const entry of entries) {
        rows.push(_buildEntryRow(entry, def, { showPartName: false }));
      }
    }
  }
  return rows.join('');
}

/**
 * Toggle the expanded state of an inventory group by partId.
 */
export function toggleInventoryGroup(partId: string): void {
  const S = getVabState();
  if (S.expandedInventoryGroups.has(partId)) {
    S.expandedInventoryGroups.delete(partId);
  } else {
    S.expandedInventoryGroups.add(partId);
  }
  renderInventoryPanel();
}

/**
 * Render (or re-render) the inventory panel body.
 */
export function renderInventoryPanel(): void {
  const body = document.getElementById('vab-inventory-body');
  if (!body) return;
  body.innerHTML = buildInventoryHTML();
}

/**
 * Refresh the inventory panel if it's open.
 */
export function refreshInventoryPanel(): void {
  const S = getVabState();
  if (S.openPanels.has('inventory')) {
    renderInventoryPanel();
  }
}

/**
 * Attach a pointerdown listener to the inventory panel so clicking a row's
 * drag area (but not its action buttons) initiates a drag for that specific
 * inventory entry.
 */
export function setupInventoryPanelDrag(
  inventoryPanel: HTMLElement,
  startInventoryDrag: (partId: string, inventoryEntryId: string, clientX: number, clientY: number) => void,
): void {
  const tracker = getVabListenerTracker();
  if (!tracker) return;
  tracker.add(inventoryPanel, 'pointerdown', ((e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    // Ignore pointerdown on buttons or inside the actions area.
    if (target.closest('.vab-inv-btn') || target.closest('.vab-inv-item-actions')) return;
    const drag = target.closest('.vab-inv-row-drag') as HTMLElement | null;
    if (!drag) return;
    const partId = drag.dataset.partId;
    const invId  = drag.dataset.invId;
    if (!partId || !invId) return;

    e.preventDefault();
    startInventoryDrag(partId, invId, e.clientX, e.clientY);
  }) as EventListener);
}
