// @ts-nocheck
// Smoke test — verifies that the Vitest test infrastructure is working.
// All core-logic unit tests live alongside this file in src/tests/.

import { describe, it, expect } from 'vitest';
import * as core from '../core/index.ts';

describe('project setup', () => {
  it('test runner is operational', () => {
    expect(1 + 1).toBe(2);
  });

  it('ES modules resolve correctly', () => {
    // Static import of core barrel — confirms the module graph is intact.
    expect(core).toBeDefined();
  });
});
