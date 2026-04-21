// @vitest-environment jsdom
/**
 * ui-draggableOverlay.test.ts — Unit tests for the shared draggable overlay
 * utility used by the FPS monitor and perf dashboard.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clampToViewport,
  makeDraggableOverlay,
} from '../ui/draggableOverlay.ts';

// Set up a fixed viewport for deterministic clamp calculations.
beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, writable: true, configurable: true });
});

// ---------------------------------------------------------------------------
// clampToViewport
// ---------------------------------------------------------------------------

describe('clampToViewport', () => {
  it('returns the position unchanged when already in bounds', () => {
    const out = clampToViewport({ x: 100, y: 100 }, 50, 50, 1024, 768);
    expect(out).toEqual({ x: 100, y: 100 });
  });

  it('clamps negative x and y to the margin', () => {
    const out = clampToViewport({ x: -50, y: -10 }, 50, 50, 1024, 768);
    expect(out.x).toBeGreaterThan(0);
    expect(out.y).toBeGreaterThan(0);
  });

  it('clamps positions that would push the element off the right edge', () => {
    const out = clampToViewport({ x: 2000, y: 100 }, 100, 100, 1024, 768);
    expect(out.x).toBeLessThanOrEqual(1024 - 100);
  });

  it('clamps positions that would push the element off the bottom edge', () => {
    const out = clampToViewport({ x: 100, y: 2000 }, 100, 100, 1024, 768);
    expect(out.y).toBeLessThanOrEqual(768 - 100);
  });

  it('degenerates gracefully when the element is larger than the viewport', () => {
    const out = clampToViewport({ x: 0, y: 0 }, 2000, 2000, 1024, 768);
    // Should not produce NaN or negative infinity — stays at the margin.
    expect(Number.isFinite(out.x)).toBe(true);
    expect(Number.isFinite(out.y)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// makeDraggableOverlay — lifecycle and pointer behaviour
// ---------------------------------------------------------------------------

/** Build a positioned HTML element with a mocked bounding-client rect. */
function createMockOverlay(initialRect: {
  left: number; top: number; width: number; height: number;
}): HTMLDivElement {
  const el = document.createElement('div');
  // Give the element realistic offset dimensions for clamp math.
  Object.defineProperty(el, 'offsetWidth', { value: initialRect.width, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: initialRect.height, configurable: true });
  el.getBoundingClientRect = vi.fn((): DOMRect => ({
    left: initialRect.left,
    top: initialRect.top,
    right: initialRect.left + initialRect.width,
    bottom: initialRect.top + initialRect.height,
    width: initialRect.width,
    height: initialRect.height,
    x: initialRect.left,
    y: initialRect.top,
    toJSON: () => ({}),
  } as DOMRect));
  el.setPointerCapture = vi.fn() as typeof el.setPointerCapture;
  el.releasePointerCapture = vi.fn() as typeof el.releasePointerCapture;
  document.body.appendChild(el);
  return el;
}

/** Dispatch a pointer event of the given type with the given coords. */
function firePointer(el: HTMLElement, type: string, clientX: number, clientY: number, pointerId = 1): void {
  const e = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
  // Augment with pointer-specific fields jsdom doesn't set by default.
  Object.defineProperty(e, 'pointerId', { value: pointerId, configurable: true });
  el.dispatchEvent(e);
}

