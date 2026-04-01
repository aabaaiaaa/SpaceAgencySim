/**
 * _input.js — Mouse move handler and wheel zoom handler.
 *
 * @module render/flight/_input
 */

import { getFlightRenderState } from './_state.js';
import { MIN_ZOOM, MAX_ZOOM } from './_constants.js';

/**
 * Track the current mouse position so the wheel handler can compute the
 * world coordinate under the cursor.
 *
 * @param {MouseEvent} e
 */
export function onMouseMove(e) {
  const s = getFlightRenderState();
  s.mouseX = e.clientX;
  s.mouseY = e.clientY;
}

/**
 * Handle mouse-wheel scroll to zoom the camera in / out.
 *
 * @param {WheelEvent} e
 */
export function onWheel(e) {
  const s = getFlightRenderState();
  if (!s.inputEnabled) return;
  e.preventDefault();

  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  s.zoomLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoomLevel * factor));
}
