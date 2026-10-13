#!/bin/sh
# Set the repo-local git identity (never --global) so commits are attributed to the
# repository owner in every session, including Claude Code on the web cloud sessions.
cd "$(dirname "$0")/.." || exit 1
git config user.name "Andreas Pachler"
git config user.email "apachler@paan-systems.com"
