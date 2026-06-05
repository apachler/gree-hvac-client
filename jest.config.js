'use strict';

/**
 * Jest configuration.
 *
 * Coverage is scoped to src/ and gated with thresholds set just below the
 * current numbers (≈90% lines). The gate only triggers when coverage is
 * collected (`npm run test:coverage` / CI), so the plain `npm test` loop stays
 * fast. Raise the floors as coverage improves — never lower them to make a PR
 * pass.
 */
module.exports = {
    testEnvironment: 'node',
    collectCoverageFrom: ['src/**/*.js'],
    coveragePathIgnorePatterns: ['/node_modules/', '/test/'],
    coverageThreshold: {
        global: {
            statements: 85,
            branches: 70,
            functions: 80,
            lines: 85,
        },
    },
};
