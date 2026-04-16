#!/usr/bin/env node
/**
 * generate-test-map.mjs — Auto-generate test-map.json from import analysis.
 *
 * Scans unit tests (src/tests/*.test.ts) and E2E specs (e2e/*.spec.ts),
 * parses their imports, and groups the results by source area to produce
 * the same JSON structure consumed by scripts/run-affected.mjs.
 *
 * Type-only imports (`import type { ... }`) are excluded from area mapping
 * to avoid mapping every test to foundation modules like constants/gameState.
 *
 * E2E specs are mapped to areas via filename heuristics and a curated lookup
 * table, since they import from E2E helpers rather than source directly.
 *
 * Usage:
 *   node scripts/generate-test-map.mjs              # write test-map.json
 *   node scripts/generate-test-map.mjs --dry-run    # print to stdout only
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a path to forward slashes (POSIX style, matching git output). */
function norm(p) {
  return p.replace(/\\/g, '/');
}

/** Read a file as UTF-8 text, returning empty string if not found. */
function readText(absPath) {
  try {
    return readFileSync(absPath, 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Extract value-import specifiers from a TypeScript/JS file.
 * Excludes `import type { ... }` statements — those are structural
 * dependencies and should not drive area mapping.
 *
 * Returns an array of raw specifier strings (e.g. '../core/physics.ts').
 */
function extractValueImports(filePath) {
  const src = readText(filePath);
  const specifiers = [];

  // Match value imports: import { ... } from 'specifier'
  // but NOT: import type { ... } from 'specifier'
  //
  // We use a two-pass approach:
  // 1. Find all import-from statements
  // 2. Exclude those that are purely `import type`

  // Match all import-from statements with their full prefix
  const re = /\bimport\s+(type\s+)?(\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const isTypeOnly = !!m[1]; // Has `type` keyword after `import`
    const specifier = m[3];
    if (!isTypeOnly) {
      specifiers.push(specifier);
    }
  }

  // Bare side-effect imports: import 'specifier'
  const reBareSideEffect = /\bimport\s+['"]([^'"]+)['"]/g;
  while ((m = reBareSideEffect.exec(src)) !== null) {
    specifiers.push(m[1]);
  }

  // Dynamic imports: import('specifier')
  const reDynamic = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reDynamic.exec(src)) !== null) {
    specifiers.push(m[1]);
  }

  return specifiers;
}

// ---------------------------------------------------------------------------
// Known barrel modules → sub-module directories
// ---------------------------------------------------------------------------

/** Map of barrel source file (POSIX relative to ROOT) → directory of sub-modules. */
const BARREL_MAP = {
  'src/ui/vab.ts':              'src/ui/vab',
  'src/ui/flightController.ts': 'src/ui/flightController',
  'src/ui/missionControl.ts':   'src/ui/missionControl',
  'src/render/flight.ts':       'src/render/flight',
};

/**
 * Given a barrel source path, return the list of sub-module source paths
 * that the barrel re-exports (including the barrel itself).
 */
function expandBarrel(barrelPosix) {
  const subDir = BARREL_MAP[barrelPosix];
  if (!subDir) return [barrelPosix];

  const absDir = resolve(ROOT, subDir);
  const result = [barrelPosix];
  if (existsSync(absDir)) {
    for (const entry of readdirSync(absDir)) {
      if (entry.endsWith('.ts')) {
        result.push(norm(relative(ROOT, resolve(absDir, entry))));
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Resolve an import specifier to a source path relative to ROOT
// ---------------------------------------------------------------------------

/**
 * Resolve an import specifier relative to the importing file.
 * Returns a POSIX path relative to ROOT, or null if not a project source import.
 */
function resolveImport(specifier, importerAbsPath) {
  // Skip external packages
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
    return null;
  }

  const importerDir = dirname(importerAbsPath);
  let resolved = resolve(importerDir, specifier);
  let relPath = norm(relative(ROOT, resolved));

  // The codebase uses .ts extensions in import specifiers and also .js
  // (which resolve to .ts via Vite plugin). Try to resolve to actual .ts file.
  if (!relPath.endsWith('.ts') && !relPath.endsWith('.js')) {
    if (existsSync(resolved + '.ts')) {
      relPath = relPath + '.ts';
    } else if (existsSync(resolved + '.js')) {
      relPath = relPath + '.js';
    } else if (existsSync(resolve(resolved, 'index.ts'))) {
      relPath = relPath + '/index.ts';
    }
  }

  // Normalise .js → .ts if the .ts file exists (Vite jsToTsResolve)
  if (relPath.endsWith('.js')) {
    const tsVariant = relPath.replace(/\.js$/, '.ts');
    const tsAbs = resolve(ROOT, tsVariant);
    if (existsSync(tsAbs)) {
      relPath = tsVariant;
    }
  }

  // Only include project source files (src/ or e2e/)
  if (!relPath.startsWith('src/') && !relPath.startsWith('e2e/')) {
    return null;
  }

  // Skip test files themselves
  if (relPath.includes('.test.') || relPath.includes('.spec.')) {
    return null;
  }

  return relPath;
}

// ---------------------------------------------------------------------------
// Source groups and area classification
// ---------------------------------------------------------------------------

// Groups of related source files that share an area name
const SOURCE_GROUPS = {
  'app/main':           ['src/main.ts'],
  'ui/fatalError':      ['src/ui/fatalError.ts'],
  'core/gameState':     ['src/core/gameState.ts', 'src/core/constants.ts'],
  'core/rocketbuilder': ['src/core/rocketbuilder.ts', 'src/core/rocketvalidator.ts'],
  'core/orbit':         ['src/core/orbit.ts', 'src/core/manoeuvre.ts'],
  'core/parachute':     ['src/core/parachute.ts', 'src/core/legs.ts'],
  'core/biomes':        ['src/core/biomes.ts', 'src/core/sciencemodule.ts', 'src/core/surfaceOps.ts'],
  'core/satellites':    ['src/core/satellites.ts', 'src/core/comms.ts'],
  'core/docking':       ['src/core/docking.ts', 'src/core/grabbing.ts'],
  'core/dragCoefficient': ['src/core/dragCoefficient.ts'],
  'core/throttleControl': ['src/core/throttleControl.ts'],
  'core/power':         ['src/core/power.ts', 'src/core/lifeSupport.ts'],
  'core/malfunction':   ['src/core/malfunction.ts', 'src/core/ejector.ts'],
  'core/finance':       ['src/core/finance.ts', 'src/core/period.ts'],
  'core/saveload':      ['src/core/saveload.ts', 'src/core/autoSave.ts', 'src/core/idbStorage.ts'],
  'core/challenges':    ['src/core/challenges.ts', 'src/core/customChallenges.ts'],
  'core/physicsWorker': ['src/core/physicsWorker.ts', 'src/core/physicsWorkerProtocol.ts'],
  'ui/settings':        ['src/ui/settings.ts', 'src/ui/perfDashboard.ts', 'src/ui/fpsMonitor.ts'],
  'ui/utilities':       ['src/ui/escapeHtml.ts', 'src/ui/listenerTracker.ts', 'src/ui/rocketCardUtil.ts', 'src/ui/autoSaveToast.ts'],
  'ui/flightHud':       ['src/ui/flightHud.ts', 'src/ui/flightContextMenu.ts'],
  'ui/flightController/docking':  ['src/ui/flightController/_docking.ts', 'src/ui/flightController/_orbitRcs.ts'],
  'ui/flightController/map':      ['src/ui/flightController/_mapView.ts'],
  'ui/flightController/surface':  ['src/ui/flightController/_surfaceActions.ts', 'src/ui/flightController/_postFlight.ts'],
  'render/pool':        ['src/render/pool.ts'],
};

// Build reverse lookup: source path → area name
const sourceToGroupArea = new Map();
for (const [area, sources] of Object.entries(SOURCE_GROUPS)) {
  for (const src of sources) {
    sourceToGroupArea.set(src, area);
  }
}

// Source files to skip — internal plumbing that should not create their own area
const SKIP_SOURCES = new Set([
  'src/core/index.ts',
  'src/data/index.ts',
  'src/ui/index.ts',
  'src/render/index.ts',
  'src/render/types.ts',       // internal render type definitions
  'src/core/transferObjects.ts', // internal helper
  'src/core/debugSaves.ts',    // dev utility
  'src/ui/library.ts',         // internal helper
  'src/ui/debugSaves.ts',      // dev utility
]);

function classifySource(srcPath) {
  // E2E infrastructure
  if (srcPath.startsWith('e2e/helpers') || srcPath === 'e2e/fixtures.ts') {
    return 'e2e-infra';
  }

  // Skip internal plumbing files
  if (SKIP_SOURCES.has(srcPath)) {
    return null;
  }

  // Check explicit groups first
  if (sourceToGroupArea.has(srcPath)) {
    return sourceToGroupArea.get(srcPath);
  }

  // Sub-module directories: src/ui/vab/_staging.ts → ui/vab
  const subDirPatterns = [
    { re: /^src\/ui\/vab\//, area: 'ui/vab' },
    { re: /^src\/ui\/flightController\//, area: 'ui/flightController' },
    { re: /^src\/ui\/missionControl\//, area: 'ui/missionControl' },
    { re: /^src\/render\/flight\//, area: 'render/flight' },
  ];
  for (const { re, area } of subDirPatterns) {
    if (re.test(srcPath)) return area;
  }

  // Barrel re-exports that are themselves sub-module directories
  if (BARREL_MAP[srcPath]) {
    const m = srcPath.match(/^src\/(.+)\.ts$/);
    if (m) return m[1];
  }

  // Standard pattern: src/{layer}/{module}.ts → {layer}/{module}
  const match = srcPath.match(/^src\/(\w+)\/(\w+)\.ts$/);
  if (match) {
    return `${match[1]}/${match[2]}`;
  }

  // Fallback for deeper paths: src/{layer}/{dir}/{file}.ts → {layer}/{dir}
  const deepMatch = srcPath.match(/^src\/(\w+)\/(\w+)\//);
  if (deepMatch) {
    return `${deepMatch[1]}/${deepMatch[2]}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// E2E spec → area mapping (heuristic + curated)
//
// E2E specs don't import source modules directly; they test via the browser.
// We map them based on filename conventions and semantic knowledge of what
// each spec exercises.
// ---------------------------------------------------------------------------

const E2E_SPEC_AREAS = {
  'e2e/flight.spec.ts':                   ['core/physics', 'core/staging', 'core/fuelsystem', 'core/flightReturn', 'ui/flightController', 'ui/flightHud', 'ui/topbar', 'render/flight', 'data/parts'],
  'e2e/landing.spec.ts':                  ['core/physics', 'core/staging', 'core/parachute', 'core/flightReturn', 'ui/flightController', 'render/flight'],
  'e2e/core-mechanics.spec.ts':           ['core/physics', 'core/physicsWorker', 'core/orbit', 'core/flightPhase', 'core/controlMode', 'core/mapView', 'ui/flightController', 'ui/flightController/map', 'render/map', 'data/parts'],
  'e2e/phase-transitions.spec.ts':        ['core/physics', 'core/flightPhase', 'core/atmosphere', 'core/orbit', 'ui/flightController'],
  'e2e/collision.spec.ts':                ['core/collision', 'core/physics', 'core/staging'],
  'e2e/orbital-operations.spec.ts':       ['core/orbit', 'core/satellites', 'core/docking', 'core/power', 'ui/flightController/docking', 'ui/satelliteOps', 'render/map'],
  'e2e/rocketbuilder.spec.ts':            ['core/rocketbuilder', 'core/staging', 'ui/vab', 'render/vab', 'data/parts'],
  'e2e/part-reconnection.spec.ts':        ['core/rocketbuilder', 'ui/vab'],
  'e2e/vab-undo.spec.ts':                 ['core/undoRedo', 'ui/vab'],
  'e2e/missions.spec.ts':                 ['core/missions', 'ui/missionControl', 'data/missions'],
  'e2e/flight-mission.spec.ts':           ['core/missions', 'core/physics'],
  'e2e/mission-progression.spec.ts':      ['core/missions', 'data/missions'],
  'e2e/crew.spec.ts':                     ['core/crew', 'ui/crewAdmin'],
  'e2e/agency-depth.spec.ts':             ['core/contracts', 'core/crew', 'core/finance', 'core/designLibrary', 'ui/crewAdmin', 'data/contracts'],
  'e2e/newgame.spec.ts':                  ['core/gameState', 'ui/hub', 'ui/mainmenu', 'render/hub'],
  'e2e/saveload.spec.ts':                 ['core/saveload', 'core/gameState', 'ui/topbar', 'ui/mainmenu'],
  'e2e/auto-save.spec.ts':               ['core/saveload', 'ui/utilities'],
  'e2e/save-version.spec.ts':             ['core/saveload'],
  'e2e/hub-navigation.spec.ts':           ['ui/hub', 'render/hub'],
  'e2e/help.spec.ts':                     ['ui/help'],
  'e2e/destinations.spec.ts':             ['core/atmosphere', 'core/orbit', 'core/biomes', 'core/achievements', 'ui/flightController/surface', 'data/bodies'],
  'e2e/biomes-science.spec.ts':           ['core/biomes', 'core/techtree', 'data/instruments', 'data/techtree', 'ui/rdLab'],
  'e2e/sandbox-replayability.spec.ts':    ['core/challenges', 'ui/settings', 'data/challenges'],
  'e2e/reliability-risk.spec.ts':         ['core/malfunction', 'core/weather', 'core/reputation', 'core/partInventory'],
  'e2e/failure-paths.spec.ts':            ['core/malfunction', 'core/finance', 'core/flightReturn'],
  'e2e/additional-systems.spec.ts':       ['core/satellites', 'core/power', 'ui/trackingStation'],
  'e2e/asteroid-belt.spec.ts':            ['core/collision', 'core/asteroidBelt', 'core/docking'],
  'e2e/launchpad.spec.ts':                ['ui/launchPad'],
  'e2e/launchpad-relaunch.spec.ts':       ['ui/launchPad'],
  'e2e/facilities-infrastructure.spec.ts':['core/construction'],
  'e2e/fps-monitor.spec.ts':              ['core/perfMonitor', 'ui/settings'],
  'e2e/debug-mode.spec.ts':               ['ui/settings'],
  'e2e/context-menu.spec.ts':             ['core/parachute', 'ui/flightHud'],
  'e2e/flight-hud-surface.spec.ts':       ['ui/flightHud'],
  'e2e/tutorial-revisions.spec.ts':       ['data/missions'],
  'e2e/keyboard-nav.spec.ts':             ['ui/flightController'],
  'e2e/tipping.spec.ts':                  ['core/physics'],
  'e2e/relaunch.spec.ts':                 ['ui/launchPad', 'core/physics'],
  'e2e/scene-cleanup.spec.ts':            ['render/flight', 'ui/flightController'],
  'e2e/smoke.spec.ts':                    [],
  'e2e/test-infrastructure.spec.ts':      [],
};

// ---------------------------------------------------------------------------
// Scan test files
// ---------------------------------------------------------------------------

function scanTestFiles() {
  const unitDir = resolve(ROOT, 'src/tests');
  const e2eDir = resolve(ROOT, 'e2e');

  const unitFiles = [];
  const e2eFiles = [];

  if (existsSync(unitDir)) {
    for (const entry of readdirSync(unitDir)) {
      if (entry.endsWith('.test.ts')) {
        unitFiles.push(resolve(unitDir, entry));
      }
    }
  }

  if (existsSync(e2eDir)) {
    for (const entry of readdirSync(e2eDir)) {
      if (entry.endsWith('.spec.ts')) {
        e2eFiles.push(resolve(e2eDir, entry));
      }
    }
  }

  return { unitFiles, e2eFiles };
}

// ---------------------------------------------------------------------------
// Build the test map
// ---------------------------------------------------------------------------

function buildTestMap() {
  const { unitFiles, e2eFiles } = scanTestFiles();

  // area → { sources: Set, unit: Set, e2e: Set }
  const areas = new Map();

  function ensureArea(name) {
    if (!areas.has(name)) {
      areas.set(name, { sources: new Set(), unit: new Set(), e2e: new Set() });
    }
    return areas.get(name);
  }

  // -------------------------------------------------------------------
  // Phase 1: Process unit tests (import-based mapping)
  // -------------------------------------------------------------------

  for (const absPath of unitFiles) {
    const specifiers = extractValueImports(absPath);
    const relTest = norm(relative(ROOT, absPath));
    const testAreas = new Set();

    for (const spec of specifiers) {
      const resolved = resolveImport(spec, absPath);
      if (!resolved) continue;

      // E2E infrastructure imports (from unit tests that test the helpers)
      if (resolved.startsWith('e2e/helpers') || resolved === 'e2e/fixtures.ts') {
        const area = ensureArea('e2e-infra');
        area.sources.add(resolved);
        testAreas.add('e2e-infra');
        continue;
      }

      // Skip test setup and index files
      if (resolved === 'src/tests/setup.ts') continue;
      if (resolved.endsWith('/index.ts')) continue;

      const areaName = classifySource(resolved);
      if (!areaName) continue;

      const area = ensureArea(areaName);

      // Add the source (and expand barrels)
      if (BARREL_MAP[resolved]) {
        for (const sub of expandBarrel(resolved)) {
          area.sources.add(sub);
        }
      } else {
        area.sources.add(resolved);
      }

      testAreas.add(areaName);
    }

    // Record the test file in each area
    for (const areaName of testAreas) {
      areas.get(areaName).unit.add(relTest);
    }
  }

  // -------------------------------------------------------------------
  // Phase 2: Process E2E specs (heuristic mapping)
  // -------------------------------------------------------------------

  const unmappedSpecs = [];

  for (const absPath of e2eFiles) {
    const relTest = norm(relative(ROOT, absPath));
    const areaNames = E2E_SPEC_AREAS[relTest];

    if (areaNames && areaNames.length > 0) {
      for (const areaName of areaNames) {
        const area = ensureArea(areaName);
        area.e2e.add(relTest);
      }
    } else if (!areaNames) {
      unmappedSpecs.push(relTest);
    }
    // specs with empty array are intentionally unmapped (smoke, test-infra)
  }

  if (unmappedSpecs.length > 0) {
    console.error(`Warning: ${unmappedSpecs.length} E2E spec(s) not in E2E_SPEC_AREAS lookup:`);
    for (const s of unmappedSpecs) {
      console.error(`  ${s}`);
    }
    console.error('Add them to E2E_SPEC_AREAS in generate-test-map.mjs.');
  }

  // -------------------------------------------------------------------
  // Phase 3: Populate sources for areas that only have E2E entries
  //
  // Some areas were only created by E2E mapping and don't have sources
  // yet. Fill in sources from the SOURCE_GROUPS or by convention.
  // -------------------------------------------------------------------

  for (const [areaName, area] of areas) {
    if (area.sources.size === 0 && areaName !== 'e2e-infra') {
      // Check SOURCE_GROUPS
      if (SOURCE_GROUPS[areaName]) {
        for (const src of SOURCE_GROUPS[areaName]) {
          if (existsSync(resolve(ROOT, src))) {
            area.sources.add(src);
          }
        }
      }
      // Convention: area name → src/{area}.ts
      if (area.sources.size === 0) {
        const conventionPath = `src/${areaName}.ts`;
        if (existsSync(resolve(ROOT, conventionPath))) {
          area.sources.add(conventionPath);
          // If it's a barrel, expand
          if (BARREL_MAP[conventionPath]) {
            for (const sub of expandBarrel(conventionPath)) {
              area.sources.add(sub);
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // Phase 4: Ensure e2e-infra area
  // -------------------------------------------------------------------

  const infraArea = ensureArea('e2e-infra');
  infraArea.sources.add('e2e/helpers.ts');
  infraArea.sources.add('e2e/helpers/');
  infraArea.sources.add('e2e/fixtures.ts');
  infraArea.unit.add('src/tests/e2e-infrastructure.test.ts');
  infraArea.e2e.add('e2e/**/*.spec.ts');

  // -------------------------------------------------------------------
  // Phase 5: Ensure barrel areas include their sub-module sources
  // -------------------------------------------------------------------

  for (const [barrelPath, subDir] of Object.entries(BARREL_MAP)) {
    const areaName = classifySource(barrelPath);
    if (!areaName || !areas.has(areaName)) continue;

    const area = areas.get(areaName);
    area.sources.add(barrelPath);
    const absDir = resolve(ROOT, subDir);
    if (existsSync(absDir)) {
      for (const entry of readdirSync(absDir)) {
        if (entry.endsWith('.ts')) {
          area.sources.add(norm(relative(ROOT, resolve(absDir, entry))));
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // Format output
  // -------------------------------------------------------------------

  const sortedAreas = {};
  const areaNames = [...areas.keys()].sort((a, b) => {
    const layerOrder = { core: 0, data: 1, ui: 2, render: 3, 'e2e-infra': 4 };
    const layerA = a.split('/')[0];
    const layerB = b.split('/')[0];
    const orderA = layerOrder[layerA] ?? 99;
    const orderB = layerOrder[layerB] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.localeCompare(b);
  });

  for (const name of areaNames) {
    const area = areas.get(name);
    sortedAreas[name] = {
      sources: [...area.sources].sort(),
      unit: [...area.unit].sort(),
      e2e: [...area.e2e].sort(),
    };
  }

  return {
    _comment: 'Auto-generated by scripts/generate-test-map.mjs. Maps source areas to test files. Used by scripts/run-affected.mjs.',
    areas: sortedAreas,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const testMap = buildTestMap();
const json = JSON.stringify(testMap, null, 2) + '\n';

if (dryRun) {
  process.stdout.write(json);
  console.error(`\n[dry-run] ${Object.keys(testMap.areas).length} areas generated.`);
} else {
  const outPath = resolve(ROOT, 'test-map.json');
  writeFileSync(outPath, json, 'utf-8');
  console.log(`Wrote ${outPath} (${Object.keys(testMap.areas).length} areas).`);
}
