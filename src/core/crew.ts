/**
 * crew.ts — Astronaut management: hiring, firing, KIA tracking, and assignment.
 *
 * Each astronaut record is persisted in `state.crew` permanently — records are
 * never deleted, even for fired or KIA astronauts, so the full career history
 * is always available.
 *
 * All functions accept the central GameState as their first argument and mutate
 * it in-place, consistent with the patterns in finance.ts.
 */

import { spend, applyDeathFine } from './finance.ts';
import {
  AstronautStatus, HIRE_COST, CREW_SALARY_PER_PERIOD, HARD_LANDING_SPEED_MIN,
  HARD_LANDING_SPEED_MAX, HARD_LANDING_INJURY_MIN, HARD_LANDING_INJURY_MAX,
  EJECTION_INJURY_PERIODS, MEDICAL_CARE_COST, TRAINING_COURSE_COST, TRAINING_COURSE_DURATION,
  TRAINING_SKILL_GAIN, TRAINING_SLOTS_BY_TIER, EXPERIENCED_CREW_SKILL_RANGE,
  EXPERIENCED_HIRE_COST_MULTIPLIER, FacilityId, getCrewCostModifier,
} from './constants.ts';
import { getFacilityTier } from './construction.ts';
import { getInjuryDurationMultiplier } from './settings.ts';
import type { GameState, FlightState, CrewSkills, CrewMember } from './gameState.ts';
import type { PhysicsState } from './physics.ts';

export type SkillName = 'piloting' | 'engineering' | 'science';

interface HireResult { success: boolean; astronaut?: CrewMember; cost?: number; error?: string; }
interface MedicalResult { success: boolean; newInjuryEnds?: number; error?: string; }
interface TrainingResult { success: boolean; cost?: number; error?: string; }
interface TraineeInfo { id: string; name: string; skill: string; gain: number; completed: boolean; }
interface TrainingProcessResult { trainingCost: number; trainees: TraineeInfo[]; }
interface InjuryRecord { crewId: string; crewName: string; cause: string; periods: number; altitude: number; }
interface XPGainRecord { id: string; name: string; piloting: number; engineering: number; science: number; }
interface FlightStats { safeLanding: boolean; stagingEvents: number; partsRecovered: number; scienceReturns: number; scienceActivations: number; }
interface TrainingSlotInfo { maxSlots: number; usedSlots: number; availableSlots: number; }
interface CreateAstronautOpts { name: string; salary?: number; hireDate?: string; skills?: CrewSkills | null; }

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8; return v.toString(16);
  });
}

function createAstronaut({ name, salary = CREW_SALARY_PER_PERIOD, hireDate = new Date().toISOString(), skills = null }: CreateAstronautOpts): CrewMember {
  return { id: generateUUID(), name, hireDate, status: AstronautStatus.ACTIVE, salary, missionsFlown: 0, flightsFlown: 0, deathDate: null, deathCause: null, assignedRocketId: null, skills: skills ?? { piloting: 0, engineering: 0, science: 0 }, injuryEnds: null, trainingSkill: null, trainingEnds: null };
}

export function getAdjustedHireCost(reputation: number): number { return Math.floor(HIRE_COST * getCrewCostModifier(reputation)); }

export function hireCrew(state: GameState, name: string): HireResult {
  const cost = getAdjustedHireCost(state.reputation ?? 50);
  if (!spend(state, cost)) return { success: false, error: `Insufficient funds to hire astronaut (need $${cost.toLocaleString('en-US')}).` };
  const astronaut = createAstronaut({ name });
  state.crew.push(astronaut);
  return { success: true, astronaut, cost };
}

export function fireCrew(state: GameState, id: string): boolean {
  const a = state.crew.find((a) => a.id === id);
  if (!a || a.status !== AstronautStatus.ACTIVE) return false;
  a.status = AstronautStatus.FIRED; a.assignedRocketId = null; return true;
}

export function recordKIA(state: GameState, id: string, cause: string): boolean {
  const a = state.crew.find((a) => a.id === id);
  if (!a || a.status === AstronautStatus.KIA) return false;
  a.status = AstronautStatus.KIA; a.deathDate = new Date().toISOString(); a.deathCause = cause; a.assignedRocketId = null;
  applyDeathFine(state, 1); return true;
}

