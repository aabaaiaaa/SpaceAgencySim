/**
 * _inventory.js — Inventory panel rendering, part refund/return logic.
 */

import { getPartById } from '../../data/parts.js';
import {
  addToInventory,
  getEffectiveReliability,
} from '../../core/partInventory.js';
import { refreshTopBar } from '../topbar.js';
import { getVabState } from './_state.js';
import { fmt$ } from './_partsPanel.js';

/**
 * Refund cash or return inventory part when removing a placed part.
 * If the part came from inventory, return it instead of refunding cash.
 * @param {string} instanceId
 * @param {string} partId
 * @param {(state: import('../../core/gameState.js').GameState) => void} vabRefreshParts
 */
export function refundOrReturnPart(instanceId, partId, vabRefreshParts) {
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

/**
 * Build the inventory panel HTML listing all recovered parts with
 * wear levels and refurbish/scrap actions.
 * @returns {string}
 */
export function buildInventoryHTML() {
  const S = getVabState();
  if (!S.gameState || !Array.isArray(S.gameState.partInventory) || S.gameState.partInventory.length === 0) {
    return `<p class="vab-inv-empty">No recovered parts.<br>Land safely to recover<br>parts from flights.</p>`;
  }

  // Group by partId.
  /** @type {Map<string, import('../../core/gameState.js').InventoryPart[]>} */
  const groups = new Map();
  for (const entry of S.gameState.partInventory) {
    if (!groups.has(entry.partId)) groups.set(entry.partId, []);
    groups.get(entry.partId).push(entry);
  }

  const rows = [];
  for (const [partId, entries] of groups) {
    const def = getPartById(partId);
    if (!def) continue;
    const label = def.name;
    rows.push(`<div class="vab-inv-group-hdr">${label} (${entries.length})</div>`);
    // Sort best condition first.
    entries.sort((a, b) => a.wear - b.wear);
    for (const entry of entries) {
      const wearPct = Math.round(entry.wear);
      const wearColor = wearPct < 30 ? '#50c860' : wearPct < 60 ? '#c0a030' : '#c04040';
      const refurbCost = Math.round(def.cost * 0.3);
      const scrapValue = Math.round(def.cost * 0.15);
      const effRel = def.reliability !== undefined
        ? (getEffectiveReliability(def.reliability, entry.wear) * 100).toFixed(0) + '%'
        : '\u2014';
      rows.push(
        `<div class="vab-inv-item" data-inv-id="${entry.id}">` +
          `<div class="vab-inv-item-info">` +
            `<span class="vab-inv-wear" style="color:${wearColor}">${wearPct}% wear</span>` +
            `<span class="vab-inv-flights">${entry.flights} flight${entry.flights !== 1 ? 's' : ''}</span>` +
            `<span class="vab-inv-rel">Rel: ${effRel}</span>` +
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
        `</div>`,
      );
    }
  }
  return rows.join('');
}

/**
 * Render (or re-render) the inventory panel body.
 */
export function renderInventoryPanel() {
  const body = document.getElementById('vab-inventory-body');
  if (!body) return;
  body.innerHTML = buildInventoryHTML();
}

/**
 * Refresh the inventory panel if it's open.
 */
export function refreshInventoryPanel() {
  const S = getVabState();
  if (S.openPanels.has('inventory')) {
    renderInventoryPanel();
  }
}
