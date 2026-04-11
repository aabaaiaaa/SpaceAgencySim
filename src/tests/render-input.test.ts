/**
 * render-input.test.ts — Unit tests for flight input handlers.
 *
 * Tests onMouseMove (position tracking) and onWheel (zoom clamping)
 * from src/render/flight/_input.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

vi.mock('pixi.js', () => ({
  Graphics: class {},
  Text: class { constructor() {} },
  TextStyle: class {},
  Container: class { children: unknown[] = []; addChild(c: unknown) { this.children.push(c); } removeChildAt(i: number) { return this.children.splice(i,1)[0]; } removeChild(c: unknown) { const i = this.children.indexOf(c); if(i>=0) this.children.splice(i,1); return c; } },
}));

import {
  getFlightRenderState,
  resetFlightRenderState,
  setFlightRenderState,
} from '../render/flight/_state.ts';
import { onMouseMove, onWheel } from '../render/flight/_input.ts';
import { MIN_ZOOM, MAX_ZOOM } from '../render/flight/_constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMouseEvent(clientX: number, clientY: number): MouseEvent {
  return { clientX, clientY } as MouseEvent;
}

function makeWheelEvent(deltaY: number): WheelEvent {
  // @ts-expect-error — minimal WheelEvent mock with only the fields our tests need
  return { deltaY, preventDefault: vi.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('onMouseMove', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('updates mouseX and mouseY from event', () => {
    onMouseMove(makeMouseEvent(200, 300));
    const s = getFlightRenderState();
    expect(s.mouseX).toBe(200);
    expect(s.mouseY).toBe(300);
  });

  it('tracks position changes over multiple events', () => {
    onMouseMove(makeMouseEvent(100, 100));
    onMouseMove(makeMouseEvent(500, 400));
    const s = getFlightRenderState();
    expect(s.mouseX).toBe(500);
    expect(s.mouseY).toBe(400);
  });
});

describe('onWheel', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('zooms in on scroll up (negative deltaY)', () => {
    const s = getFlightRenderState();
    const before = s.zoomLevel;
    onWheel(makeWheelEvent(-100));
    expect(s.zoomLevel).toBeGreaterThan(before);
  });

  it('zooms out on scroll down (positive deltaY)', () => {
    const s = getFlightRenderState();
    const before = s.zoomLevel;
    onWheel(makeWheelEvent(100));
    expect(s.zoomLevel).toBeLessThan(before);
  });

  it('calls preventDefault', () => {
    const evt = makeWheelEvent(-100);
    onWheel(evt);
    expect(evt.preventDefault).toHaveBeenCalled();
  });

  it('clamps zoom to MIN_ZOOM on extreme scroll out', () => {
    const s = getFlightRenderState();
    for (let i = 0; i < 50; i++) {
      onWheel(makeWheelEvent(100));
    }
    expect(s.zoomLevel).toBeGreaterThanOrEqual(MIN_ZOOM);
  });

  it('clamps zoom to MAX_ZOOM on extreme scroll in', () => {
    const s = getFlightRenderState();
    for (let i = 0; i < 50; i++) {
      onWheel(makeWheelEvent(-100));
    }
    expect(s.zoomLevel).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('does nothing when input is disabled', () => {
    setFlightRenderState({ inputEnabled: false });
    const s = getFlightRenderState();
    const before = s.zoomLevel;
    onWheel(makeWheelEvent(-100));
    expect(s.zoomLevel).toBe(before);
  });

  it('zoom factor is ~1.2x per scroll step', () => {
    const s = getFlightRenderState();
    const before = s.zoomLevel;
    onWheel(makeWheelEvent(-1)); // scroll up
    expect(s.zoomLevel).toBeCloseTo(before * 1.2, 1);
  });

  it('zoom out is inverse of zoom in', () => {
    const s = getFlightRenderState();
    const original = s.zoomLevel;
    onWheel(makeWheelEvent(-1)); // zoom in
    onWheel(makeWheelEvent(1));  // zoom out
    expect(s.zoomLevel).toBeCloseTo(original, 5);
  });
});
