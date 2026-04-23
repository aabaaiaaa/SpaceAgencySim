/**
 * trackingStation.ts — Tracking Station facility screen.
 *
 * Two tabs:
 *   - **Map**: top-down orbital map view with body picker (tier 2+), zoom
 *     cycling, and preview time advance.  Side panel shows orbital-object
 *     counts, tracked objects list, and crewed-vessel life-support status.
 *   - **Details**: capabilities list plus weather forecast (tier 2+) and
 *     transfer route planning summary (tier 3).
 *
 * The map is rendered via the shared PixiJS map scene in inspection mode —
 * no flight is active, so craft/thrust/warp controls are hidden and the
 * preview clock is local to this screen (it does not advance game periods).
 *
 * Requires the Tracking Station facility to be built.
 *
 * @module trackingStation
 */

import type { GameState } from '../core/gameState.ts';
import type { TierFeatureSet } from '../core/constants.ts';
import {
  FacilityId,
  TRACKING_STATION_TIER_FEATURES,
  OrbitalObjectType,
  DEFAULT_LIFE_SUPPORT_PERIODS,
  LIFE_SUPPORT_WARNING_THRESHOLD,
} from '../core/constants.ts';
import { getFacilityTier } from '../core/construction.ts';
import { getWeatherForecast } from '../core/weather.ts';
import { getTransferTargets } from '../core/manoeuvre.ts';
import {
  MapZoom,
  getInspectionBodyId,
  getInspectionAllowedZooms,
  isDebrisTrackingAvailable,
} from '../core/mapView.ts';
import {
  initMapRenderer,
  destroyMapRenderer,
  showMapScene,
  hideMapScene,
  renderInspectionMapFrame,
  setMapTarget,
  getMapTarget,
  resetMapPan,
  getSelectedObjectMarker,
} from '../render/map.ts';
import { CELESTIAL_BODIES, ALL_BODY_IDS } from '../data/bodies.ts';
import { canResumeCraft, prepareCraftResume, ResumeUnavailableError } from '../core/fieldCraftResume.ts';
import { canRecoverFieldCraft, recoverFieldCraft, RecoveryUnavailableError } from '../core/craftRecovery.ts';
import { startFlightScene } from './flightController.ts';
import { returnToHubFromFlight } from './index.ts';
import { createListenerTracker, type ListenerTracker } from './listenerTracker.ts';
import './trackingStation.css';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

type TabId = 'map' | 'details';

let _overlay: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _onBack: (() => void) | null = null;
let _listeners: ListenerTracker | null = null;

let _activeTab: TabId = 'map';
let _inspectionBodyId: string = 'EARTH';
let _inspectionZoom: string = MapZoom.LOCAL_BODY;
let _previewTimeOffset: number = 0;

let _rafId: number | null = null;
let _mapInitialized: boolean = false;

/** Re-entry guard: map-object-click listener is attached once per map-tab render. */
let _objectClickListener: ((e: Event) => void) | null = null;

/** Floating DOM button positioned over the map next to the selected object. */
let _floatingTakeControlBtn: HTMLButtonElement | null = null;

// Preview-time step sizes (seconds).
const TIME_STEP_HOUR = 3600;
const TIME_STEP_DAY = 86_400;

// ---------------------------------------------------------------------------
// Object type display helpers
// ---------------------------------------------------------------------------

const OBJ_TYPE_LABELS: Record<string, string> = {
  [OrbitalObjectType.CRAFT]:     'Craft',
  [OrbitalObjectType.SATELLITE]: 'Satellite',
  [OrbitalObjectType.DEBRIS]:    'Debris',
  [OrbitalObjectType.STATION]:   'Station',
  FIELD_CRAFT:                   'Crewed Vessel',
};

/** Return the display label for a tracked item, distinguishing probe vs crewed field craft. */
function _trackedItemLabel(item: TrackedItem): string {
  if (item.fieldCraft) {
    return item.fieldCraft.crewIds.length === 0 ? 'Probe' : 'Crewed Vessel';
  }
  return OBJ_TYPE_LABELS[item.type] || item.type;
}

