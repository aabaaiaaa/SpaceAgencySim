/**
 * crew.test.js — Unit tests for the crew management system.
 *
 * Tests cover:
 *   - hireCrew()        — deducts $50k, adds astronaut, fails without funds
 *   - fireCrew()        — sets status to 'fired', idempotency guards
 *   - recordKIA()       — sets status to 'kia', records date/cause, applies fine
 *   - assignToCrew()    — stores rocketId on astronaut, active-only guard
 *   - unassignCrew()    — clears rocketId, works regardless of status
 *   - getActiveCrew()   — filters to 'active' status only
 *   - getFullHistory()  — returns all records including fired and KIA
 *   - AstronautStatus   — frozen enum with correct values
 *   - HIRE_COST         — matches $50,000 spec
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.js';
import {
  hireCrew,
  fireCrew,
  recordKIA,
  assignToCrew,
  unassignCrew,
  getActiveCrew,
  getFullHistory,
} from '../core/crew.js';
import {
  AstronautStatus,
  HIRE_COST,
  DEATH_FINE_PER_ASTRONAUT,
  STARTING_MONEY,
} from '../core/constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState() {
  return createGameState();
}

/** Hire one astronaut by name, returning the astronaut record. */
function hireOne(state, name = 'Alice') {
  const result = hireCrew(state, name);
  if (!result.success) throw new Error('hireCrew failed unexpectedly');
  return result.astronaut;
}

// ---------------------------------------------------------------------------
// AstronautStatus enum
// ---------------------------------------------------------------------------

describe('AstronautStatus enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(AstronautStatus)).toBe(true);
  });

  it('has correct string values', () => {
    expect(AstronautStatus.ACTIVE).toBe('active');
    expect(AstronautStatus.FIRED).toBe('fired');
    expect(AstronautStatus.KIA).toBe('kia');
  });
});

// ---------------------------------------------------------------------------
// HIRE_COST constant
// ---------------------------------------------------------------------------

