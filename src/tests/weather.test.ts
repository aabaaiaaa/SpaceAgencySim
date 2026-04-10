/**
 * weather.test.js — Unit tests for the weather and launch conditions system.
 *
 * Tests cover:
 *   - generateWeather()       — generates valid weather for different bodies
 *   - initWeather()           — initialises weather state on gameState
 *   - getCurrentWeather()     — retrieves current conditions
 *   - getWeatherSkipCost()    — escalating skip cost calculation
 *   - skipWeather()           — rerolls weather, deducts fee, escalates
 *   - getWindForce()          — wind force at various altitudes
 *   - getIspModifier()        — ISP temperature modifier
 *   - getWeatherForecast()    — forecast from weather satellites
 *   - Body-specific behaviour — airless bodies, Mars dust storms
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState, WeatherConditions, OrbitalObject, SatelliteRecord } from '../core/gameState.ts';
import {
  generateWeather,
  initWeather,
  getCurrentWeather,
  getWeatherSkipCost,
  skipWeather,
  getWindForce,
  getIspModifier,
  getWeatherForecast,
} from '../core/weather.ts';
import {
  WEATHER_BASE_SKIP_COST,
  WEATHER_SKIP_ESCALATION,
  WEATHER_ISP_RANGE,
} from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let state: GameState;

beforeEach(() => {
  state = createGameState();
  state.money = 2_000_000;
  // Ensure satellite network exists (some tests check benefits).
  state.satelliteNetwork = { satellites: [] };
});

// ---------------------------------------------------------------------------
// generateWeather()
// ---------------------------------------------------------------------------

describe('generateWeather()', () => {
  it('returns valid weather for Earth with a given seed', () => {
    const w = generateWeather('EARTH', 12345);
    expect(w.bodyId).toBe('EARTH');
    expect(w.windSpeed).toBeGreaterThanOrEqual(0);
    expect(w.windAngle).toBeGreaterThanOrEqual(0);
    expect(w.windAngle).toBeLessThan(Math.PI * 2 + 0.01);
    expect(w.temperature).toBeGreaterThanOrEqual(1 - WEATHER_ISP_RANGE);
    expect(w.temperature).toBeLessThanOrEqual(1 + WEATHER_ISP_RANGE);
    expect(w.visibility).toBeGreaterThanOrEqual(0);
    expect(w.visibility).toBeLessThanOrEqual(1);
    expect(typeof w.extreme).toBe('boolean');
    expect(typeof w.description).toBe('string');
  });

  it('is deterministic — same seed produces same weather', () => {
    const w1 = generateWeather('EARTH', 99999);
    const w2 = generateWeather('EARTH', 99999);
    expect(w1.windSpeed).toBe(w2.windSpeed);
    expect(w1.windAngle).toBe(w2.windAngle);
    expect(w1.temperature).toBe(w2.temperature);
    expect(w1.visibility).toBe(w2.visibility);
    expect(w1.extreme).toBe(w2.extreme);
    expect(w1.description).toBe(w2.description);
  });

  it('different seeds produce different weather', () => {
    const w1 = generateWeather('EARTH', 100);
    const w2 = generateWeather('EARTH', 200);
    // Very unlikely to be identical across all fields.
    const same = w1.windSpeed === w2.windSpeed &&
                 w1.windAngle === w2.windAngle &&
                 w1.temperature === w2.temperature;
    expect(same).toBe(false);
  });

  it('returns no weather for the Moon (airless)', () => {
    const w = generateWeather('MOON', 12345);
    expect(w.windSpeed).toBe(0);
    expect(w.temperature).toBe(1.0);
    expect(w.visibility).toBe(0);
    expect(w.extreme).toBe(false);
    expect(w.description).toBe('No atmosphere');
  });

  it('returns no weather for Mercury (airless)', () => {
    const w = generateWeather('MERCURY', 12345);
    expect(w.windSpeed).toBe(0);
    expect(w.description).toBe('No atmosphere');
  });

  it('generates Mars weather (may include dust storms)', () => {
    const w = generateWeather('MARS', 12345);
    expect(w.bodyId).toBe('MARS');
    expect(w.windSpeed).toBeGreaterThanOrEqual(0);
    expect(typeof w.description).toBe('string');
  });

  it('generates Venus weather (has atmosphere)', () => {
    const w = generateWeather('VENUS', 12345);
    expect(w.bodyId).toBe('VENUS');
    expect(w.windSpeed).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// initWeather() / getCurrentWeather()
// ---------------------------------------------------------------------------

describe('initWeather() / getCurrentWeather()', () => {
  it('initialises weather on the game state', () => {
    expect(state.weather).toBeNull();
    initWeather(state, 'EARTH');
    expect(state.weather).not.toBeNull();
    expect(state.weather!.current).toBeDefined();
    expect(state.weather!.skipCount).toBe(0);
  });

  it('getCurrentWeather returns current conditions after init', () => {
    initWeather(state, 'EARTH');
    const w = getCurrentWeather(state);
    expect(w.bodyId).toBe('EARTH');
    expect(w.windSpeed).toBeGreaterThanOrEqual(0);
  });

  it('getCurrentWeather returns a safe default if not initialised', () => {
    const w = getCurrentWeather(state);
    expect(w.windSpeed).toBe(0);
    expect(w.temperature).toBe(1.0);
    expect(w.description).toBe('No data');
  });
});

// ---------------------------------------------------------------------------
// getWeatherSkipCost()
// ---------------------------------------------------------------------------

describe('getWeatherSkipCost()', () => {
  it('returns the base cost for the first skip', () => {
    initWeather(state, 'EARTH');
    const cost = getWeatherSkipCost(state);
    expect(cost).toBe(WEATHER_BASE_SKIP_COST);
  });

  it('escalates cost with consecutive skips', () => {
    initWeather(state, 'EARTH');
    const cost0 = getWeatherSkipCost(state);

    // Simulate a skip by incrementing skipCount.
    state.weather!.skipCount = 1;
    const cost1 = getWeatherSkipCost(state);

    state.weather!.skipCount = 2;
    const cost2 = getWeatherSkipCost(state);

    expect(cost1).toBeGreaterThan(cost0);
    expect(cost2).toBeGreaterThan(cost1);
    expect(cost1).toBe(Math.round(WEATHER_BASE_SKIP_COST * WEATHER_SKIP_ESCALATION));
  });
});

// ---------------------------------------------------------------------------
// skipWeather()
// ---------------------------------------------------------------------------

describe('skipWeather()', () => {
  it('@smoke rerolls weather and deducts fee', () => {
    initWeather(state, 'EARTH');
    const moneyBefore = state.money;

    const result = skipWeather(state, 'EARTH');
    expect(result.success).toBe(true);
    expect(result.cost).toBe(WEATHER_BASE_SKIP_COST);
    expect(state.money).toBe(moneyBefore - WEATHER_BASE_SKIP_COST);
    expect(state.weather!.skipCount).toBe(1);
  });

  it('fails if player cannot afford the skip', () => {
    initWeather(state, 'EARTH');
    state.money = 0;

    const result = skipWeather(state, 'EARTH');
    expect(result.success).toBe(false);
    expect(result.newWeather).toBeNull();
    expect(state.weather!.skipCount).toBe(0);
  });

  it('escalates fees on consecutive skips', () => {
    initWeather(state, 'EARTH');

    const r1 = skipWeather(state, 'EARTH');
    expect(r1.success).toBe(true);
    expect(r1.cost).toBe(WEATHER_BASE_SKIP_COST);

    const r2 = skipWeather(state, 'EARTH');
    expect(r2.success).toBe(true);
    expect(r2.cost).toBe(Math.round(WEATHER_BASE_SKIP_COST * WEATHER_SKIP_ESCALATION));

    expect(state.weather!.skipCount).toBe(2);
  });

  it('resets skip counter on weather init (new day)', () => {
    initWeather(state, 'EARTH');
    skipWeather(state, 'EARTH');
    skipWeather(state, 'EARTH');
    expect(state.weather!.skipCount).toBe(2);

    initWeather(state, 'EARTH');
    expect(state.weather!.skipCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getWindForce()
// ---------------------------------------------------------------------------

describe('getWindForce()', () => {
  it('returns zero wind at atmosphere top', () => {
    const w = generateWeather('EARTH', 555);
    const force = getWindForce(w, 70_000, 'EARTH');
    expect(force.windFX).toBe(0);
    expect(force.windFY).toBe(0);
  });

  it('returns zero wind above atmosphere top', () => {
    const w = generateWeather('EARTH', 555);
    const force = getWindForce(w, 100_000, 'EARTH');
    expect(force.windFX).toBe(0);
    expect(force.windFY).toBe(0);
  });

  it('returns non-zero wind at ground level for a windy day', () => {
    // Use a seed that generates wind.
    const w = generateWeather('EARTH', 42);
    if (w.windSpeed > 0.1) {
      const force = getWindForce(w, 0, 'EARTH');
      // Wind should be purely horizontal.
      expect(force.windFY).toBe(0);
      expect(Math.abs(force.windFX)).toBeGreaterThan(0);
    }
  });

  it('returns zero wind for airless bodies', () => {
    const w = generateWeather('MOON', 42);
    const force = getWindForce(w, 0, 'MOON');
    expect(force.windFX).toBe(0);
    expect(force.windFY).toBe(0);
  });

  it('wind decreases with altitude', () => {
    const w: WeatherConditions = { windSpeed: 10, windAngle: 0, temperature: 1.0, visibility: 0, extreme: false, description: 'Test', bodyId: 'EARTH' };
    const ground = getWindForce(w, 0, 'EARTH');
    const mid    = getWindForce(w, 35_000, 'EARTH');
    expect(Math.abs(ground.windFX)).toBeGreaterThan(Math.abs(mid.windFX));
  });
});

// ---------------------------------------------------------------------------
// getIspModifier()
// ---------------------------------------------------------------------------

describe('getIspModifier()', () => {
  it('returns 1.0 for null weather', () => {
    expect(getIspModifier(null)).toBe(1.0);
  });

  it('returns the temperature field from weather', () => {
    const w: WeatherConditions = { temperature: 1.03, windSpeed: 0, windAngle: 0, visibility: 0, extreme: false, description: 'Test', bodyId: 'EARTH' };
    expect(getIspModifier(w)).toBe(1.03);
  });

  it('weather temperature stays in valid range', () => {
    // Generate many weathers and check range.
    for (let seed = 0; seed < 100; seed++) {
      const w = generateWeather('EARTH', seed);
      expect(w.temperature).toBeGreaterThanOrEqual(1 - WEATHER_ISP_RANGE - 0.001);
      expect(w.temperature).toBeLessThanOrEqual(1 + WEATHER_ISP_RANGE + 0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// getWeatherForecast()
// ---------------------------------------------------------------------------

describe('getWeatherForecast()', () => {
  it('returns empty array with no weather satellites', () => {
    initWeather(state, 'EARTH');
    const forecast = getWeatherForecast(state, 'EARTH', 3);
    expect(forecast).toEqual([]);
  });

  it('returns forecast when weather satellite benefits exist', () => {
    initWeather(state, 'EARTH');

    // Manually simulate a weather satellite providing forecastAccuracy.
    // Deploy a weather satellite.
    const sat: SatelliteRecord = {
      id: 'sat-1',
      orbitalObjectId: 'orb-1',
      satelliteType: 'WEATHER',
      partId: 'satellite-weather',
      bodyId: 'EARTH',
      bandId: 'LEO',
      health: 100,
      autoMaintain: false,
      deployedPeriod: 0,
    };
    state.satelliteNetwork.satellites.push(sat);
    // Add a matching orbital object.
    state.orbitalObjects = state.orbitalObjects ?? [];
    const orb: OrbitalObject = {
      id: 'orb-1',
      bodyId: 'EARTH',
      type: 'SATELLITE',
      name: 'Weather Sat',
      elements: {
        semiMajorAxis: 6_500_000,
        eccentricity: 0,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
      },
    };
    state.orbitalObjects.push(orb);

    const forecast = getWeatherForecast(state, 'EARTH', 3);
    expect(forecast.length).toBe(3);
    forecast.forEach((fc) => {
      expect(fc.bodyId).toBe('EARTH');
      expect(typeof fc.description).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// Body-specific behaviour
// ---------------------------------------------------------------------------

describe('Body-specific weather', () => {
  it('Moon always has no weather', () => {
    for (let seed = 0; seed < 50; seed++) {
      const w = generateWeather('MOON', seed);
      expect(w.windSpeed).toBe(0);
      expect(w.visibility).toBe(0);
      expect(w.extreme).toBe(false);
    }
  });

  it('Mars can have dust storms (extreme)', () => {
    // Test many seeds to find at least one extreme event.
    let foundExtreme = false;
    for (let seed = 0; seed < 1000; seed++) {
      const w = generateWeather('MARS', seed);
      if (w.extreme) {
        foundExtreme = true;
        expect(w.description).toBe('Dust storm');
        expect(w.windSpeed).toBeGreaterThanOrEqual(20);
        break;
      }
    }
    expect(foundExtreme).toBe(true);
  });

  it('Earth can have severe storms (extreme)', () => {
    let foundExtreme = false;
    for (let seed = 0; seed < 1000; seed++) {
      const w = generateWeather('EARTH', seed);
      if (w.extreme) {
        foundExtreme = true;
        expect(w.description).toBe('Severe storm');
        break;
      }
    }
    expect(foundExtreme).toBe(true);
  });

  it('Phobos (airless, Mars moon) has no weather', () => {
    const w = generateWeather('PHOBOS', 42);
    expect(w.windSpeed).toBe(0);
    expect(w.description).toBe('No atmosphere');
  });

  it('Deimos (airless, Mars moon) has no weather', () => {
    const w = generateWeather('DEIMOS', 42);
    expect(w.windSpeed).toBe(0);
    expect(w.description).toBe('No atmosphere');
  });
});
