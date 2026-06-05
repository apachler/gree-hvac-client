// Validates commit messages against Conventional Commits.
// semantic-release derives the next version + changelog from these messages,
// so keeping them well-formed directly drives releases.
module.exports = {
    extends: ['@commitlint/config-conventional'],
};
