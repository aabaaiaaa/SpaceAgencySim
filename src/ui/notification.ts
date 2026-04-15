/**
 * notification.ts — Shared toast notification utility.
 * @module ui/notification
 */

/**
 * Show a brief toast notification that auto-dismisses after 4 seconds.
 */
export function showNotification(message: string, type: 'error' | 'info' = 'info'): void {
  document.querySelector('[data-notification-toast]')?.remove();
  const toast = document.createElement('div');
  toast.setAttribute('data-notification-toast', '');
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '24px',
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

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
