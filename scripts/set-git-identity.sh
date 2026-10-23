#!/bin/sh
# Set the repo-local git identity (never --global) so commits are attributed to the
# repository owner in every session, including Claude Code on the web cloud sessions.
cd "$(dirname "$0")/.." || exit 1
git config user.name "Andreas Pachler"
git config user.email "apachler@paan-systems.com"

# This fork has an `upstream` remote (inwaar), and gh resolves bare commands
# (gh pr create/list/checks) to it unless a default repo is set. Pin the fork
# as gh's default — only when origin is the fork, so a contributor's clone of
# their own fork is left alone. Same repo-local config `gh repo set-default`
# writes.
case "$(git remote get-url origin 2>/dev/null)" in
    *apachler/gree-hvac-client*) git config remote.origin.gh-resolved base ;;
esac
