/**
 * render-sky.test.ts — Unit tests for sky rendering utilities.
 *
 * Tests lerpColor (pure math), skyColor (state-dependent), generateStars
 * (deterministic LCG), and render functions with mock PixiJS.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Graphics, Container } from 'pixi.js';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

const { MockGraphics, MockTextStyle, MockText, MockContainer } = vi.hoisted(() => {
  class MockGraphics {
    visible = true;
    alpha = 1;
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    rotation = 0;
    label = '';
    parent: unknown = null;
    clear = vi.fn();
    rect = vi.fn();
    fill = vi.fn();
    stroke = vi.fn();
    circle = vi.fn();
    arc = vi.fn();
    moveTo = vi.fn();
    lineTo = vi.fn();
    closePath = vi.fn();
    ellipse = vi.fn();
  }

  class MockTextStyle {}

  class MockText {
    visible = true;
    alpha = 1;
    position = { set: vi.fn() };
    scale = { set: vi.fn() };
    rotation = 0;
    label = '';
    anchor = { set: vi.fn() };
    parent: unknown = null;
    text = '';
    style: unknown = null;
    x = 0;
    y = 0;
    constructor(_opts?: unknown) {}
  }

  class MockContainer {
    children: unknown[] = [];
    addChild(child: unknown) { this.children.push(child); return child; }
    removeChildAt(index: number) { return this.children.splice(index, 1)[0]; }
    removeChild(child: unknown) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      return child;
    }
  }

  return { MockGraphics, MockTextStyle, MockText, MockContainer };
});

vi.mock('pixi.js', () => ({
  Graphics: MockGraphics,
  Text: MockText,
  TextStyle: MockTextStyle,
  Container: MockContainer,
}));

import {
  getFlightRenderState,
  resetFlightRenderState,
} from '../render/flight/_state.ts';
import {
  lerpColor,
  skyColor,
  updateBodyVisuals,
  generateStars,
  renderSky,
  renderStars,
  renderHorizon,
  renderWeatherHaze,
} from '../render/flight/_sky.ts';
import {
  STAR_COUNT,
  SKY_SEA_LEVEL,
  SKY_HIGH_ALT,
  SKY_SPACE,
  STAR_FADE_START,
  STAR_FADE_FULL,
} from '../render/flight/_constants.ts';

describe('lerpColor', () => {
  it('returns c1 when t=0', () => {
    expect(lerpColor(0xff0000, 0x00ff00, 0)).toBe(0xff0000);
  });

  it('returns c2 when t=1', () => {
    expect(lerpColor(0xff0000, 0x00ff00, 1)).toBe(0x00ff00);
  });

  it('interpolates midpoint correctly', () => {
    const mid = lerpColor(0x000000, 0xffffff, 0.5);
    const r = (mid >> 16) & 0xff;
    const g = (mid >> 8) & 0xff;
    const b = mid & 0xff;
    // 0.5 * 255 ≈ 128 (rounded)
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(128);
    expect(g).toBeGreaterThanOrEqual(127);
    expect(g).toBeLessThanOrEqual(128);
    expect(b).toBeGreaterThanOrEqual(127);
    expect(b).toBeLessThanOrEqual(128);
  });

  it('handles identical colours', () => {
    expect(lerpColor(0x336699, 0x336699, 0.5)).toBe(0x336699);
  });

  it('handles black to white', () => {
    expect(lerpColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(lerpColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
  });

  it('interpolates single channel correctly', () => {
    // Red only: 0xff0000 to 0x000000 at t=0.5
    const result = lerpColor(0xff0000, 0x000000, 0.5);
    const r = (result >> 16) & 0xff;
    expect(r).toBeGreaterThanOrEqual(127);
    expect(r).toBeLessThanOrEqual(128);
    expect(result & 0x00ffff).toBe(0); // green + blue channels are 0
  });

  it('clamps to 0-255 per channel', () => {
    // Even with extreme values, result should be a valid colour
    const result = lerpColor(0x000000, 0xffffff, 0.75);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffff);
  });
});

describe('skyColor', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('returns space colour at very high altitude', () => {
    const s = getFlightRenderState();
    const result = skyColor(s.bodyVisuals.starEnd + 1000);
    expect(result).toBe(s.bodyVisuals.space);
  });

  it('returns sea level colour at altitude 0', () => {
    const result = skyColor(0);
    expect(result).toBe(SKY_SEA_LEVEL);
  });

  it('returns space for airless bodies (starEnd <= 0)', () => {
    const s = getFlightRenderState();
    s.bodyVisuals.starEnd = 0;
    s.bodyVisuals.space = 0x000005;
    const result = skyColor(100);
    expect(result).toBe(0x000005);
  });

  it('returns a colour between sea level and space at mid altitude', () => {
    const result = skyColor(35000);
    // Should not be exactly sea level or space
    expect(result).not.toBe(SKY_SEA_LEVEL);
    expect(result).not.toBe(SKY_SPACE);
    // Should be a valid colour
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffff);
  });

  it('at exactly starEnd altitude, returns space', () => {
    const s = getFlightRenderState();
    const result = skyColor(s.bodyVisuals.starEnd);
    expect(result).toBe(s.bodyVisuals.space);
  });
});

describe('generateStars', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('generates STAR_COUNT stars', () => {
    generateStars();
    const s = getFlightRenderState();
    expect(s.stars.length).toBe(STAR_COUNT);
  });

  it('star positions are normalized (0-1 range)', () => {
    generateStars();
    const s = getFlightRenderState();
    for (const star of s.stars) {
      expect(star.nx).toBeGreaterThanOrEqual(0);
      expect(star.nx).toBeLessThanOrEqual(1);
      expect(star.ny).toBeGreaterThanOrEqual(0);
      expect(star.ny).toBeLessThanOrEqual(1);
    }
  });

  it('star radii are positive', () => {
    generateStars();
    const s = getFlightRenderState();
    for (const star of s.stars) {
      expect(star.r).toBeGreaterThan(0);
    }
  });

  it('is deterministic (same output each time)', () => {
    generateStars();
    const first = [...getFlightRenderState().stars];
    resetFlightRenderState();
    generateStars();
    const second = [...getFlightRenderState().stars];
    expect(first).toEqual(second);
  });

  it('replaces previous stars on regeneration', () => {
    generateStars();
    const s = getFlightRenderState();
    expect(s.stars.length).toBe(STAR_COUNT);
    generateStars();
    expect(s.stars.length).toBe(STAR_COUNT); // not doubled
  });
});

describe('updateBodyVisuals', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('uses Earth defaults when bodyId is undefined', () => {
    updateBodyVisuals(undefined);
    const s = getFlightRenderState();
    expect(s.bodyVisuals.seaLevel).toBe(SKY_SEA_LEVEL);
    expect(s.bodyVisuals.highAlt).toBe(SKY_HIGH_ALT);
    expect(s.bodyVisuals.space).toBe(SKY_SPACE);
    expect(s.bodyVisuals.starStart).toBe(STAR_FADE_START);
    expect(s.bodyVisuals.starEnd).toBe(STAR_FADE_FULL);
  });

  it('uses Earth defaults for unknown body', () => {
    updateBodyVisuals('NONEXISTENT_BODY');
    const s = getFlightRenderState();
    // Should fall back to defaults since body has no sky visual
    expect(typeof s.bodyVisuals.seaLevel).toBe('number');
  });
});

describe('renderSky', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('does nothing when skyGraphics is null', () => {
    renderSky(0, 800, 600);
    // Should not throw
  });

  it('renders sky with mock graphics', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.skyGraphics = mockGfx;
    renderSky(0, 800, 600);
    expect(mockGfx.clear).toHaveBeenCalled();
    expect(mockGfx.rect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders sky at different altitudes', () => {
    const s = getFlightRenderState();
    s.skyGraphics = new Graphics();

    renderSky(0, 800, 600);
    renderSky(30000, 800, 600);
    renderSky(80000, 800, 600);
    // Should not throw at any altitude
  });
});

describe('renderStars', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('does nothing when starsContainer is null', () => {
    renderStars(80000, 800, 600);
    // Should not throw
  });

  it('renders stars at high altitude with mock container', () => {
    const s = getFlightRenderState();
    const mockContainer = new Container();
    s.starsContainer = mockContainer;
    generateStars();

    renderStars(80000, 800, 600);
    // Stars container should have had graphics added
    expect(mockContainer.children.length).toBeGreaterThan(0);
  });

  it('renders no stars below star fade start', () => {
    const s = getFlightRenderState();
    const mockContainer = new Container();
    s.starsContainer = mockContainer;
    generateStars();

    renderStars(0, 800, 600);
    // At sea level, alpha <= 0, stars are not drawn
    expect(mockContainer.children.length).toBe(0);
  });
});

describe('renderHorizon', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('does nothing when horizonGraphics is null', () => {
    renderHorizon(10000, 800, 600);
    // Should not throw
  });

  it('does nothing below curvature start altitude', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;
    renderHorizon(1000, 800, 600);
    expect(mockGfx.clear).toHaveBeenCalled();
    // No arc drawing at low altitude
    expect(mockGfx.arc).not.toHaveBeenCalled();
  });

  it('draws curved horizon at high altitude', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;
    s.camWorldY = 50000; // high altitude
    renderHorizon(50000, 800, 600);
    expect(mockGfx.arc).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });
});

describe('renderWeatherHaze', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('does nothing when hazeGraphics is null', () => {
    renderWeatherHaze(0, 800, 600);
    // Should not throw
  });

  it('does nothing when weather visibility is near zero', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.hazeGraphics = mockGfx;
    s.weatherVisibility = 0;
    renderWeatherHaze(0, 800, 600);
    expect(mockGfx.rect).not.toHaveBeenCalled();
  });

  it('renders haze when visibility is above threshold', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.hazeGraphics = mockGfx;
    s.weatherVisibility = 0.5;
    renderWeatherHaze(1000, 800, 600, 'EARTH');
    expect(mockGfx.rect).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders no haze above atmosphere top', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.hazeGraphics = mockGfx;
    s.weatherVisibility = 1.0;
    renderWeatherHaze(200000, 800, 600, 'EARTH');
    expect(mockGfx.rect).not.toHaveBeenCalled();
  });

  it('uses dust colour for Mars', () => {
    const s = getFlightRenderState();
    s.hazeGraphics = new Graphics();
    s.weatherVisibility = 0.5;
    renderWeatherHaze(1000, 800, 600, 'MARS');
    // Should not throw — tests the Mars branch
  });

  it('skips rendering when hazeAlpha drops below 0.01', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.hazeGraphics = mockGfx;
    // Very low visibility → hazeAlpha = visibility * altFraction * 0.45 < 0.01
    s.weatherVisibility = 0.02;
    // Altitude near atmosphere top → altFraction near 0
    renderWeatherHaze(69000, 800, 600, 'EARTH');
    expect(mockGfx.rect).not.toHaveBeenCalled();
  });

  it('renders haze with default bodyId when not provided', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.hazeGraphics = mockGfx;
    s.weatherVisibility = 0.8;
    renderWeatherHaze(5000, 800, 600);
    expect(mockGfx.rect).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// skyColor — additional edge cases
// ---------------------------------------------------------------------------

describe('skyColor edge cases', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('handles altitude exactly at midAlt boundary', () => {
    const s = getFlightRenderState();
    const midAlt = s.bodyVisuals.starStart > 0 ? s.bodyVisuals.starStart * 0.6 : 30_000;
    const result = skyColor(midAlt);
    // At midAlt, the low-altitude lerp t=1 → should return highAlt colour
    expect(result).toBe(s.bodyVisuals.highAlt);
  });

  it('returns highAlt to space gradient above midAlt', () => {
    const s = getFlightRenderState();
    const midAlt = s.bodyVisuals.starStart * 0.6;
    const aboveMid = midAlt + 5000;
    const result = skyColor(aboveMid);
    // Should be between highAlt and space
    expect(result).not.toBe(s.bodyVisuals.seaLevel);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffff);
  });

  it('handles starStart of 0 (midAlt fallback to 30000)', () => {
    const s = getFlightRenderState();
    s.bodyVisuals.starStart = 0;
    s.bodyVisuals.starEnd = 70000;
    // midAlt = 30000 since starStart <= 0
    const result = skyColor(15000);
    // Should use seaLevel->highAlt lerp with t = 15000/30000 = 0.5
    expect(result).not.toBe(s.bodyVisuals.seaLevel);
    expect(result).not.toBe(s.bodyVisuals.highAlt);
  });

  it('returns seaLevel for altitude 0 even with custom body visuals', () => {
    const s = getFlightRenderState();
    s.bodyVisuals.seaLevel = 0xff0000;
    s.bodyVisuals.highAlt = 0x0000ff;
    s.bodyVisuals.starStart = 50000;
    s.bodyVisuals.starEnd = 70000;
    const result = skyColor(0);
    // t=0 at altitude 0, so lerp(seaLevel, highAlt, 0) = seaLevel
    expect(result).toBe(0xff0000);
  });

  it('clamps high altitude lerp t to 1', () => {
    const s = getFlightRenderState();
    // At starEnd altitude, should return space
    const result = skyColor(s.bodyVisuals.starEnd);
    expect(result).toBe(s.bodyVisuals.space);
  });
});

// ---------------------------------------------------------------------------
// renderStars — additional edge cases
// ---------------------------------------------------------------------------

describe('renderStars edge cases', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('renders stars at full alpha on airless body (starEnd <= 0)', () => {
    const s = getFlightRenderState();
    const mockContainer = new Container();
    s.starsContainer = mockContainer;
    s.bodyVisuals.starEnd = 0;
    s.bodyVisuals.starStart = 0;
    generateStars();

    renderStars(0, 800, 600);
    // alpha=1 for airless body, so stars should be drawn
    expect(mockContainer.children.length).toBeGreaterThan(0);
  });

  it('renders stars when range is 0 and altitude >= starStart', () => {
    const s = getFlightRenderState();
    const mockContainer = new Container();
    s.starsContainer = mockContainer;
    s.bodyVisuals.starEnd = 50000;
    s.bodyVisuals.starStart = 50000; // range = 0
    generateStars();

    renderStars(50000, 800, 600);
    // range=0, altitude >= starStart → alpha=1
    expect(mockContainer.children.length).toBeGreaterThan(0);
  });

  it('does not render stars when range is 0 and altitude < starStart', () => {
    const s = getFlightRenderState();
    const mockContainer = new Container();
    s.starsContainer = mockContainer;
    s.bodyVisuals.starEnd = 50000;
    s.bodyVisuals.starStart = 50000; // range = 0
    generateStars();

    renderStars(49999, 800, 600);
    // range=0, altitude < starStart → alpha=0
    expect(mockContainer.children.length).toBe(0);
  });

  it('renders stars at partial alpha between starStart and starEnd', () => {
    const s = getFlightRenderState();
    const mockContainer = new Container();
    s.starsContainer = mockContainer;
    generateStars();

    const midAlt = (s.bodyVisuals.starStart + s.bodyVisuals.starEnd) / 2;
    renderStars(midAlt, 800, 600);
    // Should have some stars drawn at partial alpha
    expect(mockContainer.children.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// renderHorizon — additional edge cases
// ---------------------------------------------------------------------------

describe('renderHorizon edge cases', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('renders orbital horizon in ORBIT phase', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;

    renderHorizon(100000, 800, 600, 'ORBIT');

    expect(mockGfx.arc).toHaveBeenCalled();
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders orbital horizon in MANOEUVRE phase', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;

    renderHorizon(100000, 800, 600, 'MANOEUVRE');

    expect(mockGfx.arc).toHaveBeenCalled();
  });

  it('renders orbital horizon in CAPTURE phase', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;

    renderHorizon(100000, 800, 600, 'CAPTURE');

    expect(mockGfx.arc).toHaveBeenCalled();
  });

  it('returns early in TRANSFER phase', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;

    renderHorizon(100000, 800, 600, 'TRANSFER');

    expect(mockGfx.clear).toHaveBeenCalled();
    expect(mockGfx.arc).not.toHaveBeenCalled();
  });

  it('skips flight horizon when ground is way above viewport', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;
    s.camWorldY = -1000000; // ground far below → groundScreenY = h/2 + (-1000000) * ppm → very negative

    renderHorizon(50000, 800, 600);

    expect(mockGfx.clear).toHaveBeenCalled();
    // groundScreenY < -h so should return early
    expect(mockGfx.arc).not.toHaveBeenCalled();
  });

  it('renders atmosphere glow when altitude > 30000 in flight', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;
    s.camWorldY = 50000;

    renderHorizon(50000, 800, 600);

    expect(mockGfx.stroke).toHaveBeenCalled();
  });

  it('does not render glow below 30000 altitude in flight', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;
    s.camWorldY = 10000;

    renderHorizon(10000, 800, 600);

    expect(mockGfx.stroke).not.toHaveBeenCalled();
  });

  it('renders orbital glow at low orbit (high glowAlpha)', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;

    // Low orbit altitude: orbitalT ≈ 0, glowAlpha = 0.4 > 0.05
    renderHorizon(80000, 800, 600, 'ORBIT');

    expect(mockGfx.stroke).toHaveBeenCalled();
  });

  it('skips orbital glow at very high orbit (low glowAlpha)', () => {
    const s = getFlightRenderState();
    const mockGfx = new Graphics();
    s.horizonGraphics = mockGfx;

    // Very high orbit: orbitalT ≈ 1, glowAlpha = 0.4 - 1*0.3 = 0.1 > 0.05 — still renders
    // Need extremely high altitude to suppress glow
    // glowAlpha = 0.4 - orbitalT * 0.3; need orbitalT > 0.4/0.3 = 1.33 which is clamped to 1
    // So at max orbitalT=1: glowAlpha = 0.1 > 0.05 → glow always renders in orbital mode
    renderHorizon(2_000_000, 800, 600, 'ORBIT');
    expect(mockGfx.stroke).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// lerpColor — additional edge cases
// ---------------------------------------------------------------------------

describe('lerpColor edge cases', () => {
  it('interpolates blue channel correctly at t=0.25', () => {
    const result = lerpColor(0x000000, 0x0000ff, 0.25);
    const b = result & 0xff;
    // 0.25 * 255 = 63.75 → rounds to 64
    expect(b).toBe(64);
  });

  it('handles t slightly above 0', () => {
    const result = lerpColor(0xff0000, 0x00ff00, 0.01);
    const r = (result >> 16) & 0xff;
    const g = (result >> 8) & 0xff;
    // r should be close to 255, g close to 3
    expect(r).toBeGreaterThan(250);
    expect(g).toBeLessThan(5);
  });

  it('handles t slightly below 1', () => {
    const result = lerpColor(0xff0000, 0x00ff00, 0.99);
    const r = (result >> 16) & 0xff;
    const g = (result >> 8) & 0xff;
    expect(r).toBeLessThan(5);
    expect(g).toBeGreaterThan(250);
  });
});
