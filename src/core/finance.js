/**
 * finance.js — Financial system: money, loans, and financial events.
 *
 * All functions accept the central GameState object as their first argument
 * and mutate it in-place, consistent with the patterns in gameState.js.
 *
 * Starting position:
 *   - Cash:         $2,000,000  (the initial loan proceeds)
 *   - Loan balance: $2,000,000
 *
 * Interest is applied at 3% per completed mission (not annually).  There is
 * no due date; the loan compounds indefinitely if left unpaid.
 *
 * @module finance
 */

import {
  DEATH_FINE_PER_ASTRONAUT,
  MAX_LOAN_BALANCE,
  PartType,
} from './constants.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Interest
// ---------------------------------------------------------------------------

/**
 * Applies per-mission interest to the outstanding loan balance.
 *
 * Call this each time the player completes a mission and returns to the
 * space agency.  Interest compounds: `balance *= 1.03`.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {void}
 */
export function applyInterest(state) {
  const interest = state.loan.balance * state.loan.interestRate;
  const paid = Math.min(interest, Math.max(0, state.money));
  state.money -= paid;
  state.loan.balance += interest - paid;
  state.loan.totalInterestAccrued = (state.loan.totalInterestAccrued ?? 0) + interest;
}

// ---------------------------------------------------------------------------
// Loan Operations
// ---------------------------------------------------------------------------

/**
 * Pay down the outstanding loan.
 *
 * The actual amount paid is clamped to the lesser of:
 *   - the requested `amount`
 *   - the current loan balance (cannot overpay)
 *   - the player's available cash (cannot pay what you don't have)
 *
 * Both `state.loan.balance` and `state.money` are reduced by the amount paid.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {number} amount  Desired payment amount in dollars.
 * @returns {{ paid: number, newBalance: number, newCash: number }}
 *   `paid` is the amount actually deducted (may be less than `amount`).
 */
export function payDownLoan(state, amount) {
  const paid = Math.min(amount, state.loan.balance, state.money);
  state.loan.balance -= paid;
  state.money -= paid;
  return { paid, newBalance: state.loan.balance, newCash: state.money };
}

/**
 * Borrow additional funds, increasing both the loan balance and cash.
 *
 * The total loan balance cannot exceed MAX_LOAN_BALANCE ($10,000,000).
 * If `amount` would push the balance over the cap, only the headroom
 * remaining is disbursed.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {number} amount  Desired borrow amount in dollars.
 * @returns {{ borrowed: number, newBalance: number, newCash: number }}
 *   `borrowed` is the amount actually added (may be less than `amount`).
 */
export function borrowMore(state, amount) {
  const headroom = Math.max(0, MAX_LOAN_BALANCE - state.loan.balance);
  const borrowed = Math.min(amount, headroom);
  state.loan.balance += borrowed;
  state.money += borrowed;
  return { borrowed, newBalance: state.loan.balance, newCash: state.money };
}

// ---------------------------------------------------------------------------
// Cash Operations
// ---------------------------------------------------------------------------

/**
 * Deduct a general expense from the player's cash balance.
 *
 * Returns `false` without modifying state if the player has insufficient
 * funds (cash cannot go below $0 via this function).
 *
 * @param {import('./gameState.js').GameState} state
 * @param {number} amount  Amount to deduct in dollars.
 * @returns {boolean}  `true` if the purchase succeeded, `false` otherwise.
 */
export function spend(state, amount) {
  if (amount > state.money) return false;
  state.money -= amount;
  return true;
}

/**
 * Add earned revenue to the player's cash balance.
 *
 * Used for mission rewards, contract bonuses, and any other income.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {number} amount  Amount to add in dollars.
 * @returns {void}
 */
export function earn(state, amount) {
  state.money += amount;
}

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

/**
 * Apply the death-penalty fine for astronauts killed in action.
 *
 * Deducts $500,000 per KIA from the player's cash.  Unlike `spend()`, this
 * fine is always applied even if it drives cash below $0, reflecting that
 * the player cannot refuse a government penalty.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {number} killedCount  Number of astronauts killed on this flight.
 * @returns {void}
 */
export function applyDeathFine(state, killedCount) {
  state.money -= DEATH_FINE_PER_ASTRONAUT * killedCount;
}

// ---------------------------------------------------------------------------
// Bankruptcy Detection
// ---------------------------------------------------------------------------

/**
 * Calculate the cost of the cheapest possible rocket the player can build
 * from their currently unlocked parts.
 *
 * A minimum viable rocket needs:
 *   - One command module (COMMAND_MODULE) or computer module (COMPUTER_MODULE)
 *   - One thrust source: an ENGINE + FUEL_TANK pair, or a SOLID_ROCKET_BOOSTER
 *
 * Returns `Infinity` if the player doesn't have the parts to build any rocket.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}  Minimum cost in dollars, or Infinity if impossible.
 */
export function getMinimumRocketCost(state) {
  const unlocked = state.parts ?? [];
  if (unlocked.length === 0) return Infinity;

  // Find cheapest command/computer module.
  let cheapestCommand = Infinity;
  for (const partId of unlocked) {
    const def = getPartById(partId);
    if (!def) continue;
    if (def.type === PartType.COMMAND_MODULE || def.type === PartType.COMPUTER_MODULE) {
      cheapestCommand = Math.min(cheapestCommand, def.cost);
    }
  }
  if (cheapestCommand === Infinity) return Infinity;

  // Find cheapest thrust option: SRB alone, or engine + fuel tank.
  let cheapestSRB = Infinity;
  let cheapestEngine = Infinity;
  let cheapestTank = Infinity;

  for (const partId of unlocked) {
    const def = getPartById(partId);
    if (!def) continue;
    if (def.type === PartType.SOLID_ROCKET_BOOSTER) {
      cheapestSRB = Math.min(cheapestSRB, def.cost);
    }
    if (def.type === PartType.ENGINE) {
      cheapestEngine = Math.min(cheapestEngine, def.cost);
    }
    if (def.type === PartType.FUEL_TANK) {
      cheapestTank = Math.min(cheapestTank, def.cost);
    }
  }

  const srbCost = cheapestSRB;
  const liquidCost = cheapestEngine + cheapestTank;
  const cheapestThrust = Math.min(srbCost, liquidCost);

  if (cheapestThrust === Infinity) return Infinity;

  return cheapestCommand + cheapestThrust;
}

/**
 * Check whether the player is bankrupt.
 *
 * Bankruptcy occurs when the player's available purchasing power (current
 * cash + remaining borrowing capacity) is less than the cost of the
 * cheapest buildable rocket.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {boolean}  True if the player is bankrupt.
 */
export function isBankrupt(state) {
  const minCost = getMinimumRocketCost(state);
  if (minCost === Infinity) return false; // No parts = not bankruptcy, just early game.

  const borrowable = Math.max(0, MAX_LOAN_BALANCE - (state.loan?.balance ?? 0));
  const purchasingPower = state.money + borrowable;
  return purchasingPower < minCost;
}
