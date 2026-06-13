'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const jsdoc = require('eslint-plugin-jsdoc');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

// Flat config (ESLint 9). Mirrors the previous .eslintrc.js: eslint:recommended
// + jsdoc/recommended + prettier, with the same rule overrides.
module.exports = [
    {
        // Generated / vendored output — never linted.
        ignores: ['coverage/**', 'docs/**'],
    },
    js.configs.recommended,
    jsdoc.configs['flat/recommended'],
    prettierRecommended,
    {
        languageOptions: {
            ecmaVersion: 2021,
            // This package is CommonJS (module.exports / require).
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            'prefer-const': 'error',
            'no-var': 'error',
            'jsdoc/require-property-description': 'off',
            'jsdoc/require-param-type': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns-description': 'off',
            'jsdoc/check-property-names': 'off',
            'jsdoc/sort-tags': 'error',
            'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
            // Rules the previous eslint-plugin-jsdoc@43 `recommended` enforced
            // but v63's flat/recommended dropped. Restored for parity:
            // no-undefined-types also marks JSDoc-referenced imports (e.g.
            // ClientError) as used, so no-unused-vars doesn't flag them.
            'jsdoc/no-undefined-types': 'warn',
            'jsdoc/valid-types': 'warn',
            // New TS-flavoured JSDoc rules v63 added to recommended. Out of
            // scope for the toolchain bump — left for the TypeScript task (#3).
            'jsdoc/check-types': 'off',
            'jsdoc/no-empty-object-type': 'off',
            'jsdoc/ts-no-empty-object-type': 'off',
            'jsdoc/reject-function-type': 'off',
        },
    },
];
