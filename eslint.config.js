import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/.tsbuild/**',
      '.squad/**',
      // Prisma's generated client. It already ships `@ts-nocheck` and
      // `/* eslint-disable */`, so this is belt-and-braces — but it also keeps
      // the type-aware rules from walking thousands of generated lines.
      '**/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // vite.config.ts sits outside frontend/tsconfig.json's rootDir, so no
          // workspace project owns it. Lint it against the inferred default
          // project rather than bending the build config around one file.
          allowDefaultProject: ['frontend/vite.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          project: [
            './packages/shared/tsconfig.json',
            './backend/tsconfig.json',
            './frontend/tsconfig.json',
          ],
        },
      },
    },
    plugins: { import: importPlugin },
    rules: {
      // npm hoists node_modules, so a workspace can import a package it never
      // declared and still compile. This rule is the countermeasure, and it is
      // the whole point of US-3: each workspace's own package.json is the source
      // of truth for what that workspace may import.
      'import/no-extraneous-dependencies': 'error',
      'import/no-unresolved': 'error',

      // Definition of done: TypeScript strict, no `any` without a written
      // justification. Error rather than warn — a warning is a rule nobody obeys.
      '@typescript-eslint/no-explicit-any': 'error',

      // Definition of done: errors handled and logged, never swallowed.
      '@typescript-eslint/no-floating-promises': 'error',
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Unused values are usually a half-finished edit. `_`-prefixed names are
      // the documented way to say "deliberately discarded".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['backend/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    // AC3: configuration is read through TypedConfigService, never from
    // process.env directly. backend/src/config/ is the one place allowed to
    // touch the environment — everywhere else this is an error, not a
    // convention people are asked to remember.
    //
    // The exceptions are all code that runs *outside* the Nest application, so
    // TypedConfigService does not exist for it to use:
    //   - src/config/**        the config module itself
    //   - prisma.config.ts     read by the Prisma CLI, before any app exists
    //   - src/testing/**       test-database tooling and CLI wrappers
    //   - *.test.ts            harnesses that shell out or build a fixture env
    files: ['backend/**/*.ts'],
    ignores: [
      'backend/src/config/**',
      'backend/prisma.config.ts',
      'backend/src/testing/**',
      'backend/**/*.test.ts',
    ],
    rules: { 'no-process-env': 'error' },
  },

  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  {
    // node:test's `test()` returns a promise that the runner owns; not awaiting
    // it at the top level is the documented usage, not a swallowed error.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },

  {
    // Build-tool config outside any workspace project has no type information,
    // so the type-aware rules can only guess. Lint it syntactically.
    files: ['**/*.config.ts', '**/*.js', '**/*.mjs'],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },

  // Must stay last: switches off every stylistic rule Prettier owns.
  prettier,
);
