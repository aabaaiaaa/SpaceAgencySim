/**
 * mainStartup.test.ts — Tests for the IDB-unavailable startup path in main.ts.
 *
 * Verifies that when isIdbAvailable() returns false, showFatalError is invoked
 * with an appropriate message and initSettings() is never called.
 *
 * Because main.ts triggers main() at module load time, every dependency must be
 * mocked before the dynamic import, and vi.resetModules() is used between tests
 * to get a fresh module evaluation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references — survive vi.resetModules()
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  isIdbAvailable: vi.fn(() => true),
  registerIdbErrorHandler: vi.fn(),
  initSettings: vi.fn(() => Promise.resolve()),
  initRenderer: vi.fn(() => Promise.resolve()),
  initVabRenderer: vi.fn(),
  initHubRenderer: vi.fn(),
  showMainMenu: vi.fn(),
  initUI: vi.fn(),
  returnToHubFromFlight: vi.fn(),
  buildTestRocket: vi.fn(),
  startFlightScene: vi.fn(),
  createFlightState: vi.fn(),
  setMalfunctionMode: vi.fn(),
  plantFlag: vi.fn(),
  collectSurfaceSample: vi.fn(),
  deploySurfaceInstrument: vi.fn(),
  deployBeacon: vi.fn(),
  processSurfaceOps: vi.fn(),
  processSampleReturns: vi.fn(),
  areSurfaceItemsVisible: vi.fn(),
  checkAchievements: vi.fn(),
  computeTransferDeltaV: vi.fn(),
  isLandable: vi.fn(),
  getPartById: vi.fn(),
  autoSaveImmediate: vi.fn(),
  isAutoSaveEnabled: vi.fn(),
  showFatalError: vi.fn(),
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Module mocks — all dependencies of main.ts
// ---------------------------------------------------------------------------

vi.mock('../core/idbStorage.ts', () => ({
  isIdbAvailable: mocks.isIdbAvailable,
  registerIdbErrorHandler: mocks.registerIdbErrorHandler,
}));
vi.mock('../core/settingsStore.ts', () => ({
  initSettings: mocks.initSettings,
}));
vi.mock('../core/logger.ts', () => ({
  logger: mocks.logger,
}));
vi.mock('../render/index.ts', () => ({
  initRenderer: mocks.initRenderer,
}));
vi.mock('../render/vab.ts', () => ({
  initVabRenderer: mocks.initVabRenderer,
}));
vi.mock('../render/hub.ts', () => ({
  initHubRenderer: mocks.initHubRenderer,
}));
vi.mock('../ui/index.ts', () => ({
  showMainMenu: mocks.showMainMenu,
  initUI: mocks.initUI,
  returnToHubFromFlight: mocks.returnToHubFromFlight,
}));
vi.mock('../core/testFlightBuilder.ts', () => ({
  buildTestRocket: mocks.buildTestRocket,
}));
vi.mock('../ui/flightController.ts', () => ({
  startFlightScene: mocks.startFlightScene,
}));
vi.mock('../core/gameState.ts', () => ({
  createFlightState: mocks.createFlightState,
}));
vi.mock('../core/malfunction.ts', () => ({
  setMalfunctionMode: mocks.setMalfunctionMode,
}));
vi.mock('../core/surfaceOps.ts', () => ({
  plantFlag: mocks.plantFlag,
  collectSurfaceSample: mocks.collectSurfaceSample,
  deploySurfaceInstrument: mocks.deploySurfaceInstrument,
  deployBeacon: mocks.deployBeacon,
  processSurfaceOps: mocks.processSurfaceOps,
  processSampleReturns: mocks.processSampleReturns,
  areSurfaceItemsVisible: mocks.areSurfaceItemsVisible,
}));
vi.mock('../core/achievements.ts', () => ({
  checkAchievements: mocks.checkAchievements,
}));
vi.mock('../core/manoeuvre.ts', () => ({
  computeTransferDeltaV: mocks.computeTransferDeltaV,
}));
vi.mock('../data/bodies.ts', () => ({
  CELESTIAL_BODIES: {},
  isLandable: mocks.isLandable,
}));
vi.mock('../data/parts.ts', () => ({
  getPartById: mocks.getPartById,
}));
vi.mock('../ui/autoSaveToast.ts', () => ({
  autoSaveImmediate: mocks.autoSaveImmediate,
}));
vi.mock('../core/autoSave.ts', () => ({
  isAutoSaveEnabled: mocks.isAutoSaveEnabled,
  AUTO_SAVE_KEY: 'spaceAgencySave_auto',
}));
vi.mock('../ui/fatalError.ts', () => ({
  showFatalError: mocks.showFatalError,
}));

// ---------------------------------------------------------------------------
// Minimal DOM stubs for Node.js test environment
// ---------------------------------------------------------------------------

interface StubElement {
  style: { cssText: string };
  textContent: string;
}

let appendedElements: StubElement[];
let savedDocument: typeof globalThis.document;
let savedWindow: typeof globalThis.window;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  appendedElements = [];

  // Preserve originals for cleanup
  savedDocument = globalThis.document;
  savedWindow = globalThis.window;

  const stubElement = (): StubElement => ({ style: { cssText: '' }, textContent: '' });

  globalThis.document = {
    createElement: vi.fn(() => stubElement()),
    getElementById: vi.fn(() => stubElement()),
    body: {
      appendChild: vi.fn((child: StubElement) => {
        appendedElements.push(child);
        return child;
      }),
    },
  } as unknown as Document;

  globalThis.window = globalThis.window || {} as Window & typeof globalThis;
});

afterEach(() => {
  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
});

// Helper: let async main() settle after module import
function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('main.ts startup — IDB availability check', () => {
  it('shows fatal error and does not call initSettings when IDB is unavailable @smoke', async () => {
    mocks.isIdbAvailable.mockReturnValue(false);

    // Dynamically import main.ts — this triggers the module-level main() call
    await import('../main.ts');
    await flushMicrotasks();

    // initSettings should NOT have been called since main() returned early
    expect(mocks.initSettings).not.toHaveBeenCalled();

    // showFatalError should have been called with a message mentioning IndexedDB
    expect(mocks.showFatalError).toHaveBeenCalledTimes(1);
    expect(mocks.showFatalError.mock.calls[0][0]).toContain('IndexedDB');
  });

  it('calls initSettings when IDB is available', async () => {
    mocks.isIdbAvailable.mockReturnValue(true);

    await import('../main.ts');
    await flushMicrotasks();

    // initSettings should have been called since the IDB check passed
    expect(mocks.initSettings).toHaveBeenCalledTimes(1);

    // No fatal error should have been shown
    expect(mocks.showFatalError).not.toHaveBeenCalled();
  });
});

describe('showFatalError', () => {
  it('creates a styled error overlay and appends it to document.body', async () => {
    // Import the real function from its new dedicated module (not the mock)
    // We need to unmock fatalError.ts for this specific test to test actual DOM behavior
    vi.doUnmock('../ui/fatalError.ts');
    const { showFatalError } = await import('../ui/fatalError.ts');

    // Clear any prior state
    (document.body.appendChild as ReturnType<typeof vi.fn>).mockClear();
    appendedElements = [];

    showFatalError('Test error message');

    expect(document.body.appendChild).toHaveBeenCalledTimes(1);
    const el = appendedElements[0];
    expect(el.textContent).toBe('Test error message');
    expect(el.style.cssText).toContain('position:fixed');
    expect(el.style.cssText).toContain('z-index:9999');
  });
});
