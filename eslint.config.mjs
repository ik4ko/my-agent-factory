import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * ESLint flat config.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * `package.json` used to run `next lint`, which Next 16 removed. There was
 * also no `eslint` dependency and no config file, so `npm run lint` had been
 * failing with "Invalid project directory provided: .../lint" rather than
 * linting anything. Nothing here has ever been linted in CI.
 *
 * eslint-config-next 16.2.x ships native flat configs on its subpath exports,
 * so no `FlatCompat`/`@eslint/eslintrc` shim is needed — importing the arrays
 * directly is the supported path for this version.
 *
 * ── Baseline policy ───────────────────────────────────────────────────────
 * This turns linting ON without turning the repo red. The rules below are the
 * stock Next presets; the only local changes are `ignores` for build output
 * and generated artifacts. No rule is disabled to hide a real problem, and no
 * blanket `--fix` was run across legacy files.
 *
 * If a rule here is genuinely wrong for this codebase, downgrade it in the
 * final block with a comment saying why — do not delete the preset.
 */
export default [
  {
    // Generated, vendored, or build output. Linting these produces thousands
    // of meaningless findings and hides the real ones.
    ignores: [
      '.next/**',
      '.next-preview/**',
      'out/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'next-env.d.ts',
      // Graph tooling output committed to the repo — machine-written HTML/JS.
      'graphify-out/**',
      'public/**',
      '**/*.min.js',
      // Vendored UI-redesign handoff bundle. Not application source and not
      // built by this project; it is kept for reference only.
      'Design/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    // Jest specs run in Node with Jest globals. Without this the preset flags
    // `describe`/`it`/`expect` as undefined in every test file.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**/*.{ts,tsx}', 'jest.setup.*'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
  },

  {
    // Node-side scripts and config files are not browser code.
    files: ['scripts/**/*.{ts,mts,js,mjs}', '*.config.{js,mjs,ts}', 'jest.config.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
];
