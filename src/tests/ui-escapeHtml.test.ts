/**
 * ui-escapeHtml.test.ts — Unit tests for the shared HTML escaping utility.
 */

import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../ui/escapeHtml.ts';

describe('escapeHtml', () => {
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

  it('escapes all four characters in a single string', () => {
    expect(escapeHtml('<div class="x">&</div>'))
      .toBe('&lt;div class=&quot;x&quot;&gt;&amp;&lt;/div&gt;');
  });

  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns the same string when no escaping is needed', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('handles multiple consecutive special characters', () => {
    expect(escapeHtml('<<>>')).toBe('&lt;&lt;&gt;&gt;');
  });

  it('handles unicode characters without escaping them', () => {
    expect(escapeHtml('café ñ 日本語')).toBe('café ñ 日本語');
  });

  it('coerces non-string input via String()', () => {
    // The function calls String(str) first
    expect(escapeHtml(42 as unknown as string)).toBe('42');
    expect(escapeHtml(null as unknown as string)).toBe('null');
    expect(escapeHtml(undefined as unknown as string)).toBe('undefined');
  });

  it('escapes single quotes are NOT escaped (by design)', () => {
    // The function only escapes &, <, >, " — not single quotes
    expect(escapeHtml("it's")).toBe("it's");
  });

  it('handles strings with only special characters', () => {
    expect(escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
  });
});
