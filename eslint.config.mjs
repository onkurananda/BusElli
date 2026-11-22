// eslint.config.mjs — Root ESLint config (flat config, ESLint 9)
// Enforces .bobrules §1 TypeScript rules across backend and gtfs-parser.
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts'],
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./backend/tsconfig.json', './gtfs-parser/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // .bobrules §1.1 — no any
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // .bobrules §1.1 — explicit return types on exports
      '@typescript-eslint/explicit-module-boundary-types': 'error',

      // .bobrules §1.1 — non-null assertion only with justification comment
      // (enforced by code review — ESLint flags usage for review)
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // .bobrules §1.3 — node: prefix for built-ins
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['fs', 'path', 'crypto', 'os', 'util', 'stream', 'events', 'http', 'https', 'net', 'child_process'],
          message: "Use 'node:' prefix for Node.js built-ins (e.g. 'node:fs')",
        }],
      }],

      // General quality
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'eqeqeq': ['error', 'always'],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
];
