import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.mts', '.json'],
  },
  server: {
    watch: {
      ignored: ['**/src/tests/**', '**/e2e/**', '**/test-map.json', '**/scripts/**', '**/playwright-report/**', '**/test-results/**'],
    },
  },
  // Test configuration for Vitest (headless unit tests for core game logic)
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{js,ts}'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/render/**', 'src/ui/**'],
      exclude: ['src/core/debugSaves.ts', 'src/core/library.ts'],
      // --- Coverage layer notes ---
      // src/core: mature coverage, thresholds enforced below.
      // src/render: ~5,300 LOC. Mostly PixiJS-heavy (low testability).
      //   Top testable render modules (pure logic, minimal canvas):
      //     1. render/flight/_camera.ts — pure math: worldToScreen(), computeCoM(), ppm(), hasCommandModule()
      //     2. render/pool.ts — object pool logic (already tested in pool.test.ts)
      //     3. render/flight/_constants.ts — pure constant definitions, verifiable values
      //     4. render/flight/_state.ts — state getter/setter functions, no business logic
      //     5. render/flight/_sky.ts — lerpColor() is pure; rest is PixiJS
      //     6. render/types.ts — type-only, no runtime logic
      //     7. render/flight/_ground.ts — terrain data generation has extractable logic
      //     8. render/flight/_pool.ts — thin wrapper around RendererPool
      //     9. render/map.ts — orbit math helpers extractable, but bulk is PixiJS (~1,139 LOC)
      //    10. render/hub.ts — mostly PixiJS drawing, limited testable logic
      //
      // src/ui: ~21,400 LOC. DOM-heavy, but several modules have extractable pure logic.
      //   Top testable UI modules (pure logic or minimal DOM):
      //     1. ui/escapeHtml.ts — pure string utility, zero dependencies
      //     2. ui/listenerTracker.ts — closure-based tracker, testable with mock EventTarget
      //     3. ui/vab/_staging.ts — computeVabStageDeltaV() is 62 LOC of pure physics math
      //     4. ui/vab/_undoActions.ts — cloneStaging(), restoreStaging() are pure snapshot logic
      //     5. ui/fpsMonitor.ts — recordFrame() ring buffer stats are pure computation
      //     6. ui/flightController/_timeWarp.ts — time-warp threshold logic is deterministic
      //     7. ui/flightController/_state.ts — state container, getter/setter (already tested)
      //     8. ui/rocketCardUtil.ts — preview scaling math extractable
      //     9. ui/vab/_inventory.ts — wear/cost calculation logic
      //    10. ui/flightController/_flightPhase.ts — phase transition logic extractable from DOM
      //
      thresholds: {
        'src/core/**': {
          lines: 89,
          branches: 80,
          functions: 91,
        },
        'src/render/**': {
          lines: 55,
          branches: 45,
        },
        'src/ui/**': {
          lines: 50,
          branches: 45,
        },
      },
    },
  },
});
