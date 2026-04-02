/**
 * injectStyle.js — Idempotent style injection utility.
 *
 * UI modules inject <style> elements on initialization. Without guards, cycling
 * through main menu → game → exit → new game accumulates duplicate style blocks.
 * This helper checks for an existing <style> with a matching `id` before
 * injecting, ensuring each stylesheet is added exactly once per page load.
 *
 * Usage:
 *   import { injectStyleOnce } from './injectStyle.js';
 *   injectStyleOnce('my-module-styles', MY_CSS_STRING);
 *
 * @module ui/injectStyle
 */

/**
 * Inject a <style> element into document.head, but only if one with the given
 * ID doesn't already exist. Safe to call repeatedly — subsequent calls are
 * no-ops.
 *
 * @param {string} id  Unique ID for the style element (used as element `id`).
 * @param {string} css The CSS text content.
 */
export function injectStyleOnce(id, css) {
  if (document.getElementById(id)) return;
  const el = document.createElement('style');
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