export function assignToCrew(state: GameState, astronautId: string, rocketId: string): boolean {
  const a = state.crew.find((a) => a.id === astronautId);
  if (!a || a.status !== AstronautStatus.ACTIVE) return false;
  if (a.injuryEnds != null && a.injuryEnds > (state.currentPeriod ?? 0)) return false;
  if (a.trainingSkill) { a.trainingSkill = null; a.trainingEnds = null; }
  a.assignedRocketId = rocketId; return true;
}

export function unassignCrew(state: GameState, astronautId: string): boolean {
  const a = state.crew.find((a) => a.id === astronautId);
  if (!a) return false; a.assignedRocketId = null; return true;
}

export function getActiveCrew(state: GameState): CrewMember[] { return state.crew.filter((a) => a.status === AstronautStatus.ACTIVE); }
export function getFullHistory(state: GameState): CrewMember[] { return [...state.crew]; }

export function injureCrew(state: GameState, id: string, periods: number): boolean {
  const a = state.crew.find((a) => a.id === id);
  if (!a || a.status !== AstronautStatus.ACTIVE) return false;
  const mult = getInjuryDurationMultiplier(state);
  a.injuryEnds = (state.currentPeriod ?? 0) + Math.max(1, Math.round(periods * mult)); return true;
}

export function isCrewInjured(state: GameState, id: string): boolean {
  const a = state.crew.find((a) => a.id === id);
  if (!a) return false; return a.injuryEnds != null && a.injuryEnds > (state.currentPeriod ?? 0);
}

export function payMedicalCare(state: GameState, id: string): MedicalResult {
  const a = state.crew.find((a) => a.id === id);
  if (!a) return { success: false, error: 'Astronaut not found.' };
  if (a.injuryEnds == null || a.injuryEnds <= (state.currentPeriod ?? 0)) return { success: false, error: 'Astronaut is not injured.' };
  if (!spend(state, MEDICAL_CARE_COST)) return { success: false, error: 'Insufficient funds for medical care.' };
  const cp = state.currentPeriod ?? 0;
  a.injuryEnds = cp + Math.ceil((a.injuryEnds - cp) / 2);
  return { success: true, newInjuryEnds: a.injuryEnds };
}

export function checkInjuryRecovery(state: GameState): string[] {
  const cp = state.currentPeriod ?? 0; const healed: string[] = [];
  for (const a of state.crew) { if (a.status === AstronautStatus.ACTIVE && a.injuryEnds != null && cp >= a.injuryEnds) { a.injuryEnds = null; healed.push(a.id); } }
  return healed;
}

export function getAssignableCrew(state: GameState): CrewMember[] {
  const cp = state.currentPeriod ?? 0;
  return state.crew.filter((a) => a.status === AstronautStatus.ACTIVE && (a.injuryEnds == null || a.injuryEnds <= cp) && !a.trainingSkill);
}