/**
 * Type strings that can _possibly_ be resumed given a linked design.
 * Debris is excluded (it's scrap, not a controllable vessel).
 * All other types show a Take Control button — disabled when not resumable,
 * so the selection affordance is always visible.
 */
const CONTROLLABLE_TYPES = new Set<string>([
  OrbitalObjectType.CRAFT,
  OrbitalObjectType.STATION,
  OrbitalObjectType.SATELLITE,
  'FIELD_CRAFT',
]);

interface TrackedItem {
  id: string;
  name: string;
  /** Display type string (one of OBJ_TYPE_LABELS keys). */
  type: string;
  bodyId: string;
  source: 'orbitalObject' | 'fieldCraft';
  /** For field craft only — carry through for the selection detail panel. */
  fieldCraft?: import('../core/gameState.ts').FieldCraft;
}

/** Build the unified list of tracked objects shown in the sidebar. */
function _buildTrackedItems(state: GameState): TrackedItem[] {
  const items: TrackedItem[] = [];
  for (const obj of state.orbitalObjects ?? []) {
    items.push({ id: obj.id, name: obj.name, type: obj.type, bodyId: obj.bodyId, source: 'orbitalObject' });
  }
  for (const fc of state.fieldCraft ?? []) {
    items.push({ id: fc.id, name: fc.name, type: 'FIELD_CRAFT', bodyId: fc.bodyId, source: 'fieldCraft', fieldCraft: fc });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Tracking Station overlay.
 */
export function initTrackingStationUI(
  container: HTMLElement,
  state: GameState,
  { onBack }: { onBack: () => void },
): void {
  _state = state;
  _onBack = onBack;
  _listeners = createListenerTracker();

  _activeTab = 'map';
  _previewTimeOffset = 0;
  _inspectionBodyId = getInspectionBodyId(state);
  const allowedZooms = getInspectionAllowedZooms(state);
  _inspectionZoom = allowedZooms.length > 0 ? allowedZooms[0] : MapZoom.LOCAL_BODY;

  _overlay = document.createElement('div');
  _overlay.id = 'ts-overlay';
  container.appendChild(_overlay);

  _render();
}

/**
 * Remove the Tracking Station overlay.
 */
export function destroyTrackingStationUI(): void {
  _stopMapLoop();
  _detachObjectClickListener();
  _removeFloatingTakeControl();
  if (_mapInitialized) {
    hideMapScene();
    destroyMapRenderer();
    _mapInitialized = false;
  }
  if (_listeners) {
    _listeners.removeAll();
    _listeners = null;
  }
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  _onBack = null;
}

function _removeFloatingTakeControl(): void {
  if (_floatingTakeControlBtn) {
    _floatingTakeControlBtn.remove();
    _floatingTakeControlBtn = null;
  }
}

// ---------------------------------------------------------------------------
// Tab orchestration
// ---------------------------------------------------------------------------

function _setTab(tab: TabId): void {
  if (_activeTab === tab) return;
  _activeTab = tab;
  _render();
}

function _render(): void {
  if (!_overlay || !_state) return;

  const tier = getFacilityTier(_state, FacilityId.TRACKING_STATION);
  const tierInfo = TRACKING_STATION_TIER_FEATURES[tier] || TRACKING_STATION_TIER_FEATURES[1];

  // Reset listeners — tab changes rebuild the whole overlay.
  if (_listeners) {
    _listeners.removeAll();
  } else {
    _listeners = createListenerTracker();
  }

  _overlay.innerHTML = '';
  _overlay.classList.toggle('map-active', _activeTab === 'map');

  _overlay.appendChild(_renderTopbar(tier, tierInfo));

  if (_activeTab === 'map') {
    _stopMapLoop();
    _ensureMapInitialized();
    _overlay.appendChild(_renderMapTab(tier));
    showMapScene();
    _attachObjectClickListener();
    _startMapLoop();
  } else {
    _stopMapLoop();
    hideMapScene();
    _detachObjectClickListener();
    _removeFloatingTakeControl();
    _overlay.appendChild(_renderDetailsTab(tier, tierInfo));
  }
}

function _attachObjectClickListener(): void {
  if (_objectClickListener) return;
  _objectClickListener = (e: Event): void => {
    const detail = (e as CustomEvent).detail as { objectId?: string } | undefined;
    if (!detail?.objectId) return;
    setMapTarget(detail.objectId);
    // Re-render the sidebar so the matching row shows the selected style.
    _refreshMapSidebar();
  };
  window.addEventListener('map-object-click', _objectClickListener);
}

function _detachObjectClickListener(): void {
  if (!_objectClickListener) return;
  window.removeEventListener('map-object-click', _objectClickListener);
  _objectClickListener = null;
}

/** Rebuild just the map sidebar (cheaper than a full re-render). */
function _refreshMapSidebar(): void {
  if (!_overlay || _activeTab !== 'map' || !_state) return;
  const old = document.getElementById('ts-map-sidebar');
  if (!old) return;
  const tier = getFacilityTier(_state, FacilityId.TRACKING_STATION);
  const fresh = _renderMapSidebar(tier);
  old.replaceWith(fresh);
}

function _ensureMapInitialized(): void {
  if (_mapInitialized) return;
  initMapRenderer();
  _mapInitialized = true;
}

function _startMapLoop(): void {
  if (_rafId !== null) return;
  const loop = (): void => {
    if (!_state) {
      _rafId = null;
      return;
    }
    const baseTime = _state.playTimeSeconds ?? 0;
    const previewTime = baseTime + _previewTimeOffset;
    // At solar-system zoom the picker body (Earth, Mars, ...) would only show
    // its own SOI, not the actual system.  Render from the Sun so the planets
    // appear.  Local-body zoom respects the picker selection as usual.
    const renderBodyId = _inspectionZoom === MapZoom.SOLAR_SYSTEM
      ? 'SUN'
      : _inspectionBodyId;
    renderInspectionMapFrame(
      _state,
      renderBodyId,
      previewTime,
      _inspectionZoom,
      { showDebris: isDebrisTrackingAvailable(_state) },
    );
    _updateFloatingTakeControl();
    _rafId = requestAnimationFrame(loop);
  };
  _rafId = requestAnimationFrame(loop);
}

/**
 * Position/refresh the floating Take Control button so it sits next to the
 * currently selected craft's map marker.  Hides the button when no
 * controllable craft is selected or when the selected craft isn't visible in
 * the current render (e.g. wrong focus body).
 */
function _updateFloatingTakeControl(): void {
  if (!_overlay || _activeTab !== 'map' || !_state) {
    if (_floatingTakeControlBtn) _floatingTakeControlBtn.style.display = 'none';
    return;
  }
  const marker = getSelectedObjectMarker();
  if (!marker) {
    if (_floatingTakeControlBtn) _floatingTakeControlBtn.style.display = 'none';
    return;
  }
  // Only show for controllable types.
  if (!CONTROLLABLE_TYPES.has(marker.type)) {
    if (_floatingTakeControlBtn) _floatingTakeControlBtn.style.display = 'none';
    return;
  }

  if (!_floatingTakeControlBtn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ts-map-take-control-btn';
    btn.textContent = 'Take Control';
    btn.setAttribute('data-no-map-pan', 'true');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = getMapTarget();
      if (cur) _startTakeControl(cur);
    });
    document.body.appendChild(btn);
    _floatingTakeControlBtn = btn;
  }

  const resumable = canResumeCraft(_state, marker.id);
  _floatingTakeControlBtn.disabled = !resumable;
  _floatingTakeControlBtn.title = resumable
    ? `Take control of ${marker.name}`
    : 'No rocket design linked to this craft';

  _floatingTakeControlBtn.style.display = 'block';
  // Position a short distance right+down from the marker so it doesn't occlude the dot.
  const offsetX = 12;
  const offsetY = 8;
  _floatingTakeControlBtn.style.left = `${marker.x + offsetX}px`;
  _floatingTakeControlBtn.style.top = `${marker.y + offsetY}px`;
}

