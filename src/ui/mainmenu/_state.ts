/**
 * _state.ts — Pure reducers for the main menu UI.
 *
 * Captures the pure, non-DOM computations used by mainmenu.ts — save
 * slot card formatters, mode/auto-save badge classification, version
 * mismatch detection, and save-list organization — for unit testing.
 * Follows the VAB / hub reducer pattern (src/ui/vab/_state.ts,
 * src/ui/hub/_state.ts).
 *
 * mainmenu.ts itself has no non-DOM module state worth tracking (all
 * module refs are DOM/listener lifecycle, and shooting-star timer state
 * is explicitly out of scope per requirements §10.4), so this module
 * exposes only pure formatters/classifiers.
 */

import type { SaveSlotSummary } from '../../core/saveload.ts';

// ---------------------------------------------------------------------------
// Scalar formatters
// ---------------------------------------------------------------------------

/**
 * Formats a dollar amount with commas and a dollar sign.
 * e.g. 2000000 → "$2,000,000".  Negative values are rendered with a
 * leading hyphen; fractional values are rounded to the nearest integer.
 */
export function formatSaveMoney(amount: number): string {
  const rounded: number = Math.round(amount);
  if (rounded < 0) {
    return '-$' + Math.abs(rounded).toLocaleString('en-US');
  }
  return '$' + rounded.toLocaleString('en-US');
}

/**
 * Formats seconds as h:mm:ss.
 * e.g. 3725 → "1:02:05".  Negative values clamp to 0.
 */
export function formatSavePlayTime(totalSeconds: number): string {
  const s: number = Math.max(0, Math.floor(totalSeconds));
  const hours: number   = Math.floor(s / 3600);
  const minutes: number = Math.floor((s % 3600) / 60);
  const secs: number    = s % 60;
  const mm: string = String(minutes).padStart(2, '0');
  const ss: string = String(secs).padStart(2, '0');
  return `${hours}:${mm}:${ss}`;
}

/**
 * Formats an ISO 8601 timestamp as a localised short date + time string.
 * Falls back to the raw input if parsing throws.
 */
export function formatSaveDate(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    return d.toLocaleString('en-US', {
      year:   'numeric',
      month:  'short',
      day:    'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoTimestamp;
  }
}

// ---------------------------------------------------------------------------
// Badge classification
// ---------------------------------------------------------------------------

export interface GameModeBadge {
  /** Uppercase badge label shown in the card. */
  label: string;
  /** CSS class suffix applied to the badge (mm-mode-<suffix>). */
  cssClass: string;
}

/**
 * Classify the game-mode badge shown on a save slot card.  Unknown /
 * legacy modes fall through to the free-play badge, matching the
 * original mainmenu conditional (sandbox / tutorial / else).
 */
export function getGameModeBadge(gameMode: string): GameModeBadge {
  if (gameMode === 'sandbox')  return { label: 'SANDBOX',   cssClass: 'mm-mode-sandbox' };
  if (gameMode === 'tutorial') return { label: 'TUTORIAL',  cssClass: 'mm-mode-tutorial' };
  return { label: 'FREE PLAY', cssClass: 'mm-mode-freeplay' };
}

/**
 * True when the summary's save-format version does not match the
 * currently-running code's version; drives the "v3 (current: v4)"
 * warning badge in the save card header.
 */
export function hasSaveVersionMismatch(summary: SaveSlotSummary, currentVersion: number): boolean {
  return summary.version !== currentVersion;
}

/**
 * Whether to render the separate "agency name" sub-line below the
 * save's label.  Mirrors the original UI rule: only when the agency
 * name is set and differs from the user-chosen save name.
 */
export function shouldShowAgencyLine(summary: SaveSlotSummary): boolean {
  return Boolean(summary.agencyName) && summary.agencyName !== summary.saveName;
}

/**
 * CSS class applied to the KIA count cell — highlight red when any
 * crew have been lost, plain otherwise.  Returns an empty string when
 * no highlight is needed so callers can interpolate directly into a
 * class attribute.
 */
export function getKiaClass(summary: SaveSlotSummary): string {
  return summary.crewKIA > 0 ? 'mm-stat-kia' : '';
}

// ---------------------------------------------------------------------------
// Save list organisation
// ---------------------------------------------------------------------------

/**
 * True when at least one populated save exists, i.e. the load screen
 * should be shown by default rather than the new-game screen.
 */
export function shouldShowLoadScreen(saves: readonly (SaveSlotSummary | null)[]): boolean {
  return saves.some((s) => s !== null);
}

/**
 * A single descriptor for a row in the save-slots grid.  Manual slots
 * that are empty still render a placeholder card, while overflow slots
 * (auto-save, slots ≥ slotCount) appear only when populated.
 */
export type SaveSlotCard =
  | { kind: 'filled'; summary: SaveSlotSummary }
  | { kind: 'empty';  slotIndex: number };

/**
 * Compute the ordered list of cards shown in the save-slots grid.
 *
 * Input is the `listSaves()` result — the first `slotCount` entries
 * correspond to manual slots 0..slotCount-1 (null = empty), with
 * additional populated entries appended for overflow / auto-save.
 *
 * Output keeps the manual slots in order with empty placeholders, then
 * appends every populated overflow entry in the order `listSaves()`
 * produced them.  Empty overflow slots (impossible but defensively
 * filtered) are dropped.
 */
export function organizeSaveSlots(
  saves: readonly (SaveSlotSummary | null)[],
  slotCount: number,
): SaveSlotCard[] {
  const cards: SaveSlotCard[] = [];

  for (let i = 0; i < slotCount; i++) {
    const summary = saves[i] ?? null;
    if (summary) {
      cards.push({ kind: 'filled', summary });
    } else {
      cards.push({ kind: 'empty', slotIndex: i });
    }
  }

  for (let i = slotCount; i < saves.length; i++) {
    const summary = saves[i];
    if (summary) {
      cards.push({ kind: 'filled', summary });
    }
  }

  return cards;
}
