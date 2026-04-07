// @ts-nocheck
/**
 * ui-rocketCardUtil.test.ts — Unit tests for rocket card utility functions.
 *
 * Tests the _fmt helper (via buildRocketCard), PART_FILL/PART_STROKE constants,
 * and renderRocketPreview scaling logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../ui/rocketCardUtil.css', () => ({}));

vi.mock('../data/parts.ts', () => ({
  getPartById: vi.fn((id) => {
    const catalog = {
      'engine-1': { name: 'Merlin', width: 40, height: 30, type: 'ENGINE' },
      'tank-1': { name: 'Fuel Tank', width: 40, height: 60, type: 'FUEL_TANK' },
      'cmd-1': { name: 'Command Pod', width: 30, height: 20, type: 'COMMAND_MODULE' },
    };
    return catalog[id] || null;
  }),
}));

// Mock document for buildRocketCard
const _mockElements = [];
vi.stubGlobal('document', {
  createElement: vi.fn((tag) => {
    // Create a single context per element so getContext('2d') returns
    // the same instance every time (matching real canvas behavior).
    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    };
    const el = {
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
      appendChild: vi.fn(function(child) { this.children.push(child); return child; }),
      addEventListener: vi.fn(),
      getContext: vi.fn(() => ctx),
    };
    _mockElements.push(el);
    return el;
  }),
});

import {
  renderRocketPreview,
  buildRocketCard,
} from '../ui/rocketCardUtil.ts';

describe('rocketCardUtil', () => {
  beforeEach(() => {
    _mockElements.length = 0;
    vi.clearAllMocks();
  });

  describe('renderRocketPreview()', () => {
    it('sets canvas dimensions to 80x120', () => {
      const canvas = document.createElement('canvas');
      const design = {
        parts: [
          { partId: 'engine-1', position: { x: 0, y: 0 } },
        ],
      };

      renderRocketPreview(canvas, design);

      expect(canvas.width).toBe(80);
      expect(canvas.height).toBe(120);
    });

    it('sets the preview CSS class on the canvas', () => {
      const canvas = document.createElement('canvas');
      const design = {
        parts: [{ partId: 'cmd-1', position: { x: 0, y: 0 } }],
      };

      renderRocketPreview(canvas, design);
      expect(canvas.className).toBe('rocket-card-preview');
    });

    it('calls fillRect and strokeRect for each resolved part', () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const design = {
        parts: [
          { partId: 'engine-1', position: { x: 0, y: 0 } },
          { partId: 'tank-1', position: { x: 0, y: 50 } },
        ],
      };

      renderRocketPreview(canvas, design);

      expect(ctx.fillRect).toHaveBeenCalledTimes(2);
      expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    });

    it('handles empty parts array gracefully', () => {
      const canvas = document.createElement('canvas');
      const design = { parts: [] };

      expect(() => renderRocketPreview(canvas, design)).not.toThrow();
    });

    it('handles null parts gracefully', () => {
      const canvas = document.createElement('canvas');
      const design = { parts: null };

      expect(() => renderRocketPreview(canvas, design)).not.toThrow();
    });

    it('skips parts not found in catalog', () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const design = {
        parts: [
          { partId: 'nonexistent', position: { x: 0, y: 0 } },
          { partId: 'engine-1', position: { x: 0, y: 0 } },
        ],
      };

      renderRocketPreview(canvas, design);
      // Only one part resolved
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildRocketCard()', () => {
    it('creates a card element with correct class', () => {
      const design = {
        id: 'r1',
        name: 'Test Rocket',
        parts: [],
        totalMass: 5000,
        totalThrust: 200,
      };

      const card = buildRocketCard(design, []);
      expect(card.className).toBe('rocket-card');
      expect(card.dataset.rocketId).toBe('r1');
    });

    it('includes the rocket name', () => {
      const design = {
        id: 'r1',
        name: 'Super Heavy',
        parts: [],
        totalMass: 100000,
        totalThrust: 5000,
      };

      const card = buildRocketCard(design, []);
      // Find the name element in the card's children
      const infoCol = card.children.find(c => c.className === 'rocket-card-info');
      expect(infoCol).toBeDefined();
      const nameEl = infoCol.children.find(c => c.className === 'rocket-card-name');
      expect(nameEl.textContent).toBe('Super Heavy');
    });

    it('uses "Unnamed Rocket" when name is empty', () => {
      const design = {
        id: 'r1',
        name: '',
        parts: [],
        totalMass: 0,
        totalThrust: 0,
      };

      const card = buildRocketCard(design, []);
      const infoCol = card.children.find(c => c.className === 'rocket-card-info');
      const nameEl = infoCol.children.find(c => c.className === 'rocket-card-name');
      expect(nameEl.textContent).toBe('Unnamed Rocket');
    });

    it('renders action buttons', () => {
      const onClick = vi.fn();
      const design = {
        id: 'r1',
        name: 'Test',
        parts: [],
        totalMass: 0,
        totalThrust: 0,
      };

      const card = buildRocketCard(design, [
        { label: 'Launch', className: 'btn-launch', onClick },
        { label: 'Delete', onClick: vi.fn() },
      ]);

      const actionsEl = card.children.find(c => c.className === 'rocket-card-actions');
      expect(actionsEl).toBeDefined();
      expect(actionsEl.children.length).toBe(2);
      expect(actionsEl.children[0].textContent).toBe('Launch');
      expect(actionsEl.children[0].className).toBe('btn-launch');
      expect(actionsEl.children[1].textContent).toBe('Delete');
    });

    it('does not render actions section when no actions provided', () => {
      const design = { id: 'r1', name: 'Test', parts: [], totalMass: 0, totalThrust: 0 };
      const card = buildRocketCard(design, []);
      const actionsEl = card.children.find(c => c.className === 'rocket-card-actions');
      expect(actionsEl).toBeUndefined();
    });

    it('includes stats with formatted numbers', () => {
      const design = {
        id: 'r1',
        name: 'Big Rocket',
        parts: [{ partId: 'engine-1', position: { x: 0, y: 0 } }],
        totalMass: 12500,
        totalThrust: 3400,
      };

      const card = buildRocketCard(design, []);
      const infoCol = card.children.find(c => c.className === 'rocket-card-info');
      const statsEl = infoCol.children.find(c => c.className === 'rocket-card-stats');
      // Stats innerHTML contains formatted mass and thrust
      expect(statsEl.innerHTML).toContain('Parts: 1');
      expect(statsEl.innerHTML).toContain('12,500');
      expect(statsEl.innerHTML).toContain('3,400');
    });
  });
});