function _stopMapLoop(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}

// ---------------------------------------------------------------------------
// Topbar (shared across tabs)
// ---------------------------------------------------------------------------

function _renderTopbar(tier: number, tierInfo: TierFeatureSet): HTMLDivElement {
  const header = document.createElement('div');
  header.id = 'ts-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'ts-back-btn';
  backBtn.textContent = '← Hub';
  _listeners?.add(backBtn, 'click', () => {
    const onBack = _onBack;
    destroyTrackingStationUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'ts-title';
  title.textContent = `Tracking Station — Tier ${tier} (${tierInfo.label})`;
  header.appendChild(title);

  const tabStrip = document.createElement('div');
  tabStrip.id = 'ts-tabs';
  tabStrip.appendChild(_tabButton('map', 'Map'));
  tabStrip.appendChild(_tabButton('details', 'Details'));
  header.appendChild(tabStrip);

  return header;
}

function _tabButton(tab: TabId, label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'ts-tab-btn';
  if (_activeTab === tab) btn.classList.add('active');
  btn.textContent = label;
  btn.type = 'button';
  _listeners?.add(btn, 'click', () => _setTab(tab));
  return btn;
}

// ---------------------------------------------------------------------------
// Map tab
// ---------------------------------------------------------------------------

function _renderMapTab(tier: number): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.id = 'ts-map-view';

  wrap.appendChild(_renderMapControls(tier));
  wrap.appendChild(_renderMapSidebar(tier));

  return wrap;
}

function _renderMapControls(tier: number): HTMLDivElement {
  const controls = document.createElement('div');
  controls.id = 'ts-map-controls';

  // Body picker (tier 2+ only).
  const allowedBodies = _getAllowedBodies();
  if (tier >= 2 && allowedBodies.length > 1) {
    const bodyWrap = document.createElement('label');
    bodyWrap.className = 'ts-control-group';
    const bodyLabel = document.createElement('span');
    bodyLabel.textContent = 'Body:';
    bodyWrap.appendChild(bodyLabel);

    const sel = document.createElement('select');
    sel.id = 'ts-body-picker';
    for (const bodyId of allowedBodies) {
      const opt = document.createElement('option');
      opt.value = bodyId;
      const def = CELESTIAL_BODIES[bodyId];
      opt.textContent = def ? def.name : bodyId;
      if (bodyId === _inspectionBodyId) opt.selected = true;
      sel.appendChild(opt);
    }
    _listeners?.add(sel, 'change', () => {
      _inspectionBodyId = sel.value;
      // Body switch: clear the current target (belongs to previous body) and
      // recentre so the new body shows at screen centre.
      setMapTarget(null);
      resetMapPan();
      _refreshMapSidebar();
    });
    bodyWrap.appendChild(sel);
    controls.appendChild(bodyWrap);
  }

  // Zoom cycle (tier-gated).
  const allowedZooms = getInspectionAllowedZooms(_state!);
  if (allowedZooms.length > 1) {
    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'ts-control-btn';
    zoomBtn.textContent = `Zoom: ${_zoomLabel(_inspectionZoom)}`;
    _listeners?.add(zoomBtn, 'click', () => {
      const idx = allowedZooms.indexOf(_inspectionZoom);
      _inspectionZoom = allowedZooms[(idx + 1) % allowedZooms.length];
      zoomBtn.textContent = `Zoom: ${_zoomLabel(_inspectionZoom)}`;
      // A zoom-level change jumps to a different view radius (and potentially
      // a different focus body for SOLAR_SYSTEM) — any existing pan offset is
      // meaningless under the new scale, so recentre.
      resetMapPan();
      // Selection is tied to a body's orbital objects; when the render body
      // changes (LOCAL_BODY↔SOLAR_SYSTEM) the previous target may not belong
      // to the new view, so clear it.
      setMapTarget(null);
      _refreshMapSidebar();
    });
    controls.appendChild(zoomBtn);
  }

  // Time-advance controls.
  const timeGroup = document.createElement('div');
  timeGroup.className = 'ts-time-controls';

  const timeLabel = document.createElement('span');
  timeLabel.className = 'ts-time-readout';
  timeLabel.textContent = `Preview: ${_fmtPreviewOffset(_previewTimeOffset)}`;
  timeGroup.appendChild(timeLabel);

  const mkStep = (labelText: string, delta: number): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ts-control-btn';
    b.textContent = labelText;
    _listeners?.add(b, 'click', () => {
      _previewTimeOffset = Math.max(0, _previewTimeOffset + delta);
      timeLabel.textContent = `Preview: ${_fmtPreviewOffset(_previewTimeOffset)}`;
    });
    return b;
  };

  timeGroup.appendChild(mkStep('−1d', -TIME_STEP_DAY));
  timeGroup.appendChild(mkStep('−1h', -TIME_STEP_HOUR));
  timeGroup.appendChild(mkStep('+1h', TIME_STEP_HOUR));
  timeGroup.appendChild(mkStep('+1d', TIME_STEP_DAY));

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'ts-control-btn';
  resetBtn.textContent = 'Reset';
  _listeners?.add(resetBtn, 'click', () => {
    _previewTimeOffset = 0;
    timeLabel.textContent = `Preview: ${_fmtPreviewOffset(_previewTimeOffset)}`;
  });
  timeGroup.appendChild(resetBtn);

  controls.appendChild(timeGroup);

  // Recenter button — resets the pan offset so the body returns to screen centre.
  const recenterBtn = document.createElement('button');
  recenterBtn.type = 'button';
  recenterBtn.className = 'ts-control-btn';
  recenterBtn.textContent = 'Recenter';
  _listeners?.add(recenterBtn, 'click', () => {
    resetMapPan();
  });
  controls.appendChild(recenterBtn);

  return controls;
}

