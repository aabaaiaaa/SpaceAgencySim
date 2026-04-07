import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.mts', '.json'],
  },
  // Test configuration for Vitest (headless unit tests for core game logic)
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{js,ts}'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      exclude: ['src/core/debugSaves.ts', 'src/core/library.ts'],
      thresholds: {
        lines: 89,
        branches: 80,
        functions: 91,
      },
    },
  },
});
