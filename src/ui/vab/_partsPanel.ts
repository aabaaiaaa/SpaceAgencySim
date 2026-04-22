/**
 * _partsPanel.ts — Parts browsing, filtering, detail popup, drag-from-panel logic.
 */

import { PARTS, getPartById } from '../../data/parts.ts';
import type { PartDef } from '../../data/parts.ts';
import { PartType, EARTH_HUB_ID } from '../../core/constants.ts';
import {
  getInventoryCount,
  getInventoryForPart,
  getEffectiveReliability,
} from '../../core/partInventory.ts';
import { getActiveHub, getImportTaxMultiplier } from '../../core/hubs.ts';
import { getVabState } from './_state.ts';
import { getVabListenerTracker } from './_listenerTracker.ts';

import type { GameState } from '../../core/gameState.ts';

/**
 * Register a DOM listener through the VAB tracker so it is cleaned up when
 * the VAB is destroyed.
 */
function _addTracked(
  target: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const tracker = getVabListenerTracker();
  if (tracker) tracker.add(target, event, handler, options);
}

// ---------------------------------------------------------------------------
// Part-type display helpers
// ---------------------------------------------------------------------------

/** Human-readable category label for each PartType value. */
const TYPE_LABELS: Record<string, string> = {
  [PartType.COMMAND_MODULE]:       'Command Modules',
  [PartType.COMPUTER_MODULE]:      'Computer Modules',
  [PartType.SERVICE_MODULE]:       'Service Modules',
  [PartType.FUEL_TANK]:            'Fuel Tanks',
  [PartType.ENGINE]:               'Engines',
  [PartType.SOLID_ROCKET_BOOSTER]: 'Solid Boosters',
  [PartType.STACK_DECOUPLER]:      'Decouplers',
  [PartType.RADIAL_DECOUPLER]:     'Decouplers',
  [PartType.DECOUPLER]:            'Decouplers',
  [PartType.LANDING_LEG]:          'Landing Gear',
  [PartType.LANDING_LEGS]:         'Landing Gear',
  [PartType.PARACHUTE]:            'Parachutes',
  [PartType.SATELLITE]:            'Satellites & Payloads',
  [PartType.HEAT_SHIELD]:          'Heat Shields',
  [PartType.RCS_THRUSTER]:         'RCS Thrusters',
  [PartType.SOLAR_PANEL]:          'Solar Panels',
  [PartType.LAUNCH_CLAMP]:         'Launch Clamps',
};

/** Top-to-bottom display order for part-type groups in the panel. */
const TYPE_ORDER: string[] = [
  PartType.COMMAND_MODULE,
  PartType.COMPUTER_MODULE,
  PartType.SERVICE_MODULE,
  PartType.FUEL_TANK,
  PartType.ENGINE,
  PartType.SOLID_ROCKET_BOOSTER,
  PartType.STACK_DECOUPLER,
  PartType.RADIAL_DECOUPLER,
  PartType.DECOUPLER,
  PartType.LANDING_LEG,
  PartType.LANDING_LEGS,
  PartType.PARACHUTE,
  PartType.SATELLITE,
  PartType.HEAT_SHIELD,
  PartType.RCS_THRUSTER,
  PartType.SOLAR_PANEL,
  PartType.LAUNCH_CLAMP,
];