function _renderMapSidebar(tier: number): HTMLDivElement {
  const sidebar = document.createElement('div');
  sidebar.id = 'ts-map-sidebar';

  sidebar.appendChild(_renderObjectOverview(tier));
  sidebar.appendChild(_renderObjectList(tier));

  return sidebar;
}

// ---------------------------------------------------------------------------
// Details tab
// ---------------------------------------------------------------------------

function _renderDetailsTab(tier: number, tierInfo: TierFeatureSet): HTMLDivElement {
  const content = document.createElement('div');
  content.id = 'ts-details-view';

  content.appendChild(_renderFeatures(tierInfo));

  if (tier >= 2) {
    content.appendChild(_renderWeatherForecast());
  } else {
    content.appendChild(_tierLockedSection(
      'Weather Predictions',
      'Upgrade to Tier 2 to unlock weather window predictions.',
    ));
  }

  if (tier >= 3) {
    content.appendChild(_renderTransferRoutes());
  } else {
    const msg = tier < 2
      ? 'Upgrade to Tier 3 to unlock transfer route planning.'
      : 'Upgrade to Tier 3 to unlock deep space communication and transfer route planning.';
    content.appendChild(_tierLockedSection('Transfer Route Planning', msg));
  }

  return content;
}

function _tierLockedSection(title: string, message: string): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  section.appendChild(h2);
  const msg = document.createElement('div');
  msg.className = 'ts-tier-locked';
  msg.textContent = message;
  section.appendChild(msg);
  return section;
}

