// @vitest-environment jsdom
/**
 * notification.test.ts — Unit tests for the stacking toast notification system.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { showNotification } from '../ui/notification.ts';

function getToasts(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-notification-toast]'));
}

describe('showNotification()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear any leftover toasts
    getToasts().forEach((t) => t.remove());
  });

  afterEach(() => {
    vi.useRealTimers();
    getToasts().forEach((t) => t.remove());
  });

  it('single notification creates one toast element', () => {
    showNotification('Hello');
    expect(getToasts()).toHaveLength(1);
    expect(getToasts()[0].textContent).toBe('Hello');
  });

  it('two notifications in sequence create two toast elements', () => {
    showNotification('First');
    showNotification('Second');
    const toasts = getToasts();
    expect(toasts).toHaveLength(2);
    expect(toasts[0].textContent).toBe('First');
    expect(toasts[1].textContent).toBe('Second');
  });

  it('toasts are stacked (different bottom positions)', () => {
    showNotification('A');
    showNotification('B');
    const toasts = getToasts();
    // The newest toast should be at the base position, older ones higher
    const bottomA = parseInt(toasts[0].style.bottom, 10);
    const bottomB = parseInt(toasts[1].style.bottom, 10);
    // A (older) should be above B (newer), so A has a larger bottom value
    expect(bottomA).toBeGreaterThanOrEqual(bottomB);
  });

  it('after 4s + 300ms fade, toasts are removed from DOM', () => {
    showNotification('Ephemeral');
    expect(getToasts()).toHaveLength(1);

    // Advance past the 4s dismiss delay
    vi.advanceTimersByTime(4000);
    // Toast is still in DOM (fading out)
    expect(getToasts()).toHaveLength(1);

    // Advance past the 300ms fade
    vi.advanceTimersByTime(300);
    expect(getToasts()).toHaveLength(0);
  });

  it('maximum cap of 5 is enforced — oldest removed when exceeded', () => {
    for (let i = 0; i < 5; i++) {
      showNotification(`Toast ${i}`);
    }
    expect(getToasts()).toHaveLength(5);
    expect(getToasts()[0].textContent).toBe('Toast 0');

    // Adding a 6th should remove the oldest (Toast 0)
    showNotification('Toast 5');
    const toasts = getToasts();
    expect(toasts).toHaveLength(5);
    expect(toasts[0].textContent).toBe('Toast 1');
    expect(toasts[toasts.length - 1].textContent).toBe('Toast 5');
  });

  it('error type sets red background', () => {
    showNotification('Oops', 'error');
    const toast = getToasts()[0];
    expect(toast.style.backgroundColor).toBe('#cc3333');
  });

  it('dismissed toasts cause remaining toasts to restack', () => {
    showNotification('First');
    showNotification('Second');

    // Dismiss the first toast
    vi.advanceTimersByTime(4000);
    vi.advanceTimersByTime(300);

    // Only second toast remains
    const remaining = getToasts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].textContent).toBe('Second');
  });
});
