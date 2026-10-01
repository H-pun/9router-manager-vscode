import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      curly: 'warn',
      eqeqeq: ['warn', 'always'],
      'no-throw-literal': 'warn',
      'no-console': 'warn',
      'no-unused-vars': 'off',
      'no-undef': 'off',
      semi: ['warn', 'always'],
      'prefer-const': 'warn',
    },
  },
  {
    ignores: ['out/**', 'out-test/**', 'node_modules/**', 'webview-ui/**', 'reference/**', '*.mjs'],
  },
];
