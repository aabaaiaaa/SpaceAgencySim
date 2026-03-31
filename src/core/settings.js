/**
 * settings.js — Difficulty settings helpers.
 *
 * Reads the `difficultySettings` object on game state and returns the
 * corresponding multipliers for each system.  All game systems that are
 * affected by difficulty call these helpers rather than reading the raw
 * setting values directly.
 *
 * @module core/settings
 */

import {
  DEFAULT_DIFFICULTY_SETTINGS,
  MALFUNCTION_FREQUENCY_MULTIPLIERS,
  MalfunctionFrequency,
  WEATHER_SEVERITY_MULTIPLIERS,
  WeatherSeverity,
  FINANCIAL_PRESSURE_MULTIPLIERS,
  FinancialPressure,
  INJURY_DURATION_MULTIPLIERS,
  InjuryDuration,
} from './constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the current difficulty settings, falling back to defaults
 * for any missing fields.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('./gameState.js').DifficultySettings}
 */
export function getDifficultySettings(state) {
  const ds = state?.difficultySettings;
  if (!ds) return { ...DEFAULT_DIFFICULTY_SETTINGS };
  return {
    malfunctionFrequency: ds.malfunctionFrequency ?? DEFAULT_DIFFICULTY_SETTINGS.malfunctionFrequency,
    weatherSeverity:      ds.weatherSeverity      ?? DEFAULT_DIFFICULTY_SETTINGS.weatherSeverity,
    financialPressure:    ds.financialPressure    ?? DEFAULT_DIFFICULTY_SETTINGS.financialPressure,
    injuryDuration:       ds.injuryDuration       ?? DEFAULT_DIFFICULTY_SETTINGS.injuryDuration,
  };
}

// ---------------------------------------------------------------------------
// Malfunction frequency
// ---------------------------------------------------------------------------

/**
 * Returns the malfunction failure-chance multiplier for the current setting.
 * 0 = malfunctions disabled, 1 = normal, 2 = double chance.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}
 */
export function getMalfunctionMultiplier(state) {
  const freq = getDifficultySettings(state).malfunctionFrequency;
  return MALFUNCTION_FREQUENCY_MULTIPLIERS[freq] ?? 1.0;
}

// ---------------------------------------------------------------------------
// Weather severity
// ---------------------------------------------------------------------------

/**
 * Returns the weather severity multipliers (wind and extreme chance).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ windMult: number, extremeChanceMult: number }}
 */
export function getWeatherSeverityMultipliers(state) {
  const sev = getDifficultySettings(state).weatherSeverity;
  return WEATHER_SEVERITY_MULTIPLIERS[sev] ?? WEATHER_SEVERITY_MULTIPLIERS[WeatherSeverity.NORMAL];
}

// ---------------------------------------------------------------------------
// Financial pressure
// ---------------------------------------------------------------------------

/**
 * Returns the financial pressure multipliers (reward and cost).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {{ rewardMult: number, costMult: number }}
 */
export function getFinancialMultipliers(state) {
  const fp = getDifficultySettings(state).financialPressure;
  return FINANCIAL_PRESSURE_MULTIPLIERS[fp] ?? FINANCIAL_PRESSURE_MULTIPLIERS[FinancialPressure.NORMAL];
}

// ---------------------------------------------------------------------------
// Injury duration
// ---------------------------------------------------------------------------

/**
 * Returns the injury duration multiplier.
 * 0.5 = half duration, 1 = normal, 2 = double.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}
 */
export function getInjuryDurationMultiplier(state) {
  const dur = getDifficultySettings(state).injuryDuration;
  return INJURY_DURATION_MULTIPLIERS[dur] ?? 1.0;
}

// ---------------------------------------------------------------------------
// Mutation
// ---------------------------------------------------------------------------

/**
 * Update one or more difficulty settings on the game state.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {Partial<import('./gameState.js').DifficultySettings>} changes
 */
export function updateDifficultySettings(state, changes) {
  if (!state.difficultySettings) {
    state.difficultySettings = { ...DEFAULT_DIFFICULTY_SETTINGS };
  }
  Object.assign(state.difficultySettings, changes);
}
