/**
 * reputation.test.ts — Unit tests for the agency reputation system.
 *
 * Tests cover:
 *   - Reputation tier lookup (getReputationTier)
 *   - Facility discount (getReputationDiscount) by tier
 *   - Crew cost modifier (getCrewCostModifier) by tier
 *   - adjustReputation() clamping
 *   - Flight-return reputation events (crew death, safe return, failure, destruction)
 *   - Crew hiring cost adjusted by reputation
 */

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import {
  STARTING_REPUTATION,
  getReputationTier,
  getReputationDiscount,
  getCrewCostModifier,
  REPUTATION_TIERS,
  HIRE_COST,
  REP_GAIN_SAFE_CREW_RETURN,
  REP_LOSS_CREW_DEATH,
  REP_LOSS_MISSION_FAILURE,
  REP_LOSS_ROCKET_DESTRUCTION,
  REP_GAIN_MILESTONE,
} from '../core/constants.ts';
import {
  adjustReputation,
  applyCrewDeathReputation,
  applySafeCrewReturnReputation,
  applyMissionFailureReputation,
  applyRocketDestructionReputation,
  applyMilestoneReputation,
} from '../core/reputation.ts';
import { getAdjustedHireCost } from '../core/crew.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  return createGameState();
}

// ---------------------------------------------------------------------------
// Reputation tier lookup
// ---------------------------------------------------------------------------

describe('getReputationTier', () => {
  it('returns Basic for reputation 0–20', () => {
    expect(getReputationTier(0).label).toBe('Basic');
    expect(getReputationTier(10).label).toBe('Basic');
    expect(getReputationTier(20).label).toBe('Basic');
  });

  it('returns Standard for reputation 21–40', () => {
    expect(getReputationTier(21).label).toBe('Standard');
    expect(getReputationTier(30).label).toBe('Standard');
    expect(getReputationTier(40).label).toBe('Standard');
  });

  it('returns Good for reputation 41–60', () => {
    expect(getReputationTier(41).label).toBe('Good');
    expect(getReputationTier(50).label).toBe('Good');
    expect(getReputationTier(60).label).toBe('Good');
  });

  it('returns Premium for reputation 61–80', () => {
    expect(getReputationTier(61).label).toBe('Premium');
    expect(getReputationTier(70).label).toBe('Premium');
    expect(getReputationTier(80).label).toBe('Premium');
  });

  it('returns Elite for reputation 81–100', () => {
    expect(getReputationTier(81).label).toBe('Elite');
    expect(getReputationTier(90).label).toBe('Elite');
    expect(getReputationTier(100).label).toBe('Elite');
  });

  it('clamps out-of-range values', () => {
    expect(getReputationTier(-10).label).toBe('Basic');
    expect(getReputationTier(150).label).toBe('Elite');
  });
});

// ---------------------------------------------------------------------------
// Facility discount by tier
// ---------------------------------------------------------------------------

