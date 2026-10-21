/**
 * Soft ESLint config: the point is to catch dead code and Broken Rules-of-React
 * bugs (like a helper whose only caller is its own test), not to reformat the
 * tree. Formatting stays out of scope on purpose — no stylistic rules.
 */
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'dist/**', 'dist-electron/**', 'release/**', 'target/**', 'node_modules/**',
      '.freebuff/**', '**/*.cjs', '**/*.mjs',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Diagnostics, not blockers: a `no-unused-vars` hit is usually a name left
      // behind by a refactor, so warning keeps `npm run lint` useful locally while
      // CI still shows it. The base rules react-hooks ships are errors.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Downgraded -- the codebase leans on these on purpose:
      //   no-explicit-any: interfaces marked deliberately loose in tool parsing;
      //   refs: `agent/memory.ts` uses ref mirrors by design to hand the agent a
      //   stable view of state into callbacks without re-binding them;
      //   set-state-in-effect: the welcome/config sync patterns re-run once on mount.
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // The mockups/rs helper scripts are plain browser targets without the DOM lib
    // typing they would need; tsc covers them, eslint stays out.
    files: ['src/**/*.tsx'],
    rules: {
      // tsconfig has noUnusedLocals, but the renderer builds with vite separately.
    },
  },
)