describe('HIRE_COST constant', () => {
  it('is $50,000', () => {
    expect(HIRE_COST).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// hireCrew()
// ---------------------------------------------------------------------------

describe('hireCrew()', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('deducts $50,000 from cash', () => {
    hireCrew(state, 'Alice');
    expect(state.money).toBe(STARTING_MONEY - HIRE_COST);
  });

  it('returns { success: true, astronaut } on success', () => {
    const result = hireCrew(state, 'Bob');
    expect(result.success).toBe(true);
    expect(result.astronaut).toBeDefined();
    expect(result.astronaut.name).toBe('Bob');
  });

  it('adds the astronaut to state.crew', () => {
    hireCrew(state, 'Charlie');
    expect(state.crew).toHaveLength(1);
    expect(state.crew[0].name).toBe('Charlie');
  });

  it('new astronaut has status "active"', () => {
    const { astronaut } = hireCrew(state, 'Dana');
    expect(astronaut.status).toBe(AstronautStatus.ACTIVE);
  });

  it('new astronaut starts with 0 missions and 0 flights', () => {
    const { astronaut } = hireCrew(state, 'Eve');
    expect(astronaut.missionsFlown).toBe(0);
    expect(astronaut.flightsFlown).toBe(0);
  });

  it('new astronaut has null deathDate and deathCause', () => {
    const { astronaut } = hireCrew(state, 'Frank');
    expect(astronaut.deathDate).toBeNull();
    expect(astronaut.deathCause).toBeNull();
  });

  it('new astronaut has null assignedRocketId', () => {
    const { astronaut } = hireCrew(state, 'Grace');
    expect(astronaut.assignedRocketId).toBeNull();
  });

  it('new astronaut has a UUID id', () => {
    const { astronaut } = hireCrew(state, 'Hank');
    expect(typeof astronaut.id).toBe('string');
    expect(astronaut.id.length).toBeGreaterThan(0);
  });

  it('new astronaut has an ISO hireDate', () => {
    const { astronaut } = hireCrew(state, 'Iris');
    expect(typeof astronaut.hireDate).toBe('string');
    expect(astronaut.hireDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('each hired astronaut gets a unique id', () => {
    const a = hireCrew(state, 'A').astronaut;
    const b = hireCrew(state, 'B').astronaut;
    expect(a.id).not.toBe(b.id);
  });

  it('returns { success: false, error } when insufficient funds', () => {
    state.money = HIRE_COST - 1;
    const result = hireCrew(state, 'NoMoney');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('does not add astronaut to crew when insufficient funds', () => {
    state.money = 0;
    hireCrew(state, 'Broke');
    expect(state.crew).toHaveLength(0);
  });

  it('does not deduct money on failure', () => {
    state.money = HIRE_COST - 1;
    hireCrew(state, 'Poor');
    expect(state.money).toBe(HIRE_COST - 1);
  });

  it('can hire multiple astronauts', () => {
    hireCrew(state, 'A');
    hireCrew(state, 'B');
    hireCrew(state, 'C');
    expect(state.crew).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// fireCrew()
// ---------------------------------------------------------------------------

describe('fireCrew()', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('sets status to "fired"', () => {
    const a = hireOne(state);
    fireCrew(state, a.id);
    expect(state.crew[0].status).toBe(AstronautStatus.FIRED);
  });

  it('returns true on success', () => {
    const a = hireOne(state);
    expect(fireCrew(state, a.id)).toBe(true);
  });

  it('clears assignedRocketId when fired', () => {
    const a = hireOne(state);
    a.assignedRocketId = 'rocket-1';
    fireCrew(state, a.id);
    expect(a.assignedRocketId).toBeNull();
  });

  it('returns false for unknown id', () => {
    expect(fireCrew(state, 'nobody')).toBe(false);
  });

  it('returns false if already fired', () => {
    const a = hireOne(state);
    fireCrew(state, a.id);
    expect(fireCrew(state, a.id)).toBe(false);
  });

  it('returns false if astronaut is KIA', () => {
    const a = hireOne(state);
    recordKIA(state, a.id, 'accident');
    expect(fireCrew(state, a.id)).toBe(false);
  });

  it('does not remove the record from state.crew', () => {
    const a = hireOne(state);
    fireCrew(state, a.id);
    expect(state.crew).toHaveLength(1);
  });

  it('does not deduct any money', () => {
    const a = hireOne(state);
    const moneyBefore = state.money;
    fireCrew(state, a.id);
    expect(state.money).toBe(moneyBefore);
  });
});

// ---------------------------------------------------------------------------
// recordKIA()
// ---------------------------------------------------------------------------

describe('recordKIA()', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('sets status to "kia"', () => {
    const a = hireOne(state);
    recordKIA(state, a.id, 'engine explosion');
    expect(a.status).toBe(AstronautStatus.KIA);
  });

  it('returns true on success', () => {
    const a = hireOne(state);
    expect(recordKIA(state, a.id, 'crash')).toBe(true);
  });

  it('records deathDate as an ISO string', () => {
    const a = hireOne(state);
    recordKIA(state, a.id, 'unknown');
    expect(typeof a.deathDate).toBe('string');
    expect(a.deathDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records the provided cause', () => {
    const a = hireOne(state);
    recordKIA(state, a.id, 'fuel tank rupture');
    expect(a.deathCause).toBe('fuel tank rupture');
  });

  it('clears assignedRocketId', () => {
    const a = hireOne(state);
    a.assignedRocketId = 'rocket-1';
    recordKIA(state, a.id, 'crash');
    expect(a.assignedRocketId).toBeNull();
  });

  it('applies a $500,000 fine to cash', () => {
    const a = hireOne(state);
    const moneyBefore = state.money;
    recordKIA(state, a.id, 'accident');
    expect(state.money).toBe(moneyBefore - DEATH_FINE_PER_ASTRONAUT);
  });

  it('fine can drive cash negative', () => {
    const a = hireOne(state);   // hire while funds are available
    state.money = 100;          // then reduce cash to below the fine amount
    recordKIA(state, a.id, 'accident');
    expect(state.money).toBe(100 - DEATH_FINE_PER_ASTRONAUT);
    expect(state.money).toBeLessThan(0);
  });

  it('applies one fine per call, not per crew', () => {
    const a = hireOne(state, 'A');
    const b = hireOne(state, 'B');
    const moneyBefore = state.money;
    recordKIA(state, a.id, 'crash');
    recordKIA(state, b.id, 'crash');
    expect(state.money).toBe(moneyBefore - 2 * DEATH_FINE_PER_ASTRONAUT);
  });

  it('returns false for unknown id', () => {
    expect(recordKIA(state, 'nobody', 'cause')).toBe(false);
  });

  it('returns false if already KIA (idempotent guard)', () => {
    const a = hireOne(state);
    recordKIA(state, a.id, 'first');
    expect(recordKIA(state, a.id, 'second')).toBe(false);
  });

  it('does not apply an extra fine on the second KIA call', () => {
    const a = hireOne(state);
    const moneyAfterFirst = state.money - DEATH_FINE_PER_ASTRONAUT;
    recordKIA(state, a.id, 'first');
    const cashAfterFirst = state.money;
    recordKIA(state, a.id, 'second');
    expect(state.money).toBe(cashAfterFirst); // no change
  });

  it('can record KIA on a previously fired astronaut', () => {
    const a = hireOne(state);
    fireCrew(state, a.id);
    expect(recordKIA(state, a.id, 'post-firing incident')).toBe(true);
    expect(a.status).toBe(AstronautStatus.KIA);
  });

  it('does not remove the record from state.crew', () => {
    const a = hireOne(state);
    recordKIA(state, a.id, 'crash');
    expect(state.crew).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// assignToCrew()
// ---------------------------------------------------------------------------

describe('assignToCrew()', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('sets assignedRocketId on the astronaut', () => {
    const a = hireOne(state);
    assignToCrew(state, a.id, 'rocket-42');
    expect(a.assignedRocketId).toBe('rocket-42');
  });

  it('returns true on success', () => {
    const a = hireOne(state);
    expect(assignToCrew(state, a.id, 'rocket-1')).toBe(true);
  });

  it('returns false for unknown astronaut id', () => {
    expect(assignToCrew(state, 'nobody', 'rocket-1')).toBe(false);
  });

  it('returns false for a fired astronaut', () => {
    const a = hireOne(state);
    fireCrew(state, a.id);
    expect(assignToCrew(state, a.id, 'rocket-1')).toBe(false);
  });

  it('returns false for a KIA astronaut', () => {
    const a = hireOne(state);
    recordKIA(state, a.id, 'crash');
    expect(assignToCrew(state, a.id, 'rocket-1')).toBe(false);
  });

  it('allows re-assigning to a different rocket', () => {
    const a = hireOne(state);
    assignToCrew(state, a.id, 'rocket-1');
    assignToCrew(state, a.id, 'rocket-2');
    expect(a.assignedRocketId).toBe('rocket-2');
  });
});

// ---------------------------------------------------------------------------
// unassignCrew()
// ---------------------------------------------------------------------------

describe('unassignCrew()', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('clears assignedRocketId', () => {
    const a = hireOne(state);
    assignToCrew(state, a.id, 'rocket-1');
    unassignCrew(state, a.id);
    expect(a.assignedRocketId).toBeNull();
  });

  it('returns true on success', () => {
    const a = hireOne(state);
    expect(unassignCrew(state, a.id)).toBe(true);
  });

  it('returns false for unknown id', () => {
    expect(unassignCrew(state, 'nobody')).toBe(false);
  });

  it('works even when already null (no-op)', () => {
    const a = hireOne(state);
    expect(unassignCrew(state, a.id)).toBe(true);
    expect(a.assignedRocketId).toBeNull();
  });

  it('works on fired astronauts (cleanup after firing)', () => {
    const a = hireOne(state);
    assignToCrew(state, a.id, 'rocket-1');
    a.status = AstronautStatus.FIRED;
    expect(unassignCrew(state, a.id)).toBe(true);
    expect(a.assignedRocketId).toBeNull();
  });

  it('works on KIA astronauts (cleanup after death)', () => {
    const a = hireOne(state);
    // Manually set to verify unassign works regardless of status
    a.assignedRocketId = 'rocket-99';
    a.status = AstronautStatus.KIA;
    expect(unassignCrew(state, a.id)).toBe(true);
    expect(a.assignedRocketId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getActiveCrew()
// ---------------------------------------------------------------------------

describe('getActiveCrew()', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('returns empty array when crew is empty', () => {
    expect(getActiveCrew(state)).toEqual([]);
  });

  it('returns only active astronauts', () => {
    const a = hireOne(state, 'Active');
    hireOne(state, 'ToFire');
    hireOne(state, 'ToKill');
    fireCrew(state, state.crew[1].id);
    recordKIA(state, state.crew[2].id, 'accident');

    const active = getActiveCrew(state);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(a.id);
  });

  it('returns all astronauts when all are active', () => {
    hireOne(state, 'A');
    hireOne(state, 'B');
    hireOne(state, 'C');
    expect(getActiveCrew(state)).toHaveLength(3);
  });

  it('returns empty array when all are fired or KIA', () => {
    const a = hireOne(state, 'A');
    const b = hireOne(state, 'B');
    fireCrew(state, a.id);
    recordKIA(state, b.id, 'crash');
    expect(getActiveCrew(state)).toHaveLength(0);
  });

  it('result is a subset of state.crew (same references)', () => {
    const a = hireOne(state, 'A');
    const active = getActiveCrew(state);
    expect(active[0]).toBe(state.crew[0]);
  });
});

// ---------------------------------------------------------------------------
// getFullHistory()
// ---------------------------------------------------------------------------

describe('getFullHistory()', () => {
  let state;
  beforeEach(() => { state = freshState(); });

  it('returns empty array when no crew has ever been hired', () => {
    expect(getFullHistory(state)).toEqual([]);
  });

  it('includes active astronauts', () => {
    hireOne(state, 'Active');
    expect(getFullHistory(state)).toHaveLength(1);
  });

  it('includes fired astronauts', () => {
    const a = hireOne(state, 'Fired');
    fireCrew(state, a.id);
    expect(getFullHistory(state)).toHaveLength(1);
    expect(getFullHistory(state)[0].status).toBe(AstronautStatus.FIRED);
  });

  it('includes KIA astronauts', () => {
    const a = hireOne(state, 'KIA');
    recordKIA(state, a.id, 'accident');
    expect(getFullHistory(state)).toHaveLength(1);
    expect(getFullHistory(state)[0].status).toBe(AstronautStatus.KIA);
  });

  it('includes all records regardless of status', () => {
    hireOne(state, 'Active');
    const b = hireOne(state, 'Fired');
    const c = hireOne(state, 'KIA');
    fireCrew(state, b.id);
    recordKIA(state, c.id, 'crash');
    expect(getFullHistory(state)).toHaveLength(3);
  });

  it('returns a shallow copy — pushing to result does not affect state.crew', () => {
    hireOne(state, 'A');
    const history = getFullHistory(state);
    history.push({ id: 'fake', name: 'Fake' });
    expect(state.crew).toHaveLength(1);
  });

  it('individual records are references to live state', () => {
    const a = hireOne(state, 'A');
    const history = getFullHistory(state);
    expect(history[0]).toBe(a);
  });
});
