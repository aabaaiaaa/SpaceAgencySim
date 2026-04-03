// Structured logger — lightweight wrapper around console with levels, categories,
// and timestamps.  See requirements Section 4.3.

/* eslint-disable no-console */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

// Vite inlines import.meta.env.PROD at build time.  The type for
// ImportMeta doesn't include Vite's env, so access it via a cast.
const _meta = import.meta as unknown as { env?: { PROD?: boolean } };
let minLevel: LogLevel = _meta.env?.PROD ? 'warn' : 'debug';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function formatEntry(level: LogLevel, category: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level.toUpperCase()}] [${category}] ${message}`;
  if (data !== undefined) return `${base} ${JSON.stringify(data)}`;
  return base;
}

export const logger = {
  debug(category: string, message: string, data?: unknown): void {
    if (!shouldLog('debug')) return;
    console.log(formatEntry('debug', category, message, data));
  },

  info(category: string, message: string, data?: unknown): void {
    if (!shouldLog('info')) return;
    console.log(formatEntry('info', category, message, data));
  },

  warn(category: string, message: string, data?: unknown): void {
    if (!shouldLog('warn')) return;
    console.warn(formatEntry('warn', category, message, data));
  },

  error(category: string, message: string, data?: unknown): void {
    if (!shouldLog('error')) return;
    console.error(formatEntry('error', category, message, data));
  },

  setLevel(level: LogLevel): void {
    minLevel = level;
  },

  getLevel(): LogLevel {
    return minLevel;
  },
};
