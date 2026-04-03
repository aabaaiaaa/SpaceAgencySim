/**
 * _pool.ts — Simple array-based object pools for PIXI.Graphics and PIXI.Text.
 *
 * Avoids per-frame allocation churn by reusing PixiJS display objects.
 * Each pool is a flat array used as a free-list.
 */

import * as PIXI from 'pixi.js';

const _graphicsPool: PIXI.Graphics[] = [];
const _textPool: PIXI.Text[] = [];

/**
 * Acquire a PIXI.Graphics object from the pool.
 * Creates a new one if the pool is empty.
 */
export function acquireGraphics(): PIXI.Graphics {
  if (_graphicsPool.length > 0) {
    const g = _graphicsPool.pop()!;
    g.clear();
    g.visible = true;
    g.alpha = 1;
    g.position.set(0, 0);
    g.scale.set(1, 1);
    g.rotation = 0;
    return g;
  }
  return new PIXI.Graphics();
}

/**
 * Release a PIXI.Graphics object back to the pool.
 * Detaches it from any parent container first.
 */
export function releaseGraphics(g: PIXI.Graphics | null): void {
  if (!g) return;
  g.clear();
  if (g.parent) g.parent.removeChild(g);
  _graphicsPool.push(g);
}

/**
 * Acquire a PIXI.Text object from the pool.
 * Creates a new one if the pool is empty.
 */
export function acquireText(): PIXI.Text {
  if (_textPool.length > 0) {
    const t = _textPool.pop()!;
    t.visible = true;
    t.alpha = 1;
    t.position.set(0, 0);
    t.scale.set(1, 1);
    t.rotation = 0;
    t.anchor.set(0, 0);
    return t;
  }
  return new PIXI.Text({ text: '', style: new PIXI.TextStyle({}) });
}

/**
 * Release a PIXI.Text object back to the pool.
 * Detaches it from any parent container first.
 */
export function releaseText(t: PIXI.Text | null): void {
  if (!t) return;
  if (t.parent) t.parent.removeChild(t);
  _textPool.push(t);
}

/**
 * Release all children of a PIXI.Container back into the appropriate pool,
 * then remove them from the container.
 */
export function releaseContainerChildren(container: PIXI.Container | null): void {
  if (!container) return;
  while (container.children.length) {
    const child = container.children[0];
    container.removeChildAt(0);
    if (child instanceof PIXI.Text) {
      _textPool.push(child);
    } else if (child instanceof PIXI.Graphics) {
      child.clear();
      _graphicsPool.push(child);
    } else if (child instanceof PIXI.Container) {
      // Recursively release nested container children (e.g. debris fragments)
      releaseContainerChildren(child);
    }
  }
}

/**
 * Drain both pools completely. Call on flight renderer destroy
 * so the objects can be garbage-collected.
 */
export function drainPools(): void {
  _graphicsPool.length = 0;
  _textPool.length = 0;
}
