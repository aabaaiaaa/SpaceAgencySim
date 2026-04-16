import { test, expect } from '@playwright/test';
import { dismissWelcomeModal, dispatchKey, navigateToVab } from './helpers.js';

/**
 * E2E — Keyboard Navigation
 *
 * Verifies that keyboard navigation works across core panels:
 *   - Main menu: Tab cycles through interactive elements, focus ring is visible
 *   - Hub: Tab cycles through building buttons, focus ring is visible
 *   - Topbar menu: Arrow keys navigate items, Escape closes dropdown
 *   - Settings: Escape closes the panel
 */

test.describe('Keyboard Navigation', () => {

  test('Tab cycles through main menu elements and focus ring is visible', async ({ page }) => {
    await page.goto('/');

    // Fresh context → New Game screen should appear.
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 10_000,
    });

    // Agency name input should be auto-focused.
    await expect(page.locator('#mm-agency-name-input')).toBeFocused();

    // Tab forward through mode option cards.
    await dispatchKey(page, 'Tab');
    const tutorialOption = page.locator('.mm-mode-option[data-mode="tutorial"]');
    await expect(tutorialOption).toBeFocused();

    // Verify focus ring is visible via computed outline style.
    const outlineStyle: string = await tutorialOption.evaluate((el: Element): string => {
      return window.getComputedStyle(el).outlineStyle;
    });
    expect(outlineStyle).not.toBe('none');

    // Tab to next mode option.
    await dispatchKey(page, 'Tab');
    await expect(page.locator('.mm-mode-option[data-mode="freeplay"]')).toBeFocused();

    await dispatchKey(page, 'Tab');
    await expect(page.locator('.mm-mode-option[data-mode="sandbox"]')).toBeFocused();

    // Enter activates the focused mode option.
    await dispatchKey(page, 'Enter');
    await expect(page.locator('.mm-mode-option[data-mode="sandbox"]')).toHaveClass(/selected/, { timeout: 5_000 });

    // Tab through to the Start button and activate it.
    // Continue tabbing until we reach the start button.
    // After sandbox option → sandbox checkboxes → Start button.
    for (let i: number = 0; i < 10; i++) {
      await dispatchKey(page, 'Tab');
      const focused: string | undefined = await page.evaluate((): string | undefined => document.activeElement?.id);
      if (focused === 'mm-start-btn') break;
    }

    // Fill in the agency name first (required).
    await page.fill('#mm-agency-name-input', 'Keyboard Test Agency');

    // Focus the start button and press Enter.
    await page.focus('#mm-start-btn');
    await dispatchKey(page, 'Enter');

    // Should transition to hub.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);
  });

  test('Tab cycles through hub building buttons with visible focus ring', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 10_000,
    });

    // Start a sandbox game.
    await page.fill('#mm-agency-name-input', 'Keyboard Hub');
    await page.click('.mm-mode-option[data-mode="sandbox"]');
    await page.click('#mm-start-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);

    // Tab repeatedly until we land on a hub building (topbar buttons come first).
    let foundBuilding: boolean = false;
    for (let i: number = 0; i < 15; i++) {
      await dispatchKey(page, 'Tab');
      const isBuilding: boolean = await page.evaluate((): boolean =>
        document.activeElement?.classList.contains('hub-building') ?? false
      );
      if (isBuilding) {
        foundBuilding = true;
        break;
      }
    }
    expect(foundBuilding).toBe(true);

    // Verify the focused building matches :focus-visible (keyboard focus ring is active).
    const matchesFocusVisible: boolean = await page.evaluate((): boolean =>
      document.activeElement?.matches(':focus-visible') ?? false
    );
    expect(matchesFocusVisible).toBe(true);

    // Tab through multiple buildings and collect IDs.
    const buildingIds: string[] = [];
    // Record the current one first.
    const firstId: string | null = await page.evaluate((): string | null =>
      document.activeElement?.getAttribute('data-building-id') || null
    );
    if (firstId) buildingIds.push(firstId);

    for (let i: number = 0; i < 8; i++) {
      await dispatchKey(page, 'Tab');
      const id: string | null = await page.evaluate((): string | null =>
        document.activeElement?.getAttribute('data-building-id') || null
      );
      if (id && !buildingIds.includes(id)) buildingIds.push(id);
    }

    // Should have cycled through at least 2 different buildings.
    expect(buildingIds.length).toBeGreaterThanOrEqual(2);
  });

  test('Topbar menu opens with arrow key navigation and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 10_000,
    });

    await page.fill('#mm-agency-name-input', 'Keyboard Topbar');
    await page.click('.mm-mode-option[data-mode="sandbox"]');
    await page.click('#mm-start-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);

    // Click the hamburger menu button to open the dropdown.
    await page.click('#topbar-menu-btn');
    await page.waitForSelector('#topbar-dropdown', { state: 'visible', timeout: 3_000 });

    // First menu item should be focused.
    const firstItem = page.locator('#topbar-dropdown .topbar-dropdown-item').first();
    await expect(firstItem).toBeFocused();

    // Arrow down moves to next item.
    await dispatchKey(page, 'ArrowDown');
    const secondItem = page.locator('#topbar-dropdown .topbar-dropdown-item').nth(1);
    await expect(secondItem).toBeFocused();

    // Arrow up goes back.
    await dispatchKey(page, 'ArrowUp');
    await expect(firstItem).toBeFocused();

    // Escape closes the dropdown.
    await dispatchKey(page, 'Escape');
    await expect(page.locator('#topbar-dropdown')).not.toBeVisible({ timeout: 5_000 });

    // Focus should return to the menu button.
    await expect(page.locator('#topbar-menu-btn')).toBeFocused();
  });

  test('Settings panel closes with Escape key', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 10_000,
    });

    await page.fill('#mm-agency-name-input', 'Keyboard Settings');
    await page.click('.mm-mode-option[data-mode="sandbox"]');
    await page.click('#mm-start-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);

    // Open settings via hamburger menu.
    await page.click('#topbar-menu-btn');
    await page.waitForSelector('#topbar-dropdown', { state: 'visible', timeout: 3_000 });
    await page.click('#hub-settings-btn');
    await page.waitForSelector('#settings-panel', { state: 'visible', timeout: 3_000 });

    // Tab through settings options — they should be focusable buttons.
    // Tab repeatedly until we land on a settings option button.
    let foundSettingsBtn: boolean = false;
    for (let i: number = 0; i < 20; i++) {
      await dispatchKey(page, 'Tab');
      const isSettingsBtn: boolean = await page.evaluate((): boolean =>
        document.activeElement?.classList.contains('settings-option-btn') ?? false
      );
      if (isSettingsBtn) {
        foundSettingsBtn = true;
        break;
      }
    }
    expect(foundSettingsBtn).toBe(true);

    // Verify focus ring is visible on the focused settings button.
    const outlineStyle: string = await page.evaluate((): string => {
      const el: Element | null = document.activeElement;
      if (!el) return 'none';
      return window.getComputedStyle(el).outlineStyle;
    });
    expect(outlineStyle).not.toBe('none');

    // Escape closes the settings panel.
    await dispatchKey(page, 'Escape');
    await expect(page.locator('#settings-panel')).not.toBeVisible({ timeout: 5_000 });
  });

  test('Tab cycles through VAB toolbar buttons and part cards', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 10_000,
    });

    // Start a sandbox game then navigate to VAB.
    await page.fill('#mm-agency-name-input', 'Keyboard VAB');
    await page.click('.mm-mode-option[data-mode="sandbox"]');
    await page.click('#mm-start-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);
    await navigateToVab(page);

    // Tab through toolbar buttons — collect focused element IDs.
    const focusedIds: string[] = [];
    for (let i: number = 0; i < 20; i++) {
      await dispatchKey(page, 'Tab');
      const id: string | null = await page.evaluate((): string | null => document.activeElement?.id || null);
      if (id && !focusedIds.includes(id)) focusedIds.push(id);
    }

    // Should have cycled through at least the back button and a few toolbar buttons.
    expect(focusedIds.length).toBeGreaterThanOrEqual(3);

    // At least one toolbar button should be among the focused elements.
    const hasToolbarBtn: boolean = focusedIds.some((id: string): boolean =>
      id.startsWith('vab-btn-') || id.startsWith('vab-back')
    );
    expect(hasToolbarBtn).toBe(true);

    // Tab into the parts panel — part cards should be focusable.
    let foundPartCard: boolean = false;
    for (let i: number = 0; i < 30; i++) {
      await dispatchKey(page, 'Tab');
      const isPartCard: boolean = await page.evaluate((): boolean =>
        document.activeElement?.classList.contains('vab-part-card') ?? false
      );
      if (isPartCard) {
        foundPartCard = true;
        break;
      }
    }
    expect(foundPartCard).toBe(true);

    // Verify the part card has :focus-visible.
    const matchesFocusVisible: boolean = await page.evaluate((): boolean =>
      document.activeElement?.matches(':focus-visible') ?? false
    );
    expect(matchesFocusVisible).toBe(true);
  });

  test('Tab cycles through Mission Control tabs and items', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 10_000,
    });

    // Start a sandbox game.
    await page.fill('#mm-agency-name-input', 'Keyboard MC');
    await page.click('.mm-mode-option[data-mode="sandbox"]');
    await page.click('#mm-start-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);

    // Navigate to Mission Control.
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', {
      state: 'visible',
      timeout: 10_000,
    });

    // Tab through — should reach a tab button.
    let foundMcTab: boolean = false;
    for (let i: number = 0; i < 20; i++) {
      await dispatchKey(page, 'Tab');
      const isMcTab: boolean = await page.evaluate((): boolean =>
        document.activeElement?.classList.contains('mc-tab') ?? false
      );
      if (isMcTab) {
        foundMcTab = true;
        break;
      }
    }
    expect(foundMcTab).toBe(true);

    // Verify focus ring is active on the tab.
    const matchesFocusVisible: boolean = await page.evaluate((): boolean =>
      document.activeElement?.matches(':focus-visible') ?? false
    );
    expect(matchesFocusVisible).toBe(true);

    // Tab further and collect more focused mc-tab buttons.
    const tabLabels: string[] = [];
    const firstLabel: string | null = await page.evaluate((): string | null => document.activeElement?.textContent || null);
    if (firstLabel) tabLabels.push(firstLabel);

    for (let i: number = 0; i < 10; i++) {
      await dispatchKey(page, 'Tab');
      const isMcTab: boolean = await page.evaluate((): boolean =>
        document.activeElement?.classList.contains('mc-tab') ?? false
      );
      if (isMcTab) {
        const label: string | null = await page.evaluate((): string | null => document.activeElement?.textContent || null);
        if (label && !tabLabels.includes(label)) tabLabels.push(label);
      }
    }

    // Should have focused at least 2 different tabs.
    expect(tabLabels.length).toBeGreaterThanOrEqual(2);

    // Escape closes Mission Control and returns to hub.
    await dispatchKey(page, 'Escape');
    await expect(page.locator('#mission-control-overlay')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });
  });
});
