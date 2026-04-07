// @ts-nocheck
/**
 * ui-listenerTracker.test.ts — Unit tests for the event listener tracker utility.
 */

import { describe, it, expect, vi } from 'vitest';
import { createListenerTracker } from '../ui/listenerTracker.ts';

describe('createListenerTracker', () => {
  /** Minimal EventTarget mock. */
  function createMockTarget() {
    const listeners: Array<{ event: string; handler: unknown; options?: unknown }> = [];
    return {
      listeners,
      addEventListener: vi.fn((event, handler, options) => {
        listeners.push({ event, handler, options });
      }),
      removeEventListener: vi.fn((event, handler, _options) => {
        const idx = listeners.findIndex(
          l => l.event === event && l.handler === handler,
        );
        if (idx >= 0) listeners.splice(idx, 1);
      }),
    };
  }

  it('returns an object with add and removeAll methods', () => {
    const tracker = createListenerTracker();
    expect(typeof tracker.add).toBe('function');
    expect(typeof tracker.removeAll).toBe('function');
  });

  describe('add()', () => {
    it('calls addEventListener on the target', () => {
      const tracker = createListenerTracker();
      const target = createMockTarget();
      const handler = vi.fn();

      tracker.add(target, 'click', handler);

      expect(target.addEventListener).toHaveBeenCalledTimes(1);
      expect(target.addEventListener).toHaveBeenCalledWith('click', handler, undefined);
    });

    it('forwards options to addEventListener', () => {
      const tracker = createListenerTracker();
      const target = createMockTarget();
      const handler = vi.fn();

      tracker.add(target, 'scroll', handler, { passive: true });

      expect(target.addEventListener).toHaveBeenCalledWith('scroll', handler, { passive: true });
    });

    it('forwards boolean capture option', () => {
      const tracker = createListenerTracker();
      const target = createMockTarget();
      const handler = vi.fn();

      tracker.add(target, 'click', handler, true);

      expect(target.addEventListener).toHaveBeenCalledWith('click', handler, true);
    });

    it('tracks multiple listeners on different targets', () => {
      const tracker = createListenerTracker();
      const t1 = createMockTarget();
      const t2 = createMockTarget();
      const h1 = vi.fn();
      const h2 = vi.fn();

      tracker.add(t1, 'click', h1);
      tracker.add(t2, 'keydown', h2);

      expect(t1.addEventListener).toHaveBeenCalledTimes(1);
      expect(t2.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('tracks multiple listeners on the same target', () => {
      const tracker = createListenerTracker();
      const target = createMockTarget();

      tracker.add(target, 'click', vi.fn());
      tracker.add(target, 'mouseover', vi.fn());

      expect(target.addEventListener).toHaveBeenCalledTimes(2);
    });
  });

  describe('removeAll()', () => {
    it('calls removeEventListener for each tracked listener', () => {
      const tracker = createListenerTracker();
      const target = createMockTarget();
      const h1 = vi.fn();
      const h2 = vi.fn();

      tracker.add(target, 'click', h1);
      tracker.add(target, 'keydown', h2);
      tracker.removeAll();

      expect(target.removeEventListener).toHaveBeenCalledTimes(2);
      expect(target.removeEventListener).toHaveBeenCalledWith('click', h1, undefined);
      expect(target.removeEventListener).toHaveBeenCalledWith('keydown', h2, undefined);
    });

    it('passes options to removeEventListener', () => {
      const tracker = createListenerTracker();
      const target = createMockTarget();
      const handler = vi.fn();

      tracker.add(target, 'scroll', handler, { capture: true });
      tracker.removeAll();

      expect(target.removeEventListener).toHaveBeenCalledWith('scroll', handler, { capture: true });
    });

    it('clears the internal list after removeAll', () => {
      const tracker = createListenerTracker();
      const target = createMockTarget();

      tracker.add(target, 'click', vi.fn());
      tracker.removeAll();

      // Second removeAll should be a no-op
      target.removeEventListener.mockClear();
      tracker.removeAll();
      expect(target.removeEventListener).not.toHaveBeenCalled();
    });

    it('handles empty tracker (no listeners added)', () => {
      const tracker = createListenerTracker();
      // Should not throw
      expect(() => tracker.removeAll()).not.toThrow();
    });

    it('removes listeners from multiple targets', () => {
      const tracker = createListenerTracker();
      const t1 = createMockTarget();
      const t2 = createMockTarget();

      tracker.add(t1, 'click', vi.fn());
      tracker.add(t2, 'keydown', vi.fn());
      tracker.removeAll();

      expect(t1.removeEventListener).toHaveBeenCalledTimes(1);
      expect(t2.removeEventListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('independence of tracker instances', () => {
    it('two trackers do not share state', () => {
      const t1 = createListenerTracker();
      const t2 = createListenerTracker();
      const target = createMockTarget();
      const h1 = vi.fn();
      const h2 = vi.fn();

      t1.add(target, 'click', h1);
      t2.add(target, 'keydown', h2);

      // Removing t1's listeners should not affect t2
      t1.removeAll();
      expect(target.removeEventListener).toHaveBeenCalledTimes(1);
      expect(target.removeEventListener).toHaveBeenCalledWith('click', h1, undefined);

      target.removeEventListener.mockClear();
      t2.removeAll();
      expect(target.removeEventListener).toHaveBeenCalledTimes(1);
      expect(target.removeEventListener).toHaveBeenCalledWith('keydown', h2, undefined);
    });
  });
});
