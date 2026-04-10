/**
 * flightReturn.ts — End-of-flight game-state processing.
 *
 * Called once when the player dismisses the post-flight summary and returns
 * to the Space Agency hub.  Responsible for:
 *
 *   1. Completing any accepted missions whose objectives were all met.
 *   2. Crediting mission rewards (delegated to completeMission -> finance.earn).
 *   3. Unlocking downstream missions and parts (delegated to completeMission).
 *   4. Crediting part-recovery cash (60 % of cost for each intact landed part).
 *   5. Applying loan interest — once per flight.
 *   6. Applying death fines for KIA crew (if not already charged mid-flight).
 *   7. Recording the flight in state.flightHistory and clearing currentFlight.
 *
 * The function is pure in the sense that every mutation goes through the
 * established finance / mission helpers so that the logic is testable in
 * isolation.
 *
 * @module core/flightReturn
 */

import { completeMission } from './missions.ts';
import { earn, applyInterest, applyDeathFine } from './finance.ts';
import { advancePeriod } from './period.ts';
import { initWeather } from './weather.ts';
import { getPartById } from '../data/parts.ts';
import { PartType, DEATH_FINE_PER_ASTRONAUT, FlightOutcome, AstronautStatus } from './constants.ts';
import { processContractCompletions, generateContracts } from './contracts.ts';
import { deploySatellitesFromFlight } from './satellites.ts';
import { awardFlightXP, getMaxCrewSkill, processFlightInjuries } from './crew.ts';
import { recoverPartsToInventory } from './partInventory.ts';
import {
  applyCrewDeathReputation, applySafeCrewReturnReputation,
  applyMissionFailureReputation, applyRocketDestructionReputation,
} from './reputation.ts';
import { processSampleReturns } from './surfaceOps.ts';
import { checkAchievements } from './achievements.ts';
import { createFieldCraft, hasExtendedLifeSupport } from './lifeSupport.ts';
import { FieldCraftStatus } from './constants.ts';
import { processChallengeCompletion } from './challenges.ts';
import type { GameState, FlightState, FlightResult, FlightEvent, InventoryPart, Contract, FieldCraft, MissionInstance } from './gameState.ts';
import type { PhysicsState, RocketAssembly } from './physics.ts';
import type { CompleteMissionResult } from './missions.ts';
import type { RecoverPartsResult } from './partInventory.ts';
import type { PeriodSummary } from './period.ts';
import type { AwardedAchievement } from './achievements.ts';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CompletedMissionEntry {
  mission: MissionInstance;
  reward: number;
  unlockedParts: string[];
  newlyAvailableMissions: MissionInstance[];
}

