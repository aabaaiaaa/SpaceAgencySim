#!/usr/bin/env node
/**
 * e2e-timing.mjs — Analyse Playwright JSON timing report.
 *
 * Reads test-results/timing.json (produced by the JSON reporter) and outputs:
 *   1. Top N slowest individual tests
 *   2. Slowest files by total duration
 *   3. Tests exceeding a configurable threshold
 *   4. Average test time per file
 *
 * Usage:
 *   node scripts/e2e-timing.mjs              # defaults: top 20, threshold 30s
 *   node scripts/e2e-timing.mjs --top 10     # show top 10 slowest
 *   node scripts/e2e-timing.mjs --threshold 60  # flag tests over 60s
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? Number(args[idx + 1]) : fallback;
}

const TOP_N = getArg('top', 20);
const THRESHOLD_S = getArg('threshold', 30);

// ---------------------------------------------------------------------------
// Read report
// ---------------------------------------------------------------------------

const reportPath = resolve('test-results', 'timing.json');
let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf-8'));
} catch (err) {
  console.error(`Could not read ${reportPath}`);
  console.error('Run E2E tests first: npx playwright test');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Extract test data
// ---------------------------------------------------------------------------

const tests = [];

function walkSuites(suites, filePath = '') {
  for (const suite of suites) {
    const file = suite.file || filePath;
    for (const spec of suite.specs || []) {
      for (const result of spec.tests || []) {
        for (const run of result.results || []) {
          tests.push({
            title: spec.title,
            file: file.replace(/\\/g, '/'),
            duration: run.duration,
            status: run.status,
          });
        }
      }
    }
    if (suite.suites) walkSuites(suite.suites, file);
  }
}

walkSuites(report.suites || []);

if (tests.length === 0) {
  console.error('No test results found in report.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = ((ms % 60_000) / 1000).toFixed(0);
  return `${m}m ${s}s`;
}

function shortFile(f) {
  return f.replace(/.*e2e\//, '');
}

// ---------------------------------------------------------------------------
// 1. Top N slowest tests
// ---------------------------------------------------------------------------

const sorted = [...tests].sort((a, b) => b.duration - a.duration);

console.log(`\n=== Top ${TOP_N} Slowest Tests ===\n`);
console.log('  Duration  | File                              | Test');
console.log('  ----------|-----------------------------------|-----');
for (const t of sorted.slice(0, TOP_N)) {
  const dur = fmtDuration(t.duration).padStart(9);
  const file = shortFile(t.file).padEnd(35);
  console.log(`  ${dur} | ${file}| ${t.title}`);
}

// ---------------------------------------------------------------------------
// 2. Slowest files by total duration
// ---------------------------------------------------------------------------

const byFile = new Map();
for (const t of tests) {
  const f = shortFile(t.file);
  const entry = byFile.get(f) || { total: 0, count: 0 };
  entry.total += t.duration;
  entry.count += 1;
  byFile.set(f, entry);
}

const fileSorted = [...byFile.entries()].sort((a, b) => b[1].total - a[1].total);

console.log(`\n=== Slowest Files (Total Duration) ===\n`);
console.log('  Total     | Tests | Avg     | File');
console.log('  ----------|-------|---------|-----');
for (const [file, { total, count }] of fileSorted) {
  const tot = fmtDuration(total).padStart(9);
  const cnt = String(count).padStart(5);
  const avg = fmtDuration(Math.round(total / count)).padStart(7);
  console.log(`  ${tot} | ${cnt} | ${avg} | ${file}`);
}

// ---------------------------------------------------------------------------
// 3. Tests exceeding threshold
// ---------------------------------------------------------------------------

const slow = tests.filter((t) => t.duration > THRESHOLD_S * 1000);

if (slow.length > 0) {
  console.log(`\n=== Tests Exceeding ${THRESHOLD_S}s Threshold (${slow.length} found) ===\n`);
  for (const t of slow.sort((a, b) => b.duration - a.duration)) {
    console.log(`  ${fmtDuration(t.duration).padStart(9)}  ${shortFile(t.file)}  ${t.title}`);
  }
} else {
  console.log(`\n=== No tests exceeded the ${THRESHOLD_S}s threshold ===`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const totalDuration = tests.reduce((sum, t) => sum + t.duration, 0);
const passed = tests.filter((t) => t.status === 'passed').length;
const failed = tests.filter((t) => t.status === 'failed').length;

console.log(`\n=== Summary ===`);
console.log(`  Total tests:    ${tests.length}`);
console.log(`  Passed:         ${passed}`);
console.log(`  Failed:         ${failed}`);
console.log(`  Total duration: ${fmtDuration(totalDuration)} (sum of all tests, not wall-clock)`);
console.log(`  Average:        ${fmtDuration(Math.round(totalDuration / tests.length))}`);
console.log('');
