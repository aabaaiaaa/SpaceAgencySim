/**
 * library.ts — Library facility statistics and knowledge computation.
 *
 * Pure functions that derive statistics, records, celestial body knowledge,
 * and rocket usage data from the game state.  The Library facility UI
 * calls these to populate its dashboard tabs.
 *
 * @module core/library
 */

import { FlightOutcome, AstronautStatus } from './constants.ts';
import { ALL_BODY_IDS, getBodyDef } from '../data/bodies.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import type { GameState } from './gameState.ts';

// ---------------------------------------------------------------------------
// Local types for return values
// ---------------------------------------------------------------------------

interface AgencyStats {
  totalFlights: number;
  successfulFlights: number;
  failedFlights: number;
  partialSuccesses: number;
  totalRevenue: number;
  totalFlightTime: number;
  currentPeriod: number;
  sciencePoints: number;
  achievementsEarned: number;
  totalAchievements: number;
  satellitesDeployed: number;
  activeCrew: number;
  totalCrewHired: number;
  crewLost: number;
}

interface RecordEntry {
  value: number;
  flightId: string;
  rocketName: string;
}

interface LongestFlightEntry {
  duration: number;
  flightId: string;
  rocketName: string;
}

interface HeaviestRocket {
  mass: number;
  name: string;
  id: string;
}

interface BodyRecord {
  maxAltitude: number;
  visited: boolean;
  orbited: boolean;
  landed: boolean;
}

interface Records {
  maxAltitude: RecordEntry;
  maxSpeed: RecordEntry;
  heaviestRocket: HeaviestRocket;
  longestFlight: LongestFlightEntry;
  mostFlightsInRow: number;
  recordsByBody: Record<string, BodyRecord>;
}

interface CrewCareer {
  id: string;
  name: string;
  status: string;
  flightsFlown: number;
  skills: { piloting: number; engineering: number; science: number };
  hireDate: string;
}

interface FinancialSummary {
  currentBalance: number;
  loanBalance: number;
  totalInterestPaid: number;
  totalMissionRevenue: number;
  totalContractRevenue: number;
  reputation: number;
}

interface ExplorationProgress {
  discoveredBodies: string[];
  totalBodies: number;
  biomesExplored: number;
  totalBiomes: number;
  surfaceItemCount: number;
  bodiesLandedOn: string[];
}

interface BodyKnowledge {
  id: string;
  name: string;
  surfaceGravity: number;
  radius: number;
  hasAtmosphere: boolean;
  atmosphereTop: number;
  landable: boolean;
  biomeCount: number;
  minOrbitAltitude: number;
  orbitalDistance: number;
  parentName: string;
  timesVisited: number;
  satellitesInOrbit: number;
}

interface RocketStats {
  rocketId: string;
  rocketName: string;
  flightCount: number;
  successCount: number;
  failureCount: number;
  totalRevenue: number;
  lastFlown: string;
  successRate: number;
}

// ---------------------------------------------------------------------------
// Agency Statistics
// ---------------------------------------------------------------------------

/**
 * Compute overall agency statistics from the game state.
 */
