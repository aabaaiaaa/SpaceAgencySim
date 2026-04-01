import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
  // Global ignores
  { ignores: ['dist/', 'node_modules/', '*.config.js'] },

  // -----------------------------------------------------------------------
  // Base: all JS files in src/ and e2e/
  // -----------------------------------------------------------------------
  {
    files: ['src/**/*.js', 'e2e/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...js.configs.recommended.rules,

      // -- Correctness rules --
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-import-assign': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',
      'no-useless-assignment': 'warn',

      // -- Formatting rules OFF --
      'no-mixed-spaces-and-tabs': 'off',
    },
  },

  // -----------------------------------------------------------------------
  // TypeScript files in src/
  // -----------------------------------------------------------------------
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        projectService: true,
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,

      // Disable base rules that TS plugin replaces
      'no-unused-vars': 'off',
      'no-undef': 'off', // TS handles this
      'no-redeclare': 'off', // TS companion type pattern (const X + type X)

      // -- TS-aware correctness rules --
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',

      // -- Correctness rules --
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-import-assign': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'warn',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
      'no-throw-literal': 'error',

      // -- Formatting rules OFF --
      'no-mixed-spaces-and-tabs': 'off',
    },
  },

  // -----------------------------------------------------------------------
  // E2E test files: add Playwright globals
  // -----------------------------------------------------------------------
  {
    files: ['e2e/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // -----------------------------------------------------------------------
  // Unit test files: add Vitest/Node globals
  // -----------------------------------------------------------------------
  {
    files: ['src/tests/**/*.test.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
