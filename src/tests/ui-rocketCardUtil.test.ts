/**
 * ui-rocketCardUtil.test.ts — Unit tests for rocket card utility functions.
 *
 * Tests the _fmt helper (via buildRocketCard), PART_FILL/PART_STROKE constants,
 * and renderRocketPreview scaling logic.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { RocketDesign } from '../core/gameState.ts';
import type { PartDef } from '../data/parts.ts';
import type { RocketCardAction } from '../ui/rocketCardUtil.ts';

// ---------------------------------------------------------------------------
// Mock DOM interfaces
// ---------------------------------------------------------------------------

/** Minimal canvas 2D context mock. */
interface MockCtx {
  clearRect: Mock;
  fillRect: Mock;
  strokeRect: Mock;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

/** Minimal DOM element mock used throughout the test suite. */
interface MockElement {
  tag: string;
  id: string;
  type: string;
  style: Record<string, string>;
  textContent: string;
  className: string;
  innerHTML: string;
  dataset: Record<string, string>;
  width: number;
  height: number;
  children: MockElement[];
  appendChild: Mock;
  addEventListener: Mock;
  getContext: Mock;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../ui/rocketCardUtil.css', () => ({}));

/** Partial part catalog used by the getPartById mock. */
const mockPartCatalog: Record<string, Pick<PartDef, 'name' | 'width' | 'height' | 'type'>> = {
  'engine-1': { name: 'Merlin', width: 40, height: 30, type: 'ENGINE' },
  'tank-1': { name: 'Fuel Tank', width: 40, height: 60, type: 'FUEL_TANK' },
  'cmd-1': { name: 'Command Pod', width: 30, height: 20, type: 'COMMAND_MODULE' },
};

vi.mock('../data/parts.ts', () => ({
  getPartById: vi.fn((id: string) => {
    return mockPartCatalog[id] ?? null;
  }),
}));

// Mock document for buildRocketCard
const _mockElements: MockElement[] = [];
vi.stubGlobal('document', {
  createElement: vi.fn((tag: string): MockElement => {
    // Create a single context per element so getContext('2d') returns
    // the same instance every time (matching real canvas behavior).
    const ctx: MockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    };
    const el: MockElement = {
      tag,
      id: '',
      type: '',
      style: {},
      textContent: '',
      className: '',
      innerHTML: '',
      dataset: {},
      width: 0,
      height: 0,
      children: [],
      appendChild: vi.fn(function (this: MockElement, child: MockElement): MockElement {
        this.children.push(child);
        return child;
      }),
      addEventListener: vi.fn(),
      getContext: vi.fn((): MockCtx => ctx),
    };
    _mockElements.push(el);
    return el;
  }),
});

import {
  renderRocketPreview,
  buildRocketCard,
} from '../ui/rocketCardUtil.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal RocketDesign with required fields filled in. */
function makeDesign(overrides: Partial<RocketDesign>): RocketDesign {
  return {
    id: 'r0',
    name: 'Test',
    parts: [],
    staging: { stages: [], unstaged: [] },
    totalMass: 0,
    totalThrust: 0,
    createdDate: '',
    updatedDate: '',
    ...overrides,
  } as RocketDesign;
}

/** Helper: create a mock canvas element (avoids cast at each call site). */
function createCanvas(): MockElement {
  // @ts-expect-error — document.createElement is stubbed to return MockElement, not real HTMLCanvasElement
  return document.createElement('canvas');
}

/** Helper: call renderRocketPreview with a MockElement canvas (centralises the type bridge). */
function renderPreview(canvas: MockElement, design: RocketDesign): void {
  // @ts-expect-error — MockElement intentionally lacks full HTMLCanvasElement interface
  renderRocketPreview(canvas, design);
}

/** Helper: call buildRocketCard and return a MockElement (centralises the return-type bridge). */
function buildCard(design: RocketDesign, actions: RocketCardAction[]): MockElement {
  // @ts-expect-error — buildRocketCard returns HTMLElement but test uses MockElement stub
  return buildRocketCard(design, actions);
}

describe('rocketCardUtil', () => {
  beforeEach((): void => {
    _mockElements.length = 0;
    vi.clearAllMocks();
  });

  describe('renderRocketPreview()', () => {
    it('sets canvas dimensions to 80x120', (): void => {
      const canvas = createCanvas();
      const design = makeDesign({
        parts: [
          { partId: 'engine-1', position: { x: 0, y: 0 } },
        ],
      });

      renderPreview(canvas, design);

      expect(canvas.width).toBe(80);
      expect(canvas.height).toBe(120);
    });

    it('sets the preview CSS class on the canvas', (): void => {
      const canvas = createCanvas();
      const design = makeDesign({
        parts: [{ partId: 'cmd-1', position: { x: 0, y: 0 } }],
      });

      renderPreview(canvas, design);
      expect(canvas.className).toBe('rocket-card-preview');
    });

    it('calls fillRect and strokeRect for each resolved part', (): void => {
      const canvas = createCanvas();
      const ctx = canvas.getContext('2d') as MockCtx;
      const design = makeDesign({
        parts: [
          { partId: 'engine-1', position: { x: 0, y: 0 } },
          { partId: 'tank-1', position: { x: 0, y: 50 } },
        ],
      });

      renderPreview(canvas, design);

      expect(ctx.fillRect).toHaveBeenCalledTimes(2);
      expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    });

    it('handles empty parts array gracefully', (): void => {
      const canvas = createCanvas();
      const design = makeDesign({ parts: [] });

      expect(() => renderPreview(canvas, design)).not.toThrow();
    });

    it('handles null parts gracefully', (): void => {
      const canvas = createCanvas();
      // @ts-expect-error — intentionally passing null to test defensive handling
      const design = makeDesign({ parts: null });

      expect(() => renderPreview(canvas, design)).not.toThrow();
    });

    it('skips parts not found in catalog', (): void => {
      const canvas = createCanvas();
      const ctx = canvas.getContext('2d') as MockCtx;
      const design = makeDesign({
        parts: [
          { partId: 'nonexistent', position: { x: 0, y: 0 } },
          { partId: 'engine-1', position: { x: 0, y: 0 } },
        ],
      });

      renderPreview(canvas, design);
      // Only one part resolved
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildRocketCard()', () => {
    it('creates a card element with correct class', (): void => {
      const design = makeDesign({
        id: 'r1',
        name: 'Test Rocket',
        parts: [],
        totalMass: 5000,
        totalThrust: 200,
      });

      const card = buildCard(design, []);
      expect(card.className).toBe('rocket-card');
      expect(card.dataset.rocketId).toBe('r1');
    });

    it('includes the rocket name', (): void => {
      const design = makeDesign({
        id: 'r1',
        name: 'Super Heavy',
        parts: [],
        totalMass: 100000,
        totalThrust: 5000,
      });

      const card = buildCard(design, []);
      // Find the name element in the card's children
      const infoCol = card.children.find((c: MockElement) => c.className === 'rocket-card-info');
      expect(infoCol).toBeDefined();
      const nameEl = infoCol!.children.find((c: MockElement) => c.className === 'rocket-card-name');
      expect(nameEl!.textContent).toBe('Super Heavy');
    });

    it('uses "Unnamed Rocket" when name is empty', (): void => {
      const design = makeDesign({
        id: 'r1',
        name: '',
        parts: [],
        totalMass: 0,
        totalThrust: 0,
      });

      const card = buildCard(design, []);
      const infoCol = card.children.find((c: MockElement) => c.className === 'rocket-card-info');
      const nameEl = infoCol!.children.find((c: MockElement) => c.className === 'rocket-card-name');
      expect(nameEl!.textContent).toBe('Unnamed Rocket');
    });

    it('renders action buttons', (): void => {
      const onClick = vi.fn();
      const design = makeDesign({
        id: 'r1',
        name: 'Test',
        parts: [],
        totalMass: 0,
        totalThrust: 0,
      });

      const actions: RocketCardAction[] = [
        { label: 'Launch', className: 'btn-launch', onClick },
        { label: 'Delete', onClick: vi.fn() },
      ];

      const card = buildCard(design, actions);

      const actionsEl = card.children.find((c: MockElement) => c.className === 'rocket-card-actions');
      expect(actionsEl).toBeDefined();
      expect(actionsEl!.children.length).toBe(2);
      expect(actionsEl!.children[0].textContent).toBe('Launch');
      expect(actionsEl!.children[0].className).toBe('btn-launch');
      expect(actionsEl!.children[1].textContent).toBe('Delete');
    });

    it('does not render actions section when no actions provided', (): void => {
      const design = makeDesign({ id: 'r1', name: 'Test', parts: [], totalMass: 0, totalThrust: 0 });
      const card = buildCard(design, []);
      const actionsEl = card.children.find((c: MockElement) => c.className === 'rocket-card-actions');
      expect(actionsEl).toBeUndefined();
    });

    it('includes stats with formatted numbers', (): void => {
      const design = makeDesign({
        id: 'r1',
        name: 'Big Rocket',
        parts: [{ partId: 'engine-1', position: { x: 0, y: 0 } }],
        totalMass: 12500,
        totalThrust: 3400,
      });

      const card = buildCard(design, []);
      const infoCol = card.children.find((c: MockElement) => c.className === 'rocket-card-info');
      const statsEl = infoCol!.children.find((c: MockElement) => c.className === 'rocket-card-stats');
      // Stats innerHTML contains formatted mass and thrust
      expect(statsEl!.innerHTML).toContain('Parts: 1');
      expect(statsEl!.innerHTML).toContain('12,500');
      expect(statsEl!.innerHTML).toContain('3,400');
    });
  });
});
