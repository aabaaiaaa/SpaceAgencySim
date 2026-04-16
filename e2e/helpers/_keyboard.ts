/**
 * Reliable keyboard dispatch helpers for E2E tests.
 *
 * `page.keyboard.press()` is unreliable under parallel Playwright workers
 * because Chromium throttles inactive tabs, swallowing key events.
 * Dispatching via `window.dispatchEvent(new KeyboardEvent(...))` bypasses
 * that throttling entirely and lands the event on listeners registered on
 * `window` — which is how the game's flight/VAB/hub keyboard handlers are
 * wired up.
 */

import type { Page } from '@playwright/test';

export interface DispatchKeyOptions {
  /** DOM `KeyboardEvent.code` (e.g. `'KeyX'`, `'Space'`). Derived from `key` when omitted. */
  code?: string;
  /** Event type — defaults to `'keydown'`. Pass `'keyup'` to release modifier-style keys. */
  type?: 'keydown' | 'keyup';
  /** Whether the event bubbles. Defaults to `true`. */
  bubbles?: boolean;
  /** Shift modifier. Defaults to `false`. */
  shiftKey?: boolean;
  /** Ctrl modifier. Defaults to `false`. */
  ctrlKey?: boolean;
  /** Alt modifier. Defaults to `false`. */
  altKey?: boolean;
  /** Meta modifier. Defaults to `false`. */
  metaKey?: boolean;
}

const NAMED_CODE: Record<string, string> = {
  ' ': 'Space',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

function deriveCode(key: string): string {
  if (key.length === 1) {
    const ch = key.toUpperCase();
    if (ch >= 'A' && ch <= 'Z') return `Key${ch}`;
    if (ch >= '0' && ch <= '9') return `Digit${ch}`;
  }
  return NAMED_CODE[key] ?? key;
}

/**
 * Dispatch a keyboard event directly on `window` via `page.evaluate()`.
 *
 * Prefer this over `page.keyboard.press()` for in-game keyboard shortcuts
 * (staging, throttle, time-warp, VAB undo, etc.) because it is immune to
 * background-tab throttling under parallel Playwright workers.
 *
 * @param page Playwright page
 * @param key DOM `KeyboardEvent.key` value (e.g. `'x'`, `' '`, `'Escape'`)
 * @param opts Optional overrides — most callers can omit
 */
export async function dispatchKey(
  page: Page,
  key: string,
  opts: DispatchKeyOptions = {},
): Promise<void> {
  const code = opts.code ?? deriveCode(key);
  const type = opts.type ?? 'keydown';
  const bubbles = opts.bubbles ?? true;
  const shiftKey = opts.shiftKey ?? false;
  const ctrlKey = opts.ctrlKey ?? false;
  const altKey = opts.altKey ?? false;
  const metaKey = opts.metaKey ?? false;
  await page.evaluate(
    ({ c, k, t, b, sh, ct, al, me }) => window.dispatchEvent(
      new KeyboardEvent(t, {
        code: c,
        key: k,
        bubbles: b,
        shiftKey: sh,
        ctrlKey: ct,
        altKey: al,
        metaKey: me,
      }),
    ),
    { c: code, k: key, t: type, b: bubbles, sh: shiftKey, ct: ctrlKey, al: altKey, me: metaKey },
  );
}
