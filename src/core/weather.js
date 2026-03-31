/**
 * weather.js — Weather and launch conditions system.
 *
 * Generates random weather per "day" visible from the hub before launching.
 * Weather conditions:
 *   - Wind: horizontal force (0–15 m/s)
 *   - Temperature: ISP modifier (-5% to +5%)
 *   - Visibility: cosmetic fog/haze level (0–1, 0 = clear, 1 = dense)
 *
 * Day skipping: player pays a fee to reroll weather (does NOT advance the
 * period counter).  Fees escalate for consecutive skips.  Weather satellites
 * (Phase 4) reduce skip cost and provide forecasts.
 *
 * Extreme weather: rarely generated, highly inadvisable to fly in.
 *
 * Body-specific weather:
 *   - Earth: standard weather (wind, temperature, visibility)
 *   - Moon: no weather (airless)
 *   - Mars: dust storms (extreme wind, low visibility)
 *   - Other airless bodies: no weather
 *
 * Weather only affects atmospheric flight (wind force drops to zero above
 * the atmosphere top altitude).
 *
 * @module weather
 */

import {
  GameMode,
  WEATHER_BASE_SKIP_COST,
  WEATHER_SKIP_ESCALATION,
  WEATHER_MAX_WIND,
  WEATHER_ISP_RANGE,
  WEATHER_EXTREME_CHANCE,
  WEATHER_EXTREME_WIND_MIN,
  WEATHER_EXTREME_VISIBILITY_MAX,
} from './constants.js';
import { getBodyDef, hasAtmosphere } from '../data/bodies.js';
import { getNetworkBenefits } from './satellites.js';
import { spend } from './finance.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Weather conditions for a single day at a launch site.
 * @typedef {Object} WeatherConditions
 * @property {number}  windSpeed      Wind speed in m/s (0–15, higher in extremes).
 * @property {number}  windAngle      Wind direction in radians (0 = east, π/2 = north).
 * @property {number}  temperature    ISP modifier as a multiplier (0.95–1.05).
 * @property {number}  visibility     Fog/haze level (0 = clear, 1 = dense fog).
 * @property {boolean} extreme        True if conditions are extreme (highly inadvisable).
 * @property {string}  description    Human-readable summary (e.g. "Clear skies", "Dust storm").
 * @property {string}  bodyId         Celestial body these conditions apply to.
 */

/**
 * Weather state stored in the game state.
 * @typedef {Object} WeatherState
 * @property {WeatherConditions} current     Current day's weather.
 * @property {number}            skipCount   Consecutive skips this session (resets on launch).
 * @property {number}            seed        PRNG seed for reproducibility.
 */

// ---------------------------------------------------------------------------
// Deterministic PRNG (simple mulberry32)
// ---------------------------------------------------------------------------

/**
 * Simple 32-bit PRNG (mulberry32).  Returns a function that produces
 * pseudo-random floats in [0, 1) on each call.
 *
 * @param {number} seed
 * @returns {() => number}
 */
function _mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// ---------------------------------------------------------------------------
// Weather generation
// ---------------------------------------------------------------------------

/**
 * Weather descriptors per condition tier.
 * @type {Array<{ maxWind: number, maxVis: number, label: string }>}
 */
const WEATHER_TIERS = [
  { maxWind: 3,  maxVis: 0.1, label: 'Clear skies' },
  { maxWind: 6,  maxVis: 0.25, label: 'Light breeze' },
  { maxWind: 10, maxVis: 0.4, label: 'Moderate wind' },
  { maxWind: 15, maxVis: 0.6, label: 'Strong wind' },
];

/**
 * Mars-specific weather descriptors.
 */
const MARS_WEATHER_TIERS = [
  { maxWind: 5,  maxVis: 0.15, label: 'Calm, thin air' },
  { maxWind: 10, maxVis: 0.3, label: 'Light dust haze' },
  { maxWind: 20, maxVis: 0.5, label: 'Moderate dust' },
  { maxWind: 30, maxVis: 0.7, label: 'Heavy dust' },
];

/**
 * Generate weather conditions for a specific body.
 *
 * @param {string} bodyId  Celestial body ID.
 * @param {number} seed    PRNG seed.
 * @returns {WeatherConditions}
 */