// ---------------------------------------------------------------------------
// Shared section renderers (reused across Map side panel and Details tab)
// ---------------------------------------------------------------------------

/**
 * Render current-tier feature list.
 */
function _renderFeatures(tierInfo: TierFeatureSet): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Capabilities';
  section.appendChild(h2);

  const ul = document.createElement('ul');
  ul.className = 'ts-features';
  for (const feat of tierInfo.features) {
    const li = document.createElement('li');
    li.textContent = feat;
    ul.appendChild(li);
  }
  section.appendChild(ul);

  return section;
}

/**
 * Render overview cards (counts of objects by type).
 */
function _renderObjectOverview(tier: number): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Orbital Overview';
  section.appendChild(h2);

  const objects = _state!.orbitalObjects || [];

  const satellites = objects.filter(o => o.type === OrbitalObjectType.SATELLITE).length;
  const stations = objects.filter(o => o.type === OrbitalObjectType.STATION).length;
  const debris = objects.filter(o => o.type === OrbitalObjectType.DEBRIS).length;
  const total = objects.length;

  const cards = document.createElement('div');
  cards.className = 'ts-overview';

  cards.appendChild(_makeCard('Total Objects', String(total)));
  cards.appendChild(_makeCard('Satellites', String(satellites)));
  cards.appendChild(_makeCard('Stations', String(stations)));

  if (tier >= 2) {
    const debrisCard = _makeCard('Debris', String(debris));
    debrisCard.querySelector('.value')!.classList.add('debris-count');
    cards.appendChild(debrisCard);
  } else {
    cards.appendChild(_makeCard('Debris', '???'));
  }

  section.appendChild(cards);

  return section;
}

