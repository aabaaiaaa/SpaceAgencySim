import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from '../core/logger.ts';

describe('logger', () => {
  afterEach(() => {
    logger.setLevel('debug');
    vi.restoreAllMocks();
  });

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

  describe('log level filtering', () => {
    it('debug level allows all messages', () => {
      logger.setLevel('debug');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.debug('cat', 'debug msg');
      logger.info('cat', 'info msg');
      logger.warn('cat', 'warn msg');
      logger.error('cat', 'error msg');

      expect(logSpy).toHaveBeenCalledTimes(2);   // debug + info → console.log
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('warn level suppresses debug and info', () => {
      logger.setLevel('warn');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.debug('cat', 'suppressed');
      logger.info('cat', 'suppressed');
      logger.warn('cat', 'visible');
      logger.error('cat', 'visible');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledOnce();
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('error level suppresses debug, info, and warn', () => {
      logger.setLevel('error');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.debug('cat', 'suppressed');
      logger.info('cat', 'suppressed');
      logger.warn('cat', 'suppressed');
      logger.error('cat', 'visible');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledOnce();
    });

    it('info level suppresses only debug', () => {
      logger.setLevel('info');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.debug('cat', 'suppressed');
      logger.info('cat', 'visible');
      logger.warn('cat', 'also visible');

      expect(logSpy).toHaveBeenCalledTimes(1); // only info
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('setLevel / getLevel', () => {
    it('getLevel returns the current level', () => {
      logger.setLevel('warn');
      expect(logger.getLevel()).toBe('warn');

      logger.setLevel('debug');
      expect(logger.getLevel()).toBe('debug');
    });

    it('setLevel changes filtering behaviour immediately', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.setLevel('error');
      logger.debug('cat', 'should be suppressed');
      expect(logSpy).not.toHaveBeenCalled();

      logger.setLevel('debug');
      logger.debug('cat', 'should appear');
      expect(logSpy).toHaveBeenCalledOnce();
    });
  });

  describe('output formatting', () => {
    it('includes timestamp, level, category, and message', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.warn('myCategory', 'something happened');

      const output = spy.mock.calls[0][0];
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T/); // ISO timestamp
      expect(output).toContain('[WARN]');
      expect(output).toContain('[myCategory]');
      expect(output).toContain('something happened');
    });

    it('omits data section when no data is passed', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('cat', 'no data');

      const output = spy.mock.calls[0][0];
      expect(output).toContain('no data');
      // Should not contain JSON brackets from data serialization.
      expect(output).not.toMatch(/\{.*\}$/);
    });

    it('appends serialized data when data is passed', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('cat', 'with data', { count: 42 });

      const output = spy.mock.calls[0][0];
      expect(output).toContain('{"count":42}');
    });
  });

  describe('method routing', () => {
    it('debug and info use console.log', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.debug('cat', 'debug');
      logger.info('cat', 'info');

      expect(logSpy).toHaveBeenCalledTimes(2);
    });

    it('warn uses console.warn', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('cat', 'warning');
      expect(warnSpy).toHaveBeenCalledOnce();
    });

    it('error uses console.error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('cat', 'error');
      expect(errorSpy).toHaveBeenCalledOnce();
    });
  });
});
