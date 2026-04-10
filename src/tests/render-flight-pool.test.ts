/**
 * render-flight-pool.test.ts — Unit tests for the flight renderer pool wrapper.
 *
 * Tests acquireGraphics, releaseGraphics, acquireText, releaseText,
 * releaseContainerChildren, drainPools from src/render/flight/_pool.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Container, Graphics, Text } from 'pixi.js';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

const { MockGraphics, MockText, MockTextStyle, MockContainer } = vi.hoisted(() => {
  class MockGraphics {
    visible = true; alpha = 1; position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; parent = null; clear = vi.fn();
  }
  class MockTextStyle {}
  class MockText {
    visible = true; alpha = 1; position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; anchor = { set: vi.fn() }; parent = null;
    constructor() {}
  }
  class MockContainer {
    children: unknown[] = [];
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
  acquireGraphics,
  releaseGraphics,
  acquireText,
  releaseText,
  releaseContainerChildren,
  drainPools,
} from '../render/flight/_pool.ts';

describe('flight _pool.ts wrapper', () => {
  beforeEach(() => {
    drainPools(); // start fresh
  });

  describe('acquireGraphics / releaseGraphics', () => {
    it('acquires a new Graphics object', () => {
      const g = acquireGraphics();
      expect(g).toBeDefined();
      expect(g).toBeInstanceOf(MockGraphics);
    });

    it('reuses a released Graphics object', () => {
      const g1 = acquireGraphics();
      releaseGraphics(g1);
      const g2 = acquireGraphics();
      expect(g2).toBe(g1);
    });

    it('handles null release safely', () => {
      expect(() => releaseGraphics(null)).not.toThrow();
    });
  });

  describe('acquireText / releaseText', () => {
    it('acquires a new Text object', () => {
      const t = acquireText();
      expect(t).toBeDefined();
      expect(t).toBeInstanceOf(MockText);
    });

    it('reuses a released Text object', () => {
      const t1 = acquireText();
      releaseText(t1);
      const t2 = acquireText();
      expect(t2).toBe(t1);
    });

    it('handles null release safely', () => {
      expect(() => releaseText(null)).not.toThrow();
    });
  });

  describe('releaseContainerChildren', () => {
    it('handles null safely', () => {
      expect(() => releaseContainerChildren(null)).not.toThrow();
    });

    it('releases Graphics children back to pool', () => {
      const container = new MockContainer();
      const g = new MockGraphics();
      container.children.push(g);

      releaseContainerChildren(container as unknown as Container);
      expect(container.children.length).toBe(0);

      const reused = acquireGraphics();
      expect(reused).toBe(g);
    });
  });

  describe('drainPools', () => {
    it('empties the pool', () => {
      const g = acquireGraphics();
      releaseGraphics(g);
      drainPools();

      const fresh = acquireGraphics();
      expect(fresh).not.toBe(g);
    });
  });
});
