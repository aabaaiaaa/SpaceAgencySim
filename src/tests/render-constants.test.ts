/**
 * render-constants.test.ts — Unit tests for flight render constants.
 *
 * Verifies that all exported constants from src/render/flight/_constants.ts
 * exist, have the correct types, and have sensible values.
 */

import { describe, it, expect } from 'vitest';
import { PartType, SurfaceItemType } from '../core/constants.ts';
import {
  FLIGHT_PIXELS_PER_METRE,
  SCALE_M_PER_PX,
  MIN_ZOOM,
  MAX_ZOOM,
  SKY_SEA_LEVEL,
  SKY_HIGH_ALT,
  SKY_SPACE,
  GROUND_COLOR,
  STAR_FADE_START,
  STAR_FADE_FULL,
  STAR_COUNT,
  TRAIL_MAX_AGE,
  TRAIL_ATMOSPHERE_AGE_BONUS,
  TRAIL_DENSITY_THRESHOLD,
  TRAIL_DRIFT_SPEED,
  TRAIL_FAN_SPEED,
  TRAIL_FAN_VELOCITY_CUTOFF,
  PLUME_SEGMENTS,
  PLUME_PHASE_RATE_LIQUID,
  PLUME_PHASE_RATE_SRB,
  CAM_OFFSET_DECAY_RATE,
  PART_FILL,
  PART_STROKE,
  SURFACE_ITEM_COLORS,
  BIOME_LABEL_FADE_SPEED,
  RCS_PLUME_COLOR,
  RCS_PLUME_LENGTH,
  RCS_PLUME_HALF_WIDTH,
  MACH_1,
} from '../render/flight/_constants.ts';

