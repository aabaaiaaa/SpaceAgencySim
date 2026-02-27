/**
 * launchPad.js — Launch Pad Building HTML overlay UI.
 *
 * A placeholder screen for the Launch Pad building.  The full launch workflow
 * (selecting a rocket and crew, confirming the mission, and initiating flight)
 * is implemented in a later task.  This screen provides the navigation entry
 * point and the back-to-hub button so that hub navigation is fully testable
 * end-to-end.
 *
 * @module launchPad
 */

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const LAUNCH_PAD_STYLES = `
/* ── Launch Pad overlay ────────────────────────────────────────────────────── */
#launch-pad-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 20, 0.96);
  z-index: 20;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  font-family: 'Segoe UI', system-ui, sans-serif;
  color: #e8e8e8;
  /* leave room for the persistent top bar (approx 44px) */
  padding-top: 44px;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
#launch-pad-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px 0;
  flex-shrink: 0;
}

#launch-pad-back-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.85rem;
  padding: 6px 14px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
#launch-pad-back-btn:hover {
  background: rgba(255,255,255,0.16);
}

#launch-pad-title {
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #f0f0f0;
  margin: 0;
}

/* ── Content area ────────────────────────────────────────────────────────── */
#launch-pad-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  gap: 16px;
}

#launch-pad-status {
  font-size: 1.1rem;
  color: #8090a8;
  text-align: center;
}

#launch-pad-hint {
  font-size: 0.88rem;
  color: #5a6880;
  text-align: center;
  font-style: italic;
  max-width: 420px;
  line-height: 1.55;
}
`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The root overlay element. @type {HTMLElement | null} */
let _overlay = null;

/** Callback to navigate back to the hub. @type {(() => void) | null} */
let _onBack = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Launch Pad overlay.
 *
 * @param {HTMLElement} container   The #ui-overlay div.
 * @param {import('../core/gameState.js').GameState} _state
 * @param {{ onBack: () => void }} callbacks
 */
export function initLaunchPadUI(container, _state, { onBack }) {
  _onBack = onBack;

  // Inject CSS once.
  if (!document.getElementById('launch-pad-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'launch-pad-styles';
    styleEl.textContent = LAUNCH_PAD_STYLES;
    document.head.appendChild(styleEl);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'launch-pad-overlay';
  container.appendChild(_overlay);

  _renderShell();

  console.log('[Launch Pad UI] Initialized');
}

/**
 * Remove the Launch Pad overlay from the DOM.
 */
export function destroyLaunchPadUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _onBack = null;
  console.log('[Launch Pad UI] Destroyed');
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

/**
 * Build the static screen layout: header with back button + placeholder content.
 */
function _renderShell() {
  if (!_overlay) return;

  // Header
  const header = document.createElement('div');
  header.id = 'launch-pad-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'launch-pad-back-btn';
  backBtn.textContent = '← Hub';
  backBtn.addEventListener('click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroyLaunchPadUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'launch-pad-title';
  title.textContent = 'Launch Pad';
  header.appendChild(title);

  _overlay.appendChild(header);

  // Placeholder content
  const content = document.createElement('div');
  content.id = 'launch-pad-content';

  const status = document.createElement('p');
  status.id = 'launch-pad-status';
  status.textContent = 'No rockets are ready for launch.';
  content.appendChild(status);

  const hint = document.createElement('p');
  hint.id = 'launch-pad-hint';
  hint.textContent =
    'Build a rocket in the Vehicle Assembly Building and select a mission to begin the launch sequence.';
  content.appendChild(hint);

  _overlay.appendChild(content);
}
