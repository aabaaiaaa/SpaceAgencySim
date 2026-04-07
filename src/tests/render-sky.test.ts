// @ts-nocheck
/**
 * render-sky.test.ts — Unit tests for sky rendering utilities.
 *
 * Tests lerpColor (pure math), skyColor (state-dependent), generateStars
 * (deterministic LCG), and render functions with mock PixiJS.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    parent = null;
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
    parent = null;
    text = '';
    style = null;
    x = 0;
    y = 0;
    constructor(_opts?) {}
  }

  class MockContainer {
    children = [];
    addChild(child) { this.children.push(child); return child; }
    removeChildAt(index) { return this.children.splice(index, 1)[0]; }
    removeChild(child) {
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
    const mockGfx = new MockGraphics();
    s.skyGraphics = mockGfx;
    renderSky(0, 800, 600);
    expect(mockGfx.clear).toHaveBeenCalled();
    expect(mockGfx.rect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(mockGfx.fill).toHaveBeenCalled();
  });

  it('renders sky at different altitudes', () => {
    const s = getFlightRenderState();
    s.skyGraphics = new MockGraphics();

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
    s.starsContainer = new MockContainer();
    generateStars();

    renderStars(80000, 800, 600);
    // Stars container should have had graphics added
    expect(s.starsContainer.children.length).toBeGreaterThan(0);
  });

  it('renders no stars below star fade start', () => {
    const s = getFlightRenderState();
    s.starsContainer = new MockContainer();
    generateStars();

    renderStars(0, 800, 600);
    // At sea level, alpha <= 0, stars are not drawn
    expect(s.starsContainer.children.length).toBe(0);
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
    const mockGfx = new MockGraphics();
    s.horizonGraphics = mockGfx;
    renderHorizon(1000, 800, 600);
    expect(mockGfx.clear).toHaveBeenCalled();
    // No arc drawing at low altitude
    expect(mockGfx.arc).not.toHaveBeenCalled();
  });

  it('draws curved horizon at high altitude', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
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
    s.hazeGraphics = new MockGraphics();
    s.weatherVisibility = 0;
    renderWeatherHaze(0, 800, 600);
    expect(s.hazeGraphics.rect).not.toHaveBeenCalled();
  });

  it('renders haze when visibility is above threshold', () => {
    const s = getFlightRenderState();
    s.hazeGraphics = new MockGraphics();
    s.weatherVisibility = 0.5;
    renderWeatherHaze(1000, 800, 600, 'EARTH');
    expect(s.hazeGraphics.rect).toHaveBeenCalled();
    expect(s.hazeGraphics.fill).toHaveBeenCalled();
  });

  it('renders no haze above atmosphere top', () => {
    const s = getFlightRenderState();
    const mockGfx = new MockGraphics();
    s.hazeGraphics = mockGfx;
    s.weatherVisibility = 1.0;
    renderWeatherHaze(200000, 800, 600, 'EARTH');
    expect(mockGfx.rect).not.toHaveBeenCalled();
  });

  it('uses dust colour for Mars', () => {
    const s = getFlightRenderState();
    s.hazeGraphics = new MockGraphics();
    s.weatherVisibility = 0.5;
    renderWeatherHaze(1000, 800, 600, 'MARS');
    // Should not throw — tests the Mars branch
  });
});
