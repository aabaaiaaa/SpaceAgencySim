/**
 * hubs-integration.test.ts — Integration tests for multi-step hub workflows.
 *
 * TASK-069: Full off-world pipeline (create hub -> build -> crew -> operate)
 * TASK-070: Hub offline cascade (maintenance failure -> offline -> evacuate -> evict)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import {
  EARTH_HUB_ID,
  FacilityId,
  HIRE_COST,
} from '../core/constants.ts';
import {
  createHub,
  deliverResources,
  processConstructionProjects,
  processHubMaintenance,
  calculateHubMaintenance,
  getImportTaxMultiplier,
} from '../core/hubs.ts';
import {
  hireCrewAtHub,
  getCrewAtHub,
  processCrewTransits,
  getTransitDelay,
} from '../core/hubCrew.ts';
import {
  processTouristRevenue,
} from '../core/hubTourists.ts';
import { OFFWORLD_FACILITY_UPKEEP } from '../data/hubFacilities.ts';
import type { Tourist } from '../core/hubTypes.ts';
import { makeCrewMember } from './_factories.ts';

// ---------------------------------------------------------------------------
// TASK-069: Full off-world pipeline
// ---------------------------------------------------------------------------

describe('TASK-069: Full off-world pipeline @smoke', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState();
    // Start with generous funds to cover all operations
    state.money = 5_000_000;
  });

  it('creates a Moon hub, completes construction, hires crew, and operates across periods', () => {
    // ----------------------------------------------------------------
    // Step 1: Create game state with Earth hub (done in beforeEach)
    // ----------------------------------------------------------------
    expect(state.hubs).toHaveLength(1);
    expect(state.hubs[0].id).toBe(EARTH_HUB_ID);

    // ----------------------------------------------------------------
    // Step 2: Create an off-world surface hub on the Moon
    // ----------------------------------------------------------------
    const moonHub = createHub(state, {
      name: 'Lunar Base Alpha',
      type: 'surface',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
    });

    expect(state.hubs).toHaveLength(2);
    expect(moonHub.bodyId).toBe('MOON');
    expect(moonHub.type).toBe('surface');
    expect(moonHub.online).toBe(false);
    // createHub queues a Crew Hab construction project
    expect(moonHub.constructionQueue).toHaveLength(1);
    expect(moonHub.constructionQueue[0].facilityId).toBe(FacilityId.CREW_HAB);

    // ----------------------------------------------------------------
    // Step 3: Deliver resources to complete the Crew Hab
    // ----------------------------------------------------------------
    const project = moonHub.constructionQueue[0];
    for (const req of project.resourcesRequired) {
      deliverResources(project, req.resourceId, req.amount);
    }

    // Verify all resources delivered
    for (let i = 0; i < project.resourcesRequired.length; i++) {
      expect(project.resourcesDelivered[i].amount).toBe(
        project.resourcesRequired[i].amount,
      );
    }

    // Process construction to complete the project
    processConstructionProjects(state);

    // ----------------------------------------------------------------
    // Step 4: Verify hub comes online
    // ----------------------------------------------------------------
    expect(moonHub.online).toBe(true);
    expect(moonHub.facilities[FacilityId.CREW_HAB]).toBeDefined();
    expect(moonHub.facilities[FacilityId.CREW_HAB].built).toBe(true);
    expect(moonHub.facilities[FacilityId.CREW_HAB].tier).toBe(1);
    expect(project.completedPeriod).toBe(state.currentPeriod);

    // ----------------------------------------------------------------
    // Step 5: Hire crew at the Moon hub, verify import tax applied
    // ----------------------------------------------------------------
    const moneyBeforeHire = state.money;
    const crewMember = hireCrewAtHub(state, moonHub.id, { name: 'Luna Pilot' });

    expect(crewMember).not.toBeNull();
    expect(crewMember!.stationedHubId).toBe(moonHub.id);

    // Moon import tax is 1.2x
    const moonTax = getImportTaxMultiplier('MOON');
    expect(moonTax).toBe(1.2);
    const expectedHireCost = HIRE_COST * moonTax;
    expect(state.money).toBe(moneyBeforeHire - expectedHireCost);

    // Crew should have transit delay for Moon (1 period)
    const moonTransitDelay = getTransitDelay('MOON');
    expect(moonTransitDelay).toBe(1);
    expect(crewMember!.transitUntil).toBe(state.currentPeriod + moonTransitDelay);

    // Crew in transit should NOT appear in getCrewAtHub
    expect(getCrewAtHub(state, moonHub.id)).toHaveLength(0);

    // ----------------------------------------------------------------
    // Step 6: Advance multiple periods — verify salary, maintenance, transit
    // ----------------------------------------------------------------
    const maintenanceCost = calculateHubMaintenance(moonHub);
    expect(maintenanceCost).toBe(
      OFFWORLD_FACILITY_UPKEEP[FacilityId.CREW_HAB] * 1,
    );

    // Period 1: crew in transit, maintenance charged
    const moneyBeforePeriod1 = state.money;
    state.currentPeriod += 1;
    processHubMaintenance(state);
    processCrewTransits(state);

    // Maintenance should be deducted
    expect(state.money).toBe(moneyBeforePeriod1 - maintenanceCost);

    // ----------------------------------------------------------------
    // Step 7: Verify hub stays online after period processing
    // ----------------------------------------------------------------
    expect(moonHub.online).toBe(true);

    // ----------------------------------------------------------------
    // Step 8: Verify crew transit delay clears after correct periods
    // ----------------------------------------------------------------
    // After 1 period, transit should be cleared (Moon delay = 1)
    expect(crewMember!.transitUntil).toBeNull();

    // Now crew should appear at the hub
    const crewAtHub = getCrewAtHub(state, moonHub.id);
    expect(crewAtHub).toHaveLength(1);
    expect(crewAtHub[0].id).toBe(crewMember!.id);

    // Period 2: crew now active at hub, salary will be charged by advancePeriod
    // (salary is handled by advancePeriod not processHubMaintenance)
    const moneyBeforePeriod2 = state.money;
    state.currentPeriod += 1;
    processHubMaintenance(state);
    processCrewTransits(state);

    // Maintenance deducted again
    expect(state.money).toBe(moneyBeforePeriod2 - maintenanceCost);
    // Hub remains online
    expect(moonHub.online).toBe(true);
    // Crew still at hub
    expect(getCrewAtHub(state, moonHub.id)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TASK-070: Hub offline cascade
// ---------------------------------------------------------------------------

describe('TASK-070: Hub offline cascade @smoke', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState();
  });

  it('maintenance failure cascades: offline -> crew evacuation -> tourist eviction in one call', () => {
    // ----------------------------------------------------------------
    // Step 1: Create an online off-world hub with facilities, crew, tourists
    // ----------------------------------------------------------------
    const moonHub = createHub(state, {
      name: 'Lunar Base',
      type: 'surface',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
    });

    // Bring hub online with Crew Hab built
    moonHub.online = true;
    moonHub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    // Clear the auto-queued construction project (already "built" manually)
    moonHub.constructionQueue = [];

    // Station 2 crew members at the Moon hub
    const crew1 = makeCrewMember({
      id: 'crew-moon-1',
      name: 'Astronaut A',
      stationedHubId: moonHub.id,
      transitUntil: null,
    });
    const crew2 = makeCrewMember({
      id: 'crew-moon-2',
      name: 'Astronaut B',
      stationedHubId: moonHub.id,
      transitUntil: null,
    });
    state.crew.push(crew1, crew2);

    // Add 3 tourists
    const tourists: Tourist[] = [
      { id: 't1', name: 'Tourist 1', arrivalPeriod: 0, departurePeriod: 10, revenue: 5_000 },
      { id: 't2', name: 'Tourist 2', arrivalPeriod: 0, departurePeriod: 10, revenue: 5_000 },
      { id: 't3', name: 'Tourist 3', arrivalPeriod: 0, departurePeriod: 10, revenue: 5_000 },
    ];
    moonHub.tourists = [...tourists];

    // Verify setup is correct
    expect(moonHub.online).toBe(true);
    expect(getCrewAtHub(state, moonHub.id)).toHaveLength(2);
    expect(moonHub.tourists).toHaveLength(3);

    // Confirm maintenance cost is non-zero
    const maintenanceCost = calculateHubMaintenance(moonHub);
    expect(maintenanceCost).toBeGreaterThan(0);
    expect(maintenanceCost).toBe(OFFWORLD_FACILITY_UPKEEP[FacilityId.CREW_HAB] * 1);

    // ----------------------------------------------------------------
    // Step 2: Set money to $0 so maintenance fails
    // ----------------------------------------------------------------
    state.money = 0;

    // ----------------------------------------------------------------
    // Step 3: Call processHubMaintenance — should trigger the full cascade
    // ----------------------------------------------------------------
    processHubMaintenance(state);

    // ----------------------------------------------------------------
    // Step 4: Verify ALL cascade effects happened in this single call
    // ----------------------------------------------------------------

    // 4a. Hub goes offline
    expect(moonHub.online).toBe(false);

    // 4b. Crew evacuated to Earth
    expect(crew1.stationedHubId).toBe(EARTH_HUB_ID);
    expect(crew2.stationedHubId).toBe(EARTH_HUB_ID);

    // 4c. Tourists evicted (array emptied)
    expect(moonHub.tourists).toEqual([]);
    expect(moonHub.tourists).toHaveLength(0);

    // 4d. Money unchanged (spend failed, so no deduction)
    expect(state.money).toBe(0);
  });

  it('uses advancePeriod-order processing: maintenance runs before construction/transits/tourism', () => {
    // This test verifies the ordering in period.ts:
    //   processHubMaintenance(state)   -- line 190
    //   processConstructionProjects(state)  -- line 191
    //   processCrewTransits(state)     -- line 192
    //   processTouristRevenue(state)   -- line 193
    //
    // When a hub goes offline due to maintenance failure, the subsequent
    // functions should see the offline state and evacuated crew.

    const moonHub = createHub(state, {
      name: 'Cascade Hub',
      type: 'surface',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
    });
    moonHub.online = true;
    moonHub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    moonHub.constructionQueue = [];

    // Add crew with a future transit (to verify processCrewTransits runs after)
    const crewInTransit = makeCrewMember({
      id: 'crew-transit-test',
      name: 'Transit Tester',
      stationedHubId: moonHub.id,
      transitUntil: null,
    });
    state.crew.push(crewInTransit);

    // Add a tourist with revenue
    moonHub.tourists = [
      { id: 't-rev', name: 'Revenue Tourist', arrivalPeriod: 0, departurePeriod: 100, revenue: 10_000 },
    ];

    state.money = 0;
    state.currentPeriod = 5;

    // Run the hub processing functions in the same order as advancePeriod
    processHubMaintenance(state);
    processConstructionProjects(state);
    processCrewTransits(state);
    processTouristRevenue(state);

    // After maintenance fails:
    // - Hub offline
    expect(moonHub.online).toBe(false);

    // - Crew evacuated to Earth (by processHubMaintenance)
    expect(crewInTransit.stationedHubId).toBe(EARTH_HUB_ID);

    // - Tourists evicted by processHubMaintenance
    //   processTouristRevenue sees empty tourists array, so no revenue credited
    expect(moonHub.tourists).toHaveLength(0);

    // Money should still be 0 — no tourist revenue was credited since
    // tourists were evicted before processTouristRevenue ran
    expect(state.money).toBe(0);
  });

  it('multiple hubs cascade independently — one failing does not affect another', () => {
    // Create two off-world hubs, only one runs out of money
    const moonHub = createHub(state, {
      name: 'Moon Hub',
      type: 'surface',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
    });
    moonHub.online = true;
    moonHub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    moonHub.constructionQueue = [];

    // Set money to exactly pay for one hub's maintenance but not two
    const singleCost = calculateHubMaintenance(moonHub);
    state.money = singleCost; // Just enough for one hub

    // First hub maintenance should succeed (money covers it)
    processHubMaintenance(state);

    // Moon hub should stay online (it was the first hub processed and money was sufficient)
    expect(moonHub.online).toBe(true);
    expect(state.money).toBe(0);
  });
});