export function generateWeather(bodyId, seed) {
  const body = getBodyDef(bodyId);

  // Airless bodies have no weather.
  if (!body || !hasAtmosphere(bodyId)) {
    return {
      windSpeed: 0,
      windAngle: 0,
      temperature: 1.0,
      visibility: 0,
      extreme: false,
      description: 'No atmosphere',
      bodyId,
    };
  }

  const rand = _mulberry32(seed);

  // Determine if this is an extreme weather event.
  const isExtreme = rand() < WEATHER_EXTREME_CHANCE;

  let windSpeed, windAngle, temperature, visibility, description;

  if (bodyId === 'MARS') {
    // Mars: dust storms are the dominant weather pattern.
    if (isExtreme) {
      // Dust storm — extreme
      windSpeed = WEATHER_EXTREME_WIND_MIN + rand() * 20; // 20-40 m/s
      windAngle = rand() * Math.PI * 2;
      temperature = 1.0 - rand() * 0.03; // slight cooling
      visibility = 0.8 + rand() * 0.2;   // very low visibility
      description = 'Dust storm';
    } else {
      const tier = Math.min(Math.floor(rand() * 4), 3);
      const t = MARS_WEATHER_TIERS[tier];
      windSpeed = rand() * t.maxWind;
      windAngle = rand() * Math.PI * 2;
      temperature = 1.0 + (rand() - 0.5) * WEATHER_ISP_RANGE * 2;
      visibility = rand() * t.maxVis;
      description = t.label;
    }
  } else {
    // Earth, Venus, or other atmospheric bodies.
    if (isExtreme) {
      windSpeed = WEATHER_EXTREME_WIND_MIN + rand() * (WEATHER_MAX_WIND * 2 - WEATHER_EXTREME_WIND_MIN);
      windAngle = rand() * Math.PI * 2;
      temperature = 1.0 + (rand() - 0.5) * WEATHER_ISP_RANGE * 2;
      visibility = WEATHER_EXTREME_VISIBILITY_MAX + rand() * (1 - WEATHER_EXTREME_VISIBILITY_MAX);
      description = 'Severe storm';
    } else {
      const tier = Math.min(Math.floor(rand() * 4), 3);
      const t = WEATHER_TIERS[tier];
      windSpeed = rand() * t.maxWind;
      windAngle = rand() * Math.PI * 2;
      temperature = 1.0 + (rand() - 0.5) * WEATHER_ISP_RANGE * 2;
      visibility = rand() * t.maxVis;
      description = t.label;
    }
  }

  // Clamp temperature to the valid range.
  temperature = Math.max(1.0 - WEATHER_ISP_RANGE, Math.min(1.0 + WEATHER_ISP_RANGE, temperature));

  return {
    windSpeed,
    windAngle,
    temperature,
    visibility: Math.max(0, Math.min(1, visibility)),
    extreme: isExtreme,
    description,
    bodyId,
  };
}

// ---------------------------------------------------------------------------
// Weather state management
// ---------------------------------------------------------------------------

/**
 * Initialise or refresh the weather state on the game state.
 * Called when the player first enters the hub or after flight return.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} [bodyId='EARTH']  Body to generate weather for.
 */
export function initWeather(state, bodyId = 'EARTH') {
  // Sandbox mode with weather disabled: always perfect conditions.
  if (state.gameMode === GameMode.SANDBOX && !state.sandboxSettings?.weatherEnabled) {
    state.weather = {
      current: {
        windSpeed: 0,
        windAngle: 0,
        temperature: 1.0,
        visibility: 0,
        extreme: false,
        description: 'Clear skies (sandbox)',
        bodyId,
      },
      skipCount: 0,
      seed: 0,
    };
    return;
  }
  const seed = (state.currentPeriod * 7919 + Date.now()) & 0x7fffffff;
  state.weather = {
    current: generateWeather(bodyId, seed),
    skipCount: 0,
    seed,
  };
}

/**
 * Get the current weather conditions.  Returns a no-weather default
 * if weather state is not initialised.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {WeatherConditions}
 */
export function getCurrentWeather(state) {
  if (state.weather?.current) return state.weather.current;
  return {
    windSpeed: 0,
    windAngle: 0,
    temperature: 1.0,
    visibility: 0,
    extreme: false,
    description: 'No data',
    bodyId: 'EARTH',
  };
}