/**
 * Render the unified tracked-objects list (orbital objects + field craft).
 *
 * Selection reveals an inline action panel under the row with context details
 * (crew/supplies for crewed vessels) and a Take Control button for
 * controllable types.
 */
function _renderObjectList(tier: number): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Tracked Objects';
  section.appendChild(h2);

  const items = _state ? _buildTrackedItems(_state) : [];

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ts-tier-locked';
    empty.textContent = 'No objects currently tracked.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'ts-obj-list';

  const selectedId = getMapTarget();
  const interactive = _activeTab === 'map';

  for (const item of items) {
    if (item.type === OrbitalObjectType.DEBRIS && tier < 2) continue;

    const wrapper = document.createElement('div');
    wrapper.className = 'ts-obj-wrapper';

    const row = document.createElement(interactive ? 'button' : 'div') as HTMLElement;
    row.className = 'ts-obj-row';
    if (interactive) row.classList.add('clickable');
    if (item.type === OrbitalObjectType.DEBRIS) row.classList.add('debris');
    if (item.id === selectedId) row.classList.add('selected');

    const name = document.createElement('span');
    name.className = 'obj-name';
    name.textContent = item.name;
    row.appendChild(name);

    const type = document.createElement('span');
    type.className = 'obj-type';
    type.textContent = _trackedItemLabel(item);
    row.appendChild(type);

    const body = document.createElement('span');
    body.className = 'obj-body';
    body.textContent = item.bodyId;
    row.appendChild(body);

    if (interactive) {
      (row as HTMLButtonElement).type = 'button';
      _listeners?.add(row, 'click', () => {
        const currentlySelected = getMapTarget();
        const next = currentlySelected === item.id ? null : item.id;
        setMapTarget(next);
        _refreshMapSidebar();
      });
    }

    wrapper.appendChild(row);

    // Expanded action panel — only visible when this row is selected AND it
    // has content to show (crew/supply info or a Take Control action).
    if (interactive && item.id === selectedId) {
      const detail = _renderSelectionDetail(item);
      if (detail.childElementCount > 0) wrapper.appendChild(detail);
    }

    list.appendChild(wrapper);
  }

  section.appendChild(list);

  return section;
}

/**
 * Inline detail panel shown under a selected tracked-object row.
 * Carries context (crew/supplies for crewed vessels) and a Take Control
 * action — enabled when the craft can be resumed, disabled with an
 * explanatory tooltip otherwise.
 */
