/**
 * _routeBuilder.ts -- Route builder wizard panel for the Logistics Center.
 *
 * Handles the route creation workflow: resource type selection, route
 * naming, leg chain display, validation, and final route creation.
 *
 * @module ui/logistics/_routeBuilder
 */

import type { ResourceType } from '../../core/constants.ts';
import { createRoute } from '../../core/routes.ts';
import { getHub } from '../../core/hubs.ts';
import { getBodyDef } from '../../data/bodies.ts';
import {
  getLogisticsState,
  resetBuilderState,
  triggerRender,
  formatResourceType,
} from './_state.ts';
import { formatLocation } from './_routeMap.ts';
import { getLogisticsListenerTracker } from './_listenerTracker.ts';

/**
 * Register a DOM listener through the logistics tracker.
 */
function _addTracked(
  target: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const tracker = getLogisticsListenerTracker();
  if (tracker) tracker.add(target, event, handler, options);
}

// ---------------------------------------------------------------------------
// Route Builder Panel
// ---------------------------------------------------------------------------

export function renderBuilderPanel(): HTMLDivElement {
  const ls = getLogisticsState();
  const panel = document.createElement('div');
  panel.className = 'logistics-builder-panel';

  const heading = document.createElement('h3');
  heading.className = 'logistics-builder-heading';
  heading.textContent = 'Create New Route';
  panel.appendChild(heading);

  // --- Resource type dropdown ---
  const resourceGroup = document.createElement('div');
  resourceGroup.className = 'logistics-builder-field';

  const resourceLabel = document.createElement('label');
  resourceLabel.className = 'logistics-builder-label';
  resourceLabel.textContent = 'Resource Type';
  resourceGroup.appendChild(resourceLabel);

  const resourceSelect = document.createElement('select');
  resourceSelect.className = 'logistics-builder-select';

  // Determine available resource types: resources that exist on bodies
  // touched by at least one proven leg
  const availableResourceTypes = _getAvailableResourceTypes();

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '-- Select Resource --';
  resourceSelect.appendChild(defaultOpt);

  for (const rt of availableResourceTypes) {
    const opt = document.createElement('option');
    opt.value = rt;
    opt.textContent = formatResourceType(rt);
    if (ls.builderResourceType === rt) {
      opt.selected = true;
    }
    resourceSelect.appendChild(opt);
  }

  if (!ls.builderResourceType) {
    defaultOpt.selected = true;
  }

  _addTracked(resourceSelect, 'change', () => {
    getLogisticsState().builderResourceType = resourceSelect.value || null;
  });

  resourceGroup.appendChild(resourceSelect);
  panel.appendChild(resourceGroup);

  // --- Route name input ---
  const nameGroup = document.createElement('div');
  nameGroup.className = 'logistics-builder-field';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'logistics-builder-label';
  nameLabel.textContent = 'Route Name';
  nameGroup.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'logistics-builder-input';
  nameInput.placeholder = 'e.g. Lunar Water Run';
  nameInput.value = ls.builderRouteName;
  _addTracked(nameInput, 'input', () => {
    getLogisticsState().builderRouteName = nameInput.value;
  });

  nameGroup.appendChild(nameInput);
  panel.appendChild(nameGroup);

  // --- Legs chain display ---
  const legsGroup = document.createElement('div');
  legsGroup.className = 'logistics-builder-field';

  const legsLabel = document.createElement('label');
  legsLabel.className = 'logistics-builder-label';
  legsLabel.textContent = 'Route Legs';
  legsGroup.appendChild(legsLabel);

  const legsDisplay = document.createElement('div');
  legsDisplay.className = 'logistics-builder-legs';

  if (ls.builderLegs.length === 0) {
    // Show selected origin hub/body info above "No legs added yet"
    if (ls.builderCurrentBodyId && ls.builderOriginHubId && ls.state) {
      const originHub = getHub(ls.state, ls.builderOriginHubId);
      if (originHub) {
        const originInfo = document.createElement('div');
        originInfo.className = 'logistics-builder-origin-info';
        originInfo.textContent = `Origin: ${originHub.name} (${ls.builderCurrentBodyId})`;
        originInfo.style.color = '#FFD700';
        originInfo.style.fontSize = '11px';
        originInfo.style.marginBottom = '4px';
        legsDisplay.appendChild(originInfo);
      }
    } else if (ls.builderCurrentBodyId) {
      const bodyDef = getBodyDef(ls.builderCurrentBodyId);
      const bodyName = bodyDef?.name ?? ls.builderCurrentBodyId;
      const originInfo = document.createElement('div');
      originInfo.className = 'logistics-builder-origin-info';
      originInfo.textContent = `Origin: ${bodyName}`;
      originInfo.style.color = '#FFD700';
      originInfo.style.fontSize = '11px';
      originInfo.style.marginBottom = '4px';
      legsDisplay.appendChild(originInfo);
    }
    const emptyMsg = document.createElement('div');
    emptyMsg.textContent = 'No legs added yet';
    emptyMsg.classList.add('logistics-builder-legs-empty');
    legsDisplay.appendChild(emptyMsg);
  } else {
    // Show origin hub label on the first leg if an origin hub is selected
    if (ls.builderOriginHubId && ls.state) {
      const originHub = getHub(ls.state, ls.builderOriginHubId);
      if (originHub) {
        const originLabel = document.createElement('div');
        originLabel.className = 'logistics-builder-origin-info';
        originLabel.textContent = `From: ${originHub.name}`;
        originLabel.style.color = '#FFD700';
        originLabel.style.fontSize = '11px';
        originLabel.style.marginBottom = '4px';
        legsDisplay.appendChild(originLabel);
      }
    }

    // Show summary of chained legs
    for (const legId of ls.builderLegs) {
      const leg = ls.state?.provenLegs.find((pl) => pl.id === legId);
      if (leg) {
        const legEl = document.createElement('div');
        legEl.className = 'logistics-builder-leg-item';
        legEl.textContent = `${formatLocation(leg.origin, ls.state?.hubs)} \u2192 ${formatLocation(leg.destination, ls.state?.hubs)}`;
        legsDisplay.appendChild(legEl);
      }
    }
  }

  legsGroup.appendChild(legsDisplay);
  panel.appendChild(legsGroup);

  // --- Action buttons ---
  const actions = document.createElement('div');
  actions.className = 'logistics-builder-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'logistics-builder-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  _addTracked(cancelBtn, 'click', () => {
    resetBuilderState();
    triggerRender();
  });
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'logistics-builder-confirm-btn';
  confirmBtn.textContent = 'Create Route';
  _addTracked(confirmBtn, 'click', () => {
    const currentLs = getLogisticsState();
    // Validate inputs
    const errors: string[] = [];
    if (currentLs.builderLegs.length === 0) {
      errors.push('Add at least one leg by clicking a body then an outbound route on the map.');
    }
    if (!currentLs.builderResourceType) {
      errors.push('Select a resource type.');
    }
    if (!currentLs.builderRouteName.trim()) {
      errors.push('Enter a route name.');
    }

    // Show errors if validation fails
    const errorEl = panel.querySelector('.logistics-builder-error') as HTMLDivElement | null;
    if (errors.length > 0) {
      if (errorEl) {
        errorEl.textContent = errors.join(' ');
      }
      return;
    }

    // Attempt to create the route
    try {
      createRoute(currentLs.state!, {
        name: currentLs.builderRouteName.trim(),
        resourceType: currentLs.builderResourceType as ResourceType,
        provenLegIds: currentLs.builderLegs,
      });
      resetBuilderState();
      triggerRender();
    } catch (err: unknown) {
      if (errorEl) {
        errorEl.textContent = err instanceof Error ? err.message : String(err);
      }
    }
  });
  actions.appendChild(confirmBtn);

  panel.appendChild(actions);

  // --- Error display area ---
  const errorDiv = document.createElement('div');
  errorDiv.className = 'logistics-builder-error';
  panel.appendChild(errorDiv);

  return panel;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect resource types available for route building.
 * A resource is available if at least one proven leg touches a body
 * that produces it (via its resource profile).
 *
 * When a source body is selected (`builderCurrentBodyId`), additionally
 * includes resources with orbital buffer stock on that body, and filters
 * the full list to the intersection of profile resources and buffer resources.
 */
function _getAvailableResourceTypes(): string[] {
  const ls = getLogisticsState();
  if (!ls.state) return [];

  // Gather all body IDs from proven leg origins and destinations
  const bodyIds = new Set<string>();
  for (const leg of ls.state.provenLegs) {
    bodyIds.add(leg.origin.bodyId);
    bodyIds.add(leg.destination.bodyId);
  }

  // Collect resource types from those bodies' resource profiles
  const resourceTypes = new Set<string>();
  for (const bodyId of bodyIds) {
    const bodyDef = getBodyDef(bodyId);
    if (bodyDef?.resourceProfile) {
      for (const entry of bodyDef.resourceProfile) {
        resourceTypes.add(entry.resourceType);
      }
    }
  }

  // If a source body is selected, also include resources with orbital buffer
  // stock on that body and filter to the combined set
  if (ls.builderCurrentBodyId && ls.state) {
    const sites = ls.state.miningSites.filter(
      s => s.bodyId === ls.builderCurrentBodyId,
    );
    const bufferResources = new Set<string>();
    for (const site of sites) {
      for (const [resourceType, amount] of Object.entries(site.orbitalBuffer)) {
        if ((amount ?? 0) > 0) bufferResources.add(resourceType);
      }
    }

    // Combine: keep profile resources from the source body plus buffer resources
    const sourceBodyDef = getBodyDef(ls.builderCurrentBodyId);
    const sourceProfileResources = new Set<string>();
    if (sourceBodyDef?.resourceProfile) {
      for (const entry of sourceBodyDef.resourceProfile) {
        sourceProfileResources.add(entry.resourceType);
      }
    }

    // Filter to resources relevant to the source body:
    // either in the body's resource profile or currently in orbital buffer
    const relevantResources = new Set<string>();
    for (const rt of resourceTypes) {
      if (sourceProfileResources.has(rt) || bufferResources.has(rt)) {
        relevantResources.add(rt);
      }
    }
    // Also add any buffer resources not yet in the profile set
    for (const rt of bufferResources) {
      relevantResources.add(rt);
    }

    return [...relevantResources].sort();
  }

  return [...resourceTypes].sort();
}
