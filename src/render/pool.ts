/**
 * pool.ts — Reusable PixiJS object pool class.
 *
 * Each renderer (flight, hub, VAB) creates its own RendererPool instance
 * so pools are independently managed and drained on renderer destroy.
 */

import * as PIXI from 'pixi.js';

export class RendererPool {
  private _graphicsPool: PIXI.Graphics[] = [];
  private _textPool: PIXI.Text[] = [];

  /**
   * Acquire a PIXI.Graphics object from the pool.
   * Creates a new one if the pool is empty.
   */
  acquireGraphics(): PIXI.Graphics {
    if (this._graphicsPool.length > 0) {
      const g = this._graphicsPool.pop()!;
      g.clear();
      g.visible = true;
      g.alpha = 1;
      g.position.set(0, 0);
      g.scale.set(1, 1);
      g.rotation = 0;
      g.label = '';
      return g;
    }
    return new PIXI.Graphics();
  }

  /**
   * Release a PIXI.Graphics object back to the pool.
   * Detaches it from any parent container first.
   */
  releaseGraphics(g: PIXI.Graphics | null): void {
    if (!g) return;
    g.clear();
    if (g.parent) g.parent.removeChild(g);
    this._graphicsPool.push(g);
  }

  /**
   * Acquire a PIXI.Text object from the pool.
   * Creates a new one if the pool is empty.
   */
  acquireText(): PIXI.Text {
    if (this._textPool.length > 0) {
      const t = this._textPool.pop()!;
      t.visible = true;
      t.alpha = 1;
      t.position.set(0, 0);
      t.scale.set(1, 1);
      t.rotation = 0;
      t.anchor.set(0, 0);
      t.label = '';
      return t;
    }
    return new PIXI.Text({ text: '', style: new PIXI.TextStyle({}) });
  }

  /**
   * Release a PIXI.Text object back to the pool.
   * Detaches it from any parent container first.
   */
  releaseText(t: PIXI.Text | null): void {
    if (!t) return;
    if (t.parent) t.parent.removeChild(t);
    this._textPool.push(t);
  }

  /**
   * Release all children of a PIXI.Container back into the appropriate pool,
   * then remove them from the container.
   */
  releaseContainerChildren(container: PIXI.Container | null): void {
    if (!container) return;
    while (container.children.length) {
      const child = container.children[0];
      container.removeChildAt(0);
      if (child instanceof PIXI.Text) {
        this._textPool.push(child);
      } else if (child instanceof PIXI.Graphics) {
        child.clear();
        this._graphicsPool.push(child);
      } else if (child instanceof PIXI.Container) {
        this.releaseContainerChildren(child);
      }
    }
  }

  /**
   * Drain both pools completely so the objects can be garbage-collected.
   */
  drain(): void {
    this._graphicsPool.length = 0;
    this._textPool.length = 0;
  }
}
