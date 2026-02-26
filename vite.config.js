import { defineConfig } from 'vite';

export default defineConfig({
  // Test configuration for Vitest (headless unit tests for core game logic)
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.js'],
  },
});