describe('getReputationDiscount (tier-based)', () => {
  it('returns 0 for Basic tier (0–20)', () => {
    expect(getReputationDiscount(10)).toBe(0);
  });

  it('returns 0 for Standard tier (21–40)', () => {
    expect(getReputationDiscount(30)).toBe(0);
  });

  it('returns 0.05 for Good tier (41–60)', () => {
    expect(getReputationDiscount(50)).toBe(0.05);
  });

  it('returns 0.10 for Premium tier (61–80)', () => {
    expect(getReputationDiscount(70)).toBe(0.10);
  });

  it('returns 0.15 for Elite tier (81–100)', () => {
    expect(getReputationDiscount(90)).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// Crew cost modifier by tier
// ---------------------------------------------------------------------------

describe('getCrewCostModifier', () => {
  it('returns 1.50 for Basic tier (+50%)', () => {
    expect(getCrewCostModifier(10)).toBe(1.50);
  });

  it('returns 1.25 for Standard tier (+25%)', () => {
    expect(getCrewCostModifier(30)).toBe(1.25);
  });

  it('returns 1.00 for Good tier (normal)', () => {
    expect(getCrewCostModifier(50)).toBe(1.00);
  });

  it('returns 0.90 for Premium tier (−10%)', () => {
    expect(getCrewCostModifier(70)).toBe(0.90);
  });

  it('returns 0.75 for Elite tier (−25%)', () => {
    expect(getCrewCostModifier(90)).toBe(0.75);
  });
});

// ---------------------------------------------------------------------------
// adjustReputation — clamping
// ---------------------------------------------------------------------------

describe('adjustReputation', () => {
  it('increases reputation within bounds', () => {
    const state = freshState();
    state.reputation = 50;
    adjustReputation(state, 10);
    expect(state.reputation).toBe(60);
  });

  it('decreases reputation within bounds', () => {
    const state = freshState();
    state.reputation = 50;
    adjustReputation(state, -20);
    expect(state.reputation).toBe(30);
  });

  it('clamps to 0 when going negative', () => {
    const state = freshState();
    state.reputation = 5;
    adjustReputation(state, -20);
    expect(state.reputation).toBe(0);
  });

  it('clamps to 100 when exceeding max', () => {
    const state = freshState();
    state.reputation = 95;
    adjustReputation(state, 20);
    expect(state.reputation).toBe(100);
  });

  it('returns the new reputation value', () => {
    const state = freshState();
    state.reputation = 50;
    const result = adjustReputation(state, 5);
    expect(result).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Flight-return reputation events
// ---------------------------------------------------------------------------

describe('applyCrewDeathReputation', () => {
  it('@smoke applies −10 per crew death', () => {
    const state = freshState();
    state.reputation = 50;
    const delta = applyCrewDeathReputation(state, 2);
    expect(delta).toBe(-20);
    expect(state.reputation).toBe(30);
  });

  it('does nothing for 0 deaths', () => {
    const state = freshState();
    state.reputation = 50;
    const delta = applyCrewDeathReputation(state, 0);
    expect(delta).toBe(0);
    expect(state.reputation).toBe(50);
  });
});

describe('applySafeCrewReturnReputation', () => {
  it('applies +1 per surviving crew member', () => {
    const state = freshState();
    state.reputation = 50;
    const delta = applySafeCrewReturnReputation(state, 3);
    expect(delta).toBe(3);
    expect(state.reputation).toBe(53);
  });

  it('does nothing for 0 surviving crew', () => {
    const state = freshState();
    state.reputation = 50;
    const delta = applySafeCrewReturnReputation(state, 0);
    expect(delta).toBe(0);
    expect(state.reputation).toBe(50);
  });
});

describe('applyMissionFailureReputation', () => {
  it('applies −3 for mission failure', () => {
    const state = freshState();
    state.reputation = 50;
    const delta = applyMissionFailureReputation(state);
    expect(delta).toBe(-3);
    expect(state.reputation).toBe(47);
  });
});

describe('applyRocketDestructionReputation', () => {
  it('applies −2 for rocket destruction', () => {
    const state = freshState();
    state.reputation = 50;
    const delta = applyRocketDestructionReputation(state);
    expect(delta).toBe(-2);
    expect(state.reputation).toBe(48);
  });
});

describe('applyMilestoneReputation', () => {
  it('applies +10 for milestone', () => {
    const state = freshState();
    state.reputation = 50;
    const delta = applyMilestoneReputation(state);
    expect(delta).toBe(10);
    expect(state.reputation).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// Crew hiring cost adjusted by reputation
// ---------------------------------------------------------------------------

describe('getAdjustedHireCost', () => {
  it('costs $75,000 at Basic reputation (0–20)', () => {
    expect(getAdjustedHireCost(10)).toBe(Math.floor(HIRE_COST * 1.50));
  });

  it('costs $62,500 at Standard reputation (21–40)', () => {
    expect(getAdjustedHireCost(30)).toBe(Math.floor(HIRE_COST * 1.25));
  });

  it('costs $50,000 at Good reputation (41–60)', () => {
    expect(getAdjustedHireCost(50)).toBe(Math.floor(HIRE_COST * 1.00));
  });

  it('costs $45,000 at Premium reputation (61–80)', () => {
    expect(getAdjustedHireCost(70)).toBe(Math.floor(HIRE_COST * 0.90));
  });

  it('costs $37,500 at Elite reputation (81–100)', () => {
    expect(getAdjustedHireCost(90)).toBe(Math.floor(HIRE_COST * 0.75));
  });
});

// ---------------------------------------------------------------------------
// Starting reputation
// ---------------------------------------------------------------------------

describe('starting reputation', () => {
  it('starts at 50', () => {
    const state = freshState();
    expect(state.reputation).toBe(STARTING_REPUTATION);
    expect(state.reputation).toBe(50);
  });

  it('starts in the Good tier', () => {
    const state = freshState();
    expect(getReputationTier(state.reputation).label).toBe('Good');
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe('reputation constants', () => {
  it('has 5 tiers covering 0–100', () => {
    expect(REPUTATION_TIERS).toHaveLength(5);
    expect(REPUTATION_TIERS[0].min).toBe(0);
    expect(REPUTATION_TIERS[4].max).toBe(100);
  });

  it('tiers are contiguous', () => {
    for (let i = 1; i < REPUTATION_TIERS.length; i++) {
      expect(REPUTATION_TIERS[i].min).toBe(REPUTATION_TIERS[i - 1].max + 1);
    }
  });

  it('has correct event deltas', () => {
    expect(REP_GAIN_SAFE_CREW_RETURN).toBe(1);
    expect(REP_LOSS_CREW_DEATH).toBe(10);
    expect(REP_LOSS_MISSION_FAILURE).toBe(3);
    expect(REP_LOSS_ROCKET_DESTRUCTION).toBe(2);
    expect(REP_GAIN_MILESTONE).toBe(10);
  });
});
