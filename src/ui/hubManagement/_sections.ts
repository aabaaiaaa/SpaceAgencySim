/**
 * _sections.ts — Hub management panel content sections.
 *
 * Info grid, facilities, population, and economy sections.
 *
 * @module ui/hubManagement/_sections
 */

import type { HubManagementInfo } from '../../core/hubTypes.ts';
import { formatMoney } from './_panel.ts';

// ---------------------------------------------------------------------------
// Info grid — body, type, status, established
// ---------------------------------------------------------------------------

export function buildInfoGrid(info: HubManagementInfo): HTMLDivElement {
  const grid = document.createElement('div');
  grid.className = 'hub-mgmt-info-grid';

  _addGridRow(grid, 'Body', info.bodyName);
  _addGridRow(grid, 'Type', info.type === 'surface' ? 'Surface' : 'Orbital');

  // Status badge
  const statusLabel = document.createElement('span');
  statusLabel.className = 'hub-mgmt-info-label';
  statusLabel.textContent = 'Status';

  const statusBadge = document.createElement('span');
  const statusInfo = _getStatusInfo(info);
  statusBadge.className = `hub-mgmt-status ${statusInfo.className}`;
  statusBadge.textContent = statusInfo.label;

  grid.appendChild(statusLabel);
  grid.appendChild(statusBadge);

  _addGridRow(grid, 'Established', `Period ${info.established}`);

  return grid;
}

function _getStatusInfo(info: HubManagementInfo): { label: string; className: string } {
  if (info.online) {
    return { label: 'Online', className: 'hub-mgmt-status--online' };
  }
  // Check for in-progress construction (facilities under construction)
  const hasBuilding = info.facilities.some(f => f.underConstruction);
  if (hasBuilding) {
    return { label: 'Building', className: 'hub-mgmt-status--building' };
  }
  return { label: 'Offline', className: 'hub-mgmt-status--offline' };
}

function _addGridRow(grid: HTMLDivElement, label: string, value: string): void {
  const labelEl = document.createElement('span');
  labelEl.className = 'hub-mgmt-info-label';
  labelEl.textContent = label;

  const valueEl = document.createElement('span');
  valueEl.className = 'hub-mgmt-info-value';
  valueEl.textContent = value;

  grid.appendChild(labelEl);
  grid.appendChild(valueEl);
}

// ---------------------------------------------------------------------------
// Facilities section
// ---------------------------------------------------------------------------

export function buildFacilitiesSection(info: HubManagementInfo): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'hub-mgmt-section';

  const title = document.createElement('div');
  title.className = 'hub-mgmt-section-title';
  title.textContent = 'Facilities';
  section.appendChild(title);

  if (info.facilities.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hub-mgmt-empty';
    empty.textContent = 'No facilities built yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'hub-mgmt-facility-list';

  for (const facility of info.facilities) {
    const li = document.createElement('li');
    li.className = 'hub-mgmt-facility-item';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = facility.name;

    const tierBadge = document.createElement('span');
    tierBadge.className = 'hub-mgmt-tier-badge';
    tierBadge.textContent = `T${facility.tier}`;

    li.appendChild(nameSpan);
    li.appendChild(tierBadge);

    if (facility.underConstruction) {
      const tag = document.createElement('span');
      tag.className = 'hub-mgmt-building-tag';
      tag.textContent = '(Building)';
      li.appendChild(tag);
    }

    list.appendChild(li);
  }

  section.appendChild(list);
  return section;
}

// ---------------------------------------------------------------------------
// Population section
// ---------------------------------------------------------------------------

export function buildPopulationSection(info: HubManagementInfo): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'hub-mgmt-section';

  const title = document.createElement('div');
  title.className = 'hub-mgmt-section-title';
  title.textContent = 'Population';
  section.appendChild(title);

  const crewLine = document.createElement('div');
  crewLine.className = 'hub-mgmt-population';
  crewLine.textContent = `Crew: ${info.crewCount}`;
  section.appendChild(crewLine);

  if (info.crewCount > 0 && info.crewCount < 10) {
    const namesLine = document.createElement('div');
    namesLine.className = 'hub-mgmt-crew-names';
    namesLine.textContent = info.crewNames.join(', ');
    section.appendChild(namesLine);
  }

  const touristLine = document.createElement('div');
  touristLine.className = 'hub-mgmt-population';
  touristLine.style.marginTop = '4px';
  touristLine.textContent = `Tourists: ${info.touristCount}`;
  section.appendChild(touristLine);

  return section;
}

// ---------------------------------------------------------------------------
// Economy section
// ---------------------------------------------------------------------------

export function buildEconomySection(info: HubManagementInfo): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'hub-mgmt-section';

  const title = document.createElement('div');
  title.className = 'hub-mgmt-section-title';
  title.textContent = 'Economy';
  section.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'hub-mgmt-economy-grid';

  const maintLabel = document.createElement('span');
  maintLabel.className = 'hub-mgmt-economy-label';
  maintLabel.textContent = 'Maintenance / period';

  const maintValue = document.createElement('span');
  maintValue.className = 'hub-mgmt-economy-value';
  maintValue.textContent = formatMoney(info.maintenanceCostPerPeriod);

  const investLabel = document.createElement('span');
  investLabel.className = 'hub-mgmt-economy-label';
  investLabel.textContent = 'Total investment';

  const investValue = document.createElement('span');
  investValue.className = 'hub-mgmt-economy-value';
  investValue.textContent = formatMoney(info.totalInvestment);

  grid.appendChild(maintLabel);
  grid.appendChild(maintValue);
  grid.appendChild(investLabel);
  grid.appendChild(investValue);
  section.appendChild(grid);

  return section;
}