export function processFlightInjuries(state: GameState, flightState: FlightState, ps: PhysicsState | null): InjuryRecord[] {
  const injuries: InjuryRecord[] = [];
  if (!flightState) return injuries;
  const crewIds = flightState.crewIds ?? [];
  const events = flightState.events ?? [];
  const ejectedIds: Set<string> = ps?.ejectedCrewIds ?? new Set();
  const isCrashed = !!(ps && ps.crashed);
  const survivingIds = crewIds.filter((id) => !(isCrashed && !ejectedIds.has(id)));

  const ejectionEvent = events.find((e) => e.type === 'CREW_EJECTED');
  if (ejectionEvent) {
    for (const crewId of survivingIds) {
      if (!ejectedIds.has(crewId)) continue;
      const a = state.crew.find((a) => a.id === crewId);
      if (!a || a.status !== AstronautStatus.ACTIVE) continue;
      if (injureCrew(state, crewId, EJECTION_INJURY_PERIODS)) {
        const alt = typeof ejectionEvent.altitude === 'number' ? ejectionEvent.altitude : 0;
        injuries.push({ crewId, crewName: a.name, cause: 'Ejection', periods: EJECTION_INJURY_PERIODS, altitude: alt });
        flightState.events.push({ time: ejectionEvent.time ?? flightState.timeElapsed, type: 'CREW_INJURED', description: `${a.name} injured from ejection at ${alt.toFixed(0)} m \u2014 recovery ${EJECTION_INJURY_PERIODS} period(s).`, crewId, altitude: alt, cause: 'Ejection' });
      }
    }
  }

  const landingEvent = events.find((e) => e.type === 'LANDING');
  if (landingEvent && typeof landingEvent.speed === 'number') {
    const speed = landingEvent.speed;
    if (speed >= HARD_LANDING_SPEED_MIN && speed < HARD_LANDING_SPEED_MAX) {
      const t = (speed - HARD_LANDING_SPEED_MIN) / (HARD_LANDING_SPEED_MAX - HARD_LANDING_SPEED_MIN);
      const periods = Math.round(HARD_LANDING_INJURY_MIN + t * (HARD_LANDING_INJURY_MAX - HARD_LANDING_INJURY_MIN));
      for (const crewId of survivingIds) {
        if (ejectedIds.has(crewId)) continue;
        const a = state.crew.find((a) => a.id === crewId);
        if (!a || a.status !== AstronautStatus.ACTIVE) continue;
        if (injureCrew(state, crewId, periods)) {
          const alt = typeof landingEvent.altitude === 'number' ? landingEvent.altitude : 0;
          injuries.push({ crewId, crewName: a.name, cause: 'Hard landing', periods, altitude: alt });
          flightState.events.push({ time: landingEvent.time ?? flightState.timeElapsed, type: 'CREW_INJURED', description: `${a.name} injured from hard landing at ${speed.toFixed(1)} m/s \u2014 recovery ${periods} period(s).`, crewId, altitude: alt, cause: 'Hard landing' });
        }
      }
    }
  }
  return injuries;
}

export function awardSkillXP(astronaut: CrewMember, skill: SkillName, rawXP: number): void {
  if (!astronaut.skills) astronaut.skills = { piloting: 0, engineering: 0, science: 0 };
  const current = astronaut.skills[skill] ?? 0;
  astronaut.skills[skill] = Math.min(100, current + rawXP * (100 - current) / 100);
}

export function awardFlightXP(state: GameState, crewIds: string[], flightStats: FlightStats): XPGainRecord[] {
  const results: XPGainRecord[] = [];
  for (const crewId of crewIds) {
    const a = state.crew.find((a) => a.id === crewId);
    if (!a || a.status !== AstronautStatus.ACTIVE) continue;
    const before = { piloting: a.skills?.piloting ?? 0, engineering: a.skills?.engineering ?? 0, science: a.skills?.science ?? 0 };
    awardSkillXP(a, 'piloting', 3);
    if (flightStats.safeLanding) awardSkillXP(a, 'piloting', 5);
    for (let i = 0; i < flightStats.stagingEvents; i++) { awardSkillXP(a, 'piloting', 2); awardSkillXP(a, 'engineering', 2); }
    for (let i = 0; i < flightStats.partsRecovered; i++) awardSkillXP(a, 'engineering', 3);
    for (let i = 0; i < flightStats.scienceReturns; i++) awardSkillXP(a, 'science', 5);
    for (let i = 0; i < flightStats.scienceActivations; i++) awardSkillXP(a, 'science', 3);
    results.push({ id: a.id, name: a.name, piloting: Math.round((a.skills.piloting - before.piloting) * 10) / 10, engineering: Math.round((a.skills.engineering - before.engineering) * 10) / 10, science: Math.round((a.skills.science - before.science) * 10) / 10 });
  }
  return results;
}

export function getMaxCrewSkill(state: GameState, crewIds: string[], skill: SkillName): number {
  let max = 0;
  for (const id of crewIds) { const m = state.crew?.find((c) => c.id === id); if (m?.skills?.[skill] != null) max = Math.max(max, m.skills[skill]); }
  return max;
}

export function getTrainingSlotInfo(state: GameState): TrainingSlotInfo {
  const tier = getFacilityTier(state, FacilityId.CREW_ADMIN);
  const maxSlots = TRAINING_SLOTS_BY_TIER[tier] ?? 0;
  const usedSlots = getTrainingCrew(state).length;
  return { maxSlots, usedSlots, availableSlots: maxSlots - usedSlots };
}

