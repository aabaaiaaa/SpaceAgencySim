/**
 * finance.test.js — Unit tests for the financial system.
 *
 * Tests cover:
 *   - applyInterest()    — compounds loan balance at the state's interest rate
 *   - payDownLoan()      — reduces balance and cash; clamps to available funds
 *   - borrowMore()       — increases balance and cash; enforces $10M cap
 *   - spend()            — deducts cash; rejects transactions that exceed balance
 *   - earn()             — adds cash to the balance
 *   - applyDeathFine()   — deducts $500k per KIA; can drive cash negative
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import {
  applyInterest,
  payDownLoan,
  borrowMore,
  spend,
  earn,
  applyDeathFine,
} from '../core/finance.ts';
import {
  STARTING_MONEY,
  STARTING_LOAN_BALANCE,
  DEFAULT_LOAN_INTEREST_RATE,
  DEATH_FINE_PER_ASTRONAUT,
  MAX_LOAN_BALANCE,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh state with the default starting values. */
function freshState(): GameState {
  return createGameState();
}

// ---------------------------------------------------------------------------
// Verify starting constants match task specification
// ---------------------------------------------------------------------------

describe('Financial starting constants', () => {
  it('STARTING_MONEY is $2,000,000', () => {
    expect(STARTING_MONEY).toBe(2_000_000);
  });

  it('STARTING_LOAN_BALANCE is $2,000,000', () => {
    expect(STARTING_LOAN_BALANCE).toBe(2_000_000);
  });

  it('DEFAULT_LOAN_INTEREST_RATE is 3%', () => {
    expect(DEFAULT_LOAN_INTEREST_RATE).toBeCloseTo(0.03);
  });

  it('DEATH_FINE_PER_ASTRONAUT is $500,000', () => {
    expect(DEATH_FINE_PER_ASTRONAUT).toBe(500_000);
  });

  it('MAX_LOAN_BALANCE is $10,000,000', () => {
    expect(MAX_LOAN_BALANCE).toBe(10_000_000);
  });

  it('new game state has correct starting cash and loan', () => {
    const state = freshState();
    expect(state.money).toBe(STARTING_MONEY);
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE);
  });
});

// ---------------------------------------------------------------------------
// applyInterest
// ---------------------------------------------------------------------------

describe('applyInterest()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('deducts interest from cash when cash covers it fully', () => {
    // balance=2M, cash=2M, rate=3% → interest=60k
    applyInterest(state);
    expect(state.money).toBeCloseTo(2_000_000 - 60_000);
    expect(state.loan.balance).toBe(2_000_000);
    expect(state.loan.totalInterestAccrued).toBeCloseTo(60_000);
  });

  it('does not increase loan balance when cash covers interest', () => {
    applyInterest(state);
    expect(state.loan.balance).toBe(2_000_000);
  });

  it('uses the rate stored in state.loan.interestRate', () => {
    state.loan.balance = 1_000_000;
    state.money = 2_000_000;
    state.loan.interestRate = 0.10;             // 10% custom rate
    applyInterest(state);
    expect(state.money).toBeCloseTo(1_900_000);
    expect(state.loan.balance).toBe(1_000_000);
  });

  it('@smoke adds shortfall to balance when cash is insufficient', () => {
    state.loan.balance = 2_000_000;
    state.money = 30_000;
    state.loan.interestRate = 0.03;             // interest = 60k
    applyInterest(state);
    expect(state.money).toBe(0);
    expect(state.loan.balance).toBeCloseTo(2_030_000);
  });

  it('adds all interest to balance when cash is zero', () => {
    state.loan.balance = 2_000_000;
    state.money = 0;
    state.loan.interestRate = 0.03;
    applyInterest(state);
    expect(state.money).toBe(0);
    expect(state.loan.balance).toBeCloseTo(2_060_000);
  });

  it('handles negative cash (from death fines) without deducting more', () => {
    state.loan.balance = 2_000_000;
    state.money = -100_000;
    state.loan.interestRate = 0.03;
    applyInterest(state);
    expect(state.money).toBe(-100_000);
    expect(state.loan.balance).toBeCloseTo(2_060_000);
  });

  it('leaves a zero balance at zero', () => {
    state.loan.balance = 0;
    state.money = 2_000_000;
    applyInterest(state);
    expect(state.loan.balance).toBe(0);
    expect(state.money).toBe(2_000_000);
  });

  it('tracks totalInterestAccrued across multiple calls', () => {
    state.loan.balance = 1_000_000;
    state.money = 2_000_000;
    state.loan.interestRate = 0.03;
    applyInterest(state);
    applyInterest(state);
    expect(state.loan.totalInterestAccrued).toBeCloseTo(60_000);
  });
});

// ---------------------------------------------------------------------------
// payDownLoan
// ---------------------------------------------------------------------------

