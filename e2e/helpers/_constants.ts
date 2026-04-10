/**
 * Shared E2E test constants — layout values, facility IDs, and mission templates.
 */

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

export const VP_W = 1280;
export const VP_H = 720;

export const SAVE_KEY       = 'spaceAgencySave_0';
export const STARTING_MONEY = 2_000_000;

export const TOOLBAR_H      = 52;
export const SCALE_BAR_W    = 66;
export const PARTS_PANEL_W  = 280;

export const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
export const BUILD_H = VP_H - TOOLBAR_H;                     // 668

export const CENTRE_X        = SCALE_BAR_W + BUILD_W / 2;    // 525
export const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;      // 386

// ---------------------------------------------------------------------------
// Facility IDs (mirrors src/core/constants.js FacilityId)
// ---------------------------------------------------------------------------

export const FacilityId = Object.freeze({
  LAUNCH_PAD:      'launch-pad',
  VAB:             'vab',
  MISSION_CONTROL: 'mission-control',
  CREW_ADMIN:      'crew-admin',
  TRACKING_STATION:'tracking-station',
  RD_LAB:          'rd-lab',
  SATELLITE_OPS:   'satellite-ops',
  LIBRARY:         'library',
} as const);

export type FacilityIdValue = typeof FacilityId[keyof typeof FacilityId];

// ---------------------------------------------------------------------------
// Facility state
// ---------------------------------------------------------------------------

export interface FacilityState {
  built: boolean;
  tier: number;
}

/** Default starter facilities (pre-built at tier 1 in every new game). */
export const STARTER_FACILITIES: Readonly<Record<string, FacilityState>> = Object.freeze({
  [FacilityId.LAUNCH_PAD]:      { built: true, tier: 1 },
  [FacilityId.VAB]:             { built: true, tier: 1 },
  [FacilityId.MISSION_CONTROL]: { built: true, tier: 1 },
});

/** All facilities built at tier 1 (for advanced test scenarios). */
export const ALL_FACILITIES: Readonly<Record<string, FacilityState>> = Object.freeze({
  [FacilityId.LAUNCH_PAD]:      { built: true, tier: 1 },
  [FacilityId.VAB]:             { built: true, tier: 1 },
  [FacilityId.MISSION_CONTROL]: { built: true, tier: 1 },
  [FacilityId.CREW_ADMIN]:      { built: true, tier: 1 },
  [FacilityId.TRACKING_STATION]:{ built: true, tier: 1 },
  [FacilityId.RD_LAB]:          { built: true, tier: 1 },
  [FacilityId.SATELLITE_OPS]:   { built: true, tier: 1 },
  [FacilityId.LIBRARY]:         { built: true, tier: 1 },
});

// ---------------------------------------------------------------------------
// Mission template (no status field — callers spread and add their own)
// ---------------------------------------------------------------------------

export interface ObjectiveTemplate {
  id: string;
  type: string;
  target: Record<string, number | string>;
  completed: boolean;
  description: string;
  [key: string]: unknown;
}

export interface MissionTemplate {
  id: string;
  title: string;
  description: string;
  location: string;
  objectives: ObjectiveTemplate[];
  reward: number;
  unlocksAfter: string[];
  unlockedParts: string[];
}

export const FIRST_FLIGHT_MISSION: MissionTemplate = {
  id:           'mission-001',
  title:        'First Flight',
  description:  'Reach 100 m altitude.',
  location:     'desert',
  objectives: [{
    id:          'obj-001-1',
    type:        'REACH_ALTITUDE',
    target:      { altitude: 100 },
    completed:   false,
    description: 'Reach 100 m altitude',
  }],
  reward:        25_000,
  unlocksAfter:  [],
  unlockedParts: [],
};
