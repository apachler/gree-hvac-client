// Validates commit messages against Conventional Commits.
// semantic-release derives the next version + changelog from these messages,
// so keeping them well-formed directly drives releases.
module.exports = {
    extends: ['@commitlint/config-conventional'],
    // semantic-release authors its release commit ("chore(release): x.y.z") with
    // the full release notes in the body, whose lines can exceed the length
    // rules — never lint that machine-generated commit.
    ignores: [message => /^chore\(release\):/.test(message)],
};
