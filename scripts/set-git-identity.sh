#!/bin/sh
# SessionStart hook (.claude/settings.json), run for everyone who uses Claude
# Code in a clone of this repo, so it must not touch a contributor's setup.
# Both steps apply only when origin is the maintainer's repo.
cd "$(dirname "$0")/.." || exit 1

case "$(git remote get-url origin 2>/dev/null)" in
    *apachler/gree-hvac-client*) ;;
    *) exit 0 ;;
esac

# Fresh cloud sessions (Claude Code on the web) start without any git
# identity: attribute their commits to the repository owner. A clone with an
# identity of its own (repo-local or global) is left alone.
if [ -z "$(git config user.email)" ]; then
    git config user.name "Andreas Pachler"
    git config user.email "apachler@paan-systems.com"
fi

# This fork has an `upstream` remote (inwaar), and gh resolves bare commands
# (gh pr create/list/checks) to it unless a default repo is set. Pin the fork
# as gh's default — the same repo-local config `gh repo set-default` writes.
git config remote.origin.gh-resolved base
