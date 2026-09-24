import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * Security guardrail: git (and every other process) must be spawned with an
 * argument array, never through a shell. These rules make the build fail if
 * anyone reaches for exec()/execSync() or `shell: true`.
 */
const noShellRules = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'child_process',
          importNames: ['exec', 'execSync'],
          message: 'Use spawn() with an argument array (no shell).'
        },
        {
          name: 'node:child_process',
          importNames: ['exec', 'execSync'],
          message: 'Use spawn() with an argument array (no shell).'
        }
      ]
    }
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "Property[key.name='shell'][value.value=true]",
      message: 'shell: true is forbidden; pass an argument array instead.'
    }
  ]
}

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'coverage/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      ...noShellRules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
)