// Per-type colours for part cards — matches the PART_FILL / PART_STROKE maps
// in src/render/vab.js so the menu previews look like the placed parts.
const _hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
const _CARD_FILL: Record<string, string> = {
  [PartType.COMMAND_MODULE]:       _hex(0x1a3860),
  [PartType.COMPUTER_MODULE]:      _hex(0x122848),
  [PartType.SERVICE_MODULE]:       _hex(0x1c2c58),
  [PartType.FUEL_TANK]:            _hex(0x0e2040),
  [PartType.ENGINE]:               _hex(0x3a1a08),
  [PartType.SOLID_ROCKET_BOOSTER]: _hex(0x301408),
  [PartType.STACK_DECOUPLER]:      _hex(0x142030),
  [PartType.RADIAL_DECOUPLER]:     _hex(0x142030),
  [PartType.DECOUPLER]:            _hex(0x142030),
  [PartType.LANDING_LEG]:          _hex(0x102018),
  [PartType.LANDING_LEGS]:         _hex(0x102018),
  [PartType.PARACHUTE]:            _hex(0x2e1438),
  [PartType.SATELLITE]:            _hex(0x142240),
  [PartType.HEAT_SHIELD]:          _hex(0x2c1000),
  [PartType.RCS_THRUSTER]:         _hex(0x182c30),
  [PartType.SOLAR_PANEL]:          _hex(0x0a2810),
  [PartType.LAUNCH_CLAMP]:         _hex(0x2a2818),
};
const _CARD_STROKE: Record<string, string> = {
  [PartType.COMMAND_MODULE]:       _hex(0x4080c0),
  [PartType.COMPUTER_MODULE]:      _hex(0x2870a0),
  [PartType.SERVICE_MODULE]:       _hex(0x3860b0),
  [PartType.FUEL_TANK]:            _hex(0x2060a0),
  [PartType.ENGINE]:               _hex(0xc06020),
  [PartType.SOLID_ROCKET_BOOSTER]: _hex(0xa04818),
  [PartType.STACK_DECOUPLER]:      _hex(0x305080),
  [PartType.RADIAL_DECOUPLER]:     _hex(0x305080),
  [PartType.DECOUPLER]:            _hex(0x305080),
  [PartType.LANDING_LEG]:          _hex(0x207840),
  [PartType.LANDING_LEGS]:         _hex(0x207840),
  [PartType.PARACHUTE]:            _hex(0x8040a0),
  [PartType.SATELLITE]:            _hex(0x2868b0),
  [PartType.HEAT_SHIELD]:          _hex(0xa04010),
  [PartType.RCS_THRUSTER]:         _hex(0x2890a0),
  [PartType.SOLAR_PANEL]:          _hex(0x20a040),
  [PartType.LAUNCH_CLAMP]:         _hex(0x807040),
};
const _CARD_FILL_DEFAULT  = '#1a4080';
const _CARD_STROKE_DEFAULT = '#4090d0';

/**
 * Format a dollar amount with $ prefix, commas, and no decimal places.
 */
