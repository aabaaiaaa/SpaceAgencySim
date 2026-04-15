/**
 * notification.ts — Shared toast notification utility with stacking queue.
 * @module ui/notification
 */

const MAX_TOASTS = 5;
const TOAST_GAP = 8;
const BASE_BOTTOM = 24;
const DISMISS_MS = 4000;
const FADE_MS = 300;

/** Active toast elements, ordered oldest-first (index 0 = oldest / topmost). */
const _activeToasts: HTMLDivElement[] = [];

/** Reposition all active toasts so they stack upward from the bottom. */
function _repositionToasts(): void {
  let bottom = BASE_BOTTOM;
  for (let i = _activeToasts.length - 1; i >= 0; i--) {
    _activeToasts[i].style.bottom = `${bottom}px`;
    bottom += _activeToasts[i].offsetHeight + TOAST_GAP;
  }
}

/** Remove a toast from the active list and the DOM, then reposition. */
function _removeToast(toast: HTMLDivElement): void {
  const idx = _activeToasts.indexOf(toast);
  if (idx !== -1) _activeToasts.splice(idx, 1);
  toast.remove();
  _repositionToasts();
}

/**
 * Show a brief toast notification that auto-dismisses after 4 seconds.
 * Multiple toasts stack vertically from the bottom of the screen.
 */
export function showNotification(message: string, type: 'error' | 'info' = 'info'): void {
  // Enforce cap — remove oldest toast(s) when at limit
  while (_activeToasts.length >= MAX_TOASTS) {
    const oldest = _activeToasts[0];
    _removeToast(oldest);
  }

  const toast = document.createElement('div');
  toast.setAttribute('data-notification-toast', '');
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: `${BASE_BOTTOM}px`,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '12px 24px',
    borderRadius: '8px',
    backgroundColor: type === 'error' ? '#cc3333' : '#333',
    color: '#fff',
    fontSize: '14px',
    fontFamily: 'system-ui, sans-serif',
    zIndex: '10000',
    opacity: '1',
    transition: 'opacity 0.3s',
    pointerEvents: 'none',
  });
  toast.textContent = message;
  document.body.appendChild(toast);

  _activeToasts.push(toast);
  _repositionToasts();

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => _removeToast(toast), FADE_MS);
  }, DISMISS_MS);
}
