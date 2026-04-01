import { defineConfig } from 'vite';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Vite plugin: when a `.js` import resolves to a missing file, try `.ts`.
 * Enables incremental JS-to-TS migration without rewriting every import
 * specifier across the codebase.
 */
function jsToTsResolve() {
  return {
    name: 'js-to-ts-resolve',
    enforce: /** @type {const} */ ('pre'),
    async resolveId(source, importer, options) {
      if (!source.endsWith('.js') || !importer) return null;

      // Let Vite resolve it normally first.
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (resolved) return resolved;

      // Normal resolution failed — try swapping .js -> .ts
      const abs = resolve(dirname(importer), source);
      const tsPath = abs.replace(/\.js$/, '.ts');
      if (existsSync(tsPath)) {
        return tsPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [jsToTsResolve()],
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.mts', '.json'],
  },
  // Test configuration for Vitest (headless unit tests for core game logic)
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.{js,ts}'],
  },
});
