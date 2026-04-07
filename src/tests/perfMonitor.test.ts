/**
 * perfMonitor.test.ts — Unit tests for the core performance monitor module.
 *
 * Tests FPS calculation, frame time histogram bucketing, circular buffer
 * overflow, worker latency tracking, memory API graceful handling, and
 * getMetrics() snapshot accuracy.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  beginFrame,
  endFrame,
  getMetrics,
  reset,
  recordWorkerSend,
  recordWorkerReceive,
} from '../core/perfMonitor.ts';

describe('perfMonitor', () => {
  beforeEach(() => {
    reset();
    vi.restoreAllMocks();
  });

  describe('getMetrics() — empty state', () => {
    it('returns zeroed metrics when no frames recorded', () => {
      const m = getMetrics();
      expect(m.fpsCurrent).toBe(0);
      expect(m.fpsAverage).toBe(0);
      expect(m.fpsMin).toBe(0);
      expect(m.frameTime).toBe(0);
      expect(m.frameTimeAverage).toBe(0);
      expect(m.frameCount).toBe(0);
      expect(m.workerLatency).toBe(0);
      expect(m.histogram.bucket0to8).toBe(0);
      expect(m.histogram.bucket8to16).toBe(0);
      expect(m.histogram.bucket16to33).toBe(0);
      expect(m.histogram.bucket33plus).toBe(0);
    });
  });

  describe('beginFrame() / endFrame() — frame recording', () => {
    it('records a single frame time', () => {
      // Mock performance.now() to return controlled values.
      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      beginFrame();
      now = 1016.67; // 16.67ms frame
      endFrame();

      const m = getMetrics();
      expect(m.frameCount).toBe(1);
      expect(m.frameTime).toBeCloseTo(16.67, 1);
      expect(m.fpsCurrent).toBeCloseTo(60, 0);
    });

    it('computes rolling average from multiple frames', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      // Three frames: 10ms, 20ms, 30ms → avg = 20ms
      now = 0; beginFrame(); now = 10; endFrame();
      now = 100; beginFrame(); now = 120; endFrame();
      now = 200; beginFrame(); now = 230; endFrame();

      const m = getMetrics();
      expect(m.frameCount).toBe(3);
      expect(m.frameTimeAverage).toBeCloseTo(20, 1);
      expect(m.fpsAverage).toBeCloseTo(50, 0);
    });

    it('computes minimum FPS from worst frame', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      // Frames: 10ms, 50ms, 16ms
      now = 0; beginFrame(); now = 10; endFrame();
      now = 100; beginFrame(); now = 150; endFrame();
      now = 200; beginFrame(); now = 216; endFrame();

      const m = getMetrics();
      // Worst = 50ms → min FPS = 1000/50 = 20
      expect(m.fpsMin).toBeCloseTo(20, 0);
    });

    it('reports current frame as the most recent', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      now = 0; beginFrame(); now = 10; endFrame();
      now = 100; beginFrame(); now = 133; endFrame(); // 33ms frame

      const m = getMetrics();
      expect(m.frameTime).toBeCloseTo(33, 1);
      expect(m.fpsCurrent).toBeCloseTo(1000 / 33, 0);
    });
  });

  describe('circular buffer', () => {
    it('fills up to 60 entries', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      for (let i = 0; i < 60; i++) {
        now = i * 100; beginFrame();
        now = i * 100 + 16; endFrame();
      }

      const m = getMetrics();
      expect(m.frameCount).toBe(60);
      expect(m.frameTimeAverage).toBeCloseTo(16, 1);
    });

    it('wraps correctly after more than 60 frames', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      // Fill 60 frames at 10ms
      for (let i = 0; i < 60; i++) {
        now = i * 100; beginFrame();
        now = i * 100 + 10; endFrame();
      }
      expect(getMetrics().frameTimeAverage).toBeCloseTo(10, 1);

      // Add 30 more at 20ms (overwrites 30 of the 10ms entries)
      for (let i = 0; i < 30; i++) {
        now = 10000 + i * 100; beginFrame();
        now = 10000 + i * 100 + 20; endFrame();
      }

      const m = getMetrics();
      expect(m.frameCount).toBe(60); // Stays at 60
      // 30 × 10ms + 30 × 20ms = 900 / 60 = 15ms average
      expect(m.frameTimeAverage).toBeCloseTo(15, 1);
    });

    it('does not grow beyond buffer size', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      for (let i = 0; i < 200; i++) {
        now = i * 100; beginFrame();
        now = i * 100 + 8; endFrame();
      }

      const m = getMetrics();
      expect(m.frameCount).toBe(60);
    });
  });

  describe('frame time histogram', () => {
    it('buckets frame times correctly', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      // 2 frames in 0-8ms bucket
      now = 0; beginFrame(); now = 5; endFrame();
      now = 100; beginFrame(); now = 107; endFrame();

      // 2 frames in 8-16ms bucket
      now = 200; beginFrame(); now = 210; endFrame();
      now = 300; beginFrame(); now = 315; endFrame();

      // 1 frame in 16-33ms bucket
      now = 400; beginFrame(); now = 425; endFrame();

      // 1 frame in 33ms+ bucket
      now = 500; beginFrame(); now = 550; endFrame();

      const m = getMetrics();
      expect(m.histogram.bucket0to8).toBe(2);
      expect(m.histogram.bucket8to16).toBe(2);
      expect(m.histogram.bucket16to33).toBe(1);
      expect(m.histogram.bucket33plus).toBe(1);
    });

    it('places boundary values in correct buckets', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      // Exactly 8ms → falls in 8-16ms bucket (< 8 is first bucket)
      now = 0; beginFrame(); now = 8; endFrame();
      // Exactly 16ms → falls in 16-33ms bucket
      now = 100; beginFrame(); now = 116; endFrame();
      // Exactly 33ms → falls in 33ms+ bucket
      now = 200; beginFrame(); now = 233; endFrame();

      const m = getMetrics();
      expect(m.histogram.bucket0to8).toBe(0);
      expect(m.histogram.bucket8to16).toBe(1);
      expect(m.histogram.bucket16to33).toBe(1);
      expect(m.histogram.bucket33plus).toBe(1);
    });
  });

  describe('worker latency tracking', () => {
    it('records round-trip latency', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      now = 1000;
      recordWorkerSend();
      now = 1005; // 5ms round trip
      recordWorkerReceive();

      const m = getMetrics();
      expect(m.workerLatency).toBeCloseTo(5, 1);
    });

    it('returns 0 when no worker data recorded', () => {
      const m = getMetrics();
      expect(m.workerLatency).toBe(0);
    });

    it('ignores receive without prior send', () => {
      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      recordWorkerReceive(); // No prior send
      const m = getMetrics();
      expect(m.workerLatency).toBe(0);
    });

    it('uses latest send/receive pair', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      now = 1000; recordWorkerSend();
      now = 1003; recordWorkerReceive(); // 3ms

      now = 2000; recordWorkerSend();
      now = 2008; recordWorkerReceive(); // 8ms

      const m = getMetrics();
      expect(m.workerLatency).toBeCloseTo(8, 1);
    });
  });

  describe('memory tracking', () => {
    it('reads performance.memory when available', () => {
      const perfAny = performance as unknown as { memory?: unknown };
      perfAny.memory = {
        usedJSHeapSize: 50_000_000,
        jsHeapSizeLimit: 200_000_000,
        totalJSHeapSize: 100_000_000,
      };

      const m = getMetrics();
      expect(m.memoryUsedBytes).toBe(50_000_000);
      expect(m.memoryLimitBytes).toBe(200_000_000);

      // Clean up
      delete perfAny.memory;
    });

    it('returns 0 when performance.memory is unavailable', () => {
      const m = getMetrics();
      expect(m.memoryUsedBytes).toBe(0);
      expect(m.memoryLimitBytes).toBe(0);
    });
  });

  describe('reset()', () => {
    it('clears all buffers and state', () => {
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      // Record some data
      now = 0; beginFrame(); now = 16; endFrame();
      now = 100; recordWorkerSend(); now = 105; recordWorkerReceive();

      // Verify data exists
      expect(getMetrics().frameCount).toBe(1);
      expect(getMetrics().workerLatency).toBeCloseTo(5, 1);

      // Reset
      reset();

      // Verify everything is cleared
      const m = getMetrics();
      expect(m.frameCount).toBe(0);
      expect(m.fpsCurrent).toBe(0);
      expect(m.fpsAverage).toBe(0);
      expect(m.workerLatency).toBe(0);
      expect(m.histogram.bucket0to8).toBe(0);
    });
  });

  describe('zero frame time handling', () => {
    it('handles 0ms frame time gracefully', () => {
      let now = 1000;
      vi.spyOn(performance, 'now').mockImplementation(() => now);

      beginFrame();
      // now stays the same — 0ms frame
      endFrame();

      const m = getMetrics();
      expect(m.frameTime).toBe(0);
      expect(m.fpsCurrent).toBe(0); // 1000/0 → 0 (not Infinity)
    });
  });
});
