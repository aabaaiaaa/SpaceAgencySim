/**
 * _state.ts — Pure reducers for the crew admin UI.
 *
 * Captures the pure, non-DOM computations used by crewAdmin.ts — crew
 * row formatting, skill bar HTML construction, hire capacity / cost
 * checks, and training-period calculations — for unit testing.  Follows
 * the VAB / hub / mainmenu reducer pattern (src/ui/vab/_state.ts,
 * src/ui/hub/_state.ts, src/ui/mainmenu/_state.ts).
 *
 * crewAdmin.ts itself has no non-DOM module state worth tracking (all
 * module refs are DOM/listener lifecycle and the active-tab id, which
 * is ephemeral UI state), so this module exposes only pure
 * formatters/classifiers.
 */

import { MAX_CREW_SIZE } from '../../core/constants.ts';
import type { CrewMember, CrewSkills } from '../../core/gameState.ts';

// ---------------------------------------------------------------------------
// Skill bars — pure HTML string builder
// ---------------------------------------------------------------------------

export interface SkillEffects {
  pilotEffect: string;
  engEffect: string;
  sciEffect: string;
}

/**
 * Compute the user-facing effect descriptions for each skill.  Skills
 * are rounded before the effect strings are built so the displayed
 * numbers stay in sync with the bar fill percentages.
 */
export function computeSkillEffects(skills: CrewSkills): SkillEffects {
  const p: number = Math.round(skills.piloting);
  const e: number = Math.round(skills.engineering);
  const s: number = Math.round(skills.science);

  const pilotEffect: string = `+${(p * 0.3).toFixed(0)}% turn rate`;
  const engEffect:   string = `${(60 + (e / 100) * 20).toFixed(0)}% part recovery`;
  const sciDuration: string = (100 - (s / 100) * 33.3).toFixed(0);
  const sciEffect:   string = `${sciDuration}% exp. time, +${((s / 100) * 50).toFixed(0)}% yield`;

  return { pilotEffect, engEffect, sciEffect };
}

/**
 * Build the HTML string for the per-crew-member skill-bar block in the
 * Active Crew table.  Pure — no DOM access — so it can be unit tested
 * and reused in isolation.
 */
export function skillBarsHTML(skills: CrewSkills): string {
  const p: number = Math.round(skills.piloting);
  const e: number = Math.round(skills.engineering);
  const s: number = Math.round(skills.science);
  const { pilotEffect, engEffect, sciEffect } = computeSkillEffects(skills);

  return `
    <div class="crew-skill-row">
      <span class="crew-skill-label">Pilot</span>
      <div class="crew-skill-bar-bg"><div class="crew-skill-bar-fill piloting" style="width:${p}%"></div></div>
      <span class="crew-skill-value">${p}</span>
    </div>
    <div class="crew-skill-effect">${pilotEffect}</div>
    <div class="crew-skill-row">
      <span class="crew-skill-label">Eng.</span>
      <div class="crew-skill-bar-bg"><div class="crew-skill-bar-fill engineering" style="width:${e}%"></div></div>
      <span class="crew-skill-value">${e}</span>
    </div>
    <div class="crew-skill-effect">${engEffect}</div>
    <div class="crew-skill-row">
      <span class="crew-skill-label">Science</span>
      <div class="crew-skill-bar-bg"><div class="crew-skill-bar-fill science" style="width:${s}%"></div></div>
      <span class="crew-skill-value">${s}</span>
    </div>
    <div class="crew-skill-effect">${sciEffect}</div>
  `;
}

// ---------------------------------------------------------------------------
// Crew row formatting (Active Crew tab)
// ---------------------------------------------------------------------------

/**
 * Discriminated union describing the status cell for one crew row.  The
 * DOM code dispatches on `kind` to decide which element tree to
 * construct.
 */
export type CrewStatusDisplay =
  | { kind: 'injured';  badgeText: string; remaining: number; medicalLabel: string }
  | { kind: 'training'; badgeText: string; skill: 'piloting' | 'engineering' | 'science'; periodsLeft: number }
  | { kind: 'ready' };

/**
 * The medical-care button label — upgraded at Crew Admin Tier 3+.
 */
