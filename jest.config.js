'use strict';

/**
 * Jest configuration.
 *
 * Coverage is scoped to src/ and gated with thresholds set just below the
 * current numbers (≈99.8% lines, ≈94.5% branches). The gate only triggers
 * when coverage is collected (`npm run test:coverage` / CI), so the plain `npm test` loop stays
 * fast. Raise the floors as coverage improves — never lower them to make a PR
 * pass.
 */
module.exports = {
    testEnvironment: 'node',
    collectCoverageFrom: ['src/**/*.js'],
    coveragePathIgnorePatterns: ['/node_modules/', '/test/'],
    coverageThreshold: {
        global: {
            statements: 97,
            branches: 90,
            functions: 97,
            lines: 97,
        },
    },
};
