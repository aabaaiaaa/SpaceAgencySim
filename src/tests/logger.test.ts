import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../core/logger.ts';

describe('logger', () => {
  beforeEach(() => {
    logger.setLevel('debug');
  });

  describe('circular reference protection', () => {
    it('does not throw when data contains a circular reference', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const obj: Record<string, unknown> = { a: 1 };
      obj.self = obj; // circular reference

      expect(() => logger.error('test', 'circular', obj)).not.toThrow();

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('[Unserializable data]');
      spy.mockRestore();
    });

    it('still serializes normal data correctly', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.warn('test', 'normal data', { key: 'value' });

      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toContain('{"key":"value"}');
      spy.mockRestore();
    });
  });
});
