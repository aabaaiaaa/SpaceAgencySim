// Vitest global setup — pins logger level to 'warn' before each test to
// suppress noisy debug/info output. Tests that need debug output can call
// `logger.setLevel('debug')` locally in their own `beforeEach`.
//
// Wired up via `setupFiles: ['./src/tests/setup.ts']` in `vitest.config.ts`.

import { beforeEach } from 'vitest';
import { logger } from '../core/logger.js';

beforeEach(() => {
  logger.setLevel('warn');
});
