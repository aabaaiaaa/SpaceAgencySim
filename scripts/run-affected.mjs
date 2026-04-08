#!/usr/bin/env node
/**
 * run-affected.mjs — Run tests affected by source changes.
 *
 * Reads git diff, maps changed files to test files via test-map.json,
 * and runs only @smoke-tagged tests in those files (or all tests with --all).
 *
 * Usage:
 *   node scripts/run-affected.mjs                    # smoke tests for uncommitted changes
 *   node scripts/run-affected.mjs --base main        # smoke tests for branch vs main
 *   node scripts/run-affected.mjs --all              # all tests in affected files
 *   node scripts/run-affected.mjs --unit-only         # only unit tests
 *   node scripts/run-affected.mjs --e2e-only          # only E2E specs
 *   node scripts/run-affected.mjs --dry-run           # list affected tests without running
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flags = {
  base:     null,
  all:      args.includes('--all'),
  unitOnly: args.includes('--unit-only'),
  e2eOnly:  args.includes('--e2e-only'),
  dryRun:   args.includes('--dry-run'),
};

const baseIdx = args.indexOf('--base');
if (baseIdx !== -1 && args[baseIdx + 1]) {
  flags.base = args[baseIdx + 1];
}

// ---------------------------------------------------------------------------
// Get changed files from git
// ---------------------------------------------------------------------------

function getChangedFiles() {
  let cmd;
  if (flags.base) {
    // Diff between base ref and HEAD + any uncommitted changes
    cmd = `git diff --name-only ${flags.base}...HEAD`;
    const committed = execSync(cmd, { cwd: ROOT, encoding: 'utf-8' }).trim();
    const uncommitted = execSync('git diff --name-only', { cwd: ROOT, encoding: 'utf-8' }).trim();
    const staged = execSync('git diff --name-only --cached', { cwd: ROOT, encoding: 'utf-8' }).trim();
    const all = new Set([
      ...committed.split('\n'),
      ...uncommitted.split('\n'),
      ...staged.split('\n'),
    ]);
    all.delete('');
    return [...all];
  }

  // Uncommitted + staged changes
  const uncommitted = execSync('git diff --name-only', { cwd: ROOT, encoding: 'utf-8' }).trim();
  const staged = execSync('git diff --name-only --cached', { cwd: ROOT, encoding: 'utf-8' }).trim();
  const all = new Set([
    ...uncommitted.split('\n'),
    ...staged.split('\n'),
  ]);
  all.delete('');
  return [...all];
}

// ---------------------------------------------------------------------------
// Load test map
// ---------------------------------------------------------------------------

function loadTestMap() {
  const mapPath = resolve(ROOT, 'test-map.json');
  if (!existsSync(mapPath)) {
    console.error('Error: test-map.json not found at project root.');
    process.exit(1);
  }
  return JSON.parse(readFileSync(mapPath, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Normalize paths (git uses forward slashes on all platforms)
// ---------------------------------------------------------------------------

function norm(p) {
  return p.replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// Match changed files to test map areas
// ---------------------------------------------------------------------------

function findAffectedTests(changedFiles, testMap) {
  const unitFiles = new Set();
  const e2eFiles = new Set();

  const normalizedChanged = changedFiles.map(norm);

  for (const area of Object.values(testMap.areas)) {
    const sources = (area.sources || []).map(norm);

    // Check if any changed file matches a source in this area
    const hit = normalizedChanged.some(changed => {
      return sources.some(src => {
        // Exact match or directory prefix match (e.g., "e2e/helpers/" matches "e2e/helpers/_flight.js")
        if (src.endsWith('/')) {
          return changed.startsWith(src);
        }
        return changed === src;
      });
    });

    if (hit) {
      for (const u of area.unit || []) unitFiles.add(u);
      for (const e of area.e2e || []) {
        if (e.includes('*')) {
          // Glob pattern — flag for expansion
          e2eFiles.add('__ALL_E2E__');
        } else {
          e2eFiles.add(e);
        }
      }
    }
  }

  return { unitFiles: [...unitFiles], e2eFiles: [...e2eFiles] };
}

// ---------------------------------------------------------------------------
// Expand __ALL_E2E__ marker
// ---------------------------------------------------------------------------

function expandAllE2E(e2eFiles) {
  if (!e2eFiles.includes('__ALL_E2E__')) return e2eFiles;

  // List all spec files in e2e/
  const allSpecs = execSync('git ls-files e2e/*.spec.js', { cwd: ROOT, encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  return [...new Set([...e2eFiles.filter(f => f !== '__ALL_E2E__'), ...allSpecs])];
}

// ---------------------------------------------------------------------------
// Verify files exist
// ---------------------------------------------------------------------------

function filterExisting(files) {
  return files.filter(f => {
    const full = resolve(ROOT, f);
    return existsSync(full);
  });
}

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

function run(cmd) {
  console.log(`\n> ${cmd}\n`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const changedFiles = getChangedFiles();

if (changedFiles.length === 0) {
  console.log('No changed files detected. Nothing to test.');
  process.exit(0);
}

console.log(`Changed files (${changedFiles.length}):`);
changedFiles.forEach(f => console.log(`  ${f}`));

const testMap = loadTestMap();
let { unitFiles, e2eFiles } = findAffectedTests(changedFiles, testMap);

e2eFiles = expandAllE2E(e2eFiles);
unitFiles = filterExisting(unitFiles);
e2eFiles = filterExisting(e2eFiles);

console.log(`\nAffected unit test files (${unitFiles.length}):`);
unitFiles.forEach(f => console.log(`  ${f}`));

console.log(`\nAffected E2E spec files (${e2eFiles.length}):`);
e2eFiles.forEach(f => console.log(`  ${f}`));

if (unitFiles.length === 0 && e2eFiles.length === 0) {
  console.log('\nNo test files affected by changes.');
  process.exit(0);
}

if (flags.dryRun) {
  console.log('\n--dry-run: would run the above test files.');
  process.exit(0);
}

const unitGrepFlag = flags.all ? '' : ' --testNamePattern @smoke';
const e2eGrepFlag = flags.all ? '' : ' --grep @smoke';
let ok = true;

// Run unit tests
if (!flags.e2eOnly && unitFiles.length > 0) {
  const unitCmd = `npx vitest run${unitGrepFlag} ${unitFiles.join(' ')}`;
  if (!run(unitCmd)) ok = false;
}

// Run E2E tests
if (!flags.unitOnly && e2eFiles.length > 0) {
  const e2eCmd = `npx playwright test${e2eGrepFlag} ${e2eFiles.join(' ')}`;
  if (!run(e2eCmd)) ok = false;
}

process.exit(ok ? 0 : 1);
