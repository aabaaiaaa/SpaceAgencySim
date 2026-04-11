/**
 * pool.test.ts — Unit tests for the RendererPool class (src/render/pool.ts).
 *
 * Tests cover:
 *   - acquireGraphics: reuse from pool, create new when empty, reset properties
 *   - releaseGraphics: null safety, parent detachment, pool return
 *   - acquireText: reuse from pool, create new when empty, reset properties
 *   - releaseText: null safety, parent detachment, pool return
 *   - releaseContainerChildren: mixed child types, recursive containers
 *   - drain: empties both pools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as PIXI from 'pixi.js';

// ---------------------------------------------------------------------------
// Mock pixi.js — minimal classes for pool testing
// vi.hoisted() ensures these are available when vi.mock factory runs (hoisted)
// ---------------------------------------------------------------------------

interface MockPointLike {
  set: ReturnType<typeof vi.fn>;
}

type MockChild = InstanceType<typeof MockGraphics> | InstanceType<typeof MockText> | InstanceType<typeof MockContainer>;

const { MockGraphics, MockTextStyle, MockText, MockContainer } = vi.hoisted(() => {
  class MockGraphics {
    visible: boolean = true;
    alpha: number = 1;
    position: MockPointLike = { set: vi.fn() };
    scale: MockPointLike = { set: vi.fn() };
    rotation: number = 0;
    label: string = '';
    parent: MockContainer | null = null;
    clear = vi.fn();
  }

  class MockTextStyle {}

  class MockText {
    visible: boolean = true;
    alpha: number = 1;
    position: MockPointLike = { set: vi.fn() };
    scale: MockPointLike = { set: vi.fn() };
    rotation: number = 0;
    label: string = '';
    anchor: MockPointLike = { set: vi.fn() };
    parent: MockContainer | null = null;

    constructor(_opts?: Record<string, unknown>) {
      // Mimic PIXI.Text constructor
    }
  }

  class MockContainer {
    children: Array<MockGraphics | MockText | MockContainer> = [];
    removeChildAt(index: number): MockGraphics | MockText | MockContainer {
      return this.children.splice(index, 1)[0];
    }
    removeChild(child: MockGraphics | MockText | MockContainer): MockGraphics | MockText | MockContainer {
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

import { RendererPool } from '../render/pool.ts';

// ---------------------------------------------------------------------------
// Cast helpers — centralise the mock↔PIXI type bridging so individual tests
// stay cast-free.
// ---------------------------------------------------------------------------

/** Bridge MockContainer → PIXI.Container for releaseContainerChildren(). */
function asPIXIContainer(c: InstanceType<typeof MockContainer>): PIXI.Container {
  return c as unknown as PIXI.Container;
}