describe('payDownLoan()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('reduces both loan balance and cash by the paid amount', () => {
    const result = payDownLoan(state, 500_000);
    expect(result.paid).toBe(500_000);
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE - 500_000);
    expect(state.money).toBe(STARTING_MONEY - 500_000);
  });

  it('returns newBalance and newCash matching state', () => {
    const result = payDownLoan(state, 200_000);
    expect(result.newBalance).toBe(state.loan.balance);
    expect(result.newCash).toBe(state.money);
  });

  it('clamps to the loan balance — cannot overpay', () => {
    state.loan.balance = 100_000;
    state.money = 5_000_000;
    const result = payDownLoan(state, 999_999);
    expect(result.paid).toBe(100_000);
    expect(state.loan.balance).toBe(0);
  });

  it('clamps to available cash — cannot pay more than you have', () => {
    state.money = 50_000;
    state.loan.balance = 2_000_000;
    const result = payDownLoan(state, 500_000);
    expect(result.paid).toBe(50_000);
    expect(state.money).toBe(0);
    expect(state.loan.balance).toBe(1_950_000);
  });

  it('pays nothing when cash is 0', () => {
    state.money = 0;
    const result = payDownLoan(state, 100_000);
    expect(result.paid).toBe(0);
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE);
  });

  it('pays nothing when balance is already 0', () => {
    state.loan.balance = 0;
    const result = payDownLoan(state, 100_000);
    expect(result.paid).toBe(0);
    expect(state.money).toBe(STARTING_MONEY);
  });
});

// ---------------------------------------------------------------------------
// borrowMore
// ---------------------------------------------------------------------------

describe('borrowMore()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('increases loan balance and cash by the borrowed amount', () => {
    const result = borrowMore(state, 500_000);
    expect(result.borrowed).toBe(500_000);
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE + 500_000);
    expect(state.money).toBe(STARTING_MONEY + 500_000);
  });

  it('returns newBalance and newCash matching state', () => {
    const result = borrowMore(state, 100_000);
    expect(result.newBalance).toBe(state.loan.balance);
    expect(result.newCash).toBe(state.money);
  });

  it('caps total balance at MAX_LOAN_BALANCE', () => {
    state.loan.balance = 9_800_000;
    state.money = 100_000;
    const result = borrowMore(state, 1_000_000);
    expect(result.borrowed).toBe(200_000);
    expect(state.loan.balance).toBe(MAX_LOAN_BALANCE);
  });

  it('borrows nothing when already at the cap', () => {
    state.loan.balance = MAX_LOAN_BALANCE;
    const result = borrowMore(state, 500_000);
    expect(result.borrowed).toBe(0);
    expect(state.loan.balance).toBe(MAX_LOAN_BALANCE);
  });

  it('allows borrowing from $0 balance up to the full cap', () => {
    state.loan.balance = 0;
    state.money = 0;
    const result = borrowMore(state, MAX_LOAN_BALANCE);
    expect(result.borrowed).toBe(MAX_LOAN_BALANCE);
    expect(state.loan.balance).toBe(MAX_LOAN_BALANCE);
    expect(state.money).toBe(MAX_LOAN_BALANCE);
  });
});

// ---------------------------------------------------------------------------
// spend
// ---------------------------------------------------------------------------

describe('spend()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('deducts the amount from cash and returns true on success', () => {
    const ok = spend(state, 300_000);
    expect(ok).toBe(true);
    expect(state.money).toBe(STARTING_MONEY - 300_000);
  });

  it('returns false and does not modify state when funds are insufficient', () => {
    state.money = 100_000;
    const ok = spend(state, 200_000);
    expect(ok).toBe(false);
    expect(state.money).toBe(100_000);
  });

  it('allows spending the exact cash balance', () => {
    state.money = 500_000;
    const ok = spend(state, 500_000);
    expect(ok).toBe(true);
    expect(state.money).toBe(0);
  });

  it('rejects spending $1 more than the balance', () => {
    state.money = 500_000;
    expect(spend(state, 500_001)).toBe(false);
    expect(state.money).toBe(500_000);
  });

  it('returns false when cash is already 0', () => {
    state.money = 0;
    expect(spend(state, 1)).toBe(false);
  });

  it('does not change the loan balance', () => {
    spend(state, 100_000);
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE);
  });
});

// ---------------------------------------------------------------------------
// earn
// ---------------------------------------------------------------------------

describe('earn()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('adds amount to cash', () => {
    earn(state, 750_000);
    expect(state.money).toBe(STARTING_MONEY + 750_000);
  });

  it('can earn from a zero balance', () => {
    state.money = 0;
    earn(state, 1_000);
    expect(state.money).toBe(1_000);
  });

  it('does not affect the loan balance', () => {
    earn(state, 999_999);
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE);
  });

  it('accumulates across multiple calls', () => {
    earn(state, 100_000);
    earn(state, 200_000);
    earn(state, 300_000);
    expect(state.money).toBe(STARTING_MONEY + 600_000);
  });
});

// ---------------------------------------------------------------------------
// applyDeathFine
// ---------------------------------------------------------------------------

describe('applyDeathFine()', () => {
  let state: GameState;
  beforeEach(() => { state = freshState(); });

  it('deducts $500,000 per astronaut killed', () => {
    applyDeathFine(state, 1);
    expect(state.money).toBe(STARTING_MONEY - DEATH_FINE_PER_ASTRONAUT);
  });

  it('scales linearly with killed count', () => {
    applyDeathFine(state, 3);
    expect(state.money).toBe(STARTING_MONEY - 3 * DEATH_FINE_PER_ASTRONAUT);
  });

  it('can drive cash negative (fine is mandatory)', () => {
    state.money = 100_000;
    applyDeathFine(state, 1);
    expect(state.money).toBe(100_000 - DEATH_FINE_PER_ASTRONAUT);
    expect(state.money).toBeLessThan(0);
  });

  it('does nothing when killedCount is 0', () => {
    applyDeathFine(state, 0);
    expect(state.money).toBe(STARTING_MONEY);
  });

  it('does not affect the loan balance', () => {
    applyDeathFine(state, 2);
    expect(state.loan.balance).toBe(STARTING_LOAN_BALANCE);
  });
});
