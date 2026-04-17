/**
 * ui-crewAdminState.test.ts — Unit tests for crew-admin pure formatters /
 * classifiers extracted to `src/ui/crewAdmin/_state.ts`.
 *
 * Mirrors the style of ui-mainMenuState.test.ts and ui-hubState.test.ts.
 * Covers skill-effect computation, skill-bar HTML construction, crew
 * status classification, row formatting, medical-button labelling,
 * training / injury remaining counters, and hire-tab capacity / cost
 * aggregation.
 */

import { describe, it, expect } from 'vitest';
import {
  computeSkillEffects,
  skillBarsHTML,
  getMedicalButtonLabel,
  computeTrainingRemaining,
  computeInjuryRemaining,
  formatCrewStatus,
  formatCrewRow,
  isAtCrewCapacity,
  canAffordHire,
  computeHireTabState,
} from '../ui/crewAdmin/_state.ts';
import { MAX_CREW_SIZE, AstronautStatus } from '../core/constants.ts';
import type { CrewMember, CrewSkills } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkSkills(overrides: Partial<CrewSkills> = {}): CrewSkills {
  return { piloting: 0, engineering: 0, science: 0, ...overrides };
}

function mkCrew(overrides: Partial<CrewMember> = {}): CrewMember {
  const base: CrewMember = {
    id:               'crew-1',
    name:             'Ada Astra',
    status:           AstronautStatus.ACTIVE,
    skills:           mkSkills(),
    salary:           1000,
    hireDate:         '2026-01-01',
    missionsFlown:    0,
    flightsFlown:     0,
    deathDate:        null,
    deathCause:       null,
    assignedRocketId: null,
    injuryEnds:       null,
    trainingSkill:    null,
    trainingEnds:     null,
    stationedHubId:   'hub-1',
    transitUntil:     null,
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrewAdminState', () => {
  describe('computeSkillEffects()', () => {
    it('returns zero-valued effect strings for all-zero skills', () => {
      expect(computeSkillEffects(mkSkills())).toEqual({
        pilotEffect: '+0% turn rate',
        engEffect:   '60% part recovery',
        sciEffect:   '100% exp. time, +0% yield',
      });
    });

    it('returns max-valued effect strings for all-100 skills', () => {
      expect(computeSkillEffects(mkSkills({ piloting: 100, engineering: 100, science: 100 }))).toEqual({
        pilotEffect: '+30% turn rate',
        engEffect:   '80% part recovery',
        sciEffect:   '67% exp. time, +50% yield',
      });
    });

    it('rounds fractional skill values before computing effects', () => {
      // 49.4 rounds to 49 → +49*0.3 = 14.7 → "+15% turn rate"
      const out = computeSkillEffects(mkSkills({ piloting: 49.4, engineering: 50, science: 50 }));
      expect(out.pilotEffect).toBe('+15% turn rate');
      expect(out.engEffect).toBe('70% part recovery');
    });

    it('produces the mid-range science string', () => {
      const out = computeSkillEffects(mkSkills({ piloting: 0, engineering: 0, science: 50 }));
      expect(out.sciEffect).toBe('83% exp. time, +25% yield');
    });
  });

  describe('skillBarsHTML()', () => {
    it('embeds the rounded piloting / engineering / science numbers as the bar width', () => {
      const html = skillBarsHTML(mkSkills({ piloting: 30, engineering: 60, science: 90 }));
      expect(html).toContain('class="crew-skill-bar-fill piloting" style="width:30%"');
      expect(html).toContain('class="crew-skill-bar-fill engineering" style="width:60%"');
      expect(html).toContain('class="crew-skill-bar-fill science" style="width:90%"');
    });

    it('embeds the skill numeric values', () => {
      const html = skillBarsHTML(mkSkills({ piloting: 42, engineering: 17, science: 88 }));
      expect(html).toContain('<span class="crew-skill-value">42</span>');
      expect(html).toContain('<span class="crew-skill-value">17</span>');
      expect(html).toContain('<span class="crew-skill-value">88</span>');
    });

    it('embeds the computed effect strings', () => {
      const html = skillBarsHTML(mkSkills({ piloting: 100, engineering: 100, science: 100 }));
      expect(html).toContain('+30% turn rate');
      expect(html).toContain('80% part recovery');
      expect(html).toContain('67% exp. time, +50% yield');
    });

    it('rounds fractional skills before rendering bar width', () => {
      const html = skillBarsHTML(mkSkills({ piloting: 49.6, engineering: 0, science: 0 }));
      expect(html).toContain('style="width:50%"');
    });
  });

  describe('getMedicalButtonLabel()', () => {
    it('returns "Medical" below Crew Admin Tier 3', () => {
      expect(getMedicalButtonLabel(0)).toBe('Medical');
      expect(getMedicalButtonLabel(1)).toBe('Medical');
      expect(getMedicalButtonLabel(2)).toBe('Medical');
    });

    it('returns "Adv. Medical" at Crew Admin Tier 3 and above', () => {
      expect(getMedicalButtonLabel(3)).toBe('Adv. Medical');
      expect(getMedicalButtonLabel(4)).toBe('Adv. Medical');
    });
  });

  describe('computeTrainingRemaining()', () => {
    it('returns the delta between trainingEnds and the current period', () => {
      expect(computeTrainingRemaining(10, 3)).toBe(7);
    });

    it('clamps a negative delta to zero (training overdue)', () => {
      expect(computeTrainingRemaining(5, 10)).toBe(0);
    });

    it('treats a null trainingEnds as zero', () => {
      expect(computeTrainingRemaining(null, 0)).toBe(0);
      expect(computeTrainingRemaining(null, 5)).toBe(0);
    });

    it('returns zero when training completes exactly this period', () => {
      expect(computeTrainingRemaining(5, 5)).toBe(0);
    });
  });

  describe('computeInjuryRemaining()', () => {
    it('returns the delta between injuryEnds and the current period', () => {
      expect(computeInjuryRemaining(10, 3)).toBe(7);
    });

    it('allows a negative delta to surface (overdue injury)', () => {
      expect(computeInjuryRemaining(5, 10)).toBe(-5);
    });

    it('treats a null injuryEnds as zero', () => {
      expect(computeInjuryRemaining(null, 0)).toBe(0);
      expect(computeInjuryRemaining(null, 4)).toBe(-4);
    });
  });

  describe('formatCrewStatus()', () => {
    it('returns an injured payload when isInjured is true', () => {
      const crew = mkCrew({ injuryEnds: 10 });
      const out = formatCrewStatus(crew, 3, true, 0);
      expect(out).toEqual({
        kind:         'injured',
        badgeText:    'Injured (7 flights)',
        remaining:    7,
        medicalLabel: 'Medical',
      });
    });

    it('uses "Adv. Medical" when crewAdminTier >= 3', () => {
      const crew = mkCrew({ injuryEnds: 5 });
      const out = formatCrewStatus(crew, 2, true, 3);
      expect(out).toEqual({
        kind:         'injured',
        badgeText:    'Injured (3 flights)',
        remaining:    3,
        medicalLabel: 'Adv. Medical',
      });
    });

    it('returns a training payload when the crew member is training', () => {
      const crew = mkCrew({ trainingSkill: 'engineering', trainingEnds: 8 });
      const out = formatCrewStatus(crew, 3, false, 0);
      expect(out).toEqual({
        kind:        'training',
        skill:       'engineering',
        periodsLeft: 5,
        badgeText:   'Training: engineering (5 left)',
      });
    });

    it('prefers injury over training when both apply', () => {
      const crew = mkCrew({
        injuryEnds:    10,
        trainingSkill: 'science',
        trainingEnds:  8,
      });
      const out = formatCrewStatus(crew, 3, true, 0);
      expect(out.kind).toBe('injured');
    });

    it('returns a ready payload when neither injured nor training', () => {
      const crew = mkCrew();
      expect(formatCrewStatus(crew, 0, false, 0)).toEqual({ kind: 'ready' });
    });
  });

  describe('formatCrewRow()', () => {
    it('formats the full display payload for a ready crew member', () => {
      const crew = mkCrew({
        name:          'Ada',
        missionsFlown: 3,
        flightsFlown:  7,
        skills:        mkSkills({ piloting: 40, engineering: 50, science: 60 }),
      });
      const row = formatCrewRow(crew, 0, false, 0);
      expect(row.name).toBe('Ada');
      expect(row.missionsFlown).toBe('3');
      expect(row.flightsFlown).toBe('7');
      expect(row.status).toEqual({ kind: 'ready' });
      expect(row.skillsHTML).toContain('style="width:40%"');
      expect(row.skillsHTML).toContain('style="width:50%"');
      expect(row.skillsHTML).toContain('style="width:60%"');
    });

    it('delegates status classification to formatCrewStatus', () => {
      const crew = mkCrew({ trainingSkill: 'piloting', trainingEnds: 6 });
      const row = formatCrewRow(crew, 2, false, 0);
      expect(row.status).toEqual({
        kind:        'training',
        skill:       'piloting',
        periodsLeft: 4,
        badgeText:   'Training: piloting (4 left)',
      });
    });

    it('falls back to zero skills when the crew member has no skills object', () => {
      // CrewMember.skills is typed required, but the reducer defends
      // against legacy saves via `astronaut.skills ?? {…}`.  Force the
      // undefined path through a cast so we exercise the fallback.
      const crew = mkCrew();
      (crew as { skills?: CrewSkills }).skills = undefined;
      const row = formatCrewRow(crew, 0, false, 0);
      expect(row.skillsHTML).toContain('style="width:0%"');
    });
  });

  describe('isAtCrewCapacity()', () => {
    it('returns false below the cap', () => {
      expect(isAtCrewCapacity(0)).toBe(false);
      expect(isAtCrewCapacity(MAX_CREW_SIZE - 1)).toBe(false);
    });

    it('returns true at the cap', () => {
      expect(isAtCrewCapacity(MAX_CREW_SIZE)).toBe(true);
    });

    it('returns true above the cap', () => {
      expect(isAtCrewCapacity(MAX_CREW_SIZE + 5)).toBe(true);
    });
  });

  describe('canAffordHire()', () => {
    it('returns true when cash exceeds the hire cost', () => {
      expect(canAffordHire(5000, 1000)).toBe(true);
    });

    it('returns true when cash exactly equals the hire cost', () => {
      expect(canAffordHire(1000, 1000)).toBe(true);
    });

    it('returns false when cash is below the hire cost', () => {
      expect(canAffordHire(500, 1000)).toBe(false);
    });

    it('returns false when cash is negative', () => {
      expect(canAffordHire(-100, 0)).toBe(false);
    });
  });

  describe('computeHireTabState()', () => {
    it('aggregates affordability and capacity flags', () => {
      const state = computeHireTabState(5000, 2000, 3);
      expect(state).toEqual({
        cash:            5000,
        hireCost:        2000,
        canAfford:       true,
        activeCrewCount: 3,
        atCapacity:      false,
      });
    });

    it('reports canAfford=false when cash is below cost', () => {
      const state = computeHireTabState(500, 2000, 3);
      expect(state.canAfford).toBe(false);
      expect(state.atCapacity).toBe(false);
    });

    it('reports atCapacity=true at the crew cap', () => {
      const state = computeHireTabState(10_000, 1000, MAX_CREW_SIZE);
      expect(state.atCapacity).toBe(true);
      expect(state.canAfford).toBe(true);
    });

    it('reports both flags independently', () => {
      const state = computeHireTabState(100, 1000, MAX_CREW_SIZE + 1);
      expect(state.canAfford).toBe(false);
      expect(state.atCapacity).toBe(true);
    });
  });
});
