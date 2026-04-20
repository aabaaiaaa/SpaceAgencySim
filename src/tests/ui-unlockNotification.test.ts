// @vitest-environment jsdom
/**
 * ui-unlockNotification.test.ts — Regression test for the post-flight
 * "Continue" button dismissal on the unlock-notification modal.
 *
 * `showUnlockNotification` is invoked from the post-flight flow
 * (`flightController/_postFlight.ts`) while the Mission Control panel is NOT
 * open — so the MC listener tracker is `null`. A prior migration wired the
 * Continue button through the MC tracker, which silently no-ops when the
 * tracker is null, leaving the button live but unwired and players stuck on
 * the "NEW PARTS AVAILABLE" modal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Cut the import chain at topbar so we don't drag topbar.css / saveload
// dependencies into jsdom.
vi.mock('../ui/topbar.ts', () => ({
  refreshTopBarMissions: vi.fn(),
}));

import { showUnlockNotification } from '../ui/missionControl/_missionsTab.ts';
import {
  destroyMissionControlListenerTracker,
  getMissionControlListenerTracker,
} from '../ui/missionControl/_listenerTracker.ts';

describe('showUnlockNotification — Continue button', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Post-flight flow: Mission Control is closed, so its tracker is null.
    destroyMissionControlListenerTracker();
    expect(getMissionControlListenerTracker()).toBeNull();
  });

  it('@smoke dismisses the modal when Continue is clicked from the post-flight flow', () => {
    showUnlockNotification(null, []);

    const backdrop = document.getElementById('unlock-notification-backdrop');
    expect(backdrop).not.toBeNull();

    const btn = backdrop!.querySelector<HTMLButtonElement>('.confirm-btn');
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe('Continue');

    btn!.click();

    expect(document.getElementById('unlock-notification-backdrop')).toBeNull();
  });
});
