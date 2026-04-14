/**
 * hubTypes.ts — Type definitions for the Off-World Hubs system.
 * @module core/hubTypes
 */

// Import types that are already defined in the codebase:
import type { ResourceType } from './constants.ts';
import type { InventoryPart, FacilityState } from './gameState.ts';

/** Hub classification. Surface hubs are on a body's surface; orbital hubs orbit at a given altitude. */
export type HubType = 'surface' | 'orbital';

/** A resource requirement for a construction project. */
export interface ResourceRequirement {
  resourceId: ResourceType;
  amount: number;
}

/** A facility construction or upgrade project queued at a hub. */
export interface ConstructionProject {
  facilityId: string;
  resourcesRequired: ResourceRequirement[];
  resourcesDelivered: ResourceRequirement[];
  moneyCost: number;
  startedPeriod: number;
  completedPeriod?: number;
}

/** A tourist visiting a hub for revenue. */
export interface Tourist {
  id: string;
  name: string;
  arrivalPeriod: number;
  departurePeriod: number;
  revenue: number;
}

/** Aggregated hub information for management UI panels. */
export interface HubManagementInfo {
  id: string;
  name: string;
  bodyId: string;
  bodyName: string;
  type: HubType;
  online: boolean;
  established: number;
  facilities: { id: string; name: string; tier: number; underConstruction: boolean }[];
  crewCount: number;
  crewNames: string[];
  touristCount: number;
  maintenanceCostPerPeriod: number;
  totalInvestment: number;
  canRename: boolean;
  canReactivate: boolean;
  canAbandon: boolean;
}

/** An off-world hub (base or station) established by the player. */
export interface Hub {
  id: string;
  name: string;
  type: HubType;
  bodyId: string;
  altitude?: number;           // orbital hubs only (metres above surface)
  coordinates?: { x: number; y: number };  // surface hubs only
  biomeId?: string;            // surface hubs only
  facilities: Record<string, FacilityState>;
  tourists: Tourist[];
  partInventory: InventoryPart[];
  constructionQueue: ConstructionProject[];
  maintenanceCost: number;
  established: number;         // period when the hub was created
  online: boolean;
}
