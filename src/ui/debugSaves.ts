/**
 * debugSaves.ts — Debug Save Menu UI panel.
 *
 * Provides a full-screen overlay (separate from normal save slots) listing
 * pre-built game states at various progression points.  Clicking a state
 * loads it directly into the running game, replacing the current game state.
 *
 * Access: hub "Debug Saves" button (only visible in dev builds or when
 * explicitly enabled).
 *
 * @module ui/debugSaves
 */

import { DEBUG_SAVE_DEFINITIONS } from '../core/debugSaves.js';
import type { DebugSaveDefinition } from '../core/debugSaves.js';
import { getUnlockedMissions, reconcileParts } from '../core/missions.js';
import { refreshTopBar } from './topbar.js';
import { createListenerTracker } from './listenerTracker.js';
import { injectStyleOnce } from './injectStyle.js';
import type { GameState } from '../core/gameState.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const DEBUG_SAVE_STYLES: string = `
/* ── Debug save panel overlay ────────────────────────────────────────────── */
#debug-save-panel {
  position: fixed;
  inset: 0;
  background: var(--color-overlay-bg);
  z-index: var(--z-overlay);
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: var(--font-family);
  color: var(--color-text-light);
  pointer-events: auto;
  overflow: hidden;
}

.debug-save-content {
  width: 100%;
  max-width: 680px;
  padding: 36px 24px 44px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
}

#debug-save-panel h1 {
  font-size: var(--font-size-h1);
  font-weight: 700;
  margin: 0 0 6px;
  letter-spacing: 0.04em;
  color: #ffb060;
}