/** Attach a Graphics object to a parent mock container (sets up .parent + .children). */
function attachToParent(
  child: PIXI.Graphics | PIXI.Text,
  parent: InstanceType<typeof MockContainer>,
): void {
  (parent.children as unknown[]).push(child);
  (child as unknown as { parent: InstanceType<typeof MockContainer> }).parent = parent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RendererPool', () => {
  let pool: RendererPool;

  beforeEach(() => {
    pool = new RendererPool();
  });

  // --- acquireGraphics ---

  describe('acquireGraphics()', () => {
    it('creates a new Graphics when pool is empty', () => {
      const g = pool.acquireGraphics();
      expect(g).toBeDefined();
      expect(g).toBeInstanceOf(MockGraphics);
    });

    it('reuses a released Graphics object', () => {
      const g1 = pool.acquireGraphics();
      pool.releaseGraphics(g1);

      const g2 = pool.acquireGraphics();
      expect(g2).toBe(g1);
    });

    it('resets properties on reuse (visible, alpha, position, scale, rotation, label)', () => {
      const g = pool.acquireGraphics();
      g.visible = false;
      g.alpha = 0.5;
      g.rotation = 3.14;
      g.label = 'old';
      pool.releaseGraphics(g);

      const reused = pool.acquireGraphics();
      expect(reused.visible).toBe(true);
      expect(reused.alpha).toBe(1);
      expect(reused.rotation).toBe(0);
      expect(reused.label).toBe('');
      expect(reused.clear).toHaveBeenCalled();
      expect(reused.position.set).toHaveBeenCalledWith(0, 0);
      expect(reused.scale.set).toHaveBeenCalledWith(1, 1);
    });
  });

  // --- releaseGraphics ---

  describe('releaseGraphics()', () => {
    it('does not crash when passed null', () => {
      expect(() => pool.releaseGraphics(null)).not.toThrow();
    });

    it('detaches from parent container', () => {
      const g = pool.acquireGraphics();
      const parent = new MockContainer();
      attachToParent(g, parent);
      const mockRemoveChild = vi.fn((child: MockChild): MockChild => {
        const idx = parent.children.indexOf(child);
        if (idx >= 0) parent.children.splice(idx, 1);
        return child;
      });
      parent.removeChild = mockRemoveChild;

      pool.releaseGraphics(g);

      expect(mockRemoveChild).toHaveBeenCalledWith(g);
    });

    it('calls clear() on the released Graphics', () => {
      const g = pool.acquireGraphics();
      vi.mocked(g.clear).mockClear();
      pool.releaseGraphics(g);
      expect(g.clear).toHaveBeenCalledOnce();
    });
  });

  // --- acquireText ---

  describe('acquireText()', () => {
    it('creates a new Text when pool is empty', () => {
      const t = pool.acquireText();
      expect(t).toBeDefined();
      expect(t).toBeInstanceOf(MockText);
    });

    it('reuses a released Text object', () => {
      const t1 = pool.acquireText();
      pool.releaseText(t1);

      const t2 = pool.acquireText();
      expect(t2).toBe(t1);
    });

    it('resets properties on reuse', () => {
      const t = pool.acquireText();
      t.visible = false;
      t.alpha = 0.3;
      t.rotation = 1.0;
      t.label = 'old';
      pool.releaseText(t);

      const reused = pool.acquireText();
      expect(reused.visible).toBe(true);
      expect(reused.alpha).toBe(1);
      expect(reused.rotation).toBe(0);
      expect(reused.label).toBe('');
      expect(reused.position.set).toHaveBeenCalledWith(0, 0);
      expect(reused.scale.set).toHaveBeenCalledWith(1, 1);
      expect(reused.anchor.set).toHaveBeenCalledWith(0, 0);
    });
  });

  // --- releaseText ---

  describe('releaseText()', () => {
    it('does not crash when passed null', () => {
      expect(() => pool.releaseText(null)).not.toThrow();
    });

    it('detaches from parent container', () => {
      const t = pool.acquireText();
      const parent = new MockContainer();
      attachToParent(t, parent);
      const mockRemoveChild = vi.fn();
      parent.removeChild = mockRemoveChild;

      pool.releaseText(t);

      expect(mockRemoveChild).toHaveBeenCalledWith(t);
    });
  });

  // --- releaseContainerChildren ---

  describe('releaseContainerChildren()', () => {
    it('does not crash when passed null', () => {
      expect(() => pool.releaseContainerChildren(null)).not.toThrow();
    });

    it('releases Graphics children back to pool', () => {
      const container = new MockContainer();
      const g = new MockGraphics();
      container.children.push(g);

      pool.releaseContainerChildren(asPIXIContainer(container));

      expect(container.children).toHaveLength(0);
      // The Graphics should be in the pool now — acquiring should return it.
      const reused = pool.acquireGraphics();
      expect(reused).toBe(g);
    });

    it('releases Text children back to pool', () => {
      const container = new MockContainer();
      const t = new MockText({});
      container.children.push(t);

      pool.releaseContainerChildren(asPIXIContainer(container));

      expect(container.children).toHaveLength(0);
      const reused = pool.acquireText();
      expect(reused).toBe(t);
    });

    it('handles mixed children types', () => {
      const container = new MockContainer();
      const g = new MockGraphics();
      const t = new MockText({});
      container.children.push(g, t);

      pool.releaseContainerChildren(asPIXIContainer(container));

      expect(container.children).toHaveLength(0);
      expect(pool.acquireGraphics()).toBe(g);
      expect(pool.acquireText()).toBe(t);
    });

    it('recursively releases nested Container children', () => {
      const outer = new MockContainer();
      const inner = new MockContainer();
      const g = new MockGraphics();
      inner.children.push(g);
      outer.children.push(inner);

      pool.releaseContainerChildren(asPIXIContainer(outer));

      expect(outer.children).toHaveLength(0);
      expect(inner.children).toHaveLength(0);
      expect(pool.acquireGraphics()).toBe(g);
    });
  });

  // --- drain ---

  describe('drain()', () => {
    it('empties both pools so new objects are created', () => {
      const g1 = pool.acquireGraphics();
      const t1 = pool.acquireText();
      pool.releaseGraphics(g1);
      pool.releaseText(t1);

      pool.drain();

      // New acquires should create fresh objects, not return the drained ones.
      const g2 = pool.acquireGraphics();
      const t2 = pool.acquireText();
      expect(g2).not.toBe(g1);
      expect(t2).not.toBe(t1);
    });

    it('can be called on an empty pool without error', () => {
      expect(() => pool.drain()).not.toThrow();
    });
  });
});
