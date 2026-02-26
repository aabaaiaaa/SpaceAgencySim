// Smoke test — verifies that the Vitest test infrastructure is working.
// All core-logic unit tests live alongside this file in src/tests/.

import { describe, it, expect } from 'vitest';

describe('project setup', () => {
  it('test runner is operational', () => {
    expect(1 + 1).toBe(2);
  });

  it('ES modules resolve correctly', async () => {
    // Dynamic import of a core module — confirms the module graph is intact.
    const mod = await import('../core/index.js');
    expect(mod).toBeDefined();
  });
});