.debug-save-subtitle {
  font-size: 0.82rem;
  color: #907050;
  margin: 0 0 28px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.debug-save-warning {
  font-size: var(--font-size-small);
  color: #ff8060;
  margin: 0 0 20px;
  padding: var(--space-sm) 14px;
  background: rgba(255, 80, 40, 0.1);
  border: 1px solid rgba(255, 80, 40, 0.25);
  border-radius: var(--radius-md);
  text-align: center;
  width: 100%;
}

/* ── Category group ─────────────────────────────────────────────────────── */
.debug-save-category {
  width: 100%;
  margin-bottom: 24px;
}

.debug-save-category h2 {
  font-size: 0.78rem;
  font-weight: 700;
  color: #5880a0;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ── Save card ──────────────────────────────────────────────────────────── */
.debug-save-card {
  width: 100%;
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 14px 16px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  display: flex;
  align-items: center;
  gap: 14px;
}

.debug-save-card:hover {
  background: rgba(255, 176, 96, 0.08);
  border-color: rgba(255, 176, 96, 0.3);
}

.debug-save-card-info {
  flex: 1;
  min-width: 0;
}

.debug-save-card-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: #e0d0c0;
  margin: 0 0 4px;
}

.debug-save-card-desc {
  font-size: 0.78rem;
  color: #7090a0;
  margin: 0;
  line-height: 1.4;
}

.debug-save-card-load {
  padding: var(--btn-padding-lg);
  background: #3a2810;
  border: 1px solid #906830;
  border-radius: var(--radius-sm);
  color: #ffb060;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
  flex-shrink: 0;
}

.debug-save-card-load:hover {
  background: #5a3818;
}

/* ── Feedback banner ────────────────────────────────────────────────────── */
.debug-save-loaded {
  font-size: 0.85rem;
  color: #60ff90;
  margin: 0 0 16px;
  padding: 8px 14px;
  background: rgba(60, 255, 120, 0.08);
  border: 1px solid rgba(60, 255, 120, 0.2);
  border-radius: 6px;
  text-align: center;
  width: 100%;
}

/* ── Close button ───────────────────────────────────────────────────────── */
.debug-save-close-btn {
  margin-top: 20px;
  padding: 10px 32px;
  background: #1a3050;
  border: 1px solid #4080b0;
  border-radius: 6px;
  color: #c8e8ff;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.debug-save-close-btn:hover {
  background: #235a90;
}
`;

// ---------------------------------------------------------------------------
// Augment HTMLElement to support the _timer property used for feedback
// ---------------------------------------------------------------------------

interface FeedbackElement extends HTMLElement {
  _timer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Opens the debug save menu panel.
 *
 * @param container  The #ui-overlay div.
 * @param state      Current live game state (will be mutated on load).
 */
export function openDebugSavePanel(container: HTMLElement, state: GameState): void {
  // Prevent duplicate.
  if (document.getElementById('debug-save-panel')) return;

  // Inject styles once.
  injectStyleOnce('debug-save-styles', DEBUG_SAVE_STYLES);

  const tracker = createListenerTracker();

  /** Remove all tracked listeners, then remove the panel from the DOM. */
  function closePanel(): void {
    tracker.removeAll();
    panel.remove();
  }

  const panel = document.createElement('div');
  panel.id = 'debug-save-panel';

  const content = document.createElement('div');
  content.className = 'debug-save-content';
  panel.appendChild(content);

  // ── Heading ──────────────────────────────────────────────────────────────
  const heading = document.createElement('h1');
  heading.textContent = 'Debug Saves';
  content.appendChild(heading);

  const subtitle = document.createElement('p');
  subtitle.className = 'debug-save-subtitle';
  subtitle.textContent = 'Load a pre-built game state for testing';
  content.appendChild(subtitle);

  const warning = document.createElement('p');
  warning.className = 'debug-save-warning';
  warning.textContent = 'Loading a debug state replaces ALL current game data. Unsaved progress will be lost.';
  content.appendChild(warning);

  // ── Feedback banner (hidden initially) ───────────────────────────────────
  const feedback = document.createElement('p') as FeedbackElement;
  feedback.className = 'debug-save-loaded';
  feedback.style.display = 'none';
  content.appendChild(feedback);

  // ── Group definitions by category ────────────────────────────────────────
  const categories = new Map<string, DebugSaveDefinition[]>();
  for (const def of DEBUG_SAVE_DEFINITIONS) {
    if (!categories.has(def.category)) {
      categories.set(def.category, []);
    }
    categories.get(def.category)!.push(def);
  }

  for (const [category, defs] of categories) {
    const group = document.createElement('div');
    group.className = 'debug-save-category';

    const catHeading = document.createElement('h2');
    catHeading.textContent = category;
    group.appendChild(catHeading);

    for (const def of defs) {
      const card = document.createElement('div');
      card.className = 'debug-save-card';
      card.setAttribute('data-debug-save-id', def.id);

      const info = document.createElement('div');
      info.className = 'debug-save-card-info';

      const name = document.createElement('p');
      name.className = 'debug-save-card-name';
      name.textContent = def.name;
      info.appendChild(name);

      const desc = document.createElement('p');
      desc.className = 'debug-save-card-desc';
      desc.textContent = def.description;
      info.appendChild(desc);

      card.appendChild(info);

      const loadBtn = document.createElement('button');
      loadBtn.className = 'debug-save-card-load';
      loadBtn.textContent = 'Load';
      loadBtn.setAttribute('aria-label', `Load debug save: ${def.name}`);

      tracker.add(loadBtn, 'click', (e: Event) => {
        (e as MouseEvent).stopPropagation();
        _loadDebugState(state, def, feedback);
      });

      tracker.add(card, 'click', () => {
        _loadDebugState(state, def, feedback);
      });

      card.appendChild(loadBtn);
      group.appendChild(card);
    }

    content.appendChild(group);
  }

  // ── Close button ─────────────────────────────────────────────────────────
  const closeBtn = document.createElement('button');
  closeBtn.className = 'debug-save-close-btn';
  closeBtn.textContent = 'Close';
  closeBtn.setAttribute('aria-label', 'Close debug save menu');
  tracker.add(closeBtn, 'click', () => closePanel());
  content.appendChild(closeBtn);

  container.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Private — load a debug state
// ---------------------------------------------------------------------------

/**
 * Generates a debug state and copies all properties onto the live state object.
 */
function _loadDebugState(liveState: GameState, def: DebugSaveDefinition, feedbackEl: FeedbackElement): void {
  const snapshot = def.generate();

  // Wipe all existing keys on the live state, then copy snapshot keys in.
  // This preserves the same object reference that the rest of the app holds.
  for (const key of Object.keys(liveState)) {
    delete (liveState as unknown as Record<string, unknown>)[key];
  }
  Object.assign(liveState, snapshot);

  // Populate available missions based on completed missions and dependency chains.
  getUnlockedMissions(liveState);
  reconcileParts(liveState);

  // Update window.__gameState for e2e test access.
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__gameState = liveState;
  }

  // Refresh the top bar to show new money/agency name.
  refreshTopBar();

  // Show confirmation.
  feedbackEl.textContent = `Loaded: ${def.name}`;
  feedbackEl.style.display = 'block';

  // Auto-hide after 3 seconds.
  clearTimeout(feedbackEl._timer);
  feedbackEl._timer = setTimeout(() => {
    feedbackEl.style.display = 'none';
  }, 3000);

}
