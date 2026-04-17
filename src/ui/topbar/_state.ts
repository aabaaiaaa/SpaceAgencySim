/**
 * _state.ts — Shared mutable state and pure reducers for the topbar UI.
 *
 * Captures the non-DOM module state from topbar.ts plus the pure
 * formatters extracted for unit testing.  Follows the VAB reducer
 * pattern (src/ui/vab/_state.ts).
 */

// ---------------------------------------------------------------------------
// Financial health thresholds
// ---------------------------------------------------------------------------

/**
 * Thresholds (in dollars) used to colour the topbar cash display.  Below
 * `danger` the display is red; between `danger` and `warning` it is amber;
 * above `warning` it is the regular money colour.
 */
export const MONEY_HEALTH_THRESHOLDS = {
  danger:  20_000,
  warning: 100_000,
} as const;

// ---------------------------------------------------------------------------
// Reducer state
// ---------------------------------------------------------------------------

export interface TopbarState {
  /**
   * Identifier for the currently-active screen ('hub', 'vab', 'flight',
   * 'mission-control', ...).  Used by the help panel to choose a default
   * section.
   */
  currentScreen: string;
}

const _state: TopbarState = {
  currentScreen: 'hub',
};

/**
 * Get the current topbar state object (read/write — callers may mutate directly).
 */
export function getTopbarState(): TopbarState {
  return _state;
}

/**
 * Patch the topbar state with the supplied key/value pairs.
 */
export function setTopbarState(patch: Partial<TopbarState>): void {
  Object.assign(_state, patch);
}

/**
 * Reset the topbar state to its initial values.
 */
export function resetTopbarState(): void {
  _state.currentScreen = 'hub';
}

// ---------------------------------------------------------------------------
// Pure formatters
// ---------------------------------------------------------------------------

/**
 * Format a dollar amount as `$X,XXX,XXX` (rounded, en-US grouping).
 */
export function formatCash(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

/**
 * Return a CSS colour (as a `var(...)` reference) reflecting financial
 * health.  Red below `danger`, amber below `warning`, green otherwise.
 */
export function moneyColor(funds: number): string {
  if (funds < MONEY_HEALTH_THRESHOLDS.danger)  return 'var(--color-danger-text)';
  if (funds < MONEY_HEALTH_THRESHOLDS.warning) return 'var(--color-warning)';
  return 'var(--color-money)';
}

/**
 * Format an interest-rate decimal as a percentage string (rounded to whole %).
 */
export function formatRate(r: number): string {
  return (r * 100).toFixed(0) + '%';
}

// ---------------------------------------------------------------------------
// Missions badge
// ---------------------------------------------------------------------------

export interface MissionsBadge {
  /** Button label, e.g. "Missions" or "Missions (3)". */
  label: string;
  /** True when at least one accepted mission exists. */
  hasMissions: boolean;
}

/**
 * Build the missions-button label and visibility flag from the accepted
 * mission count.
 */
export function formatMissionsBadge(count: number): MissionsBadge {
  return {
    label:       count > 0 ? `Missions (${count})` : 'Missions',
    hasMissions: count > 0,
  };
}

// ---------------------------------------------------------------------------
// Screen → help section mapping
// ---------------------------------------------------------------------------

/**
 * Screen id → default help section id.  Used when the user opens the help
 * panel via the hamburger menu; the panel opens to the section most
 * relevant to the current screen.
 */
export const SCREEN_TO_HELP_SECTION: Record<string, string> = {
  'hub':              'overview',
  'vab':              'vab',
  'flight':           'flight',
  'orbit':            'orbit',
  'mission-control':  'missions',
  'crew-admin':       'crew',
  'launch-pad':       'vab',
  'tracking-station': 'orbit',
  'satellite-ops':    'satellites',
  'library':          'facilities',
};

/**
 * Resolve the help section that should open by default when help is
 * invoked from the given screen.  Unknown screens fall back to `overview`.
 */
export function helpSectionForScreen(screenId: string): string {
  return SCREEN_TO_HELP_SECTION[screenId] ?? 'overview';
}

// ---------------------------------------------------------------------------
// Save slot compatibility
// ---------------------------------------------------------------------------

/**
 * Return true when a save's version matches the current save version.
 * Used to grey out incompatible slots in the load-game modal.
 */
export function isSaveCompatible(saveVersion: number, currentVersion: number): boolean {
  return saveVersion === currentVersion;
}

// ---------------------------------------------------------------------------
// Dropdown / modal visibility helpers
// ---------------------------------------------------------------------------

/** DOM id for the hamburger dropdown panel. */
export const DROPDOWN_ID = 'topbar-dropdown';

/** DOM id for the missions dropdown panel. */
export const MISSIONS_DROPDOWN_ID = 'topbar-missions-dropdown';

/**
 * Ids of every topbar modal backdrop.  Used by close-all and the
 * document-level Escape handler.
 */
export const MODAL_BACKDROP_IDS: readonly string[] = [
  'loan-modal-backdrop',
  'save-modal-backdrop',
  'load-modal-backdrop',
  'load-confirm-backdrop',
  'exit-confirm-backdrop',
  'sandbox-settings-backdrop',
];

/** True if the hamburger dropdown is currently mounted in the document. */
export function isDropdownOpen(doc: Document = document): boolean {
  return doc.getElementById(DROPDOWN_ID) !== null;
}

/** True if the missions dropdown is currently mounted in the document. */
export function isMissionsDropdownOpen(doc: Document = document): boolean {
  return doc.getElementById(MISSIONS_DROPDOWN_ID) !== null;
}

/** True if any topbar modal backdrop is currently mounted in the document. */
export function isAnyModalOpen(doc: Document = document): boolean {
  for (const id of MODAL_BACKDROP_IDS) {
    if (doc.getElementById(id)) return true;
  }
  return false;
}