export function getAgencyStats(state: GameState): AgencyStats {
  const history = state.flightHistory ?? [];

  let successfulFlights = 0;
  let failedFlights = 0;
  let partialSuccesses = 0;
  let totalRevenue = 0;

  for (const flight of history) {
    if (flight.outcome === FlightOutcome.SUCCESS) successfulFlights++;
    else if (flight.outcome === FlightOutcome.FAILURE) failedFlights++;
    else partialSuccesses++;
    totalRevenue += flight.revenue ?? 0;
  }

  const crew = state.crew ?? [];

  return {
    totalFlights: history.length,
    successfulFlights,
    failedFlights,
    partialSuccesses,
    totalRevenue,
    totalFlightTime: state.flightTimeSeconds ?? 0,
    currentPeriod: state.currentPeriod ?? 0,
    sciencePoints: state.sciencePoints ?? 0,
    achievementsEarned: (state.achievements ?? []).length,
    totalAchievements: ACHIEVEMENTS.length,
    satellitesDeployed: (state.satelliteNetwork?.satellites ?? []).length,
    activeCrew: crew.filter((c) => c.status === AstronautStatus.ACTIVE).length,
    totalCrewHired: crew.length,
    crewLost: crew.filter((c) => c.status === AstronautStatus.KIA).length,
  };
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * Compute record values (max altitude, max speed, heaviest rocket) from
 * flight history and rocket designs.
 */
export function getRecords(state: GameState): Records {
  const history = state.flightHistory ?? [];

  let maxAlt: RecordEntry = { value: 0, flightId: '', rocketName: '' };
  let maxSpd: RecordEntry = { value: 0, flightId: '', rocketName: '' };
  let longestFlt: LongestFlightEntry = { duration: 0, flightId: '', rocketName: '' };

  for (const flight of history) {
    const alt = flight.maxAltitude ?? 0;
    const spd = flight.maxSpeed ?? 0;
    const dur = flight.duration ?? 0;
    const name = flight.rocketName ?? '';

    if (alt > maxAlt.value) {
      maxAlt = { value: alt, flightId: flight.id, rocketName: name };
    }
    if (spd > maxSpd.value) {
      maxSpd = { value: spd, flightId: flight.id, rocketName: name };
    }
    if (dur > longestFlt.duration) {
      longestFlt = { duration: dur, flightId: flight.id, rocketName: name };
    }
  }

  // Heaviest rocket from saved designs.
  let heaviest: HeaviestRocket = { mass: 0, name: '', id: '' };
  for (const design of state.savedDesigns ?? []) {
    if ((design.totalMass ?? 0) > heaviest.mass) {
      heaviest = { mass: design.totalMass, name: design.name, id: design.id };
    }
  }

  // Records per celestial body.
  const recordsByBody = _computeBodyRecords(state);

  // Consecutive successful flights.
  let mostInRow = 0;
  let currentStreak = 0;
  for (const flight of history) {
    if (flight.outcome === FlightOutcome.SUCCESS) {
      currentStreak++;
      if (currentStreak > mostInRow) mostInRow = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  return {
    maxAltitude: maxAlt,
    maxSpeed: maxSpd,
    heaviestRocket: heaviest,
    longestFlight: longestFlt,
    mostFlightsInRow: mostInRow,
    recordsByBody,
  };
}

// ---------------------------------------------------------------------------
// Crew Careers
// ---------------------------------------------------------------------------

/**
 * Build crew career summaries for the Library.
 */
export function getCrewCareers(state: GameState): CrewCareer[] {
  const crew = state.crew ?? [];
  const history = state.flightHistory ?? [];

  // Count flights per crew member from flight history.
  const flightCounts = new Map<string, number>();
  for (const flight of history) {
    for (const crewId of flight.crewIds ?? []) {
      flightCounts.set(crewId, (flightCounts.get(crewId) ?? 0) + 1);
    }
  }

  return crew.map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    flightsFlown: flightCounts.get(c.id) ?? 0,
    skills: { ...c.skills },
    hireDate: c.hireDate ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Financial History
// ---------------------------------------------------------------------------

/**
 * Compute a financial summary from the game state.
 */
export function getFinancialSummary(state: GameState): FinancialSummary {
  const history = state.flightHistory ?? [];
  const totalMissionRevenue = history.reduce((sum, f) => sum + (f.revenue ?? 0), 0);

  const completedContracts = state.contracts?.completed ?? [];
  const totalContractRevenue = completedContracts.reduce((sum, c) => sum + (c.reward ?? 0), 0);

  return {
    currentBalance: state.money ?? 0,
    loanBalance: state.loan?.balance ?? 0,
    totalInterestPaid: state.loan?.totalInterestAccrued ?? 0,
    totalMissionRevenue,
    totalContractRevenue,
    reputation: state.reputation ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Exploration Progress
// ---------------------------------------------------------------------------

/**
 * Compute exploration progress — discovered bodies and biome coverage.
 */
export function getExplorationProgress(state: GameState): ExplorationProgress {
  const discovered = _getDiscoveredBodies(state);

  // Count total biomes across all bodies.
  let totalBiomes = 0;
  for (const bodyId of ALL_BODY_IDS) {
    const body = getBodyDef(bodyId);
    if (body) totalBiomes += body.biomes.length;
  }

  // Count explored biomes from science log.
  const exploredBiomeIds = new Set<string>();
  for (const entry of state.scienceLog ?? []) {
    if (entry.biomeId) exploredBiomeIds.add(entry.biomeId);
  }

  // Bodies with surface landings.
  const landedBodies = new Set<string>();
  for (const item of state.surfaceItems ?? []) {
    landedBodies.add(item.bodyId);
  }

  return {
    discoveredBodies: [...discovered],
    totalBodies: ALL_BODY_IDS.length,
    biomesExplored: exploredBiomeIds.size,
    totalBiomes,
    surfaceItemCount: (state.surfaceItems ?? []).length,
    bodiesLandedOn: [...landedBodies],
  };
}

// ---------------------------------------------------------------------------
// Celestial Body Knowledge
// ---------------------------------------------------------------------------

/**
 * Return knowledge entries for discovered celestial bodies.
 * Includes physical properties useful for mission planning.
 */
export function getCelestialBodyKnowledge(state: GameState): BodyKnowledge[] {
  const discovered = _getDiscoveredBodies(state);
  const history = state.flightHistory ?? [];

  // Count visits per body from flight history.
  const visitCounts = new Map<string, number>();
  for (const flight of history) {
    for (const bodyId of flight.bodiesVisited ?? []) {
      visitCounts.set(bodyId, (visitCounts.get(bodyId) ?? 0) + 1);
    }
  }

  // Count satellites per body.
  const satCounts = new Map<string, number>();
  for (const sat of state.satelliteNetwork?.satellites ?? []) {
    satCounts.set(sat.bodyId, (satCounts.get(sat.bodyId) ?? 0) + 1);
  }

  return [...discovered]
    .map((bodyId: string) => {
      const body = getBodyDef(bodyId);
      if (!body) return null;
      const parent = body.parentId ? getBodyDef(body.parentId) : null;
      return {
        id: body.id,
        name: body.name,
        surfaceGravity: body.surfaceGravity,
        radius: body.radius,
        hasAtmosphere: !!body.atmosphere,
        atmosphereTop: body.atmosphere?.topAltitude ?? 0,
        landable: body.landable,
        biomeCount: body.biomes.length,
        minOrbitAltitude: body.minOrbitAltitude,
        orbitalDistance: body.orbitalDistance,
        parentName: parent?.name ?? 'None',
        timesVisited: visitCounts.get(bodyId) ?? 0,
        satellitesInOrbit: satCounts.get(bodyId) ?? 0,
      } as BodyKnowledge;
    })
    .filter((entry): entry is BodyKnowledge => entry !== null);
}

// ---------------------------------------------------------------------------
// Frequently Flown Rockets (Top 5)
// ---------------------------------------------------------------------------

/**
 * Get the top 5 most frequently flown rocket configurations.
 */
export function getFrequentRockets(state: GameState): RocketStats[] {
  const history = state.flightHistory ?? [];

  const rocketStats = new Map<string, Omit<RocketStats, 'successRate'>>();

  for (const flight of history) {
    const rId = flight.rocketId;
    if (!rId) continue;

    let entry = rocketStats.get(rId);
    if (!entry) {
      // Resolve rocket name: try flight record first, then saved designs.
      let name = flight.rocketName ?? '';
      if (!name) {
        const design = state.savedDesigns?.find((d) => d.id === rId)
          ?? state.rockets?.find((r) => r.id === rId);
        name = design?.name ?? rId.slice(0, 8);
      }
      entry = {
        rocketId: rId,
        rocketName: name,
        flightCount: 0,
        successCount: 0,
        failureCount: 0,
        totalRevenue: 0,
        lastFlown: '',
      };
      rocketStats.set(rId, entry);
    }

    entry.flightCount++;
    if (flight.outcome === FlightOutcome.SUCCESS) entry.successCount++;
    else if (flight.outcome === FlightOutcome.FAILURE) entry.failureCount++;
    entry.totalRevenue += flight.revenue ?? 0;
    entry.lastFlown = flight.launchDate ?? entry.lastFlown;
  }

  // Sort by flight count descending, take top 5.
  return [...rocketStats.values()]
    .sort((a, b) => b.flightCount - a.flightCount)
    .slice(0, 5)
    .map((r) => ({
      ...r,
      successRate: r.flightCount > 0
        ? Math.round((r.successCount / r.flightCount) * 100)
        : 0,
    }));
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Determine which celestial bodies the player has "discovered" by examining
 * flight history, satellites, surface items, field craft, and achievements.
 * Earth is always discovered.
 */
function _getDiscoveredBodies(state: GameState): Set<string> {
  const bodies = new Set<string>(['EARTH']);

  // From flight history (bodiesVisited field, available on enriched records).
  for (const flight of state.flightHistory ?? []) {
    for (const bodyId of flight.bodiesVisited ?? []) {
      bodies.add(bodyId);
    }
  }

  // From satellite deployments.
  for (const sat of state.satelliteNetwork?.satellites ?? []) {
    if (sat.bodyId) bodies.add(sat.bodyId);
  }

  // From surface items.
  for (const item of state.surfaceItems ?? []) {
    if (item.bodyId) bodies.add(item.bodyId);
  }

  // From field craft.
  for (const craft of state.fieldCraft ?? []) {
    if (craft.bodyId) bodies.add(craft.bodyId);
  }

  // From achievements (infer body visits from specific achievements).
  const achievementIds = new Set((state.achievements ?? []).map((a) => a.id));
  if (achievementIds.has('FIRST_LUNAR_FLYBY') || achievementIds.has('FIRST_LUNAR_ORBIT') || achievementIds.has('FIRST_LUNAR_LANDING')) {
    bodies.add('MOON');
  }
  if (achievementIds.has('FIRST_MARS_ORBIT') || achievementIds.has('FIRST_MARS_LANDING')) {
    bodies.add('MARS');
  }
  if (achievementIds.has('FIRST_SOLAR_SCIENCE')) {
    bodies.add('SUN');
  }

  return bodies;
}

/**
 * Compute per-body records from flight history, satellites, and surface items.
 */
function _computeBodyRecords(state: GameState): Record<string, BodyRecord> {
  const records: Record<string, BodyRecord> = {};

  for (const bodyId of ALL_BODY_IDS) {
    records[bodyId] = { maxAltitude: 0, visited: false, orbited: false, landed: false };
  }

  // Earth is always visited.
  records['EARTH'].visited = true;

  // From flight history.
  for (const flight of state.flightHistory ?? []) {
    for (const bodyId of flight.bodiesVisited ?? []) {
      if (records[bodyId]) records[bodyId].visited = true;
    }
  }

  // From satellites — implies orbit.
  for (const sat of state.satelliteNetwork?.satellites ?? []) {
    if (records[sat.bodyId]) {
      records[sat.bodyId].visited = true;
      records[sat.bodyId].orbited = true;
    }
  }

  // From surface items — implies landing.
  for (const item of state.surfaceItems ?? []) {
    if (records[item.bodyId]) {
      records[item.bodyId].visited = true;
      records[item.bodyId].landed = true;
    }
  }

  // From field craft.
  for (const craft of state.fieldCraft ?? []) {
    if (records[craft.bodyId]) {
      records[craft.bodyId].visited = true;
      if (craft.status === 'LANDED') records[craft.bodyId].landed = true;
      if (craft.status === 'IN_ORBIT') records[craft.bodyId].orbited = true;
    }
  }

  // From achievements.
  const achievementIds = new Set((state.achievements ?? []).map((a) => a.id));
  if (achievementIds.has('FIRST_ORBIT')) { records['EARTH'].orbited = true; }
  if (achievementIds.has('FIRST_LUNAR_FLYBY')) { records['MOON'].visited = true; }
  if (achievementIds.has('FIRST_LUNAR_ORBIT')) { records['MOON'].orbited = true; records['MOON'].visited = true; }
  if (achievementIds.has('FIRST_LUNAR_LANDING')) { records['MOON'].landed = true; records['MOON'].visited = true; }
  if (achievementIds.has('FIRST_MARS_ORBIT')) { records['MARS'].orbited = true; records['MARS'].visited = true; }
  if (achievementIds.has('FIRST_MARS_LANDING')) { records['MARS'].landed = true; records['MARS'].visited = true; }

  return records;
}
