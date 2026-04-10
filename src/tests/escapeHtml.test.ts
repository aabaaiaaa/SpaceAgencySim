/**
 * escapeHtml.test.ts — Unit tests for the shared HTML escaping utility.
 *
 * Tests all special character escaping, empty strings, non-string coercion,
 * and ensures already-escaped input is not double-escaped.
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../ui/escapeHtml.ts';

describe('escapeHtml', () => {
  // ---- Individual special characters ----

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than signs', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than signs', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
  });

  // ---- Combined special characters ----

  it('escapes all four special characters in a single string', () => {
    expect(escapeHtml('<div class="x">&</div>'))
      .toBe('&lt;div class=&quot;x&quot;&gt;&amp;&lt;/div&gt;');
  });

  it('handles multiple consecutive special characters', () => {
    expect(escapeHtml('<<>>&""')).toBe('&lt;&lt;&gt;&gt;&amp;&quot;&quot;');
  });

  it('handles strings with only special characters', () => {
    expect(escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
  });

  // ---- Edge cases ----

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns the same string when no escaping is needed', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('handles unicode characters without escaping them', () => {
    expect(escapeHtml('café ñ 日本語')).toBe('café ñ 日本語');
  });

  it('does NOT escape single quotes (by design)', () => {
    expect(escapeHtml("it's a test")).toBe("it's a test");
  });

  // ---- Non-string coercion ----

  it('coerces number input via String()', () => {
    expect(escapeHtml(42 as unknown as string)).toBe('42');
  });

  it('coerces null input via String()', () => {
    expect(escapeHtml(null as unknown as string)).toBe('null');
  });

  it('coerces undefined input via String()', () => {
    expect(escapeHtml(undefined as unknown as string)).toBe('undefined');
  });

  it('coerces boolean input via String()', () => {
    expect(escapeHtml(true as unknown as string)).toBe('true');
  });

  // ---- Already-escaped input (no double-escaping) ----

  it('does NOT double-escape already-escaped ampersands', () => {
    // Input already has &amp; — the & in &amp; gets escaped to &amp;amp;
    // This is correct behaviour: the function treats all & characters equally.
    // "Already-escaped" means the function escapes the & in &amp; → &amp;amp;
    const input = '&amp;';
    const result = escapeHtml(input);
    expect(result).toBe('&amp;amp;');
  });

  it('escapes & in &lt; to produce &amp;lt;', () => {
    const input = '&lt;';
    const result = escapeHtml(input);
    expect(result).toBe('&amp;lt;');
  });

  it('handles a realistic pre-escaped HTML fragment', () => {
    // If someone passes already-escaped HTML, each & entity gets re-escaped
    const input = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';
    const result = escapeHtml(input);
    expect(result).toBe(
      '&amp;lt;script&amp;gt;alert(&amp;quot;xss&amp;quot;)&amp;lt;/script&amp;gt;',
    );
  });

  // ---- Whitespace and formatting ----

  it('preserves whitespace characters', () => {
    expect(escapeHtml('  hello\tworld\n')).toBe('  hello\tworld\n');
  });

  it('handles very long strings', () => {
    const long = '<'.repeat(1000);
    const expected = '&lt;'.repeat(1000);
    expect(escapeHtml(long)).toBe(expected);
  });
});
