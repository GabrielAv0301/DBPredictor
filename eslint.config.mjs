import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.test.json'],
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
                ...globals.mocha
            }
        },
        rules: {
            '@typescript-eslint/no-unused-vars': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-console': 'error',
            'semi': ['error', 'always'],
            'quotes': ['error', 'single']
        },
    },
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            globals: {
                ...globals.node,
            }
        },
        rules: {
            'no-console': 'off', // Permitimos console en scripts de build
            '@typescript-eslint/no-require-imports': 'off'
        }
    },
    {
        ignores: ['out/', 'dist/', '**/node_modules/**', 'webview-ui/']
    }
);
