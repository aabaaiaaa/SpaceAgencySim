import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.mts', '.json'],
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{js,ts}'],
    setupFiles: ['./src/tests/setup.ts'],
    testTimeout: 10_000,
    maxWorkers: 2,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['src/'],
      exclude: ['src/tests/**', 'src/main.ts'],
    },
  },
});