export interface FlightReturnSummary {
  completedMissions: CompletedMissionEntry[];
  recoveryValue: number;
  interestCharged: number;
  loanBalance: number;
  deathFineTotal: number;
  operatingCosts: number;
  crewSalaryCost: number;
  facilityUpkeep: number;
  activeCrewCount: number;
  netCashChange: number;
  totalFlights: number;
  currentPeriod: number;
  expiredMissionIds: string[];
  completedContracts: Array<{ contract: Contract | undefined; reward: number | undefined }>;
  newContracts: Contract[];
  bankrupt: boolean;
  deployedSatellites: Array<{ satelliteId: string | undefined; satelliteType: string }>;
  crewXPGains: Array<{ id: string; name: string; piloting: number; engineering: number; science: number }>;
  crewInjuries: Array<{ crewId: string; crewName: string; cause: string; periods: number; altitude: number }>;
  recoveredParts: InventoryPart[];
  reputationChange: number;
  reputationAfter: number;
  samplesReturned: number;
  sampleScienceEarned: number;
  newAchievements: Array<{ id: string; title: string; cashReward: number; repReward: number }>;
  deployedFieldCraft: FieldCraft | null;
  lifeSupportWarnings: Array<{ craftId: string; craftName: string; suppliesRemaining: number; crewIds: string[] }>;
  lifeSupportDeaths: Array<{ craftId: string; craftName: string; crewId: string; crewName: string }>;
  challengeResult: {
    completed: boolean; challengeId?: string; challengeTitle?: string;
    score?: number; medal?: string; previousMedal?: string; isNewBest?: boolean; reward?: number;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function processFlightReturn(state: GameState, flightState: FlightState, ps: PhysicsState | null, assembly: RocketAssembly | null): FlightReturnSummary {
  if (!Array.isArray(state.crew)) state.crew = [];
  if (!state.missions) state.missions = { available: [], accepted: [], completed: [] };
  if (!Array.isArray(state.missions.accepted)) state.missions.accepted = [];
  if (!Array.isArray(state.missions.available)) state.missions.available = [];
  if (!Array.isArray(state.missions.completed)) state.missions.completed = [];

  const cashBefore = state.money;
  const repBefore = state.reputation ?? 50;
  const completedMissions: CompletedMissionEntry[] = [];
  let recoveryValue = 0, interestCharged = 0, deathFineTotal = 0;

  // -- 1-3. Mission completion --
  const acceptedSnapshot = [...(state.missions?.accepted ?? [])];
  for (const mission of acceptedSnapshot) {
    const allObjectivesMet = Array.isArray(mission.objectives) && mission.objectives.length > 0 && mission.objectives.filter((obj) => !obj.optional).every((obj) => obj.completed);
    if (allObjectivesMet) {
      const result: CompleteMissionResult = completeMission(state, mission.id);
      if (result.success) completedMissions.push({ mission: result.mission!, reward: result.reward!, unlockedParts: result.unlockedParts!, newlyAvailableMissions: result.newlyUnlockedMissions! });
    }
  }

  // Reset objective progress on incomplete missions so the player starts fresh.
  for (const mission of state.missions.accepted) {
    if (Array.isArray(mission.objectives)) {
      for (const obj of mission.objectives) {
        obj.completed = false;
      }
    }
  }

  // -- 4. Part recovery --
  const isLanded = !!(ps && ps.landed && !ps.crashed);
  let partsRecovered = 0;
  let recoveredParts: InventoryPart[] = [];
  if (isLanded && assembly) {
    const crewIds = flightState?.crewIds ?? [];
    const engSkill = getMaxCrewSkill(state, crewIds, 'engineering');
    const recoveryFrac = 0.6 + (engSkill / 100) * 0.2;
    for (const [instanceId, placed] of assembly.parts) {
      if (!ps!.activeParts.has(instanceId)) continue;
      const def = getPartById(placed.partId); if (!def) continue;
      recoveryValue += Math.round((def.cost ?? 0) * recoveryFrac);
    }
    if (recoveryValue > 0) earn(state, recoveryValue);
    const usedInventoryParts = ps._usedInventoryParts ?? null;
    const result: RecoverPartsResult = recoverPartsToInventory(state, assembly, ps!, usedInventoryParts);
    partsRecovered = result.partsRecovered; recoveredParts = result.entries;
  }

  // -- 4b. Crew skill XP --
  const flightEvents = flightState?.events ?? [];
  const stagingEvents = flightEvents.filter((e: FlightEvent) => e.type === 'PART_ACTIVATED').length;
  const scienceActivations = flightEvents.filter((e: FlightEvent) => e.type === 'PART_ACTIVATED' && e.partType === PartType.SERVICE_MODULE).length;
  const scienceReturns = flightEvents.filter((e: FlightEvent) => e.type === 'SCIENCE_DATA_RETURNED' || e.type === 'SCIENCE_TRANSMITTED').length;
  const survivingCrewIds = (flightState?.crewIds ?? []).filter((id: string) => {
    const ejectedIds = ps?.ejectedCrewIds ?? new Set<string>();
    if (ps?.crashed && !ejectedIds.has(id)) return false;
    return true;
  });
  const crewXPGains = awardFlightXP(state, survivingCrewIds, { safeLanding: isLanded, stagingEvents, partsRecovered, scienceReturns, scienceActivations });

  // -- 4c. Crew injuries --
  const crewInjuries = processFlightInjuries(state, flightState, ps);

  // -- 5. Loan interest --
  if (state.loan && state.loan.balance > 0) {
    const cashBefore2 = state.money; const loanBefore = state.loan.balance;
    applyInterest(state);
    interestCharged = (cashBefore2 - state.money) + (state.loan.balance - loanBefore);
  }

  // -- 6. Death fines --
  if (flightState && !flightState.deathFinesApplied) {
    const isCrashed = !!(ps && ps.crashed);
    const allCmdLost = _allCommandModulesDestroyed(ps, assembly);
    if (isCrashed || allCmdLost) {
      const ejectedIds = (ps && ps.ejectedCrewIds) ? ps.ejectedCrewIds : new Set<string>();
      const crewIds = Array.isArray(flightState.crewIds) ? flightState.crewIds : [];
      const kiaCount = crewIds.filter((id: string) => !ejectedIds.has(id)).length;
      if (kiaCount > 0) { applyDeathFine(state, kiaCount); deathFineTotal = kiaCount * DEATH_FINE_PER_ASTRONAUT; }
    }
    flightState.deathFinesApplied = true;
  }

  // -- 6a. Reputation --
  {
    const isCrashed = !!(ps && ps.crashed);
    const crewIds = Array.isArray(flightState?.crewIds) ? flightState.crewIds : [];
    const ejectedIds = ps?.ejectedCrewIds ?? new Set<string>();
    const kiaCount = isCrashed ? crewIds.filter((id: string) => !ejectedIds.has(id)).length : 0;
    if (kiaCount > 0) applyCrewDeathReputation(state, kiaCount);
    if (isLanded && crewIds.length > 0) { const safeCount = crewIds.length - kiaCount; if (safeCount > 0) applySafeCrewReturnReputation(state, safeCount); }
    if (isCrashed && !isLanded) applyRocketDestructionReputation(state);
    const outcome = _determineOutcome(ps, completedMissions.length > 0);
    if (outcome === FlightOutcome.FAILURE) applyMissionFailureReputation(state);
  }

  // -- 6b. Contract completions --
  const contractResult = processContractCompletions(state);

  // -- 6b2. Challenge completion --
  const challengeResult = processChallengeCompletion(state, flightState, ps);

  // -- 6c. Advance period --
  const periodSummary: PeriodSummary = advancePeriod(state);

  // -- 6d. Generate contracts --
  const newContracts = generateContracts(state);

  // -- 6e. Deploy satellites --
  const deployedSatellites = deploySatellitesFromFlight(state, flightState);

  // -- 6e2. Surface samples --
  const landingBodyId = flightState?.bodyId ?? 'EARTH';
  const sampleResult = isLanded ? processSampleReturns(state, landingBodyId) : { samplesReturned: 0, scienceEarned: 0 };

  // -- 6e3. Field craft --
  let deployedFieldCraft: FieldCraft | null = null;
  {
    const crewIds = Array.isArray(flightState?.crewIds) ? flightState.crewIds : [];
    const wasInOrbit = !!(flightState?.inOrbit);
    const landedOnNonEarth = isLanded && landingBodyId !== 'EARTH';
    if (crewIds.length > 0 && (wasInOrbit || landedOnNonEarth)) {
      const ejectedIds = ps?.ejectedCrewIds ?? new Set<string>();
      const isCrashed = !!(ps && ps.crashed);
      const survivingIds = crewIds.filter((id: string) => {
        if (isCrashed && !ejectedIds.has(id)) return false;
        const astro = (state.crew ?? []).find((a) => a.id === id);
        return astro && astro.status !== AstronautStatus.KIA;
      });
      if (survivingIds.length > 0) {
        if (!Array.isArray(state.fieldCraft)) state.fieldCraft = [];
        const rocketDesign = state.rockets?.find((r) => r.id === flightState.rocketId);
        const craftName = rocketDesign?.name ?? `Craft-${(flightState.rocketId ?? '').slice(0, 6)}`;
        const fieldStatus = wasInOrbit ? FieldCraftStatus.IN_ORBIT : FieldCraftStatus.LANDED;
        deployedFieldCraft = createFieldCraft({ name: craftName, bodyId: landingBodyId, status: fieldStatus, crewIds: survivingIds, hasExtendedLifeSupport: hasExtendedLifeSupport(assembly, ps), deployedPeriod: state.currentPeriod, orbitalElements: flightState?.orbitalElements ?? null, orbitBandId: flightState?.orbitBandId ?? null });
        state.fieldCraft.push(deployedFieldCraft);
      }
    }
  }

  // -- 6f. Flight time --
  state.flightTimeSeconds = (state.flightTimeSeconds ?? 0) + (flightState?.timeElapsed ?? 0);

  // -- 6g. Weather --
  initWeather(state, flightState?.bodyId ?? 'EARTH');

  // -- 7. Flight history --
  const outcome = _determineOutcome(ps, completedMissions.length > 0);
  const missionRevenueTotal = completedMissions.reduce((sum, e) => sum + e.reward, 0);
  const visitedBodies = new Set<string>();
  if (flightState?.bodyId) visitedBodies.add(flightState.bodyId);
  if (flightState?.transferState?.originBodyId) visitedBodies.add(flightState.transferState.originBodyId);
  if (flightState?.transferState?.destinationBodyId) visitedBodies.add(flightState.transferState.destinationBodyId);
  const rocketDesign = state.savedDesigns?.find((d) => d.id === flightState?.rocketId) ?? state.rockets?.find((r) => r.id === flightState?.rocketId);

  const flightResult: FlightResult = {
    id: _generateId(), missionId: flightState?.missionId ?? '', rocketId: flightState?.rocketId ?? '',
    crewIds: flightState?.crewIds ?? [], launchDate: new Date().toISOString(), outcome,
    deltaVUsed: 0, revenue: missionRevenueTotal + recoveryValue, notes: '',
    maxAltitude: flightState?.maxAltitude ?? flightState?.altitude ?? 0,
    maxSpeed: flightState?.maxVelocity ?? flightState?.velocity ?? 0,
    bodiesVisited: [...visitedBodies], duration: flightState?.timeElapsed ?? 0, rocketName: rocketDesign?.name ?? '',
  };
  if (!Array.isArray(state.flightHistory)) state.flightHistory = [];
  state.flightHistory.push(flightResult);

  // -- 8. Achievements --
  const newAchievements: AwardedAchievement[] = checkAchievements(state, { flightState, ps, isLanded, landingBodyId });
  state.currentFlight = null;

  return {
    completedMissions, recoveryValue, interestCharged, loanBalance: state.loan?.balance ?? 0,
    deathFineTotal, operatingCosts: periodSummary.totalOperatingCost,
    crewSalaryCost: periodSummary.crewSalaryCost, facilityUpkeep: periodSummary.facilityUpkeep,
    activeCrewCount: periodSummary.activeCrewCount, netCashChange: state.money - cashBefore,
    totalFlights: state.flightHistory.length, currentPeriod: periodSummary.newPeriod,
    expiredMissionIds: periodSummary.expiredMissionIds,
    completedContracts: contractResult.completedContracts, newContracts,
    bankrupt: periodSummary.bankrupt, deployedSatellites, crewXPGains, crewInjuries, recoveredParts,
    reputationChange: (state.reputation ?? 50) - repBefore, reputationAfter: state.reputation ?? 50,
    samplesReturned: sampleResult.samplesReturned, sampleScienceEarned: sampleResult.scienceEarned,
    newAchievements, deployedFieldCraft,
    lifeSupportWarnings: periodSummary.lifeSupportWarnings ?? [],
    lifeSupportDeaths: periodSummary.lifeSupportDeaths ?? [],
    challengeResult,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _allCommandModulesDestroyed(ps: PhysicsState | null, assembly: RocketAssembly | null): boolean {
  if (!assembly || !ps) return false;
  let hadCommandModule = false;
  for (const [instanceId, placed] of assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    hadCommandModule = true;
    if (ps.activeParts.has(instanceId)) return false;
  }
  return hadCommandModule;
}

function _determineOutcome(ps: PhysicsState | null, missionsCompleted: boolean): FlightOutcome {
  if (!ps) return missionsCompleted ? FlightOutcome.SUCCESS : FlightOutcome.FAILURE;
  const landed = ps.landed && !ps.crashed;
  const crashed = ps.crashed;
  if (landed && missionsCompleted) return FlightOutcome.SUCCESS;
  if (landed && !missionsCompleted) return FlightOutcome.PARTIAL_SUCCESS;
  if (crashed && missionsCompleted) return FlightOutcome.PARTIAL_SUCCESS;
  return FlightOutcome.FAILURE;
}

function _generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `flight-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
