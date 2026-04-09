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

import { DEBUG_SAVE_DEFINITIONS } from '../core/debugSaves.ts';
import type { DebugSaveDefinition } from '../core/debugSaves.ts';
import { getUnlockedMissions, reconcileParts } from '../core/missions.ts';
import { refreshTopBar } from './topbar.ts';
import { createListenerTracker } from './listenerTracker.ts';
import './debugSaves.css';
import type { GameState } from '../core/gameState.ts';


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
    Reflect.deleteProperty(liveState, key);
  }
  Object.assign(liveState, snapshot);

  // Populate available missions based on completed missions and dependency chains.
  getUnlockedMissions(liveState);
  reconcileParts(liveState);

  // Update window.__gameState for e2e test access.
  if (typeof window !== 'undefined') {
    window.__gameState = liveState;
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