describe('Flight render constants', () => {
  describe('scale constants', () => {
    it('FLIGHT_PIXELS_PER_METRE is a positive number', () => {
      expect(typeof FLIGHT_PIXELS_PER_METRE).toBe('number');
      expect(FLIGHT_PIXELS_PER_METRE).toBeGreaterThan(0);
    });

    it('SCALE_M_PER_PX is a positive fraction', () => {
      expect(SCALE_M_PER_PX).toBeGreaterThan(0);
      expect(SCALE_M_PER_PX).toBeLessThan(1);
    });

    it('SCALE_M_PER_PX is inverse of FLIGHT_PIXELS_PER_METRE', () => {
      expect(SCALE_M_PER_PX).toBeCloseTo(1 / FLIGHT_PIXELS_PER_METRE);
    });

    it('MIN_ZOOM < MAX_ZOOM', () => {
      expect(MIN_ZOOM).toBeGreaterThan(0);
      expect(MAX_ZOOM).toBeGreaterThan(MIN_ZOOM);
    });
  });

  describe('sky colour constants', () => {
    it('sky colours are valid 24-bit hex numbers', () => {
      for (const color of [SKY_SEA_LEVEL, SKY_HIGH_ALT, SKY_SPACE]) {
        expect(typeof color).toBe('number');
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
    });
  });

  describe('ground colour', () => {
    it('GROUND_COLOR is a valid 24-bit hex number', () => {
      expect(typeof GROUND_COLOR).toBe('number');
      expect(GROUND_COLOR).toBeGreaterThanOrEqual(0);
      expect(GROUND_COLOR).toBeLessThanOrEqual(0xffffff);
    });
  });

  describe('star constants', () => {
    it('STAR_FADE_START < STAR_FADE_FULL', () => {
      expect(STAR_FADE_START).toBeLessThan(STAR_FADE_FULL);
    });

    it('STAR_COUNT is a positive integer', () => {
      expect(Number.isInteger(STAR_COUNT)).toBe(true);
      expect(STAR_COUNT).toBeGreaterThan(0);
    });
  });

  describe('trail constants', () => {
    it('TRAIL_MAX_AGE is positive', () => {
      expect(TRAIL_MAX_AGE).toBeGreaterThan(0);
    });

    it('TRAIL_ATMOSPHERE_AGE_BONUS is positive', () => {
      expect(TRAIL_ATMOSPHERE_AGE_BONUS).toBeGreaterThan(0);
    });

    it('TRAIL_DENSITY_THRESHOLD is a small positive number', () => {
      expect(TRAIL_DENSITY_THRESHOLD).toBeGreaterThan(0);
      expect(TRAIL_DENSITY_THRESHOLD).toBeLessThan(1);
    });

    it('TRAIL_DRIFT_SPEED is positive', () => {
      expect(TRAIL_DRIFT_SPEED).toBeGreaterThan(0);
    });

    it('TRAIL_FAN_SPEED is positive', () => {
      expect(TRAIL_FAN_SPEED).toBeGreaterThan(0);
    });

    it('TRAIL_FAN_VELOCITY_CUTOFF is positive', () => {
      expect(TRAIL_FAN_VELOCITY_CUTOFF).toBeGreaterThan(0);
    });
  });

  describe('plume constants', () => {
    it('PLUME_SEGMENTS is a positive integer', () => {
      expect(Number.isInteger(PLUME_SEGMENTS)).toBe(true);
      expect(PLUME_SEGMENTS).toBeGreaterThan(0);
    });

    it('SRB phase rate is greater than liquid phase rate', () => {
      expect(PLUME_PHASE_RATE_SRB).toBeGreaterThan(PLUME_PHASE_RATE_LIQUID);
    });
  });

  describe('camera constants', () => {
    it('CAM_OFFSET_DECAY_RATE is positive', () => {
      expect(CAM_OFFSET_DECAY_RATE).toBeGreaterThan(0);
    });
  });

  describe('PART_FILL lookup', () => {
    it('has entries for all engine-related part types', () => {
      expect(PART_FILL[PartType.ENGINE]).toBeDefined();
      expect(PART_FILL[PartType.SOLID_ROCKET_BOOSTER]).toBeDefined();
      expect(PART_FILL[PartType.FUEL_TANK]).toBeDefined();
    });

    it('has entries for structural part types', () => {
      expect(PART_FILL[PartType.COMMAND_MODULE]).toBeDefined();
      expect(PART_FILL[PartType.STACK_DECOUPLER]).toBeDefined();
      expect(PART_FILL[PartType.LANDING_LEG]).toBeDefined();
      expect(PART_FILL[PartType.PARACHUTE]).toBeDefined();
    });

    it('all values are valid 24-bit hex colours', () => {
      for (const [, color] of Object.entries(PART_FILL)) {
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
    });
  });

  describe('PART_STROKE lookup', () => {
    it('has matching keys to PART_FILL', () => {
      const fillKeys = Object.keys(PART_FILL).sort();
      const strokeKeys = Object.keys(PART_STROKE).sort();
      expect(strokeKeys).toEqual(fillKeys);
    });

    it('all values are valid 24-bit hex colours', () => {
      for (const [, color] of Object.entries(PART_STROKE)) {
        expect(color).toBeGreaterThanOrEqual(0);
        expect(color).toBeLessThanOrEqual(0xffffff);
      }
    });
  });

  describe('SURFACE_ITEM_COLORS', () => {
    it('has entries for all surface item types', () => {
      expect(SURFACE_ITEM_COLORS[SurfaceItemType.FLAG]).toBeDefined();
      expect(SURFACE_ITEM_COLORS[SurfaceItemType.SURFACE_SAMPLE]).toBeDefined();
      expect(SURFACE_ITEM_COLORS[SurfaceItemType.SURFACE_INSTRUMENT]).toBeDefined();
      expect(SURFACE_ITEM_COLORS[SurfaceItemType.BEACON]).toBeDefined();
    });
  });

  describe('biome label', () => {
    it('BIOME_LABEL_FADE_SPEED is positive', () => {
      expect(BIOME_LABEL_FADE_SPEED).toBeGreaterThan(0);
    });
  });

  describe('RCS plume constants', () => {
    it('RCS_PLUME_COLOR is a valid colour', () => {
      expect(RCS_PLUME_COLOR).toBeGreaterThanOrEqual(0);
      expect(RCS_PLUME_COLOR).toBeLessThanOrEqual(0xffffff);
    });

    it('RCS_PLUME_LENGTH is positive', () => {
      expect(RCS_PLUME_LENGTH).toBeGreaterThan(0);
    });

    it('RCS_PLUME_HALF_WIDTH is positive and less than length', () => {
      expect(RCS_PLUME_HALF_WIDTH).toBeGreaterThan(0);
      expect(RCS_PLUME_HALF_WIDTH).toBeLessThan(RCS_PLUME_LENGTH);
    });
  });

  describe('Mach constant', () => {
    it('MACH_1 is approximately 343 m/s', () => {
      expect(MACH_1).toBe(343);
    });
  });
});
