import eslint from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'out/',
            'dist/',
            'coverage/',
            '**/node_modules/**',
            '.vscode-test/',
            '*.vsix',
            'test/e2e/fixture/',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        languageOptions: {
            globals: { ...globals.node, ...globals.mocha },
        },
        rules: {
            'no-console': 'error',
            eqeqeq: ['error', 'always'],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { fixStyle: 'inline-type-imports' },
            ],
        },
    },
    {
        // Test runner inside the extension host: prints results and loads suites dynamically.
        files: ['test/e2e/**/*.ts'],
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    {
        files: ['src/db/worker.ts'],
        rules: {
            // The worker must never import the VS Code API (it runs in a worker thread).
            'no-restricted-imports': ['error', { paths: ['vscode'] }],
        },
    },
    {
        files: ['src/core/**/*.ts'],
        rules: {
            // Core logic is pure and unit-tested without VS Code.
            'no-restricted-imports': ['error', { paths: ['vscode'] }],
        },
    },
    {
        files: ['webview-ui/**/*.{ts,tsx}'],
        plugins: { 'react-hooks': reactHooks },
        languageOptions: {
            globals: { ...globals.browser },
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            'no-console': 'error',
            '@typescript-eslint/no-explicit-any': 'error',
        },
    },
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        languageOptions: { globals: { ...globals.node } },
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
            'no-console': 'off',
        },
    }
);
