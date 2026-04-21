/**
 * draggableOverlay.ts — Make a fixed-position HUD overlay draggable.
 *
 * Used by debug overlays (FPS monitor, perf dashboard) that default to the
 * top-right corner and overlap with the mission objectives panel during
 * flight. Players can drag them to any corner; the final position is
 * persisted via an `onPositionChange` callback (typically writing to
 * settingsStore).
 *
 * The drag lifecycle follows the VAB pattern: pointerdown captures the
 * pointer, pointermove applies an 8px hysteresis before committing to the
 * drag, and pointerup releases the capture and fires the persistence hook.
 *
 * On window resize, the position is re-clamped into the viewport so
 * elements never become unreachable.
 *
 * @module ui/draggableOverlay
 */
import { createListenerTracker, type ListenerTracker } from './listenerTracker.ts';

/** Minimum pointer movement (px) before committing to a drag. */
const DRAG_HYSTERESIS_PX = 8;

/** Margin to keep overlays away from the very edges on resize clamping. */
const CLAMP_MARGIN_PX = 4;

export interface OverlayPosition {
  x: number;
  y: number;
}

export interface DraggableOverlayOptions {
  /**
   * Initial position to apply. When `null`, the element keeps its CSS
   * default position (no inline `left`/`top`/`right`/`bottom` styles).
   */
  initialPosition: OverlayPosition | null;

  /**
   * Invoked once a drag completes with the final clamped position. Callers
   * typically persist this to settingsStore.
   */
  onPositionChange: (pos: OverlayPosition) => void;
}

export interface DraggableOverlayHandle {
  /**
   * Apply a new position (or clear inline styles with `null`). Does NOT
   * fire `onPositionChange` — this is for externally-driven updates.
   */
  applyPosition(pos: OverlayPosition | null): void;

  /** Remove all tracked listeners and reset inline styles. */
  destroy(): void;
}

/**
 * Clamp a position to fit within the current viewport, accounting for the
 * element's measured size.
 */
export function clampToViewport(
  pos: OverlayPosition,
  elWidth: number,
  elHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): OverlayPosition {
  const maxX = Math.max(CLAMP_MARGIN_PX, viewportWidth - elWidth - CLAMP_MARGIN_PX);
  const maxY = Math.max(CLAMP_MARGIN_PX, viewportHeight - elHeight - CLAMP_MARGIN_PX);
  const x = Math.max(CLAMP_MARGIN_PX, Math.min(maxX, pos.x));
  const y = Math.max(CLAMP_MARGIN_PX, Math.min(maxY, pos.y));
  return { x, y };
}

/**
 * Apply an absolute position to an element. Clears `right`/`bottom` so the
 * inline `left`/`top` win over the CSS defaults (which typically anchor
 * the element to a corner using `right`/`top`).
 */
function applyInlinePosition(el: HTMLElement, pos: OverlayPosition): void {
  el.style.left = `${pos.x}px`;
  el.style.top = `${pos.y}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
}

/** Clear all inline positioning styles, returning to CSS defaults. */
function clearInlinePosition(el: HTMLElement): void {
  el.style.left = '';
  el.style.top = '';
  el.style.right = '';
  el.style.bottom = '';
}

/**
 * Make `el` draggable. Safe to call multiple times — the previous handle
 * should be `destroy()`'d first to avoid duplicate listeners.
 */
export function makeDraggableOverlay(
  el: HTMLElement,
  opts: DraggableOverlayOptions,
): DraggableOverlayHandle {
  const tracker: ListenerTracker = createListenerTracker();

  // -- Drag state --
  let dragging = false;     // committed drag (past hysteresis)
  let pointerId: number | null = null;
  let startClientX = 0;
  let startClientY = 0;
  let elStartX = 0;         // element's left-px at pointerdown
  let elStartY = 0;

  // -- Apply initial position --
  if (opts.initialPosition) {
    applyInlinePosition(el, opts.initialPosition);
  }

  // -- Pointer handlers --

  const onPointerDown = (e: PointerEvent): void => {
    // Only the primary button initiates a drag.
    if (e.button !== 0) return;

    pointerId = e.pointerId;
    dragging = false;
    startClientX = e.clientX;
    startClientY = e.clientY;

    // Compute the element's current on-screen position (works whether it's
    // positioned via inline or CSS `right`/`top`).
    const rect = el.getBoundingClientRect();
    elStartX = rect.left;
    elStartY = rect.top;

    try {
      el.setPointerCapture(pointerId);
    } catch {
      // setPointerCapture can throw on non-attached elements; we can still
      // track the move/up events via the global listeners below.
    }

    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (pointerId === null || e.pointerId !== pointerId) return;

    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;

    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_HYSTERESIS_PX) return;
      dragging = true;
      el.classList.add('dragging');
    }

    const rawPos: OverlayPosition = { x: elStartX + dx, y: elStartY + dy };
    const clamped = clampToViewport(
      rawPos,
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    applyInlinePosition(el, clamped);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (pointerId === null || e.pointerId !== pointerId) return;

    try {
      el.releasePointerCapture(pointerId);
    } catch {
      // Ignore — capture may have been auto-released.
    }

    const wasDragging = dragging;
    pointerId = null;
    dragging = false;
    el.classList.remove('dragging');

    if (!wasDragging) return;

    // Fire persistence hook with the final clamped position.
    const rect = el.getBoundingClientRect();
    opts.onPositionChange({ x: rect.left, y: rect.top });
  };

  const onPointerCancel = (): void => {
    if (pointerId === null) return;
    pointerId = null;
    dragging = false;
    el.classList.remove('dragging');
  };

  const onResize = (): void => {
    // Only re-clamp if an inline position is set — otherwise the CSS
    // default is still in effect and the element will reflow naturally.
    if (!el.style.left && !el.style.top) return;
    const rect = el.getBoundingClientRect();
    const clamped = clampToViewport(
      { x: rect.left, y: rect.top },
      el.offsetWidth,
      el.offsetHeight,
      window.innerWidth,
      window.innerHeight,
    );
    applyInlinePosition(el, clamped);
  };

  tracker.add(el, 'pointerdown', onPointerDown as EventListener);
  tracker.add(el, 'pointermove', onPointerMove as EventListener);
  tracker.add(el, 'pointerup', onPointerUp as EventListener);
  tracker.add(el, 'pointercancel', onPointerCancel as EventListener);
  tracker.add(window, 'resize', onResize);

  return {
    applyPosition(pos: OverlayPosition | null): void {
      if (pos === null) {
        clearInlinePosition(el);
        return;
      }
      const clamped = clampToViewport(
        pos,
        el.offsetWidth,
        el.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      );
      applyInlinePosition(el, clamped);
    },
    destroy(): void {
      tracker.removeAll();
      el.classList.remove('dragging');
      clearInlinePosition(el);
    },
  };
}