function _renderSelectionDetail(item: TrackedItem): HTMLDivElement {
  const detail = document.createElement('div');
  detail.className = 'ts-obj-detail';

  // Crewed-vessel details inline (formerly its own Crewed Vessels section).
  if (item.fieldCraft) {
    const fc = item.fieldCraft;
    const info = document.createElement('div');
    info.className = 'ts-obj-detail-info';

    const statusLabel = fc.status === 'IN_ORBIT' ? 'In orbit' : 'Landed';
    const locationText = `${statusLabel} — ${fc.bodyId}${fc.orbitBandId ? ` (${fc.orbitBandId})` : ''}`;
    const locEl = document.createElement('div');
    locEl.textContent = locationText;
    info.appendChild(locEl);

    const crewCount = fc.crewIds ? fc.crewIds.length : 0;
    const crewEl = document.createElement('div');
    if (crewCount > 0 && _state?.crew) {
      const names = fc.crewIds.map((id) => _state!.crew.find((c) => c.id === id)?.name ?? '???').join(', ');
      crewEl.textContent = `Crew: ${names}`;
    } else {
      crewEl.textContent = 'Uncrewed probe';
    }
    info.appendChild(crewEl);

    // Life support only applies to crewed vessels — hide the supply row for probes.
    if (crewCount > 0) {
      const supplyEl = document.createElement('div');
      if (fc.hasExtendedLifeSupport) {
        supplyEl.textContent = 'Supplies: Unlimited';
        supplyEl.classList.add('ts-supply-infinite');
      } else {
        supplyEl.textContent = `Supplies: ${fc.suppliesRemaining}/${DEFAULT_LIFE_SUPPORT_PERIODS}`;
        if (fc.suppliesRemaining <= 0) {
          supplyEl.classList.add('ts-supply-critical');
        } else if (fc.suppliesRemaining <= LIFE_SUPPORT_WARNING_THRESHOLD) {
          supplyEl.classList.add('ts-supply-warning');
        }
      }
      info.appendChild(supplyEl);
    }

    detail.appendChild(info);
  }

  // Action buttons — only when this item is of a controllable type.
  if (CONTROLLABLE_TYPES.has(item.type)) {
    const actions = document.createElement('div');
    actions.className = 'ts-obj-detail-actions';

    const resumable = _state ? canResumeCraft(_state, item.id) : false;
    const takeBtn = document.createElement('button');
    takeBtn.type = 'button';
    takeBtn.className = 'ts-take-control-btn';
    takeBtn.textContent = 'Take Control';
    takeBtn.setAttribute('data-no-map-pan', 'true');
    if (!resumable) {
      takeBtn.disabled = true;
      takeBtn.title = 'No rocket design linked to this craft — cannot rebuild the assembly';
    } else {
      _listeners?.add(takeBtn, 'click', (e) => {
        e.stopPropagation();
        _startTakeControl(item.id);
      });
    }
    actions.appendChild(takeBtn);

    // Recover button — only for FieldCraft (the persistence concept this operates on).
    // Enabled when an online hub of the appropriate kind is at the craft's body.
    if (item.fieldCraft && _state) {
      const eligibility = canRecoverFieldCraft(_state, item.fieldCraft);
      const recoverBtn = document.createElement('button');
      recoverBtn.type = 'button';
      recoverBtn.className = 'ts-recover-btn';
      recoverBtn.textContent = 'Recover';
      recoverBtn.setAttribute('data-no-map-pan', 'true');
      if (!eligibility.allowed) {
        recoverBtn.disabled = true;
        recoverBtn.title = item.fieldCraft.status === 'LANDED'
          ? `No online surface hub on ${item.fieldCraft.bodyId} to dispatch a recovery team`
          : `No online orbital hub around ${item.fieldCraft.bodyId} to intercept the craft`;
      } else {
        _listeners?.add(recoverBtn, 'click', (e) => {
          e.stopPropagation();
          _handleRecoverCraft(item.id);
        });
      }
      actions.appendChild(recoverBtn);
    }

    detail.appendChild(actions);
  }

  return detail;
}

/** Recover the field craft, then refresh the sidebar. */
function _handleRecoverCraft(craftId: string): void {
  if (!_state) return;
  try {
    recoverFieldCraft(_state, craftId);
    setMapTarget(null);
    _refreshMapSidebar();
  } catch (err) {
    if (err instanceof RecoveryUnavailableError) {
      // Eligibility was checked before enabling the button; this path should
      // only trip if state changed between render and click. Fail silently.
      return;
    }
    throw err;
  }
}

/**
 * Render weather forecast section (Tier 2+).
 */
function _renderWeatherForecast(): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Weather Window Predictions';
  section.appendChild(h2);

  const forecast = getWeatherForecast(_state!, 'EARTH', 5);
  if (forecast.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'ts-tier-locked';
    msg.textContent = 'No forecast data available. Deploy weather satellites for predictions.';
    section.appendChild(msg);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'ts-forecast-grid';

  forecast.forEach((fc: { extreme?: boolean; description: string; windSpeed: number }, i: number) => {
    const card = document.createElement('div');
    card.className = 'ts-forecast-card';

    const dayLabel = document.createElement('div');
    dayLabel.className = 'day-label';
    dayLabel.textContent = `Day +${i + 1}`;
    card.appendChild(dayLabel);

    const dayDesc = document.createElement('div');
    dayDesc.className = 'day-desc';
    if (fc.extreme) dayDesc.classList.add('extreme');
    dayDesc.textContent = `${fc.description} — Wind: ${fc.windSpeed.toFixed(0)} m/s`;
    card.appendChild(dayDesc);

    grid.appendChild(card);
  });

  section.appendChild(grid);

  return section;
}