describe('makeDraggableOverlay', () => {
  it('applies the initial position to the element', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    makeDraggableOverlay(el, {
      initialPosition: { x: 200, y: 300 },
      onPositionChange: vi.fn(),
    });
    expect(el.style.left).toBe('200px');
    expect(el.style.top).toBe('300px');
    expect(el.style.right).toBe('auto');
    expect(el.style.bottom).toBe('auto');
  });

  it('does not apply inline styles when initialPosition is null', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    makeDraggableOverlay(el, {
      initialPosition: null,
      onPositionChange: vi.fn(),
    });
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
  });

  it('does not fire onPositionChange on a click below the hysteresis threshold @smoke', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const onPositionChange = vi.fn();
    makeDraggableOverlay(el, { initialPosition: null, onPositionChange });

    firePointer(el, 'pointerdown', 850, 70);
    firePointer(el, 'pointermove', 853, 72); // 3.6px — below 8px hysteresis
    firePointer(el, 'pointerup', 853, 72);

    expect(onPositionChange).not.toHaveBeenCalled();
    expect(el.classList.contains('dragging')).toBe(false);
  });

  it('commits to drag once past hysteresis and fires onPositionChange on release @smoke', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const onPositionChange = vi.fn();
    makeDraggableOverlay(el, { initialPosition: null, onPositionChange });

    firePointer(el, 'pointerdown', 850, 70);
    firePointer(el, 'pointermove', 870, 90); // ~28px — well past hysteresis
    firePointer(el, 'pointerup', 870, 90);

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    // No assertion on exact coords here because getBoundingClientRect is
    // mocked to the initial rect; we care that the call happened.
    expect(el.classList.contains('dragging')).toBe(false);
  });

  it('applies the .dragging class while a drag is in progress', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    makeDraggableOverlay(el, { initialPosition: null, onPositionChange: vi.fn() });

    firePointer(el, 'pointerdown', 850, 70);
    firePointer(el, 'pointermove', 870, 90);
    expect(el.classList.contains('dragging')).toBe(true);

    firePointer(el, 'pointerup', 870, 90);
    expect(el.classList.contains('dragging')).toBe(false);
  });

  it('ignores non-primary-button pointerdown', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const onPositionChange = vi.fn();
    makeDraggableOverlay(el, { initialPosition: null, onPositionChange });

    const e = new MouseEvent('pointerdown', { bubbles: true, clientX: 850, clientY: 70, button: 2 });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    el.dispatchEvent(e);

    firePointer(el, 'pointermove', 870, 90);
    firePointer(el, 'pointerup', 870, 90);

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('cancels a drag on pointercancel without firing onPositionChange', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const onPositionChange = vi.fn();
    makeDraggableOverlay(el, { initialPosition: null, onPositionChange });

    firePointer(el, 'pointerdown', 850, 70);
    firePointer(el, 'pointermove', 870, 90);
    expect(el.classList.contains('dragging')).toBe(true);

    const cancel = new MouseEvent('pointercancel', { bubbles: true });
    Object.defineProperty(cancel, 'pointerId', { value: 1 });
    el.dispatchEvent(cancel);

    expect(onPositionChange).not.toHaveBeenCalled();
    expect(el.classList.contains('dragging')).toBe(false);
  });

  it('re-clamps on window resize if an inline position is set', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const handle = makeDraggableOverlay(el, {
      initialPosition: { x: 900, y: 50 },
      onPositionChange: vi.fn(),
    });
    expect(el.style.left).toBe('900px');

    // Shrink the viewport so the element no longer fits at x=900.
    Object.defineProperty(window, 'innerWidth', { value: 500, writable: true, configurable: true });
    // The getBoundingClientRect mock still returns the original rect. Update
    // so re-clamp sees the current inline position.
    (el.getBoundingClientRect as ReturnType<typeof vi.fn>).mockReturnValue({
      left: 900, top: 50, right: 1000, bottom: 90,
      width: 100, height: 40, x: 900, y: 50, toJSON: () => ({}),
    });

    window.dispatchEvent(new Event('resize'));

    // New max x is 500 - 100 - margin.
    expect(parseInt(el.style.left)).toBeLessThanOrEqual(500 - 100);
    handle.destroy();
  });

  it('does not re-clamp on resize when no inline position is set', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    makeDraggableOverlay(el, { initialPosition: null, onPositionChange: vi.fn() });

    window.dispatchEvent(new Event('resize'));

    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
  });

  it('destroy() removes listeners and clears inline styles', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const onPositionChange = vi.fn();
    const handle = makeDraggableOverlay(el, {
      initialPosition: { x: 100, y: 100 },
      onPositionChange,
    });

    handle.destroy();

    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');

    // After destroy, pointer events should not produce onPositionChange.
    firePointer(el, 'pointerdown', 850, 70);
    firePointer(el, 'pointermove', 900, 120);
    firePointer(el, 'pointerup', 900, 120);

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('applyPosition(pos) updates inline styles without firing onPositionChange', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const onPositionChange = vi.fn();
    const handle = makeDraggableOverlay(el, {
      initialPosition: null,
      onPositionChange,
    });

    handle.applyPosition({ x: 200, y: 300 });

    expect(el.style.left).toBe('200px');
    expect(el.style.top).toBe('300px');
    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('applyPosition(null) clears inline styles', () => {
    const el = createMockOverlay({ left: 800, top: 50, width: 100, height: 40 });
    const handle = makeDraggableOverlay(el, {
      initialPosition: { x: 200, y: 300 },
      onPositionChange: vi.fn(),
    });
    expect(el.style.left).toBe('200px');

    handle.applyPosition(null);

    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('');
  });
});
