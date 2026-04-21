#!/usr/bin/env node
/**
 * Codemod: fix Playwright waitForFunction calls where the 2nd arg is options
 * instead of the page-function arg. Playwright's waitForFunction signature is:
 *
 *   waitForFunction(pageFn, arg, options)
 *
 * When called with 2 args and the 2nd arg is `{ timeout: N }`, Playwright
 * treats it as `arg`, NOT as options. The timeout is silently ignored and
 * defaults to 30s. This is almost always a bug for no-arg page functions.
 *
 * This script rewrites:
 *   waitForFunction(() => <expr>, { timeout: N })
 * to:
 *   waitForFunction(() => <expr>, undefined, { timeout: N })
 *
 * It only touches calls where the page function takes zero arguments
 * (i.e. `()` or `():<type>`). Functions with args are assumed correct.
 */
import fs from 'fs';
import path from 'path';

const ROOTS = ['e2e'];
const SKIP = new Set(['node_modules', 'dist', 'test-results', 'playwright-report']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Find each `waitForFunction(` call in the source and attempt a fix.
 * Returns the rewritten source and a count of fixes applied.
 */
function transform(src) {
  let out = '';
  let i = 0;
  let fixes = 0;
  const needle = 'waitForFunction(';
  while (i < src.length) {
    const idx = src.indexOf(needle, i);
    if (idx < 0) { out += src.slice(i); break; }
    // Ensure this is a method call, not e.g. 'waitForFunctionFoo('.
    const prev = src[idx - 1];
    if (prev !== '.' && prev !== ' ' && prev !== '\n' && prev !== '\t' && prev !== '(') {
      // Not a waitForFunction call; pass through.
      out += src.slice(i, idx + needle.length);
      i = idx + needle.length;
      continue;
    }
    out += src.slice(i, idx + needle.length);
    // Scan from here to find the arg list. Track paren depth, string/template quoting.
    let j = idx + needle.length;
    const argStart = j;
    let depth = 1;
    let inStr = null; // '"' | "'" | '`'
    let inLineComment = false;
    let inBlockComment = false;
    let commas = []; // top-level commas at depth==1
    while (j < src.length && depth > 0) {
      const c = src[j];
      const n = src[j + 1];
      if (inLineComment) {
        if (c === '\n') inLineComment = false;
      } else if (inBlockComment) {
        if (c === '*' && n === '/') { inBlockComment = false; j++; }
      } else if (inStr) {
        if (c === '\\' && j + 1 < src.length) { j++; }
        else if (c === inStr) { inStr = null; }
      } else {
        if (c === '/' && n === '/') { inLineComment = true; j++; }
        else if (c === '/' && n === '*') { inBlockComment = true; j++; }
        else if (c === '"' || c === "'" || c === '`') { inStr = c; }
        else if (c === '(' || c === '{' || c === '[') { depth++; }
        else if (c === ')' || c === '}' || c === ']') {
          depth--;
          if (depth === 0) break;
        }
        else if (c === ',' && depth === 1) { commas.push(j); }
      }
      j++;
    }
    const argEnd = j;
    const callEnd = j + 1;
    // Drop trailing-comma (empty last arg) — if the text after the last comma
    // is all whitespace, it's a trailing comma, not a separate arg.
    while (commas.length > 0 && src.slice(commas[commas.length - 1] + 1, argEnd).trim() === '') {
      commas.pop();
    }
    // Only act if there are exactly 2 top-level args (one comma).
    if (commas.length !== 1) {
      out += src.slice(argStart, callEnd);
      i = callEnd;
      continue;
    }
    const commaAt = commas[0];
    const first = src.slice(argStart, commaAt).trim();
    const second = src.slice(commaAt + 1, argEnd).trim().replace(/,\s*$/, '');
    // Only fix when:
    //  - first is a no-arg arrow function, and
    //  - second looks like an options object containing `timeout`.
    // No-arg arrow: starts with `()` optionally followed by `:<Type>` then `=>`.
    const noArgFn = /^\(\s*\)\s*(?::\s*[^=]+?)?\s*=>/m.test(first);
    const isOptionsObj = /^\{[\s\S]*\btimeout\s*:/m.test(second);
    if (!noArgFn || !isOptionsObj) {
      out += src.slice(argStart, callEnd);
      i = callEnd;
      continue;
    }
    // Rewrite: keep the literal source of the first arg, insert `undefined,`
    // before the second arg, keep the second arg as-is. Preserve whitespace.
    // We rebuild: <first> <original comma> undefined, <second-text-as-was>
    // The simplest/safest rewrite preserves the original comma+gap before
    // `undefined` and puts the options after a comma.
    const firstSrc = src.slice(argStart, commaAt);
    const afterComma = src.slice(commaAt, argEnd); // starts with ','
    // afterComma looks like:  ,\n    { timeout: N }   (or similar)
    // Insert ` undefined,` after the first comma, preserve trailing whitespace.
    const rewritten =
      firstSrc +
      afterComma.replace(/^,(\s*)/, ',$1undefined,$1');
    out += rewritten + src[argEnd]; // include the closing ')'
    i = argEnd + 1;
    fixes++;
  }
  return { out, fixes };
}

let totalFixes = 0;
const files = ROOTS.flatMap(walk);
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const { out, fixes } = transform(src);
  if (fixes > 0) {
    fs.writeFileSync(file, out);
    console.log(`${file}: ${fixes} fix(es)`);
    totalFixes += fixes;
  }
}
console.log(`\nTotal: ${totalFixes} waitForFunction calls rewritten`);
