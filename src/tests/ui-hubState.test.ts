/**
 * ui-hubState.test.ts — Unit tests for hub pure formatters / classifiers.
 *
 * Mirrors ui-vabState.test.ts and ui-topbarState.test.ts style.  Covers
 * getMissionRewardTotal, formatReturnResults (per-row behaviour and
 * omission of zero amounts), formatNetCashChange (positive / negative /
 * zero cases, rounding, unicode minus), classifyFacilityAction (every
 * branch), formatBuildCost (free / plain / discounted) and
 * formatUpgradeAction (enabled / disabled tooltip behaviour).
 */

import { describe, it, expect } from 'vitest';
import {
  getMissionRewardTotal,
  formatReturnResults,
  formatNetCashChange,
  classifyFacilityAction,
  formatBuildCost,
  formatUpgradeAction,
} from '../ui/hub/_state.ts';
import type { FlightReturnSummary, CompletedMissionEntry } from '../core/flightReturn.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mkMissionEntry(reward: number): CompletedMissionEntry {
  return {
    mission:               { id: 'stub' } as CompletedMissionEntry['mission'],
    reward,
    unlockedParts:         [],
    newlyAvailableMissions: [],
  };
}

function mkSummary(overrides: Partial<FlightReturnSummary> = {}): FlightReturnSummary {
  const base: FlightReturnSummary = {
    completedMissions:     [],
    recoveryValue:         0,
    interestCharged:       0,
    loanBalance:           0,
    deathFineTotal:        0,
    operatingCosts:        0,
    crewSalaryCost:        0,
    facilityUpkeep:        0,
    activeCrewCount:       0,
    netCashChange:         0,
    totalFlights:          0,
    currentPeriod:         0,
    expiredMissionIds:     [],
    completedContracts:    [],
    newContracts:          [],
    bankrupt:              false,
    deployedSatellites:    [],
    crewXPGains:           [],
    crewInjuries:          [],
    recoveredParts:        [],
    reputationChange:      0,
    reputationAfter:       50,
    samplesReturned:       0,
    sampleScienceEarned:   0,
    newAchievements:       [],
    deployedFieldCraft:    null,
    lifeSupportWarnings:   [],
    lifeSupportDeaths:     [],
    challengeResult:       { completed: false },
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HubState', () => {
  describe('getMissionRewardTotal()', () => {
    it('returns 0 when no missions completed', () => {
      expect(getMissionRewardTotal(mkSummary())).toBe(0);
    });

    it('sums the rewards of all completed missions', () => {
      const summary = mkSummary({
        completedMissions: [mkMissionEntry(1000), mkMissionEntry(2500), mkMissionEntry(500)],
      });
      expect(getMissionRewardTotal(summary)).toBe(4000);
    });

    it('ignores zero-reward entries correctly', () => {
      const summary = mkSummary({
        completedMissions: [mkMissionEntry(0), mkMissionEntry(750)],
      });
      expect(getMissionRewardTotal(summary)).toBe(750);
    });
  });

  describe('formatReturnResults()', () => {
    it('returns an empty list when all amounts are zero', () => {
      expect(formatReturnResults(mkSummary())).toEqual([]);
    });

    it('emits a positive Mission rewards row when total > 0', () => {
      const rows = formatReturnResults(mkSummary({
        completedMissions: [mkMissionEntry(1_500)],
      }));
      expect(rows).toEqual([
        { label: 'Mission rewards', value: '+$1,500', tone: 'positive' },
      ]);
    });

    it('emits a positive Part recovery row with the 60% label when recoveryValue > 0', () => {
      const rows = formatReturnResults(mkSummary({ recoveryValue: 2_400 }));
      expect(rows).toEqual([
        { label: 'Part recovery (60 %)', value: '+$2,400', tone: 'positive' },
      ]);
    });

    it('emits a Loan interest row without balance when loanBalance is 0', () => {
      const rows = formatReturnResults(mkSummary({ interestCharged: 250, loanBalance: 0 }));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        label: 'Loan interest',
        value: '−$250',
        tone:  'negative',
      });
    });

    it('emits a Loan interest row with balance note when loanBalance > 0', () => {
      const rows = formatReturnResults(mkSummary({
        interestCharged: 250,
        loanBalance:     10_000,
      }));
      expect(rows).toHaveLength(1);
      expect(rows[0].label).toBe('Loan interest (balance: $10,000)');
      expect(rows[0].value).toBe('−$250');
      expect(rows[0].tone).toBe('negative');
    });

    it('rounds non-integer interest', () => {
      const rows = formatReturnResults(mkSummary({ interestCharged: 249.6, loanBalance: 0 }));
      expect(rows[0].value).toBe('−$250');
    });

    it('emits a Crew death fines row when deathFineTotal > 0', () => {
      const rows = formatReturnResults(mkSummary({ deathFineTotal: 20_000 }));
      expect(rows).toEqual([
        { label: 'Crew death fines', value: '−$20,000', tone: 'negative' },
      ]);
    });

    it('omits operating cost rows when operatingCosts is 0', () => {
      const rows = formatReturnResults(mkSummary({
        operatingCosts:  0,
        crewSalaryCost:  5_000,  // ignored because operatingCosts is 0
        facilityUpkeep:  3_000,
        activeCrewCount: 2,
      }));
      expect(rows).toEqual([]);
    });

    it('emits singular crew salary row for exactly 1 astronaut', () => {
      const rows = formatReturnResults(mkSummary({
        operatingCosts:  5_000,
        crewSalaryCost:  5_000,
        activeCrewCount: 1,
      }));
      expect(rows).toEqual([
        { label: 'Crew salaries (1 astronaut)', value: '−$5,000', tone: 'negative' },
      ]);
    });

    it('emits plural crew salary row for multiple astronauts', () => {
      const rows = formatReturnResults(mkSummary({
        operatingCosts:  12_000,
        crewSalaryCost:  12_000,
        activeCrewCount: 3,
      }));
      expect(rows[0].label).toBe('Crew salaries (3 astronauts)');
    });

    it('emits a Facility upkeep row when upkeep > 0', () => {
      const rows = formatReturnResults(mkSummary({
        operatingCosts:  2_500,
        facilityUpkeep:  2_500,
      }));
      expect(rows).toContainEqual({
        label: 'Facility upkeep',
        value: '−$2,500',
        tone:  'negative',
      });
    });

    it('emits both crew and facility rows when both are present', () => {
      const rows = formatReturnResults(mkSummary({
        operatingCosts:  8_500,
        crewSalaryCost:  6_000,
        facilityUpkeep:  2_500,
        activeCrewCount: 2,
      }));
      expect(rows.map((r) => r.label)).toEqual([
        'Crew salaries (2 astronauts)',
        'Facility upkeep',
      ]);
    });

    it('produces rows in the canonical order: rewards, recovery, interest, fines, crew, upkeep', () => {
      const rows = formatReturnResults(mkSummary({
        completedMissions: [mkMissionEntry(5_000)],
        recoveryValue:     1_000,
        interestCharged:   200,
        loanBalance:       0,
        deathFineTotal:    1_500,
        operatingCosts:    8_000,
        crewSalaryCost:    6_000,
        facilityUpkeep:    2_000,
        activeCrewCount:   2,
      }));
      expect(rows.map((r) => r.label)).toEqual([
        'Mission rewards',
        'Part recovery (60 %)',
        'Loan interest',
        'Crew death fines',
        'Crew salaries (2 astronauts)',
        'Facility upkeep',
      ]);
    });
  });

  describe('formatNetCashChange()', () => {
    it('formats a positive change with +', () => {
      expect(formatNetCashChange(1_234)).toEqual({
        label:    'Net cash change',
        value:    '+$1,234',
        positive: true,
      });
    });

    it('formats zero as positive', () => {
      expect(formatNetCashChange(0)).toEqual({
        label:    'Net cash change',
        value:    '+$0',
        positive: true,
      });
    });

    it('formats a negative change with the unicode minus', () => {
      expect(formatNetCashChange(-5_000)).toEqual({
        label:    'Net cash change',
        value:    '−$5,000',
        positive: false,
      });
    });

    it('rounds fractional amounts', () => {
      expect(formatNetCashChange(1999.4).value).toBe('+$1,999');
      expect(formatNetCashChange(1999.6).value).toBe('+$2,000');
      expect(formatNetCashChange(-1999.6).value).toBe('−$2,000');
    });
  });

  describe('classifyFacilityAction()', () => {
    it('returns upgrade when built and nextTier > 0', () => {
      expect(classifyFacilityAction(true, true, 2, false)).toBe('upgrade');
      expect(classifyFacilityAction(true, false, 1, false)).toBe('upgrade');
    });

    it('returns max-tier when built, no next tier, but upgrade def exists', () => {
      expect(classifyFacilityAction(true, true, 0, false)).toBe('max-tier');
    });

    it('returns built when built, no next tier, no upgrade def', () => {
      expect(classifyFacilityAction(true, false, 0, false)).toBe('built');
    });

    it('returns locked when not built and tutorial mode is active', () => {
      expect(classifyFacilityAction(false, false, 0, true)).toBe('locked');
      expect(classifyFacilityAction(false, true, 2, true)).toBe('locked');
    });

    it('returns build when not built and tutorial mode is inactive', () => {
      expect(classifyFacilityAction(false, false, 0, false)).toBe('build');
      expect(classifyFacilityAction(false, true, 3, false)).toBe('build');
    });

    it('tutorialMode has no effect once the facility is built', () => {
      expect(classifyFacilityAction(true, false, 0, true)).toBe('built');
      expect(classifyFacilityAction(true, true, 2, true)).toBe('upgrade');
    });
  });

  describe('formatBuildCost()', () => {
    it('returns Free when baseCost is 0', () => {
      expect(formatBuildCost(0, 0)).toEqual({
        costLabel:     'Free',
        isFree:        true,
        hasDiscount:   false,
        discountNote:  null,
      });
    });

    it('returns the discounted cost label when base == discounted', () => {
      expect(formatBuildCost(50_000, 50_000)).toEqual({
        costLabel:     '$50,000',
        isFree:        false,
        hasDiscount:   false,
        discountNote:  null,
      });
    });

    it('returns discount info when discountedCost < baseCost', () => {
      expect(formatBuildCost(100_000, 85_000)).toEqual({
        costLabel:     '$85,000',
        isFree:        false,
        hasDiscount:   true,
        discountNote:  '(was $100,000)',
      });
    });

    it('does not treat a higher discounted cost as a discount', () => {
      // Defensive: if the caller passes an inverted pair, we should not claim
      // a discount.
      const out = formatBuildCost(50_000, 60_000);
      expect(out.hasDiscount).toBe(false);
      expect(out.discountNote).toBeNull();
      expect(out.costLabel).toBe('$60,000');
    });
  });

  describe('formatUpgradeAction()', () => {
    it('returns the tier in the button label', () => {
      expect(formatUpgradeAction(2, true, '').buttonLabel).toBe('Upgrade to Tier 2');
      expect(formatUpgradeAction(5, true, '').buttonLabel).toBe('Upgrade to Tier 5');
    });

    it('emits no tooltip when allowed', () => {
      expect(formatUpgradeAction(2, true, 'some reason')).toEqual({
        buttonLabel:     'Upgrade to Tier 2',
        enabled:         true,
        disabledTooltip: null,
      });
    });

    it('emits the reason as tooltip when not allowed', () => {
      expect(formatUpgradeAction(3, false, 'Insufficient funds')).toEqual({
        buttonLabel:     'Upgrade to Tier 3',
        enabled:         false,
        disabledTooltip: 'Insufficient funds',
      });
    });
  });
});
