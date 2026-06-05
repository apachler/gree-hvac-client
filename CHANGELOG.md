# [3.0.0](https://github.com/apachler/gree-hvac-client/compare/v2.2.0...v3.0.0) (2026-06-05)


* feat!: establish independent fork release line (Git + GitHub Releases) ([03f4af7](https://github.com/apachler/gree-hvac-client/commit/03f4af79832ca9b6544b6c9c1e4cb0682642babf))


### Bug Fixes

* guard logger against throws so logging can't crash the client ([6f8c39f](https://github.com/apachler/gree-hvac-client/commit/6f8c39fc7089a7c14acd3134e6a26454cb9a74f3))
* read GREE_HVAC_POLLING_TIMEOUT env override ([9ce1166](https://github.com/apachler/gree-hvac-client/commit/9ce11669d7ca432ce5f30abaec7980258c561818))


### BREAKING CHANGES

* starts a new 3.x release line diverging from the upstream 2.x
package. Runtime-compatible with 2.2.0 (no API changes), but published under new
ownership/repository and consumed via Git/GitHub Releases instead of npm, so it
is released as a major version.

# Changelog

All notable changes to this project are documented here. This file is generated
and maintained automatically by
[semantic-release](https://github.com/semantic-release/semantic-release) from the
Conventional-Commit history on each release — do not edit it by hand. The tagged
GitHub Release (with the installable `.tgz`) is the canonical distribution.