export function fmt$(n: number): string {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/**
 * Build the inner HTML for the parts list from the current game state.
 */
export function buildPartsHTML(state: GameState): string {
  const unlocked = new Set(state.parts);
  const available = PARTS.filter((p: PartDef) => unlocked.has(p.id));

  // Determine import tax for the active hub (1.0 for Earth — no label shown).
  let importMultiplier = 1.0;
  let isOffworld = false;
  try {
    const hub = getActiveHub(state);
    if (hub.id !== EARTH_HUB_ID) {
      importMultiplier = getImportTaxMultiplier(hub.bodyId);
      isOffworld = importMultiplier !== 1.0;
    }
  } catch {
    // No active hub — fall back to no tax.
  }

  // Group parts by display label, preserving TYPE_ORDER.
  const groups: Map<string, PartDef[]> = new Map();
  for (const type of TYPE_ORDER) {
    const label = TYPE_LABELS[type];
    if (!label) continue;
    const matching = available.filter((p: PartDef) => p.type === type);
    if (matching.length === 0) continue;
    if (!groups.has(label)) groups.set(label, []);
    for (const p of matching) groups.get(label)!.push(p);
  }

  if (groups.size === 0) {
    return `<p class="vab-parts-empty">No parts unlocked yet.<br>Complete missions to<br>unlock rocket components.</p>`;
  }

  const rows: string[] = [];
  for (const [label, parts] of groups) {
    rows.push(`<div class="vab-parts-group-hdr">${label}</div>`);
    for (const p of parts) {
      // Scale the part rect to fit within 36x36 while preserving aspect ratio.
      const scale = Math.min(36 / p.width, 36 / p.height, 1);
      const rw = Math.max(8,  Math.round(p.width  * scale));
      const rh = Math.max(4,  Math.round(p.height * scale));
      const invCount = getInventoryCount(state, p.id);
      const invBadge = invCount > 0
        ? `<span class="vab-inv-badge" title="${invCount} in inventory — drag from inventory panel to reuse">${invCount}</span>`
        : '';

      // Calculate import-adjusted cost for off-world hubs.
      const adjustedCost = Math.round(p.cost * importMultiplier);
      const importTag = isOffworld
        ? ` <span class="vab-part-import-tax" data-import-tax="${importMultiplier}">(${importMultiplier}x import)</span>`
        : '';

      const costLabel = `<span>${fmt$(adjustedCost)}</span>${importTag}`;

      const titleCost = fmt$(adjustedCost);
      rows.push(
        `<div class="vab-part-card" data-part-id="${p.id}" tabindex="0" ` +
            `title="${p.name} — ${p.mass} kg · ${titleCost}">` +
          `<div class="vab-part-rect" style="width:${rw}px;height:${rh}px;` +
              `background:${_CARD_FILL[p.type] ?? _CARD_FILL_DEFAULT};` +
              `border:1px solid ${_CARD_STROKE[p.type] ?? _CARD_STROKE_DEFAULT}"></div>` +
          `<div class="vab-part-info">` +
            `<div class="vab-part-name">${p.name}${invBadge}</div>` +
            `<div class="vab-part-meta">` +
              `<span>${p.mass}\u202fkg</span>${costLabel}` +
            `</div>` +
          `</div>` +
        `</div>`,
      );
    }
  }
  return rows.join('');
}

/**
 * Show part details in the detail panel at the bottom of the parts list.
 */
export function showPartDetail(partId: string): void {
  const S = getVabState();
  const detailEl = document.getElementById('vab-part-detail');
  if (!detailEl) return;

  const def = getPartById(partId);
  if (!def) {
    detailEl.setAttribute('hidden', '');
    return;
  }

  const TYPE_LABEL: Record<string, string> = {
    command_module: 'Command Module', computer_module: 'Computer Module',
    service_module: 'Service Module', fuel_tank: 'Fuel Tank',
    engine: 'Engine', solid_rocket_booster: 'Solid Rocket Booster',
    stack_decoupler: 'Stack Decoupler', radial_decoupler: 'Radial Decoupler',
    decoupler: 'Decoupler', landing_leg: 'Landing Leg',
    landing_legs: 'Landing Legs', parachute: 'Parachute', satellite: 'Satellite',
    heat_shield: 'Heat Shield', rcs_thruster: 'RCS Thruster',
    solar_panel: 'Solar Panel', battery: 'Battery', payload: 'Payload',
    docking_port: 'Docking Port', nose_cone: 'Nose Cone',
    launch_clamp: 'Launch Clamp', antenna: 'Antenna', sensor: 'Sensor',
    instrument: 'Instrument', grabbing_arm: 'Grabbing Arm',
  };

  const typeLbl = TYPE_LABEL[def.type.toLowerCase()]
    ?? def.type.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

  // Determine import tax for the active hub.
  let detailImportMultiplier = 1.0;
  let detailIsOffworld = false;
  if (S.gameState) {
    try {
      const hub = getActiveHub(S.gameState);
      if (hub.id !== EARTH_HUB_ID) {
        detailImportMultiplier = getImportTaxMultiplier(hub.bodyId);
        detailIsOffworld = detailImportMultiplier !== 1.0;
      }
    } catch {
      // No active hub — fall back to no tax.
    }
  }
  const detailAdjustedCost = Math.round(def.cost * detailImportMultiplier);
  const costDisplay = detailIsOffworld
    ? `${fmt$(detailAdjustedCost)} <span class="vab-part-import-tax" data-import-tax="${detailImportMultiplier}">(${detailImportMultiplier}x import)</span>`
    : fmt$(detailAdjustedCost);

  const stats: [string, string][] = [
    ['Mass',  `${def.mass.toLocaleString('en-US')} kg`],
    ['Cost',  costDisplay],
  ];

  // Type-specific stats.
  const p = def.properties ?? {};
  if (p.thrust      !== undefined) stats.push(['Thrust (atm)', `${p.thrust} kN`]);
  if (p.thrustVac   !== undefined) stats.push(['Thrust (vac)', `${p.thrustVac} kN`]);
  if (p.isp         !== undefined) stats.push(['Isp (atm)', `${p.isp} s`]);
  if (p.ispVac      !== undefined) stats.push(['Isp (vac)', `${p.ispVac} s`]);
  if (p.throttleable !== undefined) stats.push(['Throttle', p.throttleable ? 'Yes' : 'No (SRB)']);
  if (p.fuelMass     !== undefined) stats.push(['Fuel mass', `${(p.fuelMass as number).toLocaleString('en-US')} kg`]);
  if (p.maxSafeMass  !== undefined) stats.push(['Max safe mass', `${(p.maxSafeMass as number).toLocaleString('en-US')} kg`]);
  if (p.maxLandingSpeed !== undefined) stats.push(['Max landing speed', `${p.maxLandingSpeed} m/s`]);
  if (p.seats !== undefined) stats.push(['Crew seats', String(p.seats)]);
  if (p.experimentDuration !== undefined) stats.push(['Experiment time', `${p.experimentDuration} s`]);
  if (p.crashThreshold !== undefined) stats.push(['Crash rating', `${p.crashThreshold} m/s`]);
  if (p.heatTolerance !== undefined) stats.push(['Heat tolerance', `${(p.heatTolerance as number).toLocaleString('en-US')}`]);

  // Reliability rating (from malfunction system).
  if (def.reliability !== undefined) {
    const pct = (def.reliability * 100).toFixed(0);
    stats.push(['Reliability', `${pct} %`]);
  }

  // Inventory availability info.
  const invCount = S.gameState ? getInventoryCount(S.gameState, partId) : 0;
  let invInfo = '';
  if (invCount > 0) {
    const bestPart = S.gameState ? getInventoryForPart(S.gameState, partId)[0] : null;
    const bestWear = bestPart ? Math.round(bestPart.wear) : 0;
    const effRel = (bestPart && def.reliability !== undefined)
      ? (getEffectiveReliability(def.reliability, bestPart.wear) * 100).toFixed(0)
      : null;
    invInfo =
      `<div class="vab-detail-inv">` +
        `<span class="vab-detail-inv-count">${invCount} in inventory — drag from inventory panel</span>` +
        `<span class="vab-detail-inv-wear">Best: ${bestWear}% wear` +
          (effRel ? ` / ${effRel}% eff. reliability` : '') +
        `</span>` +
      `</div>`;
  }

  detailEl.innerHTML =
    `<div class="vab-detail-name">${def.name}</div>` +
    `<div class="vab-detail-type">${typeLbl}</div>` +
    (def.description ? `<div class="vab-detail-desc">${def.description}</div>` : '') +
    invInfo +
    `<div class="vab-detail-stats">` +
      stats.map(([lbl, val]) =>
        `<div class="vab-detail-stat">` +
          `<span class="vab-detail-stat-label">${lbl}</span>` +
          `<span class="vab-detail-stat-value">${val}</span>` +
        `</div>`
      ).join('') +
    `</div>`;

  detailEl.removeAttribute('hidden');
}

/**
 * Attach pointerdown listeners to the parts panel so clicking a part card
 * initiates a drag.
 */
export function setupPanelDrag(
  partsPanel: HTMLElement,
  startDrag: (partId: string, instanceId: string | null, clientX: number, clientY: number) => void,
): void {
  _addTracked(partsPanel, 'pointerdown', ((e: PointerEvent) => {
    if (e.button !== 0) return;
    const card = (e.target as HTMLElement)?.closest?.('.vab-part-card') as HTMLElement | null;
    if (!card) return;
    const partId = card.dataset.partId;
    if (!partId) return;

    e.preventDefault();
    startDrag(partId, null, e.clientX, e.clientY);
  }) as EventListener);

  // Keyboard: Enter/Space on a part card shows its detail panel.
  _addTracked(partsPanel, 'keydown', ((e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = (e.target as HTMLElement)?.closest?.('.vab-part-card') as HTMLElement | null;
    if (!card) return;
    const partId = card.dataset.partId;
    if (!partId) return;
    e.preventDefault();
    showPartDetail(partId);
  }) as EventListener);
}
