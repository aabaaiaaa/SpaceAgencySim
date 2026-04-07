/**
 * escapeHtml.ts — Shared HTML escaping utility.
 *
 * innerHTML audit (2026-04-07): ~82 .innerHTML assignments across 29 UI files.
 * Most inject static templates or numeric values. Files with user-controlled
 * data (mainmenu.ts — save/agency names; library.ts — crew names) already
 * escape via this utility. crewAdmin.ts sets crew names via .textContent (safe).
 * No unescaped user-controlled data found in remaining innerHTML assignments.
 */

/**
 * Escapes a string for safe insertion as HTML text content.
 * Escapes &, <, >, and " characters.
 */
export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