/**
 * Render transfer route planning section (Tier 3).
 */
function _renderTransferRoutes(): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Transfer Route Planning';
  section.appendChild(h2);

  let targets: Array<{ bodyId: string; name: string; departureDV: number }>;
  try {
    targets = getTransferTargets('EARTH', 200_000);
  } catch {
    targets = [];
  }

  if (!targets || targets.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'ts-tier-locked';
    msg.textContent = 'No transfer routes available from current position.';
    section.appendChild(msg);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'ts-transfer-grid';

  for (const t of targets) {
    const card = document.createElement('div');
    card.className = 'ts-transfer-card';

    const name = document.createElement('div');
    name.className = 'body-name';
    name.textContent = t.name || t.bodyId;
    card.appendChild(name);

    const info = document.createElement('div');
    info.className = 'route-info';
    const dvStr = t.departureDV ? `${(t.departureDV / 1000).toFixed(1)} km/s` : 'N/A';
    info.textContent = `Departure dv: ${dvStr}`;
    card.appendChild(info);

    grid.appendChild(card);
  }

  section.appendChild(grid);

  return section;
}

/**
 * Resume control of the given field craft: rebuild the assembly, remove the
 * craft from the field, destroy the Tracking Station overlay, and start the
 * flight scene in orbit at the craft's last known state.
 */
function _startTakeControl(craftId: string): void {
  if (!_state) return;
  const state = _state;

  let prep;
  try {
    prep = prepareCraftResume(state, craftId);
  } catch (err) {
    const msg = err instanceof ResumeUnavailableError
      ? err.message
      : 'Unable to take control of this craft.';
    window.alert(msg);
    return;
  }

  // Remove the craft from its source list — it's about to become the active flight.
  if (prep.source === 'fieldCraft') {
    state.fieldCraft = state.fieldCraft.filter((c) => c.id !== prep.sourceId);
  } else {
    state.orbitalObjects = state.orbitalObjects.filter((o) => o.id !== prep.sourceId);
  }
  state.currentFlight = prep.flightState;

  // Capture what we need before tearing down the TS UI.
  const container = _overlay?.parentElement ?? document.body;

  destroyTrackingStationUI();

  void startFlightScene(
    container as HTMLElement,
    state,
    prep.assembly,
    prep.stagingConfig,
    prep.flightState,
    (_finalState, returnResults) => {
      // returnToHubFromFlight: mounts the hub PIXI scene, re-inits hub UI,
      // refreshes the top bar, and shows the flight-results overlay.
      returnToHubFromFlight(container as HTMLElement, state, returnResults);
    },
    prep.initialState,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _makeCard(label: string, value: string): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'ts-overview-card';

  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueEl = document.createElement('div');
  valueEl.className = 'value';
  valueEl.textContent = value;
  card.appendChild(valueEl);

  return card;
}

const ZOOM_LABELS: Record<string, string> = {
  [MapZoom.LOCAL_BODY]:   'Local Body',
  [MapZoom.SOLAR_SYSTEM]: 'Solar System',
};

function _zoomLabel(zoom: string): string {
  return ZOOM_LABELS[zoom] ?? zoom;
}

/**
 * Bodies selectable in the body picker — every catalog body at tier 2+.
 */
function _getAllowedBodies(): string[] {
  return ALL_BODY_IDS.filter((id) => id in CELESTIAL_BODIES);
}

function _fmtPreviewOffset(offsetSeconds: number): string {
  if (offsetSeconds === 0) return 'now';
  const abs = Math.abs(offsetSeconds);
  const days = Math.floor(abs / TIME_STEP_DAY);
  const hours = Math.floor((abs % TIME_STEP_DAY) / TIME_STEP_HOUR);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (parts.length === 0) parts.push(`${Math.floor(abs)}s`);
  return (offsetSeconds > 0 ? '+' : '−') + parts.join(' ');
}