/**
 * Calculate the cost to skip the current weather (reroll).
 *
 * Base cost escalates with consecutive skips.
 * Weather satellites reduce the cost.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {number}  Cost in dollars.
 */
export function getWeatherSkipCost(state) {
  // Sandbox mode: weather skip is always free.
  if (state.gameMode === GameMode.SANDBOX) return 0;

  const skipCount = state.weather?.skipCount ?? 0;
  const baseCost = WEATHER_BASE_SKIP_COST * Math.pow(WEATHER_SKIP_ESCALATION, skipCount);

  // Apply weather satellite discount.
  const benefits = getNetworkBenefits(state);
  const discount = Math.min(0.5, benefits.weatherSkipDiscount); // Cap at 50%
  return Math.round(baseCost * (1 - discount));
}

/**
 * Skip the current day's weather — pay a fee and reroll.
 * Does NOT advance the period counter.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} [bodyId='EARTH']
 * @returns {{ success: boolean, cost: number, newWeather: WeatherConditions|null }}
 */
export function skipWeather(state, bodyId = 'EARTH') {
  const cost = getWeatherSkipCost(state);
  if (!spend(state, cost)) {
    return { success: false, cost, newWeather: null };
  }

  const skipCount = (state.weather?.skipCount ?? 0) + 1;
  const seed = ((state.weather?.seed ?? 0) + skipCount * 13397) & 0x7fffffff;

  const newWeather = generateWeather(bodyId, seed);
  state.weather = {
    current: newWeather,
    skipCount,
    seed,
  };

  return { success: true, cost, newWeather };
}

/**
 * Get a weather forecast (next few days) if the player has weather satellites.
 * Returns empty array if no forecast data is available.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} [bodyId='EARTH']
 * @param {number} [days=3]
 * @returns {WeatherConditions[]}
 */
export function getWeatherForecast(state, bodyId = 'EARTH', days = 3) {
  const benefits = getNetworkBenefits(state);
  if (benefits.forecastAccuracy <= 0) return [];

  const baseSeed = state.weather?.seed ?? 0;
  const skipCount = state.weather?.skipCount ?? 0;
  const forecast = [];

  for (let i = 1; i <= days; i++) {
    const futureSeed = (baseSeed + (skipCount + i) * 13397) & 0x7fffffff;
    forecast.push(generateWeather(bodyId, futureSeed));
  }

  return forecast;
}

/**
 * Compute the wind force components at a given altitude.
 * Wind decreases linearly with altitude and reaches zero at the atmosphere top.
 * Returns {windFX, windFY} in Newtons per unit mass (i.e., acceleration).
 *
 * @param {WeatherConditions} weather
 * @param {number} altitude   Current altitude in metres.
 * @param {string} bodyId     Celestial body ID.
 * @returns {{ windFX: number, windFY: number }}
 */
export function getWindForce(weather, altitude, bodyId) {
  if (!weather || weather.windSpeed <= 0) return { windFX: 0, windFY: 0 };

  const body = getBodyDef(bodyId);
  if (!body || !body.atmosphere) return { windFX: 0, windFY: 0 };

  const atmoTop = body.atmosphere.topAltitude;
  if (altitude >= atmoTop) return { windFX: 0, windFY: 0 };

  // Wind profile: strongest at low altitude, linearly decreasing to zero
  // at the atmosphere top.  Peak wind is at ground level.
  const altFraction = Math.max(0, 1 - altitude / atmoTop);
  const effectiveWind = weather.windSpeed * altFraction;

  // Wind is a horizontal force — decompose by wind angle.
  // windAngle: 0 = east (+X), π/2 = north (+Y) in our coordinate system
  // but in this game Y is vertical.  Wind is purely horizontal → X only.
  // We treat windAngle as a deviation from pure horizontal so wind
  // pushes the rocket sideways.
  const windFX = effectiveWind * Math.cos(weather.windAngle);
  const windFY = 0; // Wind is horizontal only, no vertical component.

  return { windFX, windFY };
}

/**
 * Get the ISP temperature modifier from current weather.
 *
 * @param {WeatherConditions} weather
 * @returns {number}  Multiplier to apply to ISP (e.g. 0.95 to 1.05).
 */
export function getIspModifier(weather) {
  if (!weather) return 1.0;
  return weather.temperature;
}