export function assignToTraining(state: GameState, astronautId: string, skill: SkillName): TrainingResult {
  const a = state.crew.find((a) => a.id === astronautId);
  if (!a) return { success: false, error: 'Astronaut not found.' };
  if (a.status !== AstronautStatus.ACTIVE) return { success: false, error: 'Astronaut is not active.' };
  if (a.injuryEnds != null && a.injuryEnds > (state.currentPeriod ?? 0)) return { success: false, error: 'Astronaut is injured and cannot train.' };
  if (a.assignedRocketId) return { success: false, error: 'Astronaut is assigned to a rocket. Unassign first.' };
  if (a.trainingSkill) return { success: false, error: 'Astronaut is already in training.' };
  if (getTrainingSlotInfo(state).availableSlots <= 0) return { success: false, error: 'No training slots available. Upgrade Crew Admin for more slots.' };
  if (!spend(state, TRAINING_COURSE_COST)) return { success: false, error: `Insufficient funds for training (need $${TRAINING_COURSE_COST.toLocaleString('en-US')}).` };
  a.trainingSkill = skill; a.trainingEnds = (state.currentPeriod ?? 0) + TRAINING_COURSE_DURATION;
  return { success: true, cost: TRAINING_COURSE_COST };
}

export function cancelTraining(state: GameState, astronautId: string): boolean {
  const a = state.crew.find((a) => a.id === astronautId);
  if (!a || !a.trainingSkill) return false; a.trainingSkill = null; a.trainingEnds = null; return true;
}

export function processTraining(state: GameState): TrainingProcessResult {
  const trainees: TraineeInfo[] = []; const cp = state.currentPeriod ?? 0;
  for (const a of state.crew) {
    if (a.status !== AstronautStatus.ACTIVE || !a.trainingSkill) continue;
    const skill = a.trainingSkill;
    if (a.trainingEnds != null && cp >= a.trainingEnds) {
      const before = a.skills?.[skill] ?? 0;
      if (!a.skills) a.skills = { piloting: 0, engineering: 0, science: 0 };
      a.skills[skill] = Math.min(100, before + TRAINING_SKILL_GAIN);
      trainees.push({ id: a.id, name: a.name, skill, gain: Math.round((a.skills[skill] - before) * 10) / 10, completed: true });
      a.trainingSkill = null; a.trainingEnds = null;
    } else { trainees.push({ id: a.id, name: a.name, skill, gain: 0, completed: false }); }
  }
  return { trainingCost: 0, trainees };
}

export function getTrainingCrew(state: GameState): CrewMember[] {
  return state.crew.filter((a) => a.status === AstronautStatus.ACTIVE && a.trainingSkill != null);
}

export function getExperiencedHireCost(reputation: number): number { return Math.floor(HIRE_COST * getCrewCostModifier(reputation) * EXPERIENCED_HIRE_COST_MULTIPLIER); }

export function hireExperiencedCrew(state: GameState, name: string): HireResult {
  const cost = getExperiencedHireCost(state.reputation ?? 50);
  if (!spend(state, cost)) return { success: false, error: `Insufficient funds to hire experienced astronaut (need $${cost.toLocaleString('en-US')}).` };
  const { min, max } = EXPERIENCED_CREW_SKILL_RANGE;
  const rs = (): number => min + Math.floor(Math.random() * (max - min + 1));
  const astronaut = createAstronaut({ name, skills: { piloting: rs(), engineering: rs(), science: rs() } });
  state.crew.push(astronaut);
  return { success: true, astronaut, cost };
}

export function payAdvancedMedicalCare(state: GameState, id: string): MedicalResult {
  const a = state.crew.find((a) => a.id === id);
  if (!a) return { success: false, error: 'Astronaut not found.' };
  if (a.injuryEnds == null || a.injuryEnds <= (state.currentPeriod ?? 0)) return { success: false, error: 'Astronaut is not injured.' };
  if (!spend(state, MEDICAL_CARE_COST)) return { success: false, error: 'Insufficient funds for advanced medical care.' };
  const cp = state.currentPeriod ?? 0;
  a.injuryEnds = cp + Math.ceil((a.injuryEnds - cp) / 3);
  return { success: true, newInjuryEnds: a.injuryEnds };
}
