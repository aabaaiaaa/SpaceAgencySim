/**
 * loadingIndicator.ts — Full-screen loading overlay for screen transitions.
 * @module ui/loadingIndicator
 */

let overlay: HTMLDivElement | null = null;

/**
 * Show a full-screen "Loading..." overlay.
 * Idempotent — calling multiple times reuses the same element.
 */
export function showLoadingIndicator(): void {
  if (overlay && overlay.isConnected) {
    overlay.style.display = 'flex';
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'loading-indicator';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: '900',  // above overlays (400-500), below dialogs (9999+)
    pointerEvents: 'all',
  });

  const text = document.createElement('span');
  Object.assign(text.style, {
    color: '#ccc',
    fontSize: '18px',
    fontFamily: 'system-ui, sans-serif',
    letterSpacing: '2px',
  });
  text.textContent = 'Loading...';

  overlay.appendChild(text);
  document.body.appendChild(overlay);
}

/**
 * Hide the loading overlay.
 */
export function hideLoadingIndicator(): void {
  if (overlay && overlay.isConnected) {
    overlay.style.display = 'none';
  }
}
