/**
 * _pool.ts — Flight renderer object pool.
 *
 * Delegates to a RendererPool instance. The exported function signatures
 * remain unchanged so all existing flight renderer imports work as-is.
 */

import * as PIXI from 'pixi.js';
import { RendererPool } from '../pool.ts';

const _pool = new RendererPool();

/**
 * Acquire a PIXI.Graphics object from the pool.
 * Creates a new one if the pool is empty.
 */
export function acquireGraphics(): PIXI.Graphics {
  return _pool.acquireGraphics();
}

/**
 * Release a PIXI.Graphics object back to the pool.
 * Detaches it from any parent container first.
 */
export function releaseGraphics(g: PIXI.Graphics | null): void {
  _pool.releaseGraphics(g);
}

/**
 * Acquire a PIXI.Text object from the pool.
 * Creates a new one if the pool is empty.
 */
export function acquireText(): PIXI.Text {
  return _pool.acquireText();
}

/**
 * Release a PIXI.Text object back to the pool.
 * Detaches it from any parent container first.
 */
export function releaseText(t: PIXI.Text | null): void {
  _pool.releaseText(t);
}

/**
 * Release all children of a PIXI.Container back into the appropriate pool,
 * then remove them from the container.
 */
export function releaseContainerChildren(container: PIXI.Container | null): void {
  _pool.releaseContainerChildren(container);
}

/**
 * Drain both pools completely. Call on flight renderer destroy
 * so the objects can be garbage-collected.
 */
export function drainPools(): void {
  _pool.drain();
}
