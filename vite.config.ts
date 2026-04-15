import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.mts', '.json'],
  },
  server: {
    watch: {
      ignored: ['**/src/tests/**', '**/e2e/**', '**/test-map.json', '**/scripts/**', '**/playwright-report/**', '**/test-results/**'],
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pixi.js')) return 'vendor-pixi';
          if (id.includes('src/core/hubs.ts') || id.includes('src/core/hubCrew.ts') || id.includes('src/core/hubTourists.ts') || id.includes('src/core/hubTypes.ts')) return 'core-hubs';
          if (id.includes('src/core/mining.ts') || id.includes('src/core/refinery.ts')) return 'core-mining';
          if (id.includes('src/core/routes.ts')) return 'core-routes';
          if (id.includes('src/core/physics.ts') || id.includes('src/core/orbit.ts')) return 'core-physics';
          if (id.includes('src/data/parts.ts') || id.includes('src/data/bodies.') || id.includes('src/data/resources.') || id.includes('src/data/missions.') || id.includes('src/data/contracts.') || id.includes('src/data/hubFacilities.ts') || id.includes('src/data/hubNames.ts')) return 'data-catalogs';
        },
      },
    },
  },
  // Test configuration for Vitest (headless unit tests for core game logic)
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{js,ts}'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/render/**', 'src/ui/**'],
      exclude: [
        // Core — non-testable utilities
        'src/core/debugSaves.ts',
        'src/core/library.ts',

        // Render layer — PixiJS/WebGL-dependent (0% unit-testable)
        'src/render/flight.ts',
        'src/render/flight/_init.ts',
        'src/render/flight/_rocket.ts',
        'src/render/flight/_debris.ts',
        'src/render/hub.ts',
        'src/render/vab.ts',
        'src/render/flight/_transferObjects.ts',
        'src/render/index.ts',
        'src/render/types.ts',

        // UI layer — DOM-dependent (0% unit-testable)
        'src/ui/hub.ts',
        'src/ui/crewAdmin.ts',
        'src/ui/mainmenu.ts',
        'src/ui/help.ts',
        'src/ui/launchPad.ts',
        'src/ui/topbar.ts',
        'src/ui/settings.ts',
        'src/ui/perfDashboard.ts',
        'src/ui/satelliteOps.ts',
        'src/ui/trackingStation.ts',
        'src/ui/rdLab.ts',
        'src/ui/library.ts',
        'src/ui/autoSaveToast.ts',
        'src/ui/flightHud.ts',
        'src/ui/flightContextMenu.ts',
        'src/ui/hubSwitcher.ts',
        'src/ui/loadingIndicator.ts',
        'src/ui/rocketCardUtil.ts',
        'src/ui/flightController.ts',
        'src/ui/flightController/_init.ts',
        'src/ui/flightController/_keyboard.ts',
        'src/ui/flightController/_menuActions.ts',
        'src/ui/flightController/_docking.ts',
        'src/ui/flightController/_orbitRcs.ts',
        'src/ui/flightController/_postFlight.ts',
        'src/ui/flightController/_surfaceActions.ts',
        'src/ui/flightController/_flightPhase.ts',
        'src/ui/flightController/_mapView.ts',
        'src/ui/flightController/_hubDocking.ts',
        'src/ui/missionControl.ts',
        'src/ui/missionControl/_init.ts',
        'src/ui/missionControl/_shell.ts',
        'src/ui/missionControl/_missionsTab.ts',
        'src/ui/missionControl/_contractsTab.ts',
        'src/ui/missionControl/_challengesTab.ts',
        'src/ui/missionControl/_achievementsTab.ts',
        'src/ui/vab.ts',
        'src/ui/vab/_init.ts',
        'src/ui/vab/_canvasInteraction.ts',
        'src/ui/vab/_panels.ts',
        'src/ui/vab/_partsPanel.ts',
        'src/ui/vab/_designLibrary.ts',
        'src/ui/vab/_engineerPanel.ts',
        'src/ui/vab/_launchFlow.ts',
        'src/ui/vab/_scalebar.ts',
        'src/ui/vab/_inventory.ts',
        'src/ui/hubManagement.ts',
        'src/ui/hubManagement/**',
        'src/ui/logistics/index.ts',
        'src/ui/logistics/_miningSites.ts',
        'src/ui/logistics/_routeTable.ts',
        'src/ui/logistics/_routeBuilder.ts',
        'src/ui/logistics/_routeMap.ts',
        'src/ui/debugSaves.ts',
        'src/ui/index.ts',
      ],
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
          lines: 91,
          branches: 81,
          functions: 92,
        },
        'src/render/**': {
          lines: 34,
          branches: 89,
          functions: 49,
        },
        'src/ui/**': {
          lines: 43,
          branches: 79,
          functions: 78,
        },
      },
    },
  },
});