export function getMedicalButtonLabel(crewAdminTier: number): string {
  return crewAdminTier >= 3 ? 'Adv. Medical' : 'Medical';
}

/**
 * Compute the number of periods remaining for a training course, clamped
 * to zero.  `trainingEnds` may be null when the crew member is not
 * training — callers should check that first, but a null value yields
 * zero defensively.
 */
export function computeTrainingRemaining(trainingEnds: number | null, currentPeriod: number): number {
  return Math.max(0, (trainingEnds ?? 0) - currentPeriod);
}

/**
 * Compute the number of flights remaining on an injury, allowing
 * negative values to surface (the original UI shows the raw delta so
 * the player can see overdue injuries; preserve that behaviour).
 */
export function computeInjuryRemaining(injuryEnds: number | null, currentPeriod: number): number {
  return (injuryEnds ?? 0) - currentPeriod;
}

/**
 * Classify the status cell for an active-crew row.  Pure — takes an
 * explicit `isInjured` flag so the caller (which owns access to game
 * state) can compute it however it likes.
 */
export function formatCrewStatus(
  astronaut: CrewMember,
  currentPeriod: number,
  isInjured: boolean,
  crewAdminTier: number,
): CrewStatusDisplay {
  if (isInjured) {
    const remaining: number = computeInjuryRemaining(astronaut.injuryEnds, currentPeriod);
    return {
      kind:         'injured',
      badgeText:    `Injured (${remaining} flights)`,
      remaining,
      medicalLabel: getMedicalButtonLabel(crewAdminTier),
    };
  }
  if (astronaut.trainingSkill) {
    const periodsLeft: number = computeTrainingRemaining(astronaut.trainingEnds, currentPeriod);
    return {
      kind:        'training',
      skill:       astronaut.trainingSkill,
      periodsLeft,
      badgeText:   `Training: ${astronaut.trainingSkill} (${periodsLeft} left)`,
    };
  }
  return { kind: 'ready' };
}

export interface CrewRowDisplay {
  name: string;
  skillsHTML: string;
  status: CrewStatusDisplay;
  missionsFlown: string;
  flightsFlown: string;
}

/**
 * Format the full display payload for a single row in the Active Crew
 * table.  The caller still owns the DOM construction, but every string
 * / classification shown in the row comes from here.
 */
export function formatCrewRow(
  astronaut: CrewMember,
  currentPeriod: number,
  isInjured: boolean,
  crewAdminTier: number,
): CrewRowDisplay {
  const skills: CrewSkills = astronaut.skills ?? { piloting: 0, engineering: 0, science: 0 };
  return {
    name:          astronaut.name,
    skillsHTML:    skillBarsHTML(skills),
    status:        formatCrewStatus(astronaut, currentPeriod, isInjured, crewAdminTier),
    missionsFlown: String(astronaut.missionsFlown),
    flightsFlown:  String(astronaut.flightsFlown),
  };
}

// ---------------------------------------------------------------------------
// Hire tab — capacity / cost checks
// ---------------------------------------------------------------------------

/**
 * True when the active crew count meets or exceeds the hard crew-size
 * cap.  Wraps the MAX_CREW_SIZE constant so the magic number can stop
 * travelling through the UI layer.
 */
export function isAtCrewCapacity(activeCrewCount: number): boolean {
  return activeCrewCount >= MAX_CREW_SIZE;
}

/**
 * True when the player's current funds cover a hire.  Separated out so
 * the UI can reuse the comparison when enabling / disabling controls.
 */
export function canAffordHire(cash: number, hireCost: number): boolean {
  return cash >= hireCost;
}

export interface HireTabState {
  cash: number;
  hireCost: number;
  canAfford: boolean;
  activeCrewCount: number;
  atCapacity: boolean;
}

/**
 * Aggregate the hire-tab scalar state used to drive cash display, the
 * capacity-full message, and the hire button's enabled state.
 */
export function computeHireTabState(
  cash: number,
  hireCost: number,
  activeCrewCount: number,
): HireTabState {
  return {
    cash,
    hireCost,
    canAfford:   canAffordHire(cash, hireCost),
    activeCrewCount,
    atCapacity:  isAtCrewCapacity(activeCrewCount),
  };
}
